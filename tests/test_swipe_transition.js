const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 9, 14, 30);
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

function dispatchPointer(el, type, x, y) {
  const ev = new window.Event(type, { bubbles: true });
  ev.clientX = x; ev.clientY = y;
  el.dispatchEvent(ev);
}

(() => {
  try {
    const doc = window.document;
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);
    window.calSetView('day');
    const dateBefore = doc.getElementById('calTitle').textContent;

    const scrollEl = doc.getElementById('calDayScroll');
    check('day scroll container exists and swipe is bound', !!scrollEl && scrollEl._calSwipeBound);

    dispatchPointer(scrollEl, 'pointerdown', 300, 400);
    dispatchPointer(window, 'pointermove', 200, 402); // dx = -100, past the 48px threshold

    const anyAbsoluteGhost = [...scrollEl.children].find(c => c.style && c.style.position === 'absolute');
    check('a ghost clone of the old content is inserted during the transition', !!anyAbsoluteGhost);
    check('scrollEl is repositioned to relative so the ghost anchors correctly', scrollEl.style.position === 'relative');

    const dateAfter = doc.getElementById('calTitle').textContent;
    check('the date actually changed as part of the swipe (not just an animation)', dateAfter !== dateBefore);

    const newInner = scrollEl.querySelector('.cal-day-inner');
    check('the real (new) content ends at its animate-in target (opacity 1, translateX(0))', newInner && newInner.style.opacity === '1' && newInner.style.transform === 'translateX(0)');
    check('the animate-in transition property was actually set (not an instant snap)', newInner && /transform .26s/.test(newInner.style.transition));

    dispatchPointer(window, 'pointerup', 200, 402);

    setTimeout(() => {
      const ghostAfter = [...scrollEl.children].find(c => c.style && c.style.position === 'absolute');
      check('ghost is removed after the transition completes', !ghostAfter);
      const innerAfter = scrollEl.querySelector('.cal-day-inner');
      check('real content temporary transform/opacity cleared after the transition', innerAfter && innerAfter.style.opacity === '' && innerAfter.style.transform === '');

      check('no console/runtime errors were captured during the run', consoleErrors.length === 0);
      if (consoleErrors.length) console.log('Captured errors:', consoleErrors);

      console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
      process.exit(failures === 0 ? 0 : 1);
    }, 350);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
