import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  openAnalyticsStore, getAnalyticsStore, flushAnalytics, analyticsDir, analyticsSources, classifyUserAgent, cleanPath,
  medianFromHistogram, DURATION_BUCKETS,
} from '../lib/analytics-store.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.106;FBBV/1]',
  cubot: 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
  curl: 'curl/8.5.0',
};

// 10:00 in Bakersfield on 25 November 2026 (PST, UTC-8).
const LA_10AM = Date.parse('2026-11-25T18:00:00Z');
const DAY_MS = 864e5;

function setup({ start = LA_10AM, secret = 'test-secret-for-the-visitor-hash-0123456789' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hbh-analytics-'));
  const clock = { t: start };
  const open = (extra = {}) => openAnalyticsStore({ dir, secret, now: () => clock.t, flushIntervalMs: 0, ...extra });
  const ctx = { dir, clock, open, store: open() };
  ctx.done = () => { try { ctx.store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); };
  return ctx;
}

// One browser session as static/analytics.js sends it: start, then a page view and running-total heartbeats per page.
function visit(store, { sid = randomUUID(), ip = '198.51.100.1', ua = UA.iphone, referrerType = 'direct', referrerHost, pages = ['/'], seconds = [], events = [] } = {}) {
  const client = { ip, userAgent: ua };
  store.record({ sid, type: 'start', path: pages[0], referrerType, referrerHost }, client);
  pages.forEach((path, i) => {
    const pageToken = randomUUID();
    store.record({ sid, type: 'pageview', path, pageToken, title: 'Page title' }, client);
    if (seconds[i] != null) for (const s of [Math.floor(seconds[i] / 2), seconds[i]]) store.record({ sid, type: 'heartbeat', path, pageToken, durationSeconds: s }, client);
  });
  for (const name of events) store.record({ sid, type: 'event', name, path: pages.at(-1) }, client);
  return sid;
}

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)]));
const everything = (dir) => filesUnder(dir).map((f) => readFileSync(f, 'utf8')).join('\n');
const pairs = (list) => Object.fromEntries(list.map(({ key, value }) => [key, value]));

test('sessions, visitors, entry and exit pages, sources, devices and hours', () => {
  const ctx = setup();
  try {
    const { store } = ctx;
    visit(store, { ip: '198.51.100.1', ua: UA.iphone, referrerType: 'search', referrerHost: 'www.google.com', pages: ['/', '/how-it-works', '/contact'] });
    visit(store, { ip: '198.51.100.2', ua: UA.windows, pages: ['/situations/inherited-property', '/'] });
    visit(store, { ip: '198.51.100.1', ua: UA.android, referrerType: 'social', referrerHost: 'l.facebook.com', pages: ['/'] });
    const a = store.query({ days: 7 });
    assert.equal(a.site, 'call_harbison');
    assert.equal(a.source, 'local');
    assert.equal(a.timezone, 'America/Los_Angeles');
    assert.equal(a.generatedAt, new Date(LA_10AM).toISOString());
    assert.deepEqual(a.range, { from: '2026-11-19', to: '2026-11-25', days: 7 });
    assert.equal(a.totals.sessions, 3);
    assert.equal(a.totals.uniqueVisitors, 2, 'two sessions from one address on one day are one visitor');
    assert.equal(a.totals.pageViews, 6);
    assert.equal(a.totals.pagesPerSession, 2);
    assert.deepEqual(a.entryPages, [{ key: '/', value: 2 }, { key: '/situations/inherited-property', value: 1 }]);
    assert.deepEqual(a.exitPages, [{ key: '/', value: 2 }, { key: '/contact', value: 1 }]);
    assert.deepEqual(a.topPages[0], { key: '/', value: 3 });
    assert.equal(a.topPages.length, 4);
    assert.deepEqual(a.referrers, [{ key: 'direct', value: 1 }, { key: 'search', value: 1 }, { key: 'social', value: 1 }]);
    assert.deepEqual(pairs(a.referrerHosts), { 'google.com': 1, 'l.facebook.com': 1 });
    assert.deepEqual(a.devices, [{ key: 'Mobile', value: 2 }, { key: 'Desktop', value: 1 }]);
    assert.deepEqual(pairs(a.browsers), { Chrome: 2, Safari: 1 });
    assert.deepEqual(pairs(a.operatingSystems), { iOS: 1, Windows: 1, Android: 1 });
    assert.equal(a.hourly.length, 24);
    assert.deepEqual(a.hourly[10], { hour: 10, value: 3 }, 'hours are Bakersfield time');
    assert.equal(a.hourly.reduce((n, h) => n + h.value, 0), 3);
    assert.equal(a.daily.length, 7, 'every day in the range, zeros included');
    assert.deepEqual(a.daily.at(-1), { day: '2026-11-25', sessions: 3, pageViews: 6, visitors: 2, leads: 0 });
    assert.deepEqual(a.daily[0], { day: '2026-11-19', sessions: 0, pageViews: 0, visitors: 0, leads: 0 });
    for (const key of ['campaigns', 'countries', 'regions', 'cities']) assert.deepEqual(a[key], [], key);
    assert.equal(a.previous, null, 'nothing was recorded before this store started');
  } finally { ctx.done(); }
});

test('durations: the largest running total per page, summed per session, capped at 1800 seconds', () => {
  const ctx = setup();
  try {
    const { store } = ctx;
    const sid = randomUUID();
    const client = { ip: '198.51.100.3', userAgent: UA.mac };
    const [p1, p2] = [randomUUID(), randomUUID()];
    store.record({ sid, type: 'start', path: '/', referrerType: 'direct' }, client);
    store.record({ sid, type: 'pageview', path: '/', pageToken: p1 }, client);
    for (const s of [10, 25, 10]) store.record({ sid, type: 'heartbeat', path: '/', pageToken: p1, durationSeconds: s }, client);
    store.record({ sid, type: 'pageview', path: '/contact', pageToken: p2 }, client);
    for (const s of [5, 40]) store.record({ sid, type: 'heartbeat', path: '/contact', pageToken: p2, durationSeconds: s }, client);
    visit(store, { ip: '198.51.100.4', pages: ['/', '/about'], seconds: [1800, 99999] });
    visit(store, { ip: '198.51.100.5', pages: ['/'] });
    assert.equal(store.record({ sid: randomUUID(), type: 'heartbeat', path: '/', durationSeconds: 30 }, client).stored, false, 'time alone does not open a session');
    const { totals } = store.query({ days: 1 });
    assert.equal(totals.sessions, 3);
    assert.equal(totals.totalDurationSeconds, 65 + 1800 + 0);
    assert.equal(totals.avgDurationSeconds, Math.round(1865 / 3));
    assert.equal(totals.medianDurationSeconds, 75, '65 s falls in the 60-90 s bucket and is the middle session');
  } finally { ctx.done(); }
});

test('the median is estimated from the daily histograms across days', () => {
  const ctx = setup();
  try {
    for (let i = 0; i < 4; i += 1) visit(ctx.store, { ip: `198.51.100.${10 + i}`, seconds: [30] });
    ctx.clock.t += DAY_MS;
    visit(ctx.store, { ip: '198.51.100.20', seconds: [600] });
    const { totals } = ctx.store.query({ days: 2 });
    assert.equal(totals.sessions, 5);
    assert.ok(totals.medianDurationSeconds >= 20 && totals.medianDurationSeconds <= 30, `median ${totals.medianDurationSeconds} lies in the 20-30 s bucket`);
    assert.equal(medianFromHistogram(DURATION_BUCKETS.map(() => 0)), 0);
    assert.equal(medianFromHistogram([3, ...DURATION_BUCKETS.slice(1).map(() => 0)]), 0);
  } finally { ctx.done(); }
});

test('funnel steps count once per session, by name only, from an allowlist', () => {
  const ctx = setup();
  try {
    const { store } = ctx;
    visit(store, { ip: '198.51.100.1', events: ['lead_form_start', 'lead_form_start', 'generate_lead', 'phone_click', 'phone_click', 'phone_click'] });
    visit(store, { ip: '198.51.100.2', ua: UA.android, events: ['text_click'] });
    const client = { ip: '198.51.100.3', userAgent: UA.iphone };
    assert.equal(store.record({ sid: randomUUID(), type: 'event', name: 'purchase', path: '/' }, client).stored, false);
    assert.equal(store.record({ sid: randomUUID(), type: 'event', name: ['generate_lead'], path: '/' }, client).stored, false);
    // An event sent at once can arrive before the session's start, which was queued behind another request.
    const late = randomUUID();
    assert.equal(store.record({ sid: late, type: 'event', name: 'phone_click', path: '/' }, client).stored, true);
    store.record({ sid: late, type: 'start', path: '/', referrerType: 'search', referrerHost: 'bing.com' }, client);
    store.record({ sid: late, type: 'pageview', path: '/', pageToken: randomUUID() }, client);
    const a = store.query({ days: 1 });
    assert.deepEqual(a.events, { formStarts: 1, leads: 1, callClicks: 2, textClicks: 1 });
    assert.equal(a.daily.at(-1).leads, 1);
    assert.equal(a.totals.sessions, 3);
    assert.equal(pairs(a.referrers).search, 1, 'a start that arrives late still fills in the source');
    assert.equal(pairs(a.entryPages)['/'], 3);
  } finally { ctx.done(); }
});

test('robots are ignored; people on unusual phones are not', () => {
  const ctx = setup();
  try {
    for (const ua of [UA.googlebot, UA.headless, UA.curl, '', 'Mozilla/5.0']) {
      assert.equal(ctx.store.record({ sid: randomUUID(), type: 'start', path: '/', referrerType: 'direct' }, { ip: '198.51.100.9', userAgent: ua }).stored, false, ua || '(empty)');
    }
    assert.equal(ctx.store.query({ days: 1 }).totals.sessions, 0);
    assert.equal(classifyUserAgent(UA.cubot).robot, false);
    assert.deepEqual(classifyUserAgent(UA.ipad), { robot: false, device: 'Tablet', browser: 'Safari', os: 'iOS' });
    assert.deepEqual(classifyUserAgent(UA.samsung), { robot: false, device: 'Mobile', browser: 'Samsung Internet', os: 'Android' });
    assert.deepEqual(classifyUserAgent(UA.edge), { robot: false, device: 'Desktop', browser: 'Edge', os: 'Windows' });
    assert.deepEqual(classifyUserAgent(UA.firefox), { robot: false, device: 'Desktop', browser: 'Firefox', os: 'Linux' });
    assert.deepEqual(classifyUserAgent(UA.facebook), { robot: false, device: 'Mobile', browser: 'In-app browser', os: 'iOS' });
    assert.deepEqual(classifyUserAgent(UA.mac), { robot: false, device: 'Desktop', browser: 'Safari', os: 'macOS' });
    assert.deepEqual(classifyUserAgent('Mozilla/5.0 (PlayStation 5) Something/1.0'), { robot: false, device: 'Desktop', browser: 'Other', os: 'Other' });
  } finally { ctx.done(); }
});

test('paths lose their query and fragment, stay short, and never include HQ or the API', () => {
  assert.equal(cleanPath('/contact?email=a%40b.c#top'), '/contact');
  assert.equal(cleanPath(`/${'a'.repeat(400)}`).length, 300);
  for (const bad of ['/hq', '/hq/leads', '/HQ', '/api/track', '//evil.example', 'https://evil.example/', '', null, 7]) assert.equal(cleanPath(bad), null, String(bad));
  assert.equal(cleanPath('/jane.doe@example.com'), '(other)', 'text a visitor typed into the address bar is not kept');
  assert.equal(cleanPath('/123%20Main%20St'), '(other)');
  assert.equal(cleanPath('/es/situations/inherited-property'), '/es/situations/inherited-property');
  const ctx = setup();
  try {
    assert.equal(ctx.store.record({ sid: randomUUID(), type: 'pageview', path: '/hq' }, { ip: '198.51.100.1', userAgent: UA.iphone }).stored, false);
  } finally { ctx.done(); }
});

test('a finished day is compacted to counters; its sessions and visitor hashes are deleted', () => {
  const ctx = setup();
  try {
    const first = [visit(ctx.store, { ip: '198.51.100.1', pages: ['/', '/contact'], events: ['lead_form_start', 'generate_lead'] }), visit(ctx.store, { ip: '198.51.100.2', ua: UA.windows })];
    ctx.store.flush();
    const live1 = JSON.parse(readFileSync(join(ctx.dir, 'live.json'), 'utf8'));
    assert.equal(live1.day, '2026-11-25');
    assert.deepEqual(Object.keys(live1.sessions).sort(), [...first].sort());
    const hashes = Object.values(live1.sessions).map((row) => row.visitor);
    assert.ok(hashes.every((h) => /^[a-f0-9]{16}$/.test(h)));

    ctx.clock.t = Date.parse('2026-11-26T17:00:00Z'); // 09:00 the next day in Bakersfield
    visit(ctx.store, { ip: '198.51.100.3' });
    const summaryText = readFileSync(join(ctx.dir, 'days', '2026-11-25.json'), 'utf8');
    const summary = JSON.parse(summaryText);
    assert.equal(summary.day, '2026-11-25');
    assert.equal(summary.sessions, 2);
    assert.equal(summary.visitors, 2);
    assert.equal(summary.pageViews, 3);
    assert.deepEqual(summary.events, { formStarts: 1, leads: 1, callClicks: 0, textClicks: 0 });
    assert.deepEqual(Object.keys(summary).sort(), ['browsers', 'day', 'devices', 'durationSeconds', 'durations', 'entryPages', 'events', 'exitPages', 'hours', 'operatingSystems', 'pageViews', 'pages', 'referrerHosts', 'referrers', 'sessions', 'version', 'visitors'].sort());
    for (const secret of [...first, ...hashes]) assert.ok(!everything(ctx.dir).includes(secret), `${secret} is gone from the folder`);
    ctx.store.flush();
    const live2 = JSON.parse(readFileSync(join(ctx.dir, 'live.json'), 'utf8'));
    assert.equal(live2.day, '2026-11-26');
    assert.equal(Object.keys(live2.sessions).length, 1);

    const a = ctx.store.query({ days: 2 });
    assert.deepEqual(a.daily, [{ day: '2026-11-25', sessions: 2, pageViews: 3, visitors: 2, leads: 1 }, { day: '2026-11-26', sessions: 1, pageViews: 1, visitors: 1, leads: 0 }]);
    assert.equal(a.totals.uniqueVisitors, 3, 'visitor hashes change daily, so a range adds the days');

    // A day that ends with no traffic is compacted by the next timer tick (flush), not left in detail.
    ctx.clock.t = Date.parse('2026-11-27T08:00:05Z'); // 00:00:05 on the 27th
    ctx.store.flush();
    assert.ok(existsSync(join(ctx.dir, 'days', '2026-11-26.json')));
    assert.equal(Object.keys(JSON.parse(readFileSync(join(ctx.dir, 'live.json'), 'utf8')).sessions).length, 0);
  } finally { ctx.done(); }
});

test('a restart loses nothing that was flushed, continues open sessions, and compacts a day it slept through', () => {
  const ctx = setup();
  try {
    const sid = visit(ctx.store, { pages: ['/'] });
    visit(ctx.store, { ip: '198.51.100.2', ua: UA.windows, pages: ['/about'] });
    ctx.store.close(); // close() flushes, as server.mjs does on SIGTERM
    ctx.store = ctx.open();
    assert.equal(ctx.store.query({ days: 1 }).totals.sessions, 2);
    ctx.store.record({ sid, type: 'pageview', path: '/contact', pageToken: randomUUID() }, { ip: '198.51.100.1', userAgent: UA.iphone });
    let a = ctx.store.query({ days: 1 });
    assert.equal(a.totals.sessions, 2, 'the same session, not a new one');
    assert.equal(pairs(a.exitPages)['/contact'], 1);
    assert.equal(a.totals.pageViews, 3);
    ctx.store.close();

    ctx.clock.t += 2 * DAY_MS; // the server was down for two days
    ctx.store = ctx.open();
    assert.ok(existsSync(join(ctx.dir, 'days', '2026-11-25.json')));
    a = ctx.store.query({ days: 3 });
    assert.deepEqual(a.daily.map((d) => d.sessions), [2, 0, 0]);
    assert.equal(a.daily[0].pageViews, 3);
    assert.equal(ctx.store.day, '2026-11-27');
    assert.throws(() => ctx.open(), /already open/);
  } finally { ctx.done(); }
});

test('privacy: no IP address, user agent, query string, title or form field reaches the disk', () => {
  const ctx = setup({ secret: '' }); // no ANALYTICS_SECRET: a random one is created and kept with mode 0600
  try {
    const ip = '203.0.113.77';
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 PrivacyCanary/4.2';
    const client = { ip, userAgent: ua };
    const sids = [randomUUID(), randomUUID()];
    for (const sid of sids) {
      const pageToken = randomUUID();
      const extra = { title: 'Private page title', name: 'Jane Doe', email: 'jane@example.com', phone: '6615550100', address: '12 Synthetic Rd', utm_source: 'secretcampaign' };
      ctx.store.record({ sid, type: 'start', path: '/contact?email=jane%40example.com&phone=6615550100#form', referrerType: 'referral', referrerHost: 'partner.example', ...extra }, client);
      ctx.store.record({ sid, type: 'pageview', path: '/contact?email=jane%40example.com&phone=6615550100#form', pageToken, ...extra }, client);
      ctx.store.record({ sid, type: 'heartbeat', path: '/contact?q=1', pageToken, durationSeconds: 12, ...extra }, client);
      ctx.store.record({ sid, type: 'event', name: 'generate_lead', path: '/contact?email=x', ...extra }, client);
    }
    const forbidden = [ip, ua, 'PrivacyCanary', 'Mozilla', 'X11', 'email=', 'jane', 'Jane Doe', '6615550100', 'Synthetic Rd', 'Private page title', 'secretcampaign', '?', '#form'];
    const check = (when) => { const text = everything(ctx.dir); for (const s of forbidden) assert.ok(!text.includes(s), `${when}: "${s}" must not be on disk`); };
    ctx.store.flush();
    check('during the day');
    const secret = join(ctx.dir, 'secret');
    assert.equal(statSync(secret).mode & 0o777, 0o600);
    assert.match(readFileSync(secret, 'utf8'), /^[a-f0-9]{64}\n$/);
    const hashes = Object.values(JSON.parse(readFileSync(join(ctx.dir, 'live.json'), 'utf8')).sessions).map((row) => row.visitor);
    assert.equal(new Set(hashes).size, 1);

    ctx.clock.t += DAY_MS; // the simulated day ends
    ctx.store.flush();
    check('after compaction');
    const text = everything(ctx.dir);
    for (const s of [...sids, ...hashes]) assert.ok(!text.includes(s), `${s} is deleted with its day`);
    assert.deepEqual(filesUnder(ctx.dir).map((f) => f.slice(ctx.dir.length)).sort(), ['/days/2026-11-25.json', '/live.json', '/meta.json', '/secret']);
    const summary = JSON.parse(readFileSync(join(ctx.dir, 'days', '2026-11-25.json'), 'utf8'));
    assert.equal(summary.sessions, 2);
    assert.deepEqual(summary.pages, { '/contact': 2 });
  } finally { ctx.done(); }
});

test('previous period: the same number of days just before, once the store covers it', () => {
  const ctx = setup({ start: Date.parse('2026-11-20T18:00:00Z') });
  try {
    visit(ctx.store, { ip: '198.51.100.1', events: ['generate_lead'] });
    ctx.clock.t = Date.parse('2026-11-22T18:00:00Z');
    visit(ctx.store, { ip: '198.51.100.2' });
    visit(ctx.store, { ip: '198.51.100.3' });
    ctx.clock.t = Date.parse('2026-11-23T18:00:00Z');
    visit(ctx.store, { ip: '198.51.100.4' });
    const two = ctx.store.query({ days: 2 });
    assert.deepEqual(two.range, { from: '2026-11-22', to: '2026-11-23', days: 2 });
    assert.equal(two.totals.sessions, 3);
    assert.deepEqual(two.previous, { sessions: 1, uniqueVisitors: 1, pageViews: 1, leads: 1 });
    assert.equal(ctx.store.query({ days: 3 }).previous, null, 'the 3 days before 21 November predate the store');
    assert.equal(ctx.store.query({ days: 9999 }).range.days, 365);
    assert.equal(ctx.store.query({ days: 0 }).range.days, 30);
  } finally { ctx.done(); }
});

test('lists are sorted largest first and hold at most 25 entries', () => {
  const ctx = setup();
  try {
    for (let i = 0; i < 30; i += 1) visit(ctx.store, { ip: `198.51.100.${i}`, pages: Array.from({ length: (i % 5) + 1 }, () => `/page-${i}`) });
    const { topPages, entryPages } = ctx.store.query({ days: 1 });
    assert.equal(topPages.length, 25);
    assert.equal(entryPages.length, 25);
    for (let i = 1; i < topPages.length; i += 1) assert.ok(topPages[i - 1].value >= topPages[i].value);
    assert.equal(topPages[0].value, 5);
  } finally { ctx.done(); }
});

test('settings: where the data lives, which sources HQ can show, and the shutdown flush', () => {
  assert.equal(analyticsDir({ ANALYTICS_DIR: '/srv/x' }), '/srv/x');
  assert.equal(analyticsDir({ STATE_DIRECTORY: '/var/lib/call-harbison' }), '/var/lib/call-harbison/analytics');
  assert.equal(analyticsDir({ STATE_DIRECTORY: '/var/lib/a:/var/lib/b' }), '/var/lib/a/analytics');
  assert.equal(analyticsDir({}), join(process.cwd(), '.data', 'analytics'));
  assert.deepEqual(analyticsSources({}), { call_harbison: 'local', harbison_standard: null }, 'off Vercel, local is the default');
  assert.deepEqual(analyticsSources({ VERCEL: '1' }), { call_harbison: null, harbison_standard: null });
  assert.deepEqual(analyticsSources({ VERCEL: '1', CRM_INGEST_SECRET: 's' }), { call_harbison: 'shared', harbison_standard: 'shared' });
  assert.deepEqual(analyticsSources({ ANALYTICS_STORE: 'shared', CRM_INGEST_SECRET: 's' }), { call_harbison: 'shared', harbison_standard: 'shared' });
  assert.deepEqual(analyticsSources({ ANALYTICS_STORE: 'local' }), { call_harbison: 'local', harbison_standard: null });
  assert.deepEqual(analyticsSources({ ANALYTICS_STORE: 'local', CRM_INGEST_SECRET: 's' }), { call_harbison: 'local', harbison_standard: 'shared' });

  const dir = mkdtempSync(join(tmpdir(), 'hbh-analytics-'));
  try {
    const env = { ANALYTICS_STORE: 'local', ANALYTICS_DIR: dir, ANALYTICS_SECRET: 'a-secret-from-the-environment-0123456789' };
    const store = getAnalyticsStore(env);
    assert.equal(getAnalyticsStore(env), store, 'one store per folder per process');
    assert.equal(existsSync(join(dir, 'secret')), false, 'ANALYTICS_SECRET is used instead of a file');
    visit(store, {});
    const onDisk = () => Object.keys(JSON.parse(readFileSync(join(dir, 'live.json'), 'utf8')).sessions).length;
    assert.equal(onDisk(), 0, 'not on disk until a flush');
    assert.equal(flushAnalytics(), true);
    assert.equal(onDisk(), 1);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
