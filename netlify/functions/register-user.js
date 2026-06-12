const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_AUD = process.env.RESEND_AUDIENCE_ID;

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const { name = '', device_id = '' } = body;
  const email = (body.email || '').trim().toLowerCase();

  if (!email || !device_id) {
    return new Response('Missing required fields', { status: 400 });
  }

  // 1. Upsert to Supabase users table (service role key bypasses RLS)
  try {
    await fetch(`${SB_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'apikey':        SB_SERVICE_KEY,
        'Authorization': `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        device_id,
        name:       name.trim(),
        email,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('Supabase upsert error:', err.message);
  }

  // 2. Add/update Resend contact (idempotent — Resend deduplicates by email)
  try {
    const parts = name.trim().split(' ');
    await fetch(`https://api.resend.com/audiences/${RESEND_AUD}/contacts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        email,
        first_name:   parts[0] || '',
        last_name:    parts.slice(1).join(' ') || '',
        unsubscribed: false,
      }),
    });
  } catch (err) {
    console.error('Resend contact error:', err.message);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
