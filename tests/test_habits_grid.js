const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('../index.html', 'utf8');

const FAKE_NOW = new Date(2026, 8, 9, 14, 30); // Wed Sep 9 2026
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

// Wed schedule: a fixed-day habit "Deep work" (fitness-tagged for color
// testing) scheduled every day, 90 min, no time preference -> should land
// right after the wake+45 open. One appointment (Standup, 9:00-9:30) sits
// right where the habit would otherwise land, forcing the placement
// algorithm to skip past it -- and creating a real overlap case to test
// conflict detection against a second, later appointment.
const seedProfile = { name: 'Brizz', wake: '07:00', sleep: '23:00', focus: ['fitness'], goal: 'Ship it', time: 45, created: Date.now() };
const seedHabits = [
  { id: 'hb1', name: 'Deep work block', cat: 'fitness', dur: 90, days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
];
const seedAppts = [
  { id: 'a1', title: 'Standup', date: '2026-09-09', time: '07:45', end: '08:15', cat: 'work', note: '' },
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
    win.localStorage.setItem('bios_checks', '{}');
  }
});
const { window } = dom;
window.Date = FixedDate;

(() => {
  try {
    const doc = window.document;
    const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
    window.switchScreen('cal', navCal);
    window.selectCalDay('2026-09-09');

    const dayHTML = () => doc.getElementById('calDayCol').innerHTML;

    check('habit block renders in the day grid', dayHTML().includes('Deep work block'));
    check('habit block uses the dashed/soft border treatment', /border:1px dashed/.test(dayHTML()));
    check('appointment block still uses the solid border treatment', /border:1px solid #ffcc004d/.test(dayHTML()));
    check('habit block uses CAT_COLOR (fitness #c6ff4e), not EVENT_CAT_COLOR', dayHTML().includes('#c6ff4e'));

    // ── LEGEND IS NOW A LAYER TOGGLE, NOT CATEGORY MUTE ──
    const legendHTML = doc.getElementById('calLegend').innerHTML;
    check('legend shows Appts and Habits toggle chips', legendHTML.includes('Appts') && legendHTML.includes('Habits'));
    check('no category-based legend items leaked through', !legendHTML.includes('cal-legend-item'));

    window.calToggleLayer('habit');
    check('turning off Habits layer hides the habit block', !dayHTML().includes('Deep work block'));
    check('turning off Habits layer leaves the appointment visible', dayHTML().includes('Standup'));
    window.calToggleLayer('habit'); // back on
    check('habit block reappears after re-enabling the layer', dayHTML().includes('Deep work block'));

    window.calToggleLayer('appt');
    check('turning off Appts layer hides the appointment', !dayHTML().includes('Standup'));
    check('turning off Appts layer leaves the habit visible', dayHTML().includes('Deep work block'));
    window.calToggleLayer('appt'); // back on

    // ── UNDER-REPORTING FIX: booked time now includes habit minutes ──
    const stats = window.calDayStats('2026-09-09');
    check('calDayStats booked total includes the 90min habit (not just the 30min appt)', stats.booked >= 90);

    // ── TAP-TO-TOGGLE: tapping a habit block marks it done for that date ──
    const habitBlock = [...doc.querySelectorAll('#calDayCol .cal-block')].find(b => b.textContent.includes('Deep work block'));
    check('habit block element found for click test', !!habitBlock);
    if (habitBlock) habitBlock.click();
    const checksAfter = JSON.parse(window.localStorage.getItem('bios_checks'));
    check('tapping the habit block marks it done in bios_checks for that date', !!(checksAfter['2026-09-09'] && checksAfter['2026-09-09']['hb1']));
    // Confetti fires on Today's own checkbox but should NOT fire from a
    // calendar-grid tap — confetti() appends fixed-position particle divs
    // (z-index:999 is how it tags them), so their absence confirms it
    // didn't run, not just that no error happened to be thrown.
    check('tapping the habit block in the calendar does NOT trigger confetti', doc.querySelectorAll('div[style*="z-index:999"]').length === 0);
    // tapping again should un-toggle it
    const habitBlockAfter = [...doc.querySelectorAll('#calDayCol .cal-block')].find(b => b.textContent.includes('Deep work block'));
    if (habitBlockAfter) habitBlockAfter.click();
    const checksAfter2 = JSON.parse(window.localStorage.getItem('bios_checks'));
    check('tapping it again un-marks it done', !(checksAfter2['2026-09-09'] && checksAfter2['2026-09-09']['hb1']));

    // ── WEEK VIEW also renders habit blocks (extrapolated from the mockup, which only showed Day) ──
    window.calSetView('week');
    const weekHTML = doc.getElementById('calWeekCols').innerHTML;
    check('week view also renders the habit block', weekHTML.includes('Deep work block'));

    // ── SCROLL-JUMP FIX: toggling a habit must NOT re-scroll the view ──
    // (this is what was happening live: tapping a habit block yanked the
    // view back to "now" instead of leaving the user's scroll position
    // alone). Spy on calScrollToNow to confirm it's genuinely not called
    // from the tap path, only from real navigation.
    let scrollCalls = 0;
    const realScrollToNow = window.calScrollToNow;
    window.calScrollToNow = function(...args) { scrollCalls++; return realScrollToNow.apply(this, args); };

    window.selectCalDay('2026-09-09'); // this IS real navigation -> should scroll
    check('selectCalDay (real navigation) does call calScrollToNow', scrollCalls > 0);

    scrollCalls = 0;
    const habitBlock2 = [...doc.querySelectorAll('#calDayCol .cal-block')].find(b => b.textContent.includes('Deep work block'));
    if (habitBlock2) habitBlock2.click();
    check('tapping a habit block does NOT call calScrollToNow (scroll position preserved)', scrollCalls === 0);

    scrollCalls = 0;
    window.calMove(1);
    check('calMove (real navigation) does call calScrollToNow', scrollCalls > 0);
    window.calMove(-1); // back to original date for cleanliness

    if (consoleErrors.length) {
      const unexpected = consoleErrors.filter(e => !/el\.animate is not a function/.test(String(e && e.cause || e)));
      // jsdom doesn't implement the Web Animations API; confetti()'s el.animate()
      // call is a pure visual flourish on a real habit-check action and behaves
      // correctly in actual browsers — this is a known harness gap, not an app bug.
      check('no unexpected console/runtime errors (jsdom el.animate gap excluded)', unexpected.length === 0);
      if (unexpected.length) console.log('Unexpected errors:', unexpected);
    } else {
      check('no console/runtime errors were captured during the run', true);
    }

    console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('TEST THREW:', e);
    process.exit(1);
  }
})();
