// static/analytics.js in a fake browser: which hosts it runs on, and that funnel steps leave by name only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const source = await readFile(new URL('../static/analytics.js', import.meta.url), 'utf8');
const storage = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};

function page({ hostname = 'www.callharbison.com', siteHost, consent } = {}) {
  const posts = [];
  const clicks = [];
  const window = { dataLayer: [], addEventListener() {} };
  const document = {
    documentElement: { dataset: siteHost ? { siteHost } : {} },
    referrer: 'https://www.google.com/search?q=sell+my+house+bakersfield',
    title: 'Private page title',
    hidden: false,
    querySelector: () => null,
    addEventListener: (type, fn) => { if (type === 'click') clicks.push(fn); },
  };
  const context = {
    window, document, location: { hostname, pathname: '/contact' }, navigator: {},
    localStorage: storage(consent ? { 'hbh-consent': JSON.stringify({ value: consent, at: Date.now() }) } : {}),
    sessionStorage: storage(), crypto: { randomUUID }, URL, setInterval: () => 1, clearInterval() {},
    fetch: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true, stored: true }); },
  };
  context.addEventListener = window.addEventListener;
  vm.runInNewContext(source, context);
  return { posts, window, click: (target) => clicks.forEach((fn) => fn({ target })), settle: () => new Promise((done) => setTimeout(done, 5)) };
}

test('runs on the host named by the build and its www/apex twin, keeping the two original hosts', async () => {
  for (const [options, runs] of [
    [{ hostname: 'www.callharbison.com' }, true],
    [{ hostname: 'callharbison.com' }, true],
    [{ hostname: 'www.example.org', siteHost: 'www.example.org' }, true],
    [{ hostname: 'example.org', siteHost: 'www.example.org' }, true],
    [{ hostname: 'www.example.org', siteHost: 'example.org' }, true],
    [{ hostname: 'callharbison.com', siteHost: 'www.example.org' }, true],
    [{ hostname: 'evil.example', siteHost: 'www.example.org' }, false],
    [{ hostname: 'localhost' }, false],
  ]) {
    const p = page(options);
    await p.settle();
    assert.equal(p.posts.length > 0, runs, JSON.stringify(options));
  }
});

test('funnel steps are sent once per page, by name only, and the dataLayer keeps working', async () => {
  const p = page();
  await p.settle();
  assert.deepEqual(p.posts.map((x) => x.body.type), ['start', 'pageview']);
  assert.equal(p.posts[0].body.referrerType, 'search');
  const before = p.posts.length;
  const layer = p.window.dataLayer;
  assert.equal(layer.push({ event: 'lead_form_start', form_type: 'options', page_path: '/contact' }), 1, 'push still returns the new length');
  layer.push({ event: 'lead_form_start', form_type: 'options' });
  layer.push({ event: 'lead_form_step_complete', step: 2 }, { event: 'generate_lead', qualification: 'unqualified', name: 'Jane Doe' });
  layer.push({ event: 'cta_click', cta: 'mobile_bar' });
  layer.push({ event: 'cta_click', cta: 'handoff_sms', route_interest: 'direct' });
  layer.push({ event: 'phone_click' });
  layer.push(['gtag', 'arguments'], null, 7);
  p.click({ closest: (selector) => (selector.includes('sms:') ? {} : null) }); // a text link: already counted on this page
  await p.settle();
  assert.equal(layer.length, 10, 'every item still reaches the dataLayer');
  const events = p.posts.slice(before).map((x) => x.body);
  assert.deepEqual(events.map((e) => e.name), ['lead_form_start', 'generate_lead', 'text_click', 'phone_click']);
  for (const e of events) assert.deepEqual(Object.keys(e).sort(), ['name', 'pageToken', 'path', 'sid', 'type']);
  const sent = JSON.stringify(p.posts);
  for (const s of ['Private page title', 'Jane Doe', 'options', 'handoff_sms', 'sell+my+house']) assert.ok(!sent.includes(s), s);

  const q = page();
  q.click({ closest: (selector) => (selector.includes('sms:') ? {} : null) });
  q.click({ closest: () => null });
  await q.settle();
  assert.deepEqual(q.posts.filter((x) => x.body.type === 'event').map((x) => x.body.name), ['text_click']);
});

test('a declined consent banner stops everything, including the funnel', async () => {
  const p = page({ consent: 'denied' });
  p.window.dataLayer.push({ event: 'generate_lead' });
  await p.settle();
  assert.equal(p.posts.length, 0);
  assert.equal(p.window.dataLayer.push, Array.prototype.push, 'the dataLayer is left alone');
});
