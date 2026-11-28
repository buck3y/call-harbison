// The list of pages the site is built from. Shared by the build and by the translation tooling.
import site from '../site.config.mjs';
import { areas, guides, situations, askPage } from './templates.mjs';
import {
  homePage, howItWorksPage, contactPage, accessibilityPage, situationPage, areaPage, situationsIndexPage, aboutPage, guidesIndexPage, guidePage,
  thankYouPage, notFoundPage, privacyPage, termsPage, familyPage, partnerGuidePage,
  secondOpinionPage, whenNotToSellPage, deadlinesPage, sellerToolsPage, netSheetPage, whichPathPage, paperworkPage, handoffToolPage,
} from './templates.mjs';
import { family } from './family.mjs';
import { inquiryPages } from './content-search.mjs';
import { inquiryPage } from './templates.mjs';
import { handoffTools } from './content-handoff.mjs';

/** @returns {Array<[file: string, html: string, path: string|null, lastmod?: string]>} */
export function buildPages() {
  return [
    ['index.html', homePage(), '/'],
    ['about.html', aboutPage(), '/about'],
    ['how-it-works.html', howItWorksPage(), '/how-it-works'],
    ['contact.html', contactPage(), '/contact'],
    // "Ask a question" exists only in a build with ASSISTANT=on (docs/ASSISTANT.md).
    ...(site.assistant?.on ? [['ask.html', askPage(), '/ask']] : []),
    ...inquiryPages.map(item => [`${item.slug}.html`, inquiryPage(item), `/${item.slug}`, '2026-11-06']),
    [`${family.path.slice(1)}.html`, familyPage(), family.path],
    ['family-property-guide.html', partnerGuidePage(), null],
    ['situations/index.html', situationsIndexPage(), '/situations'],
    ...situations.map((s) => [`situations/${s.slug}.html`, situationPage(s), `/situations/${s.slug}`, s.updated]),
    ...areas.map((a) => [`areas/${a.slug}.html`, areaPage(a), `/areas/${a.slug}`, a.updated]),
    ['guides/index.html', guidesIndexPage(), '/guides'],
    ...guides.map((g) => [`guides/${g.slug}.html`, guidePage(g), `/guides/${g.slug}`, g.updated]),
    ['seller-tools.html', sellerToolsPage(), '/seller-tools'],
    ...handoffTools.map((tool) => [`${tool.slug}.html`, handoffToolPage(tool), `/${tool.slug}`]),
    ['seller-net-sheet.html', netSheetPage(), '/seller-net-sheet'],
    ['which-path-fits.html', whichPathPage(), '/which-path-fits'],
    ['paperwork-checklist.html', paperworkPage(), '/paperwork-checklist'],
    ['second-opinion.html', secondOpinionPage(), '/second-opinion'],
    ['when-not-to-sell.html', whenNotToSellPage(), '/when-not-to-sell'],
    ['inherited-house-deadlines.html', deadlinesPage(), '/inherited-house-deadlines'],
    ['privacy.html', privacyPage(), '/privacy'],
    ['terms.html', termsPage(), '/terms'],
    ['accessibility.html', accessibilityPage(), '/accessibility'],
    ['thank-you.html', thankYouPage(), null],
    ['404.html', notFoundPage(), null],
  ];
}
