export interface MotionSample {
  timestamp: number;
  ax: number; // lateral g-force (cornering)
  ay: number; // longitudinal g-force (accel/brake)
  az: number; // vertical g-force (road surface)
  speed: number; // km/h
}

export interface ScoreEvent {
  type: "hard_brake" | "hard_accel" | "hard_corner" | "rough_road";
  magnitude: number;
  timestamp: number;
  penalty: number;
}

export interface ScoreState {
  score: number;          // 0-100
  events: ScoreEvent[];
  hardBrakes: number;
  hardAccels: number;
  hardCorners: number;
  windowSamples: MotionSample[];
}

const THRESHOLDS = {
  hard_brake: 0.35,    // g-force longitudinal (deceleration)
  hard_accel: 0.28,    // g-force longitudinal (acceleration)
  hard_corner: 0.32,   // g-force lateral
  rough_road: 0.45,    // g-force vertical
};

const PENALTIES = {
  hard_brake: 3,
  hard_accel: 2,
  hard_corner: 2,
  rough_road: 1,
};

const WINDOW_MS = 60_000; // rolling 60-second window
const DEBOUNCE_MS = 2_000; // min time between same-type events

export function createScoreState(): ScoreState {
  return { score: 100, events: [], hardBrakes: 0, hardAccels: 0, hardCorners: 0, windowSamples: [] };
}

export function processSample(state: ScoreState, sample: MotionSample): ScoreState {
  const now = sample.timestamp;

  // Trim window
  const windowSamples = [...state.windowSamples, sample].filter(
    s => now - s.timestamp < WINDOW_MS
  );

  const events = [...state.events];
  let { hardBrakes, hardAccels, hardCorners } = state;

  const addEvent = (type: ScoreEvent["type"], magnitude: number) => {
    const lastOfType = events.filter(e => e.type === type).at(-1);
    if (lastOfType && now - lastOfType.timestamp < DEBOUNCE_MS) return;
    events.push({ type, magnitude, timestamp: now, penalty: PENALTIES[type] });
    if (type === "hard_brake") hardBrakes++;
    if (type === "hard_accel") hardAccels++;
    if (type === "hard_corner") hardCorners++;
  };

  if (sample.ay < -THRESHOLDS.hard_brake) addEvent("hard_brake", Math.abs(sample.ay));
  if (sample.ay > THRESHOLDS.hard_accel) addEvent("hard_accel", sample.ay);
  if (Math.abs(sample.ax) > THRESHOLDS.hard_corner) addEvent("hard_corner", Math.abs(sample.ax));
  if (Math.abs(sample.az - 1) > THRESHOLDS.rough_road) addEvent("rough_road", Math.abs(sample.az - 1));

  // Score = 100 minus total penalties from events in window
  const windowEvents = events.filter(e => now - e.timestamp < WINDOW_MS);
  const totalPenalty = windowEvents.reduce((sum, e) => sum + e.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  return { score, events, hardBrakes, hardCorners, hardAccels, windowSamples };
}

export function scoreColor(score: number): string {
  if (score >= 80) return "hsl(142 69% 58%)";
  if (score >= 60) return "hsl(43 96% 56%)";
  return "hsl(0 91% 71%)";
}

export function scoreLabel(score: number): string {
  if (score >= 90) return "Smooth AF";
  if (score >= 80) return "Smooth";
  if (score >= 65) return "Getting There";
  if (score >= 50) return "Choppy";
  return "Aggressive";
}
