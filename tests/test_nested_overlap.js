const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 11, 14, 0);
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

// The exact scenario: "Study" 8pm-1am (overnight, from the previous fix),
// and a "Trade journal" habit that sits somewhere inside that window.
// Decision: overlaps still get flagged, including this nested case — the
// app surfaces it, the person judges whether it's a real conflict or an
// intentional sub-activity. (An earlier version of this fix suppressed the
// flag for nested habits; that was reverted per explicit direction.)
const seedProfile = { name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45, created: new RealDate(2026,7,20).getTime() };
const seedHabits = [
  { id: 'tj', name: 'Trade journal', cat: 'trading', dur: 10, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
];
const seedAppts = [
  { id: 'study', title: 'Study', date: '2026-09-11', time: '20:00', end: '01:00', cat: 'personal', note: '' },
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
    window.selectCalDay('2026-09-11');

    // Retime the habit to 21:00 (9pm) -- squarely inside Study's 8pm-1am span.
    window.openRetime('tj');
    doc.getElementById('retime-time').value = '21:00';
    window.saveRetime();

    const dayHTML = doc.getElementById('calDayCol').innerHTML;
    check('Study renders', dayHTML.includes('Study'));
    check('Trade journal renders, nested inside it', dayHTML.includes('Trade journal'));
    check('the nested habit IS flagged as overlapping — the app surfaces it, the person judges it', dayHTML.includes('Overlaps'));

    const stats = window.calDayStats('2026-09-11');
    check('calDayStats counts this as a real conflict (not silently suppressed)', stats.conflicts > 0);
    // Booked time still shouldn't double-count the nested habit on top of
    // Study's own span -- that part of the merge logic is unrelated to
    // whether it's flagged as a conflict.
    check('booked time reflects Study\'s truncated-at-midnight duration, not inflated by the nested habit', stats.booked === 240);

    const conf = window.calConflictFor({ id: 'study', date: '2026-09-11', _start: 1200, _end: 1440, isHabit: false });
    check('calConflictFor on the appointment itself also finds the nested habit as a conflict', conf && conf.title === 'Trade journal');

    // Sanity: a GENUINE appointment-appointment overlap must still flag.
    const seedAppts2 = seedAppts.concat([{ id: 'clash', title: 'Double booked', date: '2026-09-11', time: '20:30', end: '21:30', cat: 'work', note: '' }]);
    window.localStorage.setItem('bios_appts', JSON.stringify(seedAppts2));
    // appts is a top-level let, not reloaded from localStorage automatically --
    // simulate what a real save/edit does by calling saveAppts-adjacent state
    // update via the actual save flow instead of poking storage directly.
    window.closeApptSheet();
    window.openApptSheet();
    doc.getElementById('appt-title').value = 'Double booked';
    doc.getElementById('appt-date').value = '2026-09-11';
    doc.getElementById('appt-time').value = '20:30';
    doc.getElementById('appt-end').value = '21:30';
    window.saveAppt(); // this overlaps Study (appt-appt, both hard commitments) -> should trigger the confirm-to-save conflict gate
    check('a genuine appointment-appointment overlap still opens the conflict confirm modal', doc.getElementById('confirmOverlay').classList.contains('open'));
    doc.getElementById('confirmOkBtn').click(); // confirm saving anyway

    const statsAfter = window.calDayStats('2026-09-11');
    check('after adding a real overlapping appointment, conflicts is now > 0', statsAfter.conflicts > 0);

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
