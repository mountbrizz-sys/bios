const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 10, 15, 0);
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
const seedDeadlines = [
  { id: 'dl1', title: 'SYNC TEST —push probe', due: '2026-09-10', cat: 'school', done: false },
  { id: 'dl2', title: 'Other deadline', due: '2026-09-11', cat: 'work', done: false },
];
// A pre-existing manual block (no deadlineId) and a block already linked
// to dl1 from an earlier "Block" tap, plus one linked to dl2 — makes sure
// the fix removes only the right one.
const seedTlBlocks = [
  { id: 'c_1', time: '08:00', type: 'other', title: 'Unrelated manual block', detail: '', key: false, fixed: false },
  { id: 'c_2', time: '09:00', type: 'focus', title: 'Work: SYNC TEST —push probe', detail: 'Deadline Sep 10', key: false, fixed: false, deadlineId: 'dl1' },
  { id: 'c_3', time: '11:00', type: 'work', title: 'Work: Other deadline', detail: 'Deadline Sep 11', key: false, fixed: false, deadlineId: 'dl2' },
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
    win.localStorage.setItem('bios_deadlines', JSON.stringify(seedDeadlines));
    win.localStorage.setItem('bios_tl_2026-09-10', JSON.stringify(seedTlBlocks));
    // Realistic precondition: the meta key that marks this cache "valid for
    // today's wake time" — set by an earlier renderTimeline() call, which
    // always happens when the Today screen first loads in real usage.
    win.localStorage.setItem('bios_tl_meta_2026-09-10', seedProfile.wake);
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;

    // Simulate opening the deadline edit sheet for dl1 (deleteDeadline reads
    // the id from #dl-id, exactly like the real edit-deadline flow does).
    doc.getElementById('dl-id').value = 'dl1';
    window.deleteDeadline();

    const remainingBlocks = JSON.parse(window.localStorage.getItem('bios_tl_2026-09-10'));
    check('the block linked to the deleted deadline (dl1) is gone', !remainingBlocks.some(b => b.id === 'c_2'));
    check('the unrelated manual block survives untouched', remainingBlocks.some(b => b.id === 'c_1'));
    check("the OTHER deadline's block (dl2) survives untouched", remainingBlocks.some(b => b.id === 'c_3'));
    check('exactly one block was removed, not more', remainingBlocks.length === seedTlBlocks.length - 1);

    const remainingDeadlines = JSON.parse(window.localStorage.getItem('bios_deadlines'));
    check('the deadline itself is gone', !remainingDeadlines.some(d => d.id === 'dl1'));
    check('the other deadline is untouched', remainingDeadlines.some(d => d.id === 'dl2'));

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
