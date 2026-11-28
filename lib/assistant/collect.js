// Build time: collect the approved answers from the finished pages, in English and Spanish, and write them where the
// server can read them and the public cannot fetch them (dist/.assistant/answers.json: server.mjs answers 404 for any
// path part that starts with a dot). Everything in the file is public website text; nothing in it is secret.
//
// An answer is one of:
//   - a FAQ entry: <details class="faq" id="…"><summary><h3>question</h3></summary><p>answer</p></details>
//   - a page's short answer: <div class="answer-box">…<p>answer</p></div>, with the page's <h1> as its question
//   - a fixed reply from src/content-assistant.mjs, for what the pages do not say (a greeting, the hand-off…)
// The same FAQ entry appears on many pages; it is kept once, on the first page that has it. Its Spanish twin is the
// entry in the same place on the /es page, and shares its id, so a conversation can change language.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assistantSettings } from '../../site.config.mjs';
import { fixedReplies } from '../../src/content-assistant.mjs';
import { esPath, pathOfFile } from '../../src/i18n/translate.mjs';

export const INDEX_DIR = '.assistant';
export const INDEX_FILE = 'answers.json';

// Pages whose text is not an answer: the private panel, the confirmation page, legal pages, the printed handout,
// the not-found page and the assistant's own page.
const SKIP = /^(?:hq\/|thank-you\.html$|privacy\.html$|terms\.html$|accessibility\.html$|family-property-guide\.html$|404\.html$|ask\.html$)/;
// Nathanael's signed note speaks as "I"; an answer in the first person is his voice, not the website's, and stays out.
const FIRST_PERSON = /(?:^|[^\p{L}])(?:I|I['’]m|I['’]ll|I['’]ve|I['’]d|me|my|mine|myself)(?=$|[^\p{L}])/u;

const ENTITY = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'" };
export const plainText = (html) => String(html)
  .replace(/<[^>]+>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, name) => {
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (/^#\d/.test(name)) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITY[name.toLowerCase()] ?? whole;
  })
  .replace(/\s+/g, ' ')
  .trim();

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10);
const FAQ = /<details class="faq" id="([^"]*)"><summary><h3>([\s\S]*?)<\/h3><\/summary><p>([\s\S]*?)<\/p><\/details>/g;
const BOX = /<div class="answer-box"><p class="answer-label">[^<]*<\/p><p>([\s\S]*?)<\/p><\/div>/;
const H1 = /<h1[^>]*>([\s\S]*?)<\/h1>/;

function readPage(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') === -1 ? undefined : html.indexOf('</main>'));
  const faqs = [...main.matchAll(FAQ)].map((m) => ({ anchor: m[1], question: plainText(m[2]), text: plainText(m[3]) }));
  const box = main.match(BOX);
  const h1 = main.match(H1);
  return { faqs, box: box && h1 ? { question: plainText(h1[1]), text: plainText(box[1]) } : null };
}

/**
 * pages: [[file, html], …] or [{ file, html }, …] with every English page and its Spanish twin under es/ (as build.mjs
 * writes them). Returns the answers: [{ id, lang, kind, question, text, url }].
 */
export function collectAnswers(pages) {
  const byFile = new Map(pages.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.file, p.html])));
  const answers = [];
  const seen = new Set();
  for (const [file, html] of byFile) {
    if (file.startsWith('es/') || SKIP.test(file)) continue;
    const spanishHtml = byFile.get(`es/${file}`);
    const en = readPage(html);
    const es = spanishHtml ? readPage(spanishHtml) : { faqs: [], box: null };
    const path = pathOfFile(file);
    const add = (id, kind, english, spanish, url) => {
      if (seen.has(id) || FIRST_PERSON.test(english.text)) return;
      if (!english.question || !english.text) return;
      seen.add(id);
      answers.push({ id, lang: 'en', kind, question: english.question, text: english.text, url });
      if (spanish && spanish.question && spanish.text) answers.push({ id, lang: 'es', kind, question: spanish.question, text: spanish.text, url: esPath(url) });
    };
    if (en.box) add(`p-${hash(`${path}\n${en.box.text}`)}`, 'page', en.box, es.box, path);
    en.faqs.forEach((faq, i) => {
      const twin = es.faqs[i] && es.faqs[i].anchor === faq.anchor ? es.faqs[i] : null;
      add(`f-${hash(`${faq.question}\n${faq.text}`)}`, 'faq', faq, twin, `${path === '/' ? '/' : path}#${faq.anchor}`);
    });
  }
  return answers;
}

/** The fixed replies of src/content-assistant.mjs, in both languages, in the same shape (plus topic and handoff). */
export function fixedAnswers() {
  return fixedReplies.flatMap((r) => ['en', 'es'].map((lang) => ({
    id: r.id,
    lang,
    kind: 'fixed',
    question: '',
    text: r[lang],
    url: lang === 'es' ? esPath(r.url) : r.url,
    handoff: r.handoff,
    ...(r.search ? { topic: r.topic[lang] } : {}),
  })));
}

/** The whole index the server reads: the provider the privacy page names, then every answer. */
export function assistantIndex(pages, { providerName = '' } = {}) {
  return { version: 1, provider: providerName, answers: [...collectAnswers(pages), ...fixedAnswers()] };
}

/**
 * For build.mjs, on the stylesheet before it is minified and fingerprinted: with ASSISTANT off, the assistant's
 * section of static/styles.css (between its two marker comments) is dropped, so the built stylesheet, its fingerprint
 * and every page that links it are exactly what they were without this feature.
 */
export function assistantStyles(css, env = process.env) {
  if (assistantSettings(env).on) return css;
  return css.replace(/\n*\/\* -{10} Ask a question \(the assistant[\s\S]*?\/\* -{10} end Ask a question[^*]*\*\//, '');
}

/**
 * For build.mjs, after the static files are copied and the pages are rendered (pages: its [file, html, …] list).
 * ASSISTANT off: removes the copied static/assistant.js, so the build holds nothing of the assistant.
 * ASSISTANT on: writes <out>/.assistant/answers.json and renames assistant.js to assistant.<hash>.js.
 * Returns the script's file name, for the src="/assistant.js" replacement in the pages.
 */
export function finishAssistantBuild({ out, pages, env = process.env }) {
  const settings = assistantSettings(env);
  const script = join(out, 'assistant.js');
  if (!settings.on) {
    rmSync(script, { force: true });
    return 'assistant.js';
  }
  mkdirSync(join(out, INDEX_DIR), { recursive: true });
  const index = assistantIndex(pages, { providerName: settings.providerName });
  writeFileSync(join(out, INDEX_DIR, INDEX_FILE), `${JSON.stringify(index)}\n`);
  if (!existsSync(script)) return 'assistant.js';
  const name = `assistant.${hash(readFileSync(script))}.js`;
  renameSync(script, join(out, name));
  return name;
}
