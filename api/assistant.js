// POST /api/assistant: "Ask a question". The visitor's question is matched to answers that are already on this website
// (lib/assistant/), and the reply carries only those answers, as the website wrote them:
//   request  { message, history: [{ q, ids }] (at most 6), lang: "en" | "es" }
//   reply    { ok, answers: [{ id, question, text, url }], handoff }
// Nothing a model writes reaches the visitor; nothing of the conversation is stored or logged here. The one log line
// per question is its outcome, how many answers, which path and the time: "[assistant] answered 1 local 4ms".
//
// Who may call it: POST, a JSON body, from a page of this site (a form-encoded body, or Sec-Fetch-Site: cross-site, or
// an Origin whose host is not this request's Host, is refused). Per address 6 questions a minute and 60 a day; the
// model at most ASSISTANT_DAILY_MAX times a day for the whole site (then the search alone answers).
// Settings: ASSISTANT=on, and optionally ASSISTANT_API_URL, ASSISTANT_API_KEY, ASSISTANT_MODEL, ASSISTANT_PROVIDER_NAME,
// ASSISTANT_DAILY_MAX (docs/ASSISTANT.md).
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientIp, createRateLimiter, rateKey } from '../lib/request-ip.js';
import { INDEX_DIR, INDEX_FILE } from '../lib/assistant/collect.js';
import { createAssistant, prepareIndex } from '../lib/assistant/service.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 16 * 1024;
const EMPTY = Object.freeze({ ok: false, answers: [], handoff: false });

/** A request a browser sent from another website: Sec-Fetch-Site says so, or Origin names another host. */
export function fromAnotherSite(headers = {}) {
  if (String(headers['sec-fetch-site'] || '').trim().toLowerCase() === 'cross-site') return true;
  const origin = headers.origin;
  if (origin === undefined || origin === null || String(origin).trim() === '') return false;
  let host;
  try { host = new URL(String(origin).trim()).host.toLowerCase(); } catch { return true; } // "null" and garbage
  return host !== String(headers.host || '').trim().toLowerCase();
}

/** The answers the build wrote into <dist>/.assistant/answers.json, read again whenever the file changes. */
export function indexReader(dist) {
  const file = join(dist, INDEX_DIR, INDEX_FILE);
  let known = null;
  return () => {
    let info;
    try { info = statSync(file); } catch { known = null; return null; }
    const stamp = `${info.ino}:${info.size}:${info.mtimeMs}`;
    if (known && known.stamp === stamp) return known.index;
    let index = null;
    try { index = prepareIndex(JSON.parse(readFileSync(file, 'utf8'))); } catch { index = null; }
    known = { stamp, index };
    return index;
  };
}

/**
 * One line for the server log at start: is the assistant on, and will questions go to a model? It names a model that
 * stays off because the privacy page was built without its provider, or with another one.
 */
export function assistantStatus({ env = process.env, dist = join(ROOT, 'dist') } = {}) {
  if (String(env.ASSISTANT || '').trim().toLowerCase() !== 'on') return '';
  const index = indexReader(dist)();
  if (!index) return '[assistant] on, but the build has no answers: build with ASSISTANT=on';
  const blocked = createAssistant({ env }).modelBlocked(index);
  if (!blocked) return `[assistant] on: the search picks candidates and the model at ${createAssistant({ env }).settings.host} chooses among them`;
  return blocked === 'no model configured' ? '[assistant] on: search only' : `[assistant] on: search only, the model stays off because ${blocked}`;
}

/**
 * The handler. Everything it depends on can be passed in (tests do): env, the index (or a function returning it),
 * fetch (only ever used to call the configured model), log, now.
 */
export function createAssistantHandler({ env = process.env, dist = join(ROOT, 'dist'), index, fetch = globalThis.fetch, log = console.log, now = Date.now } = {}) {
  const getIndex = typeof index === 'function' ? index : index ? () => index : indexReader(dist);
  const assistant = createAssistant({ env, fetch, now });
  const perMinute = createRateLimiter({ max: 6, windowMs: 60_000 });
  const perDay = createRateLimiter({ max: 60, windowMs: 24 * 60 * 60_000 });
  let warned = '';

  const handler = async function assistantHandler(req, res) {
    const started = now();
    const line = (outcome, path, count) => log(`[assistant] ${outcome}${count ? ` ${count}` : ''} ${path} ${Math.max(0, now() - started)}ms`);
    res.setHeader('Cache-Control', 'no-store');
    if (String(env.ASSISTANT || '').trim().toLowerCase() !== 'on') return res.status(404).json(EMPTY);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json(EMPTY); }
    const headers = req.headers || {};
    if (fromAnotherSite(headers)) return res.status(403).json(EMPTY);
    // JSON only: a form on another site's page can post form-encoded or text/plain without any script.
    if (String(headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return res.status(415).json(EMPTY);

    const key = rateKey(clientIp(req));
    const minute = perMinute.hit(key, now());
    const day = perDay.hit(key, now());
    const data = getIndex();
    if (minute.limited || day.limited) {
      res.setHeader('Retry-After', minute.limited ? '60' : '3600');
      const limit = data?.fixed('en', 'x-limit');
      line('limited', 'local');
      return res.status(429).json({ ok: false, answers: limit ? [answerOf(limit, req.body)] : [], handoff: true });
    }

    let body = req.body;
    if (typeof body === 'string') {
      if (body.length > MAX_BODY) return res.status(413).json(EMPTY);
      try { body = JSON.parse(body); } catch { return res.status(400).json(EMPTY); }
    } else if (body && typeof body === 'object' && JSON.stringify(body).length > MAX_BODY) return res.status(413).json(EMPTY);
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.message !== 'string' || !body.message.trim()) return res.status(400).json(EMPTY);

    if (!data) {
      line('unavailable', 'local');
      return res.status(200).json({ ok: false, answers: [], handoff: true });
    }
    const blocked = assistant.modelBlocked(data);
    if (blocked && blocked !== 'no model configured' && warned !== blocked) {
      warned = blocked;
      log(`[assistant] the model stays off: ${blocked}`);
    }
    try {
      const { reply, outcome, path } = await assistant.answer(body, data);
      line(outcome, path, outcome === 'answered' ? reply.answers.length : 0);
      return res.status(200).json(reply);
    } catch {
      // Never a 5xx, and never the error's message: it could quote the question.
      line('error', 'local');
      const sorry = data.fixed(body.lang === 'es' ? 'es' : 'en', 'x-unavailable');
      return res.status(200).json({ ok: false, answers: sorry ? [answerOf(sorry)] : [], handoff: true });
    }
  };
  handler.limits = { perMinute, perDay };
  handler.assistant = assistant;
  return handler;

  // The limit reply in the visitor's language when the body says which (read without trusting anything else in it).
  function answerOf(entry, rawBody) {
    let target = entry;
    if (rawBody !== undefined) {
      let lang = 'en';
      try { lang = (typeof rawBody === 'string' ? (rawBody.length > MAX_BODY ? null : JSON.parse(rawBody)) : rawBody)?.lang === 'es' ? 'es' : 'en'; } catch {}
      target = getIndex()?.fixed(lang, entry.id) || entry;
    }
    return { id: target.id, question: '', text: target.text, url: target.url };
  }
}

export default createAssistantHandler();
