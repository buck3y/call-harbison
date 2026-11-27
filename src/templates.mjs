import site from '../site.config.mjs';
import { COMMAND_PHASE } from '../lib/command-phase.js';
import { images, situations as baseSituations, areas as baseAreas, faqs as baseFaqs } from './content.mjs';
import { californiaCity, extraFaqs, glance, about, guides as baseGuides } from './content-extra.mjs';
import { family, familyForm, partnerGuide } from './family.mjs';
import { localSections, foreclosureGuide, inquiryPages } from './content-search.mjs';
import { cityAreas, bakersfieldZips } from './content-cities.mjs';
import { moreSituations } from './content-situations-more.mjs';
import { paperQuestions, paperGroups, quizQuestions, quizResults, quizReasons, quizNotes, toolCopy } from './content-tools.mjs';
import { handoffTools, handoffCopy } from './content-handoff.mjs';
import {
  heroCopy, reassurance, processSteps, routes, compareDisclosure, whyHarbison, transparency, safeguards,
  offerExplanation, offerExample, walkthrough, formSituations, situationFormMap, detailOptions,
  newSituations, stallionSprings, newGuides, guideMeaning,
} from './content-playbook.mjs';

export const situations = [...baseSituations, ...newSituations, ...moreSituations];
// Bakersfield, Tehachapi, Stallion Springs, California City, Kern County
export const areas = [...baseAreas.slice(0, 2), stallionSprings, californiaCity, ...baseAreas.slice(2), ...cityAreas];
export const faqs = [...baseFaqs.slice(0, 4), ...extraFaqs, ...baseFaqs.slice(4)];
export const guides = [...baseGuides.map((g) => ({ ...g, meaning: guideMeaning[g.slug] })), ...newGuides, foreclosureGuide];

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s = '') => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const year = new Date().getFullYear();
// Fallback delay before gtag.js loads for visitors who never interact (see head()).
const GA_LOAD_DELAY_MS = 4000;
// Wordmarks combine the original H-house mark with Call Harbison text.
const logo = '/assets/call-harbison.svg'; // navy and gold, transparent, 945×225
const logoReverse = '/assets/call-harbison-reverse.svg'; // gold for navy grounds, transparent, 945×225
const heroMark = '/assets/h-house-mark-v3.png'; // gold ruler-house H mark, transparent, 256×256
const ogDefault = '/assets/og-default.jpg'; // 1200×630
const headshot = '/assets/nathanael-harbison-800.jpg'; // 800×800 (from his YouTube profile photo)
const BUILD_DATE = '2026-11-12';
export const PAGE_DATES = {
  '/': '2026-11-12',
  '/how-it-works': '2026-11-12',
  '/sell-loved-ones-house': '2026-11-12',
  '/areas/kern-county': '2026-11-12',
  '/areas/bakersfield': '2026-11-12',
  '/areas/tehachapi': '2026-11-12',
  '/areas/stallion-springs': '2026-11-12',
  '/areas/california-city': '2026-11-12',
  '/situations/needs-major-repairs': '2026-11-12',
  '/situations/problem-tenants': '2026-11-12',
  '/situations/life-change': '2026-11-12',
  '/situations/relocation': '2026-11-12',
  '/situations/inherited-property': '2026-11-12',
  '/situations/land-development': '2026-11-12',
  '/buyers': '2026-11-12',
  '/investors': '2026-11-12',
  '/home-value': '2026-11-12',
  '/about': '2026-11-05',
  '/privacy': '2026-10-17',
};
export const contentDate = (path, fallback = BUILD_DATE) => PAGE_DATES[path] || fallback;
const niceDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// Resize an Unsplash URL to exact dimensions (keeps width/height attributes honest → no layout shift).
const sized = (url, w, h) => url.replace(/([?&])w=\d+/, `$1w=${w}&h=${h}`);
const img = (url, alt, w, h, { eager = false, cls = '' } = {}) =>
  `<img${cls ? ` class="${cls}"` : ''} src="${sized(url, w, h)}" srcset="${sized(url, Math.round(w / 1.5), Math.round(h / 1.5))} ${Math.round(w / 1.5)}w, ${sized(url, w, h)} ${w}w" sizes="(max-width: 640px) 92vw, ${w}px" alt="${esc(alt)}" width="${w}" height="${h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;

// Hero photo as a real <img> so the browser finds it early (LCP). On phones the photo sat under a ~90%
// overlay, so it isn't downloaded there at all (a 1×1 placeholder source). The headline becomes the LCP.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const heroSources = (url) => ({
  mobile: `${BLANK} 1w`,
  desktop: `${sized(url, 1100, 700)} 1100w, ${sized(url, 1500, 950)} 1500w, ${sized(url, 1900, 1200)} 1900w`,
});
const heroPicture = (url) => {
  const s = heroSources(url);
  return `<picture class="hero-img"><source media="(max-width: 980px)" srcset="${s.mobile}" sizes="100vw"><img src="${sized(url, 1500, 950)}" srcset="${s.desktop}" sizes="100vw" alt="" width="1500" height="950" fetchpriority="high" decoding="async"></picture>`;
};
const heroPreload = (url) => {
  const s = heroSources(url);
  return `<link rel="preload" as="image" media="(min-width: 981px)" imagesrcset="${s.desktop}" imagesizes="100vw" fetchpriority="high">`;
};

const pageTitle = (t) => (`${t} | ${site.name}`.length <= 66 ? `${t} | ${site.name}` : `${t} | Harbison`);

// ---------- Structured data (one connected @graph per page) ----------

const ids = {
  org: `${site.url}/#business`,
  person: `${site.url}/about#nathanael-harbison`,
  website: `${site.url}/#website`,
  brokerage: `${site.url}/#responsible-broker`,
};

const placeLd = (a) => ({
  '@type': a.slug === 'kern-county' ? 'AdministrativeArea' : 'City',
  name: `${a.name}${a.slug === 'kern-county' ? '' : ', CA'}${a.slug === 'kern-county' ? ', California' : ''}`,
  ...(a.geo ? { geo: { '@type': 'GeoCoordinates', latitude: a.geo[0], longitude: a.geo[1] } } : {}),
});

const orgLd = () => ({
  '@type': 'RealEstateAgent',
  '@id': ids.org,
  name: site.name,
  slogan: site.tagline,
  description: `${site.name} is a cash home buyer in Bakersfield, Tehachapi, California City, and throughout Kern County, California. It buys houses and land as-is for cash and helps owners compare a direct sale with listing, renovation, or development.`,
  url: `${site.url}/`,
  logo: { '@type': 'ImageObject', url: `${site.url}${logo}`, width: 945, height: 225 },
  image: `${site.url}${ogDefault}`,
  telephone: site.phoneHref,
  email: site.email,
  address: { '@type': 'PostalAddress', addressLocality: site.city, addressRegion: site.state, addressCountry: 'US' },
  geo: { '@type': 'GeoCoordinates', latitude: 35.3733, longitude: -119.0187 },
  areaServed: areas.map(placeLd),
  founder: { '@id': ids.person },
  employee: { '@id': ids.person },
  contactPoint: { '@type': 'ContactPoint', telephone: site.phoneHref, email: site.email, contactType: 'customer service', areaServed: 'US-CA', availableLanguage: ['English', 'Spanish'] },
  knowsAbout: ['Selling a house as-is', 'Cash home buying', 'We buy houses for cash', 'Sell my house fast', 'Inherited and probate property', 'Real estate listing', 'Home renovation', 'Land development', 'Kern County real estate'],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Property solutions',
    itemListElement: situations.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.title, url: `${site.url}/situations/${s.slug}` } })),
  },
  sameAs: [...site.businessProfiles, ...site.agentProfiles],
});

const personLd = () => ({
  '@type': 'Person',
  '@id': ids.person,
  name: site.agent,
  jobTitle: 'REALTOR®',
  url: `${site.url}/about`,
  image: { '@type': 'ImageObject', url: `${site.url}${headshot}`, width: 800, height: 800 },
  telephone: site.phoneHref,
  email: site.email,
  worksFor: [{ '@id': ids.org }, { '@id': ids.brokerage }],
  hasCredential: {
    '@type': 'EducationalOccupationalCredential',
    credentialCategory: 'license',
    name: 'California real estate license',
    identifier: `DRE #${site.dre}`,
    recognizedBy: { '@type': 'GovernmentOrganization', name: 'California Department of Real Estate', url: 'https://www.dre.ca.gov/' },
  },
  knowsAbout: ['Kern County real estate', 'Probate and inherited property sales', 'As-is home sales', 'Investment property analysis'],
  sameAs: site.agentProfiles,
});

// The licensed brokerage is distinct from the site's consumer-facing brand.
const brokerageLd = () => ({
  '@type': 'Organization',
  '@id': ids.brokerage,
  name: site.brokerage,
  url: site.brokerageUrl,
  identifier: `California DRE #${site.brokerageDre}`,
});

const websiteLd = () => ({ '@type': 'WebSite', '@id': ids.website, url: `${site.url}/`, name: site.name, publisher: { '@id': ids.org }, inLanguage: 'en-US' });

const breadcrumbLd = (url, crumbs) => ({
  '@type': 'BreadcrumbList',
  '@id': `${url}#breadcrumb`,
  itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site.url}${path}` })),
});

const faqLd = (url, list) => ({
  '@type': 'FAQPage',
  '@id': `${url}#faq`,
  mainEntity: list.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(a) } })),
});

function graph({ path, title, description, image, type = 'WebPage', crumbs, extra = [], faq, modified, speakableSelectors = ['h1', '.answer-box'] }) {
  const modDate = modified || contentDate(path);
  const url = `${site.url}${path === '/' ? '/' : path}`;
  const webpage = {
    '@type': type,
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    isPartOf: { '@id': ids.website },
    about: { '@id': type === 'ProfilePage' ? ids.person : ids.org },
    inLanguage: 'en-US',
    dateModified: modDate,
    primaryImageOfPage: { '@type': 'ImageObject', url: image },
    speakable: { '@type': 'SpeakableSpecification', cssSelector: speakableSelectors },
    ...(type === 'ProfilePage' ? { mainEntity: { '@id': ids.person } } : {}),
    ...(crumbs ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
  };
  const nodes = [orgLd(), personLd(), brokerageLd(), websiteLd(), webpage];
  if (crumbs) nodes.push(breadcrumbLd(url, crumbs));
  if (faq) nodes.push(faqLd(url, faq));
  nodes.push(...extra.map((n) => ({ ...n, mainEntityOfPage: { '@id': `${url}#webpage` } })));
  return { '@context': 'https://schema.org', '@graph': nodes };
}

const serviceLd = ({ name, description, url, areaServed }) => ({
  '@type': 'Service',
  '@id': `${url}#service`,
  name,
  description,
  serviceType: 'Home buying and real estate solutions',
  url,
  provider: { '@id': ids.org },
  areaServed,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free, no-obligation property evaluation' },
});

// ---------- Layout ----------

function head({ title, description, path, image, noindex = false, ld, preload, article }) {
  const canonical = `${site.url}${path === '/' ? '/' : path}`;
  const ogImage = image || `${site.url}${ogDefault}`;
  // The gtag() stub runs immediately so page views and events queue in dataLayer from the start.
  // gtag.js itself (~177 KB, the biggest main-thread cost on phones) loads on the first interaction
  // or GA_LOAD_DELAY_MS after the load event; it then sends everything already queued.
  const ga = site.gaId
    ? `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});gtag('js',new Date());gtag('config','${esc(site.gaId)}',{page_location:location.origin+location.pathname,page_referrer:document.referrer?new URL(document.referrer).origin:''});
  (function(){var loaded=false;function load(){if(loaded||!hbhOk())return;loaded=true;gtag('consent','update',{analytics_storage:'granted'});var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${esc(site.gaId)}';document.head.appendChild(s)}
  ['pointerdown','keydown','touchstart','scroll'].forEach(function(e){addEventListener(e,load,{once:true,passive:true})});
  addEventListener('load',function(){setTimeout(load,${GA_LOAD_DELAY_MS})});window.hbhLoadAnalytics=load})();</script>`
    : '';
  const gtm = site.gtmId
    ? `<script>window.hbhLoadTagManager=function(){if(window.hbhGtm||!hbhOk())return;window.hbhGtm=1;(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${esc(site.gtmId)}')};hbhLoadTagManager();</script>`
    : '';
  return `<!doctype html>
<html lang="en-US" data-command-phase="${COMMAND_PHASE}">
<head>
  <script>function hbhOk(){try{var s=JSON.parse(localStorage.getItem('hbh-consent')||'null');return!!s&&s.value==='granted'&&Date.now()-s.at<31536e6}catch(e){return false}}</script>
  ${ga}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${noindex ? '<meta name="robots" content="noindex,follow">' : `<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">\n  <link rel="canonical" href="${canonical}">`}
  <meta name="author" content="${esc(site.name)}">
  <meta name="geo.region" content="US-CA">
  <meta name="geo.placename" content="${esc(site.city)}, ${esc(site.region)}">
  <meta name="theme-color" content="#031f2b">
  <meta property="og:type" content="${article ? 'article' : 'website'}">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:alt" content="${esc(title)}">
  ${article ? `<meta property="article:modified_time" content="${article.updated}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <link rel="icon" href="/favicon.ico?v=2" sizes="any">
  <link rel="icon" href="/assets/favicon-48.png?v=2" type="image/png" sizes="48x48">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=2">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <link rel="preconnect" href="https://images.unsplash.com" crossorigin>
  ${preload ? (preload.startsWith('https://images.unsplash.com') ? heroPreload(preload) : `<link rel="preload" as="image" href="${preload}" fetchpriority="high">`) : ''}
  <noscript><style>.offer-flow[hidden]{display:block!important;position:static!important;opacity:1!important;transform:none!important;overflow:visible!important}.flow-bar{display:none!important}.hero-chips{display:none}</style></noscript>
  <script>if(!('onpagereveal' in window))document.documentElement.classList.add('no-vt')</script>
  <script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/api/*"}},{"not":{"href_matches":"/hq*"}},{"not":{"href_matches":"/thank-you*"}},{"not":{"href_matches":"/es/thank-you*"}}]},"eagerness":"moderate"}]}</script>
  <link rel="preload" as="font" type="font/woff2" href="/fonts/public-sans-latin.woff2" crossorigin>
  <link rel="stylesheet" href="/styles.css">
  ${gtm}
  ${site.vercelInsights ? `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
  <script defer src="/_vercel/insights/script.js"></script>
  <script>window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments)};</script>
  <script defer src="/_vercel/speed-insights/script.js"></script>` : ''}
  ${noindex ? '' : `<script>window.hbhLoadMetricool=function(){if(window.hbhMetricool||!hbhOk())return;window.hbhMetricool=1;function loadScript(a){var b=document.getElementsByTagName("head")[0],c=document.createElement("script");c.type="text/javascript",c.src="https://tracker.metricool.com/resources/be.js",c.onreadystatechange=a,c.onload=a,b.appendChild(c)}loadScript(function(){beTracker.t({hash:"398cd80eb0d6d2a7ebd652d00db3bb8"})})};hbhLoadMetricool();</script>`}
  ${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
</head>`;
}

function header(cta) {
  return `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container nav-wrap">
    <a class="brand" href="/" aria-label="${esc(site.name)} home"><img src="${logoReverse}" alt="${esc(site.name)}" width="193" height="46"></a>
    <button class="menu-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button>
    <nav class="nav" id="site-nav" aria-label="Main">
      <a href="/how-it-works">How it works</a>
      <a href="/situations">Situations</a>
      <a href="/guides">Guides</a>
      <details class="nav-drop"><summary>Seller tools</summary><div class="nav-drop-panel">${handoffTools.map((t) => `<a href="/${t.slug}">${t.nav}</a>`).join('')}<a href="/second-opinion">Second opinion on an offer</a><a class="nav-drop-all" href="/seller-tools">${handoffCopy.all}</a></div></details>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </nav>
    <a class="btn btn-gold header-cta" href="${cta}" data-cta="header">Get my cash offer</a>
  </div>
</header>`;
}

// Hand-drawn 24px social glyphs (no icon font, nothing extra to load).
const socialIcons = {
  facebook: ['Facebook', '<path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21z"/>'],
  instagram: ['Instagram', '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.1"/>'],
  youtube: ['YouTube', '<path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3z"/>'],
  linkedin: ['LinkedIn', '<rect x="3.5" y="9" width="3.4" height="11.5"/><circle cx="5.2" cy="5.3" r="2"/><path d="M9.5 9h3.3v1.6c.5-.9 1.7-1.9 3.6-1.9 3.4 0 4.1 2.2 4.1 5.1v6.7h-3.4v-6c0-1.4 0-3.2-2-3.2s-2.2 1.5-2.2 3.1v6.1H9.5z"/>'],
  zillow: ['Zillow', '<path d="M12 3.2 2.5 10.6l1.2 1.5L5 11.1V20h5.2v-5.4h3.6V20H19v-8.9l1.3 1 1.2-1.5z"/>'],
};
const socialLinks = () => site.agentProfiles
  .map((u) => [u, Object.keys(socialIcons).find((k) => u.includes(k))])
  .filter(([, k]) => k)
  .map(([u, k]) => `<a href="${u}" rel="noopener me" target="_blank"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">${socialIcons[k][1]}</svg>${socialIcons[k][0]}</a>`)
  .join('');

function footer(cta) {
  return `<footer class="footer" id="contact">
  <div class="container footer-grid">
    <div class="footer-brand"><a href="/" aria-label="${esc(site.name)} home"><img class="footer-logo" src="${logoReverse}" alt="${esc(site.name)}" width="202" height="48" loading="lazy"></a><p><strong class="footer-tag">${esc(site.tagline)}</strong></p></div>
    <nav aria-label="Explore"><h2 class="footer-h">Explore</h2><a href="/how-it-works">How it works</a><a href="/situations">Situations</a><a href="/guides">Guides</a><a href="/about">About</a></nav>
    <div><h2 class="footer-h">Contact</h2><a href="tel:${site.phoneHref}">Call ${esc(site.phone)}</a><a href="sms:${site.phoneHref}">Text ${esc(site.phone)}</a><a href="mailto:${esc(site.email)}">${esc(site.email)}</a><a href="/nathanael-harbison.vcf" download data-cta="save_contact_footer">Save contact card</a></div>
    <div><h2 class="footer-h">Follow</h2><div class="footer-social">${socialLinks()}</div></div>
  </div>
  <div class="container footer-bottom">
    <div class="footer-legal"><p>© ${year} ${esc(site.name)}</p><p>${esc(site.agent)}, DRE #${esc(site.dre)} · <a href="${site.brokerageUrl}">${esc(site.brokerage)} · DRE #${esc(site.brokerageDre)}</a></p></div>
    <div class="footer-meta"><p class="eho"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3 2.5 10h2.2v10.5h14.6V10h2.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.5 12.5h7M8.5 15.5h7" stroke="currentColor" stroke-width="1.6"/></svg>Equal Housing Opportunity</p><p class="footer-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/accessibility">Accessibility</a><a href="#" data-consent-open>Privacy choices</a></p></div>
  </div>
</footer>
<div class="mobile-bar"><a href="tel:${site.phoneHref}" class="btn btn-outline">Call</a><a href="sms:${site.phoneHref}" class="btn btn-outline">Text</a><a href="${cta}" class="btn btn-gold" data-cta="mobile_bar">Get my cash offer</a></div>
<script src="/command-recovery.js" defer></script><script src="/script.js" defer></script><script src="/analytics.js" defer></script><script src="/consent.js" defer></script>`;
}

function page(opts, body) {
  const cta = opts.hasForm === false ? '/#lead-form' : '#lead-form';
  return `${head(opts)}
<body data-page-type="${esc(opts.pageType || 'page')}">
${header(cta)}
<main id="main">
${body}
</main>
${footer(cta)}
</body>
</html>
`;
}

// ---------- Components ----------

// Progressive options form (playbook §4): situation → address → contact. The lead is created at step 3;
// timeline, occupancy, condition, and goals are asked afterwards on the thank-you page.
// `situation` preselects step 1 and opens the form on the address step.
function leadForm({ situation = '', heading = 'Get your cash offer', city = '', location = '', pageType = 'page' } = {}) {
  const preset = formSituations.includes(situation) ? situation : '';
  const choice = formSituations
    .map((o) => `<label class="choice"><input type="radio" name="situation" value="${esc(o)}"${o === preset ? ' checked' : ''}><span>${esc(o)}</span></label>`)
    .join('');
  return `<aside class="lead-card" id="lead-form" aria-label="Request property options">
      <p class="eyebrow gold">Start Here · Free &amp; No Obligation</p>
      <h2>${esc(heading)}</h2>
      <form data-lead-form data-steps data-form-type="options" method="post" action="/api/leads" novalidate>
        <input type="hidden" name="form_type" value="options">
        <input type="hidden" name="route_interest" value="">
        <input type="hidden" name="location_interest" value="${esc(location)}">
        <input type="hidden" name="page_type" value="${esc(pageType)}">
        <ol class="step-dots" aria-hidden="true"><li class="on"><span>Property</span></li><li><span>Situation</span></li><li><span>Contact</span></li><li class="dot-end"><span>Offer by email</span></li></ol>
        <fieldset class="fstep fstep-address" data-step="1">
          <legend class="fstep-q">Where is the property?</legend>
          <label for="f-street-${pageType}">Street address</label><input id="f-street-${pageType}" name="street" autocomplete="address-line1" placeholder="123 Main St" required>
          <div class="addr-row">
            <div><label for="f-city-${pageType}">City</label><input id="f-city-${pageType}" name="city" autocomplete="address-level2" value="${esc(city)}" required></div>
            <div><label for="f-zip-${pageType}">ZIP</label><input id="f-zip-${pageType}" name="zip" autocomplete="postal-code" inputmode="numeric" maxlength="10" required></div>
          </div>
          <input type="hidden" name="state" value="CA">
          <p class="form-hint">Kern County, California only</p>
          <button class="btn btn-gold btn-full" type="button" data-next>Continue</button>
        </fieldset>
        <fieldset class="fstep" data-step="2" hidden>
          <legend class="fstep-q">What would you like help with?</legend>
          <div class="choice-grid choice-list" role="radiogroup">${choice}</div>
          <div class="fstep-nav"><button class="btn btn-ghost" type="button" data-back>Back</button><button class="btn btn-gold" type="button" data-next>Continue</button></div>
        </fieldset>
        <fieldset class="fstep" data-step="3" hidden>
          <legend class="fstep-q">How can we reach you?</legend>
          <div class="two-col">
            <div><label for="f-first-${pageType}">First name</label><input id="f-first-${pageType}" name="first_name" autocomplete="given-name" required></div>
            <div><label for="f-last-${pageType}">Last name</label><input id="f-last-${pageType}" name="last_name" autocomplete="family-name" required></div>
          </div>
          <label for="f-phone-${pageType}">Mobile phone</label><input id="f-phone-${pageType}" name="phone" type="tel" autocomplete="tel" required><p class="field-hint">So Nathanael can call or text you about this property.</p>
          <label for="f-email-${pageType}">Email</label><input id="f-email-${pageType}" name="email" type="email" autocomplete="email" required><p class="field-hint">Your written options are emailed here.</p>
          <label class="check"><input type="checkbox" name="consent_response" value="yes" required><span>${esc(site.name)} may contact me by phone, text, or email about this property.</span></label>
          <label class="check"><input type="checkbox" name="consent_marketing" value="yes"><span>Also send me occasional seller tips and market updates. <span class="muted">(optional)</span></span></label>
          <label class="hp" aria-hidden="true">Company<input name="company" tabindex="-1" autocomplete="off"></label>
          <p class="trust-note">Nathanael follows up himself, not a call center. Your number is never shared for anyone else’s marketing. You can say stop anytime.</p>
          <div class="fstep-nav"><button class="btn btn-ghost" type="button" data-back>Back</button><button class="btn btn-gold" type="submit">Get my cash offer</button></div>
          <p class="form-note">Consent is not a condition of any sale. Msg &amp; data rates may apply; reply STOP to opt out. We never share your number for others’ marketing. See our <a href="/privacy">Privacy Policy</a>.</p>
        </fieldset>
        <p class="form-status" role="status" aria-live="polite"></p>
        <p class="form-alt">Prefer to talk? Call or text <a href="tel:${site.phoneHref}">${esc(site.phone)}</a></p>
        <p class="reply-line" data-reply-line data-days="${site.replyHours.days.join(',')}" data-open="${site.replyHours.open}" data-close="${site.replyHours.close}" aria-live="off"></p>
      </form>
    </aside>`;
}


// Opendoor-style address bar. It hands the street and ZIP to the page's stepped #lead-form (see script.js);
// without JavaScript it simply jumps to that form.
const addrBar = (id, cta) => `<form class="addr-bar" data-hero-address action="#lead-form" novalidate>
      <label class="sr-only" for="${id}-street">Property street address</label>
      <input id="${id}-street" name="street" autocomplete="address-line1" placeholder="Property street address">
      <label class="sr-only" for="${id}-zip">ZIP code</label>
      <input id="${id}-zip" name="zip" autocomplete="postal-code" inputmode="numeric" maxlength="10" placeholder="ZIP">
      <button class="btn btn-gold" type="submit" data-cta="${cta}">Get my cash offer</button>
    </form>`;

// Navy photo header used across inner pages (same family as the home and How It Works heroes).
const imageHeader = (img, inner, cls = '') => `<section class="hero image-header${cls ? ` ${cls}` : ''}">
  ${heroPicture(img)}
  <div class="container ih-inner">
    ${inner}
  </div>
</section>
`;
const answerBox = (text, label = 'Quick answer') => `<div class="answer-box"><p class="answer-label">${label}</p><p>${text}</p></div>`;

const faqList = (list) => `<div class="faq-list">${list
  .map(([q, a]) => `<details class="faq" id="${faqId(q)}"><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`)
  .join('')}</div>`;

const finalCta = (href = '#lead-form') => `<section class="section final-cta">
  <div class="container final-cta-grid">
    <div><p class="eyebrow gold-dark">Ready When You Are</p><h2>Want a cash offer on your house?</h2><p>Send us the address and we’ll review it. You can also call or text <a class="link" href="tel:${site.phoneHref}">${esc(site.phone)}</a>.</p></div>
    <a class="btn btn-gold big" href="${href}" data-cta="final">Get my cash offer</a>
  </div>
</section>`;

// Four steps, in order; the list order carries the sequence, no numerals.
const steps = () => `<ol class="steps">
      ${processSteps.map(([h, p]) => `<li><div><h3>${esc(h)}</h3><p>${esc(p)}</p></div></li>`).join('\n      ')}
    </ol>`;



const compareRows = [
  ['Repairs', 'As-is terms in writing', 'Optional; may affect price or financing'],
  ['Showings', 'Initial walkthrough; further access by agreement', 'Showings and open houses may be used'],
  ['Timeline', 'Agreed date, subject to contract, title and escrow', 'Depends on market and buyer financing'],
  ['Commissions', 'None paid to Harbison', 'Typically paid to agents'],
  ['Price', 'Reflects condition, costs, and convenience', 'Can be higher, especially for move-in-ready homes'],
];
// How It Works: the two ways to sell as two numbered lists. Phase names only; no day counts or promises.
const directPhases = ['Send the address', 'Walkthrough', 'Written offer', 'Escrow', 'Close'];
const listingPhases = ['Repairs', 'Photos & staging', 'Showings', 'Offers & negotiation', 'Buyer financing', 'Escrow', 'Close'];
const flowChart = () => `<div class="tracks" role="group" aria-label="Two ways to sell">
      <div class="track track-us"><h3>Sell directly to Harbison</h3><ol>${directPhases.map((p) => `<li>${p}</li>`).join('')}</ol></div>
      <div class="track track-li"><h3>Traditional listing</h3><ol>${listingPhases.map((p) => `<li>${p}</li>`).join('')}</ol></div>
    </div>
    <p class="routes-note">Typical steps only. Every sale depends on the property, the written agreement, title and escrow.</p>`;

const compareTable = ({ collapsed = false } = {}) => `${collapsed ? '<details class="vs-details"><summary>Compare the details</summary>' : ''}<table class="vs-table">
      <caption class="sr-only">Selling directly to Harbison compared with a traditional listing</caption>
      <thead><tr><td></td><th scope="col">Sell directly to Harbison</th><th scope="col">Traditional listing</th></tr></thead>
      <tbody>
      ${compareRows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('\n      ')}
      </tbody>
    </table>${collapsed ? '</details>' : ''}
    <p class="disclosure">${esc(compareDisclosure)}</p>
    <p class="disclosure">Property access, inspections, repairs and closing timing depend on the written agreement, title and escrow. Ask an independent broker or attorney to review the proposed terms before signing.</p>`;

const netEstimator = (ctaHref = '#lead-form') => `<div class="estimator" id="estimator" data-net-estimator>
      <p class="eyebrow gold-dark">Interactive Net Proceeds Estimator</p>
      <h3 class="est-title">Test rough numbers: fix &amp; list vs. direct as-is sale</h3>
      <p class="est-sub">Slide the values below to see how repair costs, holding time, and selling expenses affect what you actually walk away with.</p>
      <div class="est-controls">
        <label class="est-field">
          <span>Estimated fixed-up value: <strong data-est-arv-out>$350,000</strong></span>
          <input type="range" min="150000" max="900000" step="10000" value="350000" data-est-arv>
        </label>
        <label class="est-field">
          <span>Condition &amp; repair scope</span>
          <select data-est-repairs>
            <option value="0">Move-in ready (~$0 repairs)</option>
            <option value="15000">Light cosmetic updates (~$15,000)</option>
            <option value="40000" selected>Moderate updates / systems (~$40,000)</option>
            <option value="75000">Major roof, foundation, or plumbing (~$75,000)</option>
            <option value="115000">Full rehab or heavy damage (~$115,000)</option>
          </select>
        </label>
        <label class="est-field">
          <span>Months to renovate &amp; close on market: <strong data-est-months-out>5 months</strong></span>
          <input type="range" min="2" max="9" step="1" value="5" data-est-months>
        </label>
      </div>
      <div class="compare-wrap">
        <table class="compare offer-table">
          <caption class="sr-only">Illustrative net proceeds comparison</caption>
          <thead><tr><th scope="col">Illustrative line item</th><th scope="col">Direct As-Is Sale</th><th scope="col">Fix &amp; List</th></tr></thead>
          <tbody>
            <tr><th scope="row">Gross sale price</th><td data-out-direct-gross>$229,000 – $245,000</td><td data-out-list-gross>$350,000</td></tr>
            <tr><th scope="row">Out-of-pocket repairs (+10% buffer)</th><td>$0</td><td data-out-list-repairs>−$44,000</td></tr>
            <tr><th scope="row">Agent commissions (illustrative 5%)</th><td>$0</td><td data-out-list-comm>−$17,500</td></tr>
            <tr><th scope="row">Seller closing &amp; transfer costs</th><td data-out-direct-close>−$1,400</td><td data-out-list-close>−$5,250</td></tr>
            <tr><th scope="row">Holding costs (taxes, utilities, carry)</th><td data-out-direct-hold>−$875</td><td data-out-list-hold>−$7,875</td></tr>
            <tr class="total"><th scope="row">Illustrative net before loan payoff</th><td data-out-direct-net>$226,725 – $242,725</td><td data-out-list-net>≈ $275,375</td></tr>
            <tr><th scope="row">Typical timeline</th><td>2–4 weeks</td><td data-out-list-time>~5 months</td></tr>
          </tbody>
        </table>
      </div>
      <div class="est-foot">
        <p class="note-small">Illustrative estimate only, not an appraisal, formula, or offer. Actual offers and listing results depend on neighborhood comps, exact repair scope, title, and market demand.</p>
        <a class="btn btn-gold" href="${ctaHref}" data-cta="estimator">Get real numbers for my property</a>
      </div>
    </div>`;

const transparencyList = () => `<ul class="promise-list">${transparency.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

// Shown on every situation page: the realistic paths for this kind of property.
const pathsBlock = () => `<h3>Possible paths</h3><ul class="path-mini">${routes
  .map((r) => `<li><strong>${esc(r.name)}.</strong> ${esc(r.text)}</li>`)
  .join('')}</ul>
      <p class="note-small"><strong>What we don’t provide:</strong> legal, tax, or financial advice. For probate, trusts, taxes, or tenant disputes, we’ll suggest you check with an attorney or CPA, and we’re happy to coordinate with them.</p>`;


// Guides read like a small blog: newest first, featured on top, then a two-column list. No stock photos.
const readMins = (g) => Math.max(3, Math.round(g.sections.flatMap(([h, ps]) => [h, ...ps]).join(' ').replace(/<[^>]+>/g, ' ').split(/\s+/).length / 200));
const postMeta = (g, newest = false) => `<p class="post-date"><time datetime="${g.updated}">${niceDate(g.updated)}</time> · ${readMins(g)} min read</p>`;
const guideCards = (list = guides) => {
  const [first, ...rest] = [...list].sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  return `<a class="post post-latest" href="/guides/${first.slug}">${postMeta(first, true)}<h2>${esc(first.title)}</h2><p class="post-dek">${esc(first.description)}</p></a>
    <ol class="post-list">${rest
    .map((g) => `<li><a class="post" href="/guides/${g.slug}">${postMeta(g)}<h3>${esc(g.title)}</h3><p class="post-dek">${esc(g.description)}</p></a></li>`)
    .join('')}</ol>`;
};

// Home shows the questions sellers ask first; every FAQ still appears on the pages it belongs to.
const homeFaqs = [0, 3, 13, 10, 4].map((i) => faqs[i]);

const crumbNav = (crumbs) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs.map(([n, p], i) => (i < crumbs.length - 1 ? `<li><a href="${p}">${esc(n)}</a></li>` : `<li aria-current="page">${esc(n)}</li>`)).join('')}</ol></nav>`;

// ---------- Pages ----------

export function homePage() {
  const title = 'We Buy Houses for Cash in Bakersfield, CA | Call Harbison';
  const description = 'Compare a cash as-is offer on your Bakersfield or Kern County house with listing. Written terms, local licensed agent, no obligation. Call (661) 472-7499.';
  return page(
    {
      title,
      description,
      path: '/',
      pageType: 'home',
      image: sized(images.hero, 1200, 630),
      preload: images.hero,
      ld: graph({ path: '/', title, description, image: sized(images.hero, 1200, 630), faq: homeFaqs, speakableSelectors: ['h1', '.hero-lead'] }),
    },
    `<section class="hero home-hero">
  ${heroPicture(images.hero)}
  <div class="container hero-split">
    <div class="hero-copy">
      <h1>Property problem? <em>Call Harbison</em></h1>
      <p class="hero-lead">We buy houses as-is for cash in Bakersfield and across Kern County. No cleaning or repairs are needed for the initial review.</p>
      ${addrBar('hero', 'hero')}
      <p class="hero-reassure">It’s free, and you’re under no obligation.</p>
      <div class="hero-chips"><p>Or tell us what’s going on:</p><button type="button" data-situation="I inherited the property">Inherited</button><button type="button" data-situation="The property needs major repairs">Needs repairs</button><button type="button" data-situation="There are tenant or rental issues">Tenants</button><button type="button" data-situation="The property is vacant">Vacant</button><button type="button" data-situation="I am unsure what to do">Not sure</button></div>
    </div>
  </div>
</section>

<div class="sticky-offer" data-sticky-offer hidden><div class="container">${addrBar('sticky', 'sticky_bar')}</div></div>

<section class="section" id="compare">
  <div class="container note">
    <img class="note-photo" src="${headshot}" alt="${esc(site.agent)}, REALTOR®, Call Harbison" width="800" height="800" loading="lazy" decoding="async">
    <div class="note-body">
      <h2>Cash sale or listing? See both</h2>
      <p class="note-lead">I buy houses, and I also list them. So I don’t need to talk you into either one. I’ll show you both numbers side by side, and if listing would put more in your pocket, I’ll tell you.</p>
      <p>A direct sale is as-is. It starts with one walkthrough and closes on a date we agree on in writing, subject to title and escrow. A listing usually takes longer and costs more to get ready, but it can bring a higher price, especially for a home that’s move-in ready.</p>
      <p>Here are <a href="/when-not-to-sell">five times I’d tell you not to sell to me</a>. Already have an offer from someone else? <a href="/second-opinion">Send it over and I’ll read it for free.</a></p>
      <p class="note-sign">Nathanael Harbison<span>REALTOR®, DRE #${esc(site.dre)}</span></p>
    </div>
  </div>
</section>

<section class="section" id="faq">
  <div class="container narrow">
    <h2>Questions about selling for cash</h2>
    ${faqList(homeFaqs)}
    <p class="faq-more">Not selling? Nathanael also works with <a href="/buyers">buyers</a> and <a href="/investors" data-cta="investor_inquiry">investors</a>, and can help you <a href="/home-value">understand your home’s value</a>.</p>
  </div>
</section>

<div class="offer-flow" id="offer-flow" hidden>
  <div class="flow-bar"><a class="flow-home" href="/" data-flow-close aria-label="${esc(site.name)} home"><img src="${logoReverse}" alt="${esc(site.name)}" width="168" height="40"></a><button class="flow-close" type="button" data-flow-close><span>Close</span><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>
  <div class="flow-body">
    ${leadForm({ pageType: 'home' })}
    <p class="flow-text flow-asks">The form asks for the property address, your name, phone number, and permission to respond.</p>
    <p class="flow-text">Rather not fill out a form? <a href="sms:${site.phoneHref}" data-flow-sms data-cta="flow_text">Text Nathanael</a></p>
  </div>
</div>`
  );
}

function detailPage({ item, path, crumbs, eyebrow, extra = '', form = {}, pageType = 'page', service }) {
  const allFaqs = item.faqs ? [...item.faqs, ...faqs.slice(0, 3)] : faqs.slice(0, 4);
  const title = pageTitle(item.title);
  const heroImg = item.image;
  const ogImg = sized(item.image, 1200, 630);
  return page(
    {
      title,
      description: item.description,
      path,
      pageType,
      image: ogImg,
      ld: graph({ path, title, description: item.description, image: ogImg, crumbs, faq: allFaqs, extra: [service] }),
    },
    `<section class="hero hero-sub">
  ${heroPicture(item.image)}
  <div class="container hero-grid">
    <div class="hero-copy">
      ${crumbNav(crumbs)}
      <p class="eyebrow gold">${esc(eyebrow)}</p>
      <h1 class="h1-sub">${item.headline}</h1>
      <p class="hero-lead">${esc(item.lead)}</p>
    </div>
    ${leadForm({ ...form, pageType })}
  </div>
</section>

<section class="section cream">
  <div class="container narrow">
    <article class="prose">
      ${answerBox(esc(item.answer))}
      <h2 class="prose-h">${esc(item.title)}</h2>
      ${item.body.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
      ${(localSections[item.slug] || []).map(([h, paragraphs]) => `<section${item.slug === 'land-development' ? ' id="tehachapi-land"' : ''}><h2>${esc(h)}</h2>${paragraphs.map(p => `<p>${p}</p>`).join('')}</section>`).join('')}
      ${extra}
      <p class="updated">Last updated ${niceDate(contentDate(path))} · Reviewed by the ${esc(site.name)} team</p>
    </article>
  </div>
</section>

<section class="section navy">
  <div class="container">
    <div class="section-head center">
      <h2>What happens after you send the address</h2>
    </div>
    ${steps(true)}
  </div>
</section>

<section class="section cream">
  <div class="container narrow">
    <div class="section-head center"><p class="eyebrow gold-dark">Questions</p><h2>Common <em>questions</em></h2></div>
    ${faqList(allFaqs)}
  </div>
</section>

${finalCta()}`
  );
}

const relatedGuidesFor = (slug) => guides.filter((g) => g.related.includes(slug));
const guideLinks = (list) =>
  list.length ? `<h3>Helpful guides</h3><ul class="link-list">${list.map((g) => `<li><a href="/guides/${g.slug}">${esc(g.title)}</a></li>`).join('')}</ul>` : '';

export function situationPage(s) {
  const others = situations.filter((o) => o.slug !== s.slug);
  const url = `${site.url}/situations/${s.slug}`;
  const familyLink = ['life-change', 'inherited-property', 'relocation'].includes(s.slug)
    ? `<h3>Helping a loved one move?</h3><ul class="link-list"><li><a href="${family.path}">Selling a loved one’s house in Kern County: as-is vs. listing</a></li></ul>`
    : '';
  const extra = `${pathsBlock()}${familyLink}${guideLinks(relatedGuidesFor(s.slug))}
      <h3>Where we buy</h3><ul class="chip-list">${areas.map((a) => `<li><a href="/areas/${a.slug}">${esc(a.name)}</a></li>`).join('')}</ul>
      <h3>Other situations we help with</h3><ul class="chip-list">${others.map((o) => `<li><a href="/situations/${o.slug}">${esc(o.name)}</a></li>`).join('')}</ul>`;
  return detailPage({
    item: s,
    path: `/situations/${s.slug}`,
    crumbs: [['Home', '/'], ['Situations', '/situations'], [s.name, `/situations/${s.slug}`]],
    eyebrow: `${s.name} • ${site.region}`,
    extra,
    pageType: 'situation',
    form: { situation: situationFormMap[s.slug] || '', heading: 'Get options for this property' },
    service: serviceLd({ name: s.title, description: s.description, url, areaServed: areas.map(placeLd) }),
  });
}

export function areaPage(a) {
  const url = `${site.url}/areas/${a.slug}`;
  const otherAreas = areas.filter((o) => o.slug !== a.slug);
  const placeChip = (p) => {
    const match = otherAreas.find((o) => o.name.toLowerCase() === p.toLowerCase());
    return match ? `<a href="/areas/${match.slug}">${esc(p)}</a>` : `<span>${esc(p)}</span>`;
  };
  const extra = `<h3>Communities we cover near ${esc(a.name)}</h3><ul class="chip-list">${a.places.map((p) => `<li>${placeChip(p)}</li>`).join('')}</ul>
      <h3>Situations we help with in ${esc(a.name)}</h3><ul class="chip-list">${situations.map((o) => `<li><a href="/situations/${o.slug}">${esc(o.name)}</a></li>`).join('')}</ul>
      ${a.slug === 'bakersfield' ? `<h3>Bakersfield ZIP codes we cover</h3><ul class="chip-list">${bakersfieldZips.map((z) => `<li><span>${z}</span></li>`).join('')}</ul>` : ''}
      ${guideLinks(guides)}
      <h3>Other areas we serve</h3><ul class="chip-list">${otherAreas.map((o) => `<li><a href="/areas/${o.slug}">${esc(o.name)}</a></li>`).join('')}</ul>`;
  return detailPage({
    item: {
      ...a,
      helps: ['No repairs or cleaning needed for the initial review', 'Property access arranged by agreement', 'Closing date agreed in writing', 'We compare every option with you', `Licensed local agent, DRE #${site.dre}`],
    },
    path: `/areas/${a.slug}`,
    crumbs: [['Home', '/'], [a.name, `/areas/${a.slug}`]],
    eyebrow: `We Buy Houses • ${a.name}, CA`,
    extra,
    pageType: 'location',
    form: { city: a.slug === 'kern-county' ? '' : a.name, location: a.slug, heading: `Get options for your ${a.name} property` },
    service: serviceLd({ name: a.title, description: a.description, url, areaServed: placeLd(a) }),
  });
}

// The six situations sellers bring up most; the rest stay one click away.
const TOP_SITUATIONS = ['inherited-property', 'needs-major-repairs', 'behind-on-mortgage', 'problem-tenants', 'vacant-property', 'life-change'];
const topSituations = () => TOP_SITUATIONS.map((slug) => situations.find((s) => s.slug === slug)).filter(Boolean);

export function situationsIndexPage() {
  const title = pageTitle('Situations We Buy Houses for Cash In');
  const description = `Inherited homes, major repairs, vacant properties, problem tenants, fire damage and more. See how ${site.name} buys ${site.region} houses for cash, as-is.`;
  const crumbs = [['Home', '/'], ['Situations', '/situations']];
  return page(
    {
      title,
      description,
      path: '/situations',
      pageType: 'situations_index',
      hasForm: false,
      image: sized(images.street, 1200, 630),
      ld: graph({
        path: '/situations', title, description, image: sized(images.street, 1200, 630), type: 'CollectionPage', crumbs,
        extra: [{ '@type': 'ItemList', '@id': `${site.url}/situations#list`, itemListElement: situations.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.name, url: `${site.url}/situations/${s.slug}` })) }],
      }),
    },
    `${imageHeader(images.street, `${crumbNav(crumbs)}
    <h1 class="page-title">Situations where we <em>buy houses for cash</em></h1>
    <p class="page-intro">Pick the situation closest to yours to see how we can help. Or just <a class="link" href="/#lead-form">send us the address</a>.</p>`)}
<section class="section sit-index">
  <div class="container">
    <ul class="sit-list">
      ${topSituations().map((s) => `<li><a href="/situations/${s.slug}"><h2>${esc(s.name)}</h2><p>${esc(s.lead)}</p></a></li>`).join('\n      ')}
    </ul>
    <nav class="sit-also" aria-label="More situations"><h2>Also</h2>${situations.filter((s) => !TOP_SITUATIONS.includes(s.slug)).map((s) => `<a href="/situations/${s.slug}">${esc(s.name)}</a>`).join('')}</nav>
    <p class="sit-more">Don’t see yours? <a class="link" href="/#lead-form">Send us the address</a></p>
  </div>
</section>`
  );
}

export function aboutPage() {
  const title = pageTitle(`${about.title}, REALTOR®`);
  const crumbs = [['Home', '/'], ['About', '/about']];
  const image = `${site.url}${ogDefault}`;
  return page(
    {
      title,
      description: about.description,
      path: '/about',
      pageType: 'about',
      image,
      preload: headshot,
      hasForm: false,
      ld: graph({ path: '/about', title, description: about.description, image, type: 'ProfilePage', crumbs }),
    },
    `<section class="hero image-header about-head">
  ${heroPicture(images.local)}
  <div class="container ih-inner">
    ${crumbNav(crumbs)}
    <div class="about-hero">
      <img class="headshot" src="${headshot}" alt="${esc(site.agent)}, REALTOR®, Call Harbison" width="325" height="325" fetchpriority="high">
      <div>
        <p class="eyebrow gold">About Call Harbison</p>
        <h1 class="page-title light">Meet <em>${esc(site.agent)}</em></h1>
        <p class="light-soft about-lead">California-licensed REALTOR®, DRE #${esc(site.dre)}, with ${esc(site.brokerage)}</p>
      </div>
    </div>
  </div>
</section>
<section class="section cream">
  <div class="container narrow">
    <article class="prose">
      ${answerBox(`${esc(site.agent)} is a California-licensed REALTOR® (DRE #${esc(site.dre)}) with ${esc(site.brokerage)} who leads ${esc(site.name)}. He helps Kern County property owners sell as-is, list, renovate, or develop, and compares those options honestly before anyone commits.`, 'Who is Nathanael Harbison?')}
      ${about.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
      <h2 class="prose-h">How we work</h2>
      <dl class="principles">${about.principles.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <h2 class="prose-h">Verify &amp; connect</h2>
      <p class="verify-dre"><span class="verify-num">DRE #${esc(site.dre)}</span> <a href="${site.agentLicenseUrl}" rel="noopener" target="_blank">Look up the license on the California Department of Real Estate site</a></p>
      <div class="profile-grid">${socialLinks()}</div>
    </article>
  </div>
</section>
${finalCta('/#lead-form')}`
  );
}

export function guidesIndexPage() {
  const title = pageTitle('Seller Guides for Kern County Homeowners');
  const description = 'Plain-English guides on cash home buyers, selling a house as-is in California, cash offers vs. listing, and selling an inherited house. From Call Harbison.';
  const crumbs = [['Home', '/'], ['Guides', '/guides']];
  const image = sized(images.renovate, 1200, 630);
  return page(
    {
      title,
      description,
      path: '/guides',
      pageType: 'guides_index',
      image,
      hasForm: false,
      ld: graph({
        path: '/guides', title, description, image, type: 'CollectionPage', crumbs,
        extra: [{ '@type': 'ItemList', '@id': `${site.url}/guides#list`, itemListElement: guides.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.title, url: `${site.url}/guides/${g.slug}` })) }],
      }),
    },
    `${imageHeader(images.list, `${crumbNav(crumbs)}
    <h1 class="page-title">Seller guides for <em>Kern County owners</em></h1>
    <p class="page-intro">Clear, practical guides for Kern County property owners. They are not legal or tax advice, but they are a solid place to start.</p>`)}
<section class="section guides-index">
  <div class="container narrow">
    ${guideCards()}
  </div>
</section>
${finalCta('/#lead-form')}`
  );
}

export function guidePage(g) {
  const path = `/guides/${g.slug}`;
  const url = `${site.url}${path}`;
  const title = pageTitle(g.title);
  const crumbs = [['Home', '/'], ['Guides', '/guides'], [g.short, path]];
  const image = sized(g.image, 1200, 630);
  const toc = g.sections.map(([h], i) => `<li><a href="#s${i + 1}">${esc(h)}</a></li>`).join('');
  const related = situations.filter((s) => g.related.includes(s.slug));
  const article = {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: g.title,
    description: g.description,
    image,
    datePublished: g.published || g.updated,
    dateModified: g.updated,
    author: { '@id': ids.org },
    publisher: { '@id': ids.org },
    about: g.sections.map(([h]) => ({ '@type': 'Thing', name: h })),
    inLanguage: 'en-US',
  };
  return page(
    { title, description: g.description, path, image, article: g, pageType: 'guide', hasForm: false, ld: graph({ path, title, description: g.description, image, crumbs, extra: [article], modified: g.updated }) },
    `${imageHeader(g.image, `${crumbNav(crumbs)}
    <h1 class="page-title guide-title">${esc(g.title)}</h1>
    <p class="updated">By the ${esc(site.name)} team · Published <time datetime="${g.published || g.updated}">${niceDate(g.published || g.updated)}</time> · Last updated <time datetime="${g.updated}">${niceDate(g.updated)}</time> · ${readMins(g)} min read</p>`, 'guide-head')}
<div class="read-progress" aria-hidden="true"><span></span></div>
<section class="section page-top guide">
  <div class="container narrow">
    <article class="prose">
      ${answerBox(esc(g.answer), 'The short answer')}
      <nav class="toc" aria-label="In this guide"><p class="answer-label">In this guide</p><ol>${toc}</ol></nav>
      ${g.sections.map(([h, paras], i) => `<section id="s${i + 1}"><h2 class="prose-h">${esc(h)}</h2>${paras.map((p) => (p.startsWith('<ul') || p.startsWith('<div') ? p : `<p>${p}</p>`)).join('')}</section>`).join('\n      ')}
      ${g.slug === 'cash-offer-vs-listing' ? netEstimator('/#lead-form') : ''}
      ${g.meaning ? `<aside class="meaning"><h2>What this means for your property</h2><p>${esc(g.meaning)}</p><a class="btn btn-gold" href="/#lead-form" data-cta="guide_meaning">Get options for my property</a></aside>` : ''}
      <aside class="author-box"><img class="author-photo" src="${headshot}" alt="${esc(site.agent)}" width="64" height="64" loading="lazy"><div><p class="answer-label">About the author</p><p>Written by the ${esc(site.name)} team, led by ${esc(site.agent)}, California-licensed REALTOR® (DRE #${esc(site.dre)}) with ${esc(site.brokerage)} <a class="link" href="/about">About Nathanael</a></p></div></aside>
      <p class="disclaimer">This guide is educational and does not replace legal, tax, or financial advice. Laws and thresholds change. Consult a qualified attorney, CPA, or your agent about your specific situation.</p>
      <h3>Related situations</h3><ul class="chip-list">${related.map((s) => `<li><a href="/situations/${s.slug}">${esc(s.name)}</a></li>`).join('')}</ul>
      <h3>More guides</h3><ul class="link-list">${guides.filter((o) => o.slug !== g.slug).map((o) => `<li><a href="/guides/${o.slug}">${esc(o.title)}</a></li>`).join('')}</ul>
    </article>
  </div>
</section>
${finalCta('/#lead-form')}`
  );
}

export function inquiryPage(item) {
  const path = `/${item.slug}`;
  const title = pageTitle(item.title);
  return page({ title, description: item.description, path, pageType: 'inquiry', hasForm: false,
    ld: graph({ path, title, description: item.description, modified: '2026-11-06' }) },
    `${imageHeader(item.image || images.suburban, `${crumbNav([['Home', '/'], [item.title, path]])}<h1 class="page-title">${esc(item.title)}</h1>`)}
<section class="section"><div class="container detail-grid"><article class="prose">
      ${item.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}
      <p><a href="/situations/land-development">Land and development due diligence</a> · <a href="/how-it-works#estimator">Illustrative net-proceeds calculator</a></p>
      <h2>Choose your next conversation</h2><ul>${inquiryPages.filter(p => p.slug !== item.slug).map(p => `<li><a href="/${p.slug}">${esc(p.title)}</a></li>`).join('')}</ul>
    </article><aside class="lead-card" id="lead-form"><h2>Start a conversation</h2>
      <form data-lead-form data-form-type="options" method="post" action="/api/leads" novalidate>
        <input type="hidden" name="form_type" value="options"><input type="hidden" name="route_interest" value="${item.route}">
        <input type="hidden" name="situation" value="${esc(item.situation)}"><input type="hidden" name="page_type" value="inquiry">
        <label for="inquiry-name">Name</label><input id="inquiry-name" name="name" autocomplete="name" required>
        <label for="inquiry-phone">Phone</label><input id="inquiry-phone" name="phone" type="tel" autocomplete="tel" required>
        <label for="inquiry-email">Email (optional)</label><input id="inquiry-email" name="email" type="email" autocomplete="email">
        <label for="inquiry-area">Area of interest (optional)</label><select id="inquiry-area" name="location_interest"><option value="">Choose an area</option>${areas.map(a => `<option value="${a.slug}">${esc(a.name)}</option>`).join('')}</select>
        <p>No property ownership or address is required to ask a question. Share property details privately during follow-up.</p>
        <label class="check"><input type="checkbox" name="consent_response" value="yes" required><span>${esc(site.name)} may contact me by phone, text, or email about this inquiry.</span></label>
        <label class="check"><input type="checkbox" name="consent_marketing" value="yes"><span>Also send me occasional property tips and market updates. (optional)</span></label>
        <label class="hp" aria-hidden="true">Company<input name="company" tabindex="-1" autocomplete="off"></label>
        <button type="submit" class="btn btn-gold btn-full">Send my inquiry</button>
        <p class="form-note">Consent is not a condition of any sale. Msg &amp; data rates may apply; reply STOP to opt out. We never share your number for others' marketing. See our <a href="/privacy">Privacy Policy</a>.</p>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form></aside></div></section>`);
}

function simplePage({ title, description, path, heading, body, noindex = false, pageType = 'page' }) {
  return page(
    { title: pageTitle(title), description, path, noindex, pageType, hasForm: false, ld: noindex ? null : graph({ path, title: pageTitle(title), description, image: `${site.url}${ogDefault}` }) },
    `${imageHeader(images.valley, `<h1 class="page-title">${heading}</h1>`, 'ih-short')}
<section class="section">
  <div class="container narrow prose legal">
    ${body}
  </div>
</section>`
  );
}

// Optional follow-up questions. The lead already exists; these add context for the first call.
const detailRadios = (name, list) => `<div class="choice-grid" role="radiogroup">${list
  .map((o) => `<label class="choice"><input type="radio" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`)
  .join('')}</div>`;
const detailChecks = (name, list) => `<div class="choice-grid">${list
  .map((o) => `<label class="choice"><input type="checkbox" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`)
  .join('')}</div>`;

// ---------- Seller tools: second opinion, when not to sell, inherited-house deadlines ----------
function toolPage({ title, description, path, heading, intro, body, pageType, form = '', image = images.classic }) {
  return page(
    { title: pageTitle(title), description, path, pageType, hasForm: Boolean(form), ld: graph({ path, title: pageTitle(title), description, image: `${site.url}${ogDefault}`, crumbs: [['Home', '/'], [title, path]] }) },
    `${imageHeader(image, `${crumbNav([['Home', '/'], [title, path]])}
    <h1 class="page-title">${heading}</h1>
    <p class="page-intro">${intro}</p>`)}
<section class="section tool-page">
  <div class="container narrow">
    ${body}
  </div>
</section>${form ? `
<section class="section">
  <div class="container narrow">${form}</div>
</section>` : `
${finalCta('/#lead-form')}`}`
  );
}

const offerClauses = [
  ['“Buyer and/or assigns”', 'The person signing may not be the one who buys. The contract can be sold to someone else for a fee. Ask whether the buyer will close with their own money, and ask for proof of funds.'],
  ['Inspection or due-diligence period', 'How many days the buyer has to inspect and cancel. A long period with an easy exit can tie up your house while the buyer looks for someone else.'],
  ['Earnest money deposit', 'How much the buyer puts down and when it becomes non-refundable. A small deposit that stays refundable for weeks gives the buyer little reason to close.'],
  ['Closing costs and fees', 'Who pays escrow, title, transfer tax and any “processing” fees. Some offers move these costs to the seller in the fine print.'],
  ['Price changes after a walkthrough', 'Language that lets the buyer renegotiate after seeing the house. The first number is not always the final number.'],
  ['Closing date', 'Whether the date is fixed in writing, and what happens if the buyer misses it.'],
  ['Proof of funds', 'A cash buyer should be able to show the money. A letter from a lender is not cash.'],
];

export function secondOpinionPage() {
  const sms = `sms:${site.phoneHref}?&body=${encodeURIComponent('Hi Nathanael, here is a photo of an offer I received. Can you explain it?')}`;
  return toolPage({
    title: 'Get a Second Opinion on a Cash Offer',
    description: 'Already have a cash offer on your Kern County house? Text a photo and a licensed local agent will explain the terms in plain English. Free, no obligation.',
    path: '/second-opinion',
    pageType: 'second_opinion',
    heading: 'Already have a cash offer? <em>Get a second opinion</em>',
    intro: `Text a photo of any cash offer or purchase contract to ${esc(site.phone)}. Nathanael will explain in plain English what it says: who the buyer is, when they can walk away, and roughly what you would net. It’s free, even if you never sell to us.`,
    body: `<div class="tool-actions"><a class="btn btn-gold big" href="${sms}" data-cta="second_opinion_text">Text a photo of my offer</a><a class="btn btn-ghost big" href="mailto:${esc(site.email)}?subject=${encodeURIComponent('Second opinion on an offer')}" data-cta="second_opinion_email">Email it instead</a></div>
    <p class="tool-note">If you have already signed, Nathanael will explain the terms only. He will not ask you to break a contract. He is a licensed real estate agent, not an attorney; for legal questions, ask a California attorney.</p>
    <h2 class="tool-h">Clauses worth a second look</h2>
    <dl class="clause-list">${offerClauses.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`,
  });
}

const notToSell = [
  ['The house is in good shape and homes like it are selling', 'Listing will probably net you more. We will say so, and we can list it for you.'],
  ['You are behind on payments, but your income is back', 'Talk to a HUD-approved housing counselor first. It’s free. <a href="https://www.consumerfinance.gov/find-a-housing-counselor/" rel="noopener" target="_blank">Find one here</a>. Ask your loan servicer about a loan modification or a repayment plan before you decide to sell.'],
  ['You inherited the house and want to keep it', 'If an heir moves in as their main home, California’s Prop 19 may let the family keep the parent’s property-tax base. Check the <a href="/inherited-house-deadlines">inherited house deadlines</a> first.'],
  ['There is a reverse mortgage and the house is worth less than the balance', 'Reverse mortgages are usually non-recourse. Heirs may be able to let the lender take the house without owing the difference. Ask the loan servicer or a housing counselor before you sell.'],
  ['You want the highest possible price and have the time and money for repairs', 'Fixing up and listing can bring a higher price. The <a href="/how-it-works#estimator">net estimator</a> shows the trade-off.'],
];

export function whenNotToSellPage() {
  return toolPage({
    title: 'When You Shouldn’t Sell Your House to Us',
    description: 'Five situations where a direct cash sale is usually the wrong call, and what Kern County owners can look at instead. From Call Harbison.',
    path: '/when-not-to-sell',
    pageType: 'when_not_to_sell',
    heading: 'Five times we’ll tell you <em>not to sell to us</em>',
    intro: 'Harbison buys houses and also lists them, so we don’t need to talk you into either one. Here is when a direct cash sale is usually the wrong call, and what to look at instead.',
    body: `<ol class="honest-list">${notToSell.map(([h, p]) => `<li><h2>${h}</h2><p>${p}</p></li>`).join('')}</ol>
    <p class="tool-close">If none of these fit, a direct sale may make sense. <a class="link" href="/#lead-form">Send us the address</a> and we’ll show you both numbers.</p>`,
  });
}

export function deadlinesPage() {
  const yn = (name, q, unsure = true) => `<fieldset class="dl-q"><legend>${q}</legend><div class="choice-grid choice-row" role="radiogroup">
        <label class="choice"><input type="radio" name="${name}" value="yes"><span>Yes</span></label>
        <label class="choice"><input type="radio" name="${name}" value="no"><span>No</span></label>${unsure ? `
        <label class="choice"><input type="radio" name="${name}" value="unsure"><span>Not sure</span></label>` : ''}
      </div></fieldset>`;
  return toolPage({
    title: 'Inherited House Deadlines in California',
    description: 'See the dates that may matter for an inherited California house: Prop 19, simplified probate, reverse mortgages and property tax. Runs in your browser; nothing is saved.',
    path: '/inherited-house-deadlines',
    pageType: 'deadlines',
    heading: 'Inherited a house? <em>See the dates that matter</em>',
    intro: 'Answer a few questions to see the deadlines that may apply to an inherited California house. Everything runs in your browser. Nothing is saved or sent unless you choose to send it.',
    body: `<form class="deadline-form" data-deadlines novalidate>
      <label class="dl-date">Date of death<input type="date" name="dod" required></label>
      ${yn('primary', 'Was it the parent’s or grandparent’s main home?', false)}
      ${yn('movein', 'Will a child or grandchild move in as their main home?')}
      ${yn('hecm', 'Is there a reverse mortgage on the house?')}
      ${yn('value', 'Is the house likely worth $750,000 or less?')}
      <button class="btn btn-gold" type="submit">Show my dates</button>
      <p class="form-status" role="status" aria-live="polite"></p>
    </form>
    <ol class="timeline" data-deadline-out hidden></ol>
    <p class="tool-note">General information, not legal or tax advice. Figures as of November 2026. Confirm with a probate attorney or the Kern County Assessor before you rely on a date.</p>`,
    form: leadForm({ situation: 'I inherited the property', heading: 'Talk it through with Nathanael', pageType: 'deadlines' }),
  });
}

// ---------- Seller Tools: index + one page per tool (each tool only on its own page) ----------
const C = toolCopy;
const extLink = (href) => (/^https?:/.test(href) ? ' rel="noopener" target="_blank"' : '');
const sourcesList = (list) => `<details class="tool-sources"><summary>${C.sources}</summary><ul>${list
  .map(([label, href]) => `<li><a href="${href}"${extLink(href)}>${label}</a></li>`).join('')}</ul></details>`;
const choiceSet = (name, legend, type, opts, cls = 'choice-list') => `<fieldset class="tool-q"><legend>${legend}</legend><div class="choice-grid ${cls}" role="${type === 'radio' ? 'radiogroup' : 'group'}">${opts
  .map(([v, l]) => `<label class="choice"><input type="${type}" name="${name}" value="${v}"><span>${l}</span></label>`).join('')}</div></fieldset>`;

const toolCards = [
  [handoffCopy.groupWork, [
    ...handoffTools.map((t) => [`/${t.slug}`, t.nav, t.desc, '', `tools_${t.route}`]),
    ['/second-opinion', C.cSecond, C.cSecondD, C.cSecondM, 'tools_second_opinion'],
  ]],
  [C.gStart, [['/which-path-fits', C.cPath, C.cPathD, C.cPathM, 'tools_which_path'], ['/when-not-to-sell', C.cNot, C.cNotD, C.cNotM, 'tools_when_not']]],
  [C.gNumbers, [['/seller-net-sheet', C.cNet, C.cNetD, C.cNetM, 'tools_net_sheet']]],
  [C.gReady, [['/paperwork-checklist', C.cPaper, C.cPaperD, C.cPaperM, 'tools_paperwork'], ['/inherited-house-deadlines', C.cDead, C.cDeadD, C.cDeadM, 'tools_deadlines']]],
];

export function sellerToolsPage() {
  const path = '/seller-tools';
  const title = pageTitle(C.idxTitle);
  const crumbs = [['Home', '/'], ['Seller tools', path]];
  return page(
    { title, description: C.idxDesc, path, pageType: 'seller_tools', hasForm: false, ld: graph({ path, title, description: C.idxDesc, image: `${site.url}${ogDefault}`, crumbs }) },
    `${imageHeader(images.suburban, `${crumbNav(crumbs)}
    <h1 class="page-title">Free tools for selling a house. <em>Use them even if you never call us.</em></h1>
    <p class="page-intro">${C.idxIntro}</p>`)}
<section class="section tool-index">
  <div class="container">
    ${toolCards.map(([group, cards]) => `<h2 class="tool-group">${group}</h2>
    <ul class="tool-grid">${cards.map(([href, name, desc, meta, cta]) => `<li class="tool-card"><h3><a href="${href}" data-cta="${cta}">${name}</a></h3><p>${desc}</p>${meta ? `<p class="tool-meta">${meta}</p>` : ''}</li>`).join('')}</ul>`).join('\n    ')}
    <p class="tool-close">Prefer to talk it through? Call or text <a class="link" href="tel:${site.phoneHref}">${esc(site.phone)}</a>. Nathanael will show you both numbers, cash and listing, and tell you which one nets more.</p>
    <p class="tool-note">${C.idxNote}</p>
  </div>
</section>`
  );
}

const money = (name, label, hint = '') => `<label class="ns-field"><span>${label}</span><input name="${name}" inputmode="decimal" autocomplete="off" placeholder="$"></label>${hint ? `<p class="field-hint">${hint}</p>` : ''}`;
const payer = (name) => choiceSet(name, C.nsPayer, 'radio', [['seller', C.pSeller], ['split', C.pSplit], ['buyer', C.pBuyer]], 'choice-chips');
const nsRows = [[C.rPrice, 'price'], [C.rPayoffs, 'payoffs'], [C.rLiens, 'liens'], [C.rComm, 'commission'], [C.rFees, 'buyerFees'], [C.rTax, 'transferTax'], [C.rEscrow, 'escrow'], [C.rRepairs, 'repairs'], [C.rOther, 'other'], [C.rWait, 'waiting']];

export function netSheetPage() {
  return toolPage({
    title: C.nsTitle,
    description: C.nsDesc,
    path: '/seller-net-sheet',
    pageType: 'net_sheet',
    heading: 'What would I <em>walk away with?</em>',
    intro: C.nsIntro,
    body: `<form class="tool-form ns" data-tool="net-sheet" data-dtt-cents-per-500="55" novalidate autocomplete="off">
      <div class="ns-cols">
        <fieldset class="ns-block"><legend>${C.nsColA}</legend>
          ${money('priceA', C.nsPriceA, C.nsPriceAH)}
          ${choiceSet('commA', C.nsComm, 'radio', [1, 2, 3, 4, 5, 6].map((n) => [String(n), `${n}%`]), 'choice-chips')}
          <p class="field-hint">${C.nsCommH}</p>
          ${money('escrowA', C.nsEscrow, C.nsEscrowH)}
          ${money('repairsA', C.nsRepairs)}
          ${money('otherA', C.nsOther)}
          <label class="ns-field"><span>${C.nsMonths}</span><input name="monthsA" inputmode="numeric" autocomplete="off"></label>
          ${payer('payerA')}
        </fieldset>
        <fieldset class="ns-block"><legend>${C.nsColB}</legend>
          ${money('priceB', C.nsPriceB, C.nsPriceBH)}
          ${money('feesB', C.nsFees)}
          ${money('escrowB', C.nsEscrow)}
          <label class="check"><input type="checkbox" name="buyerPaysB"><span>${C.nsBuyerPays}</span></label>
          ${money('otherB', C.nsOther)}
          <label class="ns-field"><span>${C.nsMonths}</span><input name="monthsB" inputmode="numeric" autocomplete="off"></label>
          ${payer('payerB')}
        </fieldset>
      </div>
      <div class="ns-cols">
        <fieldset class="ns-block"><legend>${C.nsOwe}</legend>
          ${money('payoffs', C.nsPayoffs, C.nsPayoffsH)}
          <label class="check"><input type="checkbox" name="noloan"><span>${C.nsNoLoan}</span></label>
          ${money('liens', C.nsLiens)}
        </fieldset>
        <fieldset class="ns-block"><legend>${C.nsWait}</legend>
          ${money('monthly', C.nsMonthly, C.nsMonthlyH)}
          ${choiceSet('mainhome', C.nsMain, 'radio', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']], 'choice-chips')}
        </fieldset>
      </div>
    </form>
    <section class="tool-out ns-out" data-net-out aria-labelledby="ns-out-h">
      <h2 id="ns-out-h">${C.nsOut}</h2>
      <div class="compare-wrap"><table class="compare ns-table"><thead><tr><th scope="col"><span class="sr-only">Line</span></th><th scope="col">${C.nsColA}</th><th scope="col">${C.nsColB}</th></tr></thead><tbody>
        ${nsRows.map(([label, key]) => `<tr><th scope="row">${label}</th><td data-a="${key}">—</td><td data-b="${key}">—</td></tr>`).join('')}
        <tr class="total"><th scope="row">${C.rNet}</th><td data-a="net">—</td><td data-b="net">—</td></tr>
      </tbody></table></div>
      <p class="verdict" role="status" aria-live="polite"></p>
      <p class="ns-hold" hidden></p>
      <ul class="ns-missing" hidden></ul>
      <p class="tool-note">${C.nsProration}</p>
      <p class="tool-note">${C.nsTaxRate}</p>
      <p class="tool-note">${C.nsDisclaimer}</p>
      <p class="tool-cta"><a class="btn btn-gold" href="/#lead-form" data-cta="net_sheet_offer">${C.ctaOffer}</a><a class="link" href="/second-opinion">Second opinion on an offer</a></p>
      ${sourcesList([
        ['Kern County Assessor-Recorder: document recording', 'https://www.kerncounty.com/government/departments/assessor-recorder/records/document-recording'],
        ['Cal. Rev. & Tax. Code §11911 (transfer tax)', 'https://california.public.law/codes/revenue_and_taxation_code_section_11911'],
        ['Cal. Civ. Code §2943 (payoff statements)', 'https://california.public.law/codes/civil_code_section_2943'],
        ['Cal. Bus. & Prof. Code §10147.5 (commissions are negotiable)', 'https://california.public.law/codes/business_and_professions_code_section_10147.5'],
        ['Cal. Rev. & Tax. Code §18662 (real estate withholding)', 'https://california.public.law/codes/revenue_and_taxation_code_section_18662'],
        ['CFPB: find a HUD-approved housing counselor', 'https://www.consumerfinance.gov/find-a-housing-counselor/'],
      ])}
    </section>`,
  });
}

export function whichPathPage() {
  return toolPage({
    title: C.qTitle,
    description: C.qDesc,
    path: '/which-path-fits',
    pageType: 'which_path',
    heading: 'Which path <em>fits me?</em>',
    intro: C.qIntro,
    body: `<form class="tool-form quiz" data-tool="which-path" novalidate>
      ${quizQuestions.map(([id, q, type, opts]) => choiceSet(id, q, type, opts)).join('\n      ')}
      <button class="btn btn-gold" type="submit">${C.qShow}</button>
      <p class="form-status" role="status" aria-live="polite"></p>
    </form>
    <section class="tool-out quiz-out" data-quiz-out hidden>
      ${quizResults.map(([key, h, b]) => `<div class="quiz-result" data-result="${key}" hidden><h2>${h}</h2><p>${b}</p></div>`).join('')}
      <h3>${C.qWhy}</h3>
      <ul class="why">${quizReasons.map(([id, text]) => `<li data-reason="${id}" hidden>${text}</li>`).join('')}</ul>
      <h3 data-notes-h hidden>${C.qNotes}</h3>
      <ul class="notes">${quizNotes.map(([key, text, href]) => `<li data-when="${key}" hidden><p>${text}</p>${href ? `<p><a class="link" href="${href}"${extLink(href)}>Learn more</a></p>` : ''}</li>`).join('')}</ul>
      <p class="tool-cta"><a class="btn btn-gold" href="/#lead-form" data-cta="which_path_talk">${C.ctaTalk}</a><a class="link" href="/seller-net-sheet">${C.ctaNet}</a></p>
      <p class="tool-note">${C.qFooter}</p>
    </section>`,
  });
}

export function paperworkPage() {
  return toolPage({
    title: C.pTitle,
    description: C.pDesc,
    path: '/paperwork-checklist',
    pageType: 'paperwork',
    heading: 'Paperwork <em>checklist</em>',
    intro: C.pIntro,
    body: `<form class="tool-form pw" data-tool="paperwork" novalidate>
      ${paperQuestions.map(([id, q, type, opts]) => choiceSet(id, q, type, opts)).join('\n      ')}
    </form>
    <section class="tool-out pw-out" data-paper-out>
      <p class="pw-count" role="status" aria-live="polite"></p>
      ${paperGroups.map(([group, items]) => `<div class="pw-group"><h2>${group}</h2><ul class="pw-list">${items
        .map(([when, title, why, href]) => `<li data-when="${when}"><label class="check-item"><input type="checkbox"><span>${title}</span></label>${why ? `<p>${why}</p>` : ''}${href ? `<p class="pw-where"><a href="${href}"${extLink(href)}>Where to get it</a></p>` : ''}</li>`).join('')}</ul></div>`).join('\n      ')}
      <p class="tool-cta no-print"><button class="btn btn-ghost" type="button" data-print>${C.pPrint}</button><a class="btn btn-gold" href="/#lead-form" data-cta="paperwork_talk">${C.ctaTalk}</a></p>
      <p class="tool-note">${C.pFooter}</p>
    </section>`,
  });
}

// ---------- Nathanael hand-off tools: each page ends in a text, an email or the offer flow, pre-filled ----------
export function handoffToolPage(tool) {
  const H = handoffCopy;
  const primary = tool.slug === 'both-numbers' ? 'flow' : 'sms';
  return toolPage({
    title: tool.title,
    description: tool.desc,
    path: `/${tool.slug}`,
    pageType: `tool_${tool.route}`,
    heading: tool.heading,
    intro: tool.intro,
    image: images[tool.image] || images.classic,
    body: `<div class="handoff">
      <div class="handoff-info">
        <h2>${tool.listH}</h2>
        <ul class="facts">${tool.list.map((li) => `<li>${li}</li>`).join('')}</ul>
        ${tool.note ? `<p class="tool-note">${tool.note}</p>` : ''}
      </div>
      <form class="tool-form handoff-form" data-tool="handoff" data-kind="${tool.slug}" data-route="${tool.route}" data-situation="${esc(tool.situation)}" data-phone="${site.phoneHref}" data-email="${esc(site.email)}" novalidate>
        <h2>${H.formH}</h2>
        ${tool.chips.length ? choiceSet('topic', tool.chipsH, 'checkbox', tool.chips.map((c) => [c, c]), 'choice-chips') : ''}
        <label class="ns-field"><span>${H.street}</span><input name="street" autocomplete="address-line1" required></label>
        <label class="ns-field"><span>${H.zip}</span><input name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="10" required></label>
        <p class="form-status" role="status" aria-live="polite"></p>
        <div class="tool-cta">${primary === 'flow'
          ? `<button class="btn btn-gold" type="submit" value="flow">${tool.cta}</button><button class="btn btn-ghost" type="submit" value="sms">Text Nathanael</button>`
          : `<button class="btn btn-gold" type="submit" value="sms">${tool.cta}</button><button class="btn btn-ghost" type="submit" value="email">${H.email}</button>`}</div>
        ${primary === 'sms' ? `<p class="field-hint">${H.how}</p><p><a class="link" href="/#lead-form" data-flow-link>${H.flow}</a></p>` : ''}
      </form>
    </div>`,
  });
}

export function thankYouPage() {
  return page(
    { title: pageTitle('Thank You'), description: 'We received your inquiry.', path: '/thank-you', noindex: true, hasForm: false, pageType: 'thank_you' },
    `${imageHeader(images.home, `<h1 class="page-title">We received your <em>inquiry</em></h1>`, 'ih-short')}
<section class="section">
  <div class="container detail-grid">
    <div class="prose">
      <p class="lead">The team will review your request before contacting you about the next step. There is no obligation to move forward. If you recovered an earlier request, this confirms that original request; use Start another inquiry on the form to send a separate request.</p>
      <p>We typically respond within 24 hours. If there’s a specific deadline or issue we should know about, call or text <a class="link" href="tel:${site.phoneHref}">${esc(site.phone)}</a>.</p>
      <div class="ty-person"><img src="${headshot}" alt="" width="64" height="64"><p><strong>Nathanael Harbison</strong><br>Your local REALTOR®, DRE #${esc(site.dre)}</p></div>
      <h2 class="ty-h">What happens next</h2>
      <ol class="ty-steps">
        <li><strong>Nathanael reviews the address and your situation.</strong></li>
        <li><strong>He contacts you to set up a short walkthrough,</strong> in person or by video.</li>
        <li><strong>You get your options in writing, by email,</strong> with the assumptions behind any number.</li>
      </ol>
      <p class="ty-save"><a class="btn btn-gold" href="/nathanael-harbison.vcf" download data-cta="save_contact">Save Nathanael’s number</a><span>So you’ll recognize the call.</span></p>
      <p class="ty-more">While you wait, you can <a href="/guides">read the seller guides</a> or see <a href="/how-it-works">how it works</a>.</p>
    </div>
    <details class="lead-card details-card" aria-label="Optional property details" hidden><summary>Add details about a property you want to sell (optional)</summary>
      <p class="eyebrow gold">Optional · 30 seconds</p>
      <h2>Help us prepare for your call</h2>
      <form data-details-form method="post" action="/api/leads" novalidate>
        <fieldset><legend class="fstep-q">Timeline</legend>${detailRadios('timeline', detailOptions.timeline)}</fieldset>
        <fieldset><legend class="fstep-q">Who lives there now?</legend>${detailRadios('occupancy', detailOptions.occupancy)}</fieldset>
        <fieldset><legend class="fstep-q">Condition <span class="muted">(pick any)</span></legend>${detailChecks('condition', detailOptions.condition)}</fieldset>
        <fieldset><legend class="fstep-q">What matters most?</legend>${detailRadios('desired_outcome', detailOptions.outcome)}</fieldset>
        <button class="btn btn-gold btn-full" type="submit">Add to My Request</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </details>
  </div>
</section>`
  );
}

export function howItWorksPage() {
  const path = '/how-it-works';
  const title = pageTitle('How Selling Your House for Cash Works');
  const description = 'How Harbison reviews a property, how cash offers are figured, what happens at the walkthrough, and the seller promise behind every conversation.';
  const crumbs = [['Home', '/'], ['How it works', path]];
  const image = sized(images.renovate, 1200, 630);
  return page(
    { title, description, path, image, pageType: 'how_it_works', hasForm: false, ld: graph({ path, title, description, image, crumbs, extra: [{ '@type': 'HowTo', '@id': `${site.url}${path}#howto`, name: 'How to get a cash offer for your Kern County house', step: processSteps.map(([name, text], i) => ({ '@type': 'HowToStep', position: i + 1, name, text })) }] }) },
    `<section class="hero home-hero hiw-hero">
  ${heroPicture(images.street)}
  <div class="container hiw-hero-inner">
    ${crumbNav(crumbs)}
    <h1>How selling to <em>Harbison works</em></h1>
    <p class="hero-lead">What happens after you send the address, how a direct offer is figured, and how it compares with listing.</p>
    ${addrBar('hiw', 'hiw_hero')}
  </div>
</section>

<section class="section hiw-steps" id="how">
  <div class="container">
    <div class="steps-row">${steps()}</div>
  </div>
</section>

<section class="section hiw-band" id="walkthrough">
  <div class="container hiw-split">
    <div>
      <h2>The walkthrough</h2>
      <p class="section-sub">${esc(walkthrough[0])}</p>
      <p><a class="link" href="/guides/direct-sale-walkthrough">What to expect at a walkthrough</a></p>
    </div>
    <ul class="facts">${walkthrough.slice(1).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
  </div>
</section>

<section class="section" id="offers">
  <div class="container hiw-split">
    <div>
      <h2>How a direct offer is figured</h2>
      <p class="section-sub">${esc(offerExplanation)}</p>
      <p class="note-small">This is an example to show how the pieces fit together. It is not a formula applied to every property, a valuation of any home, or a promise of any offer. Every property’s numbers are different, and we show you yours.</p>
    </div>
    <div class="receipt"><div class="compare-wrap"><table class="compare offer-table"><caption class="sr-only">Illustrative direct-offer breakdown</caption><thead><tr><th scope="col">Illustrative example</th><th scope="col">Amount</th></tr></thead><tbody>${offerExample.map(([k, v], i) => `<tr${i === offerExample.length - 1 ? ' class="total"' : ''}><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div></div>
  </div>
  <div class="container"><details class="vs-details est-details"><summary>Try your own numbers</summary>${netEstimator('/#lead-form')}</details></div>
</section>

<section class="section hiw-band" id="compare">
  <div class="container">
    <h2 class="section-title">Direct sale or listing?</h2>
    ${flowChart()}
    ${compareTable({ collapsed: true })}
  </div>
</section>

<section class="section" id="promise">
  <div class="container hiw-split">
    <div>
      <h2>Our seller promise</h2>
      <p class="section-sub">These are the commitments we make before we talk numbers.</p>
    </div>
    <div>
      <div class="promise-cols">${transparencyList()}</div>
      <details class="safeguards-more">
        <summary>How we protect sellers</summary>
        <dl class="principles safeguards">${safeguards.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </details>
    </div>
  </div>
</section>

<section class="hiw-final">
  <div class="container">
    <h2>Want a cash offer on your house?</h2>
    <p>Send us the address and we’ll review it. You can also call or text <a class="link" href="tel:${site.phoneHref}">${esc(site.phone)}</a>.</p>
    ${addrBar('final', 'hiw_final')}
  </div>
</section>`
  );
}

export function contactPage() {
  const path = '/contact';
  const title = pageTitle('Contact Call Harbison: Get a Cash Offer');
  const description = `Call or text ${site.phone}, email ${site.email}, or send the property address. Serving Bakersfield, Tehachapi, and Kern County.`;
  const crumbs = [['Home', '/'], ['Contact', path]];
  const image = `${site.url}${ogDefault}`;
  const contactLd = { '@type': 'ContactPage', '@id': `${site.url}${path}#contact`, about: { '@id': `${site.url}/#business` } };
  return page(
    { title, description, path, image, pageType: 'contact', ld: graph({ path, title, description, image, crumbs, extra: [contactLd], speakableSelectors: ['h1'] }) },
    `${imageHeader(images.classic, `${crumbNav(crumbs)}
    <div class="cc-head">
        <img src="${headshot}" alt="${esc(site.agent)}, REALTOR®, Call Harbison" width="800" height="800" fetchpriority="high">
        <div>
          <h1 class="cc-name">Nathanael Harbison</h1>
          <p class="cc-role">REALTOR®, DRE #${esc(site.dre)}<br>${esc(site.brokerage)}, DRE #${esc(site.brokerageDre)}</p>
        </div>
      </div>`, 'contact-head')}
<section class="section contact-page">
  <div class="container contact-grid">
    <div class="contact-card">
      <div class="cc-actions"><a class="btn btn-gold" href="tel:${site.phoneHref}" data-cta="contact_call">Call ${esc(site.phone)}</a><a class="btn btn-ghost" href="sms:${site.phoneHref}" data-cta="contact_text">Text</a><a class="btn btn-ghost" href="mailto:${esc(site.email)}" data-cta="contact_email">Email</a></div>
      <dl class="contact-list">
        <div><dt>Email</dt><dd><a class="link" href="mailto:${esc(site.email)}">${esc(site.email)}</a></dd></div>
        <div><dt>Response</dt><dd>Typically within 24 hours</dd></div>
        <div><dt>Service area</dt><dd>Bakersfield, Tehachapi and all of Kern County</dd></div>
      </dl>
      <div class="cc-social">${socialLinks()}</div>
      <p class="cc-save"><a class="link" href="/nathanael-harbison.vcf" download data-cta="save_contact_page">Save contact card</a></p>
      <p class="note-small">If you’ve asked us to stop contacting you, you won’t hear from us again. To make that request, reply STOP to any text or email ${esc(site.email)}.</p>
    </div>
    ${leadForm({ heading: 'Send us the property', pageType: 'contact' })}
  </div>
</section>`
  );
}

export function accessibilityPage() {
  return simplePage({
    title: 'Accessibility',
    description: `${site.name} is committed to a website everyone can use. How to reach us if something doesn’t work for you.`,
    path: '/accessibility',
    pageType: 'accessibility',
    heading: 'Accessibility',
    body: `<p class="muted-note">Last updated: ${niceDate(contentDate('/accessibility'))}</p>
    <p>${esc(site.name)} wants everyone to be able to learn about their options and reach us, including people who use screen readers, keyboard navigation, magnification, or voice control.</p>
    <h2 class="prose-h">What we do</h2>
    <ul>
      <li>Aim to meet WCAG 2.1 Level AA</li>
      <li>Label every form field and announce form errors to assistive technology</li>
      <li>Keep pages usable by keyboard, with visible focus</li>
      <li>Maintain color contrast and never rely on color alone</li>
      <li>Describe meaningful images with alternative text</li>
    </ul>
    <h2 class="prose-h">Need help or found a problem?</h2>
    <p>If any part of this site is hard to use, call or text <a class="link" href="tel:${site.phoneHref}">${esc(site.phone)}</a> or email <a class="link" href="mailto:${esc(site.email)}">${esc(site.email)}</a>. We’ll help you directly and fix the issue.</p>`,
  });
}

export function notFoundPage() {
  return simplePage({
    title: 'Page Not Found',
    description: 'Page not found.',
    path: '/404',
    noindex: true,
    heading: 'Page <em>not found</em>',
    body: `<p class="lead">That page doesn’t exist. But we can still help with your property.</p><p><a class="btn btn-gold" href="/">Go to home</a> <a class="btn btn-ghost-dark" href="/situations">See situations</a></p>`,
  });
}

export function privacyPage() {
  return simplePage({
    title: 'Privacy Policy',
    description: `How ${site.name} collects, uses, and protects information submitted through this website.`,
    path: '/privacy',
    heading: 'Privacy Policy',
    body: `<p class="muted-note">Last updated: ${niceDate(contentDate('/privacy'))}</p>
    <p>${esc(site.name)} (“we,” “us”) respects your privacy. This policy explains what information we collect through this website and how we use it.</p>
    <h2 class="prose-h">Information we collect</h2>
    <p>When you submit a form, we collect the information you provide, such as your name, phone number, email address, property address, and details about your situation. We also collect standard technical data (such as browser type, pages visited, and referring site) through cookies and analytics tools.</p>
    <p>Our first-party website statistics record page views and estimated active time, separately from your form details. Raw IP addresses are not retained. Daily visitor hashes rotate, and browser Do Not Track and Global Privacy Control choices are honored for this first-party tracking.</p>
    <p><button type="button" class="btn btn-ghost" data-analytics-optout>Disable first-party analytics in this browser</button></p>
    <h2 class="prose-h">Cookies and analytics choices</h2>
    <p>When you first visit, a banner asks whether to allow analytics and marketing measurement tools such as Google Analytics and Metricool. They load only if you accept. If you decline, or your browser sends a Global Privacy Control or Do Not Track signal, they stay off. Use the Privacy choices link in the footer to change your choice at any time.</p>
    <h2 class="prose-h">How we use it</h2>
    <ul>
      <li>To respond to your inquiry and evaluate your property</li>
      <li>To contact you by phone, text message, or email about your property</li>
      <li>To improve our website and services</li>
      <li>To comply with legal obligations</li>
    </ul>
    <h2 class="prose-h">Text messages</h2>
    <p>If you provide your phone number, you agree we may contact you by call or text about your inquiry. Message and data rates may apply. Reply STOP to opt out at any time. We do not sell or share mobile numbers or SMS consent with third parties for their marketing purposes.</p>
    <h2 class="prose-h">Sharing</h2>
    <p>We do not sell your personal information. We may share it with service providers who help us operate our business (for example, hosting, email, CRM, and title/escrow companies when you choose to move forward), or when required by law.</p>
    <h2 class="prose-h">Your California privacy rights</h2>
    <p>California residents may request access to, correction of, or deletion of their personal information. To make a request, email <a class="link" href="mailto:${esc(site.email)}">${esc(site.email)}</a>.</p>
    <h2 class="prose-h">Contact</h2>
    <p>Questions? Contact us at <a class="link" href="mailto:${esc(site.email)}">${esc(site.email)}</a> or <a class="link" href="tel:${site.phoneHref}">${esc(site.phone)}</a>.</p>`,
  });
}

export function termsPage() {
  return simplePage({
    title: 'Terms of Use',
    description: `Terms of use for the ${site.name} website, including our no-offer disclaimer and California real estate license disclosure.`,
    path: '/terms',
    heading: 'Terms of Use',
    body: `<p class="muted-note">Last updated: ${niceDate(contentDate('/terms'))}</p>
    <p>By using this website you agree to these terms.</p>
    <h2 class="prose-h">No offer or advice</h2>
    <p>Content on this site is for general information only. Nothing here is an offer to purchase any property, and no binding agreement exists until a written purchase agreement is signed by all parties. We do not provide legal, tax, or financial advice. Please consult a qualified professional about your situation.</p>
    <h2 class="prose-h">License disclosure</h2>
    <p>${esc(site.agent)} is a California-licensed real estate agent (DRE #${esc(site.dre)}) with ${esc(site.brokerage)} When ${esc(site.name)} offers to purchase a property directly, that licensed status is disclosed to the seller in writing.</p>
    <h2 class="prose-h">Submissions</h2>
    <p>You agree that information you submit is accurate and that you have the right to share it. Submitting a form does not obligate you to sell, and does not obligate us to make an offer.</p>
    <h2 class="prose-h">Intellectual property</h2>
    <p>The ${esc(site.name)} name, logo, and site content are our property and may not be used without permission.</p>
    <h2 class="prose-h">Limitation of liability</h2>
    <p>This site is provided “as is.” To the fullest extent permitted by law, we are not liable for damages arising from your use of the site.</p>
    <h2 class="prose-h">Contact</h2>
    <p><a class="link" href="mailto:${esc(site.email)}">${esc(site.email)}</a> • <a class="link" href="tel:${site.phoneHref}">${esc(site.phone)}</a></p>`,
  });
}

// ---------- Family Property Transition ----------

const radios = (name, list, required = true) => `<div class="choice-grid" role="radiogroup">${list
  .map((o, i) => `<label class="choice"><input type="radio" name="${name}" value="${esc(o)}"${required && i === 0 ? ' required' : ''}><span>${esc(o)}</span></label>`)
  .join('')}</div>`;

// Four-step form. Step 1 asks for the address only, so the first commitment is small.
function familyLeadForm() {
  return `<aside class="lead-card family-card" id="lead-form" aria-label="Talk with Nathanael about a loved one's house">
      <h2>What property are you trying to figure out?</h2>
      <form data-lead-form data-form-type="family_transition" data-steps method="post" action="/api/leads" novalidate>
        <input type="hidden" name="form_type" value="family_transition">
        <ol class="step-dots" aria-hidden="true"><li class="on"></li><li></li><li></li><li></li></ol>
        <fieldset class="fstep" data-step="1">
          <legend class="sr-only">Step 1 of 4: property</legend>
          <label>Property address<input name="address" autocomplete="street-address" placeholder="123 Main St, Bakersfield, CA" required></label>
          <button class="btn btn-gold btn-full" type="button" data-next>Continue</button>
        </fieldset>
        <fieldset class="fstep" data-step="2" hidden>
          <legend class="fstep-q">What’s happening with the property?</legend>
          ${radios('situation', familyForm.situations)}
          <div class="fstep-nav"><button class="btn btn-ghost" type="button" data-back>Back</button><button class="btn btn-gold" type="button" data-next>Continue</button></div>
        </fieldset>
        <fieldset class="fstep" data-step="3" hidden>
          <legend class="fstep-q">What would help most?</legend>
          ${radios('help_needed', familyForm.helpNeeded)}
          <label>Timing<select name="timeline"><option value="">Not sure</option>${familyForm.timelines.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
          <div class="fstep-nav"><button class="btn btn-ghost" type="button" data-back>Back</button><button class="btn btn-gold" type="button" data-next>Continue</button></div>
        </fieldset>
        <fieldset class="fstep" data-step="4" hidden>
          <legend class="fstep-q">How should we reach you?</legend>
          <div class="two-col">
            <label>Your name<input name="name" autocomplete="name" required></label>
            <label>Phone<input name="phone" type="tel" autocomplete="tel" required></label>
          </div>
          <label>Email <span class="muted">(optional)</span><input name="email" type="email" autocomplete="email"></label>
          <label>Your relationship to the property<select name="relationship" required><option value="">Select one</option>${familyForm.relationships.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
          <label>Best way to reach you<select name="contact_pref">${familyForm.contactPrefs.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="consent_response" value="yes" required><span>${esc(site.name)} may contact me by phone, text, or email about this property.</span></label>
          <label class="check"><input type="checkbox" name="consent_marketing" value="yes"><span>Also send me occasional family-property guides and updates. <span class="muted">(optional)</span></span></label>
          <label class="hp" aria-hidden="true">Company<input name="company" tabindex="-1" autocomplete="off"></label>
          <div class="fstep-nav"><button class="btn btn-ghost" type="button" data-back>Back</button><button class="btn btn-gold" type="submit">Talk with Nathanael</button></div>
          <p class="form-note">Consent is not a condition of any sale. Msg &amp; data rates may apply; reply STOP to opt out. We never ask for medical information. See our <a href="/privacy">Privacy Policy</a>.</p>
        </fieldset>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </aside>`;
}

// Click-to-load YouTube (no third-party JS until the viewer asks for it). Renders nothing until a video ID
// is set in src/family.mjs. No "coming soon" placeholders on the live site.
const videoBlock = (v, { large = false } = {}) => (v.id
  ? `<figure class="video${large ? ' video-lg' : ''}"><button class="video-btn" type="button" data-yt="${esc(v.id)}" aria-label="Play video: ${esc(v.title || v.q)}" style="--thumb:url('https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg')"><span class="play" aria-hidden="true">▶</span></button><figcaption>${esc(v.title || v.q)}</figcaption></figure>`
  : '');

// FAQ anchor for a question, so the "questions families ask" list can jump to its answer.
const faqId = (q) => `q-${q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;

const videoLd = (v, url) => (v.id ? [{
  '@type': 'VideoObject',
  '@id': `${url}#video-${v.id}`,
  name: v.title || v.q,
  description: v.title || v.q,
  thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
  embedUrl: `https://www.youtube-nocookie.com/embed/${v.id}`,
  uploadDate: BUILD_DATE,
}] : []);

export function familyPage() {
  const f = family;
  const url = `${site.url}${f.path}`;
  const title = pageTitle('Selling a Loved One’s House in Kern County');
  const crumbs = [['Home', '/'], ['Selling a Loved One’s House', f.path]];
  const heroImg = f.image;
  const ogImg = sized(f.image, 1200, 630);
  const allFaqs = [...f.faqs, ...faqs.slice(0, 2)];
  const service = serviceLd({ name: f.title, description: f.description, url, areaServed: areas.map(placeLd) });
  const vids = [f.heroVideo, ...f.videos].flatMap((v) => videoLd(v, url));
  const { direct, listing } = f.paths;
  return page(
    { title, description: f.description, path: f.path, image: ogImg, pageType: 'family', ld: graph({ path: f.path, title, description: f.description, image: ogImg, crumbs, faq: allFaqs, extra: [service, ...vids] }) },
    `<section class="hero hero-sub">
  ${heroPicture(f.image)}
  <div class="container hero-grid">
    <div class="hero-copy">
      ${crumbNav(crumbs)}
      <p class="eyebrow gold">For families in ${esc(site.region)}</p>
      <h1 class="h1-sub">${f.headline}</h1>
      <p class="hero-lead">${esc(f.lead)}</p>
      <div class="hero-actions"><a class="btn btn-gold" href="tel:${site.phoneHref}" data-track="call_click">Call Nathanael at ${esc(site.phone)}</a><a class="btn btn-outline" href="#options">See my options</a></div>
    </div>
    ${familyLeadForm()}
  </div>
</section>

<section class="section white">
  <div class="container family-intro${f.heroVideo.id ? '' : ' solo'}">
    <div>
      ${answerBox(esc(f.answer))}
      <p class="fam-note">Families usually call because they’re handling two things at once: helping a loved one through a major move, and suddenly being responsible for an entire house.</p>
    </div>
    ${videoBlock(f.heroVideo, { large: true })}
  </div>
</section>

<section class="section cream">
  <div class="container">
    <div class="section-head">
      <h2>You’re probably dealing with <em>more than a house</em></h2>
    </div>
    <div class="problem-grid">${f.problems.map(([h, p]) => `<article class="problem"><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join('')}</div>
  </div>
</section>

<section class="section white" id="options">
  <div class="container">
    <div class="section-head center">
      <h2>Two paths. <em>Your family chooses.</em></h2>
      <p>Neither is automatically better. The right one depends on the house, the budget for the move, and how much time and energy the family has.</p>
    </div>
    <div class="path-grid">
      <article class="path-col"><h3>${esc(direct.name)}</h3><ul>${direct.rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p class="path-best">Best when convenience, speed, or condition matters most.</p></article>
      <article class="path-col alt"><h3>${esc(listing.name)}</h3><ul>${listing.rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p class="path-best">Best when the house shows well and there’s time to prepare it.</p></article>
    </div>
    <p class="disclosure">${esc(f.disclosure)}</p>
    <p class="btn-row"><a class="btn btn-gold big" href="#lead-form">Compare my options</a></p>
  </div>
</section>

<section class="section navy">
  <div class="container">
    <div class="section-head center"><h2 class="light">What the process <em>looks like</em></h2></div>
    <ol class="steps">${f.timeline.map(([h, p]) => `<li><div><h3>${esc(h)}</h3><p>${esc(p)}</p></div></li>`).join('')}</ol>
  </div>
</section>

<section class="section cream">
  <div class="container narrow">
    <div>
      <div class="section-head"><h2>Questions families <em>ask Nathanael</em></h2></div>
      ${f.videos.some((v) => v.id)
        ? `<div class="video-grid">${f.videos.map((v) => videoBlock(v)).join('')}</div>`
        : `<ul class="question-links">${f.videos.map((v) => `<li><a href="#${faqId(v.q)}">${esc(v.q)}</a></li>`).join('')}</ul><p class="note-small">Short answers are in the questions below. Or ask Nathanael directly.</p>`}
    </div>
  </div>
</section>

<section class="section white" id="faq">
  <div class="container narrow">
    <div class="section-head center"><h2>Common <em>questions</em></h2></div>
    ${faqList(allFaqs)}
    <p class="disclaimer">General information, not legal or tax advice. For questions about authority to sell, trusts, or conservatorships, talk with an elder-law or estate attorney.</p>
    <h3>Related</h3><ul class="chip-list">${['inherited-property', 'vacant-property', 'needs-major-repairs', 'relocation'].map((slug) => situations.find((s) => s.slug === slug)).filter(Boolean).map((s) => `<li><a href="/situations/${s.slug}">${esc(s.name)}</a></li>`).join('')}<li><a href="/guides/sell-inherited-house-california">Inherited house guide</a></li></ul>
  </div>
</section>

${finalCta()}`
  );
}

// Printable guide handed out by referral partners. Not indexed, it's a leave-behind, not a search page.
export function partnerGuidePage() {
  const g = partnerGuide;
  return page(
    { title: pageTitle('Family Property Guide'), description: g.intro, path: g.path, noindex: true, hasForm: false },
    `<section class="section cream page-top print-guide">
  <div class="container narrow prose">
    <h1 class="page-title">What to do with <em>a loved one’s house</em></h1>
    <p class="lead">${esc(g.intro)}</p>
    <h2 class="prose-h">Five questions to answer first</h2>
    <ol>${g.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
    <h2 class="prose-h">Your two main options</h2>
    <p><strong>Sell as-is:</strong> no repairs, belongings can stay, closing on your schedule. <strong>List traditionally:</strong> prepare the home and aim for full market value. Many families compare both before deciding.</p>
    <h2 class="prose-h">Talk it through with a local, licensed agent</h2>
    <p>${esc(site.agent)} · ${esc(site.name)} · DRE #${esc(site.dre)}<br>Call or text <strong>${esc(site.phone)}</strong> · ${esc(site.email)}<br>Online: <strong>${esc(site.url.replace(/^https?:\/\//, ''))}/family</strong></p>
    <p class="disclaimer">You choose whether to contact us. We never ask for medical information. On a direct purchase, Harbison is the buyer and discloses its license status in writing; you’re welcome to have anyone you trust review an offer.</p>
    <p class="no-print"><button class="btn btn-gold" type="button" onclick="print()">Print this guide</button></p>
  </div>
</section>`
  );
}
