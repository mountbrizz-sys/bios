const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 14, 5, 0); // Monday 5:00 AM — before every habit slot
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

const ALL = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
// wake/sleep still in the stored profile on purpose: old data must be ignored
const seedProfile = { name: 'Alex', wake: '09:00', sleep: '21:00', goal: 'x', time: 45, recurring: [], created: 1 };
const seedHabits = [
  { id: 'hm', name: 'Stretch',  cat: 'fitness',  dur: 30, days: ALL, pref: 'morning' },
  { id: 'ha', name: 'Read',     cat: 'learning', dur: 30, days: ALL, pref: 'afternoon' },
  { id: 'hn', name: 'Journal',  cat: 'mindfulness', dur: 15, days: ALL, pref: 'evening' },
  { id: 'ht', name: 'Meds',     cat: 'health',   dur: 5,  days: ALL, pref: 'time', time: '08:15' },
  { id: 'hl', name: 'Legacy',   cat: 'other',    dur: 10, days: ALL, pref: 'any' },
];
// an appointment sitting on 6:00 so the Morning habit has to flow around it
const seedAppts = [{ id: 'a1', title: 'Early call', date: '2026-09-14', time: '06:00', end: '07:00', cat: 'work', note: '' }];

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e));
vc.on('error', (...a) => errors.push(a));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole: vc,
  beforeParse(win) {
    win.Date = FixedDate;
    win.localStorage.setItem('bios_profile', JSON.stringify(seedProfile));
    win.localStorage.setItem('bios_habits', JSON.stringify(seedHabits));
    win.localStorage.setItem('bios_appts', JSON.stringify(seedAppts));
    win.localStorage.setItem('bios_version', '3');
  }
});
const { window } = dom;
window.Date = FixedDate;
const doc = window.document;

// app entry runs after the startup session check (one tick after load)
setTimeout(() => {
try {
  // ── Today timeline ──
  const tl = JSON.parse(window.localStorage.getItem('bios_tl_2026-09-14'));
  const at = id => (tl.find(b => b.habitId === id) || {}).time;
  check('no "Wake" block on the timeline', !tl.some(b => b.id === 'wake'));
  check('no "Morning routine" block on the timeline', !tl.some(b => b.id === 'morning'));
  check('no "Screens off" block on the timeline', !tl.some(b => b.id === 'wind'));
  check('Specific time habit sits exactly at its time', at('ht') === '08:15');
  check('Morning habit flows around the 6–7 AM appointment (not inside it)', at('hm') && at('hm') >= '07:00' && at('hm') < '12:00');
  check('stored wake 9:00 is ignored — Morning habit starts before 9', at('hm') < '09:00');
  check('Afternoon habit starts at/after noon', at('ha') && at('ha') >= '12:00' && at('ha') < '17:00');
  check('Night habit starts at/after 5 PM', at('hn') && at('hn') >= '17:00');
  check('legacy "any" habit is treated as Morning', at('hl') && at('hl') >= '06:00' && at('hl') < '12:00');
  check('no habit detail mentions wind-down', !tl.some(b => /wind-down/.test(b.detail || '')));

  // ── Calendar habit layer uses the same rules ──
  const cal = window.calHabitsOn('2026-09-14');
  const calAt = id => { const e = cal.find(x => x.habitId === id); return e ? e._start : null; };
  check('calendar: Specific time habit at 8:15', calAt('ht') === 8 * 60 + 15);
  check('calendar: Afternoon habit at/after noon', calAt('ha') >= 12 * 60 && calAt('ha') < 17 * 60);
  check('calendar: Night habit at/after 5 PM', calAt('hn') >= 17 * 60);
  check('calendar: nothing flagged past wind-down', cal.every(e => e.overflow === false));

  // ── Habit sheet: four choices, none preselected, choice required ──
  window.openSheet();
  const chips = [...doc.querySelectorAll('#sh-pref .sh-chip')].map(c => c.dataset.val + ':' + c.textContent.trim());
  check('sheet offers Morning / Afternoon / Night / Specific time only', chips.join() === 'morning:Morning,afternoon:Afternoon,evening:Night,time:Specific time');
  check('new habit has no time-of-day preselected', !doc.querySelector('#sh-pref .sel'));
  doc.getElementById('sh-name').value = 'Walk';
  window.saveHabit();
  let stored = JSON.parse(window.localStorage.getItem('bios_habits'));
  check('saving without a pick is refused', !stored.some(h => h.name === 'Walk'));

  doc.querySelector('#sh-pref [data-val="time"]').click();
  check('Specific time reveals the time picker field', doc.getElementById('sh-time-field').style.display === 'block');
  window.saveHabit();
  stored = JSON.parse(window.localStorage.getItem('bios_habits'));
  check('Specific time without a time is refused', !stored.some(h => h.name === 'Walk'));

  doc.getElementById('sh-time').value = '19:30';
  window.saveHabit();
  stored = JSON.parse(window.localStorage.getItem('bios_habits'));
  const walk = stored.find(h => h.name === 'Walk');
  check('Specific time habit saves pref "time" and its time', walk && walk.pref === 'time' && walk.time === '19:30');

  window.openSheet(walk.id);
  check('editing shows Specific time selected with its time', doc.querySelector('#sh-pref .sel').dataset.val === 'time'
    && doc.getElementById('sh-time-display').textContent.trim() === window.fmtTime('19:30'));
  doc.querySelector('#sh-pref [data-val="afternoon"]').click();
  check('switching away hides the time field', doc.getElementById('sh-time-field').style.display === 'none');
  window.saveHabit();
  stored = JSON.parse(window.localStorage.getItem('bios_habits'));
  const walk2 = stored.find(h => h.id === walk.id);
  check('switching to Afternoon drops the stale time', walk2.pref === 'afternoon' && !('time' in walk2));

  window.openSheet('hl');
  check('legacy "any" habit opens with Morning selected', doc.querySelector('#sh-pref .sel').dataset.val === 'morning');
  window.closeSheet();

  // ── Plan: no Wake / Sleep rows ──
  window.renderPlan();
  const planText = doc.getElementById('planContent') ? doc.getElementById('planContent').textContent : doc.body.textContent;
  check('Plan profile has no Wake row', !/\bWake\b/.test(planText));
  check('Plan profile has no Sleep row', !/\bSleep\b/.test(planText));

  // ── Budget card: booked time only ──
  window.renderTimeBudget();
  const budget = doc.getElementById('timeBudgetCard').innerHTML;
  check('budget card says "Booked today"', /Booked today/.test(budget));
  check('budget card has no free/overhead figure', !/Free today|Overhead/.test(budget));

  check('no runtime errors', errors.length === 0);
  if (errors.length) console.log(errors);
} catch (e) {
  console.error('TEST THREW:', e);
  failures++;
}
console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
}, 30);
