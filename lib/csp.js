// The content security policy of the public pages.
//
// build.mjs reads every page it has written, allows each inline script by the SHA-256 hash of its exact text, and
// writes the policy to dist/csp.json ({ "public": "<policy>" }). server.mjs sends it as Content-Security-Policy on
// every path except /hq* and /api/*, which get their own stricter policies from vercel.json. Nothing else inline may
// run: no inline event handler (onclick="…"), no javascript: URL, no inline script that the build did not hash.
//
// Third-party hosts are allowed only for the tools the build turns on (site.config.mjs, the same settings
// <html data-trackers> reflects): with none configured, scripts come from this site and its hashed inline scripts only.
// A tool that contacts a host not listed here is blocked, and the browser's report shows up in the server log as a
// "[csp]" line (/csp-report is rewritten to /api/track?csp=1).
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GOOGLE = {
  script: ['https://www.googletagmanager.com'],
  connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
  img: ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
};
// static/consent.js loads nothing itself; the Metricool loader in head() fetches be.js from this host, and be.js reports there.
const METRICOOL = 'https://tracker.metricool.com';
const VERCEL_VITALS = 'https://vitals.vercel-insights.com';
// Always: the stock photos, YouTube thumbnails (a background image on the video buttons) and the click-to-load player.
const PHOTOS = ['https://images.unsplash.com', 'https://i.ytimg.com'];
const PLAYER = 'https://www.youtube-nocookie.com';

/** The public policy. hashes: the 'sha256-…' sources of the inline scripts; the rest says which tools the build turned on. */
export function buildPolicy({ hashes = [], speculationRules = true, ga = false, gtm = false, metricool = false, vercelInsights = false } = {}) {
  const google = ga || gtm;
  const script = ["'self'", ...[...new Set(hashes)].sort(), ...(speculationRules ? ["'inline-speculation-rules'"] : []), ...(google ? GOOGLE.script : []), ...(metricool ? [METRICOOL] : [])];
  const img = ["'self'", 'data:', ...PHOTOS, ...(google ? GOOGLE.img : []), ...(metricool ? [METRICOOL] : [])];
  const connect = ["'self'", ...(google ? GOOGLE.connect : []), ...(metricool ? [METRICOOL] : []), ...(vercelInsights ? [VERCEL_VITALS] : [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    // Inline styles cannot run code, and several components set them; the strictness goes into scripts.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(' ')}`,
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    `frame-src ${PLAYER}`,
    "manifest-src 'self'",
    "media-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
    'report-uri /csp-report',
  ].join('; ');
}

// ---------- Reading pages ----------

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'" };
const decode = (value) => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, name) => {
  if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
  if (/^#\d/.test(name)) return String.fromCodePoint(Number(name.slice(1)));
  return ENTITIES[name.toLowerCase()] ?? whole;
});

/** Attributes of one tag as a Map of lower-case name to decoded value (first occurrence wins, as in a browser). */
export function parseAttributes(source) {
  const attrs = new Map();
  for (const m of String(source).matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

/** Every start tag of a page, in order: { name, attrs, text }. text is the content of script, style, textarea and title. */
export function pageTags(html) {
  const tags = [];
  const re = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>|<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (const m of String(html).matchAll(re)) {
    if (m[1]) tags.push({ name: m[1].toLowerCase(), attrs: parseAttributes(m[2]), text: m[3] });
    else if (m[4]) tags.push({ name: m[4].toLowerCase(), attrs: parseAttributes(m[5]) });
  }
  return tags;
}

// The type values a browser runs as JavaScript (the HTML standard's JavaScript MIME types), plus modules and import maps.
const JS_TYPES = new Set(['', 'module', 'importmap', 'application/ecmascript', 'application/javascript', 'application/x-ecmascript',
  'application/x-javascript', 'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript']);

/** What a script element is: 'external', 'inline' (runs, needs a hash), 'speculation' (speculation rules) or 'data' (JSON-LD and the like). */
export function scriptKind(tag) {
  if (tag.attrs.has('src')) return 'external';
  const type = (tag.attrs.get('type') ?? '').trim().toLowerCase();
  if (type === 'speculationrules') return 'speculation';
  return JS_TYPES.has(type) ? 'inline' : 'data';
}

/** The CSP source for an inline script. The browser hashes the text after it has turned every CR LF and CR into LF. */
export function scriptHash(text) {
  return `'sha256-${createHash('sha256').update(String(text).replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;
}

const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster'];

/** What one page needs from the policy and what it does that no policy should allow. */
export function auditPage(html) {
  const hashes = [];
  const problems = [];
  let speculationRules = false;
  for (const tag of pageTags(html)) {
    if (tag.name === 'script') {
      const kind = scriptKind(tag);
      if (kind === 'inline') hashes.push(scriptHash(tag.text));
      if (kind === 'speculation') speculationRules = true;
    }
    for (const [name, value] of tag.attrs) {
      if (/^on[a-z]/i.test(name)) problems.push(`an inline event handler <${tag.name} ${name}="${value.slice(0, 40)}">`);
      else if (URL_ATTRS.includes(name) && /^\s*javascript:/i.test(value)) problems.push(`a javascript: URL in <${tag.name} ${name}>`);
    }
  }
  return { hashes, speculationRules, problems };
}

/**
 * The policy for a whole build. pages: [{ file, html }] with file relative to the build folder; settings: site.config.mjs.
 * problems lists what the build must refuse: inline event handlers and javascript: URLs anywhere, and inline scripts
 * under /hq, whose policy (vercel.json) allows none.
 */
export function sitePolicy(pages, settings = {}) {
  const hashes = new Set();
  const problems = [];
  let speculationRules = false;
  for (const { file, html } of pages) {
    const page = auditPage(html);
    for (const problem of page.problems) problems.push(`${file}: ${problem}`);
    if (/^hq[\\/]/.test(file)) {
      if (page.hashes.length) problems.push(`${file}: an inline <script>. The /hq policy in vercel.json allows only scripts from this site's own files.`);
      continue;
    }
    for (const hash of page.hashes) hashes.add(hash);
    speculationRules ||= page.speculationRules;
  }
  const policy = buildPolicy({
    hashes: [...hashes],
    speculationRules,
    ga: Boolean(settings.gaId),
    gtm: Boolean(settings.gtmId),
    metricool: Boolean(settings.metricoolHash),
    vercelInsights: Boolean(settings.vercelInsights),
  });
  return { policy, hashes: [...hashes].sort(), problems };
}

// ---------- Serving ----------

/** True for the paths that get the public policy: everything but /hq* and /api/*, which vercel.json covers. */
export const isPublicPath = (pathname) => !String(pathname).startsWith('/hq') && !String(pathname).startsWith('/api/');

const cache = new Map();

/**
 * The public policy from <distRoot>/csp.json, or null when the file is missing or unreadable (then the server sends
 * only what vercel.json says). The file is read again whenever it changes: a rebuild swaps dist/ under a running server.
 */
export function publicPolicy(distRoot) {
  const file = join(distRoot, 'csp.json');
  let info;
  try { info = statSync(file); } catch { cache.delete(file); return null; }
  const stamp = `${info.ino}:${info.size}:${info.mtimeMs}`;
  const known = cache.get(file);
  if (known && known.stamp === stamp) return known.policy;
  let policy = null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')).public;
    // A header value must be one line of visible ASCII; anything else would make every response fail.
    if (typeof value === 'string' && /^[\x20-\x7e]+$/.test(value)) policy = value;
  } catch {}
  cache.set(file, { stamp, policy });
  return policy;
}

/**
 * For server.mjs, after the vercel.json headers are set: with a csp.json in the build, the report-only policy from
 * vercel.json gives way to the enforcing one, and /hq* and /api/* keep the policies vercel.json gives them.
 */
export function applyPublicPolicy(res, pathname, distRoot) {
  const policy = publicPolicy(distRoot);
  if (!policy) return;
  res.removeHeader('Content-Security-Policy-Report-Only');
  if (isPublicPath(pathname)) res.setHeader('Content-Security-Policy', policy);
}
