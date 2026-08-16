import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { pushDriveToSupabase, claimDeviceDrives, fetchDrivesForUser } from '../services/supabase.js';
import { saveSession, trimSession, clearSession } from '../services/auth.js';
import { getDeviceId } from '../services/storage.js';

const session = () => trimSession({
  access_token: 'access-abc', refresh_token: 'r', expires_in: 3600,
  user: { id: 'user-1', email: 'skelly@example.com', user_metadata: {} },
});

const drive = (t = 1000) => ({
  startTime: t, durationMs: 60000, distanceMeters: 900, topSpeedMps: 20,
  score: 91, eventCount: 1, samples: [], events: [],
});

function okFetch(body = []){
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

/** The parsed JSON body of the Nth fetch call. */
const bodyOf = (f, n = 0) => JSON.parse(f.mock.calls[n][1].body);
const urlOf  = (f, n = 0) => f.mock.calls[n][0];

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('drive upload — user stamping', () => {
  it('omits user_id entirely when signed out', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    await pushDriveToSupabase(drive());
    const body = bodyOf(f);
    // Not `user_id: null` — the key must be absent so the insert still works
    // against a database where the accounts migration hasn't run yet.
    expect('user_id' in body).toBe(false);
    expect(body.device_id).toBe(getDeviceId());
  });

  it('stamps the signed-in user id', async () => {
    saveSession(session());
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    await pushDriveToSupabase(drive());
    expect(bodyOf(f).user_id).toBe('user-1');
  });

  it('retries without user_id when the column does not exist yet', async () => {
    saveSession(session());
    const f = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 400,
        clone: () => ({ text: async () => JSON.stringify({ code: 'PGRST204', message: "Could not find the 'user_id' column of 'drives'" }) }),
      })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal('fetch', f);
    await pushDriveToSupabase(drive());
    expect(f).toHaveBeenCalledTimes(2);
    // The drive still lands, just as an anonymous row — a later sign-in claims it.
    const retry = bodyOf(f, 1);
    expect('user_id' in retry).toBe(false);
    expect(retry.start_time).toBe(1000);
  });

  it('does not retry when the failure is unrelated to user_id', async () => {
    saveSession(session());
    const f = vi.fn().mockResolvedValue({
      ok: false, status: 500,
      clone: () => ({ text: async () => 'internal server error' }),
    });
    vi.stubGlobal('fetch', f);
    await pushDriveToSupabase(drive());
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('sends the user token, not the anon key, when signed in', async () => {
    saveSession(session());
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    await pushDriveToSupabase(drive());
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer access-abc');
  });
});

describe('claimDeviceDrives', () => {
  it('does nothing when signed out', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    expect(await claimDeviceDrives()).toBe(null);
    expect(f).not.toHaveBeenCalled();
  });

  it('claims only this device’s unclaimed rows, through the RPC', async () => {
    saveSession(session());
    const f = okFetch(3);
    vi.stubGlobal('fetch', f);
    const n = await claimDeviceDrives();
    expect(n).toBe(3);

    // Claiming goes through claim_drives rather than a direct PATCH. The policy
    // that allowed the PATCH let any signed-in user adopt any unowned row —
    // free history once a score is worth something. The function scopes the
    // claim to rows already stamped with this device_id, server-side, where the
    // client can't widen it.
    expect(urlOf(f)).toContain('/rpc/claim_drives');
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect(bodyOf(f)).toEqual({ p_device_id: getDeviceId() });
  });

  it('reports zero when there is nothing left to claim', async () => {
    saveSession(session());
    vi.stubGlobal('fetch', okFetch(0));
    expect(await claimDeviceDrives()).toBe(0);
  });

  it('returns null rather than throwing when the call fails', async () => {
    saveSession(session());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await claimDeviceDrives()).toBe(null);
  });
});

describe('fetchDrivesForUser', () => {
  it('does nothing when signed out', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    expect(await fetchDrivesForUser()).toBe(null);
    expect(f).not.toHaveBeenCalled();
  });

  it('queries by user id and asks for no GPS samples', async () => {
    saveSession(session());
    const f = okFetch([{ start_time: 1 }]);
    vi.stubGlobal('fetch', f);
    const rows = await fetchDrivesForUser();
    expect(rows).toHaveLength(1);
    const url = urlOf(f);
    expect(url).toContain('user_id=eq.user-1');
    // Samples blow past the localStorage budget — metadata only, by design.
    expect(url).not.toContain('samples');
    expect(url).not.toContain('events');
  });

  it('returns null on a server error', async () => {
    saveSession(session());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    expect(await fetchDrivesForUser()).toBe(null);
  });

  it('stops querying once signed out again', async () => {
    saveSession(session());
    clearSession();
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    expect(await fetchDrivesForUser()).toBe(null);
    expect(f).not.toHaveBeenCalled();
  });
});
