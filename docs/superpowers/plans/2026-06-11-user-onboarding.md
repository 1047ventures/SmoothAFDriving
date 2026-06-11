# User Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-launch onboarding modal (name + email required) that feeds into a Netlify function which writes to Resend and a Supabase `users` table; add progressive car-details prompt after the 2nd drive.

**Architecture:** The client captures name + email, saves locally, dismisses the modal immediately (non-blocking), then fires a POST to `/.netlify/functions/register-user`. The Netlify function owns all server-side writes — both Resend contacts and Supabase `users` (using the service role key). The anon key that ships in the client bundle never touches the `users` table. Retry logic uses a local `smoothaf.profile_synced` flag.

**Tech Stack:** Vanilla JS ES modules, Vite 5, Vitest 2, Netlify serverless functions (ESM), Supabase REST API, Resend Contacts API.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/constants.js` | Modify | Add 4 new localStorage key constants |
| `src/tests/onboarding.test.js` | Create | Tests for `registerUser` + `syncUserProfile` |
| `src/services/supabase.js` | Modify | Add `registerUser()` and `syncUserProfile()` exports |
| `netlify/functions/register-user.js` | Create | HTTP function: normalise → upsert Supabase users → add Resend contact |
| `src/styles/modals.css` | Modify | Add `.onboard-error` and `.onboard-trust` styles |
| `src/ui/garage.js` | Modify | Add `addVehicleFromPrompt(make, model, year)` export |
| `src/ui/modals.js` | Create | `showOnboardingIfNeeded()` and `showCarPromptIfNeeded()` (depends on garage.js) |
| `src/ui/record.js` | Modify | Call `showCarPromptIfNeeded()` after `finalizeAndReview` |
| `src/main.js` | Modify | Call `showOnboardingIfNeeded()` + `syncUserProfile()` on startup |

---

## Task 1: Add Constants

**Files:**
- Modify: `src/constants.js`

- [ ] **Step 1: Add the four new storage key exports**

Open `src/constants.js`. After the `DRIVER_NAME_KEY` line (line 8), add:

```js
export const USER_EMAIL_KEY     = 'smoothaf.user_email';
export const ONBOARDED_KEY      = 'smoothaf.onboarded';
export const PROFILE_SYNCED_KEY = 'smoothaf.profile_synced';
export const CAR_PROMPTED_KEY   = 'smoothaf.car_prompted';
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass (80 tests).

- [ ] **Step 3: Commit**

```bash
git add src/constants.js
git commit -m "feat: add onboarding localStorage key constants"
```

---

## Task 2: Write Failing Tests for `registerUser` + `syncUserProfile`

**Files:**
- Create: `src/tests/onboarding.test.js`

- [ ] **Step 1: Create the test file**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub localStorage before module import
const store = {};
vi.stubGlobal('localStorage', {
  getItem:    k => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { registerUser, syncUserProfile } = await import('../services/supabase.js');
const {
  ONBOARDED_KEY, PROFILE_SYNCED_KEY, USER_EMAIL_KEY, DRIVER_NAME_KEY, DEVICE_KEY,
} = await import('../constants.js');

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  mockFetch.mockReset();
});

describe('registerUser', () => {
  it('POSTs to /.netlify/functions/register-user', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/.netlify/functions/register-user',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sets PROFILE_SYNCED_KEY on HTTP 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(store[PROFILE_SYNCED_KEY]).toBe('1');
  });

  it('does NOT set PROFILE_SYNCED_KEY when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(store[PROFILE_SYNCED_KEY]).toBeUndefined();
  });

  it('does NOT set PROFILE_SYNCED_KEY on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(store[PROFILE_SYNCED_KEY]).toBeUndefined();
  });
});

describe('syncUserProfile', () => {
  it('does nothing when not onboarded', async () => {
    await syncUserProfile();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when already profile_synced', async () => {
    store[ONBOARDED_KEY]      = '1';
    store[PROFILE_SYNCED_KEY] = '1';
    await syncUserProfile();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls fetch when onboarded but not synced', async () => {
    store[ONBOARDED_KEY]   = '1';
    store[DRIVER_NAME_KEY] = 'Alex';
    store[USER_EMAIL_KEY]  = 'alex@test.com';
    store[DEVICE_KEY]      = 'dev-abc';
    mockFetch.mockResolvedValueOnce({ ok: true });
    await syncUserProfile();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('sets PROFILE_SYNCED_KEY after successful sync', async () => {
    store[ONBOARDED_KEY]   = '1';
    store[DRIVER_NAME_KEY] = 'Alex';
    store[USER_EMAIL_KEY]  = 'alex@test.com';
    store[DEVICE_KEY]      = 'dev-abc';
    mockFetch.mockResolvedValueOnce({ ok: true });
    await syncUserProfile();
    expect(store[PROFILE_SYNCED_KEY]).toBe('1');
  });

  it('does NOT set PROFILE_SYNCED_KEY when fetch fails', async () => {
    store[ONBOARDED_KEY]   = '1';
    store[DRIVER_NAME_KEY] = 'Alex';
    store[USER_EMAIL_KEY]  = 'alex@test.com';
    store[DEVICE_KEY]      = 'dev-abc';
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await syncUserProfile();
    expect(store[PROFILE_SYNCED_KEY]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
npm test
```

Expected: the new `onboarding.test.js` file fails with "registerUser is not a function" or similar. All other tests still pass.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/tests/onboarding.test.js
git commit -m "test: add failing tests for registerUser and syncUserProfile"
```

---

## Task 3: Implement `registerUser` + `syncUserProfile`

**Files:**
- Modify: `src/services/supabase.js:1-5` (imports) and end of file (new exports)

- [ ] **Step 1: Add new constants to the import at the top of `supabase.js`**

The current first line is:
```js
import { loadDrives, getDeviceId, getSyncedIds, markSynced } from './storage.js';
```

Add a second import line below it:

```js
import {
  PROFILE_SYNCED_KEY, ONBOARDED_KEY,
  USER_EMAIL_KEY, DRIVER_NAME_KEY,
} from '../constants.js';
```

- [ ] **Step 2: Append `registerUser` and `syncUserProfile` at the end of `supabase.js`**

```js
export async function registerUser({ name, email, device_id }) {
  try {
    const res = await fetch('/.netlify/functions/register-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, device_id }),
    });
    if (res.ok) localStorage.setItem(PROFILE_SYNCED_KEY, '1');
  } catch { /* offline — caller retries via syncUserProfile on next startup */ }
}

export async function syncUserProfile() {
  if (!localStorage.getItem(ONBOARDED_KEY)) return;
  if (localStorage.getItem(PROFILE_SYNCED_KEY)) return;
  const name  = localStorage.getItem(DRIVER_NAME_KEY) || '';
  const email = localStorage.getItem(USER_EMAIL_KEY)  || '';
  await registerUser({ name, email, device_id: getDeviceId() });
}
```

- [ ] **Step 3: Run tests — all should pass**

```bash
npm test
```

Expected: all tests pass including the 9 new onboarding tests (total ~89 tests).

- [ ] **Step 4: Commit**

```bash
git add src/services/supabase.js
git commit -m "feat: add registerUser and syncUserProfile to supabase service"
```

---

## Task 4: Create the Netlify Function

**Files:**
- Create: `netlify/functions/register-user.js`

- [ ] **Step 1: Create the function file**

```js
const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_AUD = process.env.RESEND_AUDIENCE_ID;

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const { name = '', device_id = '' } = body;
  const email = (body.email || '').trim().toLowerCase();

  if (!email || !device_id) {
    return new Response('Missing required fields', { status: 400 });
  }

  // 1. Upsert to Supabase users table (service role key bypasses RLS)
  try {
    await fetch(`${SB_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        device_id,
        name:       name.trim(),
        email,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('Supabase upsert error:', err.message);
  }

  // 2. Add/update Resend contact (idempotent — Resend deduplicates by email)
  try {
    const parts = name.trim().split(' ');
    await fetch(`https://api.resend.com/audiences/${RESEND_AUD}/contacts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        email,
        first_name:   parts[0] || '',
        last_name:    parts.slice(1).join(' ') || '',
        unsubscribed: false,
      }),
    });
  } catch (err) {
    console.error('Resend contact error:', err.message);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

- [ ] **Step 2: Verify tests still pass (no breakage)**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/register-user.js
git commit -m "feat: add register-user Netlify function (Resend + Supabase users)"
```

- [ ] **Step 4: Manual smoke-test after deploy (do this after pushing)**

Once deployed to Netlify, test with curl:
```bash
curl -X POST https://YOUR_NETLIFY_SITE/.netlify/functions/register-user \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","device_id":"test-device-001"}'
```
Expected response: `{"ok":true}` with HTTP 200. Check Resend audience and Supabase `users` table for the new row.

---

## Task 5: Extend modals.css

**Files:**
- Modify: `src/styles/modals.css`

- [ ] **Step 1: Append onboarding-specific styles at the end of `src/styles/modals.css`**

```css
/* ── Onboarding modal extras ── */
.onboard-error {
  color: var(--danger, #e84a2f);
  font-size: 12px;
  min-height: 16px;
  margin: -6px 0 10px;
  text-align: center;
}
.onboard-trust {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  margin-top: 4px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/modals.css
git commit -m "feat: add onboarding modal CSS helpers"
```

---

## Task 6: Add `addVehicleFromPrompt` to `garage.js`

**Files:**
- Modify: `src/ui/garage.js`

- [ ] **Step 1: Add the export after `saveGarage` (after line ~21) in `garage.js`**

The `generateId`, `loadGarage`, and `saveGarage` functions are at lines 13-21. Add this export immediately after `saveGarage`:

```js
export function addVehicleFromPrompt(make, model, year) {
  const vehicles = loadGarage();
  vehicles.forEach(v => { v.active = false; });
  vehicles.push({
    id:     generateId(),
    type:   '',
    make:   make  || '',
    model:  model || '',
    year:   year  || '',
    color: '', licensePlate: '', vin: '',
    insurance:    { provider: '', policyNumber: '', expiryDate: '', agentPhone: '' },
    registration: { state: '', expiryDate: '' },
    active: true,
  });
  saveGarage(vehicles);
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/ui/garage.js
git commit -m "feat: add addVehicleFromPrompt export to garage"
```

---

## Task 7: Create `src/ui/modals.js`

**Files:**
- Create: `src/ui/modals.js`

- [ ] **Step 1: Create the file**

```js
import {
  ONBOARDED_KEY, USER_EMAIL_KEY, CAR_PROMPTED_KEY,
} from '../constants.js';
import { saveDriverName, getDeviceId, loadDrives } from '../services/storage.js';
import { registerUser } from '../services/supabase.js';
import { addVehicleFromPrompt } from './garage.js';

// ── Onboarding modal ───────────────────────────────────────────────────────────

function injectOnboardingModal() {
  if (document.getElementById('onboard-modal')) return;
  const el = document.createElement('div');
  el.id = 'onboard-modal';
  el.className = 'signup-overlay';
  el.innerHTML = `
    <div class="signup-card">
      <div class="signup-card-title">Welcome to Smooth AF</div>
      <div class="signup-card-sub">Track every drive. See how smooth you really are.</div>
      <input id="onboard-name"  class="signup-input" type="text"  placeholder="Your name"      autocomplete="given-name">
      <input id="onboard-email" class="signup-input" type="email" placeholder="Email address"  autocomplete="email">
      <div id="onboard-error" class="onboard-error"></div>
      <button id="onboard-submit" class="signup-submit">Get Started</button>
      <div class="onboard-trust">No spam, no passwords. Just your driving score.</div>
    </div>
  `;
  document.body.appendChild(el);
}

export function showOnboardingIfNeeded() {
  if (localStorage.getItem(ONBOARDED_KEY)) return;
  injectOnboardingModal();

  const nameInput  = document.getElementById('onboard-name');
  const emailInput = document.getElementById('onboard-email');
  const errorEl    = document.getElementById('onboard-error');
  const submitBtn  = document.getElementById('onboard-submit');

  setTimeout(() => nameInput?.focus(), 100);

  const handleSubmit = () => {
    const name  = (nameInput.value  || '').trim();
    const email = (emailInput.value || '').trim();
    errorEl.textContent = '';

    if (!name)                        { errorEl.textContent = 'Please enter your name.'; return; }
    if (!/.+@.+\..+/.test(email))     { errorEl.textContent = 'Please enter a valid email address.'; return; }

    // Persist immediately — modal dismisses before the network call
    saveDriverName(name);
    localStorage.setItem(USER_EMAIL_KEY, email);
    localStorage.setItem(ONBOARDED_KEY, '1');

    document.getElementById('onboard-modal')?.remove();

    // Fire-and-forget — syncUserProfile will retry on next startup if this fails
    registerUser({ name, email, device_id: getDeviceId() });
  };

  submitBtn.addEventListener('click', handleSubmit);
  nameInput.addEventListener('keydown',  e => { if (e.key === 'Enter') emailInput.focus(); });
  emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
}

// ── Car prompt modal ───────────────────────────────────────────────────────────

function injectCarPromptModal() {
  if (document.getElementById('car-prompt-modal')) return;
  const el = document.createElement('div');
  el.id = 'car-prompt-modal';
  el.className = 'signup-overlay';
  el.innerHTML = `
    <div class="signup-card">
      <div class="signup-card-title">What are you driving?</div>
      <div class="signup-card-sub">Tell us your car and we'll personalise your experience.</div>
      <input id="car-make"  class="signup-input" type="text" placeholder="Make (e.g. Toyota)"   autocomplete="off">
      <input id="car-model" class="signup-input" type="text" placeholder="Model (e.g. Camry)"   autocomplete="off">
      <input id="car-year"  class="signup-input" type="number" placeholder="Year (e.g. 2022)"   autocomplete="off" min="1980" max="2030">
      <button id="car-submit"  class="signup-submit">Save My Car</button>
      <button id="car-dismiss" class="signup-cancel">Skip for now</button>
    </div>
  `;
  document.body.appendChild(el);
}

export function showCarPromptIfNeeded() {
  if (localStorage.getItem(CAR_PROMPTED_KEY)) return;
  if (loadDrives().length < 2) return;

  injectCarPromptModal();

  const dismiss = () => {
    localStorage.setItem(CAR_PROMPTED_KEY, '1');
    document.getElementById('car-prompt-modal')?.remove();
  };

  document.getElementById('car-submit').addEventListener('click', () => {
    const make  = (document.getElementById('car-make').value  || '').trim();
    const model = (document.getElementById('car-model').value || '').trim();
    const year  = (document.getElementById('car-year').value  || '').trim();
    if (make || model || year) addVehicleFromPrompt(make, model, year);
    dismiss();
  });

  document.getElementById('car-dismiss').addEventListener('click', dismiss);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/modals.js
git commit -m "feat: add onboarding and car-prompt modal components"
```

---

## Task 8: Wire Onboarding in `main.js`

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Add the two new imports at the top of `main.js`**

After the existing imports, add:

```js
import { showOnboardingIfNeeded } from './ui/modals.js';
import { syncUserProfile } from './services/supabase.js';
```

- [ ] **Step 2: Add the two calls inside `DOMContentLoaded`, directly after `migrateLifetimeScore()`**

Current lines 19-22:
```js
  migrateLifetimeScore();
  checkRecoveredDrive({ onListUpdate: renderDriveList });
  renderDriveList();
  syncPendingDrives();
```

Replace with:
```js
  migrateLifetimeScore();
  showOnboardingIfNeeded();
  checkRecoveredDrive({ onListUpdate: renderDriveList });
  renderDriveList();
  syncPendingDrives();
  syncUserProfile();
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: wire onboarding modal and profile sync on app startup"
```

---

## Task 9: Wire Car Prompt in `record.js`

**Files:**
- Modify: `src/ui/record.js`

- [ ] **Step 1: Add the import at the top of `record.js`**

After the existing imports (after line 13), add:

```js
import { showCarPromptIfNeeded } from './modals.js';
```

- [ ] **Step 2: Call `showCarPromptIfNeeded()` after `finalizeAndReview` in `stopRecording()`**

Current lines 271-274:
```js
  finalizeAndReview({
    onReview: renderReview,
    onListUpdate: renderDriveList,
  });
```

Replace with:
```js
  finalizeAndReview({
    onReview: renderReview,
    onListUpdate: renderDriveList,
  });
  showCarPromptIfNeeded();
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/ui/record.js
git commit -m "feat: show car details prompt after 2nd completed drive"
```

---

## Task 10: Supabase Schema (manual step — Supabase dashboard)

- [ ] **Step 1: Run the following SQL in the Supabase dashboard SQL editor**

```sql
CREATE TABLE IF NOT EXISTS users (
  device_id   text PRIMARY KEY,
  name        text,
  email       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No anon read" ON users FOR SELECT USING (false);
```

This creates the `users` table with RLS preventing anon reads. The Netlify function uses the service role key which bypasses RLS.

- [ ] **Step 2: Verify the table exists with the correct columns**

Run in the SQL editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users' ORDER BY ordinal_position;
```

Expected output: `device_id text`, `name text`, `email text`, `created_at timestamptz`, `updated_at timestamptz`.

---

## Task 11: Netlify Environment Variables (manual step — Netlify dashboard)

- [ ] **Step 1: Add the following environment variables in Netlify dashboard → Site Settings → Environment Variables**

| Key | Value |
|-----|-------|
| `RESEND_API_KEY` | Your Resend secret key (starts with `re_`) |
| `RESEND_AUDIENCE_ID` | Your Resend audience UUID |
| `SUPABASE_URL` | `https://dbreetxubxdxogmektxc.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key (from Project Settings → API → service_role) |

> **Security note:** The service role key bypasses all RLS. Never expose it in client-side code. It lives only in Netlify's encrypted env var store.

---

## Task 12: Push + Create PR

- [ ] **Step 1: Push the branch and create a PR**

```bash
git push -u origin claude/step-1-avg-speed-iyJ30
```

Then create a draft PR targeting `claude-pwa`.

---

## Post-Deploy Verification Checklist

Run through these manually in the browser after deploying:

- [ ] First launch (clear site data) — modal appears, home screen is covered
- [ ] Submit empty name — "Please enter your name." error appears
- [ ] Submit invalid email — "Please enter a valid email address." error appears
- [ ] Valid submit — modal dismisses, home screen visible, `smoothaf.onboarded = 1` in localStorage
- [ ] Reload — modal does not appear again
- [ ] Check Resend audience — contact with submitted email appears
- [ ] Check Supabase `users` table — row with device_id, name, email
- [ ] Check Supabase `drivers` table — no `email` column
- [ ] Simulate offline: clear `smoothaf.profile_synced`, reload — `syncUserProfile` retries the POST on startup
- [ ] Complete 2 drives — car prompt appears on review screen after 2nd
- [ ] Dismiss car prompt — `smoothaf.car_prompted = 1` set, prompt never shows again
- [ ] Submit car details in prompt — new vehicle appears in Garage
