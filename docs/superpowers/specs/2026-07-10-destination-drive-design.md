# Destination Drive Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** An optional drive mode where the driver enters a destination before starting. The app fetches a route + baseline ETA, locks it as a target, and at the end scores the drive on **two axes** — **Effectiveness** (did you arrive on time or faster than the ETA?) and **Efficiency** (the existing smoothness score). Together they turn every solo drive into a match against a traffic-aware "ghost."

**Core principle:** The two axes police each other. Rushing to beat the clock wrecks smoothness; crawling to drive smoothly misses the ETA. Winning both requires genuine skill — anticipation, momentum, flow. Smooth *and* quick. We never reward speeding directly; the smoothness score is the guardrail.

**Architecture:** A provider-agnostic routing service (`services/routing.js`) does geocoding + routing behind a clean interface, backed by free OSM (Nominatim) + OSRM for the MVP and swappable for Google Routes / Mapbox traffic-aware ETA later. A pure scoring function (`effectivenessScore`) is unit-tested. Destination is optional per-drive and fully additive — a drive with no destination behaves exactly as today.

**Tech Stack:** Vanilla JS, Vite, Vitest, Leaflet (existing), Nominatim + OSRM public APIs (MVP).

---

## 1. Scope

**In scope (MVP):**
- Optional destination entry on the pre-drive screen (address search → pick a result).
- Fetch route geometry + baseline ETA at departure; lock the ETA as the target.
- A modest live "pace vs target" indicator during the drive.
- Two-axis result on the review screen: Effectiveness + Efficiency, plus a combined tier.
- Draw the planned route on the review map alongside the actual GPS track.
- Persist destination + target ETA + effectiveness on the drive record (local + cloud).

**Explicitly NOT in scope:**
- **Turn-by-turn navigation.** We are not a nav app. We set a target and measure; the driver navigates however they like (their own nav app). No voice guidance, no rerouting.
- Traffic-aware ETA (deferred — MVP uses OSRM's traffic-free duration behind the provider interface; a real provider drops in later with only a key + config).
- Precise route-adherence / off-route detection (future; live pace uses a straight-line estimate).
- Changing lifetime score or leaderboard math. Effectiveness is a per-drive stat only for now.

---

## 2. The Two Axes

### Efficiency (existing)
The current smoothness score (`analyzeDrive` / `scoreFromEvents`, 0–100). Unchanged. Continues to feed lifetime score and leaderboards exactly as today.

### Effectiveness (new)
How the actual drive time compares to the locked target ETA. Pure function, 0–100.

```
targetSec  = rawEtaSec * ETA_BUFFER   // buffer absorbs OSRM optimism (no stoplights/traffic)
overFrac   = max(0, (actualSec - targetSec) / targetSec)
effectiveness = round(clamp(100 - overFrac * PACE_PENALTY, 0, 100))
```

- Arrive on time **or faster** (`actualSec <= targetSec`) → **100**. We do not reward beating it further on this axis — being *faster* is only worth pursuing when it doesn't cost smoothness, and that trade-off is already captured by the Efficiency axis.
- Late → decays linearly. With `PACE_PENALTY = 180`, ~56% over target = 0.
- `ETA_BUFFER` default **1.2** for the OSRM MVP (its durations run optimistic vs real driving). When a traffic-aware provider is wired in, this drops toward **1.0**. Both live in `constants.js`.

### Combined tier (presentation only)
A letter tier derived from the pair, for shareability — not stored, computed at render:

| Efficiency | On-time/faster (eff=100) | ≤20% late | >20% late |
|---|---|---|---|
| ≥ 90 | **S** | A | B |
| 75–89 | A | B | C |
| < 75 | B | C | D |

The result screen shows both raw numbers *and* the tier. The two numbers tell the story; the tier makes it shareable.

---

## 3. Routing Service — `src/services/routing.js`

Provider-agnostic. The rest of the app only ever calls these two functions; swapping providers touches only this file.

```js
// Geocode a free-text address to a place. Returns null on no match / error.
export async function geocode(query) -> { label, lat, lng } | null

// Route between two points. Returns null on error.
export async function fetchRoute(from, to) ->
  { distanceM, durationSec, geometry: [[lat,lng], ...] } | null
```

**MVP backends (free, public):**
- **Geocode:** Nominatim `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=...`
- **Route:** OSRM `https://router.project-osrm.org/route/v1/driving/{lng},{lat};{lng},{lat}?overview=full&geometries=geojson`

**Constraints to respect (documented in code):**
- Nominatim usage policy: ≤1 req/sec, requires a descriptive `User-Agent` / `Referer`, no keystroke autocomplete. So geocoding fires **on submit**, not per keypress, and is debounced.
- Public OSRM/Nominatim demo servers are best-effort and rate-limited — fine for prototype and personal testing, **not** production scale. `PRODUCTION.md` note: move to a paid provider (Google/Mapbox) or self-hosted before launch.
- All calls are `try/catch`; any failure returns `null` and the drive proceeds as a normal (no-destination) drive. The feature never blocks recording.

**Provider swap (future, no rework):** a `ROUTING_PROVIDER` constant selects `nominatim`/`osrm` vs `google`/`mapbox`; the Google/Mapbox implementations fulfill the same two-function contract and read a key from config.

---

## 4. Pure Scoring — `src/services/scoring.js` (addition)

```js
// targetSec already includes ETA_BUFFER applied by the caller? No — apply here
// so tests pin the whole curve. Pass the RAW eta and the actual duration.
export function effectivenessScore(rawEtaSec, actualSec) -> number  // 0..100, integer
```

Uses `ETA_BUFFER` and `PACE_PENALTY` from `constants.js`. Returns `100` when `rawEtaSec` is null/0 is **not** valid input — callers only invoke this when a target exists. Guard: if `rawEtaSec <= 0` or `actualSec <= 0`, return `null`.

---

## 5. Data Model

### Drive object (in-memory + localStorage)
New optional fields, all `null` for a normal drive:

```js
destination:   { label, lat, lng } | null
routeDistanceM: number | null      // planned route distance
routeGeometry:  [[lat,lng], ...] | null   // for the review map
targetEtaSec:   number | null      // RAW OSRM duration, locked at departure
effectiveness:  number | null      // computed at finalize
```

`actualSec` is derived from the existing `duration_ms` — not stored separately.

### Supabase `drives` table
Add nullable columns (additive migration, safe — existing rows/writes unaffected):
`dest_label text`, `dest_lat float8`, `dest_lng float8`, `route_distance_m float8`, `target_eta_sec int`, `effectiveness int`.
`routeGeometry` is **not** synced (local-only, review-map use). `supabase.js` upload adds these fields when present.

---

## 6. UI

### Pre-drive (home / start screen)
- A new **"Set destination"** control above/near Start. Tapping opens a lightweight sheet: text input + "Search"; results list (up to 5 from geocode); tap a result to select.
- Selected destination shows as a chip ("📍 destination label · ~18 min") with an ✕ to clear.
- Starting a drive with a destination selected → mode is "Destination Drive"; without → normal drive (today's behavior).
- On start, `fetchRoute` is called and `targetEtaSec` / `routeDistanceM` / `routeGeometry` are locked into the active drive. If routing fails, show a small non-blocking notice ("Couldn't fetch ETA — recording as a normal drive") and proceed.

### During the drive (record screen)
- When a target exists, show a compact **pace strip**: locked target time (e.g. "Target 18:40") + a live estimate of ahead/behind.
- Live estimate (MVP, approximate — labeled as an estimate): `fracDone = 1 - clamp(straightLineToDest / routeDistanceM, 0, 1)`; `expectedElapsed = fracDone * targetEtaSec`; `delta = actualElapsed - expectedElapsed`. Show "▲ 0:45 ahead" / "▼ 1:10 behind". Precise route-progress is future work.
- No turn-by-turn, no route line on the record screen (keeps it calm).

### Review screen
- **Two hero numbers**: Effectiveness (with on-time/late delta, e.g. "On time · +1:20 to spare" or "3:05 late") and Efficiency (smoothness score, as today), plus the combined **tier badge**.
- Planned route (`routeGeometry`) drawn on the review map as a dashed line under the actual GPS track, so you see where you deviated.
- Normal drives (no destination) render exactly as today — none of the above appears.

---

## 7. Files

| File | Action | Responsibility |
|---|---|---|
| `src/services/routing.js` | Create | `geocode`, `fetchRoute` (provider-agnostic; Nominatim + OSRM MVP) |
| `src/services/scoring.js` | Modify | Add pure `effectivenessScore(rawEtaSec, actualSec)` |
| `src/constants.js` | Modify | `ETA_BUFFER`, `PACE_PENALTY`, `ROUTING_PROVIDER`, API base URLs |
| `src/services/drive.js` | Modify | Carry destination/target through active-drive persist + finalize; compute `effectiveness` at finalize |
| `src/services/supabase.js` | Modify | Include new fields in drive upload when present |
| `src/ui/destination.js` | Create | Destination search sheet: input, geocode-on-submit, results, select/clear |
| `src/ui/record.js` | Modify | Live pace strip when a target exists |
| `src/ui/review.js` | Modify | Two-axis result + tier badge + planned-route overlay |
| `index.html` | Modify | Destination sheet markup, pace strip, review result elements |
| `src/styles/*.css` | Modify | Styles for the above (edit existing per-screen blocks) |
| `src/tests/scoring.test.js` | Modify | Tests for `effectivenessScore` + tier |
| `src/tests/routing.test.js` | Create | Tests for URL building + response parsing (fetch mocked) |
| Supabase migration | Doc | Add nullable columns (§5) |

---

## 8. Testing

**`effectivenessScore` (pure):**
- On time (`actual == target`) → 100; faster (`actual < target`) → 100.
- Late by exactly the `PACE_PENALTY` breakpoint → 0; half that → ~50.
- `ETA_BUFFER` applied: with buffer 1.2, an actual == 1.2×rawEta → 100.
- Guards: `rawEtaSec <= 0` or `actualSec <= 0` → null.

**Tier mapping:** representative cells of the §2 table (S/A/B/C/D) hit the right letter.

**`routing.js` (fetch mocked):**
- `geocode` builds the correct Nominatim URL and parses `{label,lat,lng}` from a sample response; empty results → null; fetch throw → null.
- `fetchRoute` builds the correct OSRM URL (`{lng},{lat}` order!) and parses `distanceM`/`durationSec`/`geometry` (GeoJSON `[lng,lat]` → our `[lat,lng]`); error/no-route → null.

---

## 9. Out of Scope / Future

- Traffic-aware ETA (Google Routes / Mapbox) — provider swap only.
- Destination-Drive leaderboards keyed by route ("fastest smooth run to the office").
- Precise route-adherence, off-route detection, live route-progress.
- Turn-by-turn navigation (intentionally never — we measure, we don't guide).
- Predicted-vs-actual ETA drift display during heavy traffic.
