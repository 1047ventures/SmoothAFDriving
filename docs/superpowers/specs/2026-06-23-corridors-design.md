# Corridors Feature Design
**Date:** 2026-06-23
**Status:** Approved

## Overview

Corridors are named road segments (sourced from OSM) that users drive regularly. The system gives every major road a persistent identity — users earn a score on each corridor, see how many times they've driven it, and compete with nearby drivers for the smoothest-driver crown on that stretch of road.

A corridor exists in the catalog before anyone drives it (OSM-first). Driving a named road for >500m logs a corridor drive. Long roads like Wadsworth are naturally split north/south by OSM way IDs at major intersections like Colfax.

---

## Architecture

### Phase 1 — Detection + Local Stats (no server required)
### Phase 2 — Supabase Sync + Leaderboard + Rivals

---

## 1. Corridor Detection (`src/services/corridors.js`)

**Trigger:** Called from `finalizeAndReview()` after every drive, using the drive's `samples` array.

**Algorithm:**
1. Sample one GPS point per ~250m of cumulative distance traveled, capped at 30 points (keeps Overpass load predictable regardless of drive length)
2. Batch-query Overpass API: `[out:json]; way(around:30,{lat},{lon})[highway][name]; out tags;` for each sampled point
3. Group consecutive samples by `name` tag — contiguous runs on the same named road form a segment
4. For each segment: compute distance via haversine between first and last point
5. Keep segments where `distanceMeters >= 500`
6. Return array of `{ name, osmWayId, city, centerLat, centerLon, distanceMeters }`

**Offline behaviour:** If Overpass is unreachable, detection is skipped silently. Drive is saved without corridor data. A retry queue is not needed — corridor stats are soft data, not critical.

**Performance:** Overpass calls are fire-and-forget after the review screen renders. User never waits for it.

---

## 2. Data Model

### Supabase Tables

```sql
-- corridors: one row per unique named road segment in a city
create table corridors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,           -- e.g. "N Wadsworth Blvd"
  city         text not null,           -- e.g. "Denver"
  center_lat   float not null,
  center_lon   float not null,
  osm_way_id   bigint,                  -- nullable, best-effort
  created_at   timestamptz default now(),
  unique (name, city)
);

-- corridor_drives: one row per user per corridor per drive
create table corridor_drives (
  id              uuid primary key default gen_random_uuid(),
  corridor_id     uuid references corridors(id),
  device_id       text not null,
  score           int not null,
  distance_meters float not null,
  driven_at       timestamptz not null
);

-- index for leaderboard queries
create index on corridor_drives (corridor_id, score desc);
create index on corridor_drives (device_id);
```

### Local Cache (localStorage)

Key: `smoothaf.corridors` — JSON array of the user's corridor records:
```js
[{
  corridorId,   // local slug in Phase 1: `${name}-${city}` lowercased/slugified; replaced with Supabase uuid on Phase 2 sync
  name,         // "N Wadsworth Blvd"
  city,         // "Denver"
  centerLat, centerLon,
  drives: [{score, distanceMeters, drivenAt}],
  // derived:
  driveCount,   // drives.length
  avgScore,     // mean of scores
  bestScore,    // max of scores
}]
```

---

## 3. Home Screen — "Your Corridors" Section

**Replaces** the current placeholder teaser card.

**Renders:**
- Up to 3 corridor cards, sorted by `driveCount desc`
- Each card: road name · drive count · avg score · rank badge (Phase 2)
- "Browse nearby roads →" row below (Phase 2: queries Supabase for corridors within 5km bounding box of last known position)

**Empty state:** "Drive a road 3+ times to unlock your first corridor ranking"

---

## 4. Corridor Detail Screen (new screen)

**Trigger:** Tap any corridor card on home screen.

**Content:**
- Header: road name + city
- Your stats row: drives · avg score · best score
- 7-drive sparkline (scores over time on this specific corridor)
- **Phase 2 — Leaderboard:** all drivers ranked by avg score; user's row highlighted
- **Phase 2 — Rivals:** drivers within 5 pts of user's avg score, surfaced above the full leaderboard

**Navigation:** Back arrow → home screen

---

## 5. Sync Service additions (`src/services/supabase.js`)

```js
// Upsert a corridor (by name+city), return its uuid
syncCorridor({ name, city, centerLat, centerLon, osmWayId })

// Insert a corridor_drive row
syncCorridorDrive({ corridorId, deviceId, score, distanceMeters, drivenAt })

// Fetch top N drivers on a corridor (leaderboard)
fetchCorridorLeaderboard(corridorId, limit = 20)

// Fetch nearby corridors within bbox
fetchNearbyCorrlidors({ minLat, maxLat, minLon, maxLon })
```

---

## 6. Drive Lifecycle Changes

`finalizeAndReview()` in `src/services/drive.js` gains one new step:

```
GPS samples → processSample → detectEvent → events[]
               ↓ (new, async, non-blocking)
         detectCorridors(drive) → syncCorridors()
```

The corridor detection runs after `renderReview()` is called so it never delays the post-drive screen.

---

## 7. New Files

| File | Purpose |
|------|---------|
| `src/services/corridors.js` | Detection algorithm, local cache R/W |
| `src/ui/corridor.js` | Corridor detail screen render + leaderboard |
| `src/styles/corridor.css` | Corridor card + detail screen styles |

## Modified Files

| File | Change |
|------|--------|
| `src/services/drive.js` | Call `detectCorridors()` post-finalize |
| `src/services/supabase.js` | Add corridor sync functions |
| `src/ui/home.js` | Replace corridor teaser with real corridor cards |
| `src/styles/home.css` | Corridor card styles on home screen |
| `index.html` | Add corridor detail screen section + import |
| `src/main.js` | Wire corridor screen back button |

---

## Phasing

**Phase 1 (ship first):**
- Corridor detection from GPS
- Local storage of corridor drives
- Home screen corridor cards (personal stats only, no rank)
- Corridor detail screen (personal stats + sparkline, no leaderboard)

**Phase 2 (follow-on):**
- Supabase sync for corridors + corridor_drives
- Leaderboard on corridor detail screen
- Rivals section
- "Browse nearby" on home screen

---

## Out of Scope

- Real-time corridor detection during a drive (post-drive only)
- User-defined custom corridors
- Corridor "challenges" or achievements
- Turn-by-turn or direction-aware corridor splits (OSM way direction not used)
