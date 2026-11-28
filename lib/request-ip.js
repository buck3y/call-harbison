// Spoof-resistant client IP resolution + bounded in-memory rate limiter.
// On Vercel, x-real-ip is set by the edge proxy; if falling back to x-forwarded-for, take the
// rightmost (proxy-appended) address so a client cannot rotate a spoofed leftmost header.
// On a server, server.mjs sets x-real-ip itself (pinClientIp), so a visitor cannot name their own address.

export function clientIp(req) {
  const realIp = req?.headers?.['x-real-ip'] || req?.headers?.['x-vercel-forwarded-for'];
  if (realIp) return String(realIp).split(',').at(-1).trim();
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',').at(-1).trim();
  const remote = req?.socket?.remoteAddress;
  return remote ? String(remote).trim() : '';
}

// Eight groups of four hex digits, or null when the text is not an IPv6 address.
function ipv6Groups(text) {
  let s = text;
  // A dotted IPv4 tail (::ffff:192.0.2.1, 64:ff9b::192.0.2.1) is the last two groups.
  const tail = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (tail) {
    const bytes = tail.slice(2).map(Number);
    if (bytes.some((b) => b > 255)) return null;
    s = `${tail[1]}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(s) || s.split('::').length > 2) return null;
  const [head, rest] = s.includes('::') ? s.split('::') : [s, null];
  const left = head ? head.split(':') : [];
  const right = rest === null ? [] : rest ? rest.split(':') : [];
  const fill = rest === null ? 0 : 8 - left.length - right.length;
  if (fill < 0 || (rest !== null && fill < 1)) return null;
  const groups = [...left, ...Array(fill).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

// The rate-limit key for an address. IPv4 stays as it is. IPv6 is cut to its /64, because one subscriber gets a
// whole /64 and could otherwise rotate through endless addresses, each with a fresh bucket. An IPv4 address written
// as IPv6 (::ffff:192.0.2.1) is the IPv4 address. An empty address stays empty; the limiters give it one shared
// bucket.
export function rateKey(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') === -1 ? undefined : s.indexOf(']'));
  s = s.split('%')[0]; // a zone index (fe80::1%eth0) is not part of the address
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return s;
  const groups = s.includes(':') ? ipv6Groups(s) : null;
  if (!groups) return s.slice(0, 64);
  if (groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff') {
    const n = parseInt(groups[6] + groups[7], 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// For "[security]" lines: the address reduced as above; "unknown" when there is none, "other" when it is not an
// address at all (so whatever a header held never reaches the log).
export function addressForLog(ip) {
  const key = rateKey(ip);
  if (!key) return 'unknown';
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(key) || /^[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3}::\/64$/.test(key) ? key : 'other';
}

// Free text in a log line (a display name, a CSP directive): no control characters, no line or paragraph
// separators, no bidirectional overrides, so one entry can never look like two or hide what follows it.
export const cleanForLog = (value, max = 100) => String(value ?? '')
  .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim()
  .slice(0, max);

const NO_ADDRESS = '\u0000no-address'; // every caller whose address could not be told: one bucket, never "no limit"
const OVERFLOW = '\u0000overflow'; // new keys while the table is full of live buckets

// A fixed-window counter per key, at most maxEntries keys. A full table only ever drops buckets whose window has
// ended. What happens to a new key when every bucket is still live:
//   whenFull: 'share' (default): it shares one overflow bucket, so rotating through addresses cannot reset anyone's
//     count, and the overflow bucket is limited like any other.
//   whenFull: 'evict': the oldest bucket is dropped to make room. Only for limits where turning a newcomer away
//     would cost more than letting a flood through (the public lead form: a real seller must not share a bucket
//     with a flood).
export function createRateLimiter({ max, windowMs, maxEntries = 5000, whenFull = 'share' }) {
  const buckets = new Map();
  let soonest = Infinity; // the earliest end of a window in the table, so a sweep runs only when one can succeed

  const keyOf = (key) => (key === undefined || key === null || key === '' ? NO_ADDRESS : String(key));

  function sweep(now) {
    if (now <= soonest) return;
    soonest = Infinity;
    for (const [k, v] of buckets) {
      if (now > v.reset) buckets.delete(k);
      else if (v.reset < soonest) soonest = v.reset;
    }
  }

  // The bucket a key counts against, making room if the table is full. `adding` is false for a read.
  function slot(key, now, adding) {
    const k = keyOf(key);
    if (buckets.has(k) || buckets.size < maxEntries) return k;
    sweep(now);
    if (buckets.size < maxEntries) return k;
    if (whenFull === 'evict') {
      if (adding) buckets.delete(buckets.keys().next().value);
      return k;
    }
    return OVERFLOW;
  }

  return {
    isLimited(key, now = Date.now()) {
      const entry = buckets.get(slot(key, now, false));
      return Boolean(entry) && now <= entry.reset && entry.count >= max;
    },
    hit(key, now = Date.now()) {
      const k = slot(key, now, true);
      const entry = buckets.get(k);
      if (!entry || now > entry.reset) {
        const reset = now + windowMs;
        buckets.set(k, { count: 1, reset });
        if (reset < soonest) soonest = reset;
        return { limited: 1 > max, count: 1 };
      }
      entry.count += 1;
      return { limited: entry.count > max, count: entry.count };
    },
    reset() {
      buckets.clear();
      soonest = Infinity;
    },
    get size() { return buckets.size; },
  };
}
