// Cloudflare Pages Function — /api/register-user
//
// Captures a driver's name + email into the Supabase `users` table (and, when
// configured, a Resend audience) so the admin dashboard can show who signed up
// rather than a wall of anonymous device ids.
//
// A device id isn't proof of anything, so a request can only ever fill in a row:
// overwriting one takes a signed-in session whose email matches the row's.
import { corsHeaders, verifiedUser } from '../../src/shared/cors.mjs';

const DEVICE_RE = /^[\w-]{8,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 80, MAX_EMAIL = 254;

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(request);
  const json = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  const SB_URL = env.SUPABASE_URL;
  const SB_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = env.RESEND_API_KEY;
  const RESEND_AUD = env.RESEND_AUDIENCE_ID;

  let body;
  try { body = await request.json(); }
  catch { return new Response('Bad Request', { status: 400, headers: cors }); }

  if (!SB_URL || !SB_SERVICE_KEY) {
    console.error('register-user misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return json(500, { ok: false, error: 'misconfigured' });
  }

  const device_id = String(body.device_id || '');
  const name = String(body.name || '').trim().slice(0, MAX_NAME);
  const user = await verifiedUser(request, env);
  // A signed-in driver's email is the account's, whatever the request says.
  const email = String(user?.email || body.email || '').trim().toLowerCase();
  const emailOk = email.length <= MAX_EMAIL && EMAIL_RE.test(email);
  // A name alone is enough now: the "what's your name, Driver?" prompt captures
  // a name from drivers who never did the full email sign-up, so the dashboard
  // shows a name instead of an anonymous device id. Only device_id is required,
  // plus at least one of name/email — an empty call is still rejected.
  if (!DEVICE_RE.test(device_id) || (!name && !emailOk)) {
    return new Response('Missing required fields', { status: 400, headers: cors });
  }

  const sbHeaders = { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // 1. Upsert to the Supabase users table (service role key bypasses RLS).
  // email is omitted when absent (name-only capture) rather than written blank,
  // so a later real sign-up can fill it without colliding with an empty string.
  try {
    let canOverwrite = false;
    if (user) {
      const found = await fetch(`${SB_URL}/rest/v1/users?device_id=eq.${encodeURIComponent(device_id)}&select=email`, { headers: sbHeaders });
      const rows = found.ok ? await found.json() : null;
      const held = rows?.[0]?.email;
      canOverwrite = !!rows && (!held || held.toLowerCase() === email);
    }
    const row = { device_id, name, updated_at: new Date().toISOString() };
    if (emailOk) row.email = email;
    const sbRes = await fetch(`${SB_URL}/rest/v1/users`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: canOverwrite ? 'resolution=merge-duplicates' : 'resolution=ignore-duplicates' },
      body: JSON.stringify(row),
    });
    if (!sbRes.ok) {
      const detail = await sbRes.text().catch(() => '');
      console.error('Supabase upsert failed:', sbRes.status, detail);
      return json(500, { ok: false, error: 'db_error' });
    }
  } catch (err) {
    console.error('Supabase upsert error:', err.message);
    return json(500, { ok: false, error: 'db_error' });
  }

  // 2. Best-effort Resend contact, only for a verified account (an open endpoint
  // must not be able to fill the mailing list).
  if (RESEND_KEY && RESEND_AUD && user && emailOk) {
    try {
      const parts = name.split(' ');
      await fetch(`https://api.resend.com/audiences/${RESEND_AUD}/contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          first_name: parts[0] || '',
          last_name: parts.slice(1).join(' ') || '',
          unsubscribed: false,
        }),
      });
    } catch (err) {
      console.error('Resend contact error:', err.message);
    }
  }

  return json(200, { ok: true });
}

export function onRequest(context) {
  const { request } = context;
  if (request.method === 'POST') return onRequestPost(context);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  return new Response('Method Not Allowed', { status: 405 });
}
