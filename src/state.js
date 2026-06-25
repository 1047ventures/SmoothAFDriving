import { DEFAULTS } from './constants.js';
import { loadLifetimeScore } from './services/storage.js';

export let calib = {
  active:    false,   // collecting pairs
  done:      false,   // axes solved — use 60Hz motion detection
  failed:    false,   // couldn't solve — fall back to GPS 1Hz
  pairs:     [],      // [{gpsLong, gpsLat, mx, my, mz}]
  fwd:       null,    // [fx, fy, fz] normalised forward unit vector
  lat:       null,    // [lx, ly, lz] normalised lateral unit vector
  up:        null,
  motionBuf: [],      // recent raw {x,y,z} at 60Hz
  gravBuf:   [],
  startTime: 0,
  gyroAvail:  null,   // null=untested, true=available, false=unavailable/zero
  gyroZeroTs: 0,      // timestamp when sustained-zero rotationRate was first noticed
};

export function resetCalib(){
  calib = { active:false, done:false, failed:false, pairs:[],
            fwd:null, lat:null, up:null, motionBuf:[], gravBuf:[], startTime:0,
            gyroAvail:null, gyroZeroTs:0 };
}

export const state = {
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
  driveStartScore: 100,
  currentSpeedLimitMps: null,  // posted speed limit from OSM cache; null = no data
  rawAccel: { x: 0, y: 0, z: 0 },      // latest DeviceMotion accelerometer sample (phone frame)
  rawGyro:  { alpha: 0, beta: 0, gamma: 0 }, // latest rotationRate deg/s
};

export function resetState(){
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
  state.currentSpeedLimitMps = null;
  state.rawAccel = { x: 0, y: 0, z: 0 };
  state.rawGyro  = { alpha: 0, beta: 0, gamma: 0 };
  state.driveStartScore = loadLifetimeScore();
  state.liveScore = state.driveStartScore;
  resetCalib();
}
