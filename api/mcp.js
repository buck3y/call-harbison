// MCP server for the owner's AI assistant: POST /api/mcp, read-only (docs/MCP.md).
//
// It does not exist unless MCP_TOKEN is set to at least 32 characters: until then every request gets the same 404 as
// an unknown /api route. This file does the HTTP checks, in this order: switched on, POST only, Origin, rate limits
// and the token. The protocol is in lib/mcp/protocol.js, the tools in lib/mcp/tools.js, and the one database reader,
// which can only send GET, in lib/mcp/crm-read.js.
//
// Env: MCP_TOKEN (required, 32+ characters; "Authorization: Bearer <token>" or the bare token), MCP_CONTACT_DETAILS=on
// (optional: names, phones, e-mail, addresses and notes in replies), MCP_ALLOWED_ORIGINS (optional, comma-separated
// browser origins besides SITE_URL's; servers send no Origin).
//
// Logs: one line per call, "[mcp] tools/call crm_overview ok 12ms". Never the arguments (a search can hold a name or
// a phone number), never a result, never the token.
import { createHash, timingSafeEqual } from 'node:crypto';
import { addressForLog, clientIp, createRateLimiter, rateKey } from '../lib/request-ip.js';
import { CODES, dispatch, failure, parseMessage } from '../lib/mcp/protocol.js';
import { createTools } from '../lib/mcp/tools.js';

export const signInLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60e3 }); // failed sign-ins per address
export const callLimiter = createRateLimiter({ max: 120, windowMs: 60e3 }); // signed-in calls, all callers together
export const resetMcpLimits = () => { signInLimiter.reset(); callLimiter.reset(); };

const configuredToken = (env) => {
  const token = String(env.MCP_TOKEN || '').trim();
  return token.length >= 32 ? token : null;
};

// Both sides are hashed, so the comparison takes the same time whatever was sent (as in lib/shared-intake.js).
function tokenMatches(header, token) {
  if (typeof header !== 'string') return false;
  const given = header.trim().replace(/^Bearer\s+/i, '');
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(token).digest());
}

const originOf = (value) => {
  try { const { origin } = new URL(String(value).trim()); return origin === 'null' ? null : origin; } catch { return null; }
};

// A server calling a server sends no Origin. A browser does, and may only come from the site itself or an origin
// the owner listed: this stops a web page from using a visitor's browser to reach the endpoint.
function originAllowed(origin, env) {
  if (origin === undefined) return true;
  const site = (env.SITE_URL || 'https://www.callharbison.com').replace(/\/$/, '');
  const allowed = new Set([site, ...String(env.MCP_ALLOWED_ORIGINS || '').split(',')].map(originOf).filter(Boolean));
  const given = originOf(origin);
  return Boolean(given) && allowed.has(given);
}

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
};

export default async function handler(req, res, env = process.env) {
  const token = configuredToken(env);
  if (!token) {
    // Exactly what server.mjs answers for an /api path it does not know.
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 404, { ok: false, error: 'Not found' });
  }
  const started = Date.now();
  const headers = req.headers || {};
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  // GET (a stream) and DELETE (ending a session) belong to older revisions; this server has neither.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }
  if (!originAllowed(headers.origin, env)) {
    console.warn('[security] mcp request refused: its Origin is not allowed');
    return send(res, 403, { ok: false, error: 'Forbidden' });
  }
  // The right token always gets in. A lockout that also refused it would let anyone shut the owner's assistant out by
  // sending wrong tokens through the same provider, whose servers share addresses. The token is long and random, so
  // guessing it is not a practical attack; counting failures per address only keeps the answers and the log short.
  // One bucket per IPv4 address or IPv6 /64; an address that cannot be told is one shared bucket, never "no limit".
  if (!tokenMatches(headers.authorization, token)) {
    const ip = rateKey(clientIp(req));
    if (signInLimiter.isLimited(ip)) {
      res.setHeader('Retry-After', '900');
      return send(res, 429, { ok: false, error: 'Too many failed sign-ins. Try again in 15 minutes.' });
    }
    signInLimiter.hit(ip);
    console.warn(`[security] mcp sign-in failed from ${addressForLog(ip)}`);
    res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, 401, { ok: false, error: 'Unauthorized' });
  }
  if (callLimiter.hit('all').limited) {
    res.setHeader('Retry-After', '60');
    return send(res, 429, { ok: false, error: 'Too many requests. Try again in a minute.' });
  }

  const log = (name, outcome) => console.log(`[mcp] ${name} ${outcome} ${Date.now() - started}ms`);
  // server.mjs hands the body over as text. On Vercel it is already parsed, and reading it throws if it is not JSON.
  let body;
  try { body = req.body; } catch { body = undefined; }
  const parsed = parseMessage(body);
  if (parsed.reply) {
    log('(invalid message)', 'rejected');
    return send(res, parsed.reply.status, parsed.reply.body);
  }
  if (parsed.accepted) {
    // A notification or a response: accepted, nothing to answer. No Content-Type, as there is no body.
    log(parsed.accepted, 'accepted');
    res.status(202);
    return res.end();
  }
  let out;
  try {
    out = await dispatch(parsed.request, headers, createTools(env));
  } catch (err) {
    console.error(`[mcp] internal error: ${err.message}`);
    const internal = failure(500, parsed.request.id, CODES.internal, 'Internal error');
    return send(res, internal.status, internal.body);
  }
  log(`${out.summary.method}${out.summary.tool ? ` ${out.summary.tool}` : ''}`, out.summary.outcome);
  return send(res, out.status, out.body);
}
