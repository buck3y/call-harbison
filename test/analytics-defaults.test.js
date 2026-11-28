// Google Analytics and Metricool load only with the owner's own IDs, except on Vercel (VERCEL set), which keeps the
// built-in defaults as before. ANALYTICS_DEFAULTS=on or =off overrides either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveGaId, resolveMetricoolHash, trackerIds } from '../site.config.mjs';

const DEFAULT_GA = 'G-SN1ZWS50M7';
const DEFAULT_METRICOOL = '398cd80eb0d6d2a7ebd652d00db3bb8';

test('the Metricool hash is validated like the GA and GTM IDs', () => {
  assert.equal(resolveMetricoolHash('0123456789ABCDEF0123'), '0123456789abcdef0123');
  assert.equal(resolveMetricoolHash('  0123456789abcdef0123  '), '0123456789abcdef0123');
  for (const bad of ['', undefined, 'METRICOOL_HASH', 'xxxxxxxxxxxxxxxxxxxx', '0123', '"/><script>']) assert.equal(resolveMetricoolHash(bad), DEFAULT_METRICOOL, String(bad));
  assert.equal(resolveMetricoolHash('nope', ''), '');
});

test('no built-in IDs off Vercel; Vercel keeps them; ANALYTICS_DEFAULTS overrides both ways', () => {
  assert.deepEqual(trackerIds({}), { gaId: '', metricoolHash: '' });
  assert.deepEqual(trackerIds({ GA_MEASUREMENT_ID: 'G-OWNER12345' }), { gaId: 'G-OWNER12345', metricoolHash: '' });
  assert.deepEqual(trackerIds({ VERCEL: '1' }), { gaId: DEFAULT_GA, metricoolHash: DEFAULT_METRICOOL });
  assert.deepEqual(trackerIds({ VERCEL: '1', ANALYTICS_DEFAULTS: 'off' }), { gaId: '', metricoolHash: '' });
  assert.deepEqual(trackerIds({ ANALYTICS_DEFAULTS: 'on' }), { gaId: DEFAULT_GA, metricoolHash: DEFAULT_METRICOOL });
  assert.deepEqual(trackerIds({ ANALYTICS_DEFAULTS: 'off' }), { gaId: '', metricoolHash: '' });
  assert.deepEqual(trackerIds({ ANALYTICS_DEFAULTS: 'off', GA_MEASUREMENT_ID: 'G-XXXXXXX', METRICOOL_HASH: 'METRICOOL_HASH' }), { gaId: '', metricoolHash: '' });
  assert.deepEqual(trackerIds({ ANALYTICS_DEFAULTS: 'off', GA_MEASUREMENT_ID: 'G-OWNER12345', METRICOOL_HASH: '0123456789abcdef0123' }), { gaId: 'G-OWNER12345', metricoolHash: '0123456789abcdef0123' });
  assert.equal(resolveGaId('', ''), '');
});

// The setting is read when the build starts, so each case renders the home page in its own process.
const render = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', [
  "import { homePage } from './src/templates.mjs';",
  'const h = homePage();',
  "const pick = (re) => (h.match(re) || [])[1] || '';",
  "process.stdout.write(JSON.stringify({ ga: pick(/gtag\\('config','([^']+)'/), gtagJs: h.includes('googletagmanager.com/gtag/js'), metricool: pick(/beTracker\\.t\\(\\{hash:\"([^\"]+)\"/), metricoolScript: h.includes('tracker.metricool.com'), host: pick(/<html [^>]*data-site-host=\"([^\"]+)\"/) }));",
].join('\n')], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, VERCEL: '', ANALYTICS_DEFAULTS: '', GA_MEASUREMENT_ID: '', METRICOOL_HASH: '', GTM_ID: '', SITE_URL: '', ...env },
}).toString());

test('the pages follow the setting', () => {
  const none = { ga: '', gtagJs: false, metricool: '', metricoolScript: false, host: 'www.callharbison.com' };
  assert.deepEqual(render({}), none, 'a server build with no IDs loads no third-party tracker');
  assert.deepEqual(render({ VERCEL: '1' }), { ga: DEFAULT_GA, gtagJs: true, metricool: DEFAULT_METRICOOL, metricoolScript: true, host: 'www.callharbison.com' });
  assert.deepEqual(render({ VERCEL: '1', ANALYTICS_DEFAULTS: 'off' }), none);
  assert.deepEqual(render({ ANALYTICS_DEFAULTS: 'off', GA_MEASUREMENT_ID: 'G-OWNER12345', METRICOOL_HASH: '0123456789abcdef0123', SITE_URL: 'example.org' }),
    { ga: 'G-OWNER12345', gtagJs: true, metricool: '0123456789abcdef0123', metricoolScript: true, host: 'www.example.org' });
});
