// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { showAutoEndPrompt, closeAutoEndPrompt } = await import('../ui/autoEndPrompt.js');

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });
afterEach(() => { closeAutoEndPrompt(); vi.useRealTimers(); });

const handlers = () => ({ onEnd: vi.fn(), onKeep: vi.fn(), onTimeout: vi.fn() });
const num = () => document.getElementById('cd-num').textContent;

describe('ending-your-drive countdown', () => {
  it('counts 3, 2, 1 with Keep recording as the big button', () => {
    showAutoEndPrompt({ reason: 'ecu-silent', ...handlers() });
    expect(document.getElementById('cd-overlay')).not.toBeNull();
    expect(document.querySelector('.pdcta-h').textContent).toBe('Ending your drive');
    expect(document.getElementById('cd-stay').textContent).toBe('Keep recording');
    expect(document.getElementById('cd-go').textContent).toBe('End now');
    expect(num()).toBe('3');
    vi.advanceTimersByTime(1000); expect(num()).toBe('2');
    vi.advanceTimersByTime(1000); expect(num()).toBe('1');
  });

  it('explains the cause in plain words', () => {
    showAutoEndPrompt({ reason: 'link-lost', ...handlers() });
    expect(document.querySelector('.pdcta-sub').textContent).toMatch(/OBD adapter disconnected/);
    showAutoEndPrompt({ reason: 'ecu-silent', ...handlers() });
    expect(document.querySelector('.pdcta-sub').textContent).toBe('Engine off.');
  });

  it('with no answer, ends exactly once after 3 s', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'ecu-silent', ...h });
    vi.advanceTimersByTime(2900);
    expect(h.onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(h.onTimeout).toHaveBeenCalledTimes(1);
    expect(document.getElementById('cd-overlay')).toBeNull();
  });

  it('Keep recording declines and closes', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'ecu-silent', ...h });
    document.getElementById('cd-stay').click();
    expect(h.onKeep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(h.onTimeout).not.toHaveBeenCalled();
    expect(document.getElementById('cd-overlay')).toBeNull();
  });

  it('End now ends straight away', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'ecu-silent', ...h });
    document.getElementById('cd-go').click();
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.onKeep).not.toHaveBeenCalled();
  });

  it('closing from outside (car drove off) fires nothing and stops the timer', () => {
    const h = handlers(); const c = showAutoEndPrompt({ reason: 'link-lost', ...h });
    c.close();
    vi.advanceTimersByTime(20000);
    expect(h.onEnd).not.toHaveBeenCalled(); expect(h.onKeep).not.toHaveBeenCalled(); expect(h.onTimeout).not.toHaveBeenCalled();
    expect(document.getElementById('cd-overlay')).toBeNull();
  });

  it('closeAutoEndPrompt() also stops the countdown (no late end after a manual stop)', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'link-lost', ...h });
    closeAutoEndPrompt();
    vi.advanceTimersByTime(10000);
    expect(h.onTimeout).not.toHaveBeenCalled();
  });

  it('only one at a time', () => {
    showAutoEndPrompt({ reason: 'link-lost', ...handlers() });
    showAutoEndPrompt({ reason: 'engine-off', ...handlers() });
    expect(document.querySelectorAll('#cd-overlay')).toHaveLength(1);
  });
});
