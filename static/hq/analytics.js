// Website stats. Uses the existing HQ session; aggregates are proxied by the server, and no cross-site credentials
// reach this page. Two reply shapes are accepted: the local store's (source 'local', days and hours in the business's
// time zone, with daily page views, visitors and leads, events and the previous period) and the shared collector's
// (source 'shared' or absent, UTC, `hourlyUtc`, daily sessions only, no events, previous or range).
let analyticsRequest = 0;
let analyticsShownSite = '';
const duration = (value) => {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};
const ZONE_NAMES = { 'America/Los_Angeles': 'Pacific time', UTC: 'UTC' };
const zoneName = (tz) => ZONE_NAMES[tz] || tz || 'UTC';
const statNum = (v) => Math.max(0, Number(v) || 0);
const statList = (v) => (Array.isArray(v) ? v : [])
  .map((e) => ({ key: String(e?.key ?? '').trim(), value: statNum(e?.value) }))
  .filter((e) => e.value > 0);
const hourName = (h) => { const x = ((h % 24) + 24) % 24; return `${x % 12 === 0 ? 12 : x % 12} ${x < 12 ? 'am' : 'pm'}`; };

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
  return {
    source: d.source === 'local' ? 'local' : 'shared',
    dayZone: d.timezone || 'UTC',
    hourZone: ownHours ? (d.timezone || 'UTC') : 'UTC',
    generatedAt: d.generatedAt,
    days: Number(d.range?.days) || Number(requestedDays) || daily.length,
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

// [group title, [[list title, key, share of]]]. Groups with no data are left out.
const STAT_GROUPS = [
  ['Where visits came from', [['Sources', 'referrers', 'sessions'], ['Referring sites', 'referrerHosts', 'sessions'], ['Campaigns', 'campaigns', 'sessions']]],
  ['What people looked at', [['Pages', 'topPages', 'pageViews'], ['Entry pages', 'entryPages', 'sessions'], ['Exit pages', 'exitPages', 'sessions']]],
  ['What they used', [['Devices', 'devices', 'sessions'], ['Browsers', 'browsers', 'sessions'], ['Operating systems', 'operatingSystems', 'sessions']]],
  ['Where they were', [['Countries', 'countries', 'sessions'], ['States and regions', 'regions', 'sessions'], ['Cities', 'cities', 'sessions']]],
];
const CAPITALISE = new Set(['referrers', 'devices']);

function renderAnalytics(data) {
  const t = data.totals;
  const prev = data.previous;
  const period = `previous ${fmt(data.days)} day${data.days === 1 ? '' : 's'}`;
  const change = (cur, before, absolute = false) => {
    if (!prev || before == null) return '';
    const c = statNum(cur);
    const p = statNum(before);
    let text = 'No change';
    let dir = 0;
    if (absolute || p === 0) {
      const diff = c - p;
      dir = Math.sign(diff);
      if (diff) text = `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`;
    } else {
      const r = ((c - p) / p) * 100;
      const abs = Math.abs(r);
      const shown = abs >= 10 ? String(Math.round(abs)) : abs.toFixed(1);
      if (shown !== '0.0' && shown !== '0') { dir = Math.sign(r); text = `${dir > 0 ? '+' : '−'}${shown}%`; }
    }
    return `<span class="delta${dir > 0 ? ' up' : dir < 0 ? ' down' : ''}">${text}</span> vs ${period}`;
  };
  const statFigure = (label, value, lines) => `<div class="fig"><div class="fig-l">${esc(label)}</div><div class="fig-v">${esc(value)}</div><div class="fig-m">${lines.filter(Boolean).map((l) => `<div class="fig-s">${l}</div>`).join('')}</div></div>`;
  $('#analytics-kpis').innerHTML = [
    statFigure('Sessions', fmt(t.sessions), [change(t.sessions, prev?.sessions)]),
    statFigure('Visitors', fmt(t.uniqueVisitors), [change(t.uniqueVisitors, prev?.uniqueVisitors), 'Sum of daily estimates']),
    statFigure('Page views', fmt(t.pageViews), [change(t.pageViews, prev?.pageViews), `${t.pagesPerSession.toFixed(2)} per session`]),
    statFigure('Average time on site', duration(t.avgDurationSeconds), [`${esc(duration(t.medianDurationSeconds))} median`, `${esc(duration(t.totalDurationSeconds))} in total`]),
  ].join('');

  // The main chart: sessions per day as a line, with leads per day in a gold strip under it when the reply has them.
  const daily = data.daily;
  const n = daily.length;
  const hasLeads = daily.some((d) => d.leads != null);
  const hasViews = daily.some((d) => d.pageViews != null);
  const hasVisitors = daily.some((d) => d.visitors != null);
  const peakDay = daily.reduce((best, d, i) => (d.sessions > (daily[best]?.sessions ?? -1) ? i : best), 0);
  $('#analytics-traffic-note').innerHTML = n
    ? `<span>${esc(`${dayShort(daily[0].day)} to ${dayShort(daily[n - 1].day)}, ${zoneName(data.dayZone)}`)}</span>${hasLeads && t.sessions ? '<span class="lg"><i class="lg-line"></i>Sessions</span><span class="lg"><i class="lg-bar lead"></i>Leads</span>' : ''}`
    : '';
  const plural = (v, one, many) => `${v === 1 ? one : many}`;
  drawChart($('#analytics-traffic'), {
    kind: 'line', height: 260, points: t.sessions ? daily : [], value: (d) => d.sessions,
    label: `Sessions per day${n ? `, ${dayShort(daily[0].day)} to ${dayShort(daily[n - 1].day)}` : ''}`,
    strip: hasLeads ? { name: 'Leads', value: (d) => d.leads || 0 } : null,
    xTicks: (W, count) => tickEvery(count, W < 480 ? 4 : count <= 10 ? count : 7), xLabel: (d) => dayShort(d.day),
    labelIdx: [n - 1, peakDay],
    tip: (d) => ({
      title: dayLong(d.day),
      rows: [
        { value: fmt(d.sessions), label: plural(d.sessions, 'session', 'sessions'), key: 'series' },
        d.pageViews != null && { value: fmt(d.pageViews), label: plural(d.pageViews, 'page view', 'page views') },
        d.visitors != null && { value: fmt(d.visitors), label: plural(d.visitors, 'visitor', 'visitors') },
        d.leads != null && { value: fmt(d.leads), label: plural(d.leads, 'lead', 'leads'), key: 'lead' },
      ].filter(Boolean),
    }),
    table: {
      caption: 'Sessions per day',
      head: ['Day', 'Sessions', hasViews && 'Page views', hasVisitors && 'Visitors', hasLeads && 'Leads'].filter(Boolean),
      rows: daily.map((d) => [dayLong(d.day), fmt(d.sessions), hasViews && fmt(d.pageViews), hasVisitors && fmt(d.visitors), hasLeads && fmt(d.leads)].filter((c) => c !== false)),
    },
    empty: 'No website sessions were recorded in this date range.',
  });

  // From visit to lead: three steps on one baseline, the rates between them written out.
  const ev = data.events;
  const funnel = $('#analytics-funnel');
  $('#analytics-row').classList.toggle('no-funnel', !ev);
  if (ev && t.sessions) {
    const max = Math.max(1, t.sessions);
    const step = (label, value, rate, lead = false) => `<li><span class="k">${esc(label)}</span><span class="v">${fmt(value)}</span><span class="b${lead ? ' lead' : ''}" style="width:${Math.max(0, (value / max) * 100).toFixed(2)}%"></span>${rate ? `<span class="r">${rate}</span>` : ''}</li>`;
    const leadRate = [ev.formStarts ? `${pctText(ev.leads / ev.formStarts)} of form starts` : '', `${pctText(ev.leads / t.sessions)} of sessions`].filter(Boolean).join(', ');
    const leadChange = change(ev.leads, prev?.leads, true);
    funnel.hidden = false;
    funnel.innerHTML = `<h3 style="margin-bottom:16px">From visit to lead</h3><ol class="funnel">${[
      step('Sessions', t.sessions, ''),
      step('Form starts', ev.formStarts, `${pctText(ev.formStarts / t.sessions)} of sessions`),
      step('Leads sent', ev.leads, `${esc(leadRate)}${leadChange ? `<br>${leadChange}` : ''}`, true),
    ].join('')}</ol><p class="funnel-also">Also ${fmt(ev.callClicks)} call ${ev.callClicks === 1 ? 'click' : 'clicks'} and ${fmt(ev.textClicks)} text ${ev.textClicks === 1 ? 'click' : 'clicks'}, ${pctText(ev.callClicks / t.sessions)} and ${pctText(ev.textClicks / t.sessions)} of sessions.</p>`;
  } else {
    funnel.hidden = true;
    funnel.innerHTML = '';
  }

  // Hours of the day: 24 columns in hour order, in the zone the reply names.
  const hoursBox = $('#analytics-hours');
  if (data.hasHours) {
    hoursBox.hidden = false;
    hoursBox.innerHTML = `<div class="chart-head"><h3>Sessions by hour, ${esc(zoneName(data.hourZone))}</h3></div><div class="chart" id="analytics-hours-chart"></div>`;
    const peak = data.hours.reduce((best, h, i) => (h.value > data.hours[best].value ? i : best), 0);
    drawChart($('#analytics-hours-chart'), {
      kind: 'columns', height: 160, points: data.hours, value: (h) => h.value,
      label: `Sessions by hour of day, ${zoneName(data.hourZone)}`,
      xTicks: () => [0, 6, 12, 18], xLabel: (h) => hourName(h.hour), labelIdx: [peak],
      tip: (h) => ({ title: `${hourName(h.hour)} to ${hourName(h.hour + 1)}`, rows: [{ value: fmt(h.value), label: h.value === 1 ? 'session' : 'sessions', key: 'series' }] }),
      table: { caption: `Sessions by hour, ${zoneName(data.hourZone)}`, head: ['Hour', 'Sessions'], rows: data.hours.map((h) => [`${hourName(h.hour)} to ${hourName(h.hour + 1)}`, fmt(h.value)]) },
    });
  } else {
    hoursBox.hidden = true;
    hoursBox.innerHTML = '';
  }
  $('#analytics-row').hidden = funnel.hidden && hoursBox.hidden;

  // Ranked lists, grouped. Empty lists and empty groups are left out.
  const groups = $('#analytics-groups');
  groups.innerHTML = STAT_GROUPS.map(([title, lists]) => {
    const present = lists.filter(([, key]) => data.lists[key].length);
    if (!present.length) return '';
    return `<div class="group"><h3>${esc(title)}</h3><div class="group-lists">${present.map(([name, key]) => `<div><h4>${esc(name)}</h4><div id="analytics-list-${key}"></div></div>`).join('')}</div></div>`;
  }).join('');
  for (const [, lists] of STAT_GROUPS) {
    for (const [, key, shareOf] of lists) {
      const el = $(`#analytics-list-${key}`);
      if (!el) continue;
      const rows = data.lists[key].map((e) => ({ label: e.key ? (CAPITALISE.has(key) ? capFirst(e.key) : e.key) : '(not set)', value: e.value }));
      rankList(el, rows, { total: shareOf === 'pageViews' ? t.pageViews : t.sessions });
    }
  }
}

async function loadAnalytics() {
  const request = ++analyticsRequest;
  const days = $('#analytics-days').value;
  const site = $('#analytics').dataset.site || 'harbison_standard';
  const label = site === 'call_harbison' ? 'Call Harbison' : 'Harbison Standard';
  const host = site === 'call_harbison' ? 'www.callharbison.com' : 'www.harbisonstandard.com';
  $('#analytics-title').textContent = `${label} website stats`;
  if (analyticsShownSite !== site) $('#analytics-source').textContent = `${host}. Recorded first-party analytics.`;
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
    $('#analytics-source').textContent = `${host}. ${data.source === 'local' ? 'Recorded on this server' : 'Recorded by the shared Harbison collector'}; days in ${zoneName(data.dayZone)}.`;
    $('#analytics-tz').textContent = data.dayZone === data.hourZone
      ? (data.dayZone === 'UTC' ? 'Daily buckets use UTC.' : `Days and hours use ${zoneName(data.dayZone)}.`)
      : `Days use ${zoneName(data.dayZone)}; hours use ${zoneName(data.hourZone)}.`;
    content.hidden = false;
    renderAnalytics(data);
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
