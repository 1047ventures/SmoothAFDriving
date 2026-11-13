import { describe, it, expect, vi } from 'vitest';
import { onRequestGet } from '../../functions/c/[code].js';
import { countCardScans } from '../../functions/api/admin-stats.js';

const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'k' };
const ctx = (code, fetchImpl) => {
  global.fetch = fetchImpl;
  const waits = [];
  return { params: { code }, env, request: new Request(`https://smoothafdriving.pages.dev/c/${code}`), waitUntil: p => waits.push(p), waits };
};

describe('/c/<code> card links', () => {
  it('counts the scan and sends the person to the install page, tagged with the card', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const c = ctx('showme', fetchImpl);
    const r = await onRequestGet(c);
    await Promise.all(c.waits);
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('https://smoothafdriving.pages.dev/install?ref=card-showme');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ code: 'showme' });
  });

  it('still sends them on when the database is down', async () => {
    const c = ctx('outhere', vi.fn(async () => { throw new Error('down'); }));
    const r = await onRequestGet(c);
    await Promise.all(c.waits);
    expect(r.headers.get('Location')).toBe('https://smoothafdriving.pages.dev/install?ref=card-outhere');
  });

  it('a junk code goes to the install page and is not counted', async () => {
    const fetchImpl = vi.fn();
    const r = await onRequestGet(ctx("x');drop", fetchImpl));
    expect(r.headers.get('Location')).toBe('https://smoothafdriving.pages.dev/install');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('scan counts for /admin', () => {
  it('counts per card, most scanned first, with the latest scan', () => {
    expect(countCardScans([
      { code: 'showme', at: '2026-11-14T10:00:00Z' },
      { code: 'outhere', at: '2026-11-14T09:00:00Z' },
      { code: 'showme', at: '2026-11-15T10:00:00Z' },
    ])).toEqual([
      { code: 'showme', count: 2, last: '2026-11-15T10:00:00Z' },
      { code: 'outhere', count: 1, last: '2026-11-14T09:00:00Z' },
    ]);
    expect(countCardScans(null)).toEqual([]);
  });
});
