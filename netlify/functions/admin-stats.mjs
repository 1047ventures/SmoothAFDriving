import { createHash, timingSafeEqual } from 'node:crypto';
import { computeOverview, computeUserRows, summarizeFlags } from './_lib/adminStats.mjs';

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const sha256 = (s) => createHash('sha256').update(String(s)).digest();

// Constant-time compare. Hashing first guarantees equal-length buffers.
function passwordOk(supplied) {
  if (!ADMIN_PASSWORD) return false;
  return timingSafeEqual(sha256(supplied || ''), sha256(ADMIN_PASSWORD));
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body;
  try { body = await req.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  if (!SB_URL || !SB_SERVICE_KEY || !ADMIN_PASSWORD) {
    console.error('admin-stats misconfigured: missing SUPABASE_URL / SUPABASE_SERVICE_KEY / ADMIN_PASSWORD');
    return json(500, { ok: false, error: 'misconfigured' });
  }

  if (!passwordOk(body.password)) {
    await delay(500); // blunt brute-forcing
    return json(401, { ok: false, error: 'unauthorized' });
  }

  try {
    const view = body.view || 'overview';

    if (view === 'user') {
      // Accept a whole identity's device-id list (merged person), or a single id.
      const ids = (Array.isArray(body.device_ids) && body.device_ids.length ? body.device_ids
                   : (body.device_id ? [body.device_id] : []))
                  .map(String).filter(id => /^[\w-]+$/.test(id));
      if (!ids.length) return json(400, { ok: false, error: 'missing device_id(s)' });
      const inList = ids.join(',');
      // NOTE: 10000-row cap is far above current volume; pagination is a future task.
      const all = await sbGet(
        `drives?device_id=in.(${inList})&select=device_id,start_time,duration_ms,distance_meters,score,efficiency,effectiveness,dims,obd,event_count,dest_label,simulated&order=start_time.desc&limit=10000`
      );
      const drives = all.filter(d => !d.simulated);
      return json(200, { ok: true, drives });
    }

    if (view === 'drive') {
      if (!body.device_id || body.start_time == null) {
        return json(400, { ok: false, error: 'missing device_id or start_time' });
      }
      const enc = encodeURIComponent(body.device_id);
      const st = encodeURIComponent(body.start_time);
      const rows = await sbGet(
        `drives?device_id=eq.${enc}&start_time=eq.${st}&select=start_time,score,efficiency,effectiveness,dims,obd,distance_meters,duration_ms,dest_label,events&limit=1`
      );
      const d = rows[0];
      if (!d) return json(404, { ok: false, error: 'not found' });
      // Flags derived from stored events, so historical drives work too.
      const { events, ...meta } = d;
      return json(200, { ok: true, drive: { ...meta, flags: summarizeFlags(events), events: events || [] } });
    }

    const [users, drives] = await Promise.all([
      sbGet('users?select=device_id,name,email,updated_at&limit=10000'),
      sbGet('drives?select=device_id,user_id,start_time,duration_ms,distance_meters,score,event_count,simulated&limit=10000'),
    ]);
    const nowMs = Date.now();
    return json(200, {
      ok: true,
      overview: computeOverview(users, drives, nowMs),
      users: computeUserRows(users, drives),
    });
  } catch (err) {
    console.error('admin-stats db error:', err.message);
    return json(500, { ok: false, error: 'db_error' });
  }
};
