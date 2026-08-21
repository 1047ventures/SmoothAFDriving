import { describe, it, expect } from 'vitest';
import {
  cleanResponse, isErrorResponse, extractBytes, decodePid,
  decodeSupportedPids, kmhToMps, discoverPair, KNOWN_SERVICES,
  isLikelyObd, mergeScanResult,
} from '../services/obd.js';

// The transport needs a car. The decoding does not — and decoding is where a
// wrong answer is silent: a bad throttle number doesn't crash, it just scores
// the drive wrong.

describe('cleanResponse', () => {
  it('strips prompts, whitespace and line endings', () => {
    expect(cleanResponse('41 0C 1A F8\r\r>')).toBe('410C1AF8');
  });

  it('drops the SEARCHING... notice the adapter emits on first contact', () => {
    expect(cleanResponse('SEARCHING...\r410C1AF8\r>')).toBe('410C1AF8');
  });
});

describe('isErrorResponse', () => {
  it.each(['NO DATA', 'UNABLE TO CONNECT', 'STOPPED', '?'])('flags %s', (s) => {
    expect(isErrorResponse(s)).toBe(true);
  });

  it('does not flag a normal reply', () => {
    expect(isErrorResponse('410C1AF8')).toBe(false);
  });
});

describe('extractBytes', () => {
  it('finds the payload after the 41<pid> marker', () => {
    expect(extractBytes('410C1AF8', '0C')).toEqual([0x1A, 0xF8]);
  });

  it('tolerates header bytes before the marker', () => {
    // With ATH1, or a multi-frame reply, the marker is not at position 0.
    expect(extractBytes('7E8064103410C1AF8', '0C')).toEqual([0x1A, 0xF8]);
  });

  it('returns null for an error reply rather than garbage numbers', () => {
    expect(extractBytes('NO DATA', '0C')).toBe(null);
  });

  it('returns null when the requested pid is not in the reply', () => {
    expect(extractBytes('410D40', '0C')).toBe(null);
  });
});

describe('decodePid', () => {
  it('decodes RPM as ((A*256)+B)/4', () => {
    // 0x1AF8 = 6904 → 1726 rpm
    expect(decodePid('rpm', '410C1AF8')).toBe(1726);
  });

  it('decodes speed as a raw km/h byte', () => {
    expect(decodePid('speed', '410D40')).toBe(64);
  });

  it('decodes throttle as a percentage of 255', () => {
    expect(decodePid('throttle', '411180')).toBeCloseTo(50.2, 1);
  });

  it('reports 0% throttle rather than treating it as missing', () => {
    // A closed throttle is the most common reading in traffic. If 0 were
    // conflated with null the scoring engine would see gaps, not coasting.
    expect(decodePid('throttle', '411100')).toBe(0);
  });

  it('returns null when the car sends no data', () => {
    expect(decodePid('rpm', 'NO DATA')).toBe(null);
  });

  it('returns null for an unknown reading name', () => {
    expect(decodePid('boost', '410C1AF8')).toBe(null);
  });

  it('returns null when the payload is shorter than the pid needs', () => {
    // RPM needs two bytes; one is not "half an answer", it's no answer.
    expect(decodePid('rpm', '410C1A')).toBe(null);
  });
});

describe('decodeSupportedPids', () => {
  it('decodes the 0100 bitmask into pid numbers', () => {
    // 0x80000000 → only bit for PID 0x01 set.
    expect(decodeSupportedPids('410080000000')).toEqual([1]);
  });

  it('decodes a realistic mask containing throttle (0x11 = 17)', () => {
    const pids = decodeSupportedPids('4100BE1FA813');
    expect(pids).toContain(0x0C); // rpm
    expect(pids).toContain(0x0D); // speed
    expect(pids).toContain(0x11); // throttle
  });

  it('returns empty on a malformed reply instead of guessing', () => {
    expect(decodeSupportedPids('NO DATA')).toEqual([]);
    expect(decodeSupportedPids('4100BE')).toEqual([]);
  });
});

describe('kmhToMps', () => {
  it('converts the car’s km/h to the engine’s m/s', () => {
    expect(kmhToMps(100)).toBeCloseTo(27.78, 2);
    expect(kmhToMps(0)).toBe(0);
  });
});

describe('discoverPair', () => {
  const svc = (uuid, chars) => ({ uuid, characteristics: chars });
  const ch  = (uuid, properties) => ({ uuid, properties });

  it('prefers a known ELM327 service over an unknown one', async () => {
    const pair = await discoverPair([
      svc('0000180a-0000-1000-8000-00805f9b34fb', [
        ch('a', { write: true }), ch('b', { notify: true }),
      ]),
      svc(KNOWN_SERVICES[0], [
        ch('fff1', { notify: true }), ch('fff2', { write: true }),
      ]),
    ]);
    expect(pair.service).toBe(KNOWN_SERVICES[0]);
    expect(pair.write).toBe('fff2');
    expect(pair.notify).toBe('fff1');
  });

  it('falls back to any service exposing both write and notify', async () => {
    const pair = await discoverPair([
      svc('custom', [ch('x', { writeWithoutResponse: true }), ch('y', { indicate: true })]),
    ]);
    expect(pair).toEqual({ service: 'custom', write: 'x', notify: 'y' });
  });

  it('returns null when nothing can both write and notify', async () => {
    const pair = await discoverPair([svc('s', [ch('x', { read: true })])]);
    expect(pair).toBe(null);
  });

  it('survives empty or missing input', async () => {
    expect(await discoverPair([])).toBe(null);
    expect(await discoverPair(undefined)).toBe(null);
  });
});

describe('isLikelyObd', () => {
  it('matches common OBD adapter names', () => {
    for (const n of ['OBDII', 'Veepeak', 'VEEPEAK OBDCheck', 'vLink', 'OBDLink LX', 'Vgate iCar Pro', 'ELM327-BLE']) {
      expect(isLikelyObd(n, [])).toBe(true);
    }
  });

  it('matches on a known ELM327 service UUID even with no name', () => {
    expect(isLikelyObd('', [KNOWN_SERVICES[0].toUpperCase()])).toBe(true);
  });

  it('rejects unrelated named radios and nameless noise', () => {
    expect(isLikelyObd('AirPods Pro', [])).toBe(false);
    expect(isLikelyObd('Galaxy Buds', ['0000180f-0000-1000-8000-00805f9b34fb'])).toBe(false);
    expect(isLikelyObd('', [])).toBe(false);
  });
});

describe('mergeScanResult', () => {
  it('dedupes by deviceId, keeping the strongest signal', () => {
    const map = new Map();
    mergeScanResult(map, { deviceId: 'a', name: 'OBDII', rssi: -80, likely: true });
    const out = mergeScanResult(map, { deviceId: 'a', name: 'OBDII', rssi: -55, likely: true });
    expect(out).toHaveLength(1);
    expect(out[0].rssi).toBe(-55); // upgraded to the closer reading
  });

  it('orders likely-OBD first, then by signal strength', () => {
    const map = new Map();
    mergeScanResult(map, { deviceId: 'phone', name: 'Pixel', rssi: -40, likely: false });
    mergeScanResult(map, { deviceId: 'far',   name: 'OBDII', rssi: -90, likely: true });
    const out = mergeScanResult(map, { deviceId: 'near', name: 'Veepeak', rssi: -55, likely: true });
    expect(out.map(d => d.deviceId)).toEqual(['near', 'far', 'phone']);
  });
});
