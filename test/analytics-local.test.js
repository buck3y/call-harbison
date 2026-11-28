// Local analytics (the default off Vercel, or ANALYTICS_STORE=local): /api/track records on this server and HQ reads
// the same store. test/analytics.test.js and test/central-hq.test.js keep proving the shared (forwarding) behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import track from '../api/track.js';
import hq, { makeSession } from '../api/hq.js';
import { openAnalyticsStore, flushAnalytics } from '../lib/analytics-store.js';
import { flushAnalytics as serverFlush } from '../server.mjs';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const HQ_ENV = { HQ_PASSWORD: 'test password', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test key' };
const CRM = 'test-shared-secret-longer-than-32-characters';

const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const post = async (body, env, headers = {}) => {
  const res = response();
  await track({ method: 'POST', headers: { 'x-real-ip': '192.0.2.8', 'user-agent': IPHONE, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }, res, env);
  return res;
};
const get = async (url, env, headers = { cookie: `__Host-hq_session=${makeSession('Test Admin', env)}` }) => {
  const res = response();
  await hq({ method: 'GET', url, headers }, res, env);
  return res;
};
const noNetwork = () => { globalThis.fetch = async () => assert.fail('nothing may leave this server in local mode'); };
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)]));

// A store opened first with a test clock; the handlers then find it by folder.
function localStore(now = Date.parse('2026-11-25T18:00:00Z')) {
  const dir = mkdtempSync(join(tmpdir(), 'hbh-analytics-local-'));
  const clock = { t: now };
  const store = openAnalyticsStore({ dir, secret: 'test-secret-for-the-visitor-hash-0123456789', now: () => clock.t, flushIntervalMs: 0 });
  return { dir, clock, store, env: { ANALYTICS_STORE: 'local', ANALYTICS_DIR: dir }, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('/api/track in local mode records here, needs no shared secret, and keeps the same checks', async () => {
  const original = globalThis.fetch;
  const ctx = localStore();
  noNetwork();
  try {
    const sid = randomUUID();
    const pageToken = randomUUID();
    const ok = await post({ sid, type: 'start', path: '/contact?email=private', referrerType: 'search', referrerHost: 'www.google.com', title: 'Contact' }, ctx.env);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.body, { ok: true, stored: true });
    assert.equal(ok.headers['Cache-Control'], 'no-store');
    assert.equal((await post({ sid, type: 'pageview', path: '/contact', pageToken, title: 'Contact' }, ctx.env)).statusCode, 200);
    assert.equal((await post({ sid, type: 'heartbeat', path: '/contact', pageToken, durationSeconds: 33 }, ctx.env)).statusCode, 200);
    assert.equal((await post({ sid, type: 'event', name: 'generate_lead', path: '/contact' }, ctx.env)).statusCode, 200);

    for (const [body, status, why] of [
      [{ sid, type: 'event', name: 'purchase', path: '/' }, 400, 'unknown event name'],
      [{ sid, type: 'event', path: '/' }, 400, 'event without a name'],
      [{ sid, type: 'invented', path: '/' }, 400, 'unknown type'],
      [{ sid, type: 'pageview', path: '/hq' }, 400, 'HQ pages'],
      [{ sid: 'not-a-session', type: 'pageview', path: '/' }, 400, 'bad session id'],
      ['{not json', 400, 'bad JSON'],
      [{ sid: randomUUID(), type: 'heartbeat', path: '/', durationSeconds: 5 }, 202, 'time for a session never started'],
    ]) assert.equal((await post(body, ctx.env)).statusCode, status, why);

    for (const headers of [{ dnt: '1' }, { 'sec-gpc': '1' }, { 'user-agent': GOOGLEBOT }]) {
      const res = await post({ sid: randomUUID(), type: 'start', path: '/', referrerType: 'direct' }, ctx.env, headers);
      assert.equal(res.statusCode, 202, JSON.stringify(headers));
      assert.deepEqual(res.body, { ok: true, stored: false });
    }

    const a = ctx.store.query({ days: 1 });
    assert.equal(a.totals.sessions, 1);
    assert.equal(a.totals.totalDurationSeconds, 33);
    assert.deepEqual(a.events, { formStarts: 0, leads: 1, callClicks: 0, textClicks: 0 });
    assert.deepEqual(a.topPages, [{ key: '/contact', value: 1 }]);
    ctx.store.flush();
    const disk = filesUnder(ctx.dir).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const s of ['192.0.2.8', 'iPhone', 'email=private', 'Contact']) assert.ok(!disk.includes(s), s);
  } finally { globalThis.fetch = original; ctx.done(); }
});

test('/api/track: a store that cannot be written fails visibly; forwarding mode never forwards funnel events', async () => {
  const original = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), 'hbh-analytics-broken-'));
  const errors = [];
  const log = console.error;
  console.error = (line) => errors.push(String(line));
  try {
    writeFileSync(join(dir, 'file'), 'x');
    noNetwork();
    const broken = await post({ sid: randomUUID(), type: 'start', path: '/', referrerType: 'direct' }, { ANALYTICS_STORE: 'local', ANALYTICS_DIR: join(dir, 'file', 'analytics') });
    assert.equal(broken.statusCode, 503);
    assert.ok(errors.some((line) => line.startsWith('[analytics] local store unavailable')));
    assert.ok(errors.every((line) => !line.includes('192.0.2.8') && !line.includes('iPhone')), 'the log names no visitor');

    const shared = { ANALYTICS_STORE: 'shared', CRM_INGEST_SECRET: CRM };
    const skipped = await post({ sid: randomUUID(), type: 'event', name: 'phone_click', path: '/' }, shared);
    assert.equal(skipped.statusCode, 202);
    assert.deepEqual(skipped.body, { ok: true, stored: false });
    assert.equal((await post({ sid: randomUUID(), type: 'event', name: 'nope', path: '/' }, shared)).statusCode, 400);
    assert.equal((await post({ sid: randomUUID(), type: 'start', path: '/' }, { VERCEL: '1' })).statusCode, 503, 'on Vercel without the shared secret nothing changes');
  } finally { globalThis.fetch = original; console.error = log; rmSync(dir, { recursive: true, force: true }); }
});

test('HQ analytics in local mode answers in the panel contract from the local store', async () => {
  const original = globalThis.fetch;
  const ctx = localStore();
  const env = { ...HQ_ENV, ...ctx.env };
  noNetwork();
  try {
    for (const [ip, path] of [['192.0.2.1', '/'], ['192.0.2.2', '/how-it-works']]) {
      const sid = randomUUID();
      await post({ sid, type: 'start', path, referrerType: 'direct' }, env, { 'x-real-ip': ip });
      await post({ sid, type: 'pageview', path, pageToken: randomUUID() }, env, { 'x-real-ip': ip });
      await post({ sid, type: 'event', name: 'lead_form_start', path }, env, { 'x-real-ip': ip });
    }
    assert.equal((await get('/api/hq?action=analytics&days=7&site=call_harbison', env, {})).statusCode, 401);
    const res = await get('/api/hq?action=analytics&days=7&site=call_harbison', env);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.body.ok, true);
    assert.equal(res.body.site, 'call_harbison');
    const a = res.body.analytics;
    assert.deepEqual(Object.keys(a).sort(), ['browsers', 'campaigns', 'cities', 'countries', 'daily', 'devices', 'entryPages', 'events', 'exitPages', 'generatedAt', 'hourly', 'operatingSystems', 'previous', 'range', 'referrerHosts', 'referrers', 'regions', 'site', 'source', 'timezone', 'topPages', 'totals'].sort());
    assert.deepEqual(Object.keys(a.totals).sort(), ['avgDurationSeconds', 'medianDurationSeconds', 'pageViews', 'pagesPerSession', 'sessions', 'totalDurationSeconds', 'uniqueVisitors'].sort());
    assert.equal(a.source, 'local');
    assert.equal(a.timezone, 'America/Los_Angeles');
    assert.deepEqual(a.range, { from: '2026-11-19', to: '2026-11-25', days: 7 });
    assert.equal(a.daily.length, 7);
    assert.deepEqual(Object.keys(a.daily[0]).sort(), ['day', 'leads', 'pageViews', 'sessions', 'visitors']);
    assert.equal(a.totals.sessions, 2);
    assert.equal(a.totals.uniqueVisitors, 2);
    assert.deepEqual(a.events, { formStarts: 2, leads: 0, callClicks: 0, textClicks: 0 });
    assert.equal(a.hourly.length, 24);
    assert.equal(a.previous, null);
    assert.equal((await get('/api/hq?action=analytics&days=9999&site=call_harbison', env)).body.analytics.range.days, 365);
    assert.equal((await get('/api/hq?action=analytics&site=unknown', env)).statusCode, 503, 'other sites still need the shared connection');
    assert.equal((await get('/api/hq?action=analytics&site=harbison_standard', env)).statusCode, 503);
  } finally { globalThis.fetch = original; ctx.done(); }
});

test('the shared source is passed through with its source and time zone named', async () => {
  const original = globalThis.fetch;
  const ctx = localStore();
  try {
    const shared = { site: 'harbison_standard', totals: { sessions: 4 }, daily: [{ day: '2026-11-25', sessions: 4 }], hourlyUtc: [{ hour: 3, value: 4 }] };
    globalThis.fetch = async (url) => {
      assert.equal(String(url), 'https://www.harbisonstandard.com/api/hq/analytics?days=30&site=harbison_standard');
      return Response.json(shared);
    };
    for (const env of [{ ...HQ_ENV, CRM_INGEST_SECRET: CRM }, { ...HQ_ENV, CRM_INGEST_SECRET: CRM, ...ctx.env }]) {
      const res = await get('/api/hq?action=analytics&site=harbison_standard', env);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.analytics, { ...shared, source: 'shared', timezone: 'UTC' });
    }
    globalThis.fetch = async () => Response.json({ ...shared, site: 'call_harbison' });
    for (const env of [{ VERCEL: '1' }, { ANALYTICS_STORE: 'shared' }]) {
      const callHarbison = await get('/api/hq?action=analytics&site=call_harbison', { ...HQ_ENV, CRM_INGEST_SECRET: CRM, ...env });
      assert.equal(callHarbison.body.analytics.source, 'shared', `${JSON.stringify(env)}: this site's numbers stay shared`);
    }
  } finally { globalThis.fetch = original; ctx.done(); }
});

test('server.mjs exports the flush it runs on SIGTERM and SIGINT', () => {
  assert.equal(serverFlush, flushAnalytics);
});

test('the me and sign-in replies say which stats tabs can work', async () => {
  for (const [extra, expected] of [
    [{}, { call_harbison: 'local', harbison_standard: null }],
    [{ CRM_INGEST_SECRET: CRM }, { call_harbison: 'local', harbison_standard: 'shared' }],
    [{ VERCEL: '1' }, { call_harbison: null, harbison_standard: null }],
    [{ VERCEL: '1', CRM_INGEST_SECRET: CRM }, { call_harbison: 'shared', harbison_standard: 'shared' }],
    [{ ANALYTICS_STORE: 'shared', CRM_INGEST_SECRET: CRM }, { call_harbison: 'shared', harbison_standard: 'shared' }],
    [{ VERCEL: '1', ANALYTICS_STORE: 'local', CRM_INGEST_SECRET: CRM }, { call_harbison: 'local', harbison_standard: 'shared' }],
  ]) {
    const env = { ...HQ_ENV, ...extra };
    const me = await get('/api/hq?action=me', env);
    assert.equal(me.statusCode, 200);
    assert.equal(me.body.name, 'Test Admin');
    assert.deepEqual(me.body.analytics, expected, JSON.stringify(extra));
    const res = response();
    await hq({ method: 'POST', url: '/api/hq?action=login', headers: {}, body: { password: HQ_ENV.HQ_PASSWORD, name: 'Nate' } }, res, env);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.analytics, expected);
  }
});
