// Cloudflare Pages Function — /c/<code>
//
// The short link printed as a card's QR code. Counts the scan (which card, when,
// country) and sends the person straight on to the install page. The count is
// fire-and-forget: a database hiccup never stands between someone and the app.
// Counts show on /admin (admin-stats overview, cardScans).

export const CARD_CODE = /^[a-z0-9-]{1,32}$/;

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const code = String(params.code || '').toLowerCase();
  const to = new URL('/install', request.url);
  if (!CARD_CODE.test(code)) return Response.redirect(to.toString(), 302);
  to.searchParams.set('ref', `card-${code}`);

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    const save = fetch(`${env.SUPABASE_URL}/rest/v1/card_scans`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ code, country: request.cf?.country || null }),
    }).catch(() => {});
    if (context.waitUntil) context.waitUntil(save); else await save;
  }
  return Response.redirect(to.toString(), 302);
}
