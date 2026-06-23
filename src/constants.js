export const APP_VERSION = 'v75';

// ── Storage keys ──────────────────────────────────────────────────────────────
export const STORAGE_KEY        = 'smoothaf.drives.v1';
export const DEVICE_KEY         = 'smoothaf.device_id';
export const SYNCED_KEY         = 'smoothaf.synced_ids';
export const LIFETIME_SCORE_KEY = 'smoothaf.lifetime_score';
export const DRIVER_NAME_KEY    = 'smoothaf.driver_name';
export const USER_EMAIL_KEY     = 'smoothaf.user_email';
export const ONBOARDED_KEY      = 'smoothaf.onboarded';
export const PROFILE_SYNCED_KEY = 'smoothaf.profile_synced';
export const CAR_PROMPTED_KEY   = 'smoothaf.car_prompted';
export const VEHICLE_KEY        = 'smoothaf.vehicle_type';
export const ACTIVE_DRIVE_KEY   = 'smoothaf.active_drive';

export const MAX_STORED_DRIVES = 20;

// ── Vehicle types ─────────────────────────────────────────────────────────────
export const VEHICLE_TYPES = [
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

// ── Detection thresholds (tier-2 baseline) ────────────────────────────────────
// Tier 1 fires at 55% of these, tier 3 at 175%.
// Raised again — real-world drives showed too many false positive tier-1 accel/brake events.
export const DEFAULTS = {
  hardBrake:     4.5,   // m/s² — tier-1 fires at 2.48; normal city braking rarely exceeds this
  hardAccel:     4.0,   // m/s² — tier-1 fires at 2.20; normal on-ramp rarely triggers
  sharpTurn:     4.5,   // m/s² lateral — GPS heading jitter was causing false highway events
  emaAlpha:      0.25,  // more smoothing vs 0.32 — filters single-sample GPS spikes
  jerkThreshold: 5.5,   // m/s³ — gear-change / abrupt transmission event
  // ── Tier-2 base penalties (multiplied by tier factor below) ─────────────
  penaltyBrake:  4.5,
  penaltyAccel:  3.2,
  penaltyTurn:   4.0,
  // ── Tier multipliers: tier1 × 0.14, tier2 × 1.0, tier3 × 2.4 ───────────
};

// Mutable singleton — can be tuned at runtime
export const CFG = { ...DEFAULTS };

// ── Timing constants ──────────────────────────────────────────────────────────
export const EVENT_COOLDOWN_MS   = 1500; // 1.5s — prevents one brake from logging 3 events
export const CALIB_DURATION_MS   = 10000; // 10s calibration window
export const CALIB_MIN_PAIRS     = 5;     // need at least 5 GPS↔motion pairs
export const CALIB_MIN_SPEED_MPS = 2;     // only pair samples when moving
export const MOTION_BUF_SIZE     = 20;    // ring buffer depth (60Hz → ~330ms)

// ── Scoring constants ─────────────────────────────────────────────────────────
// Tier 1 fires at 55% of threshold · tier 2 moderate · tier 3 harsh (175%)
export const TIER_MULT = { 1: 0.14, 2: 1.0, 3: 2.4 };
// Confidence weighting: blend raw score toward 100 for short drives.
// CONFIDENCE_PRIOR = 120 GPS samples ≈ 2 minutes. At exactly 2 min of data,
// the raw score is weighted 50% — prevents 30-second test drives showing 100.
export const CONFIDENCE_PRIOR = 120;

// ── Seven-Dimension Scoring display ──────────────────────────────────────────
export const DIM_WEIGHTS = {
  peakHarshness: 0.20,
  throttle:      0.20,
  steering:      0.10,
  braking:       0.15,
  cornering:     0.10,
  transitions:   0.10,
  momentum:      0.15,
};

export const DIM_DISPLAY = [
  { key: 'peakHarshness', label: 'Peak Harshness'       },
  { key: 'throttle',      label: 'Throttle Steadiness'  },
  { key: 'steering',      label: 'Steering Steadiness'  },
  { key: 'braking',       label: 'Braking Anticipation' },
  { key: 'cornering',     label: 'Corner Composure'     },
  { key: 'transitions',   label: 'Transition Smoothness'},
  { key: 'momentum',      label: 'Momentum Management'  },
];

// ── Voice labels ──────────────────────────────────────────────────────────────
export const VOICE_LABELS = { brake: 'Hard brake!', accel: 'Hard acceleration!', turn: 'Sharp turn!', shift: 'Rough shift!' };

// ── Photo / garage keys ───────────────────────────────────────────────────────
export const CAR_PHOTO_KEY = 'smoothaf.car_photo';
export const REMOVEBG_KEY  = 'smoothaf.removebg_key';
export const CAR_POS_KEY   = 'smoothaf.car_pos';
export const REC_PHOTO_KEY = 'smoothaf.rec_photo';
export const REC_POS_KEY   = 'smoothaf.rec_pos';
export const GARAGE_KEY    = 'smoothaf.garage';
