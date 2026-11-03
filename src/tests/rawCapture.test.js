import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createChunkWriter, uploadPendingRaw, discardRawCapture, rawKey,
  RAW_CHUNK_ROWS, RAW_HEADER_BYTES, RAW_ACCEL_SCALE, RAW_GYRO_SCALE, RAW_BUCKET,
} from '../services/sensors/rawCapture.js';
import { state, resetState } from '../state.js';
import { createMotionHandler } from '../services/sensors/motion.js';

const OWNER = '6df5b1f1-a5c6-49fa-9b93-fc837c267af9';
let session = { access_token: 'tok', user: { id: OWNER } };
vi.mock('../services/auth.js', async (orig) => ({
  ...(await orig()),
  refreshIfNeeded: async () => session,
  currentUser: () => session?.user,
  authHeaders: () => ({ apikey: 'k', Authorization: 'Bearer tok' }),
}));

const ev = (v = 1) => ({
  acceleration: { x: v, y: -v, z: 0.5 },
  accelerationIncludingGravity: { x: v, y: -v, z: 9.81 },
  rotationRate: { alpha: 12.3, beta: -4.5, gamma: 0 },
});

function memStore(entries = {}){
  const m = new Map(Object.entries(entries));
  return { m, put: async (k, v) => m.set(k, v), get: async k => m.get(k), del: async k => m.delete(k), keys: async () => [...m.keys()] };
}

describe('raw chunk format', () => {
  it('writes a header and scaled rows that read back', () => {
    const w = createChunkWriter(5000);
    expect(w.push(ev(2), 100, 7000)).toBeNull();
    expect(w.push(ev(2), 116.7, 7017)).toBeNull();
    const { idx, buffer } = w.flush();
    const d = new DataView(buffer);
    expect(idx).toBe(0);
    expect(String.fromCharCode(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3))).toBe('SAFR');
    expect(d.getUint32(8, true)).toBe(2);
    expect(d.getFloat64(16, true)).toBe(7000);
    expect(d.getFloat64(24, true)).toBe(5000);
    expect(buffer.byteLength).toBe(RAW_HEADER_BYTES + 2 * 20);
    const row2 = RAW_HEADER_BYTES + 20;
    expect(d.getUint16(row2, true)).toBe(17);
    expect(d.getInt16(row2 + 2, true) / RAW_ACCEL_SCALE).toBe(2);
    expect(d.getInt16(row2 + 4, true) / RAW_ACCEL_SCALE).toBe(-2);
    expect(d.getInt16(row2 + 12, true) / RAW_ACCEL_SCALE).toBeCloseTo(9.81, 2);
    expect(d.getInt16(row2 + 14, true) / RAW_GYRO_SCALE).toBeCloseTo(12.3, 1);
  });

  it('seals a full chunk and starts the next index', () => {
    const w = createChunkWriter(0);
    let sealed = null;
    for (let i = 0; i < RAW_CHUNK_ROWS; i++) sealed = w.push(ev(), i * 16, 1000);
    expect(new DataView(sealed.buffer).getUint32(8, true)).toBe(RAW_CHUNK_ROWS);
    w.push(ev(), 99999, 2000);
    expect(w.flush().idx).toBe(1);
  });

  it('starts a new chunk across a gap too long to store', () => {
    const w = createChunkWriter(0);
    w.push(ev(), 0, 1000);
    const sealed = w.push(ev(), 70000, 71000);
    expect(sealed.idx).toBe(0);
    const next = w.flush();
    expect(new DataView(next.buffer).getFloat64(16, true)).toBe(71000);
  });

  it('clamps values past the range instead of wrapping', () => {
    const w = createChunkWriter(0);
    w.push(ev(500), 0, 0);
    expect(new DataView(w.flush().buffer).getInt16(RAW_HEADER_BYTES + 2, true)).toBe(32767);
  });

  it('does not let rounding drift accumulate', () => {
    const w = createChunkWriter(0);
    for (let i = 0; i < 1000; i++) w.push(ev(), i * 16.667, 0);
    const d = new DataView(w.flush().buffer);
    let t = 0;
    for (let i = 0; i < 1000; i++) t += d.getUint16(RAW_HEADER_BYTES + i * 20, true);
    expect(Math.abs(t - 999 * 16.667)).toBeLessThan(1);
  });
});

describe('raw upload', () => {
  beforeEach(() => { session = { access_token: 'tok', user: { id: OWNER } }; });

  it('uploads to the owner folder and clears what landed', async () => {
    const s = memStore({ [rawKey(5, 0)]: new ArrayBuffer(4), [rawKey(5, 1)]: new ArrayBuffer(4) });
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '' }));
    await uploadPendingRaw({ s, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain(`/storage/v1/object/${RAW_BUCKET}/${OWNER}/5/00000.bin`);
    expect(s.m.size).toBe(0);
  });

  it('keeps a chunk the server refused and stops there', async () => {
    const s = memStore({ [rawKey(5, 0)]: new ArrayBuffer(4), [rawKey(5, 1)]: new ArrayBuffer(4) });
    const fetchImpl = vi.fn(async () => ({ ok: false, text: async () => '{"error":"Unauthorized"}' }));
    await uploadPendingRaw({ s, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(s.m.size).toBe(2);
  });

  it('treats a duplicate as already uploaded', async () => {
    const s = memStore({ [rawKey(5, 0)]: new ArrayBuffer(4) });
    const fetchImpl = vi.fn(async () => ({ ok: false, text: async () => '{"statusCode":"409","error":"Duplicate"}' }));
    await uploadPendingRaw({ s, fetchImpl });
    expect(s.m.size).toBe(0);
  });

  it('keeps everything when offline', async () => {
    const s = memStore({ [rawKey(5, 0)]: new ArrayBuffer(4) });
    await uploadPendingRaw({ s, fetchImpl: async () => { throw new Error('offline'); } });
    expect(s.m.size).toBe(1);
  });

  it("uploads nothing for any other account", async () => {
    session = { access_token: 'tok', user: { id: 'someone-else' } };
    const s = memStore({ [rawKey(5, 0)]: new ArrayBuffer(4) });
    const fetchImpl = vi.fn();
    await uploadPendingRaw({ s, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('discards only the named drive', async () => {
    const s = memStore({ [rawKey(5, 0)]: new ArrayBuffer(4), [rawKey(55, 0)]: new ArrayBuffer(4) });
    await discardRawCapture(5, s);
    expect([...s.m.keys()]).toEqual([rawKey(55, 0)]);
  });
});

describe('road roughness window', () => {
  function drive(seconds, jolt){
    const h = createMotionHandler();
    for (let i = 0; i < seconds * 60; i++){
      const v = jolt && jolt(i / 60) ? 15 : 0.3;
      h({
        acceleration: { x: 0, y: 0, z: (i % 2 ? 1 : -1) * v },
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 + (i % 2 ? 1 : -1) * v },
        rotationRate: { alpha: 0.5, beta: 0.2, gamma: 0.1 },
      });
    }
  }

  beforeEach(() => {
    resetState();
    state.recording = true;
    state.lastGpsPos = { speed: 30, lat: 0, lon: 0 };
  });

  it('stays at 6 seconds on a phone with a gyro', () => {
    drive(60);
    expect(state.motionEvents).toBe(3600);
    expect(state.roughnessBuf.length).toBeLessThanOrEqual(720);
  });

  it('a jolt fades within seconds, not for the rest of the drive', () => {
    drive(60, t => t >= 20 && t < 22);
    expect(state.currentRoughness).toBeLessThan(0.5);
  });
});
