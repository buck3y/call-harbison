// "Ask a question": the words of the block, the /ask page and the privacy paragraph (English; their Spanish is in
// src/i18n/es/assistant.json, keyed by this exact text), and the fixed replies the server sends for what the pages do
// not say (both languages here, because the server sends them and the page translator never sees them).
// docs/ASSISTANT.md explains the design: the model only chooses among this website's own answers and never writes.
import site from '../site.config.mjs';

export const askCopy = {
  label: 'Ask your own question',
  labelPage: 'Your question',
  automated: '(automated answers)',
  hint: 'Answers are taken from this website by a program. They are not an offer or advice. Please don’t type names, phone numbers or addresses here.',
  button: 'Ask',
  clear: 'Clear',
  footer: 'Ask a question',
  // The /ask page. title and description keep their search form; the visible heading is sentence case.
  title: 'Ask a Question About Selling Your House',
  description: 'Type a question about selling a Kern County house or land and see the answer this website already gives, with a link to the page. Automated; not an offer or advice.',
  heading: 'Ask a question',
  intro: 'Type a question in your own words. A program finds the answer on this website and shows it with a link to the page it comes from. For anything about your own property, it points you to Nathanael.',
  crumb: 'Ask a question',
  noscript: 'The assistant needs JavaScript, which is turned off in this browser.',
};

// The privacy page. Two wordings, chosen by the build: with a provider named (ASSISTANT_PROVIDER_NAME) a question may
// leave the server; without one it never does (api/assistant.js refuses to call a model the pages do not name).
// Every sentence describes what lib/assistant/ and static/assistant.js do; an attorney should read them.
const askLimits = 'To limit how many questions one connection can ask, the server counts them per internet address in its memory for up to a day. Your browser keeps your questions and the answers in its session storage until you close the tab or choose Clear.';
export const askPrivacy = {
  heading: 'Questions typed into “Ask a question”',
  // No provider named: nothing leaves the server.
  local: `When you type a question into the automated “Ask a question” assistant, this website’s own server matches it to an answer already published here and shows you that answer. Your question is not sent to any other company, and the server does not store or log it. ${askLimits}`,
  // A provider named: this sentence, the provider's name in a list (as the analytics tools are listed), then `after`.
  sent: 'When you type a question into the automated “Ask a question” assistant, only this website’s own text is shown to you in reply. To find the published answer that matches, this website’s server may send your question, with up to six of your earlier questions from this visit, to this company, which runs a language model:',
  after: `Before a question leaves this server, the server removes anything that looks like a phone number, email address, street address or long number, and anything after “my name is”. No internet address, cookie or other identifier is sent with it. This website does not store or log your questions; that company’s own terms say what it does with the text it receives. ${askLimits}`,
};

// Fixed replies. `topic` is what the search and the model see for a reply that can be a candidate (search: true);
// it is never shown. `handoff` adds the ways to reach Nathanael under the reply. `url` is a path on this site.
const phone = site.phone;
export const fixedReplies = [
  {
    id: 'x-greeting', handoff: false, search: false, url: '/ask',
    en: 'Ask a question about selling a house or land in Kern County, in your own words, and this assistant will show you what this website says about it.',
    es: 'Haga una pregunta sobre la venta de una casa o un terreno en el condado de Kern, con sus propias palabras, y este asistente le mostrará lo que dice este sitio al respecto.',
  },
  {
    id: 'x-handoff', handoff: true, search: false, url: '/contact',
    en: 'That’s a question for Nathanael. This website doesn’t answer it directly, and he can look at your property and your situation. He typically replies within 24 hours.',
    es: 'Esa pregunta es para Nathanael. Este sitio no la responde directamente, y él puede revisar su propiedad y su situación. Suele responder en un plazo de 24 horas.',
  },
  {
    id: 'x-off-topic', handoff: false, search: false, url: '/ask',
    en: 'This assistant can only help with questions about selling a property in Kern County.',
    es: 'Este asistente solo puede ayudar con preguntas sobre la venta de una propiedad en el condado de Kern.',
  },
  {
    id: 'x-contact', handoff: true, search: true, url: '/contact',
    topic: {
      en: 'How do I reach Nathanael? Contact, phone number, call, text, email, talk to someone, office hours, reach a person',
      es: '¿Cómo me comunico con Nathanael? Contacto, número de teléfono, llamar, mensaje de texto, correo electrónico, hablar con alguien, comunicarme',
    },
    en: `Call or text Nathanael at ${phone}, or email ${site.email}. You can also send the property address with the form. He typically replies within 24 hours.`,
    es: `Llame o envíe un mensaje de texto a Nathanael al ${phone}, o escriba a ${site.email}. También puede enviar la dirección de la propiedad con el formulario. Suele responder en un plazo de 24 horas.`,
  },
  {
    id: 'x-about', handoff: false, search: true, url: '/ask',
    topic: {
      en: 'Is this a bot? Am I talking to a real person, a robot, AI or Nathanael? Who answers these questions? What is this assistant?',
      es: '¿Es un bot? ¿Hablo con una persona real, un robot, inteligencia artificial o Nathanael? ¿Quién responde estas preguntas? ¿Qué es este asistente?',
    },
    en: 'This is an automated assistant, not a person. It matches your question to answers already published on this website and shows them with a link to the page they come from. It does not write answers of its own. For anything about your own property, it points you to Nathanael.',
    es: 'Este es un asistente automático, no una persona. Relaciona su pregunta con respuestas ya publicadas en este sitio y las muestra con un enlace a la página de donde vienen. No escribe respuestas propias. Para cualquier cosa sobre su propia propiedad, le indica que hable con Nathanael.',
  },
  {
    id: 'x-unavailable', handoff: true, search: false, url: '/contact',
    en: `The assistant isn’t available right now. Call or text Nathanael at ${phone}.`,
    es: `El asistente no está disponible en este momento. Llame o envíe un mensaje de texto a Nathanael al ${phone}.`,
  },
  {
    id: 'x-limit', handoff: true, search: false, url: '/contact',
    en: `That’s a lot of questions in a short time. Please wait a little, or call or text Nathanael at ${phone}.`,
    es: `Son muchas preguntas en poco tiempo. Espere un momento, o llame o envíe un mensaje de texto a Nathanael al ${phone}.`,
  },
];
