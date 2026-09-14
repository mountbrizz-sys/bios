const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 10, 12, 0); // Thu Sep 10 2026, noon
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { if (args.length === 0) return new RealDate(FAKE_NOW); return new RealDate(...args); }
  static now() { return new RealDate(FAKE_NOW).getTime(); }
}

let failures = 0;
function check(name, cond) {
  if (cond) console.log('PASS:', name);
  else { console.log('FAIL:', name); failures++; }
}

const seedProfile = { name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45, created: new RealDate(2026,7,20).getTime() };
const seedHabits = [
  { id: 'hb1', name: 'Reading', cat: 'learning', dur: 30, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
];
const seedAppts = [
  { id: 'a1', title: 'Standup', date: '2026-09-10', time: '09:00', end: '09:30', cat: 'work', note: '' },
];

const consoleErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => consoleErrors.push(e));
virtualConsole.on('error', (...a) => consoleErrors.push(a));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole,
  beforeParse(win) {
    win.Date = FixedDate;
    win.localStorage.setItem('bios_profile', JSON.stringify(seedProfile));
    win.localStorage.setItem('bios_habits', JSON.stringify(seedHabits));
    win.localStorage.setItem('bios_appts', JSON.stringify(seedAppts));
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;
    // Force the initial render explicitly rather than relying on the timing
    // of window's 'load' event having already fired by this point.
    window.renderToday();
    window.renderTimeline();

    check('the separate #todayList checklist no longer exists at all', !doc.getElementById('todayList'));
    check('the "Today\'s habits" section header is gone', !doc.body.innerHTML.includes("Today's habits"));
    check('the empty-state banner is hidden when habits exist', doc.getElementById('todayNoHabitsBanner').style.display === 'none');

    const tl = doc.getElementById('todayTimeline');
    check('the merged timeline contains the habit (Reading)', tl.innerHTML.includes('Reading'));
    check('the merged timeline contains the appointment (Standup)', tl.innerHTML.includes('Standup'));
    check('habit row is labeled "Habit · learning"', tl.innerHTML.includes('Habit · learning'));
    check('appt row is labeled "Appt · work"', tl.innerHTML.includes('Appt · work'));
    check('habit rows do NOT show a streak badge in the merged view (dropped per decision)', !/habit-streak/.test(tl.innerHTML));

    const rows = [...tl.querySelectorAll('.tl-row')];
    const habitRow = rows.find(r => r.textContent.includes('Reading'));
    const apptRow = rows.find(r => r.textContent.includes('Standup'));
    check('habit row has a checkbox-style control', habitRow && habitRow.querySelector('.habit-check'));
    check('habit row is clickable (cursor:pointer + onclick set)', habitRow && habitRow.getAttribute('onclick') && habitRow.getAttribute('onclick').includes('toggleCheck'));
    check('appt row has no checkbox (that\'s habit-only)', apptRow && !apptRow.querySelector('.habit-check'));
    check('appt row opens the edit sheet on click, not an instant delete', apptRow && apptRow.getAttribute('onclick') && apptRow.getAttribute('onclick').includes("editAppt('a1')"));
    check('appt row has no bare delete (X) button — deletion goes through the edit sheet', apptRow && !apptRow.querySelector('.tl-del'));

    // Tapping the habit row should toggle it done, exactly like the old
    // separate checklist did. confetti() uses the Web Animations API,
    // which jsdom doesn't implement — a known harness gap (verified
    // earlier in this project), not an app bug, so we swallow just that.
    const doneBefore = doc.getElementById('today-done').textContent;
    try { window.toggleCheck('hb1'); } catch (e) { if (!/animate is not a function/.test(String(e))) throw e; }
    const doneAfter = doc.getElementById('today-done').textContent;
    check('header done-count increments after toggling the habit', Number(doneAfter) === Number(doneBefore) + 1);
    const tlAfter = doc.getElementById('todayTimeline');
    check('habit row now renders in the "past/done" strikethrough style', /tl-row past/.test(tlAfter.innerHTML) && tlAfter.innerHTML.includes('Reading'));
    window.toggleCheck('hb1'); // undo for cleanliness (unchecking never fires confetti)

    // Tapping the appointment row should open the real edit sheet.
    const apptRow2 = [...doc.getElementById('todayTimeline').querySelectorAll('.tl-row')].find(r => r.textContent.includes('Standup'));
    apptRow2.click();
    check('clicking the appointment row opens the edit-appointment sheet', doc.getElementById('editApptOverlay').classList.contains('open'));
    check('the edit sheet is prefilled with the right appointment', doc.getElementById('edit-appt-title').value === 'Standup');
    window.closeEditAppt();

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    // Zero-habits case, run last since it removes the seeded habit: delete
    // it and confirm the empty-state banner reappears (deleteHabit goes
    // through the confirm modal, same pattern as every other delete here).
    window.deleteHabit('hb1');
    doc.getElementById('confirmOkBtn').click();
    check('empty-state banner appears once there are zero habits scheduled', doc.getElementById('todayNoHabitsBanner').style.display === 'block');
    check('empty-state banner text matches the original wording', doc.getElementById('todayNoHabitsBanner').textContent.includes('No habits scheduled today'));

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
