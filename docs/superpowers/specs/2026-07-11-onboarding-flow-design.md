# First-Run Onboarding Flow — Design

> Design spec for a follow-up implementation (not part of the UX critical-five batch). Turn into a plan with superpowers:writing-plans when ready to build.

**Problem (from the UX audit):** An organic first-time user is dropped straight onto the home hero with no value prop, no "how it works," and no permission context. The only onboarding today is a name/email modal that appears **after** the first completed drive (`modals.js` `showOnboardingIfNeeded`, gated on `ONBOARDED_KEY`), plus a *separate* car-prompt modal after the 2nd drive (`showCarPromptIfNeeded`). So: no cold-start guidance, permissions requested cold at first Start, and modal fatigue post-drive.

**Goal:** A short, skippable cold-start flow that (1) sells the value in one line, (2) tells the user the one thing that makes scoring work — *mount the phone* — (3) primes location + motion permission with context before the OS prompts, and (4) consolidates the scattered post-drive asks. Everything stays optional; the user can reach "Start Drive" fast.

**Non-goals:** account system / login, video, localization, changing the scoring or the in-drive UI.

---

## 1. Trigger & Gating

- New storage key `INTRO_SEEN_KEY = 'smoothaf.intro_seen'` (add to `constants.js`). Distinct from `ONBOARDED_KEY` (which gates the name capture).
- On `DOMContentLoaded` (`main.js`), after the home render, call `showIntroIfNeeded()`:
  - Show the intro **only if** `!localStorage.getItem(INTRO_SEEN_KEY)` **and** `loadDrives().length === 0` (brand-new user).
  - The existing ad-splash (utm arrivals) takes precedence — if the ad-splash shows, don't also show the intro; set `INTRO_SEEN` when the ad-splash is dismissed so they aren't double-onboarded.
- Set `INTRO_SEEN_KEY` when the intro is completed **or** skipped (either path marks it seen — never nag).

## 2. The Intro (3 slides, skippable)

A full-screen overlay (injected at runtime like the other modals in `modals.js`), dark theme, one primary action per slide, a persistent "Skip" affordance, and dots showing progress.

1. **Value** — "Smooth AF scores how smoothly you drive." Sub: "Real-time smoothness score every trip. Brake, accelerate, and corner like butter." Primary: **Next**.
2. **How it works** — "① Mount your phone. ② Tap Start. ③ Just drive." Emphasize the mount: "Keep your phone in a steady mount — that's how we feel every input." (This single tip materially improves sensor data quality.) Primary: **Next**.
3. **Permissions primer** — "We use your phone's **motion** and **location** to measure smoothness and map your drive. Nothing leaves your device without your say-so." Primary: **Got it — let's drive** → sets `INTRO_SEEN`, closes the overlay, and returns to Home (does NOT auto-start a drive; the user taps Start themselves, which triggers the existing permission requests — now with context).

Copy is placeholder-quality; refine on device. Keep each slide to a headline + one sub + one button.

## 3. Permission Priming (reduce cold prompts)

- The current motion pre-prompt (`#perm-modal`, shown at first Start) stays. The intro's slide 3 is the *soft* primer; the OS prompt still fires at first Start. This two-step (educate in intro → OS prompt on Start) is the standard pattern and fine.
- Optional enhancement (flag for later, not required): use `navigator.permissions.query({name:'geolocation'})` to detect a previously-denied state and, if blocked, show a small "Location is blocked — enable it in Settings to record" hint on the home screen instead of failing at Start. (Pairs with the critical-five geolocation-denied toast.)

## 4. Consolidate the post-drive asks

Today: name/email modal after drive 1 (`showOnboardingIfNeeded`), car prompt after drive 2 (`showCarPromptIfNeeded`) — two interruptions on two different drives.

- Keep **name capture after the first drive** (they've now seen value — good moment to ask). But merge the **car prompt into the same post-first-drive sheet** as an optional second step ("Add your car? (optional)") rather than waiting for drive 2. One interruption, not two.
- Email stays optional on the name step (as today). Nothing blocks reaching the leaderboard later via the existing signup modal.
- If the user skipped everything, never re-prompt automatically — surface these as passive CTAs on Home instead (the existing "Set your driver name" leaderboard CTA already does this).

## 5. Files (for the future plan)

| File | Change |
|---|---|
| `src/constants.js` | Add `INTRO_SEEN_KEY` |
| `src/ui/modals.js` (or new `src/ui/intro.js`) | `showIntroIfNeeded()` + the 3-slide overlay (runtime-injected, matching existing modal-injection style); merge car prompt into the post-first-drive sheet |
| `src/main.js` | Call `showIntroIfNeeded()` in DOMContentLoaded; set `INTRO_SEEN` on ad-splash dismiss |
| `src/styles/modals.css` | Intro overlay + slide styles (dark theme, dots, skip) |
| `index.html` | Only if not runtime-injected |

## 6. Success criteria

- A brand-new organic user sees the 3-slide intro before their first Start; a returning user (or anyone with ≥1 drive) never sees it.
- Skips are one tap and never re-shown.
- After the first drive: a single consolidated "name (+ optional car)" moment, not two separate modals across two drives.
- Permission prompts at first Start now follow context the user just read.

## 7. Open questions (decide at plan time)

- Do we want name capture in the intro itself (up-front, higher friction) or keep it post-first-drive (recommended)? → recommend post-first-drive.
- Should slide 3's button optionally kick off Start immediately, or always return to Home? → recommend return to Home (less jarring; user initiates).
