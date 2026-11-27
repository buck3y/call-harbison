// The privacy page and the cookie banner name only the third-party tools the build actually loads.
// site.config.mjs reads the environment when it is imported, so each build is rendered in its own process
// (as in test/analytics-defaults.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const render = (env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', [
  "import site from './site.config.mjs';",
  "import { privacyPage } from './src/templates.mjs';",
  "import { loadDictionary, translatePage } from './src/i18n/translate.mjs';",
  'const html = privacyPage();',
  'const report = { missing: new Set() };',
  "translatePage(html, { dict: loadDictionary().dict, siteUrl: site.url, filePath: 'privacy.html', report });",
  'process.stdout.write(JSON.stringify({ html, missing: [...report.missing] }));',
].join('\n')], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, ANALYTICS_DEFAULTS: '', GA_MEASUREMENT_ID: '', METRICOOL_HASH: '', GTM_ID: '', VERCEL_INSIGHTS: '', ...env },
}).toString());

const main = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const firstParty = [
  /Our own website statistics record the pages you view/,
  /Raw IP addresses are not retained\./,
  /Daily visitor hashes rotate, and browser Do Not Track and Global Privacy Control choices are honored for this first-party tracking\./,
  /data-analytics-optout/,
];

test('default build: the privacy page names the tools that load after consent', () => {
  const { html, missing } = render({});
  assert.match(html, /<html [^>]*data-trackers="ga metricool"/);
  assert.match(main(html), /<li>Google Analytics<\/li>/);
  assert.match(main(html), /<li>Metricool<\/li>/);
  assert.match(main(html), /They load only if you accept\./);
  for (const re of firstParty) assert.match(html, re);
  assert.deepEqual(missing, [], 'every sentence has Spanish');
});

test('ANALYTICS_DEFAULTS=off with no IDs: the page names no third-party tracker and implies no analytics cookies', () => {
  for (const env of [{ ANALYTICS_DEFAULTS: 'off' }, { ANALYTICS_DEFAULTS: 'off', VERCEL_INSIGHTS: 'off' }]) {
    const { html, missing } = render(env);
    assert.match(html, /<html [^>]*data-trackers=""/);
    assert.doesNotMatch(html, /Google Analytics|Google Tag Manager|Metricool|googletagmanager/i);
    assert.doesNotMatch(main(html), /through cookies/);
    assert.match(main(html), /this site uses no third-party analytics or advertising tools\./i);
    for (const re of firstParty) assert.match(html, re);
    assert.deepEqual(missing, [], 'every sentence has Spanish');
    if (env.VERCEL_INSIGHTS === 'off') assert.doesNotMatch(main(html), /Vercel/);
    else assert.match(main(html), /Vercel Web Analytics and Speed Insights/);
  }
});

// The banner script, run in a minimal fake DOM (the APIs consent.js already uses).
const source = readFileSync(new URL('../static/consent.js', import.meta.url), 'utf8');
function banner({ trackers, lang = 'en-US' } = {}) {
  const el = () => ({
    children: [], attrs: {}, text: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...nodes) { this.children.push(...nodes); },
    addEventListener() {}, remove() {},
    set textContent(v) { this.text = v; }, get textContent() { return this.text; },
  });
  const body = el();
  const document = { documentElement: { lang, dataset: trackers === undefined ? {} : { trackers } }, body, createElement: el, querySelectorAll: () => [] };
  vm.runInNewContext(source, { document, window: {}, navigator: {}, localStorage: { getItem: () => null, setItem() {} } });
  const flat = (n) => (typeof n === 'string' ? n : [n.text, ...n.children.map(flat)].join(''));
  return { label: body.children[0].attrs['aria-label'], text: flat(body.children[0]) };
}

test('the banner follows <html data-trackers>', () => {
  const legacy = banner();
  assert.match(legacy.text, /with Google Analytics and similar tools/);
  const defaults = banner({ trackers: 'ga metricool' });
  assert.match(defaults.text, /with our own statistics, Google Analytics and Metricool to understand/);
  assert.equal(defaults.label, 'Cookie and privacy choices');
  const none = banner({ trackers: '' });
  assert.doesNotMatch(none.text, /Google|Metricool|similar tools/);
  assert.match(none.text, /We use no cookies or third-party tools for this\./);
  assert.match(none.text, /decline and we will stop counting your visits/);
  assert.equal(none.label, 'Privacy choices');
  const spanish = banner({ trackers: '', lang: 'es-US' });
  assert.match(spanish.text, /No usamos cookies ni herramientas de terceros/);
  assert.match(banner({ trackers: 'ga', lang: 'es-US' }).text, /con nuestras propias estadísticas y Google Analytics para/);
});
