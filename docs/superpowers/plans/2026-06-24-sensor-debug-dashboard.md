# Sensor Debug Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON drive export button to the review screen and a slide-up live sensor chart panel to the record screen.

**Architecture:** The export is a pure client-side Blob download triggered from `review.js`. The live chart is an HTML5 canvas in a new `src/ui/debug.js` module; `record.js` feeds it data on its existing 200ms tick. Both features are independent — either can be reverted without affecting the other.

**Tech Stack:** Vanilla JS, HTML5 Canvas, CSS transform animations, Blob/URL.createObjectURL

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `index.html` | Modify | Add export button in review top bar; add debug panel + handle HTML inside record screen |
| `src/ui/debug.js` | **Create** | Rolling buffers, canvas chart rendering — no DOM side-effects beyond drawing to the canvas |
| `src/ui/record.js` | Modify | Import debug module; call `pushDebugSample` + `renderDebugChart` in `updateLiveUI`; wire handle tap |
| `src/ui/review.js` | Modify | Add `buildExportData(drive, analysis)` + `exportDrive(drive, analysis)`; wire export button |
| `src/styles/record.css` | Modify | Slide-up panel, drag handle, canvas sizing |
| `src/styles/review.css` | Modify | Export button (reuses `.back-btn`, add right-side positioning) |
| `src/tests/debug.test.js` | **Create** | Unit tests for buffer rolling and `buildExportData` shape |

---

## Task 1: `buildExportData` — pure export serialiser + tests

**Files:**
- Modify: `src/ui/review.js`
- Create: `src/tests/debug.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/tests/debug.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

// Stub localStorage before any imports
vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
});

const { buildExportData } = await import('../ui/review.js');

const DRIVE = {
  startTime: 1750000000000,
  score: 87,
  distanceMeters: 3862,
  durationMs: 420000,
  topSpeedMps: 13.4,
  events: [
    { type: 'brake', tier: 2, severity: 1.4, t: 1750000060000,
      lat: 39.74, lon: -104.99, speedMph: 18, roadRoughness: 0.3 },
  ],
  samples: [
    { t: 1750000000000, lat: 39.74, lon: -104.99, speed: 8.2, heading: 92,
      longAccel: 0.1, latAccel: -0.05, jerk: 0.02, harshness: 0.11, roadRoughness: 0.18 },
  ],
};

const ANALYSIS = {
  score: 87,
  dims: { peakHarshness: 91, throttle: 88, steering: 94, braking: 85,
          cornering: 90, transitions: 87, momentum: 83 },
};

describe('buildExportData', () => {
  it('produces the correct top-level keys', () => {
    const data = buildExportData(DRIVE, ANALYSIS);
    expect(Object.keys(data)).toEqual(['meta', 'dims', 'events', 'samples']);
  });

  it('meta has required fields', () => {
    const { meta } = buildExportData(DRIVE, ANALYSIS);
    expect(meta.score).toBe(87);
    expect(meta.durationSecs).toBe(420);
    expect(meta.distanceMiles).toBeCloseTo(2.4, 0);
    expect(typeof meta.exportedAt).toBe('number');
    expect(typeof meta.appVersion).toBe('string');
  });

  it('dims are passed through from analysis', () => {
    const { dims } = buildExportData(DRIVE, ANALYSIS);
    expect(dims.peakHarshness).toBe(91);
    expect(dims.momentum).toBe(83);
  });

  it('events are passed through unchanged', () => {
    const { events } = buildExportData(DRIVE, ANALYSIS);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('brake');
    expect(events[0].tier).toBe(2);
  });

  it('samples contain only the specified fields', () => {
    const { samples } = buildExportData(DRIVE, ANALYSIS);
    expect(samples).toHaveLength(1);
    const s = samples[0];
    expect(Object.keys(s).sort()).toEqual(
      ['harshness','heading','jerk','latAccel','lon','longAccel','lat','roadRoughness','speed','t'].sort()
    );
  });

  it('handles null analysis gracefully', () => {
    const data = buildExportData(DRIVE, null);
    expect(data.dims).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- src/tests/debug.test.js
```

Expected: FAIL — `buildExportData is not a function`

- [ ] **Step 3: Add `buildExportData` to `src/ui/review.js`**

Add these imports at the top of `src/ui/review.js` (after existing imports):

```js
import { APP_VERSION } from '../constants.js';
import { metersToMiles } from '../utils/math.js';
```

> Note: `metersToMiles` is already imported on line 4. `APP_VERSION` needs to be added to the import from `'../constants.js'` — change line 6:
> ```js
> import { DIM_DISPLAY, APP_VERSION } from '../constants.js';
> ```

Add this function near the bottom of `src/ui/review.js`, before the closing `export { mapInstance }`:

```js
export function buildExportData(drive, analysis) {
  const when = new Date(drive.startTime);
  const pad = n => String(n).padStart(2, '0');
  return {
    meta: {
      exportedAt:    Date.now(),
      appVersion:    APP_VERSION,
      score:         drive.score,
      distanceMiles: parseFloat(metersToMiles(drive.distanceMeters || 0).toFixed(2)),
      durationSecs:  Math.round((drive.durationMs || 0) / 1000),
      startTime:     drive.startTime,
    },
    dims:    analysis ? analysis.dims : null,
    events:  drive.events || [],
    samples: (drive.samples || []).map(s => ({
      t:             s.t,
      lat:           s.lat,
      lon:           s.lon,
      speed:         s.speed,
      heading:       s.heading,
      longAccel:     s.longAccel,
      latAccel:      s.latAccel,
      jerk:          s.jerk,
      harshness:     s.harshness,
      roadRoughness: s.roadRoughness,
    })),
  };
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- src/tests/debug.test.js
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/review.js src/tests/debug.test.js
git commit -m "feat: add buildExportData serialiser + tests"
```

---

## Task 2: Export button — HTML, CSS, wire-up

**Files:**
- Modify: `index.html` (review top bar)
- Modify: `src/styles/review.css`
- Modify: `src/ui/review.js`

- [ ] **Step 1: Add export button to `index.html`**

Find the `.review-top` div (around line 272):
```html
    <div class="review-top">
      <button id="btn-back" class="back-btn" aria-label="Back">×</button>
    </div>
```

Replace with:
```html
    <div class="review-top">
      <button id="btn-back" class="back-btn" aria-label="Back">×</button>
      <button id="rv-export-btn" class="back-btn rv-export-btn" aria-label="Export drive data" title="Export JSON">↓</button>
    </div>
```

- [ ] **Step 2: Style the export button in `src/styles/review.css`**

Add after the `.back-btn` rule (around line 28):

```css
  .rv-export-btn{font-size:16px;font-weight:700}
```

- [ ] **Step 3: Add `exportDrive` function to `src/ui/review.js`**

Add after `buildExportData`:

```js
export function exportDrive(drive, analysis) {
  const data  = buildExportData(drive, analysis);
  const when  = new Date(drive.startTime);
  const pad   = n => String(n).padStart(2, '0');
  const fname = `smoothaf-${when.getFullYear()}-${pad(when.getMonth()+1)}-${pad(when.getDate())}-${pad(when.getHours())}-${pad(when.getMinutes())}.json`;
  const blob  = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
```

- [ ] **Step 4: Wire the button inside `renderReview`**

In `src/ui/review.js`, find `renderReview(drive)`. After `reviewAnalysis = analysis;` (around line 21), add:

```js
  const exportBtn = document.getElementById('rv-export-btn');
  if (exportBtn) {
    exportBtn.onclick = () => exportDrive(drive, analysis);
  }
```

- [ ] **Step 5: Build and manually verify**

```bash
npm run build
```

Open the app, complete or replay a drive, go to the review screen. Tap the ↓ button — a `.json` file should download. Open it and confirm it has `meta`, `dims`, `events`, `samples` keys.

- [ ] **Step 6: Commit**

```bash
git add index.html src/styles/review.css src/ui/review.js
git commit -m "feat: add JSON drive export button to review screen"
```

---

## Task 3: `debug.js` — rolling buffer + canvas chart

**Files:**
- Create: `src/ui/debug.js`
- Modify: `src/tests/debug.test.js` (add buffer tests)

- [ ] **Step 1: Write buffer tests**

Append to `src/tests/debug.test.js`:

```js
const { pushDebugSample, getDebugBuffers, clearDebugBuffers } = await import('../ui/debug.js');

describe('pushDebugSample', () => {
  beforeEach(() => clearDebugBuffers());

  it('appends one data point per push', () => {
    pushDebugSample({ emaLongAccel: 1, emaLatAccel: -0.5, currentRoughness: 0.2, lastGpsPos: { speed: 8 } });
    const bufs = getDebugBuffers();
    expect(bufs.long).toHaveLength(1);
    expect(bufs.long[0]).toBeCloseTo(1);
    expect(bufs.lat[0]).toBeCloseTo(-0.5);
    expect(bufs.roughness[0]).toBeCloseTo(0.2);
    expect(bufs.speed[0]).toBeCloseTo(0.8); // speed / 10
  });

  it('caps all buffers at 300 points', () => {
    for (let i = 0; i < 310; i++) {
      pushDebugSample({ emaLongAccel: i, emaLatAccel: 0, currentRoughness: 0, lastGpsPos: { speed: 0 } });
    }
    const bufs = getDebugBuffers();
    expect(bufs.long.length).toBe(300);
    expect(bufs.long[bufs.long.length - 1]).toBeCloseTo(309); // newest is last
  });

  it('handles null lastGpsPos gracefully', () => {
    pushDebugSample({ emaLongAccel: 0, emaLatAccel: 0, currentRoughness: 0, lastGpsPos: null });
    expect(getDebugBuffers().speed[0]).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- src/tests/debug.test.js
```

Expected: FAIL — `pushDebugSample is not a function`

- [ ] **Step 3: Create `src/ui/debug.js`**

```js
const MAX_POINTS = 300;

const bufs = { long: [], lat: [], roughness: [], speed: [] };

export function clearDebugBuffers() {
  bufs.long      = [];
  bufs.lat       = [];
  bufs.roughness = [];
  bufs.speed     = [];
}

export function getDebugBuffers() {
  return bufs;
}

export function pushDebugSample(state) {
  const spd = state.lastGpsPos ? (state.lastGpsPos.speed || 0) : 0;
  bufs.long.push(state.emaLongAccel || 0);
  bufs.lat.push(state.emaLatAccel   || 0);
  bufs.roughness.push(state.currentRoughness || 0);
  bufs.speed.push(spd / 10); // scale to m/s² range for co-plotting
  if (bufs.long.length > MAX_POINTS) {
    bufs.long.shift();
    bufs.lat.shift();
    bufs.roughness.shift();
    bufs.speed.shift();
  }
}

const STREAMS = [
  { key: 'long',      color: '#E8501A', label: 'Long' },
  { key: 'lat',       color: '#4A9EE8', label: 'Lat'  },
  { key: 'roughness', color: '#C49A28', label: 'Rgh'  },
  { key: 'speed',     color: '#5DBF7A', label: 'Spd÷10' },
];

const Y_RANGE = 6; // ±6 m/s²

export function renderDebugChart(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = 'rgba(10,8,8,0.92)';
  ctx.fillRect(0, 0, W, H);

  // Zero line
  const midY = H / 2;
  ctx.strokeStyle = 'rgba(244,235,217,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(W, midY);
  ctx.stroke();

  const pts = bufs.long.length;
  if (pts < 2) return;

  STREAMS.forEach(({ key, color }) => {
    const data = bufs[key];
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (MAX_POINTS - 1)) * W;
      const y = midY - (v / Y_RANGE) * midY;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

export function updateDebugLegend(legendEl) {
  if (!legendEl) return;
  legendEl.innerHTML = STREAMS.map(({ key, color, label }) => {
    const val = bufs[key].length ? bufs[key][bufs[key].length - 1].toFixed(2) : '—';
    return `<span style="color:${color}">${label} <b>${val}</b></span>`;
  }).join('');
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/tests/debug.test.js
```

Expected: all buffer tests PASS (chart rendering tests are skipped — canvas requires a browser)

- [ ] **Step 5: Commit**

```bash
git add src/ui/debug.js src/tests/debug.test.js
git commit -m "feat: debug chart module — rolling buffers + canvas renderer"
```

---

## Task 4: Debug panel — HTML + CSS

**Files:**
- Modify: `index.html`
- Modify: `src/styles/record.css`

- [ ] **Step 1: Add panel HTML inside `#screen-record` in `index.html`**

Find `<button id="btn-stop" class="stop-btn">End Drive</button>` (near line 248). Insert the following immediately **before** that line:

```html
    <!-- Debug sensor chart panel -->
    <div id="debug-handle" class="debug-handle" aria-label="Toggle sensor chart"></div>
    <div id="debug-panel" class="debug-panel">
      <div id="debug-legend" class="debug-legend"></div>
      <canvas id="debug-canvas" class="debug-canvas"></canvas>
    </div>
```

- [ ] **Step 2: Add panel CSS to `src/styles/record.css`**

Append at the end of `src/styles/record.css`:

```css
  /* ── Debug sensor chart panel ── */
  .debug-handle{
    position:absolute;left:50%;transform:translateX(-50%);
    bottom:72px;width:36px;height:4px;border-radius:2px;
    background:rgba(244,235,217,.22);cursor:pointer;z-index:40;
    transition:background .15s;
  }
  .debug-handle:active{background:rgba(244,235,217,.5)}
  .debug-panel{
    position:absolute;left:0;right:0;bottom:0;
    height:45%;
    background:rgba(10,8,8,.93);
    border-top:1px solid rgba(244,235,217,.1);
    display:flex;flex-direction:column;
    padding:10px 12px calc(env(safe-area-inset-bottom,0)+8px);
    transform:translateY(100%);
    transition:transform .28s cubic-bezier(.4,0,.2,1);
    z-index:38;
    pointer-events:none;
  }
  .debug-panel.open{transform:translateY(0);pointer-events:auto}
  .debug-legend{
    display:flex;gap:14px;flex-shrink:0;margin-bottom:6px;
    font-family:var(--sans);font-size:10px;letter-spacing:.04em;
  }
  .debug-legend b{font-weight:700}
  .debug-canvas{flex:1;min-height:0;width:100%;border-radius:6px}
```

- [ ] **Step 3: Build and visually check structure**

```bash
npm run build
```

Open app, start a drive. The debug handle bar (small pill) should be visible just above the End Drive button. The panel should not be visible yet (hidden below the screen edge).

- [ ] **Step 4: Commit**

```bash
git add index.html src/styles/record.css
git commit -m "feat: debug panel HTML and CSS (hidden until wired)"
```

---

## Task 5: Wire debug panel into `record.js`

**Files:**
- Modify: `src/ui/record.js`

- [ ] **Step 1: Add imports at top of `src/ui/record.js`**

After the existing imports (around line 14), add:

```js
import { pushDebugSample, renderDebugChart, updateDebugLegend, clearDebugBuffers } from './debug.js';
```

- [ ] **Step 2: Wire panel open/close**

In `src/ui/record.js`, add this function before `startRecording`:

```js
function wireDebugPanel() {
  const handle = document.getElementById('debug-handle');
  const panel  = document.getElementById('debug-panel');
  if (!handle || !panel) return;
  handle.addEventListener('click', () => panel.classList.toggle('open'));
}
```

- [ ] **Step 3: Call `wireDebugPanel` and `clearDebugBuffers` in `startRecording`**

In `startRecording()`, after `showScreen('record');` (around line 214), add:

```js
  clearDebugBuffers();
  wireDebugPanel();
```

- [ ] **Step 4: Feed data on every tick in `updateLiveUI`**

In `updateLiveUI()`, add these two lines at the very end, after `updateRoadUI()` (around line 205):

```js
  pushDebugSample(state);
  renderDebugChart(document.getElementById('debug-canvas'));
  updateDebugLegend(document.getElementById('debug-legend'));
```

- [ ] **Step 5: Build**

```bash
npm run build
```

- [ ] **Step 6: Manual end-to-end test**

1. Open the app, start a drive (or the demo drive)
2. The small handle pill is visible above End Drive
3. Tap the handle → panel slides up, canvas fills with 4 colored lines scrolling in real time
4. Legend row shows `Long`, `Lat`, `Rgh`, `Spd÷10` with live values
5. Tap handle again → panel slides back down
6. End drive → review screen shows ↓ export button
7. Tap ↓ → `.json` file downloads with correct filename

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass (102+ tests)

- [ ] **Step 8: Bump version and commit**

In `src/constants.js`, change `APP_VERSION = 'v99'` → `'v100'`.
In `public/sw.js`, change `CACHE = 'smoothaf-v99'` → `'smoothaf-v100'`.

```bash
git add src/ui/record.js src/constants.js public/sw.js
git commit -m "v100: live sensor chart panel + JSON drive export"
```

---

## Self-Review

**Spec coverage check:**
- ✅ JSON export button on review screen — Task 2
- ✅ File named `smoothaf-YYYY-MM-DD-HH-MM.json` — Task 2 `exportDrive`
- ✅ Export contains meta, dims, events, samples — Task 1 `buildExportData`
- ✅ Slide-up panel on record screen — Tasks 3, 4, 5
- ✅ Drag handle trigger — Task 4 HTML, Task 5 wiring
- ✅ 4 colored streams (orange/blue/gold/green) — Task 3 `STREAMS` constant
- ✅ 60-second rolling window at 200ms = 300 points — Task 3 `MAX_POINTS`
- ✅ Legend with live values — Task 3 `updateDebugLegend`
- ✅ Updates on existing 200ms tick — Task 5 `updateLiveUI`

**Placeholder scan:** No TBDs, all code complete.

**Type consistency:** `pushDebugSample(state)` signature matches usage in record.js. `buildExportData(drive, analysis)` signature matches `exportDrive` and the test drive fixture. `clearDebugBuffers` / `getDebugBuffers` / `renderDebugChart` / `updateDebugLegend` all exported from `debug.js` and imported in record.js and tests.
