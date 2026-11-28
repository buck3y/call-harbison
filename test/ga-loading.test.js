import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// gtag.js (~177 KB) was the largest main-thread cost on phones. It must not be fetched during page load.
// Google Analytics is in the pages of a Vercel build (built-in property) or of any build with GA_MEASUREMENT_ID;
// site.config.mjs reads that at import, so each build renders in its own process.
const render = (env) => execFileSync(process.execPath, ['--input-type=module', '-e', "import { homePage } from './src/templates.mjs'; process.stdout.write(homePage());"], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, VERCEL: '', ANALYTICS_DEFAULTS: '', GA_MEASUREMENT_ID: '', ...env },
}).toString();
const site = { gaId: 'G-SN1ZWS50M7' };
const html = render({ VERCEL: '1' });
const headStart = html.slice(html.indexOf('<head>'), html.indexOf('<head>') + 3000);

test('a server build without GA_MEASUREMENT_ID has no Google Analytics; with it, the owner\'s property loads', () => {
  const plain = render({});
  assert.doesNotMatch(plain, /googletagmanager|gtag\(/);
  assert.match(render({ GA_MEASUREMENT_ID: 'G-OWNER12345' }), /gtag\('config','G-OWNER12345',\{/);
});

test('gtag.js is not requested by a script tag in the page source', () => {
  assert.doesNotMatch(html, /<script[^>]+src="https:\/\/www\.googletagmanager\.com\/gtag\/js/);
});

test('the gtag() stub and config still run first, right after <head>', () => {
  assert.match(headStart, /window\.dataLayer=window\.dataLayer\|\|\[\];function gtag\(\)\{dataLayer\.push\(arguments\)\}/);
  assert.match(headStart, new RegExp(`gtag\\('config','${site.gaId}',\\{`));
});

test('gtag.js is loaded on first interaction or shortly after the load event', () => {
  assert.match(headStart, new RegExp(`googletagmanager\\.com/gtag/js\\?id=${site.gaId}`));
  for (const evt of ['pointerdown', 'keydown', 'touchstart', 'scroll']) assert.match(headStart, new RegExp(`'${evt}'`));
  assert.match(headStart, /addEventListener\('load'/);
});
