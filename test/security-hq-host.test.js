// HQ_HOST: HQ on an address of its own. Every row of the routing table, on both hosts, through the real request
// handler over real HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler, startupNotes } from '../server.mjs';
import { hqUrl } from '../lib/hq-url.js';

const dist = mkdtempSync(join(tmpdir(), 'hbh-hq-host-'));
for (const dir of ['hq', 'fonts', 'assets']) mkdirSync(join(dist, dir));
const files = {
  'index.html': '<h1>home</h1><script src="https://www.googletagmanager.com/gtag/js"></script>',
  'about.html': '<h1>about</h1>',
  '404.html': '<h1>public not found</h1><script src="https://www.googletagmanager.com/gtag/js"></script>',
  'hq/index.html': '<h1>hq</h1>',
  'hq/leads.html': '<h1>hq leads</h1>',
  'hq/app.js': '// hq app',
  'styles.0123456789.css': 'body{}',
  'script.0123456789.js': '//',
  'fonts/public-sans-latin.woff2': 'font',
  'assets/logo.svg': '<svg/>',
  'favicon.ico': 'ico',
  'robots.txt': 'User-agent: *',
  'sitemap.xml': '<urlset/>',
  'llms.txt': '# llms',
  'trick.png.html': '<h1>an html page named like an image</h1>',
};
for (const [name, body] of Object.entries(files)) writeFileSync(join(dist, name), body);

const stub = (name) => async (req, res) => res.status(200).json({ ok: true, handler: name, url: req.url });
const api = { '/api/hq': stub('hq'), '/api/leads': stub('leads'), '/api/track': stub('track'), '/api/intake': stub('intake'), '/api/mcp': stub('mcp') };

const servers = {};
before(async () => {
  for (const [name, hqHostName] of [['split', 'hq.example.test'], ['shared', '']]) {
    const server = createServer(createHandler({ dist, api, hqHostName, log: () => {} }));
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    servers[name] = server;
  }
});
after(() => { for (const s of Object.values(servers)) s.close(); rmSync(dist, { recursive: true, force: true }); });

const call = (server, host, path, { method = 'GET', headers = {} } = {}) => new Promise((done, fail) => {
  const req = request({ host: '127.0.0.1', port: servers[server].address().port, path, method, headers: { ...(host === null ? {} : { host }), ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => done({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', fail);
  req.end();
});

const HQ = 'hq.example.test';
const WWW = 'www.example.test';

test('on the HQ host: / goes to /hq; HQ, its files, /api/hq, /healthz and non-page static files are served', async () => {
  const root = await call('split', HQ, '/');
  assert.equal(root.status, 307);
  assert.equal(root.headers.location, '/hq');
  for (const [path, expect] of [['/hq', /<h1>hq<\/h1>/], ['/hq/leads', /hq leads/], ['/hq/app.js', /hq app/]]) {
    const res = await call('split', HQ, path);
    assert.equal(res.status, 200, path);
    assert.match(res.text, expect, path);
  }
  const apiHq = await call('split', HQ, '/api/hq?action=me');
  assert.equal(apiHq.status, 200);
  assert.equal(JSON.parse(apiHq.text).handler, 'hq');
  assert.equal((await call('split', HQ, '/healthz')).status, 200);
  for (const path of ['/styles.0123456789.css', '/script.0123456789.js', '/fonts/public-sans-latin.woff2', '/assets/logo.svg', '/favicon.ico']) {
    assert.equal((await call('split', HQ, path)).status, 200, path);
  }
  const report = await call('split', HQ, '/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' } });
  assert.equal(JSON.parse(report.text).url, '/api/track?csp=1', 'CSP reports from HQ still reach the CSP log (and only it)');
});

test('on the HQ host: every public page and every other /api route is 404, with no public page in the reply', async () => {
  for (const path of ['/about', '/index.html', '/about.html', '/robots.txt', '/sitemap.xml', '/llms.txt', '/no-such-page', '/trick.png', '/contact-us', '/family']) {
    const res = await call('split', HQ, path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.text, /googletagmanager|public not found|home|about/, `${path}: the public 404 page (with its scripts) is not used`);
    assert.equal(res.headers.location, undefined, `${path}: no redirect towards a public page`);
  }
  for (const [path, method] of [['/api/leads', 'POST'], ['/api/track', 'POST'], ['/api/intake', 'POST'], ['/api/mcp', 'POST'], ['/api/nope', 'GET'], ['/api', 'GET']]) {
    const res = await call('split', HQ, path, { method });
    assert.equal(res.status, 404, path);
    assert.deepEqual(JSON.parse(res.text), { ok: false, error: 'Not found' }, path);
  }
});

test('the HQ host is matched without regard to case or port', async () => {
  for (const host of ['HQ.Example.Test', 'hq.example.test:443', 'hq.example.test:8443', 'hq.example.test.']) {
    assert.equal((await call('split', host, '/hq')).status, 200, host);
    assert.equal((await call('split', host, '/about')).status, 404, host);
  }
});

test('on every other host: /hq, everything under /hq/ and /api/hq are 404; the public site is unchanged', async () => {
  for (const host of [WWW, 'example.test', '127.0.0.1', null]) {
    for (const path of ['/hq', '/hq/leads', '/hq/app.js', '/hq/', '/hq.html', '/hq/index.html']) {
      const res = await call('split', host, path);
      assert.equal(res.status, 404, `${host} ${path}`);
      assert.doesNotMatch(res.text, /<h1>hq/, `${host} ${path}`);
    }
    const apiHq = await call('split', host, '/api/hq?action=login', { method: 'POST' });
    assert.equal(apiHq.status, 404, `${host} /api/hq`);
    assert.deepEqual(JSON.parse(apiHq.text), { ok: false, error: 'Not found' });
  }
  assert.equal((await call('split', WWW, '/')).status, 200);
  assert.equal((await call('split', WWW, '/about')).status, 200);
  assert.equal((await call('split', WWW, '/robots.txt')).status, 200);
  assert.equal(JSON.parse((await call('split', WWW, '/api/leads', { method: 'POST' })).text).handler, 'leads');
  assert.equal(JSON.parse((await call('split', WWW, '/api/track', { method: 'POST' })).text).handler, 'track');
  assert.equal((await call('split', WWW, '/healthz')).status, 200);
  assert.match((await call('split', WWW, '/no-such-page')).text, /public not found/, 'the public host keeps its own 404 page');
});

test('without HQ_HOST everything behaves as before', async () => {
  for (const host of [WWW, HQ]) {
    assert.equal((await call('shared', host, '/hq')).status, 200, host);
    assert.equal((await call('shared', host, '/hq/leads')).status, 200, host);
    assert.equal(JSON.parse((await call('shared', host, '/api/hq?action=me')).text).handler, 'hq', host);
    assert.equal((await call('shared', host, '/about')).status, 200, host);
    assert.equal((await call('shared', host, '/')).status, 200, host);
  }
});

test('HQ links in alerts follow HQ_HOST; the start-up notes recommend it when outside scripts are set', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(hqUrl({ HQ_HOST: 'HQ.CallHarbison.com' }, id), `https://hq.callharbison.com/hq?lead=${id}`);
  assert.equal(hqUrl({ HQ_HOST: 'https://hq.callharbison.com/' }, id), `https://hq.callharbison.com/hq?lead=${id}`);
  assert.equal(hqUrl({ SITE_URL: 'https://www.callharbison.com' }, id), `https://www.callharbison.com/hq?lead=${id}`);
  assert.equal(hqUrl({}, id), `https://www.callharbison.com/hq?lead=${id}`);
  const recommend = (env) => startupNotes(env).some((n) => /Set HQ_HOST/.test(n));
  assert.equal(recommend({ GA_MEASUREMENT_ID: 'G-ABC123XYZ9' }), true);
  assert.equal(recommend({ GTM_ID: 'GTM-K9P4R2' }), true);
  assert.equal(recommend({ METRICOOL_HASH: '398cd80eb0d6d2a7ebd652d00db3bb8' }), true);
  assert.equal(recommend({ GA_MEASUREMENT_ID: 'G-ABC123XYZ9', HQ_HOST: 'hq.callharbison.com' }), false);
  assert.equal(recommend({}), false, 'no outside scripts, nothing to recommend');
  const note = startupNotes({ GA_MEASUREMENT_ID: 'G-ABC123XYZ9' }).find((n) => /HQ_HOST/.test(n));
  assert.doesNotMatch(note, /G-ABC123XYZ9/, 'names the setting, not its value');
});
