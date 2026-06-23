import { state, calib } from '../../state.js';
import {
  CFG,
  EVENT_COOLDOWN_MS,
  CALIB_MIN_PAIRS,
  MOTION_BUF_SIZE,
} from '../../constants.js';
import { dot3, normalise3, solveLS3 } from '../../utils/linalg.js';
import { mpsToMph } from '../../utils/math.js';
import { detectEventWithThresh } from './gps.js';

// Run at end of calibration window — returns true on success
export function calibrateAxes(){
  const pairs = calib.pairs;
  if (pairs.length < CALIB_MIN_PAIRS) return false;
  const rows = pairs.map(p=>[p.mx, p.my, p.mz]);

  const fRaw = solveLS3(rows, pairs.map(p=>p.gpsLong));
  const fVec = fRaw ? normalise3(fRaw) : null;
  if (!fVec) return false;

  const lRaw = solveLS3(rows, pairs.map(p=>p.gpsLat));
  const lVec = lRaw ? normalise3(lRaw) : null;
  if (!lVec) return false;

  calib.fwd = fVec;
  calib.lat = lVec;
  console.log('Calibrated fwd:', fVec.map(x=>x.toFixed(3)), 'lat:', lVec.map(x=>x.toFixed(3)));
  return true;
}

/**
 * Factory: returns the devicemotion handler function.
 * Accepts callbacks = { flashEvent, speakEvent } for UI feedback.
 */
export function createMotionHandler(callbacks = {}){
  const { flashEvent, speakEvent } = callbacks;
  return function motionHandler(ev){
    if (!state.recording) return;

    // gravity-included for orientation; pure accel for motion
    const ag = ev.accelerationIncludingGravity;
    const a  = (ev.acceleration && ev.acceleration.x != null)
               ? ev.acceleration : ag;
    if (!a) return;

    const mx = a.x||0, my = a.y||0, mz = a.z||0;
    state.lastMotionG = Math.hypot(mx, my, mz) / 9.81;

    // ── Gravity buffer for orientation/vertical axis ──────────────────────
    if (ag) {
      calib.gravBuf.push({ x: ag.x||0, y: ag.y||0, z: ag.z||0 });
      if (calib.gravBuf.length > 120) calib.gravBuf.shift();
      // Derive vertical (up) axis from mean gravity once we have enough samples
      if (!calib.up && calib.gravBuf.length >= 60) {
        const gx = calib.gravBuf.reduce((s,g)=>s+g.x,0)/calib.gravBuf.length;
        const gy = calib.gravBuf.reduce((s,g)=>s+g.y,0)/calib.gravBuf.length;
        const gz = calib.gravBuf.reduce((s,g)=>s+g.z,0)/calib.gravBuf.length;
        calib.up = normalise3([gx, gy, gz]);
      }
    }

    // ── Gyroscope availability tracking ──────────────────────────────────
    const rr = ev.rotationRate;
    const nowMs = Date.now();
    if (!rr || rr.alpha == null) {
      calib.gyroAvail = false;
    } else if (rr.alpha === 0 && rr.beta === 0 && rr.gamma === 0) {
      if (!calib.gyroZeroTs) calib.gyroZeroTs = nowMs;
      else if (nowMs - calib.gyroZeroTs > 2000) calib.gyroAvail = false;
    } else {
      calib.gyroZeroTs = 0;
      if (calib.gyroAvail !== false) calib.gyroAvail = true;
    }

    // ── Road roughness — vertical axis + gyro pitch enhancement ──────────────
    if (calib.up) {
      const vertAccel = dot3(calib.up, [mx, my, mz]);
      state.roughnessBuf.push(vertAccel);
      // Pitch rate × speed gives fore-aft rocking m/s² — catches bumps on upright-mounted phones
      if (calib.gyroAvail && rr && state.lastGpsPos) {
        const pitchContrib = Math.abs(rr.beta || 0) * (Math.PI / 180) * (state.lastGpsPos.speed || 0) * 0.5;
        state.roughnessBuf.push(pitchContrib);
      }
      if (state.roughnessBuf.length > 360) state.roughnessBuf.shift(); // 6s
      if (state.roughnessBuf.length >= 60) {
        const mean = state.roughnessBuf.reduce((s,v)=>s+v,0)/state.roughnessBuf.length;
        state.currentRoughness = Math.sqrt(
          state.roughnessBuf.reduce((s,v)=>s+(v-mean)**2,0)/state.roughnessBuf.length
        );
      }
    }

    // ── Stability monitoring (pre-calibration orientation check) ─────────
    state.stabBuf.push({ x:mx, y:my, z:mz });
    if (state.stabBuf.length > 90) state.stabBuf.shift();

    // ── Calibration motion buffer ─────────────────────────────────────────
    calib.motionBuf.push({ x:mx, y:my, z:mz });
    if (calib.motionBuf.length > MOTION_BUF_SIZE) calib.motionBuf.shift();

    // ── 60Hz event detection (post-calibration only) ──────────────────────
    if (!calib.done) return;
    const pos = state.lastGpsPos;
    if (!pos || (pos.speed||0) < 1) {
      // Stopped — zero out everything and reset peak window
      state.emaLongMotion = 0;
      state.emaLatMotion  = 0;
      state.currentJerk   = 0;
      state.peakLong      = 0;
      state.peakLat       = 0;
      state.peakWindowMs  = Date.now();
      return;
    }

    const alpha   = CFG.emaAlpha;
    const longRaw = dot3(calib.fwd, [mx, my, mz]);

    // Gyro yaw-rate lateral G: project rotationRate onto vertical axis → true cornering force
    // independent of phone mount angle. Falls back to accelerometer lateral when unavailable.
    let latRaw;
    if (calib.gyroAvail && rr && calib.up) {
      const [ux, uy, uz] = calib.up;
      const yawRateRads = (( rr.beta||0) * ux + (rr.gamma||0) * uy + (rr.alpha||0) * uz) * (Math.PI / 180);
      latRaw = yawRateRads * (pos.speed || 0);
    } else {
      latRaw = dot3(calib.lat, [mx, my, mz]);
    }

    // ── Peak-hold: track worst-case G in each axis this 500ms window ───────
    if (Math.abs(longRaw) > Math.abs(state.peakLong)) state.peakLong = longRaw;
    if (Math.abs(latRaw)  > Math.abs(state.peakLat))  state.peakLat  = latRaw;

    // ── EMA kept for jerk/shift detection only (not used for thresholds) ───
    state.prevEmaLong   = state.emaLongMotion;
    state.emaLongMotion = alpha * longRaw + (1-alpha) * state.emaLongMotion;
    state.emaLatMotion  = alpha * latRaw  + (1-alpha) * state.emaLatMotion;
    state.currentJerk   = (state.emaLongMotion - state.prevEmaLong) / 0.0167;

    // ── Every 500ms: fire detection on the window peak, then reset ─────────
    const nowT = Date.now();
    if (nowT - state.peakWindowMs >= 500) {
      if (nowT - state.lastMotionEventT >= EVENT_COOLDOWN_MS) {
        const evt = detectEventWithThresh(
          state.peakLong, state.peakLat, CFG, state.currentJerk, pos.speed || 0
        );
        if (evt){
          state.lastMotionEventT = nowT;
          const full = {
            ...evt, t: nowT, lat: pos.lat, lon: pos.lon,
            speedMph:      Math.round(mpsToMph(pos.speed || 0)),
            roadRoughness: state.currentRoughness,
          };
          state.events.push(full);
          if (flashEvent) flashEvent(evt.type, state.peakLat);
          if (speakEvent) speakEvent(evt.type);
        }
      }
      // Reset peak-hold window regardless of whether an event fired
      state.peakLong     = 0;
      state.peakLat      = 0;
      state.peakWindowMs = nowT;
    }
  };
}
