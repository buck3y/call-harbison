// One master secret, one key per purpose (lib/secrets.js), and a thank-you details token that is always checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyFor, masterSecret, masterSecretSource, PURPOSE, secretNotes, sessionPurpose } from '../lib/secrets.js';
import { makeSession, readSession } from '../api/hq.js';
import leadsHandler, { makeDetailsToken, readDetailsToken, resetLeadLimiters } from '../api/leads.js';
import { previewToken } from '../lib/seller-operations.js';
import { closeLocalDatabase, openLocalDatabase } from '../lib/local-database.js';

const LONG = 'a-session-secret-that-is-long-enough-0123456789';
const base = { HQ_PASSWORD: 'correct horse battery staple', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests' };
const unrelated = { CRM_INGEST_SECRET: 'shared-with-harbison-standard-0123456789', RESEND_API_KEY: 're_live_key', LEAD_WEBHOOK_URL: 'https://hooks.invalid/secret-path' };
const lead = { id: '11111111-1111-4111-8111-111111111111', phone: '(661) 555-0101', address: '101 Example Ave, Bakersfield, CA 93301' };
const rows = [{ id: 'r1', source_system: 'synthetic' }];
const keys = (env) => ({ session: keyFor(env, sessionPurpose(env)), details: keyFor(env, PURPOSE.details), preview: keyFor(env, PURPOSE.preview) });

test('the session, details and preview keys differ from each other, and none equals a setting or the master', () => {
  for (const env of [base, { ...base, HQ_SESSION_SECRET: LONG }, { HQ_PASSWORD: base.HQ_PASSWORD }]) {
    const k = keys(env);
    assert.notDeepEqual(k.session, k.details);
    assert.notDeepEqual(k.session, k.preview);
    assert.notDeepEqual(k.details, k.preview);
    const values = [...Object.values({ ...env, ...unrelated }), masterSecret(env)].map(String);
    for (const key of Object.values(k)) {
      assert.equal(key.length, 32);
      for (const value of values) {
        for (const form of [key.toString('hex'), key.toString('base64'), key.toString('base64url'), key.toString('latin1')]) assert.notEqual(form, value);
      }
    }
  }
});

test('the master secret comes from HQ_SESSION_SECRET (32+), else the database key, else one made at start', () => {
  assert.equal(masterSecretSource({ ...base, HQ_SESSION_SECRET: LONG }), 'HQ_SESSION_SECRET');
  assert.equal(masterSecret({ ...base, HQ_SESSION_SECRET: LONG }), LONG);
  // A short one is ignored, with a note at start; the next source is used.
  const short = { ...base, HQ_SESSION_SECRET: 'too-short' };
  assert.equal(masterSecretSource(short), 'SUPABASE_SERVICE_ROLE_KEY');
  assert.match(secretNotes(short).join(' '), /HQ_SESSION_SECRET is shorter than 32 characters, so it is ignored/);
  assert.doesNotMatch(secretNotes(short).join(' '), /too-short/, 'the note names the setting, never its value');
  assert.equal(masterSecretSource({ HQ_PASSWORD: 'x' }), 'process');
  assert.equal(masterSecret({}), masterSecret({ RESEND_API_KEY: 'x' }), 'the per-process key is stable within the process');
  assert.match(secretNotes({}).join(' '), /key made at start/);
  assert.deepEqual(secretNotes(base), []);
});

test('CRM_INGEST_SECRET, RESEND_API_KEY and LEAD_WEBHOOK_URL no longer influence any key or token', () => {
  for (const env of [base, { HQ_PASSWORD: base.HQ_PASSWORD }, { ...base, HQ_SESSION_SECRET: LONG }]) {
    const withOthers = { ...env, ...unrelated };
    assert.deepEqual(keys(withOthers), keys(env));
    const now = Date.parse('2026-11-27T12:00:00Z');
    assert.equal(makeSession('Nate', withOthers, now), makeSession('Nate', env, now));
    assert.equal(makeDetailsToken(lead, withOthers, now), makeDetailsToken(lead, env, now));
    assert.equal(previewToken(rows, withOthers, now + 1000), previewToken(rows, env, now + 1000));
    // Each setting alone, too: before, any of them could have been the details secret.
    for (const [k, v] of Object.entries(unrelated)) assert.equal(makeDetailsToken(lead, { ...env, [k]: v }, now), makeDetailsToken(lead, env, now), k);
  }
});

test('a token made under one master secret fails under another', () => {
  const a = { ...base };
  const b = { ...base, SUPABASE_SERVICE_ROLE_KEY: 'another-database-key' };
  const c = { ...base, HQ_SESSION_SECRET: LONG };
  const token = makeDetailsToken(lead, a);
  assert.equal(readDetailsToken(token, a).id, lead.id);
  assert.equal(readDetailsToken(token, b), null);
  assert.equal(readDetailsToken(token, c), null);
  assert.equal(readSession(makeSession('Nate', a), b), null);
  assert.equal(readSession(makeSession('Nate', a), a).n, 'Nate');
  // Changing HQ_PASSWORD still signs everyone out.
  assert.equal(readSession(makeSession('Nate', a), { ...a, HQ_PASSWORD: 'a different long password' }), null);
});

test('the details endpoint refuses a request without a valid token in every configuration', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('[]', { status: 200 }); };
  const err = console.error; console.error = () => {};
  const configs = [
    {},
    { ...unrelated },
    { CRM_INGEST_SECRET: unrelated.CRM_INGEST_SECRET },
    { RESEND_API_KEY: 're_key', LEAD_NOTIFY_EMAIL: 'staff@example.invalid' },
    { LEAD_WEBHOOK_URL: unrelated.LEAD_WEBHOOK_URL },
    base,
    { ...base, HQ_SESSION_SECRET: LONG },
    { ...base, HQ_SESSION_SECRET: 'short' },
  ];
  const other = { ...base, SUPABASE_SERVICE_ROLE_KEY: 'not-this-server' };
  const forged = `${Buffer.from(JSON.stringify({ id: lead.id, phone: lead.phone, address: lead.address, exp: Date.now() + 3600e3 })).toString('base64url')}.forged`;
  try {
    for (const env of configs) {
      for (const [why, extra] of [
        ['no token', {}],
        ['empty token', { details_token: '' }],
        ['forged token', { details_token: forged }],
        ['token from another server', { details_token: makeDetailsToken(lead, other) }],
        ['expired token', { details_token: makeDetailsToken(lead, env, Date.now() - 7 * 3600e3) }],
      ]) {
        resetLeadLimiters();
        const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
        await leadsHandler({ method: 'POST', headers: {}, body: { kind: 'details', ...lead, occupancy: 'Vacant', ...extra } }, res, env);
        assert.ok([400, 401].includes(res.statusCode), `${JSON.stringify(Object.keys(env))} / ${why}: ${res.statusCode}`);
        assert.equal(res.body.ok, false);
      }
    }
    assert.deepEqual(calls, [], 'nothing was stored or sent for a refused request');
  } finally { globalThis.fetch = original; console.error = err; }
});

test('with its own database, a short HQ_SESSION_SECRET does not become the signing key', async () => {
  const state = mkdtempSync(join(tmpdir(), 'hbh-security-keys-'));
  try {
    const db = await openLocalDatabase({ env: { HQ_SESSION_SECRET: 'short-secret' }, dir: join(state, 'db'), state, log: () => {} });
    assert.ok(existsSync(join(state, 'signing-key')), 'the random key in the state folder is used instead');
    assert.match(db.key, /^[a-f0-9]{64}$/);
    await closeLocalDatabase();
  } finally { await closeLocalDatabase().catch(() => {}); rmSync(state, { recursive: true, force: true }); }
});
