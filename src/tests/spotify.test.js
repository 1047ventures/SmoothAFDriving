import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as sp from '../services/spotify.js';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  vi.stubGlobal('localStorage', mem());
  sp.SPOTIFY.CLIENT_ID = 'cid';
  localStorage.setItem(sp.SPOTIFY.KEY_TOKENS, JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_at: Date.now() + 600000 }));
});

describe('spotify auth', () => {
  it('inert without a client id', () => { expect(sp.isConfigured('')).toBe(false); expect(sp.isConfigured('x')).toBe(true); });
  it('auth url carries PKCE challenge, scopes and the right redirect', async () => {
    const u = new URL(await sp.buildAuthUrl({ native: true }));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe('com.smoothafdriving.app://spotify');
    expect(u.searchParams.get('scope')).toContain('user-modify-playback-state');
    const web = new URL(await sp.buildAuthUrl({ origin: 'https://x.app' }));
    expect(web.searchParams.get('redirect_uri')).toBe('https://x.app/');
  });
  it('exchanges the code with the stored verifier', async () => {
    localStorage.removeItem(sp.SPOTIFY.KEY_TOKENS);
    await sp.buildAuthUrl({ native: true });
    const verifier = JSON.parse(localStorage.getItem(sp.SPOTIFY.KEY_VERIFIER)).v;
    const f = vi.fn().mockResolvedValue(res(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
    vi.stubGlobal('fetch', f);
    expect(await sp.handleRedirect('com.smoothafdriving.app://spotify?code=abc')).toBe(true);
    const body = f.mock.calls[0][1].body;
    expect(body.get('code_verifier')).toBe(verifier);
    expect(body.get('code')).toBe('abc');
    expect(sp.isConnected()).toBe(true);
  });
  it('ignores a redirect with no pending sign-in or no code', async () => {
    expect(await sp.handleRedirect('x://y?code=1')).toBe(false);
    await sp.buildAuthUrl({});
    expect(await sp.handleRedirect('https://x/?error=access_denied')).toBe(false);
  });
  it('refreshes an expired token and keeps the refresh token', async () => {
    localStorage.setItem(sp.SPOTIFY.KEY_TOKENS, JSON.stringify({ access_token: 'old', refresh_token: 'R', expires_at: 1 }));
    const f = vi.fn()
      .mockResolvedValueOnce(res(200, { access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(res(204));
    vi.stubGlobal('fetch', f);
    await sp.next();
    expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
    expect(JSON.parse(localStorage.getItem(sp.SPOTIFY.KEY_TOKENS)).refresh_token).toBe('R');
  });
  it('a revoked refresh token disconnects', async () => {
    localStorage.setItem(sp.SPOTIFY.KEY_TOKENS, JSON.stringify({ access_token: 'old', refresh_token: 'R', expires_at: 1 }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(400, {})));
    expect((await sp.getPlayback()).state).toBe('auth');
    expect(sp.isConnected()).toBe(false);
  });
});

describe('spotify playback', () => {
  const item = { id: 't1', uri: 'spotify:track:t1', type: 'track', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }],
    album: { images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }] } };
  it('shapes a playing track', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { item, is_playing: true, currently_playing_type: 'track' })));
    expect(await sp.getPlayback()).toMatchObject({ state: 'ok', title: 'Song', artist: 'A, B', art: 'small', playing: true, isTrack: true });
  });
  it('204 and no item mean idle; ads are flagged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(204)));
    expect((await sp.getPlayback()).state).toBe('idle');
    expect(sp.shapePlayback({ currently_playing_type: 'ad', is_playing: true })).toMatchObject({ ad: true });
  });
  it('maps control errors to plain codes', async () => {
    for (const [st, code] of [[204, 'ok'], [403, 'premium'], [404, 'nodevice'], [500, 'error']]){
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(st)));
      localStorage.setItem(sp.SPOTIFY.KEY_TOKENS, JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_at: Date.now() + 600000 }));
      expect(await sp.pause()).toBe(code);
    }
  });
  it('save uses /me/library and falls back to /me/tracks on 404', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(200));
    vi.stubGlobal('fetch', f);
    expect(await sp.setSaved('t1', true)).toBe('ok');
    expect(f.mock.calls[0][0]).toContain('/me/library?uris=spotify%3Atrack%3At1');
    expect(f.mock.calls[1][0]).toContain('/me/tracks?ids=t1');
    expect(f.mock.calls[1][1].method).toBe('PUT');
  });
  it('isSaved reads the boolean array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, [true])));
    expect(await sp.isSaved('t1')).toBe(true);
  });
  it('network failure never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await sp.next()).toBe('error');
  });
});
