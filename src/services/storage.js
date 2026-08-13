import {
  STORAGE_KEY,
  DEVICE_KEY,
  SYNCED_KEY,
  LIFETIME_SCORE_KEY,
  DRIVER_NAME_KEY,
  MAX_STORED_DRIVES,
  ACTIVE_DRIVE_KEY,
  OSM_SPEED_CACHE,
  OSM_CACHE_TTL,
  OSM_CACHE_MAX,
  SOCIAL_HANDLES_KEY,
  CORRIDORS_KEY,
} from '../constants.js';
import { slugifyCorridorId } from './corridors.js';

// ── Lifetime score ────────────────────────────────────────────────────────────
export function loadLifetimeScore(){
  try { const v = parseFloat(localStorage.getItem(LIFETIME_SCORE_KEY)); return isNaN(v) ? 100 : v; } catch { return 100; }
}
export function saveLifetimeScore(s){
  try { localStorage.setItem(LIFETIME_SCORE_KEY, String(Math.round(s))); } catch {}
}

// ── Driver name ───────────────────────────────────────────────────────────────
export function loadDriverName(){
  try { return localStorage.getItem(DRIVER_NAME_KEY) || ''; } catch { return ''; }
}
export function saveDriverName(n){
  try { localStorage.setItem(DRIVER_NAME_KEY, n.trim()); } catch {}
}

// ── Migration ─────────────────────────────────────────────────────────────────
// Run once if no lifetime score saved yet — derive it from stored drives.
// Most-recent drive carries the most weight (exponential decay factor 0.65).
export function migrateLifetimeScore(){
  const stored = localStorage.getItem(LIFETIME_SCORE_KEY);
  const drives = loadDrives().filter(d => d.score != null);
  if (!drives.length){ if (stored === null) saveLifetimeScore(100); return; }
  // Re-derive if never set, corrupted to 0, or implausibly low vs actual drives
  const storedVal = Number(stored);
  const recentAvg = drives.slice(0, 5).reduce((s, d) => s + d.score, 0) / Math.min(drives.length, 5);
  const implausible = stored === null || storedVal === 0 || storedVal < recentAvg - 30;
  if (!implausible) return;
  const recent = drives.slice(0, 10);
  saveLifetimeScore(Math.round(recent.reduce((s, d) => s + d.score, 0) / recent.length));
}

/**
 * Recompute the lifetime score from the 10 most recent drives — the same
 * rolling average finalizeAndReview uses. Called after a cloud restore, where
 * the newly merged history should be reflected immediately.
 */
export function recomputeLifetimeScore(){
  const drives = loadDrives().filter(d => d.score != null);
  if (!drives.length) return;
  const recent = drives.slice(0, 10);
  saveLifetimeScore(Math.round(recent.reduce((s, d) => s + d.score, 0) / recent.length));
}

// ── Drives ────────────────────────────────────────────────────────────────────
export function loadDrives(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
/**
 * Persist the drive list, trimmed to MAX_STORED_DRIVES.
 *
 * GPS samples dominate the payload (a long drive is ~380 KB on its own, and a
 * full history runs past the ~5 MB localStorage budget), so on a quota error we
 * shed `samples` from the oldest drives and retry rather than silently dropping
 * the whole write. A drive without samples still lists and scores fine — only
 * the review map needs them, and those can be re-fetched from the cloud.
 * Returns true if the list was persisted.
 */
export function saveDrives(all){
  const trimmed = all.slice(0, MAX_STORED_DRIVES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    return true;
  } catch {}

  // Over quota — drop samples oldest-first until it fits.
  const shed = trimmed.map(d => ({ ...d }));
  for (let i = shed.length - 1; i >= 0; i--){
    if (!shed[i].samples || !shed[i].samples.length) continue;
    shed[i] = { ...shed[i], samples: [], samplesDropped: true };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shed));
      return true;
    } catch {}
  }
  return false;
}
export function saveDrive(drive){
  const all = loadDrives();
  all.unshift(drive);
  saveDrives(all);
}

export function toggleFavoriteDrive(idx, callbacks = {}){
  const all = loadDrives();
  if (!all[idx]) return;
  all[idx].starred = !all[idx].starred;
  saveDrives(all);
  callbacks.onUpdate?.();
}

export function deleteDrive(idx, callbacks = {}){
  const all = loadDrives();
  all.splice(idx, 1);
  saveDrives(all);
  callbacks.onUpdate?.();
}

// ── Device / sync ─────────────────────────────────────────────────────────────
export function getDeviceId(){
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id){
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getSyncedIds(){
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY) || '[]')); }
  catch { return new Set(); }
}

export function markSynced(driveId){
  const ids = getSyncedIds();
  ids.add(driveId);
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids])); } catch {}
}

// ── Social handles ────────────────────────────────────────────────────────────
export function loadSocialHandles(){
  try { return JSON.parse(localStorage.getItem(SOCIAL_HANDLES_KEY) || '{}'); } catch { return {}; }
}
export function saveSocialHandles(handles){
  try { localStorage.setItem(SOCIAL_HANDLES_KEY, JSON.stringify(handles)); } catch {}
}

// ── OSM speed-limit cache ─────────────────────────────────────────────────────
function osmCacheKey(lat, lon){
  return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

function loadOsmCache(){
  try { return JSON.parse(localStorage.getItem(OSM_SPEED_CACHE) || '{}'); }
  catch { return {}; }
}

function saveOsmCache(cache){
  try { localStorage.setItem(OSM_SPEED_CACHE, JSON.stringify(cache)); } catch {}
}

export function getOsmLimit(lat, lon){
  const cache = loadOsmCache();
  const entry = cache[osmCacheKey(lat, lon)];
  if (!entry) return null;
  if (Date.now() - entry.ts > OSM_CACHE_TTL) return null;
  return entry.limitMps;
}

export function setOsmLimit(lat, lon, limitMps){
  const cache = loadOsmCache();
  const key   = osmCacheKey(lat, lon);
  cache[key]  = { limitMps, ts: Date.now() };
  // LRU eviction: drop oldest entries when over cap
  const keys  = Object.keys(cache);
  if (keys.length > OSM_CACHE_MAX){
    keys.sort((a, b) => cache[a].ts - cache[b].ts)
        .slice(0, keys.length - OSM_CACHE_MAX)
        .forEach(k => delete cache[k]);
  }
  saveOsmCache(cache);
}

// ── Corridors ─────────────────────────────────────────────────────────────────

/** Latest drivenAt timestamp within a corridor entry's drive list (guards missing/legacy fields). */
function lastDrivenAt(entry){
  const drives = entry?.drives || [];
  return drives.reduce((max, d) => Math.max(max, d?.drivenAt || 0), -Infinity);
}

/**
 * One-time, idempotent merge of corridor entries that were previously keyed by
 * name+city into the current name-only identity. Groups all stored corridors by
 * `slugifyCorridorId(name)`; when more than one legacy entry maps to the same
 * canonical id, they're combined into a single corridor — drive histories are
 * concatenated (so drive counts, score history and distance totals are all
 * preserved, keeping both the best and the most recent drives), and the
 * display fields (city, center, osmWayId) are taken from whichever legacy
 * entry has the most recent drive.
 *
 * Safe to call on every load: once every entry's corridorId already matches
 * its canonical name-only id (the common case after the first run), this is a
 * no-op and returns the input untouched.
 */
export function mergeDuplicateCorridors(corridors){
  if (!Array.isArray(corridors) || !corridors.length) return corridors;

  const groups = new Map(); // canonicalId -> legacy entries[]
  for (const entry of corridors){
    if (!entry || !entry.name) continue;
    const canonicalId = slugifyCorridorId(entry.name);
    if (!groups.has(canonicalId)) groups.set(canonicalId, []);
    groups.get(canonicalId).push(entry);
  }

  // No-op fast path: every entry is already its own group under the correct id.
  const alreadyMerged = groups.size === corridors.length
    && corridors.every(entry => entry?.corridorId === slugifyCorridorId(entry?.name || ''));
  if (alreadyMerged) return corridors;

  const merged = [];
  for (const [canonicalId, entries] of groups){
    if (entries.length === 1){
      const [only] = entries;
      merged.push(only.corridorId === canonicalId ? only : { ...only, corridorId: canonicalId });
      continue;
    }
    // Multiple legacy (name+city) entries for the same road — combine them.
    let mostRecent = entries[0], mostRecentTs = lastDrivenAt(entries[0]);
    for (let i = 1; i < entries.length; i++){
      const ts = lastDrivenAt(entries[i]);
      if (ts > mostRecentTs){ mostRecent = entries[i]; mostRecentTs = ts; }
    }
    const combinedDrives = entries
      .flatMap(e => e.drives || [])
      .sort((a, b) => (a?.drivenAt || 0) - (b?.drivenAt || 0));
    merged.push({
      corridorId: canonicalId,
      name:       mostRecent.name,
      city:       mostRecent.city,
      centerLat:  mostRecent.centerLat,
      centerLon:  mostRecent.centerLon,
      osmWayId:   mostRecent.osmWayId ?? null,
      drives:     combinedDrives,
    });
  }
  return merged;
}

export function loadCorridors(){
  let corridors;
  try { corridors = JSON.parse(localStorage.getItem(CORRIDORS_KEY) || '[]'); } catch { return []; }
  const merged = mergeDuplicateCorridors(corridors);
  if (merged !== corridors) saveCorridors(merged);
  return merged;
}
export function saveCorridors(corridors){
  try { localStorage.setItem(CORRIDORS_KEY, JSON.stringify(corridors)); } catch {}
}
export function upsertCorridorDrive({ name, city, centerLat, centerLon, osmWayId, score, distanceMeters, drivenAt }){
  const all = loadCorridors();
  const id  = slugifyCorridorId(name);
  const idx = all.findIndex(c => c.corridorId === id);
  const drive = { score, distanceMeters, drivenAt };
  if (idx === -1){
    all.push({ corridorId: id, name, city, centerLat, centerLon, osmWayId: osmWayId || null, drives: [drive] });
  } else {
    // Refresh display fields to the latest drive's city/road-name metadata,
    // and keep combining the drive history (count, scores, distance, timestamps).
    all[idx].city      = city;
    all[idx].centerLat  = centerLat;
    all[idx].centerLon  = centerLon;
    all[idx].osmWayId   = osmWayId || all[idx].osmWayId || null;
    all[idx].drives.push(drive);
  }
  saveCorridors(all);
}
