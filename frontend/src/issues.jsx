import React,{useEffect,useRef,useState} from "react";
import {metricRows,percentage} from "./metrics.js";
export function IssuesPanel({context,namespace,inventory,busy,onOpenResource,metrics,metricState}){
 const [events,E]=useState([]),[error,X]=useState(""),[loading,L]=useState(true),[filter,F]=useState("All"),[type,T]=useState("All");
 const [logs,S]=useState([]),[scanStatus,U]=useState(""),[scanning,B]=useState(false),scan=useRef(null);
 useEffect(()=>{const c=new AbortController();fetch("/api/issues/events?"+new URLSearchParams({context,namespace}),{signal:c.signal,headers:{"X-KubeTree-Local":"1"},cache:"no-store"}).then(async r=>{if(!r.ok)throw Error("Check event permissions and connectivity");return r.json()}).then(d=>{if(!c.signal.aborted)E(d||[])}).catch(e=>{if(!c.signal.aborted)X(e.message)}).finally(()=>{if(!c.signal.aborted)L(false)});return()=>{c.abort();scan.current?.abort()}},[context,namespace]);
 const pods=inventory.filter(x=>x.kind==="Pod"),groups=new Map();
 function add(resource,kind,name,ns,uid,severity,category,reason,message,tab="Details"){
  const key=uid||JSON.stringify([kind,ns,name]);
  if(!groups.has(key))groups.set(key,{resource,kind,name,ns,severity,entries:[]});
  const g=groups.get(key);if(severity==="Critical")g.severity=severity;
  if(!g.entries.some(e=>e.reason===reason&&e.message===message))g.entries.push({severity,category,reason,message,tab});
 }
 function podIssue(p,severity,category,reason,message,tab){const m=p.metadata;add(p,"Pod",m.name,m.namespace,m.uid,severity,category,reason,message,tab)}
 for(const p of pods){
  for(const c of [...(p.status?.containerStatuses||[]),...(p.status?.initContainerStatuses||[])]){
   const reason=c.state?.waiting?.reason||c.state?.terminated?.reason;
   if(["CrashLoopBackOff","OOMKilled","ImagePullBackOff","ErrImagePull","CreateContainerConfigError","CreateContainerError","RunContainerError"].includes(reason))podIssue(p,"Critical","Container",reason,c.name);
   if(c.restartCount>1)podIssue(p,"Warning","Container","Restarts",`${c.name}: ${c.restartCount} restarts`);
   const last=c.lastState?.terminated;
   if(reason!=="OOMKilled"&&last?.reason==="OOMKilled")podIssue(p,"Critical","Container","Previous OOMKilled",c.name);
   if(c.restartCount>1&&last?.exitCode>0&&last.reason!=="OOMKilled"&&reason!=="CrashLoopBackOff")podIssue(p,"Warning","Container","Repeated container failure",`${c.name}: previous exit ${last.exitCode}`);
  }
  for(const r of metricRows(p,new Map(),metrics))for(const [label,usage,limit] of [["CPU",r.cpu,r.cpuLimit],["Memory",r.memory,r.memoryLimit]]){
   const pct=percentage(usage,limit);if(pct!==null&&pct>=80)podIssue(p,pct>=90?"Critical":"Warning","Metrics",`${label} limit usage`,`${r.container}: ${pct}% of limit`,"Metrics");
  }
 }
 for(const e of events){const o=e.involvedObject||{},ns=o.namespace||e.metadata?.namespace||"",p=inventory.find(x=>x.metadata.uid===o.uid);const crash=o.kind==="Pod"&&e.reason==="BackOff"&&/restarting failed container/i.test(e.message||"");add(p,o.kind||"Resource",o.name||"Unknown",ns,o.uid,crash?"Critical":"Warning","Events",e.reason||"Warning",`${e.message||""}${e.count>1?` (${e.count} occurrences)`:""}`)}
 for(const l of logs){const p=pods.find(x=>x.metadata.uid===l.uid);if(p)podIssue(p,l.errors||l.exceptions?"Critical":"Warning","Logs","Log matches",`${l.container}: ${l.errors} errors, ${l.warnings} warnings, ${l.exceptions} exceptions`,"Logs")}
 async function scanLogs(){
  if(scan.current)return;const c=new AbortController();scan.current=c;B(true);S([]);U("Scanning…");
  const all=pods.flatMap(p=>(p.status?.containerStatuses||[]).filter(s=>s.state?.running||s.state?.terminated||s.restartCount>0).map(s=>({p,s}))),jobs=all.slice(0,100);let next=0,failed=0,done=0;const found=[];
  async function worker(){while(!c.signal.aborted&&next<jobs.length){const {p,s}=jobs[next++];try{const r=await fetch("/api/logs?"+new URLSearchParams({context,namespace:p.metadata.namespace,pod:p.metadata.name,container:s.name,tail:"1000"}),{signal:c.signal,headers:{"X-KubeTree-Local":"1"},cache:"no-store"});if(!r.ok)throw Error();const d=await r.json();let errors=0,warnings=0,exceptions=0;for(const line of (d.logs||"").split("\n")){if(/\berror\b/i.test(line))errors++;if(/\bwarn(?:ing)?\b/i.test(line))warnings++;if(/\b\w*exception\b/i.test(line))exceptions++}if(errors||warnings||exceptions)found.push({uid:p.metadata.uid,container:s.name,errors,warnings,exceptions});done++}catch{if(!c.signal.aborted)failed++}}}
  await Promise.all(Array.from({length:4},worker));if(!c.signal.aborted){S(found);U(`Scanned ${done}/${jobs.length} containers; ${failed} unavailable.${all.length>100?` Limited to 100 of ${all.length}.`:""} Keyword matches in recent logs, not confirmed failures.`)}else U("Scan cancelled.");if(scan.current===c){scan.current=null;B(false)}
 }
 const priority=e=>e.reason.includes("OOMKilled")?0:e.reason==="CrashLoopBackOff"?1:e.severity==="Critical"&&e.category==="Container"?2:e.severity==="Critical"?3:e.reason==="Restarts"?5:4;
 for(const g of groups.values())g.entries.sort((a,b)=>priority(a)-priority(b));
 const rows=[...groups.values()].sort((a,b)=>a.severity.localeCompare(b.severity)||a.name.localeCompare(b.name)),critical=rows.filter(r=>r.severity==="Critical").length;
 function inspect(r,tab){onOpenResource({...r.resource.metadata,kind:r.resource.kind},"list",tab)}
 return <section className="global-search issues-panel"><h2>Issues</h2><p className="global-search-summary">Scope: {namespace==="*"?"All namespaces":namespace} · Grouped by affected resource</p><div className="metric-grid">{[["Critical",critical],["Warnings",rows.length-critical],["Affected resources",rows.length]].map(([label,value])=><div className="metric-card" key={label}><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong></div>)}</div><div className="view-controls"><label className="issue-filter">Severity<select aria-label="Severity" value={filter} onChange={e=>F(e.target.value)}>{["All","Critical","Warning"].map(x=><option key={x}>{x}</option>)}</select></label><label className="issue-filter">Issue type<select aria-label="Issue type" value={type} onChange={e=>T(e.target.value)}>{["All","Container","Events","Metrics","Logs"].map(x=><option key={x}>{x}</option>)}</select></label><button disabled={busy||!context} onClick={()=>scanning?scan.current?.abort():scanLogs()}>{scanning?"Cancel scan":"Scan logs"}</button></div><p className="global-search-summary">Metrics: {metricState.available?"80% warning / 90% critical of configured limits":metricState.loading?"Loading…":"Unavailable; no usage alerts"}{metricState.updatedAt&&` · Retrieved ${new Date(metricState.updatedAt).toLocaleTimeString()}`}</p>{scanStatus&&<p role="status">{scanStatus}</p>}{(busy||loading)&&<p role="status">Loading issue data…</p>}{error&&<p className="error">Warning events unavailable: {error}</p>}{rows.filter(r=>(filter==="All"||r.severity===filter)&&(type==="All"||r.entries.some(e=>e.category===type))).map(r=><details className="issue-group" key={r.resource?.metadata.uid||JSON.stringify([r.kind,r.ns,r.name])}><summary><span className={r.severity==="Critical"?"health-unhealthy":"health-warning"}>{r.severity}</span><span><strong>{r.name}</strong><small>{r.kind} · {r.ns}</small></span><span>{r.entries[0].reason} · {r.entries.length} {r.entries.length===1?"signal":"signals"}</span><span className="issue-chevron" aria-hidden="true">›</span></summary><div className="issue-body">{r.entries.filter(e=>type==="All"||e.category===type).map((e,i)=><p key={i}><strong>{e.reason}</strong> — {e.message}</p>)}{r.resource&&<div className="view-controls"><button onClick={()=>inspect(r,"Details")}>Inspect</button>{r.kind==="Pod"&&<><button onClick={()=>inspect(r,"Metrics")}>Metrics</button><button onClick={()=>inspect(r,"Logs")}>Logs</button></>}</div>}</div></details>)}{!rows.length&&!busy&&!loading&&<p>No issues detected in available data.</p>}</section>
}
