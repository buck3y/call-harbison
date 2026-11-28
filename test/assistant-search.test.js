// The search-only path (no model) on questions typed the way sellers type them: typos, no punctuation, long stories.
// Each sample names the answer it should get (faq:<English question>, page:<path>, x:<fixed reply>) or the hand-off
// or the greeting, plus any other answer that would also be right ("ok").
//
// Every third sample (positions 3, 6, 9… in each language) is held out: the method was tuned on the others only.
// The test fails if either score drops below a floor set a little under what was measured, so later changes to the
// search, the synonyms or the pages cannot quietly make it worse. ASSISTANT_TUNING=1 prints the tuning set's misses
// and never evaluates the held-out set (use that while tuning).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexFromSource } from '../lib/assistant/source.js';
import { createAssistant, prepareIndex } from '../lib/assistant/service.js';
import { search } from '../lib/assistant/search.js';

const EN = [
  ['do you charge any fees or commision', 'faq:Are there fees or commissions?'],
  ['my mom passed away last year and left me her house in bakersfield, its still in probate, can i sell it now or do i have to wait', 'faq:Can I sell an inherited house that is still in probate?', ['page:/situations/inherited-property', 'page:/guides/sell-inherited-house-california']],
  ['how fast can you close', 'faq:How fast can you close?', ['faq:How quickly can you close?']],
  ['the roof leaks and the foundation is cracked do i need to fix it before you buy', 'faq:Will you still make an offer if the house has foundation or roof problems?', ['page:/situations/needs-major-repairs', 'faq:Do I have to make any repairs or clean the house?']],
  ['i have tenants who wont pay rent can i still sell', 'faq:Do my tenants have to move out before I sell?', ['page:/situations/problem-tenants', 'faq:Can I sell a rental property with tenants living in it?']],
  ['are you a real estate agent or just an investor', 'faq:Are you a licensed real estate agent?', ['page:/about']],
  ['Im 3 months behind on my morgage and got a notice, can you stop the foreclosure', 'faq:Can you stop my foreclosure?', ['page:/situations/behind-on-mortgage', 'page:/guides/kern-county-foreclosure-options']],
  ['how much will you give me for my house at 2201 Oak St', 'handoff', ['faq:How do you determine a cash offer?']],
  ['what is your phone number', 'x:x-contact'],
  ['hi', 'greeting'],
  ['who pays the closing costs', 'faq:Who pays closing costs in a cash sale?'],
  ['do i have to clean out all the junk in the house first', 'faq:Do I have to make any repairs or clean the house?', ['faq:Do we have to clean out the house first?', 'faq:Do I have to empty the house before you will look at it?', 'page:/situations/hoarding-contents', 'faq:What if the house is still full of furniture and belongings?']],
  ['the house is empty and people keep breaking in', 'faq:What if there are squatters or break-in damage?', ['page:/situations/vacant-property']],
  ['how do you come up with your offer price', 'faq:How do you determine a cash offer?', ['page:/guides/what-affects-a-cash-offer']],
  ['can i sell my house if i live in another state', 'faq:I live out of state. Can I still sell?', ['faq:Can I sell a loved one’s Bakersfield house if I live in another state?', 'faq:I live out of the area. Can I sell my Kern County property without traveling?']],
  ['do i pay taxes on an inherited house when i sell', 'faq:Do I pay taxes when I sell an inherited house?'],
  ['we are getting divorced and need to sell the house', 'page:/situations/life-change', ['faq:Both owners need to agree to sell, right?']],
  ['is there any obligation if i ask for an offer', 'faq:Is there any obligation if I request an offer?'],
  ['my house had a kitchen fire and its not livable', 'faq:Do you buy houses that are unlivable?', ['page:/situations/fire-water-damage']],
  ['the previous owner added a room without permits will that stop the sale', 'faq:Does unpermitted work stop a sale?', ['faq:What about work that was done without permits?', 'page:/situations/code-violations-unpermitted-work']],
  ['i got a code violation letter from the county', 'faq:Can I sell a house with a code violation?', ['page:/situations/code-violations-unpermitted-work']],
  ['there is a lien on my house can i still sell', 'faq:Can I sell a house that has a lien on it?', ['page:/situations/liens-back-taxes', 'faq:Can I sell a house with back property taxes or a lien?']],
  ['i owe back property taxes what happens when i sell', 'faq:What happens to back property taxes when I sell?', ['faq:Can I sell a house with back property taxes or a lien?', 'page:/situations/liens-back-taxes']],
  ['do you buy land in tehachapi', 'faq:Do you buy cabins and vacant land around Tehachapi, not just houses?', ['page:/areas/tehachapi']],
  ['how is vacant land valued', 'faq:How is land valued?', ['page:/situations/land-development']],
  ['can i split my lot into two', 'faq:Can I split my lot?'],
  ['my listing expired and the house never sold why', 'faq:Why didn’t my house sell?', ['page:/situations/failed-listing']],
  ['do you buy houses in oildale', 'faq:Do you buy houses in Oildale?', ['faq:Do you buy houses in Oildale, Rosedale and Lamont?', 'page:/areas/oildale']],
  ['do you buy in ridgecrest', 'faq:Do you buy houses in Ridgecrest and Inyokern?', ['page:/areas/ridgecrest']],
  ['my dad is moving into assisted living what do we do with his house', 'faq:What happens to the house when a loved one moves into senior living?', ['page:/sell-loved-ones-house']],
  ['should i fix up the house before selling or sell as is', 'page:/guides/renovate-or-sell-as-is', ['faq:Should we fix the house before selling it?', 'faq:How do I sell a house that needs repairs in California?']],
  ['is it better to list with a realtor or take a cash offer', 'page:/guides/cash-offer-vs-listing', ['faq:Should I list my Bakersfield house or take a direct offer?', 'faq:Should I list my Rosedale home or take a cash offer?']],
  ['what happens at the walkthrough', 'page:/guides/direct-sale-walkthrough'],
  ['how quickly will i hear back from you', 'faq:How quickly will I hear back?'],
  ['can i stay in the house a few weeks after closing', 'faq:Can I stay in the house for a bit after closing?'],
  ['will you keep my situation private, i dont want neighbors to know', 'faq:Will you keep this private?'],
  ['whats the weather like in bakersfield tomorrow', 'handoff'],
  ['can you help me buy a car', 'handoff'],
  ['my brother and i inherited the house but he doesnt want to sell what can i do', 'handoff', ['faq:Who has to sign to sell a loved one’s house?', 'faq:Both owners need to agree to sell, right?']],
  ['what is my house worth', 'handoff', ['faq:How do you determine a cash offer?']],
  ['do i need to tell buyers about problems i know about', 'faq:Do I need to disclose problems I know about?'],
  ['where do i find my parcel number', 'faq:Where do I find my Kern County parcel number (APN)?'],
  ['does a septic system matter when selling in tehachapi', 'faq:Do a well and septic system change how a Tehachapi home sells?'],
  ['is this a real person or a bot', 'x:x-about'],
  ['my renter is a hoarder and the place is trashed, plus the roof is shot. i just want out. do you buy houses like that', 'page:/situations/hoarding-contents', ['faq:Do I have to make any repairs or clean the house?', 'page:/situations/needs-major-repairs', 'page:/situations/problem-tenants', 'faq:Do you buy houses that are unlivable?']],
  ['can i leave furniture and stuff behind', 'faq:What if the house is still full of furniture and belongings?', ['faq:Do I have to make any repairs or clean the house?', 'faq:Do we have to clean out the house first?', 'page:/situations/hoarding-contents']],
  ['thank you', 'greeting'],
  ['do you buy houses in delano', 'faq:Do you buy houses in Delano and McFarland?', ['page:/areas/delano']],
];

const ES = [
  ['cobran comision', 'faq:Are there fees or commissions?'],
  ['heredé la casa de mi mamá, todavía está en probate, la puedo vender?', 'faq:Can I sell an inherited house that is still in probate?', ['page:/situations/inherited-property', 'page:/guides/sell-inherited-house-california']],
  ['que tan rapido pueden cerrar', 'faq:How fast can you close?', ['faq:How quickly can you close?']],
  ['la casa necesita muchas reparaciones, el techo esta mal', 'page:/situations/needs-major-repairs', ['faq:Will you still make an offer if the house has foundation or roof problems?', 'faq:Do I have to make any repairs or clean the house?']],
  ['tengo inquilinos que no pagan la renta', 'page:/situations/problem-tenants', ['faq:Do my tenants have to move out before I sell?', 'faq:Should I talk to a lawyer about my tenant situation?']],
  ['estoy atrasado en los pagos de la hipoteca', 'page:/situations/behind-on-mortgage', ['faq:Will I get anything if I sell while behind on payments?', 'faq:Can you stop my foreclosure?', 'page:/guides/kern-county-foreclosure-options']],
  ['cual es su numero de telefono', 'x:x-contact'],
  ['hola', 'greeting'],
  ['quien paga los costos de cierre', 'faq:Who pays closing costs in a cash sale?'],
  ['tengo que limpiar la casa antes de vender', 'faq:Do I have to make any repairs or clean the house?', ['faq:Do we have to clean out the house first?', 'faq:Do I have to empty the house before you will look at it?']],
  ['como calculan la oferta en efectivo', 'faq:How do you determine a cash offer?', ['page:/guides/what-affects-a-cash-offer']],
  ['vivo en otro estado, puedo vender mi casa', 'faq:I live out of state. Can I still sell?', ['faq:Can I sell a loved one’s Bakersfield house if I live in another state?', 'faq:I live out of the area. Can I sell my Kern County property without traveling?']],
  ['tengo que pagar impuestos si vendo una casa heredada', 'faq:Do I pay taxes when I sell an inherited house?'],
  ['cuanto me dan por mi casa en la calle Niles 1520', 'handoff', ['faq:How do you determine a cash offer?']],
  ['es usted agente con licencia', 'faq:Are you a licensed real estate agent?', ['page:/about']],
  ['la casa se quemo en un incendio', 'page:/situations/fire-water-damage', ['faq:Do you buy houses that are unlivable?', 'faq:Can I sell before my insurance claim is settled?']],
  ['compran terrenos en california city', 'page:/areas/california-city', ['faq:What makes one California City lot worth more than another?', 'faq:Do I need to visit California City to sell my lot?']],
  ['hay un gravamen en mi casa', 'faq:Can I sell a house that has a lien on it?', ['page:/situations/liens-back-taxes', 'faq:Can I sell a house with back property taxes or a lien?']],
  ['nos estamos divorciando', 'page:/situations/life-change', ['faq:Both owners need to agree to sell, right?']],
  ['es un robot o una persona', 'x:x-about'],
  ['mi papa se va a una casa de retiro, que hacemos con su casa', 'faq:What happens to the house when a loved one moves into senior living?', ['page:/sell-loved-ones-house']],
  ['gracias', 'greeting'],
  ['hay alguna obligacion si pido una oferta', 'faq:Is there any obligation if I request an offer?'],
  ['el listado se vencio y nadie compro mi casa, por que', 'faq:Why didn’t my house sell?', ['page:/situations/failed-listing']],
  ['compran casas en delano', 'faq:Do you buy houses in Delano and McFarland?', ['page:/areas/delano']],
];

// Floors: a little under the scores measured when the method was settled on 2026-11-27 (tuning 45/49 = 92%,
// held-out 16/24 = 67%; docs/ASSISTANT.md). One more miss in either set is allowed; two fail the test.
const FLOOR = { tuning: 0.88, heldOut: 0.62 };

const raw = indexFromSource();
const index = prepareIndex(raw);
const english = raw.answers.filter((a) => a.lang === 'en');
function resolve(ref) {
  if (ref === 'handoff' || ref === 'greeting') return ref;
  const [kind, value] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  const hit = kind === 'faq' ? english.find((a) => a.kind === 'faq' && a.question === value)
    : kind === 'page' ? english.find((a) => a.kind === 'page' && a.url === value)
      : english.find((a) => a.id === value);
  assert.ok(hit, `sample refers to an answer that is not on the site: ${ref}`);
  return hit.id;
}
const assistant = createAssistant({ env: {} });
async function outcome(question, lang) {
  const { reply, outcome: kind } = await assistant.answer({ message: question, lang }, index);
  if (kind === 'greeting') return 'greeting';
  if (kind === 'handoff' || reply.answers[0].id === 'x-handoff') return 'handoff';
  return reply.answers[0].id;
}
const samples = [...EN.map((s, i) => ({ s, lang: 'en', heldOut: i % 3 === 2 })), ...ES.map((s, i) => ({ s, lang: 'es', heldOut: i % 3 === 2 }))];
async function score(set) {
  const misses = [];
  for (const { s: [question, expected, ok = []], lang } of set) {
    const allowed = new Set([expected, ...ok].map(resolve));
    const got = await outcome(question, lang);
    if (process.env.ASSISTANT_TUNING === '2') {
      const r = search(index.search, lang, question);
      console.log(`#   ${allowed.has(got) ? 'ok  ' : 'MISS'} s=${r.strength.toFixed(2)} lead=${r[1] ? (r[0].score / r[1].score).toFixed(2) : '-'} top=${r[0] ? r[0].score.toFixed(1) : '-'} topOk=${r[0] && allowed.has(r[0].entry.id) ? 'y' : 'n'} want=${expected.slice(0, 12)} ${question.slice(0, 50)}`);
    }
    if (allowed.has(got)) continue;
    let why = '';
    if (process.env.ASSISTANT_TUNING) {
      const r = search(index.search, lang, question);
      why = ` [strength ${r.strength.toFixed(2)}, lead ${r[1] ? (r[0].score / r[1].score).toFixed(2) : '-'}; top: ${r.slice(0, 3).map((x) => `${allowed.has(x.entry.id) ? '*' : ''}${(x.entry.question || x.entry.id).slice(0, 40)} ${x.score.toFixed(1)}`).join(' | ')}]`;
    }
    misses.push(`${lang} "${question}" -> ${got}; wanted ${expected}${why}`);
  }
  return { score: (set.length - misses.length) / set.length, misses, n: set.length };
}

test('there are enough samples, in both languages, and every expected answer exists', () => {
  assert.ok(EN.length >= 40 && ES.length >= 20, `${EN.length} English, ${ES.length} Spanish`);
  for (const { s: [, expected, ok = []] } of samples) for (const ref of [expected, ...ok]) resolve(ref);
});

test('the search-only path answers the tuning set', async () => {
  const result = await score(samples.filter((x) => !x.heldOut));
  console.log(`# tuning set: ${Math.round(result.score * 100)}% of ${result.n}`);
  if (process.env.ASSISTANT_TUNING) for (const m of result.misses) console.log(`#   miss: ${m}`);
  assert.ok(result.score >= FLOOR.tuning, `tuning score ${result.score.toFixed(2)} is under the floor ${FLOOR.tuning}:\n${result.misses.join('\n')}`);
});

test('the search-only path answers the held-out set (never used for tuning)', { skip: Boolean(process.env.ASSISTANT_TUNING) }, async () => {
  const result = await score(samples.filter((x) => x.heldOut));
  console.log(`# held-out set: ${Math.round(result.score * 100)}% of ${result.n}`);
  for (const m of result.misses) console.log(`#   miss: ${m}`);
  assert.ok(result.score >= FLOOR.heldOut, `held-out score ${result.score.toFixed(2)} is under the floor ${FLOOR.heldOut}:\n${result.misses.join('\n')}`);
});
