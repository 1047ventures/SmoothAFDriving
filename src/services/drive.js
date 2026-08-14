import { state } from '../state.js';
import { ACTIVE_DRIVE_KEY, STORAGE_KEY, MAX_STORED_DRIVES, DEFAULTS, CFG } from '../constants.js';
import {
  loadDrives,
  saveDrive,
  saveLifetimeScore,
  saveDrives,
  recomputeLifetimeScore,
  loadDriverName,
  getSyncedIds,
} from './storage.js';
import { scoreFromEvents, analyzeDrive, effectivenessScore, compositeScore, computePitStopMs, movingSeconds } from './scoring.js';
import { isTrafficAware } from './routing.js';
import {
  pushDriveToSupabase, syncToLeaderboard, fetchCloudDrives, cloudRowToDrive,
  fetchDrivesForUser, claimDeviceDrives,
} from './supabase.js';
import { isSignedIn } from './auth.js';
import { haversine, metersToMiles, mpsToMph } from '../utils/math.js';
import { ARRIVAL_RADIUS_M } from '../constants.js';

// Did the drive actually end at the destination? Effectiveness must NOT be
// awarded otherwise — ending short (e.g. a gas stop halfway) would look like
// arriving impossibly early. Needs GPS samples to verify (recovered drives can't).
function arrivedAtDestination(drive){
  if (!drive.destination || !drive.samples || !drive.samples.length) return false;
  const last = drive.samples[drive.samples.length - 1];
  const d = haversine(
    { lat: last.lat, lon: last.lon },
    { lat: drive.destination.lat, lon: drive.destination.lng }
  );
  return d <= ARRIVAL_RADIUS_M;
}
import { detectCorridors } from './corridors.js';

export function persistActiveDrive(){
  if (!state.recording || state.simulated) return;
  try {
    const dist = state.samples.reduce((s, p) => s + (p.distMeters || 0), 0);
    const top  = state.samples.reduce((m, p) => Math.max(m, p.speed || 0), 0);
    localStorage.setItem(ACTIVE_DRIVE_KEY, JSON.stringify({
      startTs:    state.startTime,
      startScore: state.driveStartScore,
      events:     state.events,
      sampleCount:state.samples.length,
      distanceMeters: dist,
      topSpeedMps:    top,
      durationMs: Date.now() - state.startTime,
      savedAt:    Date.now(),
      destination:    state.destination || null,
      targetEtaSec:   state.targetEtaSec || null,
      routeDistanceM: state.routeDistanceM || null,
    }));
  } catch {}
}

export function clearActiveDrive(){
  try { localStorage.removeItem(ACTIVE_DRIVE_KEY); } catch {}
}

/**
 * Check if a drive was interrupted (e.g. browser reload) and recover it.
 * callbacks.onListUpdate() is called if a drive was recovered and saved.
 */
export function checkRecoveredDrive(callbacks = {}){
  const { onListUpdate } = callbacks;
  try {
    const raw = localStorage.getItem(ACTIVE_DRIVE_KEY);
    if (!raw) return;
    localStorage.removeItem(ACTIVE_DRIVE_KEY);
    const saved = JSON.parse(raw);
    const age = Date.now() - (saved.savedAt || 0);
    if (age > 4 * 60 * 60 * 1000) return; // ignore if >4h old
    if ((saved.sampleCount || 0) < 20)    return; // too short to bother
    const cfg   = { ...DEFAULTS };
    const score = scoreFromEvents(saved.events || [], cfg, saved.sampleCount);
    const drive = {
      id:             'rec_' + saved.startTs,
      score:          Math.round(score),
      distanceMeters: saved.distanceMeters || 0,
      durationMs:     saved.durationMs     || 0,
      topSpeedMps:    saved.topSpeedMps    || 0,
      events:         saved.events         || [],
      samples:        [],
      ts:             saved.startTs,
      recovered:      true,
      destination:    saved.destination || null,
      targetEtaSec:   saved.targetEtaSec || null,
      routeDistanceM: saved.routeDistanceM || null,
      // Recovered drives keep no GPS samples, so arrival can't be verified —
      // don't award effectiveness we can't stand behind.
      effectiveness:  null,
    };
    const all = loadDrives();
    if (all.find(d => d.startTime === saved.startTs || d.id === drive.id)) return; // already saved
    all.unshift(drive);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_STORED_DRIVES))); } catch {}
    onListUpdate?.();
  } catch {}
}

/**
 * Build a finalized drive object from the current recording state.
 * Pure-ish (reads `state`, no I/O); `score`/`dims` are filled in by the caller
 * via analyzeDrive. Used by both finalizeAndReview (on stop) and the live gauge
 * (every ~1s) so the in-drive score and the stored score share one engine.
 */
export function buildDriveFromState(){
  const samples = state.samples;
  let distance = 0, topSpeed = 0, topSpeedLat = null, topSpeedLon = null;
  for (let i = 1; i < samples.length; i++){
    distance += haversine(samples[i-1], samples[i]);
    if (samples[i].speed > topSpeed){
      topSpeed = samples[i].speed;
      topSpeedLat = samples[i].lat;
      topSpeedLon = samples[i].lon;
    }
  }
  const duration = samples.length ? samples[samples.length-1].t - samples[0].t : 0;
  const events = [...state.events];

  return {
    startTime: state.startTime,
    durationMs: duration,
    distanceMeters: distance,
    topSpeedMps: topSpeed,
    topSpeedLat: topSpeedLat != null ? +topSpeedLat.toFixed(6) : null,
    topSpeedLon: topSpeedLon != null ? +topSpeedLon.toFixed(6) : null,
    speedLimitMps: state.currentSpeedLimitMps || null,
    score: 0,  // filled in by caller via analyzeDrive
    samples: samples.map(s => ({
      t:       s.t - state.startTime,
      lat:     +s.lat.toFixed(6),
      lon:     +s.lon.toFixed(6),
      speed:   +((s.speed||0).toFixed(2)),
      heading: s.heading != null ? +s.heading.toFixed(1) : null,
      h:       +((s.harshness||0).toFixed(2)),
      la:      +((s.longAccel||0).toFixed(3)),
      ra:      +((s.latAccel||0).toFixed(3)),
    })),
    events: events.map(e => ({
      type: e.type, severity: +((e.severity||1).toFixed(2)),
      tier: e.tier || 2,
      lat: +e.lat.toFixed(6), lon: +e.lon.toFixed(6),
      speedMph: Math.round(e.speedMph||0),
      t: e.t - state.startTime,
      la: e.la != null ? +e.la.toFixed(3) : null,
      ra: e.ra != null ? +e.ra.toFixed(3) : null,
    })),
    eventCount: events.length,
    simulated: state.simulated,
    settingsSnapshot: { ...CFG },
    destination:    state.destination || null,
    targetEtaSec:   state.targetEtaSec || null,
    routeDistanceM: state.routeDistanceM || null,
    routeGeometry:  state.routeGeometry || null,
  };
}

/**
 * Finalize the current recording into a drive object, save it, push to Supabase,
 * and hand off to UI via callbacks.
 * callbacks.onReview(drive)   — called with the completed drive object
 * callbacks.onListUpdate()    — called to refresh the drive list
 * callbacks.onTooShort()      — called instead of onReview when the drive had
 *                               < 2 samples (nothing to score); UI should surface
 *                               this rather than leaving the user on a dead screen
 */
export function finalizeAndReview(callbacks = {}){
  const { onReview, onListUpdate, onTooShort } = callbacks;
  if (state.samples.length < 2){
    if (onTooShort) onTooShort();
    if (onListUpdate) onListUpdate();
    return;
  }

  const drive = buildDriveFromState();
  const analysis = analyzeDrive(drive);
  drive.dims  = analysis.dims;
  // Destination Drive: only score effectiveness if you actually REACHED the
  // destination — otherwise ending short of it looks like arriving early. No
  // arrival → unfinished (renders like a normal drive, no effectiveness).
  // Store smoothness separately; the drive's headline score is the composite
  // (smoothness + clock), which flows into lifetime + leaderboard.
  drive.efficiency = analysis.score;
  drive.arrived = arrivedAtDestination(drive);
  // Pit stops (long parked stretches) don't count against the clock — the time
  // that matters is moving time. The lateness penalty is only fair when the ETA
  // was traffic-aware (Mapbox), so it's gated on isTrafficAware().
  drive.pitStopMs = computePitStopMs(drive.samples);
  const moveSec = movingSeconds(drive.durationMs / 1000, drive.pitStopMs / 1000);
  drive.movingSec = moveSec;
  const penalize = isTrafficAware();
  drive.effectiveness = (drive.targetEtaSec && drive.arrived)
    ? effectivenessScore(drive.targetEtaSec, moveSec)
    : null;
  drive.score = compositeScore(analysis.score, drive.targetEtaSec, moveSec,
    { arrived: drive.arrived, allowPenalty: penalize });
  saveDrive(drive);
  pushDriveToSupabase(drive);
  // Non-blocking — corridor detection runs after review renders
  detectCorridors(drive).catch(() => {});

  // Lifetime score = rolling average of the 10 most recent drives
  // (includes this drive, which was just saved above)
  const allDrives = loadDrives().filter(d => d.score != null);
  if (allDrives.length > 0) {
    const recent = allDrives.slice(0, 10);
    saveLifetimeScore(Math.round(recent.reduce((s, d) => s + d.score, 0) / recent.length));
  }
  // Leaderboard gets the real stored score, NOT the (now-defunct) live gauge value.
  const driverName = loadDriverName();
  if (driverName) syncToLeaderboard(driverName, drive.score).catch(() => {});

  if (onReview) onReview(drive);
  if (onListUpdate) onListUpdate();
}

/**
 * Merge cloud drives into local storage without clobbering anything local.
 *
 * Local drives win on conflict: a locally-recorded drive still has its GPS
 * samples and events, while the cloud copy is metadata-only. Dedupe is by
 * startTime, which is the same stable ID the uploader uses.
 *
 * Pure apart from the storage read/write — takes rows, returns a summary.
 */
export function mergeCloudDrives(rows){
  if (!Array.isArray(rows) || !rows.length) return { added: 0, skipped: 0, total: loadDrives().length };
  const local = loadDrives();
  const seen  = new Set(local.map(d => d.startTime));
  let added = 0, skipped = 0;
  for (const row of rows){
    const drive = cloudRowToDrive(row);
    if (!drive.startTime || seen.has(drive.startTime)){ skipped++; continue; }
    seen.add(drive.startTime);
    local.push(drive);
    added++;
  }
  local.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  const saved = saveDrives(local);
  return { added, skipped, total: local.length, saved };
}

/**
 * Pull a previous install's drives down from the cloud and merge them in.
 * Returns a summary, or null if the fetch failed / nothing was there.
 */
export async function restoreDrivesFromCloud(deviceId){
  const rows = await fetchCloudDrives(deviceId);
  if (!rows) return null;
  const result = mergeCloudDrives(rows);
  if (result.added > 0) recomputeLifetimeScore();
  return { ...result, fetched: rows.length };
}

/**
 * The post-sign-in restore: adopt this device's anonymous drives into the
 * account, then pull down everything the account owns — including drives from
 * phones this install has never heard of.
 *
 * Safe to call on every launch. Claiming filters on user_id=is.null and the
 * merge dedupes by startTime, so repeat runs settle to a no-op.
 */
export async function restoreDrivesForUser(){
  if (!isSignedIn()) return null;
  await claimDeviceDrives();
  const rows = await fetchDrivesForUser();
  if (!rows) return null;
  const result = mergeCloudDrives(rows);
  if (result.added > 0) recomputeLifetimeScore();
  return { ...result, fetched: rows.length };
}
