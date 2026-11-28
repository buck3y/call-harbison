// Checks a running MCP server the way an assistant uses it, and says what came back in plain words.
//
//   MCP_TOKEN=… node scripts/mcp-check.mjs https://www.callharbison.com/api/mcp
//
// It runs the older handshake (initialize), lists the tools, calls system_status and crm_overview, then lists the
// tools again in the current protocol (2026-07-28). It prints counts and yes/no answers only, never a name, a phone
// number or the token. Exit code 0 when every step worked, 1 otherwise. See docs/MCP.md.

const MODERN = '2026-07-28';
const url = process.argv[2];
const token = String(process.env.MCP_TOKEN || '').trim();

function fail(message) {
  console.log(`FAILED: ${message}`);
  process.exit(1);
}

if (!url || !/^https?:\/\//i.test(url)) fail('say which server to check, for example: MCP_TOKEN=… node scripts/mcp-check.mjs https://www.callharbison.com/api/mcp');
if (!token) fail('set MCP_TOKEN to the token in the server\'s settings file (it is not printed).');

const WHY = {
  401: 'the server refused the token: it is not the one in MCP_TOKEN on the server.',
  403: 'the server refused the request because of its Origin header.',
  404: 'nothing answers at that address: MCP is switched off there (MCP_TOKEN missing or shorter than 32 characters, or the service was not restarted), or the address is wrong.',
  405: 'the server does not accept this kind of request at that address.',
  429: 'too many failed sign-ins or calls: wait 15 minutes and try again.',
};

// A reply is one JSON object, or (from other servers) an event stream whose data lines carry it.
function readReply(text, type) {
  if (/text\/event-stream/i.test(type || '')) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try { const message = JSON.parse(line.slice(5)); if (message && ('result' in message || 'error' in message)) return message; } catch {}
    }
    return null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

let nextId = 1;
async function send(step, method, params, headers = {}, { notification = false } = {}) {
  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notification ? {} : { id: nextId++ }) };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    fail(`${step}: could not reach ${url} (${err.cause?.code || err.name || 'no answer'}).`);
  }
  const text = await res.text();
  if (notification) {
    if (res.status !== 202) fail(`${step}: expected 202 Accepted, got ${res.status}.`);
    return null;
  }
  if (WHY[res.status]) fail(`${step}: ${res.status}, ${WHY[res.status]}`);
  const message = readReply(text, res.headers.get('content-type'));
  if (!message) fail(`${step}: the server answered ${res.status} without a JSON-RPC reply.`);
  if (message.error) fail(`${step}: the server answered with error ${message.error.code}, "${String(message.error.message).slice(0, 200)}".`);
  if (res.status !== 200 || !message.result) fail(`${step}: the server answered ${res.status} without a result.`);
  return message.result;
}

async function callTool(step, name, protocolVersion) {
  const result = await send(step, 'tools/call', { name, arguments: {} }, { 'MCP-Protocol-Version': protocolVersion });
  const text = result.content?.find?.((c) => c.type === 'text')?.text;
  if (result.isError) fail(`${step}: ${name} answered with an error: "${String(text).slice(0, 200)}"`);
  try { return JSON.parse(text); } catch { fail(`${step}: ${name} did not return JSON.`); }
  return null;
}

const yes = (value, words = ['set up', 'not set up']) => (value ? words[0] : words[1]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

console.log(`Checking ${url}`);

const init = await send('1. Handshake', 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'call-harbison-mcp-check', version: '1.0.0' } });
const legacy = init.protocolVersion;
if (!legacy || !init.serverInfo?.name) fail('1. Handshake: the reply has no protocol version or server name.');
await send('1. Handshake', 'notifications/initialized', undefined, { 'MCP-Protocol-Version': legacy }, { notification: true });
console.log(`1. Handshake (older protocol): OK. ${init.serverInfo.title || init.serverInfo.name} ${init.serverInfo.version || ''} answered with protocol ${legacy}.`);

const listed = await send('2. Tool list', 'tools/list', {}, { 'MCP-Protocol-Version': legacy });
const names = (listed.tools || []).map((t) => t.name);
if (!names.length) fail('2. Tool list: the server lists no tools.');
for (const needed of ['system_status', 'crm_overview']) if (!names.includes(needed)) fail(`2. Tool list: ${needed} is missing.`);
console.log(`2. Tools: ${names.join(', ')} (${names.length}).`);

const status = await callTool('3. System status', 'system_status', legacy);
const backup = status.latest_backup ? `newest backup ${status.latest_backup.date}, ${status.latest_backup.age} old` : 'no backup found';
console.log(`3. System status: database ${status.database?.kind === 'local' ? 'on this server' : 'at Supabase'}, ${status.database?.answering ? 'answering' : 'NOT answering'}; ${backup}; e-mail alerts ${yes(status.email_alerts)}; text alerts ${yes(status.text_alerts)}; website statistics ${yes(status.site_statistics_here, ['recorded here', 'not recorded here'])}; contact details ${yes(status.contact_details_shared, ['shared', 'not shared'])}.`);
if (!status.database?.answering) fail('3. System status: the database does not answer.');

const overview = await callTool('4. Overview', 'crm_overview', legacy);
const s = overview.stats || {};
console.log(`4. Overview: ${plural(s.newToday ?? 0, 'new lead')} today and ${s.new30 ?? 0} in 30 days; ${s.uncontacted ?? 0} waiting for a first call; ${plural(s.followupsDue ?? 0, 'follow-up')} due; ${plural(s.appointments7 ?? 0, 'appointment')} in the next 7 days; ${plural(s.openPipeline ?? 0, 'open lead')}.`);

const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'call-harbison-mcp-check', version: '1.0.0' } };
const modern = await send('5. Tool list (current protocol)', 'tools/list', { _meta: meta }, { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' });
const modernNames = (modern.tools || []).map((t) => t.name);
if (modern.resultType !== 'complete') fail('5. Tool list (current protocol): the reply has no resultType "complete".');
if (modernNames.join(',') !== names.join(',')) fail('5. Tool list (current protocol): the tools differ from the older protocol\'s list.');
console.log(`5. Tool list (current protocol ${MODERN}): the same ${names.length} tools, cached for ${Math.round((modern.ttlMs || 0) / 1000)} s.`);

console.log('All checks passed. The server is read-only: none of these steps changed anything.');
