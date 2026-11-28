// One master secret for everything this site signs, and one key per purpose derived from it. A key that leaks or is
// worked out for one purpose (a thank-you link, say) then tells nothing about another (an HQ sign-in).
//
// The master secret is the first of:
//   HQ_SESSION_SECRET, when it is at least 32 characters. A shorter one is ignored (secretNotes() says so at start).
//   SUPABASE_SERVICE_ROLE_KEY. With the site's own database that is the random key kept in the state folder
//     (lib/local-database.js, useDatabase()); with Supabase it is the project's service key.
//   A random value made once per process. Signatures then stop working at a restart, but there is always a key, so
//     nothing that checks a signature can be skipped for want of one.
// Never another service's API key (RESEND_API_KEY, Twilio), never a URL (LEAD_WEBHOOK_URL), and never
// CRM_INGEST_SECRET: Harbison Standard knows that one, so it must not be able to sign anything here.
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const MIN_SECRET_LENGTH = 32;

// The purposes in use. A new use gets a new name here, never an existing key.
export const PURPOSE = {
  details: 'thank-you-details', // the token that lets /thank-you add property details to the lead just sent
  preview: 'seller-import-preview', // the token that binds a research import to the dry run the reviewer saw
};

const processSecret = randomBytes(32).toString('hex');

export function masterSecretSource(env = process.env) {
  if (String(env.HQ_SESSION_SECRET || '').length >= MIN_SECRET_LENGTH) return 'HQ_SESSION_SECRET';
  if (env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY';
  return 'process';
}

export function masterSecret(env = process.env) {
  const source = masterSecretSource(env);
  if (source === 'process') return processSecret;
  return String(env[source]);
}

// HMAC-SHA256(master, purpose): a 32-byte key for one purpose.
export function keyFor(env, purpose) {
  if (typeof purpose !== 'string' || !purpose) throw new Error('A signing key needs a purpose');
  return createHmac('sha256', masterSecret(env)).update(purpose).digest();
}

// HQ sessions are signed with a key that also depends on HQ_PASSWORD, so changing the password signs everyone out.
export const sessionPurpose = (env = process.env) => `hq-session|${createHash('sha256').update(String(env.HQ_PASSWORD || '')).digest('hex')}`;

// What server.mjs prints once at start. Names settings, never a value.
export function secretNotes(env = process.env) {
  const notes = [];
  const own = String(env.HQ_SESSION_SECRET || '');
  if (own && own.length < MIN_SECRET_LENGTH) {
    notes.push(`HQ_SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters, so it is ignored: HQ sign-ins and thank-you links are signed with ${masterSecretSource(env) === 'process' ? 'a key made at start' : 'the database key'} instead. Set a longer one, or remove it.`);
  }
  if (masterSecretSource(env) === 'process') {
    notes.push('No HQ_SESSION_SECRET and no database key: HQ sign-ins and thank-you links are signed with a key made at start, so they stop working at the next restart.');
  }
  return notes;
}
