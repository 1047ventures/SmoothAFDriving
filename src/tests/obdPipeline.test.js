import { describe, it, expect, beforeEach } from 'vitest';

// Stub localStorage before any imports (drive.js → storage.js touches it).
import { vi } from 'vitest';
vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
});

const { state, resetState } = await import('../state.js');
const { attachObd } = await import('../services/sensors/gps.js');
const { buildDriveFromState, summarizeObd } = await import('../services/drive.js');
const { buildExportData } = await import('../ui/review.js');

const OBD = {
  throttle: 34.2, rpm: 2100, load: 41, gear: 3, gearRatio: 1.52,
  horsepower: 88, torqueNm: 190, speedMps: 18.4, at: 1000,
};

describe('attachObd', () => {
  it('copies fresh channels onto the sample', () => {
    const s = attachObd({ t: 0 }, OBD, 1500); // 500ms old — fresh
    expect(s.throttle).toBe(34.2);
    expect(s.rpm).toBe(2100);
    expect(s.gear).toBe(3);
    expect(s.obdSpeed).toBe(18.4);
    expect(s.horsepower).toBe(88);
  });

  it('skips a stale reading rather than smearing it forward', () => {
    const s = attachObd({ t: 0 }, OBD, 5000); // 4s old — stale
    expect(s.throttle).toBeUndefined();
    expect(s.rpm).toBeUndefined();
  });

  it('is a no-op when no OBD is connected', () => {
    const s = attachObd({ t: 0 }, null, 1000);
    expect(Object.keys(s)).toEqual(['t']);
  });

  it('attaches only the channels the car actually answered', () => {
    const partial = { throttle: 20, rpm: null, at: 1000 };
    const s = attachObd({ t: 0 }, partial, 1200);
    expect(s.throttle).toBe(20);
    expect(s).not.toHaveProperty('rpm');
  });
});

describe('summarizeObd', () => {
  it('returns null for a GPS-only drive', () => {
    expect(summarizeObd([{ speed: 10 }, { speed: 12 }])).toBeNull();
  });

  it('averages over reporting samples and reports coverage', () => {
    const samples = [
      { throttle: 10, rpm: 1000, gear: 2 },
      { throttle: 30, rpm: 3000, gear: 3 },
      { speed: 5 }, // GPS-only point mid-drive
      { throttle: 50, rpm: 2000, gear: 3, horsepower: 120, torqueNm: 200 },
    ];
    const sum = summarizeObd(samples);
    expect(sum.coverage).toBeCloseTo(0.75, 2); // 3 of 4 samples carried OBD
    expect(sum.samples).toBe(3);
    expect(sum.avgThrottle).toBeCloseTo(30, 1);
    expect(sum.maxThrottle).toBe(50);
    expect(sum.peakRpm).toBe(3000);
    expect(sum.gears).toEqual([2, 3]);
    expect(sum.peakHp).toBe(120);
  });
});

describe('buildDriveFromState carries OBD', () => {
  beforeEach(() => {
    resetState();
    state.startTime = 1_000_000;
    state.samples = [
      { t: 1_000_000, lat: 39.7, lon: -104.9, speed: 8, heading: 90,
        harshness: 0.2, longAccel: 0.1, latAccel: 0.05,
        throttle: 22.5, rpm: 1800, load: 35, gear: 2, obdSpeed: 8.1,
        horsepower: 60, torqueNm: 150 },
      { t: 1_001_000, lat: 39.7, lon: -104.9, speed: 9, heading: 90,
        harshness: 0.2, longAccel: 0.1, latAccel: 0.05 }, // GPS-only
    ];
    state.events = [];
  });

  it('writes abbreviated OBD keys only on samples that had them', () => {
    const d = buildDriveFromState();
    expect(d.samples[0].thr).toBe(22.5);
    expect(d.samples[0].rpm).toBe(1800);
    expect(d.samples[0].g).toBe(2);
    expect(d.samples[0].os).toBeCloseTo(8.1, 2);
    expect(d.samples[1]).not.toHaveProperty('thr'); // GPS-only sample stays lean
  });

  it('attaches a drive-level obd summary', () => {
    const d = buildDriveFromState();
    expect(d.obd).not.toBeNull();
    expect(d.obd.coverage).toBeCloseTo(0.5, 2);
    expect(d.obd.peakRpm).toBe(1800);
    expect(d.obd.gears).toEqual([2]);
  });
});

describe('buildExportData surfaces OBD self-describingly', () => {
  it('expands abbreviated stored keys to full names, drops absent ones', () => {
    const drive = {
      startTime: 1_000_000, score: 80, distanceMeters: 1000, durationMs: 60000,
      obd: { coverage: 0.5, peakRpm: 1800 },
      events: [],
      samples: [
        { t: 0, lat: 39.7, lon: -104.9, speed: 8, heading: 90,
          h: 0.2, la: 0.1, ra: 0.05, thr: 22.5, rpm: 1800, g: 2, os: 8.1 },
        { t: 1000, lat: 39.7, lon: -104.9, speed: 9, heading: 90, h: 0.2, la: 0.1, ra: 0.05 },
      ],
    };
    const data = buildExportData(drive, null);
    expect(data.obd).toEqual({ coverage: 0.5, peakRpm: 1800 });
    expect(data.samples[0].throttle).toBe(22.5);
    expect(data.samples[0].rpm).toBe(1800);
    expect(data.samples[0].gear).toBe(2);
    expect(data.samples[0].obdSpeedMps).toBeCloseTo(8.1, 2);
    expect(data.samples[1]).not.toHaveProperty('throttle'); // absent, not undefined
  });
});
