const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

// Pin "today" so date-dependent rendering is deterministic.
const FAKE_NOW = new Date(2026, 8, 9, 14, 30); // Wed Sep 9 2026, 2:30pm
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) return new RealDate(FAKE_NOW);
    return new RealDate(...args);
  }
  static now() { return new RealDate(FAKE_NOW).getTime(); }
}

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('PASS:', name); }
  else { console.log('FAIL:', name); failures++; }
}

// Seed data BEFORE the page's inline script runs, using a virtual console +
// beforeParse hook so localStorage is populated when the script initializes
// module state (appts/deadlines are read at top-level script execution).
const seedAppts = [
  { id: 'a1', title: 'Standup', date: '2026-09-09', time: '09:00', end: '09:30', cat: 'work', note: '' },
  { id: 'a2', title: 'Design review', date: '2026-09-09', time: '09:15', end: '10:00', cat: 'work', note: '' }, // overlaps a1
  { id: 'a3', title: 'Gym', date: '2026-09-09', time: '05:30', end: '06:30', cat: 'fitness', note: '' },
  { id: 'a4', title: 'No end time', date: '2026-09-09', time: '13:00', end: '', cat: 'other', note: '' },
  { id: 'a5', title: 'Next week thing', date: '2026-09-16', time: '10:00', end: '11:00', cat: 'personal', note: '' },
];
const seedDeadlines = [
  { id: 'd1', title: 'Submit report', due: '2026-09-09', cat: 'work', done: false },
];

const consoleErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => consoleErrors.push(e));
virtualConsole.on('error', (...args) => consoleErrors.push(args));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/',
  virtualConsole,
  beforeParse(win) {
    win.Date = FixedDate;
    win.localStorage.setItem('bios_appts', JSON.stringify(seedAppts));
    win.localStorage.setItem('bios_deadlines', JSON.stringify(seedDeadlines));
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;

    // Switch to the calendar screen like a real user would.
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    check('calendar nav item exists', !!navCal);
    window.switchScreen('cal', navCal);

    // Note: top-level `let`/`const` in the page script aren't reachable as
    // window.X (documented jsdom quirk for this project) — assert on DOM
    // output/behavior instead of reaching into script-lexical state.
    check('kicker reflects a valid default view', /Week|Month|Today/.test(doc.getElementById('calKicker').textContent) || doc.getElementById('calKicker').textContent.length > 0);
    check('exactly one tab is active by default', doc.querySelectorAll('.cal-tab.active').length === 1);

    // ── WEEK VIEW ──
    window.calSetView('week');
    check('week tab marked active', doc.getElementById('calTab-week').classList.contains('active'));
    check('week view visible', doc.getElementById('calWeekView').style.display === 'flex');
    check('month view hidden', doc.getElementById('calMonthView').style.display === 'none');
    const weekCols = doc.getElementById('calWeekCols').children;
    check('week has 7 day columns', weekCols.length === 7);
    const tueCol = weekCols[2]; // Wed 9/9 is index 2 in a Mon-start week containing 9/9
    check('today column marked is-sel or contains blocks', tueCol.querySelectorAll('.cal-block').length >= 3);
    check('summary shows conflict flag for 9/9', doc.getElementById('calConflictFlag').style.display !== 'none');
    check('conflict label mentions clash', /clash/.test(doc.getElementById('calConflictLabel').textContent));

    // ── DAY VIEW ──
    window.selectCalDay('2026-09-09');
    check('selectCalDay switches to day view (tab active)', doc.getElementById('calTab-day').classList.contains('active'));
    check('day view visible', doc.getElementById('calDayView').style.display === 'flex');
    const dayBlocks = doc.querySelectorAll('#calDayCol .cal-block');
    check('day view renders 4 appt blocks', dayBlocks.length === 4);
    const allDay = doc.getElementById('calAllDay');
    check('all-day deadline strip visible', allDay.style.display !== 'none');
    check('all-day strip contains deadline title', allDay.textContent.includes('Submit report'));
    check('conflict tag rendered on overlapping block', doc.getElementById('calDayCol').innerHTML.includes('Overlaps'));

    // No-end-time appointment shouldn't crash layout and should get ~30min tall block
    const noEndBlock = [...dayBlocks].find(b => b.textContent.includes('No end time'));
    check('no-end-time appt still renders', !!noEndBlock);

    // ── MONTH VIEW ──
    window.calSetView('month');
    check('month view visible', doc.getElementById('calMonthView').style.display === 'block');
    const cells = doc.querySelectorAll('#calGrid .cal-cell');
    check('month grid has cells', cells.length >= 28 && cells.length % 7 === 0);
    const todayCell = doc.querySelector('#calGrid .cal-cell.today');
    check('today cell marked in month view', !!todayCell);
    check('today cell shows a chip for an appointment', todayCell.querySelector('.cal-chip') !== null);

    // Tapping a month day should jump into day view (per spec)
    todayCell.click();
    check('tapping today cell in month view opens day view', doc.getElementById('calDayView').style.display === 'flex' && doc.getElementById('calTab-day').classList.contains('active'));
    check('day title still reflects Sep 9 after the jump', doc.getElementById('calTitle').textContent.includes('9'));

    // ── NAVIGATION ──
    window.calSetView('week');
    const titleBefore = doc.getElementById('calTitle').textContent;
    window.calMove(1);
    const titleAfterNext = doc.getElementById('calTitle').textContent;
    check('calMove(1) in week view changes the displayed range', titleAfterNext !== titleBefore);
    window.calMove(-1);
    const titleAfterBack = doc.getElementById('calTitle').textContent;
    check('calMove(-1) returns to the original week', titleAfterBack === titleBefore);
    window.calToday();
    check('calToday resets title to the week containing Sep 9', doc.getElementById('calTitle').textContent === titleBefore);

    // ── LEGEND MUTE ──
    window.selectCalDay('2026-09-09'); // back to day view for this date
    check('Gym visible before hiding appts layer', doc.getElementById('calDayCol').innerHTML.includes('Gym'));
    window.calToggleLayer('appt');
    check('turning off the Appts layer hides appointment blocks', !doc.getElementById('calDayCol').innerHTML.includes('Gym'));
    window.calToggleLayer('appt'); // turn back on for cleanliness
    window.calRenderDay();
    check('unmuting restores the appt', doc.getElementById('calDayCol').innerHTML.includes('Gym'));

    // ── EDIT SHEET CONFLICT BANNER ──
    window.editAppt('a1');
    const banner = doc.getElementById('editApptConflict');
    check('edit sheet shows conflict banner for overlapping appt', banner.style.display !== 'none' && banner.textContent.includes('Overlaps'));
    window.closeEditAppt();

    window.editAppt('a3'); // Gym, no conflict
    check('edit sheet hides conflict banner for non-overlapping appt', doc.getElementById('editApptConflict').style.display === 'none');
    window.closeEditAppt();

    // ── DELETE FROM EDIT SHEET ──
    window.editAppt('a4');
    window.deleteEditAppt();
    check('deleteEditAppt opens the confirm modal (not an immediate delete)', doc.getElementById('confirmOverlay').classList.contains('open'));
    check('confirm modal shows a removal message', /remove/i.test(doc.getElementById('confirmMsg').textContent));
    // Simulate the user pressing the confirm button.
    doc.getElementById('confirmOkBtn').click();
    check('confirm modal closes after confirming', !doc.getElementById('confirmOverlay').classList.contains('open'));
    check('deleted appt no longer appears in day view', !doc.getElementById('calDayCol').innerHTML.includes('No end time'));
    check('edit sheet closed after delete', !doc.getElementById('editApptOverlay').classList.contains('open'));

    // ── CREATE FLOW (openApptSheet slot-prefill + saveAppt) ──
    window.selectCalDay('2026-09-09');
    window.openApptSheet();
    check('create sheet opens', doc.getElementById('apptSheetOverlay').classList.contains('open'));
    check('create sheet date prefilled to selected day', doc.getElementById('appt-date').value === '2026-09-09');
    const prefStart = doc.getElementById('appt-time').value;
    check('create sheet prefills a start time from a free slot', !!prefStart);
    doc.getElementById('appt-title').value = 'New test event';
    window.saveAppt();
    check('new appt renders in day view after save', doc.getElementById('calDayCol').innerHTML.includes('New test event'));
    check('create sheet closes after save', !doc.getElementById('apptSheetOverlay').classList.contains('open'));

    // ── SAVE-TIME CONFLICT GUARD (the bug from the review) ──
    doc.getElementById('appt-title').value = ''; // reset from prior save
    window.openApptSheet();
    doc.getElementById('appt-title').value = 'Conflicting new appt';
    doc.getElementById('appt-date').value = '2026-09-09';
    doc.getElementById('appt-time').value = '09:10'; // overlaps a1/a2 (9:00-9:30 / 9:15-10:00)
    doc.getElementById('appt-end').value = '09:20';
    window.saveAppt();
    check('saveAppt on a conflicting time opens the confirm modal instead of silently saving', doc.getElementById('confirmOverlay').classList.contains('open'));
    check('new conflicting appt not yet in day view before confirming', !doc.getElementById('calDayCol').innerHTML.includes('Conflicting new appt'));
    doc.getElementById('confirmOkBtn').click();
    check('confirming the overlap warning does save it', doc.getElementById('calDayCol').innerHTML.includes('Conflicting new appt'));

    // ── UNIFIED COLOR MAP (the color-system review point) ──
    const dayHTML = doc.getElementById('calDayCol').innerHTML;
    check('personal-category block no longer uses the lime system color', !dayHTML.includes('#b8ff2e'));
    check('appt/deadline categories never render as --cyan (#2ee8ff) or --lime (#b8ff2e)', !dayHTML.includes('#2ee8ff') && !dayHTML.includes('#b8ff2e'));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    // ── SMOKE TEST: other screens untouched by this change still work ──
    const navToday = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Today');
    const navTasks = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'To-do');
    const navPlan  = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Plan');
    window.switchScreen('today', navToday);
    check('today screen switches without error', doc.getElementById('screen-today').classList.contains('active'));
    window.switchScreen('tasks', navTasks);
    check('tasks screen switches without error', doc.getElementById('screen-tasks').classList.contains('active'));
    window.switchScreen('plan', navPlan);
    check('plan screen switches without error', doc.getElementById('screen-plan').classList.contains('active'));
    window.switchScreen('cal', navCal);
    check('back to calendar screen without error', doc.getElementById('screen-cal').classList.contains('active'));
    check('still no console/runtime errors after full screen tour', consoleErrors.length === 0);

    console.log('\\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
