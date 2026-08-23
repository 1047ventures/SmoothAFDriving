/**
 * First-run intro — a once-only, almost-wordless welcome shown before the very
 * first drive.
 *
 * Two deliberate product calls, both from the customer-journey review:
 *   1. Drive-first. It primes the OS permissions (motion + location) on the
 *      final tap — a real user gesture, which iOS requires for motion — so the
 *      first drive doesn't stall on a cold permission wall. It never asks anyone
 *      to sign up; that ask belongs at the end of the first drive.
 *   2. Visual, not verbal. Each beat is a picture and about three words.
 */

import { INTRO_SEEN_KEY } from '../constants.js';
import { requestMotionPermissionIfNeeded } from './record.js';

const SLIDES = [
  {
    art: `<div class="intro-glow"></div><div class="intro-score">94</div><div class="intro-cap">/100</div>`,
    h:   `Every drive, <span class="hot">scored</span>.`,
    sub: `How smooth were you? One number, 0&ndash;100.`,
  },
  {
    art: `<div class="intro-phone"><span class="glyph">S</span>
            <span class="edge top"></span><span class="edge bottom"></span>
            <span class="edge left"></span><span class="edge right"></span>
            <span class="intro-edge-labels"><span class="l-top">brake</span><span class="l-bottom">accel</span><span class="l-side">turns</span></span>
          </div>`,
    h:   `See every move.`,
    sub: `Edges glow <b>green</b> when you're smooth, <b>red</b> when you're not.`,
  },
  {
    art: `<div class="intro-mount"><span class="intro-mphone"></span><span class="intro-mbase"></span></div>`,
    h:   `Mount &amp; drive.`,
    sub: `That's the whole setup. We score the rest.`,
  },
  {
    art: `<div class="intro-badge">&check;</div>`,
    h:   `Ready when <span class="hot">you</span> are.`,
    sub: `We use location &amp; motion to score the drive. It stays on your phone unless you share it.`,
    cta: `Turn on &amp; drive`,
  },
];

const el = id => document.getElementById(id);

export function showIntroIfNeeded(){
  if (localStorage.getItem(INTRO_SEEN_KEY)) return;
  if (el('intro-overlay')) return;
  inject();
  wire();
}

function inject(){
  const slidesHtml = SLIDES.map((s, i) => `
    <section class="intro-slide${i === 0 ? ' active' : ''}" data-i="${i}" aria-hidden="${i === 0 ? 'false' : 'true'}">
      <div class="intro-art">${s.art}</div>
      <div class="intro-copy">
        <h2 class="intro-h">${s.h}</h2>
        <p class="intro-sub">${s.sub}</p>
      </div>
    </section>`).join('');

  const dots = SLIDES.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'intro-overlay';
  overlay.className = 'intro-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Welcome to Smooth AF Driving');
  overlay.innerHTML = `
    <button id="intro-skip" class="intro-skip" type="button">Skip</button>
    <div class="intro-stage">${slidesHtml}</div>
    <div class="intro-foot">
      <div id="intro-dots" class="intro-dots">${dots}</div>
      <button id="intro-next" class="intro-next" type="button">Next</button>
    </div>`;
  document.body.appendChild(overlay);
}

function wire(){
  let i = 0;
  const slides = [...document.querySelectorAll('.intro-slide')];
  const dots   = [...document.querySelectorAll('#intro-dots i')];
  const next   = el('intro-next');
  const last   = SLIDES.length - 1;

  const render = () => {
    slides.forEach((s, n) => {
      const on = n === i;
      s.classList.toggle('active', on);
      s.setAttribute('aria-hidden', String(!on));
    });
    dots.forEach((d, n) => d.classList.toggle('on', n === i));
    next.innerHTML = SLIDES[i].cta || 'Next';
    next.classList.toggle('cta', i === last);
  };

  const advance = () => {
    if (i < last){ i += 1; render(); }
    else finish();
  };

  next.addEventListener('click', advance);
  el('intro-skip').addEventListener('click', () => finish({ prime: false }));
  render();
}

/**
 * Close the intro. On the real finish (not a skip) prime both permissions on
 * this tap so the first drive starts clean: motion needs the gesture, and a
 * one-shot location read surfaces its prompt now instead of mid-drive.
 */
async function finish({ prime = true } = {}){
  localStorage.setItem(INTRO_SEEN_KEY, '1');

  if (prime){
    try { await requestMotionPermissionIfNeeded(); } catch { /* denial is fine */ }
    try {
      navigator.geolocation?.getCurrentPosition(() => {}, () => {}, { timeout: 8000, maximumAge: 60000 });
    } catch { /* no geolocation — the drive will report it */ }
  }

  const overlay = el('intro-overlay');
  if (!overlay) return;
  overlay.classList.add('closing');
  setTimeout(() => overlay.remove(), 340);
}
