# Bios

Personal productivity PWA — habits, calendar, deadlines, tasks, weekly
review, cloud sync. Single-file vanilla JS. Live at
biosbybrizz.netlify.app.

## What's in this zip

```
index.html        the entire app
sw.js              service worker (cache versioning)
manifest.json      PWA manifest
config.js          Supabase credentials (public, protected by RLS)
icon-512.png       app icon
CLAUDE.md          context for Claude Code — read this first
package.json       test runner + jsdom dependency
tests/             18 jsdom regression tests, one per fixed bug/feature
```

**Missing on purpose:** `icon-192.png`. Your manifest references it but it
wasn't part of what I had access to — grab it from your current Netlify
deploy (or wherever the original icon set lives) and drop it in next to
`icon-512.png` before your first deploy from this repo.

## One-time setup

```bash
# 1. Turn this folder into a git repo
cd bios-project
git init
git add .
git commit -m "Initial commit — carried over from chat-based development"

# 2. Push to GitHub (create an empty repo there first, then:)
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main

# 3. Install test dependencies
npm install

# 4. Confirm everything actually works before you rely on it
npm test
```

All 18 tests should pass. If any fail, something didn't carry over
cleanly — worth chasing down before you build on top of this.

## Connecting Netlify to the repo (removes the drag-and-drop step)

1. Netlify dashboard → your Bios site → **Site configuration → Build &
   deploy → Link repository** (or create a new site "from Git" pointing
   at the same custom domain).
2. Build command: leave blank (nothing to build — it's static files).
3. Publish directory: `.` (the repo root).
4. From now on, `git push` to `main` deploys automatically. No more
   manual drag-and-drop.

## Using Claude Code from here

Open this folder in Claude Code (terminal, VS Code, or the desktop app).
It reads `CLAUDE.md` automatically for context — deploy rules, standing
principles, testing discipline, and known open items are all in there
already, carried over from the chat sessions that built this app.

Day to day:
```bash
npm test          # before every deploy — this is a standing rule, not optional
```

Bump the `CACHE` version string in `sw.js` on every deploy (the service
worker uses this to detect updates and prompt users to refresh — skipping
it means people can get stuck on stale cached versions).

## Why this move

Everything up to now happened through chat: I'd generate the file, you'd
download it and drag it into Netlify by hand, and my test suite lived only
in that session's sandbox — gone the moment the conversation ended, rebuilt
from scratch (and re-litigated) next time. None of that is a property of
the app; it's a property of the workflow. With this repo, Claude Code
works with the real files directly, the test suite persists and accumulates
instead of resetting, and a git push replaces the manual deploy step
entirely.
