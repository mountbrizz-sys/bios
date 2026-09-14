const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 14, 12, 0);
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
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;

    // ── FINDING 1: applyCloudData() was missing `tasks` — same bug class
    // as the earlier appts/deadlines pull fix, just never caught for tasks. ──
    window.renderTasks();
    const beforeTasksHTML = doc.getElementById('tasksList') ? doc.getElementById('tasksList').innerHTML : '';
    check('no task visible before the simulated pull', !beforeTasksHTML.includes('Synced task'));

    const cloudPayload = {
      bios_profile: JSON.stringify(seedProfile),
      bios_habits: JSON.stringify([]),
      bios_checks: JSON.stringify({}),
      bios_tasks: JSON.stringify([{ id: 'tk1', title: 'Synced task', day: '2026-09-14', done: false }]),
    };
    window.applyCloudData(cloudPayload);
    check('BUG FIX: pulled task lands in localStorage', JSON.parse(window.localStorage.getItem('bios_tasks'))[0].title === 'Synced task');
    window.renderTasks();
    const afterTasksHTML = doc.getElementById('tasksList').innerHTML;
    check('BUG FIX: the pulled task actually renders on screen, not just in storage', afterTasksHTML.includes('Synced task'));

    // ── FINDING 2: saveHabit() always wrote a `target` field regardless of
    // mode -- exactly the kind of leftover data that made an earlier real
    // bug (a habit's stale target after a mode switch) harder to trace. ──
    // Create a frequency-mode habit (target should be present).
    window.openSheet();
    doc.getElementById('sh-name').value = 'Gym';
    const freqBtn = [...doc.querySelectorAll('#sh-mode .sh-chip, #sh-mode [data-val]')].find(el => el.dataset.val === 'freq');
    if (freqBtn) freqBtn.click();
    window.saveHabit();

    let habits = JSON.parse(window.localStorage.getItem('bios_habits'));
    let gym = habits.find(h => h.name === 'Gym');
    check('frequency-mode habit correctly has a target field', gym && gym.mode === 'freq' && typeof gym.target === 'number');

    // Now edit it, switching to fixed-days mode.
    window.openSheet(gym.id);
    const daysBtn = [...doc.querySelectorAll('#sh-mode .sh-chip, #sh-mode [data-val]')].find(el => el.dataset.val === 'days');
    if (daysBtn) daysBtn.click();
    const monBtn = [...doc.querySelectorAll('#sh-days [data-d]')].find(el => el.dataset.d === 'Mon');
    if (monBtn) monBtn.click();
    window.saveHabit();

    habits = JSON.parse(window.localStorage.getItem('bios_habits'));
    gym = habits.find(h => h.name === 'Gym');
    check('BUG FIX: after switching to fixed-days mode, the stale target field is gone', gym && gym.mode === 'days' && !('target' in gym));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
