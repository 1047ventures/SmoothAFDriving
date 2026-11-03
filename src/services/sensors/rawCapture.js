/**
 * Raw 60 Hz motion capture: the accelerometer + gyro stream the score's per-second
 * samples are boiled down from, saved so future scoring can be tuned and re-run
 * against real drives. Owner-only for now (RAW_CAPTURE_USER_IDS), and the bucket's
 * policy enforces the same account.
 *
 * Chunks of about a minute go to IndexedDB while driving, then upload after the
 * drive (or on the next launch, if it never got that far). A chunk leaves
 * IndexedDB only once the server has it. Everything fails soft: capture must
 * never get in the way of recording a drive.
 *
 * File format, little-endian. scripts/raw-decode.py reads it.
 *   Header (32 bytes): 'SAFR', u32 version, u32 rows, u32 chunk index,
 *                      f64 first-row epoch ms, f64 drive start epoch ms
 *   Rows (20 bytes):   u16 ms since previous row, then i16 ax ay az gx gy gz rα rβ rγ
 *                      a* gravity removed, g* gravity included (m/s² × RAW_ACCEL_SCALE)
 *                      r* rotation rate (deg/s × RAW_GYRO_SCALE)
 */
import { CLOUD_WRITES } from '../supabase.js';
import { authHeaders, currentUser, refreshIfNeeded } from '../auth.js';
import { SB_URL } from '../../constants.js';

export const RAW_CAPTURE_USER_IDS = ['6df5b1f1-a5c6-49fa-9b93-fc837c267af9'];
export const RAW_BUCKET = 'raw-motion';
export const RAW_ACCEL_SCALE = 500;    // ±65 m/s² at 0.002 resolution
export const RAW_GYRO_SCALE  = 10;     // ±3276 deg/s at 0.1 resolution
export const RAW_VERSION = 1;
export const RAW_HEADER_BYTES = 32;
export const RAW_ROW_VALUES = 10;
export const RAW_CHUNK_ROWS = 3600;    // a minute at 60 Hz

const MAX_DT_MS = 65535;
const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v || 0)));

/**
 * Pure chunk builder. push() one motion event; returns a finished chunk's
 * ArrayBuffer when it fills or when a gap too long for a u16 forces a new one.
 */
export function createChunkWriter(driveStart){
  let idx = 0, rows = 0, buf = null, words = null, last = 0, t0 = 0;

  const seal = () => {
    if (!rows) return null;
    const out = buf.slice(0, RAW_HEADER_BYTES + rows * RAW_ROW_VALUES * 2);
    const h = new DataView(out);
    [0x53, 0x41, 0x46, 0x52].forEach((c, i) => h.setUint8(i, c));
    h.setUint32(4, RAW_VERSION, true);
    h.setUint32(8, rows, true);
    h.setUint32(12, idx, true);
    h.setFloat64(16, t0, true);
    h.setFloat64(24, driveStart, true);
    const chunk = { idx, buffer: out };
    idx++; rows = 0;
    return chunk;
  };

  return {
    /** tMs: a steady clock in ms for row spacing; epochMs: wall clock for the header. */
    push(ev, tMs, epochMs){
      const a = ev.acceleration, g = ev.accelerationIncludingGravity, r = ev.rotationRate;
      let sealed = (rows && tMs - last > MAX_DT_MS) ? seal() : null;
      if (!rows){
        buf = new ArrayBuffer(RAW_HEADER_BYTES + RAW_CHUNK_ROWS * RAW_ROW_VALUES * 2);
        words = new DataView(buf);
        t0 = epochMs;
        last = tMs;
      }
      // Advance by the rounded step so rounding error can't accumulate over a chunk.
      const dt = Math.max(0, Math.round(tMs - last));
      last += dt;
      const at = RAW_HEADER_BYTES + rows * RAW_ROW_VALUES * 2;
      words.setUint16(at, dt, true);
      const vals = [
        a?.x * RAW_ACCEL_SCALE, a?.y * RAW_ACCEL_SCALE, a?.z * RAW_ACCEL_SCALE,
        g?.x * RAW_ACCEL_SCALE, g?.y * RAW_ACCEL_SCALE, g?.z * RAW_ACCEL_SCALE,
        r?.alpha * RAW_GYRO_SCALE, r?.beta * RAW_GYRO_SCALE, r?.gamma * RAW_GYRO_SCALE,
      ];
      vals.forEach((v, i) => words.setInt16(at + 2 + i * 2, i16(v), true));
      rows++;
      if (rows >= RAW_CHUNK_ROWS) sealed = seal();
      return sealed;
    },
    flush: seal,
  };
}

// ── IndexedDB ────────────────────────────────────────────────────────────────

const DB_NAME = 'smoothaf-raw', STORE = 'chunks';
let dbP = null;

function openDb(){
  dbP ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      req.result.onclose = () => { dbP = null; };   // iOS can close it while backgrounded
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  }).catch(err => { dbP = null; throw err; });
  return dbP;
}

async function tx(mode, run, retried = false){
  const db = await openDb();
  let t;
  try { t = db.transaction(STORE, mode); }
  catch (err){
    if (retried) throw err;
    dbP = null;   // a connection that closed without telling us
    return tx(mode, run, true);
  }
  return new Promise((resolve, reject) => {
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

const idbStore = {
  put: (key, buffer) => tx('readwrite', s => s.put(buffer, key)),
  get: key => tx('readonly', s => s.get(key)),
  del: key => tx('readwrite', s => s.delete(key)),
  keys: () => tx('readonly', s => s.getAllKeys()),
};

export const rawKey = (driveStart, idx) => `${driveStart}/${String(idx).padStart(5, '0')}`;

// ── Capture ──────────────────────────────────────────────────────────────────

let writer = null, activeStart = null, queued = 0, dropped = 0, pending = Promise.resolve();

const store = () => (typeof indexedDB === 'undefined' ? null : idbStore);

export function rawCaptureEnabled(){
  return CLOUD_WRITES && RAW_CAPTURE_USER_IDS.includes(currentUser()?.id) && !!store();
}

function save(chunk, s = store()){
  if (!chunk) return;
  const start = activeStart;
  queued++;
  pending = pending
    .then(() => s.put(rawKey(start, chunk.idx), chunk.buffer))
    .catch(() => { dropped++; });
}

export function beginRawCapture(driveStart){
  writer = null; activeStart = null; queued = 0; dropped = 0;
  if (!rawCaptureEnabled()) return false;
  writer = createChunkWriter(driveStart);
  activeStart = driveStart;
  return true;
}

export function captureRaw(ev){
  if (!writer) return;
  try {
    const now = Date.now();
    save(writer.push(ev, ev.sensorTs != null ? ev.sensorTs * 1000 : now, now));
  } catch { dropped++; }
}

/** Seal the last partial chunk. Resolves once everything captured is in IndexedDB. */
export function finishRawCapture(){
  if (!writer) return Promise.resolve();
  try { save(writer.flush()); } catch { dropped++; }
  writer = null;
  const start = activeStart;
  return pending.then(() => { if (activeStart === start) activeStart = null; });
}

export const rawCaptureStats = () => ({ chunks: queued, dropped });

/** Drop a drive's chunks: the drive was too short to keep. */
export async function discardRawCapture(driveStart, s = store()){
  if (!s) return;
  try {
    const keys = await s.keys();
    await Promise.all(keys.filter(k => String(k).startsWith(`${driveStart}/`)).map(k => s.del(k)));
  } catch { /* the next upload pass takes them instead */ }
}

// ── Upload ───────────────────────────────────────────────────────────────────

let uploading = false;

/** Upload whatever's waiting, oldest first; stops at the first failure and retries next time. */
export async function uploadPendingRaw({ s = store(), fetchImpl = fetch } = {}){
  if (uploading || !s || !CLOUD_WRITES) return;
  uploading = true;
  try {
    const keys = (await s.keys()).map(String).sort();
    if (!keys.length) return;
    const session = await refreshIfNeeded();
    const uid = session?.user?.id;
    if (!session?.access_token || !RAW_CAPTURE_USER_IDS.includes(uid)) return;
    for (const key of keys){
      if (activeStart != null && key.startsWith(`${activeStart}/`)) continue;   // still recording
      const body = await s.get(key);
      if (!body){ await s.del(key); continue; }
      const res = await fetchImpl(`${SB_URL}/storage/v1/object/${RAW_BUCKET}/${uid}/${key}.bin`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' },
        body,
      });
      // An earlier upload may have landed with its response lost: that's a success.
      const landed = res.ok || /duplicate|already exists/i.test(await res.text().catch(() => ''));
      if (!landed) return;
      await s.del(key);
    }
  } catch { /* offline: the chunks wait in IndexedDB */ }
  finally { uploading = false; }
}
