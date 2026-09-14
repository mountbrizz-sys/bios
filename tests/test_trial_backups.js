const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 11, 12, 0); // Fri Sep 11 2026, noon — matches the backups' anchor date
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

function loadTrialUser(label, backupPath, assertions) {
  console.log('\n== ' + label + ' ==');
  const backup = JSON.parse(fs.readFileSync(require('path').join(__dirname, backupPath), 'utf8'));
  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => consoleErrors.push(e));
  virtualConsole.on('error', (...a) => consoleErrors.push(a));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole,
    beforeParse(win) {
      win.Date = FixedDate;
      Object.keys(backup.data).forEach(k => win.localStorage.setItem(k, backup.data[k]));
    }
  });
  const { window } = dom;
  window.Date = FixedDate;
  const doc = window.document;

  window.renderToday();
  window.renderTimeline();
  window.renderDeadlines();
  const navCal = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Calendar');
  window.switchScreen('cal', navCal);
  const navPlan = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Plan');
  window.switchScreen('plan', navPlan);
  const navToday = [...doc.querySelectorAll('.nav-item')].find(n => n.textContent.trim() === 'Today');
  window.switchScreen('today', navToday);

  assertions(window, doc);

  check(label + ': no console/runtime errors while exercising the app', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('Captured errors:', consoleErrors);
}

loadTrialUser('Maria (busy student)', './trial_maria_backup.json', (window, doc) => {
  check('profile name loaded correctly', doc.getElementById('today-date').textContent.includes('Fri'));
  check('budget hero card rendered', doc.getElementById('timeBudgetCard').innerHTML.includes('Free today'));
  check('deadline nudge shows the essay due today', doc.getElementById('dlNudge').innerHTML.includes('Essay due'));
  const tl = doc.getElementById('todayTimeline').innerHTML;
  check('merged schedule shows the overlapping Team meeting appt', tl.includes('Team meeting'));
  check('merged schedule shows the study block habit', tl.includes('Study block'));
  check('merged schedule tags habit rows correctly', tl.includes('Habit · learning') || tl.includes('Habit · fitness'));

  window.calSetView('day');
  const dayHTML = doc.getElementById('calDayCol').innerHTML;
  check('calendar day view renders both overlapping appointments', dayHTML.includes('Team meeting') && dayHTML.includes('Client call'));
  check('calendar day view flags the conflict between them', dayHTML.includes('Overlaps'));
  check('calendar day view renders the Gym habit as a soft block', dayHTML.includes('Gym'));

  const stats = window.calDayStats('2026-09-11');
  check('calDayStats booked time reflects habits counting toward the total', stats.booked > 0);

  window.renderPlan();
  window.renderRecurringSummary();
  check('recurring summary reflects the seeded Part-time shift', doc.getElementById('recurringMgrSummary').textContent.includes('1 recurring'));

  window.openWeeklyReview();
  check('weekly review opens without error on a fresh restored account', doc.getElementById('reviewOverlay').classList.contains('open'));
  check('weekly review load section renders 7 days', doc.querySelectorAll('#reviewLoad .review-load-row').length === 7);
  window.closeReview();
});

loadTrialUser('Devon (9-5 worker)', './trial_devon_backup.json', (window, doc) => {
  check('profile name loaded correctly', doc.getElementById('today-date').textContent.includes('Fri'));
  const tl = doc.getElementById('todayTimeline').innerHTML;
  check('merged schedule shows the standup appt', tl.includes('Team standup'));
  check('merged schedule shows the basketball appt', tl.includes('Basketball league'));

  window.renderPlan();
  window.renderRecurringSummary();
  check('recurring summary correctly shows "None yet" with no recurring activities', doc.getElementById('recurringMgrSummary').textContent.includes('None yet'));

  window.calSetView('week');
  const weekHTML = doc.getElementById('calWeekCols').innerHTML;
  check('week view renders without error for a lighter dataset', weekHTML.includes('Team standup') || weekHTML.includes('Basketball'));

  const dlHTML = doc.getElementById('dlNudge').innerHTML;
  check('deadline nudge shows tax forms due tomorrow', dlHTML.includes('Tax forms'));
});

console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
