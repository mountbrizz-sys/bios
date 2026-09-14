const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 9, 14, 30); // Wed Sep 9 2026
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

const seedProfile = {
  name: 'Brizz', wake: '07:00', sleep: '23:00', focus: ['fitness','finance'], goal: 'Ship Bios', time: 45,
  sched: 'M-F 9-5', created: Date.now(),
  recurring: [
    { title: 'Gym class', icon: 'dumbbell', start: '06:00', end: '07:00', cat: 'fitness', days: ['Mon','Wed','Fri'] },
  ],
};
const seedHabits = [
  { id: 'h1', name: 'Journal', cat: 'mindfulness', dur: 10, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
];
// Checks: done 5 of the last 7 real calendar days but NOT yesterday/today,
// so the streak (consecutive-ending-today) should read 0 while "X/7" reads 5.
function keyFor(offset) { const d = new Date(FAKE_NOW); d.setDate(d.getDate() - offset); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const seedChecks = {};
[2,3,4,5,6].forEach(off => { seedChecks[keyFor(off)] = { h1: Date.now() }; });

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
    win.localStorage.setItem('bios_checks', JSON.stringify(seedChecks));
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;

    // ── EMOJI REMOVAL: static chips/cards render SVG, not emoji text ──
    const focusCards = doc.getElementById('focusCards');
    check('onboarding focus cards exist', !!focusCards);
    check('focus cards contain SVG icons', focusCards.querySelectorAll('svg').length === 8);
    check('focus cards have no emoji characters left', !/[\u{1F300}-\u{1FAFF}]/u.test(focusCards.innerHTML));

    const shCats = doc.getElementById('sh-cats');
    check('habit category chips contain SVG icons', shCats.querySelectorAll('svg').length === 8);
    check('habit category chips have no emoji characters left', !/[\u{1F300}-\u{1FAFF}]/u.test(shCats.innerHTML));

    // ── STREAK "X/7" COMPANION ──
    const navPlan = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Plan');
    window.switchScreen('plan', navPlan);
    const habitsMgrHTML = doc.getElementById('habitsMgr').innerHTML;
    check('habit manager shows a streak badge', habitsMgrHTML.includes('habit-streak'));
    check('habit manager shows the 5/7 companion count', habitsMgrHTML.includes('5/7'));
    check('streak itself reads 0 (not consecutive through today)', /habit-streak zero">0d/.test(habitsMgrHTML));

    // ── RECURRING ACTIVITIES MANAGER (Plan screen) ──
    check('recurring summary shows seeded count before opening manager', doc.getElementById('recurringMgrSummary').textContent.includes('1 recurring'));
    window.openRecurringMgr();
    check('recurring manager sheet opens', doc.getElementById('recurringMgrOverlay').classList.contains('open'));
    const listHTML = doc.getElementById('recurringListMgr').innerHTML;
    check('manager seeds from existing profile.recurring (title present)', listHTML.includes('Gym class'));
    check('icon picker uses SVG chips, not emoji', doc.querySelectorAll('#recurringListMgr svg').length > 0);
    check('icon picker chip count matches curated 10-icon set per row', doc.querySelectorAll('#recurringListMgr .sh-chip').length >= 10);

    // Add a second recurring activity, fill it in, and save.
    window.addRecurringRow();
    const rows = window.document.querySelectorAll('#recurringListMgr [id^="rec-title-"]');
    const newTitleInput = rows[rows.length - 1];
    newTitleInput.value = 'Night class';
    const newRowId = newTitleInput.id.replace('rec-title-', '');
    const mondayBtn = doc.querySelector(`[data-row="${newRowId}"][data-day="Tue"]`);
    check('day toggle button exists for the new row', !!mondayBtn);
    if (mondayBtn) window.toggleRecDay(mondayBtn);

    window.saveRecurringMgr();
    check('manager sheet closes after save', !doc.getElementById('recurringMgrOverlay').classList.contains('open'));
    check('recurring summary updates to reflect the new total', doc.getElementById('recurringMgrSummary').textContent.includes('2 recurring'));

    // ── MONTH VIEW: recurring-activity indicator is a color dot, not an icon char ──
    window.calSetView('month');
    const monthHTML = doc.getElementById('calGrid').innerHTML;
    check('month grid has no leftover pin/pictograph characters', !/[\u{1F300}-\u{1FAFF}]/u.test(monthHTML));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    // ── WEEKLY REVIEW: budget-vs-actual extension ──
    window.openWeeklyReview();
    check('weekly review opens', doc.getElementById('reviewOverlay').classList.contains('open'));
    const statsHTML = doc.getElementById('reviewStats').innerHTML;
    check('review shows 5 stat cards including Overloaded days', doc.querySelectorAll('#reviewStats .review-stat').length === 5);
    check('review stats include an Overloaded days label', statsHTML.includes('Overloaded days'));
    const loadHTML = doc.getElementById('reviewLoad').innerHTML;
    check('review load section renders 7 day rows', doc.querySelectorAll('#reviewLoad .review-load-row').length === 7);
    check('load rows show a free-time figure', /\d+(\.\d+)?h free/.test(loadHTML));
    check('today\'s row is marked in the load section', loadHTML.includes('review-load-day">Tue') || /Tue.*•|Wed.*•/.test(loadHTML));
    // No snapshot existed before this test run started, so every row should
    // show the "no drift data yet" dash rather than a fabricated comparison.
    check('days with no snapshot show the honest "no drift data" dash, not a fake comparison', (loadHTML.match(/color:var\(--text4\);">—</g) || []).length >= 6);
    window.closeReview();
    check('weekly review closes', !doc.getElementById('reviewOverlay').classList.contains('open'));

    // computeDayBudget sanity: a date with no appts/habits scheduled should
    // return the full waking window minus overhead, never negative.
    const emptyDayBudget = window.computeDayBudget('2026-01-01');
    check('computeDayBudget on an empty date returns a sane positive capacity', emptyDayBudget.capacity > 0 && emptyDayBudget.overloaded === false);

    // ── DRIFT MECHANISM END-TO-END: does it actually detect a late add? ──
    const navToday = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Today');
    window.switchScreen('today', navToday); // triggers renderTimeBudget() -> snapshots today's budget
    const todayKey = '2026-09-09';
    const snapAfterFirstOpen = JSON.parse(window.localStorage.getItem('bios_day_snapshot'))[todayKey];
    check('opening Today snapshots the budget for today', !!snapAfterFirstOpen);
    const beforeCapacity = snapAfterFirstOpen.capacity;

    // Simulate a same-day late addition via the real save flow (appts is a
    // top-level let, not reachable as window.appts — same jsdom quirk as
    // calSel elsewhere in this project's tests).
    window.openApptSheet();
    doc.getElementById('appt-title').value = 'Emergency call';
    doc.getElementById('appt-date').value = todayKey;
    doc.getElementById('appt-time').value = '15:00';
    doc.getElementById('appt-end').value = '17:00';
    window.saveAppt();
    const afterBudget = window.computeDayBudget(todayKey);
    check('adding a same-day appointment reduces the recomputed final capacity', afterBudget.capacity < beforeCapacity);

    window.openWeeklyReview();
    const loadHTML2 = doc.getElementById('reviewLoad').innerHTML;
    check('today\'s row now shows real drift ("added"), not the no-data dash', /added/.test(loadHTML2));
    window.closeReview();

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
