import { PGlite } from '@electric-sql/pglite';
import { prepareSchema } from '../lib/local-database.js';
// An in-memory copy of the site's database, built by the same schema runner the server uses on its own folder.
export async function createTestDatabase({ excludeMigrations = [] } = {}) {
 const db = new PGlite();
 await prepareSchema(db, { exclude: excludeMigrations });
 return db;
}
export async function rpc(db,name,body) {
 const allowed = ['lead_command_execute','lead_command_status','lead_claim_alert','lead_finish_alert','lead_release_alert','lead_reconcile_alert','lead_worker_heartbeat','seller_command_status','seller_workflow_reliable','seller_import','seller_review','seller_link','seller_workflow','seller_claim_outbox','seller_finish_outbox','seller_reconcile'];
 if (!allowed.includes(name)) throw new Error('Unknown RPC');
 const args=Object.entries(body); if (args.some(([k])=>!/^[a-z_]+$/.test(k))) throw new Error('Invalid arguments');
 const sql=`select * from public.${name}(${args.map(([k],i)=>`${k} => $${i+1}`).join(',')})`;
 const {rows}=await db.query(sql,args.map(([,v])=>v && typeof v==='object'? JSON.stringify(v):v));
 return ['seller_claim_outbox','lead_claim_alert'].includes(name)?rows:rows[0]?.[name];
}
