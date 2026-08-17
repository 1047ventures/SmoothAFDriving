import { describe, it, expect } from 'vitest';
import {
  torqueNm, horsepower, decodeGearA4, derive,
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

describe('derive', () => {
  it('produces power and torque when the torque PIDs are present', () => {
    const out = derive({ rpm: 4000, torquePct: 75, torqueRef: 400 });
    expect(out.torqueNm).toBe(300);
    expect(out.horsepower).toBeCloseTo(168.4, 0);
  });

  it('leaves power and torque null when the car does not report torque', () => {
    const out = derive({ rpm: 4000 });
    expect(out.torqueNm).toBe(null);
    expect(out.horsepower).toBe(null);
  });
});

describe('decodeGearA4', () => {
  // Response to 01A4 is `41 A4 A B C D`; extractBytes hands us [A, B, C, D].
  it('reads a supported gear and its ratio', () => {
    // A=0x03 (gear+ratio supported), B=0x04 (4th), C,D = 0x051E = 1310 → 1.310
    expect(decodeGearA4([0x03, 0x04, 0x05, 0x1e]))
      .toEqual({ supported: true, gear: 4, ratio: 1.31 });
  });

  it('treats a byte above 15 as nibble-packed and takes the high nibble', () => {
    // Some transmissions pack the gear in the high nibble: 0x40 → 4th.
    expect(decodeGearA4([0x01, 0x40, 0x00, 0x00]).gear).toBe(4);
  });

  it('reports neutral as gear 0', () => {
    expect(decodeGearA4([0x01, 0x00, 0x00, 0x00]).gear).toBe(0);
  });

  it('gives a ratio but no gear when only the ratio bit is set', () => {
    const out = decodeGearA4([0x02, 0x03, 0x03, 0xe8]); // ratio 1.000, gear unsupported
    expect(out.gear).toBe(null);
    expect(out.ratio).toBeCloseTo(1.0, 3);
  });

  it('is unsupported — no gear, no ratio — when the status byte is clear', () => {
    expect(decodeGearA4([0x00, 0x04, 0x05, 0x1e]))
      .toEqual({ supported: false, gear: null, ratio: null });
  });

  it('handles a null or short reply from a car that does not answer 0xA4', () => {
    expect(decodeGearA4(null)).toEqual({ supported: false, gear: null, ratio: null });
    expect(decodeGearA4([0x03, 0x04])).toEqual({ supported: false, gear: null, ratio: null });
  });
});
