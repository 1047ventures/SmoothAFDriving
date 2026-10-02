// Cloudflare Pages Function — /api/admin-stats
//
// The operator dashboard's data endpoint. POST a password, get the overview +
// per-user rows, one user's drives, or one drive's detail.
//
// Reuses the tested pure aggregators; password hashing uses Web Crypto
// (crypto.subtle) rather than node:crypto, since the Workers runtime provides
// that globally and not Node's crypto by default.
import { computeOverview, computeUserRows, summarizeFlags, downsamplePath } from '../../src/shared/adminStats.mjs';

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Thin an [[lat,lon],…] list to at most `max` points, keeping first and last.
function thinPairs(pts, max) {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

/**
 * Snap a raw GPS trace onto the road network via OSRM, so a sparse or jumpy
 * recording still draws a line that follows the roads instead of chording
 * straight across them. Routes through the trace's points as waypoints and
 * returns the road-following geometry as [[lat,lon],…], or null on any failure
 * (the caller then falls back to the raw trace — no worse than before).
 */
async function snapToRoads(path) {
  try {
    const pts = (path || []).filter((p) => Array.isArray(p) && p.length === 2);
    if (pts.length < 2) return null;
    // OSRM caps how many coordinates one request may carry; thin to a safe count.
    const wp = thinPairs(pts, 90);
    const coords = wp.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    const geo = data && data.routes && data.routes[0] && data.routes[0].geometry;
    const coordsOut = geo && geo.coordinates;
    if (!Array.isArray(coordsOut) || coordsOut.length < 2) return null;
    return coordsOut.map(([lon, lat]) => [lat, lon]);
  } catch {
    return null;
  }
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return new Uint8Array(buf);
}

// Constant-time compare over two equal-length SHA-256 digests.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function passwordOk(supplied, expected) {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(supplied || ''), sha256(expected)]);
  return timingSafeEqual(a, b);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const SB_URL = env.SUPABASE_URL;
  const SB_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD;

  let body;
  try { body = await request.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  if (!SB_URL || !SB_SERVICE_KEY || !ADMIN_PASSWORD) {
    console.error('admin-stats misconfigured: missing SUPABASE_URL / SUPABASE_SERVICE_KEY / ADMIN_PASSWORD');
    return json(500, { ok: false, error: 'misconfigured' });
  }

  if (!(await passwordOk(body.password, ADMIN_PASSWORD))) {
    await delay(500); // blunt brute-forcing
    return json(401, { ok: false, error: 'unauthorized' });
  }

  const sbGet = async (path) => {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
    });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    return res.json();
  };

  // Auth accounts (Apple / email sign-in) from GoTrue's admin API, keyed by
  // user_id. This is what de-anonymises a signed-in driver whose identity was
  // never copied into the `users` label table — their name/email live only here.
  // Best-effort: if the admin endpoint is unavailable the dashboard still renders
  // (those drivers just read anonymous, as before), so a failure never 500s.
  const fetchAuthUsers = async () => {
    const map = new Map();
    try {
      const res = await fetch(`${SB_URL}/auth/v1/admin/users?per_page=1000`, {
        headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
      });
      if (!res.ok) { console.error('admin-stats auth users:', res.status); return map; }
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
      for (const u of list) {
        if (!u || !u.id) continue;
        const md = u.user_metadata || {};
        const firstName = md.given_name || md.givenName || null;
        const lastName  = md.family_name || md.familyName || null;
        const name = md.name || md.full_name ||
          ([firstName, lastName].filter(Boolean).join(' ') || null);
        map.set(u.id, { email: u.email || null, name, firstName, lastName });
      }
    } catch (e) {
      console.error('admin-stats auth users error:', e.message);
    }
    return map;
  };

  // Purge junk drives: ~zero distance AND zero flags — empty rows left by crash
  // recovery or pre-gate saves (GPS jitter while parked logs a few meters, which
  // shows as "0.0 mi"). "Zero miles" means what the dashboard shows: under 80 m,
  // i.e. rounds to 0.0 mi. The live finalize gate is 0.3 mi (~483 m), so nothing
  // under 80 m is ever a real drive. Both conditions required so a short-but-
  // flagged or a longer clean drive is never touched. The nested and/or filter
  // is mandatory; a DELETE with no filter would wipe the table, so we never send
  // one. Returns how many rows were removed.
  const ZERO_MI_METERS = 80; // < 0.05 mi → renders as "0.0 mi"
  const purgeEmptyDrives = async () => {
    const filter =
      `and=(or(distance_meters.is.null,distance_meters.lt.${ZERO_MI_METERS}),or(event_count.is.null,event_count.eq.0))`;
    const res = await fetch(`${SB_URL}/rest/v1/drives?${filter}`, {
      method: 'DELETE',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        Prefer: 'return=representation',
      },
    });
    if (!res.ok) throw new Error(`supabase delete ${res.status}`);
    const gone = await res.json();
    return Array.isArray(gone) ? gone.length : 0;
  };

  try {
    const view = body.view || 'overview';

    if (view === 'user') {
      // Accept a whole identity's device-id list (merged person), or a single id.
      const ids = (Array.isArray(body.device_ids) && body.device_ids.length ? body.device_ids
                   : (body.device_id ? [body.device_id] : []))
                  .map(String).filter((id) => /^[\w-]+$/.test(id));
      if (!ids.length) return json(400, { ok: false, error: 'missing device_id(s)' });
      const inList = ids.join(',');
      const all = await sbGet(
        `drives?device_id=in.(${inList})&select=device_id,start_time,duration_ms,distance_meters,score,efficiency,effectiveness,dims,obd,event_count,dest_label,simulated&order=start_time.desc&limit=10000`
      );
      const drives = all.filter((d) => !d.simulated);
      return json(200, { ok: true, drives });
    }

    if (view === 'drive') {
      if (!body.device_id || body.start_time == null) {
        return json(400, { ok: false, error: 'missing device_id or start_time' });
      }
      const enc = encodeURIComponent(body.device_id);
      const st = encodeURIComponent(body.start_time);
      const rows = await sbGet(
        `drives?device_id=eq.${enc}&start_time=eq.${st}&select=start_time,score,efficiency,effectiveness,dims,obd,distance_meters,duration_ms,dest_label,events,samples&limit=1`
      );
      const d = rows[0];
      if (!d) return json(404, { ok: false, error: 'not found' });
      // Flags derived from the stored events, so this works on historical drives
      // that predate the detail columns. Events pass through for the list/map.
      // The GPS track becomes a route path for this one drive's map. A high cap
      // (vs the 48 the multi-drive overlay uses) keeps enough points to follow
      // the road's curves instead of chording across them — it's one drive on
      // demand, so the payload is still small.
      const { events, samples, ...meta } = d;
      // Diagnostics: `raw:true` returns the stored GPS samples untouched (time,
      // speed, accel, heading) so a bad score can be traced to the actual fixes
      // instead of guessed at. Password-gated like everything else here.
      if (body.raw) {
        return json(200, { ok: true, drive: { ...meta, events: events || [], samples: samples || [] } });
      }
      const raw = downsamplePath(samples, 2000);
      // Snap the trace onto real roads (handles sparse/jumpy recordings that
      // otherwise draw as straight chords). Falls back to the raw trace.
      const snapped = await snapToRoads(raw);
      const usedSnap = !!(snapped && snapped.length > 1);
      return json(200, {
        ok: true,
        drive: {
          ...meta,
          flags: summarizeFlags(events),
          events: events || [],
          path: usedSnap ? snapped : raw,
          snapped: usedSnap,
        },
      });
    }

    if (view === 'tracks') {
      // Every drive's path (downsampled), for overlaying a person's routes on one
      // map — the roads they drive often show up as the darkest overlapping lines.
      const ids = (Array.isArray(body.device_ids) && body.device_ids.length ? body.device_ids
                   : (body.device_id ? [body.device_id] : []))
                  .map(String).filter((id) => /^[\w-]+$/.test(id));
      if (!ids.length) return json(400, { ok: false, error: 'missing device_id(s)' });
      const inList = ids.join(',');
      const all = await sbGet(
        `drives?device_id=in.(${inList})&select=start_time,score,distance_meters,samples,simulated&order=start_time.desc&limit=300`
      );
      const tracks = all
        .filter((d) => !d.simulated)
        .map((d) => ({
          t: d.start_time,
          score: d.score,
          mi: d.distance_meters ? +(d.distance_meters / 1609.34).toFixed(1) : 0,
          // Enough points to trace the road's curves (so overlapping drives line
          // up on the same roads); the 48 default chorded across bends.
          path: downsamplePath(d.samples, 200),
        }))
        .filter((x) => x.path.length > 1);
      return json(200, { ok: true, tracks });
    }

    // Sweep out empty drives before reading, so the dashboard never counts them.
    const purgedEmpty = await purgeEmptyDrives();
    const [users, drives, authById] = await Promise.all([
      sbGet('users?select=device_id,name,email,updated_at&limit=10000'),
      sbGet('drives?select=device_id,user_id,start_time,duration_ms,distance_meters,score,event_count,simulated&limit=10000'),
      fetchAuthUsers(),
    ]);
    const nowMs = Date.now();
    return json(200, {
      ok: true,
      purgedEmpty,
      overview: computeOverview(users, drives, nowMs, authById),
      users: computeUserRows(users, drives, authById),
    });
  } catch (err) {
    console.error('admin-stats db error:', err.message);
    return json(500, { ok: false, error: 'db_error' });
  }
}

// A GET (or anything non-POST) gets a clear 405 rather than a confusing 404.
export function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('Method Not Allowed', { status: 405 });
}
