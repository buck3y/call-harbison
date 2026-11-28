import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8')
);

test('the misspelled contact-us path redirects to the real contact page', () => {
  const redirects = config.redirects || [];
  const hit = redirects.find((r) => r.source === '/contact-us');
  assert.ok(hit, '/contact-us must redirect, otherwise it 404s for anyone typing or linking it');
  assert.equal(hit.destination, '/contact');
});

test('every redirect points at a destination that is not itself redirected', () => {
  const destinations = new Set((config.redirects || []).map((r) => r.destination));
  for (const r of config.redirects || []) {
    assert.ok(!destinations.has(r.source), `${r.source} redirects into another redirect: ${r.destination}`);
  }
});

test('security headers are set on every response', () => {
  const catchAll = (config.headers || []).find((h) => h.source === '/(.*)');
  assert.ok(catchAll, 'a catch-all header rule must exist');
  const keys = new Set(catchAll.headers.map((h) => h.key.toLowerCase()));
  for (const required of ['x-content-type-options', 'referrer-policy', 'x-frame-options']) {
    assert.ok(keys.has(required), `missing ${required} on the catch-all rule`);
  }
});

// The enforcing policy for the public pages is built from the pages (dist/csp.json, test/csp.test.js) and sent by
// server.mjs, which drops this report-only one. It stays here for hosts that only read vercel.json (Vercel, during the
// move) and for a build without csp.json, and it names no whole scheme, so its reports show anything unexpected.
test('a report-only Content-Security-Policy is the fallback, without a blanket source', () => {
  const catchAll = (config.headers || []).find((h) => h.source === '/(.*)');
  const csp = catchAll.headers.find((h) => h.key.toLowerCase() === 'content-security-policy-report-only');
  assert.ok(csp, 'the fallback report-only policy is present');
  assert.match(csp.value, /report-uri \/csp-report/);
  for (const source of csp.value.split(/[\s;]+/)) assert.ok(!['*', 'https:', 'http:', 'blob:'].includes(source), source);
});

test('every response opens no window to other sites and turns off the browser features the site never uses', () => {
  const byKey = Object.fromEntries((config.headers || []).find((h) => h.source === '/(.*)').headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(byKey['cross-origin-opener-policy'], 'same-origin');
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial', 'hid', 'bluetooth', 'midi', 'display-capture', 'browsing-topics']) {
    assert.match(byKey['permissions-policy'], new RegExp(`(^|, )${feature}=\\(\\)`), feature);
  }
  const everyKey = (config.headers || []).flatMap((h) => h.headers.map((x) => x.key.toLowerCase()));
  assert.ok(!everyKey.includes('cross-origin-embedder-policy'), 'COEP would block the stock photos and the analytics tools');
});

test('the hq dashboard stays uncached, noindex and unframeable, and runs only its own files', () => {
  const hq = (config.headers || []).find((h) => h.source === '/hq(.*)');
  assert.ok(hq, '/hq must have its own header rule');
  const byKey = Object.fromEntries(hq.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(byKey['x-robots-tag'], 'noindex, nofollow');
  assert.equal(byKey['cache-control'], 'no-store');
  assert.equal(byKey['x-frame-options'], 'DENY');
  assert.equal(byKey['content-security-policy'], "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  assert.equal(byKey['referrer-policy'], 'no-referrer');
  assert.equal(byKey['cross-origin-resource-policy'], 'same-origin');
  const order = (config.headers || []).map((h) => h.source);
  assert.ok(order.indexOf('/hq(.*)') > order.indexOf('/(.*)'), 'the /hq rule comes after the catch-all, so its values win');
});

test('API answers can be neither framed nor read by other sites', () => {
  const api = (config.headers || []).find((h) => h.source === '/api/(.*)');
  assert.ok(api, '/api/(.*) must have its own header rule');
  const byKey = Object.fromEntries(api.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(byKey['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
  assert.equal(byKey['cross-origin-resource-policy'], 'same-origin');
});