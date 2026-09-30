// Cloudflare Pages Function — /api/daily-digest
//
// Computes the end-of-day operator digest (all-time totals + today's deltas) and
// emails it via Resend. Aggregate only — counts and sums, never a user row — so
// nothing sensitive leaves. Triggered once a day by the daily-digest GitHub
// Action, which passes a shared secret; a bare request without it is refused so
// nobody can spam the mailer.
import { computeDailyDigest } from '../../src/shared/adminStats.mjs';

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const SB_URL = env.SUPABASE_URL;
  const SB_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = env.RESEND_API_KEY;
  const SECRET = env.DIGEST_SECRET;
  const TO = env.DIGEST_EMAIL || 'skellyslife@gmail.com';
  const FROM = env.DIGEST_FROM || 'Smooth AF <digest@smoothafdriving.com>';
  // Local-day offset in hours for bounding "today" (default US Mountain).
  const TZ_OFFSET = Number(env.DIGEST_TZ_OFFSET ?? -6);

  // Shared-secret gate: header or ?key=, constant nothing-clever compare.
  const supplied = request.headers.get('x-digest-key') || url.searchParams.get('key') || '';
  if (!SECRET || supplied !== SECRET) return json(401, { ok: false, error: 'unauthorized' });
  if (!SB_URL || !SB_SERVICE_KEY) return json(500, { ok: false, error: 'misconfigured' });

  const sbGet = async (path) => {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
    });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    return res.json();
  };

  let digest;
  try {
    const [users, drives] = await Promise.all([
      sbGet('users?select=device_id,name,email,updated_at&limit=10000'),
      sbGet('drives?select=device_id,user_id,start_time,distance_meters,score,event_count,simulated&limit=10000'),
    ]);
    digest = computeDailyDigest(users, drives, Date.now(), TZ_OFFSET);
  } catch (err) {
    console.error('daily-digest db error:', err.message);
    return json(500, { ok: false, error: 'db_error' });
  }

  const subject = `Smooth AF — ${digest.drivesToday} drive${digest.drivesToday === 1 ? '' : 's'} today, ${digest.milesToday} mi`;
  const text =
`Smooth AF — daily digest
${digest.date}

TODAY
• ${digest.newDriversToday} new driver${digest.newDriversToday === 1 ? '' : 's'}
• ${digest.activeToday} active driver${digest.activeToday === 1 ? '' : 's'}
• ${digest.drivesToday} drive${digest.drivesToday === 1 ? '' : 's'}, ${digest.milesToday} mi
• avg score today: ${digest.avgScoreToday ?? '—'}
• ${digest.flagsToday} harsh-event flag${digest.flagsToday === 1 ? '' : 's'}

ALL-TIME
• ${digest.totalUsers} known user${digest.totalUsers === 1 ? '' : 's'} across ${digest.totalDevices} device${digest.totalDevices === 1 ? '' : 's'}
• ${digest.totalDrives} drives, ${digest.totalMiles} mi
• avg score across all drives: ${digest.avgScore ?? '—'}
• active in last 7 days: ${digest.activeUsers7d}

— sent by the daily-digest job`;

  // ?dry=1 computes and returns without emailing — for a quick check.
  if (url.searchParams.get('dry') === '1') return json(200, { ok: true, sent: false, digest });

  if (!RESEND_KEY) return json(500, { ok: false, error: 'no_resend_key', digest });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [TO], subject, text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('resend send failed:', res.status, detail);
      return json(502, { ok: false, error: 'send_failed', digest });
    }
  } catch (err) {
    console.error('resend error:', err.message);
    return json(502, { ok: false, error: 'send_failed', digest });
  }

  return json(200, { ok: true, sent: true, to: TO, digest });
}

export const onRequestGet = handle;
export const onRequestPost = handle;
