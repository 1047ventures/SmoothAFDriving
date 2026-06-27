# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, password-gated operator dashboard showing who uses SmoothAF Driving and how, on top of the existing Supabase `users` and `drives` tables.

**Architecture:** A pure aggregation module (`netlify/functions/_lib/adminStats.mjs`) does all the math and is unit-tested with Vitest. A thin Netlify function (`netlify/functions/admin-stats.mjs`) authenticates a password against an env var, reads Supabase with the service-role key, and delegates to the pure module. A static `public/admin.html` renders overview tiles + a per-user drill-down.

**Tech Stack:** Netlify Functions (ESM `.mjs`, esbuild bundler), Supabase REST, `node:crypto`, vanilla HTML/JS, Vitest.

**Reference:** Spec at `docs/superpowers/specs/2026-06-27-analytics-dashboard-design.md`. Existing service-key pattern at `netlify/functions/register-user.js`.

**Conventions to know:**
- Vitest `include` is `src/**/*.js` (see `vite.config.js`), so the test file must live under `src/` and end in `.js`. It imports the module under test by relative path into `netlify/`.
- Netlify functions are auto-discovered from `netlify/functions/`. Subdirectories like `_lib/` are not treated as functions (leading underscore), so helper modules live safely there.
- All commit authors in this repo use `git config user.email noreply@anthropic.com && git config user.name Claude`.

---

### Task 1: Pure aggregation — `computeOverview`

**Files:**
- Create: `netlify/functions/_lib/adminStats.mjs`
- Test: `src/tests/adminStats.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/tests/adminStats.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { computeOverview } from '../../netlify/functions/_lib/adminStats.mjs';

const DAY = 864e5;
const NOW = 1_700_000_000_000;            // fixed "now" for deterministic windows
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Shared fixture: 3 users (Alice, Bob, Dana), 4 real drives + 1 simulated.
// dev-A: 2 drives on 2 different days (returning), recent (active 7d)
// dev-B: 1 drive 10 days ago (active 30d, not 7d, not returning)
// dev-C: 1 drive 100 days ago, NO user row (anonymous)
// dev-D: user row but NO drives (installed, never drove)
const USERS = [
  { device_id: 'dev-A', name: 'Alice', email: 'a@x.com', updated_at: '2023-11-13T00:00:00Z' },
  { device_id: 'dev-B', name: 'Bob',   email: 'b@x.com', updated_at: '2023-11-04T00:00:00Z' },
  { device_id: 'dev-D', name: 'Dana',  email: 'd@x.com', updated_at: '2023-11-10T00:00:00Z' },
];
const DRIVES = [
  { device_id: 'dev-A', start_time: NOW - 2 * DAY, score: 90, distance_meters: 1609.34, simulated: false },
  { device_id: 'dev-A', start_time: NOW - 1 * DAY, score: 80, distance_meters: 3218.68, simulated: false },
  { device_id: 'dev-B', start_time: NOW - 10 * DAY, score: 70, distance_meters: 1609.34, simulated: false },
  { device_id: 'dev-C', start_time: NOW - 100 * DAY, score: 50, distance_meters: 0, simulated: false },
  { device_id: 'dev-A', start_time: NOW, score: 0, distance_meters: 9999, simulated: true }, // excluded
];

describe('computeOverview', () => {
  const ov = computeOverview(USERS, DRIVES, NOW);

  it('counts users, devices, drives (simulated excluded)', () => {
    expect(ov.totalUsers).toBe(3);
    expect(ov.totalDevices).toBe(3);   // A, B, C — not D (no drives), not the sim row
    expect(ov.totalDrives).toBe(4);
  });

  it('averages score and sums miles over real drives only', () => {
    expect(ov.avgScore).toBe(73);      // (90+80+70+50)/4 = 72.5 -> 73
    expect(ov.totalMiles).toBe(4);     // (1+2+1+0) miles
  });

  it('computes active windows relative to nowMs', () => {
    expect(ov.activeUsers7d).toBe(1);  // dev-A only
    expect(ov.activeUsers30d).toBe(2); // dev-A, dev-B
  });

  it('counts returning users (drives on >= 2 distinct UTC days)', () => {
    expect(ov.returningUsers).toBe(1); // dev-A
  });

  it('buckets installs by each device first-seen day, sorted ascending', () => {
    expect(ov.installsByDay).toEqual([
      { day: day(NOW - 100 * DAY), count: 1 },
      { day: day(NOW - 10 * DAY),  count: 1 },
      { day: day(NOW - 2 * DAY),   count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/adminStats.test.js`
Expected: FAIL — cannot resolve `../../netlify/functions/_lib/adminStats.mjs` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `netlify/functions/_lib/adminStats.mjs`:

```js
// Pure analytics aggregators. No I/O, no Date.now() — caller passes nowMs so
// results are deterministic and unit-testable.

const MS_PER_DAY = 864e5;
const METERS_PER_MILE = 1609.34;

function realDrives(drives) {
  return (drives || []).filter(d => !d.simulated);
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

function mean(nums) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

function miles(meters) {
  return +(meters / METERS_PER_MILE).toFixed(1);
}

export function computeOverview(users, drives, nowMs) {
  const real = realDrives(drives);
  const devices = new Set(real.map(d => d.device_id));

  const firstSeen = new Map();
  const daysByDevice = new Map();
  const active7 = new Set();
  const active30 = new Set();

  for (const d of real) {
    const prev = firstSeen.get(d.device_id);
    if (prev == null || d.start_time < prev) firstSeen.set(d.device_id, d.start_time);

    let days = daysByDevice.get(d.device_id);
    if (!days) { days = new Set(); daysByDevice.set(d.device_id, days); }
    days.add(dayKey(d.start_time));

    if (d.start_time >= nowMs - 7 * MS_PER_DAY) active7.add(d.device_id);
    if (d.start_time >= nowMs - 30 * MS_PER_DAY) active30.add(d.device_id);
  }

  let returningUsers = 0;
  for (const days of daysByDevice.values()) if (days.size >= 2) returningUsers++;

  const byDay = new Map();
  for (const ts of firstSeen.values()) {
    const k = dayKey(ts);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const installsByDay = [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  return {
    totalUsers: (users || []).length,
    totalDevices: devices.size,
    totalDrives: real.length,
    avgScore: mean(real.map(d => d.score).filter(s => s != null)),
    totalMiles: miles(real.reduce((s, d) => s + (d.distance_meters || 0), 0)),
    activeUsers7d: active7.size,
    activeUsers30d: active30.size,
    returningUsers,
    installsByDay,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/adminStats.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_lib/adminStats.mjs src/tests/adminStats.test.js
git commit -m "feat: computeOverview analytics aggregator"
```

---

### Task 2: Pure aggregation — `computeUserRows`

**Files:**
- Modify: `netlify/functions/_lib/adminStats.mjs` (add export)
- Test: `src/tests/adminStats.test.js` (add describe block, reuse fixture)

- [ ] **Step 1: Write the failing test**

Append to `src/tests/adminStats.test.js` (after the `computeOverview` block). First update the import line at the top of the file from:

```js
import { computeOverview } from '../../netlify/functions/_lib/adminStats.mjs';
```

to:

```js
import { computeOverview, computeUserRows } from '../../netlify/functions/_lib/adminStats.mjs';
```

Then append:

```js
describe('computeUserRows', () => {
  const rows = computeUserRows(USERS, DRIVES);

  it('returns one row per device (union of users and real drives)', () => {
    expect(rows.length).toBe(4); // A, B, C, D
  });

  it('sorts by lastSeen descending', () => {
    expect(rows.map(r => r.deviceId)).toEqual(['dev-A', 'dev-D', 'dev-B', 'dev-C']);
  });

  it('aggregates a known user correctly', () => {
    const a = rows.find(r => r.deviceId === 'dev-A');
    expect(a.name).toBe('Alice');
    expect(a.isAnonymous).toBe(false);
    expect(a.driveCount).toBe(2);     // simulated drive excluded
    expect(a.avgScore).toBe(85);      // (90+80)/2
    expect(a.totalMiles).toBe(3);     // 1+2
    expect(a.firstSeen).toBe(NOW - 2 * DAY);
    expect(a.lastSeen).toBe(NOW - 1 * DAY);
  });

  it('flags devices with drives but no user row as anonymous', () => {
    const c = rows.find(r => r.deviceId === 'dev-C');
    expect(c.isAnonymous).toBe(true);
    expect(c.name).toBeNull();
    expect(c.email).toBeNull();
    expect(c.driveCount).toBe(1);
    expect(c.avgScore).toBe(50);
  });

  it('includes users who never drove (zero drives, null scores)', () => {
    const d = rows.find(r => r.deviceId === 'dev-D');
    expect(d.driveCount).toBe(0);
    expect(d.avgScore).toBeNull();
    expect(d.firstSeen).toBeNull();
    expect(d.totalMiles).toBe(0);
    expect(d.lastSeen).toBe(Date.parse('2023-11-10T00:00:00Z')); // falls back to updated_at
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/adminStats.test.js`
Expected: FAIL — `computeUserRows is not a function` (export missing).

- [ ] **Step 3: Write minimal implementation**

Append to `netlify/functions/_lib/adminStats.mjs`:

```js
export function computeUserRows(users, drives) {
  const real = realDrives(drives);
  const usersByDevice = new Map((users || []).map(u => [u.device_id, u]));

  const drivesByDevice = new Map();
  for (const d of real) {
    let arr = drivesByDevice.get(d.device_id);
    if (!arr) { arr = []; drivesByDevice.set(d.device_id, arr); }
    arr.push(d);
  }

  const deviceIds = new Set([...usersByDevice.keys(), ...drivesByDevice.keys()]);
  const rows = [];

  for (const deviceId of deviceIds) {
    const u = usersByDevice.get(deviceId) || null;
    const ds = drivesByDevice.get(deviceId) || [];
    const starts = ds.map(d => d.start_time);
    const firstSeen = ds.length ? Math.min(...starts) : null;
    let lastSeen = ds.length ? Math.max(...starts) : null;
    if (lastSeen == null && u && u.updated_at) {
      const parsed = Date.parse(u.updated_at);
      lastSeen = Number.isNaN(parsed) ? null : parsed;
    }
    rows.push({
      deviceId,
      name: u ? (u.name || null) : null,
      email: u ? (u.email || null) : null,
      isAnonymous: !u,
      driveCount: ds.length,
      firstSeen,
      lastSeen,
      avgScore: mean(ds.map(d => d.score).filter(s => s != null)),
      totalMiles: miles(ds.reduce((s, d) => s + (d.distance_meters || 0), 0)),
    });
  }

  rows.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/adminStats.test.js`
Expected: PASS (10 tests total).

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `npx vitest run`
Expected: all test files pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_lib/adminStats.mjs src/tests/adminStats.test.js
git commit -m "feat: computeUserRows analytics aggregator"
```

---

### Task 3: Netlify function — `admin-stats`

**Files:**
- Create: `netlify/functions/admin-stats.mjs`

This handler is thin I/O glue (per spec, not unit-tested); verification is a syntax check plus the existing pattern in `register-user.js`.

- [ ] **Step 1: Write the function**

Create `netlify/functions/admin-stats.mjs`:

```js
import { createHash, timingSafeEqual } from 'node:crypto';
import { computeOverview, computeUserRows } from './_lib/adminStats.mjs';

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const sha256 = (s) => createHash('sha256').update(String(s)).digest();

// Constant-time compare. Hashing first guarantees equal-length buffers.
function passwordOk(supplied) {
  if (!ADMIN_PASSWORD) return false;
  return timingSafeEqual(sha256(supplied || ''), sha256(ADMIN_PASSWORD));
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body;
  try { body = await req.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  if (!SB_URL || !SB_SERVICE_KEY || !ADMIN_PASSWORD) {
    console.error('admin-stats misconfigured: missing SUPABASE_URL / SUPABASE_SERVICE_KEY / ADMIN_PASSWORD');
    return json(500, { ok: false, error: 'misconfigured' });
  }

  if (!passwordOk(body.password)) {
    await delay(500); // blunt brute-forcing
    return json(401, { ok: false, error: 'unauthorized' });
  }

  try {
    const view = body.view || 'overview';

    if (view === 'user') {
      if (!body.device_id) return json(400, { ok: false, error: 'missing device_id' });
      const enc = encodeURIComponent(body.device_id);
      // NOTE: 10000-row cap is far above current volume; pagination is a future task.
      const all = await sbGet(
        `drives?device_id=eq.${enc}&select=start_time,duration_ms,distance_meters,score,event_count,simulated&order=start_time.desc&limit=10000`
      );
      const drives = all.filter(d => !d.simulated);
      return json(200, { ok: true, drives });
    }

    const [users, drives] = await Promise.all([
      sbGet('users?select=device_id,name,email,updated_at&limit=10000'),
      sbGet('drives?select=device_id,start_time,duration_ms,distance_meters,score,event_count,simulated&limit=10000'),
    ]);
    const nowMs = Date.now();
    return json(200, {
      ok: true,
      overview: computeOverview(users, drives, nowMs),
      users: computeUserRows(users, drives),
    });
  } catch (err) {
    console.error('admin-stats db error:', err.message);
    return json(500, { ok: false, error: 'db_error' });
  }
};
```

- [ ] **Step 2: Verify syntax**

Run: `node --check netlify/functions/admin-stats.mjs && node --check netlify/functions/_lib/adminStats.mjs`
Expected: no output, exit 0 (both files parse).

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/admin-stats.mjs
git commit -m "feat: admin-stats Netlify function (password-gated)"
```

---

### Task 4: Dashboard page — `public/admin.html`

**Files:**
- Create: `public/admin.html`

Self-contained static page (Vite copies `public/` to `dist/` unchanged). No external assets, no build step.

- [ ] **Step 1: Write the page**

Create `public/admin.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>SmoothAF · Admin</title>
  <style>
    :root { --bg:#0a0808; --cream:#f4ebd9; --dim:rgba(244,235,217,.55); --line:rgba(244,235,217,.12); }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--cream);
           font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:24px; }
    h1 { font-size:18px; letter-spacing:.04em; margin:0 0 16px; }
    .hidden { display:none !important; }
    input { font:inherit; padding:10px 12px; border-radius:8px; border:1px solid var(--line);
            background:#000; color:var(--cream); }
    button { font:inherit; padding:10px 16px; border-radius:8px; border:0; cursor:pointer;
             background:var(--cream); color:#080808; font-weight:600; }
    .err { color:#e8501a; font-size:13px; margin-top:8px; min-height:16px; }
    .tiles { display:flex; flex-wrap:wrap; gap:12px; margin:16px 0 24px; }
    .tile { flex:1 1 130px; background:#120f0f; border:1px solid var(--line); border-radius:12px; padding:14px; }
    .tile .v { font-size:26px; font-weight:700; }
    .tile .l { font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:.08em; margin-top:4px; }
    svg { display:block; margin:8px 0 24px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
    th { color:var(--dim); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
    tr.user-row { cursor:pointer; }
    tr.user-row:hover { background:#161212; }
    .anon { color:var(--dim); font-style:italic; }
    .drilldown td { background:#0f0c0c; font-size:12px; color:var(--dim); }
  </style>
</head>
<body>
  <h1>SmoothAF · Operator Dashboard</h1>

  <div id="gate">
    <input id="pw" type="password" placeholder="Admin password" autocomplete="current-password">
    <button id="unlock">Unlock</button>
    <div id="gate-err" class="err"></div>
  </div>

  <div id="dash" class="hidden">
    <div id="tiles" class="tiles"></div>
    <svg id="installs" width="100%" height="80" viewBox="0 0 600 80" preserveAspectRatio="none"></svg>
    <table>
      <thead>
        <tr><th>User</th><th>Drives</th><th>Avg</th><th>Miles</th><th>First seen</th><th>Last seen</th></tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div id="dash-err" class="err"></div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const PW_KEY = 'saf_admin_pw';
    const fmtDate = (ms) => ms == null ? '—' : new Date(ms).toLocaleDateString();
    const shortId = (id) => id.slice(0, 8);

    async function call(view, extra = {}) {
      const password = sessionStorage.getItem(PW_KEY) || '';
      const res = await fetch('/.netlify/functions/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, view, ...extra }),
      });
      if (res.status === 401) { sessionStorage.removeItem(PW_KEY); showGate('Wrong password.'); throw new Error('unauthorized'); }
      if (!res.ok) throw new Error('request failed (' + res.status + ')');
      return res.json();
    }

    function showGate(msg) {
      $('dash').classList.add('hidden');
      $('gate').classList.remove('hidden');
      $('gate-err').textContent = msg || '';
    }

    function renderTiles(o) {
      const tiles = [
        ['Users', o.totalUsers], ['Devices', o.totalDevices], ['Drives', o.totalDrives],
        ['Avg score', o.avgScore ?? '—'], ['Miles', o.totalMiles],
        ['Active 7d', o.activeUsers7d], ['Active 30d', o.activeUsers30d], ['Returning', o.returningUsers],
      ];
      $('tiles').innerHTML = tiles.map(([l, v]) =>
        `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
    }

    function renderInstalls(byDay) {
      const svg = $('installs');
      if (!byDay.length) { svg.innerHTML = ''; return; }
      const max = Math.max(...byDay.map(d => d.count), 1);
      const w = 600, h = 80, bw = w / byDay.length;
      svg.innerHTML = byDay.map((d, i) => {
        const bh = (d.count / max) * (h - 16);
        return `<rect x="${i * bw + 1}" y="${h - bh}" width="${Math.max(1, bw - 2)}" height="${bh}" fill="#c4a962"></rect>` +
               `<title>${d.day}: ${d.count}</title>`;
      }).join('');
    }

    function renderRows(rows) {
      $('rows').innerHTML = rows.map(r => {
        const who = r.isAnonymous
          ? `<span class="anon">Anonymous · ${shortId(r.deviceId)}</span>`
          : `${r.name || '—'}<br><span class="anon">${r.email || ''}</span>`;
        return `<tr class="user-row" data-device="${r.deviceId}">
          <td>${who}</td><td>${r.driveCount}</td><td>${r.avgScore ?? '—'}</td>
          <td>${r.totalMiles}</td><td>${fmtDate(r.firstSeen)}</td><td>${fmtDate(r.lastSeen)}</td></tr>`;
      }).join('');
      document.querySelectorAll('.user-row').forEach(tr =>
        tr.addEventListener('click', () => toggleDrill(tr)));
    }

    async function toggleDrill(tr) {
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('drilldown')) { next.remove(); return; }
      const data = await call('user', { device_id: tr.dataset.device });
      const list = data.drives.map(d =>
        `${fmtDate(d.start_time)} · score ${d.score ?? '—'} · ${(d.distance_meters / 1609.34).toFixed(1)} mi · ${Math.round((d.duration_ms || 0) / 60000)} min`
      ).join('<br>') || 'No drives.';
      const row = document.createElement('tr');
      row.className = 'drilldown';
      row.innerHTML = `<td colspan="6">${list}</td>`;
      tr.after(row);
    }

    async function load() {
      try {
        const data = await call('overview');
        $('gate').classList.add('hidden');
        $('dash').classList.remove('hidden');
        renderTiles(data.overview);
        renderInstalls(data.overview.installsByDay);
        renderRows(data.users);
      } catch (e) {
        if (e.message !== 'unauthorized') $('dash-err').textContent = e.message;
      }
    }

    $('unlock').addEventListener('click', () => {
      sessionStorage.setItem(PW_KEY, $('pw').value);
      load();
    });
    $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('unlock').click(); });

    if (sessionStorage.getItem(PW_KEY)) load(); else showGate('');
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the build copies it**

Run: `npm run build && test -f dist/admin.html && echo "admin.html copied"`
Expected: build succeeds and prints `admin.html copied`.

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin dashboard page (overview + per-user drill-down)"
```

---

### Task 5: Env documentation + cache bump + final verification

**Files:**
- Create: `.env.example`
- Modify: `src/constants.js` (APP_VERSION bump)
- Modify: `public/sw.js` (CACHE bump)

- [ ] **Step 1: Document required env vars**

Create `.env.example` (names only — never commit real values):

```
# Netlify-stored secrets (set in the Netlify dashboard, not in this file).
# Server-side only — never exposed to the client bundle.
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
RESEND_API_KEY=
RESEND_AUDIENCE_ID=
# Password gating the /admin.html operator dashboard (admin-stats function).
ADMIN_PASSWORD=
```

- [ ] **Step 2: Bump app version**

In `src/constants.js`, change the first line:

```js
export const APP_VERSION = 'v103';
```

(Current value is `v102`. Confirm before editing; if it differs, bump to the next integer above the current value.)

- [ ] **Step 3: Bump service-worker cache**

In `public/sw.js`, change line 5:

```js
const CACHE = 'smoothaf-v103';
```

(Must match the `APP_VERSION` integer used in Step 2.)

- [ ] **Step 4: Final full verification**

Run: `npx vitest run && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add .env.example src/constants.js public/sw.js
git commit -m "chore: document ADMIN_PASSWORD env + bump cache to v103"
```

---

## Post-Implementation

After all tasks: the dashboard is live at `/admin.html` once `ADMIN_PASSWORD`, `SUPABASE_URL`, and `SUPABASE_SERVICE_KEY` are set in Netlify's env store. **The operator must set `ADMIN_PASSWORD` in Netlify before the dashboard will work** — without it the function returns `misconfigured`.

Use `superpowers:finishing-a-development-branch` to wrap up.

## Out of Scope (do not implement here)

- The missing `drivers` leaderboard table.
- Row-level security on the anon-readable `drives` table.
- Install-event tracking distinct from first-drive.
- The in-app driver-facing "takeaways" score-timeline view.
- Pagination beyond 10k rows; per-function rate limiting.
