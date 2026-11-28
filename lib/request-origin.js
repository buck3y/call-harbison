// Did a browser send this request from another website? Browsers say so in two headers: Sec-Fetch-Site (every
// current browser) and Origin (on every POST). A page elsewhere can make its visitors' browsers post to this site,
// but it cannot remove or change those headers.
//
// Cross-site: Sec-Fetch-Site is "cross-site", or Origin is present and is neither this request's own host nor the
// origin of SITE_URL. An Origin of "null" (a sandboxed frame, a file, some redirects) and an Origin that is not a
// URL count as cross-site. No headers at all means "not cross-site": old browsers and server-side callers send none.
//
// One exception: "Origin: null" together with "Sec-Fetch-Site: same-origin" is this site's own page. A browser
// writes null itself on a same-origin form post or report (a CSP report) when the page's Referrer-Policy is
// no-referrer, as HQ's may be; Sec-Fetch-Site cannot be set by a page, so it is the better witness there.
import { siteBase } from './hq-url.js';

const originOf = (value) => {
  try { return new URL(value); } catch { return null; }
};

export function isCrossSite(req, env = process.env) {
  const headers = req?.headers || {};
  const fetchSite = String(headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (fetchSite === 'cross-site') return true;
  const raw = headers.origin;
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const value = String(raw).trim();
  if (value.toLowerCase() === 'null') return fetchSite !== 'same-origin';
  const origin = originOf(value);
  if (!origin || !/^https?:$/.test(origin.protocol)) return true;
  // The request's own host, port included when one is given (http://localhost:3000 posting to localhost:3000).
  const ownHost = String(headers.host || '').trim().toLowerCase().replace(/\.$/, '');
  if (ownHost && origin.host === ownHost) return false;
  const site = originOf(siteBase(env));
  return !(site && origin.origin === site.origin);
}
