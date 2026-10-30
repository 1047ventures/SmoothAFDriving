import { describe, it, expect } from 'vitest';
import { conciergeReadout } from '../services/concierge.js';

const care = {
  vid: 'v1', odo: 48210,
  car: { year: 2019, make: 'Subaru', model: 'Outback' },
  findings: [{ title: 'Brake pads worth a look', evidence: '14 hard stops per 100 mi', advice: 'Check pad thickness.' }],
  timeline: [{ name: 'Oil change', status: 'overdue', due: '600 mi over' }, { name: 'Wipers', status: 'ok', due: 'in 3 months' }],
  drives: [
    { score: 88, vehicleId: 'v1', distanceMeters: 16093, durationMs: 1_200_000, ts: Date.UTC(2026, 9, 29),
      events: [{ type: 'brake', lat: 40.01, lon: -105.27 }, { type: 'turn' }], wear: { hits: 1 } },
    { score: 50, simulated: true, distanceMeters: 1000, durationMs: 60000, ts: 1, events: [] },
  ],
};

describe('conciergeReadout', () => {
  it('covers the car, findings, codes, battery, service and drives', () => {
    const r = conciergeReadout(care, {
      report: { checkedAt: Date.now(), milOn: true, unread: 0, codes: [{ code: 'P0420', title: 'Catalyst efficiency low', severity: 'soon', pending: false }] },
      battery: { parts: [{ name: 'Resting', v: 12.31, state: 'watch' }, { name: 'Charging', v: null }] },
      asked: care.findings[0],
    });
    expect(r).toContain('2019 Subaru Outback, about 48,210 miles');
    expect(r).toContain('They tapped Ask on: Brake pads worth a look');
    expect(r).toContain('P0420: Catalyst efficiency low');
    expect(r).toContain('Check-engine light ON');
    expect(r).toContain('Resting: 12.31 V (watch)');
    expect(r).toContain('Oil change: overdue');
    expect(r).not.toContain('Wipers');
    expect(r).toContain('score 88, 10.0 mi, 20 min, 1 harsh braking');
    expect(r).toContain('1 big bumps');
  });
  it('leaves out simulated drives and never includes locations', () => {
    const r = conciergeReadout(care);
    expect(r).not.toContain('score 50');
    expect(r).not.toMatch(/40\.01|105\.27/);
    expect(r).toContain('No scan yet');
    expect(r).toContain('No voltage readings yet');
  });
  it('only includes this car\'s drives', () => {
    const r = conciergeReadout({ ...care, drives: [{ ...care.drives[0], vehicleId: 'v2' }] });
    expect(r).toContain('No drives recorded yet');
  });
  it('handles no car', () => {
    expect(conciergeReadout(null)).toMatch(/No car/);
  });
});
