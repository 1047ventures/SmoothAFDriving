/**
 * Account deletion (App Store guideline 5.1.1(v)): the server removes the account
 * and its cloud data, then this phone forgets everything it held.
 */
import { refreshIfNeeded } from './auth.js';
import { apiUrl } from './supabase.js';
import { getDeviceId, getDeviceSecret } from './storage.js';
import { clearRawCapture } from './sensors/rawCapture.js';
import { watchDongle } from './carWake.js';

export async function deleteAccount({ fetchImpl = fetch } = {}){
  const session = await refreshIfNeeded();
  if (!session?.access_token) return false;
  const res = await fetchImpl(apiUrl('/api/delete-account'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: getDeviceId(), device_secret: getDeviceSecret() }),
  });
  if (!res.ok) return false;
  await clearRawCapture();
  await watchDongle(null);   // native keeps the saved reader; wake notifications must stop too
  Object.keys(localStorage).filter(k => k.startsWith('smoothaf.')).forEach(k => localStorage.removeItem(k));
  return true;
}
