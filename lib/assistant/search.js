// Keyword ranking over the website's own answers (BM25), per language. No network, no dependencies.
// A query word that is not in the answers is matched to a word one or two letters away (a typo), and each query word
// brings in its synonyms (lib/assistant/text.js) at a lower weight. The question or heading of an answer counts twice.
import { distance, related, terms } from './text.js';

const K1 = 1.2;
const B = 0.75;
const WEIGHT = { word: 1, typo: 0.8, synonym: 0.35, context: 0.3 };
const TELLING = 4;

/** Terms of an answer: its question (or topic) twice, the words of its page address once, and its text. */
function answerTerms(entry) {
  const lang = entry.lang;
  const title = [...terms(entry.question || '', lang), ...terms(entry.topic || '', lang)];
  const slug = terms(String(entry.url || '').replace(/^\/es(?=\/|$)/, '').replace(/[#?].*$/, '').replace(/[/-]+/g, ' '), lang);
  return [...title, ...title, ...slug, ...terms(entry.text || '', lang)];
}

/** answers: [{ id, lang, question, text, url, topic? }] -> an index per language. */
export function buildSearchIndex(answers) {
  const byLang = new Map();
  for (const entry of answers) {
    if (!byLang.has(entry.lang)) byLang.set(entry.lang, { docs: [], df: new Map(), total: 0 });
    const index = byLang.get(entry.lang);
    const tf = new Map();
    const list = answerTerms(entry);
    for (const t of list) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) index.df.set(t, (index.df.get(t) || 0) + 1);
    index.docs.push({ entry, tf, len: list.length });
    index.total += list.length;
  }
  for (const index of byLang.values()) {
    index.n = index.docs.length;
    index.avg = index.total / Math.max(1, index.n);
    index.vocab = [...index.df.keys()];
  }
  return byLang;
}

const idf = (index, t) => {
  const df = index.df.get(t) || 0;
  return Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
};

/** The weighted query terms: the question's own words, their typo matches and synonyms, and a little context. */
function queryWeights(index, text, lang, context) {
  const weights = new Map();
  const add = (t, w) => { if (w > (weights.get(t) || 0)) weights.set(t, w); };
  const own = terms(text, lang);
  const counts = new Map();
  for (const t of own) counts.set(t, (counts.get(t) || 0) + 1);
  for (const [t, count] of counts) {
    const boost = 1 + 0.25 * Math.min(2, count - 1);
    if (index.df.has(t)) add(t, WEIGHT.word * boost);
    else if (t.length >= 5 && !/^\d+$/.test(t) && ![...related(t, lang)].some((s) => index.df.has(s))) {
      // A typo: an unknown word one letter (two, for long words) from a known one. Not for short stems, where one
      // letter often makes another word, and not for a word whose synonyms the answers already use.
      const max = t.length >= 8 ? 2 : 1;
      let best = null;
      for (const v of index.vocab) {
        const d = distance(t, v, max);
        if (d <= max && (!best || d < best.d || (d === best.d && index.df.get(v) > index.df.get(best.v)))) best = { v, d };
      }
      if (best) add(best.v, WEIGHT.typo * boost);
    }
  }
  const asked = new Map(weights); // the question's own words (and their typo matches), before synonyms and context
  for (const t of [...weights.keys(), ...counts.keys()]) for (const s of related(t, lang)) if (index.df.has(s)) add(s, WEIGHT.synonym);
  if (context) for (const t of new Set(terms(context, lang))) if (index.df.has(t)) add(t, WEIGHT.context);
  return { weights, asked };
}

/**
 * The best answers of one language for a question, best first: [{ entry, score }].
 * `strength` on the result is the top score as a share of what an answer containing the question's four most telling
 * words would score (0..1, capped): a long story is not marked down for its extra words.
 */
export function search(byLang, lang, text, { context = '', limit = 12 } = {}) {
  const index = byLang.get(lang);
  if (!index || !index.n) return Object.assign([], { strength: 0 });
  const { weights, asked } = queryWeights(index, text, lang, context);
  const ceiling = [...asked].map(([t, w]) => w * idf(index, t) * (K1 + 1)).sort((a, b) => b - a).slice(0, TELLING).reduce((a, b) => a + b, 0);
  const scored = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const [t, w] of weights) {
      const f = doc.tf.get(t);
      if (!f) continue;
      score += w * idf(index, t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.len) / index.avg)));
    }
    if (score > 0) scored.push({ entry: doc.entry, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.entry.id < b.entry.id ? -1 : 1));
  const top = scored.slice(0, limit);
  return Object.assign(top, { strength: top.length && ceiling ? Math.min(1, top[0].score / ceiling) : 0 });
}
