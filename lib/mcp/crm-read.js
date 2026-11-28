// The only place the MCP server (api/mcp.js) reaches the database, and it can only read.
//
// readRows() sends one GET in the handlers' REST dialect (Supabase's, answered on a VPS by lib/postgres-rest.js),
// exactly as sb() in api/hq.js does. It takes no method and no body, so nothing here can insert, change or delete a
// row: "the MCP server cannot change data" is true by construction. The table allowlist matters as much as the
// method: lib/postgres-rest.js runs `rpc/<function>` as a database function call even on GET, and a function can write.
//
// Callers build every query with URLSearchParams and name their columns; select=* is refused, so a column added to
// the leads table later (a new piece of personal data, say) never reaches the assistant without a code change.
import { useDatabase } from '../local-database.js';

const TABLES = new Set(['leads', 'lead_events']);
const COLUMNS = /^[a-z_]+(,[a-z_]+)*$/;
const TIMEOUT_MS = 15000;

export async function readRows(env, table, params) {
  if (!TABLES.has(table)) throw new Error('readRows can only read leads and lead_events');
  if (!(params instanceof URLSearchParams)) throw new Error('readRows needs its query as URLSearchParams');
  const select = params.getAll('select');
  if (select.length !== 1 || !COLUMNS.test(select[0])) throw new Error('readRows needs the columns named in select');
  useDatabase(env);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('No database is configured');
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?${params}`, {
    method: 'GET',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A failed reply is not read, and a malformed one is not quoted: a database error can contain a value, such as a
  // phone number, and these messages go to the log.
  if (!res.ok) {
    try { await res.body?.cancel(); } catch {}
    throw new Error(`Database read failed (HTTP ${res.status})`);
  }
  let rows;
  try { rows = await res.json(); } catch { throw new Error('Database read returned something that is not JSON'); }
  if (!Array.isArray(rows)) throw new Error('Database read did not return a list of rows');
  return rows;
}
