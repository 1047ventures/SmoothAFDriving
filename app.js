/* =========================================================================
   Smooth AF — Driving tracker
   Proprietary single-file PWA. No backend.
   Data flow:
     GPS (watchPosition)  ───┐
                             ├──►  processSample() ──►  event detection
     DeviceMotion (60Hz)  ───┘         (derivative + EMA + jerk)

     On stop:   render Leaflet map with polyline colored by local harshness,
                plus markers at each detected event, plus summary panel.

     Desktop or DeviceMotion unavailable:  replay embedded demo drive.
   ========================================================================= */

// -------------------------------------------------------------------------
// DOM helpers
// -------------------------------------------------------------------------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// -------------------------------------------------------------------------
// Globals
// -------------------------------------------------------------------------
const STORAGE_KEY  = 'smoothaf.drives.v1';
const DEVICE_KEY   = 'smoothaf.device_id';
const SYNCED_KEY   = 'smoothaf.synced_ids';

// ── Vehicle types — imgFront: home screen, imgRear: recording screen ──────────
const VEHICLE_KEY = 'smoothaf.vehicle_type';
const VEHICLE_TYPES = [
  { id:'sedan',      label:'Sedan',        icon:'🚗' },
  { id:'crossover',  label:'Crossover',    icon:'🚙' },
  { id:'suv',        label:'Lux SUV',      icon:'🚐',
    imgFront:'vehicles/suv-front.jpg', imgRear:'vehicles/suv-rear.jpg' },
  { id:'sports',     label:'Sports Car',   icon:'🏎️' },
  { id:'convertible',label:'Convertible',  icon:'🚘' },
  { id:'truck',      label:'Pickup Truck', icon:'🛻' },
  { id:'hatchback',  label:'Hatchback',    icon:'🚗' },
  { id:'electric',   label:'Electric',     icon:'⚡' },
];
const MAX_STORED_DRIVES = 20;

// ── Supabase ──────────────────────────────────────────────────────────────────
const SB_URL    = 'https://dbreetxubxdxogmektxc.supabase.co';
const SB_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRicmVldHh1YnhkeG9nbWVrdHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjY5ODgsImV4cCI6MjA5MjkwMjk4OH0.hMeEhYpNNgZ67Nh9GnjwJvtSBbdQVhbdjiBBNNG5qe4';

function getDeviceId(){
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id){
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function getSyncedIds(){
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY) || '[]')); }
  catch { return new Set(); }
}
function markSynced(driveId){
  const ids = getSyncedIds();
  ids.add(driveId);
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids])); } catch {}
}

async function pushDriveToSupabase(drive){
  if (!drive || !drive.startTime) return;
  const driveId = String(drive.startTime); // stable local ID
  if (getSyncedIds().has(driveId)) return;  // already uploaded
  try {
    const payload = {
      device_id:       getDeviceId(),
      start_time:      drive.startTime,
      duration_ms:     drive.durationMs,
      distance_meters: drive.distanceMeters,
      top_speed_mps:   drive.topSpeedMps,
      score:           drive.score,
      event_count:     drive.eventCount,
      simulated:       !!drive.simulated,
      settings:        drive.settingsSnapshot || null,
      samples:         drive.samples,
      events:          drive.events,
    };
    const res = await fetch(`${SB_URL}/rest/v1/drives`, {
      method: 'POST',
      headers: {
        'apikey':        SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) markSynced(driveId);
  } catch { /* offline – will retry on next startup */ }
}

// Sync any drives that weren't uploaded yet (e.g. was offline during drive)
function syncPendingDrives(){
  const drives = loadDrives();
  drives.forEach(d => pushDriveToSupabase(d));
}

const DEFAULTS = {
  // ── Detection thresholds (tier-2 baseline) ───────────────────────────────
  // Tier 1 fires at 55% of these, tier 3 at 175%.
  // Raised from previous values — GPS-derived lateral G has too much noise at low thresholds.
  hardBrake:     3.8,   // m/s²
  hardAccel:     3.2,   // m/s²
  sharpTurn:     3.8,   // m/s² lateral — GPS heading jitter was causing false highway events
  emaAlpha:      0.25,  // more smoothing vs 0.32 — filters single-sample GPS spikes
  jerkThreshold: 5.5,   // m/s³ — gear-change / abrupt transmission event
  // ── Tier-2 base penalties (multiplied by tier factor below) ─────────────
  penaltyBrake:  4.5,
  penaltyAccel:  3.2,
  penaltyTurn:   4.0,
  // ── Tier multipliers: tier1 × 0.14, tier2 × 1.0, tier3 × 2.4 ───────────
};

const CFG = { ...DEFAULTS };

const state = {
  screen: 'home',
  recording: false,
  simulated: false,
  samples: [],
  events: [],
  startTime: 0,
  lastMotionG: 0,
  emaLongAccel: 0,      // GPS-based EMA (fallback / track)
  emaLatAccel: 0,
  emaLongMotion: 0,     // Motion 60Hz EMA (kept for jerk/shift only)
  emaLatMotion: 0,
  prevEmaLong: 0,
  currentJerk: 0,       // m/s³ — jerk = Δlong/Δt at 60Hz
  peakLong: 0,          // peak-hold: worst longitudinal in current 500ms window
  peakLat: 0,           // peak-hold: worst lateral in current 500ms window
  peakWindowMs: 0,      // start timestamp of current peak-hold window
  lastMotionEventT: -Infinity,
  lastGpsPos: null,
  // Road roughness
  roughnessBuf: [],     // rolling buffer of vertical accel samples
  currentRoughness: 0,  // RMS noise of vertical axis (m/s²)
  // Stability / orientation
  stabBuf: [],          // pre-recording stability buffer [{x,y,z,gx,gy,gz}]
  gpsWatchId: null,
  motionHandler: null,
  simTimer: null,
  liveScore: 100,
  tickInterval: null,
  wakeLock: null,
};

const EVENT_COOLDOWN_MS    = 1500; // 1.5s — prevents one brake from logging 3 events
const CALIB_DURATION_MS    = 10000; // 10s calibration window
const CALIB_MIN_PAIRS      = 5;     // need at least 5 GPS↔motion pairs
const CALIB_MIN_SPEED_MPS  = 2;     // only pair samples when moving
const MOTION_BUF_SIZE      = 20;    // ring buffer depth (60Hz → ~330ms)

// ── Calibration state (reset each drive) ─────────────────────────────────────
let calib = {
  active:    false,   // collecting pairs
  done:      false,   // axes solved — use 60Hz motion detection
  failed:    false,   // couldn't solve — fall back to GPS 1Hz
  pairs:     [],      // [{gpsLong, gpsLat, mx, my, mz}]
  fwd:       null,    // [fx, fy, fz] normalised forward unit vector
  lat:       null,    // [lx, ly, lz] normalised lateral unit vector
  motionBuf: [],      // recent raw {x,y,z} at 60Hz
  startTime: 0,
};

function resetCalib(){
  calib = { active:false, done:false, failed:false, pairs:[],
            fwd:null, lat:null, up:null, motionBuf:[], gravBuf:[], startTime:0 };
}

// ── 3-D linear algebra helpers ────────────────────────────────────────────────
function dot3(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function norm3(v){ return Math.hypot(v[0], v[1], v[2]); }
function normalise3(v){ const n=norm3(v); return n<1e-9?null:v.map(x=>x/n); }

// Gaussian elimination — solves 3×3 system Mv = b, returns v or null
function gaussElim3(M, b){
  const A = M.map((r,i)=>[...r, b[i]]);
  for (let col=0; col<3; col++){
    let maxR=col;
    for (let r=col+1; r<3; r++) if (Math.abs(A[r][col])>Math.abs(A[maxR][col])) maxR=r;
    [A[col],A[maxR]]=[A[maxR],A[col]];
    if (Math.abs(A[col][col])<1e-10) return null;
    for (let r=col+1; r<3; r++){
      const f=A[r][col]/A[col][col];
      for (let k=col;k<=3;k++) A[r][k]-=f*A[col][k];
    }
  }
  const x=[0,0,0];
  for (let i=2;i>=0;i--){
    x[i]=A[i][3];
    for (let j=i+1;j<3;j++) x[i]-=A[i][j]*x[j];
    x[i]/=A[i][i];
  }
  return x;
}

// Least-squares: finds v such that A*v ≈ b (overconstrained 3-D regression)
function solveLS3(rows, b){
  const ATA=[[0,0,0],[0,0,0],[0,0,0]], ATb=[0,0,0];
  rows.forEach((r,i)=>{
    for (let j=0;j<3;j++){
      ATb[j]+=r[j]*b[i];
      for (let k=0;k<3;k++) ATA[j][k]+=r[j]*r[k];
    }
  });
  return gaussElim3(ATA, ATb);
}

// Run at end of calibration window — returns true on success
function calibrateAxes(){
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
  console.log('✅ Calibrated fwd:', fVec.map(x=>x.toFixed(3)), 'lat:', lVec.map(x=>x.toFixed(3)));
  return true;
}

// -------------------------------------------------------------------------
// Utility math
// -------------------------------------------------------------------------
const mpsToMph = mps => mps * 2.2369362920544;
const metersToMiles = m => m / 1609.344;
const fmtDuration = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
};
const fmtScore = n => Math.max(0, Math.min(100, Math.round(n)));

function haversine(a, b){
  const R = 6371000;
  const toRad = x => x * Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la = toRad(a.lat), lb = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function harshnessToColor(h){
  if (h < 1.4) return '#6FB669';
  if (h < 2.4) return '#B6B85A';
  if (h < 3.2) return '#C48B3A';
  if (h < 4.0) return '#E8A03A';
  return '#E03B2F';
}

// Color route segments by dominant force type — shows what the driver was doing, not just severity.
// la < 0 = braking (red scale), la > 0 = accel (amber scale), |ra| dominant = turn (gold scale)
function forceSegmentColor(la, ra){
  const DEAD  = 0.12; // m/s² dead-band — below this reads as coast
  const bMag  = la < -DEAD ? Math.abs(la) : 0;
  const aMag  = la >  DEAD ? la : 0;
  const tMag  = Math.abs(ra || 0) > DEAD ? Math.abs(ra) : 0;
  const dom   = Math.max(bMag, aMag, tMag);
  if (dom < DEAD) return '#6FB669'; // coasting — green
  if (bMag >= aMag && bMag >= tMag){
    if (bMag > 3.0) return '#E03B2F';
    if (bMag > 1.5) return '#D86040';
    if (bMag > 0.6) return '#C08060';
    return '#A89080';
  }
  if (aMag >= bMag && aMag >= tMag){
    if (aMag > 2.5) return '#E8A03A';
    if (aMag > 1.2) return '#C8B040';
    if (aMag > 0.5) return '#A8B858';
    return '#88B870';
  }
  // Turning dominant
  if (tMag > 3.0) return '#C4A962';
  if (tMag > 1.5) return '#A8A870';
  return '#8AAE78';
}

// -------------------------------------------------------------------------
// Core algorithm: derive longitudinal / lateral accel + jerk from GPS series
// -------------------------------------------------------------------------
function processSample(s, prev){
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

function detectEvent(s, nowT){
  const lastEvent = state.events[state.events.length - 1];
  if (lastEvent && (nowT - lastEvent.t) < EVENT_COOLDOWN_MS) return null;
  return detectEventWithThresh(s.longAccel, s.latAccel, CFG, s.jerk, s.speed || 0);
}

// ── Tiered event detection ────────────────────────────────────────────────────
// tier 1 = subtle (55% of threshold) · tier 2 = moderate · tier 3 = harsh (175%)
// jerk events catch gear-change shocks and abrupt transmission inputs.
function detectEventWithThresh(la, ra, cfg, jerk, speed){
  jerk  = jerk  || 0;
  speed = speed || 0; // m/s
  const b = cfg.hardBrake, a = cfg.hardAccel;
  // Highway speed gate: above 30 mph (13.4 m/s), turn threshold doubled.
  // GPS heading noise at freeway speed makes lateral G unreliable — only flag extreme maneuvers.
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

// ── Scoring ───────────────────────────────────────────────────────────────────
// Target distribution: avg 80-85 · great 90-95 · world-class 97+
// Road roughness reduces penalties up to 35% — bumpy roads aren't the driver's fault.
// Shift events are tracked but NEVER penalised (informational only).
const TIER_MULT = { 1: 0.14, 2: 1.0, 3: 2.4 };
// Confidence weighting: blend raw score toward 100 for short drives.
// CONFIDENCE_PRIOR = 120 GPS samples ≈ 2 minutes. At exactly 2 min of data,
// the raw score is weighted 50% — prevents 30-second test drives showing 100.
const CONFIDENCE_PRIOR = 120;

function scoreFromEvents(events, cfg, sampleCount){
  cfg = cfg || CFG;
  const basePenalty = { brake: cfg.penaltyBrake, accel: cfg.penaltyAccel, turn: cfg.penaltyTurn };
  let score = 100;
  for (const e of events){
    if (e.type === 'shift') continue;  // informational only, never deduct points
    const base     = basePenalty[e.type] || 3;
    const tier     = TIER_MULT[e.tier || 2] || 1;
    // Road roughness: up to 35% penalty reduction on very rough roads
    const roughAdj = 1 - Math.min(0.35, (e.roadRoughness || 0) / 3.5);
    score -= base * tier * (e.severity || 1) * roughAdj;
  }
  // Confidence weighting: short drives blend toward 100
  if (sampleCount != null && sampleCount > 0){
    score = (sampleCount * score + CONFIDENCE_PRIOR * 100) / (sampleCount + CONFIDENCE_PRIOR);
  }
  return fmtScore(score);
}

// Re-score a stored drive using new CFG (uses pre-computed la/ra per sample)
function rescoreDrive(drive, cfg){
  const events = [];
  let lastEventT = -Infinity;
  for (const s of drive.samples){
    if ((s.t - lastEventT) < EVENT_COOLDOWN_MS) continue;
    const evt = detectEventWithThresh(s.la || 0, s.ra || 0, cfg, 0, s.speed || 0);
    if (evt){
      events.push({
        ...evt,
        t: s.t, lat: s.lat, lon: s.lon,
        speedMph: Math.round(mpsToMph(s.speed || 0)),
      });
      lastEventT = s.t;
    }
  }
  return {
    ...drive,
    events,
    eventCount: events.length,
    score: scoreFromEvents(events, cfg, drive.samples.length),
  };
}

function rescoreAllDrives(){
  const all = loadDrives();
  const rescored = all.map(d => rescoreDrive(d, CFG));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rescored)); } catch {}
  return rescored;
}

// =========================================================================
// Seven-Dimension Continuous Scoring
// =========================================================================

const DIM_WEIGHTS = {
  peakHarshness: 0.20,
  throttle:      0.20,
  steering:      0.10,
  braking:       0.15,
  cornering:     0.10,
  transitions:   0.10,
  momentum:      0.15,
};

const DIM_DISPLAY = [
  { key: 'peakHarshness', label: 'Peak Harshness'       },
  { key: 'throttle',      label: 'Throttle Steadiness'  },
  { key: 'steering',      label: 'Steering Steadiness'  },
  { key: 'braking',       label: 'Braking Anticipation' },
  { key: 'cornering',     label: 'Corner Composure'     },
  { key: 'transitions',   label: 'Transition Smoothness'},
  { key: 'momentum',      label: 'Momentum Management'  },
];

function pct(sortedArr, p){
  if (!sortedArr.length) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sortedArr[lo] : sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function linMap(val, inLo, inHi, outLo, outHi){
  const t = Math.max(0, Math.min(1, (val - inLo) / (inHi - inLo)));
  return outLo + t * (outHi - outLo);
}

function dimColor(n){ return n >= 80 ? 'var(--good)' : n >= 55 ? 'var(--warn)' : 'var(--danger)'; }

function analyzeDrive(drive){
  const smp = drive.samples || [];
  const n   = smp.length;
  if (n < 3){
    const dims = { peakHarshness:85, throttle:85, steering:85, braking:85, cornering:85, transitions:85, momentum:85 };
    return { score:85, dims, fullStops:0, stopsPerMile:0, longFlipsPerMin:0, latFlipsPerMin:0, p90Harshness:0 };
  }

  const durationMin = (drive.durationMs || 0) / 60000;
  const distanceMi  = metersToMiles(drive.distanceMeters || 0);

  // ── 1. Peak Harshness — p90 of harshness magnitude ───────────────────────
  const hSorted = smp.map(s => s.h || 0).sort((a,b) => a - b);
  const p90H    = pct(hSorted, 90);
  const peakHarshness = Math.round(clamp(linMap(p90H, 0.3, 4.0, 100, 0), 0, 100)); // ← tune

  // ── 2. Throttle Steadiness — rapid longitudinal sign-flip rate ───────────
  // "Rapid" = sign flips within LONG_WIN samples of the previous flip.
  const LONG_WIN  = 8;    // ← tune (GPS samples, ~8 s)
  const LONG_DEAD = 0.15; // ← tune (m/s² dead-band, ignore near-zero la)
  let longFlips = 0, lastLSign = 0, lastLFlip = -Infinity;
  for (let i = 0; i < n; i++){
    const la = smp[i].la || 0;
    if (Math.abs(la) < LONG_DEAD) continue;
    const sg = la > 0 ? 1 : -1;
    if (lastLSign !== 0 && sg !== lastLSign){
      if (i - lastLFlip <= LONG_WIN) longFlips++;
      lastLFlip = i;
    }
    lastLSign = sg;
  }
  const longFlipsPerMin = durationMin > 0 ? longFlips / durationMin : 0;
  const throttle = Math.round(clamp(linMap(longFlipsPerMin, 0, 8, 100, 0), 0, 100)); // ← tune

  // ── 3. Steering Steadiness — rapid lateral sign-flip rate ────────────────
  const LAT_WIN  = 6;    // ← tune
  const LAT_DEAD = 0.15; // ← tune
  let latFlips = 0, lastRSign = 0, lastRFlip = -Infinity;
  for (let i = 0; i < n; i++){
    const ra = smp[i].ra || 0;
    if (Math.abs(ra) < LAT_DEAD) continue;
    const sg = ra > 0 ? 1 : -1;
    if (lastRSign !== 0 && sg !== lastRSign){
      if (i - lastRFlip <= LAT_WIN) latFlips++;
      lastRFlip = i;
    }
    lastRSign = sg;
  }
  const latFlipsPerMin = durationMin > 0 ? latFlips / durationMin : 0;
  const steering = Math.round(clamp(linMap(latFlipsPerMin, 0, 10, 100, 0), 0, 100)); // ← tune

  // ── 4. Braking Anticipation — approach quality for each stop ─────────────
  // Approach: from last time speed > STOP_ENTRY until speed < STOP_EXIT.
  const STOP_ENTRY = 2.2;  // m/s ← tune
  const STOP_EXIT  = 0.9;  // m/s ← tune
  const LOOK_BACK  = 30;   // samples ← tune
  let stopScores = [], wasMoving = false;
  for (let i = 1; i < n; i++){
    if ((smp[i-1].speed || 0) > STOP_ENTRY) wasMoving = true;
    if (wasMoving && (smp[i].speed || 0) < STOP_EXIT){
      wasMoving = false;
      const start = Math.max(0, i - LOOK_BACK);
      let decelSum = 0, decelN = 0;
      for (let j = start; j < i; j++){
        const la = smp[j].la || 0;
        if (la < 0){ decelSum += Math.abs(la); decelN++; }
      }
      const approachLen  = i - start;
      const avgDecel     = decelN > 0 ? decelSum / decelN : 0;
      const lenScore   = clamp(linMap(approachLen, 5, 20, 0, 100), 0, 100); // ← tune
      const decelScore = clamp(linMap(avgDecel, 2.0, 0.5, 0, 100), 0, 100); // ← tune
      stopScores.push((lenScore + decelScore) / 2);
    }
  }
  const braking = stopScores.length > 0
    ? Math.round(stopScores.reduce((a,b) => a+b, 0) / stopScores.length)
    : 85; // ← tune (default when no stops detected)

  // ── 5. Corner Composure — simultaneous braking + lateral force ───────────
  const CORN_LA = -0.5; // ← tune
  const CORN_RA =  0.8; // ← tune
  let cornerCount = 0;
  for (const s of smp){
    if ((s.la || 0) < CORN_LA && Math.abs(s.ra || 0) > CORN_RA) cornerCount++;
  }
  const cornerPct = n > 0 ? cornerCount / n : 0;
  const cornering = Math.round(clamp(linMap(cornerPct, 0, 0.08, 100, 0), 0, 100)); // ← tune

  // ── 6. Transition Smoothness — mean jerk magnitude ───────────────────────
  let jerkSum = 0, jerkN = 0;
  for (let i = 1; i < n; i++){
    const dt  = Math.max(0.1, (smp[i].t - smp[i-1].t) / 1000);
    jerkSum  += Math.abs(((smp[i].la || 0) - (smp[i-1].la || 0)) / dt);
    jerkN++;
  }
  const meanJerk  = jerkN > 0 ? jerkSum / jerkN : 0;
  const transitions = Math.round(clamp(linMap(meanJerk, 0.3, 3.0, 100, 0), 0, 100)); // ← tune

  // ── 7. Momentum Management — full stops per mile ─────────────────────────
  const STOP_SPD = 0.5;   // m/s ← tune
  const STOP_MS  = 1500;  // ms  ← tune
  let fullStops = 0, stopStartIdx = -1;
  const stopMarkers = [];
  function recordStop(startIdx, endIdx){
    const durMs = smp[endIdx].t - smp[startIdx].t;
    if (durMs < STOP_MS) return;
    fullStops++;
    const mid = Math.round((startIdx + endIdx) / 2);
    const approachIdx = Math.max(0, startIdx - 1);
    stopMarkers.push({
      lat: smp[mid].lat, lon: smp[mid].lon,
      t: smp[startIdx].t, durationMs: durMs,
      speedMph: Math.round(mpsToMph(smp[approachIdx].speed || 0))
    });
  }
  for (let i = 0; i < n; i++){
    const spd = smp[i].speed || 0;
    if (spd < STOP_SPD && stopStartIdx < 0)  stopStartIdx = i;
    if (spd >= STOP_SPD && stopStartIdx >= 0){ recordStop(stopStartIdx, i); stopStartIdx = -1; }
  }
  if (stopStartIdx >= 0) recordStop(stopStartIdx, n - 1);
  const stopsPerMile = distanceMi > 0 ? fullStops / distanceMi : 0;
  const momentum = Math.round(clamp(linMap(stopsPerMile, 0, 6, 100, 0), 0, 100)); // ← tune

  // ── Composite ─────────────────────────────────────────────────────────────
  const dims = { peakHarshness, throttle, steering, braking, cornering, transitions, momentum };
  const score = Math.round(
    Object.entries(DIM_WEIGHTS).reduce((s, [k,w]) => s + (dims[k] || 0) * w, 0)
  );

  return { score, dims, fullStops, stopsPerMile: +stopsPerMile.toFixed(2),
           stopMarkers,
           longFlipsPerMin: +longFlipsPerMin.toFixed(1),
           latFlipsPerMin:  +latFlipsPerMin.toFixed(1),
           p90Harshness:    +p90H.toFixed(2) };
}

function driveCoaching(analysis){
  const { dims, stopsPerMile, longFlipsPerMin, latFlipsPerMin, p90Harshness, fullStops } = analysis;
  const cards = [];

  // Worst 2 dimensions below threshold → warning cards
  const ranked = Object.entries(dims).sort((a,b) => a[1] - b[1]);
  let warned = 0;
  for (const [key, score] of ranked){
    if (warned >= 2 || score >= 70) break;
    const texts = {
      peakHarshness: { title: 'Harsh inputs detected',
        body: `Your 90th-percentile harshness was ${p90Harshness.toFixed(2)} m/s² — aim for under 0.8. Feather the brakes and smooth your turn entries.` },
      throttle:      { title: 'Throttle pumping',
        body: `You toggled between gas and brake ~${longFlipsPerMin.toFixed(1)}× per minute. Aim for under 3/min by coasting more and reading stops earlier.` },
      steering:      { title: 'Frequent steering corrections',
        body: `Lateral direction reversed ~${latFlipsPerMin.toFixed(1)}× per minute. Look further ahead — your hands follow your eyes.` },
      braking:       { title: 'Late braking',
        body: `Stops came with short approach distances and sharp decel. Spot brake zones earlier and ease in gradually over a longer runway.` },
      cornering:     { title: 'Braking mid-corner',
        body: `Simultaneous braking and lateral force hurts balance. Brake before the apex, not through it.` },
      transitions:   { title: 'Jerky pedal transitions',
        body: `High jerk between pedal phases — blend smoothly between braking, coasting, and acceleration.` },
      momentum:      { title: `${fullStops} full stop${fullStops !== 1 ? 's' : ''}`,
        body: `${stopsPerMile.toFixed(1)} stops/mile. Read lights and traffic to maintain a rolling pace — the goal is to never fully stop.` },
    };
    if (texts[key]){ cards.push({ type: 'warning', ...texts[key] }); warned++; }
  }

  // Best dimension ≥ 80 → positive card
  const [bestKey, bestScore] = ranked[ranked.length - 1];
  if (bestScore >= 80){
    const praise = {
      peakHarshness: { title: 'Impressively smooth inputs',
        body: `Your 90th-percentile harshness was just ${p90Harshness.toFixed(2)} m/s². Passengers felt barely a ripple.` },
      throttle:      { title: 'Steady throttle control',
        body: `Only ${longFlipsPerMin.toFixed(1)} throttle reversals per minute — smooth progressive pedal work.` },
      steering:      { title: 'Committed steering lines',
        body: `Lateral corrections at just ${latFlipsPerMin.toFixed(1)}/min — you tracked your intended path confidently.` },
      braking:       { title: 'Excellent braking anticipation',
        body: `Long, gentle approaches to every stop — exactly what the car and your passengers want.` },
      cornering:     { title: 'Clean corner exits',
        body: `Minimal braking-while-cornering. Textbook corner entry technique.` },
      transitions:   { title: 'Silky pedal transitions',
        body: `Very low jerk between phases. Passengers won't even reach for the grab handle.` },
      momentum:      { title: 'Excellent momentum management',
        body: `Only ${fullStops} full stop${fullStops !== 1 ? 's' : ''} (${stopsPerMile.toFixed(1)}/mile). You read the road and kept rolling.` },
    };
    if (praise[bestKey]) cards.push({ type: 'positive', ...praise[bestKey] });
  }

  if (!cards.length)
    cards.push({ type: 'positive', title: 'Smooth AF', body: 'Strong across all seven dimensions. Your passengers felt the difference.' });

  return cards;
}

// -------------------------------------------------------------------------
// LocalStorage — drives
// -------------------------------------------------------------------------
function loadDrives(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveDrives(all){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_STORED_DRIVES))); } catch {}
}
function saveDrive(drive){
  const all = loadDrives();
  all.unshift(drive);
  saveDrives(all);
}
function toggleFavoriteDrive(idx){
  const all = loadDrives();
  if (!all[idx]) return;
  all[idx].starred = !all[idx].starred;
  saveDrives(all);
  renderDriveList();
}
function deleteDrive(idx){
  const all = loadDrives();
  all.splice(idx, 1);
  saveDrives(all);
  renderDriveList();
}

function getDriverPersona(drives){
  if (!drives || drives.length < 2) return null;
  const totalMi   = drives.reduce((s,d) => s + metersToMiles(d.distanceMeters||0), 0);
  const avgMi     = totalMi / drives.length;
  const avgScore  = Math.round(drives.reduce((s,d) => s + (d.score||0), 0) / drives.length);
  const avgTop    = drives.reduce((s,d) => s + (d.topSpeedMps||0), 0) / drives.length * 2.237; // mph
  const avgDurMin = drives.reduce((s,d) => s + (d.durationMs||0), 0) / drives.length / 60000;

  // Classify drive type by top speed and trip length
  const hiwayCnt  = drives.filter(d => (d.topSpeedMps||0)*2.237 > 60).length;
  const cityRatio = 1 - hiwayCnt / drives.length;
  const isHighway = hiwayCnt / drives.length > 0.55;
  const isCity    = cityRatio > 0.65;
  const isMixed   = !isHighway && !isCity;
  const isLong    = avgMi > 20;
  const isShort   = avgMi < 5;
  const isSmooth  = avgScore >= 85;
  const isRough   = avgScore < 65;

  let title, sub;
  if (isHighway && isLong && isSmooth){
    title = 'Mile-Eater';
    sub   = `Cruising ${Math.round(avgMi)} mi avg at highway pace. Clean, consistent, unfazed.`;
  } else if (isHighway && isLong && isRough){
    title = 'Highway Charger';
    sub   = `Long hauls, fast pace, heavy inputs. Smooth it out and save on fuel.`;
  } else if (isCity && isShort && isSmooth){
    title = 'Urban Ghost';
    sub   = `Threading city blocks like water. ${Math.round(avgDurMin)} min trips, almost no drama.`;
  } else if (isCity && isShort && isRough){
    title = 'Stop-Light Sprinter';
    sub   = `Short hops, hard stops. Ease off the pedal and your score will climb.`;
  } else if (isCity && isSmooth){
    title = 'City Glider';
    sub   = `Reading traffic before it happens. Smooth across ${drives.length} city drives.`;
  } else if (isMixed && isSmooth){
    title = 'All-Roads Driver';
    sub   = `Highways, surface streets — handles both clean. ${Math.round(totalMi)} mi logged.`;
  } else if (isMixed && !isSmooth){
    title = 'Mixed-Bag Driver';
    sub   = `All kinds of roads, all kinds of inputs. Consistency will push that score up.`;
  } else if (isHighway){
    title = 'Open Road Cruiser';
    sub   = `Happiest at speed. Avg ${Math.round(avgTop)} mph top, ${Math.round(avgMi)} mi per drive.`;
  } else {
    title = 'Daily Driver';
    sub   = `${drives.length} drives, ${Math.round(totalMi)} mi total. Avg score ${avgScore}.`;
  }
  return {title, sub, avgScore, drives: drives.length, totalMi: Math.round(totalMi)};
}

function renderPersonaBadge(){
  const el = document.getElementById('persona-badge');
  if (!el) return;
  const drives = loadDrives();
  const p = getDriverPersona(drives);
  if (!p){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="persona-title">${p.title}</div>
    <div class="persona-sub">${p.sub}</div>`;
}

function renderDriveList(){
  const host = $('#drives-container');
  const all = loadDrives();
  renderPersonaBadge();
  if (!all.length){
    host.innerHTML = '<div class="empty-drives">No drives yet. Tap start.</div>';
    return;
  }
  const sorted = all
    .map((d, i) => ({d, i}))
    .sort((a, b) => (b.d.starred ? 1 : 0) - (a.d.starred ? 1 : 0));
  host.innerHTML = sorted.map(({d, i}) => {
    const when = new Date(d.startTime);
    const mi = d.distanceMeters ? metersToMiles(d.distanceMeters).toFixed(1) : '0.0';
    return `
      <div class="drive-row" data-idx="${i}">
        <div class="drive-score" style="color:${scoreColor(d.score)}">${d.score}</div>
        <div class="drive-meta">
          <div class="drive-when">${when.toLocaleDateString([], {month:'short', day:'numeric'})} · ${when.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</div>
          <div class="drive-stats">${mi} MI · ${fmtDuration(d.durationMs)} · ${d.eventCount || 0} events</div>
        </div>
        <div class="drive-actions">
          <button class="drive-star-btn${d.starred ? ' starred' : ''}" data-idx="${i}" aria-label="Favorite">${d.starred ? '★' : '☆'}</button>
          <button class="drive-del-btn" data-idx="${i}" aria-label="Delete">×</button>
        </div>
      </div>`;
  }).join('');
  $$('#drives-container .drive-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.drive-star-btn, .drive-del-btn')) return;
      const idx = Number(row.dataset.idx);
      renderReview(loadDrives()[idx]);
    });
  });
  $$('#drives-container .drive-star-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavoriteDrive(Number(btn.dataset.idx));
    });
  });
  $$('#drives-container .drive-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const row = btn.closest('.drive-row');
      if (btn.dataset.confirm === '1'){
        deleteDrive(Number(btn.dataset.idx));
      } else {
        btn.dataset.confirm = '1';
        btn.textContent = 'Delete?';
        btn.classList.add('confirming');
        setTimeout(() => {
          btn.dataset.confirm = '0';
          btn.textContent = '×';
          btn.classList.remove('confirming');
        }, 2500);
      }
    });
  });
}

function scoreColor(n){
  if (n >= 85) return '#6FB669';
  if (n >= 65) return '#C4A962';
  if (n >= 45) return '#E8A03A';
  return '#E03B2F';
}

// -------------------------------------------------------------------------
// Recording — real devices
// -------------------------------------------------------------------------
async function requestMotionPermissionIfNeeded(){
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'){
    try {
      const res = await DeviceMotionEvent.requestPermission();
      if (res === 'granted'){
        try { localStorage.setItem('smoothaf.motion_perm', 'granted'); } catch {}
        try { document.cookie = 'saf_mp=1;max-age=31536000;path=/;SameSite=Strict'; } catch {}
      }
      return res === 'granted';
    } catch { return false; }
  }
  return true;
}

function motionPermGranted(){
  try { if (localStorage.getItem('smoothaf.motion_perm') === 'granted') return true; } catch {}
  try { if (document.cookie.includes('saf_mp=1')) return true; } catch {}
  return false;
}

function startRecording(){
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
        // Already driving — skip stability wait, fast-track to calibration
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

  if (!navigator.geolocation){
    alert('No geolocation. Use replay demo instead.');
    stopRecording();
    return;
  }
  state.gpsWatchId = navigator.geolocation.watchPosition(onGpsUpdate, err => {
    console.warn('GPS error', err);
    if (err.code === 1) {
      alert('Location permission denied. Enable it in Settings to record a drive.');
      stopRecording();
    }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });

  // Initialise peak-hold window to now
  state.peakWindowMs = Date.now();

  // Start calibration window
  calib.active    = true;
  calib.startTime = Date.now();
  setCalibUI('calibrating');

  state.motionHandler = ev => {
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

    // ── Road roughness — vertical axis vibration ──────────────────────────
    if (calib.up) {
      const vertAccel = dot3(calib.up, [mx, my, mz]);
      state.roughnessBuf.push(vertAccel);
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

    const alpha    = CFG.emaAlpha;
    const longRaw  = dot3(calib.fwd, [mx, my, mz]);
    const latRaw   = dot3(calib.lat, [mx, my, mz]);

    // ── Peak-hold: track worst-case G in each axis this 500ms window ───────
    // Captures transients (e.g. 80ms brake stab) that EMA would smooth away.
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
          flashEvent(evt.type, state.peakLat);
          speakEvent(evt.type);
        }
      }
      // Reset peak-hold window regardless of whether an event fired
      state.peakLong     = 0;
      state.peakLat      = 0;
      state.peakWindowMs = nowT;
    }
  };
  window.addEventListener('devicemotion', state.motionHandler);
}

function onGpsUpdate(pos){
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
      const ok = calibrateAxes();
      calib.done   = ok;
      calib.failed = !ok;
      setCalibUI(ok ? 'done' : 'failed');
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
      flashEvent(evt.type, state.peakLat);
      speakEvent(evt.type);
    }
  }
}

function updateLiveUI(){
  const last = state.samples[state.samples.length - 1];
  const mph = last ? mpsToMph(last.speed || 0) : 0;
  $('#live-speed').textContent = Math.round(mph);

  // G-force value
  const gVal = state.lastMotionG
    ? state.lastMotionG.toFixed(2)
    : (last ? Math.min(2.5, (last.harshness||0)/9.81).toFixed(2) : '0.00');
  const gEl = $('#live-g');
  if (gEl) gEl.textContent = gVal + 'G';

  // G-force bar needle
  const la = last ? (last.longAccel || 0) : 0;
  const needle = document.getElementById('live-g-needle');
  if (needle){
    const pct = 50 + clamp(la / 6, -1, 1) * 44;
    const isBrake = la < -0.6, isAccel = la > 0.6;
    needle.style.left       = pct + '%';
    needle.style.background = isBrake ? '#E03B2F' : isAccel ? '#E8A03A' : 'rgba(244,235,217,.9)';
    needle.style.boxShadow  = isBrake ? '0 0 14px rgba(224,59,47,.7)' : isAccel ? '0 0 14px rgba(232,160,58,.7)' : '0 0 10px rgba(244,235,217,.3)';
    needle.style.color      = (isBrake || isAccel) ? 'rgba(10,8,8,.9)' : 'rgba(10,8,8,.85)';
    needle.textContent      = gVal;
  }

  // Ring color — tracks G-force continuously; events can override briefly
  const ring = document.getElementById('smooth-ring');
  if (ring && !ring._eventLock){
    if (la < -0.5)      ring.className = 'smooth-ring brake';
    else if (la > 0.5)  ring.className = 'smooth-ring accel';
    else                ring.className = 'smooth-ring smooth';
  }


  $('#live-time').textContent = fmtDuration(Date.now() - state.startTime);
  const avgMph = state.samples.length
    ? Math.round(state.samples.reduce((s, x) => s + (x.speed || 0), 0) / state.samples.length * 2.23694)
    : 0;
  $('#live-avg-speed').textContent = avgMph;
  updateRoadUI();
}

function setCalibUI(phase){
  // Only show failure — success is silent
  if (phase !== 'failed') return;
  const el = document.getElementById('calib-status');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = '⚠️ Calibration failed · GPS fallback';
  el.style.color = '#f87171';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function updateRoadUI(){ /* roughness tracked in state.currentRoughness; shown in review */ }

function flashEvent(type, latAccel){
  const el = document.createElement('div');
  el.className = 'event-flash' + (type === 'turn' ? ' warn' : '');
  el.textContent = type === 'brake' ? 'Hard brake' : type === 'accel' ? 'Hard accel' : 'Sharp turn';
  const ticker = $('#event-ticker');
  ticker.innerHTML = '';
  ticker.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2500);

  // Animate smooth ring (lock briefly so continuous G update doesn't override)
  const ring = document.getElementById('smooth-ring');
  if (ring){
    ring._eventLock = true;
    ring.className = 'smooth-ring ' + type;
    setTimeout(() => { ring._eventLock = false; }, 1200);
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

// -------------------------------------------------------------------------
// Voice announcements
// -------------------------------------------------------------------------
const VOICE_LABELS = { brake: 'Hard brake!', accel: 'Hard acceleration!', turn: 'Sharp turn!', shift: 'Rough shift!' };

function speakEvent(type){
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(VOICE_LABELS[type] || type);
  u.volume = 1; u.rate = 1.1; u.pitch = 1;
  window.speechSynthesis.speak(u);
}

function stopRecording(){
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
  finalizeAndReview();
}

function resetState(){
  state.samples = [];
  state.events = [];
  state.emaLongAccel = 0;
  state.emaLatAccel = 0;
  state.emaLongMotion = 0;
  state.emaLatMotion = 0;
  state.prevEmaLong = 0;
  state.currentJerk = 0;
  state.lastMotionG = 0;
  state.peakLong = 0;
  state.peakLat  = 0;
  state.peakWindowMs = 0;
  state.lastMotionEventT = -Infinity;
  state.lastGpsPos = null;
  state.roughnessBuf = [];
  state.currentRoughness = 0;
  state.stabBuf = [];
  state.liveScore = 100;
  resetCalib();
}

// -------------------------------------------------------------------------
// Simulated drive
// -------------------------------------------------------------------------
function startSimulatedDrive(){
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

function buildDemoDrive(){
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

// -------------------------------------------------------------------------
// Finalize + review
// -------------------------------------------------------------------------
function finalizeAndReview(){
  const samples = state.samples;
  if (samples.length < 2){
    showScreen('home');
    renderDriveList();
    return;
  }

  let distance = 0, topSpeed = 0;
  for (let i = 1; i < samples.length; i++){
    distance += haversine(samples[i-1], samples[i]);
    if (samples[i].speed > topSpeed) topSpeed = samples[i].speed;
  }
  const duration = samples[samples.length-1].t - samples[0].t;
  const events = [...state.events];

  const drive = {
    startTime: state.startTime,
    durationMs: duration,
    distanceMeters: distance,
    topSpeedMps: topSpeed,
    score: 0,  // computed below via analyzeDrive
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
  };

  drive.score = analyzeDrive(drive).score;
  saveDrive(drive);
  pushDriveToSupabase(drive);
  renderReview(drive);
  renderDriveList();
}

// -------------------------------------------------------------------------
// Driving style verdict
// -------------------------------------------------------------------------
function drivingStyleVerdict(analysis, drive){
  const { score, stopsPerMile } = analysis;
  const topMph = Math.round(mpsToMph(drive.topSpeedMps || 0));
  const isHighway  = topMph > 60;
  const neverStops = stopsPerMile < 0.4;

  if (score >= 93) return { label:'Smooth AF',           sub:'Peak level. Passengers won\'t even notice they\'re moving.' };
  if (score >= 86){
    if (isHighway)   return { label:'Fast & Fluid',       sub:'High speed, zero drama. The highway is yours.' };
    if (neverStops)  return { label:'In The Flow',        sub:'Reading traffic like a pro — you barely had to stop.' };
                     return { label:'Pretty Damn Smooth', sub:'Composed, consistent, controlled. Solid drive.' };
  }
  if (score >= 76){
    if (isHighway)   return { label:'Mostly Smooth',      sub:'Good at speed, a few rough moments slipped through.' };
                     return { label:'Slow & Steady',      sub:'Deliberate driving. A little choppy at times but you stayed patient.' };
  }
  if (score >= 62)   return { label:'Getting There',      sub:'Some smooth patches, some rough ones. The map markers show where to tighten up.' };
  if (score >= 45)   return { label:'Room To Grow',       sub:'Foundation is there. Focus on anticipating stops earlier.' };
                     return { label:'Rough Ride',         sub:'The road had its way today. Study the map markers and find the patterns.' };
}

// -------------------------------------------------------------------------
// Leaflet review rendering
// -------------------------------------------------------------------------
let mapInstance = null;
let mapLayers = [];
let reviewEventMarkers = { brake: [], accel: [], turn: [] };
let reviewDrive = null;

function renderReview(drive){
  showScreen('review');
  reviewDrive = drive;

  const analysis = analyzeDrive(drive);

  // ── Header ─────────────────────────────────────────────────────────────────
  const when = new Date(drive.startTime);
  $('#review-when').textContent =
    when.toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) +
    ' · ' + when.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});

  // ── Score ──────────────────────────────────────────────────────────────────
  const scoreEl = $('#review-score');
  scoreEl.textContent = analysis.score;
  scoreEl.className = 'score-big ' + (analysis.score >= 85 ? 'good' : analysis.score >= 60 ? 'mid' : 'bad');

  // ── Events — show all detected events in chips; only tier 2+ affect score ──
  $('#ev-brake').textContent = drive.events.filter(e => e.type === 'brake').length;
  $('#ev-accel').textContent = drive.events.filter(e => e.type === 'accel').length;
  $('#ev-turn').textContent  = drive.events.filter(e => e.type === 'turn').length;
  $('#ev-stop').textContent  = analysis.stopMarkers.length;

  // ── Stat strip ─────────────────────────────────────────────────────────────
  $('#r-distance').textContent = metersToMiles(drive.distanceMeters).toFixed(1);
  $('#r-duration').textContent = fmtDuration(drive.durationMs);
  $('#r-topspeed').textContent  = Math.round(mpsToMph(drive.topSpeedMps));
  const roadEl = $('#r-road-quality');
  if (roadEl && drive.samples.length){
    const avgRough = drive.samples.reduce((s,x) => s + (x.roadRoughness || 0), 0) / drive.samples.length;
    roadEl.textContent = avgRough < 0.15 ? 'Smooth' : avgRough < 0.5 ? 'Good' : avgRough < 1.0 ? 'Fair' : 'Rough';
    roadEl.style.color = avgRough < 0.15 ? 'var(--good)' : avgRough < 0.5 ? 'var(--sage)' : avgRough < 1.0 ? 'var(--warn)' : 'var(--danger)';
  }

  // ── Force timeline chart ───────────────────────────────────────────────────
  renderForceTimeline(drive);

  // ── Style verdict + analysis sheet ────────────────────────────────────────
  const verdict = drivingStyleVerdict(analysis, drive);
  const vColor  = dimColor(analysis.score);

  // Verdict preview on score header
  const verdictTag = document.getElementById('score-verdict-tag');
  if (verdictTag) verdictTag.textContent = verdict.label;

  // Populate analysis sheet
  const asLabel = document.getElementById('as-verdict-label');
  const asSub   = document.getElementById('as-verdict-sub');
  if (asLabel) { asLabel.textContent = verdict.label; asLabel.style.color = vColor; }
  if (asSub)   asSub.textContent = verdict.sub;

  const asDims = document.getElementById('as-dims-list');
  if (asDims){
    const regularDims = DIM_DISPLAY.filter(d => d.key !== 'momentum');
    const mVal  = analysis.dims.momentum || 0;
    const mColor = dimColor(mVal);
    const tiles = regularDims.map(({ key, label }) => {
      const val   = analysis.dims[key] || 0;
      const color = dimColor(val);
      return `<div class="dim-tile" style="border-color:${color}44">
        <div class="dim-tile-score" style="color:${color}">${val}</div>
        <div class="dim-tile-label">${label}</div>
      </div>`;
    }).join('');
    const momentum = `<div class="dim-tile momentum" id="dim-tile-momentum" style="border-color:${mColor}44">
      <div class="momentum-left">
        <div class="dim-tile-score" style="color:${mColor}">${mVal}</div>
        <div class="dim-tile-label">Momentum</div>
      </div>
      <div class="momentum-right">
        ${analysis.fullStops} full stop${analysis.fullStops !== 1 ? 's' : ''}<br>
        ${analysis.stopsPerMile.toFixed(1)} per mile<br>
        <div class="momentum-map-link" style="color:${mColor}">View on map →</div>
      </div>
    </div>`;
    asDims.innerHTML = tiles + momentum;
    document.getElementById('dim-tile-momentum')?.addEventListener('click', () => {
      document.getElementById('analysis-sheet')?.classList.add('hidden');
      enterMapFilter('stop');
    });
  }

  // Wire score header tap
  const scoreBtn = document.getElementById('score-header-btn');
  if (scoreBtn){
    scoreBtn.onclick = () => document.getElementById('analysis-sheet')?.classList.remove('hidden');
  }
  document.getElementById('as-close')?.addEventListener('click', () => {
    document.getElementById('analysis-sheet')?.classList.add('hidden');
  });

  // ── Map ────────────────────────────────────────────────────────────────────
  if (!mapInstance){
    mapInstance = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd',
    }).addTo(mapInstance);
  } else {
    mapLayers.forEach(l => mapInstance.removeLayer(l));
    mapLayers = [];
  }

  if (drive.samples.length < 2) return;

  const bounds = L.latLngBounds(drive.samples.map(s => [s.lat, s.lon]));
  mapInstance.fitBounds(bounds, { padding: [40, 40] });

  for (let i = 1; i < drive.samples.length; i++){
    const a = drive.samples[i-1], b = drive.samples[i];
    const la = ((a.la || 0) + (b.la || 0)) / 2;
    const ra = ((a.ra || 0) + (b.ra || 0)) / 2;
    const seg = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
      color: forceSegmentColor(la, ra), weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round'
    }).addTo(mapInstance);
    mapLayers.push(seg);
  }

  // Direction-of-travel arrows — ~7 evenly spaced along the route
  const smp = drive.samples;
  const step = Math.max(1, Math.floor(smp.length / 7));
  for (let i = step; i < smp.length - 1; i += step){
    const a = smp[i], b = smp[i + 1];
    const dy = b.lat - a.lat, dx = b.lon - a.lon;
    if (Math.abs(dy) < 1e-6 && Math.abs(dx) < 1e-6) continue;
    const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const arrow = L.marker([a.lat, a.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div class="route-arrow" style="transform:rotate(${deg}deg)">▲</div>`,
        iconSize: [14, 14], iconAnchor: [7, 7]
      }),
      interactive: false
    }).addTo(mapInstance);
    mapLayers.push(arrow);
  }

  const first = drive.samples[0], last = drive.samples[drive.samples.length-1];
  [
    L.marker([first.lat, first.lon], { icon: L.divIcon({ className:'', html:'<div class="start-marker"></div>', iconSize:[14,14], iconAnchor:[7,7] }) }).addTo(mapInstance).bindPopup('Start'),
    L.marker([last.lat,  last.lon],  { icon: L.divIcon({ className:'', html:'<div class="end-marker"></div>',   iconSize:[14,14], iconAnchor:[7,7] }) }).addTo(mapInstance).bindPopup('End'),
  ].forEach(m => mapLayers.push(m));

  reviewEventMarkers = { brake: [], accel: [], turn: [], stop: [] };
  for (const s of analysis.stopMarkers){
    const secs = (s.durationMs / 1000).toFixed(s.durationMs < 10000 ? 1 : 0);
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className:'', html:`<div class="ev-marker stop-pill">${secs}s</div>`, iconSize:[52,24], iconAnchor:[26,12] })
    }).addTo(mapInstance);
    m.bindPopup(`<b>Full stop</b><br>${secs}s · approach ${s.speedMph} mph<br><span style="color:#8A7B72">t+${fmtDuration(s.t)}</span>`);
    mapLayers.push(m);
    reviewEventMarkers.stop.push(m);
  }
  for (const e of drive.events){
    if (e.type === 'shift') continue;
    const tier  = e.tier || 2;
    const label = e.type === 'brake' ? 'Brake' : e.type === 'accel' ? 'Accel' : 'Turn';
    const raw   = e.la != null ? `${Math.abs(e.la).toFixed(2)} m/s² (${(Math.abs(e.la)/9.81).toFixed(3)}G)`
                : e.ra != null ? `${Math.abs(e.ra).toFixed(2)} m/s² (${(Math.abs(e.ra)/9.81).toFixed(3)}G)`
                : `sev ${(e.severity||1).toFixed(1)}×`;
    const tierLabel = tier >= 3 ? 'Harsh' : tier >= 2 ? 'Moderate' : 'Mild';
    let markerHtml, markerSize, markerAnchor;
    if (tier >= 2){
      const glyph = e.type === 'brake' ? 'B' : e.type === 'accel' ? 'A' : 'T';
      markerHtml   = `<div class="ev-marker ${e.type}">${glyph}</div>`;
      markerSize   = [26, 26]; markerAnchor = [13, 13];
    } else {
      markerHtml   = `<div class="ev-marker-dot ${e.type}"></div>`;
      markerSize   = [12, 12]; markerAnchor = [6, 6];
    }
    const m = L.marker([e.lat, e.lon], {
      icon: L.divIcon({ className:'', html: markerHtml, iconSize: markerSize, iconAnchor: markerAnchor })
    }).addTo(mapInstance);
    if (e.type === 'brake'){
      m.on('click', () => showBrakeProfile(e, drive));
    } else {
      m.bindPopup(`<b>${tierLabel} ${label}</b><br>${e.speedMph} mph · ${raw}<br><span style="color:#8A7B72">t+${fmtDuration(e.t)}</span>`);
    }
    mapLayers.push(m);
    if (reviewEventMarkers[e.type]) reviewEventMarkers[e.type].push(m);
  }

  setTimeout(() => mapInstance.invalidateSize(), 80);
}

// -------------------------------------------------------------------------
// Full-drive force timeline chart
// -------------------------------------------------------------------------
function renderForceTimeline(drive){
  const canvas = document.getElementById('force-timeline-canvas');
  if (!canvas || !drive || drive.samples.length < 2) return;
  requestAnimationFrame(() => {
    const dpr   = window.devicePixelRatio || 1;
    const W     = canvas.offsetWidth;
    const H     = canvas.offsetHeight;
    if (!W || !H) return;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const smp   = drive.samples;
    const t0    = smp[0].t, tEnd = smp[smp.length-1].t;
    const tSpan = tEnd - t0 || 1;

    // Y: center = zero, positive la = accel (upward), negative la = brake (downward)
    const allAbs  = smp.flatMap(s => [Math.abs(s.la || 0), Math.abs(s.ra || 0)]);
    const maxForce = Math.max(1.2, ...allAbs);
    const tx = t  => ((t - t0) / tSpan) * W;
    const ty = v  => H * 0.5 * (1 - v / maxForce);
    const zero = ty(0);

    ctx.clearRect(0, 0, W, H);

    // Subtle zone backgrounds
    ctx.fillStyle = 'rgba(232,160,58,.05)';
    ctx.fillRect(0, 0, W, zero);            // upper = accel zone
    ctx.fillStyle = 'rgba(224,59,47,.05)';
    ctx.fillRect(0, zero, W, H - zero);    // lower = brake zone

    // Zero line
    ctx.strokeStyle = 'rgba(244,235,217,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(W, zero); ctx.stroke();

    // ── Accel fill (la > 0, plots above center) ───────────────────────────
    ctx.beginPath();
    ctx.moveTo(tx(smp[0].t), zero);
    smp.forEach(s => ctx.lineTo(tx(s.t), (s.la||0) > 0.05 ? ty(s.la) : zero));
    ctx.lineTo(tx(smp[smp.length-1].t), zero);
    ctx.closePath();
    const aGrad = ctx.createLinearGradient(0, 0, 0, zero);
    aGrad.addColorStop(0, 'rgba(232,160,58,.6)');
    aGrad.addColorStop(1, 'rgba(232,160,58,.08)');
    ctx.fillStyle = aGrad;
    ctx.fill();

    // ── Brake fill (la < 0, plots below center) ───────────────────────────
    ctx.beginPath();
    ctx.moveTo(tx(smp[0].t), zero);
    smp.forEach(s => ctx.lineTo(tx(s.t), (s.la||0) < -0.05 ? ty(s.la) : zero));
    ctx.lineTo(tx(smp[smp.length-1].t), zero);
    ctx.closePath();
    const bGrad = ctx.createLinearGradient(0, zero, 0, H);
    bGrad.addColorStop(0, 'rgba(224,59,47,.08)');
    bGrad.addColorStop(1, 'rgba(224,59,47,.6)');
    ctx.fillStyle = bGrad;
    ctx.fill();

    // ── La main line ──────────────────────────────────────────────────────
    ctx.beginPath();
    smp.forEach((s, i) => {
      const x = tx(s.t), y = ty(s.la || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(244,235,217,.4)';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // ── Ra line (lateral / turning — gold) ───────────────────────────────
    ctx.beginPath();
    smp.forEach((s, i) => {
      const x = tx(s.t), y = ty(s.ra || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(196,169,98,.55)';
    ctx.lineWidth   = 1;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Event tick marks for tier-2+ events (hairlines on timeline)
    ctx.strokeStyle = 'rgba(224,59,47,.5)';
    ctx.lineWidth   = 1;
    drive.events.forEach(e => {
      if ((e.tier || 2) < 2 || e.type === 'shift') return;
      const x = tx(e.t);
      const color = e.type === 'brake' ? 'rgba(224,59,47,.6)' : e.type === 'accel' ? 'rgba(232,160,58,.6)' : 'rgba(196,169,98,.6)';
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H * 0.18); ctx.stroke();
    });
  });
}

// -------------------------------------------------------------------------
// Brake event deceleration profile panel + sparkline
// -------------------------------------------------------------------------
function showBrakeProfile(e, drive){
  const existing = document.getElementById('brake-detail-panel');
  if (existing) existing.remove();

  const PRE_MS  = 4000;
  const POST_MS = 6000;
  const slice = drive.samples.filter(s => s.t >= e.t - PRE_MS && s.t <= e.t + POST_MS);
  if (slice.length < 2) return;

  const laVals  = slice.map(s => s.la || 0);
  const minLa   = Math.min(-0.3, ...laVals);
  const maxLa   = Math.max( 0.3, ...laVals);
  const peakLa  = Math.min(...laVals);
  const peakG   = (Math.abs(peakLa) / 9.81).toFixed(2);
  const peakMs2 = Math.abs(peakLa).toFixed(1);

  const brakePts = slice.filter(s => (s.la || 0) < -0.3);
  const dur = brakePts.length >= 2
    ? ((brakePts[brakePts.length-1].t - brakePts[0].t) / 1000).toFixed(1)
    : brakePts.length === 1 ? '<1' : '—';

  const qualLabel = peakG >= 0.4 ? 'Hard' : peakG >= 0.2 ? 'Moderate' : 'Light';
  const qualColor = peakG >= 0.4 ? 'var(--danger)' : peakG >= 0.2 ? 'var(--warn)' : 'var(--good)';

  const panel = document.createElement('div');
  panel.id = 'brake-detail-panel';
  panel.className = 'brake-detail-panel';
  panel.innerHTML = `
    <div class="bdp-header">
      <span class="bdp-title" style="color:${qualColor}">${qualLabel} brake</span>
      <span class="bdp-meta">${e.speedMph} mph entry · tier ${e.tier || 2}</span>
      <button class="bdp-close" aria-label="Close">×</button>
    </div>
    <canvas class="brake-spark" id="brake-spark"></canvas>
    <div class="bdp-stats">
      <div class="bdp-stat">
        <div class="bdp-stat-v" style="color:${qualColor}">${peakG}<span class="bdp-stat-u">G</span></div>
        <div class="bdp-stat-l">Peak G</div>
      </div>
      <div class="bdp-stat">
        <div class="bdp-stat-v">${peakMs2}<span class="bdp-stat-u">m/s²</span></div>
        <div class="bdp-stat-l">Peak force</div>
      </div>
      <div class="bdp-stat">
        <div class="bdp-stat-v">${dur}<span class="bdp-stat-u">s</span></div>
        <div class="bdp-stat-l">Duration</div>
      </div>
      <div class="bdp-stat">
        <div class="bdp-stat-v">${e.speedMph}<span class="bdp-stat-u">mph</span></div>
        <div class="bdp-stat-l">Entry</div>
      </div>
    </div>`;

  const mapBlock = document.querySelector('.review-map-block');
  if (!mapBlock) return;
  mapBlock.appendChild(panel);
  panel.querySelector('.bdp-close').onclick = () => panel.remove();

  requestAnimationFrame(() =>
    drawBrakeSparkline(document.getElementById('brake-spark'), slice, e.t, minLa, maxLa)
  );
}

function drawBrakeSparkline(canvas, slice, eventT, minLa, maxLa){
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth;
  const H   = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const t0    = slice[0].t;
  const tSpan = (slice[slice.length-1].t - t0) || 1;
  const laRange = maxLa - minLa || 1;

  const tx = t  => ((t - t0) / tSpan) * W;
  const ty = la => H * (maxLa - la) / laRange;
  const zero = ty(0);

  // Zero baseline
  ctx.strokeStyle = 'rgba(244,235,217,.14)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(W, zero); ctx.stroke();

  // Event timestamp dashed line
  const ex = tx(eventT);
  if (ex >= 0 && ex <= W){
    ctx.strokeStyle = 'rgba(224,59,47,.45)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, H); ctx.stroke();
    ctx.setLineDash([]);
  }

  const pts = slice.map(s => ({ x: tx(s.t), y: ty(s.la || 0) }));

  // Filled area under the curve
  ctx.beginPath();
  ctx.moveTo(pts[0].x, zero);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length-1].x, zero);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(224,59,47,.48)');
  grad.addColorStop(1, 'rgba(224,59,47,.04)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke line
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = '#E03B2F';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Peak G label
  const peakPt = pts.reduce((a, b) => b.y > a.y ? b : a); // highest y = most negative la
  ctx.fillStyle = 'rgba(224,59,47,.9)';
  ctx.font      = `bold ${9 * dpr / dpr}px var(--sans)`;
  ctx.textAlign = 'center';
  ctx.fillText(`${(Math.abs(Math.min(...slice.map(s=>s.la||0)))/9.81).toFixed(2)}G`, clamp(peakPt.x, 18, W-18), Math.max(10, peakPt.y - 6));
}

function enterMapFilter(type){
  if (!mapInstance) return;
  const mapBlock = document.querySelector('.review-map-block');
  const btn = document.getElementById('btn-map-expand');
  if (mapBlock && !mapBlock.classList.contains('map-full')){
    mapBlock.classList.add('map-full');
    if (btn){ btn.textContent = '×'; btn.setAttribute('aria-label', 'Close map'); }
    setTimeout(() => mapInstance.invalidateSize(), 100);
  }
  ['brake','accel','turn','stop'].forEach(t => {
    reviewEventMarkers[t].forEach(m => {
      if (t === type){ if (!mapInstance.hasLayer(m)) m.addTo(mapInstance); }
      else           { if (mapInstance.hasLayer(m))  mapInstance.removeLayer(m); }
    });
  });
  const pts = reviewEventMarkers[type].map(m => m.getLatLng());
  if (pts.length) mapInstance.fitBounds(L.latLngBounds(pts), { padding:[60,60] });
  const badge = document.getElementById('map-filter-badge');
  const labelEl = document.getElementById('map-filter-label');
  if (badge && labelEl){
    const labels = { brake:'BRAKES', accel:'ACCELS', turn:'TURNS', stop:'FULL STOPS' };
    labelEl.textContent = labels[type] || type.toUpperCase();
    badge.classList.add('visible');
  }
}

function clearMapFilter(){
  if (!mapInstance) return;
  ['brake','accel','turn','stop'].forEach(t => {
    reviewEventMarkers[t].forEach(m => { if (!mapInstance.hasLayer(m)) m.addTo(mapInstance); });
  });
  const badge = document.getElementById('map-filter-badge');
  if (badge) badge.classList.remove('visible');
  if (reviewDrive && reviewDrive.samples.length){
    const bounds = L.latLngBounds(reviewDrive.samples.map(s => [s.lat, s.lon]));
    mapInstance.fitBounds(bounds, { padding:[40,40] });
  }
}

// -------------------------------------------------------------------------
// Screen router
// -------------------------------------------------------------------------
function showScreen(name){
  $$('.screen').forEach(s => s.classList.remove('active'));
  const node = $('#screen-' + name);
  if (node) node.classList.add('active');
  state.screen = name;
  // Re-invalidate map when returning to review
  if (name === 'review' && mapInstance) setTimeout(() => mapInstance.invalidateSize(), 80);
}

// -------------------------------------------------------------------------
// Wire up buttons
// -------------------------------------------------------------------------
function wireStartButton(btnId){
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

// ── Car photo — background removal + cartoon ─────────────────────────────────
const CAR_PHOTO_KEY   = 'smoothaf.car_photo';
const REMOVEBG_KEY    = 'smoothaf.removebg_key';
const CAR_POS_KEY     = 'smoothaf.car_pos';
const REC_PHOTO_KEY   = 'smoothaf.rec_photo';
const REC_POS_KEY     = 'smoothaf.rec_pos';

function loadCarPhoto(){ try { return localStorage.getItem(CAR_PHOTO_KEY); } catch { return null; } }
function getRemoveBgKey(){ return localStorage.getItem(REMOVEBG_KEY) || '9BMp9XXKWRiqoXeqEPp1T63U'; }
function loadCarPos(){ try { return JSON.parse(localStorage.getItem(CAR_POS_KEY)) || {x:50,y:38}; } catch { return {x:50,y:38}; } }
function saveCarPos(p){ try { localStorage.setItem(CAR_POS_KEY, JSON.stringify(p)); } catch {} }
function loadRecPos(){ try { return JSON.parse(localStorage.getItem(REC_POS_KEY)) || {x:50,y:42}; } catch { return {x:50,y:42}; } }
function saveRecPos(p){ try { localStorage.setItem(REC_POS_KEY, JSON.stringify(p)); } catch {} }
function loadRecPhoto(){ try { return localStorage.getItem(REC_PHOTO_KEY); } catch { return null; } }

async function removeBgAPI(file){
  const key = getRemoveBgKey();
  if (!key) throw Object.assign(new Error('No key'), { code: 'no-key' });
  const fd = new FormData();
  fd.append('image_file', file);
  fd.append('size', 'auto');
  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': key },
    body: fd,
  });
  if (res.status === 403) throw Object.assign(new Error('Invalid key'), { code: 'invalid-key' });
  if (!res.ok) throw new Error(`remove.bg ${res.status}`);
  return res.blob();
}

function savePhotoPlain(file){
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 900, scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      try { localStorage.setItem(CAR_PHOTO_KEY, dataUrl); } catch {}
      renderCarDisplay(); renderRecAvatar();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function processCarPhoto(file){
  const container = document.getElementById('car-display');
  if (container) container.innerHTML = '<div class="car-loading"><span>Processing…</span></div>';

  try {
    const blob = await removeBgAPI(file);
    await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try { localStorage.setItem(CAR_PHOTO_KEY, e.target.result); } catch {}
        resolve();
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    renderCarDisplay(); renderRecAvatar();
  } catch (err) {
    if (err.code === 'invalid-key'){
      localStorage.removeItem(REMOVEBG_KEY);
      showApiKeyPrompt(file, 'That key didn\'t work — try again.');
    } else {
      console.warn('remove.bg failed, using plain:', err);
      savePhotoPlain(file);
    }
  }
}

function showApiKeyPrompt(pendingFile, errorMsg){
  const modal = document.getElementById('removebg-modal');
  modal.querySelector('.removebg-error').textContent = errorMsg || '';
  modal.querySelector('#removebg-key-input').value = '';
  modal._pendingFile = pendingFile;
  modal.classList.remove('hidden');
}

// ── Garage ────────────────────────────────────────────────────────────────────
const GARAGE_KEY = 'smoothaf.garage';

function generateId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function loadGarage(){
  try { return JSON.parse(localStorage.getItem(GARAGE_KEY)) || []; } catch { return []; }
}

function saveGarage(vehicles){
  try { localStorage.setItem(GARAGE_KEY, JSON.stringify(vehicles)); } catch {}
}

function getActiveVehicle(){
  const g = loadGarage();
  return g.find(v => v.active) || g[0] || null;
}

function setActiveVehicle(id){
  const g = loadGarage();
  g.forEach(v => v.active = v.id === id);
  saveGarage(g);
}

function migrateFromOldVehicleKey(){
  if (loadGarage().length > 0) return;
  const oldType = localStorage.getItem(VEHICLE_KEY);
  if (!oldType) return;
  saveGarage([{
    id: generateId(), type: oldType,
    make:'', model:'', year:'', color:'', licensePlate:'', vin:'',
    insurance:{ provider:'', policyNumber:'', expiryDate:'', agentPhone:'' },
    registration:{ state:'', expiryDate:'' },
    active: true
  }]);
}

// ── Vehicle images ─────────────────────────────────────────────────────────────
function getCarImageSrc(ctx){
  const custom = loadCarPhoto();
  if (custom) return custom;
  const active = getActiveVehicle();
  const typeId = active?.type || localStorage.getItem(VEHICLE_KEY);
  if (!typeId) return null;
  const vt = VEHICLE_TYPES.find(v => v.id === typeId);
  if (!vt) return null;
  if (ctx === 'rear' && vt.imgRear) return vt.imgRear;
  if (ctx === 'front' && vt.imgFront) return vt.imgFront;
  if (vt.imgFront) return vt.imgFront;
  return `vehicles/${typeId}.jpg`;
}

// ── Garage UI ──────────────────────────────────────────────────────────────────
let _editingVehicleId = null;

function showGarageSheet(){
  const sheet = document.getElementById('garage-sheet');
  if (!sheet) return;
  migrateFromOldVehicleKey();
  renderGarageList();
  showGarageView('list');
  sheet.classList.remove('hidden');
}

function hideGarageSheet(){
  document.getElementById('garage-sheet')?.classList.add('hidden');
}

function showGarageView(view){
  document.getElementById('garage-list-view')?.classList.toggle('hidden', view !== 'list');
  document.getElementById('garage-form-view')?.classList.toggle('hidden', view !== 'form');
}

function renderGarageList(){
  const container = document.getElementById('garage-list');
  if (!container) return;
  const vehicles = loadGarage();
  if (vehicles.length === 0){
    container.innerHTML = '<div class="gs-empty">No vehicles yet. Add one below.</div>';
    return;
  }
  container.innerHTML = vehicles.map(v => {
    const vt = VEHICLE_TYPES.find(t => t.id === v.type) || { icon:'🚗', label:'Vehicle' };
    const nameLine = [v.year, v.make, v.model].filter(Boolean).join(' ') || vt.label;
    const detail = [v.color, v.licensePlate].filter(Boolean).join(' · ');
    return `
      <div class="gs-card${v.active ? ' active-vehicle' : ''}" data-id="${v.id}">
        <div class="gs-card-icon">${vt.icon}</div>
        <div class="gs-card-body">
          <div class="gs-card-name">${nameLine}</div>
          ${detail ? `<div class="gs-card-detail">${detail}</div>` : ''}
        </div>
        ${v.active ? '<div class="gs-card-badge">Driving today</div>' : ''}
        <button class="gs-card-edit" data-edit="${v.id}">Edit</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.gs-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-edit]')) return;
      setActiveVehicle(card.dataset.id);
      renderGarageList();
      renderCarDisplay();
      renderRecAvatar();
    });
  });
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openVehicleForm(btn.dataset.edit); });
  });
}

function openVehicleForm(vehicleId){
  _editingVehicleId = vehicleId || null;
  const v = vehicleId ? loadGarage().find(x => x.id === vehicleId) : null;

  document.getElementById('gs-form-title').textContent = v ? 'Edit vehicle' : 'Add vehicle';
  buildGarageTypeGrid(v?.type || null);

  document.getElementById('gs-make').value           = v?.make || '';
  document.getElementById('gs-model').value          = v?.model || '';
  document.getElementById('gs-year').value           = v?.year || '';
  document.getElementById('gs-color').value          = v?.color || '';
  document.getElementById('gs-plate').value          = v?.licensePlate || '';
  document.getElementById('gs-vin').value            = v?.vin || '';
  document.getElementById('gs-ins-provider').value   = v?.insurance?.provider || '';
  document.getElementById('gs-ins-policy').value     = v?.insurance?.policyNumber || '';
  document.getElementById('gs-ins-expiry').value     = v?.insurance?.expiryDate || '';
  document.getElementById('gs-ins-agent').value      = v?.insurance?.agentPhone || '';
  document.getElementById('gs-reg-state').value      = v?.registration?.state || '';
  document.getElementById('gs-reg-expiry').value     = v?.registration?.expiryDate || '';

  document.getElementById('gs-delete')?.classList.toggle('hidden', !v);
  showGarageView('form');
}

function buildGarageTypeGrid(selectedType){
  const grid = document.getElementById('gs-type-grid');
  if (!grid) return;
  grid.innerHTML = VEHICLE_TYPES.map(vt => `
    <div class="gs-type-card${vt.id === selectedType ? ' selected' : ''}" data-type="${vt.id}">
      <div class="gs-type-icon">${vt.icon}</div>
      <div class="gs-type-label">${vt.label}</div>
    </div>`).join('');
  grid.querySelectorAll('.gs-type-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.gs-type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

function saveVehicleForm(){
  const vehicles = loadGarage();
  const selectedTypeEl = document.querySelector('#gs-type-grid .gs-type-card.selected');
  const data = {
    type:         selectedTypeEl?.dataset.type || 'sedan',
    make:         document.getElementById('gs-make').value.trim(),
    model:        document.getElementById('gs-model').value.trim(),
    year:         document.getElementById('gs-year').value.trim(),
    color:        document.getElementById('gs-color').value.trim(),
    licensePlate: document.getElementById('gs-plate').value.trim(),
    vin:          document.getElementById('gs-vin').value.trim(),
    insurance: {
      provider:     document.getElementById('gs-ins-provider').value.trim(),
      policyNumber: document.getElementById('gs-ins-policy').value.trim(),
      expiryDate:   document.getElementById('gs-ins-expiry').value,
      agentPhone:   document.getElementById('gs-ins-agent').value.trim(),
    },
    registration: {
      state:      document.getElementById('gs-reg-state').value.trim(),
      expiryDate: document.getElementById('gs-reg-expiry').value,
    },
  };

  let refreshDisplay = false;
  if (_editingVehicleId){
    const idx = vehicles.findIndex(v => v.id === _editingVehicleId);
    if (idx !== -1){
      refreshDisplay = vehicles[idx].active;
      vehicles[idx] = { ...vehicles[idx], ...data };
    }
  } else {
    data.id = generateId();
    data.active = vehicles.length === 0;
    refreshDisplay = data.active;
    vehicles.push(data);
  }

  saveGarage(vehicles);
  if (refreshDisplay){ renderCarDisplay(); renderRecAvatar(); }
  showGarageView('list');
  renderGarageList();
}

function deleteVehicle(id){
  const vehicles = loadGarage().filter(v => v.id !== id);
  if (vehicles.length > 0 && !vehicles.find(v => v.active)) vehicles[0].active = true;
  saveGarage(vehicles);
  renderCarDisplay();
  renderRecAvatar();
  showGarageView('list');
  renderGarageList();
}

function buildVehicleGrid(){
  const grid = document.getElementById('vs-grid');
  if (!grid) return;
  const saved = localStorage.getItem(VEHICLE_KEY);
  grid.innerHTML = VEHICLE_TYPES.map(v => `
    <div class="vs-card${v.id === saved ? ' selected' : ''}" data-id="${v.id}">
      <div class="vs-icon">${v.icon}</div>
      <div class="vs-label">${v.label}</div>
    </div>`).join('');
  grid.querySelectorAll('.vs-card').forEach(card => {
    card.addEventListener('click', () => selectVehicleType(card.dataset.id));
  });
}

function showVehicleSheet(){
  const sheet = document.getElementById('vehicle-sheet');
  if (!sheet) return;
  buildVehicleGrid();
  sheet.classList.remove('hidden');
}

function hideVehicleSheet(){
  document.getElementById('vehicle-sheet')?.classList.add('hidden');
}

function selectVehicleType(vehicleId){
  if (!VEHICLE_TYPES.find(v => v.id === vehicleId)) return;
  localStorage.setItem(VEHICLE_KEY, vehicleId);
  try { localStorage.removeItem(CAR_PHOTO_KEY); } catch {}
  hideVehicleSheet();
  renderCarDisplay();
  renderRecAvatar();
}

function renderCarDisplay(){
  const container = document.getElementById('car-display');
  if (!container) return;
  const src = getCarImageSrc('front');
  if (src){
    const pos = loadCarPos();
    container.innerHTML = `
      <div class="car-photo-bg" id="car-photo-bg" style="background-image:url(${src});background-position:${pos.x}% ${pos.y}%"></div>
      <div class="car-vignette"></div>
      <div class="car-action-row">
        <button class="car-action-btn" id="car-change-btn">Change</button>
        <button class="car-action-btn" id="car-reposition-btn">Reposition</button>
      </div>`;
    document.getElementById('car-change-btn').addEventListener('click', showGarageSheet);
    document.getElementById('car-reposition-btn').addEventListener('click', enterRepositionMode);
  } else {
    container.innerHTML = `
      <div class="car-upload-prompt" id="car-type-invite" style="cursor:pointer">
        <div class="car-upload-icon">🚗</div>
        <div class="car-upload-title">Choose your ride</div>
        <div class="car-upload-sub">Select a vehicle type or upload a photo</div>
      </div>`;
    document.getElementById('car-type-invite')?.addEventListener('click', showGarageSheet);
  }
  renderRecAvatar();
}

function enterRepositionMode(){
  const container = document.getElementById('car-display');
  const bg = document.getElementById('car-photo-bg');
  if (!container || !bg) return;

  let pos = loadCarPos();
  let startTouch = null, startPos = {...pos};
  const w = container.offsetWidth  || 390;
  const h = container.offsetHeight || 600;

  const overlay = document.createElement('div');
  overlay.className = 'car-reposition-overlay';
  overlay.innerHTML = `
    <div class="car-reposition-hint">Drag to reposition</div>
    <button class="car-reposition-done" id="repo-done">Done</button>
    <button class="car-reposition-reset" id="repo-reset">Reset position</button>`;
  container.appendChild(overlay);

  overlay.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1){
      startTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
      startPos = {...pos};
    }
    e.preventDefault();
  }, {passive: false});

  overlay.addEventListener('touchmove', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1 && startTouch){
      const dx = e.touches[0].clientX - startTouch.x;
      const dy = e.touches[0].clientY - startTouch.y;
      pos.x = Math.max(0, Math.min(100, startPos.x - dx * (100/w)));
      pos.y = Math.max(0, Math.min(100, startPos.y - dy * (100/h)));
      bg.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    }
    e.preventDefault();
  }, {passive: false});

  overlay.addEventListener('touchend', () => { startTouch = null; });

  document.getElementById('repo-done').addEventListener('click', () => {
    saveCarPos(pos);
    overlay.remove();
  });
  document.getElementById('repo-reset').addEventListener('click', () => {
    pos = {x:50, y:38};
    bg.style.backgroundPosition = '50% 38%';
    saveCarPos(pos);
    overlay.remove();
  });
}

function enterRecRepositionMode(){
  const panel = document.querySelector('.rec-car-panel');
  const bg = document.getElementById('rec-bg');
  if (!panel || !bg) return;
  let pos = loadRecPos();
  let startTouch = null, startPos = {...pos};
  const w = panel.offsetWidth || 390;
  const h = panel.offsetHeight || 500;
  const overlay = document.createElement('div');
  overlay.className = 'car-reposition-overlay';
  overlay.innerHTML = `
    <div class="car-reposition-hint">Drag to reposition</div>
    <button class="car-reposition-done" id="rec-repo-done">Done</button>
    <button class="car-reposition-reset" id="rec-repo-reset">Reset position</button>`;
  panel.appendChild(overlay);
  overlay.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1){ startTouch = {x:e.touches[0].clientX, y:e.touches[0].clientY}; startPos = {...pos}; }
    e.preventDefault();
  }, {passive:false});
  overlay.addEventListener('touchmove', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1 && startTouch){
      const dx = e.touches[0].clientX - startTouch.x;
      const dy = e.touches[0].clientY - startTouch.y;
      pos.x = Math.max(0, Math.min(100, startPos.x - dx*(100/w)));
      pos.y = Math.max(0, Math.min(100, startPos.y - dy*(100/h)));
      bg.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    }
    e.preventDefault();
  }, {passive:false});
  overlay.addEventListener('touchend', () => { startTouch = null; });
  document.getElementById('rec-repo-done').addEventListener('click', () => { saveRecPos(pos); overlay.remove(); });
  document.getElementById('rec-repo-reset').addEventListener('click', () => {
    pos = {x:50,y:50}; bg.style.backgroundPosition = '50% 50%'; saveRecPos(pos); overlay.remove();
  });
}

function saveRecPhoto(file){
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 900, scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // Try progressively lower quality until it fits in localStorage
      for (const q of [0.82, 0.65, 0.5, 0.35]){
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', q);
          localStorage.setItem(REC_PHOTO_KEY, dataUrl);
          renderRecAvatar();
          return;
        } catch {}
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function renderRecAvatar(){
  const bg = document.getElementById('rec-bg');
  const src = loadRecPhoto() || getCarImageSrc('rear');
  if (bg){
    if (src){
      const pos = loadRecPos();
      bg.style.backgroundImage = `url(${src})`;
      bg.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
      bg.style.display = 'block';
    } else {
      bg.style.display = 'none';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderDriveList();
  syncPendingDrives();
  renderCarDisplay();

  wireStartButton('#btn-start');
  wireStartButton('#btn-new-drive');

  $('#btn-stop').addEventListener('click', () => stopRecording());

  $('#btn-back').addEventListener('click', () => {
    const mapBlock = document.querySelector('.review-map-block');
    if (mapBlock && mapBlock.classList.contains('map-full')) {
      mapBlock.classList.remove('map-full');
      clearMapFilter();
      const expandBtn = document.getElementById('btn-map-expand');
      if (expandBtn) { expandBtn.textContent = '⤢'; expandBtn.setAttribute('aria-label', 'Expand map'); }
      setTimeout(() => mapInstance && mapInstance.invalidateSize(), 100);
      return;
    }
    showScreen('home');
    renderDriveList();
  });

  document.getElementById('btn-map-expand')?.addEventListener('click', () => {
    const mapBlock = document.querySelector('.review-map-block');
    const btn = document.getElementById('btn-map-expand');
    const isFull = mapBlock.classList.toggle('map-full');
    btn.textContent = isFull ? '×' : '⤢';
    btn.setAttribute('aria-label', isFull ? 'Close map' : 'Expand map');
    if (!isFull) clearMapFilter();
    setTimeout(() => mapInstance && mapInstance.invalidateSize(), 100);
  });

  document.getElementById('map-filter-clear')?.addEventListener('click', clearMapFilter);

  document.querySelectorAll('.event-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.classList.contains('brake') ? 'brake'
                 : chip.classList.contains('accel') ? 'accel'
                 : chip.classList.contains('stop')  ? 'stop' : 'turn';
      enterMapFilter(type);
    });
  });

  // Remove.bg API key modal
  document.getElementById('removebg-save')?.addEventListener('click', () => {
    const key = document.getElementById('removebg-key-input').value.trim();
    if (!key) return;
    localStorage.setItem(REMOVEBG_KEY, key);
    document.getElementById('removebg-modal').classList.add('hidden');
    const f = document.getElementById('removebg-modal')._pendingFile;
    if (f) processCarPhoto(f);
  });
  document.getElementById('removebg-skip')?.addEventListener('click', () => {
    document.getElementById('removebg-modal').classList.add('hidden');
    const f = document.getElementById('removebg-modal')._pendingFile;
    if (f) savePhotoPlain(f);
  });

  // Recording screen background upload
  document.getElementById('rec-photo-input')?.addEventListener('change', e => {
    if (e.target.files[0]) saveRecPhoto(e.target.files[0]);
  });
  document.getElementById('btn-go-home')?.addEventListener('click', () => {
    showScreen('home');
    renderDriveList();
  });

  // Garage sheet
  document.getElementById('btn-vehicle-type')?.addEventListener('click', showGarageSheet);
  document.getElementById('gs-close')?.addEventListener('click', hideGarageSheet);
  document.getElementById('gs-form-close')?.addEventListener('click', hideGarageSheet);
  document.getElementById('gs-back')?.addEventListener('click', () => showGarageView('list'));
  document.getElementById('gs-add-btn')?.addEventListener('click', () => openVehicleForm(null));
  document.getElementById('gs-save')?.addEventListener('click', saveVehicleForm);
  document.getElementById('gs-delete')?.addEventListener('click', () => {
    if (!_editingVehicleId) return;
    if (confirm('Delete this vehicle?')) deleteVehicle(_editingVehicleId);
  });

  // Past drives toggle
  document.getElementById('btn-view-drives')?.addEventListener('click', () => {
    const panel = document.getElementById('drives-list-panel');
    const btn = document.getElementById('btn-view-drives');
    const opening = !panel.classList.contains('open');
    panel.classList.toggle('open', opening);
    btn.textContent = opening ? 'Hide drives' : 'Past drives';
  });

});
