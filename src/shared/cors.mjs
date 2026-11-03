// CORS for the endpoints the iOS app calls. The app's WebView origin isn't this
// site's, so it needs an explicit allow; nothing else does.
const ALLOWED = new Set([
  'capacitor://localhost',
  'https://smoothafdriving.pages.dev',
  'https://smoothafdriving.com',
  'https://www.smoothafdriving.com',
]);

export function corsHeaders(request){
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** The signed-in user behind this request, or null. Asks Supabase; never trusts the token's own claims. */
export async function verifiedUser(request, env, fetchImpl = fetch){
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch { return null; }
}
