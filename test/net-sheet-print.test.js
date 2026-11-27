import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import site from '../site.config.mjs';
import { buildPages } from '../src/pages.mjs';
import { loadDictionary, translatePage } from '../src/i18n/translate.mjs';

// The printed net sheet is the visitor's own worksheet under the website's letterhead. It must carry the licence
// details and must say plainly that it is not an offer, an appraisal, an opinion of price or a closing statement.
const { dict } = loadDictionary();
const html = buildPages().find(([file]) => file === 'seller-net-sheet.html')[1];
const es = translatePage(html, { dict, siteUrl: site.url, filePath: 'seller-net-sheet.html', report: { missing: new Set() } });
const sheetOf = (page) => {
  const start = page.indexOf('<section class="ns-print"');
  assert.ok(start > -1, 'the print-only worksheet is on the page');
  return page.slice(start, page.indexOf('</section>', start));
};

test('the printed net sheet carries the letterhead with both DRE numbers, in English and Spanish', () => {
  for (const sheet of [sheetOf(html), sheetOf(es)]) {
    assert.ok(sheet.includes(`DRE #${site.dre}`), 'agent DRE number');
    assert.ok(sheet.includes(`${site.brokerage}, DRE #${site.brokerageDre}`), 'brokerage name and DRE number');
    assert.ok(sheet.includes(site.agent) && sheet.includes(site.phone), 'agent name and phone');
    assert.match(sheet, /<img class="nsp-logo" data-src="\/assets\/call-harbison\.svg" alt=""/, 'light-ground logo, loaded only when needed');
  }
});

test('the printed net sheet says it is the visitor’s own figures and not an offer, in English and Spanish', () => {
  const en = sheetOf(html);
  assert.ok(en.includes('Seller net sheet: your own figures'));
  assert.ok(en.includes('Nathanael Harbison did not prepare or review it, and it is not an opinion of price or a closing statement.'));
  assert.ok(en.includes('It is not an offer, an appraisal, or tax or legal advice.'));
  const sp = sheetOf(es);
  assert.ok(sp.includes('Hoja de ganancias: sus propias cifras'));
  assert.ok(sp.includes('Nathanael Harbison no la preparó ni la revisó, y no es una opinión de precio ni un estado de cierre.'));
  assert.ok(sp.includes('No es una oferta, ni un avalúo, ni asesoría legal o de impuestos.'));
});

test('the print action starts hidden and the worksheet never shows on screen', () => {
  assert.match(html, /<button class="btn btn-ghost" type="button" data-ns-print hidden>Print this sheet<\/button>/);
  const css = readFileSync(new URL('../static/styles.css', import.meta.url), 'utf8');
  const printAt = css.indexOf('@media print{');
  const screenRule = css.indexOf('.ns-print{display:none}');
  assert.ok(screenRule > -1 && screenRule < printAt, 'hidden on screen, outside the print block');
  assert.ok(css.indexOf('.ns-print{display:block', printAt) > printAt, 'shown in print');
});
