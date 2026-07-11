import { state } from '../state.js';
import { ACTIVE_DRIVE_KEY, STORAGE_KEY, MAX_STORED_DRIVES, DEFAULTS, CFG } from '../constants.js';
import {
  loadDrives,
  saveDrive,
  saveLifetimeScore,
  loadDriverName,
  getSyncedIds,
} from './storage.js';
import { scoreFromEvents, analyzeDrive, effectivenessScore } from './scoring.js';
import { pushDriveToSupabase, syncToLeaderboard } from './supabase.js';
import { haversine, metersToMiles, mpsToMph } from '../utils/math.js';
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
      effectiveness:  saved.targetEtaSec
        ? effectivenessScore(saved.targetEtaSec, Math.round((saved.durationMs || 0) / 1000))
        : null,
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
 * callbacks.onReview(drive) — called with the completed drive object
 * callbacks.onListUpdate()  — called to refresh the drive list
 */
export function finalizeAndReview(callbacks = {}){
  const { onReview, onListUpdate } = callbacks;
  if (state.samples.length < 2){
    if (onListUpdate) onListUpdate();
    return;
  }

  const drive = buildDriveFromState();
  const analysis = analyzeDrive(drive);
  drive.score = analysis.score;
  drive.dims  = analysis.dims;
  // Destination Drive: score arrival time vs the locked ETA (null if no destination)
  drive.effectiveness = drive.targetEtaSec
    ? effectivenessScore(drive.targetEtaSec, Math.round(drive.durationMs / 1000))
    : null;
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
