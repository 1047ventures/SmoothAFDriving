# Analytics Dashboard Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A private, password-gated operator dashboard that shows who is using SmoothAF Driving and how — overview metrics plus a per-user drill-down — built on the data already flowing into Supabase.

**Architecture:** A single Netlify function (`admin-stats`) authenticates a password against an env var, then uses the service-role key to read the `users` and `drives` tables and returns aggregated JSON. All aggregation math lives in a pure, unit-tested module (`_lib/adminStats.mjs`). A static `admin.html` page renders the result. The service key never leaves the function; `admin.html` ships publicly but is inert without the password.

**Tech Stack:** Netlify Functions (ESM `.mjs`), Supabase REST, vanilla HTML/JS, Vitest for the pure aggregators.

---

## 1. Existing Backend (context)

Two Supabase tables already receive data:

- **`drives`** — written client-side with the public anon key. Columns used here: `device_id`, `start_time` (ms epoch), `duration_ms`, `distance_meters`, `top_speed_mps`, `score`, `event_count`, `simulated`. Anon-readable.
- **`users`** — written server-side by `netlify/functions/register-user.js` with the service-role key on onboarding. Columns: `device_id` (key), `name`, `email`, `updated_at`. **Not** anon-readable (holds email).

Join key between the two is `device_id`. The dashboard is the only place these are joined, and the join must happen server-side because it exposes email.

The leaderboard `drivers` table referenced by `supabase.js` does **not** exist and is out of scope here (tracked separately).

---

## 2. Access Model

Single shared password, checked server-side.

- New env var **`ADMIN_PASSWORD`** (set in Netlify's encrypted env store, alongside `SUPABASE_SERVICE_KEY`).
- Every request to `admin-stats` includes `{ password }` in the POST body.
- The function compares with a **constant-time** check (see §6) and, on mismatch, waits a fixed delay then returns `401`.
- `admin.html` prompts for the password once, caches it in `sessionStorage`, and sends it with each request. On `401` it clears the cached value and re-prompts.

The password is never stored in the repo, the client bundle, or `admin.html`.

---

## 3. Function: `netlify/functions/admin-stats.mjs`

Thin handler. Responsibilities only: method/auth checks, Supabase fetch, delegate math, return JSON.

```
POST /.netlify/functions/admin-stats
body: { password: string, view: 'overview' | 'user', device_id?: string }
```

Behavior:

1. Reject non-POST with `405`.
2. Parse JSON body; malformed → `400`.
3. If `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `ADMIN_PASSWORD` missing → log + `500 { ok:false, error:'misconfigured' }`.
4. Validate `password` (constant-time). Fail → fixed 500ms delay → `401 { ok:false, error:'unauthorized' }`.
5. Fetch with the service key (headers: `apikey` + `Authorization: Bearer` = service key):
   - `view:'overview'` → fetch all `users` (`device_id,name,email,updated_at`) and all `drives` (`device_id,start_time,duration_ms,distance_meters,score,event_count,simulated`). Call `computeOverview(users, drives, nowMs)` and `computeUserRows(users, drives)`. Return `{ ok:true, overview, users }`.
   - `view:'user'` → require `device_id`; fetch that device's drives ordered by `start_time` desc; return `{ ok:true, drives }` (raw per-drive rows, simulated excluded).
6. Any Supabase error → log + `500 { ok:false, error:'db_error' }`.

`nowMs` is read from `Date.now()` **inside the handler** and passed into the pure functions (keeps the math deterministic/testable).

Supabase row caps: request up to 10000 rows (`?limit=10000`) — far above current volume; if ever exceeded, that's a future pagination task (note it in a code comment, don't silently truncate).

---

## 4. Pure Module: `netlify/functions/_lib/adminStats.mjs`

No I/O, no `Date.now()` (time passed in). Exports:

### `computeOverview(users, drives, nowMs) → object`

Excludes `simulated` drives from all drive-derived metrics. Returns:

| Field | Definition |
|---|---|
| `totalUsers` | count of `users` rows |
| `totalDevices` | count of distinct `device_id` across non-simulated drives |
| `totalDrives` | count of non-simulated drives |
| `avgScore` | mean `score` over non-simulated drives, rounded; `null` if none |
| `totalMiles` | sum of `distance_meters` / 1609.34, rounded to 1 dp |
| `activeUsers7d` | distinct devices with ≥1 non-simulated drive where `start_time >= nowMs - 7*864e5` |
| `activeUsers30d` | same, 30-day window |
| `returningUsers` | distinct devices with non-simulated drives on ≥2 distinct UTC calendar days |
| `installsByDay` | array of `{ day:'YYYY-MM-DD', count }` — bucket each device by its **first-seen** day (min `start_time`), sorted ascending |

### `computeUserRows(users, drives) → array`

One row per device that appears in `users` **or** in non-simulated `drives` (outer join). Sorted by `lastSeen` desc. Each row:

| Field | Definition |
|---|---|
| `deviceId` | the device_id |
| `name` | from `users`, else `null` |
| `email` | from `users`, else `null` |
| `isAnonymous` | `true` when no matching `users` row |
| `driveCount` | non-simulated drives for this device |
| `firstSeen` | min `start_time`, or `null` if no drives |
| `lastSeen` | max `start_time`, or `users.updated_at` epoch if no drives |
| `avgScore` | mean score over this device's non-simulated drives, rounded; `null` if none |
| `totalMiles` | sum of distance for this device, 1 dp |

A device with a `users` row but zero drives still appears (driveCount 0, scores null) — that's an install that never recorded.

---

## 5. Page: `public/admin.html`

Self-contained static page (no build step; lives in `public/` so Vite copies it to `dist/`). Served at `/admin.html`.

Layout:

1. **Password prompt** — shown when no cached password or after a `401`. Single password input + "Unlock". On submit, fires an `overview` request.
2. **Overview band** — metric tiles for the `computeOverview` fields, plus a minimal inline-SVG bar sketch of `installsByDay` (no chart library — hand-rolled `<rect>`s).
3. **Users table** — columns: name/email (or "Anonymous · `<short device id>`"), drives, avg score, first seen, last seen, total miles. Sorted by last seen. Clicking a row calls `view:'user'` and expands an inline list of that device's drives (date, score, miles, duration).

Styling: inline `<style>`, dark theme consistent with the app's palette (cream on near-black). No external assets. Dates rendered in the operator's locale from the epoch values.

Network errors and non-200s surface a small inline error line; `401` resets to the password prompt.

---

## 6. Security

- Service-role key read only from `process.env.SUPABASE_SERVICE_KEY` inside the function. Never sent to the client, never in `admin.html`.
- Email is returned **only** after the password check passes — it is the point of the per-user view, but it never reaches the client otherwise.
- Constant-time password comparison: compare SHA-256 digests of the supplied and expected passwords with `crypto.timingSafeEqual` (Node `crypto`, available in Netlify functions). Hashing first makes the compared buffers equal-length regardless of input.
- Fixed delay (~500ms) on auth failure to blunt brute-forcing. (Netlify has no per-function rate limit out of the box; the delay + a strong password is the v1 mitigation. A real rate limiter is a future task.)
- The anon-readability of `drives` (full GPS tracks) is a pre-existing concern and is **not** addressed here — flagged separately for an RLS pass.

---

## 7. Files

| File | Action | Responsibility |
|---|---|---|
| `netlify/functions/admin-stats.mjs` | Create | Auth + Supabase fetch + delegate to pure module |
| `netlify/functions/_lib/adminStats.mjs` | Create | `computeOverview`, `computeUserRows` (pure) |
| `public/admin.html` | Create | Password gate + overview + per-user drill-down UI |
| `src/tests/adminStats.test.js` | Create | Unit tests for the pure aggregators |
| `netlify.toml` | Verify | Confirm functions dir resolves `admin-stats`; no secrets added to file |
| `.env.example` (if present) / README | Modify | Document `ADMIN_PASSWORD` (name only, never a value) |

No existing source files change behavior; this is additive.

---

## 8. Testing

`src/tests/adminStats.test.js` imports the pure module and covers, against a fixed fixture of users + drives + a known `nowMs`:

- `computeOverview`: exact `totalUsers`, `totalDevices`, `totalDrives`, `avgScore`, `totalMiles`.
- Simulated drives are excluded from every metric.
- `activeUsers7d` / `activeUsers30d` at window boundaries (a drive just inside vs just outside each window relative to `nowMs`).
- `returningUsers`: a device with two drives on the same UTC day counts as 0; on two different days counts as 1.
- `installsByDay`: a device is bucketed by its earliest drive day only; buckets sorted ascending; counts correct when multiple devices first-seen on the same day.
- `computeUserRows`: correct join — a device in `drives` but not `users` is `isAnonymous:true` with `name`/`email` null; a `users` row with zero drives appears with `driveCount:0` and null scores; `avgScore`/`totalMiles`/`firstSeen`/`lastSeen` correct; rows sorted by `lastSeen` desc.

The handler (`admin-stats.mjs`) is not unit-tested (thin I/O glue); its logic is exercised through the pure module.

---

## 9. Out of Scope

- The missing `drivers` leaderboard table (separate fix).
- Row-level security / locking down anon read of `drives` (separate privacy pass).
- Install-event tracking distinct from first-drive (v1 derives installs from first drive; a dedicated ping is a later add).
- The in-app driver-facing "takeaways" score-timeline view (separate product track).
- Pagination beyond 10k rows; per-function rate limiting (noted, deferred).
- Cloud sync / multi-admin auth (single shared password is intentional for v1).
