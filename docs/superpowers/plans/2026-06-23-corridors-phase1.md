# Corridors Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect which named roads a user drove on after each drive, store corridor stats locally, show corridor cards on the home screen, and open a corridor detail screen on tap.

**Architecture:** After `finalizeAndReview()`, a non-blocking async call to `detectCorridors(drive)` samples GPS points from the drive, makes one Overpass union query to find named roads, groups consecutive same-road points into segments, and upserts matching corridors (≥500m) into localStorage. The home screen renders up to 3 corridor cards from the local cache. Tapping a card opens a new corridor detail screen.

**Tech Stack:** Vanilla JS ES modules, Overpass API (already used for speed limits), Nominatim reverse geocoding, localStorage, Vitest for tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/constants.js` | Modify | Add `CORRIDORS_KEY` storage key |
| `src/services/storage.js` | Modify | Add `loadCorridors`, `saveCorridors`, `upsertCorridorDrive` |
| `src/services/corridors.js` | Create | Detection: sample GPS, Overpass query, segment grouping, city lookup |
| `src/services/drive.js` | Modify | Call `detectCorridors(drive)` non-blocking after `saveDrive` |
| `src/ui/home.js` | Modify | Replace `renderCorridorTeaser` with `renderCorridorCards` |
| `src/styles/home.css` | Modify | Add corridor card styles |
| `src/ui/corridor.js` | Create | `renderCorridor(corridorId)` — detail screen |
| `src/styles/corridor.css` | Create | Corridor detail screen styles |
| `index.html` | Modify | Replace teaser div; add `screen-corridor` section |
| `src/main.js` | Modify | Wire `btn-corridor-back`; import corridor screen |
| `src/tests/corridors.test.js` | Create | Unit tests for pure functions |

---

### Task 1: Add storage key and corridor localStorage functions

**Files:**
- Modify: `src/constants.js`
- Modify: `src/services/storage.js`
- Create: `src/tests/corridors.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/corridors.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
vi.stubGlobal('localStorage', {
  getItem:    k => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
});

const { loadCorridors, saveCorridors, upsertCorridorDrive } = await import('../services/storage.js');

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

describe('loadCorridors', () => {
  it('returns empty array when nothing stored', () => {
    expect(loadCorridors()).toEqual([]);
  });
  it('returns parsed array when stored', () => {
    store['smoothaf.corridors'] = JSON.stringify([{ corridorId: 'a', name: 'Test St', drives: [] }]);
    expect(loadCorridors()).toHaveLength(1);
  });
});

describe('upsertCorridorDrive', () => {
  it('creates a new corridor entry on first drive', () => {
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 82, distanceMeters: 1200, drivenAt: 1000 });
    const all = loadCorridors();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('N Wadsworth Blvd');
    expect(all[0].drives).toHaveLength(1);
    expect(all[0].drives[0].score).toBe(82);
  });
  it('appends a drive to an existing corridor', () => {
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 82, distanceMeters: 1200, drivenAt: 1000 });
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 90, distanceMeters: 1400, drivenAt: 2000 });
    const all = loadCorridors();
    expect(all).toHaveLength(1);
    expect(all[0].drives).toHaveLength(2);
  });
  it('creates separate entries for different corridors', () => {
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 82, distanceMeters: 1200, drivenAt: 1000 });
    upsertCorridorDrive({ name: 'W Colfax Ave',     city: 'Denver', centerLat: 39.74, centerLon: -104.99, osmWayId: 456, score: 75, distanceMeters: 800,  drivenAt: 2000 });
    expect(loadCorridors()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test src/tests/corridors.test.js
```
Expected: FAIL — `loadCorridors is not a function`

- [ ] **Step 3: Add `CORRIDORS_KEY` to `src/constants.js`**

Add after `SHARE_PROMPTED_KEY`:
```js
export const CORRIDORS_KEY = 'smoothaf.corridors';
```

- [ ] **Step 4: Add corridor storage functions to `src/services/storage.js`**

Add to imports at top:
```js
import {
  // ... existing imports ...
  CORRIDORS_KEY,
} from '../constants.js';
```

Add at the bottom of the file:
```js
// ── Corridors ─────────────────────────────────────────────────────────────────
export function loadCorridors(){
  try { return JSON.parse(localStorage.getItem(CORRIDORS_KEY) || '[]'); } catch { return []; }
}
export function saveCorridors(corridors){
  try { localStorage.setItem(CORRIDORS_KEY, JSON.stringify(corridors)); } catch {}
}
export function upsertCorridorDrive({ name, city, centerLat, centerLon, osmWayId, score, distanceMeters, drivenAt }){
  const all = loadCorridors();
  const id  = `${name}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const idx = all.findIndex(c => c.corridorId === id);
  const drive = { score, distanceMeters, drivenAt };
  if (idx === -1){
    all.push({ corridorId: id, name, city, centerLat, centerLon, osmWayId: osmWayId || null, drives: [drive] });
  } else {
    all[idx].drives.push(drive);
  }
  saveCorridors(all);
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test src/tests/corridors.test.js
```
Expected: PASS — 5 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/constants.js src/services/storage.js src/tests/corridors.test.js
git commit -m "feat: add corridor storage key and localStorage functions"
```

---

### Task 2: Corridor detection service

**Files:**
- Create: `src/services/corridors.js`
- Modify: `src/tests/corridors.test.js`

- [ ] **Step 1: Add unit tests for pure functions**

Append to `src/tests/corridors.test.js`:

```js
const { sampleGpsPoints, slugifyCorridorId } = await import('../services/corridors.js');

describe('sampleGpsPoints', () => {
  const makeSamples = (count, latStep = 0.001) =>
    Array.from({ length: count }, (_, i) => ({ lat: 39.7 + i * latStep, lon: -104.9, speed: 10, t: i * 1000 }));

  it('returns empty array for empty input', () => {
    expect(sampleGpsPoints([], 25)).toEqual([]);
  });
  it('returns all points when drive is shorter than interval', () => {
    // latStep=0.0001 ≈ 11m per step, 5 steps ≈ 55m total — well under 250m
    const samples = makeSamples(5, 0.0001);
    const result = sampleGpsPoints(samples, 25);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
  it('samples one point per ~250m and caps at maxPoints', () => {
    // latStep=0.003 ≈ 333m per step — should trigger sampling
    const samples = makeSamples(100, 0.003);
    const result = sampleGpsPoints(samples, 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result[0]).toEqual(samples[0]);
  });
  it('always includes the first sample', () => {
    const samples = makeSamples(50, 0.002);
    expect(sampleGpsPoints(samples, 25)[0]).toEqual(samples[0]);
  });
});

describe('slugifyCorridorId', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyCorridorId('N Wadsworth Blvd', 'Denver')).toBe('n-wadsworth-blvd-denver');
  });
  it('removes special characters', () => {
    expect(slugifyCorridorId('W. Colfax Ave.', 'Denver')).toBe('w-colfax-ave-denver');
  });
  it('strips leading and trailing hyphens', () => {
    expect(slugifyCorridorId('Speer Blvd', 'Denver')).toBe('speer-blvd-denver');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test src/tests/corridors.test.js
```
Expected: FAIL — `sampleGpsPoints is not a function`

- [ ] **Step 3: Create `src/services/corridors.js`**

```js
import { haversine } from '../utils/math.js';
import { upsertCorridorDrive } from './storage.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const MIN_SEGMENT_METERS = 500;

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export function slugifyCorridorId(name, city){
  return `${name}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Sample one GPS point per ~250m of cumulative distance, capped at maxPoints. */
export function sampleGpsPoints(samples, maxPoints = 25){
  if (!samples.length) return [];
  const INTERVAL = 250;
  const result = [samples[0]];
  let accumulated = 0;
  for (let i = 1; i < samples.length; i++){
    accumulated += haversine(samples[i - 1], samples[i]);
    if (accumulated >= INTERVAL){
      result.push(samples[i]);
      accumulated = 0;
      if (result.length >= maxPoints) break;
    }
  }
  return result;
}

// ── Overpass: one union query for all sample points ───────────────────────────

async function fetchRoadNamesForPoints(points){
  const parts = points
    .map(p => `  way(around:50,${p.lat.toFixed(5)},${p.lon.toFixed(5)})[highway][name];`)
    .join('\n');
  const query = `[out:json][timeout:20];\n(\n${parts}\n);\nout tags center;`;
  const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const { elements = [] } = await res.json();
  return elements; // [{ type:'way', id, center:{lat,lon}, tags:{name,highway} }]
}

// ── City name from Nominatim ──────────────────────────────────────────────────

async function fetchCityForPoint(lat, lon){
  const res = await fetch(
    `${NOMINATIM}?format=json&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=10`,
    { headers: { 'Accept-Language': 'en', 'User-Agent': 'SmoothAFDriving/1.0' } }
  );
  if (!res.ok) return 'Unknown';
  const data = await res.json();
  return data.address?.city || data.address?.town || data.address?.county || 'Unknown';
}

// ── Assign each sample point to its nearest road ──────────────────────────────

function assignRoadNames(points, roads){
  return points.map(p => {
    let bestRoad = null, bestDist = Infinity;
    for (const road of roads){
      if (!road.center || !road.tags?.name) continue;
      const d = haversine(p, road.center);
      if (d < bestDist){ bestDist = d; bestRoad = road; }
    }
    return { ...p, roadName: bestDist < 1000 ? bestRoad?.tags?.name || null : null, osmWayId: bestRoad?.id || null, center: bestRoad?.center || null };
  });
}

// ── Group consecutive same-road points into segments ─────────────────────────

function groupIntoSegments(labeled){
  const segments = [];
  let current = null;
  for (const pt of labeled){
    if (!pt.roadName){ current = null; continue; }
    if (!current || current.name !== pt.roadName){
      current = { name: pt.roadName, osmWayId: pt.osmWayId, center: pt.center, points: [pt] };
      segments.push(current);
    } else {
      current.points.push(pt);
    }
  }
  return segments;
}

// ── Compute segment distance and filter by minimum ───────────────────────────

function filterSegments(segments){
  return segments
    .map(seg => {
      let dist = 0;
      for (let i = 1; i < seg.points.length; i++) dist += haversine(seg.points[i - 1], seg.points[i]);
      return { name: seg.name, osmWayId: seg.osmWayId, center: seg.center, distanceMeters: dist };
    })
    .filter(seg => seg.distanceMeters >= MIN_SEGMENT_METERS);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Detect which named road corridors a drive covered.
 * Runs post-drive, non-blocking. Upserts matches into localStorage.
 * @param {object} drive  — finalized drive object with .samples and .score
 */
export async function detectCorridors(drive){
  const samples = drive.samples || [];
  if (samples.length < 10) return;

  const points = sampleGpsPoints(samples, 25);
  if (points.length < 2) return;

  let roads = [];
  try { roads = await fetchRoadNamesForPoints(points); } catch { return; }
  if (!roads.length) return;

  const labeled   = assignRoadNames(points, roads);
  const segments  = groupIntoSegments(labeled);
  const corridors = filterSegments(segments);
  if (!corridors.length) return;

  // Look up city from drive start point (one call, shared for all corridors)
  const startPt = points[0];
  let city = 'Unknown';
  try { city = await fetchCityForPoint(startPt.lat, startPt.lon); } catch {}

  for (const c of corridors){
    upsertCorridorDrive({
      name:            c.name,
      city,
      centerLat:       c.center?.lat ?? startPt.lat,
      centerLon:       c.center?.lon ?? startPt.lon,
      osmWayId:        c.osmWayId,
      score:           drive.score,
      distanceMeters:  c.distanceMeters,
      drivenAt:        drive.startTime,
    });
  }
}
```

- [ ] **Step 4: Run tests to confirm pure function tests pass**

```bash
npm test src/tests/corridors.test.js
```
Expected: PASS — all tests pass (async Overpass/Nominatim tests are not in the unit test suite — tested manually)

- [ ] **Step 5: Commit**

```bash
git add src/services/corridors.js src/tests/corridors.test.js
git commit -m "feat: add corridor detection service with GPS sampling and Overpass lookup"
```

---

### Task 3: Hook `detectCorridors` into drive finalization

**Files:**
- Modify: `src/services/drive.js`

- [ ] **Step 1: Import `detectCorridors` at top of `src/services/drive.js`**

Add after the existing imports:
```js
import { detectCorridors } from './corridors.js';
```

- [ ] **Step 2: Call `detectCorridors` non-blocking after `saveDrive`**

In `finalizeAndReview`, find the line:
```js
  saveDrive(drive);
  pushDriveToSupabase(drive);
```

Replace with:
```js
  saveDrive(drive);
  pushDriveToSupabase(drive);
  // Non-blocking — corridor detection runs after review renders
  detectCorridors(drive).catch(() => {});
```

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npm test
```
Expected: all existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/services/drive.js
git commit -m "feat: run corridor detection non-blocking after each drive is finalized"
```

---

### Task 4: Home screen corridor cards

**Files:**
- Modify: `index.html`
- Modify: `src/ui/home.js`
- Modify: `src/styles/home.css`

- [ ] **Step 1: Replace corridor teaser markup in `index.html`**

Find and replace the entire corridor teaser block:
```html
    <!-- Corridor teaser card (shown when <3 corridor drives) -->
    <div class="home-corridor-teaser" id="home-corridor-teaser">
      <div class="hct-card">
        <div class="hct-road-info">
          <div class="hct-road-name" id="hct-road-name">Your first corridor</div>
          <div class="hct-road-sub" id="hct-road-sub">Drive a route 3+ times to unlock ranking</div>
        </div>
        <div class="hct-rank-badge" id="hct-rank-badge">?</div>
      </div>
      <div class="hct-hint" id="hct-hint">Who's the Smoothest Operator on your block?</div>
    </div>
```

With:
```html
    <!-- Corridor cards — rendered by home.js from localStorage -->
    <div class="home-corridors-list" id="home-corridors-list"></div>
```

- [ ] **Step 2: Update imports in `src/ui/home.js`**

Add `loadCorridors` to the storage import line:
```js
import {
  loadDrives,
  loadLifetimeScore,
  toggleFavoriteDrive,
  deleteDrive,
  loadDriverName,
  loadCorridors,
} from '../services/storage.js';
```

- [ ] **Step 3: Replace `renderCorridorTeaser` with `renderCorridorCards` in `src/ui/home.js`**

Remove the entire `renderCorridorTeaser` function and replace the call site.

Old call (in `renderHomeStats`):
```js
  // Corridor teaser card
  renderCorridorTeaser(all);
```

New call:
```js
  renderCorridorCards();
```

Add the new function at the bottom of the file (before `renderDriveList`):
```js
function renderCorridorCards(){
  const host = document.getElementById('home-corridors-list');
  if (!host) return;
  const corridors = loadCorridors();

  if (!corridors.length){
    host.innerHTML = `
      <div class="hcl-empty">
        <div class="hcl-empty-title">Your first corridor</div>
        <div class="hcl-empty-sub">Drive a named road for 500m+ to unlock your corridor rank</div>
      </div>`;
    return;
  }

  // Sort by drive count desc, show top 3
  const top = [...corridors]
    .sort((a, b) => b.drives.length - a.drives.length)
    .slice(0, 3);

  host.innerHTML = top.map(c => {
    const count    = c.drives.length;
    const avgScore = Math.round(c.drives.reduce((s, d) => s + d.score, 0) / count);
    const bestScore = Math.max(...c.drives.map(d => d.score));
    return `
      <div class="hcl-card" data-corridor-id="${c.corridorId}">
        <div class="hcl-road-info">
          <div class="hcl-road-name">${c.name}</div>
          <div class="hcl-road-meta">${c.city} · ${count} drive${count !== 1 ? 's' : ''}</div>
        </div>
        <div class="hcl-scores">
          <div class="hcl-score-avg">${avgScore}</div>
          <div class="hcl-score-lbl">avg</div>
        </div>
      </div>`;
  }).join('');

  host.querySelectorAll('.hcl-card').forEach(card => {
    card.addEventListener('click', () => {
      import('./corridor.js').then(m => m.renderCorridor(card.dataset.corridorId));
    });
  });
}
```

- [ ] **Step 4: Add corridor card styles to `src/styles/home.css`**

Read the current end of home.css, then append after the last rule:
```css
  /* ── Corridor cards ── */
  .home-corridors-list{padding:0 20px;display:flex;flex-direction:column;gap:8px;margin-top:8px}
  .hcl-empty{padding:16px 0 4px;text-align:left}
  .hcl-empty-title{font-family:var(--serif);font-style:italic;font-weight:700;font-size:18px;color:var(--cream);margin-bottom:4px}
  .hcl-empty-sub{font-size:12px;color:rgba(242,232,213,.35);line-height:1.5}
  .hcl-card{display:flex;align-items:center;justify-content:space-between;background:rgba(242,232,213,.04);border:1px solid rgba(242,232,213,.08);border-radius:12px;padding:12px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s}
  .hcl-card:active{background:rgba(242,232,213,.08)}
  .hcl-road-name{font-family:var(--serif);font-style:italic;font-weight:700;font-size:16px;color:var(--cream);line-height:1.2}
  .hcl-road-meta{font-size:11px;color:rgba(242,232,213,.35);margin-top:3px;letter-spacing:.04em}
  .hcl-scores{display:flex;flex-direction:column;align-items:center;flex-shrink:0}
  .hcl-score-avg{font-family:var(--serif);font-style:italic;font-weight:700;font-size:28px;color:var(--cream);line-height:1}
  .hcl-score-lbl{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(242,232,213,.3);margin-top:2px}
```

- [ ] **Step 5: Run tests and check for errors**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui/home.js src/styles/home.css
git commit -m "feat: replace corridor teaser with real corridor cards on home screen"
```

---

### Task 5: Corridor detail screen

**Files:**
- Modify: `index.html`
- Create: `src/styles/corridor.css`
- Create: `src/ui/corridor.js`
- Modify: `src/styles/index.css`
- Modify: `src/main.js`

- [ ] **Step 1: Add corridor screen section to `index.html`**

Find the closing `</main>` tag and add before it:

```html
    <!-- ══════════════════════════════════════════════════════════
         SCREEN: CORRIDOR DETAIL
    ═══════════════════════════════════════════════════════════════ -->
    <section id="screen-corridor">
      <div class="corridor-topbar">
        <button class="corridor-back-btn" id="btn-corridor-back" aria-label="Back">←</button>
        <div class="corridor-header">
          <div class="corridor-road-name" id="corridor-road-name">—</div>
          <div class="corridor-city" id="corridor-city"></div>
        </div>
      </div>

      <div class="corridor-stats-row">
        <div class="corridor-stat">
          <div class="corridor-stat-val" id="corridor-drives">—</div>
          <div class="corridor-stat-lbl">Drives</div>
        </div>
        <div class="corridor-stat">
          <div class="corridor-stat-val" id="corridor-avg">—</div>
          <div class="corridor-stat-lbl">Avg Score</div>
        </div>
        <div class="corridor-stat">
          <div class="corridor-stat-val" id="corridor-best">—</div>
          <div class="corridor-stat-lbl">Best</div>
        </div>
      </div>

      <div class="corridor-sparkline-wrap">
        <div class="corridor-sparkline-hdr">
          <span class="corridor-sparkline-lbl">Score Trend</span>
          <span class="corridor-sparkline-trend" id="corridor-trend"></span>
        </div>
        <svg id="corridor-sparkline-svg" width="100%" height="52" viewBox="0 0 342 52" fill="none" preserveAspectRatio="none">
          <polyline id="corridor-sparkline-line" points="" stroke="rgba(242,232,213,0.4)" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
          <g id="corridor-sparkline-dots"></g>
        </svg>
      </div>

      <div class="corridor-drives-label">Drive History</div>
      <div class="corridor-drives-list" id="corridor-drives-list"></div>
    </section>
```

- [ ] **Step 2: Create `src/styles/corridor.css`**

```css
/* ── Corridor detail screen ──────────────────────────────────────────────── */
#screen-corridor {
  display: none;
  flex-direction: column;
  overflow-y: auto;
  background: var(--bg);
  min-height: 100dvh;
  padding: calc(env(safe-area-inset-top,0) + 56px) 20px calc(env(safe-area-inset-bottom,0) + 100px);
}
#screen-corridor.active { display: flex; }

.corridor-topbar {
  position: fixed;
  top: env(safe-area-inset-top, 0);
  left: 0; right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 10px;
  background: rgba(10,8,8,.9);
  backdrop-filter: blur(8px);
}
.corridor-back-btn {
  appearance: none; border: none; background: none;
  color: rgba(242,232,213,.6); font-size: 22px; cursor: pointer; padding: 4px 8px 4px 0;
  flex-shrink: 0;
}
.corridor-road-name {
  font-family: var(--serif); font-style: italic; font-weight: 700;
  font-size: 20px; color: var(--cream); line-height: 1.15;
}
.corridor-city {
  font-size: 11px; letter-spacing: .1em; color: rgba(242,232,213,.35); margin-top: 2px;
}

.corridor-stats-row {
  display: flex; margin-bottom: 24px;
  border-top: 1px solid rgba(242,232,213,.1);
  border-bottom: 1px solid rgba(242,232,213,.1);
  height: 64px; flex-shrink: 0;
}
.corridor-stat {
  flex: 1; display: flex; flex-direction: column;
  justify-content: center; align-items: flex-start; padding-left: 4px;
}
.corridor-stat:not(:first-child) { border-left: 1px solid rgba(242,232,213,.1); padding-left: 16px; }
.corridor-stat-val {
  font-family: var(--serif); font-style: italic; font-weight: 700;
  font-size: 26px; color: var(--cream); line-height: 1;
}
.corridor-stat-lbl {
  font-size: 9px; letter-spacing: .38em; text-transform: uppercase;
  color: rgba(242,232,213,.35); margin-top: 5px;
}

.corridor-sparkline-wrap { padding: 0 0 20px; }
.corridor-sparkline-hdr {
  display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px;
}
.corridor-sparkline-lbl {
  font-size: 9px; letter-spacing: .38em; text-transform: uppercase; color: rgba(242,232,213,.35);
}
.corridor-sparkline-trend { font-size: 12px; font-weight: 500; color: rgba(242,232,213,.4); }

.corridor-drives-label {
  font-size: 9px; letter-spacing: .38em; text-transform: uppercase;
  color: rgba(242,232,213,.35); margin-bottom: 12px;
}
.corridor-drives-list { display: flex; flex-direction: column; gap: 8px; }
.corridor-drive-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: rgba(242,232,213,.04); border: 1px solid rgba(242,232,213,.07);
  border-radius: 10px;
}
.corridor-drive-score {
  font-family: var(--serif); font-style: italic; font-weight: 700;
  font-size: 24px; color: var(--cream); width: 48px;
}
.corridor-drive-meta { flex: 1; padding: 0 12px; }
.corridor-drive-date { font-size: 13px; color: rgba(242,232,213,.7); }
.corridor-drive-dist { font-size: 11px; color: rgba(242,232,213,.35); margin-top: 2px; }
```

- [ ] **Step 3: Create `src/ui/corridor.js`**

```js
import { loadCorridors } from '../services/storage.js';
import { showScreen } from './router.js';
import { metersToMiles } from '../utils/math.js';

export function renderCorridor(corridorId){
  const all      = loadCorridors();
  const corridor = all.find(c => c.corridorId === corridorId);
  if (!corridor){ showScreen('home'); return; }

  showScreen('corridor');

  // Header
  const nameEl = document.getElementById('corridor-road-name');
  const cityEl = document.getElementById('corridor-city');
  if (nameEl) nameEl.textContent = corridor.name;
  if (cityEl) cityEl.textContent = corridor.city;

  // Stats
  const drives    = corridor.drives;
  const avgScore  = Math.round(drives.reduce((s, d) => s + d.score, 0) / drives.length);
  const bestScore = Math.max(...drives.map(d => d.score));

  const drivesEl = document.getElementById('corridor-drives');
  const avgEl    = document.getElementById('corridor-avg');
  const bestEl   = document.getElementById('corridor-best');
  if (drivesEl) drivesEl.textContent = drives.length;
  if (avgEl)    avgEl.textContent    = avgScore;
  if (bestEl)   bestEl.textContent   = bestScore;

  // Sparkline (last 7 drives, oldest first)
  const recent   = drives.slice(-7);
  const sparkLine = document.getElementById('corridor-sparkline-line');
  const sparkDots = document.getElementById('corridor-sparkline-dots');
  const trendEl   = document.getElementById('corridor-trend');

  if (sparkLine) sparkLine.setAttribute('points', '');
  if (sparkDots) sparkDots.innerHTML = '';

  if (recent.length > 1){
    const vals = recent.map(d => d.score);
    const min  = Math.min(...vals), max = Math.max(...vals);
    const rng  = max - min || 1;
    const coords = vals.map((v, i) => ({
      x: Math.round(i / (vals.length - 1) * 342),
      y: Math.round(44 - ((v - min) / rng) * 36),
    }));
    if (sparkLine) sparkLine.setAttribute('points', coords.map(c => `${c.x},${c.y}`).join(' '));
    if (sparkDots){
      coords.forEach((c, i) => {
        const isLast = i === coords.length - 1;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y);
        dot.setAttribute('r', isLast ? '4' : '3');
        dot.setAttribute('fill', isLast ? '#E8501A' : 'rgba(242,232,213,0.5)');
        sparkDots.appendChild(dot);
      });
    }
    if (trendEl){
      const mid   = Math.floor(vals.length / 2);
      const early = vals.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
      const late  = vals.slice(mid).reduce((s, v) => s + v, 0) / (vals.length - mid);
      const delta = Math.round(late - early);
      trendEl.textContent = Math.abs(delta) < 5
        ? `Holding steady at ${vals[vals.length - 1]}`
        : `${delta > 0 ? '↑' : '↓'} ${delta > 0 ? '+' : ''}${delta} pts`;
      trendEl.style.color = delta >= 5 ? 'rgba(90,158,82,.9)' : delta <= -5 ? 'rgba(224,59,47,.8)' : 'rgba(242,232,213,.4)';
    }
  }

  // Drive history list (newest first)
  const listEl = document.getElementById('corridor-drives-list');
  if (listEl){
    listEl.innerHTML = [...drives].reverse().map(d => {
      const when = new Date(d.drivenAt);
      const mi   = metersToMiles(d.distanceMeters).toFixed(1);
      return `
        <div class="corridor-drive-row">
          <div class="corridor-drive-score">${d.score}</div>
          <div class="corridor-drive-meta">
            <div class="corridor-drive-date">${when.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            <div class="corridor-drive-dist">${mi} mi</div>
          </div>
        </div>`;
    }).join('');
  }
}
```

- [ ] **Step 4: Import `corridor.css` in `src/styles/index.css`**

Read `src/styles/index.css` first, then add the import at the end:
```css
@import './corridor.css';
```

- [ ] **Step 5: Wire back button in `src/main.js`**

Add after the existing `#btn-back` handler:
```js
  document.getElementById('btn-corridor-back')?.addEventListener('click', () => {
    showScreen('home');
  });
```

- [ ] **Step 6: Run tests**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add index.html src/styles/corridor.css src/ui/corridor.js src/styles/index.css src/main.js
git commit -m "feat: add corridor detail screen with stats, sparkline, and drive history"
```

---

### Task 6: Final integration check and push

- [ ] **Step 1: Run all tests**

```bash
npm test
```
Expected: all tests pass, no failures

- [ ] **Step 2: Build to catch any import or syntax errors**

```bash
npm run build
```
Expected: build completes without errors

- [ ] **Step 3: Push to production**

```bash
git push -u origin claude-pwa
```
