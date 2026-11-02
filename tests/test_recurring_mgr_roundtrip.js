const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

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
const tick = () => new Promise(r => setTimeout(r, 20));

// Exactly what onboarding saves: one activity with per-day times (two slots
// on Mon) and an icon, plus a plain single-time activity.
const shift = {
  title: 'Shift', icon: 'dumbbell', start: '09:00', end: '13:00', cat: 'fitness', days: ['Mon','Wed'],
  dayTimes: { Mon: [{ start: '06:00', end: '08:00' }, { start: '15:00', end: '17:00' }], Wed: [{ start: '10:00', end: '14:00' }] },
};
const klass = { title: 'Class', icon: 'book', start: '18:00', end: '19:30', cat: 'learning', days: ['Tue'] };
const seedProfile = {
  name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45,
  created: new RealDate(2026,7,20).getTime(),
  recurring: [shift, klass],
};

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
    win.localStorage.setItem('bios_appts', JSON.stringify([]));
  }
});
const { window } = dom;
window.Date = FixedDate;

(async () => {
  try {
    const doc = window.document;
    const savedRecurring = () => JSON.parse(window.localStorage.getItem('bios_profile')).recurring;

    // Open Manage, change nothing, Save.
    window.openRecurringMgr();
    await tick(); // toggleRecDay re-renders per-day slots on a timeout
    const cb = doc.querySelector('#recurringListMgr input[id^="rec-perday-"]');
    check('BUG FIX: "Different times per day" is ticked when Manage opens a per-day activity', cb && cb.checked);
    window.saveRecurringMgr();

    let rec = savedRecurring();
    const s = rec.find(r => r.title === 'Shift');
    const c = rec.find(r => r.title === 'Class');
    check('both activities survive an unchanged Manage → Save', rec.length === 2 && s && c);
    check('BUG FIX: per-day times survive Manage → Save', s && JSON.stringify(s.dayTimes) === JSON.stringify(shift.dayTimes));
    check('icon, category and days survive Manage → Save', s && s.icon === 'dumbbell' && s.cat === 'fitness' && s.days.join() === 'Mon,Wed');
    check('single-time activity keeps its times and icon', c && c.start === '18:00' && c.end === '19:30' && c.icon === 'book' && !c.dayTimes);

    const appts = JSON.parse(window.localStorage.getItem('bios_appts'));
    const mon = appts.filter(a => a.date === '2026-09-14' && a.title === 'Shift').map(a => a.time).sort();
    check('calendar regenerates both Monday per-day slots, not the 9:00 default', mon.join() === '06:00,15:00');

    // ✕ remove must work with the manager's string ids.
    window.openRecurringMgr();
    await tick();
    const removeBtns = [...doc.querySelectorAll('#recurringListMgr button')].filter(b => b.textContent.trim() === '✕');
    removeBtns[1].click();
    doc.getElementById('confirmOkBtn').click();
    await tick();
    window.saveRecurringMgr();
    rec = savedRecurring();
    check('BUG FIX: ✕ in Manage removes that activity', rec.length === 1 && rec[0].title === 'Shift');


    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);
  } catch (e) {
    console.error('TEST THREW:', e);
    failures++;
  }
  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
