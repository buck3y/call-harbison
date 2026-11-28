// First-party site analytics kept on this server: the default anywhere but Vercel. ANALYTICS_STORE=shared (or
// running on Vercel without ANALYTICS_STORE=local) makes api/track.js forward to the shared collector instead, and
// nothing here runs. Plain Node (18 and 22), no dependencies, one process.
//
// ---------- On disk ----------
//
// The folder is ANALYTICS_DIR, else $STATE_DIRECTORY/analytics (systemd's StateDirectory=), else ./.data/analytics.
//
//   secret                 64 hex digits, mode 0600. Keys the visitor hash. Only created when ANALYTICS_SECRET is unset.
//   meta.json              { "version": 1, "since": "2026-11-27" }  the first day this folder recorded.
//   live.json              the current day in detail (below). Rewritten every few seconds while it changes, and on shutdown.
//   days/YYYY-MM-DD.json   one finished day as counters only (below). Written once when the day is compacted.
//
// Every file is written to a temporary file in the same folder and then renamed over the old one, so a reader or a
// crash never sees half a file. Leftover temporary files are removed at start.
//
// live.json
//   { "version": 1, "day": "2026-11-27",
//     "pages": { "/": 41, "/contact": 3 },              page views per path
//     "sessions": { "<session id from the browser>": {
//         "visitor": "3f9c0a7d1e2b4c5d",              first 16 hex digits of HMAC-SHA256(secret, "call_harbison:<day>:<ip>")
//         "start": 1764259200000,                     time of the first event seen (ms)
//         "referrer": "search", "referrerHost": "google.com",
//         "device": "Mobile", "browser": "Safari", "os": "iOS",   from the user agent, which is then dropped
//         "entry": "/", "exit": "/contact", "pageViews": 2,
//         "seconds": { "<page token>": 41 },          active seconds per page view (the browser sends a running total)
//         "events": ["lead_form_start"] } } }         funnel steps reached in this session, each at most once
//
// days/YYYY-MM-DD.json
//   { "version": 1, "day", "sessions", "visitors", "pageViews", "durationSeconds",
//     "durations": [ sessions per DURATION_BUCKETS entry ],  for a median across days
//     "hours": [ 24 session counts by starting hour ],
//     "events": { "formStarts", "leads", "callClicks", "textClicks" },  sessions that reached each step
//     "referrers", "referrerHosts", "devices", "browsers", "operatingSystems", "pages", "entryPages", "exitPages":
//       { key: count }, the largest 100 of each }
//
// ---------- The day rule ----------
//
// Days and hours are calendar days in America/Los_Angeles. The first event, query or timer tick (every few seconds)
// that finds live.json belongs to an earlier day summarises that day into days/<day>.json and starts live.json again,
// empty, for the new day. A server that was down over midnight does the same when it starts. So session ids, page
// tokens and visitor hashes never outlive their day; the counters stay for as long as the files exist.
//
// ---------- Never stored ----------
//
// IP addresses, user-agent strings, query strings, fragments, page titles and form fields. Paths are cut at "?" and
// "#", capped at 300 characters, never /hq or /api, and a path with characters no page of this site uses (an address
// typed into the address bar that lands on the 404 page, for example) is counted as "(other)".
//
// ---------- Counting ----------
//
// A session is a browser session id (sessionStorage, renewed after 30 idle minutes). It belongs to the day of its
// first event; one that runs past midnight starts again on the new day, as in Google Analytics. A session's time is
// the sum over its page views of the largest running total each sent, capped at 1800 seconds. Average time counts
// every session, including those with no recorded time. Visitors are distinct hashes per day; a range adds the days.

import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TIME_ZONE = 'America/Los_Angeles';
export const MAX_SECONDS = 1800;
// Upper bounds in seconds: bucket i holds times in (DURATION_BUCKETS[i - 1], DURATION_BUCKETS[i]]; bucket 0 holds 0.
export const DURATION_BUCKETS = [0, 5, 10, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800];
// The funnel steps the browser may report, by name only, and the counter each one feeds.
export const EVENT_NAMES = { lead_form_start: 'formStarts', generate_lead: 'leads', phone_click: 'callClicks', text_click: 'textClicks' };

const VERSION = 1;
const FLUSH_MS = 5000;
const OTHER = '(other)';
const TYPES = ['start', 'pageview', 'heartbeat', 'end', 'event'];
const REFERRER_TYPES = ['direct', 'search', 'social', 'referral'];
const COUNTS = ['referrers', 'referrerHosts', 'devices', 'browsers', 'operatingSystems', 'pages', 'entryPages', 'exitPages'];
const SID = /^[a-f0-9-]{36}$/;
const HOST = /^[a-z0-9.-]{1,253}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Bounds that keep one busy or hostile day small in memory and on disk.
const LIMITS = { sessionsPerDay: 20000, sessionsPerVisitor: 200, pathsPerDay: 2000, pagesPerSession: 200, keptPerCounter: 100, listed: 25 };

// ---------- Settings ----------

// ANALYTICS_STORE=local or =shared decides. Unset: local, except on Vercel (VERCEL is set there), where it is shared.
export function isLocalAnalytics(env = process.env) {
  const store = String(env.ANALYTICS_STORE || '').trim();
  if (store === 'local') return true;
  if (store === 'shared') return false;
  return !env.VERCEL;
}

// What the HQ panel can show: null means not configured.
export function analyticsSources(env = process.env) {
  const shared = env.CRM_INGEST_SECRET ? 'shared' : null;
  return { call_harbison: isLocalAnalytics(env) ? 'local' : shared, harbison_standard: shared };
}

export function analyticsDir(env = process.env) {
  if (env.ANALYTICS_DIR) return resolve(env.ANALYTICS_DIR);
  const state = String(env.STATE_DIRECTORY || '').split(':')[0];
  return state ? join(state, 'analytics') : resolve('.data', 'analytics');
}

// ---------- Days in the business's time zone ----------

let zoned;
export function zonedParts(ms) {
  zoned ||= new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = {};
  for (const { type, value } of zoned.formatToParts(new Date(ms))) p[type] = value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const daysFrom = (from, count) => Array.from({ length: count }, (_, i) => addDays(from, i));

// ---------- What a request may contribute ----------

export function cleanPath(raw) {
  if (typeof raw !== 'string') return null;
  const path = raw.split(/[?#]/)[0].slice(0, 300);
  if (!path.startsWith('/') || path.startsWith('//') || /^\/(hq|api)(\/|$)/i.test(path)) return null;
  return /^\/[A-Za-z0-9/._~-]*$/.test(path) ? path : OTHER;
}

const ROBOT = /(?<!cu)bot\b|crawl|spider|slurp|scraper|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|externalhit|externalagent|embedly|feedfetcher|mediapartners|google-|googleother|apis-google|whatsapp|curl\/|wget\/|python|go-http|java\/|okhttp|axios|node-fetch|undici|libwww|httpclient|phantomjs|selenium|puppeteer|playwright/i;

// A handful of categories each, "Other" for the rest. iPads that ask for desktop pages are counted as desktops.
export function classifyUserAgent(raw) {
  const ua = String(raw || '').slice(0, 500);
  if (ua.length < 12 || ROBOT.test(ua)) return { robot: true };
  const device = /ipad|tablet|kindle|silk\/|playbook|android(?!.*mobile)/i.test(ua) ? 'Tablet'
    : /mobi|iphone|ipod|android|windows phone|blackberry|opera mini/i.test(ua) ? 'Mobile' : 'Desktop';
  const browser = /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|BytedanceWebview/i.test(ua) ? 'In-app browser'
    : /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
      : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
        : /OPR\/|OPiOS\/|Opera/.test(ua) ? 'Opera'
          : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
            : /Chrome\/|CriOS\/|Chromium\//.test(ua) ? 'Chrome'
              : /Safari\//.test(ua) && /Version\/|iPhone|iPad|Macintosh/.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
      : /CrOS/.test(ua) ? 'ChromeOS'
        : /Windows/.test(ua) ? 'Windows'
          : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
            : /Linux/.test(ua) ? 'Linux' : 'Other';
  return { robot: false, device, browser, os };
}

const visitorHash = (secret, day, ip) => createHmac('sha256', secret).update(`call_harbison:${day}:${ip || 'unknown'}`).digest('hex').slice(0, 16);

// ---------- Files ----------

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = openSync(tmp, 'w', 0o600);
    try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

function removeTemporaryFiles(...dirs) {
  for (const dir of dirs) for (const name of readdirSync(dir)) if (name.endsWith('.tmp')) { try { unlinkSync(join(dir, name)); } catch {} }
}

function readOrCreateSecret(dir) {
  const file = join(dir, 'secret');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = (readText(file) || '').trim();
    if (existing.length >= 32) { try { chmodSync(file, 0o600); } catch {} return existing; }
    try {
      const fd = openSync(file, existing ? 'w' : 'wx', 0o600);
      try { writeSync(fd, `${randomBytes(32).toString('hex')}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  return (readText(file) || '').trim();
}

// ---------- Counters ----------

const bump = (map, key, n = 1) => { if (key) map.set(key, (map.get(key) || 0) + n); };
const count = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
const bucketOf = (seconds) => { const i = DURATION_BUCKETS.findIndex((top) => seconds <= top); return i === -1 ? DURATION_BUCKETS.length - 1 : i; };

function emptySummary(day) {
  const s = { day, sessions: 0, visitors: 0, pageViews: 0, durationSeconds: 0, durations: DURATION_BUCKETS.map(() => 0), hours: Array(24).fill(0), events: {} };
  for (const key of Object.values(EVENT_NAMES)) s.events[key] = 0;
  for (const key of COUNTS) s[key] = new Map();
  return s;
}

function sessionSeconds(row) {
  let total = 0;
  for (const value of Object.values(row.seconds)) total += value;
  return Math.min(MAX_SECONDS, Math.round(total));
}

function summarize(state) {
  const s = emptySummary(state.day);
  const visitors = new Set();
  for (const row of state.sessions.values()) {
    const seconds = sessionSeconds(row);
    s.sessions += 1;
    visitors.add(row.visitor);
    s.pageViews += row.pageViews;
    s.durationSeconds += seconds;
    s.durations[bucketOf(seconds)] += 1;
    s.hours[zonedParts(row.start).hour] += 1;
    bump(s.referrers, row.referrer);
    bump(s.referrerHosts, row.referrerHost);
    bump(s.devices, row.device);
    bump(s.browsers, row.browser);
    bump(s.operatingSystems, row.os);
    bump(s.entryPages, row.entry);
    bump(s.exitPages, row.exit);
    for (const name of row.events) s.events[EVENT_NAMES[name]] += 1;
  }
  s.visitors = visitors.size;
  for (const [path, n] of state.pages) bump(s.pages, path, n);
  return s;
}

const largest = (map, limit) => [...map].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit);

function serializeSummary(s) {
  const out = { version: VERSION, day: s.day, sessions: s.sessions, visitors: s.visitors, pageViews: s.pageViews, durationSeconds: s.durationSeconds, durations: s.durations, hours: s.hours, events: s.events };
  for (const key of COUNTS) out[key] = Object.fromEntries(largest(s[key], LIMITS.keptPerCounter));
  return `${JSON.stringify(out)}\n`;
}

function parseSummary(text, day) {
  const raw = JSON.parse(text);
  const s = emptySummary(day);
  for (const key of ['sessions', 'visitors', 'pageViews', 'durationSeconds']) s[key] = count(raw[key]);
  if (Array.isArray(raw.durations) && raw.durations.length === DURATION_BUCKETS.length) s.durations = raw.durations.map(count);
  if (Array.isArray(raw.hours) && raw.hours.length === 24) s.hours = raw.hours.map(count);
  for (const key of Object.keys(s.events)) s.events[key] = count(raw.events?.[key]);
  for (const key of COUNTS) for (const [k, n] of Object.entries(raw[key] || {})) if (count(n)) s[key].set(k, count(n));
  return s;
}

function merge(summaries, day) {
  const total = emptySummary(day);
  for (const s of summaries) {
    for (const key of ['sessions', 'visitors', 'pageViews', 'durationSeconds']) total[key] += s[key];
    s.durations.forEach((n, i) => { total.durations[i] += n; });
    s.hours.forEach((n, i) => { total.hours[i] += n; });
    for (const key of Object.keys(total.events)) total.events[key] += s.events[key];
    for (const key of COUNTS) for (const [k, n] of s[key]) bump(total[key], k, n);
  }
  return total;
}

// The median of a histogram, read by straight-line interpolation inside the bucket where it falls.
export function medianFromHistogram(durations) {
  const n = durations.reduce((a, b) => a + b, 0);
  if (!n) return 0;
  const half = n / 2;
  let before = 0;
  for (let i = 0; i < durations.length; i += 1) {
    if (before + durations[i] >= half && durations[i] > 0) {
      const low = i === 0 ? 0 : DURATION_BUCKETS[i - 1];
      return Math.round(low + ((half - before) / durations[i]) * (DURATION_BUCKETS[i] - low));
    }
    before += durations[i];
  }
  return DURATION_BUCKETS.at(-1);
}

// ---------- The current day ----------

const freshDay = (day) => ({ day, pages: new Map(), sessions: new Map() });

function serializeLive(state) {
  return `${JSON.stringify({ version: VERSION, day: state.day, pages: Object.fromEntries(state.pages), sessions: Object.fromEntries(state.sessions) })}\n`;
}

const label = (v) => (typeof v === 'string' && v.length <= 300 ? v : null);

function parseLive(text) {
  const raw = JSON.parse(text);
  if (raw?.version !== VERSION || !DAY.test(raw.day || '')) throw new Error('unknown live.json format');
  const state = freshDay(raw.day);
  for (const [path, n] of Object.entries(raw.pages || {})) if (count(n)) state.pages.set(path, count(n));
  for (const [sid, row] of Object.entries(raw.sessions || {})) {
    if (!SID.test(sid) || !row || typeof row !== 'object') continue;
    const seconds = {};
    for (const [token, value] of Object.entries(row.seconds || {})) if (Number.isFinite(value)) seconds[token] = Math.max(0, Math.min(MAX_SECONDS, value));
    state.sessions.set(sid, {
      visitor: /^[a-f0-9]{16}$/.test(row.visitor || '') ? row.visitor : '0000000000000000',
      start: Number.isFinite(row.start) ? row.start : Date.parse(`${raw.day}T12:00:00Z`),
      referrer: REFERRER_TYPES.includes(row.referrer) ? row.referrer : null,
      referrerHost: label(row.referrerHost),
      device: label(row.device), browser: label(row.browser), os: label(row.os),
      entry: label(row.entry), exit: label(row.exit),
      pageViews: count(row.pageViews),
      seconds,
      events: Array.isArray(row.events) ? row.events.filter((name) => Object.hasOwn(EVENT_NAMES, name)) : [],
    });
  }
  return state;
}

// ---------- The store ----------

const open = new Map();

// One store per folder per process. Tests pass `now` to drive the clock and `flushIntervalMs: 0` to flush by hand.
export function openAnalyticsStore({ dir, secret, now = Date.now, flushIntervalMs = FLUSH_MS } = {}) {
  const root = resolve(dir);
  if (open.has(root)) throw new Error(`An analytics store is already open for ${root}`);
  const daysDir = join(root, 'days');
  mkdirSync(daysDir, { recursive: true, mode: 0o700 });
  removeTemporaryFiles(root, daysDir);
  const key = secret ? String(secret) : readOrCreateSecret(root);
  const liveFile = join(root, 'live.json');
  const summaryFile = (day) => join(daysDir, `${day}.json`);
  const summaries = new Map(); // finished days already read: day -> summary or null
  let closed = false;
  let dirty = false;

  const writeLive = () => { writeAtomic(liveFile, serializeLive(state)); dirty = false; };
  const compact = (finished) => {
    const text = serializeSummary(summarize(finished));
    writeAtomic(summaryFile(finished.day), text);
    summaries.set(finished.day, parseSummary(text, finished.day)); // the trimmed copy, exactly as a restart would read it
  };

  let state;
  const today = zonedParts(now()).day;
  const saved = readText(liveFile);
  if (saved !== null) {
    try { state = parseLive(saved); } catch (err) {
      // Detail that cannot be read is dropped rather than kept past its day.
      console.error(`[analytics] live.json could not be read (${err.message}); starting the day again`);
    }
  }
  if (state && state.day < today) { compact(state); state = null; }
  if (!state) { state = freshDay(today); writeLive(); }

  const visitorSessions = new Map();
  const countVisitors = () => { visitorSessions.clear(); for (const row of state.sessions.values()) bump(visitorSessions, row.visitor); };
  countVisitors();

  const metaFile = join(root, 'meta.json');
  let since = null;
  try { since = JSON.parse(readText(metaFile) || 'null')?.since; } catch {}
  if (!DAY.test(since || '')) {
    const known = readdirSync(daysDir).map((name) => name.replace(/\.json$/, '')).filter((day) => DAY.test(day));
    since = [state.day, ...known].sort()[0];
    writeAtomic(metaFile, `${JSON.stringify({ version: VERSION, since })}\n`);
  }

  // A clock that steps back over midnight keeps the newer day: nothing is ever filed under a day already compacted.
  const roll = (t) => {
    const day = zonedParts(t).day;
    if (day <= state.day) return;
    compact(state);
    state = freshDay(day);
    visitorSessions.clear();
    writeLive();
  };

  const summaryFor = (day) => {
    if (day === state.day) return summarize(state);
    if (!summaries.has(day)) {
      let s = null;
      try { const text = readText(summaryFile(day)); if (text !== null) s = parseSummary(text, day); } catch (err) {
        console.error(`[analytics] days/${day}.json could not be read (${err.message})`);
      }
      summaries.set(day, s);
    }
    return summaries.get(day) || emptySummary(day);
  };

  const store = {
    dir: root,
    get day() { return state.day; },
    get since() { return since; },

    // `event` is what the browser sent, already checked by api/track.js and checked again here. `client` carries the
    // address and user agent: both are reduced to a hash and three categories at once and never kept.
    record(event = {}, client = {}) {
      if (closed) throw new Error('The analytics store is closed');
      const t = now();
      roll(t);
      const ua = classifyUserAgent(client.userAgent);
      if (ua.robot) return { stored: false, reason: 'robot' };
      const sid = String(event.sid || '').toLowerCase();
      const { type } = event;
      if (!SID.test(sid) || !TYPES.includes(type)) return { stored: false, reason: 'invalid' };
      if (type === 'event' && !(typeof event.name === 'string' && Object.hasOwn(EVENT_NAMES, event.name))) return { stored: false, reason: 'invalid' };
      const path = type === 'start' || type === 'pageview' ? cleanPath(event.path) : null;
      if ((type === 'start' || type === 'pageview') && !path) return { stored: false, reason: 'invalid' };

      let row = state.sessions.get(sid);
      if (!row) {
        // Time alone does not open a session: it is the tail of one that began before midnight or before a crash.
        if (type === 'heartbeat' || type === 'end') return { stored: false, reason: 'unknown session' };
        if (state.sessions.size >= LIMITS.sessionsPerDay) return { stored: false, reason: 'limit' };
        const visitor = visitorHash(key, state.day, client.ip);
        if ((visitorSessions.get(visitor) || 0) >= LIMITS.sessionsPerVisitor) return { stored: false, reason: 'limit' };
        row = { visitor, start: t, referrer: null, referrerHost: null, device: ua.device, browser: ua.browser, os: ua.os, entry: null, exit: null, pageViews: 0, seconds: {}, events: [] };
        state.sessions.set(sid, row);
        bump(visitorSessions, visitor);
      }

      if (type === 'start' && !row.referrer) {
        row.referrer = REFERRER_TYPES.includes(event.referrerType) ? event.referrerType : 'direct';
        const host = typeof event.referrerHost === 'string' ? event.referrerHost.toLowerCase() : '';
        if (row.referrer !== 'direct' && HOST.test(host)) row.referrerHost = host.replace(/^www\./, '');
      }
      if (type === 'start' && !row.entry) row.entry = path;
      if (type === 'pageview') {
        row.entry ||= path;
        row.exit = path;
        row.pageViews += 1;
        bump(state.pages, state.pages.has(path) || state.pages.size < LIMITS.pathsPerDay ? path : OTHER);
      }
      if ((type === 'heartbeat' || type === 'end') && Number.isFinite(event.durationSeconds)) {
        const token = SID.test(String(event.pageToken || '').toLowerCase()) ? String(event.pageToken).toLowerCase() : '-';
        const seconds = Math.max(0, Math.min(MAX_SECONDS, Math.round(event.durationSeconds)));
        if (Object.hasOwn(row.seconds, token) || Object.keys(row.seconds).length < LIMITS.pagesPerSession) {
          row.seconds[token] = Math.max(row.seconds[token] || 0, seconds);
        }
      }
      if (type === 'event' && !row.events.includes(event.name)) row.events.push(event.name);
      dirty = true;
      return { stored: true };
    },

    // The reply for GET /api/hq?action=analytics&site=call_harbison (the contract in the HQ panel's specification).
    query({ days = 30 } = {}) {
      if (closed) throw new Error('The analytics store is closed');
      const t = now();
      roll(t);
      const n = Math.min(Math.max(Math.floor(Number(days)) || 30, 1), 365);
      const to = state.day;
      const from = addDays(to, -(n - 1));
      const list = daysFrom(from, n).map(summaryFor);
      const total = merge(list, to);
      const prevFrom = addDays(from, -n);
      const prev = since <= prevFrom ? merge(daysFrom(prevFrom, n).map(summaryFor), prevFrom) : null;
      const ranked = (map) => largest(map, LIMITS.listed).map(([k, value]) => ({ key: k, value }));
      return {
        site: 'call_harbison',
        source: 'local',
        timezone: TIME_ZONE,
        generatedAt: new Date(t).toISOString(),
        range: { from, to, days: n },
        totals: {
          sessions: total.sessions,
          uniqueVisitors: total.visitors,
          pageViews: total.pageViews,
          pagesPerSession: total.sessions ? Math.round((total.pageViews / total.sessions) * 100) / 100 : 0,
          avgDurationSeconds: total.sessions ? Math.round(total.durationSeconds / total.sessions) : 0,
          medianDurationSeconds: medianFromHistogram(total.durations),
          totalDurationSeconds: total.durationSeconds,
        },
        previous: prev && { sessions: prev.sessions, uniqueVisitors: prev.visitors, pageViews: prev.pageViews, leads: prev.events.leads },
        daily: list.map((s) => ({ day: s.day, sessions: s.sessions, pageViews: s.pageViews, visitors: s.visitors, leads: s.events.leads })),
        events: { ...total.events },
        hourly: total.hours.map((value, hour) => ({ hour, value })),
        referrers: ranked(total.referrers),
        referrerHosts: ranked(total.referrerHosts),
        campaigns: [],
        countries: [], regions: [], cities: [],
        devices: ranked(total.devices),
        browsers: ranked(total.browsers),
        operatingSystems: ranked(total.operatingSystems),
        topPages: ranked(total.pages),
        entryPages: ranked(total.entryPages),
        exitPages: ranked(total.exitPages),
      };
    },

    // Also compacts a day that ended while nothing was happening.
    flush() {
      if (closed) return false;
      roll(now());
      if (!dirty) return false;
      writeLive();
      return true;
    },

    close() {
      if (closed) return;
      if (timer) clearInterval(timer);
      try { store.flush(); } finally { closed = true; open.delete(root); }
    },
  };

  const timer = flushIntervalMs > 0 ? setInterval(() => {
    try { store.flush(); } catch (err) { console.error(`[analytics] could not save (${err.message})`); }
  }, flushIntervalMs) : null;
  timer?.unref?.();
  open.set(root, store);
  return store;
}

// The store for this environment, opened on first use.
export function getAnalyticsStore(env = process.env) {
  return open.get(analyticsDir(env)) || openAnalyticsStore({ dir: analyticsDir(env), secret: env.ANALYTICS_SECRET });
}

// Writes every open store's current day to disk. server.mjs calls it before the process exits.
export function flushAnalytics() {
  let ok = true;
  for (const store of open.values()) {
    try { store.flush(); } catch (err) { ok = false; console.error(`[analytics] could not save (${err.message})`); }
  }
  return ok;
}
