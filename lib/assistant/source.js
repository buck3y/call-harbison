// The answer index built straight from the source pages, in this process (tests, checks): the same answers the build
// collects from ./dist, without building. The pages' wording does not depend on ASSISTANT, so this works either way.
import site from '../../site.config.mjs';
import { buildPages } from '../../src/pages.mjs';
import { loadDictionary, translatePage } from '../../src/i18n/translate.mjs';
import { assistantIndex } from './collect.js';

let cached = null;
/** [[file, html], …] for every English page and its Spanish twin under es/. */
export function sourcePages() {
  if (cached) return cached;
  const { dict } = loadDictionary();
  cached = buildPages().flatMap(([file, html]) => (file === '404.html' ? [[file, html]] : [
    [file, html],
    [`es/${file}`, translatePage(html, { dict, siteUrl: site.url, filePath: file, report: { missing: new Set() } })],
  ]));
  return cached;
}

export const indexFromSource = ({ providerName = '' } = {}) => assistantIndex(sourcePages(), { providerName });
