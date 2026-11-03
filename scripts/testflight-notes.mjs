// Sets a TestFlight build's "What to Test" text through the App Store Connect API.
//   KEY_ID=… ISSUER_ID=… PRIVATE_KEY=… BUILD_NUMBER=253 NOTES=… node scripts/testflight-notes.mjs
import { createSign } from 'node:crypto';

const { KEY_ID, ISSUER_ID, PRIVATE_KEY, BUILD_NUMBER, NOTES } = process.env;
const BUNDLE_ID = 'com.smoothafdriving.app';
const API = 'https://api.appstoreconnect.apple.com/v1';
const LOCALE = 'en-US';
const MAX_NOTES = 4000;   // Apple's limit
// A build isn't visible to the API until Apple has started processing it.
const WAIT_MS = 25 * 60_000, RETRY_MS = 30_000;

const b64url = (v) => Buffer.from(v).toString('base64url');

function token(){
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key: PRIVATE_KEY, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}

async function api(path, { method = 'GET', data } = {}){
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify({ data }) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function setNotes(buildId, whatsNew){
  const { data: locs } = await api(`/builds/${buildId}/betaBuildLocalizations`);
  const loc = locs.find((l) => l.attributes.locale === LOCALE);
  if (loc){
    await api(`/betaBuildLocalizations/${loc.id}`, {
      method: 'PATCH',
      data: { type: 'betaBuildLocalizations', id: loc.id, attributes: { whatsNew } },
    });
  } else {
    await api('/betaBuildLocalizations', {
      method: 'POST',
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: LOCALE, whatsNew },
        relationships: { build: { data: { type: 'builds', id: buildId } } },
      },
    });
  }
  // Read it back, so a green run means the text is really there.
  const { data: after } = await api(`/builds/${buildId}/betaBuildLocalizations`);
  return after.find((l) => l.attributes.locale === LOCALE)?.attributes.whatsNew;
}

const notes = (NOTES || '').trim().slice(0, MAX_NOTES);
if (!notes || !BUILD_NUMBER) throw new Error('BUILD_NUMBER and NOTES are required');

const { data: apps } = await api(`/apps?filter[bundleId]=${BUNDLE_ID}&limit=1`);
if (!apps.length) throw new Error(`No app found for ${BUNDLE_ID}`);

const deadline = Date.now() + WAIT_MS;
for (;;){
  let lastError = `build ${BUILD_NUMBER} not visible yet`;
  try {
    const { data: builds } = await api(`/builds?filter[app]=${apps[0].id}&filter[version]=${BUILD_NUMBER}&limit=1`);
    if (builds.length){
      const saved = await setNotes(builds[0].id, notes);
      if (saved !== notes) throw new Error(`read back different text: ${saved}`);
      console.log(`Build ${BUILD_NUMBER} notes set:\n${saved}`);
      break;
    }
  } catch (err){
    lastError = err.message;
  }
  if (Date.now() > deadline) throw new Error(lastError);
  console.log(`${lastError}; retrying`);
  await new Promise((r) => setTimeout(r, RETRY_MS));
}
