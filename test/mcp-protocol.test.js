// The MCP endpoint over HTTP: off by default, the token and its rate limits, Origin, methods, both protocol eras
// (2026-07-28 without a handshake, and the handshake revisions before it), and what reaches the log. No database is
// open in this file: system_status still answers, and crm_overview shows how a failed read looks. The tools on a real
// database are in test/mcp-tools.test.js.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../server.mjs';
import mcp, { resetMcpLimits } from '../api/mcp.js';
import { LEGACY_VERSIONS, SUPPORTED_VERSIONS, decodeHeaderValue } from '../lib/mcp/protocol.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const TOKEN = randomBytes(32).toString('hex');
const TOOLS = ['crm_overview', 'list_leads', 'get_lead', 'pipeline_report', 'site_analytics', 'system_status'];
const MODERN = '2026-07-28';
const base = mkdtempSync(join(tmpdir(), 'hbh-mcp-protocol-'));
const dist = join(base, 'dist');
const freshEnv = (extra = {}) => ({ MCP_TOKEN: TOKEN, SITE_URL: 'https://www.callharbison.com', STATE_DIRECTORY: join(base, 'state'), ANALYTICS_STORE: 'shared', ...extra });
let env = freshEnv();

const logs = [];
const keep = { log: console.log, warn: console.warn, error: console.error };
let server;
let port;
before(async () => {
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<h1>home</h1>');
  for (const level of ['log', 'warn', 'error']) console[level] = (...args) => { logs.push(args.map(String).join(' ')); };
  server = createServer(createHandler({ dist, api: { '/api/mcp': (req, res) => mcp(req, res, env) }, log: (line) => logs.push(line) }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});
after(async () => {
  Object.assign(console, keep);
  await new Promise((ok) => server.close(ok));
  rmSync(base, { recursive: true, force: true });
});
beforeEach(() => { env = freshEnv(); resetMcpLimits(); });

const call = ({ method = 'POST', path = '/api/mcp', headers = {}, body } = {}) => new Promise((done, fail) => {
  const sent = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
  const req = request({ host: '127.0.0.1', port, path, method, headers: sent }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      done({ status: res.statusCode, headers: res.headers, text, json });
    });
  });
  req.on('error', fail);
  if (body !== undefined) req.write(body);
  req.end();
});
const post = (message, headers = {}) => call({ headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers }, body: typeof message === 'string' ? message : JSON.stringify(message) });
let ids = 0;
const legacy = (method, params, headers) => post({ jsonrpc: '2.0', id: ++ids, method, ...(params === undefined ? {} : { params }) }, headers);
const META = { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' } };
const modern = (method, params = {}, headers = {}, meta = META) => post(
  { jsonrpc: '2.0', id: ++ids, method, params: { ...params, _meta: meta } },
  { 'mcp-protocol-version': MODERN, 'mcp-method': method, ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}), ...headers },
);
const toolText = (reply) => reply.json.result.content[0].text;
const toolJson = (reply) => JSON.parse(toolText(reply));

test('switched off unless MCP_TOKEN has at least 32 characters, and then it looks like any unknown /api route', async () => {
  const unknown = await call({ path: '/api/no-such-route', headers: { 'content-type': 'application/json' }, body: '{}' });
  for (const token of [undefined, '', 'x'.repeat(31), ' '.repeat(40)]) {
    env = freshEnv({ MCP_TOKEN: token });
    for (const reply of [
      await legacy('initialize', { protocolVersion: '2025-11-25', capabilities: {} }),
      await call({ method: 'GET' }),
      await call({ method: 'DELETE', headers: { origin: 'https://evil.example' } }),
    ]) {
      assert.equal(reply.status, 404, `token ${JSON.stringify(token)}`);
      assert.equal(reply.text, unknown.text);
      for (const name of ['content-type', 'cache-control']) assert.equal(reply.headers[name], unknown.headers[name], name);
      for (const name of ['x-robots-tag', 'www-authenticate', 'allow', 'mcp-session-id']) assert.equal(reply.headers[name], undefined, name);
    }
  }
  assert.deepEqual(unknown.json, { ok: false, error: 'Not found' });
  env = freshEnv({ MCP_TOKEN: 'k'.repeat(32) });
  assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: `Bearer ${'k'.repeat(32)}` })).status, 200, '32 characters is enough');
});

test('sign-in: the token with or without "Bearer"; anything else is 401 and logged without the token', async () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const authorization of [undefined, '', 'Bearer', `Bearer ${TOKEN.slice(1)}`, `Basic ${TOKEN}`, TOKEN.toUpperCase()]) {
    const reply = await post(ping, { authorization });
    assert.equal(reply.status, 401, String(authorization));
    assert.equal(reply.headers['www-authenticate'], 'Bearer');
    assert.deepEqual(reply.json, { ok: false, error: 'Unauthorized' });
  }
  for (const authorization of [`Bearer ${TOKEN}`, TOKEN, `bearer ${TOKEN}`, ` Bearer  ${TOKEN} `]) {
    const reply = await post(ping, { authorization });
    assert.equal(reply.status, 200, authorization);
    assert.deepEqual(reply.json, { jsonrpc: '2.0', id: 1, result: {} });
  }
  assert.ok(logs.includes('[security] mcp sign-in failed from 127.0.0.1'));
  assert.ok(!logs.join('\n').includes(TOKEN) && !logs.join('\n').includes(TOKEN.slice(1)), 'the token is never logged');
});

test('after ten failed sign-ins an address gets 429 for wrong tokens, and the right token still gets in', async () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  const from = (ip, authorization) => post(ping, { authorization, 'x-forwarded-for': ip });
  for (let i = 0; i < 10; i += 1) assert.equal((await from('192.0.2.50', 'Bearer wrong')).status, 401);
  const failuresLogged = logs.filter((line) => line.includes('mcp sign-in failed')).length;
  const locked = await from('192.0.2.50', 'Bearer wrong again');
  assert.equal(locked.status, 429);
  assert.equal(locked.headers['retry-after'], '900');
  assert.equal(logs.filter((line) => line.includes('mcp sign-in failed')).length, failuresLogged, 'a turned-away attempt adds no log line');
  // Wrong tokens sent from a shared address (a provider's servers) must not shut the owner's assistant out.
  assert.equal((await from('192.0.2.50', `Bearer ${TOKEN}`)).status, 200, 'the right token gets in from the same address');
  assert.equal((await from('192.0.2.51', `Bearer ${TOKEN}`)).status, 200, 'another address gets in');

  // No address at all is one shared bucket, not "no limit".
  const direct = async (authorization) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await mcp({ method: 'POST', headers: { authorization }, body: JSON.stringify(ping) }, res, env);
    return res;
  };
  for (let i = 0; i < 10; i += 1) assert.equal((await direct('Bearer wrong')).statusCode, 401);
  const shared = await direct('Bearer wrong again');
  assert.equal(shared.statusCode, 429);
  assert.equal(shared.headers['retry-after'], '900');
  assert.equal((await direct(`Bearer ${TOKEN}`)).statusCode, 200);
  assert.ok(logs.includes('[security] mcp sign-in failed from unknown'));
});

test('signed-in calls are limited to 120 a minute in total', async () => {
  for (let i = 0; i < 120; i += 1) assert.equal((await legacy('ping')).status, 200, `call ${i + 1}`);
  const over = await legacy('ping');
  assert.equal(over.status, 429);
  assert.equal(over.headers['retry-after'], '60');
});

test('Origin: none, the site\'s own or a listed one is fine; any other is 403 before the token is looked at; no CORS headers', async () => {
  env = freshEnv({ MCP_ALLOWED_ORIGINS: 'https://grok.example, https://other.example' });
  logs.length = 0;
  for (const origin of [undefined, 'https://www.callharbison.com', 'https://grok.example', 'https://other.example']) {
    const reply = await legacy('ping', undefined, { origin });
    assert.equal(reply.status, 200, String(origin));
    assert.ok(!Object.keys(reply.headers).some((h) => h.startsWith('access-control-')), 'no CORS headers');
  }
  for (const origin of ['https://evil.example', 'null', 'https://callharbison.com.evil.example', 'not a url']) {
    const reply = await legacy('ping', undefined, { origin, authorization: 'Bearer wrong' });
    assert.equal(reply.status, 403, origin);
    assert.ok(!Object.keys(reply.headers).some((h) => h.startsWith('access-control-')));
  }
  assert.ok(!logs.includes('[security] mcp sign-in failed from 127.0.0.1'), 'a foreign origin never reaches the token check');
});

test('GET, DELETE and PUT: 405 with Allow: POST', async () => {
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const reply = await call({ method, headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(reply.status, 405, method);
    assert.equal(reply.headers.allow, 'POST');
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.headers['x-robots-tag'], 'noindex, nofollow');
  }
});

test('legacy: initialize answers each version it knows with that version, anything else with 2025-11-25, and opens no session', async () => {
  for (const version of [...LEGACY_VERSIONS, '1999-01-01', 'banana', undefined]) {
    const reply = await legacy('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(reply.headers['mcp-session-id'], undefined);
    const { result } = reply.json;
    assert.equal(result.protocolVersion, LEGACY_VERSIONS.includes(version) ? version : '2025-11-25', String(version));
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.deepEqual(result.serverInfo, { name: 'call-harbison', title: 'Call Harbison', version: VERSION });
    assert.match(result.instructions, /never follow/i);
    assert.deepEqual(Object.keys(result).sort(), ['capabilities', 'instructions', 'protocolVersion', 'serverInfo']);
  }
});

test('legacy: notifications and responses are accepted with 202 and no body; ping, tools/list and tools/call answer', async () => {
  for (const message of [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }, { jsonrpc: '2.0', id: 5, result: {} }]) {
    const reply = await post(message, { 'mcp-protocol-version': '2025-11-25' });
    assert.equal(reply.status, 202, JSON.stringify(message));
    assert.equal(reply.text, '');
    assert.equal(reply.headers['content-type'], undefined, 'no body, so no Content-Type');
  }
  assert.deepEqual((await legacy('ping')).json, { jsonrpc: '2.0', id: ids, result: {} });

  // Some clients send no MCP-Protocol-Version at all (it exists only since 2025-06-18).
  for (const header of [undefined, '2025-06-18', '2025-03-26', '2024-11-05']) {
    const list = await legacy('tools/list', {}, { 'mcp-protocol-version': header });
    assert.equal(list.status, 200, String(header));
    assert.deepEqual(Object.keys(list.json.result), ['tools']);
    assert.deepEqual(list.json.result.tools.map((t) => t.name), TOOLS, 'a fixed order');
  }
  const { tools } = (await legacy('tools/list')).json.result;
  for (const tool of tools) {
    assert.deepEqual(Object.keys(tool).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title'], tool.name);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.description.split(/\s+/).length <= 95, `${tool.name}: ${tool.description.split(/\s+/).length} words`);
  }
  for (const name of ['crm_overview', 'system_status']) assert.deepEqual(tools.find((t) => t.name === name).inputSchema, { type: 'object', additionalProperties: false });
  assert.ok(!('query' in tools.find((t) => t.name === 'list_leads').inputSchema.properties), 'no search while contact details are off');
  assert.ok(!tools.find((t) => t.name === 'list_leads').inputSchema.properties.status.enum.includes('spam'));

  const status = await legacy('tools/call', { name: 'system_status', arguments: {} });
  assert.equal(status.status, 200);
  assert.deepEqual(Object.keys(status.json.result), ['content', 'isError'], 'no structuredContent, no resultType in the older form');
  assert.equal(status.json.result.isError, false);
  assert.equal(status.json.result.content.length, 1);
  assert.equal(status.json.result.content[0].type, 'text');
  const body = toolJson(status);
  assert.deepEqual(Object.keys(body).slice(0, 2), ['as_of', 'timezone']);
  assert.equal(body.timezone, 'America/Los_Angeles');
  assert.equal(body.database.answering, false, 'no database is open in this file');
  assert.equal(body.contact_details_shared, false);
  const noArguments = await legacy('tools/call', { name: 'system_status' });
  assert.equal(noArguments.json.result.isError, false, 'arguments may be left out');
});

test('legacy: errors', async () => {
  const unknownMethod = await legacy('resources/list');
  assert.equal(unknownMethod.status, 200);
  assert.deepEqual(unknownMethod.json, { jsonrpc: '2.0', id: ids, error: { code: -32601, message: 'Method not found' } });
  const discoverWithoutMeta = await legacy('server/discover');
  assert.equal(discoverWithoutMeta.json.error.code, -32601, 'without _meta a request is the older form, which has no server/discover');
  const unknownTool = await legacy('tools/call', { name: 'nope', arguments: {} });
  assert.equal(unknownTool.status, 200);
  assert.deepEqual(unknownTool.json.error, { code: -32602, message: 'Unknown tool: nope' });

  const parse = await post('{"jsonrpc":"2.0","id":1,"method":');
  assert.equal(parse.status, 400);
  assert.deepEqual(parse.json, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
  assert.equal((await post('')).json.error.code, -32700, 'an empty body is not JSON');
  const batch = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assert.equal(batch.status, 400);
  assert.equal(batch.json.error.code, -32600);
  for (const message of [{ jsonrpc: '1.0', id: 1, method: 'ping' }, { id: 1, method: 'ping' }, 'null', '"ping"', { jsonrpc: '2.0', id: null, method: 'ping' }, { jsonrpc: '2.0', id: 1.5, method: 'ping' }, { jsonrpc: '2.0', id: { a: 1 }, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0' }]) {
    const reply = await post(message);
    assert.equal(reply.status, 400, JSON.stringify(message));
    assert.equal(reply.json.error.code, -32600, JSON.stringify(message));
  }
  const nonsense = await legacy('tools/list', {}, { 'mcp-protocol-version': 'banana' });
  assert.equal(nonsense.status, 400);
  assert.deepEqual(nonsense.json.error, { code: -32022, message: 'Unsupported protocol version', data: { supported: SUPPORTED_VERSIONS, requested: 'banana' } });
  for (const params of [[1, 2], 'x']) assert.equal((await legacy('tools/list', params)).json.error.code, -32602);
  assert.equal((await legacy('tools/call', { arguments: {} })).json.error.code, -32602, 'no tool name');
  assert.equal((await legacy('tools/call', { name: 'system_status', arguments: [1] })).json.error.code, -32602, 'arguments not an object');
});

test('a bad argument is a tool result with isError and a sentence that says how to fix the call', async () => {
  const cases = [
    ['system_status', { verbose: true }, /Unknown argument: verbose\. This tool takes no arguments/],
    ['crm_overview', { days: 3 }, /Unknown argument: days/],
    ['list_leads', { limit: 0 }, /limit must be a whole number from 1 to 50/],
    ['list_leads', { limit: 51 }, /limit must be a whole number from 1 to 50/],
    ['list_leads', { offset: -1 }, /offset must be a whole number/],
    ['list_leads', { view: 'trash' }, /view must be one of: open, new, followups, closed, all/],
    ['list_leads', { status: 'spam' }, /spam are not shown/],
    ['list_leads', { status: 'won' }, /status must be one of: new, contact_attempted/],
    ['list_leads', { route: 'cash' }, /route must be one of: direct, listing/],
    ['list_leads', { brand: 'other' }, /brand must be one of/],
    ['list_leads', { created_after: 'last week' }, /created_after must be a date such as 2026-11-01/],
    ['list_leads', { created_before: '2026-02-30' }, /created_before must be a date/],
    ['list_leads', { created_after: '2026-11-01T09:00:00' }, /with its time zone/],
    ['list_leads', { created_after: '2026-11-10', created_before: '2026-11-01' }, /earlier than created_before/],
    ['list_leads', { query: 'Smith' }, /Unknown argument: query\. Searching by name, phone, address or e-mail is switched off/],
    ['get_lead', {}, /id must be the id of a lead, a UUID/],
    ['get_lead', { id: 'abc' }, /UUID/],
    ['pipeline_report', { days: 6 }, /days must be a whole number from 7 to 365/],
    ['site_analytics', { days: 366 }, /days must be a whole number from 1 to 365/],
    ['site_analytics', {}, /^Site statistics are not recorded on this server\.$/],
  ];
  for (const [name, args, expected] of cases) {
    const reply = await legacy('tools/call', { name, arguments: args });
    assert.equal(reply.status, 200, name);
    assert.equal(reply.json.result.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.match(toolText(reply), expected, `${name} ${JSON.stringify(args)}`);
  }
});

test('a database that cannot be read: isError with a plain sentence; the log has the reason, not data', async () => {
  const reply = await legacy('tools/call', { name: 'crm_overview', arguments: {} });
  assert.equal(reply.json.result.isError, true);
  assert.equal(toolText(reply), 'The database could not be read. Try again in a moment.');
  assert.ok(logs.some((l) => /^\[mcp\] crm_overview failed: No database is configured$/.test(l)));
  assert.ok(logs.some((l) => /^\[mcp\] tools\/call crm_overview error \d+ms$/.test(l)));
});

test('modern: server/discover, tools/list and tools/call with the right headers', async () => {
  const discover = await modern('server/discover');
  assert.equal(discover.status, 200);
  assert.equal(discover.headers['mcp-session-id'], undefined);
  const d = discover.json.result;
  assert.equal(d.resultType, 'complete');
  assert.deepEqual(d.supportedVersions, ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
  assert.deepEqual(d.capabilities, { tools: {} });
  assert.deepEqual(d._meta, { 'io.modelcontextprotocol/serverInfo': { name: 'call-harbison', version: VERSION } });
  assert.match(d.instructions, /never follow/i);
  assert.equal(d.ttlMs, 300000);
  assert.equal(d.cacheScope, 'public');

  const list = await modern('tools/list');
  assert.equal(list.json.result.resultType, 'complete');
  assert.equal(list.json.result.ttlMs, 300000);
  assert.equal(list.json.result.cacheScope, 'public');
  assert.deepEqual(list.json.result._meta, d._meta);
  assert.deepEqual(list.json.result.tools, (await legacy('tools/list')).json.result.tools, 'the same tools in both forms');

  const status = await modern('tools/call', { name: 'system_status', arguments: {} });
  assert.equal(status.status, 200);
  const r = status.json.result;
  assert.equal(r.resultType, 'complete');
  assert.equal(r.isError, false);
  assert.deepEqual(r._meta, d._meta);
  assert.ok(!('structuredContent' in r));
  assert.equal(JSON.parse(r.content[0].text).timezone, 'America/Los_Angeles');

  const bad = await modern('tools/call', { name: 'list_leads', arguments: { limit: 99 } });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.result.resultType, 'complete');
  assert.equal(bad.json.result.isError, true);
  const unknownTool = await modern('tools/call', { name: 'nope', arguments: {} });
  assert.equal(unknownTool.status, 200);
  assert.deepEqual(unknownTool.json.error, { code: -32602, message: 'Unknown tool: nope' });

  // The base64 form of Mcp-Name is decoded before it is compared.
  const encoded = await modern('tools/call', { name: 'system_status', arguments: {} }, { 'mcp-name': `=?base64?${Buffer.from('system_status').toString('base64')}?=` });
  assert.equal(encoded.status, 200);
  assert.equal(encoded.json.result.isError, false);
});

test('modern: every required field and header, and what happens when one is missing or different', async () => {
  const mismatch = async (reply, why) => {
    assert.equal(reply.status, 400, why);
    assert.equal(reply.json.error.code, -32020, why);
    assert.equal(reply.json.id, ids, why);
  };
  const malformed = async (reply, why) => {
    assert.equal(reply.status, 400, why);
    assert.equal(reply.json.error.code, -32602, why);
  };
  await malformed(await modern('tools/list', {}, {}, { 'io.modelcontextprotocol/protocolVersion': MODERN }), 'no clientCapabilities');
  await malformed(await modern('tools/list', {}, {}, { ...META, 'io.modelcontextprotocol/clientCapabilities': 'all' }), 'clientCapabilities not an object');
  await malformed(await modern('tools/list', {}, {}, { 'io.modelcontextprotocol/clientCapabilities': {} }), 'header modern, no version in _meta');
  await malformed(await post({ jsonrpc: '2.0', id: ++ids, method: 'tools/list' }, { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/list' }), 'header modern, no params at all');
  await malformed(await post({ jsonrpc: '2.0', id: ++ids, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } }, { 'mcp-protocol-version': MODERN, 'mcp-method': 'initialize' }), 'a legacy handshake sent with a modern header');

  await mismatch(await modern('tools/list', {}, { 'mcp-protocol-version': undefined }), 'no MCP-Protocol-Version');
  await mismatch(await modern('tools/list', {}, { 'mcp-protocol-version': '2025-11-25' }), 'header and _meta differ');
  await mismatch(await modern('tools/list', {}, { 'mcp-method': undefined }), 'no Mcp-Method');
  await mismatch(await modern('tools/list', {}, { 'mcp-method': 'tools/call' }), 'Mcp-Method differs');
  await mismatch(await modern('tools/call', { name: 'system_status', arguments: {} }, { 'mcp-name': undefined }), 'no Mcp-Name');
  await mismatch(await modern('tools/call', { name: 'system_status', arguments: {} }, { 'mcp-name': 'crm_overview' }), 'Mcp-Name differs');
  await mismatch(await modern('tools/call', { name: 'system_status', arguments: {} }, { 'mcp-name': `=?base64?${Buffer.from('crm_overview').toString('base64')}?=` }), 'base64 Mcp-Name differs');
  await mismatch(await modern('tools/call', { name: 'system_status', arguments: {} }, { 'mcp-name': '=?base64?not*base64?=' }), 'Mcp-Name is not valid base64');

  const future = { ...META, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' };
  const unsupported = await modern('tools/list', {}, { 'mcp-protocol-version': '2027-01-01' }, future);
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.json.id, ids);
  assert.deepEqual(unsupported.json.error, { code: -32022, message: 'Unsupported protocol version', data: { supported: SUPPORTED_VERSIONS, requested: '2027-01-01' } });
  await mismatch(await modern('tools/list', {}, { 'mcp-protocol-version': undefined }, future), 'a version in _meta alone must still come with its header');

  for (const method of ['resources/list', 'ping', 'initialize', 'prompts/list']) {
    const reply = await modern(method);
    assert.equal(reply.status, 404, method);
    assert.deepEqual(reply.json.error, { code: -32601, message: 'Method not found' }, method);
  }
});

test('Mcp-Name values: plain, base64 and the examples of the specification', () => {
  assert.equal(decodeHeaderValue('us-west1'), 'us-west1');
  assert.equal(decodeHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?='), 'Hello, 世界');
  assert.equal(decodeHeaderValue('=?base64?IHBhZGRlZCA=?='), ' padded ');
  assert.equal(decodeHeaderValue('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?='), '=?base64?literal?=');
  assert.equal(decodeHeaderValue('café'), null, 'not a plain header value');
  assert.equal(decodeHeaderValue('=?base64?@@@?='), null);
});

test('logs: one line per call with method, tool, outcome and time; never arguments, unknown names or the token', async () => {
  logs.length = 0;
  await legacy('tools/call', { name: 'system_status', arguments: {} });
  await legacy('call 661-555-0199 now');
  await legacy('tools/call', { name: 'lookup 6615550199', arguments: {} });
  await legacy('tools/call', { name: 'list_leads', arguments: { created_after: '661-555-0199 Elm St' } });
  await post({ jsonrpc: '2.0', method: 'notifications/661-555-0199' });
  await post('{"jsonrpc":"2.0","id":1,"method":"6615550199"');
  const text = logs.join('\n');
  assert.ok(logs.some((l) => /^\[mcp\] tools\/call system_status ok \d+ms$/.test(l)), text);
  assert.ok(logs.some((l) => /^\[mcp\] \(other method\) rejected \d+ms$/.test(l)), text);
  assert.ok(logs.some((l) => /^\[mcp\] tools\/call \(unknown tool\) rejected \d+ms$/.test(l)), text);
  assert.ok(logs.some((l) => /^\[mcp\] tools\/call list_leads error \d+ms$/.test(l)), text);
  assert.ok(logs.some((l) => /^\[mcp\] \(other method\) accepted \d+ms$/.test(l)), text);
  assert.ok(logs.some((l) => /^\[mcp\] \(invalid message\) rejected \d+ms$/.test(l)), text);
  assert.ok(logs.some((l) => /^POST \/api\/mcp 200 \d+ms$/.test(l)), 'server.mjs logs the route only');
  for (const secret of [TOKEN, '555-0199', '5550199', 'Elm St']) assert.ok(!text.includes(secret), secret);
});

// scripts/mcp-check.mjs against this server. It cannot pass here (no database), so these are its failures; the
// passing run is in test/mcp-tools.test.js.
const check = (target, token) => new Promise((done) => {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'mcp-check.mjs'), target], { env: { PATH: process.env.PATH, ...(token ? { MCP_TOKEN: token } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.on('close', (code) => done({ code, out }));
});

test('scripts/mcp-check.mjs says plainly what is wrong and exits 1', async () => {
  const target = `http://127.0.0.1:${port}/api/mcp`;
  const wrong = await check(target, 'w'.repeat(40));
  assert.equal(wrong.code, 1);
  assert.match(wrong.out, /FAILED: 1\. Handshake: 401, the server refused the token/);
  assert.ok(!wrong.out.includes('w'.repeat(40)), 'the token is not printed');
  const missing = await check(target, '');
  assert.equal(missing.code, 1);
  assert.match(missing.out, /set MCP_TOKEN/);
  env = freshEnv({ MCP_TOKEN: '' });
  const off = await check(target, TOKEN);
  assert.equal(off.code, 1);
  assert.match(off.out, /404, nothing answers at that address: MCP is switched off/);
  env = freshEnv();
  const noDatabase = await check(target, TOKEN);
  assert.equal(noDatabase.code, 1);
  assert.match(noDatabase.out, /1\. Handshake \(older protocol\): OK/);
  assert.match(noDatabase.out, /FAILED: 3\. System status: the database does not answer\./);
});
