// Where HQ lives. With HQ_HOST set (for example hq.callharbison.com), HQ has an address of its own: server.mjs
// serves /hq and /api/hq only there, so no script on a public page (where Google Analytics, Tag Manager or Metricool
// may run) shares an origin with the staff cookie. Unset, HQ is at SITE_URL/hq as before.
import { normalizeSiteUrl } from '../site.config.mjs';

// "HQ.CallHarbison.com:443", "hq.callharbison.com." and "https://hq.callharbison.com/" all name hq.callharbison.com.
export function hostName(value) {
  let text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.includes('://')) {
    try { text = new URL(text).host; } catch { return ''; }
  }
  text = text.split('/')[0];
  // An IPv6 literal keeps its brackets; anything after them, or after a single colon, is a port.
  const host = text.startsWith('[') ? text.slice(0, text.indexOf(']') + 1) : text.split(':')[0];
  return host.replace(/\.$/, '');
}

export const hqHost = (env = process.env) => hostName(env.HQ_HOST);

export function siteBase(env = process.env) {
  try { return normalizeSiteUrl(env.SITE_URL); } catch { return 'https://www.callharbison.com'; }
}

// The link to one lead in HQ, for alert e-mails.
export function hqUrl(env = process.env, leadId) {
  const host = hqHost(env);
  const base = host ? `https://${host}` : siteBase(env);
  return leadId ? `${base}/hq?lead=${encodeURIComponent(leadId)}` : `${base}/hq`;
}
