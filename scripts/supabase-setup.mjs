/**
 * One-shot Supabase setup over the Management API.
 *
 * Exists because the two remaining setup steps were dashboard-only clicking,
 * and the DB-password path (scripts/run-migrations.sh + SUPABASE_DB_URL) broke
 * when that password was rotated. This needs one credential instead —
 * SUPABASE_ACCESS_TOKEN, a personal access token — and does both jobs:
 *
 *   1. applies any pending files in supabase/migrations/
 *   2. makes the auth emails print the 6-digit code
 *
 * Both are idempotent: migrations are tracked in public.schema_migrations, and
 * a template that already contains {{ .Token }} is left alone. Safe to re-run.
 *
 * Node 18+, no dependencies.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API   = 'https://api.supabase.com';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF   = process.env.SUPABASE_PROJECT_REF || 'dbreetxubxdxogmektxc';
const DRY   = process.argv.includes('--dry-run');

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG_DIR = join(ROOT, 'supabase', 'migrations');

if (!TOKEN){
  console.error('SUPABASE_ACCESS_TOKEN is not set.');
  console.error('Create one at https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

/** Management API call. Throws with the server's own message on failure. */
async function api(path, { method = 'GET', body } = {}){
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok){
    throw new Error(`${method} ${path} → ${res.status}\n${text.slice(0, 600)}`);
  }
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

/** Run SQL through the same endpoint the dashboard's SQL editor uses. */
const sql = q => api(`/v1/projects/${REF}/database/query`, { method: 'POST', body: { query: q } });

/** Postgres string literal — migrations are trusted, filenames less so. */
const lit = s => `'${String(s).replace(/'/g, "''")}'`;

// ── 1 · Migrations ────────────────────────────────────────────────────────────

async function applyMigrations(){
  console.log('\n── Migrations ───────────────────────────────────');

  let files;
  try {
    files = (await readdir(MIG_DIR)).filter(f => f.endsWith('.sql')).sort();
  } catch {
    console.log('No supabase/migrations directory — nothing to do.');
    return;
  }
  if (!files.length){ console.log('No migration files.'); return; }

  // A dry run must not write, and `create table if not exists` is still a write.
  // Read the tracking table instead, treating "doesn't exist yet" as nothing
  // applied — which is exactly what a first real run would find.
  let applied = new Set();
  if (DRY){
    try {
      const rows = await sql('select version from public.schema_migrations;');
      applied = new Set((rows || []).map(r => r.version));
    } catch {
      console.log('(no schema_migrations table yet — everything below is pending)');
    }
  } else {
    await sql(`create table if not exists public.schema_migrations (
                 version text primary key,
                 applied_at timestamptz not null default now()
               );`);
    const rows = await sql('select version from public.schema_migrations;');
    applied = new Set((rows || []).map(r => r.version));
  }

  let pending = 0;
  for (const f of files){
    if (applied.has(f)){ console.log(`• already applied: ${f}`); continue; }
    pending++;
    const body = await readFile(join(MIG_DIR, f), 'utf8');
    console.log(`→ applying:        ${f}`);
    if (DRY){ console.log('  (dry run — not sent)'); continue; }
    // One statement: the migration and its bookkeeping commit together, so a
    // failure can't leave the file recorded as applied.
    await sql(`begin;\n${body}\ninsert into public.schema_migrations (version) values (${lit(f)});\ncommit;`);
    console.log(`✓ applied:         ${f}`);
  }
  if (!pending)   console.log('\nDatabase already up to date.');
  else if (DRY)   console.log(`\n${pending} migration(s) would be applied.`);
  else            console.log(`\n${pending} migration(s) applied.`);
}

// ── 2 · Auth email templates ──────────────────────────────────────────────────

// Supabase's stock templates mail a magic link. A link has to deep-link back
// into the native app, which breaks whenever the mail client opens it in its own
// webview — so the app asks for a typed code instead. The code is always
// generated; the default template just never prints it.
const CODE_BLOCK = `
<h2>Your Smooth AF code</h2>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:18px 0">{{ .Token }}</p>
<p>Enter this in the app to sign in. It expires in an hour.</p>
<p style="color:#888;font-size:13px">If you didn't ask for this, you can ignore it.</p>
`.trim();

// A first-time address gets "Confirm signup"; a returning one gets "Magic Link".
// Both have to carry the code or half the sign-ins dead-end.
const TEMPLATES = [
  { key: 'mailer_templates_confirmation_content', label: 'Confirm signup' },
  { key: 'mailer_templates_magic_link_content',   label: 'Magic Link'     },
];

async function setupEmailTemplates(){
  console.log('\n── Auth email templates ─────────────────────────');

  const cfg   = await api(`/v1/projects/${REF}/config/auth`);
  const patch = {};

  for (const { key, label } of TEMPLATES){
    const current = cfg?.[key] || '';
    if (current.includes('{{ .Token }}')){
      console.log(`• already prints the code: ${label}`);
      continue;
    }
    // An empty value means Supabase is serving its built-in default, so there's
    // nothing of the user's to preserve — write the code template outright.
    // Otherwise keep whatever they've customised and add the code above it.
    patch[key] = current.trim() ? `${CODE_BLOCK}\n<hr>\n${current}` : CODE_BLOCK;
    console.log(`→ adding the code to:      ${label}${current.trim() ? ' (keeping existing content)' : ''}`);
  }

  if (!Object.keys(patch).length){ console.log('\nTemplates already good.'); return; }
  if (DRY){ console.log('\n(dry run — not sent)'); return; }

  await api(`/v1/projects/${REF}/config/auth`, { method: 'PATCH', body: patch });
  console.log('\nTemplates updated.');
}

// ── 3 · One-time-code length ──────────────────────────────────────────────────

// The project was configured to mail 8-digit codes while the app's input was
// capped at 6 characters — the last two digits could not be typed at all, so
// sign-in was impossible rather than merely fiddly. That mismatch is the bug.
//
// 6 is the floor: Supabase rejects anything shorter with
//   "mailer_otp_length: Too small: expected number to be >=6"
// so the app's existing maxlength="6" was right all along, and this only has to
// bring the server down to meet it. Don't lower it further — you can't.
//
// Note also what is deliberately NOT changed here: the expiry, left at its
// 3600s default. A code that expired before arriving is a mail-latency problem;
// widening the window would only enlarge the guessing surface. Fix the mail.
const OTP_MIN     = 6;   // enforced server-side by Supabase
const OTP_LENGTH  = Number(process.env.SUPABASE_OTP_LENGTH || OTP_MIN);

async function setupOtpLength(){
  console.log('\n── One-time-code length ─────────────────────────');

  if (!Number.isInteger(OTP_LENGTH) || OTP_LENGTH < OTP_MIN || OTP_LENGTH > 10){
    throw new Error(
      `SUPABASE_OTP_LENGTH must be an integer ${OTP_MIN}–10, got ${OTP_LENGTH}. ` +
      `Supabase rejects anything below ${OTP_MIN}.`
    );
  }

  const cfg     = await api(`/v1/projects/${REF}/config/auth`);
  const current = cfg?.mailer_otp_length;
  const expSecs = Number(cfg?.mailer_otp_exp ?? 0);

  // Surfaced rather than changed: if mail arrives after this window the code is
  // already dead on arrival, and that is a delivery problem wearing a costume.
  console.log(`code expires after: ${expSecs ? `${expSecs}s (${Math.round(expSecs / 60)} min)` : 'unknown'}`);

  if (Number(current) === OTP_LENGTH){
    console.log(`• already ${OTP_LENGTH} digits`);
    return;
  }

  console.log(`→ ${current || 'default'} digits → ${OTP_LENGTH}`);
  if (DRY){ console.log('  (dry run — not sent)'); return; }

  await api(`/v1/projects/${REF}/config/auth`, {
    method: 'PATCH',
    body:   { mailer_otp_length: OTP_LENGTH },
  });
  console.log(`✓ code is now ${OTP_LENGTH} digits`);
}

// ── 4 · Custom SMTP ───────────────────────────────────────────────────────────

// Supabase's built-in mailer is a shared, throttled service the docs are explicit
// about not using in production. Here it delivered a sign-in code more than an
// hour late — past the code's own expiry — which to the driver is indistinguishable
// from "sign-in is broken". Custom SMTP is the fix.
//
// Credentials come from the environment, never the repo. Set them as Actions
// secrets and pass them through in the workflow. With none set this is skipped,
// so the script stays safe to run for the migration/template half alone.
const SMTP = {
  smtp_host:        process.env.SMTP_HOST,
  smtp_port:        process.env.SMTP_PORT,
  smtp_user:        process.env.SMTP_USER,
  smtp_pass:        process.env.SMTP_PASS,
  smtp_admin_email: process.env.SMTP_SENDER_EMAIL,
  smtp_sender_name: process.env.SMTP_SENDER_NAME || 'Smooth AF',
};

async function setupSmtp(){
  console.log('\n── Custom SMTP ──────────────────────────────────');

  // sender_name has a default, so it can't be the thing that decides intent.
  const required = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_admin_email'];
  const missing  = required.filter(k => !SMTP[k]);

  if (missing.length === required.length){
    console.log('No SMTP_* environment variables set — skipping.');
    console.log('Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SENDER_EMAIL to configure it.');
    return;
  }
  if (missing.length){
    throw new Error(`SMTP is half-configured. Missing: ${missing.join(', ')}`);
  }

  const cfg = await api(`/v1/projects/${REF}/config/auth`);

  // The live config is the authority on which keys this project actually
  // exposes — cheaper to check than to discover through a silently-ignored PATCH.
  const unknown = Object.keys(SMTP).filter(k => !(k in (cfg || {})));
  if (unknown.length){
    console.log(`! not present in this project's auth config: ${unknown.join(', ')}`);
    console.log('  (they will be sent anyway; Supabase ignores keys it does not know)');
  }

  if (cfg?.smtp_host === SMTP.smtp_host && cfg?.smtp_user === SMTP.smtp_user){
    console.log(`• already sending through ${SMTP.smtp_host} as ${SMTP.smtp_admin_email}`);
    return;
  }

  console.log(`→ host:   ${SMTP.smtp_host}:${SMTP.smtp_port}`);
  console.log(`→ sender: ${SMTP.smtp_sender_name} <${SMTP.smtp_admin_email}>`);
  console.log('  (password not printed)');
  if (DRY){ console.log('\n(dry run — not sent)'); return; }

  await api(`/v1/projects/${REF}/config/auth`, { method: 'PATCH', body: SMTP });
  console.log('\n✓ SMTP configured — mail now leaves through your own sender.');
}

// ── 5 · Verify ────────────────────────────────────────────────────────────────

async function verify(){
  console.log('\n── Verify ───────────────────────────────────────');
  const col = await sql(`select 1 from information_schema.columns
                         where table_schema='public' and table_name='drives'
                           and column_name='user_id';`);
  console.log(`drives.user_id column: ${col?.length ? 'present ✓' : 'MISSING ✗'}`);

  const cfg = await api(`/v1/projects/${REF}/config/auth`);
  for (const { key, label } of TEMPLATES){
    console.log(`${label}: ${(cfg?.[key] || '').includes('{{ .Token }}') ? 'prints the code ✓' : 'NO CODE ✗'}`);
  }
  console.log(`Code length: ${cfg?.mailer_otp_length || 'default'} digits${Number(cfg?.mailer_otp_length) === OTP_LENGTH ? ' ✓' : ''}`);
  console.log(`Mail sender: ${cfg?.smtp_host ? `${cfg.smtp_host} ✓` : 'Supabase shared mailer — slow, not for production ✗'}`);
  console.log(`Sign in with Apple: ${cfg?.external_apple_enabled ? 'enabled ✓' : 'off (optional)'}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  console.log(`Project: ${REF}${DRY ? '   [DRY RUN]' : ''}`);
  await applyMigrations();
  await setupEmailTemplates();
  // SMTP before code length, deliberately. Mail delivery is the critical path;
  // code length is cosmetic. Running them the other way round once meant a
  // rejected length value aborted the script before it ever configured the
  // mailer — a nice-to-have blocking the thing that actually mattered.
  await setupSmtp();
  await setupOtpLength();
  if (!DRY) await verify();
  console.log('\nDone.');
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
