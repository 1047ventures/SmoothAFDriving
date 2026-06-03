# User Onboarding + Drive Tracking Design

**Date:** 2026-06-03  
**Status:** Approved  

---

## Overview

Add a first-launch onboarding modal that captures name + email before the user can access the app. Route captures to Resend (via Netlify function) and Supabase. Establish a progressive profiling pattern for collecting additional user/vehicle data over time.

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

### 1. Onboarding Modal

**Trigger:** On `DOMContentLoaded`, check `localStorage` for `smoothaf.onboarded`. If absent, show the modal before revealing the home screen.

**Fields:**
- Name (text, required)
- Email (email type, required, client-side format validation)

**No skip button.** Both fields required to proceed.

**Submit flow:**
1. Validate fields client-side (non-empty, valid email format)
2. Save name + email to localStorage immediately (`DRIVER_NAME_KEY` + new `USER_EMAIL_KEY = 'smoothaf.user_email'`)
3. Call `registerUser({ name, email, device_id })` — async, non-blocking
4. Set `localStorage.setItem('smoothaf.onboarded', '1')`
5. Dismiss modal, show home screen

**Offline handling:** If `registerUser` fails, the data is already in localStorage. A `syncUserProfile()` function runs on each startup — if `smoothaf.onboarded` is set but Supabase has no email for this device_id, it retries the registration.

**Visual style:** Matches existing modal pattern (`.permission-hint` / `.signup-overlay`). Dark card, Playfair italic heading ("Welcome to Smooth AF"), tang-colored submit button.

---

### 2. Netlify Function — `register-user`

**File:** `netlify/functions/register-user.js`

**Trigger:** POST from client on onboarding submit (and on retry via `syncUserProfile`)

**Request body:**
```json
{ "name": "string", "email": "string", "device_id": "string" }
```

**Actions:**
1. Add contact to Resend Audience via Resend Contacts API
2. Return `200 OK`

**Error handling:** Returns `200` even on Resend failure (non-critical path — Supabase is the source of truth).

**Environment variables (set in Netlify dashboard):**
- `RESEND_API_KEY` — Resend secret key
- `RESEND_AUDIENCE_ID` — target audience ID

The Resend API key never appears in client-side code.

---

### 3. Supabase Schema Change

Add `email` column to the `drivers` table:

```sql
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email text;
```

Update `syncToLeaderboard()` in `src/services/supabase.js` to include `email` in the upsert payload.

Add `syncUserProfile()` to `src/services/supabase.js`:
- Reads `smoothaf.onboarded`, `DRIVER_NAME_KEY`, `USER_EMAIL_KEY` from localStorage
- If onboarded but no email in Supabase for this device, calls the Netlify function and upserts to Supabase

---

### 4. Drive Tracking

No changes needed. `pushDriveToSupabase` already uploads every drive with `device_id`. The new `drivers` row (with email) joins to `drives` via `device_id` in the Supabase dashboard.

`syncPendingDrives()` already retries failed uploads on each startup.

---

### 5. Progressive Profiling

After a user completes their **2nd drive**, show a prompt on the post-drive review screen:

> "What are you driving? Tell us your car and we'll personalize your experience."  
> Fields: Make (text), Model (text), Year (number) — all optional, dismissable once.

**Trigger logic:** `loadDrives().length === 2` after `finalizeAndReview`. Show once — store `smoothaf.car_prompted = '1'` after dismissal or submission. Feeds directly into the existing Garage system (`saveVehicleForm`).

Future prompts (not in this spec — add as separate features):
- After 5 drives: commute type (city / highway / mixed)
- After 10 drives: notification preferences
- After first 90+ score: share/refer prompt

---

## Data Flow

```
User opens app
  → smoothaf.onboarded absent?
    → Show onboarding modal
    → Submit: save to localStorage + POST /register-user + upsert Supabase drivers
    → Set smoothaf.onboarded = 1
  → Home screen visible

User completes drive
  → pushDriveToSupabase (drive linked to device_id)
  → 2nd drive? → show car prompt → save to Garage

App startup (every time)
  → syncPendingDrives() — retry failed drive uploads
  → syncUserProfile() — retry failed user registration
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/ui/modals.js` (new) | Onboarding modal component + show/hide logic |
| `src/services/supabase.js` | Add `email` to `syncToLeaderboard`, add `syncUserProfile` |
| `src/constants.js` | Add `USER_EMAIL_KEY = 'smoothaf.user_email'`, `ONBOARDED_KEY = 'smoothaf.onboarded'`, `CAR_PROMPTED_KEY = 'smoothaf.car_prompted'` |
| `src/main.js` | Check onboarding on startup, call `syncUserProfile`, wire car prompt after 2nd drive |
| `netlify/functions/register-user.js` (new) | Netlify function — Resend contact add |
| `src/styles/modals.css` | Onboarding modal styles (extend existing) |
| Supabase dashboard | Run `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email text` |
| Netlify dashboard | Add `RESEND_API_KEY` and `RESEND_AUDIENCE_ID` env vars |

---

## Testing

- [ ] First launch shows modal, home screen not visible behind it
- [ ] Submit with empty fields shows validation error
- [ ] Submit with invalid email shows validation error  
- [ ] Valid submit: localStorage set, modal dismissed, home screen appears
- [ ] Netlify function called — contact appears in Resend audience
- [ ] Supabase `drivers` row has name + email
- [ ] Existing user (onboarded flag set) — modal does not appear on relaunch
- [ ] Offline submit — data saved locally, synced on next startup
- [ ] 2nd drive completed — car prompt appears on review screen
- [ ] Car prompt dismissed — `smoothaf.car_prompted` set, prompt never shows again
