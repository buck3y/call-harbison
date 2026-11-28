// "Ask a question" in the pages. site.config.mjs reads the environment at import, so each build is rendered in its
// own process (as test/privacy-wording.test.js does), into a temporary file.
//   off (the default): no trace at all: no block, no /ask, no script, no footer link, no privacy paragraph
//   on: every text has Spanish; the copy, search and branding rules hold for the new page and block; no inline event
//   handler; the privacy paragraph in both wordings; the block only where it belongs; the build helper's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPage } from '../lib/csp.js';
import { assistantStyles, finishAssistantBuild, INDEX_DIR, INDEX_FILE } from '../lib/assistant/collect.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'hbh-ask-pages-'));
const CLEAN = { VERCEL: '', ANALYTICS_DEFAULTS: '', GA_MEASUREMENT_ID: '', METRICOOL_HASH: '', GTM_ID: '', VERCEL_INSIGHTS: '', SITE_URL: '', ASSISTANT: '', ASSISTANT_PROVIDER_NAME: '' };
function render(name, env) {
  const out = join(work, `${name}.json`);
  execFileSync(process.execPath, ['--input-type=module', '-e', [
    "import { writeFileSync } from 'node:fs';",
    "import site from './site.config.mjs';",
    "import { buildPages } from './src/pages.mjs';",
    "import { decoratePage, loadDictionary, translatePage } from './src/i18n/translate.mjs';",
    'const { dict } = loadDictionary(); const report = { missing: new Set() }; const pages = {}; const paths = {};',
    'for (const [file, html, path] of buildPages()) {',
    "  paths[file] = path; if (file === '404.html') { pages[file] = html; continue; }",
    "  pages[file] = decoratePage(html, { lang: 'en', filePath: file, siteUrl: site.url });",
    "  pages[`es/${file}`] = decoratePage(translatePage(html, { dict, siteUrl: site.url, filePath: file, report }), { lang: 'es', filePath: file, siteUrl: site.url });",
    '}',
    `writeFileSync(${JSON.stringify(out)}, JSON.stringify({ pages, paths, missing: [...report.missing] }));`,
  ].join('\n')], { cwd: repo, env: { ...process.env, ...CLEAN, ...env }, stdio: 'pipe' });
  return JSON.parse(readFileSync(out, 'utf8'));
}
const off = render('off', {});
const local = render('local', { ASSISTANT: 'on' });
const sent = render('sent', { ASSISTANT: 'on', ASSISTANT_PROVIDER_NAME: 'Cloudflare' });
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

const MARKERS = [/data-assistant/, /assistant\.js/, /href="\/(?:es\/)?ask"/, /“Ask a question”|“Haga una pregunta”/, /class="ask/];
const FAQ_PAGES = (pages) => Object.keys(pages).filter((f) => /<details class="faq"/.test(pages[f]));

test('off (the default): not a trace of the assistant in any page, and /ask is not built', () => {
  assert.ok(Object.keys(off.pages).length > 100);
  for (const [file, html] of Object.entries(off.pages)) for (const re of MARKERS) assert.doesNotMatch(html, re, file);
  assert.ok(!('ask.html' in off.pages) && !('es/ask.html' in off.pages));
  // The build helper removes the copied static/assistant.js and writes no index.
  const out = mkdtempSync(join(work, 'build-off-'));
  cpSync(join(repo, 'static/assistant.js'), join(out, 'assistant.js'));
  finishAssistantBuild({ out, pages: Object.entries(off.pages), env: {} });
  assert.deepEqual(readdirSync(out), []);
});

test('off: the stylesheet the build fingerprints is the one without the assistant\'s section; on, it is whole', () => {
  const css = readFileSync(join(repo, 'static/styles.css'), 'utf8');
  const start = css.indexOf('/* ---------- Ask a question (the assistant');
  const endMark = '/* ---------- end Ask a question';
  const end = css.indexOf('*/', css.indexOf(endMark)) + 2;
  assert.ok(start > 0 && end > start, 'both marker comments are in static/styles.css');
  const without = css.slice(0, start).replace(/\n+$/, '') + css.slice(end);
  assert.equal(assistantStyles(css, {}), without);
  assert.doesNotMatch(assistantStyles(css, {}), /\.ask\b|\.ask-/);
  assert.equal(assistantStyles(css, { ASSISTANT: 'on' }), css);
  assert.doesNotMatch(css.slice(end), /\.ask/, 'every assistant rule is inside the marked section');
});

test('on: every English text on every page has Spanish, in both wordings', () => {
  assert.deepEqual(local.missing, []);
  assert.deepEqual(sent.missing, []);
});

test('on: the block follows the FAQ on the pages that have one, and nowhere it should not be', () => {
  for (const build of [local, sent]) {
    const withBlock = Object.keys(build.pages).filter((f) => /data-assistant/.test(build.pages[f]));
    assert.deepEqual(withBlock.sort(), [...FAQ_PAGES(build.pages), 'ask.html', 'es/ask.html'].sort());
    for (const file of ['thank-you.html', 'privacy.html', 'terms.html', 'accessibility.html', 'family-property-guide.html', '404.html', 'guides/index.html']) {
      for (const f of [file, `es/${file}`]) if (build.pages[f]) assert.doesNotMatch(build.pages[f], /data-assistant/, f);
    }
    for (const [file, html] of Object.entries(build.pages)) {
      const has = /data-assistant/.test(html);
      assert.equal((html.match(/<script src="\/assistant\.js" defer><\/script>/g) || []).length, has ? 1 : 0, `script only with the block: ${file}`);
      if (file !== '404.html') assert.match(html, /<a href="\/(?:es\/)?ask">(?:Ask a question|Haga una pregunta)<\/a><\/nav>/, `footer link: ${file}`);
      if (!has) continue;
      const block = html.slice(html.indexOf('<div class="ask'), html.indexOf('</div>', html.indexOf('class="ask-tools"')));
      assert.match(block, /^<div class="ask[^"]*" data-assistant [^>]* hidden>/, 'hidden until the script starts');
      assert.doesNotMatch(block, /btn-gold/, 'one gold button per screen: the block\'s button is the outline');
      assert.match(block, /class="btn btn-outline" type="submit"/);
      assert.match(block, /\((?:automated answers|respuestas automáticas)\)/, 'the label says the answers are automated');
      assert.match(block, /<input id="ask-q" name="q" type="text" maxlength="500"/);
      assert.match(block, /class="form-hint ask-hint"/);
      assert.match(block, /role="status" aria-live="polite"/);
      if (FAQ_PAGES(build.pages).includes(file)) assert.ok(html.indexOf('data-assistant') > html.lastIndexOf('<details class="faq"'), `after the FAQ list: ${file}`);
    }
  }
});

test('on: /ask is a page like the others (photo header, canonical, valid structured data, Spanish twin, sitemap path)', () => {
  for (const build of [local, sent]) {
    assert.equal(build.paths['ask.html'], '/ask');
    for (const [file, url] of [['ask.html', 'https://www.callharbison.com/ask'], ['es/ask.html', 'https://www.callharbison.com/es/ask']]) {
      const html = build.pages[file];
      assert.match(html, /<section class="hero image-header">/);
      assert.ok(html.includes(`<link rel="canonical" href="${url}">`), file);
      assert.doesNotMatch(html, /content="noindex/);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
      assert.match(html, /<h1 class="page-title">(?:Ask a question|Haga una pregunta)<\/h1>/);
      assert.match(html, /call-harbison-reverse\.svg/);
      const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
      assert.match(footer, /02059393/);
      assert.match(footer, /02227690/);
      assert.match(html, /<noscript>/);
    }
    assert.match(build.pages['es/ask.html'], /<html lang="es-US"/);
    assert.match(build.pages['es/ask.html'], /<title>Haga una pregunta sobre la venta de su casa \| Call Harbison<\/title>/);
  }
});

// The compliance tests' own banned phrases, read from their source (as in assistant-security.test.js): every one in
// sales-accuracy.test.js, and the old brand from branding-release.test.js (its other checks are about one page each).
const patternsIn = (f) => [...readFileSync(new URL(f, import.meta.url), 'utf8')
  .matchAll(/assert\.doesNotMatch\([^,]+,\s*\/((?:\\.|[^/\\\n])+)\/([a-z]*)/g)].map((m) => new RegExp(m[1], m[2]));
const banned = [...patternsIn('sales-accuracy.test.js'), ...patternsIn('branding-release.test.js').filter((re) => re.test('Harbison Buys Homes'))];

test('on: the copy, branding and content-security rules hold on every page, the new page and block included', () => {
  assert.ok(banned.length >= 4);
  for (const build of [local, sent]) {
    for (const [file, html] of Object.entries(build.pages)) {
      for (const re of banned) assert.doesNotMatch(html, re, `${file}: ${re}`);
      assert.deepEqual(auditPage(html).problems, [], `${file}: inline handler or javascript: URL`);
      assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+\s*=/i, `${file}: inline event handler`);
    }
    // The assistant's own copy: no arrows, no exclamation marks, one person's voice.
    for (const file of ['ask.html', 'es/ask.html', 'situations/inherited-property.html', 'es/index.html']) {
      const html = build.pages[file];
      const own = html.slice(html.indexOf('<div class="ask'), html.indexOf('</div>', html.indexOf('class="ask-tools"')));
      const page = file.endsWith('ask.html') ? html.slice(html.indexOf('<main'), html.indexOf('</main>')) : '';
      for (const part of [own, page]) assert.doesNotMatch(part, /→|!|the team|our licensed agent|el equipo/, file);
    }
  }
});

test('on: the privacy page says what happens to a question, in the wording the build calls for', () => {
  const main = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const lp = main(local.pages['privacy.html']);
  assert.match(lp, /<h2 class="prose-h">Questions typed into “Ask a question”<\/h2>/);
  assert.match(lp, /this website’s own server matches it to an answer already published here/);
  assert.match(lp, /Your question is not sent to any other company, and the server does not store or log it\./);
  assert.doesNotMatch(lp, /language model/);
  const sp = main(sent.pages['privacy.html']);
  assert.match(sp, /may send your question, with up to six of your earlier questions from this visit, to this company, which runs a language model:<\/p>\s*<ul><li>Cloudflare<\/li><\/ul>/);
  assert.match(sp, /removes anything that looks like a phone number, email address, street address or long number, and anything after “my name is”/);
  assert.match(sp, /This website does not store or log your questions/);
  assert.doesNotMatch(sp, /not sent to any other company/);
  for (const p of [lp, sp]) assert.match(p, /counts them per internet address in its memory for up to a day/);
  assert.match(main(sent.pages['es/privacy.html']), /<ul><li>Cloudflare<\/li><\/ul>/);
  assert.match(main(local.pages['es/privacy.html']), /Su pregunta no se envía a ninguna otra empresa/);
  assert.doesNotMatch(main(off.pages['privacy.html']), /Ask a question/);
});

test('the build helper, on: the index goes in a dot-folder the server never serves, and the script is fingerprinted', () => {
  const out = mkdtempSync(join(work, 'build-on-'));
  cpSync(join(repo, 'static/assistant.js'), join(out, 'assistant.js'));
  const name = finishAssistantBuild({ out, pages: Object.entries(sent.pages), env: { ASSISTANT: 'on', ASSISTANT_PROVIDER_NAME: 'Cloudflare' } });
  assert.match(name, /^assistant\.[0-9a-f]{10}\.js$/);
  assert.ok(existsSync(join(out, name)) && !existsSync(join(out, 'assistant.js')));
  const index = JSON.parse(readFileSync(join(out, INDEX_DIR, INDEX_FILE), 'utf8'));
  assert.equal(index.provider, 'Cloudflare');
  const kinds = index.answers.reduce((m, a) => ({ ...m, [`${a.lang} ${a.kind}`]: (m[`${a.lang} ${a.kind}`] || 0) + 1 }), {});
  assert.equal(kinds['en faq'], kinds['es faq']);
  assert.equal(kinds['en page'], kinds['es page']);
  assert.ok(kinds['en faq'] > 50 && kinds['en page'] > 30, JSON.stringify(kinds));
  assert.ok(index.answers.every((a) => /^\/(?!\/)/.test(a.url)));
  const collected = index.answers.filter((a) => a.kind !== 'fixed');
  assert.ok(collected.every((a) => !/\/(?:thank-you|privacy|terms|accessibility|family-property-guide|ask)\b/.test(a.url)), 'nothing from the pages that are not answers');
  assert.equal(new Set(index.answers.filter((a) => a.lang === 'en').map((a) => a.id)).size, index.answers.filter((a) => a.lang === 'en').length, 'each answer once');
});
