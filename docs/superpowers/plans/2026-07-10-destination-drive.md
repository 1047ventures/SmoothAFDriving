# Destination Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional "Destination Drive" mode — enter a destination, get a route + baseline ETA locked as a target, then score the drive on two axes: **Effectiveness** (arrived by the ETA?) and **Efficiency** (existing smoothness score).

**Architecture:** Provider-agnostic routing service (`services/routing.js`, Nominatim + OSRM MVP) + a pure `effectivenessScore`/`destinationTier` in `scoring.js`. Destination data flows through `state` → `buildDriveFromState` → `finalizeAndReview`, and is fully optional (no-destination drives are unchanged).

**Tech Stack:** Vanilla JS, Vite, Vitest. Nominatim + OSRM public APIs (MVP), swappable later.

**Reference:** Spec at `docs/superpowers/specs/2026-07-10-destination-drive-design.md`.

**Conventions:** Vitest `include` is `src/**/*.js`. Drive objects are camelCase in memory (`startTime`, `durationMs`, `distanceMeters`, `score`). Set commit author `git config user.email noreply@anthropic.com && git config user.name Claude`.

**Phasing:** Tasks 1–5 (the "brain" + plumbing) are pure/service/data and fully verifiable here — build now. Task 6 (UI) is outlined only and will be detailed in a follow-up plan, because it needs on-device verification.

---

### Task 1: Constants

**Files:** Modify: `src/constants.js`

- [ ] **Step 1: Add the Destination-Drive constants** at the end of the file:

```js
// ── Destination Drive (routing + effectiveness) ───────────────────────────────
export const ROUTING_PROVIDER = 'osm';   // 'osm' (Nominatim+OSRM) | future: 'google' | 'mapbox'
export const NOMINATIM_BASE   = 'https://nominatim.openstreetmap.org';
export const OSRM_BASE        = 'https://router.project-osrm.org';
export const ETA_BUFFER       = 1.2;      // OSRM durations run optimistic (no lights/traffic);
                                          // trends to ~1.0 once a traffic-aware provider is wired in
export const PACE_PENALTY     = 180;      // effectiveness points lost per unit of over-fraction
```

- [ ] **Step 2: Verify** `npm run build` succeeds.
- [ ] **Step 3: Commit**

```bash
git add src/constants.js
git commit -m "feat: add Destination Drive constants"
```

---

### Task 2: Pure scoring — `effectivenessScore` + `destinationTier`

**Files:** Modify: `src/services/scoring.js`; Test: `src/tests/scoring.test.js`

- [ ] **Step 1: Write failing tests** — append to `src/tests/scoring.test.js`:

```js
import { effectivenessScore, destinationTier } from '../services/scoring.js';

describe('effectivenessScore', () => {
  it('is 100 when on time or faster', () => {
    // ETA_BUFFER 1.2 → target = 600*1.2 = 720s
    expect(effectivenessScore(600, 720)).toBe(100); // exactly on (buffered) target
    expect(effectivenessScore(600, 500)).toBe(100); // faster
  });
  it('decays when late (PACE_PENALTY 180)', () => {
    // target = 720; 20% over target = 864s → 100 - 0.2*180 = 64
    expect(effectivenessScore(600, 864)).toBe(64);
    // ~55.6% over → 0
    expect(effectivenessScore(600, 720 * 1.6)).toBe(0);
  });
  it('guards invalid input with null', () => {
    expect(effectivenessScore(0, 500)).toBeNull();
    expect(effectivenessScore(600, 0)).toBeNull();
    expect(effectivenessScore(-1, 500)).toBeNull();
  });
});

describe('destinationTier', () => {
  it('maps the on-time column', () => {
    expect(destinationTier(100, 95)).toBe('S');
    expect(destinationTier(100, 80)).toBe('A');
    expect(destinationTier(100, 70)).toBe('B');
  });
  it('maps the close-late column (65..99)', () => {
    expect(destinationTier(70, 95)).toBe('A');
    expect(destinationTier(70, 80)).toBe('B');
    expect(destinationTier(70, 70)).toBe('C');
  });
  it('maps the late column (<65)', () => {
    expect(destinationTier(40, 95)).toBe('B');
    expect(destinationTier(40, 80)).toBe('C');
    expect(destinationTier(40, 70)).toBe('D');
  });
  it('returns null when either axis is null', () => {
    expect(destinationTier(null, 90)).toBeNull();
    expect(destinationTier(100, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tests/scoring.test.js` — expect FAIL (functions not exported).

- [ ] **Step 3: Implement** — add to `src/services/scoring.js`. First ensure the import line at the top includes the new constants (add them to the existing `constants.js` import):

```js
import { ETA_BUFFER, PACE_PENALTY } from '../constants.js';
```
(If `scoring.js` already imports from `../constants.js`, add `ETA_BUFFER, PACE_PENALTY` to that existing import list instead of adding a second import.)

Then append these two pure functions:

```js
// Effectiveness (0..100): how the actual drive time compares to the locked ETA.
// On time or faster (after the ETA buffer) = 100; lateness decays linearly.
// Returns null for invalid input. Never rewards beating the ETA further — the
// speed/smoothness trade-off is captured by the separate Efficiency score.
export function effectivenessScore(rawEtaSec, actualSec){
  if (!(rawEtaSec > 0) || !(actualSec > 0)) return null;
  const targetSec = rawEtaSec * ETA_BUFFER;
  const overFrac = Math.max(0, (actualSec - targetSec) / targetSec);
  return Math.round(Math.max(0, Math.min(100, 100 - overFrac * PACE_PENALTY)));
}

// Combined shareable tier from the two axes. effectiveness/efficiency are 0..100.
export function destinationTier(effectiveness, efficiency){
  if (effectiveness == null || efficiency == null) return null;
  const timeBand = effectiveness >= 100 ? 0 : effectiveness >= 65 ? 1 : 2; // on-time / close / late
  const effBand  = efficiency   >= 90  ? 0 : efficiency   >= 75 ? 1 : 2;   // high / mid / low smoothness
  const GRID = [
    ['S', 'A', 'B'], // efficiency >= 90
    ['A', 'B', 'C'], // 75..89
    ['B', 'C', 'D'], // < 75
  ];
  return GRID[effBand][timeBand];
}
```

- [ ] **Step 4: Run** `npx vitest run src/tests/scoring.test.js` — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add src/services/scoring.js src/tests/scoring.test.js
git commit -m "feat: effectivenessScore + destinationTier (two-axis scoring)"
```

---

### Task 3: Routing service — `geocode` + `fetchRoute`

**Files:** Create: `src/services/routing.js`; Test: `src/tests/routing.test.js`

Note: `geocode` returns an **array** of up to 5 matches (the UI shows a picker) — this supersedes the single-result wording in the spec.

- [ ] **Step 1: Write failing tests** — create `src/tests/routing.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocode, fetchRoute } from '../services/routing.js';

afterEach(() => { vi.restoreAllMocks(); });

function mockFetch(payload, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, json: async () => payload,
  });
}

describe('geocode', () => {
  it('builds a Nominatim URL and parses results', async () => {
    const spy = mockFetch([
      { display_name: '1 Main St, Town', lat: '40.1', lon: '-74.2' },
      { display_name: '1 Main St, Other', lat: '41.0', lon: '-75.0' },
    ]);
    const out = await geocode('1 Main St');
    expect(spy.mock.calls[0][0]).toContain('nominatim.openstreetmap.org/search');
    expect(spy.mock.calls[0][0]).toContain('q=1%20Main%20St');
    expect(out).toEqual([
      { label: '1 Main St, Town', lat: 40.1, lng: -74.2 },
      { label: '1 Main St, Other', lat: 41.0, lng: -75.0 },
    ]);
  });
  it('returns null for blank query, empty results, or errors', async () => {
    expect(await geocode('')).toBeNull();
    mockFetch([]);
    expect(await geocode('nowhere')).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    expect(await geocode('boom')).toBeNull();
  });
});

describe('fetchRoute', () => {
  it('builds an OSRM URL (lng,lat order) and parses the route', async () => {
    const spy = mockFetch({
      routes: [{
        distance: 5000, duration: 600,
        geometry: { coordinates: [[-74.2, 40.1], [-74.3, 40.2]] },
      }],
    });
    const out = await fetchRoute({ lat: 40.1, lng: -74.2 }, { lat: 40.2, lng: -74.3 });
    expect(spy.mock.calls[0][0]).toContain('/route/v1/driving/-74.2,40.1;-74.3,40.2');
    expect(out).toEqual({
      distanceM: 5000,
      durationSec: 600,
      geometry: [[40.1, -74.2], [40.2, -74.3]], // flipped to [lat,lng]
    });
  });
  it('returns null when no route or on error', async () => {
    mockFetch({ routes: [] });
    expect(await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    expect(await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tests/routing.test.js` — expect FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/services/routing.js`:

```js
// Provider-agnostic routing. The rest of the app calls only geocode()/fetchRoute();
// swapping to Google/Mapbox (traffic-aware) touches only this file.
//
// MVP backends are the free public Nominatim + OSRM demo servers. These are
// best-effort and rate-limited (Nominatim: <=1 req/sec, no keystroke autocomplete)
// — fine for prototyping/personal use, NOT production scale. Before launch, move
// to a paid or self-hosted provider. Browsers cannot set a User-Agent header, so
// we rely on the default UA/Referer (accepted by Nominatim at low volume).
import { NOMINATIM_BASE, OSRM_BASE } from '../constants.js';

// query -> [{ label, lat, lng }] (up to 5) | null
export async function geocode(query){
  if (!query || !query.trim()) return null;
  try {
    const url = `${NOMINATIM_BASE}/search?format=jsonv2&limit=5&q=${encodeURIComponent(query.trim())}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map(r => ({ label: r.display_name, lat: +r.lat, lng: +r.lon }));
  } catch {
    return null;
  }
}

// from/to are { lat, lng } -> { distanceM, durationSec, geometry:[[lat,lng]] } | null
export async function fetchRoute(from, to){
  try {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data && data.routes && data.routes[0];
    if (!route) return null;
    return {
      distanceM: route.distance,
      durationSec: route.duration,
      geometry: (route.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run** `npx vitest run src/tests/routing.test.js` — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add src/services/routing.js src/tests/routing.test.js
git commit -m "feat: provider-agnostic routing service (geocode + route)"
```

---

### Task 4: Plumb destination through the drive lifecycle

**Files:** Modify: `src/state.js`, `src/services/drive.js`

Destination is captured into `state` at drive start (by the UI, Task 6), carried into the drive object, and turned into `effectiveness` at finalize.

- [ ] **Step 1: Add destination fields to state** — in `src/state.js`, add to the `state` object initializer and to `resetState()` (match the file's existing style). Add:

```js
destination: null,     // { label, lat, lng }
targetEtaSec: null,    // raw OSRM duration, locked at drive start
routeDistanceM: null,
routeGeometry: null,   // [[lat,lng], ...] for the review map
```
Ensure `resetState()` sets all four back to `null`.

- [ ] **Step 2: Carry them into the drive object** — in `src/services/drive.js`, `buildDriveFromState()`, add these to the returned object (after `settingsSnapshot`):

```js
    destination:    state.destination || null,
    targetEtaSec:   state.targetEtaSec || null,
    routeDistanceM: state.routeDistanceM || null,
    routeGeometry:  state.routeGeometry || null,
```

- [ ] **Step 3: Compute effectiveness at finalize** — in `finalizeAndReview()`, after `drive.dims = analysis.dims;` add:

```js
  // Destination Drive: score arrival time vs the locked ETA (null if no destination)
  drive.effectiveness = drive.targetEtaSec
    ? effectivenessScore(drive.targetEtaSec, Math.round(drive.durationMs / 1000))
    : null;
```
And add `effectivenessScore` to the existing `import { scoreFromEvents, analyzeDrive } from './scoring.js';` line:
```js
import { scoreFromEvents, analyzeDrive, effectivenessScore } from './scoring.js';
```

- [ ] **Step 4: Persist across crash-recovery** — in `persistActiveDrive()` (the `localStorage.setItem(ACTIVE_DRIVE_KEY, JSON.stringify({...}))` payload), include the destination fields so a recovered drive keeps its target:

```js
      destination:    state.destination || null,
      targetEtaSec:   state.targetEtaSec || null,
      routeDistanceM: state.routeDistanceM || null,
```
(`routeGeometry` may be large; it is intentionally NOT included in the recovery snapshot.) In `checkRecoveredDrive()`, copy `destination`/`targetEtaSec`/`routeDistanceM` from `saved` onto the recovered drive object, and set `effectiveness` via `effectivenessScore(saved.targetEtaSec, Math.round((saved.durationMs||0)/1000))` when `saved.targetEtaSec` is present, else `null`.

- [ ] **Step 5: Verify** `npx vitest run && npm run build` — all pass. (No behavior change for no-destination drives: all new fields default to `null`.)
- [ ] **Step 6: Commit**

```bash
git add src/state.js src/services/drive.js
git commit -m "feat: carry destination + target ETA through drive lifecycle"
```

---

### Task 5: Cloud upload fields + Supabase migration note

**Files:** Modify: `src/services/supabase.js`; Create: `docs/supabase-destination-drive-migration.sql`

- [ ] **Step 1: Include new fields in the drive upload** — in `src/services/supabase.js`, find where the drive row is built for insert (the object mapping drive → Supabase columns) and add, only when present:

```js
    dest_label:      drive.destination?.label ?? null,
    dest_lat:        drive.destination?.lat ?? null,
    dest_lng:        drive.destination?.lng ?? null,
    route_distance_m: drive.routeDistanceM ?? null,
    target_eta_sec:  drive.targetEtaSec ?? null,
    effectiveness:   drive.effectiveness ?? null,
```
(Match the existing snake_case column mapping style in that file. Do NOT send `routeGeometry` — local-only.)

- [ ] **Step 2: Write the migration doc** — create `docs/supabase-destination-drive-migration.sql`:

```sql
-- Destination Drive: additive, nullable columns on public.drives.
-- Safe to run on the live table; existing rows/writes are unaffected.
alter table public.drives add column if not exists dest_label       text;
alter table public.drives add column if not exists dest_lat         float8;
alter table public.drives add column if not exists dest_lng         float8;
alter table public.drives add column if not exists route_distance_m float8;
alter table public.drives add column if not exists target_eta_sec   int;
alter table public.drives add column if not exists effectiveness    int;
```

- [ ] **Step 3: Verify** `npx vitest run && npm run build` pass.
- [ ] **Step 4: Commit**

```bash
git add src/services/supabase.js docs/supabase-destination-drive-migration.sql
git commit -m "feat: upload Destination Drive fields; add Supabase migration"
```

**Operator step (manual, after merge):** run `docs/supabase-destination-drive-migration.sql` in the Supabase SQL editor before the fields will persist to the cloud. Until then, uploads silently drop unknown columns or error per PostgREST config — verify after running the migration.

---

### Task 6: UI (OUTLINE ONLY — detailed in a follow-up plan, needs on-device verification)

Not to be implemented from this plan. Captured here so the shape is agreed:

- **`src/ui/destination.js` (new):** destination search sheet — text input, geocode **on submit** (debounced, not per keystroke), results list (up to 5), select → set `state.destination` + call `fetchRoute` and lock `state.targetEtaSec`/`routeDistanceM`/`routeGeometry`; clear control; failure → non-blocking notice, drive proceeds normally.
- **`src/ui/record.js`:** compact pace strip when a target exists — locked target time + approximate ahead/behind estimate (straight-line-distance based; labeled as estimate). No route line, no turn-by-turn.
- **`src/ui/review.js`:** two hero numbers (Effectiveness with on-time/late delta + Efficiency) + `destinationTier` badge; draw `routeGeometry` as a dashed planned-route line under the actual GPS track. No-destination drives render exactly as today.
- **`index.html` + `src/styles/*.css`:** markup + styles for the above (edit existing per-screen CSS blocks, do not append new bottom blocks).

A follow-up plan will specify these with exact markup/code once we can iterate on device.

---

## Self-Review Checklist (run after implementing 1–5)
- No-destination drives are byte-for-byte unchanged in behavior (all new fields `null`).
- `effectivenessScore` / `destinationTier` are pure and match the spec tables.
- `routing.js` never throws to callers (always resolves value-or-null); the drive never blocks on routing.
- New Supabase fields are additive/nullable; `routeGeometry` is never uploaded.

## Out of Scope
Traffic-aware ETA provider swap; route-adherence; destination leaderboards; turn-by-turn navigation. (See spec §9.)
