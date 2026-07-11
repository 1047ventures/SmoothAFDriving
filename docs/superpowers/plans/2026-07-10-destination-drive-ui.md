# Destination Drive — UI Implementation Plan (follow-up)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Built in increments; each increment is testable on the PR #21 Netlify/Vercel preview.

**Goal:** The user-facing layer for Destination Drive (brain already merged): pick a destination before a drive, see a live pace strip during it, and a two-axis result (Effectiveness + Efficiency + tier) after.

**Prereqs already in place:** `routing.js` (`geocode`, `fetchRoute`), `scoring.js` (`effectivenessScore`, `destinationTier`), and `state`/`drive.js` plumbing (`state.destination`, `targetEtaSec`, `routeDistanceM`, `routeGeometry` → drive object → `drive.effectiveness`).

**Verification:** No device needed — each increment pushes to `claude/destination-drive`, and the preview URL (`https://deploy-preview-21--smoothaf-driving.netlify.app`) updates. Validate feel there.

**CRITICAL integration rule:** `startRecording()` calls `resetState()`, which nulls the destination fields. So the picked destination + fetched route must be held in a **module-level cache in `destination.js`**, and applied into `state` **inside `startRecording()` AFTER `resetState()`**. Never set `state.destination` directly from the home screen — it would be wiped at start.

---

## Increment 1: Destination entry (home screen)

**Files:** Create `src/ui/destination.js`; Modify `index.html` (home CTA area ~line 114, + a sheet), `src/main.js` (wire button), `src/ui/record.js` (apply cached destination after resetState), `src/styles/home.css` or `modals.css` (sheet + chip styles).

**`src/ui/destination.js` responsibilities:**
- Module state: `let picked = null;` (`{ label, lat, lng }`) and `let route = null;` (`{ distanceM, durationSec, geometry }`).
- `openDestinationSheet()` — show the sheet.
- On "Search" submit: call `geocode(query)` (debounced, on submit only — never per keystroke, per Nominatim policy). Render up to 5 results. Loading + empty/error states ("No matches", "Couldn't search — try again").
- On result tap: set `picked`; call `fetchRoute(currentPosition, picked)` where `currentPosition` comes from `navigator.geolocation.getCurrentPosition` (one-shot; if unavailable, keep `picked` but `route=null` — ETA locks at start instead). Store `route`. Close sheet. Render the destination chip ("📍 <short label> · ~<mins> min" when route known, else "📍 <short label>").
- `clearDestination()` — `picked = null; route = null;` hide chip.
- `getPendingDestination()` → `{ picked, route }` for `record.js` to consume at start.
- `applyDestinationToState(state)` helper OR export the getters; `record.js` reads them.

**`record.js` change (the critical bit):** inside `startRecording()`, AFTER `resetState()`, do:
```js
const { picked, route } = getPendingDestination();
if (picked) {
  state.destination    = picked;
  state.targetEtaSec   = route?.durationSec ?? null;
  state.routeDistanceM = route?.distanceM ?? null;
  state.routeGeometry  = route?.geometry ?? null;
}
```
If `picked` exists but `route` is null (geocoded but route not fetched yet), attempt `fetchRoute` at start and fill the fields; on failure proceed with `targetEtaSec=null` (normal drive). Keep it non-blocking — never delay recording more than a moment.

**index.html:** a "Set destination" button + a hidden chip next to `#btn-start`; a destination sheet (`#dest-sheet`) with input `#dest-input`, `#dest-search`, results `#dest-results`, close.

**Test on preview:** search an address, pick it, see the chip + ETA; start a drive; confirm it records normally.

**Commit:** `feat: destination entry sheet + start-time wiring`

---

## Increment 2: Live pace strip (record screen)

**Files:** Modify `index.html` (record screen, near `.rec-topbar` ~line 150), `src/ui/record.js` (`updateLiveUI`), `src/styles/record.css`.

- Only render when `state.targetEtaSec` is set. Show locked target ("Target 18:40" — compute from drive start + `targetEtaSec*ETA_BUFFER`) and an approximate ahead/behind:
```js
const remainMeters = state.routeDistanceM ? haversine(lastSample, state.destination) : null;
const fracDone = state.routeDistanceM ? clamp(1 - remainMeters / state.routeDistanceM, 0, 1) : 0;
const expectedElapsed = fracDone * state.targetEtaSec * ETA_BUFFER;
const delta = elapsedSec - expectedElapsed;   // + = behind, - = ahead
```
Label "▲ 0:45 ahead" / "▼ 1:10 behind"; mark subtle (it's an estimate). No route line, no turn-by-turn.

**Test on preview:** simulated drive with a destination shows the strip updating.

**Commit:** `feat: live pace strip during destination drives`

---

## Increment 3: Two-axis result (review screen)

**Files:** Modify `index.html` (review screen ~line 259), `src/ui/review.js` (`renderReview`), `src/styles/review.css`.

- When `drive.effectiveness != null`: show two hero figures — **Effectiveness** (with delta, e.g. "On time · 1:20 to spare" or "3:05 late", computed from `drive.durationMs` vs `drive.targetEtaSec*ETA_BUFFER`) and **Efficiency** (`drive.score`) — plus the **tier badge** from `destinationTier(drive.effectiveness, drive.score)`.
- Draw `drive.routeGeometry` as a dashed polyline under the actual GPS track on the review Leaflet map (guard: only if present).
- No-destination drives: none of this renders (unchanged).

**Test on preview:** review a completed destination drive; verify both numbers, tier, and the planned-route overlay.

**Commit:** `feat: two-axis result + planned-route overlay on review`

---

## Increment 4: Polish pass
Copy, spacing, dark-theme consistency, empty/error states, the `ETA_BUFFER` felt-tuning based on real drives. Driven by preview feedback.

---

## Notes
- All new UI is gated on destination presence — the app is byte-for-byte unchanged for normal drives.
- `geocode` fires on submit only (Nominatim ≤1 req/sec, no autocomplete).
- Geolocation one-shot for the route origin; handle denial gracefully (no ETA, still records).
