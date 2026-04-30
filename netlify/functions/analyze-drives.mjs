/**
 * Smooth AF — Nightly Drive Analysis
 * Netlify Scheduled Function — runs every day at 8am
 *
 * Pulls last 48h of real drives from Supabase, does rule-based analysis,
 * writes a plain-English insight summary back to drive_insights table.
 * Visible in the dashboard AI Insights box.
 */

export const config = { schedule: "0 8 * * *" };

const SB_URL  = 'https://dbreetxubxdxogmektxc.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRicmVldHh1YnhkeG9nbWVrdHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjY5ODgsImV4cCI6MjA5MjkwMjk4OH0.hMeEhYpNNgZ67Nh9GnjwJvtSBbdQVhbdjiBBNNG5qe4';
const HEADERS = { 'apikey': SB_ANON, 'Authorization': `Bearer ${SB_ANON}` };

export default async function handler() {
  try {
    // ── 1. Fetch last 48h of real drives ──────────────────────────────────────
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const res = await fetch(
      `${SB_URL}/rest/v1/drives?select=id,created_at,duration_ms,distance_meters,top_speed_mps,score,event_count,simulated,events,samples,settings&simulated=eq.false&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=100`,
      { headers: HEADERS }
    );
    const drives = await res.json();

    // Also grab last 10 drives (older) for trend comparison
    const histRes = await fetch(
      `${SB_URL}/rest/v1/drives?select=score,created_at&simulated=eq.false&order=created_at.desc&limit=10`,
      { headers: HEADERS }
    );
    const history = await histRes.json();

    // ── 2. Compute analytics ──────────────────────────────────────────────────
    const summary = buildSummary(drives, history);
    const analytics = buildAnalytics(drives, history);

    // ── 3. Write insight to Supabase ──────────────────────────────────────────
    await fetch(`${SB_URL}/rest/v1/drive_insights`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        period_start: since,
        period_end:   new Date().toISOString(),
        drive_count:  drives.length,
        summary,
        data: analytics,
      }),
    });

    console.log('✅ Insight written:', summary);
    return new Response(JSON.stringify({ ok: true, summary }), { status: 200 });

  } catch (err) {
    console.error('analyze-drives error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function buildSummary(drives, history) {
  if (!drives.length) return 'No new drives in the last 48 hours.';

  const n = drives.length;
  const scores = drives.map(d => d.score).filter(s => s != null);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  // Trend: compare avg of these drives vs avg of older drives not in this window
  const olderScores = history
    .filter(h => !drives.find(d => d.id === h.id))
    .map(h => h.score).filter(s => s != null);
  let trendStr = '';
  if (olderScores.length >= 2 && avgScore != null) {
    const oldAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
    const delta = avgScore - oldAvg;
    trendStr = delta >= 3 ? ' (trending ↑ up)' : delta <= -3 ? ' (trending ↓ down)' : ' (steady)';
  }

  // Event breakdown
  const allEvents = drives.flatMap(d => d.events || []);
  const evCounts = { brake: 0, accel: 0, turn: 0 };
  allEvents.forEach(e => { if (evCounts[e.type] !== undefined) evCounts[e.type]++; });
  const totalEvents = allEvents.length;

  // Dominant event type
  let evNote = '';
  if (totalEvents === 0) {
    evNote = 'Zero events fired — either very smooth driving or thresholds may need tightening.';
  } else {
    const dominant = Object.entries(evCounts).sort((a, b) => b[1] - a[1])[0];
    const pct = Math.round((dominant[1] / totalEvents) * 100);
    const label = dominant[0] === 'brake' ? 'hard brakes' : dominant[0] === 'accel' ? 'hard accelerations' : 'sharp turns';

    // Speed analysis for dominant events
    const domEvents = allEvents.filter(e => e.type === dominant[0]);
    const speedsMph = domEvents.map(e => e.speedMph).filter(s => s != null && s > 0);
    const avgSpeed = speedsMph.length ? Math.round(speedsMph.reduce((a, b) => a + b, 0) / speedsMph.length) : null;
    const speedNote = avgSpeed ? ` at avg ${avgSpeed}mph` : '';

    evNote = `${totalEvents} event${totalEvents > 1 ? 's' : ''} total — ${label} dominate (${pct}%${speedNote}).`;

    // Threshold advice
    if (pct >= 80 && totalEvents >= 4) {
      const settingsSnap = drives[drives.length - 1].settings || {};
      if (dominant[0] === 'brake') {
        const cur = settingsSnap.hardBrake || 3.5;
        const sug = +(cur + 0.5).toFixed(1);
        evNote += ` Consider raising hardBrake threshold from ${cur} → ${sug} if these are normal driving.`;
      } else if (dominant[0] === 'turn') {
        const cur = settingsSnap.sharpTurn || 3.6;
        const sug = +(cur + 0.4).toFixed(1);
        evNote += ` Consider raising sharpTurn threshold from ${cur} → ${sug} if these are routine urban turns.`;
      } else if (dominant[0] === 'accel') {
        const cur = settingsSnap.hardAccel || 2.8;
        const sug = +(cur + 0.3).toFixed(1);
        evNote += ` Consider raising hardAccel threshold from ${cur} → ${sug}.`;
      }
    }
  }

  // Distance + top speed
  const totalMi = (drives.reduce((a, d) => a + (d.distance_meters || 0), 0) / 1609.34).toFixed(1);
  const topMph = Math.round(Math.max(...drives.map(d => (d.top_speed_mps || 0) * 2.237)));

  // Best drive
  const best = drives.reduce((a, b) => (b.score > (a.score || 0) ? b : a), drives[0]);
  const bestDate = best ? new Date(best.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const bestNote = best && scores.length > 1 ? ` Best drive: ${bestDate} (score ${Math.round(best.score)}).` : '';

  const scoreStr = avgScore != null ? `avg score ${avgScore}${trendStr}` : 'no scores recorded';

  return `${n} drive${n > 1 ? 's' : ''} in the last 48h — ${scoreStr}. ${totalMi} miles driven, top speed ${topMph}mph. ${evNote}${bestNote}`.trim();
}

function buildAnalytics(drives, history) {
  const allEvents = drives.flatMap(d => d.events || []);
  const evCounts = { brake: 0, accel: 0, turn: 0 };
  allEvents.forEach(e => { if (evCounts[e.type] !== undefined) evCounts[e.type]++; });

  const scores = drives.map(d => d.score).filter(Boolean);
  const histScores = history.map(h => h.score).filter(Boolean);

  return {
    driveCount: drives.length,
    avgScore: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null,
    historicAvgScore: histScores.length ? +(histScores.reduce((a, b) => a + b, 0) / histScores.length).toFixed(1) : null,
    totalEvents: allEvents.length,
    eventBreakdown: evCounts,
    totalMiles: +(drives.reduce((a, d) => a + (d.distance_meters || 0), 0) / 1609.34).toFixed(2),
    topSpeedMph: Math.round(Math.max(...drives.map(d => (d.top_speed_mps || 0) * 2.237), 0)),
  };
}
