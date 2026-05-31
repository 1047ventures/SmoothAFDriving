import { describe, it, expect } from 'vitest';
import { scoreFromEvents, analyzeDrive, getDriverPersona } from '../services/scoring.js';
import { DEFAULTS } from '../constants.js';

const cfg = { ...DEFAULTS };

describe('scoreFromEvents', () => {
  it('returns 100 for no events', () => {
    expect(scoreFromEvents([], cfg, 300)).toBe(100);
  });

  it('deducts points for a tier-2 brake event', () => {
    const events = [{ type: 'brake', tier: 2, severity: 1 }];
    const score = scoreFromEvents(events, cfg, 300);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(0);
  });

  it('tier-3 deducts more than tier-2', () => {
    const tier2 = scoreFromEvents([{ type: 'brake', tier: 2, severity: 1 }], cfg, 300);
    const tier3 = scoreFromEvents([{ type: 'brake', tier: 3, severity: 1 }], cfg, 300);
    expect(tier3).toBeLessThan(tier2);
  });

  it('blends toward 100 for short drives (low sample count)', () => {
    const events = [{ type: 'brake', tier: 2, severity: 1 }];
    const longDrive  = scoreFromEvents(events, cfg, 1000);
    const shortDrive = scoreFromEvents(events, cfg, 10);
    expect(shortDrive).toBeGreaterThan(longDrive);
  });

  it('skips shift events (informational only)', () => {
    const shift = scoreFromEvents([{ type: 'shift', tier: 2, severity: 1 }], cfg, 300);
    expect(shift).toBe(100);
  });

  it('applies road roughness reduction', () => {
    const smooth = scoreFromEvents([{ type: 'brake', tier: 2, severity: 1, roadRoughness: 0 }], cfg, 300);
    const rough  = scoreFromEvents([{ type: 'brake', tier: 2, severity: 1, roadRoughness: 3.5 }], cfg, 300);
    expect(rough).toBeGreaterThan(smooth);
  });
});

describe('analyzeDrive', () => {
  const makeDrive = (samples, events = []) => ({
    samples, events, durationMs: samples.length * 1000,
    distanceMeters: 1000, topSpeedMps: 15,
  });

  it('returns safe defaults for very short drives', () => {
    const result = analyzeDrive(makeDrive([]));
    expect(result.score).toBe(85);
    expect(result.dims.momentum).toBe(85);
  });

  it('returns a score between 0 and 100 for a normal drive', () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({
      t: i * 1000, lat: 39.7 + i * 0.0001, lon: -104.9,
      speed: 10, h: 0.5, la: 0.1, ra: 0.05,
    }));
    const result = analyzeDrive(makeDrive(samples));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('detects full stops correctly', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => ({ t: i * 1000, speed: 10, lat: 39.7, lon: -104.9, la: 0, ra: 0, h: 0 })),
      ...Array.from({ length: 5 }, (_, i)  => ({ t: (10 + i) * 1000, speed: 0, lat: 39.7, lon: -104.9, la: 0, ra: 0, h: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ t: (15 + i) * 1000, speed: 10, lat: 39.7, lon: -104.9, la: 0, ra: 0, h: 0 })),
    ];
    const result = analyzeDrive(makeDrive(samples));
    expect(result.fullStops).toBeGreaterThanOrEqual(1);
  });
});

describe('getDriverPersona', () => {
  it('returns null for fewer than 2 drives', () => {
    expect(getDriverPersona([])).toBeNull();
    expect(getDriverPersona([{ score: 90, distanceMeters: 5000, durationMs: 600000, topSpeedMps: 20 }])).toBeNull();
  });

  it('returns an object with title and sub for 2+ drives', () => {
    const drives = Array.from({ length: 5 }, () => ({
      score: 88, distanceMeters: 10000, durationMs: 900000, topSpeedMps: 25,
    }));
    const persona = getDriverPersona(drives);
    expect(persona).not.toBeNull();
    expect(typeof persona.title).toBe('string');
    expect(typeof persona.sub).toBe('string');
  });
});
