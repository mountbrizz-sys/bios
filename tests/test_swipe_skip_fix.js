const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

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

const consoleErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => consoleErrors.push(e));
virtualConsole.on('error', (...a) => consoleErrors.push(a));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole,
  beforeParse(win) { win.Date = FixedDate; }
});
const { window } = dom;
window.Date = FixedDate;

function dispatchPointer(el, type, x, y, pointerId) {
  const ev = new window.Event(type, { bubbles: true });
  ev.clientX = x; ev.clientY = y; ev.pointerId = pointerId;
  el.dispatchEvent(ev);
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async () => {
  try {
    const doc = window.document;
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);
    window.calSetView('day');
    const titleBefore = doc.getElementById('calTitle').textContent;

    const scrollEl = doc.getElementById('calDayScroll');

    // ── THE ACTUAL BUG: a gesture that gets cancelled (pointercancel, not
    // pointerup) mid-swipe used to leak its move/up listeners on window
    // forever. A second, fresh swipe shortly after would then have TWO
    // active listeners reacting to it, each independently crossing the
    // threshold and firing its own shift -> the date skips by 2 (or more)
    // for what was really two separate gesture attempts. ──

    // Gesture 1: starts, moves a little (not yet past threshold), then gets
    // cancelled by the browser (simulating iOS treating a fast/hard swipe
    // ambiguously) instead of a clean pointerup.
    dispatchPointer(scrollEl, 'pointerdown', 300, 400, 1);
    dispatchPointer(window, 'pointermove', 280, 401, 1); // dx=-20, under threshold, no shift yet
    dispatchPointer(window, 'pointercancel', 280, 401, 1); // cancelled, NOT pointerup

    const titleAfterCancel = doc.getElementById('calTitle').textContent;
    check('a cancelled gesture under threshold causes no shift at all', titleAfterCancel === titleBefore);

    // Gesture 2: a completely fresh, legitimate swipe right after.
    dispatchPointer(scrollEl, 'pointerdown', 300, 400, 2);
    dispatchPointer(window, 'pointermove', 200, 402, 2); // dx=-100, past threshold -> should shift exactly once
    dispatchPointer(window, 'pointerup', 200, 402, 2);

    const titleAfterSecondSwipe = doc.getElementById('calTitle').textContent;
    check('BUG FIX: after the leaked-listener scenario, a fresh swipe still advances by exactly ONE day', titleAfterSecondSwipe !== titleBefore);
    // Verify it's exactly one day, not two: shift back by one and compare.
    window.calMove(-1);
    check('confirms it was exactly a single day\'s worth of movement, not two', doc.getElementById('calTitle').textContent === titleBefore);
    window.calMove(1); // restore
    await wait(320); // let the previous swipe's animation fully finish (clears calSwipeBusy) before starting a new one

    // ── A single hard/fast swipe (large dx, many rapid move events) must
    // still only move ONE day, never more, regardless of how far/fast. ──
    const titleBeforeHard = doc.getElementById('calTitle').textContent;
    dispatchPointer(scrollEl, 'pointerdown', 300, 400, 3);
    // Simulate a "hard" swipe: many rapid move events with a large total dx.
    for (let x = 290; x >= 50; x -= 20) dispatchPointer(window, 'pointermove', x, 400, 3);
    dispatchPointer(window, 'pointerup', 50, 400, 3);
    const titleAfterHard = doc.getElementById('calTitle').textContent;
    window.calMove(-1);
    check('a hard/fast swipe with many rapid move events still moves exactly one day', doc.getElementById('calTitle').textContent === titleBeforeHard);
    window.calMove(1); // restore
    await wait(320);

    // ── MONTH VIEW: previously had no swipe support at all ──
    window.calSetView('month');
    const monthTitleBefore = doc.getElementById('calTitle').textContent;
    const monthEl = doc.getElementById('calMonthView');
    check('month view swipe is now bound', monthEl._calSwipeBound === true);
    dispatchPointer(monthEl, 'pointerdown', 300, 400, 10);
    dispatchPointer(window, 'pointermove', 200, 402, 10);
    dispatchPointer(window, 'pointerup', 200, 402, 10);
    const monthTitleAfter = doc.getElementById('calTitle').textContent;
    check('BUG FIX: swiping in month view now moves exactly one month', monthTitleAfter !== monthTitleBefore);
    window.calMove(-1);
    check('confirms it moved exactly one month, not more', doc.getElementById('calTitle').textContent === monthTitleBefore);
    await wait(320);

    check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
    if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
