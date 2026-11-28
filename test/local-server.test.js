// The whole site on one machine: the real request handler from server.mjs, a temporary state folder, and nothing
// configured but HQ_PASSWORD. A lead is submitted, found and moved on in HQ; then everything is closed, a second
// instance starts on the same folder, and the lead and the change are still there.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../server.mjs';
import { closeLocalDatabase, openLocalDatabase, useDatabase } from '../lib/local-database.js';

for (const key of Object.keys(process.env)) {
  if (/^(SUPABASE_|DATABASE_|RESEND_|LEAD_|TWILIO_|CRM_|HQ_|SELLER_|ANALYTICS_|VERCEL)/.test(key)) delete process.env[key];
}
const state = mkdtempSync(join(tmpdir(), 'hbh-site-'));
const dist = mkdtempSync(join(tmpdir(), 'hbh-site-dist-'));
writeFileSync(join(dist, 'index.html'), '<h1>home</h1>');
process.env.HQ_PASSWORD = 'only-this-is-configured';
process.env.STATE_DIRECTORY = state;

const PHONE = '(661) 555-0142';
const STREET = '4127 Synthetic Oak Dr';
const logs = [];
const keep = { log: console.log, error: console.error, warn: console.warn };
for (const level of ['log', 'error', 'warn']) console[level] = (...args) => { logs.push(args.map(String).join(' ')); };
after(() => { Object.assign(console, keep); rmSync(state, { recursive: true, force: true }); rmSync(dist, { recursive: true, force: true }); });

async function start() {
  await openLocalDatabase({ env: process.env, log: (line) => logs.push(line) });
  useDatabase(process.env);
  const server = createServer(createHandler({ dist, log: (line) => logs.push(line) }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers: body ? { 'content-type': 'application/json', ...headers } : headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); done({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }); });
    });
    req.on('error', fail);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
  return { call, stop: () => new Promise((ok) => server.close(ok)) };
}

const submission = randomUUID();
// What the home page's offer flow posts (static/script.js composes `address` from the street, city and ZIP).
const lead = {
  form_type: 'options', street: STREET, city: 'Bakersfield', zip: '93309', address: `${STREET}, Bakersfield, CA 93309`,
  situation: 'I inherited the property', route_interest: 'direct', page_type: 'home', first_name: 'Testa', last_name: 'Lead',
  name: 'Testa Lead', phone: PHONE, email: 'testa.lead@example.invalid', consent_response: 'yes', source: '/', language: 'en', submission_id: submission,
};

test('a lead submitted, found and moved on in HQ survives a restart, with only HQ_PASSWORD set', async () => {
  const first = await start();
  const sent = await first.call('/api/leads', { method: 'POST', body: lead });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.id, submission);
  assert.equal(sent.json.duplicate, false);
  assert.ok(sent.json.details_token, 'a thank-you token, signed with the key kept in the state folder');
  const again = await first.call('/api/leads', { method: 'POST', body: lead });
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true, 'a retried submission is recognised, not stored twice');
  const details = await first.call('/api/leads', { method: 'POST', body: { kind: 'details', details_token: sent.json.details_token, timeline: 'Within 30 days', occupancy: 'Vacant', condition_flags: ['Major repairs needed'], desired_outcome: 'Compare my options' } });
  assert.equal(details.status, 200, JSON.stringify(details.json));

  const login = await first.call('/api/hq?action=login', { method: 'POST', body: { password: process.env.HQ_PASSWORD, name: 'Nathanael' } });
  assert.equal(login.status, 200);
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const list = await first.call('/api/hq?action=leads', { headers: { cookie } });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const found = list.json.leads.filter((l) => l.id === submission);
  assert.equal(found.length, 1, 'exactly one row for the submission');
  assert.equal(found[0].status, 'new');
  const moved = await first.call(`/api/hq?action=lead&id=${submission}`, { method: 'PATCH', headers: { cookie, 'x-hq': '1' }, body: { status: 'contact_attempted', notes: 'Left a voicemail' } });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  const health = await first.call('/api/hq?action=health', { headers: { cookie } });
  assert.equal(health.json.health.crm.label, 'Database on this server');

  // With the database closed, a lead is refused (502), never answered with a false success.
  await closeLocalDatabase();
  const refused = await first.call('/api/leads', { method: 'POST', body: { ...lead, submission_id: randomUUID(), phone: '(661) 555-0143' } });
  assert.equal(refused.status, 502);
  assert.equal(refused.json.ok, false);
  await first.stop();
  assert.deepEqual(readdirSync(state).sort(), ['db', 'signing-key'], 'the lock is gone after a clean close');

  const second = await start();
  const still = await second.call(`/api/hq?action=lead&id=${submission}`, { headers: { cookie } });
  assert.equal(still.status, 200, 'the sign-in from the first instance is still valid: the signing key was kept');
  assert.equal(still.json.lead.status, 'contact_attempted');
  assert.equal(still.json.lead.notes, 'Left a voicemail');
  assert.equal(still.json.lead.timeline, 'Within 30 days');
  assert.equal(still.json.lead.phone, PHONE);
  assert.ok(still.json.events.some((e) => /contact_attempted/.test(`${e.detail}`)), 'the stage change is in the activity log');
  const all = await second.call('/api/hq?action=leads', { headers: { cookie } });
  assert.equal(all.json.leads.filter((l) => l.id === submission).length, 1);
  await second.stop();
  await closeLocalDatabase();

  const text = logs.join('\n');
  for (const secret of [PHONE, '555-0142', '5550142', STREET, 'Synthetic Oak', 'testa.lead']) assert.ok(!text.includes(secret), `"${secret}" is not in the logs`);
  assert.ok(logs.some((line) => /^POST \/api\/leads 200/.test(line)), 'requests were logged, without their contents');
});
