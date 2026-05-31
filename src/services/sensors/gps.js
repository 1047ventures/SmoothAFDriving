import { state, calib } from '../../state.js';
import {
  CFG,
  EVENT_COOLDOWN_MS,
  CALIB_MIN_SPEED_MPS,
  CALIB_DURATION_MS,
} from '../../constants.js';
import { clamp, mpsToMph } from '../../utils/math.js';

// ── Tiered event detection ────────────────────────────────────────────────────
// tier 1 = subtle (55% of threshold) · tier 2 = moderate · tier 3 = harsh (175%)
// jerk events catch gear-change shocks and abrupt transmission inputs.
export function detectEventWithThresh(la, ra, cfg, jerk, speed){
  jerk  = jerk  || 0;
  speed = speed || 0; // m/s
  const b = cfg.hardBrake, a = cfg.hardAccel;
  // Highway speed gate: above 30 mph (13.4 m/s), turn threshold doubled.
  const t = cfg.sharpTurn * (speed > 13.4 ? 2.5 : 1.0);

  // ── Tier 3 — harsh ────────────────────────────────────────────────────────
  if (la < -(b * 1.75)) return { type:'brake', severity: clamp((Math.abs(la)-b*1.75)/2+2.5, 2.5, 4), tier:3, la };
  if (la >  (a * 1.75)) return { type:'accel', severity: clamp((la-a*1.75)/2+2.5,           2.5, 4), tier:3, la };
  if (Math.abs(ra) > t * 1.75) return { type:'turn', severity: clamp((Math.abs(ra)-t*1.75)/2+2.5, 2.5, 4), tier:3, ra };

  // ── Tier 2 — moderate ─────────────────────────────────────────────────────
  if (la < -b) return { type:'brake', severity: clamp((Math.abs(la)-b)/2+1, 1, 2.5), tier:2, la };
  if (la >  a) return { type:'accel', severity: clamp((la-a)/2+1,           1, 2.5), tier:2, la };
  if (Math.abs(ra) > t) return { type:'turn', severity: clamp((Math.abs(ra)-t)/2+1, 1, 2.5), tier:2, ra };

  // ── Tier 1 — subtle ───────────────────────────────────────────────────────
  if (la < -(b * 0.55)) return { type:'brake', severity:0.6, tier:1, la };
  if (la >  (a * 0.55)) return { type:'accel', severity:0.6, tier:1, la };
  if (Math.abs(ra) > t * 0.58) return { type:'turn', severity:0.6, tier:1, ra };

  // ── Gear/transmission jerk (informational only — never penalised in score) ─
  if (Math.abs(jerk) > (cfg.jerkThreshold || 5.5) && Math.abs(la) > 0.5)
    return { type:'shift', severity:0.5, tier:1 };

  return null;
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
 * callbacks = { flashEvent, speakEvent, setCalibUI, calibrateAxes }
 */
export function onGpsUpdate(pos, callbacks = {}){
  const { flashEvent, speakEvent, setCalibUI, calibrateAxes } = callbacks;
  if (!state.recording) return;
  const c = pos.coords;
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

  // Always track latest GPS position so motion events can be geo-tagged
  state.lastGpsPos = { lat: s.lat, lon: s.lon, speed: s.speed };

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
      if (flashEvent) flashEvent(evt.type, state.peakLat);
      if (speakEvent) speakEvent(evt.type);
    }
  }
}
