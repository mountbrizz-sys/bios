const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');

const FAKE_NOW = new Date(2026, 8, 14, 12, 0); // Monday
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
const tick = () => new Promise(r => setTimeout(r, 30));

const SESSION = { user: { id: 'u1', email: 'test@example.com' } };
const realProfile = { name: 'Alex', wake: '06:30', sleep: '22:30', goal: 'g', time: 45, focus: ['fitness'], recurring: [], created: 1 };
const realHabits = [{ id: 'h1', name: 'Gym', cat: 'fitness', dur: 60, days: ['Mon'] }];

// Fake Supabase client: session + cloud row are per-scenario, pushes recorded.
function fakeSupabase(opts) {
  const pushes = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: opts.session || null } }),
      onAuthStateChange: () => {},
      signOut: async () => ({}),
      // login fails the way Safari reports a dead server when opts.cloudDown
      signInWithPassword: async () => opts.cloudDown
        ? { data: null, error: { name: 'AuthRetryableFetchError', message: 'Load failed' } }
        : { data: { session: SESSION }, error: null },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.cloudRow || null, error: null }) }) }),
      upsert: async (row) => { pushes.push(row); return { error: null }; },
    }),
  };
  return { client, pushes };
}

// opts: { local: {key: obj}, session, cloudRow, noClient, cloudDown }
async function boot(opts) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  vc.on('error', (...a) => errors.push(a));
  const fake = fakeSupabase(opts);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', virtualConsole: vc,
    beforeParse(win) {
      win.Date = FixedDate;
      // jsdom has no fetch; the startup reachability check uses it
      win.fetch = async () => { if (opts.cloudDown) throw new TypeError('Load failed'); return { status: 200 }; };
      if (!opts.noClient) {
        win.BIOS_SUPABASE_URL = 'https://fake.supabase.co';
        win.BIOS_SUPABASE_ANON_KEY = 'anon';
        win.supabase = { createClient: () => fake.client };
      }
      win.localStorage.setItem('bios_version', '3');
      Object.entries(opts.local || {}).forEach(([k, v]) => win.localStorage.setItem(k, JSON.stringify(v)));
    }
  });
  dom.window.Date = FixedDate;
  await tick();
  const w = dom.window, doc = w.document;
  return {
    w, doc, errors, pushes: fake.pushes,
    appShown: () => doc.getElementById('app').style.display === 'flex',
    splashShown: () => doc.getElementById('splash').style.display !== 'none'
      && doc.getElementById('splashActions').style.visibility === 'visible',
    onboardShown: () => !!doc.getElementById('screen-onboard'),
    stored: (k) => JSON.parse(w.localStorage.getItem(k) || 'null'),
  };
}

(async () => {
  try {
    // A — logged out, nothing on device: splash with Log in, no app, no onboarding
    let t = await boot({});
    check('logged out: splash with login buttons is shown', t.splashShown());
    check('logged out: app is not entered', !t.appShown());
    check('logged out: onboarding never opens', !t.onboardShown());
    check('splash has no "Get started" button anymore', !/Get started/.test(t.doc.getElementById('splash').textContent));

    // B — logged out but data on device: login still required
    t = await boot({ local: { bios_profile: realProfile, bios_habits: realHabits } });
    check('LOGIN REQUIRED: local data alone does not enter the app', !t.appShown() && t.splashShown());

    // C — logged in, brand-new account: straight into the app with a blank profile, zero habits
    t = await boot({ session: SESSION });
    check('new account: app opens directly', t.appShown() && !t.onboardShown());
    check('new account: blank profile created, with no wake/sleep setting', t.stored('bios_profile') && t.stored('bios_profile').blank === true && !('wake' in t.stored('bios_profile')));
    check('new account: zero habits is allowed', Array.isArray(t.stored('bios_habits')) && t.stored('bios_habits').length === 0);
    check('Plan habits section renders the empty state', /No habits yet/.test(t.doc.getElementById('habitsMgr').textContent));
    check('new account: no runtime errors', t.errors.length === 0);
    if (t.errors.length) console.log(t.errors);

    // D — blank profile left on device, log into an account with data: pull, no conflict
    const blank = { name: '', wake: '07:00', sleep: '23:00', recurring: [], focus: [], created: 1, blank: true };
    const cloud = { data: { bios_profile: JSON.stringify(realProfile), bios_habits: JSON.stringify(realHabits) } };
    t = await boot({ local: { bios_profile: blank, bios_habits: [] }, cloudRow: cloud });
    await t.w.onAuthSuccess(SESSION);
    check('SYNC SAFETY: blank device + account data pulls the account (no conflict screen)',
      t.doc.getElementById('syncConflictScreen').style.display !== 'flex' && t.stored('bios_profile').name === 'Alex');
    check('pulled habits are in place and app is open', t.stored('bios_habits').length === 1 && t.appShown());
    check('nothing was pushed over the account during the pull', t.pushes.length === 0);

    // E — real data on device + account data: still asks, never guesses
    t = await boot({ local: { bios_profile: realProfile, bios_habits: realHabits }, cloudRow: cloud });
    await t.w.onAuthSuccess(SESSION);
    check('SYNC SAFETY: real local data + account data still shows the conflict screen',
      t.doc.getElementById('syncConflictScreen').style.display === 'flex');

    // F — the onboarding / profile-editor screen is gone entirely
    check('onboarding screen no longer exists in the page', !t.onboardShown() && typeof t.w.editProfile === 'undefined');

    // H — Plan actions: Log out is there when logged in, Edit (onboarding) is gone
    t = await boot({ session: SESSION, local: { bios_profile: realProfile, bios_habits: realHabits } });
    const actions = t.doc.getElementById('planActions');
    check('Plan shows a Log out button when logged in', !!t.doc.getElementById('planLogoutBtn'));
    check('Plan shows the logged-in email', /test@example\.com/.test(actions.textContent));
    check('Plan no longer has the Edit button', !/Edit/.test(actions.textContent) && !actions.querySelector('[onclick*="editProfile"]'));

    // G — login service unreachable but data on device: never lock the user out
    t = await boot({ noClient: true, local: { bios_profile: realProfile, bios_habits: realHabits } });
    check('offline with local data: app still opens', t.appShown());
    t = await boot({ noClient: true });
    check('offline with no data: splash explains the connection problem',
      t.splashShown() && /connection/.test(t.doc.getElementById('splashNotice').textContent));

    // I — logged out, Supabase down (e.g. paused project), data on device: open it offline
    t = await boot({ cloudDown: true, local: { bios_profile: realProfile, bios_habits: realHabits } });
    check('OFFLINE FALLBACK: Supabase down + local data → app opens', t.appShown() && !t.splashShown());
    check('offline entry tells the user it is offline', /Offline/.test(t.doc.getElementById('toast').textContent));
    check('offline entry never pushes to the account', t.pushes.length === 0);
    check('Plan offers Log in while offline', /Log in/.test(t.doc.getElementById('planActions').textContent));

    // J — Supabase down but nothing on this device: nothing to open, splash as usual
    t = await boot({ cloudDown: true });
    check('Supabase down + no local data → splash (login needed)', t.splashShown() && !t.appShown());

    // K — login attempt fails because the server is unreachable
    t = await boot({ local: { bios_profile: realProfile, bios_habits: realHabits } });
    check('reachable server + local data still requires login', t.splashShown() && !t.appShown());
    t.w.showAuthScreen();
    t.doc.getElementById('auth-email').value = 'test@example.com';
    t.doc.getElementById('auth-password').value = 'password123';
    const fake = t.w.supabase.createClient();
    fake.auth.signInWithPassword = async () => ({ data: null, error: { name: 'AuthRetryableFetchError', message: 'Load failed' } });
    await t.w.submitAuth();
    check('network login failure shows a clear message, not "Load failed"',
      /Can't reach the server/.test(t.doc.getElementById('authError').textContent));
    const offBtn = t.doc.getElementById('authOfflineBtn');
    check('…and offers "Open this device\'s data (offline)"', offBtn.style.display === 'block');
    offBtn.click();
    check('tapping it opens the app with local data', t.appShown());
  } catch (e) {
    console.error('TEST THREW:', e);
    failures++;
  }
  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
