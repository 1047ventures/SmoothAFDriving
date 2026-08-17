# Smooth AF Driving — Developer Guide

## ⚠️ Verify with subagents — everything, not just UI (operating rule)

**Nothing is "done" because it was written and the tests passed.** Dispatch
subagents to independently test and verify every change before calling it
complete, and run them in parallel when they don't depend on each other.

Verify against the **running system**, not the diff. The bugs that have actually
cost time here were all invisible in the code and obvious the moment something
real was exercised:

- The project mailed **8-digit** codes into a **6-character** field. Both halves
  read fine on their own; only checking the live auth config found it.
- A setup script aborted on a cosmetic step *before* configuring the mailer, so
  a failed run looked like a successful one.
- A roadmap was published but never committed, so the artifact and the repo
  silently diverged.

What that means in practice:

- **UI change** → a UI/UX-expert subagent that renders and critiques it (below).
- **Backend / config / infra change** → a subagent that queries the live thing
  and reports what it actually found — the REST endpoint, the auth config, the
  workflow log — never just "the script says it worked".
- **Anything non-trivial** → an adversarial reviewer whose job is to find the
  failure case, and a fresh-eyes agent that reads the change cold.
- **Claims from another agent or handoff doc are input, not truth.** Re-derive
  anything load-bearing yourself; two such claims have already been wrong.

Spawn as many as the work warrants. The cost of an extra agent is trivial next
to shipping a build that can't sign in.

## ⚠️ Build log & roadmap — update at EVERY opportunity (operating rule)

`docs/roadmap.html` is how the user tracks this project. Treat it as part of the
deliverable, not documentation to catch up on later.

Update it **every time** anything below changes — not just when asked, and not
only at the end of a session:

- something ships, or starts, or gets unblocked
- a user action item is added, resolved, or turns out to be unnecessary
- a diagnosis changes — *especially* when an earlier entry turns out to be wrong
- a flagged/tech-debt item's shape changes, even if it isn't fixed

Re-stamp the "Updated" line, publish to the existing artifact URL, **and commit
the file in the same breath** — details in "Roadmap artifact" below. An entry
that is merely stale is worse than no entry: the user makes decisions from it.

## ⚠️ UI/UX changes — ALWAYS visually verify (operating rule)

Any change that affects the rendered UI (CSS, HTML/markup, layout, or JS that
changes what's on screen) MUST be **visually reviewed before it's called done** —
never ship UI on "build passes / tests green" alone.

The required step: dispatch a **UI/UX-expert subagent** that actually *renders*
the affected screen(s) and critiques them. It should drive Playwright (Chromium
is preinstalled at `/opt/pw-browsers`; `PLAYWRIGHT_BROWSERS_PATH` is set) against
the deploy-preview URL or a local `npm run preview`, at a phone viewport, then:
- navigate to the changed screen(s) (mock geolocation/permissions to reach
  in-drive screens; or toggle DOM state via `page.evaluate` to force a state like
  the pace strip visible), take **screenshots**, and read them back,
- critique layout, legibility, spacing, overlap, alignment, and overall feel,
- report concrete fixes.

Then fix what it finds and re-verify. This applies to every UI change, every PR —
no exceptions, even for "one-liner" tweaks.

## Architecture Overview

Vanilla JS PWA. No framework. Vite for bundling + Vitest for tests.

```
src/
  main.js                     Entry point — DOMContentLoaded init, event handler wiring, SW registration
  constants.js                All constants: storage keys, DEFAULTS, CFG, VEHICLE_TYPES, timing params
  state.js                    Mutable runtime singletons: state, calib, resetState(), resetCalib()

  services/
    storage.js                localStorage R/W: drives, lifetime score, driver name, device ID
    drive.js                  Drive lifecycle: persist (crash recovery), finalize, recover
    scoring.js                Scoring algorithm: scoreFromEvents, analyzeDrive, driveCoaching, personas
    supabase.js               Cloud sync: drive upload, leaderboard fetch/write
    wakeLock.js               navigator.wakeLock wrapper
    sensors/
      gps.js                  GPS processing: processSample, detectEvent, detectEventWithThresh, onGpsUpdate
      motion.js               DeviceMotion: calibrateAxes (least-squares axis solve), createMotionHandler

  ui/
    router.js                 showScreen(name) — toggles .active class on screen sections
    home.js                   renderHomeStats, renderDriveList
    record.js                 startRecording, stopRecording, updateLiveUI, flashEvent, speakEvent
    review.js                 renderReview, Leaflet map, enterMapFilter, clearMapFilter
    leaderboard.js            openLeaderboard, openSignupModal
    rewards.js                renderRewards
    garage.js                 Garage sheet, vehicle forms, car photo management, repositioning

  utils/
    dom.js                    $ and $$ selector helpers
    math.js                   mpsToMph, metersToMiles, fmtDuration, fmtScore, haversine, clamp, pct, linMap
    linalg.js                 dot3, norm3, normalise3, gaussElim3, solveLS3
    color.js                  harshnessToColor, forceSegmentColor, scoreColor, dimColor

  styles/
    index.css                 @import chain — the only file you need to reference
    variables.css             :root custom properties (colors, fonts)
    global.css                Reset, animations, shared utility classes
    home.css / record.css / review.css / garage.css / leaderboard.css / rewards.css / modals.css

  tests/
    math.test.js              Unit tests for utils/math.js
    linalg.test.js            Unit tests for utils/linalg.js
    color.test.js             Unit tests for utils/color.js
    scoring.test.js           Unit tests for scoring algorithm
    storage.test.js           Unit tests for localStorage layer
    sensors.test.js           Unit tests for event detection
```

## Key Design Decisions

### Shared mutable state
`state` and `calib` are module-level objects exported from `state.js`. They are mutated directly everywhere — this is intentional for a single-user PWA with no concurrent access.

### Circular dependency avoidance
Services never import from UI. Cross-layer calls use callbacks:
- `toggleFavoriteDrive(idx, { onUpdate })` — storage calls `onUpdate?.()` instead of `renderDriveList()`
- `deleteDrive(idx, { onUpdate })` — same
- `finalizeAndReview({ onReview, onListUpdate })` — calls `onReview(drive)` and `onListUpdate?.()` instead of importing render functions
- `checkRecoveredDrive({ onListUpdate })` — same
- `onGpsUpdate({ flashEvent, speakEvent, setCalibUI, calibrateAxes })` — callbacks injected from `record.js`

### CSS architecture
One file per screen. Never add a new override block at the bottom — edit the existing block. The `v3` comment sections in each CSS file are the canonical active rules; the `v1` rules above them are legacy kept for structural reference.

### Service worker
`public/sw.js` is copied to `dist/` unchanged by Vite. Bump `CACHE` version on every deploy. The `SHELL` array does **not** include hashed JS/CSS filenames — Vite handles those via `dist/index.html` which `sw.js` caches via `network-first`.

### Scoring pipeline
```
GPS 1Hz → processSample() → detectEvent() → events[]
Motion 60Hz → createMotionHandler() → peak-hold 500ms → detectEventWithThresh()
Stop → finalizeAndReview() → analyzeDrive() (7-dim) → score
```

`scoreFromEvents` handles the event-penalty model with confidence blending (short drives blend toward 100 to prevent 30-second perfect scores).

`analyzeDrive` runs 7 independent dimensions (peakHarshness, throttle, steering, braking, cornering, transitions, momentum) and produces a weighted composite.

### Drive recovery (iOS background eviction)
Every 30s during a live drive, `persistActiveDrive()` snapshots state to `localStorage`. On startup, `checkRecoveredDrive()` checks for a saved snapshot and restores it as a completed drive if it's <4h old and has ≥20 samples.

`stopRecording()` sets `state.recording = false` as its **first** line to prevent the 200ms ticker from re-saving after `clearActiveDrive()` clears the key.

## Roadmap artifact

`docs/roadmap.html` is the source of truth for the build log / roadmap the user
reads. It is published as an Artifact at:

```
https://claude.ai/code/artifact/248fed84-e783-4407-b137-4dc0b291ed33
```

Update it whenever the user's action items change or something ships. Edit the
file, then publish with **both** `file_path: docs/roadmap.html` and that `url` —
publishing without the `url` creates a second artifact and orphans the link the
user has bookmarked. Keep `favicon: 🏎️` stable, and **always re-stamp the
"Updated" line in the header**; changing content without the date makes the page
look stale to the user.

## Home screen audit artifact

`docs/home-audit.html` is a second published page, linked from the roadmap:

```
https://claude.ai/code/artifact/5b0f3541-951e-49af-bbb7-05e0fdc3fb85
```

Same rules as the roadmap — publish with **both** `file_path` and that `url`,
keep `favicon: 🏠`, and re-stamp the "Reviewed" line. Update it when home-screen
elements are added, linked, or removed, so it never describes a screen that no
longer exists.

## Commands

```bash
npm run dev          # Vite dev server with HMR
npm run build        # Production build → dist/
npm run preview      # Preview the dist/ build locally
npm test             # Run all tests (Vitest)
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report → coverage/
```

## Deploy

All three hosts (Netlify, Vercel, Cloudflare) run `npm run build` and serve from `dist/`. Config:
- `netlify.toml` — `command = "npm run build"`, `publish = "dist"`
- `vercel.json` — `buildCommand`, `outputDirectory = "dist"`
- `.github/workflows/deploy.yml` — installs, builds, tests, deploys to Netlify

## Branches
- `main` — production
- `claude/step-1-avg-speed-*` — active dev branch

## What lives where (legacy files)
- `app.js` — the original monolithic 2900-line file. **Not used in the Vite build.** Kept as a migration reference; will be deleted once the Vite path is confirmed stable in production.
- `sw.js` (root) — legacy service worker for the non-Vite version. `public/sw.js` is the active one.
