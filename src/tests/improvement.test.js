import { describe, it, expect } from 'vitest';
import { improvementVerdict, compareMeasure, MEASURES, eligibleDrives } from '../services/improvement.js';

const MI = 1609.34;
// newest-first list builder: each spec → a 10-mile drive
function drive({ brakes = 0, accels = 0, eff = 85, smooth = 80, mi = 10, ...rest } = {}){
  const events = [
    ...Array.from({ length: brakes }, (_, i) => ({ type: 'brake', t: i * 1000 })),
    ...Array.from({ length: accels }, (_, i) => ({ type: 'accel', t: i * 1000 })),
  ];
  return { distanceMeters: mi * MI, score: eff, efficiency: eff, dims: { smoothness: smooth },
           events, eventCount: events.length, samples: [], ...rest };
}
const many = (n, spec) => Array.from({ length: n }, () => drive(spec));

describe('improvementVerdict', () => {
  it('asks for more drives below 6 eligible', () => {
    const v = improvementVerdict(many(4, {}));
    expect(v.status).toBe('not-enough');
    expect(v.need).toBe(2);
  });

  it('calls out fewer hard brakes per mile', () => {
    // recent 5: 1 brake/10mi; baseline 10: 4 brakes/10mi → 75% fewer
    const v = improvementVerdict([...many(5, { brakes: 1 }), ...many(10, { brakes: 4 })]);
    expect(v.status).toBe('improving');
    expect(v.measure).toBe('braking');
    expect(v.headline).toBe('Hard braking down 75%');
    expect(v.detail).toBe('your last 5 drives vs the 10 before');
  });

  it('leads with progress even when something else slipped', () => {
    const v = improvementVerdict([...many(5, { brakes: 1, accels: 3 }), ...many(10, { brakes: 4, accels: 2 })]);
    expect(v.status).toBe('improving');
    expect(v.measure).toBe('braking');
  });

  it('reports a slip with a tip when nothing improved', () => {
    const v = improvementVerdict([...many(5, { brakes: 4 }), ...many(10, { brakes: 1 })]);
    expect(v.status).toBe('slipping');
    expect(v.headline).toBe('Hard braking up 300%');
    expect(v.tip).toMatch(/earlier/);
  });

  it('is steady when changes are within noise', () => {
    const v = improvementVerdict([...many(5, { brakes: 2, eff: 86 }), ...many(10, { brakes: 2, eff: 85 })]);
    expect(v.status).toBe('steady');
  });

  it('splits small histories evenly', () => {
    const v = improvementVerdict([...many(3, { eff: 92, smooth: 90 }), ...many(4, { eff: 80, smooth: 70 })]);
    expect(v.detail).toBe('your last 3 drives vs the 4 before');
    expect(v.status).toBe('improving');
  });

  it('ignores simulated and too-short drives', () => {
    const d = [drive({ simulated: true }), drive({ mi: 0.1 }), drive()];
    expect(eligibleDrives(d)).toHaveLength(1);
  });
});

describe('compareMeasure', () => {
  const braking = MEASURES.find(m => m.key === 'braking');
  it('skips cloud-restored drives with eventCount but no events', () => {
    const restored = Array.from({ length: 5 }, () => drive({ events: [], eventCount: 3 }));
    expect(compareMeasure(braking, restored, many(5, { brakes: 2 }))).toBeNull();
  });
  it('pools rates by miles instead of averaging per drive', () => {
    // one 0.5-mi hop with a brake + four clean 20-mi drives = 1 brake / 80.5 mi
    const recent = [drive({ mi: 0.5, brakes: 1 }), ...many(4, { mi: 20 })];
    const base = many(5, { mi: 20, brakes: 2 });   // 10 brakes / 100 mi
    const r = compareMeasure(braking, recent, base);
    expect(r.dir).toBe('better');
    expect(r.recent).toBeCloseTo(10 / 80.5, 3);
  });
  it('says nothing when the baseline had no events to improve from', () => {
    expect(compareMeasure(braking, many(5, {}), many(5, {}))).toBeNull();
  });
});
