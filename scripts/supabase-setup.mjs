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

// ── 3 · Verify ────────────────────────────────────────────────────────────────

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
  console.log(`Sign in with Apple: ${cfg?.external_apple_enabled ? 'enabled ✓' : 'off (optional)'}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  console.log(`Project: ${REF}${DRY ? '   [DRY RUN]' : ''}`);
  await applyMigrations();
  await setupEmailTemplates();
  if (!DRY) await verify();
  console.log('\nDone.');
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
