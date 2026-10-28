import { describe, it, expect } from 'vitest';
import { smoothMiles, paceBonusFrac, trafficBonusFrac, drivePoints, lifetimePoints } from '../services/points.js';

// A straight track: n samples 1s apart, ~0.001° lat (~111 m) between each.
function track(n){
  return Array.from({ length: n }, (_, i) => ({ t: i * 1000, lat: 40 + i * 0.001, lon: -75, speed: 20 }));
}
const MI = 1609.34;

describe('smoothMiles', () => {
  it('counts the whole drive when there are no events', () => {
    const r = smoothMiles({ distanceMeters: 5 * MI, samples: track(50), events: [] });
    expect(r.totalMi).toBeCloseTo(5, 3);
    expect(r.smoothMi).toBeCloseTo(5, 3);
  });
  it('blacks out road around a harsh event', () => {
    // 49 segments; event at t=25s blacks out segment midpoints within ±8s → 16 segments
    const r = smoothMiles({ distanceMeters: 49 * 111, samples: track(50), events: [{ t: 25000 }] });
    expect(r.smoothMi / r.totalMi).toBeCloseTo(33 / 49, 2);
  });
  it('never exceeds total distance', () => {
    const r = smoothMiles({ distanceMeters: 1 * MI, samples: track(50), events: [] });
    expect(r.smoothMi).toBeLessThanOrEqual(r.totalMi + 1e-9);
  });
  it('falls back to efficiency when samples are missing', () => {
    expect(smoothMiles({ distanceMeters: 10 * MI, efficiency: 90 }).smoothMi).toBeCloseTo(10, 3);
    expect(smoothMiles({ distanceMeters: 10 * MI, efficiency: 70 }).smoothMi).toBeCloseTo(5, 3);
    expect(smoothMiles({ distanceMeters: 10 * MI, efficiency: 40 }).smoothMi).toBe(0);
  });
});

describe('paceBonusFrac', () => {
  const base = { arrived: true, targetEtaSec: 600, etaBuffer: 1.2 };
  it('pays the full bonus for a smooth drive that beat the ETA by 20%', () => {
    expect(paceBonusFrac({ ...base, movingSec: 576, efficiency: 90 })).toBeCloseTo(0.5, 5);
  });
  it('pays nothing for rough-but-fast', () => {
    expect(paceBonusFrac({ ...base, movingSec: 500, efficiency: 70 })).toBe(0);
  });
  it('pays nothing when late, not arrived, or no ETA', () => {
    expect(paceBonusFrac({ ...base, movingSec: 800, efficiency: 95 })).toBe(0);
    expect(paceBonusFrac({ ...base, arrived: false, movingSec: 500, efficiency: 95 })).toBe(0);
    expect(paceBonusFrac({ movingSec: 500, efficiency: 95, arrived: true })).toBe(0);
  });
});

describe('drivePoints', () => {
  it('a long smooth drive out-earns a short perfect one', () => {
    const short = drivePoints({ distanceMeters: 0.5 * MI, efficiency: 95 });
    const long  = drivePoints({ distanceMeters: 20 * MI, efficiency: 95 });
    expect(short.total).toBe(5);
    expect(long.total).toBe(200);
  });
  it('stacks the pace bonus on the base', () => {
    const p = drivePoints({ distanceMeters: 10 * MI, efficiency: 90, arrived: true, targetEtaSec: 600, etaBuffer: 1.2, movingSec: 576 });
    expect(p.base).toBe(100);
    expect(p.bonus).toBe(50);
    expect(p.total).toBe(150);
  });
  it('lifetimePoints prefers stamped points', () => {
    expect(lifetimePoints([{ points: { total: 42 } }, { distanceMeters: 1 * MI, efficiency: 95 }])).toBe(52);
  });
});

describe('trafficBonusFrac', () => {
  it('is zero with no traffic reading or light traffic', () => {
    expect(trafficBonusFrac({})).toBe(0);
    expect(trafficBonusFrac({ traffic: { ratio: 1.2 } })).toBe(0);
  });
  it('scales up to +50% at twice the open-road time, then caps', () => {
    expect(trafficBonusFrac({ traffic: { ratio: 1.625 } })).toBeCloseTo(0.25, 5);
    expect(trafficBonusFrac({ traffic: { ratio: 2.0 } })).toBeCloseTo(0.5, 5);
    expect(trafficBonusFrac({ traffic: { ratio: 3.5 } })).toBeCloseTo(0.5, 5);
  });
  it('multiplies only the smooth-mile base, stacking with the ETA bonus', () => {
    const p = drivePoints({ distanceMeters: 10 * MI, efficiency: 90, traffic: { ratio: 2.0 } });
    expect(p.base).toBe(100);
    expect(p.traffic).toBe(50);
    expect(p.total).toBe(p.base + p.bonus + p.traffic);
    const rough = drivePoints({ distanceMeters: 10 * MI, efficiency: 40, traffic: { ratio: 2.0 } });
    expect(rough.traffic).toBe(0);
  });
});
