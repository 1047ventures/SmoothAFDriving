import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub localStorage before module import
const store = {};
vi.stubGlobal('localStorage', {
  getItem:    k => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { registerUser, syncUserProfile } = await import('../services/supabase.js');
const {
  ONBOARDED_KEY, PROFILE_SYNCED_KEY, USER_EMAIL_KEY, DRIVER_NAME_KEY, DEVICE_KEY,
} = await import('../constants.js');

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  mockFetch.mockReset();
});

describe('registerUser', () => {
  it('POSTs to /.netlify/functions/register-user', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/.netlify/functions/register-user',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sets PROFILE_SYNCED_KEY on HTTP 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(store[PROFILE_SYNCED_KEY]).toBe('1');
  });

  it('does NOT set PROFILE_SYNCED_KEY when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(store[PROFILE_SYNCED_KEY]).toBeUndefined();
  });

  it('does NOT set PROFILE_SYNCED_KEY on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    await registerUser({ name: 'Alex', email: 'alex@test.com', device_id: 'dev1' });
    expect(store[PROFILE_SYNCED_KEY]).toBeUndefined();
  });
});

describe('syncUserProfile', () => {
  it('does nothing when not onboarded', async () => {
    await syncUserProfile();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when already profile_synced', async () => {
    store[ONBOARDED_KEY]      = '1';
    store[PROFILE_SYNCED_KEY] = '1';
    await syncUserProfile();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls fetch when onboarded but not synced', async () => {
    store[ONBOARDED_KEY]   = '1';
    store[DRIVER_NAME_KEY] = 'Alex';
    store[USER_EMAIL_KEY]  = 'alex@test.com';
    store[DEVICE_KEY]      = 'dev-abc';
    mockFetch.mockResolvedValueOnce({ ok: true });
    await syncUserProfile();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('sets PROFILE_SYNCED_KEY after successful sync', async () => {
    store[ONBOARDED_KEY]   = '1';
    store[DRIVER_NAME_KEY] = 'Alex';
    store[USER_EMAIL_KEY]  = 'alex@test.com';
    store[DEVICE_KEY]      = 'dev-abc';
    mockFetch.mockResolvedValueOnce({ ok: true });
    await syncUserProfile();
    expect(store[PROFILE_SYNCED_KEY]).toBe('1');
  });

  it('does NOT set PROFILE_SYNCED_KEY when fetch fails', async () => {
    store[ONBOARDED_KEY]   = '1';
    store[DRIVER_NAME_KEY] = 'Alex';
    store[USER_EMAIL_KEY]  = 'alex@test.com';
    store[DEVICE_KEY]      = 'dev-abc';
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await syncUserProfile();
    expect(store[PROFILE_SYNCED_KEY]).toBeUndefined();
  });
});
