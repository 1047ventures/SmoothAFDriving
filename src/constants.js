// Injected by Vite at build time (see resolveVersion in vite.config.js). In CI
// this is the TestFlight build number, so what the app reports and what the
// build list shows are the same number. The fallback keeps tests and any
// non-Vite consumer working, since __APP_VERSION__ only exists after bundling.
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// The one public link we hand out to share the app. It must point at the
// LIVE PWA, not the marketing brand site: smoothafdriving.com currently serves
// a separate Lovable marketing page with no funnel into the app, while the
// pages.dev host serves the real installable app + /install landing page.
// Centralized here so a future branded domain (e.g. app.smoothafdriving.com →
// Cloudflare Pages) is a one-line swap, not a hunt through share strings.
export const INSTALL_URL = 'https://smoothafdriving.pages.dev/install';

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
export const OSM_SPEED_CACHE    = 'smoothaf.osm_speed';
export const SOCIAL_HANDLES_KEY = 'smoothaf.social_handles';
export const SHARE_PROMPTED_KEY = 'smoothaf.share_prompted';
export const CORRIDORS_KEY      = 'smoothaf.corridors';
export const AUTH_KEY           = 'smoothaf.auth';
// Last OBD adapter connected, so the app can silently reconnect to it next time
// instead of making you re-pick from a scan every drive. Stores {deviceId,name}.
export const OBD_DEVICE_KEY     = 'smoothaf.obd_device';
// First-run visual intro shown once, before the first drive. Drive-first: it
// primes permissions and sets expectations but never asks anyone to sign up.
export const INTRO_SEEN_KEY     = 'smoothaf.intro_seen';
// Shown once, after a drive, to a signed-out driver: share this drive + sign in
// to keep it. Deferred to here (not the first open) so the ask lands after the
// value is felt and some social capital is on the line.
export const FIRST_CTA_KEY      = 'smoothaf.first_cta';

// ── Supabase ──────────────────────────────────────────────────────────────────
// The anon key is public by design — it is the browser-facing key and carries no
// privileges beyond what row-level security grants. Lives here (not in
// supabase.js) so auth.js can use it without a circular import.
export const SB_URL  = 'https://dbreetxubxdxogmektxc.supabase.co';
export const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRicmVldHh1YnhkeG9nbWVrdHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjY5ODgsImV4cCI6MjA5MjkwMjk4OH0.hMeEhYpNNgZ67Nh9GnjwJvtSBbdQVhbdjiBBNNG5qe4';

export const MAX_STORED_DRIVES = 200;  // metadata-only restored drives are tiny (~600B each);
                                       // saveDrives() sheds GPS samples if the quota is hit.
export const OSM_CACHE_TTL  = 30 * 24 * 60 * 60 * 1000; // 30 days
export const OSM_CACHE_MAX  = 500;                        // LRU eviction above this

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
// Tier 1 subtle (55%) · tier 2 moderate (100%) · tier 3 harsh (175%) · tier 4 extreme (260%)
// TIER_MULT still weights the momentum-series chart; TIER_THRESH gates live
// event detection (the in-drive flashes). Both are display/feedback only now —
// the headline score comes entirely from analyzeDrive's dimensions.
export const TIER_MULT   = { 1: 0.14, 2: 1.0, 3: 2.4, 4: 4.0 };
export const TIER_THRESH = { 1: 0.55, 2: 1.0,  3: 1.75, 4: 2.6 };

// Plausibility cap on GPS-derived lateral acceleration (m/s²). Lateral is
// heading-change × speed, and a single-sample heading glitch at highway speed
// produces absurd phantom "turns" (10–28 g were seen in real drives). No street
// corner exceeds ~9 m/s² (~0.9 g), so we clamp to that and treat anything beyond
// it as GPS noise rather than driving. (See gps.js processSample.)
export const LAT_ACCEL_CAP = 9;

// ── Three-Dimension Scoring display ──────────────────────────────────────────
// Trimmed from seven to the three the phone's sensors actually resolve, weighted
// by real signal. The four dropped (steering, cornering, transitions, throttle)
// were computed from 1 Hz GPS-derived lateral/jerk/flip data too coarse to ever
// move — they handed ~100 to every drive and only flattened the score. Lateral
// is deliberately NOT a scored axis: GPS heading jitter makes it untrustworthy
// (it was firing hundreds of phantom "sharp turns"). Smoothness rides the
// LONGITUDINAL signal (accel/brake), which heading noise cannot corrupt.
export const DIM_WEIGHTS = {
  smoothness: 0.50,
  momentum:   0.30,
  braking:    0.20,
};

export const DIM_DISPLAY = [
  { key: 'smoothness', label: 'Smoothness'          },
  { key: 'braking',    label: 'Braking Anticipation'},
  { key: 'momentum',   label: 'Momentum Management' },
];

// ── Scoring dials — calibrated against 25 real drives (median → ~80) ──────────
// Smoothness = 0.6·longitudinal-g + 0.4·jerk, each mapped through these anchors.
// Re-tune here as more varied drives come in. Targets: average 80–85, clean 90+,
// genuinely rough (stop-and-go / jerky) 45–65, ultra-smooth highway 95–100.
export const SMOOTH_LA_LO    = 0.15; // p85 |longitudinal g| (m/s²) scoring 100
export const SMOOTH_LA_HI    = 1.2;  // p85 |longitudinal g| scoring 0
export const SMOOTH_JERK_LO  = 0.05; // mean |jerk| (m/s³) scoring 100
export const SMOOTH_JERK_HI  = 0.6;  // mean |jerk| scoring 0
export const MOMENTUM_STOP_MAX = 4.5; // full stops per mile that score 0

// Speed difficulty multiplier: holding the car smooth at speed is harder than at
// a crawl, so a smooth fast drive earns a bonus the same smoothness at low speed
// does not. Gated by the base score — sloppy-but-fast earns almost none.
export const SPEED_DIFF_LO_MPH = 25;  // at/below this avg moving speed: no bonus
export const SPEED_DIFF_HI_MPH = 65;  // at/above this: full bonus
export const SPEED_BONUS_MAX   = 5;   // max points added for a smooth, fast drive

// ── Ride Composure — how calm the cabin actually was ─────────────────────────
// From the 60 Hz accelerometer's vertical+pitch RMS (state.currentRoughness),
// stored per sample as `rr`. This is what the PASSENGER feels: rumble strips,
// wind/truck buffeting, road texture, and sway you didn't counter all spike it —
// a rougher ride than it could have been, whatever the cause. A smooth ride on a
// glassy road scores high; the same inputs on a bus getting shoved around does
// not. PROVISIONAL anchors — recalibrate once real mounted-phone drives land.
export const RIDE_RR_LO = 0.4;  // vertical RMS (m/s²) that scores 100 (glassy calm)
export const RIDE_RR_HI = 3.0;  // vertical RMS that scores 0 (rumble strips / heavy buffeting)

// A perfect 100 is meant to be nearly impossible. Without a ride-quality
// measurement (GPS-only drive, no mounted phone) we can't certify the cabin
// stayed calm, so such a drive is capped here — the top of the range is reserved
// for drives where the sensors actually confirmed a smooth ride.
export const NO_RIDE_DATA_CEILING = 95;

// ── Voice labels ──────────────────────────────────────────────────────────────
export const VOICE_LABELS = { brake: 'Hard brake!', accel: 'Hard acceleration!', turn: 'Sharp turn!', shift: 'Rough shift!' };

// ── Photo / garage keys ───────────────────────────────────────────────────────
export const CAR_PHOTO_KEY = 'smoothaf.car_photo';
export const CAR_POS_KEY   = 'smoothaf.car_pos';
export const REC_PHOTO_KEY = 'smoothaf.rec_photo';
export const REC_POS_KEY   = 'smoothaf.rec_pos';
export const GARAGE_KEY    = 'smoothaf.garage';

// ── Destination Drive (routing + effectiveness) ───────────────────────────────
// 'mapbox' uses Mapbox (traffic-aware) when a token is present, else falls back
// to 'osm' (free Nominatim+OSRM, no live traffic). So the app works before the
// key is set and goes traffic-aware automatically once VITE_MAPBOX_TOKEN exists.
export const ROUTING_PROVIDER = 'mapbox';
export const MAPBOX_TOKEN     = import.meta.env?.VITE_MAPBOX_TOKEN || '';
export const MAPBOX_BASE      = 'https://api.mapbox.com';
export const NOMINATIM_BASE   = 'https://nominatim.openstreetmap.org';
export const OSRM_BASE        = 'https://router.project-osrm.org';
// The target you're scored against is the raw route ETA times a buffer. Which
// buffer depends on where the ETA came from, and getting this wrong is exactly
// the "beat a 40-min drive by 14 minutes" bug: OSRM returns free-flow times with
// no lights or traffic, so 1.2 pads it toward reality — but that same 1.2 on top
// of a Mapbox traffic-aware ETA (which already counts lights and congestion)
// just hands you 20% of free time. Use routing.etaBuffer(), never the raw
// constant, so the value tracks the active provider.
export const ETA_BUFFER         = 1.2;    // OSRM: free-flow, needs real padding
export const ETA_BUFFER_TRAFFIC = 1.05;   // Mapbox driving-traffic: already realistic; a hair for final approach/parking
export const PACE_PENALTY     = 180;      // effectiveness points lost per unit of over-fraction
export const ARRIVAL_RADIUS_M = 200;      // must end within this of the destination for effectiveness to count
export const CLOCK_MAX_SWING = 15;   // max ± points the clock can move the score
export const CLOCK_BEAT_FULL = 0.20; // beating the (buffered) ETA by 20% = full +bonus
export const CLOCK_LATE_FULL = 0.20; // 20% over the (buffered) ETA = full -penalty
export const SCORE_MAX        = 100 + CLOCK_MAX_SWING; // drives can break 100 (rare)

// ── Live ETA + pit-stop detection ──────────────────────────────────────────────
export const LIVE_ETA_REFRESH_MS = 60000;  // re-fetch the traffic-aware ETA at most this often
export const PIT_SPEED_MPS       = 0.7;     // below this the car is "stationary"
export const PIT_STOP_MS         = 180000;  // a stationary run this long = a pit stop (gas/coffee),
                                            // not a traffic light — its whole duration is excluded
                                            // from the clock so a mid-drive stop can't make you "late".
