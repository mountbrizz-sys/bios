const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

// "Today" = Thursday Sep 10, 2026 — mid-week, so the week Mon 7 -> Sun 13
// has both past days (Mon-Wed) and future days (Fri-Sun) to inspect.
const FAKE_NOW = new Date(2026, 8, 10, 15, 0);
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

// ── Realistic trial-user data ──
const seedProfile = {
  name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness','learning'], goal: 'Get consistent', time: 45,
  sched: 'M-F 9-5', created: new RealDate(2026, 7, 20).getTime(), // account 3 weeks old, past the "too new" gate
};
const seedHabits = [
  // Frequency habit: gym twice a week, no fixed days -- the case in question.
  { id: 'gym', name: 'Gym', cat: 'fitness', dur: 60, mode: 'freq', target: 2, days: [] },
  // A normal fixed-day habit for contrast/control.
  { id: 'read', name: 'Reading', cat: 'learning', dur: 30, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
];
// Trial user actually went to the gym once this week: Wednesday Sep 9.
const seedChecks = {
  '2026-09-09': { gym: RealDate.now() },
};
const seedAppts = [
  { id: 'a1', title: 'Team sync', date: '2026-09-08', time: '10:00', end: '10:30', cat: 'work', note: '' },
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
    win.localStorage.setItem('bios_checks', JSON.stringify(seedChecks));
    win.localStorage.setItem('bios_appts', JSON.stringify(seedAppts));
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);

    const week = { Mon: '2026-09-07', Tue: '2026-09-08', Wed: '2026-09-09', Thu: '2026-09-10', Fri: '2026-09-11', Sat: '2026-09-12', Sun: '2026-09-13' };

    console.log('\n-- Walking each day of the week, checking for the Gym block --\n');
    const results = {};
    Object.keys(week).forEach(day => {
      window.selectCalDay(week[day]);
      const html = doc.getElementById('calDayCol').innerHTML;
      results[day] = html.includes('Gym');
      console.log(day, week[day], '-> Gym block shown:', results[day]);
    });

    console.log('\n-- Verdict --\n');
    check('Gym now shows on Wed at its REAL completion time (fixed: previously hidden entirely)', results.Wed === true);
    check('Gym target (2) is not yet met this week (only 1 done)', window.weekDoneCount('gym', window.calParse('2026-09-10')) < window.habitTarget({target:2}));

    // The fix: no more phantom "still owed" block on days BEFORE the
    // week's actual completion (Monday and Tuesday), since nothing
    // happened on those days and, chronologically, there was no way to
    // know yet whether the week's target would be met later.
    const phantomOnPast = results.Mon || results.Tue;
    check('FIXED: no phantom "still owed" block on past days (Mon/Tue) before the completion', phantomOnPast === false);

    // And does it also show on the still-future days, which is the ONE case
    // where "still owed" is an honest, useful signal?
    check('Gym still shows on future days this week (Fri/Sat/Sun) -- correctly, since target isn\'t met yet', results.Fri && results.Sat && results.Sun);

    // Control: the fixed-day habit ("Reading") should behave correctly on
    // every day regardless of past/future, since it's not target-based.
    Object.keys(week).forEach(day => {
      window.selectCalDay(week[day]);
      const html = doc.getElementById('calDayCol').innerHTML;
      check('Reading (fixed-day control habit) shows correctly on ' + day, html.includes('Reading'));
    });

    console.log('\n' + (failures === 0 ? 'ALL CHECKS RESOLVED AS EXPECTED' : failures + ' UNEXPECTED RESULT(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
