// Words for the assistant's keyword search: accent folding, stop words, a light stemmer and a short synonym table,
// in English and Spanish. No dependencies. lib/assistant/search.js ranks answers with these terms.

/** Lower case, accents and other marks removed (á -> a, ñ -> n), curly apostrophes made straight. */
export const fold = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‘’ʼ`´]/g, "'");

// Phrases that mean one thing, rewritten (on folded text) before the text is cut into words.
const PHRASES = [
  [/\breal estate\b|\bbienes raices\b/g, ' realestate '],
  [/\bpass(?:ed|es)? away\b|\bpaso a mejor vida\b/g, ' died '],
  [/\bhow much\b/g, ' price '],
  [/\bhow long\b/g, ' timeline '],
  [/\bhow fast\b|\bhow quick(?:ly)?\b|\bhow soon\b|\bque tan rapido\b|\bque tan pronto\b/g, ' fast '],
  [/\bcome up with\b|\bfigure out\b|\bwork out\b/g, ' determine '],
  [/\bas[- ]is\b|\btal como esta\b/g, ' asis '],
  [/\breal estate agents?\b|\brealtors?\b/g, ' agent '],
  [/\bbehind on\b|\bfell behind\b|\bfalling behind\b|\bcan'?t pay\b|\bcannot pay\b/g, ' behind '],
  [/\bclean(?:ing)? (?:it )?out\b|\bcleanout\b/g, ' clean '],
  [/\bfix(?:ing)? (?:it )?up\b|\bfixer(?:[- ]upper)?\b/g, ' repair '],
  [/\bback taxes\b|\bproperty taxes\b|\btax(?:es)? owed\b|\bimpuestos atrasados\b|\bimpuestos prediales\b/g, ' backtax '],
  [/\bcode (?:violations?|enforcement|notice)\b/g, ' codeviolation '],
  [/\bno permits?\b|\bwithout (?:a )?permits?\b|\bunpermitted\b|\bnot permitted\b|\bsin permisos?\b/g, ' unpermitted '],
  [/\bsenior living\b|\bassisted living\b|\bnursing home\b|\bmemory care\b|\bcare home\b|\bcasa de retiro\b|\basilo\b|\bresidencia de ancianos\b/g, ' seniorliving '],
  [/\bcuanto (?:me )?(?:pagan|pagarian|pagaria|dan|darian|daria|ofrecen|vale)\b/g, ' price '],
  [/\bcuanto tiempo\b/g, ' timeline '],
  [/\bbreak(?:ing|s)?[- ]ins?\b|\bbroke(?:n)? in(?:to)?\b|\bbreaking into\b/g, ' breakin '],
];

const STOP = new Set(`
a an the and or but if of to in on at for with by from as is are was were be been being am do does did doing done
have has had having i me my mine myself we us our ours you your yours he him his she her hers it its they them their
this that these those there here what which who whom whose when where why how can could would should will shall may
might must so than too very just about into over under up down out off again then once all any both each few more most
other some such no nor not only own same s t don dont doesnt didnt cant wont isnt im ive id ill youre were theyre get
gets got getting want wants wanted wanna need needs know like also really please thanks thank hi hello hey yes yeah ok
okay guys sir maam still even much many one two lot lots thing things something anything someone anyone way go going
gonna make made say said ask asking question questions help let lets see look looking thinking think
street st ave avenue road rd drive dr lane ln blvd
el la los las lo un una unos unas de del al y o u e en con por para que se su sus mi mis me te tu tus le les es son
era fue ser estar esta estan este esto estos estas ese esa eso esos esas hay como cuando donde cual cuales quien quienes
porque pero si sino muy mas ya tambien yo usted ustedes nosotros ella ellos ellas tengo tiene tienen tenemos puedo puede
pueden podria podemos quiero quisiera queremos necesito hola gracias favor sobre hasta desde entre sin nos algo todo toda
todos todas cada otro otra otros mismo misma bien hacer hago saber pregunta preguntas ayuda ayudar buenas buenos dias
tardes noches senor senora calle avenida estamos estoy estaba estaban somos soy fui
`.trim().split(/\s+/));

/** English stems: plural, -ing, -ed and a final e go (houses -> hous, closing -> clos, inherited -> inherit). */
function stemEn(word) {
  let w = word;
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (/(?:ch|sh|x|z|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s')) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 4 && /([b-df-hj-np-tv-z])\1$/.test(w) && !w.endsWith('ll') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/**
 * Spanish stems: plurals, the common verb endings (infinitive, -an/-en, -amos, gerund, participle), -ación and the
 * final vowel go, so heredé, heredar, heredada and herederos meet at hered-, pago and pagar at pag-.
 */
function stemEs(word) {
  let w = word;
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  if (w.endsWith('ces') && w.length > 5) w = `${w.slice(0, -3)}z`;
  else if (/[^aeiou]es$/.test(w) && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith('s')) w = w.slice(0, -1);
  if (w.length >= 7 && /(?:acion)$/.test(w)) return w.slice(0, -5);
  if (w.length >= 7 && /(?:ando|iendo)$/.test(w)) return w.replace(/(?:ando|iendo)$/, '');
  if (w.length >= 6 && /(?:amo|emo|imo)$/.test(w)) return w.slice(0, -3);
  if (w.length >= 6 && /(?:ad|id)[oa]$/.test(w)) return w.slice(0, -3);
  if (w.length >= 5 && /(?:ar|er|ir)$/.test(w)) return w.slice(0, -2);
  if (w.length >= 6 && /(?:an|en)$/.test(w)) return w.slice(0, -2);
  if (w.length >= 4 && /[aoei]$/.test(w)) w = w.slice(0, -1);
  return w;
}

// Words that mean the same thing for this website, written out in each language and stemmed with that language's
// stemmer, so an English word never meets a Spanish one by accident. A query word brings in the others at a lower
// weight (search.js). Kept to near-synonyms: a topic that is merely related belongs to the answers, not here.
const IRREGULAR = { sold: 'sell', bought: 'buy', paid: 'pay', owed: 'owe', died: 'die', dead: 'die', death: 'die', mom: 'mother', mum: 'mother', dad: 'father', kids: 'child', children: 'child', renters: 'tenant', renter: 'tenant' };
const GROUPS = [
  { en: 'inherit inherited inheritance heir heirs die deceased', es: 'heredar herede heredada heredado herencia heredero fallecio murio difunto' },
  { en: 'probate executor administrator', es: 'probate sucesion albacea testamentaria' },
  { en: 'repair repairs fix fixing', es: 'reparar reparacion arreglar arreglo' },
  { en: 'damage damaged broken', es: 'dano danada danado roto' },
  { en: 'tenant tenants', es: 'inquilino inquilinos arrendatario' },
  { en: 'evict eviction', es: 'desalojo desalojar' },
  { en: 'foreclosure foreclose', es: 'ejecucion embargo' },
  { en: 'behind late', es: 'atrasado atraso' },
  { en: 'mortgage loan', es: 'hipoteca prestamo' },
  { en: 'fee fees commission commissions charge', es: 'comision comisiones cobrar cobran cargo' },
  { en: 'fast quick quickly soon', es: 'rapido pronto' },
  { en: 'price worth value', es: 'precio valor vale' },
  { en: 'determine calculate figure', es: 'calcular calculan determinar determinan' },
  { en: 'vacant empty unoccupied abandoned', es: 'vacia vacio desocupada abandonada' },
  { en: 'breakin squatter squatters vandalism trespassers', es: 'okupas invasores vandalismo intrusos' },
  { en: 'land acreage parcel', es: 'terreno terrenos parcela' },
  { en: 'divorce separation', es: 'divorcio divorciando separacion' },
  { en: 'relocate relocating relocation transfer', es: 'reubicar mudanza mudarme trasladar' },
  { en: 'fire burned', es: 'incendio fuego quemo quemada quemado' },
  { en: 'flood water', es: 'inundacion agua' },
  { en: 'hoarder hoarding', es: 'acumulador acumulacion' },
  { en: 'belongings stuff junk furniture contents', es: 'pertenencias cosas muebles basura' },
  { en: 'clean empty', es: 'limpiar vaciar' },
  { en: 'lien liens', es: 'gravamen' },
  { en: 'tax taxes backtax', es: 'impuesto impuestos backtax' },
  { en: 'permit permits unpermitted', es: 'permiso permisos unpermitted' },
  { en: 'violation codeviolation citation', es: 'violacion multa codeviolation' },
  { en: 'licensed license agent broker', es: 'licencia agente corredor' },
  { en: 'contact reach', es: 'contacto comunicarme comunicar' },
  { en: 'phone number call', es: 'telefono numero llamar' },
  { en: 'email', es: 'correo' },
  { en: 'listing list listed mls', es: 'listado listar publicar anunciar' },
  { en: 'seniorliving elderly', es: 'seniorliving ancianos' },
  { en: 'bot robot ai automated human', es: 'bot robot automatico humano artificial' },
  { en: 'disclose disclosure tell', es: 'divulgar revelar informar' },
  { en: 'private privacy confidential neighbors', es: 'privado privacidad confidencial vecinos' },
  { en: 'obligation obligated commitment', es: 'obligacion compromiso' },
  { en: 'walkthrough visit tour', es: 'visita recorrido' },
];

const STEM = { en: stemEn, es: stemEs };
const RELATED = { en: new Map(), es: new Map() };
for (const group of GROUPS) {
  for (const lang of ['en', 'es']) {
    const stems = [...new Set(group[lang].split(' ').map((w) => STEM[lang](IRREGULAR[w] || w)))];
    for (const stem of stems) {
      const others = RELATED[lang].get(stem) || new Set();
      for (const other of stems) if (other !== stem) others.add(other);
      RELATED[lang].set(stem, others);
    }
  }
}

/** The search terms of a text, in order, with repeats: folded, phrases rewritten, stop words dropped, stemmed. */
export function terms(text, lang = 'en') {
  let s = ` ${fold(text)} `;
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const stem = STEM[lang] || stemEn;
  const out = [];
  for (const raw of s.replace(/'s\b/g, '').replace(/'/g, '').split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2 || STOP.has(raw)) continue;
    if (/^\d+$/.test(raw) && raw.length > 4) continue; // street numbers, ZIP codes, phone fragments say nothing about the topic
    out.push(stem(IRREGULAR[raw] || raw));
  }
  return out;
}

/** Stems that mean the same thing as this one in this language (may be empty). */
export const related = (stem, lang = 'en') => RELATED[lang]?.get(stem) || new Set();

/** Edit distance with an early stop: the true distance when it is at most `max`, otherwise max + 1. */
export function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let prev2 = null;
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}
