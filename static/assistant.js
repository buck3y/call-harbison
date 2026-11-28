// "Ask a question" (docs/ASSISTANT.md). Loaded, deferred, only on pages that carry the block, only in a build with
// ASSISTANT=on. It sends the visitor's question to /api/assistant and shows the website's own answers that come back.
// Rules kept here: every string reaches the page through textContent; every link is built here, from a path that
// starts with one "/" (or tel:/sms: with the site's own number); no inline handlers; the conversation is kept in
// sessionStorage only, until the tab closes or the visitor chooses Clear; analytics get event names, never text.
(() => {
  const block = document.querySelector('[data-assistant]');
  if (!block) return;
  const form = block.querySelector('form');
  const input = form && form.querySelector('input[name="q"]');
  const button = form && form.querySelector('button[type="submit"]');
  const status = block.querySelector('.ask-status');
  const log = block.querySelector('.ask-log');
  const tools = block.querySelector('.ask-tools');
  const clear = block.querySelector('.ask-clear');
  if (!form || !input || !button || !status || !log || !tools || !clear) return;

  const spanish = document.documentElement.lang.toLowerCase().startsWith('es');
  const say = (english, es) => (spanish ? es : english);
  const KEY = 'hbh-ask';
  const KEEP = 20; // entries kept on screen; the server only ever reads the last six questions
  const SENT = 6;
  const phone = /^\+\d{8,15}$/.test(block.dataset.phone || '') ? block.dataset.phone : '';
  const phoneLabel = block.dataset.phoneLabel || '';

  const push = (event) => { try { (window.dataLayer = window.dataLayer || []).push({ event }); } catch {} };
  // A path on this site: one leading "/", no "//", no backslash, no spaces or control characters.
  const sitePath = (url) => typeof url === 'string' && url.length < 300 && /^\/(?![/\\])[^\s\\]*$/.test(url);
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

  // ---------- What is kept: this tab's conversation, in sessionStorage only ----------
  const clean = (turn) => {
    if (!turn || typeof turn.q !== 'string' || !Array.isArray(turn.answers)) return null;
    const answers = turn.answers.slice(0, 2).filter((a) => a && typeof a.id === 'string' && typeof a.text === 'string')
      .map((a) => ({ id: a.id.slice(0, 48), question: text(a.question, 300), text: text(a.text, 4000), url: sitePath(a.url) ? a.url : '' }));
    return { q: turn.q.slice(0, 500), answers, handoff: turn.handoff === true };
  };
  const read = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      return saved && Array.isArray(saved.turns) ? saved.turns.map(clean).filter(Boolean).slice(-KEEP) : [];
    } catch { return []; }
  };
  const write = (turns) => { try { sessionStorage.setItem(KEY, JSON.stringify({ turns: turns.slice(-KEEP) })); } catch {} };
  let turns = read();

  // ---------- Drawing an entry: the visitor's question, the website's answer, where it came from ----------
  const link = (href, label) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    return a;
  };
  function reach() {
    const p = document.createElement('p');
    p.className = 'ask-reach';
    if (phone) {
      p.append(link(`tel:${phone}`, say(`Call ${phoneLabel}`, `Llamar al ${phoneLabel}`)));
      p.append(link(`sms:${phone}`, say('Text Nathanael', 'Enviar un texto a Nathanael')));
    }
    const formHere = document.querySelector('#lead-form');
    p.append(link(formHere ? '#lead-form' : (spanish ? '/es#lead-form' : '/#lead-form'), say('Send the address', 'Enviar la dirección')));
    return p;
  }
  function fill(li, turn) {
    while (li.childNodes.length > 1) li.lastChild.remove();
    for (const answer of turn.answers) {
      const p = document.createElement('p');
      p.className = 'ask-a';
      p.textContent = answer.text;
      li.append(p);
      if (answer.question && answer.url) {
        const from = document.createElement('p');
        from.className = 'ask-from';
        from.append(say('From: ', 'De: '), link(answer.url, answer.question));
        li.append(from);
      }
    }
    if (turn.handoff) li.append(reach());
  }
  function entry(question) {
    const li = document.createElement('li');
    const h = document.createElement('h3');
    h.className = 'ask-q';
    // Shown with a capital first letter, like the site's own questions; what is sent and kept stays as typed.
    h.textContent = question.charAt(0).toUpperCase() + question.slice(1);
    li.append(h);
    return li;
  }
  const showTools = () => { const some = log.children.length > 0; log.hidden = !some; tools.hidden = !some; };

  for (const turn of turns) { const li = entry(turn.q); fill(li, turn); log.prepend(li); }
  showTools();
  block.hidden = false;

  // ---------- Asking ----------
  const unavailable = () => ({
    q: '',
    answers: [{ id: 'x-unavailable', question: '', url: '', text: say(`The assistant isn’t available right now. Call or text Nathanael at ${phoneLabel}.`, `El asistente no está disponible en este momento. Llame o envíe un mensaje de texto a Nathanael al ${phoneLabel}.`) }],
    handoff: true,
  });
  let opened = false;
  input.addEventListener('focus', () => { if (!opened) { opened = true; push('assistant_open'); } });
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (busy || question.length < 2) { input.focus(); return; }
    busy = true;
    button.disabled = true;
    push('assistant_question');
    const li = entry(question);
    log.prepend(li);
    showTools();
    input.value = '';
    status.className = 'ask-status';
    status.textContent = say('Looking for the answer on this website…', 'Buscando la respuesta en este sitio…');
    const history = turns.slice(-SENT).map((t) => ({ q: t.q, ids: t.answers.map((a) => a.id) }));
    let turn = null;
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 20000) : 0;
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify({ message: question, history, lang: spanish ? 'es' : 'en' }),
        signal: controller ? controller.signal : undefined,
      });
      clearTimeout(timer);
      const data = await res.json();
      const got = clean({ q: question, answers: Array.isArray(data && data.answers) ? data.answers : [], handoff: data && data.handoff === true });
      if (got && got.answers.length) turn = got;
    } catch {}
    const shown = turn || { ...unavailable(), q: question };
    fill(li, shown);
    if (turn) { turns = [...turns, turn].slice(-KEEP); write(turns); }
    push(shown.handoff ? 'assistant_handoff' : 'assistant_answer');
    // Screen readers hear the answer; on screen it is already under the question.
    status.className = 'ask-status sr-only';
    status.textContent = shown.answers.map((a) => a.text).join(' ');
    button.disabled = false;
    busy = false;
  });

  clear.addEventListener('click', () => {
    turns = [];
    try { sessionStorage.removeItem(KEY); } catch {}
    log.replaceChildren();
    status.className = 'ask-status';
    status.textContent = '';
    showTools();
    input.focus();
  });
})();
