// Harbison HQ — dashboard + shared CRM. Talks only to /api/hq (session cookie, same origin).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STAGES = {
  new: 'New', contact_attempted: 'Contact attempted', connected: 'Connected', qualified: 'Qualified',
  appointment_set: 'Appointment set', property_reviewed: 'Property reviewed', options_presented: 'Options presented',
  nurture: 'Nurture', under_contract: 'Under contract', closed_won: 'Closed won', closed_lost: 'Closed lost',
  not_a_fit: 'Not a fit', spam: 'Spam',
};
const ROUTES = { direct: 'Sell direct', listing: 'List', renovate: 'Renovate then sell', development: 'Development', not_ready: 'Not ready yet', buyer: 'Home purchase inquiry', investor: 'Investment property inquiry', home_value: 'Home value inquiry' };
const BRANDS = { harbison_standard: 'Harbison Standard', call_harbison: 'Call Harbison' };
const CHANNELS = { google_ads: 'Google Ads', ai_search: 'AI search', youtube: 'YouTube', phone_call: 'Phone call', other_referral: 'Other referral', gbp: 'Google Business Profile' };
const channelName = (c) => (c ? CHANNELS[c] || String(c).charAt(0).toUpperCase() + String(c).slice(1).replace(/_/g, ' ') : '—');
const brandOf = (l) => (l.form_type === 'harbison_standard' ? 'harbison_standard' : 'call_harbison');
// Stages are soft pills: new in blue (not called yet), the working stages neutral, the stages near a sale in gold,
// closed won in green, the closed and dead ones grey.
const stageTone = (s) => (s === 'new' ? 'info' : s === 'closed_won' ? 'good'
  : ['appointment_set', 'property_reviewed', 'options_presented', 'under_contract'].includes(s) ? 'gold'
    : ['closed_lost', 'not_a_fit', 'spam'].includes(s) ? 'muted' : '');
const stageTag = (s) => `<span class="pill ${stageTone(s)}">${esc(STAGES[s] || s)}</span>`;
// Line icons, 24px grid, drawn at 18px with a 1.5 stroke (the same set as the sidebar).
const ICONS = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  phone: '<path d="M20 16.2v2.6a1.7 1.7 0 0 1-1.9 1.7 16.8 16.8 0 0 1-7.3-2.6 16.5 16.5 0 0 1-5.1-5.1 16.8 16.8 0 0 1-2.6-7.4A1.7 1.7 0 0 1 4.8 3.5h2.6a1.7 1.7 0 0 1 1.7 1.5c.1.8.3 1.6.6 2.4a1.7 1.7 0 0 1-.4 1.8l-1.1 1.1a13.6 13.6 0 0 0 5.1 5.1l1.1-1.1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.4.6a1.7 1.7 0 0 1 1.4 1.7z"/>',
  userPlus: '<path d="M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20"/><circle cx="9" cy="8" r="3.5"/><path d="M19 8v6M22 11h-6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>',
  users: '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35"/><path d="M15.5 4.65a3.5 3.5 0 0 1 0 6.7"/>',
  file: '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h6"/>',
  up: '<path d="m4 16 6-6 4 4 6-6"/><path d="M15 8h5v5"/>',
  down: '<path d="m4 8 6 6 4-4 6 6"/><path d="M15 16h5v-5"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
// A KPI card: label and icon, one figure, then the change against the period before (or a line of context).
const kpiCard = ({ icon: ic, tone = '', label, value, foot = '', go = '' }) => `<div class="card kpi"${go ? ` data-go="${go}" role="button" tabindex="0"` : ''}><div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-ic${tone ? ` ${tone}` : ''}">${icon(ic)}</span></div><div class="kpi-value">${esc(value)}</div><div class="kpi-foot">${foot}</div></div>`;
// The change against the period before: an arrow, the signed figure, and what it compares with. Up is good here.
const changeChip = (cur, prev, { percent = true, against = '' } = {}) => {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (prev == null) return '';
  let text = 'No change';
  let dir = 0;
  if (!percent || p === 0) {
    const d = c - p;
    dir = Math.sign(d);
    if (d) text = `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
  } else {
    const r = ((c - p) / p) * 100;
    const shown = Math.abs(r) >= 10 ? String(Math.round(Math.abs(r))) : Math.abs(r).toFixed(1);
    if (shown !== '0' && shown !== '0.0') { dir = Math.sign(r); text = `${dir > 0 ? '+' : '−'}${shown}%`; }
  }
  return `<span class="chg ${dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'}">${dir ? icon(dir > 0 ? 'up' : 'down') : ''}${text}</span>${against ? `<span>${esc(against)}</span>` : ''}`;
};
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase() || '?';
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const capFirst = (s) => { const t = String(s ?? ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const pctText = (ratio) => {
  const p = (Number(ratio) || 0) * 100;
  if (p >= 9.95) return `${Math.round(p)}%`;
  if (p >= 0.05) return `${p.toFixed(1)}%`;
  return p > 0 ? '<0.1%' : '0%';
};
// A duration in minutes, in the clock's own units ("4 h 48 min", "2 days 3 h").
const minutesText = (value) => clockParts(Math.max(0, Math.round(Number(value) || 0))).map(([n, u]) => `${n} ${u}`).join(' ');
// ---------- The waiting clock ----------
// How long a lead has waited for a first call (or a follow-up has been due), set the same way wherever a lead
// appears: figures in ink, units small. Past an hour it turns amber; past the 24 hours the site promises, red.
const CLOCK_SLOW = 60;
const CLOCK_LATE = 1440;
const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)) || 0;
const clockParts = (m) => {
  if (m < 60) return [[m, 'min']];
  if (m < 1440) return [[Math.floor(m / 60), 'h'], ...(m % 60 ? [[m % 60, 'min']] : [])];
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return [[d, d === 1 ? 'day' : 'days'], ...(h ? [[h, 'h']] : [])];
};
const clockInner = (m) => clockParts(m).map(([n, u]) => `<b>${n}</b><i>${u}</i>`).join('');
const clockTone = (m) => (m >= CLOCK_LATE ? ' late' : m >= CLOCK_SLOW ? ' slow' : '');
const clockHtml = (iso) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const m = minutesSince(iso);
  return `<span class="clock${clockTone(m)}" data-since="${esc(iso)}">${clockInner(m)}</span>`;
};
// Plain text of the same duration, for "received 5 h ago" lines and accessible names.
const agoText = (iso) => `${clockParts(minutesSince(iso)).map(([n, u]) => `${n} ${u}`).join(' ')} ago`;
function tickClocks() {
  document.querySelectorAll('.clock[data-since]').forEach((el) => {
    const m = minutesSince(el.dataset.since);
    el.className = `clock${clockTone(m)}`;
    el.innerHTML = clockInner(m);
  });
  document.querySelectorAll('[data-wait-since]').forEach((el) => {
    const [tone, word] = waitWord(minutesSince(el.dataset.waitSince));
    el.className = `pill ${tone}`;
    el.textContent = word;
  });
}
setInterval(tickClocks, 30000);
// The town from "202 Demo St, Tehachapi, CA 93561".
const townOf = (address) => {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) return parts[1].replace(/\b[A-Z]{2}\b\s*\d{5}(-\d{4})?$/, '').trim() || parts[1];
  return '';
};
const when = (iso, withTime = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', withTime ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
};
// Calendar days from the API ('YYYY-MM-DD') are dates, not instants: format them in UTC so they never shift a day.
const dayDate = (day) => new Date(`${String(day).slice(0, 10)}T12:00:00Z`);
const dayShort = (day) => dayDate(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayLong = (day) => dayDate(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const ago = (iso) => agoText(iso);
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const digits = (p) => String(p || '').replace(/[^\d+]/g, '');
const leadSubline = (l) => l.address || [BRANDS[brandOf(l)], l.situation || l.email].filter(Boolean).join(', ') || 'General inquiry';

async function api(action, { method = 'GET', params = {}, body } = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/hq?${qs}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-HQ': '1' } : { 'X-HQ': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'Unexpected response' }));
  if (res.status === 401 && action !== 'login') { showLogin(); throw new Error(json.error || 'Signed out'); }
  if (!res.ok || !json.ok) throw Object.assign(new Error(json.error || 'Request failed'), { status: res.status });
  return json;
}

// ---------- URL routing ----------
function tabFromLocation() {
  const p = location.pathname;
  if (p.endsWith('/call-harbison')) return 'analytics-call';
  if (p.endsWith('/harbison-standard')) return 'analytics-standard';
  if (p.endsWith('/operations')) return 'operations';
  if (p.endsWith('/leads')) return 'leads';
  if (p.endsWith('/partners')) return 'partners';
  const t = new URLSearchParams(location.search).get('tab');
  return ['operations', 'dash', 'leads', 'partners', 'analytics-standard', 'analytics-call'].includes(t) ? t : 'dash';
}

function syncUrl({ tab, leadId, replace = false } = {}) {
  const activeTab = tab || document.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab || 'dash';
  let path = activeTab === 'operations' ? '/hq/operations' : '/hq';
  if (activeTab === 'analytics-call') path = '/hq/stats/call-harbison';
  else if (activeTab === 'analytics-standard') path = '/hq/stats/harbison-standard';
  else if (activeTab === 'leads') path = '/hq/leads';
  else if (activeTab === 'partners') path = '/hq/partners';

  const sp = new URLSearchParams();
  if (activeTab === 'leads') {
    if (list.view && list.view !== 'open') sp.set('view', list.view);
    if (list.brand) sp.set('brand', list.brand);
    if (list.status) sp.set('status', list.status);
    if (list.q) sp.set('q', list.q);
  }
  const openId = leadId !== undefined ? leadId : current?.id;
  if (openId) sp.set('lead', openId);
  const next = `${path}${sp.toString() ? `?${sp}` : ''}`;
  if (`${location.pathname}${location.search}` !== next) {
    history[replace ? 'replaceState' : 'pushState']({}, '', next);
  }
}

// ---------- auth ----------
function showLogin(msg = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-err').textContent = msg;
  $('#login-password').value = '';
  ($('#login-name').value ? $('#login-password') : $('#login-name')).focus();
}
let operationsEnabled = false;
// The server says which stats sources can work ({ call_harbison, harbison_standard }). An older server sends
// nothing, and then both tabs stay as they were. With only Call Harbison configured the tab is "Website stats".
function applyAnalyticsTabs(sources) {
  const known = Boolean(sources) && typeof sources === 'object';
  const hasStandard = !known || Boolean(sources.harbison_standard);
  const hasCall = !known || Boolean(sources.call_harbison);
  $('#tab-analytics').hidden = !hasStandard;
  $('#tab-analytics-call').hidden = !hasCall;
  // One site is simply "Website"; two are named by brand. The label sits beside the tab's icon.
  $('#tab-analytics-call .label').textContent = hasCall && !hasStandard ? 'Website' : 'Call Harbison site';
  $('#tab-analytics .label').textContent = hasStandard && !hasCall ? 'Website' : 'Harbison Standard site';
}

// ---------- menu (tablets and phones) ----------
// Below 1024px the sidebar becomes a menu that opens over the page, with a scrim behind it.
function setMenu(open) {
  $('#top').classList.toggle('menu-open', open);
  $('#side-scrim').hidden = !open;
  $('#hq-menu').setAttribute('aria-expanded', String(open));
}
$('#hq-menu').addEventListener('click', () => setMenu($('#hq-menu').getAttribute('aria-expanded') !== 'true'));
$('#side-scrim').addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#hq-menu').getAttribute('aria-expanded') === 'true') { setMenu(false); $('#hq-menu').focus(); }
});
function showApp(name, enabled = false, analyticsSources) {
  operationsEnabled = enabled;
  applyAnalyticsTabs(analyticsSources);
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = name;
  $('#who-initial').textContent = initials(name);
  $('#dash-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  try { localStorage.setItem('hq_name', name); } catch {}
  const sp = new URLSearchParams(location.search);
  if (sp.get('view')) list.view = sp.get('view');
  if (sp.get('brand')) { list.brand = sp.get('brand'); $('#brand').value = list.brand; }
  if (sp.get('status')) { list.status = sp.get('status'); $('#stage-filter').value = list.status; }
  if (sp.get('q')) { list.q = sp.get('q'); $('#q').value = list.q; }
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === list.view)));
  openTab(tabFromLocation(), false);
  const deepLead = sp.get('lead');
  if (deepLead) openLead(deepLead, false);
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('#login-err').textContent = '';
  try {
    const r = await api('login', { method: 'POST', body: { name: $('#login-name').value, password: $('#login-password').value } });
    showApp(r.name, r.sellerOperationsEnabled, r.analytics);
  } catch (err) {
    $('#login-err').textContent = err.message;
    $('#login-password').select();
  } finally {
    btn.disabled = false;
  }
});
$('#logout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  window.clearSellerOperations?.();
  showLogin('Signed out.');
});

// ---------- tabs ----------
function openTab(name, navigate = true) {
  const tabButton = document.querySelector(`[data-tab="${name}"]`);
  if (!tabButton || tabButton.hidden) {
    // A stats tab the server cannot serve (or an unknown tab) falls back to the dashboard.
    name = 'dash';
    if (!navigate) syncUrl({ tab: name, replace: true });
  }
  const analytics = name.startsWith('analytics-');
  setMenu(false);
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  // The top bar names the section the sidebar has selected.
  $('#page-title').textContent = document.querySelector(`[data-tab="${name}"] .label`)?.textContent || 'Overview';
  $('#dash-date').hidden = name !== 'dash';
  $('#operations').hidden = name !== 'operations';
  if (name === 'operations') window.loadSellerOperations?.();
  $('#dash').hidden = name !== 'dash';
  $('#leads').hidden = name !== 'leads';
  $('#partners').hidden = name !== 'partners';
  $('#analytics').hidden = !analytics;
  if (navigate) syncUrl({ tab: name });
  if (name === 'dash') loadDash();
  if (name === 'leads') loadLeads(true);
  if (name === 'partners') loadPartners();
  if (analytics) {
    $('#analytics').dataset.site = name === 'analytics-call' ? 'call_harbison' : 'harbison_standard';
    $('#analytics').setAttribute('aria-labelledby', name === 'analytics-call' ? 'tab-analytics-call' : 'tab-analytics');
    loadAnalytics();
  }
}
window.addEventListener('popstate', () => {
  const sp = new URLSearchParams(location.search);
  const leadParam = sp.get('lead');
  if (!leadParam && !$('#drawer').hidden) closeDrawer(false);
  else if (leadParam && current?.id !== leadParam) openLead(leadParam, false);
  openTab(tabFromLocation(), false);
});
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

// ---------- charts: plain SVG. One blue for data, gold only for leads. ----------
// drawChart(host, { kind: 'line' | 'columns', points, value, height, label, xTicks, xLabel, labelIdx, labelText,
//   markClass, strip: { name, value }, tip(point, i) -> { title, rows: [{ value, label, key }] }, table: { head, rows } })
const SVG_NS = 'http://www.w3.org/2000/svg';
const chartRegistry = new Map();
const svgEl = (tag, attrs = {}, parent = null) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (parent) parent.appendChild(el);
  return el;
};
function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw));
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return ticks;
}
function tableView(t) {
  const details = document.createElement('details');
  details.className = 'table-view';
  const summary = document.createElement('summary');
  summary.textContent = 'Show as a table';
  details.addEventListener('toggle', () => { summary.textContent = details.open ? 'Hide the table' : 'Show as a table'; });
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  if (t.caption) { const c = table.createCaption(); c.className = 'sr-only'; c.textContent = t.caption; }
  const head = table.createTHead().insertRow();
  t.head.forEach((h) => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.appendChild(th); });
  const body = table.createTBody();
  t.rows.forEach((r) => { const tr = body.insertRow(); r.forEach((cell) => { tr.insertCell().textContent = cell; }); });
  wrap.appendChild(table);
  details.append(summary, wrap);
  return details;
}
function drawChart(host, cfg) {
  if (!host) return;
  host.textContent = '';
  const plot = document.createElement('div');
  plot.className = 'chart-plot';
  host.appendChild(plot);
  if (cfg.table && cfg.points.length) host.appendChild(tableView(cfg.table));
  chartRegistry.set(host, cfg);
  renderChart(host, cfg);
}
function renderChart(host, cfg) {
  const plot = host.querySelector('.chart-plot');
  if (!plot) return;
  plot.textContent = '';
  const n = cfg.points.length;
  if (!n) { plot.innerHTML = `<p class="empty">${esc(cfg.empty || 'Nothing to show yet.')}</p>`; return; }
  const W = Math.max(260, Math.floor(host.clientWidth || 640));
  cfg.renderedWidth = W;
  const columns = cfg.kind === 'columns';
  const values = cfg.points.map((p) => Math.max(0, Number(cfg.value(p)) || 0));
  const ticks = niceTicks(Math.max(...values), W < 480 ? 3 : 4);
  const top = ticks[ticks.length - 1];
  const tickText = (v) => (top >= 10000 ? `${fmt(v / 1000)}K` : fmt(v));
  const strip = cfg.strip || null;
  const left = Math.max(...ticks.map((t) => tickText(t).length), strip ? strip.name.length + 1 : 0) * 7 + 12;
  const right = 8;
  const padTop = 24;
  const H = W < 480 ? Math.round(cfg.height * 0.72) : cfg.height;
  const stripGap = strip ? 20 : 0;
  const stripH = strip ? 32 : 0;
  const axisH = 28;
  const plotW = W - left - right;
  const base = padTop + H;
  const total = base + stripGap + stripH + axisH;
  const y = (v) => base - (v / top) * H;
  const band = plotW / n;
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const x = (i) => (columns ? left + band * (i + 0.5) : n === 1 ? left + plotW / 2 : left + step * i);
  const crisp = (v) => Math.round(v) + 0.5;

  const svg = svgEl('svg', { width: W, height: total, viewBox: `0 0 ${W} ${total}`, 'aria-hidden': 'true', focusable: 'false' });
  const hl = svgEl('rect', { class: 'band-hl', x: 0, y: padTop - 8, width: Math.max(0, band), height: H + 8, visibility: 'hidden' }, svg);
  for (const t of ticks) {
    svgEl('line', { class: t === 0 ? 'grid base' : 'grid', x1: left, x2: W - right, y1: crisp(y(t)), y2: crisp(y(t)) }, svg);
    svgEl('text', { x: left - 8, y: Math.round(y(t)) + 4, 'text-anchor': 'end' }, svg).textContent = tickText(t);
  }
  const column = (cx, w, h, bottom, cls) => {
    const x0 = cx - w / 2;
    const x1 = x0 + w;
    const y0 = bottom - h;
    const r = Math.min(4, w / 2, h);
    svgEl('path', { class: cls, d: `M${x0.toFixed(1)} ${bottom}V${(y0 + r).toFixed(1)}A${r} ${r} 0 0 1 ${(x0 + r).toFixed(1)} ${y0.toFixed(1)}H${(x1 - r).toFixed(1)}A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${(y0 + r).toFixed(1)}V${bottom}Z` }, svg);
  };
  if (columns) {
    const w = Math.max(2, Math.min(24, band - 2));
    values.forEach((v, i) => { if (v > 0) column(x(i), w, Math.max(1, (v / top) * H), base, cfg.markClass ? cfg.markClass(cfg.points[i], i) : 'm-series'); });
  } else {
    const pts = values.map((v, i) => [x(i), y(v)]);
    const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('');
    if (n > 1) {
      svgEl('path', { class: 'area', d: `${d}L${pts[n - 1][0].toFixed(1)} ${base}L${pts[0][0].toFixed(1)} ${base}Z` }, svg);
      svgEl('path', { class: 'line', d }, svg);
    }
    for (const i of (n <= 14 ? pts.map((_, k) => k) : [n - 1])) svgEl('circle', { class: 'dot', cx: pts[i][0].toFixed(1), cy: pts[i][1].toFixed(1), r: 4 }, svg);
  }
  if (strip) {
    const sv = cfg.points.map((p) => Math.max(0, Number(strip.value(p)) || 0));
    const sMax = Math.max(1, ...sv);
    const sBase = base + stripGap + stripH;
    svgEl('line', { class: 'grid base', x1: left, x2: W - right, y1: crisp(sBase), y2: crisp(sBase) }, svg);
    svgEl('text', { class: 'axis-name', x: left - 16, y: sBase - 2, 'text-anchor': 'end' }, svg).textContent = strip.name;
    const w = Math.max(2, Math.min(12, (columns ? band : step) - 2));
    sv.forEach((v, i) => { if (v > 0) column(x(i), w, Math.max(2, (v / sMax) * stripH), sBase, 'm-lead'); });
  }
  const axisY = total - 8;
  const xt = typeof cfg.xTicks === 'function' ? cfg.xTicks(W, n) : (cfg.xTicks || []);
  for (const i of xt) {
    if (i < 0 || i >= n) continue;
    const label = cfg.xLabel(cfg.points[i], i);
    const half = label.length * 3.4;
    let tx = x(i);
    let anchor = 'middle';
    if (tx + half > W) { anchor = 'end'; tx = Math.min(W, x(i) + (columns ? Math.min(12, band / 2) : 0)); }
    else if (tx - half < 0) { anchor = 'start'; tx = Math.max(0, x(i) - (columns ? Math.min(12, band / 2) : 0)); }
    svgEl('text', { x: tx.toFixed(1), y: axisY, 'text-anchor': anchor }, svg).textContent = label;
  }
  for (const i of new Set(cfg.labelIdx || [])) {
    if (i == null || i < 0 || i >= n || values[i] <= 0) continue;
    const text = cfg.labelText ? cfg.labelText(cfg.points[i], i) : fmt(values[i]);
    const half = text.length * 3.6;
    let tx = x(i);
    let anchor = 'middle';
    if (tx + half > W) { anchor = 'end'; tx = W; }
    svgEl('text', { class: 'lbl', x: tx.toFixed(1), y: Math.round(y(values[i])) - 10, 'text-anchor': anchor }, svg).textContent = text;
  }

  // Hover and keyboard layer: the crosshair (line) or the column band finds the nearest point.
  const cross = svgEl('line', { class: 'cross', x1: 0, x2: 0, y1: padTop - 8, y2: strip ? base + stripGap + stripH : base, visibility: 'hidden' }, svg);
  const hdot = columns ? null : svgEl('circle', { class: 'dot', r: 5, cx: 0, cy: 0, visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { class: 'hit', x: left - (columns ? 0 : Math.min(12, step / 2)), y: 0, width: plotW + (columns ? 0 : Math.min(24, step)), height: base + stripGap + stripH }, svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  plot.append(svg, tip);
  let cur = -1;
  const show = (index) => {
    const i = Math.max(0, Math.min(n - 1, index));
    cur = i;
    const px = x(i);
    if (columns) { hl.setAttribute('x', (px - band / 2).toFixed(1)); hl.setAttribute('visibility', 'visible'); }
    else {
      cross.setAttribute('x1', crisp(px)); cross.setAttribute('x2', crisp(px)); cross.setAttribute('visibility', 'visible');
      hdot.setAttribute('cx', px.toFixed(1)); hdot.setAttribute('cy', y(values[i]).toFixed(1)); hdot.setAttribute('visibility', 'visible');
    }
    const info = cfg.tip(cfg.points[i], i);
    tip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'tip-t';
    title.textContent = info.title;
    tip.appendChild(title);
    for (const row of info.rows) {
      const r = document.createElement('div');
      r.className = 'tip-r';
      const key = document.createElement('span');
      key.className = `tip-k ${row.key || ''}`;
      if (!row.key) key.style.background = 'transparent';
      const b = document.createElement('b');
      b.textContent = row.value;
      const l = document.createElement('span');
      l.textContent = row.label;
      r.append(key, b, l);
      tip.appendChild(r);
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let tx = px + 16;
    if (tx + tw > W) tx = px - 16 - tw;
    if (tx < 0) tx = Math.max(0, Math.min(W - tw, px - tw / 2));
    tip.style.transform = `translate(${Math.round(tx)}px,${padTop - 8}px)`;
  };
  const hide = () => {
    cur = -1;
    tip.hidden = true;
    hl.setAttribute('visibility', 'hidden');
    cross.setAttribute('visibility', 'hidden');
    hdot?.setAttribute('visibility', 'hidden');
  };
  const indexAt = (e) => {
    const px = e.clientX - svg.getBoundingClientRect().left;
    return columns ? Math.floor((px - left) / band) : Math.round((px - left) / step);
  };
  hit.addEventListener('pointermove', (e) => show(indexAt(e)));
  hit.addEventListener('pointerdown', (e) => show(indexAt(e)));
  hit.addEventListener('pointerleave', () => { if (document.activeElement !== plot) hide(); });
  plot.tabIndex = 0;
  plot.setAttribute('role', 'group');
  plot.setAttribute('aria-label', `${cfg.label}. Use the left and right arrow keys to read each value, or open the table below.`);
  plot.onfocus = () => show(cur >= 0 ? cur : n - 1);
  plot.onblur = hide;
  plot.onkeydown = (e) => {
    const moves = cur >= 0 ? { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 } : { ArrowLeft: n - 1, ArrowRight: 0, Home: 0, End: n - 1 };
    if (e.key in moves) { e.preventDefault(); show(moves[e.key]); } else if (e.key === 'Escape') hide();
  };
}
let chartResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(() => {
    for (const [host, cfg] of chartRegistry) {
      if (!host.isConnected) { chartRegistry.delete(host); continue; }
      if (host.offsetWidth && Math.floor(host.clientWidth) !== cfg.renderedWidth) renderChart(host, cfg);
    }
  }, 150);
});
// Every n-th index counted back from the newest, so the latest point always has a date under it.
const tickEvery = (n, count) => { const step = Math.max(1, Math.ceil(n / count)); const out = []; for (let i = n - 1; i >= 0; i -= step) out.push(i); return out; };

// ---------- card charts: donut and bars ----------
const CAT = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
const shareOf = (v, sum) => { const p = sum ? (v / sum) * 100 : 0; return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`; };
// A share of one whole: at most six slices, the smallest folded into "Other". Each slice is named with its share
// in the legend beside the ring; hovering or focusing a slice or its legend row shows it in the centre.
function drawDonut(host, { rows, center, centerLabel, label, empty = 'Nothing yet', stageLinks = false }) {
  if (!host) return;
  const all = rows.filter((r) => r.value > 0);
  const sum = all.reduce((n, r) => n + r.value, 0);
  if (!sum) { host.innerHTML = `<p class="empty">${esc(empty)}</p>`; return; }
  let slices = all;
  if (all.length > 6) {
    const kept = new Set([...all].sort((a, b) => b.value - a.value).slice(0, 5));
    slices = [...all.filter((r) => kept.has(r)), { label: 'Other', value: all.filter((r) => !kept.has(r)).reduce((n, r) => n + r.value, 0), other: true }];
  }
  const R = 80;
  const r = 56;
  const C = 84;
  const gap = slices.length > 1 ? 2 / ((R + r) / 2) : 0; // a 2px surface gap between slices
  const pt = (rad, a) => `${(C + rad * Math.cos(a)).toFixed(2)} ${(C + rad * Math.sin(a)).toFixed(2)}`;
  let a0 = -Math.PI / 2;
  const segs = slices.map((s, i) => {
    const sweep = (s.value / sum) * Math.PI * 2;
    const start = a0 + gap / 2;
    const end = Math.max(start + 0.01, a0 + sweep - gap / 2);
    a0 += sweep;
    const cls = s.other ? 'c-other' : CAT[i];
    const d = slices.length === 1
      ? `M${C - R} ${C}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0ZM${C - r} ${C}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0Z`
      : `M${pt(R, start)}A${R} ${R} 0 ${end - start > Math.PI ? 1 : 0} 1 ${pt(R, end)}L${pt(r, end)}A${r} ${r} 0 ${end - start > Math.PI ? 1 : 0} 0 ${pt(r, start)}Z`;
    return `<path class="seg ${cls}" data-i="${i}" d="${d}" fill-rule="evenodd"/>`;
  }).join('');
  const legend = slices.map((s, i) => `<li tabindex="0" data-i="${i}"${stageLinks && s.key ? ` data-stage="${esc(s.key)}"` : ''}><span class="sw ${s.other ? 'c-other' : CAT[i]}"></span><span class="nm">${esc(s.label)}</span><span class="pc">${shareOf(s.value, sum)}</span><span class="ct">${fmt(s.value)}</span></li>`).join('');
  host.innerHTML = `<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 168 168" role="img" aria-label="${esc(label)}">${segs}<text class="d-val" x="${C}" y="${C + 2}" text-anchor="middle">${esc(center)}</text><text class="d-lbl" x="${C}" y="${C + 22}" text-anchor="middle">${esc(centerLabel)}</text></svg><ul class="legend">${legend}</ul></div></div>`;
  host.appendChild(tableView({ caption: label, head: ['', 'Count', 'Share'], rows: slices.map((s) => [s.label, fmt(s.value), shareOf(s.value, sum)]) }));
  const box = host.querySelector('.donut');
  const [val, lbl] = host.querySelectorAll('svg text');
  const show = (i) => {
    box.classList.toggle('focus', i != null);
    box.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('on', i != null && el.dataset.i === String(i)));
    val.textContent = i == null ? center : shareOf(slices[i].value, sum);
    lbl.textContent = i == null ? centerLabel : (slices[i].label.length > 18 ? `${slices[i].label.slice(0, 17)}…` : slices[i].label);
  };
  box.querySelectorAll('[data-i]').forEach((el) => {
    el.addEventListener('pointerenter', () => show(Number(el.dataset.i)));
    el.addEventListener('pointerleave', () => show(null));
    el.addEventListener('focus', () => show(Number(el.dataset.i)));
    el.addEventListener('blur', () => show(null));
  });
}
// Ranked bars in a card: the name, the figure, and a thin bar under them.
function barList(el, rows, { empty = 'Nothing yet' } = {}) {
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<p class="empty">${esc(empty)}</p>`; return; }
  const max = Math.max(1, ...rows.map((r) => r.value));
  el.innerHTML = `<ul class="hbars">${rows.map((r) => `<li><span class="nm">${esc(r.label)}</span><span class="v">${fmt(r.value)}</span><span class="track"><span class="bar" style="width:${((r.value / max) * 100).toFixed(1)}%"></span></span></li>`).join('')}</ul>`;
}
// Counts keyed by name: largest first, or in the given order.
const countRows = (obj, labels = {}, order = null) => {
  const entries = Object.entries(obj || {});
  const sorted = order
    ? [...order.filter((k) => k in (obj || {})).map((k) => [k, obj[k]]), ...entries.filter(([k]) => !order.includes(k))]
    : entries.sort((a, b) => b[1] - a[1]);
  return sorted.map(([k, n]) => ({ key: k, label: labels[k] || capFirst(String(k).replace(/_/g, ' ')), value: Number(n) || 0 }));
};

// ---------- Overview ----------
// With seller operations on, a call starts from the inquiry once response permission is checked, so the list shows
// the number without making it a link.
const phoneHtml = (l) => {
  const tel = digits(l.phone);
  if (l.phone) return tel && !operationsEnabled ? `<a href="tel:${esc(tel)}">${esc(l.phone)}</a>` : esc(l.phone);
  return l.email ? `<span class="muted">${esc(l.email)}</span>` : '';
};
// The waiting pill names the clock's threshold in words.
const waitWord = (m) => (m >= CLOCK_LATE ? ['critical', 'Past 24 hours'] : m >= CLOCK_SLOW ? ['warning', 'Over an hour'] : ['info', 'Under an hour']);
const waitPill = (iso) => { const [tone, word] = waitWord(minutesSince(iso)); return `<span class="pill ${tone}" data-wait-since="${esc(iso)}">${word}</span>`; };
const waitingRow = (l) => {
  const town = townOf(l.address);
  const phone = phoneHtml(l);
  // The name, then the town and how they found us; the brand is in the lead itself.
  return `<tr data-id="${esc(l.id)}" tabindex="0"><td class="c-clock">${clockHtml(l.created_at)}</td><td class="c-name"><strong>${esc(l.name)}</strong><span class="sub">${esc([town, l.channel && channelName(l.channel)].filter(Boolean).join(", ") || BRANDS[brandOf(l)])}</span></td><td class="c-phone">${phone}</td><td class="c-said">${esc(l.situation || "")}</td><td class="c-pill">${waitPill(l.created_at)}</td></tr>`;
};
const miniRow = (l, sub, meta) => `<li data-id="${esc(l.id)}" tabindex="0"><span class="avatar" aria-hidden="true">${esc(initials(l.name))}</span><span class="who-line"><strong>${esc(l.name)}</strong><span>${esc(sub)}</span></span><span class="meta">${meta}</span></li>`;
const dayName = (iso) => {
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.floor((new Date(d).setHours(0, 0, 0, 0) - start) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const timeClock = (iso) => { const [t, ap] = timeOf(iso).split(' '); return `<span class="clock"><b>${esc(t)}</b><i>${esc(ap || '')}</i></span>`; };

async function loadDash() {
  let d;
  try { d = await api('stats'); } catch (e) { $('#kpis').innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  const s = d.stats;
  const weeks = s.weekly || [];
  const lastWeek = weeks.length - 1;
  const thisWeek = weeks.length ? weeks[lastWeek].leads : s.new7;
  const weekBefore = weeks.length > 1 ? weeks[lastWeek - 1].leads : null;
  const next = d.upcoming[0];

  // KPI cards: what needs action first, then this week against the week before.
  $('#kpis').innerHTML = [
    kpiCard({ icon: 'clock', label: 'Waiting for a first call', value: fmt(s.uncontacted), go: 'new',
      foot: d.waiting.length ? `<span>Longest</span>${clockHtml(d.waiting[0].created_at)}` : '<span>Everyone has had a first call</span>' }),
    kpiCard({ icon: 'phone', label: 'Follow-ups due', value: fmt(s.followupsDue), go: 'followups', foot: '<span data-foot="followups">Checking…</span>' }),
    kpiCard({ icon: 'userPlus', tone: 'gold', label: 'New leads this week', value: fmt(thisWeek), go: 'all',
      foot: `${changeChip(thisWeek, weekBefore, { percent: false, against: 'vs the week before' })}<span>${fmt(s.newToday)} today</span>` }),
    kpiCard({ icon: 'calendar', label: 'Appointments, next 7 days', value: fmt(s.appointments7), go: 'open',
      foot: next ? `<span>Next ${esc(dayName(next.appointment_at))}, ${esc(timeOf(next.appointment_at))}</span>` : '<span>None booked</span>' }),
  ].join('');
  document.querySelectorAll('.kpi[data-go]').forEach((k) => {
    const go = () => { setView(k.dataset.go, false); openTab('leads'); };
    k.addEventListener('click', go);
    k.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  // Leads per week: the week ending now in gold; labels name each bucket's last day in local time (the reply's
  // weekEnding is a UTC date, a day ahead in the evening here).
  const peakWeek = weeks.reduce((best, w, i) => (w.leads > (weeks[best]?.leads ?? -1) ? i : best), 0);
  const weekEnd = (i) => new Date(Date.now() - (lastWeek - i) * 7 * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('#spark-l').innerHTML = weeks.length ? '<span class="lg"><i class="lg-bar"></i>Earlier weeks</span><span class="lg"><i class="lg-bar lead"></i>This week</span>' : '';
  drawChart($('#spark'), {
    kind: 'columns', height: 280, points: weeks, value: (w) => w.leads,
    label: `Leads per week, ${weeks.length} weeks to ${weeks.length ? weekEnd(lastWeek) : ''}`,
    markClass: (w, i) => (i === lastWeek ? 'm-lead' : 'm-series'),
    xTicks: (W, n) => tickEvery(n, W < 480 ? 3 : 4), xLabel: (w, i) => weekEnd(i),
    labelIdx: [lastWeek, peakWeek],
    tip: (w, i) => ({ title: `${i === lastWeek ? 'This week, ' : ''}7 days to ${weekEnd(i)}`, rows: [{ value: fmt(w.leads), label: w.leads === 1 ? 'lead' : 'leads', key: i === lastWeek ? 'lead' : 'series' }] }),
    table: { caption: 'Leads per week', head: ['Week ending', 'Leads'], rows: weeks.map((w, i) => [weekEnd(i), fmt(w.leads)]) },
    empty: 'No leads yet.',
  });

  // Pipeline by stage: open leads as one whole; a stage in the legend opens the leads at that stage.
  drawDonut($('#by-status'), { rows: countRows(s.byStatus, STAGES, Object.keys(STAGES)), center: fmt(s.openPipeline), centerLabel: 'open', label: 'Open leads by stage', empty: 'No open leads', stageLinks: true });

  // Waiting for a first call: longest wait first, the clock running, a pill naming its threshold.
  $('#count-waiting').textContent = fmt(s.uncontacted);
  $('#count-followups').textContent = fmt(s.followupsDue);
  $('#waiting').innerHTML = d.waiting.length
    ? d.waiting.map(waitingRow).join('') + (s.uncontacted > d.waiting.length ? `<tr><td colspan="5" class="note">The ${fmt(d.waiting.length)} longest waits of ${fmt(s.uncontacted)}</td></tr>` : '')
    : '<tr><td colspan="5" class="empty">Everyone has had a first call</td></tr>';
  $('#upcoming').innerHTML = d.upcoming.length
    ? d.upcoming.map((l) => miniRow(l, [townOf(l.address), BRANDS[brandOf(l)]].filter(Boolean).join(', '), `${timeClock(l.appointment_at)}${esc(dayName(l.appointment_at))}`)).join('')
    : '<li class="empty">No appointments booked</li>';
  loadFollowupsDue(s.followupsDue);

  drawDonut($('#by-channel'), { rows: countRows(s.byChannel, CHANNELS), center: fmt(Object.values(s.byChannel || {}).reduce((n, v) => n + (Number(v) || 0), 0)), centerLabel: 'leads', label: 'Where leads came from, last 30 days', empty: 'No leads in the last 30 days' });
  barList($('#by-route'), countRows(s.byRoute, ROUTES), { empty: 'No path chosen in the last 30 days' });
  barList($('#by-brand'), countRows(s.byBrand, BRANDS), { empty: 'No leads in the last 30 days' });
  $('#results').innerHTML = `<div class="trio"><div><b>${esc(s.medianMinutesToContact == null ? '—' : minutesText(s.medianMinutesToContact))}</b><span>Median first call, 30 days</span></div><div><b>${fmt(s.won90)}</b><span>Closed, 90 days</span></div><div><b>${esc(money(s.grossProfit90))}</b><span>Gross profit, 90 days</span></div></div>`;
  loadHealth();
}

// Follow-ups due come from the leads list (the same view as Leads, Follow-ups due), oldest due first.
let followupsRequest = 0;
async function loadFollowupsDue(count) {
  const request = ++followupsRequest;
  const el = $('#followups-due');
  const foot = () => document.querySelector('[data-foot="followups"]');
  try {
    const r = await api('leads', { params: { view: 'followups', limit: '6' } });
    if (request !== followupsRequest) return;
    el.innerHTML = r.leads.length
      ? r.leads.map((l) => miniRow(l, [STAGES[l.status] || l.status, townOf(l.address)].filter(Boolean).join(', '), `${clockHtml(l.next_followup)}overdue`)).join('')
        + (count > r.leads.length ? `<li class="more-note note">The ${fmt(r.leads.length)} oldest of ${fmt(count)}</li>` : '')
      : '<li class="empty">No follow-ups due</li>';
    if (foot()) foot().innerHTML = r.leads.length ? `Oldest ${clockHtml(r.leads[0].next_followup)} overdue` : 'None due';
  } catch (e) {
    if (request !== followupsRequest) return;
    el.innerHTML = `<li class="empty">${esc(e.message)}</li>`;
    if (foot()) foot().textContent = '';
  }
}

async function loadHealth() {
  const el = $('#health-items');
  if (!el) return;
  try {
    const { health: h } = await api('health');
    // One tile per connection: its name, a status pill, and what to do about it.
    const line = (tone, name, word, detail = '') => `<li><span class="sl-name">${esc(name)}</span><span class="pill ${tone}">${esc(word)}</span>${detail ? `<span class="sl-detail">${esc(detail)}</span>` : ''}</li>`;
    // `missing` names what is not set (RESEND_API_KEY, LEAD_NOTIFY_EMAIL); an older server does not send it.
    const missing = Array.isArray(h.email.missing) ? h.email.missing.map(String).filter(Boolean) : null;
    const missingText = missing && missing.length
      ? `${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]} are` : `${missing[0]} is`} not set`
      : 'RESEND_API_KEY is not set';
    const email = !h.email.configured
      ? line('warning', 'Email alerts', 'Off', missingText)
      : h.email.sandboxSender
        ? line('warning', 'Email alerts', 'Sandbox sender', 'Verify the LEAD_FROM_EMAIL domain')
        : line('good', 'Email alerts', 'Ready', `Sends to ${h.email.recipients.join(', ')}`);
    el.classList.remove('muted');
    el.innerHTML = `<ul>${[
      line('good', 'Database', 'Connected', h.crm?.label || ''),
      email,
      h.standardBridge.configured ? line('good', 'Standard bridge', 'Active') : line('warning', 'Standard bridge', 'Not set'),
      h.webhook.configured ? line('good', 'Webhook', 'Active', h.webhook.signed === true ? 'Posts are signed' : h.webhook.signed === false ? 'Posts are not signed' : '') : line('muted', 'Webhook', 'Off', 'Optional'),
      h.sms.configured ? line('good', 'SMS', 'Configured', `Customer acknowledgement ${h.sms.customerAckEnabled ? 'on' : 'off'}`) : line('muted', 'SMS', 'Off'),
    ].join('')}</ul>`;
  } catch {
    el.textContent = 'Could not check integration status.';
  }
}

$('#test-alert-btn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const msg = $('#test-alert-msg');
  btn.disabled = true;
  msg.textContent = 'Sending…';
  msg.className = 'status-msg';
  try {
    const r = await api('test-alert', { method: 'POST', body: {} });
    msg.textContent = (r.channels || []).map((c) => c.detail).join('; ') || 'Test alert sent.';
    msg.className = 'status-msg ok';
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'status-msg bad';
  } finally {
    btn.disabled = false;
  }
});
['#waiting', '#upcoming', '#followups-due'].forEach((sel) => {
  $(sel).addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // the phone number dials; the rest of the row opens the lead
    const row = e.target.closest('[data-id]');
    if (row) openLead(row.dataset.id);
  });
  $(sel).addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-id]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLead(row.dataset.id); }
  });
});
document.querySelectorAll('[data-go-view]').forEach((b) => b.addEventListener('click', () => { setView(b.dataset.goView, false); openTab('leads'); }));
// A stage in "Where each seller stands" opens the open leads at that stage.
$('#by-status').addEventListener('click', (e) => {
  const b = e.target.closest('[data-stage]');
  if (!b) return;
  list.status = b.dataset.stage;
  $('#stage-filter').value = list.status;
  setView('open', false);
  openTab('leads');
});

// ---------- partners & ROI ----------
$('#s-month').value = new Date().toISOString().slice(0, 7);
const monthName = (m) => { const t = String(m || '').slice(0, 7); return /^\d{4}-\d{2}$/.test(t) ? new Date(`${t}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : t; };
const partnerStatus = (s) => `<span class="pill ${s === 'active' ? 'good' : ['paused', 'declined'].includes(s) ? 'muted' : ''}">${esc(capFirst(String(s || '').replace(/_/g, ' ')))}</span>`;
async function loadPartners() {
  let r;
  try { r = await api('partners'); } catch (e) {
    $('#partner-rows').innerHTML = `<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`;
    return;
  }
  const baseUrl = location.origin.includes('localhost') ? 'https://www.callharbison.com' : location.origin;
  $('#partner-rows').innerHTML = (r.partners || []).length
    ? r.partners.map((p) => `<tr>
        <td><strong>${esc(p.name)}</strong><span class="sub">${esc(capFirst(p.category.replace(/_/g, ' ')))}, <code>${esc(p.slug)}</code></span></td>
        <td>${partnerStatus(p.status)}</td>
        <td class="num-col">${fmt(p.inquiries)}</td>
        <td class="num-col">${fmt(p.appointments)}</td>
        <td class="num-col">${fmt(p.closed)}</td>
        <td class="num-col">${money(p.gross_profit || 0)}</td>
        <td><button type="button" class="btn ghost sm" data-copy="${esc(`${baseUrl}/family?ref=${encodeURIComponent(p.slug)}`)}">Copy link</button></td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No partners configured yet.</td></tr>';

  $('#funnel-rows').innerHTML = (r.funnel || []).length
    ? r.funnel.map((f) => `<tr>
        <td>${esc(monthName(f.month))}</td>
        <td>${esc(channelName(f.channel))}</td>
        <td class="num-col">${fmt(f.leads)}</td>
        <td class="num-col">${fmt(f.qualified)}</td>
        <td class="num-col">${fmt(f.closed)}</td>
        <td class="num-col">${f.spend != null ? money(f.spend) : '—'}</td>
        <td class="num-col">${f.cost_per_lead != null ? money(f.cost_per_lead) : '—'}</td>
        <td class="num-col">${f.roas != null ? `${Number(f.roas).toFixed(2)}×` : '—'}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" class="empty">No funnel activity yet.</td></tr>';
}
$('#partner-rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = prev; }, 1600);
  } catch {}
});
$('#partner-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#p-msg');
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  msg.textContent = '';
  try {
    const fd = Object.fromEntries(new FormData(e.target).entries());
    await api('partner', { method: 'POST', body: fd });
    msg.textContent = 'Partner saved.';
    msg.className = 'status-msg ok';
    e.target.reset();
    loadPartners();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'status-msg bad';
  } finally { btn.disabled = false; }
});
$('#spend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#s-msg');
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  msg.textContent = '';
  try {
    const fd = Object.fromEntries(new FormData(e.target).entries());
    await api('spend', { method: 'POST', body: fd });
    msg.textContent = 'Spend recorded.';
    msg.className = 'status-msg ok';
    loadPartners();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'status-msg bad';
  } finally { btn.disabled = false; }
});

// ---------- lead list ----------
const list = { view: 'open', q: '', brand: '', status: '', offset: 0, items: [] };
$('#stage-filter').innerHTML = `<option value="">Any stage</option>${Object.entries(STAGES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}`;

function setView(v, reload = true) {
  list.view = v;
  if (v === 'spam' || v === 'trash') { list.status = ''; $('#stage-filter').value = ''; }
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  if (reload) { syncUrl({ tab: 'leads', replace: true }); loadLeads(true); }
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
let searchTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { list.q = e.target.value; syncUrl({ tab: 'leads', replace: true }); loadLeads(true); }, 250);
});
$('#more').addEventListener('click', () => loadLeads(false));
$('#brand').addEventListener('change', (e) => { list.brand = e.target.value; syncUrl({ tab: 'leads', replace: true }); loadLeads(true); });
$('#stage-filter').addEventListener('change', (e) => { list.status = e.target.value; syncUrl({ tab: 'leads', replace: true }); loadLeads(true); });
$('#export-csv').addEventListener('click', () => {
  const qs = new URLSearchParams({ action: 'export', view: list.view, q: list.q, brand: list.brand, status: list.status });
  location.href = `/api/hq?${qs}`;
});

async function loadLeads(reset) {
  if (reset) { list.offset = 0; list.items = []; }
  let r;
  try {
    r = await api('leads', { params: { view: list.view, q: list.q, brand: list.brand, status: list.status, offset: String(list.offset), limit: '50' } });
  } catch (e) {
    $('#rows').innerHTML = `<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`;
    return;
  }
  list.items = list.items.concat(r.leads);
  list.offset += r.leads.length;
  $('#more').hidden = r.leads.length < r.limit;
  $('#leads-empty').hidden = list.items.length > 0;
  const due = (l) => l.next_followup && Date.parse(l.next_followup) <= Date.now();
  // Leads that came in through the Spanish pages (/es/...) are marked so the team replies in Spanish.
  const spanish = (l) => /^\/es(\/|$)/.test(l.source || '');
  // The waiting clock runs for a new lead nobody has called yet, and for a follow-up past its time.
  const waiting = (l) => l.status === 'new' && !l.do_not_contact && list.view !== 'trash';
  const sinceLine = (l) => (waiting(l) ? `${clockHtml(l.created_at)} waiting` : esc(ago(l.created_at)));
  const dueLine = (l) => `${clockHtml(l.next_followup)} overdue`;
  $('#rows').innerHTML = list.items.map((l) => `<tr data-id="${esc(l.id)}" tabindex="0">
      <td>${esc(when(l.created_at))}<span class="sub">${sinceLine(l)}</span></td>
      <td><strong>${esc(l.name)}</strong><span class="sub">${esc(l.phone || l.email)}</span>${spanish(l) ? '<span class="sub">Reply in Spanish</span>' : ''}</td>
      <td>${esc(l.address || 'Not supplied')}</td>
      <td>${esc(l.situation || '—')}${l.route_interest ? `<span class="sub">Path: ${esc(ROUTES[l.route_interest] || l.route_interest)}</span>` : ''}</td>
      <td>${stageTag(l.status)}${l.do_not_contact ? '<span class="sub due">Do not contact</span>' : ''}</td>
      <td>${esc(when(l.next_followup))}${due(l) ? `<span class="sub">${dueLine(l)}</span>` : ''}</td>
      <td>${esc(BRANDS[brandOf(l)])}<span class="sub">${esc(channelName(l.channel))}</span></td></tr>`).join('');
  $('#cards').innerHTML = list.items.map((l) => `<div class="lead-card" data-id="${esc(l.id)}" role="button" tabindex="0">
      <div class="row"><strong>${esc(l.name)}</strong>${stageTag(l.status)}</div>
      <span class="muted">${esc(l.address || l.email || 'General inquiry')}</span>
      <div class="row"><span class="muted">${esc([BRANDS[brandOf(l)], l.situation].filter(Boolean).join(', '))}</span><span class="muted">${due(l) ? dueLine(l) : waiting(l) ? sinceLine(l) : l.next_followup ? `Follow up ${esc(when(l.next_followup))}` : esc(ago(l.created_at))}</span></div>${spanish(l) ? '<span class="muted">Reply in Spanish</span>' : ''}</div>`).join('');
  renderEmptyTrash();
}
['#rows', '#cards'].forEach((sel) => {
  $(sel).addEventListener('click', (e) => { const el = e.target.closest('[data-id]'); if (el) openLead(el.dataset.id); });
  $(sel).addEventListener('keydown', (e) => { const el = e.target.closest('[data-id]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLead(el.dataset.id); } });
});

// ---------- modal / drawer helpers + focus trap ----------
let current = null;
let initialFormValues = {};
let lastFocus = null;
const FIELDS = ['name', 'phone', 'email', 'address', 'situation', 'route_interest', 'status', 'assigned_to', 'next_followup', 'appointment_at', 'estimated_value', 'offer_amount', 'outcome_path', 'closed_value', 'gross_profit', 'lost_reason', 'notes', 'authority_confirmed', 'do_not_contact'];
const statusOptionsHtml = Object.entries(STAGES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
$('#f-status').innerHTML = statusOptionsHtml;
$('#nl-status').innerHTML = statusOptionsHtml;

function activeDialog() {
  if (!$('#drawer').hidden) return $('#drawer');
  if (!$('#new-drawer').hidden) return $('#new-drawer');
  if (!$('#import-drawer').hidden) return $('#import-drawer');
  return null;
}

function closeAllDrawers(updateHistory = true) {
  $('#drawer').hidden = true;
  $('#new-drawer').hidden = true;
  $('#import-drawer').hidden = true;
  $('#scrim').hidden = true;
  current = null;
  if (updateHistory) syncUrl({ leadId: null, replace: true });
  lastFocus?.focus?.();
}
function closeDrawer(updateHistory = true) { closeAllDrawers(updateHistory); }

$('#d-close').addEventListener('click', () => closeAllDrawers(true));
$('#new-close').addEventListener('click', () => closeAllDrawers(true));
$('#import-close').addEventListener('click', () => closeAllDrawers(true));
$('#scrim').addEventListener('click', () => closeAllDrawers(true));

document.addEventListener('keydown', (e) => {
  const dlg = activeDialog();
  if (!dlg) return;
  if (e.key === 'Escape') { e.preventDefault(); closeAllDrawers(true); return; }
  if (e.key === 'Tab') {
    const focusables = [...dlg.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// ---------- manual new-lead drawer ----------
function openNewLeadDrawer() {
  lastFocus = document.activeElement;
  $('#drawer').hidden = true;
  $('#import-drawer').hidden = true;
  $('#new-form').reset();
  $('#nl-assigned_to').value = 'nathanael';
  $('#nl-status').value = 'connected';
  $('#nl-consent_response').checked = true;
  $('#nl-msg').textContent = '';
  $('#nl-msg').className = 'status-msg';
  $('#new-drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#nl-name').focus();
}
$('#top-new-lead').addEventListener('click', openNewLeadDrawer);
$('#leads-new-btn').addEventListener('click', openNewLeadDrawer);

$('#new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#nl-msg');
  const btn = e.target.querySelector('button[type=submit]');
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.consent_response = $('#nl-consent_response').checked;
  if (!body.name.trim()) { msg.textContent = 'Enter a contact name.'; msg.className = 'status-msg bad'; $('#nl-name').focus(); return; }
  if (!body.phone.trim() && !body.email.trim()) { msg.textContent = 'Enter a phone number or email address.'; msg.className = 'status-msg bad'; $('#nl-phone').focus(); return; }
  btn.disabled = true;
  msg.textContent = '';
  try {
    const r = await api('lead', { method: 'POST', body });
    $('#new-drawer').hidden = true;
    if (!$('#leads').hidden) loadLeads(true);
    if (!$('#dash').hidden) loadDash();
    await openLead(r.lead.id);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'status-msg bad';
  } finally {
    btn.disabled = false;
  }
});

// ---------- historical CSV / JSON import drawer ----------
function openImportDrawer() {
  lastFocus = document.activeElement;
  $('#drawer').hidden = true;
  $('#new-drawer').hidden = true;
  $('#imp-msg').textContent = '';
  $('#imp-msg').className = 'status-msg';
  $('#imp-summary').hidden = true;
  $('#imp-summary').innerHTML = '';
  $('#import-drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#imp-raw').focus();
}
$('#import-btn')?.addEventListener('click', openImportDrawer);

$('#imp-file')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  $('#imp-raw').value = await file.text();
});

async function runLeadImport(dryRun) {
  const msg = $('#imp-msg');
  const summary = $('#imp-summary');
  const raw = $('#imp-raw').value.trim();
  if (!raw) { msg.textContent = 'Upload or paste CSV or JSON rows first.'; msg.className = 'status-msg bad'; $('#imp-raw').focus(); return; }
  $('#imp-preview-btn').disabled = true;
  $('#imp-run-btn').disabled = true;
  msg.textContent = dryRun ? 'Checking rows…' : 'Importing…';
  msg.className = 'status-msg';
  try {
    const r = await api('import', {
      method: 'POST',
      body: { raw, default_brand: $('#imp-brand').value, dry_run: dryRun },
    });
    const c = r.counts || { ready: 0, duplicates: 0, invalid: 0 };
    if (dryRun) {
      msg.textContent = `${fmt(c.ready)} ready, ${fmt(c.duplicates)} duplicate(s) skipped, ${fmt(c.invalid)} invalid`;
      msg.className = `status-msg ${c.ready ? 'ok' : ''}`;
      const lines = [];
      if (r.preview?.length) {
        lines.push(`<strong>Sample rows ready (${r.preview.length} of ${fmt(c.ready)})</strong><ul>${r.preview.map((p) => `<li><strong>${esc(p.name)}</strong> (${esc(p.contact || '—')}), ${esc(BRANDS[p.brand] || p.brand)}, ${esc(String(p.created_at).slice(0, 10))}</li>`).join('')}</ul>`);
      }
      if (r.invalid?.length) {
        lines.push(`<strong>Invalid rows (${fmt(c.invalid)})</strong><ul>${r.invalid.map((inv) => `<li>Row ${inv.row}: ${esc(inv.reason)}</li>`).join('')}</ul>`);
      }
      summary.innerHTML = lines.join('') || 'All rows already exist in HQ (duplicates skipped).';
      summary.hidden = false;
    } else {
      msg.textContent = `Imported ${fmt(r.imported)} lead(s) (${fmt(c.duplicates)} duplicate(s) skipped).`;
      msg.className = 'status-msg ok';
      summary.hidden = true;
      loadLeads(true);
      loadDash();
    }
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'status-msg bad';
  } finally {
    $('#imp-preview-btn').disabled = false;
    $('#imp-run-btn').disabled = false;
  }
}

$('#imp-preview-btn')?.addEventListener('click', () => runLeadImport(true));
$('#import-form')?.addEventListener('submit', (e) => { e.preventDefault(); runLeadImport(false); });

// ---------- lead drawer ----------
async function openLead(id, updateHistory = true) {
  lastFocus = document.activeElement;
  $('#new-drawer').hidden = true;
  $('#import-drawer').hidden = true;
  let r;
  try { r = await api('lead', { params: { id } }); } catch (e) { alertMsg(e.message); return; }
  current = r.lead;
  renderLead(r.lead, r.events);
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#drawer').scrollTop = 0;
  if (updateHistory) syncUrl({ leadId: id, replace: true });
  $('#d-close').focus();
}
const alertMsg = (m) => { $('#d-save-msg').textContent = m; $('#d-save-msg').className = 'status-msg bad'; };

function renderLead(l, events) {
  $('#d-name').textContent = l.name;
  renderTrashState(l);
  $('#d-sub').replaceChildren(...[BRANDS[brandOf(l)], l.address || 'Property not supplied', `Received ${when(l.created_at)}`].map((text) => {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }));
  // The same waiting clock as the call sheet, while nobody has called a new lead.
  if (l.status === 'new' && !l.first_contact_at && !l.do_not_contact && !l.deleted_at) {
    const span = document.createElement('span');
    span.innerHTML = `${clockHtml(l.created_at)} waiting for a first call`;
    $('#d-sub').appendChild(span);
  }
  $('#d-dnc').hidden = !l.do_not_contact;
  const tel = digits(l.phone);
  const contactButtons = l.do_not_contact || (operationsEnabled && !l.consent_response) ? [] : [
    tel && `<a class="btn" href="tel:${esc(tel)}">Call ${esc(l.phone)}</a>`,
    tel && `<a class="btn ghost" href="sms:${esc(tel)}">Text</a>`,
    // Everything but the "@" is percent-encoded, so a stored address such as "a@b.c?bcc=…" cannot add a recipient.
    l.email && `<a class="btn ghost" href="mailto:${esc(encodeURIComponent(l.email).replace(/%40/g, '@'))}">Email</a>`,
    l.address && `<a class="btn ghost" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}" target="_blank" rel="noopener">Map</a>`,
  ].filter(Boolean);
  if (operationsEnabled) contactButtons.push(`<a class="btn ghost" href="/hq/operations?inquiry=${encodeURIComponent(l.id)}">Work this inquiry</a>`);
  contactButtons.push(`<button class="textbtn" type="button" id="copy-lead-link">Copy HQ link</button>`);
  $('#d-actions').innerHTML = contactButtons.join('');
  $('#copy-lead-link')?.addEventListener('click', async (ev) => {
    // currentTarget is null once the handler awaits, so keep the button first.
    const btn = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(`${location.origin}/hq?lead=${encodeURIComponent(l.id)}`);
      btn.textContent = 'Link copied';
    } catch (e) {
      console.error('[hq] copy link failed:', e);
      btn.textContent = 'Copy failed';
    }
  });

  const consent = [l.consent_response && 'contact about property', l.consent_marketing && 'marketing'].filter(Boolean).join(' + ');
  const snapshot = events.find((event) => event.actor === 'Harbison Standard intake');
  $('#d-original').hidden = brandOf(l) !== 'harbison_standard';
  $('#d-original-text').textContent = snapshot?.detail || l.notes || '';
  const facts = [
    ['Brand', BRANDS[brandOf(l)]], ['Assigned to', l.assigned_to || 'Nathanael'],
    ['Phone', l.phone], ['Email', l.email], ['Property', l.address],
    ['Situation', l.situation], ['Path of interest', ROUTES[l.route_interest] || l.route_interest],
    ['Timeline', l.timeline], ['Occupancy', l.occupancy],
    ['Condition', Array.isArray(l.condition_flags) ? l.condition_flags.join(', ') : ''],
    ['Goal', l.desired_outcome], ['Relationship', l.relationship], ['Help needed', l.help_needed],
    ['Prefers', l.contact_pref], ['Consent', consent || (l.form_type === 'harbison_standard' ? 'Inquiry only; no marketing opt-in recorded' : l.form_type === 'options' ? 'none recorded' : 'form notice')],
    ['Source', [l.channel && channelName(l.channel), l.ref_partner && `partner:${l.ref_partner}`, l.utm_source, l.utm_campaign].filter(Boolean).join(', ')],
    ['Submitted from', l.source], ['Landing page', l.landing_page], ['Form', l.form_type],
    ['First contact', l.first_contact_at ? when(l.first_contact_at) : ''],
  ].filter(([, v]) => v);
  $('#d-facts').innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  // When a Standard lead's notes are purely the untouched intake snapshot (already shown in #d-original),
  // present Team notes empty so staff don't have to edit around the raw intake block.
  const notesDuplicatesSnapshot = Boolean(snapshot?.detail && l.notes === snapshot.detail);
  $('#f-notes').placeholder = notesDuplicatesSnapshot ? 'Add team follow-up notes. The original inquiry is kept above.' : '';

  initialFormValues = {};
  for (const f of FIELDS) {
    const el = $(`#f-${f}`);
    el.disabled = operationsEnabled && ['status','assigned_to','next_followup','appointment_at','authority_confirmed','do_not_contact','outcome_path'].includes(f);
    if (el.type === 'checkbox') {
      el.checked = !!l[f];
      initialFormValues[f] = el.checked;
    } else if (el.type === 'datetime-local') {
      el.value = toLocalInput(l[f]);
      initialFormValues[f] = el.value;
    } else if (f === 'notes' && notesDuplicatesSnapshot) {
      el.value = '';
      initialFormValues[f] = '';
    } else {
      el.value = l[f] ?? '';
      initialFormValues[f] = String(el.value);
    }
  }
  $('#d-save-msg').textContent = '';
  $('#d-save-msg').className = 'status-msg';
  renderTimeline(events);
}

function renderTimeline(events) {
  const label = { status_change: 'Stage', note: 'Note', call: 'Call', text: 'Text', email: 'Email', appointment: 'Appointment', offer: 'Offer' };
  const pretty = (e) => (e.kind === 'status_change' ? String(e.detail || '').replace(/[a-z_]+/g, (s) => STAGES[s] || s) : e.detail);
  $('#d-timeline').innerHTML = events.length
    ? events.map((e) => `<li><div class="what"><strong>${esc(label[e.kind] || e.kind)}</strong><span>${esc(pretty(e))}</span></div><div class="meta">${esc(when(e.at))}${e.actor ? ` by ${esc(e.actor)}` : ''}</div></li>`).join('')
    : '<li class="empty">No activity yet.</li>';
}

$('#d-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return;
  const body = {};
  const nonNullFields = new Set(['phone', 'address']);
  for (const f of FIELDS) {
    const el = $(`#f-${f}`);
    if (el.type === 'checkbox') {
      if (el.checked !== initialFormValues[f]) body[f] = el.checked;
    } else if (el.type === 'datetime-local') {
      if (el.value !== initialFormValues[f]) body[f] = el.value ? new Date(el.value).toISOString() : null;
    } else {
      const trimmed = el.value.trim();
      if (trimmed !== initialFormValues[f].trim()) {
        body[f] = trimmed === '' ? (nonNullFields.has(f) ? '' : null) : trimmed;
      }
    }
  }
  const msg = $('#d-save-msg');
  if (!Object.keys(body).length) { msg.textContent = 'No changes to save.'; msg.className = 'status-msg'; return; }
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('lead', { method: 'PATCH', params: { id: current.id }, body });
    const r = await api('lead', { params: { id: current.id } });
    current = r.lead;
    renderLead(r.lead, r.events);
    msg.textContent = 'Saved.';
    msg.className = 'status-msg ok';
    if (!$('#leads').hidden) loadLeads(true);
    if (!$('#dash').hidden) loadDash();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'status-msg bad';
  } finally {
    btn.disabled = false;
  }
});

$('#note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return;
  const input = $('#n-detail');
  if (!input.value.trim()) { input.focus(); return; }
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    await api('event', { method: 'POST', params: { id: current.id }, body: { kind: $('#n-kind').value, detail: input.value } });
    input.value = '';
    const r = await api('lead', { params: { id: current.id } });
    current = r.lead;
    renderLead(r.lead, r.events);
    if (!$('#leads').hidden) loadLeads(true);
    if (!$('#dash').hidden) loadDash();
  } catch (err) {
    alertMsg(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- boot ----------
try { $('#login-name').value = localStorage.getItem('hq_name') || ''; } catch {}
api('me').then((r) => showApp(r.name, r.sellerOperationsEnabled, r.analytics)).catch((e) => showLogin(e.status === 503 ? e.message : ''));

// ---------- Trash: delete, restore, delete forever ----------
function renderTrashState(l) {
  const trashed = Boolean(l.deleted_at);
  $('#d-trash').hidden = !trashed;
  $('#d-trash-text').textContent = trashed ? `In Trash, deleted ${when(l.deleted_at)}${l.deleted_by ? ` by ${l.deleted_by}` : ''}` : '';
  $('#d-form').hidden = trashed;
  $('#note-form').hidden = trashed;
  $('#d-delete-start').hidden = trashed;
  $('#d-delete-confirm').hidden = true;
  $('#d-purge').hidden = !trashed;
  $('#d-purge-confirm').value = '';
  $('#d-purge-go').disabled = true;
  $('#d-danger-msg').textContent = '';
  $('#d-danger-msg').className = 'status-msg';
}

function dangerMsg(text, ok = false) {
  $('#d-danger-msg').textContent = text;
  $('#d-danger-msg').className = `status-msg ${ok ? 'ok' : 'bad'}`;
}

async function afterTrashChange() {
  if (!$('#leads').hidden) await loadLeads(true);
  if (!$('#dash').hidden) await loadDash();
}

$('#d-delete').addEventListener('click', () => {
  $('#d-delete-start').hidden = true;
  $('#d-delete-confirm').hidden = false;
  $('#d-delete-yes').focus();
});
$('#d-delete-no').addEventListener('click', () => {
  $('#d-delete-confirm').hidden = true;
  $('#d-delete-start').hidden = false;
  $('#d-delete').focus();
});
$('#d-delete-yes').addEventListener('click', async (ev) => {
  if (!current) return;
  const btn = ev.currentTarget; // currentTarget is cleared once the event finishes dispatching
  btn.disabled = true;
  try {
    await api('lead', { method: 'DELETE', params: { id: current.id } });
    closeDrawer();
    await afterTrashChange();
  } catch (e) {
    dangerMsg(e.message);
  } finally {
    btn.disabled = false;
  }
});
$('#d-restore').addEventListener('click', async (ev) => {
  if (!current) return;
  const btn = ev.currentTarget;
  btn.disabled = true;
  try {
    await api('restore', { method: 'POST', params: { id: current.id }, body: {} });
    const r = await api('lead', { params: { id: current.id } });
    current = r.lead;
    renderLead(r.lead, r.events);
    dangerMsg('Restored. The lead is back in your lists.', true);
    await afterTrashChange();
  } catch (e) {
    dangerMsg(e.message);
  } finally {
    btn.disabled = false;
  }
});
$('#d-purge-confirm').addEventListener('input', (e) => { $('#d-purge-go').disabled = e.target.value.trim() !== 'DELETE'; });
$('#d-purge').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current || $('#d-purge-confirm').value.trim() !== 'DELETE') return;
  $('#d-purge-go').disabled = true;
  try {
    await api('purge', { method: 'DELETE', params: { id: current.id }, body: { confirm: 'DELETE' } });
    closeDrawer();
    await afterTrashChange();
  } catch (err) {
    dangerMsg(err.message);
    $('#d-purge-go').disabled = false;
  }
});

// ---------- Empty Trash ----------
// Deletes only the trashed leads currently listed, and says how many before anything happens.
const plural = (n) => `${n} lead${n === 1 ? '' : 's'}`;
function resetEmptyTrashForm() {
  $('#empty-trash-form').hidden = true;
  $('#empty-trash-start').hidden = false;
  $('#empty-trash-confirm').value = '';
  $('#empty-trash-go').disabled = true;
}
function renderEmptyTrash() {
  const n = list.view === 'trash' ? list.items.length : 0;
  $('#empty-trash').hidden = n === 0;
  resetEmptyTrashForm();
  emptyTrashMsg('');
  if (!n) return;
  $('#empty-trash-text').textContent = `Empty Trash deletes the ${plural(n)} listed below and their activity, for good.`;
  $('#empty-trash-go').textContent = `Delete ${plural(n)} forever`;
}
function emptyTrashMsg(text, ok = false) {
  $('#empty-trash-msg').textContent = text;
  $('#empty-trash-msg').className = `status-msg ${ok ? 'ok' : 'bad'}`;
}
$('#empty-trash-start').addEventListener('click', () => {
  $('#empty-trash-start').hidden = true;
  $('#empty-trash-form').hidden = false;
  emptyTrashMsg('');
  $('#empty-trash-confirm').focus();
});
$('#empty-trash-cancel').addEventListener('click', resetEmptyTrashForm);
$('#empty-trash-confirm').addEventListener('input', (e) => { $('#empty-trash-go').disabled = e.target.value.trim() !== 'DELETE'; });
$('#empty-trash-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ids = list.view === 'trash' ? list.items.map((l) => l.id) : [];
  if (!ids.length || $('#empty-trash-confirm').value.trim() !== 'DELETE') return;
  $('#empty-trash-go').disabled = true;
  try {
    const r = await api('empty-trash', { method: 'DELETE', body: { confirm: 'DELETE', ids } });
    await afterTrashChange();
    // The reload hides the bar once Trash is empty; keep it open just to confirm what happened.
    if (!list.items.length) {
      $('#empty-trash-text').textContent = '';
      $('#empty-trash-start').hidden = true;
      $('#empty-trash').hidden = false;
    }
    emptyTrashMsg(`Deleted ${plural(r.deleted)} for good.`, true);
  } catch (err) {
    emptyTrashMsg(err.message);
    $('#empty-trash-go').disabled = false;
  }
});
