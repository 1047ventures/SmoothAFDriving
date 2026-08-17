import { describe, it, expect } from 'vitest';
import {
  torqueNm, horsepower, speedRatio, learnRatio, inferGear, derive,
} from '../services/obdDerived.js';

describe('torqueNm', () => {
  it('scales the percentage against the reference figure', () => {
    expect(torqueNm(50, 400)).toBe(200);
  });
  it('keeps negative torque on the overrun rather than clamping it', () => {
    // Foot off, engine braking: the ECU reports negative torque and it's real.
    expect(torqueNm(-20, 300)).toBe(-60);
  });
  it('returns null when either PID is missing', () => {
    expect(torqueNm(50, undefined)).toBe(null);
    expect(torqueNm(undefined, 400)).toBe(null);
    expect(torqueNm(50, 0)).toBe(null);
  });
});

describe('horsepower', () => {
  it('derives hp from torque and rpm', () => {
    // 300 Nm at 5000 rpm ≈ 210 hp.
    expect(horsepower(300, 5000)).toBeCloseTo(210.5, 0);
  });
  it('is zero-ish at idle torque, never NaN', () => {
    expect(horsepower(0, 800)).toBe(0);
  });
  it('returns null without both inputs', () => {
    expect(horsepower(null, 5000)).toBe(null);
    expect(horsepower(300, 0)).toBe(null);
  });
});

describe('speedRatio', () => {
  it('is engine speed over road speed', () => {
    expect(speedRatio(2000, 50)).toBe(40);
  });
  it('refuses to compute below walking pace', () => {
    // A stationary car with the engine running is not in an infinitely tall gear.
    expect(speedRatio(800, 0)).toBe(null);
    expect(speedRatio(800, 3)).toBe(null);
  });
});

describe('learnRatio + inferGear', () => {
  // Simulate a five-speed: taller ratio = lower gear.
  const RATIOS = { 1: 60, 2: 42, 3: 32, 4: 25, 5: 20 };

  function learnFrom(sequence){
    let clusters = [];
    for (const r of sequence) clusters = learnRatio(clusters, r);
    return clusters;
  }

  it('discovers gears as clusters, ordered so index is gear number', () => {
    const clusters = learnFrom([60, 61, 59, 25, 24.5, 25.5, 42, 41, 43]);
    // Three distinct gears found; tallest first.
    expect(clusters.map(c => Math.round(c.ratio))).toEqual([60, 42, 25]);
  });

  it('names the gear once a cluster is confident', () => {
    // Third gear seen enough times to trust; a fresh 3rd-gear reading resolves.
    const clusters = learnFrom([60, 60, 60, 32, 32, 32]);
    expect(inferGear(clusters, 32)).toBe(2);   // two known gears, 32 is the 2nd tallest
  });

  it('stays quiet until a cluster has enough observations', () => {
    // One glimpse of a ratio is as likely a shift-in-progress as a real gear.
    const clusters = learnFrom([60, 32]);
    expect(inferGear(clusters, 32)).toBe(null);
  });

  it('does not renumber a known gear when a new one is discovered later', () => {
    // Learn 2nd and 4th first; 4th is "gear 2" of what's known.
    let clusters = learnFrom([42, 42, 42, 25, 25, 25]);
    expect(inferGear(clusters, 25)).toBe(2);
    // Now discover 1st gear (taller). 25 must still be reported relative to ALL
    // gears — it becomes 3rd — not silently keep its old number.
    clusters = learnFrom([42, 42, 42, 25, 25, 25, 60, 60, 60]);
    expect(inferGear(clusters, 25)).toBe(3);
    void RATIOS;
  });

  it('returns null for a ratio that matches no known gear', () => {
    const clusters = learnFrom([60, 60, 60]);
    expect(inferGear(clusters, 20)).toBe(null);
  });
});

describe('derive', () => {
  it('carries the learned clusters forward across polls', () => {
    let state = derive({ rpm: 3000, speedKmh: 50, clusters: [] });
    expect(state.clusters).toHaveLength(1);
    state = derive({ rpm: 3060, speedKmh: 51, clusters: state.clusters });
    // Same ratio band → same cluster refined, not a second one.
    expect(state.clusters).toHaveLength(1);
    expect(state.clusters[0].n).toBe(2);
  });

  it('produces power and torque when the torque PIDs are present', () => {
    const out = derive({ rpm: 4000, speedKmh: 80, torquePct: 75, torqueRef: 400 });
    expect(out.torqueNm).toBe(300);
    expect(out.horsepower).toBeCloseTo(168.4, 0);
  });

  it('leaves power and torque null when the car does not report torque', () => {
    const out = derive({ rpm: 4000, speedKmh: 80 });
    expect(out.torqueNm).toBe(null);
    expect(out.horsepower).toBe(null);
    // Ratio-based figures still work without the torque PIDs.
    expect(out.ratio).toBe(50);
  });
});
