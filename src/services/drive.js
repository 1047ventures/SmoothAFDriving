import { state } from '../state.js';
import { ACTIVE_DRIVE_KEY, STORAGE_KEY, MAX_STORED_DRIVES, CFG } from '../constants.js';
import {
  loadDrives,
  saveDrive,
  saveLifetimeScore,
  saveDrives,
  recomputeLifetimeScore,
  loadDriverName,
  getSyncedIds,
} from './storage.js';
import { analyzeDrive, effectivenessScore, compositeScore, computePitStopMs, movingSeconds } from './scoring.js';
import { isTrafficAware, etaBuffer } from './routing.js';
import {
  pushDriveToSupabase, syncToLeaderboard, fetchCloudDrives, cloudRowToDrive,
  fetchDrivesForUser, claimDeviceDrives,
} from './supabase.js';
import { isSignedIn } from './auth.js';
import { haversine, metersToMiles, mpsToMph } from '../utils/math.js';
import { ARRIVAL_RADIUS_M, MIN_DRIVE_METERS } from '../constants.js';

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
import { syncProfile } from './profile.js';

// Map one in-memory sample to its compact stored shape (short keys, rounded).
// Shared by the finalized drive and the 30s crash-recovery snapshot so a
// recovered drive carries real GPS + motion samples and is scored by the same
// analyzeDrive engine as everything else — no separate event-only scorer.
function storeSample(s, startTime){
  const out = {
    t:       s.t - startTime,
    lat:     +s.lat.toFixed(6),
    lon:     +s.lon.toFixed(6),
    speed:   +((s.speed||0).toFixed(2)),
    heading: s.heading != null ? +s.heading.toFixed(1) : null,
    h:       +((s.harshness||0).toFixed(2)),
    la:      +((s.longAccel||0).toFixed(3)),
    ra:      +((s.latAccel||0).toFixed(3)),
  };
  if (s.roadRoughness) out.rr = +s.roadRoughness.toFixed(3);
  if (s.roadJolt)      out.rj = +s.roadJolt.toFixed(3);
  if (s.throttle   != null) out.thr = +s.throttle.toFixed(1);
  if (s.rpm        != null) out.rpm = Math.round(s.rpm);
  if (s.load       != null) out.ld  = +s.load.toFixed(1);
  if (s.gear       != null) out.g   = s.gear;
  if (s.obdSpeed   != null) out.os  = +s.obdSpeed.toFixed(2);
  if (s.horsepower != null) out.hp  = Math.round(s.horsepower);
  if (s.torqueNm   != null) out.nm  = Math.round(s.torqueNm);
  // Slower channels, abbreviated to hold the localStorage quota.
  if (s.coolant    != null) out.ct  = Math.round(s.coolant);
  if (s.intakeTemp != null) out.it  = Math.round(s.intakeTemp);
  if (s.map        != null) out.map = Math.round(s.map);
  if (s.timingAdv  != null) out.ta  = +s.timingAdv.toFixed(1);
  if (s.maf        != null) out.maf = +s.maf.toFixed(1);
  if (s.fuelLevel  != null) out.fl  = +s.fuelLevel.toFixed(1);
  if (s.voltage    != null) out.v   = +s.voltage.toFixed(2);
  return out;
}

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
      // Full mapped samples so a recovered drive is a real, scoreable drive
      // (map + ride composure) rather than a sample-less event stub.
      samples:    state.samples.map(s => storeSample(s, state.startTime)),
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
    const drive = {
      id:             'rec_' + saved.startTs,
      score:          0,   // filled in by analyzeDrive below
      distanceMeters: saved.distanceMeters || 0,
      durationMs:     saved.durationMs     || 0,
      topSpeedMps:    saved.topSpeedMps    || 0,
      events:         saved.events         || [],
      samples:        saved.samples        || [],
      ts:             saved.startTs,
      recovered:      true,
      destination:    saved.destination || null,
      targetEtaSec:   saved.targetEtaSec || null,
      routeDistanceM: saved.routeDistanceM || null,
      // Recovered drives can't verify arrival at a destination reliably, so
      // don't award effectiveness we can't stand behind.
      effectiveness:  null,
    };
    // Score through the same engine as every other drive. Older snapshots (from
    // before samples were persisted) fall back to the neutral short-drive score.
    drive.score = Math.round(analyzeDrive(drive).score);
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
/**
 * Roll the per-sample OBD readings up into a drive-level summary.
 *
 * Returns null when no sample carried OBD data, so a GPS-only drive has no `obd`
 * key at all and the review/export layers can treat presence as "car was
 * connected". Averages are over the samples that actually reported each channel,
 * not the whole drive, so a mid-drive connect doesn't drag an average toward
 * zero. `coverage` is the fraction of samples with any OBD reading — the honest
 * signal for how much of the drive the car was actually feeding.
 */
export function summarizeObd(samples){
  const n = samples.length;
  if (!n) return null;
  const stat = key => {
    const vals = samples.map(s => s[key]).filter(v => v != null);
    if (!vals.length) return null;
    const sum = vals.reduce((a, v) => a + v, 0);
    return { avg: sum / vals.length, max: Math.max(...vals), min: Math.min(...vals), n: vals.length };
  };
  const rpm = stat('rpm'), throttle = stat('throttle'), load = stat('load'),
        hp = stat('horsepower'), nm = stat('torqueNm'), obdSpeed = stat('obdSpeed'),
        coolant = stat('coolant'), intakeTemp = stat('intakeTemp'), map = stat('map'),
        timingAdv = stat('timingAdv'), maf = stat('maf'), fuelLevel = stat('fuelLevel'),
        voltage = stat('voltage');
  const withObd = samples.filter(s =>
    s.throttle != null || s.rpm != null || s.gear != null || s.obdSpeed != null).length;
  if (!withObd) return null;

  const gears = [...new Set(samples.map(s => s.gear).filter(g => g != null))].sort((a, b) => a - b);
  const r1 = v => v == null ? null : +v.toFixed(1);
  return {
    coverage:    +(withObd / n).toFixed(3),
    samples:     withObd,
    peakRpm:     rpm ? Math.round(rpm.max) : null,
    avgRpm:      rpm ? Math.round(rpm.avg) : null,
    maxThrottle: r1(throttle?.max),
    avgThrottle: r1(throttle?.avg),
    avgLoad:     r1(load?.avg),
    peakHp:      hp ? Math.round(hp.max) : null,
    peakTorqueNm: nm ? Math.round(nm.max) : null,
    topObdSpeedMps: obdSpeed ? +obdSpeed.max.toFixed(2) : null,
    gears:       gears.length ? gears : null,
    // Slower channels — a single representative figure each, present only when
    // the car reported that reading at all.
    peakCoolant:  coolant ? Math.round(coolant.max) : null,
    avgIntakeTemp: intakeTemp ? Math.round(intakeTemp.avg) : null,
    peakMap:      map ? Math.round(map.max) : null,
    peakTimingAdv: timingAdv ? Math.round(timingAdv.max) : null,
    peakMaf:      maf ? +maf.max.toFixed(1) : null,
    minFuelLevel: fuelLevel ? Math.round(fuelLevel.min) : null,
    avgVoltage:   voltage ? +voltage.avg.toFixed(2) : null,
  };
}

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
    samples: samples.map(s => storeSample(s, state.startTime)),
    obd: summarizeObd(samples),
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
  // Need at least two fixes to measure any distance at all.
  if (state.samples.length < 2){
    if (onTooShort) onTooShort();
    if (onListUpdate) onListUpdate();
    return;
  }

  const drive = buildDriveFromState();
  // Distance is the gate, not sample count: a drive counts once it covers at
  // least MIN_DRIVE_METERS (0.3 mi). Anything shorter is a driveway roll, not a
  // drive, and shouldn't clutter history or the score.
  if ((drive.distanceMeters || 0) < MIN_DRIVE_METERS){
    if (onTooShort) onTooShort();
    if (onListUpdate) onListUpdate();
    return;
  }

  const analysis = analyzeDrive(drive);
  // Keep the full scoring breakdown on the drive (not just the 3 sub-scores) so
  // it can be stored and shown in the operator dashboard: ride composure and the
  // speed-difficulty multiplier are part of how the number was reached.
  drive.dims  = {
    ...analysis.dims,
    rideComposure: analysis.rideComposure ?? null,
    speedBonus:    analysis.speedBonus ?? null,
  };
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
  // Stamp the buffer this drive was scored under, so a drive recorded on OSRM
  // keeps its 1.2 target even after a Mapbox token later flips the app to 1.05.
  // Without this, switching providers would silently re-judge old history.
  drive.etaBuffer = etaBuffer();
  drive.effectiveness = (drive.targetEtaSec && drive.arrived)
    ? effectivenessScore(drive.targetEtaSec, moveSec, drive.etaBuffer)
    : null;
  drive.score = compositeScore(analysis.score, drive.targetEtaSec, moveSec,
    { arrived: drive.arrived, allowPenalty: penalize, buffer: drive.etaBuffer });
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

  // Your garage is part of "everything the account owns" too. It lived only in
  // localStorage, so signing in on a new phone used to bring the drives and
  // leave the cars behind. Deliberately not awaited into the return value: a
  // profile that fails to sync must never stop drives from restoring.
  syncProfile().catch(() => {});

  const rows = await fetchDrivesForUser();
  if (!rows) return null;
  const result = mergeCloudDrives(rows);
  if (result.added > 0) recomputeLifetimeScore();
  return { ...result, fetched: rows.length };
}
