const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 14, 12, 0); // Monday
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

// A recurring "Trade" activity, Mon/Wed/Fri 9:00-10:30, already generated
// out to three occurrences this week -- exactly what topUpRecurring()
// would have produced from this template.
const seedProfile = {
  name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45,
  created: new RealDate(2026,7,20).getTime(),
  recurring: [
    { title: 'Trade', icon: 'dollar', start: '09:00', end: '10:30', cat: 'personal', days: ['Mon','Wed','Fri'] },
  ],
};
const seedAppts = [
  { id: 'rec_1_mon', title: 'Trade', date: '2026-09-14', time: '09:00', end: '10:30', cat: 'personal', note: 'Recurring' },
  { id: 'rec_1_wed', title: 'Trade', date: '2026-09-16', time: '09:00', end: '10:30', cat: 'personal', note: 'Recurring' },
  { id: 'rec_1_fri', title: 'Trade', date: '2026-09-18', time: '09:00', end: '10:30', cat: 'personal', note: 'Recurring' },
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
    win.localStorage.setItem('bios_habits', JSON.stringify([]));
    win.localStorage.setItem('bios_version', '3');
    win.localStorage.setItem('bios_appts', JSON.stringify(seedAppts));
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;

    // Edit Monday's occurrence: move it from 9:00-10:30 to 10:00-11:30,
    // exactly like the reported scenario.
    window.editAppt('rec_1_mon');
    doc.getElementById('edit-appt-time').value = '10:00';
    doc.getElementById('edit-appt-end').value = '11:30';
    window.saveEditAppt();

    let appts = JSON.parse(window.localStorage.getItem('bios_appts'));
    let mon = appts.find(a => a.id === 'rec_1_mon');
    check('the edited Monday occurrence saved the new time immediately', mon.time === '10:00' && mon.end === '11:30');
    check('BUG FIX: editing detaches it from the recurring group (note is no longer "Recurring")', mon.note !== 'Recurring');

    const wed = appts.find(a => a.id === 'rec_1_wed');
    const fri = appts.find(a => a.id === 'rec_1_fri');
    check('Wednesday\'s occurrence is untouched (still 9:00-10:30, still Recurring)', wed.time === '09:00' && wed.note === 'Recurring');
    check('Friday\'s occurrence is untouched too', fri.time === '09:00' && fri.note === 'Recurring');

    // ── THE ACTUAL BUG: simulate what every real app load does ──
    window.topUpRecurring();

    appts = JSON.parse(window.localStorage.getItem('bios_appts'));
    mon = appts.find(a => a.id === 'rec_1_mon');
    check('BUG FIX: after topUpRecurring() runs again (simulating a reload), the edit SURVIVES', mon && mon.time === '10:00' && mon.end === '11:30');

    const monRecurringDuplicates = appts.filter(a => a.date === '2026-09-14' && a.title === 'Trade' && a.note === 'Recurring');
    check('no duplicate "Trade" got regenerated for Monday at the old 9:00 slot', monRecurringDuplicates.length === 0);

    const wedAfter = appts.find(a => a.id === 'rec_1_wed');
    check('Wednesday and Friday are still correctly managed by the recurring template (unaffected either way)', wedAfter && wedAfter.time === '09:00' && wedAfter.note === 'Recurring');

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);
  } catch (e) {
    console.error('TEST THREW:', e);
    failures++;
  }
})();

// ── Separate check: a recurring activity with TWO distinct times on the
// same day (per-day dayTimes) must still get both slots generated, even
// after the single-slot detach-fix above changed how "already covered" is
// determined. ──
(() => {
  const seedProfile2 = {
    name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45,
    created: new RealDate(2026,7,20).getTime(),
    recurring: [
      { title: 'Shift', icon: 'work', cat: 'work', days: ['Mon'], dayTimes: { Mon: [{ start: '09:00', end: '11:00' }, { start: '15:00', end: '17:00' }] } },
    ],
  };
  const consoleErrors2 = [];
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', (e) => consoleErrors2.push(e));
  vc2.on('error', (...a) => consoleErrors2.push(a));
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole: vc2,
    beforeParse(win) {
      win.Date = FixedDate;
      win.localStorage.setItem('bios_profile', JSON.stringify(seedProfile2));
      win.localStorage.setItem('bios_habits', JSON.stringify([]));
      win.localStorage.setItem('bios_version', '3');
      win.localStorage.setItem('bios_appts', JSON.stringify([]));
    }
  });
  const win2 = dom2.window;
  win2.Date = FixedDate;
  win2.topUpRecurring();
  const appts2 = JSON.parse(win2.localStorage.getItem('bios_appts'));
  const mondayShifts = appts2.filter(a => a.date === '2026-09-14' && a.title === 'Shift');
  check('multi-slot recurring day still generates BOTH time slots (not suppressed by the single-slot fix)', mondayShifts.length === 2);
  check('no console/runtime errors in the multi-slot check', consoleErrors2.length === 0);
})();

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
