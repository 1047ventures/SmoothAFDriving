/**
 * "Ending your drive · 3, 2, 1"
 *
 * Shown when the engine-off monitor decides the drive is over. Doing nothing ends
 * it; "Keep recording" says we were wrong, and that answer tunes the wait (see
 * services/autoEndLearn.js).
 *
 * It resolves exactly once, through one of: onEnd (End now), onKeep (Keep
 * recording), onTimeout (the countdown ran out). Calling close() — because the car
 * drove off, or the driver ended the drive another way — tears it down without
 * firing any of them.
 */
import { showCountdown } from './countdown.js';

let mine = null;   // only ever close our own card, never someone else's countdown

const SUB = {
  'ecu-silent': 'Engine off.',
  'link-lost':  'Your OBD adapter disconnected, which usually means the car is off.',
  'engine-off': 'The engine seems to be off.',
};

export function showAutoEndPrompt({ reason, timeoutMs = 3_000, onEnd, onKeep, onTimeout }){
  mine?.close();
  mine = showCountdown({
    title: 'Ending your drive',
    sub: SUB[reason] || SUB['engine-off'],
    seconds: Math.max(1, Math.round(timeoutMs / 1000)),
    stayLabel: 'Keep recording',
    goLabel: 'End now',
    onDone: onTimeout,
    onStay: onKeep,
    onGo: onEnd,
  });
  return mine;
}

/** Remove any open prompt without answering it. */
export function closeAutoEndPrompt(){
  mine?.close();
  mine = null;
}
