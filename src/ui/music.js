/**
 * Music strip on the driving screen — what's playing, with ♥ / play-pause / next.
 *
 * Lives in the same line as the live insights: the track name is the resting state and an
 * insight ("Rolled it — no stop.") takes the text over for a few seconds, then hands it
 * back. The three buttons never move, so the strip costs no extra height and no extra
 * noise. Inert (hidden) until Spotify is configured AND connected.
 */
import * as sp from '../services/spotify.js';
import { Capacitor } from '@capacitor/core';
const $id = id => document.getElementById(id);

const POLL_MS = 5000;
let timer = null, cur = null, savedFor = null, saved = false, noteTimer = null, active = false;

const line = () => $id('rec-line');

function paint(){
  const ln = line(); if (!ln) return;
  const show = sp.isConfigured() && sp.isConnected() && active;
  ln.classList.toggle('has-music', show);
  if (!show) return;
  const idle = !cur || cur.state !== 'ok' || cur.ad;
  const title = $id('mu-title'), artist = $id('mu-artist'), art = $id('mu-art');
  if (!ln.dataset.note){
    title.textContent = cur?.ad ? 'Ad' : idle ? 'Spotify' : cur.title;
    artist.textContent = cur?.ad ? '' : idle ? (cur?.state === 'auth' ? 'Reconnect in Sensors' : 'Nothing playing') : cur.artist;
  }
  art.style.backgroundImage = !idle && cur.art ? `url("${cur.art}")` : '';
  $id('mu-pp').classList.toggle('is-playing', !idle && cur.playing);
  $id('mu-pp').setAttribute('aria-label', !idle && cur.playing ? 'Pause' : 'Play');
  const heart = $id('mu-heart');
  heart.classList.toggle('on', saved && !idle);
  heart.setAttribute('aria-pressed', String(saved && !idle));
  heart.disabled = idle || !cur.isTrack;
}

/** A short message in place of the track text (errors the driver needs to see). */
function note(msg){
  const ln = line(); if (!ln) return;
  ln.dataset.note = '1';
  $id('mu-title').textContent = msg; $id('mu-artist').textContent = '';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { delete ln.dataset.note; paint(); }, 3500);
}
const ERR = { premium: 'Needs Spotify Premium', nodevice: 'Open Spotify to play', auth: 'Reconnect Spotify in Sensors', error: 'Spotify didn’t respond' };

async function refresh(){
  if (!sp.isConnected()){ paint(); return; }
  cur = await sp.getPlayback();
  if (cur.state === 'auth') updateConnectRow();
  if (cur.state === 'ok' && cur.isTrack && cur.id !== savedFor){
    savedFor = cur.id; saved = false; paint();
    const id = cur.id, s = await sp.isSaved(id);
    if (cur?.id === id) saved = Boolean(s);
  }
  paint();
}

async function act(fn, optimistic){
  optimistic?.(); paint();
  const r = await fn();
  if (r !== 'ok') note(ERR[r] || ERR.error);
  setTimeout(refresh, 700);
}

export function musicStart(){
  active = true; paint();
  if (!sp.isConnected()) return;
  refresh(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
}
export function musicStop(){
  active = false; clearInterval(timer); timer = null; cur = null; savedFor = null; paint();
}

function updateConnectRow(){
  const btn = $id('sp-connect'), st = $id('sp-status'), row = $id('sp-row');
  if (!btn) return;
  const on = sp.isConfigured();
  row.classList.toggle('hidden', !on);
  const conn = sp.isConnected();
  btn.textContent = conn ? 'Disconnect' : 'Connect Spotify';
  st.textContent = conn ? 'Connected' : 'Not connected';
}

async function connect(){
  const native = Capacitor.isNativePlatform();
  const url = await sp.buildAuthUrl({ native });
  if (native){ const { Browser } = await import('@capacitor/browser'); await Browser.open({ url }); }
  else location.href = url;
}

async function onRedirect(url){
  if (!url) return;
  const ok = await sp.handleRedirect(url);
  if (Capacitor.isNativePlatform()){ try { (await import('@capacitor/browser')).Browser.close(); } catch {} }
  if (ok){ updateConnectRow(); if (active) musicStart(); }
}

export function wireMusic(){
  updateConnectRow();
  $id('sp-connect')?.addEventListener('click', () => {
    if (sp.isConnected()){ sp.disconnect(); musicStop(); updateConnectRow(); }
    else connect();
  });
  $id('mu-pp')?.addEventListener('click', () => {
    const wasPlaying = Boolean(cur?.playing);   // read BEFORE the optimistic flip
    act(() => (wasPlaying ? sp.pause() : sp.play()), () => { if (cur) cur.playing = !wasPlaying; });
  });
  $id('mu-next')?.addEventListener('click', () => act(() => sp.next()));
  $id('mu-heart')?.addEventListener('click', () => {
    if (!cur?.id) return;
    const want = !saved, id = cur.id;
    act(() => sp.setSaved(id, want), () => { saved = want; });
  });
  // Return trip: web comes back to "/?code=…"; native comes back as a custom-scheme deep link.
  const q = new URLSearchParams(location.search);
  if (q.get('code') && sp.isConfigured()){
    onRedirect(location.href).finally(() => history.replaceState({}, '', location.pathname));
  }
  if (Capacitor.isNativePlatform()){
    import('@capacitor/app').then(({ App }) => App.addListener('appUrlOpen', e => { if (e.url?.startsWith(sp.SPOTIFY.NATIVE_REDIRECT)) onRedirect(e.url); })).catch(() => {});
  }
}
