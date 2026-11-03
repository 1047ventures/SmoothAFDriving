import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onRequest as deleteAccount } from '../../functions/api/delete-account.js';
import { onRequest as registerUser } from '../../functions/api/register-user.js';

const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'svc' };
const UID = '11111111-2222-3333-4444-555555555555';
const req = (url, body, headers = {}, method = 'POST') => new Request(`https://x.test${url}`, {
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined,
});
const ok = (data = []) => new Response(JSON.stringify(data), { status: 200 });

function mockSupabase({ user = { id: UID, email: 'Me@Example.com' }, usersRow = null, fail = null, noDeviceMatch = false } = {}){
  const calls = [];
  let rawLeft = true;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m, body: init.body, headers: init.headers });
    if (fail && u.includes(fail)) return new Response('no', { status: 500 });
    if (u.endsWith('/auth/v1/user')) {
      return init.headers.Authorization === 'Bearer good' ? ok(user) : new Response('{}', { status: 401 });
    }
    if (u.includes('/storage/v1/object/list/')) {
      const { prefix } = JSON.parse(init.body);
      if (prefix === UID) return ok([{ name: '1000' }]);
      return ok(rawLeft ? [{ name: '00000.bin' }, { name: '00001.bin' }] : []);
    }
    if (u.includes('/storage/v1/object/raw-motion') && m === 'DELETE') { rawLeft = false; return ok(); }
    if (u.includes('/rest/v1/drives') && m === 'GET') return ok(noDeviceMatch ? [] : [{ start_time: 1 }]);
    if (u.includes('/rest/v1/users') && m === 'GET') return ok(usersRow ? [usersRow] : []);
    return ok();
  });
  return calls;
}

let saved;
beforeEach(() => { saved = globalThis.fetch; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { globalThis.fetch = saved; vi.restoreAllMocks(); });

describe('delete-account', () => {
  it('refuses without a verified session and deletes nothing', async () => {
    const calls = mockSupabase();
    const a = await deleteAccount({ request: req('/api/delete-account', {}), env });
    const b = await deleteAccount({ request: req('/api/delete-account', {}, { Authorization: 'Bearer forged' }), env });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(calls.filter(c => c.m === 'DELETE')).toEqual([]);
  });

  it('removes raw motion, drives, signup rows, then the login last', async () => {
    const calls = mockSupabase();
    const secret = 's'.repeat(40);
    const res = await deleteAccount({ request: req('/api/delete-account', { device_id: 'device-cccc', device_secret: secret }, { Authorization: 'Bearer good' }), env });
    expect(res.status).toBe(200);
    const dels = calls.filter(c => c.m === 'DELETE').map(c => c.u.replace('https://sb.test', ''));
    expect(dels[0]).toBe('/storage/v1/object/raw-motion');
    expect(dels).toContain(`/rest/v1/drives?user_id=eq.${UID}`);
    expect(dels.some(d => /drives\?device_id=eq\.device-cccc&device_secret_hash=eq\.[0-9a-f]{64}&user_id=is\.null$/.test(d))).toBe(true);
    expect(dels).toContain('/rest/v1/users?device_id=eq.device-cccc');
    expect(dels).toContain('/rest/v1/users?email=eq.me%40example.com');
    expect(dels.at(-1)).toBe(`/auth/v1/admin/users/${UID}`);
    expect(calls.find(c => c.m === 'DELETE').body).toContain(`${UID}/1000/00000.bin`);
  });

  it("naming someone else's device deletes nothing of theirs", async () => {
    const calls = mockSupabase({ noDeviceMatch: true });
    const noSecret = await deleteAccount({ request: req('/api/delete-account', { device_id: 'victim-device' }, { Authorization: 'Bearer good' }), env });
    const badSecret = await deleteAccount({ request: req('/api/delete-account', { device_id: 'victim-device', device_secret: 'x'.repeat(40) }, { Authorization: 'Bearer good' }), env });
    expect([noSecret.status, badSecret.status]).toEqual([200, 200]);
    expect(calls.filter(c => c.m === 'DELETE' && c.u.includes('victim-device'))).toEqual([]);
  });

  it('keeps the login when a data step fails, so it can be retried', async () => {
    const calls = mockSupabase({ fail: `/rest/v1/drives?user_id=eq.${UID}` });
    const res = await deleteAccount({ request: req('/api/delete-account', {}, { Authorization: 'Bearer good' }), env });
    expect(res.status).toBe(500);
    expect(calls.some(c => c.u.includes('/auth/v1/admin/users/'))).toBe(false);
  });
});

describe('register-user', () => {
  const body = { device_id: 'device-aaaa', name: 'A Driver', email: 'a@b.co' };
  const write = calls => calls.find(c => c.u.endsWith('/rest/v1/users') && c.m === 'POST');

  it('without a session it can only fill an empty row', async () => {
    const calls = mockSupabase();
    const res = await registerUser({ request: req('/api/register-user', body), env });
    expect(res.status).toBe(200);
    expect(write(calls).headers.Prefer).toBe('resolution=ignore-duplicates');
  });

  it("can't take over a row holding someone else's email", async () => {
    const calls = mockSupabase({ usersRow: { email: 'other@x.co' } });
    await registerUser({ request: req('/api/register-user', body, { Authorization: 'Bearer good' }), env });
    expect(write(calls).headers.Prefer).toBe('resolution=ignore-duplicates');
  });

  it("a signed-in owner updates their own row, using the account's email", async () => {
    const calls = mockSupabase({ usersRow: { email: 'me@example.com' } });
    await registerUser({ request: req('/api/register-user', body, { Authorization: 'Bearer good' }), env });
    expect(write(calls).headers.Prefer).toBe('resolution=merge-duplicates');
    expect(JSON.parse(write(calls).body).email).toBe('me@example.com');
  });

  it('rejects junk, caps names', async () => {
    const calls = mockSupabase();
    const bad = await registerUser({ request: req('/api/register-user', { device_id: 'x', name: 'y' }), env });
    expect(bad.status).toBe(400);
    await registerUser({ request: req('/api/register-user', { device_id: 'device-aaaa', name: 'n'.repeat(500) }), env });
    expect(JSON.parse(write(calls).body).name.length).toBe(80);
  });

  it('answers the iOS app preflight and no one else', async () => {
    mockSupabase();
    const a = await registerUser({ request: req('/api/register-user', null, { Origin: 'capacitor://localhost' }, 'OPTIONS'), env });
    const b = await registerUser({ request: req('/api/register-user', null, { Origin: 'https://evil.test' }, 'OPTIONS'), env });
    expect(a.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
    expect(b.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
