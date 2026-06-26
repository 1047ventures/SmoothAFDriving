# Vehicle Fingerprinting & Auto-Assignment Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically identify which garage vehicle was used for each drive, using a per-vehicle fingerprint profile built from confirmed drives, and surface the result on the review screen with an explicit confirmation/correction UI.

**Architecture:** A new `vehicleDetector.js` service extracts a 6-feature vector from each finalized drive, computes a normalized distance against stored per-vehicle profiles (Welford online mean/variance), and returns the best match with a confidence level. A cold-start speed-bucket heuristic handles new vehicles before 3 confirmed drives exist. The review screen shows the result and collects confirmation, which feeds back into the profile.

**Tech Stack:** Vanilla JS, localStorage, no external dependencies.

---

## 1. Vehicle Types

Expand `VEHICLE_TYPES` in `src/constants.js` from 8 entries to 16 by adding:

| id | label | icon |
|---|---|---|
| `van` | Van | 🚌 |
| `minivan` | Minivan | 🚐 |
| `campervan` | Camper Van | 🏕️ |
| `rv` | RV / Motorhome | 🏠 |
| `motorcycle` | Motorcycle | 🏍️ |
| `scooter` | Scooter | 🛵 |
| `ebike` | E-Bike | ⚡ |
| `bicycle` | Bicycle | 🚲 |

No existing type ids or labels change.

---

## 2. Feature Vector

`extractFeatures(drive)` returns a plain object computed entirely from the finalized drive object — no external calls:

| Feature | Computation |
|---|---|
| `avgSpeedMps` | `drive.distanceMeters / (drive.durationMs / 1000)` |
| `topSpeedMps` | `drive.topSpeedMps` |
| `p95SpeedMps` | 95th-percentile of `drive.samples[i].speed` values |
| `speedVariance` | population variance of `drive.samples[i].speed` values |
| `eventRatePerMin` | `drive.events.length / (drive.durationMs / 60000)` |
| `dimMomentum` | `(drive.dims?.momentum ?? 80) / 100` |

If `drive.samples` is empty, `p95SpeedMps` and `speedVariance` fall back to `topSpeedMps` and `0` respectively.

---

## 3. Cold-Start Heuristic

Used when no garage vehicle has ≥ `MIN_PROFILE_DRIVES` (3) confirmed drives. Returns a `type` id and `'suggestion'` confidence — never auto-assigns.

```
topSpeedMps < 8.9  (20 mph)  → 'bicycle'
topSpeedMps < 13.4 (30 mph)  → 'ebike'
topSpeedMps < 20.1 (45 mph)  → 'scooter'
topSpeedMps < 35.8 (80 mph)  → 'motorcycle' or car-class (ambiguous)
otherwise                    → car-class
```

The heuristic maps the detected type to garage vehicles whose `type` field matches. If exactly one garage vehicle matches the detected type, it becomes the suggestion. If multiple match, all are presented as options.

---

## 4. Profile Storage (Welford Online Algorithm)

Storage key: `smoothaf.vehicle_profiles` (new, added to `constants.js`).

One profile entry per garage vehicle `id`:

```json
{
  "van-abc123": {
    "vehicleId": "van-abc123",
    "n": 7,
    "means": {
      "avgSpeedMps": 8.4,
      "topSpeedMps": 19.2,
      "p95SpeedMps": 16.1,
      "speedVariance": 12.3,
      "eventRatePerMin": 0.4,
      "dimMomentum": 0.78
    },
    "M2s": {
      "avgSpeedMps": 4.1,
      "topSpeedMps": 22.0,
      "p95SpeedMps": 18.5,
      "speedVariance": 6.7,
      "eventRatePerMin": 0.12,
      "dimMomentum": 0.09
    }
  }
}
```

`M2s` are Welford's running sum-of-squared-deviations. Variance = `M2 / n`. StdDev = `sqrt(M2 / n)`.

`updateProfile(vehicleId, features)` does a single Welford increment and saves. Called only on explicit user confirmation.

Profile updates are **additive only** — there is no decrement when a user corrects a mis-assignment. A wrong data point averages out over many confirmed drives and does not need to be removed.

---

## 5. Matching Algorithm

`matchToGarage(features, garage, profiles)` returns `{ vehicleId, confidence }`.

1. Filter `garage` to vehicles where `profiles[v.id]?.n >= MIN_PROFILE_DRIVES`.
2. For each eligible vehicle, compute the **normalized squared distance**:
   ```
   distance = Σ  ((feature_value - mean) / max(stddev, 0.1))²
   ```
   The `max(stddev, 0.1)` floor prevents division-by-zero on features with no variance.
3. Pick the vehicle with the lowest distance.
4. Map distance to confidence:
   - distance < 3 → `'high'`
   - distance < 8 → `'medium'`
   - otherwise → `'low'`
5. If no garage vehicle has enough profile data, fall back to cold-start heuristic and return confidence `'suggestion'`.

`matchToGarage` is a pure function — no side effects, no localStorage reads.

---

## 6. Drive Object Changes

Two new optional fields on every finalized drive (added in `finalizeAndReview`):

| Field | Type | Description |
|---|---|---|
| `vehicleId` | `string \| null` | Matched garage vehicle id, or null if unresolved |
| `vehicleConfidence` | `'high' \| 'medium' \| 'low' \| 'suggestion' \| null` | Confidence level |

These fields are written **before** `saveDrive()` is called. Both start as `null` for drives recorded before this feature ships.

---

## 7. Files

| File | Action | Responsibility |
|---|---|---|
| `src/constants.js` | Modify | Add 8 vehicle types, `VEHICLE_PROFILES_KEY`, `MIN_PROFILE_DRIVES = 3` |
| `src/services/vehicleDetector.js` | **Create** | `extractFeatures`, `classifyBySpeed`, `matchToGarage`, `updateProfile` |
| `src/services/storage.js` | Modify | `loadVehicleProfiles`, `saveVehicleProfiles`, `updateDriveVehicle(startTime, vehicleId)` |
| `src/services/drive.js` | Modify | Call `matchToGarage` in `finalizeAndReview`, stamp `vehicleId` + `vehicleConfidence` on drive |
| `src/ui/review.js` | Modify | Render vehicle chip; handle confirm / reassign; call `updateProfile` on confirmation |
| `src/ui/home.js` | Modify | Render vehicle icon next to each drive in the list |
| `index.html` | Modify | Vehicle chip + picker markup in review screen |
| `src/styles/review.css` | Modify | Styles for vehicle chip, picker |
| `src/tests/vehicleDetector.test.js` | **Create** | Unit tests for all pure functions in vehicleDetector.js |

---

## 8. Review Screen UI

Three chip states rendered just below the score ring:

**High / medium confidence (auto-assigned):**
```
[ 🚌 Vandura  ·  wrong? ]
```
Tapping "wrong?" opens an inline picker listing all garage vehicles. Selecting one calls `updateDriveVehicle(drive.startTime, newVehicleId)` to patch the stored drive, then calls `updateProfile(newVehicleId, features)`. The previously-assigned vehicle's profile is not modified.

**Low confidence or cold-start suggestion:**
```
Which vehicle?  [ 🚌 Vandura ]  [ ⚡ E-Bike ]  [ + skip ]
```
One chip per garage vehicle. Tapping a chip assigns and updates the profile. Tapping "skip" leaves `vehicleId: null`.

**No garage vehicles:**
Chip is hidden entirely.

---

## 9. Home Screen

Drive list items gain a small vehicle icon to the left of the score. If `drive.vehicleId` is set, look up the vehicle's type in the garage and render the `VEHICLE_TYPES` icon. If null, render nothing.

---

## 10. Testing

`vehicleDetector.test.js` covers:

- `extractFeatures` with a known drive → exact values for all 6 features
- `classifyBySpeed` at each speed bucket boundary (values just below and just above each threshold)
- `matchToGarage` with profiles that have enough data → correct vehicle id returned
- `matchToGarage` with all profiles under `MIN_PROFILE_DRIVES` → falls back to cold-start
- `updateProfile` applied 3× → means and variances match hand-calculated Welford values
- `matchToGarage` correctly returns `'high'` / `'medium'` / `'low'` confidence at the distance boundaries

---

## 11. Out of Scope

- Retroactive detection on drives recorded before this feature ships (vehicleId stays null)
- Distinguishing two vehicles of the same type (e.g., two sedans) — the profile handles this if their driving profiles diverge enough, but no UI is built to resolve ties
- Cloud sync of vehicle profiles (profiles stay local)
