// The Model Context Protocol, written by hand for one endpoint: JSON-RPC 2.0 in a single POST, one JSON reply, no
// sessions, no event streams and no requests from the server. api/mcp.js does the HTTP checks (token, origin, rate
// limits) and hands the body here; lib/mcp/tools.js supplies the tools.
//
// It is "dual-era" (https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), answering both on
// the same endpoint, because we do not know which one a client such as xAI's speaks:
//   modern  2026-07-28. No handshake. Every request names its version in params._meta and in the
//           MCP-Protocol-Version header, and mirrors `method` (and the tool name) in Mcp-Method / Mcp-Name headers.
//           Results carry resultType and the server's identity; lists carry caching hints.
//   legacy  2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05. `initialize` first, then plain JSON-RPC. We keep no
//           session, so any request is answered whether or not `initialize` came before it.
// A request is modern when its _meta names a version that is not a legacy one, or its header names a modern version.

import { readFileSync } from 'node:fs';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
const PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
const MODERN_METHODS = ['server/discover', 'tools/list', 'tools/call'];
const LEGACY_METHODS = ['initialize', 'ping', 'tools/list', 'tools/call'];
// Method names a client sends are its own text: only these are ever written to the log.
const NAMED_IN_LOGS = new Set([...MODERN_METHODS, ...LEGACY_METHODS, 'notifications/initialized', 'notifications/cancelled']);
const CACHE = { ttlMs: 300000, cacheScope: 'public' }; // the tool list is the same for every caller and holds nothing private

let version = '0.0.0';
try { version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || version; } catch {}
export const SERVER = { name: 'call-harbison', title: 'Call Harbison', version };

export const CODES = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, headerMismatch: -32020, unsupportedVersion: -32022 };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (id) => typeof id === 'string' || Number.isInteger(id);
export const logName = (method) => (NAMED_IN_LOGS.has(method) ? method : '(other method)');

export function failure(status, id, code, message, data) {
  return { status, body: { jsonrpc: '2.0', ...(validId(id) ? { id } : {}), error: { code, message, ...(data === undefined ? {} : { data }) } } };
}

// One message from the POST body: { reply } to send back at once, { accepted } for a notification or a response
// (202, no body), or { request } to dispatch.
export function parseMessage(raw) {
  let message = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try { message = JSON.parse(String(raw)); } catch { return { reply: failure(400, undefined, CODES.parse, 'Parse error') }; }
  } else if (raw === undefined || raw === null) {
    return { reply: failure(400, undefined, CODES.parse, 'Parse error') };
  }
  if (Array.isArray(message)) return { reply: failure(400, undefined, CODES.invalidRequest, 'Invalid Request: send one JSON-RPC message per request, not a batch') };
  if (!isObject(message) || message.jsonrpc !== '2.0') return { reply: failure(400, message?.id, CODES.invalidRequest, 'Invalid Request: not a JSON-RPC 2.0 message') };
  const hasMethod = typeof message.method === 'string';
  if (!hasMethod && ('result' in message || 'error' in message)) return { accepted: '(response)' };
  if (!Object.hasOwn(message, 'id')) {
    return hasMethod ? { accepted: logName(message.method) } : { reply: failure(400, undefined, CODES.invalidRequest, 'Invalid Request: no method') };
  }
  if (!validId(message.id)) return { reply: failure(400, undefined, CODES.invalidRequest, 'Invalid Request: id must be a string or an integer') };
  if (!hasMethod) return { reply: failure(400, message.id, CODES.invalidRequest, 'Invalid Request: method must be a string') };
  return { request: message };
}

// Mcp-Name may carry a name that is not plain ASCII as =?base64?<base64 of UTF-8>?=. Returns null when the header is
// not a valid header value at all.
export function decodeHeaderValue(value) {
  if (typeof value !== 'string' || /[^\x20-\x7e\t]/.test(value)) return null;
  if (!(value.startsWith('=?base64?') && value.endsWith('?=') && value.length >= 11)) return value;
  const encoded = value.slice(9, -2);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

// `server` is { tools, instructions, has(name), call(name, args) -> { content, isError } }.
// Returns { status, body, summary: { method, tool?, outcome } }; the summary is all that may be logged.
export async function dispatch(request, headers, server) {
  const { id, method } = request;
  const header = (name) => {
    const value = headers?.[name];
    return value === undefined ? undefined : String(Array.isArray(value) ? value[0] : value);
  };
  const summary = { method: logName(method) };
  const reject = (status, code, message, data) => ({ ...failure(status, id, code, message, data), summary: { ...summary, outcome: 'rejected' } });
  const unsupported = (requested) => reject(400, CODES.unsupportedVersion, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: String(requested).slice(0, 100) });

  const versionHeader = header('mcp-protocol-version');
  if (versionHeader !== undefined && !SUPPORTED_VERSIONS.includes(versionHeader)) return unsupported(versionHeader);
  const params = request.params;
  const meta = isObject(params) && isObject(params._meta) ? params._meta : null;
  const metaVersion = meta && Object.hasOwn(meta, PROTOCOL_VERSION) ? meta[PROTOCOL_VERSION] : undefined;
  const modern = MODERN_VERSIONS.includes(versionHeader) || (metaVersion !== undefined && !LEGACY_VERSIONS.includes(metaVersion));

  if (params !== undefined && !isObject(params)) return reject(modern ? 400 : 200, CODES.invalidParams, 'Invalid params: params must be an object');

  // A tool call, the same in both eras apart from how the result is wrapped.
  const callTool = async (malformedStatus) => {
    const name = params?.name;
    if (typeof name !== 'string' || !name) return reject(malformedStatus, CODES.invalidParams, 'Invalid params: tools/call needs params.name, the name of a tool');
    if (!server.has(name)) return { ...reject(200, CODES.invalidParams, `Unknown tool: ${name.slice(0, 128)}`), summary: { ...summary, tool: '(unknown tool)', outcome: 'rejected' } };
    const args = params.arguments ?? {};
    if (!isObject(args)) return { ...reject(malformedStatus, CODES.invalidParams, 'Invalid params: arguments must be an object'), summary: { ...summary, tool: name, outcome: 'rejected' } };
    const result = await server.call(name, args);
    return { status: 200, result, summary: { ...summary, tool: name, outcome: result.isError ? 'error' : 'ok' } };
  };

  if (!modern) {
    const ok = (result, extra = {}) => ({ status: 200, body: { jsonrpc: '2.0', id, result }, summary: { ...summary, outcome: 'ok', ...extra } });
    if (method === 'initialize') {
      const requested = params?.protocolVersion;
      return ok({
        // "If the server supports the requested protocol version, it MUST respond with the same version. Otherwise
        // ... another protocol version it supports", the newest one.
        protocolVersion: LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { ...SERVER },
        instructions: server.instructions,
      });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: server.tools });
    if (method === 'tools/call') {
      const out = await callTool(200);
      return out.result ? { status: 200, body: { jsonrpc: '2.0', id, result: { content: out.result.content, isError: out.result.isError } }, summary: out.summary } : out;
    }
    return reject(200, CODES.methodNotFound, 'Method not found');
  }

  // ---------- Modern (2026-07-28) ----------
  if (versionHeader === undefined) return reject(400, CODES.headerMismatch, 'Header mismatch: the MCP-Protocol-Version header is required');
  if (!meta || typeof meta[PROTOCOL_VERSION] !== 'string' || !isObject(meta[CLIENT_CAPABILITIES])) {
    return reject(400, CODES.invalidParams, `Invalid params: params._meta must carry ${PROTOCOL_VERSION} (a string) and ${CLIENT_CAPABILITIES} (an object)`);
  }
  if (meta[PROTOCOL_VERSION] !== versionHeader) return reject(400, CODES.headerMismatch, `Header mismatch: the MCP-Protocol-Version header does not match ${PROTOCOL_VERSION}`);
  if (!MODERN_VERSIONS.includes(versionHeader)) return unsupported(versionHeader);
  const methodHeader = header('mcp-method');
  if (methodHeader === undefined) return reject(400, CODES.headerMismatch, 'Header mismatch: the Mcp-Method header is required');
  if (methodHeader !== method) return reject(400, CODES.headerMismatch, 'Header mismatch: the Mcp-Method header does not match the method in the body');
  if (!MODERN_METHODS.includes(method)) return reject(404, CODES.methodNotFound, 'Method not found');

  const complete = (result) => ({ resultType: 'complete', ...result, _meta: { [SERVER_INFO]: { name: SERVER.name, version: SERVER.version } } });
  const ok = (result) => ({ status: 200, body: { jsonrpc: '2.0', id, result: complete(result) }, summary: { ...summary, outcome: 'ok' } });
  if (method === 'server/discover') {
    return ok({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {} }, instructions: server.instructions, ...CACHE });
  }
  if (method === 'tools/list') return ok({ tools: server.tools, ...CACHE });

  // tools/call: Mcp-Name must equal params.name, after decoding its base64 form.
  if (typeof params?.name !== 'string' || !params.name) return reject(400, CODES.invalidParams, 'Invalid params: tools/call needs params.name, the name of a tool');
  const nameHeader = header('mcp-name');
  if (nameHeader === undefined) return reject(400, CODES.headerMismatch, 'Header mismatch: the Mcp-Name header is required for tools/call');
  if (decodeHeaderValue(nameHeader) !== params.name) return reject(400, CODES.headerMismatch, 'Header mismatch: the Mcp-Name header does not match params.name');
  const out = await callTool(400);
  return out.result ? { status: 200, body: { jsonrpc: '2.0', id, result: complete({ content: out.result.content, isError: out.result.isError }) }, summary: out.summary } : out;
}
