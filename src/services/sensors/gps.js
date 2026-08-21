import { state, calib } from '../../state.js';
import {
  CFG,
  EVENT_COOLDOWN_MS,
  CALIB_MIN_SPEED_MPS,
  CALIB_DURATION_MS,
  TIER_THRESH,
} from '../../constants.js';
import { clamp, mpsToMph } from '../../utils/math.js';
import { getOsmLimit, setOsmLimit } from '../storage.js';

// ── Tiered event detection ────────────────────────────────────────────────────
// tier 1 subtle (55%) · tier 2 moderate (100%) · tier 3 harsh (175%) · tier 4 extreme (260%)
// jerk events catch gear-change shocks and abrupt transmission inputs.
export function detectEventWithThresh(la, ra, cfg, jerk, speed){
  jerk  = jerk  || 0;
  speed = speed || 0; // m/s

  // Below ~4.5 mph: GPS speed noise is too high to reliably detect events.
  if (speed < 2) return null;

  // Speed-adaptive multiplier: cap at posted speed limit so speeding never loosens thresholds.
  const limit = state.currentSpeedLimitMps;
  const effSpeed = (limit != null) ? Math.min(speed, limit * 1.1) : speed;

  const longMult = effSpeed > 22.4 ? 1.35  // >50 mph — highway
                 : effSpeed > 13.4 ? 1.15  // >30 mph — suburban
                 : 1.0;                     // city

  const b = cfg.hardBrake * longMult;
  const a = cfg.hardAccel * longMult;
  // Highway speed gate: above 30 mph (13.4 m/s), turn threshold raised 2.5×.
  const t = cfg.sharpTurn * (speed > 13.4 ? 2.5 : 1.0);

  const T = TIER_THRESH;

  // ── Tier 4 — extreme ──────────────────────────────────────────────────────
  if (la < -(b * T[4])) return { type:'brake', severity: clamp((Math.abs(la)-b*T[4])/2+3.5, 3.5, 5), tier:4, la };
  if (la >  (a * T[4])) return { type:'accel', severity: clamp((la-a*T[4])/2+3.5,           3.5, 5), tier:4, la };
  if (Math.abs(ra) > t * T[4]) return { type:'turn', severity: clamp((Math.abs(ra)-t*T[4])/2+3.5, 3.5, 5), tier:4, ra };

  // ── Tier 3 — harsh ────────────────────────────────────────────────────────
  if (la < -(b * T[3])) return { type:'brake', severity: clamp((Math.abs(la)-b*T[3])/2+2.5, 2.5, 4), tier:3, la };
  if (la >  (a * T[3])) return { type:'accel', severity: clamp((la-a*T[3])/2+2.5,           2.5, 4), tier:3, la };
  if (Math.abs(ra) > t * T[3]) return { type:'turn', severity: clamp((Math.abs(ra)-t*T[3])/2+2.5, 2.5, 4), tier:3, ra };

  // ── Tier 2 — moderate ─────────────────────────────────────────────────────
  if (la < -b) return { type:'brake', severity: clamp((Math.abs(la)-b)/2+1, 1, 2.5), tier:2, la };
  if (la >  a) return { type:'accel', severity: clamp((la-a)/2+1,           1, 2.5), tier:2, la };
  if (Math.abs(ra) > t) return { type:'turn', severity: clamp((Math.abs(ra)-t)/2+1, 1, 2.5), tier:2, ra };

  // ── Tier 1 — subtle ───────────────────────────────────────────────────────
  if (la < -(b * T[1])) return { type:'brake', severity:0.6, tier:1, la };
  if (la >  (a * T[1])) return { type:'accel', severity:0.6, tier:1, la };
  if (Math.abs(ra) > t * 0.58) return { type:'turn', severity:0.6, tier:1, ra };

  // ── Gear/transmission jerk (informational only — never penalised in score) ─
  if (Math.abs(jerk) > (cfg.jerkThreshold || 5.5) && Math.abs(la) > 0.5)
    return { type:'shift', severity:0.5, tier:1 };

  return null;
}

// ── OSM speed-limit fetch ─────────────────────────────────────────────────────
function parseMaxspeed(raw){
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (['national','urban','rural','signals','none','walk','living_zone'].includes(s)) return null;
  const mph = s.match(/^([\d.]+)\s*mph$/);
  if (mph) return parseFloat(mph[1]) * 0.44704;
  const kmh = s.match(/^([\d.]+)\s*(km\/h|kph|kmh)$/);
  if (kmh) return parseFloat(kmh[1]) / 3.6;
  const num = parseFloat(s);
  if (!isNaN(num) && num > 0) return num / 3.6;
  return null;
}

let _lastOsmKey = null; // prevent duplicate fetches for the same grid cell

async function fetchAndCacheOsmLimit(lat, lon){
  try {
    const q   = `[out:json][timeout:6];way(around:50,${lat.toFixed(3)},${lon.toFixed(3)})[highway][maxspeed];out body;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6000);
    let res;
    try { res = await fetch(url, { signal: controller.signal }); }
    finally { clearTimeout(tid); }
    if (!res.ok) return;
    const data = await res.json();
    const el = data.elements?.find(e => e.tags?.maxspeed);
    if (!el) return;
    const limitMps = parseMaxspeed(el.tags.maxspeed);
    if (limitMps == null) return;
    setOsmLimit(lat, lon, limitMps);
    state.currentSpeedLimitMps = limitMps;
  } catch {}
}

// How stale an OBD reading may be before a sample is treated as OBD-less. The
// poll loop runs ~4Hz, so 2s covers a couple of dropped frames without letting
// a disconnected dongle's last value bleed across a whole drive.
const OBD_FRESH_MS = 2000;

/**
 * Copy the latest fresh OBD reading onto a GPS sample.
 *
 * Exported for the unit tests; called from onGpsUpdate for every sample. Reads
 * the shared `state.obd` that ui/obd.js publishes each poll. Only the channels
 * the car actually answered are attached — a null stays absent rather than
 * writing a column of nulls into every drive.
 */
export function attachObd(s, obd = state.obd, now = Date.now()){
  if (!obd || obd.at == null || (now - obd.at) > OBD_FRESH_MS) return s;
  if (obd.throttle   != null) s.throttle   = obd.throttle;
  if (obd.rpm        != null) s.rpm        = obd.rpm;
  if (obd.load       != null) s.load       = obd.load;
  if (obd.gear       != null) s.gear       = obd.gear;
  if (obd.gearRatio  != null) s.gearRatio  = obd.gearRatio;
  if (obd.horsepower != null) s.horsepower = obd.horsepower;
  if (obd.torqueNm   != null) s.torqueNm   = obd.torqueNm;
  // The car's wheel-speed truth, kept beside the GPS speed rather than replacing
  // it, so review can show both and scoring can choose.
  if (obd.speedMps   != null) s.obdSpeed   = obd.speedMps;
  return s;
}

export function processSample(s, prev){
  if (!prev){
    s.longAccel = 0;
    s.latAccel  = 0;
    s.jerk      = 0;
    s.harshness = 0;
    return s;
  }
  const dt = Math.max(0.05, (s.t - prev.t) / 1000);

  // Longitudinal accel from speed change (m/s per s = m/s²)
  const rawLong = ((s.speed ?? 0) - (prev.speed ?? 0)) / dt;

  // Lateral accel from heading change at current speed. Only reliable above 2 m/s.
  let latAccel = 0;
  if (s.speed != null && prev.speed != null && s.speed > 2 && prev.speed > 2 &&
      s.heading != null && prev.heading != null){
    let dh = s.heading - prev.heading;
    while (dh > 180)  dh -= 360;
    while (dh < -180) dh += 360;
    latAccel = s.speed * (dh * Math.PI/180) / dt;
  }
  // Hard flush at low speed — prevents residual EMA from triggering false turn events
  if ((s.speed ?? 0) < 2) {
    latAccel = 0;
    state.emaLatAccel = 0;
  }

  const alpha = CFG.emaAlpha;
  state.emaLongAccel = alpha * rawLong  + (1-alpha) * state.emaLongAccel;
  state.emaLatAccel  = alpha * latAccel + (1-alpha) * state.emaLatAccel;

  s.longAccel = state.emaLongAccel;
  s.latAccel  = state.emaLatAccel;
  s.jerk      = (s.longAccel - (prev.longAccel || 0)) / dt;
  s.harshness = Math.hypot(s.longAccel, s.latAccel);
  return s;
}

export function detectEvent(s, nowT){
  const lastEvent = state.events[state.events.length - 1];
  if (lastEvent && (nowT - lastEvent.t) < EVENT_COOLDOWN_MS) return null;
  return detectEventWithThresh(s.longAccel, s.latAccel, CFG, s.jerk, s.speed || 0);
}

/**
 * onGpsUpdate — called from startRecording's watchPosition callback.
 * callbacks = { flashEvent, setCalibUI, calibrateAxes, onFirstSample }
 * onFirstSample() fires once, when the very first GPS sample of the drive is
 * pushed — used by the UI to clear the "Acquiring GPS…" indicator (Fix 1).
 */
export function onGpsUpdate(pos, callbacks = {}){
  const { flashEvent, setCalibUI, calibrateAxes, onFirstSample } = callbacks;
  if (!state.recording) return;
  const c = pos.coords;
  const wasFirstSample = state.samples.length === 0;
  const prev = state.samples[state.samples.length - 1];
  let heading = c.heading;
  if ((heading == null || Number.isNaN(heading)) && prev){
    const currentSpeed = c.speed != null && !Number.isNaN(c.speed) ? c.speed : 0;
    const dLat = c.latitude - prev.lat;
    const dLon = (c.longitude - prev.lon) * Math.cos(prev.lat*Math.PI/180);
    const deltaMeters = Math.sqrt((dLat*111111)**2 + (dLon*111111)**2);
    if (currentSpeed > 3 && deltaMeters > 5 && Math.abs(dLat) + Math.abs(dLon) > 1e-7)
      heading = (Math.atan2(dLon, dLat) * 180/Math.PI + 360) % 360;
  }
  const speed = c.speed != null && !Number.isNaN(c.speed) ? Math.max(0, c.speed) : (prev ? prev.speed : 0);
  const s = processSample({ t: Date.now(), lat: c.latitude, lon: c.longitude, speed, heading }, prev);
  state.samples.push(s);
  if (wasFirstSample && onFirstSample) onFirstSample();

  // Always track latest GPS position so motion events can be geo-tagged
  state.lastGpsPos = { lat: s.lat, lon: s.lon, speed: s.speed };

  // OSM speed-limit lookup: cache-first, async fetch on miss
  const osmCached = getOsmLimit(s.lat, s.lon);
  if (osmCached != null) {
    state.currentSpeedLimitMps = osmCached;
  } else {
    const cellKey = `${s.lat.toFixed(3)}_${s.lon.toFixed(3)}`;
    if (cellKey !== _lastOsmKey) {
      _lastOsmKey = cellKey;
      fetchAndCacheOsmLimit(s.lat, s.lon);
    }
  }

  // ── Calibration pairing ──────────────────────────────────────────────────
  if (calib.active && !calib.done && s.speed >= CALIB_MIN_SPEED_MPS && prev && calib.motionBuf.length >= 4){
    // Average recent motion buffer
    const buf = calib.motionBuf;
    const mx = buf.reduce((a,m)=>a+m.x,0)/buf.length;
    const my = buf.reduce((a,m)=>a+m.y,0)/buf.length;
    const mz = buf.reduce((a,m)=>a+m.z,0)/buf.length;
    calib.pairs.push({ gpsLong: s.longAccel, gpsLat: s.latAccel, mx, my, mz });

    const elapsed = Date.now() - calib.startTime;
    if (elapsed >= CALIB_DURATION_MS || calib.pairs.length >= 20){
      calib.active = false;
      const ok = calibrateAxes ? calibrateAxes() : false;
      calib.done   = ok;
      calib.failed = !ok;
      if (setCalibUI) setCalibUI(ok ? 'done' : 'failed');
    }
  }

  // Store road roughness snapshot with each GPS sample
  s.roadRoughness = state.currentRoughness;

  // Fold in the car's own numbers when a fresh OBD reading exists. Attached to
  // the sample so the recorded drive carries throttle/RPM/gear alongside the GPS
  // track — the raw material for OBD-aware scoring, export and review. A stale
  // reading (dongle dropped) is left off rather than smeared forward.
  attachObd(s);

  // ── Event detection ──────────────────────────────────────────────────────
  // After successful calibration, motion handler detects at 60Hz — skip here.
  // Before/if calibration failed, fall back to GPS 1Hz detection.
  if (!calib.done){
    const evt = detectEvent(s, s.t);
    if (evt){
      const full = {
        ...evt, t: s.t, lat: s.lat, lon: s.lon,
        speedMph: mpsToMph(s.speed),
        roadRoughness: state.currentRoughness,
      };
      state.events.push(full);
      if (flashEvent) flashEvent(evt.type, state.peakLat, full.tier);
    }
  }
}
