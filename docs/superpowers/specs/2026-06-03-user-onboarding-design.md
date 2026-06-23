# User Onboarding + Drive Tracking Design

**Date:** 2026-06-03  
**Updated:** 2026-06-11 (architecture simplification — security fix)  
**Status:** Approved  

---

## Overview

Add a first-launch onboarding modal that captures name + email before the user can access the app. Route captures to Resend (via Netlify function) and a server-side-only `users` Supabase table. Establish a progressive profiling pattern for collecting additional user/vehicle data over time.

---

## Goals

- Every user who opens the app is identified (name + email)
- All drives are linked to a user record via device_id
- Email list in Resend stays in sync automatically
- No friction beyond the initial capture (no passwords, no email verification)

---

## Non-Goals

- Supabase Auth / password-based accounts
- Multi-device account merging
- Email verification flow
- Push notifications

---

## Architecture

### Security Model

The Supabase **anon key** ships in the client bundle and is intentionally public — it provides read access to `drivers` (leaderboard) and write access to `drives`. **Email addresses must never appear in any table readable by the anon key.**

The solution: a **`users` table** with Row Level Security set to deny anon reads. All writes to `users` and Resend go through the Netlify function, which holds the **service role key** as a server-side env var.

The client makes **one POST** to `/register-user`. The function handles both writes. The client never touches Supabase directly for registration.

---

### 1. Onboarding Modal

**Trigger:** On `DOMContentLoaded`, check `localStorage` for `smoothaf.onboarded`. If absent, show the modal before revealing the home screen.

**Fields:**
- Name (text, required)
- Email (email type, required, client-side format validation)

**No skip button.** Both fields required to proceed.

**Submit flow:**
1. Validate fields client-side (non-empty, valid email format via `/.+@.+\..+/`)
2. Save name + email to localStorage immediately (`DRIVER_NAME_KEY` + new `USER_EMAIL_KEY = 'smoothaf.user_email'`)
3. Set `localStorage.setItem('smoothaf.onboarded', '1')`
4. Dismiss modal, show home screen
5. Call `registerUser({ name, email, device_id })` — async, fire-and-forget (does NOT block UI)

**Retry / offline handling:** `smoothaf.profile_synced` is only set to `'1'` by the client after the Netlify function returns `200`. On each app startup, `syncUserProfile()` checks: if `smoothaf.onboarded = '1'` but `smoothaf.profile_synced ≠ '1'`, it retries the POST. No Supabase read required — the flag is local-only.

**Visual style:** Matches existing modal pattern (`.signup-overlay` / `.signup-card`). Dark card, Playfair italic heading ("Welcome to Smooth AF"), tang-colored submit button. Trust copy below submit: *"No spam, no passwords. Just your driving score."*

---

### 2. Netlify Function — `register-user`

**File:** `netlify/functions/register-user.js`

**Trigger:** POST from client on onboarding submit and on retry via `syncUserProfile`

**Request body:**
```json
{ "name": "string", "email": "string", "device_id": "string" }
```

**Actions (in order):**
1. Normalize email: `email.trim().toLowerCase()`
2. Upsert to Supabase `users` table using **service role key** (conflict on `device_id`)
3. Add/update contact in Resend Audience via Resend Contacts API (idempotent — Resend deduplicates by email)
4. Return `200 OK`

**Error handling:** Returns `200` even on partial failure (Resend failure is non-critical — Supabase `users` is the source of truth). Logs errors server-side only.

**Environment variables (set in Netlify dashboard):**
- `RESEND_API_KEY` — Resend secret key
- `RESEND_AUDIENCE_ID` — target audience ID
- `SUPABASE_SERVICE_KEY` — service role key (never anon key)
- `SUPABASE_URL` — project URL (same as client value, but co-located for clarity)

No sensitive key ever appears in client-side code.

**Idempotency:** Both Supabase upsert (conflict on `device_id`) and Resend contacts API (deduplicates on email) are safe to call multiple times. Retries are harmless.

---

### 3. Supabase Schema Change

Create a new **`users`** table (do NOT add `email` to `drivers`):

```sql
CREATE TABLE IF NOT EXISTS users (
  device_id   text PRIMARY KEY,
  name        text,
  email       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Lock down anon access
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon read" ON users FOR SELECT USING (false);
```

The `drivers` table is NOT modified. Email is never written there.

The Netlify function upserts to `users` using the service role key (bypasses RLS).

---

### 4. Drive Tracking

No changes needed. `pushDriveToSupabase` already uploads every drive with `device_id`. The `users` row (with email) joins to `drives` via `device_id` in the Supabase dashboard.

`syncPendingDrives()` already retries failed uploads on each startup.

---

### 5. Progressive Profiling

After a user completes their **2nd drive** (i.e., `loadDrives().length >= 2`), show a prompt on the post-drive review screen:

> "What are you driving? Tell us your car and we'll personalize your experience."  
> Fields: Make (text), Model (text), Year (number) — all optional, dismissable once.

**Trigger logic:** `loadDrives().length >= 2 && !localStorage.getItem('smoothaf.car_prompted')` after `finalizeAndReview`. Show once — store `smoothaf.car_prompted = '1'` after dismissal or submission. Feeds directly into the existing Garage system (`saveVehicleForm`).

> **Note:** Use `>= 2` not `=== 2` — guards against edge cases where a drive was deleted then re-added.

Future prompts (not in this spec — add as separate features):
- After 5 drives: commute type (city / highway / mixed)
- After 10 drives: notification preferences
- After first 90+ score: share/refer prompt

---

## Data Flow

```
User opens app
  → smoothaf.onboarded absent?
    → Show onboarding modal (home screen hidden)
    → Submit: validate → save to localStorage → set smoothaf.onboarded = 1 → dismiss modal
    → POST /register-user (async, non-blocking)
      → On 200: set smoothaf.profile_synced = 1
      → On failure: flag stays unset, retried on next startup
  → Home screen visible

User completes drive
  → pushDriveToSupabase (drive linked to device_id)
  → drives.length >= 2 && !car_prompted? → show car prompt → save to Garage

App startup (every time)
  → syncPendingDrives() — retry failed drive uploads
  → syncUserProfile() — if onboarded but not profile_synced, retry POST /register-user
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/ui/modals.js` (new) | Onboarding modal component + `showOnboardingIfNeeded()` |
| `src/services/supabase.js` | Add `syncUserProfile()` |
| `src/constants.js` | Add `USER_EMAIL_KEY`, `ONBOARDED_KEY`, `PROFILE_SYNCED_KEY`, `CAR_PROMPTED_KEY` |
| `src/main.js` | Call `showOnboardingIfNeeded()` on startup, call `syncUserProfile()`, wire car prompt after drive |
| `netlify/functions/register-user.js` (new) | Netlify function — writes to Resend + Supabase `users` |
| `src/styles/modals.css` | Onboarding modal styles (extend existing `.signup-overlay` pattern) |
| Supabase dashboard | Run `CREATE TABLE users` + RLS policies |
| Netlify dashboard | Add `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL` env vars |

---

## Testing

- [ ] First launch shows modal, home screen not visible behind it
- [ ] Submit with empty fields shows validation error
- [ ] Submit with invalid email shows validation error  
- [ ] Valid submit: localStorage set, modal dismissed, home screen appears
- [ ] `smoothaf.profile_synced` set after successful POST
- [ ] Netlify function called — contact appears in Resend audience
- [ ] Supabase `users` row has name + email, `drivers` row does NOT have email
- [ ] Existing user (onboarded flag set) — modal does not appear on relaunch
- [ ] Offline submit — data saved locally, modal dismissed, synced on next startup
- [ ] `smoothaf.profile_synced` absent after offline submit — `syncUserProfile()` retries on next startup
- [ ] 2nd drive completed — car prompt appears on review screen
- [ ] Car prompt dismissed — `smoothaf.car_prompted` set, prompt never shows again
- [ ] Duplicate POST (retry scenario) — Supabase upsert and Resend both idempotent, no duplicates
