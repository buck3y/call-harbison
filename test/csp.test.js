// The content security policy: built from the pages as written (lib/csp.js, build.mjs), and sent by server.mjs.
// The builds run in child processes (site.config.mjs reads its settings at import) into a temporary folder (BUILD_OUT),
// never into ./dist.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPage, buildPolicy, isPublicPath, pageTags, publicPolicy, scriptHash, scriptKind, sitePolicy } from '../lib/csp.js';
import { createHandler, loadRouting } from '../server.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'hbh-csp-'));
after(() => rmSync(work, { recursive: true, force: true }));

const SELF = 'https://www.callharbison.com'; // the default SITE_URL, which every build below uses
const NO_SETTINGS = { VERCEL: '', ANALYTICS_DEFAULTS: '', GA_MEASUREMENT_ID: '', METRICOOL_HASH: '', GTM_ID: '', VERCEL_INSIGHTS: '', SITE_URL: '' };
const htmlFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? htmlFiles(path) : (entry.name.endsWith('.html') ? [path] : []);
});
function build(name, env = {}) {
  const out = join(work, name);
  execFileSync(process.execPath, ['build.mjs'], { cwd: repo, env: { ...process.env, ...NO_SETTINGS, ...env, BUILD_OUT: out }, stdio: 'pipe' });
  const pages = htmlFiles(out).map((path) => ({ file: relative(out, path), html: readFileSync(path, 'utf8') }));
  const css = readdirSync(out).filter((f) => /^styles\.[0-9a-f]{10}\.css$/.test(f)).map((f) => readFileSync(join(out, f), 'utf8')).join('\n');
  return { out, pages, css, policy: JSON.parse(readFileSync(join(out, 'csp.json'), 'utf8')).public };
}
const builds = {
  none: build('none'),
  ga: build('ga', { ANALYTICS_DEFAULTS: 'off', GA_MEASUREMENT_ID: 'G-CSPTEST123' }),
  metricool: build('metricool', { ANALYTICS_DEFAULTS: 'off', METRICOOL_HASH: '0123456789abcdef0123' }),
};

// ---------- Reading a policy the way a browser does (for the sources this site uses) ----------

const directives = (policy) => new Map(policy.split(';').map((d) => d.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
const FALLBACK = { 'frame-src': ['child-src', 'default-src'], 'form-action': [], 'frame-ancestors': [], 'base-uri': [] };
const sourcesFor = (map, directive) => {
  if (map.has(directive)) return map.get(directive);
  for (const other of FALLBACK[directive] ?? ['default-src']) if (map.has(other)) return map.get(other);
  return null; // nothing restricts it
};
function allows(map, directive, url) {
  const sources = sourcesFor(map, directive);
  if (sources === null) return true;
  const u = new URL(url, `${SELF}/page`);
  if (u.origin === SELF && sources.includes("'self'")) return true;
  return sources.some((source) => {
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return u.protocol === source.toLowerCase();
    const host = /^https:\/\/(\*\.)?([a-z0-9.-]+)$/i.exec(source);
    if (!host || u.protocol !== 'https:') return false;
    return host[1] ? u.hostname.endsWith(`.${host[2]}`) : u.hostname === host[2];
  });
}

// Everything a page makes the browser fetch, as [directive, url].
const srcset = (value) => String(value || '').split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
const cssUrls = (text) => [...String(text).matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]);
function loads(html) {
  const found = [];
  const add = (directive, url) => { if (url && !url.startsWith('#')) found.push([directive, url]); };
  for (const tag of pageTags(html)) {
    const a = tag.attrs;
    const rel = String(a.get('rel') || '').toLowerCase().split(/\s+/);
    if (tag.name === 'script') {
      add('script-src', a.get('src'));
      // An inline script that names an https:// address loads it as a script (the analytics and tag loaders).
      if (scriptKind(tag) === 'inline') for (const m of tag.text.matchAll(/https:\/\/[^'"\s)]+/g)) add('script-src', m[0]);
    }
    if (tag.name === 'link') {
      if (rel.includes('stylesheet')) add('style-src', a.get('href'));
      if (rel.includes('icon') || rel.includes('apple-touch-icon')) add('img-src', a.get('href'));
      if (rel.includes('manifest')) add('manifest-src', a.get('href'));
      if (rel.includes('preload') || rel.includes('modulepreload')) {
        const directive = { image: 'img-src', font: 'font-src', style: 'style-src', script: 'script-src', fetch: 'connect-src' }[a.get('as')] || 'default-src';
        add(directive, a.get('href'));
        for (const url of srcset(a.get('imagesrcset'))) add(directive, url);
      }
    }
    if (tag.name === 'img') { add('img-src', a.get('src')); add('img-src', a.get('data-src')); for (const url of srcset(a.get('srcset'))) add('img-src', url); }
    if (tag.name === 'source') { for (const url of srcset(a.get('srcset'))) add('img-src', url); add('media-src', a.get('src')); }
    if (tag.name === 'iframe' || tag.name === 'frame') add('frame-src', a.get('src'));
    if (tag.name === 'video' || tag.name === 'audio') { add('media-src', a.get('src')); add('img-src', a.get('poster')); }
    if (tag.name === 'object' || tag.name === 'embed') add('object-src', a.get('data') || a.get('src') || '/');
    if (tag.name === 'form') add('form-action', a.get('action'));
    if (a.has('formaction')) add('form-action', a.get('formaction'));
    if (tag.name === 'image' || tag.name === 'use') add('img-src', a.get('href') || a.get('xlink:href'));
    for (const url of cssUrls(a.get('style'))) add('img-src', url);
    if (tag.name === 'style') for (const url of cssUrls(tag.text)) add('img-src', url);
  }
  return found;
}
const isHq = (file) => file.startsWith('hq/');

// ---------- The built policy against the built pages ----------

for (const [name, built] of Object.entries(builds)) {
  test(`${name}: every inline script on every public page, English and Spanish, is allowed by its hash`, () => {
    const scriptSrc = directives(built.policy).get('script-src');
    const pages = built.pages.filter((p) => !isHq(p.file));
    assert.ok(pages.length > 100 && pages.some((p) => p.file === 'es/index.html'), 'the whole build was read, Spanish included');
    let inline = 0;
    for (const { file, html } of pages) {
      for (const tag of pageTags(html).filter((t) => t.name === 'script' && scriptKind(t) === 'inline')) {
        inline += 1;
        assert.ok(scriptSrc.includes(scriptHash(tag.text)), `${file}: inline script not in the policy: ${tag.text.slice(0, 60)}`);
      }
      if (/<script type="speculationrules">/.test(html)) assert.ok(scriptSrc.includes("'inline-speculation-rules'"), file);
    }
    assert.ok(inline > pages.length, 'each page has its inline head scripts');
  });

  test(`${name}: no page has an inline event handler or a javascript: URL`, () => {
    for (const { file, html } of built.pages) assert.deepEqual(auditPage(html).problems, [], file);
  });

  test(`${name}: everything a page loads is allowed by the matching directive`, () => {
    const map = directives(built.policy);
    const hqRules = loadRouting().headers.filter((r) => r.match.test('/hq')).flatMap((r) => r.headers).filter(([k]) => k === 'Content-Security-Policy');
    const hq = directives(hqRules.at(-1)[1]);
    let checked = 0;
    for (const { file, html } of built.pages) {
      for (const [directive, url] of loads(html)) {
        checked += 1;
        assert.ok(allows(isHq(file) ? hq : map, directive, url), `${file}: ${directive} blocks ${url}`);
      }
    }
    assert.ok(checked > 1000, `${checked} loads checked`);
    // The fingerprinted stylesheet: the font in @font-face, any other url() is an image.
    for (const url of cssUrls(built.css.match(/@font-face\{[^}]*\}/g)?.join('') || '')) assert.ok(allows(map, 'font-src', url), url);
    for (const url of cssUrls(built.css.replace(/@font-face\{[^}]*\}/g, ''))) assert.ok(allows(map, 'img-src', url), url);
  });

  test(`${name}: scripts never get 'unsafe-inline' or 'unsafe-eval', and no directive allows a whole scheme or any host`, () => {
    const map = directives(built.policy);
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'"]) assert.ok(!map.get('script-src').includes(bad), bad);
    for (const [directive, sources] of map) for (const source of sources) assert.ok(!['*', 'https:', 'http:', 'blob:', 'filesystem:'].includes(source), `${directive} ${source}`);
    assert.deepEqual(map.get('object-src'), ["'none'"]);
    assert.deepEqual(map.get('base-uri'), ["'self'"]);
    assert.deepEqual(map.get('form-action'), ["'self'"]);
    assert.deepEqual(map.get('frame-ancestors'), ["'self'"]);
    assert.deepEqual(map.get('report-uri'), ['/csp-report']);
    assert.ok(map.has('upgrade-insecure-requests'));
  });
}

test('the client scripts contact no host the policy does not account for', () => {
  const map = directives(builds.none.policy);
  // Every https:// origin in the browser scripts, and the directive it is loaded under. A new one must be added here
  // and to lib/csp.js, or the policy blocks it.
  const known = { 'https://www.youtube-nocookie.com': 'frame-src' };
  const files = readdirSync(join(repo, 'static')).filter((f) => f.endsWith('.js'));
  assert.ok(files.includes('script.js') && files.includes('consent.js'));
  for (const file of files) {
    for (const m of readFileSync(join(repo, 'static', file), 'utf8').matchAll(/https:\/\/[a-z0-9.-]+/gi)) {
      assert.ok(known[m[0]], `static/${file} names ${m[0]}`);
      assert.ok(allows(map, known[m[0]], `${m[0]}/embed/x`), `${known[m[0]]} allows ${m[0]}`);
    }
  }
});

test('with no tracker configured, scripts come only from this site and the hashed inline scripts', () => {
  const map = directives(builds.none.policy);
  const scriptSrc = map.get('script-src');
  assert.deepEqual(scriptSrc.filter((s) => !s.startsWith("'sha256-")), ["'self'", "'inline-speculation-rules'"]);
  const always = new Set(["'self'", "'none'", "'unsafe-inline'", "'inline-speculation-rules'", 'data:', 'https://images.unsplash.com', 'https://i.ytimg.com', 'https://www.youtube-nocookie.com', '/csp-report']);
  for (const [directive, sources] of map) for (const source of sources) assert.ok(always.has(source) || source.startsWith("'sha256-"), `${directive} ${source}`);
  // The matcher these tests rely on does refuse what the policy leaves out.
  assert.ok(!allows(map, 'script-src', 'https://www.googletagmanager.com/gtag/js?id=G-X'));
  assert.ok(!allows(map, 'img-src', 'https://example.org/x.png') && !allows(map, 'img-src', 'http://images.unsplash.com/x'));
  assert.ok(allows(map, 'img-src', 'data:image/png;base64,AAAA') && !allows(map, 'font-src', 'data:font/woff2;base64,AAAA'));
  assert.ok(!allows(map, 'frame-src', '/embed') && !allows(map, 'form-action', 'https://example.org/'));
});

test('with Google Analytics configured the policy names Google and not Metricool, and the reverse', () => {
  const ga = builds.ga.policy;
  assert.ok(directives(ga).get('script-src').includes('https://www.googletagmanager.com'));
  assert.ok(directives(ga).get('connect-src').includes('https://*.google-analytics.com'));
  assert.ok(directives(ga).get('img-src').includes('https://*.google-analytics.com'));
  assert.doesNotMatch(ga, /metricool/);
  const metricool = builds.metricool.policy;
  for (const directive of ['script-src', 'img-src', 'connect-src']) assert.ok(directives(metricool).get(directive).includes('https://tracker.metricool.com'), directive);
  assert.doesNotMatch(metricool, /google/);
  assert.doesNotMatch(builds.none.policy, /google|metricool|vercel/);
  // Tag Manager gets the Google hosts too; Vercel's insights only report to their own host.
  assert.match(buildPolicy({ gtm: true }), /script-src 'self' 'inline-speculation-rules' https:\/\/www\.googletagmanager\.com;/);
  assert.match(buildPolicy({ vercelInsights: true }), /connect-src 'self' https:\/\/vitals\.vercel-insights\.com;/);
});

// ---------- The checks themselves ----------

test('a hash is the SHA-256 of the exact script text, as the CSP standard computes it', () => {
  assert.equal(scriptHash("alert('Hello, world.');"), "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='");
  assert.equal(scriptHash('a\r\nb'), scriptHash('a\nb'), 'line endings as the browser normalises them');
  const kinds = pageTags('<script>a()</script><script type="module">b()</script><script src="/x.js"></script><script type="application/ld+json">{}</script><script type="speculationrules">{}</script><script type="text/plain">x</script>').map(scriptKind);
  assert.deepEqual(kinds, ['inline', 'inline', 'external', 'data', 'speculation', 'data']);
});

test('the build refuses inline handlers and javascript: URLs anywhere, and inline scripts under /hq', () => {
  const page = (body) => `<!doctype html><html><head><script>if(!('onpagereveal' in window))x()</script></head><body>${body}</body></html>`;
  assert.deepEqual(sitePolicy([{ file: 'a.html', html: page('<p>Turn it on=off. <code>onclick="print()"</code> is text here.</p>') }]).problems, []);
  for (const bad of ['<button type="button" onclick="print()">Print</button>', '<img src="x.png" ONERROR=alert(1)>', '<a href="javascript:void(0)">x</a>', "<form action='JavaScript:go()'></form>"]) {
    assert.equal(sitePolicy([{ file: 'a.html', html: page(bad) }]).problems.length, 1, bad);
  }
  const hq = sitePolicy([{ file: 'hq/index.html', html: '<script>x()</script><script src="/hq/app.js" defer></script>' }]);
  assert.match(hq.problems.join(), /hq\/index\.html: an inline <script>/);
  assert.deepEqual(hq.hashes, [], 'the /hq pages add nothing to the public policy');
  // The partner guide's print button is a listener now.
  const guide = builds.none.pages.find((p) => p.file === 'family-property-guide.html').html;
  assert.match(guide, /<button class="btn btn-gold" type="button" data-print-page>Print this guide<\/button>/);
  assert.match(readFileSync(join(repo, 'static/script.js'), 'utf8'), /document\.querySelectorAll\('\[data-print-page\]'\)\.forEach/);
});

test('publicPolicy reads csp.json, follows a rebuild, and gives null when the file is missing or wrong', () => {
  const dist = join(work, 'serve-policy');
  mkdirSync(dist, { recursive: true });
  assert.equal(publicPolicy(dist), null);
  writeFileSync(join(dist, 'csp.json'), JSON.stringify({ public: "default-src 'self'" }));
  assert.equal(publicPolicy(dist), "default-src 'self'");
  writeFileSync(join(dist, 'csp.json'), JSON.stringify({ public: "default-src 'none'" }));
  utimesSync(join(dist, 'csp.json'), new Date(), new Date(Date.now() + 5000));
  assert.equal(publicPolicy(dist), "default-src 'none'", 'a changed file is read again');
  writeFileSync(join(dist, 'csp.json'), '{ not json');
  utimesSync(join(dist, 'csp.json'), new Date(), new Date(Date.now() + 10000));
  assert.equal(publicPolicy(dist), null);
  writeFileSync(join(dist, 'csp.json'), JSON.stringify({ public: "default-src 'self'\r\nX-Evil: 1" }));
  utimesSync(join(dist, 'csp.json'), new Date(), new Date(Date.now() + 15000));
  assert.equal(publicPolicy(dist), null, 'a value that could not be a header is refused');
  rmSync(join(dist, 'csp.json'));
  assert.equal(publicPolicy(dist), null);
  assert.ok(isPublicPath('/') && isPublicPath('/es/about') && isPublicPath('/fonts/x.woff2') && isPublicPath('/csp-report'));
  assert.ok(!isPublicPath('/hq') && !isPublicPath('/hq/leads') && !isPublicPath('/api/leads'));
});

// ---------- What the server sends ----------

const dist = join(work, 'serve');
for (const dir of ['hq', 'fonts']) mkdirSync(join(dist, dir), { recursive: true });
writeFileSync(join(dist, 'index.html'), '<h1>home</h1>');
writeFileSync(join(dist, 'hq/index.html'), '<h1>hq</h1>');
writeFileSync(join(dist, 'fonts/public-sans-latin.woff2'), 'font');
const PUBLIC = builds.none.policy;
const HQ = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

async function headersOf(paths) {
  const server = createServer(createHandler({ dist, routing: loadRouting(), api: {}, log: () => {} }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const get = (path) => new Promise((done, fail) => {
    request({ host: '127.0.0.1', port: server.address().port, path }, (res) => { res.resume(); res.on('end', () => done({ status: res.statusCode, ...res.headers })); }).on('error', fail).end();
  });
  try {
    const out = {};
    for (const path of paths) out[path] = await get(path);
    return out;
  } finally { server.close(); }
}

test('the server sends the vercel.json headers: COOP and Permissions-Policy everywhere, strict policies on /hq and /api', async () => {
  writeFileSync(join(dist, 'csp.json'), JSON.stringify({ public: PUBLIC }));
  const h = await headersOf(['/', '/hq', '/api/nothing', '/fonts/public-sans-latin.woff2']);
  for (const [path, headers] of Object.entries(h)) {
    assert.equal(headers['cross-origin-opener-policy'], 'same-origin', path);
    assert.match(headers['permissions-policy'], /camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\), serial=\(\), hid=\(\), bluetooth=\(\), midi=\(\), display-capture=\(\), browsing-topics=\(\)/, path);
    assert.equal(headers['x-content-type-options'], 'nosniff', path);
    assert.match(headers['strict-transport-security'], /max-age=63072000/, path);
    assert.equal(headers['cross-origin-embedder-policy'], undefined, `${path}: COEP would break the stock photos and analytics`);
  }
  assert.equal(h['/'].status, 200);
  assert.equal(h['/']['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(h['/']['x-frame-options'], 'SAMEORIGIN');
  assert.equal(h['/hq'].status, 200);
  assert.equal(h['/hq']['content-security-policy'], HQ);
  assert.equal(h['/hq']['referrer-policy'], 'no-referrer');
  assert.equal(h['/hq']['cross-origin-resource-policy'], 'same-origin');
  assert.equal(h['/hq']['x-frame-options'], 'DENY');
  assert.equal(h['/api/nothing'].status, 404);
  assert.equal(h['/api/nothing']['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
  assert.equal(h['/api/nothing']['cross-origin-resource-policy'], 'same-origin');
  assert.equal(h['/fonts/public-sans-latin.woff2']['cache-control'], 'public, max-age=31536000, immutable');
});

test('the server sends csp.json as the enforcing policy on public paths and drops the report-only one (server.mjs applies lib/csp.js)', async () => {
  writeFileSync(join(dist, 'csp.json'), JSON.stringify({ public: PUBLIC }));
  const h = await headersOf(['/', '/hq', '/api/nothing', '/fonts/public-sans-latin.woff2', '/no-such-page']);
  for (const [path, headers] of Object.entries(h)) assert.equal(headers['content-security-policy-report-only'], undefined, `${path}: the report-only policy gives way to the enforcing one`);
  assert.equal(h['/']['content-security-policy'], PUBLIC, 'server.mjs must call applyPublicPolicy(res, pathname, distRoot) from lib/csp.js after the vercel.json headers');
  assert.equal(h['/fonts/public-sans-latin.woff2']['content-security-policy'], PUBLIC);
  assert.equal(h['/no-such-page']['content-security-policy'], PUBLIC);
  assert.equal(h['/hq']['content-security-policy'], HQ, '/hq keeps its own policy');
  assert.equal(h['/api/nothing']['content-security-policy'], "default-src 'none'; frame-ancestors 'none'", '/api keeps its own policy');

  rmSync(join(dist, 'csp.json'));
  const without = await headersOf(['/']);
  assert.equal(without['/']['content-security-policy'], undefined, 'without csp.json the server changes nothing');
  assert.match(without['/']['content-security-policy-report-only'], /report-uri \/csp-report/);
});
