// The log a sign-in, a failed sign-in, a lead, a search, an export and two CSP reports leave behind: the lines that
// should be there are, and none holds a password, a phone number, an e-mail address, a street or a query string.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../server.mjs';
import { cspLine, cspReports, resetTrackLogs } from '../api/track.js';
import { db, installMockSupabase } from '../dev/mock-supabase.mjs';

for (const key of Object.keys(process.env)) if (/^(SUPABASE_|RESEND_|LEAD_|TWILIO_|CRM_|HQ_|SELLER_|ANALYTICS_|VERCEL|GA_|GTM_|METRICOOL)/.test(key)) delete process.env[key];
const PASSWORD = 'a long and unique test password';
process.env.HQ_PASSWORD = PASSWORD;
process.env.SITE_URL = 'https://www.callharbison.com';
installMockSupabase(process.env);

const PHONE = '(661) 555-0188';
const EMAIL = 'logcheck.person@example.invalid';
const STREET = '4100 Logcheck Ln';
const SECRETS = [PASSWORD, 'wrong-password-guess', 'Mallory', PHONE, '555-0188', '5550188', EMAIL, 'logcheck.person', STREET, 'Logcheck Ln', 'q=', 'phone=', 'token=abc', 'uid=1', 'view=all'];

const logs = [];
const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
for (const level of Object.keys(keep)) console[level] = (...args) => logs.push(args.map(String).join(' '));
const dist = mkdtempSync(join(tmpdir(), 'hbh-security-logs-'));
writeFileSync(join(dist, 'index.html'), '<h1>home</h1>');
let server;
before(async () => {
  server = createServer(createHandler({ dist, log: (line) => logs.push(line) }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
});
after(() => { server.close(); Object.assign(console, keep); rmSync(dist, { recursive: true, force: true }); });

const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((done, fail) => {
  const text = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => done({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', fail);
  if (text) req.write(text);
  req.end();
});

test('sign-ins, a lead, a search, an export and CSP reports leave the right lines and nothing personal', async () => {
  // A lead from the public form, with everything a person types.
  const sent = await call('/api/leads', { method: 'POST', body: { submission_id: randomUUID(), form_type: 'options', street: STREET, city: 'Bakersfield', zip: '93309', name: 'Logcheck Person', phone: PHONE, email: EMAIL, consent_response: 'yes', situation: 'I inherited the property' } });
  assert.equal(sent.status, 200, sent.text);
  assert.ok(db.leads.some((l) => l.phone === PHONE));

  const failed = await call('/api/hq?action=login', { method: 'POST', body: { password: 'wrong-password-guess', name: 'Mallory' } });
  assert.equal(failed.status, 401);
  const ok = await call('/api/hq?action=login', { method: 'POST', body: { password: PASSWORD, name: 'Nate\u202e\r\n' } });
  assert.equal(ok.status, 200);
  const cookie = String(ok.headers['set-cookie']).split(';')[0];
  const found = await call(`/api/hq?action=leads&view=all&q=${encodeURIComponent(EMAIL)}`, { headers: { cookie } });
  assert.equal(JSON.parse(found.text).leads.length, 1);
  const csv = await call(`/api/hq?action=export&view=all&q=${encodeURIComponent('555-0188')}`, { headers: { cookie } });
  assert.equal(csv.status, 200);
  assert.ok(csv.text.includes(EMAIL), 'the export itself holds the lead');

  resetTrackLogs();
  const reportUri = { 'csp-report': { 'document-uri': `https://www.callharbison.com/thank-you?phone=6615550188&email=${encodeURIComponent(EMAIL)}`, 'effective-directive': 'script-src-elem', 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=abc', 'original-policy': "default-src 'self'" } };
  assert.equal((await call('/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: reportUri })).status, 204);
  const reportTo = [{ type: 'csp-violation', url: 'https://www.callharbison.com/about?uid=1', body: { documentURL: 'https://www.callharbison.com/about?uid=1', effectiveDirective: 'img-src', blockedURL: 'https://tracker.example/pixel.gif?uid=1', disposition: 'report' } }, { type: 'deprecation', body: { id: 'x' } }];
  assert.equal((await call('/csp-report', { method: 'POST', headers: { 'content-type': 'application/reports+json' }, body: reportTo })).status, 204);

  const text = logs.join('\n');
  for (const expected of [
    /^POST \/api\/leads 200 \d+ms$/m,
    /^POST \/api\/hq\?action=login 401 \d+ms$/m,
    /^POST \/api\/hq\?action=login 200 \d+ms$/m,
    /^GET \/api\/hq\?action=leads 200 \d+ms$/m,
    /^GET \/api\/hq\?action=export 200 \d+ms$/m,
    /^POST \/api\/track 204 \d+ms$/m,
    /^\[security\] hq sign-in failed from 127\.0\.0\.1$/m,
    /^\[security\] hq sign-in ok: "Nate" from 127\.0\.0\.1$/m,
    /^\[security\] hq export by "Nate": \d+ row\(s\)$/m,
    /^\[csp\] script-src-elem blocked evil\.example on \/thank-you$/m,
    /^\[csp\] img-src blocked tracker\.example on \/about$/m,
  ]) assert.match(text, expected);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `"${secret}" is not in the log`);
  assert.ok(logs.every((line) => !line.includes('\r') && !/\u202e/.test(line)), 'a display name cannot break a line');
});

test('CSP report lines: both report shapes, short values, no control characters, at most 30 per 10 minutes', async () => {
  assert.deepEqual(cspReports('not json'), []);
  assert.deepEqual(cspReports({ other: 1 }), []);
  assert.equal(cspReports(JSON.stringify(Array(50).fill({ type: 'csp-violation', body: {} }))).length, 20, 'a bounded number per post');
  assert.equal(cspLine({ 'violated-directive': "script-src 'self' https://x", 'blocked-uri': 'inline', 'document-uri': 'https://www.callharbison.com/' }), '[csp] script-src blocked inline on /');
  assert.equal(cspLine({ effectiveDirective: 'img-src', blockedURL: 'data', documentURL: 'https://www.callharbison.com/a' }), '[csp] img-src blocked data on /a');
  assert.equal(cspLine({ effectiveDirective: 'img-src', blockedURL: 'data:image/png;base64,AAAA', documentURL: 'https://www.callharbison.com/a' }), '[csp] img-src blocked data: on /a');
  assert.equal(cspLine({}), '[csp] unknown blocked unknown on unknown');
  const nasty = cspLine({ effectiveDirective: `script-src\n[security] forged${'x'.repeat(300)}`, blockedURL: 'https://evil.example', documentURL: `https://www.callharbison.com/${'p'.repeat(300)}?q=secret` });
  assert.ok(!nasty.includes('\n') && !nasty.includes('q=secret'));
  for (const part of nasty.replace(/^\[csp\] /, '').split(/ (?:blocked|on) /)) assert.ok(part.length <= 100, part.length);

  logs.length = 0;
  resetTrackLogs();
  const report = JSON.stringify({ 'csp-report': { 'effective-directive': 'font-src', 'blocked-uri': 'https://fonts.example/f.woff2', 'document-uri': 'https://www.callharbison.com/' } });
  for (let i = 0; i < 40; i += 1) await call('/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: report });
  assert.equal(logs.filter((l) => l.startsWith('[csp] ')).length, 30);
});
