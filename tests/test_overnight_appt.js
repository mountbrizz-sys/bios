const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 11, 14, 0); // Fri Sep 11 2026
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

// The exact scenario from the screenshot: "Study" 8:00 PM Sep 11 -> 1:00 AM
// (i.e. Sep 12), plus a normal same-day appointment for contrast, plus an
// early-morning appointment on Sep 12 that the overnight one's spillover
// should correctly conflict with.
const seedProfile = { name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45, created: new RealDate(2026,7,20).getTime() };
const seedAppts = [
  { id: 'study', title: 'Study', date: '2026-09-11', time: '20:00', end: '01:00', cat: 'personal', note: '' },
  { id: 'normal', title: 'Dinner', date: '2026-09-11', time: '18:00', end: '19:00', cat: 'social', note: '' },
  { id: 'earlybird', title: 'Early flight check-in', date: '2026-09-12', time: '00:30', end: '01:30', cat: 'other', note: '' }, // should conflict with Study's spillover
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

    // ── TODAY (Sep 11): the overnight appt should render truncated at
    // midnight visually, but its full duration should count toward the
    // day's booked/gap stats ──
    window.selectCalDay('2026-09-11');
    const dayHTML = doc.getElementById('calDayCol').innerHTML;
    check('Study renders on its own date', dayHTML.includes('Study'));
    check('Study\'s meta text shows the REAL end time (1:00 AM), not a truncated one', dayHTML.includes('1:00 AM'));
    check('Dinner (normal same-day appt) still renders correctly', dayHTML.includes('Dinner'));

    const statsToday = window.calDayStats('2026-09-11');
    // Study should count for its full ~5 hours (8pm-1am = 300min), not the
    // old silent-collapse fallback of 30min.
    check('today\'s booked time reflects the FULL overnight duration, not a 30min collapse', statsToday.booked >= 300);

    // ── TOMORROW (Sep 12): no visible block for the spillover, but the
    // early-morning hour should still count as busy, and the early flight
    // check-in should be flagged as conflicting with it ──
    window.selectCalDay('2026-09-12');
    const nextDayHTML = doc.getElementById('calDayCol').innerHTML;
    const nextDayBlockTitles = [...doc.querySelectorAll('#calDayCol .cal-day-block-title')].map(t => t.textContent);
    check('no visible spillover BLOCK for Study on the next day (by design)', !nextDayBlockTitles.includes('Study'));
    check('"Study" only appears in a conflict tag referencing it, not as its own block', nextDayHTML.includes('Overlaps Study'));
    check('the early-morning appointment on the next day still renders', nextDayHTML.includes('Early flight'));
    check('the next-day appointment IS flagged as conflicting with the overnight spillover', nextDayHTML.includes('Overlaps'));

    const statsTomorrow = window.calDayStats('2026-09-12');
    check('tomorrow\'s stats register a conflict from the spillover', statsTomorrow.conflicts > 0);

    // ── MONTH VIEW: no duplicate/spillover chip bleeding onto the next day ──
    window.calSetView('month');
    const monthHTML = doc.getElementById('calGrid').innerHTML;
    const cells = [...doc.querySelectorAll('#calGrid .cal-cell')];
    const sep12Cell = cells.find(c => c.querySelector('.cal-num') && c.querySelector('.cal-num').textContent.trim().startsWith('12'));
    check('Sep 12\'s month cell only shows its own appt (Early), no phantom Study chip', sep12Cell && sep12Cell.textContent.includes('Early') && !sep12Cell.textContent.includes('Study'));

    // ── Sanity: a NORMAL appointment (end after start) must be completely
    // unaffected by this change ──
    window.selectCalDay('2026-09-11');
    const r = window.calApptRange({ time: '18:00', end: '19:00', date: '2026-09-11' }, '2026-09-11');
    check('normal same-day appointment range is unaffected', r.start === 1080 && r.end === 1140 && !r.overnight);

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
