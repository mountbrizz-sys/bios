const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 11, 12, 12); // Fri Sep 11 2026, matches the screenshot's 12:12
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
const seedHabits = [
  { id: 'tj', name: 'Trade journal', cat: 'trading', dur: 45, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
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
    // Real usage renders the timeline once on load (caching whatever the
    // default placement is) BEFORE anyone opens the retime sheet — that
    // pre-existing cache is exactly what has to get busted correctly.
    window.renderTimeline();

    const beforeTL = doc.getElementById('todayTimeline').innerHTML;
    check('Trade journal appears somewhere in the initial schedule', beforeTL.includes('Trade journal'));

    // Retime it to 10:00 PM, exactly like the screenshot.
    window.openRetime('tj');
    doc.getElementById('retime-time').value = '22:00';
    window.saveRetime();

    const afterTL = doc.getElementById('todayTimeline').innerHTML;
    check('BUG FIX: Today\'s schedule now actually shows 10:00 PM for the retimed habit', afterTL.includes('10:00 PM'));
    check('the row is marked "moved today"', afterTL.includes('moved today'));

    // The calendar had zero knowledge of retimes at all — confirm it does now.
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);
    window.selectCalDay('2026-09-11');
    const dayHTML = doc.getElementById('calDayCol').innerHTML;
    check('BUG FIX: the calendar day view also shows the habit at its retimed slot (10 PM = minute 1320)', dayHTML.includes('top:1321px') || dayHTML.includes('top:1320px') || /top:132\dpx/.test(dayHTML));
    check('the calendar block for it is tagged "moved today" too', dayHTML.includes('moved today'));

    // And clearing the retime should genuinely revert both places.
    window.switchScreen('today', navToday);
    window.openRetime('tj');
    window.clearRetime();
    const clearedTL = doc.getElementById('todayTimeline').innerHTML;
    check('clearing the retime removes "moved today" from Today\'s schedule', !clearedTL.includes('moved today'));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
