# Sensor Debug Dashboard — Design Spec

**Date:** 2026-06-24
**Branch:** `claude-pwa`

## Overview

Two complementary tools for understanding algorithm behavior:

1. **JSON Drive Export** — downloads full drive data as a `.json` file from the review screen for offline analysis
2. **Live Sensor Chart** — slide-up panel on the record screen showing real-time scrolling multi-stream chart

---

## Part 1: JSON Drive Export

### Goal
After a drive, export everything the algorithm saw as a single downloadable file. The user drags it into a chat or notebook for analysis.

### File format

Filename: `smoothaf-YYYY-MM-DD-HH-MM.json`

```json
{
  "meta": {
    "exportedAt": 1750000000000,
    "appVersion": "v99",
    "score": 87,
    "distanceMiles": 2.4,
    "durationSecs": 420,
    "startTime": 1749999580000,
    "vehicle": { "id": "suv", "make": "BMW", "model": "X3" }
  },
  "dims": {
    "peakHarshness": 91,
    "throttle": 88,
    "steering": 94,
    "braking": 85,
    "cornering": 90,
    "transitions": 87,
    "momentum": 83
  },
  "events": [
    { "type": "brake", "tier": 2, "severity": 1.4, "t": 1749999600000,
      "lat": 39.7392, "lon": -104.9903, "speedMph": 18, "roadRoughness": 0.3 }
  ],
  "samples": [
    { "t": 1749999580000, "lat": 39.7391, "lon": -104.9901,
      "speed": 8.2, "heading": 92, "longAccel": 0.1, "latAccel": -0.05,
      "jerk": 0.02, "harshness": 0.11, "roadRoughness": 0.18 }
  ]
}
```

### UI placement
A download icon button added to the review screen top bar, to the right of the existing close button. Tapping it generates a Blob URL and programmatically clicks a hidden `<a download>` element. No server involved — pure client-side.

### Files changed
- `index.html` — add `<button id="rv-export-btn">` in review top bar; add hidden `<a id="rv-export-link">`
- `src/ui/review.js` — `exportDrive(drive)` function: serializes drive + dims + events + samples → Blob → download
- `src/styles/review.css` — style the export button (matches existing close button style)

---

## Part 2: Live Sensor Chart Panel

### Goal
During recording, surface a slide-up panel showing the last 60 seconds of sensor streams as a scrolling chart. Developer-facing but always accessible — one swipe from the normal record UI.

### Trigger
A 36px drag handle bar sits at the bottom edge of `#screen-record` at all times (above the stop button). Tap or swipe up → panel animates up to cover bottom 45% of screen. Swipe down or tap handle again → dismisses.

### Chart

Rendered on an HTML5 `<canvas>` element. Updates every 200ms on the same tick as `updateLiveUI`. Maintains a rolling 300-point buffer (~60 seconds at 200ms intervals) per stream.

**Four streams:**

| Stream | Color | Value | Unit |
|---|---|---|---|
| Longitudinal accel | `#E8501A` (orange) | `state.emaLongAccel` | m/s² |
| Lateral accel | `#4A9EE8` (blue) | `state.emaLatAccel` | m/s² |
| Road roughness | `#C49A28` (gold) | `state.currentRoughness` | m/s² RMS |
| Speed | `#5DBF7A` (green) | `state.lastGpsPos.speed` scaled ÷ 10 | scaled |

Zero line drawn across vertical center. Y-axis range: ±6 m/s² (hard-coded; streams clip at edges). Each stream label + current value shown in a legend row above the chart.

### Layout

```
┌─────────────────────────────┐  ← record screen top (radar, score)
│                             │
│   [normal record UI]        │
│                             │
├─────────────────────────────┤  ← drag handle (always visible)
│  ╔═════════════════════════╗│  ← panel (slides up)
│  ║  legend: LA  LatA  Rgh  ║│
│  ║  [scrolling canvas]     ║│
│  ║                         ║│
│  ╚═════════════════════════╝│
└─────────────────────────────┘
```

Panel sits above the stop button. Stop button remains tappable when panel is open.

### Files changed
- `index.html` — add `#debug-panel` div with canvas + legend; add `#debug-handle` bar
- `src/ui/debug.js` (new) — `initDebugChart()`, `pushDebugSample(state)`, `renderDebugChart(canvas)`
- `src/ui/record.js` — call `pushDebugSample(state)` + `renderDebugChart()` in the 200ms tick; wire handle tap/swipe
- `src/styles/record.css` — panel slide-up animation, handle styles, canvas sizing

---

## Implementation order

1. JSON export (simpler, self-contained, immediately useful)
2. Debug panel HTML + CSS (structure before logic)
3. `debug.js` chart logic (buffer management + canvas rendering)
4. Wire chart into record tick

## Non-goals

- No server, no WebSocket streaming
- No replay/scrub of historical samples within the panel (post-ride analysis is what the JSON export is for)
- No user-facing settings toggle for the panel (dev tool, always available via the handle)
- No 60Hz raw motion buffer in the export (GPS-rate samples only — keeps file size small)
