import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHandler, loadRouting, pinClientIp, sourceToRegExp } from '../server.mjs';

// A small stand-in for ./dist, so these tests never depend on (or disturb) a real build.
const dist = mkdtempSync(join(tmpdir(), 'hbh-server-'));
for (const dir of ['situations', 'fonts', 'hq', 'es', 'assets']) mkdirSync(join(dist, dir));
const files = {
  'index.html': '<h1>home</h1>',
  'about.html': '<h1>about</h1>',
  '404.html': '<h1>custom not found</h1>',
  'situations/index.html': '<h1>situations</h1>',
  'situations/inherited-property.html': '<h1>inherited</h1>',
  'es/index.html': '<h1>inicio</h1>',
  'hq/index.html': '<h1>hq</h1>',
  'hq/leads.html': '<h1>hq leads</h1>',
  'fonts/public-sans-latin.woff2': 'font',
  'styles.0123456789.css': 'body{}',
  'consent.0123456789.js': '//',
  'assets/logo.svg': '<svg/>',
  'robots.txt': 'User-agent: *',
  'nathanael-harbison.vcf': 'BEGIN:VCARD',
  '.env': 'SECRET=1',
};
for (const [name, body] of Object.entries(files)) writeFileSync(join(dist, name), body);

const seen = [];
const api = {
  '/api/echo': async (req, res) => {
    seen.push({ url: req.url, body: req.body, ip: req.headers['x-real-ip'], forwarded: req.headers['x-forwarded-for'] });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ ok: true, body: req.body ?? null, url: req.url, ip: req.headers['x-real-ip'] });
  },
  '/api/track': async (req, res) => res.status(200).json({ url: req.url, body: req.body ?? null }),
  '/api/boom': async () => { throw new Error('kaboom'); },
  '/api/silent': async (req, res) => { res.statusCode = 204; },
};

let server;
let port;
const logs = [];
before(async () => {
  server = createServer(createHandler({ dist, api, log: (line) => logs.push(line) }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});
after(() => {
  server.close();
  rmSync(dist, { recursive: true, force: true });
});

// node:http sends the path exactly as written, which fetch() would normalise.
const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((done, fail) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => done({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', fail);
  if (body !== undefined) req.write(body);
  req.end();
});

test('vercel.json sources become working patterns', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const rule of [...config.headers, ...config.redirects, ...config.rewrites]) assert.ok(sourceToRegExp(rule.source) instanceof RegExp, rule.source);
  assert.ok(sourceToRegExp('/(.*)').test('/situations/inherited-property'));
  assert.ok(sourceToRegExp('/styles.(.*).css').test('/styles.0123456789.css'));
  assert.ok(!sourceToRegExp('/styles.(.*).css').test('/stylesX0123456789Xcss'), 'a dot in a source is a literal dot');
  assert.ok(sourceToRegExp('/hq(.*)').test('/hq'));
  assert.ok(sourceToRegExp('/hq(.*)').test('/hq/leads'));
  assert.ok(!sourceToRegExp('/hq(.*)').test('/api/hq'));
  assert.ok(sourceToRegExp('/guides/:slug').test('/guides/cash-offer-vs-listing'));
  assert.ok(!sourceToRegExp('/guides/:slug').test('/guides/a/b'));
  assert.ok(sourceToRegExp('/docs/:path*').test('/docs/a/b'));
  const routing = loadRouting();
  assert.equal(routing.cleanUrls, true);
  assert.equal(routing.trailingSlash, false);
  assert.ok(routing.redirects.length >= 4);
});

test('pages are served with clean URLs and the security headers from vercel.json', async () => {
  const home = await call('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /home/);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.match(home.headers['strict-transport-security'], /max-age=63072000/);
  assert.equal(home.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(home.headers['content-security-policy-report-only'], /report-uri \/csp-report/);
  assert.equal(home.headers['cache-control'], 'public, max-age=0, must-revalidate');

  assert.match((await call('/about')).text, /about/);
  assert.match((await call('/situations')).text, /situations/);
  assert.match((await call('/situations/inherited-property')).text, /inherited/);
  assert.match((await call('/es')).text, /inicio/);
  assert.match((await call('/about?utm_source=x')).text, /about/);
  assert.equal((await call('/robots.txt')).headers['content-type'], 'text/plain; charset=utf-8');
  assert.match((await call('/nathanael-harbison.vcf')).headers['content-type'], /text\/vcard/);
});

test('.html and trailing-slash addresses redirect to the clean address, keeping the query', async () => {
  for (const [from, to] of [
    ['/about.html', '/about'], ['/about/', '/about'], ['/index.html', '/'], ['/situations/index.html', '/situations'],
    ['/situations/', '/situations'], ['/es/', '/es'], ['/about.html?a=1', '/about?a=1'], ['/about/?a=1', '/about?a=1'],
  ]) {
    const res = await call(from);
    assert.equal(res.status, 308, from);
    assert.equal(res.headers.location, to, from);
  }
});

test('redirects and rewrites from vercel.json apply', async () => {
  const contact = await call('/contact-us?ref=card');
  assert.equal(contact.status, 308);
  assert.equal(contact.headers.location, '/contact?ref=card');
  const family = await call('/family?ref=partner');
  assert.equal(family.status, 307);
  assert.equal(family.headers.location, '/sell-loved-ones-house?ref=partner');

  const report = await call('/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: '{"csp-report":{}}' });
  assert.equal(report.status, 200);
  assert.equal(JSON.parse(report.text).url, '/api/track?csp=1');
});

test('cache and privacy headers follow the path', async () => {
  const immutable = 'public, max-age=31536000, immutable';
  assert.equal((await call('/fonts/public-sans-latin.woff2')).headers['cache-control'], immutable);
  assert.equal((await call('/fonts/public-sans-latin.woff2')).headers['content-type'], 'font/woff2');
  assert.equal((await call('/styles.0123456789.css')).headers['cache-control'], immutable);
  assert.equal((await call('/consent.0123456789.js')).headers['cache-control'], immutable);
  assert.match((await call('/assets/logo.svg')).headers['cache-control'], /max-age=2592000/);
  for (const path of ['/hq', '/hq/leads']) {
    const hq = await call(path);
    assert.equal(hq.status, 200, path);
    assert.equal(hq.headers['cache-control'], 'no-store', path);
    assert.equal(hq.headers['x-robots-tag'], 'noindex, nofollow', path);
    assert.equal(hq.headers['x-frame-options'], 'DENY', path);
  }
});

test('unknown pages get the site 404 page with a 404 status', async () => {
  const missing = await call('/no-such-page');
  assert.equal(missing.status, 404);
  assert.match(missing.text, /custom not found/);
  assert.equal(missing.headers['x-content-type-options'], 'nosniff');
});

test('HEAD, conditional requests and wrong methods behave', async () => {
  const head = await call('/about', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(head.headers['content-length'], String(files['about.html'].length));

  const first = await call('/about');
  assert.ok(first.headers.etag);
  const again = await call('/about', { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.text, '');

  const post = await call('/about', { method: 'POST', body: 'x' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('hostile paths never leave ./dist and never redirect off the site', async () => {
  const doubled = await call('//evil.example/path');
  assert.equal(doubled.status, 308);
  assert.equal(doubled.headers.location, '/evil.example/path');
  assert.ok(!doubled.headers.location.startsWith('//'));

  assert.equal((await call('/\\evil.example')).status, 400);
  assert.equal((await call('/%5Cevil.example/')).status, 400);
  assert.equal((await call('/%E0%A4%A')).status, 400, 'malformed percent-encoding');
  assert.equal((await call('/about%00.html')).status, 400);

  for (const path of ['/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/situations/..%2f..%2f.env']) {
    const res = await call(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.text, /root:|SECRET/, path);
  }
  const dotfile = await call('/.env');
  assert.equal(dotfile.status, 404);
  assert.doesNotMatch(dotfile.text, /SECRET/);
});

test('API handlers get the body, the address and the Vercel-style response helpers', async () => {
  seen.length = 0;
  const json = await call('/api/echo?action=me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  assert.equal(json.status, 201);
  assert.match(json.headers['content-type'], /application\/json/);
  assert.equal(json.headers['cache-control'], 'no-store', 'a handler header wins over the default');
  assert.equal(json.headers['x-content-type-options'], 'nosniff', 'vercel.json headers also cover the API');
  assert.deepEqual(JSON.parse(json.text), { ok: true, body: '{"a":1}', url: '/api/echo?action=me', ip: '127.0.0.1' });

  const form = await call('/api/echo', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'street=1+Main+St&zip=93301' });
  assert.deepEqual(JSON.parse(form.text).body, { street: '1 Main St', zip: '93301' });

  const empty = await call('/api/echo');
  assert.equal(JSON.parse(empty.text).body, null, 'no body arrives as undefined, as on Vercel');

  assert.equal((await call('/api/silent')).status, 204);
  assert.ok(logs.some((line) => /^POST \/api\/echo 201 \d+ms$/.test(line)), 'API calls are logged without the query string');
});

test('API failures and limits are contained', async () => {
  const boom = await call('/api/boom', { method: 'POST', body: '{}' });
  assert.equal(boom.status, 500);
  assert.deepEqual(JSON.parse(boom.text), { ok: false, error: 'Server error' });
  assert.doesNotMatch(boom.text, /kaboom/);

  const missing = await call('/api/nope');
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.text), { ok: false, error: 'Not found' });

  const big = await call('/api/echo', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024) }, body: '{}' }).catch((err) => ({ status: 413, err }));
  assert.equal(big.status, 413);

  assert.equal((await call('/healthz')).status, 200);
  assert.match((await call('/healthz')).text, /^ok/);
});

test('a build for a host other than Vercel leaves out the Vercel-only scripts', () => {
  const render = (env) => execFileSync(process.execPath, ['--input-type=module', '-e', "import { homePage } from './src/templates.mjs'; process.stdout.write(homePage().includes('/_vercel/') ? 'present' : 'absent');"], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ...env },
  }).toString();
  assert.equal(render({ VERCEL_INSIGHTS: '' }), 'present', 'the default build keeps Vercel Web Analytics and Speed Insights');
  assert.equal(render({ VERCEL_INSIGHTS: 'off' }), 'absent', 'they would only 404 on a VPS');
});

test('only a trusted proxy may say who the visitor is', () => {
  const make = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers: { ...headers } });

  const direct = make('203.0.113.9', { 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '6.6.6.6', 'x-vercel-forwarded-for': '6.6.6.6' });
  assert.equal(pinClientIp(direct), '203.0.113.9', 'a visitor connecting directly cannot name their own address');
  assert.deepEqual(direct.headers, { 'x-real-ip': '203.0.113.9' });

  const proxied = make('127.0.0.1', { 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '6.6.6.6, 198.51.100.7' });
  assert.equal(pinClientIp(proxied), '198.51.100.7', 'the address the local proxy appended wins over anything the visitor sent');

  const mapped = make('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.8' });
  assert.equal(pinClientIp(mapped), '198.51.100.8');

  const docker = make('172.18.0.3', { 'x-forwarded-for': '198.51.100.9' });
  assert.equal(pinClientIp(docker), '172.18.0.3', 'a private-network peer is not trusted by default');
  assert.equal(pinClientIp(make('172.18.0.3', { 'x-forwarded-for': '198.51.100.9' }), 'private'), '198.51.100.9');
  assert.equal(pinClientIp(make('127.0.0.1', { 'x-forwarded-for': '198.51.100.9' }), 'off'), '127.0.0.1');
});
