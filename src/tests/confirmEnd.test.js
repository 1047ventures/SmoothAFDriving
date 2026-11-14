// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { confirmEndDrive, closeEndConfirm, endConfirmOpen } = await import('../ui/confirmEnd.js');
const { END_CONFIRM_MPS } = await import('../constants.js');

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => closeEndConfirm());

describe('End Drive guard', () => {
  it('ends immediately when parked — the normal way a drive ends stays one tap', () => {
    const onEnd = vi.fn();
    confirmEndDrive(0, onEnd);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ec-overlay')).toBeNull();
  });

  it('ends immediately at a crawl, so a parking-lot roll does not nag', () => {
    const onEnd = vi.fn();
    confirmEndDrive(END_CONFIRM_MPS - 0.1, onEnd);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('asks instead of ending when the car is moving', () => {
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);          // ~60 mph
    expect(onEnd).not.toHaveBeenCalled();
    expect(document.getElementById('ec-overlay')).not.toBeNull();
    expect(document.getElementById('ec-sub').textContent).toMatch(/60 mph/);
  });

  it('keeps driving when the driver backs out, and never ends', () => {
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    document.getElementById('ec-keep').click();
    expect(onEnd).not.toHaveBeenCalled();
    expect(document.getElementById('ec-overlay')).toBeNull();
  });

  it('ends only on the explicit confirm, once', () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    vi.advanceTimersByTime(500);          // past the anti-double-tap arm delay
    const go = document.getElementById('ec-end');
    go.click(); go.click();
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does nothing on its own — there is no timer racing the driver', () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    vi.advanceTimersByTime(120_000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(document.getElementById('ec-overlay')).not.toBeNull();
    vi.useRealTimers();
  });

  it('closes without answering when the drive ends another way', () => {
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    expect(endConfirmOpen()).toBe(true);
    closeEndConfirm();
    expect(onEnd).not.toHaveBeenCalled();
    expect(document.getElementById('ec-overlay')).toBeNull();
    expect(endConfirmOpen()).toBe(false);
  });

  it('only ever shows one card', () => {
    confirmEndDrive(27, vi.fn());
    confirmEndDrive(27, vi.fn());
    expect(document.querySelectorAll('#ec-overlay').length).toBe(1);
  });

  it('does not arm the destructive button immediately', () => {
    // It opens under the finger that just tapped End Drive, so for a moment
    // "End drive anyway" sits where that button was. A double-tap must not end
    // the drive and hide the warning in one go.
    vi.useFakeTimers();
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    const go = document.getElementById('ec-end');
    expect(go.disabled).toBe(true);
    go.click();
    expect(onEnd).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(go.disabled).toBe(false);
    go.click();
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('backs out on Escape — doing nothing keeps recording, so ambiguity is safe', () => {
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onEnd).not.toHaveBeenCalled();
    expect(document.getElementById('ec-overlay')).toBeNull();
  });

  it('backs out on a tap outside the card, not on a tap inside it', () => {
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    document.querySelector('#ec-overlay .pdcta-card').click();   // inside: no-op
    expect(document.getElementById('ec-overlay')).not.toBeNull();
    document.getElementById('ec-overlay').click();               // the scrim
    expect(onEnd).not.toHaveBeenCalled();
    expect(document.getElementById('ec-overlay')).toBeNull();
  });

  it('names the reason to a screen reader, not just the title', () => {
    confirmEndDrive(27, vi.fn());
    const ov = document.getElementById('ec-overlay');
    expect(ov.getAttribute('aria-describedby')).toBe('ec-sub');
    expect(ov.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById('ec-sub')).not.toBeNull();
  });

  it('stops listening for Escape once it is gone', () => {
    const onEnd = vi.fn();
    confirmEndDrive(27, onEnd);
    document.getElementById('ec-keep').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onEnd).not.toHaveBeenCalled();   // no stray handler left behind
  });
});
