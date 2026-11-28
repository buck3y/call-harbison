// Requests from other websites: refused for /api/track and for changes in /api/hq; for /api/leads never refused,
// only counted in one shared bucket. /api/intake (server to server, with its bearer) is unchanged.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isCrossSite } from '../lib/request-origin.js';
import track, { resetTrackLogs } from '../api/track.js';
import hq, { COOKIE, makeSession, resetHqLimits } from '../api/hq.js';
import leads, { CROSS_SITE_MAX, resetLeadLimiters } from '../api/leads.js';
import intake from '../api/intake.js';
import { db, installMockSupabase } from '../dev/mock-supabase.mjs';
import { openAnalyticsStore } from '../lib/analytics-store.js';

const SITE = { SITE_URL: 'https://www.callharbison.com' };
const req = (headers) => ({ headers });
const FOREIGN = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', host: 'www.callharbison.com' };
const SAME = { origin: 'https://www.callharbison.com', 'sec-fetch-site': 'same-origin', host: 'www.callharbison.com' };

function response() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.end = (v = '') => ((res.raw = v), res);
  return res;
}
const run = async (fn, request, env) => { const res = response(); await fn({ headers: {}, ...request }, res, env); return res; };

let warnings = [];
beforeEach(() => { resetLeadLimiters(); resetHqLimits(); resetTrackLogs(); warnings = []; console.warn = (...a) => warnings.push(a.join(' ')); });

test('isCrossSite: what counts as another website', () => {
  assert.equal(isCrossSite(req({}), SITE), false, 'no headers: old browsers and servers');
  assert.equal(isCrossSite(req({ 'sec-fetch-site': 'cross-site' }), SITE), true);
  assert.equal(isCrossSite(req({ 'sec-fetch-site': 'same-origin' }), SITE), false);
  assert.equal(isCrossSite(req({ 'sec-fetch-site': 'none' }), SITE), false);
  assert.equal(isCrossSite(req(SAME), SITE), false);
  assert.equal(isCrossSite(req({ origin: 'http://localhost:3000', host: 'localhost:3000' }), SITE), false, 'the request host itself');
  assert.equal(isCrossSite(req({ origin: 'https://www.callharbison.com', host: '127.0.0.1:3000' }), SITE), false, "SITE_URL's origin, behind a proxy");
  assert.equal(isCrossSite(req({ origin: 'https://callharbison.com', host: 'www.callharbison.com' }), SITE), true, 'another host, even of the same site');
  assert.equal(isCrossSite(req({ origin: 'https://evil.example', host: 'www.callharbison.com' }), SITE), true);
  assert.equal(isCrossSite(req({ origin: 'https://www.callharbison.com.evil.example', host: 'www.callharbison.com' }), SITE), true);
  assert.equal(isCrossSite(req({ origin: 'null', host: 'www.callharbison.com' }), SITE), true, 'an Origin of null');
  assert.equal(isCrossSite(req({ origin: 'not a url', host: 'www.callharbison.com' }), SITE), true);
  assert.equal(isCrossSite(req({ origin: 'https://evil.example', 'sec-fetch-site': 'same-site', host: 'www.callharbison.com' }), SITE), true);
  // A same-origin form post or CSP report from a page with Referrer-Policy: no-referrer (HQ) carries Origin: null.
  assert.equal(isCrossSite(req({ origin: 'null', 'sec-fetch-site': 'same-origin', host: 'hq.callharbison.com' }), SITE), false);
  assert.equal(isCrossSite(req({ origin: 'null', 'sec-fetch-site': 'cross-site' }), SITE), true);
});

test('POST /api/track from another website is refused with 403; a same-origin post still records', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => assert.fail('nothing leaves this server');
  const dir = mkdtempSync(join(tmpdir(), 'hbh-cross-site-track-'));
  const store = openAnalyticsStore({ dir, secret: 'test-secret-for-the-visitor-hash-0123456789', flushIntervalMs: 0 });
  const env = { ...SITE, ANALYTICS_STORE: 'local', ANALYTICS_DIR: dir };
  try {
    const body = () => JSON.stringify({ sid: randomUUID(), type: 'start', path: '/', referrerType: 'direct' });
    const refused = await run(track, { method: 'POST', headers: { ...FOREIGN, 'x-real-ip': '192.0.2.1' }, body: body() }, env);
    assert.equal(refused.statusCode, 403);
    const csp = await run(track, { method: 'POST', url: '/api/track?csp=1', headers: { ...FOREIGN }, body: '{"csp-report":{}}' }, env);
    assert.equal(csp.statusCode, 403, 'CSP reports from another website too: they would only fill the log');
    const ok = await run(track, { method: 'POST', headers: { ...SAME, 'x-real-ip': '192.0.2.1', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0' }, body: body() }, env);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.stored, true);
    assert.ok(warnings.includes('[security] cross-site POST to /api/track refused'));
  } finally { globalThis.fetch = original; store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('/api/hq: any change from another website is 403 whatever the cookie; reads and same-origin changes work', async () => {
  const original = globalThis.fetch;
  const env = { HQ_PASSWORD: 'correct horse battery staple' };
  installMockSupabase(env);
  try {
    const cookie = `${COOKIE}=${makeSession('Nate', env)}`;
    const target = db.leads[0].id;
    const patch = (headers) => run(hq, { method: 'PATCH', url: `/api/hq?action=lead&id=${target}`, headers: { cookie, 'x-hq': '1', ...headers }, body: { notes: 'cross-site test' } }, env);
    for (const headers of [FOREIGN, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }]) {
      const res = await patch(headers);
      assert.equal(res.statusCode, 403, JSON.stringify(headers));
    }
    assert.notEqual(db.leads[0].notes, 'cross-site test');
    for (const action of ['login', 'logout']) assert.equal((await run(hq, { method: 'POST', url: `/api/hq?action=${action}`, headers: { ...FOREIGN, 'x-hq': '1' }, body: { password: env.HQ_PASSWORD } }, env)).statusCode, 403, action);
    assert.equal((await run(hq, { method: 'GET', url: '/api/hq?action=me', headers: { cookie, ...FOREIGN } }, env)).statusCode, 200, 'a GET changes nothing (and SameSite=Strict keeps the cookie off cross-site requests)');
    const same = await patch(SAME);
    assert.equal(same.statusCode, 200, JSON.stringify(same.body));
    assert.equal(db.leads[0].notes, 'cross-site test');
    assert.equal((await patch({})).statusCode, 200, 'no Origin at all: not cross-site');
    assert.equal(warnings.filter((l) => l.startsWith('[security] cross-site PATCH to /api/hq refused')).length, 4);
    assert.ok(warnings.every((l) => !l.includes(target) && !l.includes('evil.example')), 'route only');
  } finally { globalThis.fetch = original; }
});

test('POST /api/leads from another website is stored, never refused, but all such posts share one bucket', async () => {
  const original = globalThis.fetch;
  const env = { ...SITE };
  installMockSupabase(env);
  try {
    const lead = (n, headers) => run(leads, {
      method: 'POST', url: '/api/leads',
      headers: { 'x-real-ip': `198.51.100.${n}`, ...headers },
      body: { submission_id: randomUUID(), form_type: 'options', street: `${n} Proxy Rd`, city: 'Bakersfield', zip: '93301', name: `Proxy Reader ${n}`, phone: `66155501${String(n).padStart(2, '0')}`, consent_response: 'yes', situation: 'I inherited the property' },
    }, env);
    const results = [];
    for (let n = 1; n <= CROSS_SITE_MAX; n += 1) results.push(await lead(n, FOREIGN));
    assert.deepEqual(results.map((r) => r.statusCode), Array(CROSS_SITE_MAX).fill(200), 'a reader on a translation proxy is a real lead');
    for (const r of results) assert.ok(db.leads.some((l) => l.id === r.body.id), 'stored');
    const over = await lead(CROSS_SITE_MAX + 1, { origin: 'https://another-proxy.example' });
    assert.equal(over.statusCode, 429, 'the sixth cross-site post in 10 minutes, from a new address and a new site');
    assert.equal(over.body.error, 'Too many requests. Please wait a few minutes or call us directly.', 'the same 429 the other limits give');
    assert.equal((await lead(CROSS_SITE_MAX + 2, SAME)).statusCode, 200, 'the site’s own visitors are not affected');
    assert.equal((await lead(CROSS_SITE_MAX + 3, {})).statusCode, 200);
    assert.equal(warnings.filter((l) => l.startsWith('[security] submissions from other websites are over their shared limit')).length, 1);
  } finally { globalThis.fetch = original; }
});

test('/api/intake is server to server: its bearer decides, not the Origin', async () => {
  const original = globalThis.fetch;
  const env = { CRM_INGEST_SECRET: 'test-secret-with-at-least-32-characters' };
  installMockSupabase(env);
  try {
    const body = { version: 1, brand: 'harbison_standard', submission_id: randomUUID(), lead: { name: 'Bridge Buyer', email: 'bridge@example.invalid', goal: 'Buying' } };
    const res = await run(intake, { method: 'POST', headers: { ...FOREIGN, authorization: `Bearer ${env.CRM_INGEST_SECRET}` }, body }, env);
    assert.equal(res.statusCode, 201);
    assert.equal((await run(intake, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body }, env)).statusCode, 401);
    assert.ok(warnings.some((l) => /^\[security\] intake bearer wrong from (unknown|[\d.]+)$/.test(l)), warnings.join('\n'));
  } finally { globalThis.fetch = original; }
});
