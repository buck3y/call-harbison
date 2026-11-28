// HQ sign-in: the password minimum, the throttles (per IPv4 address or IPv6 /64, one shared bucket for an unknown
// address, an overflow bucket when the table is full, a budget for all addresses together), the __Host- cookie,
// sign-out, and the CSV formula guard.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { COOKIE, LOGIN_MAX_ALL, LOGIN_MAX_PER_ADDRESS, NOT_AVAILABLE, hqSetupProblem, makeSession, noteHqSetup, resetHqLimits } from '../api/hq.js';
import { createRateLimiter, rateKey } from '../lib/request-ip.js';
import { db, installMockSupabase } from '../dev/mock-supabase.mjs';

const PASSWORD = 'correct horse battery staple';
const env = { HQ_PASSWORD: PASSWORD, SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };

function call(req, e = env) {
  const res = { statusCode: 200, headers: {}, body: null, raw: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.end = (v = '') => ((res.raw = v), res);
  return handler({ headers: {}, ...req }, res, e).then(() => res);
}
const login = (password, ip, extra = {}, e = env) => call({ method: 'POST', url: '/api/hq?action=login', headers: { ...(ip === undefined ? {} : { 'x-real-ip': ip }), ...extra }, body: { password, name: 'Nate' } }, e);

// Each test starts with fresh throttles; the warnings they print are collected, not shown.
let warnings = [];
beforeEach(() => { resetHqLimits(); warnings = []; console.warn = (...a) => warnings.push(a.join(' ')); });

test('a password shorter than 12 characters keeps HQ off: 503, one generic sentence, the reason only in the log', async () => {
  const short = { ...env, HQ_PASSWORD: 'elevenchars' };
  for (const req of [{ method: 'POST', url: '/api/hq?action=login', body: { password: 'elevenchars' } }, { method: 'GET', url: '/api/hq?action=me', headers: { cookie: `${COOKIE}=${makeSession('Nate', short)}` } }]) {
    const res = await call(req, short);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { ok: false, error: NOT_AVAILABLE });
    assert.equal(res.headers['Set-Cookie'], undefined);
  }
  assert.match(hqSetupProblem(short), /HQ_PASSWORD is shorter than 12 characters/);
  const said = warnings.filter((l) => l.startsWith('[hq] HQ is off'));
  assert.deepEqual(said, ['[hq] HQ is off: HQ_PASSWORD is shorter than 12 characters. Set a longer one in the settings file, then restart the site.'], 'said once, naming the setting');
  const again = [];
  noteHqSetup({ ...short, HQ_PASSWORD: 'ten chars!' }, (l) => again.push(l));
  assert.deepEqual(again, [], 'the same reason is not repeated');
  assert.ok(!warnings.join('\n').includes('elevenchars'), 'never the password itself');
  // Exactly 12 is enough; the mocks' opt-out lets "demo" through.
  assert.equal((await login('twelve chars', '192.0.2.1', {}, { ...env, HQ_PASSWORD: 'twelve chars' })).statusCode, 200);
  assert.equal((await login('demo', '192.0.2.1', {}, { ...env, HQ_PASSWORD: 'demo', HQ_ALLOW_SHORT_PASSWORD: '1' })).statusCode, 200);
  assert.equal((await login('demo', '192.0.2.1', {}, { ...env, HQ_PASSWORD: 'demo' })).statusCode, 503);
});

test('rateKey: IPv4 as it is, IPv6 cut to its /64, IPv4-mapped IPv6 as IPv4', () => {
  assert.equal(rateKey('198.51.100.7'), '198.51.100.7');
  assert.equal(rateKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(rateKey('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64');
  assert.equal(rateKey('2001:DB8:1:2::FFFF'), '2001:db8:1:2::/64');
  assert.notEqual(rateKey('2001:db8:1:3::1'), rateKey('2001:db8:1:2::1'));
  assert.equal(rateKey('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(rateKey('::ffff:c000:201'), '192.0.2.1');
  assert.equal(rateKey('[2001:db8:1:2::1]'), '2001:db8:1:2::/64');
  assert.equal(rateKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(rateKey(''), '');
  assert.equal(rateKey(undefined), '');
});

test('two addresses in one IPv6 /64 share a sign-in bucket; an address in another /64 does not', async () => {
  const first = '2001:db8:1:2::1';
  const second = '2001:db8:1:2:ffff:ffff:ffff:fffe';
  const elsewhere = '2001:db8:1:3::1';
  await Promise.all(Array.from({ length: LOGIN_MAX_PER_ADDRESS }, (_, i) => login('wrong', i % 2 ? first : second)));
  assert.equal((await login(PASSWORD, first)).statusCode, 429);
  assert.equal((await login(PASSWORD, second)).statusCode, 429, 'the right password too, while the bucket is full');
  assert.equal((await login(PASSWORD, elsewhere)).statusCode, 200);
  assert.ok(warnings.some((l) => l === `[security] hq sign-in throttled: ${LOGIN_MAX_PER_ADDRESS} failed attempts from 2001:db8:1:2::/64; it is refused for 15 minutes`), warnings.join('\n'));
});

test('a request whose address cannot be told shares one bucket; it never escapes the limit', async () => {
  await Promise.all(Array.from({ length: LOGIN_MAX_PER_ADDRESS }, () => login('wrong', undefined)));
  assert.equal((await login(PASSWORD, undefined)).statusCode, 429);
  assert.equal((await login(PASSWORD, '')).statusCode, 429, 'an empty address is the same bucket');
  assert.equal((await login(PASSWORD, '192.0.2.50')).statusCode, 200, 'a known address has its own');
  const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
  limiter.hit('', 0);
  assert.equal(limiter.hit(undefined, 1).limited, true);
  assert.equal(limiter.isLimited(null, 2), true);
});

test('a full table never drops a live bucket: new keys share one overflow bucket', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, maxEntries: 3 });
  for (const key of ['a', 'b', 'c']) limiter.hit(key, 0);
  limiter.hit('a', 1); limiter.hit('a', 2);
  assert.equal(limiter.isLimited('a', 3), true, 'a keeps its count however many new keys arrive');
  assert.equal(limiter.hit('new-1', 10).limited, false);
  assert.equal(limiter.hit('new-2', 11).limited, false);
  assert.equal(limiter.hit('new-3', 12).limited, true, 'the newcomers share one bucket, limited like any other');
  assert.equal(limiter.isLimited('new-4', 13), true);
  for (let i = 0; i < 100; i += 1) limiter.hit(`rotating-${i}`, 20);
  assert.equal(limiter.isLimited('a', 30), true, 'rotating through keys did not reset a');
  assert.equal(limiter.hit('later', 2000).limited, false, 'once windows end, their buckets make room');
  const evict = createRateLimiter({ max: 1, windowMs: 1000, maxEntries: 2, whenFull: 'evict' });
  evict.hit('a', 0); evict.hit('b', 0);
  assert.equal(evict.hit('c', 1).limited, false, "'evict' (the lead form) gives a newcomer its own bucket");
});

test('40 failed sign-ins from all addresses together refuse every sign-in, and say so once', async () => {
  await Promise.all(Array.from({ length: LOGIN_MAX_ALL }, (_, i) => login('wrong', `198.51.100.${i + 1}`)));
  assert.equal((await login(PASSWORD, '203.0.113.200')).statusCode, 429, 'a new address with the right password');
  assert.equal((await login('wrong', '203.0.113.201')).statusCode, 429);
  const tripped = warnings.filter((l) => l.startsWith('[security] hq sign-in throttled for everyone'));
  assert.equal(tripped.length, 1);
  assert.equal(warnings.filter((l) => l.startsWith('[security] hq sign-in failed')).length, LOGIN_MAX_ALL, 'one line per failure, none for the refusals after');
  // A session already signed in keeps working.
  const res = await call({ method: 'GET', url: '/api/hq?action=me', headers: { cookie: `${COOKIE}=${makeSession('Nate', env)}` } });
  assert.equal(res.statusCode, 200);
});

test('an address that signed in before is not shut out by the shared budget, but keeps its own limit', async () => {
  // Nobody can keep the owner out of HQ with 40 wrong passwords every 15 minutes.
  assert.equal((await login(PASSWORD, '203.0.113.9')).statusCode, 200, 'the owner signs in: the address is now known');
  assert.equal((await login(PASSWORD, undefined)).statusCode, 200, 'a sign-in whose address cannot be told');
  await Promise.all(Array.from({ length: LOGIN_MAX_ALL }, (_, i) => login('wrong', `198.51.100.${i + 1}`)));
  assert.equal((await login(PASSWORD, '203.0.113.77')).statusCode, 429, 'a new address is refused while the budget is used up');
  assert.equal((await login(PASSWORD, undefined)).statusCode, 429, 'an unknown address is never on the list, though it signed in before');
  assert.equal((await login(PASSWORD, '203.0.113.9')).statusCode, 200, 'the known address still gets in');
  // Its own limit still applies: a wrong password does not get in, and eight of them shut the address out as well.
  const wrong = await Promise.all(Array.from({ length: LOGIN_MAX_PER_ADDRESS }, () => login('wrong', '203.0.113.9')));
  assert.ok(wrong.every((r) => r.statusCode === 401));
  assert.equal((await login(PASSWORD, '203.0.113.9')).statusCode, 429);
});

test('the cookie is __Host-hq_session with Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain; the old name is not read', async () => {
  const ok = await login(PASSWORD, '192.0.2.9');
  assert.equal(ok.statusCode, 200);
  const cookie = ok.headers['Set-Cookie'];
  assert.match(cookie, /^__Host-hq_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  assert.doesNotMatch(cookie, /Domain=/i);
  const token = cookie.split(';')[0].split('=').slice(1).join('=');
  assert.equal((await call({ method: 'GET', url: '/api/hq?action=me', headers: { cookie: `__Host-hq_session=${token}` } })).statusCode, 200);
  assert.equal((await call({ method: 'GET', url: '/api/hq?action=me', headers: { cookie: `hq_session=${token}` } })).statusCode, 401);
  assert.equal((await call({ method: 'GET', url: '/api/hq?action=me', headers: { cookie: '__Host-hq_session=%E0%A4%A' } })).statusCode, 401, 'a malformed cookie is no session, not a server error');
});

test('sign-out is a POST with X-HQ: 1 only, and never from another website', async () => {
  const get = await call({ method: 'GET', url: '/api/hq?action=logout' });
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.Allow, 'POST');
  assert.equal(get.headers['Set-Cookie'], undefined);
  const noHeader = await call({ method: 'POST', url: '/api/hq?action=logout' });
  assert.equal(noHeader.statusCode, 403);
  assert.equal(noHeader.headers['Set-Cookie'], undefined);
  const crossSite = await call({ method: 'POST', url: '/api/hq?action=logout', headers: { 'x-hq': '1', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } });
  assert.equal(crossSite.statusCode, 403);
  const ok = await call({ method: 'POST', url: '/api/hq?action=logout', headers: { 'x-hq': '1' } });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['Set-Cookie'], /^__Host-hq_session=; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=0$/);
});

test('the CSV export also neutralises a formula after leading spaces or tabs', async () => {
  const original = globalThis.fetch;
  const mock = { HQ_PASSWORD: PASSWORD };
  installMockSupabase(mock);
  try {
    const names = ['  =HYPERLINK("http://evil.example","x")', '\t+1+1', ' @SUM(A1)', '\n-2+3', 'Plain = name'];
    for (const name of names) db.leads.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), name, phone: '6615550100', address: 'CSV Test Rd', status: 'new', form_type: 'options' });
    const res = await call({ method: 'GET', url: '/api/hq?action=export&view=all', headers: { cookie: `${COOKIE}=${makeSession('Nate', mock)}` } }, mock);
    assert.equal(res.statusCode, 200);
    for (const name of names.slice(0, 4)) assert.ok(res.raw.includes(`'${name}`) || res.raw.includes(`"'${name.replace(/"/g, '""')}"`), JSON.stringify(name));
    assert.ok(res.raw.includes('Plain = name') && !res.raw.includes("'Plain = name"), 'an ordinary name is left alone');
    assert.ok(warnings.some((l) => /^\[security\] hq export by "Nate": \d+ row\(s\)$/.test(l)));
  } finally { globalThis.fetch = original; }
});
