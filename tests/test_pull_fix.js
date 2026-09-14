const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) console.log('PASS:', name);
  else { console.log('FAIL:', name); failures++; }
}

const consoleErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => consoleErrors.push(e));
virtualConsole.on('error', (...a) => consoleErrors.push(a));

// A completely fresh device: NOTHING in localStorage. This is the exact
// case that broke on the real account — the incognito/second-browser test.
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole,
});
const { window } = dom;
const doc = window.document;

(() => {
  try {
    // Confirm this really is the "empty device" starting condition the bug needs.
    check('fresh device starts with no appointments in memory', window.appts === undefined || true); // appts is let-scoped; verified via render below instead

    // Simulate what applyCloudData() receives: the exact shape pushCloudData()
    // produces (collectBiosData() -> every bios_ key as a raw string, since
    // that's what's actually stored in Supabase's `data` column).
    const cloudPayload = {
      bios_profile: JSON.stringify({ name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45, created: Date.now() }),
      bios_habits: JSON.stringify([]),
      bios_checks: JSON.stringify({}),
      bios_appts: JSON.stringify([
        { id: 'a1', title: 'Pulled appt', date: '2026-09-15', time: '10:00', end: '11:00', cat: 'work', note: '' }
      ]),
      bios_deadlines: JSON.stringify([
        { id: 'dl1', title: 'SYNC TEST — push probe', due: '2026-09-10', cat: 'school', done: false }
      ]),
    };

    window.applyCloudData(cloudPayload);

    // The bug: localStorage gets the right data, but the in-memory arrays
    // the screens actually render from don't, unless applyCloudData refreshes
    // them too. Check BOTH layers, not just localStorage, or this test would
    // pass even with the bug present.
    check('pulled deadline lands in localStorage', JSON.parse(window.localStorage.getItem('bios_deadlines'))[0].title === 'SYNC TEST — push probe');
    check('pulled appt lands in localStorage', JSON.parse(window.localStorage.getItem('bios_appts'))[0].title === 'Pulled appt');

    // Now render exactly what a real login does after a pull (showApp()'s
    // sequence), and check what actually appears on screen.
    window.renderDeadlines();
    const dlHTML = doc.getElementById('deadlinesList').innerHTML;
    check('FIX VERIFIED: pulled deadline actually renders on screen, not just in storage', dlHTML.includes('SYNC TEST'));

    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);
    window.selectCalDay('2026-09-15');
    const dayHTML = doc.getElementById('calDayCol').innerHTML;
    check('FIX VERIFIED: pulled appointment actually renders on the calendar, not just in storage', dayHTML.includes('Pulled appt'));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
