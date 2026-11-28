import { COMMAND_PHASE } from '../lib/command-phase.js';
import { databaseMode } from '../lib/local-database.js';
// Manual only; scheduling and activation require separate approval.
import { reliabilityRpc } from '../lib/lead-reliability.js';
import { processLeadAlerts, publicAlertSender } from '../lib/lead-alerts.js';
const env=process.env;
// The site's own database can be open in one process only, the running site. Never open a second copy.
if(databaseMode(env)==='local'){
 console.error('This site keeps its database on this server, and only the running site (server.mjs) may open it. This worker works only with a Supabase database (SUPABASE_URL). Nothing was done.');
 process.exit(1);
}
if(COMMAND_PHASE!=='protocol'||env.LEAD_RELIABILITY_DISPATCH_ENABLED!=='true')console.log('Public alert dispatch OFF; no database access or sends.');
else {
 try{console.log(JSON.stringify(await processLeadAlerts({env,rpc:reliabilityRpc(env),send:publicAlertSender(env)})));}
 catch{console.error('Alert completion unconfirmed. Inspect queue and provider evidence before retry.');process.exitCode=1;}
}
