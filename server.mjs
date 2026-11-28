// Production server for a VPS or any single machine. Run: npm start
// It serves ./dist the way Vercel does (clean URLs plus the redirects, rewrites and headers in vercel.json)
// and runs the API handlers. It does not build: run `npm run build` first.
// Put Caddy or nginx in front for HTTPS and compression. See docs/VPS.md.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import leadsHandler from './api/leads.js';
import hqHandler from './api/hq.js';
import intakeHandler from './api/intake.js';
import trackHandler from './api/track.js';
import mcpHandler from './api/mcp.js';
import { flushAnalytics } from './lib/analytics-store.js';
import { closeLocalDatabase, databaseMode, openLocalDatabase, startDailyBackups, useDatabase } from './lib/local-database.js';
import { applyPublicPolicy } from './lib/csp.js';

// Writes the site analytics kept on this server to disk. Called before the process exits.
export { flushAnalytics };

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 4.5 * 1024 * 1024; // the ceiling Vercel applies to a function request
const DEFAULT_CACHE = 'public, max-age=0, must-revalidate';
// /api/mcp answers 404 until MCP_TOKEN is set (docs/MCP.md).
const API = { '/api/leads': leadsHandler, '/api/hq': hqHandler, '/api/intake': intakeHandler, '/api/track': trackHandler, '/api/mcp': mcpHandler };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json', '.vcf': 'text/vcard; charset=utf-8', '.mp4': 'video/mp4',
};

// ---------- Routing rules: vercel.json stays the one source, so Vercel and a VPS answer the same way ----------

// A vercel.json `source` such as "/(.*)", "/styles.(.*).css" or "/blog/:slug" as a regular expression.
export function sourceToRegExp(source) {
  let out = '';
  for (let i = 0; i < source.length;) {
    if (source[i] === '(') {
      let depth = 0;
      let end = i;
      do {
        if (source[end] === '(') depth += 1;
        else if (source[end] === ')') depth -= 1;
        end += 1;
      } while (depth > 0 && end < source.length);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    const param = source[i] === ':' ? /^:[A-Za-z0-9_]+([*+?]?)/.exec(source.slice(i)) : null;
    if (param) {
      out += { '*': '(.*)', '+': '(.+)', '?': '([^/]*)', '': '([^/]+)' }[param[1]];
      i += param[0].length;
      continue;
    }
    out += source[i].replace(/[.*+?^${}|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

export function loadRouting(file = join(ROOT, 'vercel.json')) {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  return {
    cleanUrls: config.cleanUrls === true,
    trailingSlash: config.trailingSlash,
    redirects: (config.redirects || []).map((r) => ({ match: sourceToRegExp(r.source), destination: r.destination, status: r.statusCode || (r.permanent ? 308 : 307) })),
    rewrites: (config.rewrites || []).map((r) => ({ match: sourceToRegExp(r.source), destination: r.destination })),
    headers: (config.headers || []).map((h) => ({ match: sourceToRegExp(h.source), headers: h.headers.map((x) => [x.key, x.value]) })),
  };
}

// ---------- Visitor address ----------

const LOOPBACK = /^(?:::ffff:)?127\.\d+\.\d+\.\d+$|^::1$/;
const PRIVATE = /^(?:::ffff:)?(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)|^f[cd][0-9a-f]{2}:/i;

// lib/request-ip.js believes X-Real-IP first. On Vercel the platform sets it. Here this server sets it, so a
// visitor cannot send their own and step around the rate limits. Only a reverse proxy we trust may name the visitor.
// trust: "loopback" (a proxy on this machine, the default), "private" (also a proxy on a private network, e.g. Docker), "off".
export function pinClientIp(req, trust = 'loopback') {
  const peer = String(req.socket?.remoteAddress || '');
  const trusted = trust !== 'off' && (LOOPBACK.test(peer) || (trust === 'private' && PRIVATE.test(peer)));
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  const named = forwarded.at(-1) || String(req.headers['x-real-ip'] || '').split(',').at(-1).trim();
  const ip = (trusted && named ? named : peer).replace(/^::ffff:/, '');
  delete req.headers['x-forwarded-for'];
  delete req.headers['x-vercel-forwarded-for'];
  req.headers['x-real-ip'] = ip;
  return ip;
}

// ---------- Responses ----------

const plain = (res, status, text) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`${text}\n`);
};

// Only ever called with a path that starts with one "/", so it cannot send a visitor to another site.
const redirect = (res, status, location) => {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', DEFAULT_CACHE);
  res.end();
};

function readBody(req, limit) {
  return new Promise((done, fail) => {
    if (Number(req.headers['content-length']) > limit) { fail(Object.assign(new Error('Payload too large'), { status: 413 })); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { fail(Object.assign(new Error('Payload too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

// The handlers were written for Vercel: they read req.body and answer with res.status(code).json(body).
async function runApi(handler, req, res) {
  let raw;
  try { raw = await readBody(req, MAX_BODY_BYTES); } catch (err) {
    res.setHeader('Connection', 'close');
    res.statusCode = err.status || 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: err.status === 413 ? 'Request too large' : 'Bad request' }), () => req.destroy());
    return;
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  // A form posted without JavaScript arrives as an object, as it does on Vercel. JSON stays a string; every handler parses it.
  req.body = type === 'application/x-www-form-urlencoded' ? Object.fromEntries(new URLSearchParams(raw)) : (raw === '' ? undefined : raw);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return res;
  };
  res.send = (body) => {
    if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    res.end(body);
    return res;
  };
  await handler(req, res);
  if (!res.writableEnded) res.end();
}

async function findFile(distRoot, pathname) {
  const base = resolve(distRoot, `.${pathname}`);
  if (base !== distRoot && !base.startsWith(`${distRoot}${sep}`)) return null;
  const candidates = base === distRoot ? [join(distRoot, 'index.html')] : [base, `${base}.html`, join(base, 'index.html')];
  for (const file of candidates) {
    try {
      const info = await stat(file);
      if (info.isFile()) return { file, info };
    } catch {}
  }
  return null;
}

// ---------- The request handler ----------

export function createHandler({
  dist = join(ROOT, 'dist'),
  routing = loadRouting(),
  api = API,
  trustProxy = process.env.TRUST_PROXY || 'loopback',
  log = console.log,
} = {}) {
  const distRoot = resolve(dist);

  async function notFound(req, res) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', DEFAULT_CACHE);
    let page = '<!doctype html><title>Not found</title><h1>Not found</h1>';
    try { page = await readFile(join(distRoot, '404.html')); } catch {}
    res.end(req.method === 'HEAD' ? undefined : page);
  }

  async function respond(req, res) {
    const rawUrl = String(req.url || '/');
    const cut = rawUrl.indexOf('?');
    const rawPath = cut === -1 ? rawUrl : rawUrl.slice(0, cut);
    const search = cut === -1 ? '' : rawUrl.slice(cut);
    let pathname;
    try { pathname = decodeURIComponent(rawPath); } catch { return plain(res, 400, 'Bad request'); }
    // Backslashes and control characters have no place in a path, and browsers read "/\host" as another site.
    if (!rawPath.startsWith('/') || /[\\\u0000-\u001f]/.test(pathname)) return plain(res, 400, 'Bad request');

    for (const rule of routing.headers) {
      if (rule.match.test(pathname)) for (const [key, value] of rule.headers) res.setHeader(key, value);
    }
    // The enforcing policy build.mjs wrote for the public pages (dist/csp.json, lib/csp.js) replaces the report-only
    // one from vercel.json; /hq and /api keep their own. Without csp.json nothing changes.
    applyPublicPolicy(res, pathname, distRoot);

    if (pathname === '/healthz') return plain(res, 200, 'ok');
    if (/\/{2,}/.test(rawPath)) return redirect(res, 308, rawPath.replace(/\/{2,}/g, '/') + search);

    const hop = routing.redirects.find((r) => r.match.test(pathname));
    if (hop) return redirect(res, hop.status, hop.destination + (hop.destination.includes('?') ? search.replace(/^\?/, '&') : search));

    let route = pathname;
    let routeSearch = search;
    const rewrite = routing.rewrites.find((r) => r.match.test(pathname));
    if (rewrite) {
      const [toPath, toQuery = ''] = rewrite.destination.split('?');
      route = toPath;
      routeSearch = toQuery ? `?${toQuery}${search.replace(/^\?/, '&')}` : search;
    }

    const handler = Object.hasOwn(api, route) ? api[route] : null;
    if (handler) {
      const started = Date.now();
      pinClientIp(req, trustProxy);
      req.url = route + routeSearch;
      await runApi(handler, req, res);
      log(`${req.method} ${route} ${res.statusCode} ${Date.now() - started}ms`);
      return undefined;
    }
    if (route === '/api' || route.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return plain(res, 405, 'Method not allowed');
    }
    if (routing.cleanUrls && /\.html$/i.test(rawPath)) {
      const clean = rawPath.replace(/\.html$/i, '').replace(/(^|\/)index$/i, '$1');
      return redirect(res, 308, (clean.length > 1 ? clean.replace(/\/$/, '') : '/') + search);
    }
    if (routing.trailingSlash === false && rawPath.length > 1 && rawPath.endsWith('/')) return redirect(res, 308, rawPath.replace(/\/+$/, '') + search);
    if (route.split('/').some((part) => part.startsWith('.') && part !== '.well-known')) return notFound(req, res);

    const hit = await findFile(distRoot, route);
    if (!hit) return notFound(req, res);
    const etag = `W/"${hit.info.size.toString(16)}-${Math.floor(hit.info.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type', TYPES[extname(hit.file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', hit.info.mtime.toUTCString());
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', DEFAULT_CACHE);
    if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
    if (req.method === 'HEAD') { res.setHeader('Content-Length', hit.info.size); return res.end(); }
    let body;
    try { body = await readFile(hit.file); } catch { return notFound(req, res); } // the file went away mid-request (a build swapped ./dist)
    res.setHeader('Content-Length', body.length);
    return res.end(body);
  }

  return async function handle(req, res) {
    try {
      await respond(req, res);
    } catch (err) {
      log(`error ${req.method} ${String(req.url || '').split('?')[0]}: ${err?.stack || err}`);
      if (res.headersSent) return res.end();
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ ok: false, error: 'Server error' }));
    }
    return undefined;
  };
}

// ---------- Start when run directly ----------

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('No ./dist/index.html yet. Run "npm run build" first.');
    process.exit(1);
  }
  // The site's own database, unless SUPABASE_URL names a Supabase project. It is ready (schema applied) before the
  // first request; if it cannot be opened the site does not start, rather than take leads it cannot store.
  if (databaseMode(process.env) === 'local') {
    try {
      const db = await openLocalDatabase({ env: process.env });
      useDatabase(process.env);
      console.log(`Database: ${db.dir}${db.durable ? '' : ' (not forced to disk, see the warning above)'}`);
    } catch (err) {
      console.error(`The site was not started because its database could not be opened: ${err.message}`);
      process.exit(1);
    }
    startDailyBackups();
  }
  const server = createServer(createHandler({ dist }));
  server.listen(port, host, () => console.log(`Call Harbison is serving ./dist on http://${host}:${port}`));

  let stopping = false;
  const stop = (signal) => {
    console.log(`${signal} received: finishing open requests`);
    // The last few seconds of site analytics are still in memory, and the database must be closed cleanly:
    // both happen once the open requests are done.
    const exit = async () => {
      if (stopping) return;
      stopping = true;
      flushAnalytics();
      try { await closeLocalDatabase(); } catch (err) { console.error(`The database did not close cleanly: ${err.message}`); }
      process.exit(0);
    };
    server.close(exit);
    server.closeIdleConnections?.();
    setTimeout(exit, 10000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  // One failed background promise (a notification that could not be sent) must not take the site down.
  process.on('unhandledRejection', (err) => console.error(`Unhandled rejection: ${err?.stack || err}`));
}
