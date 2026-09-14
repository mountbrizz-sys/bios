const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 13, 12, 0); // Sunday
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

// The exact scenario: "Meditar", mindfulness category, all 7 days, 15 min,
// evening preference -- plus a sleep-category habit for the same check.
const seedProfile = { name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45, created: new RealDate(2026,7,20).getTime() };
const seedHabits = [
  { id: 'med', name: 'Meditar', cat: 'mindfulness', dur: 15, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], pref: 'evening' },
  { id: 'wind', name: 'Wind down reading', cat: 'sleep', dur: 20, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
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
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;

    // ── TODAY'S SCHEDULE ──
    const navToday = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Today');
    window.switchScreen('today', navToday);
    window.renderTimeline();
    const tlHTML = doc.getElementById('todayTimeline').innerHTML;
    check('BUG FIX: the mindfulness habit (Meditar) now appears in Today\'s schedule', tlHTML.includes('Meditar'));
    check('BUG FIX: the sleep habit also now appears in Today\'s schedule', tlHTML.includes('Wind down reading'));

    // ── CALENDAR ──
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);
    window.selectCalDay('2026-09-13');
    const dayHTML = doc.getElementById('calDayCol').innerHTML;
    check('BUG FIX: Meditar now renders as a block in the calendar day view', dayHTML.includes('Meditar'));
    check('BUG FIX: the sleep habit also renders in the calendar', dayHTML.includes('Wind down reading'));

    // ── BUDGET CONSISTENCY: now that it's visibly scheduled, it should
    // count toward "planned" time too, not be silently excluded ──
    const budget = window.computeDayBudget('2026-09-13');
    check('planned time includes both habits\' duration (15+20=35min) alongside anything else', budget.habitMins >= 35);

    // ── Plan screen unaffected either way (never excluded these) ──
    window.renderHabits();
    check('Plan screen habit list still shows Meditar (was never affected by this bug)', doc.body.innerHTML.includes('Meditar'));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
