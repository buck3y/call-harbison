// Central business details. Edit here once — every page picks it up on the next build.

// Canonical links, the sitemap, and structured data all need an absolute https URL on the final host.
// Accepts sloppy input ("callharbison.com", "http://…/") and returns e.g. "https://www.callharbison.com".
// A bare two-part domain gets "www." because Vercel redirects the apex to www — canonicals must not redirect.
export function normalizeSiteUrl(raw) {
  const value = (raw || '').trim() || 'https://www.callharbison.com';
  const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  const local = u.hostname === 'localhost' || u.hostname.endsWith('.vercel.app');
  if (!local && u.hostname.split('.').length === 2) u.hostname = `www.${u.hostname}`;
  if (!local) u.protocol = 'https:';
  return `${u.origin}${u.pathname}`.replace(/\/$/, '');
}

// A GA4 measurement ID looks like G-XXXXXXXXXX. Anything else (an empty or placeholder env var) falls back to the default.
export function resolveGaId(raw, fallback = 'G-SN1ZWS50M7') {
  const value = (raw || '').trim();
  return /^G-[A-Z0-9]{6,}$/.test(value) && !/^G-X+$/.test(value) ? value : fallback;
}

// A GTM container ID looks like GTM-XXXXXXX. Empty or placeholder values are ignored.
export function resolveGtmId(raw) {
  const value = (raw || '').trim();
  return /^GTM-[A-Z0-9]{4,}$/.test(value) && !/^GTM-X+$/.test(value) ? value : '';
}

// A Metricool tracker hash is hexadecimal. Anything else (an empty or placeholder env var) falls back to the default.
export function resolveMetricoolHash(raw, fallback = '398cd80eb0d6d2a7ebd652d00db3bb8') {
  const value = (raw || '').trim().toLowerCase();
  return /^[a-f0-9]{16,64}$/.test(value) ? value : fallback;
}

// Third-party trackers. Google Analytics and Metricool load only with the owner's own GA_MEASUREMENT_ID and
// METRICOOL_HASH, except on Vercel (VERCEL is set during a Vercel build), which keeps the account's built-in IDs as
// before. ANALYTICS_DEFAULTS=on or =off overrides either way.
export function trackerIds(env = process.env) {
  const defaults = String(env.ANALYTICS_DEFAULTS || '').trim() || (env.VERCEL ? 'on' : 'off');
  const fallback = defaults === 'off' ? '' : undefined;
  return { gaId: resolveGaId(env.GA_MEASUREMENT_ID, fallback), metricoolHash: resolveMetricoolHash(env.METRICOOL_HASH, fallback) };
}
// Vercel Web Analytics and Speed Insights exist only on Vercel. VERCEL_INSIGHTS=on or =off overrides.
export function vercelInsightsOn(env = process.env) {
  const value = String(env.VERCEL_INSIGHTS || '').trim();
  return value ? value !== 'off' : Boolean(env.VERCEL);
}
const trackers = trackerIds();

export default {
  name: 'Call Harbison',
  tagline: 'Property problem? Call Harbison.',
  // Production URL (used for canonical links, sitemap, social cards). Override with SITE_URL on Vercel.
  url: normalizeSiteUrl(process.env.SITE_URL),

  phone: '(661) 472-7499',
  phoneHref: '+16614727499',
  email: 'nate85.realtor@gmail.com',

  // Licensee info — California requires the DRE number on advertising.
  agent: 'Nathanael Harbison',
  dre: '02059393',
  agentLicenseUrl: 'https://www2.dre.ca.gov/publicasp/pplinfo.asp?License_id=02059393',
  brokerage: 'The Mora Partners Inc.',
  brokerageDre: '02227690',
  brokerageUrl: 'https://www2.dre.ca.gov/publicasp/pplinfo.asp?License_id=02227690',
  agentProfiles: [
    'https://www.callharbison.com/about',
    'https://www.zillow.com/profile/nate85%20realtor',
    'https://www.facebook.com/nate85.realtor',
    'https://www.instagram.com/nathanaelharbison',
    'https://www.youtube.com/@NathanaelRealEstate',
    'https://www.linkedin.com/in/nathanael-harbison',
  ],
  // Add the Google Business Profile URL here once it exists (strong local + AI search signal).
  businessProfiles: [],

  // Reply hours shown next to every form ("It's 4:12 pm in Bakersfield…"). Bakersfield time, 24h clock.
  // PLACEHOLDER: confirm Nathanael's real hours before launch. days: 0 = Sunday … 6 = Saturday.
  replyHours: { days: [1, 2, 3, 4, 5, 6], open: 8, close: 19 },

  city: 'Bakersfield',
  state: 'CA',
  region: 'Kern County',
  serviceAreas: ['Bakersfield', 'Tehachapi', 'California City', 'Stallion Springs', 'Kern County'],

  // Google Analytics 4 / Google tag ID from GA_MEASUREMENT_ID. Empty (Google Analytics left out of the pages) when
  // it is not set, unless the built-in default applies (see trackerIds above).
  gaId: trackers.gaId,
  // Metricool tracker hash from METRICOOL_HASH. Empty (left out) as above.
  metricoolHash: trackers.metricoolHash,
  // Optional Google Tag Manager container (GTM-XXXXXXX). Preferred for Ads conversions + call tracking. Set GTM_ID.
  gtmId: resolveGtmId(process.env.GTM_ID),
  // Vercel Web Analytics and Speed Insights: only on Vercel (see vercelInsightsOn above).
  vercelInsights: vercelInsightsOn(),
};
