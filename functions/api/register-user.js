// Cloudflare Pages Function — /api/register-user
//
// Captures a driver's name + email into the Supabase `users` table (and, when
// configured, a Resend audience) so the admin dashboard can show who signed up
// rather than a wall of anonymous device ids.
const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  const SB_URL = env.SUPABASE_URL;
  const SB_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = env.RESEND_API_KEY;
  const RESEND_AUD = env.RESEND_AUDIENCE_ID;

  let body;
  try { body = await request.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  if (!SB_URL || !SB_SERVICE_KEY) {
    console.error('register-user misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return json(500, { ok: false, error: 'misconfigured' });
  }

  const { name = '', device_id = '' } = body;
  const email = (body.email || '').trim().toLowerCase();
  // A name alone is enough now: the "what's your name, Driver?" prompt captures
  // a name from drivers who never did the full email sign-up, so the dashboard
  // shows a name instead of an anonymous device id. Only device_id is required,
  // plus at least one of name/email — an empty call is still rejected.
  if (!device_id || (!name.trim() && !email)) {
    return new Response('Missing required fields', { status: 400 });
  }

  // 1. Upsert to the Supabase users table (service role key bypasses RLS).
  // email is omitted when absent (name-only capture) rather than written blank,
  // so a later real sign-up can fill it without colliding with an empty string.
  try {
    const row = { device_id, name: name.trim(), updated_at: new Date().toISOString() };
    if (email) row.email = email;
    const sbRes = await fetch(`${SB_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
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

  // 2. Best-effort Resend contact (skipped when Resend isn't configured, or when
  // there's no email yet — a name-only capture has nothing to add to an audience).
  if (RESEND_KEY && RESEND_AUD && email) {
    try {
      const parts = name.trim().split(' ');
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
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('Method Not Allowed', { status: 405 });
}
