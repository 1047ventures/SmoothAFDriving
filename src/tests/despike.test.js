// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.stubGlobal('localStorage', { getItem: () => null, setItem(){}, removeItem(){}, clear(){} });

// NOT destructured: resetCalib() REASSIGNS `calib`, so a destructured copy
// pins the object that existed at import time while the code under test
// follows the live binding to the new one. Reach through the namespace.
const S = await import('../state.js');
const { state, resetState } = S;
const { createMotionHandler } = await import('../services/sensors/motion.js');

/**
 * Drive the real 60 Hz handler with a synthetic forward-axis signal and report
 * what reached the event thresholds (state.peakLong).
 *
 * The axes are set to unit vectors so the projection is the identity — the test
 * is about the filter, not the calibration solve.
 */
function feed(samples){
  resetState();
  state.recording = true;
  state.lastGpsPos = { lat: 39.8, lon: -105.1, speed: 27 };  // ~60 mph, highway
  S.calib.done = true;
  S.calib.gyroAvail = false;
  S.calib.fwd = [1, 0, 0];
  S.calib.lat = [0, 1, 0];
  S.calib.up  = [0, 0, 1];
  // resetState leaves this 0, which makes every sample look like the 500ms
  // window expiring (and resetting the peak). On a real drive the stopped
  // branch stamps it before the car moves; stamp it here for the same reason.
  state.peakWindowMs = Date.now();
  const handler = createMotionHandler({});
  for (const a of samples){
    handler({
      accelerationIncludingGravity: { x: a, y: 0, z: 9.81 },
      acceleration: { x: a, y: 0, z: 0 },
      rotationRate: null,
      interval: 1 / 60,
    });
  }
  return Math.abs(state.peakLong);
}

const flat = (n, v = 0) => new Array(n).fill(v);

describe('road impacts must not read as driver inputs', () => {
  // Highway tier-2 accel threshold is hardAccel(4.0) x longMult(1.35) = 5.4 m/s².
  const THRESHOLD = 5.4;

  it('a single-sample pothole does not reach the threshold', () => {
    // One 16ms sample at 18 m/s² — a hard hit, far above any throttle input.
    const peak = feed([...flat(10), 18, ...flat(10)]);
    expect(peak).toBeLessThan(THRESHOLD);
  });

  it('a two-sample expansion joint does not reach the threshold', () => {
    const peak = feed([...flat(10), 16, 16, ...flat(10)]);
    expect(peak).toBeLessThan(THRESHOLD);
  });

  it('a burst of rumble strip does not reach the threshold', () => {
    // Alternating hits, the shape that produced "a million flags" on a straight road.
    const burst = [];
    for (let i = 0; i < 30; i++) burst.push(i % 2 ? 14 : -12);
    const peak = feed([...flat(10), ...burst, ...flat(10)]);
    expect(peak).toBeLessThan(THRESHOLD);
  });

  it('a long stretch of rumble strip never builds up', () => {
    // The case a median filter gets wrong: alternation is not an outlier, it is
    // the majority of the window. 4 seconds of it must still read as nothing.
    const long = [];
    for (let i = 0; i < 240; i++) long.push(i % 2 ? 13 : -13);
    expect(feed(long)).toBeLessThan(THRESHOLD);
  });

  it('but a real braking input still gets through', () => {
    // 6 m/s² held for 400ms — an ordinary firm brake.
    const peak = feed([...flat(10), ...flat(24, -6), ...flat(10)]);
    expect(peak).toBeGreaterThanOrEqual(6 - 0.01);
  });

  it('and a real throttle push still gets through', () => {
    const peak = feed([...flat(10), ...flat(30, 7), ...flat(10)]);
    expect(peak).toBeGreaterThanOrEqual(7 - 0.01);
  });

  it('a sustained input riding on a rough road survives the filter', () => {
    // Braking at 6 m/s² while the road adds alternating single-sample noise:
    // the input is what persists, so it is what should be measured.
    const mixed = [];
    for (let i = 0; i < 30; i++) mixed.push(i % 3 === 0 ? -17 : -6);
    const peak = feed([...flat(10), ...mixed, ...flat(10)]);
    expect(peak).toBeGreaterThanOrEqual(6 - 0.01);
    expect(peak).toBeLessThan(17);        // the spikes did not set the peak
  });
});
