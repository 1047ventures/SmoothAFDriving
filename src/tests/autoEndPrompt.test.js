// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { showAutoEndPrompt, closeAutoEndPrompt } = await import('../ui/autoEndPrompt.js');

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });
afterEach(() => { closeAutoEndPrompt(); vi.useRealTimers(); });

const handlers = () => ({ onEnd: vi.fn(), onKeep: vi.fn(), onTimeout: vi.fn() });

describe('end-this-drive prompt', () => {
  it('asks, with both choices and a countdown', () => {
    showAutoEndPrompt({ reason: 'link-lost', timeoutMs: 45000, ...handlers() });
    expect(document.getElementById('ae-overlay')).not.toBeNull();
    expect(document.getElementById('ae-end').textContent).toBe('End drive');
    expect(document.getElementById('ae-keep').textContent).toBe('Keep recording');
    expect(document.getElementById('ae-count').textContent).toBe('Ending automatically in 45s');
  });

  it('explains the cause in plain words', () => {
    showAutoEndPrompt({ reason: 'link-lost', ...handlers() });
    expect(document.querySelector('.pdcta-sub').textContent).toMatch(/OBD adapter disconnected/);
    showAutoEndPrompt({ reason: 'engine-off', ...handlers() });
    expect(document.querySelector('.pdcta-sub').textContent).toMatch(/engine seems to be off/);
  });

  it('End drive confirms, once, and closes', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'link-lost', ...h });
    document.getElementById('ae-end').click();
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.onKeep).not.toHaveBeenCalled();
    expect(document.getElementById('ae-overlay')).toBeNull();
  });

  it('Keep recording declines and closes', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'link-lost', ...h });
    document.getElementById('ae-keep').click();
    expect(h.onKeep).toHaveBeenCalledTimes(1);
    expect(h.onEnd).not.toHaveBeenCalled();
    expect(document.getElementById('ae-overlay')).toBeNull();
  });

  it('counts down and, with no answer, times out exactly once', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'link-lost', timeoutMs: 5000, ...h });
    vi.advanceTimersByTime(3000);
    expect(document.getElementById('ae-count').textContent).toBe('Ending automatically in 2s');
    vi.advanceTimersByTime(5000);
    expect(h.onTimeout).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ae-overlay')).toBeNull();
  });

  it('closing from outside (car drove off) fires nothing and stops the timer', () => {
    const h = handlers(); const c = showAutoEndPrompt({ reason: 'link-lost', timeoutMs: 5000, ...h });
    c.close();
    vi.advanceTimersByTime(20000);
    expect(h.onEnd).not.toHaveBeenCalled(); expect(h.onKeep).not.toHaveBeenCalled(); expect(h.onTimeout).not.toHaveBeenCalled();
    expect(document.getElementById('ae-overlay')).toBeNull();
  });

  it('closeAutoEndPrompt() also stops the countdown (no late timeout after a manual stop)', () => {
    const h = handlers(); showAutoEndPrompt({ reason: 'link-lost', timeoutMs: 3000, ...h });
    closeAutoEndPrompt();
    vi.advanceTimersByTime(10000);
    expect(h.onTimeout).not.toHaveBeenCalled();
  });

  it('only one prompt at a time', () => {
    showAutoEndPrompt({ reason: 'link-lost', ...handlers() });
    showAutoEndPrompt({ reason: 'engine-off', ...handlers() });
    expect(document.querySelectorAll('#ae-overlay')).toHaveLength(1);
  });
});
