// Cloudflare Pages Function — /api/delete-account
//
// Permanently deletes the signed-in driver's account and everything held for it:
// drives, raw motion, the signup row, the mailing-list contact, and the login
// itself (which cascades to the profile). The session token is the only proof
// accepted, and it's checked with Supabase. The phone clears its own copy after.
import { corsHeaders, verifiedUser } from '../../src/shared/cors.mjs';

const RAW_BUCKET = 'raw-motion';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(request);
  const json = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  const SB_URL = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !KEY) return json(500, { ok: false, error: 'misconfigured' });

  const user = await verifiedUser(request, env);
  if (!user) return json(401, { ok: false, error: 'not_signed_in' });

  const body = await request.json().catch(() => ({}));
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const sb = (path, init = {}) => fetch(`${SB_URL}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const must = async (res, step) => { if (!res.ok) throw new Error(`${step}: ${res.status}`); return res; };
  const uid = encodeURIComponent(user.id);

  try {
    const device = /^[\w-]{8,64}$/.test(String(body.device_id || '')) ? String(body.device_id) : '';

    // Raw motion: <uid>/<drive start>/<chunk>.bin
    const list = async prefix => (await (await must(await sb(`/storage/v1/object/list/${RAW_BUCKET}`, {
      method: 'POST',
      body: JSON.stringify({ prefix, limit: 1000 }),
    }), 'list raw')).json()).map(i => `${prefix}/${i.name}`);
    for (const folder of await list(user.id)) {
      let chunks;
      while ((chunks = await list(folder)).length) {
        await must(await sb(`/storage/v1/object/${RAW_BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: chunks }) }), 'delete raw');
      }
    }

    // A device id isn't proof: anyone can name one. This phone's own rows go only when
    // it holds the secret its drives were stamped with. Check before deleting them.
    const secret = String(body.device_secret || '');
    let proven = null;
    if (device && secret.length >= 32) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
      proven = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      const match = `device_id=eq.${encodeURIComponent(device)}&device_secret_hash=eq.${proven}`;
      const held = await (await must(await sb(`/rest/v1/drives?${match}&select=start_time&limit=1`), 'check device')).json();
      if (!held.length) proven = null;
      else await must(await sb(`/rest/v1/drives?${match}&user_id=is.null`, { method: 'DELETE' }), 'delete device drives');
    }

    await must(await sb(`/rest/v1/drives?user_id=eq.${uid}`, { method: 'DELETE' }), 'delete drives');

    if (proven) {
      await must(await sb(`/rest/v1/users?device_id=eq.${encodeURIComponent(device)}`, { method: 'DELETE' }), 'delete signup');
    }
    if (user.email) {
      await must(await sb(`/rest/v1/users?email=eq.${encodeURIComponent(user.email.toLowerCase())}`, { method: 'DELETE' }), 'delete signup by email');
    }

    if (env.RESEND_API_KEY && env.RESEND_AUDIENCE_ID && user.email) {
      await fetch(`https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts/${encodeURIComponent(user.email)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      }).catch(() => {});
    }

    // Last, so a failure above can be retried while the session still works.
    await must(await sb(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' }), 'delete login');
  } catch (err) {
    console.error('delete-account failed:', err.message);
    return json(500, { ok: false, error: 'delete_failed' });
  }
  return json(200, { ok: true });
}

export function onRequest(context) {
  const { request } = context;
  if (request.method === 'POST') return onRequestPost(context);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  return new Response('Method Not Allowed', { status: 405 });
}
