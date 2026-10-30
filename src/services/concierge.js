/**
 * The concierge readout: everything the voice agent should know about this
 * driver's car when a call starts, as plain text for its prompt. Pure (no
 * storage reads), so the Garage hands in what it already loaded.
 *
 * Never includes locations: the agent needs the car's story, not where you go.
 */
import { metersToMiles } from '../utils/math.js';

const RECENT = 5;
const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

function carLine(car, odo){
  const name = [car?.year, car?.make, car?.model].filter(Boolean).join(' ') || 'Unknown car';
  return `Car: ${name}${odo ? `, about ${odo.toLocaleString('en-US')} miles` : ', odometer not entered'}.`;
}

function driveLine(d){
  const ev = d.events || [];
  const n = t => ev.filter(e => e.type === t).length;
  const mi = metersToMiles(d.distanceMeters || 0).toFixed(1);
  const min = Math.round((d.durationMs || 0) / 60000);
  const bits = [`score ${Math.round(d.score || 0)}`, `${mi} mi`, `${min} min`];
  bits.push(`${n('brake')} harsh braking, ${n('accel')} harsh acceleration, ${n('turn')} harsh cornering events`);
  if (d.wear?.hits) bits.push(`${d.wear.hits} big bumps or potholes`);
  return `- ${day(d.ts || d.startTime)}: ${bits.join(', ')}`;
}

/**
 * @param c        careFor() result: { car, odo, ctx, findings, timeline, drives }
 * @param report   the latest code scan (carHealth buildReport) or null
 * @param battery  batterySummary() or null
 * @param asked    the finding the driver tapped Ask on, or null
 */
export function conciergeReadout(c, { report = null, battery = null, asked = null, now = Date.now() } = {}){
  if (!c) return 'No car is set up in the app yet.';
  const L = [carLine(c.car, c.odo)];

  if (asked) L.push('', `They tapped Ask on: ${asked.title}. ${asked.evidence || ''} App advice: ${asked.advice || ''}`.trim());

  L.push('', 'What the app flagged:');
  L.push(...(c.findings.length
    ? c.findings.map(f => `- ${f.title}. ${f.evidence || ''}`.trim())
    : ['- Nothing in recent driving.']));

  L.push('', 'Code scan (OBD dongle):');
  if (!report) L.push('- No scan yet.');
  else {
    const ago = Math.round((now - report.checkedAt) / 86_400_000);
    L.push(`- Scanned ${ago <= 0 ? 'today' : `${ago} day${ago === 1 ? '' : 's'} ago`}. Check-engine light ${report.milOn ? 'ON' : report.milOn === false ? 'off' : 'unknown'}.`);
    if (!report.codes.length) L.push(report.unread ? `- The car reports ${report.unread} stored code(s) the dongle couldn't read.` : '- No trouble codes.');
    for (const k of report.codes) L.push(`- ${k.code}${k.pending ? ' (pending, early warning)' : ''}: ${k.title}. Severity: ${k.severity}.`);
  }

  L.push('', 'Battery:');
  const parts = battery?.parts?.filter(p => p.v != null) || [];
  L.push(...(parts.length
    ? parts.map(p => `- ${p.name}: ${p.v.toFixed(2)} V (${p.state})`)
    : ['- No voltage readings yet.']));

  const due = c.timeline.filter(t => t.status === 'overdue' || t.status === 'soon');
  L.push('', 'Maintenance due:');
  L.push(...(due.length ? due.map(t => `- ${t.name}: ${t.status}, ${t.due}`) : ['- Nothing logged as due.']));

  // This car's drives only (a multi-car driver's other car isn't this story).
  const mine = d => (d.vehicleId ?? d.wear?.vid ?? null) === (c.vid ?? null);
  const recent = (c.drives || []).filter(d => !d.simulated && mine(d)).slice(0, RECENT);
  L.push('', `Last ${recent.length || ''} drives:`.replace('  ', ' '));
  L.push(...(recent.length ? recent.map(driveLine) : ['- No drives recorded yet.']));

  return L.join('\n');
}

/** What the agent is told about itself, ahead of the readout. */
export const CONCIERGE_PROMPT = `You are the Smooth AF Concierge, the voice assistant inside the Smooth AF Driving app. The driver started this call from their Garage, and the app has handed you their car's readout below, so you already know their car, codes, battery and recent driving. Use it: don't ask for things the readout already says.

Help them understand what's going on with their car, decide whether they can handle it themselves, and know when it needs a mechanic. Sort each issue into: do it yourself (the Learn button on the card has how-to videos), get it looked at soon (the Book button finds a mechanic; Smooth AF's partner Lotus Mobile Mechanic comes to you around Boulder and Denver), or stop driving.

Safety first: soft or sinking brakes, smoke, burning or fuel smell, a flashing check-engine light, steering trouble or overheating mean pull over somewhere safe and call roadside assistance or a tow; if anyone is hurt or in danger, call 911. If they're driving right now, ask them to call back once parked.

Be honest: you can't see the car, so say "likely" and "worth checking". Never invent recalls, codes or prices. Keep it short and conversational, one question at a time, like a friend who knows cars. When it fits, mention that smoother braking and fewer hard hits mean less wear.`;
