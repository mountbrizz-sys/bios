const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 14, 5, 0); // Monday 5:00 AM
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

const TODAY = '2026-09-14'; // Mon
const seedProfile = { name: 'Alex', goal: 'x', time: 45, recurring: [], created: 1 };
const seedHabits = [
  // three times every day
  { id: 'meds', name: 'Meds', cat: 'health', dur: 5, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], pref: 'time', times: ['08:00','14:00','21:00'] },
  // different times per day: twice on Mon, once on Wed
  { id: 'run', name: 'Run', cat: 'fitness', dur: 30, days: ['Mon','Wed'], pref: 'time', times: ['07:00'],
    dayTimes: { Mon: ['06:30','18:00'], Wed: ['07:15'] } },
  // older single-time habit (h.time, no times[])
  { id: 'old', name: 'Old', cat: 'other', dur: 10, days: ['Mon'], pref: 'time', time: '10:00' },
];

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e));
vc.on('error', (...a) => errors.push(a));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole: vc,
  beforeParse(win) {
    win.Date = FixedDate;
    win.Element.prototype.animate = () => ({}); // jsdom has no Web Animations; confetti uses it
    win.localStorage.setItem('bios_profile', JSON.stringify(seedProfile));
    win.localStorage.setItem('bios_habits', JSON.stringify(seedHabits));
    win.localStorage.setItem('bios_version', '3');
  }
});
const { window } = dom;
window.Date = FixedDate;
const doc = window.document;
const tl = () => JSON.parse(window.localStorage.getItem('bios_tl_' + TODAY));
const dayChecks = () => (JSON.parse(window.localStorage.getItem('bios_checks')) || {})[TODAY] || {};

setTimeout(() => {
try {
  // ── Today: one block per time ──
  const meds = tl().filter(b => b.habitId === 'meds');
  check('3x/day habit gets three timeline blocks', meds.length === 3);
  check('blocks sit at 8:00, 14:00, 21:00', meds.map(b => b.time).join() === '08:00,14:00,21:00');
  check('blocks are labeled "1 of 3" … "3 of 3"', meds.map(b => b.title).join('|') === 'Meds · 1 of 3|Meds · 2 of 3|Meds · 3 of 3');
  const run = tl().filter(b => b.habitId === 'run');
  check('per-day times: Monday uses its own two times', run.map(b => b.time).join() === '06:30,18:00');
  const old = tl().filter(b => b.habitId === 'old');
  check('older single-time habit still shows once at its time, unlabeled', old.length === 1 && old[0].time === '10:00' && old[0].title === 'Old');

  // ── Calendar: same, and Wednesday's per-day time ──
  check('calendar Mon: three Meds entries', window.calHabitsOn(TODAY).filter(e => e.habitId === 'meds').length === 3);
  const wedRun = window.calHabitsOn('2026-09-16').filter(e => e.habitId === 'run');
  check('calendar Wed: Run once at 7:15 (its per-day time)', wedRun.length === 1 && wedRun[0]._start === 7 * 60 + 15);

  // ── Check-offs: day counts as done once ANY time is checked ──
  window.toggleHabitCheck('meds', TODAY, 1);
  let c = dayChecks();
  check('checking the 2nd time stores that slot', !!c['meds#1']);
  check('ONE time checked → habit counts as done for the day', !!c['meds']);
  const rows = [...doc.querySelectorAll('#todayTimeline .tl-row')].filter(r => /Meds ·/.test(r.textContent));
  check('only that time shows checked on Today', rows.length === 3
    && rows.filter(r => r.querySelector('.habit-check.done')).length === 1
    // (an early check-off moves that block to when it was done, so match by label, not position)
    && rows.find(r => /2 of 3/.test(r.textContent)).querySelector('.habit-check.done'));
  check('Today counter counts the habit as done', doc.getElementById('today-done').textContent === '1');

  window.toggleHabitCheck('meds', TODAY, 2);
  window.toggleHabitCheck('meds', TODAY, 1);
  c = dayChecks();
  check('unchecking one of two still leaves the day done', !!c['meds'] && !c['meds#1'] && !!c['meds#2']);
  window.toggleHabitCheck('meds', TODAY, 2);
  c = dayChecks();
  check('unchecking the last time clears the day', !c['meds'] && !c['meds#2']);

  // streak reads the day key
  window.toggleHabitCheck('meds', TODAY, 0);
  check('streak counts a day with one of three times done', window.computeStreak(seedHabits[0]) >= 1);

  // day-level toggle (calendar day sheet) stays consistent with the slots
  window.toggleCheckOn('meds', TODAY, true); // uncheck the whole day
  c = dayChecks();
  check('day-level uncheck clears every time', !c['meds'] && !Object.keys(c).some(k => k.startsWith('meds#')));
  window.toggleCheckOn('meds', TODAY, true); // check the whole day
  c = dayChecks();
  check('day-level check marks the first time done', !!c['meds'] && !!c['meds#0']);

  // ── Budget counts minutes per time ──
  const b = window.computeDayBudget(TODAY);
  check('budget: Meds 3×5 + Run 2×30 + Old 10 = 85 min', b.habitMins === 85);

  // ── Habit sheet: add several times, then per-day times ──
  window.openSheet();
  doc.getElementById('sh-name').value = 'Water';
  doc.querySelector('#sh-pref [data-val="time"]').click();
  doc.getElementById('sh-t-0').value = '09:00';
  window.addShTime('');
  check('"+ another time" adds a second time field', !!doc.getElementById('sh-t-1'));
  check('first time is kept when adding another', doc.getElementById('sh-t-0').value === '09:00');
  doc.getElementById('sh-t-1').value = '15:00';
  window.saveHabit();
  let stored = JSON.parse(window.localStorage.getItem('bios_habits'));
  const water = stored.find(h => h.name === 'Water');
  check('saves both times, sorted', water && water.times.join() === '09:00,15:00' && !water.dayTimes);

  window.openSheet(water.id);
  check('editing shows both times', doc.getElementById('sh-t-0').value === '09:00' && doc.getElementById('sh-t-1').value === '15:00');
  doc.getElementById('sh-perday').checked = true;
  window.renderShTimes(true);
  // default days are Mon–Fri; each day starts with a copy of the shared times
  check('per-day editor shows a row per selected day, seeded with the shared times',
    doc.getElementById('sh-t-Mon-0').value === '09:00' && doc.getElementById('sh-t-Fri-1').value === '15:00');
  window.removeShTime('Fri', 1);
  doc.getElementById('sh-t-Fri-0').value = '11:00';
  window.saveHabit();
  stored = JSON.parse(window.localStorage.getItem('bios_habits'));
  const water2 = stored.find(h => h.id === water.id);
  check('per-day times saved (Mon twice, Fri once at 11:00)',
    water2.dayTimes && water2.dayTimes.Mon.join() === '09:00,15:00' && water2.dayTimes.Fri.join() === '11:00');

  window.openSheet(water.id);
  check('editing reopens with per-day on', doc.getElementById('sh-perday').checked && !!doc.getElementById('sh-t-Fri-0'));
  window.closeSheet();

  // frequency mode hides per-day
  window.openSheet();
  doc.querySelector('#sh-pref [data-val="time"]').click();
  doc.querySelector('#sh-mode [data-val="freq"]').click();
  check('"x times a week" habits hide "Different times per day"', doc.getElementById('sh-perday-row').style.display === 'none');
  window.closeSheet();

  check('no runtime errors', errors.length === 0);
  if (errors.length) console.log(errors);
} catch (e) {
  console.error('TEST THREW:', e);
  failures++;
}
console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
}, 30);
