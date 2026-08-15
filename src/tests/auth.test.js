import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getSession, saveSession, clearSession, currentUser, isSignedIn,
  trimSession, isValidEmail, sendEmailCode, verifyEmailCode,
  refreshIfNeeded, authHeaders, displayName, signInWithAppleToken,
} from '../services/auth.js';
import { AUTH_KEY, SB_ANON, DRIVER_NAME_KEY } from '../constants.js';

const NOW = () => Math.floor(Date.now() / 1000);

/** A GoTrue-shaped token response. */
function gotrueSession(over = {}){
  return {
    access_token:  'access-abc',
    refresh_token: 'refresh-xyz',
    expires_in:    3600,
    user: { id: 'user-1', email: 'skelly@example.com', user_metadata: { name: 'Skelly' } },
    ...over,
  };
}

function mockFetch(status, body){
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('session storage', () => {
  it('reads back nothing when signed out', () => {
    expect(getSession()).toBe(null);
    expect(currentUser()).toBe(null);
    expect(isSignedIn()).toBe(false);
  });

  it('round-trips a saved session', () => {
    saveSession(trimSession(gotrueSession()));
    expect(isSignedIn()).toBe(true);
    expect(currentUser().email).toBe('skelly@example.com');
  });

  it('treats a corrupt blob as signed out rather than throwing', () => {
    localStorage.setItem(AUTH_KEY, '{not json');
    expect(getSession()).toBe(null);
    expect(isSignedIn()).toBe(false);
  });

  it('rejects a session missing a token or user id', () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ user: { id: 'u' } }));
    expect(getSession()).toBe(null);
    localStorage.setItem(AUTH_KEY, JSON.stringify({ access_token: 'a' }));
    expect(getSession()).toBe(null);
  });

  it('clears', () => {
    saveSession(trimSession(gotrueSession()));
    clearSession();
    expect(isSignedIn()).toBe(false);
  });
});

describe('trimSession', () => {
  it('keeps only the fields the client needs', () => {
    const s = trimSession(gotrueSession());
    expect(Object.keys(s).sort()).toEqual(['access_token', 'expires_at', 'refresh_token', 'user']);
    expect(Object.keys(s.user).sort()).toEqual(['email', 'id', 'name']);
  });

  it('derives expires_at from expires_in when absent', () => {
    const s = trimSession(gotrueSession());
    expect(s.expires_at).toBeGreaterThan(NOW() + 3500);
    expect(s.expires_at).toBeLessThanOrEqual(NOW() + 3600);
  });

  it('prefers an explicit expires_at', () => {
    expect(trimSession(gotrueSession({ expires_at: 12345 })).expires_at).toBe(12345);
  });

  it('returns null for a response with no session in it', () => {
    expect(trimSession(null)).toBe(null);
    expect(trimSession({ error: 'nope' })).toBe(null);
  });
});

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('skelly@example.com')).toBe(true);
    expect(isValidEmail('a.b+tag@sub.domain.co')).toBe(true);
  });
  it('rejects malformed ones', () => {
    for (const bad of ['', 'skelly', 'skelly@', '@example.com', 'a b@example.com', 'a@b.c']){
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe('sendEmailCode', () => {
  it('rejects a bad address without hitting the network', async () => {
    const f = mockFetch(200, {});
    vi.stubGlobal('fetch', f);
    const res = await sendEmailCode('nope');
    expect(res.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('normalises the address before sending', async () => {
    const f = mockFetch(200, {});
    vi.stubGlobal('fetch', f);
    const res = await sendEmailCode('  Skelly@Example.COM ');
    expect(res.ok).toBe(true);
    expect(JSON.parse(f.mock.calls[0][1].body).email).toBe('skelly@example.com');
  });

  it('surfaces the server message on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(429, { msg: 'For security purposes, wait 60 seconds' }));
    const res = await sendEmailCode('skelly@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/60 seconds/);
  });

  it('reports a network failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = await sendEmailCode('skelly@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/connection/i);
  });
});

describe('verifyEmailCode', () => {
  it('stores the session on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, gotrueSession()));
    const res = await verifyEmailCode('skelly@example.com', '123456');
    expect(res.ok).toBe(true);
    expect(isSignedIn()).toBe(true);
    expect(currentUser().id).toBe('user-1');
  });

  it('rejects an empty code without hitting the network', async () => {
    const f = mockFetch(200, {});
    vi.stubGlobal('fetch', f);
    expect((await verifyEmailCode('skelly@example.com', '  ')).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('leaves the app signed out on a bad code', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { msg: 'Token has expired or is invalid' }));
    const res = await verifyEmailCode('skelly@example.com', '000000');
    expect(res.ok).toBe(false);
    expect(isSignedIn()).toBe(false);
  });
});

describe('signInWithAppleToken', () => {
  it('does not call out when the sheet was cancelled', async () => {
    const f = mockFetch(200, {});
    vi.stubGlobal('fetch', f);
    expect((await signInWithAppleToken(null)).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('stores the session on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, gotrueSession()));
    expect((await signInWithAppleToken('apple-id-token')).ok).toBe(true);
    expect(isSignedIn()).toBe(true);
  });
});

describe('refreshIfNeeded', () => {
  it('is a no-op when signed out', async () => {
    const f = mockFetch(200, {});
    vi.stubGlobal('fetch', f);
    expect(await refreshIfNeeded()).toBe(null);
    expect(f).not.toHaveBeenCalled();
  });

  it('leaves a still-valid token alone', async () => {
    const f = mockFetch(200, {});
    vi.stubGlobal('fetch', f);
    saveSession(trimSession(gotrueSession()));
    const s = await refreshIfNeeded();
    expect(s.access_token).toBe('access-abc');
    expect(f).not.toHaveBeenCalled();
  });

  it('refreshes a token that is about to expire', async () => {
    saveSession(trimSession(gotrueSession({ expires_at: NOW() + 30 })));
    vi.stubGlobal('fetch', mockFetch(200, gotrueSession({ access_token: 'access-new' })));
    const s = await refreshIfNeeded();
    expect(s.access_token).toBe('access-new');
    expect(getSession().access_token).toBe('access-new');
  });

  it('signs out when the refresh token is refused', async () => {
    saveSession(trimSession(gotrueSession({ expires_at: NOW() - 10 })));
    vi.stubGlobal('fetch', mockFetch(400, { msg: 'Invalid Refresh Token' }));
    expect(await refreshIfNeeded()).toBe(null);
    expect(isSignedIn()).toBe(false);
  });

  it('keeps the session through a network blip', async () => {
    saveSession(trimSession(gotrueSession({ expires_at: NOW() - 10 })));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const s = await refreshIfNeeded();
    expect(s?.access_token).toBe('access-abc');
    expect(isSignedIn()).toBe(true);
  });

  it('signs out an expired session that has no refresh token', async () => {
    saveSession({ ...trimSession(gotrueSession({ expires_at: NOW() - 10 })), refresh_token: null });
    expect(await refreshIfNeeded()).toBe(null);
    expect(isSignedIn()).toBe(false);
  });
});

describe('authHeaders', () => {
  it('falls back to the anon key when signed out', () => {
    expect(authHeaders().Authorization).toBe(`Bearer ${SB_ANON}`);
  });

  it('uses the user token when signed in', () => {
    saveSession(trimSession(gotrueSession()));
    const h = authHeaders();
    expect(h.Authorization).toBe('Bearer access-abc');
    expect(h.apikey).toBe(SB_ANON);
  });
});

describe('displayName', () => {
  it('is empty when there is neither a local name nor a session', () => {
    expect(displayName()).toBe('');
  });

  it('prefers the locally chosen driver name', () => {
    saveSession(trimSession(gotrueSession()));
    localStorage.setItem(DRIVER_NAME_KEY, 'Skelly the Wheelman');
    expect(displayName()).toBe('Skelly the Wheelman');
  });

  it('falls back to the account name', () => {
    saveSession(trimSession(gotrueSession()));
    expect(displayName()).toBe('Skelly');
  });

  it('falls back to the email local-part when the account has no name', () => {
    saveSession(trimSession(gotrueSession({
      user: { id: 'user-1', email: 'skelly@example.com', user_metadata: {} },
    })));
    expect(displayName()).toBe('skelly');
  });
});
