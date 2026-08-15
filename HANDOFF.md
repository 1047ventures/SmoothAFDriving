# Smooth AF Driving — Handoff

**Written:** Aug 15, 2026 · 5:12 PM MDT
**Status:** All work continues in one session from here. Nothing is waiting on another thread.

Read this top to bottom before starting. It supersedes any earlier handoff — an
earlier draft contained one factual error and four omissions, corrected below.

---

## 1 · The one thing blocking everything

**Sign-in is built, deployed, and cannot complete: the email never arrives.**

This is not "untested." It was attempted, and it failed. Requesting a code hits
Supabase successfully:

```
POST /auth/v1/otp  →  HTTP 200, {}
```

`200` means *accepted and queued*, and there was no rate-limit rejection. So the
app's client code is doing its job correctly — **this is a mail delivery failure,
not a bug.**

Prime suspect: Supabase's built-in shared SMTP, which is explicitly not for
production. It is throttled at the project level, slow, and drops mail without
reporting it.

**Diagnose in this order:**

1. Gmail **spam** and **Promotions** tabs. Bare transactional mail from a shared
   sender lands there constantly.
2. **Supabase → Authentication → Logs** — definitive answer on whether the send
   was dispatched or dropped.
3. If dropped: configure **custom SMTP**. Resend is the least friction (3,000/mo
   free, sends from their test domain with no DNS wait).

`scripts/supabase-setup.mjs` already talks to the Management API auth config
endpoint, which accepts `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`,
`smtp_sender_name`. Extending that script is the natural place to put SMTP setup
so it's reproducible rather than dashboard clicking.

---

## 2 · Verified true in production

Independently confirmed against the live API, not just read from a log.

| Item | State | Evidence |
|---|---|---|
| `drives.user_id` column | **Applied** | REST select returns `200` (previously `42703 does not exist`) |
| `20260814000000_accounts.sql` | **Applied & tracked** | recorded in `public.schema_migrations` |
| "Confirm signup" email | **Prints the code** | `{{ .Token }}` present on re-read |
| "Magic Link" email | **Prints the code** | same |
| The 122 existing drives | **All claimable** | every row `user_id: null`, `device_id` = `41226b7c-e747-44e3-be3e-73e9fb8ba4eb` |
| Sign in with Apple | **Off** — optional | `external.apple: false` |

Existing custom email-template content was **preserved** — the code block was
prepended above it with an `<hr>`, not substituted for it.

**No new app build is needed.** TestFlight **build 106** already ships the
client-side accounts code. Everything remaining is server-side.

---

## 3 · Open work, in priority order

### 3.1 — Shorten the sign-in code to 4 digits *(requested, not started)*

The 6-digit code **did not fit the input field on the phone** — there was not
enough room to type it. This was asked for and never actioned.

Two ways to fix it, and they're not equivalent:

- **Shorten the code.** Supabase exposes `mailer_otp_length` in the auth config,
  reachable through the same Management API `scripts/supabase-setup.mjs` already
  uses. Note the security cost: 4 digits is 10,000 combinations versus
  1,000,000. Supabase's OTP expiry and rate limiting absorb some of that, but
  it is a real reduction.
- **Widen the field.** `.auth-input-code` in `src/styles/auth.css` uses
  `letter-spacing:.42em` with a compensating `text-indent`. That's likely what
  ran out of room, and the input can be made to fit 6 comfortably.

The user asked for 4 digits. Do that, but the field is worth fixing regardless —
whatever the length, it should not feel cramped.

> If you touch `auth.css`, the visual-verification rule in `CLAUDE.md` applies.
> The 6-digit input's `text-indent` hack is **correct** — measured 84.5px vs
> 84.0px side gaps. Don't "fix" it.

### 3.2 — Move the deploy hosts off `claude-pwa`

`claude-pwa` still exists at `3e8945e` and is now **two commits behind `main`**.
Each host has its own production-branch setting that may still point at it:

- **Netlify** → Site configuration → Build & deploy → Branches → Production branch
- **Vercel** → Settings → Git → Production Branch — **two projects**:
  `smoothafdriving` *and* `smoothaf-tracker`
- **Cloudflare Pages** → Settings → Builds & deployments → Production branch

Nothing breaks loudly if skipped; those hosts quietly freeze at old code. Once
moved, `claude-pwa` can be deleted.

`smoothaf-tracker` serves the dead `/tracker` page. Disconnecting that project
outright is probably better than repointing it.

### 3.3 — Revoke the Supabase personal access token

It's a full-account credential that has done its job.
https://supabase.com/dashboard/account/tokens

### 3.4 — Lock down `drives_select`

`public.drives` has RLS enabled, but select is deliberately open:

```sql
create policy drives_select on public.drives
  for select to anon, authenticated using (true);
```

Full GPS tracks are readable by anyone holding the anon key. **This is
pre-existing, not introduced by the accounts migration** — and the roadmap
previously implied the migration resolved it, which was wrong.

It's intentional: tightening to `using (user_id = auth.uid())` breaks the
device-ID restore path for users who haven't signed in. Gated on (a) sign-in
confirmed working end to end, and (b) the device-ID restore box retired from the
home screen.

### 3.5 — OBD-II over Bluetooth

Dongle in hand (Veepeak OBDCheck BLE), native shell running, fully unblocked.
A Capacitor BLE plugin speaking ELM327 gets real throttle %, RPM and true
vehicle speed — data the phone's sensors cannot see.

### 3.6 — Optional: Sign in with Apple

The button is already built and **appears by itself** once the provider is
enabled — `isAppleConfigured()` checks at runtime, so no release is needed.
Apple only *requires* it if you offer another third-party login, so email-only
is App Store submittable as-is. Steps in `ACCOUNTS.md`.

---

## 4 · Repo and branches

`origin/main` HEAD is `a9af8cc` — *"Move the roadmap into the repo so any session
can update it (#48)"*.

`main` **is now the production branch.** It previously held an unrelated Lovable
project while all real work sat on `claude-pwa` — which meant `workflow_dispatch`
buttons never appeared, because GitHub only registers those from the default
branch. The codebase was moved to `main` and the workflows repointed.

### Branch cleanup — corrected

An earlier handoff said `origin/lovable-legacy` holds *"39 commits that exist
nowhere else."* **That is wrong**, and it contradicted its own next paragraph.
Measured:

```
commits on lovable-legacy not in main:            39
  ...also on claude/smooth-driving-tracker-app:   39
  ...also on claude/cartoon-profile-pics-QdTAg:   39
  ...also on claude/ad-landing-splash:            39
```

The old history is preserved in **four or more places**. Practical consequence,
which inverts the earlier advice:

- **Keep `lovable-legacy`.** It is the clean, intentional archive of the old
  Lovable tree at `5a34c5d`.
- **Those other `claude/*` branches are therefore safe to delete** — the earlier
  doc marked them unsafe, leaving clutter for no reason.
- Remaining `claude/*` branches showing 1–13 "unmerged" commits are squash-merge
  artifacts; their content is already in `main`. Safe, cosmetic.

**Nothing has been deleted.**

---

## 5 · Things that are NOT problems — don't re-investigate

- **`.env` committed on the old `main`.** Contains only
  `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_SUPABASE_URL` — all browser-facing and public by design.
- **The Supabase anon key in `src/constants.js`.** Public by design; RLS is the
  actual boundary.
- **`gh` CLI rate limit.** A login failed with *"API rate limit already exceeded
  for user ID 131412107."* The likely cause is not a mystery integration: the
  prior session made heavy GitHub API calls authenticated as that account —
  listing runs, fetching logs, opening and merging PRs. Check that before
  hunting a stuck retry loop. `gh` is installed (v2.97.0) but **not
  authenticated**; `~/.config/gh/hosts.yml` was never written.
- **The 6-digit code input's `text-indent`.** Correct, and measured. See §3.1.

---

## 6 · Conventions to keep

**Roadmap.** `docs/roadmap.html` is the source of truth and publishes to a
**fixed artifact URL**. Republish with **both** `file_path` and that `url` —
omitting the URL forks a second artifact and orphans the user's bookmark. Keep
`favicon: 🏎️`. **Always re-stamp the "Updated" line**; this has already been
missed once and made the page look stale. Full procedure is in the comment at
the top of that file, and in `CLAUDE.md`.

**UI changes.** `CLAUDE.md` mandates rendering affected screens with Playwright
and actually reading the screenshots before calling a UI change done. Chromium
is at `/opt/pw-browsers`. This rule has caught real defects — a top-bar button
painting text over the version badge, a modal that scrolled its own close button
out of reach.

**Migrations and Supabase config.** Run through
`.github/workflows/supabase-setup.yml` (Management API, needs
`SUPABASE_ACCESS_TOKEN`). It's idempotent, and `dry_run` writes nothing. The
older `migrate.yml` needs `SUPABASE_DB_URL`, which has been broken since the DB
password was rotated. Both share `public.schema_migrations`, so they agree on
what has run.

**Docs worth reading:** `CLAUDE.md` (architecture, conventions), `ACCOUNTS.md`
(auth setup and the manual fallbacks), `NATIVE.md` (iOS/TestFlight runbook).

---

## 7 · The immediate next move

1. Check spam, then Supabase auth logs.
2. If the mail was dropped, set up custom SMTP — that unblocks sign-in.
3. Sign in on build 106 and confirm the 122 drives get claimed.
4. Then shorten the code to 4 digits and fix the input field.

Everything else in §3 can follow in any order.
