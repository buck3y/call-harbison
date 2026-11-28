import { COMMAND_PHASE } from './command-phase.js';
// Public notification intents: one job is one external request. No credentials in snapshots.
import { createHmac } from 'node:crypto';
import { digest } from './lead-reliability.js';
import { hqUrl } from './hq-url.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e164=p=>{const d=String(p||'').replace(/\D/g,'');return d.length===10?`+1${d}`:d.length===11&&d[0]==='1'?`+${d}`:null;};

// LEAD_WEBHOOK_SECRET (optional): every webhook post carries X-Call-Harbison-Signature: sha256=<hex HMAC-SHA256 of
// the exact body>, so the receiver can tell a post from this site from one anybody could send to its URL.
export function webhookHeaders(body, env) {
 const headers={'Content-Type':'application/json'};
 if(env.LEAD_WEBHOOK_SECRET)headers['X-Call-Harbison-Signature']=`sha256=${createHmac('sha256',String(env.LEAD_WEBHOOK_SECRET)).update(body).digest('hex')}`;
 return headers;
}

// Customer acknowledgement texts (LEAD_ACK_ENABLED=true) go to the number typed into the form, so a flood of fake
// leads could text strangers at this site's cost. At most LEAD_ACK_DAILY_MAX (default 30) a day, Bakersfield date,
// counted in this process. Staff alerts are not counted.
const ackCount={day:'',sent:0,noted:false};
const bakersfieldDay=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const ackDailyMax=env=>{const n=Number.parseInt(String(env.LEAD_ACK_DAILY_MAX??'').trim(),10);return Number.isInteger(n)&&n>=0?n:30;};
export function takeAckSlot(env,now=Date.now(),log=console.warn){
 const day=bakersfieldDay(now),max=ackDailyMax(env);
 if(ackCount.day!==day)Object.assign(ackCount,{day,sent:0,noted:false});
 if(ackCount.sent>=max){
  if(!ackCount.noted){ackCount.noted=true;log(`[leads] customer acknowledgement texts are paused until tomorrow: the daily ceiling of ${max} (LEAD_ACK_DAILY_MAX) was reached. Staff alerts still go out.`);}
  return false;
 }
 ackCount.sent+=1;return true;
}
export const resetAckCount=()=>Object.assign(ackCount,{day:'',sent:0,noted:false});

export function alertIntents(lead, env, {details=false, recipients, ack, spanish=false}={}) {
 const jobs=[];const add=(channel,target,payload)=>jobs.push({channel,target,payload});
 const leadLink=hqUrl(env,lead.id);
 const link=`<p><a href="${esc(leadLink)}">Open in Harbison HQ →</a></p>`;
 // No LEAD_NOTIFY_EMAIL, no e-mail: there is no default recipient. The lead is still stored and shown in HQ.
 if(env.RESEND_API_KEY&&Array.isArray(recipients)&&recipients.length){
  let body;
  if(details){
   const summary=[lead.timeline&&`Timeline: ${lead.timeline}`,lead.occupancy&&`Occupancy: ${lead.occupancy}`,lead.condition_flags?.length&&`Condition: ${lead.condition_flags.join(', ')}`,lead.desired_outcome&&`Goal: ${lead.desired_outcome}`].filter(Boolean);
   body={from:env.LEAD_FROM_EMAIL||'Harbison Leads <onboarding@resend.dev>',to:recipients,subject:`Lead details added: ${lead.address || lead.situation}`,html:`<p><strong>${esc(lead.address)}</strong> · ${esc(lead.phone)}</p><ul>${summary.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>${link}`};
  }else{
   const rows=[...Object.entries(lead),...(spanish?[['language','Spanish: please reply in Spanish']]:[])].filter(([k,v])=>v&&k!=='id').map(([k,v])=>`<tr><td style="padding:4px 12px 4px 0;color:#62717a">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join('');
   body={from:env.LEAD_FROM_EMAIL||'Harbison Leads <onboarding@resend.dev>',to:recipients,reply_to:lead.email||undefined,subject:`New ${lead.form_type==='family_transition'?'family property':'property'} lead [${lead.channel}]${spanish?' [ES]':''}: ${lead.address || lead.situation}`,html:`<h2 style="font-family:Georgia,serif;color:#031f2b">New property lead</h2><table>${rows}</table><p><a href="tel:${esc(lead.phone)}">Call ${esc(lead.name)}</a> · <a href="${esc(leadLink)}">Open in Harbison HQ →</a></p>`};
  }
  add('email',JSON.stringify(recipients),body);
 }
 if(env.LEAD_WEBHOOK_URL) add('webhook',digest(env.LEAD_WEBHOOK_URL),{...(details?{kind:'details'}:{}),...lead,submitted_at:new Date().toISOString()});
 if(!details && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM){
  const to=e164(lead.phone);
  if(env.LEAD_ACK_ENABLED==='true'&&to&&lead.contact_pref!=='Email'&&lead.consent_response&&takeAckSlot(env)) add('customer_sms',to,{to,from:env.TWILIO_FROM,body:ack});
  const alert=`NEW LEAD${spanish?' [SPANISH]':''} (${lead.channel}${lead.ref_partner?`:${lead.ref_partner}`:''}) ${lead.name} ${lead.phone} — ${lead.address.split(',')[0]}. ${lead.situation||''} ${lead.relationship?`| ${lead.relationship}`:''}${lead.route_interest?` | path: ${lead.route_interest}`:''} | prefers ${lead.contact_pref||'call'}`.slice(0,320);
  for(const n of new Set((env.LEAD_ALERT_SMS||'').split(',').map(n=>e164(n.trim())).filter(Boolean))) add('sms',n,{to:n,from:env.TWILIO_FROM,body:alert});
 }
 return jobs;
}
export function publicAlertSender(env, fetcher=fetch){
 const validate=()=>{if(!env.RESEND_API_KEY&&!env.LEAD_WEBHOOK_URL&&!(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM))throw new Error('No dispatch configuration');};
 const prepare=job=>{
  if(job.channel==='email'){
   if(!env.RESEND_API_KEY)throw new Error('Email unavailable');
   return ['https://api.resend.com/emails',{headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`hbh-command-${job.id}`},body:JSON.stringify(job.payload)}];
  }
  if(job.channel==='webhook'){
   if(!env.LEAD_WEBHOOK_URL||digest(env.LEAD_WEBHOOK_URL)!==job.target)throw new Error('Webhook configuration changed');
   const body=JSON.stringify(job.payload);
   return [env.LEAD_WEBHOOK_URL,{headers:webhookHeaders(body,env),body}];
  }
  if(!['sms','customer_sms'].includes(job.channel)||!env.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN||env.TWILIO_FROM!==job.payload.from)throw new Error('SMS configuration changed');
  return [`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{headers:{Authorization:`Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:job.payload.to,From:job.payload.from,Body:job.payload.body})}];
 };
 const send=async(job,prepared)=>{
  const [url,options]=prepared;const r=await fetcher(url,{...options,method:'POST',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Object.assign(new Error('Provider response unconfirmed'),{definitelyRejected:r.status>=400&&r.status<500&&r.status!==408});
  if(job.channel==='webhook')return {id:`http:${r.status}`};
  const receipt=await r.json();return {id:job.channel==='email'?receipt.id:receipt.sid};
 };
 return Object.assign(send,{validate,prepare});
}
export async function processLeadAlerts({env,rpc,send,phase=COMMAND_PHASE}){
 if(phase!=='protocol'||env.LEAD_RELIABILITY_DISPATCH_ENABLED!=='true')return {disabled:true,processed:0};
 send.validate();await rpc('lead_worker_heartbeat');
 const jobs=await rpc('lead_claim_alert');let processed=0;
 for(const job of jobs){
  let prepared;
  try{prepared=send.prepare(job);}catch(error){
   if(await rpc('lead_release_alert',{job_id:job.id,lease:job.lease})!==true)throw new Error('Release unconfirmed');
   throw error;
  }
  if(!(Date.parse(job.lease_until)-Date.now()>=30000))throw new Error('Lease expired; reconcile');
  let result;
  try{const receipt=await send(job,prepared);result=receipt?.id?{state:'accepted',provider_id:String(receipt.id)}:{state:'uncertain',provider_id:null};}
  catch(e){result={state:e.definitelyRejected===true?'failed':'uncertain',provider_id:null};}
  if(await rpc('lead_finish_alert',{job_id:job.id,lease:job.lease,...result})!==true)throw new Error('Completion unconfirmed; reconcile');
  processed++;
 }
 return {processed};
}
