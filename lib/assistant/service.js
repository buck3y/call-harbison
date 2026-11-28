// What the assistant replies, given a question: search this website's answers, let the model choose among the best
// ones if a model is configured and allowed, otherwise (or when it fails) use the search alone. The reply only ever
// holds answers from the index the build wrote; the visitor's own text is never sent back.
import { askModel, modelSettings } from './model.js';
import { buildSearchIndex, search } from './search.js';
import { fold } from './text.js';

export const CANDIDATES = 12;
export const HISTORY_TURNS = 6;
export const MAX_QUESTION = 1000;
export const ID = /^[a-z]-[a-z0-9-]{1,40}$/;

// The local path answers only when the best match is clearly ahead. It must reach a quarter of what an answer holding
// the question's four most telling words would score (search.js "strength"), and then either lead the runner-up by
// 15%, or be a strong match (a score of 6 or more) that still leads by 5%: two strong answers close together are
// usually the same answer on two pages, while a weak, flat field means the site does not answer the question.
// Otherwise the question goes to Nathanael. Tuned on the tuning two-thirds of the sample questions in
// test/assistant-search.test.js, never on the held-out third. The score of 6 is in BM25 points for this site's
// answers; it would need checking if the site grew to several times its size.
export const CONFIDENT = { strength: 0.25, lead: 1.15, strong: 6, strongLead: 1.05 };

/** The index the build wrote, made ready to answer from. raw: { version, provider, answers }. */
export function prepareIndex(raw) {
  const answers = Array.isArray(raw?.answers) ? raw.answers.filter((a) => a && ID.test(a.id) && (a.lang === 'en' || a.lang === 'es') && typeof a.text === 'string' && typeof a.url === 'string' && /^\/(?!\/)/.test(a.url)) : [];
  const byLang = new Map([['en', new Map()], ['es', new Map()]]);
  for (const a of answers) byLang.get(a.lang).set(a.id, a);
  return {
    provider: typeof raw?.provider === 'string' ? raw.provider : '',
    byLang,
    search: buildSearchIndex(answers.filter((a) => a.kind !== 'fixed' || a.topic)),
    fixed: (lang, id) => byLang.get(lang).get(id) || byLang.get('en').get(id),
  };
}

/** The visitor's earlier turns: their question (text, cut) and the ids that were shown, kept only if they exist. */
export function readHistory(history, lang, index) {
  if (!Array.isArray(history)) return [];
  const known = index.byLang.get(lang);
  return history.slice(-HISTORY_TURNS).flatMap((turn) => {
    if (!turn || typeof turn !== 'object' || typeof turn.q !== 'string') return [];
    const question = turn.q.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
    if (!question) return [];
    const ids = Array.isArray(turn.ids) ? turn.ids.filter((id) => typeof id === 'string' && ID.test(id)).slice(0, 2) : [];
    return [{ question, shown: ids.map((id) => known.get(id)).filter(Boolean) }];
  });
}

const GREETING = new Set('hi hello hey hiya howdy yo good morning afternoon evening day there thanks thank you thx ty bye goodbye see ya later ok okay cool great nice hola buenas buenos dias tardes noches gracias muchas saludos adios chao hasta luego vale bien perfecto'.split(' '));
/** "hi", "thanks", "buenas tardes": a message made only of greeting words. */
export function isGreeting(text) {
  const words = fold(text).split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.length <= 6 && words.every((w) => GREETING.has(w));
}

// Without a model: a question about what the visitor's own property is worth or would be offered goes to Nathanael,
// however well a general answer matches ("what is my house worth", "cuánto me dan por mi casa").
const PRICE = '(?:worth|value|price|appraise|pay me|pay for|give me|offer me|offer for|get for|sell (?:it )?for|vale|valor|precio|pagan|pagarian|pagaria|dan|darian|daria|ofrecen|ofrecerian)';
const MINE = '(?:my|our|mi|nuestra|nuestro)\\s+(?:[a-z]+\\s+){0,2}(?:house|home|property|place|land|lot|condo|duplex|cabin|casa|propiedad|terreno|lote|traila)';
const PERSONAL = [new RegExp(`\\b${MINE}\\b[^.?!]*\\b${PRICE}\\b`), new RegExp(`\\b${PRICE}\\b[^.?!]*\\b${MINE}\\b`), new RegExp(`\\bcuanto\\b[^.?!]*\\b${MINE}\\b`)];
export const looksPersonal = (text) => PERSONAL.some((re) => re.test(fold(text)));

/** The search alone: the top answer when it is clearly ahead, otherwise null (the hand-off). */
export function localChoice(results) {
  if (!results.length || results.strength < CONFIDENT.strength) return null;
  const lead = results.length > 1 ? results[0].score / results[1].score : Infinity;
  if (lead >= CONFIDENT.lead || (results[0].score >= CONFIDENT.strong && lead >= CONFIDENT.strongLead)) return results[0].entry;
  return null;
}

const shown = (entry) => ({ id: entry.id, question: entry.kind === 'fixed' ? '' : String(entry.question || ''), text: entry.text, url: entry.url });

/**
 * The assistant for one server: the model settings, its state (daily count, pause after a refusal) and answer().
 * The model is used only when it is configured AND the pages name its provider (index.provider): a question may leave
 * the server only when the privacy page says where it goes.
 */
export function createAssistant({ env = process.env, fetch = globalThis.fetch, now = Date.now } = {}) {
  const settings = modelSettings(env);
  const state = { jsonMode: true, pausedUntil: 0, day: '', calls: 0 };
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

  /** Why the model is not used for this index, or '' when it is. */
  function modelBlocked(index) {
    if (settings.off) return settings.off;
    if (!index.provider) return 'the pages were built without ASSISTANT_PROVIDER_NAME, so the privacy page says questions are not sent anywhere';
    if (settings.providerName !== index.provider) return `ASSISTANT_PROVIDER_NAME is not "${index.provider}", the name the privacy page was built with`;
    return '';
  }

  function canCall() {
    const t = now();
    if (state.day !== dayOf(t)) { state.day = dayOf(t); state.calls = 0; }
    return t >= state.pausedUntil && state.calls < settings.dailyMax;
  }

  /**
   * body: { message, history, lang } (already checked to be an object). Returns
   * { reply: { ok, answers, handoff }, outcome, path } where outcome is answered | handoff | greeting | off_topic.
   */
  async function answer(body, index) {
    const lang = body.lang === 'es' ? 'es' : 'en';
    const message = String(body.message).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_QUESTION);
    const earlier = readHistory(body.history, lang, index);
    const results = search(index.search, lang, message, { context: earlier.length ? earlier[earlier.length - 1].question : '', limit: CANDIDATES });
    const fixed = (id) => index.fixed(lang, id);
    const reply = (entries, outcome, path) => ({
      reply: { ok: true, answers: entries.map(shown), handoff: outcome === 'handoff' || entries.some((e) => e.handoff === true) },
      outcome,
      path,
    });

    if (!modelBlocked(index) && canCall()) {
      const candidates = results.map((r) => r.entry);
      const result = await askModel({ settings, state, question: message, earlier, candidates, fetch, now, onCall: () => { state.calls += 1; } });
      if (result.ok) {
        if (result.kind === 'answered') return reply(result.pick.map((n) => candidates[n - 1]), 'answered', 'model');
        if (result.kind === 'greeting') return reply([fixed('x-greeting')], 'greeting', 'model');
        if (result.kind === 'off_topic') return reply([fixed('x-off-topic')], 'off_topic', 'model');
        return reply([fixed('x-handoff')], 'handoff', 'model');
      }
      if (result.retryAfterMs) state.pausedUntil = now() + result.retryAfterMs;
    }

    if (isGreeting(message)) return reply([fixed('x-greeting')], 'greeting', 'local');
    if (looksPersonal(message)) return reply([fixed('x-handoff')], 'handoff', 'local');
    const best = localChoice(results);
    return best ? reply([best], 'answered', 'local') : reply([fixed('x-handoff')], 'handoff', 'local');
  }

  return { settings, state, modelBlocked, answer };
}
