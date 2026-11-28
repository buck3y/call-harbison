// The site's own database: PostgreSQL 18 running inside this Node process (PGlite, compiled to WebAssembly), with
// its files in one folder on this server's disk. No second service, no network port, no outside account.
//
// ---------- Where things live ----------
//
//   state folder    STATE_DIRECTORY (systemd's StateDirectory=, /var/lib/call-harbison), else ./.data
//   db/             DATABASE_DIR if set, else <state>/db. PostgreSQL's own files, mode 0700. Never edit by hand.
//   db.lock         the process that has db/ open: {"pid","boot","start","at"}. Removed when it closes cleanly.
//   signing-key     64 hex digits, mode 0600. Signs HQ sign-ins and thank-you links. Not created when
//                   HQ_SESSION_SECRET is set to 32 characters or more. Deleting it signs everyone out of HQ.
//   backups/        db-YYYY-MM-DD.tar.gz (Bakersfield date), one a day, the newest 14 kept. Mode 0600. Every
//                   lead is in them: treat them like the database.
//
// ---------- How the handlers reach it ----------
//
// The handlers speak Supabase's REST dialect through fetch(`${SUPABASE_URL}/rest/v1/…`). useDatabase(env) points
// SUPABASE_URL at LOCAL_URL, an address under .invalid that no resolver will ever answer, and gives the handlers a
// bearer key. A fetch shim answers LOCAL_URL inside this process through lib/postgres-rest.js. Every other URL
// goes to the real fetch untouched. With SUPABASE_URL set to a real Supabase project, none of this is used.
//
// ---------- Trust ----------
//
// Trusted: the environment; the SQL files under supabase/, which are run by the database superuser at start; the
//   state folder, which belongs to the service user (0700).
// Not trusted: anything a visitor sends. It reaches this module only inside the REST requests the handlers build.
//   lib/postgres-rest.js checks every table, column and function name against /^[a-z_][a-z0-9_]*$/, binds every
//   value as a query parameter, and can only name things in the `public` schema. The shim answers only requests
//   that carry the bearer key useDatabase() handed out, so only this process's own code can use it, and there is
//   no listener. Queries run as the PostgreSQL superuser, as they did with Supabase's service key, so row-level
//   security does not apply: the handlers are the access control.
// Never logged: query text, values, or anything PostgreSQL prints. Its stdout and stderr are discarded because an
//   error line can quote a value, such as a phone number. Only file names, counts and error messages from our own
//   code or from migrations are logged.
//
// ---------- Durability (what survives what) ----------
//
// PGlite normally runs PostgreSQL with fsync off, and its Node file layer has no fsync at all, so a power cut could
// lose or damage recent writes. Here -F is dropped, the write-ahead log is synced with fsync(), and the file layer's
// fsync calls Node's fsyncSync. A commit is on the disk before the request that made it returns. At open a
// self-check counts the fsyncs of one real commit and warns if there were none (a PGlite upgrade that changed its
// internals). A crash or `kill -9` is recovered from at the next open, as in any PostgreSQL.
//
// ---------- One process at a time ----------
//
// Inside PGlite every instance claims pid -42, so PostgreSQL's own lock file cannot tell processes apart, and a
// second process on the same folder silently loses writes. db.lock stops that: open() and restore refuse while the
// process named there is alive (same boot, same start time) and take over a lock left by a process that died.
//
// ---------- Keys and memory ----------
//
// useDatabase() writes LOCAL_URL and the signing key into the handlers' environment (process.env on the server) as
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, the slots the handlers already read. lib/secrets.js takes it as the
// master secret for HQ sessions, thank-you links and import previews (unless HQ_SESSION_SECRET of 32 characters or
// more is set) and derives one key per purpose from it. Nothing sends that variable anywhere but this shim;
// the only child process this module starts gets PATH alone. The first creation of a database (initdb) needs about
// 750 MB, which a process would keep, so it runs in a short-lived child; the server itself stays near 250-300 MB.
//
// ---------- Schema ----------
//
// Every open creates the roles the schema expects, then applies supabase/schema.sql and each file in
// supabase/migrations/ in name order, each once, recorded with its checksum in app_meta.migrations. A migration runs
// in one transaction together with its record (an outer begin;/commit; in the file is taken out for that). If one
// fails, none of it stays, the database is closed and open() throws naming the file: the server does not start.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createRestHandler } from './postgres-rest.js';
import { zonedParts } from './analytics-store.js';
import { MIN_SECRET_LENGTH } from './secrets.js';

export const LOCAL_URL = 'http://local-database.invalid';
export const KEEP_BACKUPS = 14;
const SCHEMA_DIR = fileURLToPath(new URL('../supabase/', import.meta.url));
const BACKUP_FILE = /^db-\d{4}-\d{2}-\d{2}\.tar\.gz$/;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

let current = null; // the open database of this process
let fsyncs = 0; // fsync calls PostgreSQL made, for the self-check and the tests
let shimInstalled = false;
let backups = null;

// ---------- Settings ----------

export function stateDir(env = process.env) {
  const state = String(env.STATE_DIRECTORY || '').split(':')[0];
  return state ? resolve(state) : resolve('.data');
}
export const databaseDir = (env = process.env) => (env.DATABASE_DIR ? resolve(env.DATABASE_DIR) : join(stateDir(env), 'db'));
export const backupsDir = (env = process.env) => join(stateDir(env), 'backups');
// Supabase when a real SUPABASE_URL is set, otherwise this server's own database.
export const databaseMode = (env = process.env) => (env.SUPABASE_URL && env.SUPABASE_URL !== LOCAL_URL ? 'supabase' : 'local');
export const durabilityStats = () => ({ fsyncs });

// ---------- Files ----------

function writeAll(fd, data) {
  for (let done = 0; done < data.length;) done += writeSync(fd, data, done, data.length - done);
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = openSync(tmp, 'w', 0o600);
    try { writeAll(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
  try { const fd = openSync(dirname(file), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch {}
}

function signingKey(state) {
  const file = join(state, 'signing-key');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const key = readFileSync(file, 'utf8').trim();
      if (/^[a-f0-9]{64}$/.test(key)) return key;
      throw new Error(`${file} does not hold a valid key. Delete it to make a new one (that signs everyone out of HQ).`);
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    try {
      const fd = openSync(file, 'wx', 0o600);
      try { writeAll(fd, Buffer.from(`${randomBytes(32).toString('hex')}\n`)); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  throw new Error(`Could not create ${file}`);
}

// ---------- The lock ----------

const bootId = () => { try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return ''; } };
// Field 22 of /proc/<pid>/stat: when the process started, so a reused pid is not mistaken for the holder.
const startedAt = (pid) => { try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] || ''; } catch { return ''; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

export function lockHolder(lockFile) {
  let text;
  try { text = readFileSync(lockFile, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  let info;
  try { info = JSON.parse(text); } catch { return { stale: true }; }
  const pid = Number(info?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return { ...info, stale: true };
  const boot = bootId();
  if (info.boot && boot && info.boot !== boot) return { ...info, stale: true };
  const start = startedAt(pid);
  if (info.start && start && info.start !== start) return { ...info, stale: true };
  if (pid === process.pid && !current) return { ...info, stale: true }; // left by an open in this process that failed
  return { ...info, stale: false };
}

function acquireLock(lockFile, folder) {
  const mine = { pid: process.pid, boot: bootId(), start: startedAt(process.pid), at: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(lockFile, 'wx', 0o600);
      try { writeAll(fd, Buffer.from(`${JSON.stringify(mine)}\n`)); fsyncSync(fd); } finally { closeSync(fd); }
      return mine;
    } catch (err) { if (err.code !== 'EEXIST') throw err; }
    const holder = lockHolder(lockFile);
    if (holder && !holder.stale) {
      throw Object.assign(new Error(`The database in ${folder} is in use by process ${holder.pid} (since ${holder.at}). Only one process may open it: stop the other one first (sudo systemctl stop call-harbison).`), { code: 'DATABASE_IN_USE', pid: holder.pid });
    }
    try { unlinkSync(lockFile); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  throw new Error(`Could not take the lock ${lockFile}`);
}

function releaseLock(lockFile, mine) {
  try {
    const info = JSON.parse(readFileSync(lockFile, 'utf8'));
    if (info.pid === mine.pid && info.at === mine.at) unlinkSync(lockFile);
  } catch {}
}

// ---------- The engine ----------

async function engine() {
  const [{ PGlite }, { NodeFS }] = await Promise.all([import('@electric-sql/pglite'), import('@electric-sql/pglite/nodefs')]);
  // NodeFS writes PostgreSQL's files straight to the folder; this adds the fsync it lacks.
  class DurableNodeFS extends NodeFS {
    async init(pg, options) {
      const out = await super.init(pg, options);
      out.emscriptenOpts.preRun = [...(out.emscriptenOpts.preRun || []), (mod) => {
        const nodefs = mod.FS?.filesystems?.NODEFS;
        if (!nodefs?.stream_ops || typeof nodefs.tryFSOperation !== 'function') return; // the self-check reports it
        nodefs.stream_ops.fsync = (stream) => {
          fsyncs += 1;
          if (stream.nfd != null) nodefs.tryFSOperation(() => fsyncSync(stream.nfd));
          return 0;
        };
      }];
      return out;
    }
  }
  const startParams = [...PGlite.defaultStartParams.filter((p) => p !== '-F'), '-c', 'wal_sync_method=fsync', '-c', 'shared_buffers=32MB'];
  const quiet = () => true;
  return { create: (folder, extra = {}) => PGlite.create({ fs: new DurableNodeFS(folder), startParams, onStdout: quiet, onStderr: quiet, ...extra }) };
}

// The first creation (initdb) briefly needs about 750 MB, which a process keeps afterwards. So it runs in a child
// process that exits, into a temporary folder renamed into place only when it is complete.
export async function createDataFolder(folder) {
  const { create } = await engine();
  const pg = await create(folder);
  await pg.close();
}

function createInChild(root) {
  const incoming = `${root}.creating-${process.pid}`;
  rmSync(incoming, { recursive: true, force: true });
  const code = `import { createDataFolder } from ${JSON.stringify(import.meta.url)};\nawait createDataFolder(${JSON.stringify(incoming)});`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 180000, env: { PATH: process.env.PATH || '' } });
  if (run.status !== 0 || !existsSync(join(incoming, 'PG_VERSION'))) {
    rmSync(incoming, { recursive: true, force: true });
    const last = String(run.stderr || run.error?.message || '').trim().split('\n').pop();
    throw new Error(`Could not create a new database in ${root}${last ? ` (${last})` : ''}`);
  }
  renameSync(incoming, root);
}

// ---------- Schema ----------

const META = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists app_meta;
create table if not exists app_meta.migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now());
create table if not exists app_meta.opened (id int primary key, at timestamptz not null);`;

// A migration written for Supabase may wrap itself in begin;/commit;. Those two lines go, so that the migration
// and its record commit together. Anything else that controls transactions is refused.
export function migrationBody(sql) {
  const lines = sql.split('\n');
  const noise = (line) => !line.trim() || line.trim().startsWith('--');
  let first = 0;
  while (first < lines.length && noise(lines[first])) first += 1;
  if (!/^begin\s*;$/i.test(lines[first]?.trim() || '')) return sql;
  let last = lines.length - 1;
  while (last > first && noise(lines[last])) last -= 1;
  if (!/^commit\s*;$/i.test(lines[last].trim())) throw new Error('it starts with begin; but does not end with commit;');
  lines[first] = '';
  lines[last] = '';
  return lines.join('\n');
}

export async function prepareSchema(pg, { schemaDir = SCHEMA_DIR, exclude = [] } = {}) {
  await pg.exec(META);
  const done = new Map((await pg.query('select name, checksum from app_meta.migrations')).rows.map((r) => [r.name, r.checksum]));
  const migrations = readdirSync(join(schemaDir, 'migrations')).filter((f) => f.endsWith('.sql') && !exclude.includes(f)).sort();
  const files = [['schema.sql', join(schemaDir, 'schema.sql')], ...migrations.map((f) => [f, join(schemaDir, 'migrations', f)])];
  const applied = [];
  const changed = [];
  for (const [name, file] of files) {
    const sql = readFileSync(file, 'utf8');
    const checksum = sha256(sql);
    if (done.has(name)) { if (done.get(name) !== checksum) changed.push(name); continue; }
    try {
      const body = migrationBody(sql);
      await pg.transaction(async (tx) => {
        await tx.exec(body);
        await tx.query('insert into app_meta.migrations (name, checksum) values ($1, $2)', [name, checksum]);
      });
    } catch (err) {
      throw Object.assign(new Error(`Migration ${name} failed, so nothing of it was applied: ${err.message}`), { code: 'MIGRATION_FAILED', migration: name });
    }
    applied.push(name);
  }
  return { applied, changed };
}

// ---------- Open, use, close ----------

const headerOf = (headers, name) => {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  return hit ? String(hit[1]) : '';
};
const sameKey = (given, key) => {
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(`Bearer ${key}`).digest();
  return timingSafeEqual(a, b);
};

async function answerLocally(url, init) {
  const db = current;
  if (!db) return Response.json({ message: 'The database is closed', code: 'DB_CLOSED' }, { status: 503 });
  if (!sameKey(headerOf(init.headers, 'authorization'), db.key)) return Response.json({ message: 'Not allowed' }, { status: 401 });
  if (!url.startsWith(`${LOCAL_URL}/rest/v1/`)) return Response.json({ message: 'Not found' }, { status: 404 });
  return db.handle(url, init);
}

function installShim() {
  if (shimInstalled) return;
  const passThrough = globalThis.fetch;
  globalThis.fetch = function fetchWithLocalDatabase(target, init) {
    const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target?.url;
    if (typeof url === 'string' && url.startsWith(`${LOCAL_URL}/`)) return answerLocally(url, init || {});
    return passThrough(target, init);
  };
  shimInstalled = true;
}

// Points the handlers' environment at the open local database. Returns 'local', 'supabase', or null (none open).
export function useDatabase(env = process.env) {
  if (databaseMode(env) === 'supabase') return 'supabase';
  if (!current) return null;
  env.SUPABASE_URL = LOCAL_URL;
  env.SUPABASE_SERVICE_ROLE_KEY = current.key;
  return 'local';
}

export const localDatabase = () => current;

export async function openLocalDatabase({ env = process.env, dir = databaseDir(env), state = stateDir(env), schemaDir = SCHEMA_DIR, log = console.log } = {}) {
  if (current) throw new Error(`The database is already open in this process (${current.dir})`);
  const root = resolve(dir);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(root), { recursive: true, mode: 0o700 });
  const lockFile = `${root}.lock`;
  const lock = acquireLock(lockFile, root);
  let pg;
  try {
    if (!existsSync(join(root, 'PG_VERSION'))) {
      if (existsSync(root) && readdirSync(root).length) throw new Error(`${root} is not empty but holds no database. Move it aside first.`);
      rmSync(root, { recursive: true, force: true });
      createInChild(root);
    }
    chmodSync(root, 0o700);
    const { create } = await engine();
    pg = await create(root);
    const { applied, changed } = await prepareSchema(pg, { schemaDir });
    const before = fsyncs;
    await pg.query('insert into app_meta.opened (id, at) values (1, now()) on conflict (id) do update set at = excluded.at');
    const durable = (await pg.query('show fsync')).rows[0]?.fsync === 'on' && fsyncs > before;
    if (!durable) console.warn('[db] warning: commits are not being forced to disk, so a power cut could lose recent changes. Check the PGlite version.');
    if (changed.length) console.warn(`[db] warning: ${changed.join(', ')} changed after being applied; they are not run again`);
    if (applied.length) log(`[db] applied ${applied.length} schema file(s): ${applied.join(', ')}`);
    // A shorter HQ_SESSION_SECRET is ignored (lib/secrets.js), so it must not become this key either: everything
    // signed here would then rest on a value short enough to guess.
    const key = String(env.HQ_SESSION_SECRET || '').length >= MIN_SECRET_LENGTH ? sha256(`local-database|${env.HQ_SESSION_SECRET}`) : signingKey(state);
    current = { pg, dir: root, state, key, durable, applied, changed, lockFile, lock, handle: createRestHandler((text, params) => pg.query(text, params)) };
    installShim();
    return current;
  } catch (err) {
    try { await pg?.close(); } catch {}
    releaseLock(lockFile, lock);
    throw err;
  }
}

export async function closeLocalDatabase() {
  const db = current;
  if (!db) return false;
  if (backups) { clearTimeout(backups.first); clearInterval(backups.every); }
  await backups?.running;
  backups = null;
  current = null; // requests from here on get 503 and fail visibly
  try { await db.pg.close(); } finally { releaseLock(db.lockFile, db.lock); }
  return true;
}

// ---------- Backups ----------

function prune(folder, keep) {
  const old = readdirSync(folder).filter((f) => BACKUP_FILE.test(f)).sort().reverse().slice(keep);
  for (const f of old) unlinkSync(join(folder, f));
  return old;
}

// A consistent copy of the whole database as one file. It is taken while no query runs; PostgreSQL replays its
// log when it is loaded, as after a crash.
export async function backupLocalDatabase({ folder, keep = KEEP_BACKUPS, now = Date.now() } = {}) {
  const db = current;
  if (!db) throw new Error('The database is not open');
  const target = folder || join(db.state, 'backups');
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(target, 0o700); // every lead is in these files
  const file = join(target, `db-${zonedParts(now).day}.tar.gz`);
  await db.pg.query('checkpoint');
  const blob = await db.pg.dumpDataDir('gzip');
  const data = Buffer.from(await blob.arrayBuffer());
  writeAtomic(file, data);
  return { file, bytes: data.length, removed: prune(target, keep) };
}

// One backup a day: shortly after start and then whenever the hourly check finds none for today.
export function startDailyBackups({ firstDelayMs = 60e3, intervalMs = 3600e3, now = Date.now, log = console.log } = {}) {
  if (!current) return false;
  if (backups) { clearTimeout(backups.first); clearInterval(backups.every); }
  const state = { running: null };
  const tick = () => {
    const db = current;
    if (!db || state.running) return state.running;
    if (existsSync(join(db.state, 'backups', `db-${zonedParts(now()).day}.tar.gz`))) return null;
    state.running = backupLocalDatabase({ now: now() })
      .then((r) => log(`[db] backup written: ${basename(r.file)} (${Math.round(r.bytes / 1024)} KB)${r.removed.length ? `, removed ${r.removed.length} old` : ''}`))
      .catch((err) => console.error(`[db] backup failed: ${err.message}`))
      .finally(() => { state.running = null; });
    return state.running;
  };
  state.first = setTimeout(tick, firstDelayMs);
  state.every = setInterval(tick, intervalMs);
  state.first.unref?.();
  state.every.unref?.();
  state.tick = tick;
  backups = state;
  return state;
}

// ---------- Restore (the service must be stopped) ----------

// Loads a backup into a new folder, checks it opens, and only then swaps it in. The folder it replaces is kept
// next to it as db.before-restore-<time>.
export async function restoreDatabase({ file, env = process.env, dir = databaseDir(env) } = {}) {
  if (current) throw new Error('The database is open in this process');
  const root = resolve(dir);
  // Checked here first: PGlite's own unzip reports a damaged file as an unhandled error instead of failing.
  let tar;
  try { tar = gunzipSync(readFileSync(file)); } catch (err) {
    throw new Error(`${file} is not a backup made by this site (${err.code === 'ENOENT' ? 'no such file' : 'not a gzip file, or damaged'})`);
  }
  if (!tar.includes('PG_VERSION')) throw new Error(`${file} is not a backup made by this site (there is no database inside)`);
  mkdirSync(dirname(root), { recursive: true, mode: 0o700 });
  const lockFile = `${root}.lock`;
  const lock = acquireLock(lockFile, root);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const incoming = `${root}.restoring-${stamp}`;
  try {
    const { create } = await engine();
    const pg = await create(incoming, { loadDataDir: new Blob([tar]) });
    let leads;
    try {
      leads = (await pg.query('select count(*)::int as n from public.leads')).rows[0].n;
    } catch {
      throw new Error(`${file} opened, but it is not a backup of this site (it has no leads table)`);
    } finally { await pg.close(); }
    chmodSync(incoming, 0o700);
    let previous = null;
    if (existsSync(root)) { previous = `${root}.before-restore-${stamp}`; renameSync(root, previous); }
    try { renameSync(incoming, root); } catch (err) { if (previous) renameSync(previous, root); throw err; }
    return { leads, previous, dir: root };
  } catch (err) {
    rmSync(incoming, { recursive: true, force: true });
    throw err;
  } finally {
    releaseLock(lockFile, lock);
  }
}
