// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
vi.mock('../services/obd.js', async (orig) => ({ ...(await orig()), BleClient: {} }));
const { renderScanList } = await import('../ui/obd.js');

const dev = (id, name, rssi, likely) => ({ deviceId: id, name, rssi, likely });

beforeEach(() => { document.body.innerHTML = '<div id="obd-scan-list"></div>'; });

describe('scan list rendering (regression: list thrash ate taps)', () => {
  it('keeps the SAME button element across hundreds of updates', () => {
    renderScanList([dev('a', 'ANCEL BD310', -70, true)]);
    const first = document.querySelector('.obd-device');
    for (let i = 0; i < 300; i++) renderScanList([dev('a', 'ANCEL BD310', -40 - (i % 40), true)]);
    expect(document.querySelectorAll('.obd-device')).toHaveLength(1);
    expect(document.querySelector('.obd-device')).toBe(first);   // never rebuilt
  });

  it('a tap completes even while updates keep streaming in', () => {
    const onTap = vi.fn();
    document.getElementById('obd-scan-list').addEventListener('click', e => {
      const r = e.target.closest('.obd-device'); if (r) onTap(r.dataset.id);
    });
    renderScanList([dev('a', 'Veepeak', -60, true)]);
    const row = document.querySelector('.obd-device');
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    renderScanList([dev('a', 'Veepeak', -45, true)]);            // update lands mid-press
    renderScanList([dev('a', 'Veepeak', -52, true)]);
    row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    row.click();
    expect(document.body.contains(row)).toBe(true);              // the pressed node survived
    expect(onTap).toHaveBeenCalledWith('a');
  });

  it('hides non-OBD and unnamed devices, and says how many it hid', () => {
    renderScanList([dev('p', 'Pixel 8', -40, false), dev('t', '[TV] Samsung', -50, false), dev('u', null, -60, false)]);
    expect(document.querySelectorAll('.obd-device')).toHaveLength(0);
    expect(document.querySelector('.obd-scan-empty').textContent).toMatch(/3 other Bluetooth devices hidden/);
  });

  it('appends new adapters without moving or removing existing rows', () => {
    renderScanList([dev('a', 'OBDII', -80, true)]);
    renderScanList([dev('a', 'OBDII', -80, true), dev('b', 'Veepeak', -30, true)]);
    renderScanList([dev('a', 'OBDII', -20, true), dev('b', 'Veepeak', -90, true)]);
    expect([...document.querySelectorAll('.obd-device')].map(r => r.dataset.id)).toEqual(['a', 'b']);
  });
});
