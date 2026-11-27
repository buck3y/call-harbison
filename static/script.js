// ---------- Language ----------
// Spanish pages live under /es and set <html lang="es-US">. Messages written here pick the right language.
const spanish = document.documentElement.lang.toLowerCase().startsWith('es');
const say = (english, es) => (spanish ? es : english);
// Remember the language the visitor picks with the header switch (the English pages read this and redirect).
document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-lang-pref]');
  if (!pick) return;
  try { localStorage.setItem('hbh-lang', pick.dataset.langPref); } catch {}
});

// Mobile menu
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');

const closeMenu = (returnFocus = false) => {
  if (!nav || !menu || !nav.classList.contains('open')) return;
  nav.classList.remove('open');
  menu.setAttribute('aria-expanded', 'false');
  if (returnFocus) menu.focus();
};

menu?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
});

nav?.querySelectorAll('a').forEach((a) => {
  a.addEventListener('click', () => closeMenu(false));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu(true);
});

document.addEventListener('click', (e) => {
  if (nav?.classList.contains('open') && !e.target.closest('.site-header')) closeMenu(false);
});

// ---------- Attribution ----------
// First touch is kept 90 days (Google's gclid window) so a seller who returns weeks later is still credited
// to the ad or partner that found them. Session UTMs are preserved when no ad/partner click overrides them.
const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'ref'];
const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'ref'];
const FIRST_KEY = 'hbh_first_touch';
const TTL = 90 * 864e5;
const params = new URLSearchParams(location.search);
const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k) || 'null'); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch {} },
};
(() => {
  const incoming = Object.fromEntries(ATTR_KEYS.filter((k) => params.get(k)).map((k) => [k, params.get(k).slice(0, 256)]));
  // Partner short links: /family?ref=rosewood → treated as a referral campaign.
  if (incoming.ref && !incoming.utm_source) Object.assign(incoming, { utm_source: incoming.ref, utm_medium: 'referral', utm_campaign: incoming.utm_campaign || 'family_transition' });
  const first = store.get(FIRST_KEY);
  if (!first || Date.now() - first.t > TTL) {
    store.set(FIRST_KEY, { t: Date.now(), landing_page: location.pathname, referrer: document.referrer.slice(0, 300), ...incoming });
  } else if (CLICK_KEYS.some((k) => incoming[k])) {
    // A new ad click or partner visit is a stronger signal than an old organic visit.
    store.set(FIRST_KEY, { ...first, ...incoming, t: Date.now() });
  }
  if (Object.keys(incoming).length) store.set('hbh_last_touch', incoming, sessionStorage);
})();
const attribution = () => {
  const first = store.get(FIRST_KEY) || {};
  const last = store.get('hbh_last_touch', sessionStorage) || {};
  const hasStickyClick = CLICK_KEYS.some((k) => first[k]);
  const out = { landing_page: first.landing_page || location.pathname, referrer: first.referrer || document.referrer };
  ATTR_KEYS.forEach((k) => {
    out[k] = CLICK_KEYS.includes(k) || hasStickyClick ? (first[k] || last[k] || '') : (last[k] || first[k] || '');
  });
  return out;
};

// ---------- Analytics (GTM dataLayer + GA4 gtag if present) ----------
// Event names follow the site playbook. Never send names, phones, emails, or addresses here.
const pageType = document.body.dataset.pageType || 'page';
const device = () => (matchMedia('(max-width: 640px)').matches ? 'mobile' : matchMedia('(max-width: 980px)').matches ? 'tablet' : 'desktop');
window.dataLayer = window.dataLayer || [];
const track = (event, props = {}) => {
  const payload = {
    page_path: location.pathname,
    page_type: pageType,
    // Arbitrary campaign/query values can contain personal data. Keep attribution in CRM only.
    device_type: device(),
    ...props,
  };
  window.dataLayer.push({ event, ...payload });
  if (window.gtag) window.gtag('event', event, payload);
};
const PAGE_VIEW_EVENTS = { guide: 'guide_view', situation: 'situation_page_view', location: 'location_page_view' };
if (PAGE_VIEW_EVENTS[pageType]) track(PAGE_VIEW_EVENTS[pageType]);

document.addEventListener('click', (e) => {
  if (e.target.closest('a[href^="tel:"]')) track('phone_click');
  const tracked = e.target.closest('[data-track]');
  if (tracked) track(tracked.dataset.track);
  const cta = e.target.closest('[data-cta]');
  if (cta) track('cta_click', { cta: cta.dataset.cta });
  // Path cards pre-fill route_interest on the page's form.
  const route = e.target.closest('[data-route]');
  if (route) {
    const field = document.querySelector('#lead-form input[name="route_interest"]');
    if (field) field.value = route.dataset.route;
    track('cta_click', { cta: 'route_card', route_interest: route.dataset.route });
  }
});

// ---------- FAQ deep links: open the answer a link points to ----------
const openFaq = () => {
  const el = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  const box = el.closest?.('details'); // e.g. #estimator inside "Try your own numbers"
  if (box && !box.open) { box.open = true; el.scrollIntoView?.({ block: 'start' }); }
};
window.addEventListener('hashchange', openFaq);
openFaq();

// ---------- Click-to-load video ----------
document.querySelectorAll('button[data-yt]').forEach((b) => {
  b.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.yt)}?autoplay=1&rel=0`;
    f.title = b.getAttribute('aria-label') || 'Video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.allowFullscreen = true;
    b.replaceWith(f);
    track('video_play', { video_id: b.dataset.yt });
  });
});

// ---------- Interactive Net Proceeds Estimator ----------
document.querySelectorAll('[data-net-estimator]').forEach((box) => {
  const arvInput = box.querySelector('[data-est-arv]');
  const repairsSelect = box.querySelector('[data-est-repairs]');
  const monthsInput = box.querySelector('[data-est-months]');
  const fmt = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  let trackedOnce = false;

  const update = (isUserAction = false) => {
    const arv = Number(arvInput?.value) || 350000;
    const repairs = Number(repairsSelect?.value) || 0;
    const months = Number(monthsInput?.value) || 5;

    const set = (sel, txt) => { const el = box.querySelector(sel); if (el) el.textContent = txt; };
    set('[data-est-arv-out]', fmt(arv));
    const monthsWord = say(months === 1 ? 'month' : 'months', months === 1 ? 'mes' : 'meses');
    set('[data-est-months-out]', `${months} ${monthsWord}`);

    const listRepairs = Math.round(repairs * 1.1);
    const listComm = Math.round(arv * 0.05);
    const listClose = Math.round(arv * 0.015);
    const listHold = Math.round(arv * 0.0045 * months);
    const listNet = Math.max(0, arv - listRepairs - listComm - listClose - listHold);

    // Illustrative direct-buyer math: ARV minus repairs, resale/carry/risk costs, presented as a realistic range.
    const buyerCarryAndResale = Math.round(arv * 0.085);
    const buyerMarginLow = Math.round(arv * 0.085 + repairs * 0.15);
    const buyerMarginHigh = Math.round(arv * 0.12 + repairs * 0.22);
    const directHigh = Math.max(25000, Math.round((arv - repairs - buyerCarryAndResale - buyerMarginLow) / 1000) * 1000);
    const directLow = Math.max(20000, Math.min(directHigh - 5000, Math.round((arv - repairs - buyerCarryAndResale - buyerMarginHigh) / 1000) * 1000));
    const directClose = Math.round(Math.max(1000, arv * 0.004));
    const directHold = Math.round(Math.max(600, arv * 0.0025));

    set('[data-out-list-gross]', fmt(arv));
    set('[data-out-list-repairs]', listRepairs ? `−${fmt(listRepairs)}` : '$0');
    set('[data-out-list-comm]', `−${fmt(listComm)}`);
    set('[data-out-list-close]', `−${fmt(listClose)}`);
    set('[data-out-list-hold]', `−${fmt(listHold)}`);
    set('[data-out-list-net]', `≈ ${fmt(listNet)}`);
    set('[data-out-list-time]', `~${months} ${monthsWord}`);

    set('[data-out-direct-gross]', `${fmt(directLow)} – ${fmt(directHigh)}`);
    set('[data-out-direct-close]', `−${fmt(directClose)}`);
    set('[data-out-direct-hold]', `−${fmt(directHold)}`);
    set('[data-out-direct-net]', `${fmt(Math.max(0, directLow - directClose - directHold))} – ${fmt(Math.max(0, directHigh - directClose - directHold))}`);

    if (isUserAction && !trackedOnce) {
      trackedOnce = true;
      track('estimator_interact');
    }
  };

  [arvInput, repairsSelect, monthsInput].forEach((el) => el?.addEventListener('input', () => update(true)));
  repairsSelect?.addEventListener('change', () => update(true));
  update(false);
});

const formProps = (form) => {
  const v = (n) => form.querySelector(`[name="${n}"]:checked, input[type=hidden][name="${n}"], select[name="${n}"]`)?.value || '';
  return { form_type: form.dataset.formType || 'standard', situation_type: v('situation'), route_interest: v('route_interest'), location_interest: v('location_interest') };
};

// Report the form once, the first time it scrolls into view.
if ('IntersectionObserver' in window) {
  const seen = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { track('lead_form_view', formProps(en.target)); seen.unobserve(en.target); }
  }), { threshold: 0.4 });
  document.querySelectorAll('form[data-lead-form]').forEach((f) => seen.observe(f));
}

// ---------- Stepped forms ----------
document.querySelectorAll('form[data-steps]').forEach((form) => {
  const steps = [...form.querySelectorAll('.fstep')];
  const dots = [...form.querySelectorAll('.step-dots li')];
  const status = form.querySelector('.form-status');
  const firstHeading = form.closest('.lead-card')?.querySelector('h2')?.textContent;
  let current = 0;
  let started = false;
  let lastPointerDown = 0;

  form.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.choice')) lastPointerDown = Date.now();
  });

  form.show = (i, focus = true) => {
    const next = Math.max(0, Math.min(i, steps.length - 1));
    if (next !== current) {
      form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
      status.className = 'form-status';
      status.textContent = '';
    }
    current = next;
    steps.forEach((s, n) => (s.hidden = n !== current));
    dots.forEach((d, n) => d.classList.toggle('on', n <= current));
    const h = form.closest('.lead-card')?.querySelector('h2');
    if (h && current === 0 && form.dataset.formType === 'family_transition' && firstHeading) h.textContent = firstHeading;
    if (focus) steps[current].querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,input[type=radio]:checked,input[type=radio]')?.focus({ preventScroll: true });
  };
  if (form.dataset.start) form.show(Number(form.dataset.start), false);

  const stepValid = (s) => {
    const bad = [];
    const addr = s.querySelector('[name=address]');
    if (addr && addr.value.trim().length < 5) bad.push(addr);
    const street = s.querySelector('[name=street]');
    if (street && street.value.trim().length < 4) bad.push(street);
    const city = s.querySelector('[name=city]');
    if (city && city.value.trim().length < 2) bad.push(city);
    const zip = s.querySelector('[name=zip]');
    if (zip && !/^\d{5}(-\d{4})?$/.test(zip.value.trim())) bad.push(zip);
    s.querySelectorAll('.choice-grid[role=radiogroup]').forEach((g) => {
      if (!g.querySelector('input:checked')) bad.push(g);
    });
    return bad;
  };
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-next]')) {
      const bad = stepValid(steps[current]);
      form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
      status.className = 'form-status';
      status.textContent = '';
      if (bad.length) {
        bad.forEach((el) => el.classList.add('invalid'));
        const typed = bad.some((el) => el.tagName === 'INPUT');
        status.textContent = typed
          ? (form.querySelector('[name=street]')
            ? say('Please enter the street, city, and 5-digit ZIP code.', 'Por favor, escriba la calle, la ciudad y el código postal (ZIP) de 5 dígitos.')
            : say('Please enter the property address.', 'Por favor, escriba la dirección de la propiedad.'))
          : say('Please choose the closest option.', 'Por favor, elija la opción que más se acerque.');
        status.classList.add('error');
        track('lead_form_error', { ...formProps(form), step: current + 1 });
        return;
      }
      if (!started) { started = true; track('lead_form_start', formProps(form)); }
      track('lead_form_step_complete', { ...formProps(form), step: current + 1 });
      form.show(current + 1);
    }
    if (e.target.closest('[data-back]')) form.show(current - 1);
  });
  // Enter advances instead of submitting early.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && current < steps.length - 1 && e.target.tagName === 'INPUT') {
      e.preventDefault();
      form.querySelector('.fstep:not([hidden]) [data-next]')?.click();
    }
  });
  // Auto-advance only on pointer/touch taps — never on keyboard arrow navigation inside a radiogroup.
  form.addEventListener('change', (e) => {
    if (Date.now() - lastPointerDown > 500) return;
    if (e.target.type === 'radio' && steps[current].querySelectorAll('.choice-grid').length === 1 && !steps[current].querySelector('select')) {
      setTimeout(() => form.querySelector('.fstep:not([hidden]) [data-next]')?.click(), 180);
    }
  });
});

// ---------- Lead forms ----------
// Only a reviewed never-activated deployment may bypass recovery bootstrap.
const commandPhase = document.documentElement?.dataset.commandPhase;
const submitCommand = async (...args) => {
  if (commandPhase === 'preactivation') return Promise.resolve({legacy:true});
  if (commandPhase !== 'protocol' || !window.HBHCommands) throw new Error('Submission recovery is unavailable. Please reload or contact the team.');
  const result = await window.HBHCommands.submit(...args);
  if (result?.legacy) throw new Error('Recovery protocol mismatch. Please reload or contact the team.');
  return result;
};
document.querySelectorAll('form[data-lead-form]').forEach((form) => {
  if (commandPhase === 'protocol') window.HBHCommands?.bind(form);
  const status = form.querySelector('.form-status');
  const button = form.querySelector('button[type="submit"]');
  let submitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    status.className = 'form-status';

    const data = Object.fromEntries(new FormData(form).entries());
    data.source = location.pathname;
    data.language = spanish ? 'es' : 'en';
    Object.assign(data, attribution());
    // Options form: split fields → the combined values the CRM and alerts use.
    if (data.street !== undefined) data.address = [data.street, data.city, `${data.state || 'CA'} ${data.zip || ''}`.trim()].map((s) => (s || '').trim()).filter(Boolean).join(', ');
    if (data.first_name !== undefined) data.name = `${data.first_name || ''} ${data.last_name || ''}`.trim();

    const hasConsentCheckbox = Boolean(form.querySelector('[name="consent_response"]'));
    if (hasConsentCheckbox && !data.consent_response) data.consent_response = '';

    const missing = [];
    const generalInquiry = data.form_type === 'options' && ['buyer', 'investor', 'home_value'].includes(data.route_interest);
    if (!generalInquiry && (data.address || '').trim().length < 5) missing.push('address');
    if ((data.name || '').trim().length < 2 || (data.first_name !== undefined && !(data.first_name || '').trim())) missing.push('name');
    if ((data.phone || '').replace(/\D/g, '').length < 10) missing.push('phone');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) missing.push('email');
    if (!data.email && form.querySelector?.('input[name="email"][required]')) missing.push('email');
    if (form.dataset.formType === 'family_transition' && !data.relationship) missing.push('relationship');
    if (hasConsentCheckbox && data.consent_response !== 'yes') missing.push('consent_response');
    if (missing.length) return showErrors(missing);

    submitting = true;
    try {
      const reliable = await submitCommand(data, false, () => track('lead_form_submit', formProps(form)));
      if (!reliable.legacy) {
        if (!reliable.duplicate) { track('lead_form_success', formProps(form)); track('generate_lead', { ...formProps(form), qualification: 'unqualified' }); }
        location.href = spanish ? '/es/thank-you' : '/thank-you'; return;
      }
    } catch (error) { submitting = false; track('lead_form_error', { ...formProps(form), step: 'submit' }); status.textContent = error.message; status.classList.add('error'); return; }

    // Persist only a random reference (not contact data) across uncertain retries/reloads.
    // Keep the same reference even if fields change after a failed attempt: the server
    // rejects conflicting reuse rather than silently overwriting or alerting twice.
    const submissionKey = `hbh_submission:${location.pathname}:${data.form_type || 'standard'}`;
    let submissionStorage;
    try { submissionStorage = window.sessionStorage; } catch {}
    try {
      const savedReference = (submissionStorage ? store.get(submissionKey, submissionStorage) : null) || form.dataset.submissionId;
      if (typeof savedReference === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(savedReference)) data.submission_id = savedReference;
      else if (typeof crypto.randomUUID === 'function') data.submission_id = crypto.randomUUID();
      else {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        const hex = [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
        data.submission_id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
    } catch {
      status.textContent = say('This browser cannot send the form securely. Please use the call or text links instead.', 'Este navegador no puede enviar el formulario de forma segura. Use los enlaces para llamar o enviar un texto.');
      status.classList.add('error');
      submitting = false;
      return;
    }
    form.dataset.submissionId = data.submission_id;
    if (submissionStorage) store.set(submissionKey, data.submission_id, submissionStorage);
    track('lead_form_submit', formProps(form));
    button.disabled = true;
    const label = button.textContent;
    button.textContent = say('Sending…', 'Enviando…');

    let requestTimer;
    try {
      const controller = new AbortController();
      requestTimer = setTimeout(() => controller.abort(), 45000);
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        if (!json.duplicate) {
          track('lead_form_success', formProps(form));
          track('generate_lead', { ...formProps(form), qualification: 'unqualified' });
        }
        if (submissionStorage) store.set('hbh_lead', { id: json.id || null, phone: data.phone, address: data.address, details_token: json.details_token || '' }, submissionStorage);
        try { submissionStorage?.removeItem(submissionKey); } catch {}
        delete form.dataset.submissionId;
        location.href = spanish ? '/es/thank-you' : '/thank-you';
        return;
      }
      if (json.fields) return showErrors(json.fields);
      throw new Error(json.error || 'Request failed');
    } catch (err) {
      track('lead_form_error', { ...formProps(form), step: 'submit' });
      const phone = document.querySelector('.nav-phone');
      // The server's own rate-limit messages are shown as written (the API answers in the visitor's language).
      status.textContent = err?.message && /Too many|already received|Demasiados|ya recibimos/i.test(err.message)
        ? err.message
        : spanish
          ? `Algo salió mal al enviar su solicitud; no se perdió nada de lo que escribió. Por favor, inténtelo de nuevo${phone ? `, o llame o envíe un texto al ${phone.textContent}` : ''}.`
          : `Something went wrong sending your request. Nothing you typed was lost. Please try again${phone ? `, or call or text ${phone.textContent}` : ''}.`;
      status.textContent = status.textContent.trim();
      status.classList.add('error');
    } finally {
      submitting = false;
      clearTimeout(requestTimer);
      button.disabled = false;
      button.textContent = label;
    }
  });

  function showErrors(fields) {
    track('lead_form_error', { ...formProps(form), fields: fields.join(',') });
    // Map combined fields back to the inputs the visitor actually sees.
    const names = fields.flatMap((f) => (f === 'address' && form.querySelector('[name=street]') ? ['street', 'city', 'zip'] : f === 'name' && form.querySelector('[name=first_name]') ? ['first_name', 'last_name'] : [f]));
    if (form.show) {
      const idx = [...form.querySelectorAll('.fstep')].findIndex((s) => names.some((f) => s.querySelector(`[name="${f}"]`)));
      if (idx >= 0) form.show(idx);
    }
    names.forEach((f) => {
      const el = form.querySelector(`[name="${f}"]`);
      el?.classList.add('invalid');
      el?.closest('.check')?.classList.add('invalid');
    });
    form.querySelector('.invalid')?.focus();
    status.textContent =
      names.length === 1 && names[0] === 'consent_response' ? say('Please check the box so we can respond to your request.', 'Marque la casilla para que podamos responder a su solicitud.')
      : fields.includes('relationship') && fields.length === 1 ? say('Please tell us your relationship to the property.', 'Por favor, indíquenos su relación con la propiedad.')
      : say('Please check the highlighted fields and enter valid contact information.', 'Revise los campos resaltados e ingrese información de contacto válida.');
    status.classList.add('error');
  }
});

// ---------- Thank-you page: optional details ----------
const detailsCard = document.querySelector('.details-card');
if (detailsCard) {
  if (commandPhase === 'protocol') window.HBHCommands?.sellerDetailsAvailable().then(allowed => { detailsCard.hidden = !allowed; });
  else if (commandPhase === 'preactivation') {
    const saved = store.get('hbh_lead', sessionStorage);
    detailsCard.hidden = !(saved?.address && saved?.details_token);
  }
}
document.querySelectorAll('form[data-details-form]').forEach((form) => {
  if (commandPhase === 'protocol') window.HBHCommands?.bind(form, true);
  const status = form.querySelector('.form-status');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const savedLead = store.get('hbh_lead', sessionStorage) || {};
    const payload = {
      kind: 'details',
      ...savedLead,
      timeline: fd.get('timeline') || '',
      occupancy: fd.get('occupancy') || '',
      condition_flags: fd.getAll('condition'),
      desired_outcome: fd.get('desired_outcome') || '',
    };
    if (!payload.timeline && !payload.occupancy && !payload.condition_flags.length && !payload.desired_outcome) {
      status.textContent = say('Choose at least one answer, or skip this, it’s optional.', 'Elija al menos una respuesta, o sáltese este paso: es opcional.');
      status.className = 'form-status error';
      return;
    }
    try {
      const reliable = await submitCommand({ timeline:payload.timeline,occupancy:payload.occupancy,condition_flags:payload.condition_flags,desired_outcome:payload.desired_outcome }, true);
      if (!reliable.legacy) {
        if (!reliable.duplicate) track('lead_details_added', { fields: ['timeline', 'occupancy', 'desired_outcome'].filter(k => payload[k]).concat(payload.condition_flags.length ? ['condition'] : []).join(',') });
        status.textContent = say('Added to your request. Thank you.', 'Se agregó a su solicitud. Gracias.'); status.className = 'form-status ok'; button.disabled = true; return; }
    } catch (error) { status.textContent = error.message; status.className = 'form-status error'; return; }
    if (!payload.phone) {
      status.textContent = say('Thanks. Please mention these details when we call.', 'Gracias. Por favor, mencione estos detalles cuando le llamemos.');
      status.className = 'form-status';
      return;
    }
    button.disabled = true;
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      status.textContent = say('Added to your request. Thank you.', 'Se agregó a su solicitud. Gracias.');
      status.className = 'form-status ok';
      button.textContent = say('Added', 'Agregado');
      track('lead_details_added', { fields: ['timeline', 'occupancy', 'desired_outcome'].filter((k) => payload[k]).concat(payload.condition_flags.length ? ['condition'] : []).join(',') });
    } catch {
      button.disabled = false;
      status.textContent = say('That didn’t go through. Please mention these details when we call.', 'No se pudo enviar. Por favor, mencione estos detalles cuando le llamemos.');
      status.className = 'form-status error';
    }
  });
});

// ---------- Service area: Kern County ZIP codes only ----------
// Every Bakersfield ZIP (933xx) plus the rest of Kern County. Neighbors that share the 932/935 ranges
// (Tulare County, Lancaster/Palmdale, Inyo, San Bernardino) are deliberately excluded.
const KERN_ZIP = /^(?:933\d\d|932(?:0[356]|1[56]|2[02456]|3[08]|4[0139]|5[01256]|6[38]|76|8[0357])|935(?:0[1245]|1[689]|2[3478]|31|5[456]|6[01]|81|96))(?:-\d{4})?$/;
const inServiceArea = (zip) => KERN_ZIP.test(String(zip || '').trim());
const outOfAreaText = () => say('Sorry, that ZIP code is outside our service area. We only buy houses in Kern County, California.', 'Lo sentimos, ese código postal está fuera de nuestra zona. Solo compramos casas en el condado de Kern, California.');

// ---------- Address bar: hands the street and ZIP to the page's stepped form ----------
// Postal city for common Kern County ZIPs, so a known ZIP can skip straight to the situation step.
// Unknown ZIPs simply stop on the address step with the city field focused.
const KERN_ZIP_CITY = {
  93301: 'Bakersfield', 93302: 'Bakersfield', 93303: 'Bakersfield', 93304: 'Bakersfield', 93305: 'Bakersfield', 93306: 'Bakersfield',
  93307: 'Bakersfield', 93308: 'Bakersfield', 93309: 'Bakersfield', 93311: 'Bakersfield', 93312: 'Bakersfield', 93313: 'Bakersfield',
  93314: 'Bakersfield', 93561: 'Tehachapi', 93505: 'California City', 93215: 'Delano', 93263: 'Shafter', 93280: 'Wasco',
  93268: 'Taft', 93203: 'Arvin', 93241: 'Lamont', 93250: 'McFarland', 93555: 'Ridgecrest', 93560: 'Rosamond', 93501: 'Mojave',
};
document.querySelectorAll('form[data-hero-address]').forEach((bar) => {
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    const street = bar.querySelector('[name=street]');
    const zip = bar.querySelector('[name=zip]');
    const z = zip.value.trim();
    bar.querySelectorAll('.invalid').forEach((el) => { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); });
    const bad = [street.value.trim().length < 4 && street, z && !/^\d{5}(-\d{4})?$/.test(z) && zip].filter(Boolean);
    if (bad.length) {
      bad.forEach((el) => { el.classList.add('invalid'); el.setAttribute('aria-invalid', 'true'); });
      let note = bar.nextElementSibling?.classList?.contains('addr-msg') ? bar.nextElementSibling : null;
      if (!note) { note = document.createElement('p'); note.className = 'addr-msg'; note.setAttribute('role', 'alert'); bar.after(note); }
      note.textContent = bad[0] === street
        ? say('Enter the street address of the property.', 'Escriba la dirección de la propiedad.')
        : say('Enter a 5-digit ZIP code.', 'Escriba un código postal (ZIP) de 5 dígitos.');
      bad[0].focus();
      return;
    }
    let msg = bar.nextElementSibling?.classList?.contains('addr-msg') ? bar.nextElementSibling : null;
    if (z && !inServiceArea(z)) {
      zip.classList.add('invalid');
      if (!msg) { msg = document.createElement('p'); msg.className = 'addr-msg'; msg.setAttribute('role', 'alert'); bar.after(msg); }
      msg.textContent = outOfAreaText();
      track('cta_click', { cta: 'out_of_area' });
      zip.focus();
      return;
    }
    msg?.remove();
    const card = document.getElementById('lead-form');
    const form = card?.querySelector('form[data-steps]');
    if (!form) {
      // No form on this page: carry the address to the home page's offer flow.
      const q = new URLSearchParams({ street: street.value.trim(), zip: z });
      location.href = `${spanish ? '/es' : ''}/?${q}#get-offer`;
      return;
    }
    const field = (n) => form.querySelector(`[name="${n}"]`);
    if (field('street')) field('street').value = street.value.trim();
    if (field('zip') && z) field('zip').value = z;
    const city = KERN_ZIP_CITY[z.slice(0, 5)];
    if (city && field('city') && !field('city').value.trim()) field('city').value = city;
    const advance = () => {
      const step = form.querySelector('.fstep:not([hidden])');
      const empty = [...step.querySelectorAll('input[required]')].find((i) => !i.value.trim());
      if (empty) empty.focus({ preventScroll: true });
      else step.querySelector('[data-next]')?.click();
    };
    if (document.querySelector('#offer-flow')) {
      bar.classList.add('is-sending');
      setTimeout(() => {
        bar.classList.remove('is-sending');
        openFlow();
        setTimeout(advance, 260);
      }, 160);
    } else {
      card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      advance();
    }
  });
});

// ---------- Guides: reading progress bar ----------
const progress = document.querySelector('.read-progress span');
const article = document.querySelector('.guide .prose');
if (progress && article) {
  const update = () => {
    const r = article.getBoundingClientRect();
    const total = r.height - innerHeight * 0.6;
    progress.style.transform = `scaleX(${Math.min(1, Math.max(0, -r.top / total))})`;
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}

// ---------- Honest reply line: Bakersfield time + posted hours (site.config.mjs → replyHours) ----------
document.querySelectorAll('[data-reply-line]').forEach((el) => {
  const days = el.dataset.days.split(',').map(Number);
  const open = Number(el.dataset.open);
  const close = Number(el.dataset.close);
  const locale = spanish ? 'es-US' : 'en-US';
  const tz = 'America/Los_Angeles';
  const render = () => {
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const hour = Number(parts.hour);
    const time = now.toLocaleTimeString(locale, { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    el.classList.toggle('on', days.includes(day) && hour >= open && hour < close);
    // The reply hours in site.config.mjs are still unconfirmed, so both branches give the same 24-hour
    // promise as the FAQ, Contact, the thank-you page and llms.txt.
    el.textContent = say(`It’s ${time} in Bakersfield. Nathanael typically replies within 24 hours.`, `Son las ${time} en Bakersfield. Nathanael suele responder en un plazo de 24 horas.`);
  };
  render();
  setInterval(render, 60000);
});

// ---------- Inherited house deadlines (runs in the browser; nothing is saved) ----------
document.querySelectorAll('form[data-deadlines]').forEach((form) => {
  const out = document.querySelector('[data-deadline-out]');
  const status = form.querySelector('.form-status');
  const locale = spanish ? 'es-US' : 'en-US';
  const fmt = (d) => d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const val = (n) => form.querySelector(`[name="${n}"]:checked`)?.value || '';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = form.dod.value;
    if (!raw) { form.dod.classList.add('invalid'); status.textContent = say('Please enter the date of death.', 'Por favor, escriba la fecha de fallecimiento.'); status.className = 'form-status error'; form.dod.focus(); return; }
    form.dod.classList.remove('invalid');
    status.textContent = ''; status.className = 'form-status';
    const dod = new Date(`${raw}T00:00:00Z`);
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const items = [];
    const add = (date, en, es) => items.push({ date, text: say(en, es) });
    if (val('primary') === 'yes' && val('movein') !== 'no') {
      const d = new Date(dod); d.setUTCFullYear(d.getUTCFullYear() + 1);
      add(d, 'Last day for an heir to move in as their main home and keep the parent’s property-tax base (Prop 19). The claim form, BOE-19-P, is filed with the Kern County Assessor.',
        'Último día para que un heredero se mude a la casa como su residencia principal y conserve la base del impuesto a la propiedad del padre o la madre (Prop 19). El formulario BOE-19-P se presenta ante el Tasador del condado de Kern.');
    }
    if (val('value') !== 'no' && dod >= new Date('2025-04-01T00:00:00Z')) {
      add(null, 'Because the death was on or after April 1, 2025, a main home worth $750,000 or less may pass through a simpler court petition instead of full probate (Probate Code §13151). Ask a probate attorney.',
        'Como el fallecimiento fue el 1 de abril de 2025 o después, una vivienda principal que valga $750,000 o menos puede transferirse con una petición judicial más sencilla en lugar de una sucesión completa (Código de Sucesiones §13151). Consulte a un abogado.');
    }
    if (val('hecm') !== 'no') {
      add(null, 'Reverse mortgage: after the lender sends a due-and-payable notice, heirs generally have 30 days to respond and about 6 months to sell or pay off, sometimes with extensions. Heirs may be able to sell for 95% of the appraised value even if the loan is larger.',
        'Hipoteca inversa: después de que el prestamista envía el aviso de pago exigible, los herederos suelen tener 30 días para responder y unos 6 meses para vender o pagar, a veces con prórrogas. Es posible vender por el 95% del valor tasado aunque el préstamo sea mayor.');
    }
    for (const [m, d, en, es] of [[11, 10, 'First property-tax installment becomes late after this date.', 'La primera cuota del impuesto a la propiedad se atrasa después de esta fecha.'], [3, 10, 'Second property-tax installment becomes late after this date.', 'La segunda cuota del impuesto a la propiedad se atrasa después de esta fecha.']]) {
      const due = new Date(Date.UTC(today.getUTCFullYear(), m, d));
      if (due < today) due.setUTCFullYear(due.getUTCFullYear() + 1);
      add(due, en, es);
    }
    add(null, 'If the house is empty, check the homeowner’s insurance for a vacancy clause. Many policies limit coverage once a home has been vacant for a while.',
      'Si la casa está vacía, revise si el seguro tiene una cláusula de desocupación. Muchas pólizas limitan la cobertura cuando la casa lleva un tiempo vacía.');
    items.sort((a, b) => (a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity));
    out.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      if (it.date && it.date < today) li.className = 'past';
      const when = document.createElement('strong');
      when.textContent = it.date ? fmt(it.date) : say('Good to know', 'Conviene saber');
      const p = document.createElement('p');
      p.textContent = it.text;
      li.append(when, p);
      out.append(li);
    }
    out.hidden = false;
    const heading = document.querySelector('[data-deadline-h]');
    if (heading) heading.hidden = false;
    (heading || out).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    track('cta_click', { cta: 'deadlines_shown' });
  });
});

// ---------- Language: the switch lives quietly in the footer (Spanish browsers are detected automatically) ----------
{
  const sw = document.querySelector('.site-header .lang-switch');
  const spot = document.querySelector('.footer .footer-links');
  if (sw && spot) spot.append(sw);
}

// ---------- City from ZIP inside the stepped forms ----------
document.querySelectorAll('form[data-steps] [name=zip]').forEach((zip) => {
  zip.addEventListener('input', () => {
    const city = zip.form.querySelector('[name=city]');
    const z = zip.value.trim().slice(0, 5);
    if (city && !city.value.trim() && KERN_ZIP_CITY[z]) city.value = KERN_ZIP_CITY[z];
  });
});

// ---------- Full-screen offer flow (home): the address opens the steps as their own page ----------
const flow = document.querySelector('#offer-flow');
function openFlow(push = true) {
  if (!flow) return false;
  if (flow.hidden) {
    clearTimeout(flow._closing);
    flow.hidden = false;
    document.body.classList.add('flow-open');
    // Next frame: let the browser paint the starting state, then fade/slide in.
    requestAnimationFrame(() => requestAnimationFrame(() => flow.classList.add('is-open')));
    if (push) history.pushState({ flow: 1 }, '', '#get-offer');
    track('cta_click', { cta: 'offer_flow_open' });
  }
  flow.scrollTop = 0;
  return true;
}
function closeFlow(fromHistory = false) {
  if (!flow || flow.hidden) return;
  flow.classList.remove('is-open');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  flow._closing = setTimeout(() => { flow.hidden = true; document.body.classList.remove('flow-open'); }, reduce ? 0 : 350);
  if (!fromHistory && history.state?.flow) history.back();
}
const focusFirstEmpty = () => {
  const step = flow?.querySelector('.fstep:not([hidden])');
  const empty = step && [...step.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox])')].find((i) => !i.value.trim());
  (empty || step?.querySelector('input'))?.focus({ preventScroll: true });
};
if (flow) {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-flow-close]')) { e.preventDefault(); closeFlow(); scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const a = e.target.closest('a[href="#lead-form"], a[href="/#lead-form"]');
    if (a) { e.preventDefault(); openFlow(); focusFirstEmpty(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !flow.hidden) closeFlow(); });
  addEventListener('popstate', () => (history.state?.flow ? openFlow(false) : closeFlow(true)));
  if (location.hash === '#lead-form' || location.hash === '#get-offer') { openFlow(false); focusFirstEmpty(); }
}

// ---------- Header dropdown: close when clicking elsewhere or pressing Escape ----------
document.querySelectorAll('.nav-drop').forEach((drop) => {
  document.addEventListener('click', (e) => { if (!drop.contains(e.target)) drop.open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drop.open = false; });
});

// ---------- Offer flow extras: situation chips, a pre-written text, save & resume ----------
const flowForm = () => document.querySelector('#offer-flow form[data-steps]');
const addressOf = (f) => ['street', 'city', 'zip'].map((n) => f?.querySelector(`[name="${n}"]`)?.value.trim()).filter(Boolean).join(', ');

// One tap on "Inherited", "Tenants"… opens the flow with that answer already chosen.
document.querySelectorAll('[data-situation]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const f = flowForm();
    const radio = f && [...f.querySelectorAll('input[name="situation"]')].find((r) => r.value === chip.dataset.situation);
    if (radio) radio.checked = true;
    track('cta_click', { cta: 'situation_chip', situation_type: chip.dataset.situation });
    if (openFlow()) focusFirstEmpty();
  });
});

// "Text Nathanael" carries the address when we have it.
document.querySelectorAll('[data-flow-sms]').forEach((a) => {
  const base = a.getAttribute('href');
  const refresh = () => {
    const addr = addressOf(flowForm());
    const body = addr ? say(`Hi Nathanael, I'd like options for ${addr}.`, `Hola Nathanael, quisiera opciones para ${addr}.`) : say("Hi Nathanael, I'd like options for my property.", 'Hola Nathanael, quisiera opciones para mi propiedad.');
    a.setAttribute('href', `${base}?&body=${encodeURIComponent(body)}`);
  };
  a.addEventListener('pointerdown', refresh);
  a.addEventListener('focus', refresh);
  refresh();
});

// Save & resume: the address is remembered on this device only, and cleared once a request is sent.
const DRAFT = 'hbh-draft';
const readDraft = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); return d && Date.now() - d.t < 30 * 864e5 ? d : null; } catch { return null; } };
const writeDraft = (d) => { try { d ? localStorage.setItem(DRAFT, JSON.stringify({ ...d, t: Date.now() })) : localStorage.removeItem(DRAFT); } catch {} };
if (document.body?.dataset?.pageType === 'thank_you') writeDraft(null);
document.querySelectorAll('form[data-lead-form], form[data-hero-address]').forEach((f) => {
  f.addEventListener('input', (e) => {
    if (!['street', 'city', 'zip'].includes(e.target.name)) return;
    const d = readDraft() || {};
    d[e.target.name] = e.target.value.trim();
    if (d.street) writeDraft(d);
  });
});
{
  const draft = readDraft();
  const bar = document.querySelector('.home-hero form[data-hero-address]');
  if (draft?.street && bar && flow) {
    const note = document.createElement('p');
    note.className = 'resume';
    const label = document.createElement('span');
    label.textContent = say('Pick up where you left off: ', 'Continúe donde se quedó: ');
    const where = document.createElement('strong');
    where.textContent = [draft.street, draft.city].filter(Boolean).join(', ');
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = say('Continue', 'Continuar');
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'resume-x';
    no.setAttribute('aria-label', say('Dismiss', 'Descartar'));
    no.textContent = '×';
    note.append(label, where, go, no);
    bar.before(note);
    go.addEventListener('click', () => {
      const f = flowForm();
      for (const n of ['street', 'city', 'zip']) { const el = f?.querySelector(`[name="${n}"]`); if (el && draft[n]) el.value = draft[n]; }
      if (!f?.querySelector('[name=city]')?.value && draft.zip && KERN_ZIP_CITY[draft.zip.slice(0, 5)]) f.querySelector('[name=city]').value = KERN_ZIP_CITY[draft.zip.slice(0, 5)];
      track('cta_click', { cta: 'resume_draft' });
      openFlow();
      setTimeout(focusFirstEmpty, 300);
    });
    no.addEventListener('click', () => { writeDraft(null); note.remove(); });
  }
}

// ---------- Page fade for browsers without cross-page view transitions ----------
if (document.documentElement?.classList?.contains('no-vt')) {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || /^\/(api|hq)\b/.test(url.pathname)) return;
    if (url.pathname === location.pathname && url.search === location.search) return; // same page / anchors
    e.preventDefault();
    document.documentElement.classList.add('leaving');
    setTimeout(() => { location.href = url.href; }, 170);
  });
  addEventListener('pageshow', () => document.documentElement.classList.remove('leaving'));
}

// ---------- Arriving from another page's address bar: prefill and open the offer flow ----------
{
  const q = new URLSearchParams(location.search);
  const f = flowForm();
  if (flow && f && q.get('street')) {
    const set = (n, v) => { const el = f.querySelector(`[name="${n}"]`); if (el && v) el.value = v; };
    set('street', q.get('street'));
    set('zip', q.get('zip'));
    const z = (q.get('zip') || '').slice(0, 5);
    if (KERN_ZIP_CITY[z]) set('city', KERN_ZIP_CITY[z]);
    if (q.get('route')) set('route_interest', q.get('route'));
    const sit = q.get('situation') && [...f.querySelectorAll('input[name="situation"]')].find((r) => r.value === q.get('situation'));
    if (sit) sit.checked = true;
    history.replaceState(null, '', `${location.pathname}#get-offer`);
    openFlow(false);
    setTimeout(() => {
      const step = f.querySelector('.fstep:not([hidden])');
      const empty = [...step.querySelectorAll('input[required]')].find((i) => !i.value.trim());
      if (empty) empty.focus({ preventScroll: true }); else step.querySelector('[data-next]')?.click();
    }, 300);
  }
}

// ---------- Phone numbers on a computer: a small menu instead of a dead tel: link ----------
if (typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches) {
  let menu;
  const close = () => { menu?.remove(); menu = null; };
  document.addEventListener('click', (e) => {
    if (menu?.contains(e.target)) { if (e.target.closest('a[href^="tel:"], a[href^="sms:"], a[download]')) setTimeout(close, 0); return; } // menu items act normally
    const tel = e.target.closest('a[href^="tel:"]');
    if (!tel) { if (menu) close(); return; }
    e.preventDefault();
    close();
    const num = tel.getAttribute('href').slice(4);
    const pretty = tel.textContent.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] || num;
    menu = document.createElement('div');
    menu.className = 'tel-menu';
    menu.setAttribute('role', 'menu');
    const item = (label, href, extra = {}) => {
      const a = document.createElement('a');
      a.textContent = label; a.href = href; a.setAttribute('role', 'menuitem');
      Object.entries(extra).forEach(([k, v]) => a.setAttribute(k, v));
      menu.append(a); return a;
    };
    const head = document.createElement('p'); head.textContent = pretty; menu.append(head);
    item(say('Call', 'Llamar'), `tel:${num}`);
    item(say('Text', 'Enviar mensaje'), `sms:${num}`);
    const copy = item(say('Copy number', 'Copiar número'), '#');
    copy.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigator.clipboard?.writeText(pretty).then(() => { copy.textContent = say('Copied', 'Copiado'); setTimeout(close, 900); });
    });
    item(say('Save contact card', 'Guardar tarjeta de contacto'), '/nathanael-harbison.vcf', { download: '' });
    document.body.append(menu);
    const r = tel.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(12, Math.min(r.left + scrollX, scrollX + innerWidth - w - 12))}px`;
    menu.style.top = `${r.bottom + scrollY + 8}px`;
    track('phone_click');
    menu.querySelector('a')?.focus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('scroll', close, { passive: true });
}

// ---------- Home: a slim address bar follows you once the hero is out of view ----------
{
  const stick = document.querySelector('[data-sticky-offer]');
  const hero = document.querySelector('.home-hero');
  if (stick && hero && 'IntersectionObserver' in window) {
    stick.hidden = false;
    new IntersectionObserver(([en]) => stick.classList.toggle('show', !en.isIntersecting), { rootMargin: '-80px 0px 0px 0px' }).observe(hero);
  }
  // Phones: the call bar drops its "Get my cash offer" button while a hero with its own address bar or form is on screen.
  const heroTop = document.querySelector('.home-hero, .hero-sub');
  if (heroTop && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => document.body.classList.toggle('hero-in', en.isIntersecting), { rootMargin: '-80px 0px 0px 0px' }).observe(heroTop);
  }
}

// ================= Seller Tools (all runs in the browser; nothing is saved or sent) =================
const toolMoney = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return String(v ?? '').trim() === '' ? null : (Number.isFinite(n) ? n : NaN); };
const fmtUSD = (n) => (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const aboutUSD = (n) => '$' + (Math.round(Math.abs(n) / 100) * 100).toLocaleString('en-US');

// ---------- Net sheet ----------
document.querySelectorAll('form[data-tool="net-sheet"]').forEach((form) => {
  const out = document.querySelector('[data-net-out]');
  const cents = Number(form.dataset.dttCentsPer500 || 55);
  const v = (n) => toolMoney(form.querySelector(`[name="${n}"]`)?.value);
  const pick = (n) => form.querySelector(`[name="${n}"]:checked`)?.value || '';
  const on = (n) => Boolean(form.querySelector(`[name="${n}"]`)?.checked);
  const dtt = (price) => (price > 100 ? (Math.ceil(price / 500) * cents) / 100 : 0); // Cal. R&T §11911
  const share = (tax, payer) => (payer === 'buyer' ? 0 : payer === 'split' ? tax / 2 : tax);
  let started = false;
  const render = () => {
    form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    const bad = new Set(['priceA', 'priceB', 'escrowA', 'escrowB', 'repairsA', 'otherA', 'otherB', 'feesB', 'payoffs', 'liens', 'monthly', 'monthsA', 'monthsB']
      .filter((n) => Number.isNaN(v(n))));
    bad.forEach((n) => form.querySelector(`[name="${n}"]`)?.classList.add('invalid'));
    const noLoan = on('noloan');
    // A line is unknown (null) when what was typed isn't a number, or when a line the sheet needs is still blank.
    // Optional lines (liens, fees, repairs, other costs) left blank count as none. An unknown line leaves the net unknown.
    const opt = (n) => (bad.has(n) ? null : (v(n) || 0));
    const req = (n) => (bad.has(n) || v(n) == null ? null : v(n));
    const col = (k) => {
      const price = v(`price${k}`);
      if (price == null || Number.isNaN(price)) return null;
      const monthsVal = v(`months${k}`);
      const monthly = opt('monthly');
      const lines = {
        price,
        payoffs: noLoan ? 0 : req('payoffs'),
        liens: opt('liens'),
        commission: k === 'A' ? (pick('commA') ? Math.round(price * Number(pick('commA')) / 100) : null) : 0,
        buyerFees: k === 'B' ? opt('feesB') : 0,
        transferTax: share(dtt(price), pick(`payer${k}`) || 'seller'),
        escrow: k === 'B' && on('buyerPaysB') ? 0 : req(`escrow${k}`),
        repairs: k === 'A' ? opt('repairsA') : 0,
        other: opt(`other${k}`),
        waiting: monthly == null || bad.has(`months${k}`) ? null : monthly ? (monthsVal == null ? null : monthly * monthsVal) : 0,
      };
      const known = Object.values(lines).every((x) => x != null);
      const net = known ? lines.price - Object.entries(lines).filter(([key]) => key !== 'price').reduce((sum, [, x]) => sum + x, 0) : null;
      return { lines, net, months: monthsVal };
    };
    const A = col('A'); const B = col('B');
    for (const [k, c] of [['a', A], ['b', B]]) {
      out.querySelectorAll(`[data-${k}]`).forEach((td) => {
        const key = td.getAttribute(`data-${k}`);
        if (!c) { td.textContent = '—'; return; }
        const val = key === 'net' ? c.net : c.lines[key];
        td.textContent = val == null ? '—' : key === 'price' || key === 'net' ? fmtUSD(val) : (val ? fmtUSD(-val) : '$0');
        if (k === 'b' && ['commission', 'repairs'].includes(key)) td.textContent = '—';
        if (k === 'a' && key === 'buyerFees') td.textContent = '—';
      });
    }
    const verdict = out.querySelector('.verdict');
    let text = '';
    const short = [A, B].find((c) => c && c.net != null && c.net < 0);
    if (short) text = say(`On these numbers, the sale wouldn’t cover what’s owed: about ${fmtUSD(-short.net)} short. Before you sign anything, talk to your lender and a free HUD-approved housing counselor.`, `Con estos números, la venta no alcanzaría para cubrir lo que se debe; faltarían unos ${fmtUSD(-short.net)}. Antes de firmar nada, hable con su prestamista y con un consejero de vivienda aprobado por HUD (es gratis).`);
    else if (A && B && (A.net == null || B.net == null)) text = bad.size ? say('Correct the boxes marked in red to compare the two.', 'Corrija las casillas marcadas en rojo para comparar las dos.') : say('Fill in the missing lines to compare the two.', 'Complete las líneas que faltan para comparar las dos.');
    else if (A && B) {
      const diff = A.net - B.net;
      if (Math.abs(diff) < 1000) text = say('On your numbers, the two come out about the same. Then it comes down to time, hassle and certainty.', 'Con sus números, las dos opciones quedan más o menos igual. Entonces todo depende del tiempo, la molestia y la seguridad.');
      else if (diff > 0) text = say(`On your numbers, listing leaves you about ${aboutUSD(diff)} more${A.months ? `, after the ${A.months} months of waiting costs you entered` : ''}. If you can wait and handle the work, that’s real money. Nathanael can list it, too.`, `Con sus números, ponerla en venta le deja unos ${aboutUSD(diff)} más${A.months ? `, después de los ${A.months} meses de gastos de espera que usted escribió` : ''}. Si puede esperar y encargarse del trabajo, es dinero real. Nathanael también puede ponerla en venta.`);
      else text = say(`On your numbers, the cash offer leaves you about ${aboutUSD(-diff)} more. That can happen when repairs, waiting costs or commission are high. Check those lines with real bids before you decide.`, `Con sus números, la oferta en efectivo le deja unos ${aboutUSD(-diff)} más. Eso puede pasar cuando las reparaciones, los gastos de espera o la comisión son altos. Confirme esas líneas con cotizaciones reales antes de decidir.`);
    }
    verdict.textContent = text;
    // California withholding heads-up (not subtracted): 3⅓% unless an exemption applies (Cal. R&T §18662)
    const hold = out.querySelector('.ns-hold');
    const top = Math.max(A?.lines.price || 0, B?.lines.price || 0);
    const holdAmt = top > 100000 && pick('mainhome') !== 'yes' ? Math.round(top / 30) : 0;
    hold.hidden = !holdAmt;
    if (holdAmt) hold.textContent = say(`Heads-up: escrow may hold back up to ${fmtUSD(holdAmt)} (3⅓% of the price) for California income tax unless an exemption applies, such as a price of $100,000 or less, a main home, or a sale at a loss. It isn’t a fee; it’s credited toward your state tax. Ask a tax preparer.`, `Aviso: el escrow podría retener hasta ${fmtUSD(holdAmt)} (3⅓% del precio) para el impuesto estatal de California, a menos que aplique una excepción, como un precio de $100,000 o menos, una vivienda principal o una venta con pérdida. No es un cargo; se acredita a su impuesto estatal. Pregunte a su preparador de impuestos.`);
    // Still missing
    const miss = [];
    if (A && !pick('commA')) miss.push(say('Commission (List it)', 'Comisión (en venta)'));
    if ((A || B) && v('payoffs') == null && !noLoan) miss.push(say('Loan payoffs, or tick “There’s no loan on it”', 'Saldo de préstamos, o marque “No tiene préstamo”'));
    if (A && v('escrowA') == null) miss.push(say('Escrow and title (List it)', 'Escrow y título (en venta)'));
    if (B && v('escrowB') == null && !on('buyerPaysB')) miss.push(say('Escrow and title (Cash offer)', 'Escrow y título (oferta en efectivo)'));
    if (v('monthly') && ((A && v('monthsA') == null) || (B && v('monthsB') == null))) miss.push(say('Months until closing', 'Meses hasta el cierre'));
    // Shown above the table: what can't be read, then what the sheet still needs
    const notes = [];
    if (bad.size) notes.push(['ns-bad', say('Use numbers only in the boxes marked in red, like 6500.', 'Use solo números en las casillas marcadas en rojo, por ejemplo 6500.')]);
    if (miss.length) notes.push(['ns-missing-h', say('Still missing', 'Falta completar')], ...miss.map((m) => ['', m]));
    const ul = out.querySelector('.ns-missing');
    ul.hidden = !notes.length;
    ul.replaceChildren(...notes.map(([cls, t]) => { const li = document.createElement('li'); if (cls) li.className = cls; li.textContent = t; return li; }));
    if (A && B && !started) { started = true; track('cta_click', { cta: 'net_sheet_result' }); }
  };
  form.addEventListener('input', () => requestAnimationFrame(render));
  form.addEventListener('change', () => requestAnimationFrame(render));
  form.addEventListener('submit', (e) => e.preventDefault());
  render();
});

// ---------- Which path fits me? ----------
document.querySelectorAll('form[data-tool="which-path"]').forEach((form) => {
  const out = document.querySelector('[data-quiz-out]');
  const PATHS = ['wait', 'listing', 'renovate', 'direct']; // also the tie-break order: most honest first
  const W = {
    q1: { ready: [0, 3, 0, 0], light: [0, 2, 2, 1], major: [0, 0, 1, 3], unsure: [0, 1, 1, 1] },
    q2: { time: [0, 2, 2, 0], soon: [0, 1, 0, 2], deadline: [0, 0, -2, 3], undecided: [3, 0, 0, 0] },
    q3: { yes: [0, 1, 2, 0], some: [0, 1, 0, 1], no: [0, 0, -3, 2] },
    q4: { tenant: [0, 0, 0, 1], behind: [2, 0, 0, 1], inherited: [0, 0, 0, 0], people: [2, 0, 0, 0], reverse: [1, 0, 0, 0], none: [0, 0, 0, 0] },
    q5: { price: [0, 2, 2, 0], certainty: [0, 0, 0, 2], speed: [0, 0, 0, 2], keep: [4, 0, 0, 0] },
  };
  const supports = { 'q1-ready': 'listing', 'q1-light': 'renovate', 'q1-major': 'direct', 'q2-time': 'listing', 'q2-soon': 'direct', 'q2-deadline': 'direct', 'q2-undecided': 'wait', 'q3-yes': 'renovate', 'q3-no': 'direct', 'q4-tenant': 'direct', 'q5-price': 'listing', 'q5-certainty': 'direct', 'q5-speed': 'direct', 'q5-keep': 'wait' };
  const answers = () => ({ q1: form.q1?.value, q2: form.q2?.value, q3: form.q3?.value, q4: [...form.querySelectorAll('[name=q4]:checked')].map((c) => c.value), q5: form.q5?.value });
  const score = (a) => {
    const s = [0, 0, 0, 0];
    const add = (w) => w && w.forEach((x, i) => (s[i] += x));
    add(W.q1[a.q1]); add(W.q2[a.q2]); add(W.q3[a.q3]); (a.q4 || []).forEach((k) => add(W.q4[k])); add(W.q5[a.q5]);
    if (a.q5 === 'keep' && a.q4?.includes('inherited')) s[0] += 2;
    const order = PATHS.map((p, i) => ({ p, v: s[i] })).sort((x, y) => y.v - x.v || PATHS.indexOf(x.p) - PATHS.indexOf(y.p));
    return a.q5 === 'keep' ? 'wait' : order[0].p;
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'q4') {
      const none = form.querySelector('[name=q4][value=none]');
      if (e.target.value === 'none' && e.target.checked) form.querySelectorAll('[name=q4]').forEach((c) => { if (c !== none) c.checked = false; });
      else if (e.target.checked && none) none.checked = false;
    }
    // An answered question loses its red mark; the message goes once none is left
    e.target.closest('.choice-grid')?.classList.remove('invalid');
    const status = form.querySelector('.form-status');
    if (status.classList.contains('error') && !form.querySelector('.choice-grid.invalid')) { status.textContent = ''; status.className = 'form-status'; }
    if (!out.hidden) show(false);
  });
  const show = (scroll = true) => {
    const a = answers();
    const status = form.querySelector('.form-status');
    // The questions carry no numbers, so mark the unanswered ones instead of naming them
    const open = ['q1', 'q2', 'q3', 'q5'].filter((q) => !a[q]);
    form.querySelectorAll('.choice-grid.invalid').forEach((g) => g.classList.remove('invalid'));
    if (open.length) {
      open.forEach((q) => form.querySelector(`[name="${q}"]`)?.closest('.choice-grid')?.classList.add('invalid'));
      status.textContent = say('Please answer the questions marked in red.', 'Por favor, conteste las preguntas marcadas en rojo.');
      status.className = 'form-status error';
      if (scroll) form.querySelector(`[name="${open[0]}"]`)?.focus();
      return;
    }
    status.textContent = ''; status.className = 'form-status';
    const winner = score(a);
    out.hidden = false;
    out.querySelectorAll('[data-result]').forEach((d) => (d.hidden = d.dataset.result !== winner));
    const given = new Set([`q1-${a.q1}`, `q2-${a.q2}`, `q3-${a.q3}`, `q5-${a.q5}`, ...a.q4.map((k) => `q4-${k}`)]);
    let shown = 0;
    out.querySelectorAll('[data-reason]').forEach((li) => { li.hidden = !(given.has(li.dataset.reason) && supports[li.dataset.reason] === winner); if (!li.hidden) shown++; });
    if (!shown) out.querySelectorAll('[data-reason]').forEach((li) => (li.hidden = !given.has(li.dataset.reason)));
    const triggers = new Set(a.q4);
    let notes = 0;
    out.querySelectorAll('[data-when]').forEach((li) => { li.hidden = !(triggers.has(li.dataset.when) && (li.dataset.when !== 'inherited' || a.q5 === 'keep')); if (!li.hidden) notes++; });
    const nh = out.querySelector('[data-notes-h]'); if (nh) nh.hidden = !notes;
    track('cta_click', { cta: 'which_path_result', route_interest: winner });
    if (scroll) out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); show(); });
});

// ---------- Paperwork checklist ----------
document.querySelectorAll('form[data-tool="paperwork"]').forEach((form) => {
  const out = document.querySelector('[data-paper-out]');
  const alias = { unsure: ['spouse', 'coowners'], loanunsure: ['mortgage'] };
  const render = () => {
    const picked = [...form.querySelectorAll('input:checked')].map((i) => i.value);
    const set = new Set(['always', ...picked.flatMap((p) => [p, ...(alias[p] || [])])]);
    out.querySelectorAll('[data-when]').forEach((li) => (li.hidden = !li.dataset.when.split(' ').some((w) => set.has(w))));
    out.querySelectorAll('.pw-group').forEach((g) => (g.hidden = !g.querySelector('[data-when]:not([hidden])')));
    const items = [...out.querySelectorAll('[data-when]:not([hidden]) input[type=checkbox]')];
    const done = items.filter((i) => i.checked).length;
    out.querySelector('.pw-count').textContent = say(`${done} of ${items.length} ready`, `${done} de ${items.length} listos`);
  };
  form.addEventListener('change', render);
  out.addEventListener('change', render);
  out.querySelector('[data-print]')?.addEventListener('click', () => print());
  render();
});

// ---------- Stepped forms: the address step stops on a ZIP outside Kern County ----------
document.querySelectorAll('form[data-steps]').forEach((form) => {
  const guard = (e) => {
    const step = form.querySelector('.fstep:not([hidden])');
    const zip = step?.querySelector('[name=zip]');
    if (!zip) return;
    const z = zip.value.trim();
    if (!/^\d{5}(-\d{4})?$/.test(z) || inServiceArea(z)) return; // format errors are handled by the form itself
    e.preventDefault();
    e.stopImmediatePropagation();
    zip.classList.add('invalid');
    const status = form.querySelector('.form-status');
    if (status) { status.textContent = outOfAreaText(); status.className = 'form-status error'; }
    track('cta_click', { cta: 'out_of_area' });
    zip.focus();
  };
  form.addEventListener('click', (e) => { if (e.target.closest('[data-next]')) guard(e); }, true);
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') guard(e); }, true);
  form.addEventListener('submit', guard, true);
});

// ---------- Nathanael hand-off tools: a pre-written text or email, or the offer flow ----------
document.querySelectorAll('form[data-tool="handoff"]').forEach((form) => {
  const status = form.querySelector('.form-status');
  const fail = (el, msg) => { el?.classList.add('invalid'); el?.focus(); status.textContent = msg; status.className = 'form-status error'; };
  const read = () => {
    form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    status.textContent = ''; status.className = 'form-status';
    const street = form.querySelector('[name=street]');
    const zip = form.querySelector('[name=zip]');
    if (street.value.trim().length < 4) return fail(street, say('Please enter the street address.', 'Por favor, escriba la dirección.'));
    if (!/^\d{5}(-\d{4})?$/.test(zip.value.trim())) return fail(zip, say('Please enter a 5-digit ZIP code.', 'Por favor, escriba un código postal de 5 dígitos.'));
    if (!inServiceArea(zip.value)) { track('cta_click', { cta: 'out_of_area' }); return fail(zip, outOfAreaText()); }
    return { street: street.value.trim(), zip: zip.value.trim() };
  };
  const toFlow = (d) => {
    const q = new URLSearchParams({ street: d.street, zip: d.zip, route: form.dataset.route, situation: form.dataset.situation });
    location.href = `${spanish ? '/es' : ''}/?${q}#get-offer`;
  };
  const opening = {
    'both-numbers': ['Hi Nathanael, I’d like both numbers, a cash offer and a listing estimate, for', 'Hola Nathanael, quisiera ambas cifras, una oferta en efectivo y un cálculo para vender en el mercado, para'],
    'repair-check': ['Hi Nathanael, could you give me a repair reality check for', 'Hola Nathanael, ¿me puede ayudar con una revisión de reparaciones para'],
    'listing-relaunch': ['Hi Nathanael, my listing didn’t sell. Could you review what happened at', 'Hola Nathanael, mi casa no se vendió. ¿Puede revisar qué pasó en'],
    'owner-check-in': ['Hi Nathanael, I live out of the area. Could you check on my property at', 'Hola Nathanael, vivo fuera del área. ¿Podría revisar mi propiedad en'],
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = read();
    if (!d) return;
    const how = e.submitter?.value || 'sms';
    track('cta_click', { cta: `handoff_${how}`, route_interest: form.dataset.route });
    if (how === 'flow') return toFlow(d);
    const [en, es] = opening[form.dataset.kind] || ['Hi Nathanael, about my property at', 'Hola Nathanael, sobre mi propiedad en'];
    const topics = [...form.querySelectorAll('[name=topic]:checked')].map((i) => i.closest('label')?.querySelector('span')?.textContent.trim()).filter(Boolean);
    let body = `${say(en, es)} ${d.street}, ${d.zip}${spanish && form.dataset.kind !== 'both-numbers' ? '?' : '.'}`;
    if (topics.length) body += ` ${say('Details:', 'Detalles:')} ${topics.join(', ')}.`;
    if (form.dataset.kind === 'repair-check') body += ` ${say('I’ll send photos next.', 'Enseguida le mando fotos.')}`;
    if (how === 'email') {
      const subject = document.querySelector('h1')?.textContent.trim() || 'Call Harbison';
      location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    } else {
      location.href = `sms:${form.dataset.phone}?&body=${encodeURIComponent(body)}`;
    }
  });
  form.querySelector('[data-flow-link]')?.addEventListener('click', (e) => {
    const street = form.querySelector('[name=street]').value.trim();
    if (!street) return; // no details yet: the link simply opens the offer flow
    e.preventDefault();
    const d = read();
    if (d) toFlow(d);
  });
});
