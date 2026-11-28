// The model path and every way it can fail. The model may choose; when it cannot (not configured, refused by the
// privacy page, over the daily ceiling, slow, refusing, broken, redirected), the search alone answers, and the visitor
// never sees a 5xx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantHandler, assistantStatus } from '../api/assistant.js';
import { indexFromSource } from '../lib/assistant/source.js';
import { prepareIndex } from '../lib/assistant/service.js';
import { MODEL_TIMEOUT_MS, modelSettings, readReply } from '../lib/assistant/model.js';

const ENV = { ASSISTANT: 'on', ASSISTANT_API_URL: 'https://model.example.test/v1/chat/completions', ASSISTANT_MODEL: 'stand-in-1', ASSISTANT_PROVIDER_NAME: 'Stand-in Co' };
const index = prepareIndex(indexFromSource({ providerName: 'Stand-in Co' }));

let ip = 0;
async function ask(handler, message, { lang = 'en', history } = {}) {
  ip += 1; // a fresh address each time, so the per-address limit never interferes here
  const res = { statusCode: 200, headers: {} };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (v) => { res.body = v; return res; };
  await handler({ method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `203.0.113.${ip % 250}` }, body: JSON.stringify({ message, lang, history }) }, res);
  return res;
}
const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
function model(respond) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return respond(calls.length, init); };
  return { fetch, calls };
}
const candidatesOf = (call) => JSON.parse(call.body.messages[1].content).answers;
const logs = [];
const make = (fetch, env = ENV, extra = {}) => createAssistantHandler({ env, index, fetch, log: (l) => logs.push(l), ...extra });

test('a valid pick: the picked answers, as the website wrote them, in the order chosen', async () => {
  const m = model(() => reply('{"pick":[2,1],"kind":"answered"}'));
  logs.length = 0;
  const res = await ask(make(m.fetch), 'do you charge fees or commission');
  const sent = candidatesOf(m.calls[0]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.answers.map((a) => a.question), [sent[1].question, sent[0].question]);
  assert.match(logs.at(-1), /^\[assistant\] answered 2 model \d+ms$/);
});

test('each kind: greeting, off_topic, personal and none produce their fixed replies', async () => {
  const cases = { greeting: 'x-greeting', off_topic: 'x-off-topic', personal: 'x-handoff', none: 'x-handoff' };
  for (const [kind, id] of Object.entries(cases)) {
    for (const lang of ['en', 'es']) {
      const res = await ask(make(model(() => reply(`{"pick":[],"kind":"${kind}"}`)).fetch), 'something', { lang });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.answers.map((a) => a.id), [id], kind);
      assert.equal(res.body.answers[0].text, index.fixed(lang, id).text);
      assert.equal(res.body.handoff, id === 'x-handoff', kind);
    }
  }
});

test('invalid JSON, numbers not offered, a wrong kind: treated as no reply, the search alone answers', async () => {
  for (const bad of ['not json', '{"pick":[42],"kind":"answered"}', '{"pick":[1],"kind":"maybe"}', '{"pick":[1,1],"kind":"answered"}']) {
    logs.length = 0;
    const res = await ask(make(model(() => reply(bad)).fetch), 'do you charge fees or commission');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.answers[0].question, 'Are there fees or commissions?', bad);
    assert.match(logs.at(-1), /^\[assistant\] answered 1 local \d+ms$/);
  }
  assert.equal(readReply('{"pick":[1],"kind":"answered"}', 0), null, 'no candidates, nothing to pick');
  assert.deepEqual(readReply(' ```json\n{"pick":[2],"kind":"answered","extra":"x"}\n``` ', 3), { pick: [2], kind: 'answered' });
  assert.deepEqual(readReply('{"kind":"none"}', 3), { pick: [], kind: 'none' });
});

test('a 429 or a 500: the search answers, and the model is left alone for a while (no retry storm)', async () => {
  for (const status of [429, 500]) {
    let t = Date.parse('2026-11-27T18:00:00Z');
    const m = model(() => new Response('{"error":"busy"}', { status, headers: status === 429 ? { 'retry-after': '120' } : {} }));
    const handler = make(m.fetch, ENV, { now: () => t });
    const first = await ask(handler, 'do you charge fees or commission');
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.answers[0].question, 'Are there fees or commissions?');
    assert.equal(m.calls.length, 1);
    t += 10_000;
    await ask(handler, 'how fast can you close');
    assert.equal(m.calls.length, 1, `paused after ${status}`);
    t += status === 429 ? 121_000 : 31_000;
    await ask(handler, 'how fast can you close');
    assert.equal(m.calls.length, 2, 'asked again once the pause is over');
  }
});

test('a network error is retried once; a redirect is refused; a timeout is not retried', async () => {
  const dropped = model(() => { throw new TypeError('fetch failed'); });
  const res = await ask(make(dropped.fetch), 'do you charge fees or commission');
  assert.equal(res.statusCode, 200);
  assert.equal(dropped.calls.length, 2, 'one retry');
  assert.equal(res.body.answers[0].question, 'Are there fees or commissions?');
  // fetch with redirect: "error" rejects on a 3xx; the stand-in does what fetch does.
  const moved = model((n, init) => { assert.equal(init.redirect, 'error'); throw new TypeError('fetch failed: unexpected redirect'); });
  assert.equal((await ask(make(moved.fetch), 'how fast can you close')).statusCode, 200);
  const late = model(() => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); });
  assert.equal((await ask(make(late.fetch), 'how fast can you close')).statusCode, 200);
  assert.equal(late.calls.length, 1);
});

test(`a slow model: after ${MODEL_TIMEOUT_MS / 1000} seconds the search answers`, async () => {
  const slow = model((n, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(reply('{"pick":[1],"kind":"answered"}')), 30_000);
    init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); });
  }));
  const started = Date.now();
  const res = await ask(make(slow.fetch), 'do you charge fees or commission');
  const took = Date.now() - started;
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.answers[0].question, 'Are there fees or commissions?');
  assert.ok(took >= MODEL_TIMEOUT_MS - 100 && took < MODEL_TIMEOUT_MS + 2000, `${took}ms`);
  assert.equal(slow.calls.length, 1);
});

test('a service that refuses response_format (400) is asked without it from then on', async () => {
  const m = model((n, init) => (JSON.parse(init.body).response_format ? new Response('{"error":"response_format not supported"}', { status: 400 }) : reply('{"pick":[1],"kind":"answered"}')));
  const handler = make(m.fetch);
  assert.equal((await ask(handler, 'do you charge fees')).statusCode, 200);
  await ask(handler, 'do you charge fees');
  assert.equal(m.calls.length, 2);
  assert.ok(m.calls[0].body.response_format && !m.calls[1].body.response_format);
});

test('anything thrown inside: still a 200 with the fixed "not available" reply, never a 5xx', async () => {
  const broken = { fixed: index.fixed, byLang: index.byLang, provider: index.provider, get search() { throw new Error('index broken QUESTION-SECRET'); } };
  logs.length = 0;
  const res = await ask(createAssistantHandler({ env: ENV, index: broken, fetch: model(() => reply('x')).fetch, log: (l) => logs.push(l) }), 'QUESTION-SECRET');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.answers.map((a) => a.id), ['x-unavailable']);
  assert.ok(logs.every((l) => !l.includes('QUESTION-SECRET')));
  const none = await ask(createAssistantHandler({ env: ENV, index: () => null, log: () => {} }), 'hello');
  assert.equal(none.statusCode, 200);
  assert.equal(none.body.ok, false);
});

test('a question leaves the server only when the privacy page names where it goes', async () => {
  for (const env of [{ ...ENV, ASSISTANT_PROVIDER_NAME: '' }, { ...ENV, ASSISTANT_PROVIDER_NAME: 'Someone Else' }]) {
    const m = model(() => reply('{"pick":[1],"kind":"answered"}'));
    logs.length = 0;
    const handler = make(m.fetch, env);
    await ask(handler, 'do you charge fees');
    await ask(handler, 'how fast can you close');
    assert.equal(m.calls.length, 0, 'the model is never called');
    assert.equal(logs.filter((l) => l.startsWith('[assistant] the model stays off')).length, 1, 'said once, in one line');
  }
  const unnamed = prepareIndex(indexFromSource({ providerName: '' }));
  const m = model(() => reply('{"pick":[1],"kind":"answered"}'));
  await ask(createAssistantHandler({ env: ENV, index: unnamed, fetch: m.fetch, log: () => {} }), 'do you charge fees');
  assert.equal(m.calls.length, 0, 'pages built without a provider: questions go nowhere');
  assert.equal(assistantStatus({ env: { ASSISTANT: '' } }), '');
  assert.ok(modelSettings({ ASSISTANT_API_URL: 'http://model.example.test/v1', ASSISTANT_MODEL: 'm' }).off, 'plain http refused');
  assert.ok(modelSettings({ ASSISTANT_API_URL: 'https://user:pw@model.example.test/v1', ASSISTANT_MODEL: 'm' }).off, 'credentials in the address refused');
  assert.ok(!modelSettings({ ASSISTANT_API_URL: 'http://127.0.0.1:8080/v1/chat/completions', ASSISTANT_MODEL: 'm' }).off, 'a model on this machine may use http');
});

test('the daily ceiling for the whole site: past it, the search answers and nothing is sent', async () => {
  let t = Date.parse('2026-11-27T08:00:00Z');
  const m = model(() => reply('{"pick":[1],"kind":"answered"}'));
  const handler = make(m.fetch, { ...ENV, ASSISTANT_DAILY_MAX: '2' }, { now: () => t });
  for (let i = 0; i < 5; i += 1) {
    const res = await ask(handler, 'do you charge fees or commission');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  }
  assert.equal(m.calls.length, 2);
  t += 24 * 60 * 60_000;
  await ask(handler, 'do you charge fees');
  assert.equal(m.calls.length, 3, 'a new day');
  const off = model(() => reply('{"pick":[1],"kind":"answered"}'));
  await ask(make(off.fetch, { ...ENV, ASSISTANT_DAILY_MAX: '0' }), 'fees');
  assert.equal(off.calls.length, 0, 'ASSISTANT_DAILY_MAX=0 keeps the model off');
});
