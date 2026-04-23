export interface MotionSample {
  timestamp: number;
  ax: number; // lateral g-force (cornering) — gravity-free
  ay: number; // longitudinal g-force (accel/brake) — gravity-free
  az: number; // vertical g-force (road surface) — gravity-free
  speed: number; // km/h
}

export interface ScoreEvent {
  type: "hard_brake" | "hard_accel" | "hard_corner" | "rough_road";
  magnitude: number;
  timestamp: number;
  penalty: number;
}

export interface ScoreState {
  score: number;
  events: ScoreEvent[];
  hardBrakes: number;
  hardAccels: number;
  hardCorners: number;
  windowSamples: MotionSample[];
}

// Strict thresholds — triggers on real inputs, not just emergencies.
// These intentionally fire on normal driving to create meaningful scoring separation.
const THRESHOLDS = {
  hard_brake:  0.18,  // firm braking, not panic-stop
  hard_accel:  0.12,  // spirited pull from a stop
  hard_corner: 0.15,  // definite lane change or turn-in
  rough_road:  0.25,  // significant bump / pothole
};

const PENALTIES = {
  hard_brake:  5,
  hard_accel:  4,
  hard_corner: 4,
  rough_road:  1,
};

const MAX_HARSH_PENALTY  = 22;
const MAX_SMOOTH_PENALTY = 20;
const WINDOW_MS          = 60_000;
const SMOOTH_WINDOW_MS   = 30_000;
const DEBOUNCE_MS        = 2_000;

export function createScoreState(): ScoreState {
  return { score: 100, events: [], hardBrakes: 0, hardAccels: 0, hardCorners: 0, windowSamples: [] };
}

export function processSample(state: ScoreState, sample: MotionSample): ScoreState {
  const now = sample.timestamp;

  const windowSamples = [...state.windowSamples, sample].filter(
    s => now - s.timestamp < WINDOW_MS
  );

  const events = [...state.events];
  let { hardBrakes, hardAccels, hardCorners } = state;

  const addEvent = (type: ScoreEvent["type"], magnitude: number) => {
    const lastOfType = events.filter(e => e.type === type).at(-1);
    if (lastOfType && now - lastOfType.timestamp < DEBOUNCE_MS) return;
    events.push({ type, magnitude, timestamp: now, penalty: PENALTIES[type] });
    if (type === "hard_brake")  hardBrakes++;
    if (type === "hard_accel")  hardAccels++;
    if (type === "hard_corner") hardCorners++;
  };

  if (sample.ay < -THRESHOLDS.hard_brake)             addEvent("hard_brake",  Math.abs(sample.ay));
  if (sample.ay >  THRESHOLDS.hard_accel)              addEvent("hard_accel",  sample.ay);
  if (Math.abs(sample.ax) > THRESHOLDS.hard_corner)   addEvent("hard_corner", Math.abs(sample.ax));
  if (Math.abs(sample.az) > THRESHOLDS.rough_road)    addEvent("rough_road",  Math.abs(sample.az));

  // Harsh event penalty: each event hits immediately, capped so a rough mile
  // doesn't zero out the score entirely.
  const windowEvents = events.filter(e => now - e.timestamp < WINDOW_MS);
  const harshPenalty = Math.min(
    MAX_HARSH_PENALTY,
    windowEvents.reduce((sum, e) => sum + e.penalty, 0)
  );

  // Continuous smoothness penalty: RMS of horizontal composite over 30s.
  // No floor — any non-zero motion costs points. This makes highway "choppiness"
  // visible even without hard events triggering.
  // Tight pro driving ~0.02g → ~3.6 pts. Normal city ~0.08g → ~14 pts.
  const recentSamples = windowSamples.filter(s => now - s.timestamp < SMOOTH_WINDOW_MS);
  let smoothnessPenalty = 0;
  if (recentSamples.length >= 10) {
    const rmsG = Math.sqrt(
      recentSamples.reduce((sum, s) => sum + s.ax * s.ax + s.ay * s.ay, 0) / recentSamples.length
    );
    smoothnessPenalty = Math.min(MAX_SMOOTH_PENALTY, rmsG * 180);
  }

  const score = Math.max(0, Math.min(100, 100 - harshPenalty - smoothnessPenalty));

  return { score, events, hardBrakes, hardCorners, hardAccels, windowSamples };
}

export function scoreColor(score: number): string {
  if (score >= 88) return "hsl(142 69% 58%)";
  if (score >= 72) return "hsl(43 96% 56%)";
  return "hsl(0 91% 71%)";
}

export function scoreLabel(score: number): string {
  if (score >= 95) return "Smooth AF";
  if (score >= 88) return "Very Smooth";
  if (score >= 80) return "Smooth";
  if (score >= 70) return "Getting There";
  if (score >= 55) return "Choppy";
  return "Aggressive";
}
