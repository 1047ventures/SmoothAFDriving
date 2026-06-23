# Algorithm Improvements: OSM Speed Limits + Gyroscope + Four-Tier Events

**Date:** 2026-06-23  
**Branch:** `claude/step-1-avg-speed-iyJ30`

## Overview

Three focused augmentations to the sensor pipeline. No new files — 4 existing files touched. Each improvement is independent; any one can be reverted without affecting the others.

---

## 1. OSM Speed-Limit Context

### Goal
Detection thresholds currently scale with actual driving speed — faster driving = looser thresholds. This is backwards on residential streets. Posted speed limit caps the effective speed used for threshold scaling, so driving 50mph in a 25mph zone gets city-tight thresholds, not highway-loose ones.

### Cache design

Stored in localStorage under key `OSM_SPEED_CACHE` as a flat object:

```json
{
  "37.421_-122.084": { "limitMps": 13.4, "ts": 1750000000000 },
  "37.422_-122.085": { "limitMps": 8.9,  "ts": 1750000000000 }
}
```

- Key: lat/lon each rounded to 3 decimal places (~110m grid cell)
- Value: speed limit in m/s + timestamp
- TTL: 30 days (rarely changes; cache builds up so regular routes never hit network)
- Max entries: 500 (LRU eviction by timestamp — drop oldest on overflow)

### Fetch behavior

On each GPS sample:
1. Round lat/lon → compute cache key
2. Cache hit + age < 30 days → use `limitMps`, no network call
3. Cache miss or expired → fire async Overpass fetch; use `state.currentSpeedLimitMps` (last-known) in the meantime
4. Fetch success → parse, cache, update `state.currentSpeedLimitMps`
5. Fetch error / timeout (6s) → silently keep last-known value

Overpass query:
```
[out:json][timeout:6];
way(around:50,{lat},{lon})[highway][maxspeed];
out body;
```

`maxspeed` tag parsing:
- `"30 mph"` → 30 × 0.44704 = 13.4 m/s
- `"50"` (bare number, assumed km/h) → 50 / 3.6 = 13.9 m/s
- `"national"` / `"urban"` / unrecognised → null (fall back to speed-based logic)

### Threshold scaling change

Current (`gps.js`):
```js
const longMult = speed > 22.4 ? 1.35 : speed > 13.4 ? 1.15 : 1.0;
```

New:
```js
const effectiveSpeed = state.currentSpeedLimitMps != null
  ? Math.min(speed, state.currentSpeedLimitMps * 1.1)
  : speed;
const longMult = effectiveSpeed > 22.4 ? 1.35 : effectiveSpeed > 13.4 ? 1.15 : 1.0;
```

The 1.1 factor gives 10% headroom above the posted limit before thresholds tighten — avoids false positives for momentary speed above limit (cresting a hill, GPS jitter).

### State additions

`state.js`:
- `currentSpeedLimitMps: null` — null means no data yet, use fallback

`constants.js`:
- `OSM_SPEED_CACHE` — localStorage key
- `OSM_CACHE_TTL = 30 * 24 * 60 * 60 * 1000` — 30 days in ms
- `OSM_CACHE_MAX = 500` — max entries before LRU eviction

### Files changed
- `constants.js` — new constants
- `storage.js` — `loadOsmCache()`, `saveOsmCache()`, `getOsmLimit(lat, lon)`, `setOsmLimit(lat, lon, limitMps)`
- `sensors/gps.js` — OSM fetch call, `effectiveSpeed` threshold scaling, `state.currentSpeedLimitMps` update

---

## 2. Gyroscope Lateral G

### Goal
Accelerometer-based lateral G is affected by phone mounting angle — any tilt bleeds cornering force across axes. Gyroscope yaw rate is orientation-independent: `yawRate (rad/s) × speed (m/s) = lateral acceleration (m/s²)` from physics, regardless of how the phone is mounted.

### Axis projection

After `calib.done = true`, the calibration system already computed `calib.up` (gravity direction in device frame). Project `rotationRate` onto that axis to extract true yaw:

```js
const toRad = Math.PI / 180;
const [ux, uy, uz] = calib.up;
// rotationRate axes: beta=X, gamma=Y, alpha=Z
const yawRateRads = (ev.rotationRate.beta * ux + ev.rotationRate.gamma * uy + ev.rotationRate.alpha * uz) * toRad;
const lateralMps2 = yawRateRads * currentSpeedMps;
```

Before calibration is complete, fall back to accelerometer lateral unchanged.

### Fallback logic

`calib.gyroAvail` flag (new field, default `null`):
- `null` — not yet tested
- `true` — rotationRate available and non-zero
- `false` — rotationRate null/undefined or has been zero for >2s → use accelerometer fallback

On every motion event:
- If `ev.rotationRate` is null → `calib.gyroAvail = false`
- If all three rotationRate values have been 0 for >2s → `calib.gyroAvail = false`
- First non-zero reading → `calib.gyroAvail = true`

### Road roughness enhancement

`rotationRate.beta` (pitch rate) captures fore-aft rocking over bumps that the vertical accelerometer sometimes misses (especially when phone is upright in mount). Add its high-frequency energy to the existing roughness RMS:

```js
// existing: roughnessBuf pushes vertical accel
// new: also push |rotationRate.beta| scaled to m/s² equivalent
if (calib.gyroAvail) {
  const pitchContrib = Math.abs(ev.rotationRate.beta) * toRad * currentSpeedMps * 0.5;
  state.roughnessBuf.push(pitchContrib);
}
```

The 0.5 weight blends gyro roughness contribution without overpowering the existing accel signal.

### Files changed
- `state.js` — `currentSpeedLimitMps: null` in `state`, `gyroAvail: null` in `calib`; add resets in `resetState()`/`resetCalib()`
- `sensors/motion.js` — gyro availability detection, yaw-rate lateral G when `calib.done && calib.gyroAvail`, pitch roughness contribution

---

## 3. Four-Tier Event Detection

### Goal
Currently a 0.8g brake and a 1.5g brake both score as "tier 3 harsh." Adding tier 4 "extreme" gives the scoring room to penalise genuinely dangerous inputs proportionally.

### New tier table

| Tier | Threshold multiplier | `TIER_MULT` (score penalty) | Label |
|------|---------------------|---------------------------|-------|
| 1    | 0.55×               | 0.14                      | minor |
| 2    | 1.0×                | 1.0                       | notable |
| 3    | 1.75×               | 2.4                       | harsh |
| **4**| **2.6×**            | **4.0**                   | **extreme** |

At default thresholds: tier 4 braking = 2.6 × 4.5 m/s² = **11.7 m/s²** (~1.2g) — genuine emergency-stop territory. One extreme event costs 4× a notable event in the score penalty.

### Detection change

`detectEventWithThresh` in `gps.js` — add tier 4 check before existing tier 3:

```js
// existing
if (absVal > thresh * 1.75) tier = 3;

// becomes
if      (absVal > thresh * 2.6)  tier = 4;
else if (absVal > thresh * 1.75) tier = 3;
```

### Review map

Tier 3 events currently show as red markers. Tier 4 inherits this (no UI change needed now — map already shows tier 3+, tier 4 is a subset). A visual distinction (deeper red, different icon) can be added later.

### Files changed
- `constants.js` — `TIER_MULT[4] = 4.0`; add `TIER_THRESH = { 1: 0.55, 2: 1.0, 3: 1.75, 4: 2.6 }` to replace magic numbers in gps.js
- `sensors/gps.js` — update detection condition; use `TIER_THRESH` constants

---

## Implementation order

1. `constants.js` — all new constants (no logic, zero risk)
2. `sensors/gps.js` tier 4 — isolated condition change, easy to verify with unit tests
3. `storage.js` OSM cache functions — pure localStorage R/W, fully testable
4. `sensors/gps.js` OSM fetch + threshold scaling
5. `sensors/motion.js` gyro integration
6. `state.js` — new state fields + resets

## Tests to add / update

- `sensors.test.js` — tier 4 threshold boundary cases; `effectiveSpeed` capping at `limitMps × 1.1`
- `storage.test.js` — OSM cache get/set, TTL expiry, LRU eviction at 500 entries
- `motion.test.js` (new, or add to sensors.test.js) — gyro availability flag transitions; yaw-rate lateral calculation

## Non-goals (explicitly out of scope)

- UI changes for tier 4 on the review map (later)
- OSM data for road type (motorway vs residential) beyond speed limit
- Gyroscope-based heading estimation
- Absolute orientation / compass integration
