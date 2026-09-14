const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 11, 15, 0); // 3:00 PM
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

// The exact scenario: "Journal" was scheduled for noon (12pm), never
// retimed, and it's now 3pm. Nothing has been checked off yet.
const seedProfile = { name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45, created: new RealDate(2026,7,20).getTime() };
const seedHabits = [
  { id: 'jr', name: 'Log trades', cat: 'trading', dur: 10, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
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
    const navToday = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Today');
    window.switchScreen('today', navToday);
    window.renderTimeline();

    // Manually retime Journal's default placement to noon, to guarantee
    // its slot has definitely passed relative to 3pm "now", exactly like
    // the reported scenario (scheduled at noon, forgot to move it).
    window.openRetime('jr');
    doc.getElementById('retime-time').value = '12:00';
    window.saveRetime();

    const tlHTML = () => doc.getElementById('todayTimeline').innerHTML;
    const habitRow = () => [...doc.querySelectorAll('#todayTimeline .tl-row')].find(r => r.textContent.includes('Log trades'));

    check('Log trades appears in the schedule at its (unmoved) noon slot', tlHTML().includes('Log trades') && tlHTML().includes('12:00'));

    const row1 = habitRow();
    check('BUG FIX: even though noon has passed (it\'s 3pm), the row is NOT styled as done/past', row1 && !row1.className.includes('tl-row past'));
    const checkbox1 = row1.querySelector('.habit-check');
    check('BUG FIX: the checkbox itself is NOT shown as checked just because time passed', checkbox1 && !checkbox1.className.includes('done'));

    // Now the person actually does it, late, at 3pm, and taps the row.
    // confetti() uses the Web Animations API, which jsdom doesn't
    // implement — a known harness gap (verified earlier in this project,
    // reported via the virtual console rather than a catchable throw),
    // not an app bug.
    row1.click();

    const row2 = habitRow();
    check('after actually confirming it, the row now shows done/past styling', row2 && row2.className.includes('tl-row past'));
    const checkbox2 = row2.querySelector('.habit-check');
    check('after actually confirming it, the checkbox now shows checked', checkbox2 && checkbox2.className.includes('done'));
    // The important part from the request: it stays logged at its
    // ORIGINAL (noon) slot -- confirming doesn't silently move it to 3pm.
    const row3 = habitRow();
    check('it still shows at its original noon slot, not moved to 3pm just because that\'s when it was confirmed', row3 && row3.textContent.includes('12:00') && !row3.textContent.includes('3:00'));

    const checksData = JSON.parse(window.localStorage.getItem('bios_checks'));
    const todayKey = '2026-09-11';
    check('the actual completion is genuinely recorded in bios_checks', !!(checksData[todayKey] && checksData[todayKey]['jr']));

    check('no unexpected console/runtime errors (jsdom el.animate gap excluded)', consoleErrors.every(e => /animate is not a function/.test(String(e && e.cause || e))));
    if (!consoleErrors.every(e => /animate is not a function/.test(String(e && e.cause || e)))) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
