// lib/local-database.js: the site's own PostgreSQL in a folder. One folder is created for the whole file (the first
// creation takes a few seconds) and reused, in order: schema, migrations, durability, the single-process lock, a
// crash, backup and restore, and the worker scripts' refusal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_URL, backupLocalDatabase, closeLocalDatabase, databaseDir, databaseMode, durabilityStats, localDatabase, lockHolder,
  migrationBody, openLocalDatabase, restoreDatabase, stateDir, useDatabase,
} from '../lib/local-database.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODULE = new URL('../lib/local-database.js', import.meta.url).href;
let base; let state; let dir; let schema;
const quiet = () => {};
const open = (extra = {}) => openLocalDatabase({ env: {}, dir, state, schemaDir: schema, log: quiet, ...extra });
const sql = async (text, params) => (await localDatabase().pg.query(text, params)).rows;
// A child process that runs `body` with the module imported as `db`; prints what it is given to print.
const child = (body) => spawnSync(process.execPath, ['--input-type=module', '-e', `import * as db from ${JSON.stringify(MODULE)};\n${body}`], { encoding: 'utf8', timeout: 120000 });

before(() => {
  base = mkdtempSync(join(tmpdir(), 'hbh-localdb-'));
  state = join(base, 'state');
  dir = join(state, 'db');
  schema = join(base, 'schema');
  cpSync(join(ROOT, 'supabase', 'schema.sql'), join(schema, 'schema.sql'));
  cpSync(join(ROOT, 'supabase', 'migrations'), join(schema, 'migrations'), { recursive: true });
});
after(async () => { await closeLocalDatabase().catch(() => {}); rmSync(base, { recursive: true, force: true }); });

test('settings: where the database lives, and which database the handlers use', () => {
  assert.equal(stateDir({ STATE_DIRECTORY: '/var/lib/call-harbison' }), '/var/lib/call-harbison');
  assert.equal(databaseDir({ STATE_DIRECTORY: '/var/lib/call-harbison' }), '/var/lib/call-harbison/db');
  assert.equal(databaseDir({ DATABASE_DIR: '/srv/db', STATE_DIRECTORY: '/var/lib/x' }), '/srv/db');
  assert.equal(databaseDir({}), join(process.cwd(), '.data', 'db'));
  assert.equal(databaseMode({}), 'local');
  assert.equal(databaseMode({ SUPABASE_URL: LOCAL_URL }), 'local');
  assert.equal(databaseMode({ SUPABASE_URL: 'https://abc.supabase.co' }), 'supabase');
  const supabase = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'keep' };
  assert.equal(useDatabase(supabase), 'supabase');
  assert.deepEqual(supabase, { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'keep' });
  const none = {};
  assert.equal(useDatabase(none), null, 'nothing open: the handlers keep failing visibly as before');
  assert.deepEqual(none, {});
});

test('a migration wrapped in begin;/commit; loses only those two lines', () => {
  assert.equal(migrationBody('create table a (id int);'), 'create table a (id int);');
  assert.equal(migrationBody('-- note\n\nbegin;\ncreate table a (id int);\ncommit;\n-- end\n'), '-- note\n\n\ncreate table a (id int);\n\n-- end\n');
  assert.throws(() => migrationBody('begin;\ncreate table a (id int);\n'), /does not end with commit/);
});

test('a new folder gets the schema and every migration once; a second open applies nothing', async () => {
  const started = Date.now();
  const db = await open();
  const migrations = readdirSync(join(schema, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(db.applied, ['schema.sql', ...migrations]);
  assert.equal(db.durable, true, 'commits are forced to disk');
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(state, 'signing-key')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(state, 'signing-key'), 'utf8'), /^[a-f0-9]{64}\n$/);
  assert.equal(lockHolder(`${dir}.lock`).pid, process.pid);
  assert.deepEqual((await sql('select count(*)::int n from public.leads'))[0], { n: 0 });
  assert.ok((await sql("select to_regclass('public.lead_commands') t"))[0].t, 'the last migration ran');
  await closeLocalDatabase();
  assert.equal(lockHolder(`${dir}.lock`), null, 'a clean close removes the lock');
  const again = await open();
  assert.deepEqual(again.applied, []);
  assert.deepEqual(again.changed, []);
  assert.equal((await sql('select count(*)::int n from app_meta.migrations'))[0].n, migrations.length + 1);
  await closeLocalDatabase();
  console.log(`# first creation and two opens: ${Date.now() - started} ms`);
});

test('a broken migration stops the start, keeps nothing of itself and leaves the folder usable', async () => {
  const broken = join(schema, 'migrations', '20991231000000_broken.sql');
  writeFileSync(broken, "begin;\ncreate table public.half_done (id int);\ninsert into public.leads (address, name, phone) values ('1 Half St', 'Half Done', '6615550000');\nselect no_such_function();\ncommit;\n");
  try {
    await assert.rejects(open(), (err) => err.code === 'MIGRATION_FAILED' && /Migration 20991231000000_broken\.sql failed/.test(err.message));
    assert.equal(localDatabase(), null);
    assert.equal(lockHolder(`${dir}.lock`), null, 'the lock is released, so a fixed release can start');
  } finally { rmSync(broken); }
  const db = await open();
  assert.deepEqual(db.applied, [], 'the broken file was not recorded as applied');
  assert.equal((await sql("select to_regclass('public.half_done') t"))[0].t, null, 'its table was rolled back');
  assert.equal((await sql('select count(*)::int n from public.leads'))[0].n, 0, 'its row was rolled back');
  await closeLocalDatabase();
});

test('an applied migration that was edited later is reported, not run again', async () => {
  const file = join(schema, 'migrations', '003_options_form.sql');
  const original = readFileSync(file, 'utf8');
  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(String(line));
  try {
    writeFileSync(file, `${original}\n-- edited after it was applied\n`);
    const db = await open();
    assert.deepEqual(db.changed, ['003_options_form.sql']);
    assert.ok(warnings.some((w) => w.includes('003_options_form.sql changed after being applied')));
    await closeLocalDatabase();
  } finally { writeFileSync(file, original); console.warn = warn; }
});

test('the handlers reach it through the shim, every commit is synced, and nothing else may use the shim', async () => {
  await open();
  const env = {};
  assert.equal(useDatabase(env), 'local');
  assert.equal(env.SUPABASE_URL, LOCAL_URL);
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const before = durabilityStats().fsyncs;
  const saved = await fetch(`${LOCAL_URL}/rest/v1/leads`, { method: 'POST', headers, body: JSON.stringify({ address: '1 Shim St, Bakersfield, CA 93301', name: 'Shim Test', phone: '6615550111' }) });
  assert.equal(saved.status, 201);
  assert.ok(durabilityStats().fsyncs > before, 'the insert was fsynced before the reply');
  const read = await fetch(`${LOCAL_URL}/rest/v1/leads?name=eq.Shim%20Test&select=name,phone`, { headers });
  assert.deepEqual(await read.json(), [{ name: 'Shim Test', phone: '6615550111' }]);
  const stranger = await fetch(`${LOCAL_URL}/rest/v1/leads?select=name`, { headers: { Authorization: 'Bearer guess' } });
  assert.equal(stranger.status, 401);
  assert.equal((await fetch(`${LOCAL_URL}/rest/v1/app_meta.migrations`, { headers })).status, 400, 'only public tables can be named');
  await closeLocalDatabase();
  assert.equal((await fetch(`${LOCAL_URL}/rest/v1/leads`, { headers })).status, 503, 'a closed database fails visibly');
});

test('a second process is refused while the folder is open; a crashed holder\'s lock is taken over', async () => {
  await open();
  const second = child(`try { await db.openLocalDatabase({ env: {}, dir: ${JSON.stringify(dir)}, state: ${JSON.stringify(state)}, log() {} }); console.log('OPENED'); } catch (e) { console.log(e.code, e.message); process.exit(3); }`);
  assert.equal(second.status, 3, second.stdout + second.stderr);
  assert.match(second.stdout, new RegExp(`DATABASE_IN_USE .*in use by process ${process.pid}`));
  assert.equal((await sql('select count(*)::int n from public.leads'))[0].n, 1, 'the first process is unaffected');
  await closeLocalDatabase();

  // A process that commits and is then killed: the commit survives, and its stale lock does not block the next start.
  const crashed = child(`const d = await db.openLocalDatabase({ env: {}, dir: ${JSON.stringify(dir)}, state: ${JSON.stringify(state)}, log() {} });
await d.pg.query("insert into public.leads (address, name, phone) values ('2 Crash Ct, Bakersfield, CA 93301', 'Crash Test', '6615550112')");
process.kill(process.pid, 'SIGKILL');`);
  assert.equal(crashed.signal, 'SIGKILL');
  const left = lockHolder(`${dir}.lock`);
  assert.equal(left.stale, true, 'the killed process left its lock behind, marked stale');
  await open();
  assert.deepEqual(await sql("select name from public.leads where name = 'Crash Test'"), [{ name: 'Crash Test' }]);
  await closeLocalDatabase();
});

test('backup and restore: a dated dump, the newest 14 kept, and a verified swap that keeps the old folder', async () => {
  await open();
  const backups = join(state, 'backups');
  mkdirSync(backups); // as someone might have made it by hand, with ordinary permissions
  for (let day = 1; day <= 15; day += 1) {
    const name = `db-2025-01-${String(day).padStart(2, '0')}.tar.gz`;
    cpSync(join(ROOT, 'package.json'), join(backups, name)); // stand-ins for older days
  }
  const now = Date.parse('2026-11-27T20:00:00Z');
  const { file, bytes, removed } = await backupLocalDatabase({ now });
  assert.equal(file, join(backups, 'db-2026-11-27.tar.gz'));
  assert.ok(bytes > 100000);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(backups).mode & 0o777, 0o700);
  assert.equal(removed.length, 2);
  assert.equal(readdirSync(backups).length, 14);
  assert.ok(!existsSync(join(backups, 'db-2025-01-01.tar.gz')) && !existsSync(join(backups, 'db-2025-01-02.tar.gz')), 'the oldest go first');

  await sql("insert into public.leads (address, name, phone) values ('3 After St, Bakersfield, CA 93301', 'After Backup', '6615550113')");
  await assert.rejects(restoreDatabase({ file, env: {}, dir }), /open in this process/);
  await closeLocalDatabase();

  await assert.rejects(restoreDatabase({ file: join(backups, 'db-2025-01-15.tar.gz'), env: {}, dir }));
  assert.ok(existsSync(join(dir, 'PG_VERSION')), 'a bad backup leaves the database alone');

  const restored = await restoreDatabase({ file, env: {}, dir });
  assert.equal(restored.leads, 2, 'the backup held the two leads made before it');
  assert.ok(existsSync(join(restored.previous, 'PG_VERSION')), 'the replaced folder is kept');
  assert.equal(lockHolder(`${dir}.lock`), null);
  const db = await open();
  assert.deepEqual(db.applied, []);
  assert.deepEqual((await sql('select name from public.leads order by name')).map((r) => r.name), ['Crash Test', 'Shim Test']);
  await closeLocalDatabase();
});

test('the restore command refuses while the site has the database open, and restores once it is stopped', async () => {
  const script = join(ROOT, 'scripts', 'restore-database.mjs');
  const backup = join(state, 'backups', 'db-2026-11-27.tar.gz');
  const run = (env) => spawnSync(process.execPath, [script, backup], { cwd: base, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const nowhere = run({});
  assert.equal(nowhere.status, 2);
  assert.match(nowhere.stderr, /Say where the database is/);
  await open();
  await sql("insert into public.leads (address, name, phone) values ('4 Running Rd, Bakersfield, CA 93301', 'While Running', '6615550114')");
  const busy = run({ DATABASE_DIR: dir });
  assert.equal(busy.status, 1, busy.stdout + busy.stderr);
  assert.match(busy.stderr, new RegExp(`Nothing was changed: .*in use by process ${process.pid}`));
  assert.equal((await sql("select count(*)::int n from public.leads where name = 'While Running'"))[0].n, 1, 'the running database was not touched');
  await closeLocalDatabase();
  const done = run({ DATABASE_DIR: dir });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /The restored database holds 2 leads\./);
  assert.match(done.stdout, /The database it replaced is kept in .*db\.before-restore-/);
  await open();
  assert.equal((await sql("select count(*)::int n from public.leads where name = 'While Running'"))[0].n, 0);
  await closeLocalDatabase();
});

test('the worker scripts refuse to open a second copy of the local database', () => {
  for (const script of ['process-outbox.mjs', 'process-lead-alerts.mjs']) {
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts', script)], { cwd: base, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(run.status, 1, script);
    assert.match(run.stderr, /only the running site \(server\.mjs\) may open it/, script);
    assert.ok(!existsSync(join(base, '.data')), `${script} created nothing`);
  }
});

test('HQ_SESSION_SECRET replaces the signing-key file', async () => {
  const other = mkdtempSync(join(tmpdir(), 'hbh-localdb-secret-'));
  try {
    const db = await openLocalDatabase({ env: { HQ_SESSION_SECRET: 'x'.repeat(40) }, dir, state: other, schemaDir: schema, log: quiet });
    assert.equal(existsSync(join(other, 'signing-key')), false);
    assert.match(db.key, /^[a-f0-9]{64}$/);
    await closeLocalDatabase();
  } finally { rmSync(other, { recursive: true, force: true }); }
});

test('a folder that is not empty but holds no database is never overwritten', async () => {
  const strange = join(base, 'strange');
  mkdirSync(strange);
  cpSync(join(ROOT, 'package.json'), join(strange, 'package.json'));
  await assert.rejects(openLocalDatabase({ env: {}, dir: strange, state, schemaDir: schema, log: quiet }), /not empty but holds no database/);
  assert.ok(existsSync(join(strange, 'package.json')));
});
