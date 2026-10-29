import { loadSocialHandles, saveSocialHandles, loadDriverName } from '../services/storage.js';
import { metersToMiles, mpsToMph, fmtDuration } from '../utils/math.js';
import { drivingStyleVerdict } from '../services/scoring.js';
import { SHARE_PROMPTED_KEY, INSTALL_URL } from '../constants.js';

function getDisplayHandle(){
  const h = loadSocialHandles();
  if (h.instagram) return `@${h.instagram.replace(/^@/, '')}`;
  if (h.twitter)   return `@${h.twitter.replace(/^@/, '')}`;
  if (h.threads)   return `@${h.threads.replace(/^@/, '')}`;
  return null;
}

function openHandlesModal(){
  return new Promise(resolve => {
    const modal = document.getElementById('share-modal');
    if (!modal){ resolve(); return; }

    const existing = loadSocialHandles();
    const igEl = document.getElementById('share-instagram');
    const twEl = document.getElementById('share-twitter');
    const thEl = document.getElementById('share-threads');
    if (igEl && existing.instagram) igEl.value = existing.instagram;
    if (twEl && existing.twitter)   twEl.value = existing.twitter;
    if (thEl && existing.threads)   thEl.value = existing.threads;

    modal.classList.remove('hidden');

    function done(save){
      if (save && igEl && twEl && thEl){
        saveSocialHandles({
          instagram: igEl.value.trim().replace(/^@/, ''),
          twitter:   twEl.value.trim().replace(/^@/, ''),
          threads:   thEl.value.trim().replace(/^@/, ''),
        });
      }
      localStorage.setItem(SHARE_PROMPTED_KEY, '1');
      modal.classList.add('hidden');
      saveBtn?.removeEventListener('click', saveFn);
      skipBtn?.removeEventListener('click', skipFn);
      resolve();
    }

    const saveFn = () => done(true);
    const skipFn = () => done(false);
    const saveBtn = document.getElementById('share-save-btn');
    const skipBtn = document.getElementById('share-skip-btn');
    saveBtn?.addEventListener('click', saveFn);
    skipBtn?.addEventListener('click', skipFn);
  });
}

async function ensureFontLoaded(){
  try { await document.fonts.load('800 64px "Barlow Condensed"'); } catch {}
}

function drawBackground(ctx, SIZE, accentColor){
  ctx.fillStyle = '#0D0A09';
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.strokeStyle = 'rgba(242,241,238,0.022)';
  ctx.lineWidth = 0.5;
  for (let i = -SIZE; i < SIZE * 2; i += 22){
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + SIZE, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - SIZE, SIZE); ctx.stroke();
  }

  const band = ctx.createLinearGradient(0, 0, SIZE, 0);
  band.addColorStop(0, accentColor + '80');
  band.addColorStop(0.4, accentColor + '20');
  band.addColorStop(1, 'transparent');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, SIZE, 7);
}

export function buildShareCanvas(drive, analysis){
  const score = analysis.score || 0;
  const accentColor = score >= 90 ? '#3FC46A' : score >= 75 ? '#E8B83A' : '#E03B2F';
  const verdict = drivingStyleVerdict(analysis, drive);

  const SIZE = 1080;
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, SIZE, accentColor);

  // Brand
  ctx.font = '800 52px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillStyle = 'rgba(242,241,238,0.92)';
  ctx.textAlign = 'left';
  ctx.fillText('Smooth AF', 80, 110);

  // Drive date
  const when = new Date(drive.startTime);
  const dateStr = when.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }) +
    ' · ' + when.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  ctx.font = '400 26px -apple-system, Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(242,241,238,0.3)';
  ctx.textAlign = 'left';
  ctx.fillText(dateStr, 80, 156);

  // Score (gradient)
  const sg = ctx.createLinearGradient(SIZE/2 - 200, 180, SIZE/2 + 200, 520);
  sg.addColorStop(0, '#F4EBD9');
  sg.addColorStop(1, accentColor);
  ctx.font = '800 340px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillStyle = sg;
  ctx.textAlign = 'center';
  ctx.fillText(String(score), SIZE / 2, 490);

  // Letter grade
  const grade = analysis.letterGrade || '—';
  ctx.font = '800 80px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillStyle = accentColor;
  ctx.textAlign = 'center';
  ctx.fillText(grade, SIZE / 2, 588);

  // Verdict label
  if (verdict?.label){
    ctx.font = '400 32px -apple-system, Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(242,241,238,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(verdict.label, SIZE / 2, 650);
  }

  // Stats row
  const distMi = metersToMiles(drive.distanceMeters || 0).toFixed(1);
  const durStr  = fmtDuration(drive.durationMs || 0);
  const topMph  = Math.round(mpsToMph(drive.topSpeedMps || 0));
  const stats = [
    { val: distMi,       lbl: 'Miles'    },
    { val: durStr,       lbl: 'Duration' },
    { val: String(topMph), lbl: 'Top MPH' },
  ];
  const colW = 280;
  const x0   = (SIZE - colW * 3) / 2;
  const rowY = 758;

  stats.forEach((s, i) => {
    const cx = x0 + colW * i + colW / 2;
    ctx.font = '800 54px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillStyle = 'rgba(242,241,238,0.92)';
    ctx.textAlign = 'center';
    ctx.fillText(s.val, cx, rowY);
    ctx.font = '400 22px -apple-system, Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(242,241,238,0.35)';
    ctx.fillText(s.lbl.toUpperCase(), cx, rowY + 38);
  });

  ctx.strokeStyle = 'rgba(242,241,238,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++){
    const x = x0 + colW * i;
    ctx.beginPath(); ctx.moveTo(x, rowY - 52); ctx.lineTo(x, rowY + 46); ctx.stroke();
  }

  // Handle / name
  const displayHandle = getDisplayHandle() || loadDriverName();
  if (displayHandle){
    ctx.font = '400 28px -apple-system, Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(242,241,238,0.42)';
    ctx.textAlign = 'center';
    ctx.fillText(displayHandle, SIZE / 2, 888);
  }

  // Watermark
  ctx.font = '400 22px -apple-system, Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(242,241,238,0.18)';
  ctx.textAlign = 'center';
  ctx.fillText('smoothafdriving.com', SIZE / 2, 1034);

  return canvas;
}

async function doShare(canvas, title, text){
  try {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const file = new File([blob], 'smoothaf-score.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })){
      await navigator.share({ files: [file], title, text });
      return;
    }
  } catch {}
  try {
    if (navigator.share) await navigator.share({ title, text });
  } catch {}
}

export async function shareCurrentDrive(drive, analysis){
  if (!drive || !analysis) return;
  if (!localStorage.getItem(SHARE_PROMPTED_KEY)) await openHandlesModal();
  await ensureFontLoaded();
  const canvas = buildShareCanvas(drive, analysis);
  const mi = metersToMiles(drive.distanceMeters || 0).toFixed(1);
  const h = getDisplayHandle();
  const text = `Scored ${analysis.score}/100 on a ${mi} mi drive${h ? ' ' + h : ''} 🚗 ${INSTALL_URL} #SmoothAF`;
  await doShare(canvas, 'My Smooth AF Drive', text);
}
