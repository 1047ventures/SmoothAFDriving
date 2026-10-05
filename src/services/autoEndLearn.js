/**
 * Learning from the driver's answers to "end this drive?".
 *
 * The auto-end rules (services/autoEnd.js) are a guess about when a drive is over.
 * Rather than trust the guess, the app ASKS, and each answer is a label:
 *
 *   end     the driver confirmed — we were right
 *   keep    the driver said "keep recording" — we were wrong (asked too early)
 *   moved   the car drove off while the question was up — also wrong
 *   timeout nobody answered, so it ended — NOT a label (we don't know)
 *   auto    ended without asking because the signal had earned trust — NOT a label
 *
 * Only end/keep/moved teach anything. They do two things, per signal ('link-lost'
 * = the adapter lost power, 'engine-off' = RPM read 0):
 *   1. TUNE the wait: each recent wrong call lengthens that signal's parked wait
 *      (up to 3x); a clean run of confirmations shortens it (down to a floor).
 *   2. GRADUATE: after enough consecutive confirmations and no misses, stop asking
 *      and just end the drive. One wrong call sends it straight back to asking.
 */
import { AUTO_END } from './autoEnd.js';

export const LEARN = {
  KEY: 'smoothaf.autoend_log',
  MAX_LOG: 60,
  RECENT: 5,            // how many recent labelled answers shape the wait
  TRUST_AFTER: 8,       // consecutive confirmations before it stops asking
  SHORTEN_AFTER: 3,     // clean confirmations before the wait shrinks
  SHORTEN_FACTOR: 0.6,
  LENGTHEN_PER_MISS: 0.5,
  MAX_LENGTHEN: 3,      // never wait more than 3x the default
  FLOOR_MS: { 'link-lost': 15_000, 'engine-off': 60_000 },
};

const WRONG = new Set(['keep', 'moved']);
const LABELLED = new Set(['end', 'keep', 'moved']);

export function loadLog(storage = globalThis.localStorage){
  try {
    const v = JSON.parse(storage.getItem(LEARN.KEY));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Append one outcome and keep the log bounded. Returns the new log. */
export function recordOutcome(entry, storage = globalThis.localStorage){
  const log = loadLog(storage);
  log.push({ t: entry.t ?? Date.now(), reason: entry.reason, answer: entry.answer, parkedMs: entry.parkedMs ?? null });
  const trimmed = log.slice(-LEARN.MAX_LOG);
  try { storage.setItem(LEARN.KEY, JSON.stringify(trimmed)); } catch { /* storage full: learning is best-effort */ }
  return trimmed;
}

/** Labelled answers for one signal, newest first. */
export function labelled(log, reason){
  return (log || []).filter(e => e.reason === reason && LABELLED.has(e.answer)).reverse();
}

/** The parked wait for one signal after learning from the driver's answers. */
export function tunedWaitMs(log, reason, baseMs){
  const recent = labelled(log, reason).slice(0, LEARN.RECENT);
  const misses = recent.filter(e => WRONG.has(e.answer)).length;
  if (misses > 0){
    return Math.round(baseMs * Math.min(LEARN.MAX_LENGTHEN, 1 + LEARN.LENGTHEN_PER_MISS * misses));
  }
  if (recent.length >= LEARN.SHORTEN_AFTER && recent.every(e => e.answer === 'end')){
    return Math.max(LEARN.FLOOR_MS[reason] ?? 0, Math.round(baseMs * LEARN.SHORTEN_FACTOR));
  }
  return baseMs;
}

/** An AUTO_END config with both waits tuned to this driver's answers. */
export function tunedConfig(log, base = AUTO_END){
  return {
    ...base,
    LINK_LOST_PARKED_MS: tunedWaitMs(log, 'link-lost',  base.LINK_LOST_PARKED_MS),
    RPM_ZERO_PARKED_MS:  tunedWaitMs(log, 'engine-off', base.RPM_ZERO_PARKED_MS),
  };
}

/**
 * Has this signal earned the right to end a drive without asking? Only when the
 * driver's last TRUST_AFTER labelled answers for it were all confirmations.
 */
export function isTrusted(log, reason){
  const recent = labelled(log, reason).slice(0, LEARN.TRUST_AFTER);
  return recent.length >= LEARN.TRUST_AFTER && recent.every(e => e.answer === 'end');
}

/** Plain-language tally for a signal — handy for a settings screen or the operator. */
export function summarize(log, reason){
  const l = labelled(log, reason);
  const right = l.filter(e => e.answer === 'end').length;
  return { asked: l.length, right, wrong: l.length - right, trusted: isTrusted(log, reason) };
}
