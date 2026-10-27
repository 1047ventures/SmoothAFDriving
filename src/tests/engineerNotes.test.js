import { describe, it, expect } from 'vitest';
import { engineerNotes, eventName } from '../services/engineerNotes.js';

// Heading north along lon -75: samples every 1s, ~11 m apart.
const samples = Array.from({ length: 40 }, (_, i) => ({ t: i * 1000, lat: 40 + i * 0.0001, lon: -75 }));
const MI = 1609.344;
const brake = (over = {}) => ({ type: 'brake', tier: 3, severity: 3, t: 20000, lat: 40.002, lon: -75, speedMph: 22, ...over });

describe('engineerNotes', () => {
  it('writes a fix note with time, speed and advice for the worst event', () => {
    const n = engineerNotes({ events: [brake()], samples, distanceMeters: MI }, { smoothStreakMi: 0.1 });
    expect(n).toHaveLength(1);
    expect(n[0].tone).toBe('fix');
    expect(n[0].title).toMatch(/^Hard brake · .* in · 22 mph$/);
    expect(n[0].lat).toBe(40.002);
  });
  it('collapses repeats of one kind into a single note that counts them', () => {
    const n = engineerNotes({ events: [brake(), brake({ severity: 4, t: 30000 }), brake({ t: 10000 })], samples, distanceMeters: MI }, {});
    const fixes = n.filter(x => x.tone === 'fix');
    expect(fixes).toHaveLength(1);
    expect(fixes[0].body).toContain('1 of 3 hard brakes');
  });
  it('keeps at most two fix notes, worst kinds first', () => {
    const evs = [brake({ severity: 2 }), { type: 'accel', tier: 3, severity: 4, t: 5000 }, { type: 'turn', tier: 4, severity: 5, t: 8000 }];
    const n = engineerNotes({ events: evs, samples, distanceMeters: MI }, {});
    expect(n.map(x => x.title.split(' · ')[0])).toEqual(['Extreme turn', 'Hard accel']);
  });
  it('blames traffic when no light or sign was ahead of a brake', () => {
    const n = engineerNotes({ events: [brake()], samples, distanceMeters: MI }, {}, []);
    expect(n[0].body).toMatch(/it was traffic/);
  });
  it('names the light when one was just ahead of the brake', () => {
    const n = engineerNotes({ events: [brake()], samples, distanceMeters: MI }, {}, [{ lat: 40.0021, lon: -75, kind: 'signal' }]);
    expect(n[0].body).toMatch(/light ahead/);
  });
  it('praises the smoothest stretch, and a fully clean drive', () => {
    const withStreak = engineerNotes({ events: [brake()], samples, distanceMeters: 2 * MI }, { smoothStreakMi: 0.6 });
    expect(withStreak[1]).toMatchObject({ tone: 'praise', title: '0.6 mi with zero harsh inputs' });
    const clean = engineerNotes({ events: [], samples, distanceMeters: MI, traffic: { ratio: 1.6 } }, {});
    expect(clean).toEqual([expect.objectContaining({ tone: 'praise', title: 'Clean the whole way' })]);
    expect(clean[0].body).toMatch(/heavy traffic/);
  });
  it('names events by tier', () => {
    expect(eventName({ type: 'brake', tier: 4 })).toBe('Extreme brake');
    expect(eventName({ type: 'turn' })).toBe('Sharp turn');
  });
});
