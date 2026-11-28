// Same-origin collector. Only this server can label records as Call Harbison.
// On a server it records on this machine (lib/analytics-store.js). With ANALYTICS_STORE=shared, or on Vercel, each
// event is forwarded to the shared collector at Harbison Standard instead.
import { createHmac } from 'node:crypto';
import { cleanForLog, clientIp, createRateLimiter } from '../lib/request-ip.js';
import { EVENT_NAMES, getAnalyticsStore, isLocalAnalytics } from '../lib/analytics-store.js';
import { isCrossSite } from '../lib/request-origin.js';

// Lines an outsider can cause are capped, so the log cannot be flooded: 30 per 10 minutes each.
const cspLog = createRateLimiter({ max: 30, windowMs: 10 * 60e3 });
const refusalLog = createRateLimiter({ max: 30, windowMs: 10 * 60e3 });
export const resetTrackLogs = () => { cspLog.reset(); refusalLog.reset(); };

// ---------- Content-security-policy reports (/csp-report, rewritten to /api/track?csp=1) ----------
// Browsers post one when the policy blocks something (or, report-only, would have). Two shapes:
//   report-uri: {"csp-report": {"effective-directive", "violated-directive", "blocked-uri", "document-uri", …}}
//   report-to:  [{"type": "csp-violation", "body": {"effectiveDirective", "blockedURL", "documentURL", …}}, …]
// Each becomes one line, "[csp] script-src-elem blocked evil.example on /about": the directive, only the host (or
// the scheme, or a keyword such as inline) of what was blocked, and only the path of the page. Never a query
// string. Each value is cut to 100 characters and stripped of control characters.
const CSP_KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'self', 'data', 'blob', 'trusted-types-policy', 'trusted-types-sink']);
const MAX_REPORTS_PER_POST = 20;

function blockedPart(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'unknown';
  if (CSP_KEYWORDS.has(text.toLowerCase())) return text.toLowerCase();
  try {
    const url = new URL(text);
    return /^(?:https?|wss?):$/.test(url.protocol) ? url.host : url.protocol;
  } catch {}
  const scheme = /^([a-z][a-z0-9+.-]{0,30}):/i.exec(text);
  return scheme ? `${scheme[1].toLowerCase()}:` : 'unknown';
}

function pagePath(value) {
  try { return new URL(String(value ?? '')).pathname || '/'; } catch { return 'unknown'; }
}

export function cspReports(body) {
  let data = body;
  if (Buffer.isBuffer(data)) data = data.toString('utf8');
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return []; } }
  if (Array.isArray(data)) {
    return data.filter((r) => r && typeof r === 'object' && r.type === 'csp-violation' && r.body && typeof r.body === 'object').map((r) => r.body).slice(0, MAX_REPORTS_PER_POST);
  }
  const one = data && typeof data === 'object' ? data['csp-report'] : null;
  return one && typeof one === 'object' && !Array.isArray(one) ? [one] : [];
}

export function cspLine(report) {
  const directive = String(report['effective-directive'] ?? report.effectiveDirective ?? report['violated-directive'] ?? report.violatedDirective ?? '').trim().split(/\s+/)[0] || 'unknown';
  const blocked = blockedPart(report['blocked-uri'] ?? report.blockedURL ?? report.blockedUri);
  const page = pagePath(report['document-uri'] ?? report.documentURL ?? report.documentUri);
  return `[csp] ${cleanForLog(directive, 100) || 'unknown'} blocked ${cleanForLog(blocked, 100) || 'unknown'} on ${cleanForLog(page, 100) || 'unknown'}`;
}

// Only the checked fields go to the store, which reduces the address and user agent to a hash and three categories.
function recordLocally(req, res, env, body, path) {
  try {
    const { stored } = getAnalyticsStore(env).record(
      { sid: body.sid, type: body.type, path, pageToken: body.pageToken, durationSeconds: body.durationSeconds, referrerType: body.referrerType, referrerHost: body.referrerHost, name: body.name },
      { ip: clientIp(req), userAgent: req.headers?.['user-agent'] },
    );
    return res.status(stored ? 200 : 202).json({ ok: true, stored });
  } catch (err) {
    console.error(`[analytics] local store unavailable (${err?.code || err?.message})`);
    return res.status(503).json({ ok: false });
  }
}

export default async function handler(req, res, env = process.env) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url || '/api/track', 'http://x');
  // Another website may not post here: it could only pad the statistics, or fill the CSP log with noise.
  if (req.method === 'POST' && isCrossSite(req, env)) {
    if (!refusalLog.hit('track').limited) console.warn('[security] cross-site POST to /api/track refused');
    return res.status(403).json({ ok: false });
  }
  // Browser CSP report sink (routed from /csp-report in vercel.json without adding a separate function).
  if (url.searchParams.get('csp') === '1') {
    if (req.method === 'POST') {
      for (const report of cspReports(req.body)) {
        if (cspLog.hit('csp').limited) break;
        console.warn(cspLine(report));
      }
    }
    return res.end ? res.status(204).end('') : res.status(204).json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const local = isLocalAnalytics(env);
  if (!local && !env.CRM_INGEST_SECRET) return res.status(503).json({ ok: false });
  if (req.headers?.dnt === '1' || req.headers?.['sec-gpc'] === '1') return res.status(202).json({ ok: true, stored: false });
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { return res.status(400).json({ ok: false }); }
  if (!body || !/^[a-f0-9-]{36}$/i.test(body.sid || '') || !['start', 'pageview', 'heartbeat', 'end', 'event'].includes(body.type)) return res.status(400).json({ ok: false });
  const path = typeof body.path === 'string' ? body.path.split(/[?#]/)[0].slice(0, 300) : '/';
  if (!path.startsWith('/') || path.startsWith('//') || /^\/(hq|api)(\/|$)/.test(path)) return res.status(400).json({ ok: false });
  // Funnel steps, by name only. The shared collector does not know them, so they are recorded only in local mode.
  if (body.type === 'event') {
    if (typeof body.name !== 'string' || !Object.hasOwn(EVENT_NAMES, body.name)) return res.status(400).json({ ok: false });
    if (!local) return res.status(202).json({ ok: true, stored: false });
  }
  if (local) return recordLocally(req, res, env, body, path);
  const ip = clientIp(req) || 'unknown';
  const visitor = createHmac('sha256', env.CRM_INGEST_SECRET).update(`call_harbison:${new Date().toISOString().slice(0, 10)}:${ip}`).digest('hex');
  // Explicit transport allowlist: never forward inquiry fields or arbitrary campaign/title text.
  const payload = { sid: body.sid, type: body.type, site: 'call_harbison', path };
  if (/^[a-f0-9-]{36}$/i.test(body.pageToken || '')) payload.pageToken = body.pageToken;
  if (Number.isFinite(body.durationSeconds)) payload.durationSeconds = Math.max(0, Math.min(1800, Math.round(body.durationSeconds)));
  if (['direct', 'search', 'social', 'referral'].includes(body.referrerType)) payload.referrerType = body.referrerType;
  if (typeof body.referrerHost === 'string' && /^[a-z0-9.-]{1,253}$/i.test(body.referrerHost)) payload.referrerHost = body.referrerHost;
  try {
    const response = await fetch('https://www.harbisonstandard.com/api/track', {
      method: 'POST', signal: AbortSignal.timeout(10000), redirect: 'error',
      headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${env.CRM_INGEST_SECRET}`,
        'x-analytics-user-agent': String(req.headers?.['user-agent'] || '').slice(0, 500),
        'x-analytics-visitor': visitor,
        'x-analytics-country': String(req.headers?.['x-vercel-ip-country'] || ''),
        'x-analytics-region': String(req.headers?.['x-vercel-ip-country-region'] || ''),
        'x-analytics-city': String(req.headers?.['x-vercel-ip-city'] || ''),
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    return res.status(response.status).json({ ok: result.ok === true, stored: result.stored === true });
  } catch {
    console.error('[analytics] Call Harbison collector unavailable');
    return res.status(502).json({ ok: false });
  }
}
