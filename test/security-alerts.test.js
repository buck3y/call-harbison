// Alerts: no built-in recipients, a daily ceiling on customer acknowledgement texts, and an optional signature on
// every webhook post.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import leads, { deliver, deliverDetails, notificationRecipients, parseDetails, parseLead, resetLeadLimiters } from '../api/leads.js';
import hq, { COOKIE, makeSession, resetHqLimits } from '../api/hq.js';
import { alertIntents, publicAlertSender, resetAckCount, takeAckSlot, webhookHeaders } from '../lib/lead-alerts.js';
import { startupNotes } from '../server.mjs';
import { db, installMockSupabase } from '../dev/mock-supabase.mjs';

const seller = { form_type: 'options', street: '77 Alert Test Way', city: 'Bakersfield', zip: '93301', name: 'Alert Tester', phone: '(661) 555-0177', consent_response: 'yes', situation: 'I inherited the property' };
function response() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.setHeader = (k, v) => (res.headers[k] = v);
  return res;
}
// Every outside request is recorded; the mock database answers its own.
function recordOutside() {
  const databaseFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('http://mock.supabase.local')) return databaseFetch(url, init);
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'provider-receipt', sid: 'SM1' }), { status: 200 });
  };
  return calls;
}

let warnings = [];
beforeEach(() => { resetLeadLimiters(); resetHqLimits(); resetAckCount(); warnings = []; console.warn = (...a) => warnings.push(a.join(' ')); });

test('without LEAD_NOTIFY_EMAIL no e-mail is attempted, the lead is stored, and the start-up notes say why', async () => {
  const original = globalThis.fetch;
  const env = { RESEND_API_KEY: 're_test' };
  installMockSupabase(env);
  const calls = recordOutside();
  try {
    assert.deepEqual(notificationRecipients(env), []);
    const res = response();
    await leads({ method: 'POST', headers: { 'x-real-ip': '192.0.2.10' }, body: { ...seller, submission_id: randomUUID() } }, res, env);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(db.leads.some((l) => l.id === res.body.id), 'the lead is stored and shown in HQ');
    const details = await deliverDetails(parseDetails({ id: res.body.id, phone: seller.phone, address: '77 Alert Test Way, Bakersfield, CA 93301', occupancy: 'Vacant' }), env);
    assert.equal(details.ok, true);
    assert.deepEqual(calls.filter((c) => c.url.includes('resend.com')), [], 'no request to the mail service');
    assert.deepEqual(alertIntents({ ...parseLead(seller).lead, id: randomUUID() }, env, { recipients: notificationRecipients(env) }).filter((j) => j.channel === 'email'), [], 'nor a queued one');
    assert.ok(startupNotes(env).includes('New-lead e-mail is off: LEAD_NOTIFY_EMAIL is not set. Leads are still stored and shown in HQ.'));
    assert.ok(startupNotes({}).some((n) => n.startsWith('New-lead e-mail is off: RESEND_API_KEY and LEAD_NOTIFY_EMAIL are not set.')));
    assert.ok(!startupNotes({ RESEND_API_KEY: 'k', LEAD_NOTIFY_EMAIL: 'a@example.invalid' }).some((n) => n.includes('e-mail is off')));
    // The queued protocol (not live yet) refuses an inquiry it can alert nobody about: said loudly at start.
    const reliable = (extra) => startupNotes({ LEAD_RELIABILITY_ENABLED: 'true', RESEND_API_KEY: 'k', ...extra }).some((n) => n.startsWith('LEAD_RELIABILITY_ENABLED is on but no staff alert'));
    assert.equal(reliable({}), true);
    assert.equal(reliable({ LEAD_NOTIFY_EMAIL: 'a@example.invalid' }), false);
    assert.equal(reliable({ LEAD_WEBHOOK_URL: 'https://hooks.invalid/x' }), false);
  } finally { globalThis.fetch = original; }
});

test('HQ health and test-alert know there are no recipients and send nothing', async () => {
  const original = globalThis.fetch;
  const env = { HQ_PASSWORD: 'correct horse battery staple', RESEND_API_KEY: 're_test', LEAD_FROM_EMAIL: 'Leads <leads@callharbison.com>' };
  installMockSupabase(env);
  const calls = recordOutside();
  try {
    const cookie = `${COOKIE}=${makeSession('Nate', env)}`;
    const health = response();
    await hq({ method: 'GET', url: '/api/hq?action=health', headers: { cookie } }, health, env);
    assert.equal(health.body.health.email.configured, false);
    assert.deepEqual(health.body.health.email.missing, ['LEAD_NOTIFY_EMAIL']);
    assert.deepEqual(health.body.health.email.recipients, []);
    const alert = response();
    await hq({ method: 'POST', url: '/api/hq?action=test-alert', headers: { cookie, 'x-hq': '1' }, body: {} }, alert, env);
    assert.equal(alert.statusCode, 502);
    assert.deepEqual(alert.body.channels, [{ channel: 'email', ok: false, detail: 'LEAD_NOTIFY_EMAIL is not set, so new-lead e-mail is off' }]);
    assert.deepEqual(calls, [], 'nothing was sent');
  } finally { globalThis.fetch = original; }
});

test('customer acknowledgement texts stop at LEAD_ACK_DAILY_MAX a day; staff alerts do not', async () => {
  const original = globalThis.fetch;
  const env = { TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_AUTH_TOKEN: 'token', TWILIO_FROM: '+16615550100', LEAD_ALERT_SMS: '+16615550199', LEAD_ACK_ENABLED: 'true', LEAD_ACK_DAILY_MAX: '2' };
  installMockSupabase(env);
  const calls = recordOutside();
  try {
    for (let n = 1; n <= 4; n += 1) {
      const lead = { ...parseLead({ ...seller, phone: `(661) 555-02${String(n).padStart(2, '0')}` }).lead, id: randomUUID() };
      assert.equal((await deliver(lead, env)).ok, true);
    }
    const texts = calls.filter((c) => c.url.includes('api.twilio.com')).map((c) => new URLSearchParams(c.init.body).get('To'));
    assert.equal(texts.filter((to) => to === '+16615550199').length, 4, 'every staff alert went out');
    assert.deepEqual(texts.filter((to) => to !== '+16615550199'), ['+16615550201', '+16615550202'], 'two acknowledgements, then none');
    assert.equal(warnings.filter((l) => l.includes('LEAD_ACK_DAILY_MAX')).length, 1, 'one line when the ceiling is reached');
    // The same ceiling holds for the queued (reliable) path, and a new Bakersfield day starts afresh.
    resetAckCount();
    const day = Date.parse('2026-11-27T20:00:00Z');
    assert.deepEqual([1, 2, 3].map(() => takeAckSlot({ LEAD_ACK_DAILY_MAX: '2' }, day, () => {})), [true, true, false]);
    assert.equal(takeAckSlot({ LEAD_ACK_DAILY_MAX: '2' }, day + 864e5, () => {}), true);
    resetAckCount();
    assert.equal(Array.from({ length: 31 }, () => takeAckSlot({}, day, () => {})).filter(Boolean).length, 30, 'the default is 30');
  } finally { globalThis.fetch = original; }
});

test('with LEAD_WEBHOOK_SECRET every webhook post is signed over its exact body', async () => {
  const original = globalThis.fetch;
  const secret = 'webhook-secret-for-tests-0123456789';
  const env = { LEAD_WEBHOOK_URL: 'https://hooks.invalid/lead', LEAD_WEBHOOK_SECRET: secret, HQ_PASSWORD: 'correct horse battery staple' };
  installMockSupabase(env);
  const calls = recordOutside();
  const verify = (call) => {
    const header = call.init.headers['X-Call-Harbison-Signature'];
    assert.match(header, /^sha256=[0-9a-f]{64}$/);
    assert.equal(header, `sha256=${createHmac('sha256', secret).update(call.init.body).digest('hex')}`);
    assert.notEqual(header, `sha256=${createHmac('sha256', 'another secret').update(call.init.body).digest('hex')}`);
  };
  try {
    const lead = { ...parseLead(seller).lead, id: randomUUID() };
    assert.equal((await deliver(lead, env)).ok, true);
    assert.equal((await deliverDetails(parseDetails({ id: lead.id, phone: lead.phone, address: lead.address, occupancy: 'Vacant' }), env)).ok, true);
    const res = response();
    await hq({ method: 'POST', url: '/api/hq?action=test-alert', headers: { cookie: `${COOKIE}=${makeSession('Nate', env)}`, 'x-hq': '1' }, body: {} }, res, env);
    const hooks = calls.filter((c) => c.url === env.LEAD_WEBHOOK_URL);
    assert.equal(hooks.length, 3, 'the lead, its details and the HQ test alert');
    hooks.forEach(verify);
    // The queued path signs at send time; the stored job holds no secret.
    const [job] = alertIntents(lead, env, { recipients: [] }).filter((j) => j.channel === 'webhook');
    assert.ok(!JSON.stringify(job).includes(secret));
    const [url, options] = publicAlertSender(env).prepare(job);
    assert.equal(url, env.LEAD_WEBHOOK_URL);
    verify({ init: options });
    assert.equal(webhookHeaders('{}', { LEAD_WEBHOOK_URL: 'x' })['X-Call-Harbison-Signature'], undefined, 'no secret, no header');
  } finally { globalThis.fetch = original; }
});
