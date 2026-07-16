# Composite Drive Score (Effective × Efficient) — Design

> Scoring-model spec for Destination Drive. Bonus side ships now; penalty side ships with the live traffic-aware ETA. Pairs with the ahead/behind hero, pit-stop detection, and the post-game recap (separate specs/builds).

## Thesis
Smoothness is the game; beating the clock is the bonus round. The final drive score should reward being **effective AND efficient** — and that composite is what feeds review, lifetime, and the leaderboard. A pure-smoothness drive tops out at 100; a destination drive can break 100, but only rarely — when you were smooth *and* beat a realistic ETA by a real margin.

## The model
```
driveScore = clamp( efficiency + clockMod , 0 , SCORE_MAX )
```
- **efficiency** = existing smoothness score (0–100), from `analyzeDrive`.
- **clockMod** = signed points from the clock, 0 when there's no destination or no arrival.
- **SCORE_MAX = 100 + CLOCK_MAX_SWING** — drives *can* exceed 100 (rare, earned).

### clockMod (signed)
```
target = rawEtaSec * ETA_BUFFER          // the ETA the driver was racing
margin = (target - actualSec) / target   // >0 beat it, <0 late

if margin >= 0:   // beat the clock → BONUS, smoothness-gated
    pace = min(1, margin / CLOCK_BEAT_FULL)
    clockMod = +CLOCK_MAX_SWING * pace * (efficiency / 100)
else:             // late → PENALTY (only when allowPenalty)
    if not allowPenalty: clockMod = 0
    else:
      pace = min(1, -margin / CLOCK_LATE_FULL)
      clockMod = -CLOCK_MAX_SWING * pace
```

Constants (tunable): `CLOCK_MAX_SWING = 15`, `CLOCK_BEAT_FULL = 0.20` (beat by 20% = full bonus), `CLOCK_LATE_FULL = 0.20` (20% late = full penalty).

### Why it can't be gamed / why 100+ is rare
- The **bonus is gated by `(efficiency/100)`** — a rough-but-fast run can't earn it. To break 100 you need ~95+ smooth AND a ~20% beat. That's a trophy, not a Tuesday.
- Reckless never pays: efficiency is the big term (0–100); a maniac who beats the clock still scores low because their base cratered.
- **Late bites** (dawdler tax): puttering under the limit in the right lane the whole way → late → penalty → detracts from the score, even if buttery-smooth.

### Fairness gate (critical)
The **penalty is only fair if the ETA reflects reality** — an accident/traffic ahead of you is not "your own accord." So:
- **Bonus (positive):** ships now, works on any ETA (OSM or Mapbox). Pure upside.
- **Penalty (negative):** ships **only with the live, traffic-aware ETA** (Mapbox + in-drive re-fetch), so "late" measures your pace against a realistic, moving clock — never an accident. Gate on `routing.isTrafficAware()` + a live target. Until then `allowPenalty = false`.

### Arrival & pit stops
- Effectiveness/clockMod only apply if the drive **actually reached the destination** (`arrivedAtDestination`, ≤ `ARRIVAL_RADIUS_M`). Already in place.
- Pit stops (a stationary stretch mid-drive) are **excluded from scoring** and surfaced in the recap — separate build.

### Lifetime & leaderboard
`driveScore` (the composite) is THE score everywhere: review headline, drive list, lifetime average, leaderboard. Effective-and-efficient rises to the top. Consequence: once the penalty is live, destination drives are **risk/reward** — a botched run can lower your standing, not just deny a bonus. (Non-destination drives are unaffected: `clockMod = 0`.)

## Implementation

### `src/constants.js`
```js
export const CLOCK_MAX_SWING = 15;
export const CLOCK_BEAT_FULL = 0.20;
export const CLOCK_LATE_FULL = 0.20;
export const SCORE_MAX       = 100 + CLOCK_MAX_SWING;
```

### `src/services/scoring.js` (pure, add + test)
- `clockModifier(rawEtaSec, actualSec, efficiency, allowPenalty=false) -> number` (signed points; 0 for invalid/`margin>=0 && …`).
- `compositeScore(efficiency, rawEtaSec, actualSec, { arrived=false, allowPenalty=false }) -> number` (rounded; efficiency-only when not arrived / no eta).
- Keep `effectivenessScore` + `destinationTier` for the two-axis display.

### `src/services/drive.js` — `finalizeAndReview`
```js
drive.efficiency = analysis.score;                 // store smoothness separately
drive.arrived    = arrivedAtDestination(drive);
drive.effectiveness = (drive.targetEtaSec && drive.arrived)
  ? effectivenessScore(drive.targetEtaSec, Math.round(drive.durationMs / 1000)) : null;
drive.score = compositeScore(analysis.score, drive.targetEtaSec, Math.round(drive.durationMs / 1000),
  { arrived: drive.arrived, allowPenalty: false });  // penalty ships with the live traffic-aware ETA
```
(`drive.score` becomes the composite; `drive.efficiency` holds smoothness. Lifetime average / leaderboard already read `drive.score`, so they pick up the composite automatically.)

### `src/ui/review.js`
The two-axis "Efficiency" figure and the tier must use **smoothness**, not the composite:
- `#dest-epc-val` → `drive.efficiency ?? drive.score`
- `destinationTier(drive.effectiveness, drive.efficiency ?? drive.score)`

## Out of scope (next builds)
- Ahead/behind **hero** number + **live/dynamic ETA** re-fetch (unlocks the penalty side).
- **Pit-stop detection**.
- **Post-game recap** screen.
- Rescore (`rescoreDrive`) currently recomputes `score` from events only → drops the clock component; acceptable for now (rescore is a threshold-tuning path), revisit when the live ETA lands.
