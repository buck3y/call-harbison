// Website stats. Uses the existing HQ session; aggregates are proxied by the server, and no cross-site credentials
// reach this page. Two reply shapes are accepted: the local store's (source 'local', days and hours in the business's
// time zone, with daily page views, visitors and leads, events and the previous period) and the shared collector's
// (source 'shared' or absent, UTC, `hourlyUtc`, daily sessions only, no events, previous or range).
// Every value from the reply or from a lead reaches markup through esc() or textContent.
let analyticsRequest = 0;
let analyticsShownSite = '';
let statementRequest = 0;
// Durations in the waiting clock's units: "48 s", "1 min 34 s", "42 h 35 min".
const duration = (value) => {
  const s = Math.max(0, Math.round(Number(value) || 0));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(s / 3600)} h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)} min` : ''}`;
};
const ZONE_NAMES = { 'America/Los_Angeles': 'Pacific time', UTC: 'UTC' };
const zoneName = (tz) => ZONE_NAMES[tz] || tz || 'UTC';
const statNum = (v) => Math.max(0, Number(v) || 0);
const statList = (v) => (Array.isArray(v) ? v : [])
  .map((e) => ({ key: String(e?.key ?? '').trim(), value: statNum(e?.value) }))
  .filter((e) => e.value > 0);
const hourName = (h) => { const x = ((h % 24) + 24) % 24; return `${x % 12 === 0 ? 12 : x % 12} ${x < 12 ? 'am' : 'pm'}`; };
// Shares: whole percents in lists ("46%", "<1%"); one decimal for conversion rates ("3.0%").
const shareText = (n, of) => { if (!of) return ''; const p = (n / of) * 100; return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`; };
const rateText = (n, of) => (of ? `${((n / of) * 100).toFixed(1)}%` : '');
const dayIn = (iso, zone) => new Date(iso).toLocaleDateString('en-CA', { timeZone: zone });
const shiftDay = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function normalizeAnalytics(raw, requestedDays) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const ownHours = Array.isArray(d.hourly) && d.hourly.length > 0;
  const hourSource = ownHours ? d.hourly : (Array.isArray(d.hourlyUtc) ? d.hourlyUtc : []);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 0 }));
  for (const e of hourSource) { const h = Number(e?.hour); if (Number.isInteger(h) && h >= 0 && h < 24) hours[h].value += statNum(e.value); }
  const optional = (v) => (v == null ? null : statNum(v));
  const daily = (Array.isArray(d.daily) ? d.daily : []).filter((x) => x && x.day).map((x) => ({
    day: String(x.day).slice(0, 10), sessions: statNum(x.sessions),
    pageViews: optional(x.pageViews), visitors: optional(x.visitors), leads: optional(x.leads),
  }));
  const t = d.totals || {};
  const ev = d.events && typeof d.events === 'object' ? d.events : null;
  const dayZone = d.timezone || 'UTC';
  const days = Number(d.range?.days) || Number(requestedDays) || daily.length;
  // The calendar days covered: the reply's range, else the daily rows, else the last `days` days.
  const to = d.range?.to || daily[daily.length - 1]?.day || dayIn(Date.now(), dayZone);
  const from = d.range?.from || daily[0]?.day || shiftDay(to, -(Math.max(1, days) - 1));
  return {
    source: d.source === 'local' ? 'local' : 'shared',
    dayZone,
    hourZone: ownHours ? (d.timezone || 'UTC') : 'UTC',
    generatedAt: d.generatedAt,
    days,
    range: { from, to },
    totals: {
      sessions: statNum(t.sessions), uniqueVisitors: statNum(t.uniqueVisitors), pageViews: statNum(t.pageViews),
      pagesPerSession: statNum(t.pagesPerSession), avgDurationSeconds: statNum(t.avgDurationSeconds),
      medianDurationSeconds: statNum(t.medianDurationSeconds), totalDurationSeconds: statNum(t.totalDurationSeconds),
    },
    previous: d.previous && typeof d.previous === 'object' ? d.previous : null,
    daily,
    hours,
    hasHours: hours.some((h) => h.value > 0),
    events: ev ? { formStarts: statNum(ev.formStarts), leads: statNum(ev.leads), callClicks: statNum(ev.callClicks), textClicks: statNum(ev.textClicks) } : null,
    lists: Object.fromEntries(['referrers', 'referrerHosts', 'campaigns', 'countries', 'regions', 'cities', 'devices', 'browsers', 'operatingSystems', 'topPages', 'entryPages', 'exitPages'].map((k) => [k, statList(d[k])])),
  };
}

// Referring sites fold under their source with the same rule the site's tracker uses (static/analytics.js).
const SEARCH_HOST = /google|bing|duckduckgo|yahoo/;
const SOCIAL_HOST = /youtube|facebook|instagram|linkedin|tiktok|reddit/;
const hostSource = (h) => (SEARCH_HOST.test(h) ? 'search' : SOCIAL_HOST.test(h) ? 'social' : 'referral');
const SOURCE_NAMES = { search: 'Search', direct: 'Direct', social: 'Social', referral: 'Other sites' };

// Long ledgers show their first rows and a "Show all" button.
function foldRows(el, limit) {
  const rows = [...el.querySelectorAll('tbody tr[data-fold]')];
  if (rows.length <= limit) return;
  rows.forEach((tr, i) => { tr.hidden = i >= limit; });
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'textbtn list-more';
  b.setAttribute('aria-expanded', 'false');
  b.textContent = `Show all ${fmt(rows.length)}`;
  b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    rows.forEach((tr, i) => { tr.hidden = !open && i >= limit; });
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? 'Show fewer' : `Show all ${fmt(rows.length)}`;
  });
  el.appendChild(b);
}

function renderAnalytics(data, site) {
  const t = data.totals;
  const prev = data.previous;
  const against = `vs previous ${fmt(data.days)} day${data.days === 1 ? '' : 's'}`;
  const range = `${dayShort(data.range.from)} to ${dayShort(data.range.to)}`;
  const chip = (cur, before) => (prev && before != null ? changeChip(cur, before, { against }) : `<span>${esc(range)}</span>`);

  // KPI cards with the change against the previous period of the same length (when the reply has one).
  $('#analytics-kpis').innerHTML = [
    kpiCard({ icon: 'eye', label: 'Visits', value: fmt(t.sessions), foot: chip(t.sessions, prev?.sessions) }),
    kpiCard({ icon: 'users', label: 'Visitors', value: fmt(t.uniqueVisitors), foot: chip(t.uniqueVisitors, prev?.uniqueVisitors) }),
    kpiCard({ icon: 'file', label: 'Page views', value: fmt(t.pageViews), foot: `${prev && prev.pageViews != null ? changeChip(t.pageViews, prev.pageViews) : ''}<span>${esc(t.pagesPerSession.toFixed(2))} a visit</span>` }),
    kpiCard({ icon: 'clock', label: 'Average time on site', value: duration(t.avgDurationSeconds), foot: `<span>${esc(`${duration(t.medianDurationSeconds)} median, ${duration(t.totalDurationSeconds)} in all`)}</span>` }),
  ].join('');

  // Visits per day: a line, with leads per day in a gold strip under it when the reply has them.
  const daily = data.daily;
  const n = daily.length;
  const hasLeads = daily.some((d) => d.leads != null);
  const hasViews = daily.some((d) => d.pageViews != null);
  const hasVisitors = daily.some((d) => d.visitors != null);
  const peakDay = daily.reduce((best, d, i) => (d.sessions > (daily[best]?.sessions ?? -1) ? i : best), 0);
  $('#analytics-range').textContent = n ? `${dayShort(daily[0].day)} to ${dayShort(daily[n - 1].day)}, ${zoneName(data.dayZone)}` : '';
  $('#analytics-traffic-note').innerHTML = hasLeads && t.sessions ? '<span class="lg"><i class="lg-line"></i>Visits</span><span class="lg"><i class="lg-bar lead"></i>Leads</span>' : '';
  const plural = (v, one, many) => (v === 1 ? one : many);
  drawChart($('#analytics-traffic'), {
    kind: 'line', height: 240, points: t.sessions ? daily : [], value: (d) => d.sessions,
    label: `Visits per day${n ? `, ${dayShort(daily[0].day)} to ${dayShort(daily[n - 1].day)}` : ''}`,
    strip: hasLeads ? { name: 'Leads', value: (d) => d.leads || 0 } : null,
    xTicks: (W, count) => tickEvery(count, W < 480 ? 4 : count <= 10 ? count : 6), xLabel: (d) => dayShort(d.day),
    labelIdx: [n - 1, peakDay],
    tip: (d) => ({
      title: dayLong(d.day),
      rows: [
        { value: fmt(d.sessions), label: plural(d.sessions, 'visit', 'visits'), key: 'series' },
        d.pageViews != null && { value: fmt(d.pageViews), label: plural(d.pageViews, 'page view', 'page views') },
        d.visitors != null && { value: fmt(d.visitors), label: plural(d.visitors, 'visitor', 'visitors') },
        d.leads != null && { value: fmt(d.leads), label: plural(d.leads, 'lead', 'leads'), key: 'lead' },
      ].filter(Boolean),
    }),
    table: {
      caption: 'Visits per day',
      head: ['Day', 'Visits', hasViews && 'Page views', hasVisitors && 'Visitors', hasLeads && 'Leads'].filter(Boolean),
      rows: daily.map((d) => [dayLong(d.day), fmt(d.sessions), hasViews && fmt(d.pageViews), hasVisitors && fmt(d.visitors), hasLeads && fmt(d.leads)].filter((c) => c !== false)),
    },
    empty: 'No visits were recorded in this date range.',
  });

  // From visit to sale, as one statement: the site's own count, then what became of the same days' leads in HQ.
  const ev = data.events;
  const row = (label, rate, value, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th scope="row">${esc(label)}</th><td class="soft">${esc(rate)}</td><td>${esc(value)}</td></tr>`;
  const foot = [
    ev && prev?.leads != null ? `${fmt(ev.leads)} requests, ${changeChip(ev.leads, prev.leads, { percent: false })} against the previous ${fmt(data.days)} days.` : '',
    ev && (ev.callClicks || ev.textClicks) ? `Also ${fmt(ev.callClicks)} taps on the phone number and ${fmt(ev.textClicks)} on text.` : '',
  ].filter(Boolean).join(' ');
  $('#analytics-funnel').innerHTML = `<div class="card-head"><div><h3>From visit to sale</h3><p class="card-sub">${esc(range)}</p></div></div>
    <table class="ledger"><tbody>
      <tr class="group"><th scope="colgroup" colspan="3">On the website</th></tr>
      ${row('Visits', '', fmt(t.sessions))}
      ${ev ? row('Started the offer form', t.sessions ? `${rateText(ev.formStarts, t.sessions)} of visits` : '', fmt(ev.formStarts)) : ''}
      ${ev ? row('Sent a request', ev.formStarts ? `${rateText(ev.leads, ev.formStarts)} of starts` : '', fmt(ev.leads)) : ''}
      <tr class="group"><th scope="colgroup" colspan="3">In HQ, leads received on these days</th></tr>
    </tbody><tbody id="statement-hq"><tr><td class="soft" colspan="3" style="text-align:left">Counting leads…</td></tr></tbody></table>
    ${foot ? `<p class="note statement-foot">${foot}</p>` : ''}`;
  loadStatementLeads(site, data);

  // Where visits came from, and the devices they used: each a share of all visits.
  const srcBox = $('#analytics-sources');
  srcBox.hidden = !data.lists.referrers.length;
  srcBox.innerHTML = '<div class="card-head"><div><h3>Where visits came from</h3><p class="card-sub">Share of visits</p></div></div><div></div>';
  drawDonut(srcBox.lastElementChild, { rows: data.lists.referrers.map((s) => ({ label: SOURCE_NAMES[s.key] || capFirst(s.key || '(not set)'), value: s.value })), center: fmt(t.sessions), centerLabel: 'visits', label: 'Where visits came from' });
  const devBox = $('#analytics-devices');
  devBox.hidden = !data.lists.devices.length;
  devBox.innerHTML = '<div class="card-head"><div><h3>Devices</h3><p class="card-sub">Share of visits</p></div></div><div></div>';
  drawDonut(devBox.lastElementChild, { rows: data.lists.devices.map((s) => ({ label: capFirst(s.key || '(not set)'), value: s.value })), center: fmt(data.lists.devices.reduce((m, s) => m + s.value, 0)), centerLabel: 'visits', label: 'Devices used for visits' });

  // Hours of the day: 24 small columns in hour order, in the zone the reply names.
  const hoursBox = $('#analytics-hours');
  hoursBox.hidden = !data.hasHours;
  if (data.hasHours) {
    hoursBox.innerHTML = `<div class="card-head"><div><h3>Visits by hour</h3><p class="card-sub">${esc(zoneName(data.hourZone))}</p></div></div><div class="chart" id="analytics-hours-chart"></div>`;
    const peak = data.hours.reduce((best, h, i) => (h.value > data.hours[best].value ? i : best), 0);
    drawChart($('#analytics-hours-chart'), {
      kind: 'columns', height: 132, points: data.hours, value: (h) => h.value,
      label: `Visits by hour of day, ${zoneName(data.hourZone)}`,
      xTicks: () => [0, 6, 12, 18], xLabel: (h) => hourName(h.hour), labelIdx: [peak],
      tip: (h) => ({ title: `${hourName(h.hour)} to ${hourName(h.hour + 1)}`, rows: [{ value: fmt(h.value), label: h.value === 1 ? 'visit' : 'visits', key: 'series' }] }),
      table: { caption: `Visits by hour, ${zoneName(data.hourZone)}`, head: ['Hour', 'Visits'], rows: data.hours.map((h) => [`${hourName(h.hour)} to ${hourName(h.hour + 1)}`, fmt(h.value)]) },
    });
  } else hoursBox.innerHTML = '';

  // Top pages: each page's views, and the share of all visits that began on it.
  const entries = new Map(data.lists.entryPages.map((e) => [e.key, e.value]));
  const viewed = new Set(data.lists.topPages.map((p) => p.key));
  const pages = [...data.lists.topPages, ...data.lists.entryPages.filter((e) => !viewed.has(e.key)).map((e) => ({ key: e.key, value: null }))];
  const pageBox = $('#analytics-pages');
  pageBox.hidden = !pages.length;
  pageBox.innerHTML = pages.length
    ? `<div class="card-head"><div><h3>Top pages</h3><p class="card-sub">Views, and the share of visits that started on the page</p></div></div><div class="table-wrap"><table><thead><tr><th>Page</th><th class="num-col">Views</th><th class="num-col">Visits started here</th></tr></thead><tbody>${pages.map((p) => `<tr data-fold><td class="path">${esc(p.key || '(not set)')}</td><td class="num-col"><strong>${p.value == null ? '—' : fmt(p.value)}</strong></td><td class="num-col">${entries.has(p.key) ? shareText(entries.get(p.key), t.sessions) : '—'}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  if (pages.length) { foldRows(pageBox, 8); pageBox.querySelector('.list-more')?.classList.add('pad'); }

  // Referring sites and campaigns: ranked bars.
  const hosts = data.lists.referrerHosts.map((h) => ({ label: h.key.replace(/^www\./, '') || '(not set)', value: h.value }));
  const campaigns = data.lists.campaigns.map((c) => ({ label: c.key || '(not set)', value: c.value }));
  const refBox = $('#analytics-referrers');
  refBox.hidden = !hosts.length && !campaigns.length;
  refBox.innerHTML = `<div class="card-head"><div><h3>Referring sites</h3><p class="card-sub">Visits from each site</p></div></div><div id="analytics-hosts"></div>${campaigns.length ? '<h4 class="sub-head">Campaigns</h4><div id="analytics-campaigns"></div>' : ''}`;
  barList($('#analytics-hosts'), hosts.slice(0, 8), { empty: 'No referring sites' });
  if (campaigns.length) barList($('#analytics-campaigns'), campaigns.slice(0, 6));

  // Reference: browsers, systems, last pages and places, as short lines of text.
  const refs = [['Browsers', 'browsers'], ['Systems', 'operatingSystems'], ['Last page seen', 'exitPages'], ['Countries', 'countries'], ['States', 'regions'], ['Cities', 'cities']]
    .filter(([, key]) => data.lists[key].length);
  const groupBox = $('#analytics-groups');
  groupBox.hidden = !refs.length;
  groupBox.innerHTML = refs.length
    ? `<div class="card-head"><div><h3>For reference</h3><p class="card-sub">Share of visits</p></div></div><dl>${refs.map(([name, key]) => `<dt>${esc(name)}</dt><dd>${data.lists[key].slice(0, 6).map((e) => `<span>${esc(e.key || '(not set)')} ${shareText(e.value, t.sessions)}</span>`).join(' ')}</dd>`).join('')}</dl>`
    : '';
}

// The second half of the statement: leads from the same brand created on the same calendar days, and where each
// one stands now. Reads the ordinary leads list (newest 200), so a very busy range is marked "at least".
async function loadStatementLeads(site, data) {
  const request = ++statementRequest;
  const body = $('#statement-hq');
  const row = (label, rate, value, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th scope="row">${esc(label)}</th><td class="soft">${esc(rate)}</td><td>${esc(value)}</td></tr>`;
  try {
    const r = await api('leads', { params: { view: 'all', brand: site, limit: '200' } });
    if (request !== statementRequest || !body.isConnected) return;
    const zone = data.dayZone;
    const { from, to } = data.range;
    const inRange = (l) => { const day = dayIn(l.created_at, zone); return day >= from && day <= to; };
    const leads = r.leads.filter((l) => l.status !== 'spam' && inRange(l));
    const oldest = r.leads[r.leads.length - 1];
    const partial = r.leads.length >= r.limit && oldest && dayIn(oldest.created_at, zone) >= from;
    const count = (stages) => leads.filter((l) => stages.includes(l.status)).length;
    const total = leads.length;
    const appointment = count(['appointment_set', 'property_reviewed', 'options_presented', 'under_contract', 'closed_won']);
    const contract = count(['under_contract', 'closed_won']);
    const closed = count(['closed_won']);
    const of = (n) => (total ? `${rateText(n, total)} of leads` : '');
    body.innerHTML = [
      row('Leads, any channel', partial ? 'at least' : '', fmt(total)),
      row('Reached an appointment', of(appointment), fmt(appointment)),
      row('Went under contract', of(contract), fmt(contract)),
      row('Closed', of(closed), fmt(closed), 'total'),
    ].join('');
  } catch (error) {
    if (request === statementRequest && body.isConnected) body.innerHTML = `<tr><td class="soft" colspan="3" style="text-align:left">${esc(error.message || 'Leads could not be counted.')}</td></tr>`;
  }
}

async function loadAnalytics() {
  const request = ++analyticsRequest;
  const days = $('#analytics-days').value;
  const site = $('#analytics').dataset.site || 'harbison_standard';
  const label = site === 'call_harbison' ? 'Call Harbison' : 'Harbison Standard';
  const host = site === 'call_harbison' ? 'callharbison.com' : 'harbisonstandard.com';
  $('#analytics-title').textContent = `${label} website`;
  if (analyticsShownSite !== site) $('#analytics-source').textContent = host;
  $('#analytics-status').textContent = 'Loading…';
  $('#analytics-error').hidden = true;
  // Refetch keeps the frame: the same site's previous numbers stay, dimmed, until the new ones arrive.
  const content = $('#analytics-content');
  const keepFrame = analyticsShownSite === site && !content.hidden;
  if (keepFrame) { content.classList.add('is-stale'); content.setAttribute('aria-busy', 'true'); } else content.hidden = true;
  try {
    const result = await api('analytics', { params: { days, site } });
    if (request !== analyticsRequest || $('#analytics').hidden || $('#analytics').dataset.site !== site) return;
    const data = normalizeAnalytics(result.analytics, days);
    $('#analytics-source').textContent = `${host}, ${data.source === 'local' ? 'counted on this server' : 'counted by the shared Harbison collector'}, days in ${zoneName(data.dayZone)}`;
    $('#analytics-tz').textContent = data.dayZone === data.hourZone
      ? `Days and hours use ${zoneName(data.dayZone)}.`
      : `Days use ${zoneName(data.dayZone)}; hours use ${zoneName(data.hourZone)}.`;
    content.hidden = false;
    renderAnalytics(data, site);
    analyticsShownSite = site;
    $('#analytics-status').textContent = `Updated ${new Date(data.generatedAt || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) {
    if (request !== analyticsRequest) return;
    $('#analytics-status').textContent = '';
    $('#analytics-error').textContent = error.message || 'Website stats could not be loaded.';
    $('#analytics-error').hidden = false;
    content.hidden = true;
    analyticsShownSite = '';
  } finally {
    if (request === analyticsRequest) { content.classList.remove('is-stale'); content.removeAttribute('aria-busy'); }
  }
}
$('#analytics-days').addEventListener('change', loadAnalytics);
$('#analytics-refresh').addEventListener('click', loadAnalytics);
