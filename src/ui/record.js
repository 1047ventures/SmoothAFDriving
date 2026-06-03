import { $, $$ } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { state, calib, resetState } from '../state.js';
import { CFG, VOICE_LABELS } from '../constants.js';
import { mpsToMph, fmtDuration, clamp } from '../utils/math.js';
import { showScreen } from './router.js';
import { renderDriveList } from './home.js';
import { renderReview } from './review.js';
import { renderRecAvatar } from './garage.js';
import { finalizeAndReview } from '../services/drive.js';
import { clearActiveDrive, persistActiveDrive } from '../services/drive.js';
import { onGpsUpdate, processSample, detectEvent } from '../services/sensors/gps.js';
import { calibrateAxes, createMotionHandler } from '../services/sensors/motion.js';

export function requestMotionPermissionIfNeeded(){
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'){
    return DeviceMotionEvent.requestPermission()
      .then(res => {
        if (res === 'granted'){
          try { localStorage.setItem('smoothaf.motion_perm', 'granted'); } catch {}
          try { document.cookie = 'saf_mp=1;max-age=31536000;path=/;SameSite=Strict'; } catch {}
        }
        return res === 'granted';
      })
      .catch(() => false);
  }
  return Promise.resolve(true);
}

export function motionPermGranted(){
  try { if (localStorage.getItem('smoothaf.motion_perm') === 'granted') return true; } catch {}
  try { if (document.cookie.includes('saf_mp=1')) return true; } catch {}
  return false;
}

export function flashEvent(type, latAccel){
  const el = document.createElement('div');
  el.className = 'event-flash' + (type === 'turn' ? ' warn' : '');
  el.textContent = type === 'brake' ? 'Hard brake' : type === 'accel' ? 'Hard accel' : 'Sharp turn';
  const ticker = $('#event-ticker');
  ticker.innerHTML = '';
  ticker.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2500);

  // Flash arc color on event (lock briefly so G update doesn't override)
  const arcProg = document.getElementById('arc-progress');
  const arcSvgEl = document.getElementById('arc-svg');
  if (arcProg && arcSvgEl){
    arcProg._eventLock = true;
    const eColor = type === 'brake' ? 'rgba(224,59,47,.95)' : type === 'accel' ? 'rgba(111,182,105,.95)' : 'rgba(196,169,98,.95)';
    const eGlow  = type === 'brake' ? 'rgba(224,59,47,.65)' : type === 'accel' ? 'rgba(111,182,105,.65)' : 'rgba(196,169,98,.55)';
    arcProg.setAttribute('stroke', eColor);
    arcSvgEl.style.filter = `drop-shadow(0 0 16px ${eGlow})`;
    setTimeout(() => { arcProg._eventLock = false; }, 1200);
  }

  // Directional burst
  const burstId = type === 'brake' ? 'burst-brake'
                : type === 'accel' ? 'burst-accel'
                : (latAccel >= 0 ? 'burst-right' : 'burst-left');
  const burst = document.getElementById(burstId);
  if (burst){
    burst.classList.remove('fire');
    void burst.offsetWidth;
    burst.classList.add('fire');
    setTimeout(() => burst.classList.remove('fire'), 800);
  }
}

export function speakEvent(type){
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(VOICE_LABELS[type] || type);
  u.volume = 1; u.rate = 1.1; u.pitch = 1;
  window.speechSynthesis.speak(u);
}

export function setCalibUI(phase){
  // Only show failure — success is silent
  if (phase !== 'failed') return;
  const el = document.getElementById('calib-status');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = 'Calibration failed · GPS fallback';
  el.style.color = '#f87171';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function updateRoadUI(){ /* roughness tracked in state.currentRoughness; shown in review */ }

export function updateLiveUI(){
  // Persist every 30s so iOS reload can recover the drive
  const now = Date.now();
  if (!state._lastSave || now - state._lastSave > 30000){
    state._lastSave = now;
    persistActiveDrive();
  }

  const last = state.samples[state.samples.length - 1];
  const mph = last ? mpsToMph(last.speed || 0) : 0;
  $('#live-speed').textContent = Math.round(mph);

  // G-force value (shown as text in bottom-right stat)
  const gVal = state.lastMotionG
    ? state.lastMotionG.toFixed(2)
    : (last ? Math.min(2.5, (last.harshness||0)/9.81).toFixed(2) : '0.00');
  const gEl = $('#live-g');
  if (gEl) gEl.textContent = gVal + 'G';

  const la  = last ? (last.longAccel || 0) : 0;
  const ra  = last ? (last.latAccel  || 0) : 0;
  const isBrake = la < -0.5, isAccel = la > 0.5;

  // Cumulative live score — compute first so arc fill is in sync
  const scoreEl = document.getElementById('live-score');
  {
    const durationMins = (Date.now() - state.startTime) / 60000;
    const penalty = state.events.reduce((s, e) => {
      const w = e.type === 'brake' ? 5 : e.type === 'accel' ? 3 : 2;
      return s + w * (e.magnitude || 1);
    }, 0);
    const recovery = Math.min(durationMins * 1.5, 6);
    const score = Math.max(0, Math.min(100, Math.round(state.driveStartScore - penalty + recovery)));
    if (scoreEl) scoreEl.textContent = score;
    state.liveScore = score;
  }

  // Arc gauge: fill dashoffset from score, color + glow from driving state
  const arcProgress = document.getElementById('arc-progress');
  const arcSvg      = document.getElementById('arc-svg');
  if (arcProgress && arcSvg && !arcProgress._eventLock){
    arcProgress.style.strokeDashoffset = String(499.2 * (1 - state.liveScore / 100));
    const arcColor = isBrake ? 'rgba(224,59,47,.92)' : isAccel ? 'rgba(111,182,105,.92)' : 'rgba(244,235,217,.9)';
    const glowCol  = isBrake ? 'rgba(224,59,47,.5)'  : isAccel ? 'rgba(111,182,105,.5)'  : 'rgba(244,235,217,.28)';
    arcProgress.setAttribute('stroke', arcColor);
    arcSvg.style.filter = `drop-shadow(0 0 10px ${glowCol})`;
  }

  // G-force radar dot: x=lateral, y=longitudinal (accel=up, brake=down)
  const radarDot = document.getElementById('g-radar-dot');
  if (radarDot){
    const maxG = 1.4;
    const xPct = 50 + clamp(ra / maxG, -1, 1) * 36;
    const yPct = 50 - clamp(la / maxG, -1, 1) * 36;
    radarDot.style.left       = xPct + '%';
    radarDot.style.top        = yPct + '%';
    radarDot.style.background = isBrake ? 'rgba(224,59,47,.95)' : isAccel ? 'rgba(111,182,105,.95)' : 'rgba(244,235,217,.95)';
    radarDot.style.boxShadow  = isBrake ? '0 0 8px rgba(224,59,47,.7)' : isAccel ? '0 0 8px rgba(111,182,105,.7)' : '0 0 8px rgba(244,235,217,.5)';
  }

  // G-force radar container state glow
  const radar = document.getElementById('g-radar');
  if (radar){
    radar.classList.toggle('state-brake',  isBrake);
    radar.classList.toggle('state-accel',  !isBrake && isAccel);
    radar.classList.toggle('state-smooth', !isBrake && !isAccel);
  }

  // Drive state label (rec-state-dot + rec-state-text)
  const stateDot  = document.getElementById('rec-state-dot');
  const stateText = document.getElementById('rec-state-text');
  if (stateDot && stateText){
    const stateColor = isBrake ? '#C93828' : isAccel ? '#E8501A' : '#5A9E52';
    const stateLabel = isBrake ? 'Braking'  : isAccel ? 'Accelerating' : 'Smooth';
    stateDot.style.background = stateColor;
    stateText.textContent     = stateLabel;
    stateText.style.color     = stateColor;
  }

  // Off-screen needle — JS compat
  const needle = document.getElementById('live-g-needle');
  if (needle){ needle.style.left = (50 + clamp(la / 6, -1, 1) * 44) + '%'; }

  // Duration
  $('#live-time').textContent = fmtDuration(Date.now() - state.startTime);

  // Avg speed
  const avgMph = state.samples.length
    ? Math.round(state.samples.reduce((s, x) => s + (x.speed || 0), 0) / state.samples.length * 2.23694)
    : 0;
  $('#live-avg-speed').textContent = avgMph;

  // Distance (avg speed × elapsed time, converted to miles)
  const distEl = document.getElementById('live-distance');
  if (distEl){
    const elapsedSecs = (Date.now() - state.startTime) / 1000;
    const avgMps = state.samples.length
      ? state.samples.reduce((s, x) => s + (x.speed || 0), 0) / state.samples.length : 0;
    distEl.textContent = (avgMps * elapsedSecs / 1609.34).toFixed(1);
  }

  updateRoadUI();
}

export function startRecording(){
  if (!navigator.geolocation){
    showToast('No GPS on this device — try the Demo Drive instead', 'error');
    return;
  }
  resetState();
  state.recording = true;
  state.simulated = false;
  state.startTime = Date.now();
  $('#rec-source').textContent = 'GPS + Motion';
  showScreen('record');
  renderRecAvatar();

  // ── Phase 0: detect if already moving (skip stability wait if so) ────────
  if (navigator.geolocation){
    navigator.geolocation.getCurrentPosition(p => {
      const spd = p.coords.speed;
      if (spd != null && !Number.isNaN(spd) && spd > 2.2){
        setCalibUI('moving');
      }
    }, ()=>{}, { enableHighAccuracy:true, timeout:2000, maximumAge:2000 });
  }

  state.tickInterval = setInterval(updateLiveUI, 200);

  if ('wakeLock' in navigator){
    navigator.wakeLock.request('screen')
      .then(wl => { state.wakeLock = wl; })
      .catch(() => {});
  }

  state.gpsWatchId = navigator.geolocation.watchPosition(
    pos => onGpsUpdate(pos, {
      flashEvent,
      speakEvent,
      setCalibUI,
      calibrateAxes,
    }),
    err => {
      console.warn('GPS error', err);
      if (err.code === 1) {
        showToast('Location denied — enable in iPhone Settings to record', 'error');
        stopRecording();
      } else if (err.code === 2) {
        showToast('GPS unavailable — make sure Location is on', 'error');
        stopRecording();
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );

  // Initialise peak-hold window to now
  state.peakWindowMs = Date.now();

  // Start calibration window
  calib.active    = true;
  calib.startTime = Date.now();
  setCalibUI('calibrating');

  state.motionHandler = createMotionHandler({ flashEvent, speakEvent });
  window.addEventListener('devicemotion', state.motionHandler);
}

export function stopRecording(){
  state.recording = false;   // set immediately so persistActiveDrive can't re-save
  clearActiveDrive();
  if (state.gpsWatchId != null){
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
  }
  if (state.motionHandler){
    window.removeEventListener('devicemotion', state.motionHandler);
    state.motionHandler = null;
  }
  if (state.simTimer){ clearTimeout(state.simTimer); state.simTimer = null; }
  if (state.tickInterval){ clearInterval(state.tickInterval); state.tickInterval = null; }
  if (state.wakeLock){ state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
  state.recording = false;
  finalizeAndReview({
    onReview: renderReview,
    onListUpdate: renderDriveList,
  });
}

export function startSimulatedDrive(){
  resetState();
  state.recording = true;
  state.simulated = true;
  state.startTime = Date.now();
  $('#rec-source').textContent = 'Demo drive';
  showScreen('record');

  state.tickInterval = setInterval(updateLiveUI, 200);

  const drive = buildDemoDrive();
  const SPEED = 10;
  let i = 0;
  const stepOne = () => {
    if (!state.recording) return;
    if (i >= drive.length){ stopRecording(); return; }
    const row = drive[i];
    const s = processSample({
      t: state.startTime + row.dt,
      lat: row.lat, lon: row.lon,
      speed: row.speed, heading: row.heading,
    }, state.samples[state.samples.length - 1]);
    state.samples.push(s);
    const evt = detectEvent(s, s.t);
    if (evt){
      state.events.push({ ...evt, t: s.t, lat: s.lat, lon: s.lon, speedMph: mpsToMph(s.speed) });
      flashEvent(evt.type, state.peakLat);
      speakEvent(evt.type);
    }
    state.lastMotionG = Math.min(2.5, s.harshness / 9.81);
    i += 1;
    const nextDt = i < drive.length ? (drive[i].dt - row.dt) : 50;
    state.simTimer = setTimeout(stepOne, Math.max(10, nextDt / SPEED));
  };
  stepOne();
}

export function buildDemoDrive(){
  const out = [];
  const START = { lat: 39.7446, lon: -104.9806 };
  let { lat, lon } = START;
  let speed = 0, heading = 90, t = 0;
  const HZ = 5, step = 1000 / HZ;

  const push = () => {
    out.push({ dt: t, lat, lon, speed: Math.max(0, speed), heading: (heading+360)%360 });
    const dtSec = 1/HZ;
    lat += Math.cos(heading*Math.PI/180) * speed * dtSec / 111111;
    lon += Math.sin(heading*Math.PI/180) * speed * dtSec / (111111 * Math.cos(lat*Math.PI/180));
    t += step;
  };

  for (let i = 0; i < 8*HZ; i++){ speed += 12/(8*HZ); push(); }
  for (let i = 0; i < 20*HZ; i++){ speed += (Math.random()-0.5)*0.06; push(); }
  for (let i = 0; i < 3*HZ; i++){ speed += 10/(3*HZ); push(); }
  for (let i = 0; i < 5*HZ; i++){ speed -= 7/(5*HZ); push(); }
  for (let i = 0; i < 10*HZ; i++){ speed += (Math.random()-0.5)*0.06; push(); }
  for (let i = 0; i < 3*HZ; i++){ heading += 90/(3*HZ); push(); }
  for (let i = 0; i < 12*HZ; i++){ speed += (Math.random()-0.5)*0.06; push(); }
  for (let i = 0; i < 6*HZ; i++){ speed += 5/(6*HZ); push(); }
  for (let i = 0; i < 2.5*HZ; i++){ speed -= 14/(2.5*HZ); push(); }
  for (let i = 0; i < 5*HZ; i++){ speed = Math.max(3, speed + (Math.random()-0.5)*0.1); push(); }
  for (let i = 0; i < 2.5*HZ; i++){ heading -= 80/(2.5*HZ); push(); }
  for (let i = 0; i < 6*HZ; i++){ speed += 12/(6*HZ); push(); }
  for (let i = 0; i < 18*HZ; i++){ speed += (Math.random()-0.5)*0.08; push(); }
  for (let i = 0; i < 6*HZ; i++){ speed = Math.max(0, speed - 15/(6*HZ)); push(); }

  return out;
}

export function wireStartButton(btnId){
  const btn = $(btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const needsPermission = typeof DeviceMotionEvent !== 'undefined' &&
                            typeof DeviceMotionEvent.requestPermission === 'function';
    if (needsPermission){
      // Already granted before — call silently (iOS returns cached result)
      if (motionPermGranted()){
        await requestMotionPermissionIfNeeded();
        startRecording();
        return;
      }
      $('#perm-modal').classList.remove('hidden');
      $('#perm-allow').onclick = async () => {
        $('#perm-modal').classList.add('hidden');
        await requestMotionPermissionIfNeeded();
        startRecording();
      };
      $('#perm-skip').onclick = () => {
        $('#perm-modal').classList.add('hidden');
        startRecording();
      };
      return;
    }
    startRecording();
  });
}
