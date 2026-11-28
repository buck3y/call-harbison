// The whole journey after the hardening, on the site's own database in a temporary folder and through the real
// request handler over real HTTP: a lead from the site's own page, sign in to HQ, find it, export, sign out.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../server.mjs';
import { closeLocalDatabase, openLocalDatabase, useDatabase } from '../lib/local-database.js';
import { masterSecretSource } from '../lib/secrets.js';

for (const key of Object.keys(process.env)) if (/^(SUPABASE_|DATABASE_|RESEND_|LEAD_|TWILIO_|CRM_|HQ_|SELLER_|ANALYTICS_|VERCEL)/.test(key)) delete process.env[key];
const state = mkdtempSync(join(tmpdir(), 'hbh-journey-'));
const dist = mkdtempSync(join(tmpdir(), 'hbh-journey-dist-'));
writeFileSync(join(dist, 'index.html'), '<h1>home</h1>');
const PASSWORD = 'journey-test-password-long';
process.env.HQ_PASSWORD = PASSWORD;
process.env.STATE_DIRECTORY = state;
process.env.SITE_URL = 'https://www.callharbison.com';

const PHONE = '(661) 555-0164';
const STREET = '9 Journey Test Ct';
const logs = [];
const keep = { log: console.log, warn: console.warn, error: console.error };
for (const level of Object.keys(keep)) console[level] = (...args) => logs.push(args.map(String).join(' '));
const steps = [];
after(async () => {
  Object.assign(console, keep);
  await closeLocalDatabase().catch(() => {});
  rmSync(state, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
  // The journey, for the report.
  console.log(steps.map((s) => `journey: ${s}`).join('\n'));
});

test('a same-origin lead, HQ sign-in, search, export and sign-out on the real local database', async () => {
  await openLocalDatabase({ env: process.env, log: () => {} });
  useDatabase(process.env);
  assert.equal(masterSecretSource(process.env), 'SUPABASE_SERVICE_ROLE_KEY', 'signed with the key kept in the state folder');
  const server = createServer(createHandler({ dist, log: (line) => logs.push(line) }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((done, fail) => {
    const req = request(`${origin}${path}`, { method, headers: body ? { 'content-type': 'application/json', ...headers } : headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
  const json = (r) => JSON.parse(r.text);
  // What a browser on the site's own page sends with a fetch().
  const page = { origin, 'sec-fetch-site': 'same-origin' };

  try {
    const submission = randomUUID();
    const sent = await call('/api/leads', { method: 'POST', headers: page, body: { submission_id: submission, form_type: 'options', street: STREET, city: 'Bakersfield', zip: '93309', name: 'Journey Tester', phone: PHONE, email: 'journey.tester@example.invalid', consent_response: 'yes', situation: 'I inherited the property', route_interest: 'direct', source: '/' } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(json(sent).id, submission);
    assert.ok(json(sent).details_token);
    steps.push(`POST /api/leads (same origin) -> ${sent.status}, stored as ${json(sent).id}, details token issued`);

    const details = await call('/api/leads', { method: 'POST', headers: page, body: { kind: 'details', details_token: json(sent).details_token, occupancy: 'Vacant' } });
    assert.equal(details.status, 200, details.text);
    const noToken = await call('/api/leads', { method: 'POST', headers: page, body: { kind: 'details', phone: PHONE, address: `${STREET}, Bakersfield, CA 93309`, occupancy: 'Tenant occupied' } });
    assert.equal(noToken.status, 401);
    steps.push(`thank-you details with its token -> ${details.status}; the same without a token -> ${noToken.status}`);

    const wrong = await call('/api/hq?action=login', { method: 'POST', headers: { ...page, 'x-hq': '1' }, body: { password: 'not the password', name: 'Nathanael' } });
    assert.equal(wrong.status, 401);
    const login = await call('/api/hq?action=login', { method: 'POST', headers: { ...page, 'x-hq': '1' }, body: { password: PASSWORD, name: 'Nathanael' } });
    assert.equal(login.status, 200, login.text);
    const setCookie = String(login.headers['set-cookie']);
    assert.match(setCookie, /^__Host-hq_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
    const cookie = setCookie.split(';')[0];
    steps.push(`sign-in: wrong password -> ${wrong.status}; right password -> ${login.status}, cookie ${cookie.split('=')[0]} (Path=/; HttpOnly; Secure; SameSite=Strict; 12 h)`);

    const found = await call(`/api/hq?action=leads&view=all&q=${encodeURIComponent('Journey Tester')}`, { headers: { ...page, cookie, 'x-hq': '1' } });
    assert.equal(found.status, 200, found.text);
    const rows = json(found).leads.filter((l) => l.id === submission);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phone, PHONE);
    const detail = await call(`/api/hq?action=lead&id=${submission}`, { headers: { ...page, cookie, 'x-hq': '1' } });
    assert.equal(json(detail).lead.occupancy, 'Vacant');
    steps.push(`search in HQ -> ${found.status}, found the lead once; its detail view shows the thank-you answer`);

    const csv = await call('/api/hq?action=export&view=all', { headers: { ...page, cookie, 'x-hq': '1' } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.split('\r\n').some((line) => line.startsWith(submission)), 'the lead is in the export');
    steps.push(`export -> ${csv.status}, ${csv.text.split('\r\n').length - 1} row(s), the lead among them`);

    const crossSite = await call('/api/hq?action=logout', { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', cookie, 'x-hq': '1' } });
    assert.equal(crossSite.status, 403);
    const logout = await call('/api/hq?action=logout', { method: 'POST', headers: { ...page, cookie, 'x-hq': '1' } });
    assert.equal(logout.status, 200);
    assert.match(String(logout.headers['set-cookie']), /^__Host-hq_session=; .*Max-Age=0$/);
    const afterwards = await call('/api/hq?action=me', { headers: page });
    assert.equal(afterwards.status, 401);
    steps.push(`sign-out from another site -> ${crossSite.status}; from HQ -> ${logout.status}, cookie cleared; without it -> ${afterwards.status}`);

    const text = logs.join('\n');
    for (const line of [/^POST \/api\/hq\?action=login 401 \d+ms$/m, /^POST \/api\/hq\?action=login 200 \d+ms$/m, /^\[security\] hq sign-in failed from 127\.0\.0\.1$/m, /^\[security\] hq sign-in ok: "Nathanael" from 127\.0\.0\.1$/m, /^\[security\] hq export by "Nathanael": \d+ row\(s\)$/m, /^\[security\] cross-site POST to \/api\/hq refused$/m, /^POST \/api\/hq\?action=logout 200 \d+ms$/m]) assert.match(text, line);
    for (const secret of [PASSWORD, 'not the password', PHONE, '555-0164', STREET, 'journey.tester', 'Journey Tester', 'Journey%20Tester']) assert.ok(!text.includes(secret), `"${secret}" is not in the log`);
    steps.push(`log: ${logs.filter((l) => /^(POST|GET) |^\[security\]/.test(l)).length} request and security lines, none with the password, the phone, the street, the e-mail or a search`);
    for (const line of logs.filter((l) => /^(POST|GET) |^\[security\]/.test(l))) steps.push(`  ${line.replace(/\d+ms$/, 'Nms')}`);
  } finally {
    await new Promise((ok) => server.close(ok));
    await closeLocalDatabase();
  }
});
