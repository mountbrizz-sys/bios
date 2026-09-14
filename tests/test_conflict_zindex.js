const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 11, 10, 0);
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

function zIndexOf(doc, selector) {
  const probe = doc.createElement('div');
  probe.className = selector.replace('.', '');
  doc.body.appendChild(probe);
  const z = doc.defaultView.getComputedStyle(probe).zIndex;
  probe.remove();
  return parseInt(z, 10);
}

const seedProfile = { name: 'Alex', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'x', time: 45, created: new RealDate(2026,7,20).getTime() };
const seedHabits = [
  { id: 'tj', name: 'Trade journal', cat: 'trading', dur: 60, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
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
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);
    window.selectCalDay('2026-09-11');
    window.openRetime('tj');
    doc.getElementById('retime-time').value = '20:00';
    window.saveRetime();

    // ── Z-INDEX: the confirm dialog must paint above the still-open sheet ──
    const sheetZ = zIndexOf(doc, '.sheet-overlay');
    const confirmZ = zIndexOf(doc, '.confirm-overlay');
    check('confirm-overlay\'s z-index is now higher than sheet-overlay\'s (was reversed: 250 vs 350)', confirmZ > sheetZ);

    // ── Create a new appointment that overlaps the habit ──
    window.openApptSheet();
    doc.getElementById('appt-title').value = 'Study';
    doc.getElementById('appt-date').value = '2026-09-11';
    doc.getElementById('appt-time').value = '20:00';
    doc.getElementById('appt-end').value = '21:00';
    window.saveAppt();

    check('the appointment sheet is still open underneath (never closed before confirming)', doc.getElementById('apptSheetOverlay').classList.contains('open'));
    check('the confirm dialog is open on top of it', doc.getElementById('confirmOverlay').classList.contains('open'));

    const msg = doc.getElementById('confirmMsg').textContent;
    check('BUG FIX: conflict message shows a real time, not an empty "()"', !msg.includes('()'));
    check('conflict message correctly names the habit', msg.includes('Trade journal'));
    check('conflict message shows the habit\'s actual time (8:00 PM)', msg.includes('8:00 PM'));

    doc.getElementById('confirmOkBtn').click();
    check('confirming saves it and closes both overlays', !doc.getElementById('confirmOverlay').classList.contains('open') && !doc.getElementById('apptSheetOverlay').classList.contains('open'));

    // ── Same bug, same fix, in the edit-sheet's conflict banner ──
    const savedAppts = JSON.parse(window.localStorage.getItem('bios_appts'));
    const studyId = savedAppts.find(a => a.title === 'Study').id;
    window.editAppt(studyId);
    const bannerText = doc.getElementById('editApptConflict').textContent;
    check('edit-sheet conflict banner also shows a real time, not empty "()"', !bannerText.includes('()'));
    check('edit-sheet conflict banner names the conflicting habit', bannerText.includes('Trade journal'));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
