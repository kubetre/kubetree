import {Dependencies,ObjectDetails} from './dependencies.jsx';
import React,{useState,useEffect,useRef} from 'react';import{createRoot}from'react-dom/client';import './style.css';import brandLogo from './kubetre-logo.png';
async function api(path,params={}){const r=await fetch('/api/'+path+'?'+new URLSearchParams(params),{headers:{'X-KubeTree-Local':'1'}});if(!r.ok){const t=await r.text();try{throw new Error(JSON.parse(t).error||t)}catch(e){if(e instanceof SyntaxError)throw new Error(t);throw e}}return r.json()}
function Logs({resource,children,context}){const pods=[];function visit(x,seen=new Set()){if(seen.has(x.metadata.uid))return;seen.add(x.metadata.uid);if(x.kind==='Pod')pods.push(x);else (children.get(x.metadata.uid)||[]).forEach(y=>visit(y,seen))}visit(resource);const [id,S]=useState(pods[0]?.metadata.uid||''),[container,C]=useState(''),[tail,T]=useState('100'),[previous,P]=useState(false),[timestamps,TS]=useState(true),[live,L]=useState(false),[output,O]=useState(''),[error,E]=useState(''),[search,Q]=useState('');const pod=pods.find(x=>x.metadata.uid===id);const containers=[...(pod?.spec?.containers||[]),...(pod?.spec?.initContainers||[])];const name=containers.some(x=>x.name===container)?container:containers[0]?.name;const [refresh,R]=useState(0);useEffect(()=>{let active=true,timer;const controller=new AbortController();async function read(){if(!pod||!name)return;try{const r=await fetch('/api/logs?'+new URLSearchParams({context,namespace:pod.metadata.namespace,pod:pod.metadata.name,container:name,tail,previous,timestamps}),{signal:controller.signal,headers:{'X-KubeTree-Local':'1'}});const data=await r.json();if(!r.ok)throw Error(data.error||'Log request failed');if(active){O(data.logs);E('')}}catch(e){if(active)E(e.message)}finally{if(active&&live)timer=setTimeout(read,3000)}}O('');E('');read();return()=>{active=false;clearTimeout(timer);controller.abort()}},[context,id,name,tail,previous,timestamps,live,refresh]);if(!pods.length)return <p>No associated Pods available.</p>;const filtered=output.split('\n').filter(x=>x.toLowerCase().includes(search.toLowerCase())).join('\n');return <div className="logs"><label>Pod <select value={id} onChange={e=>{S(e.target.value);C('')}}>{pods.map(x=><option key={x.metadata.uid} value={x.metadata.uid}>{x.metadata.name}</option>)}</select></label><label>Container <select value={name||''} onChange={e=>C(e.target.value)}>{containers.map(x=><option key={x.name}>{x.name}</option>)}</select></label><label>Lines <select value={tail} onChange={e=>T(e.target.value)}>{[100,500,1000].map(x=><option key={x}>{x}</option>)}</select></label><label><input type="checkbox" checked={previous} onChange={e=>P(e.target.checked)}/>Previous container</label><label><input type="checkbox" checked={timestamps} onChange={e=>TS(e.target.checked)}/>Timestamps</label><button onClick={()=>L(!live)}>{live?'Pause':'Auto-refresh (3s)'}</button><button onClick={()=>R(x=>x+1)}>Refresh</button><input placeholder="Search logs" value={search} onChange={e=>Q(e.target.value)}/><button onClick={()=>navigator.clipboard.writeText(filtered).catch(e=>E(e.message))}>Copy</button><button onClick={()=>{const url=URL.createObjectURL(new Blob([filtered],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='container.log';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>Download</button>{error&&<p className="error">{error}</p>}<pre className="log-output">{filtered||'No log output'}</pre></div>}
function App(){const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('kubetree-theme')==='light'?'light':'dark'}catch{return 'dark'}});useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('kubetree-theme',theme)}catch{}},[theme]);const [context,C]=useState(''),[ns,N]=useState(()=>{try{return localStorage.getItem('kubetree-namespace')||'default'}catch{return 'default'}}),[draft,T]=useState(ns),[names,S]=useState([]),[items,I]=useState([]),[warnings,W]=useState([]),[error,E]=useState(''),[busy,B]=useState(false),[selected,D]=useState(null),[search,Q]=useState(''),[collapsed,F]=useState({}),[view,V]=useState("list"),[zoom,Z]=useState(1),[tab,Tab]=useState("Details"),[anchor,A]=useState(null);const [expanded,expand]=useState(false),[fit,setFit]=useState(true),[fitMode,setFitMode]=useState("width");const scrollRef=useRef(null),canvasRef=useRef(null);
const dragRef=useRef(null);
const [lastRefresh,setLastRefresh]=useState(null);
const zoomRef=useRef(zoom);
zoomRef.current=zoom;

function changeZoom(value,point){
  const el=scrollRef.current;
  const canvas=canvasRef.current;
  if(!el||!canvas)return;
  const next=Math.max(.05,Math.min(2,value));
  const rect=canvas.getBoundingClientRect();
  const x=point?.clientX??(el.getBoundingClientRect().left+el.clientWidth/2);
  const y=point?.clientY??(el.getBoundingClientRect().top+el.clientHeight/2);
  const gx=(x-rect.left)/zoomRef.current;
  const gy=(y-rect.top)/zoomRef.current;
  setFit(false);
  Z(next);
  requestAnimationFrame(()=>{
    const updated=canvas.getBoundingClientRect();
    el.scrollLeft+=updated.left+gx*next-x;
    el.scrollTop+=updated.top+gy*next-y;
  });
}

useEffect(()=>{
  const el=scrollRef.current;
  if(view!=="graph"||busy||!el)return;
  function wheel(e){
    if(e.target.closest("input"))return;
    e.preventDefault();
    changeZoom(zoomRef.current*Math.exp(-e.deltaY*.0015),e);
  }
  el.addEventListener("wheel",wheel,{passive:false});
  return()=>el.removeEventListener("wheel",wheel);
},[view,busy,expanded]);

function startPan(e){
  if(e.button!==0||e.target.closest("button,input"))return;
  const el=e.currentTarget;
  dragRef.current={
    x:e.clientX,y:e.clientY,
    left:el.scrollLeft,top:el.scrollTop
  };
  el.setPointerCapture(e.pointerId);
  el.classList.add("panning");
}
function movePan(e){
  const d=dragRef.current;
  if(!d)return;
  e.currentTarget.scrollLeft=d.left+d.x-e.clientX;
  e.currentTarget.scrollTop=d.top+d.y-e.clientY;
}
function stopPan(e){
  dragRef.current=null;
  e.currentTarget.classList.remove("panning");
}
useEffect(()=>{if(!expanded)return;const old=document.body.style.overflow;document.body.style.overflow="hidden";const close=e=>{if(e.key==="Escape")expand(false)};window.addEventListener("keydown",close);return()=>{document.body.style.overflow=old;window.removeEventListener("keydown",close)}},[expanded]);useEffect(()=>{if(view!=="graph"||!fit||busy)return;const el=scrollRef.current,canvas=canvasRef.current;if(!el||!canvas)return;const resize=()=>{const width=Math.max(1,...Array.from(canvas.children,x=>x.offsetWidth));const height=Math.max(1,canvas.offsetHeight);
const widthScale=(el.clientWidth-42)/width;
const heightScale=(el.clientHeight-42)/height;
Z(Math.min(1,Math.max(.05,fitMode==="screen"?Math.min(widthScale,heightScale):widthScale)));
requestAnimationFrame(()=>{
  el.scrollLeft=Math.max(0,(el.scrollWidth-el.clientWidth)/2);
  el.scrollTop=0;
})};resize();const observer=new ResizeObserver(resize);observer.observe(el);for(const child of canvas.children)observer.observe(child);return()=>observer.disconnect()},[view,fit,fitMode,busy,items,search,collapsed,expanded]);function select(x){D(x);Tab('Details');if(view!=='dep')A(x)}
async function connect(){E('');try{const c=(await api('context')).context;C(c);try{S(await api('namespaces',{context:c}))}catch(e){S([]);E('Namespace discovery failed: '+e.message);console.error(e)}}catch(e){E(e.message)}}
useEffect(()=>{connect()},[]);useEffect(()=>{if(context)load()},[context,ns]);useEffect(()=>{try{localStorage.setItem("kubetree-namespace",ns)}catch{}},[ns]);
async function load(){B(true);E('');I([]);D(null);A(null);W([]);try{const data=await api('resources',{context,namespace:ns});I(data.items);W(data.warnings);setLastRefresh(new Date())}catch(e){E(e.message)}finally{B(false)}}
const ids=new Set(items.map(x=>x.metadata.uid));const children=new Map();const roots=[];for(const x of items){const p=x.metadata.ownerReferences?.find(o=>o.controller&&ids.has(o.uid));if(p){if(!children.has(p.uid))children.set(p.uid,[]);children.get(p.uid).push(x)}else roots.push(x)}
function matches(x,seen=new Set()){if(seen.has(x.metadata.uid))return false;seen.add(x.metadata.uid);return (x.kind+' '+x.metadata.name+' '+x.metadata.namespace).toLowerCase().includes(search.toLowerCase())||(children.get(x.metadata.uid)||[]).some(y=>matches(y,seen))}
function node(x,seen=new Set()){const id=x.metadata.uid;if(seen.has(id)||!matches(x))return null;const next=new Set(seen).add(id),kids=children.get(id)||[];return <li key={id}><div className={'node '+(selected?.metadata.uid===id?'selected':'')}><button className="toggle" aria-label="Toggle children" disabled={!kids.length} onClick={()=>F(old=>({...old,[id]:!old[id]}))}>{kids.length?(collapsed[id]?'▸':'▾'):'·'}</button><button className="resource" onClick={()=>select(x)}><span className="kind">{x.kind}</span> {x.metadata.name}<small>{x.metadata.namespace} · {x.status?.phase|| (x.kind==='Deployment'?`${x.status?.readyReplicas||0} ready`:'')}</small></button></div>{!collapsed[id]&&kids.length>0&&<ul>{kids.map(y=>node(y,next))}</ul>}</li>}
function graph(x,seen=new Set()){const id=x.metadata.uid;if(seen.has(id)||!matches(x))return null;const next=new Set(seen).add(id),kids=(children.get(id)||[]).filter(y=>matches(y)&&!next.has(y.metadata.uid));return <li key={id}><div className={'graph-card '+(selected?.metadata.uid===id?'selected':'')}><button className="graph-resource" onClick={()=>select(x)}><span className="kind">{x.kind}</span><strong>{x.metadata.name}</strong><small>{x.metadata.namespace} · {x.status?.phase|| (x.kind==='Deployment'?`${x.status?.readyReplicas||0} ready`:'')}</small></button>{kids.length>0&&<button className="graph-toggle" aria-label={collapsed[id]?'Expand children':'Collapse children'} aria-expanded={!collapsed[id]} onClick={()=>F(old=>({...old,[id]:!old[id]}))}>{collapsed[id]?'＋':'−'} {kids.length}</button>}</div>{!collapsed[id]&&kids.length>0&&<ul>{kids.map(y=>graph(y,next))}</ul>}</li>}
return <><header><a className="brand" href="https://kubetre.com" target="_blank" rel="noopener noreferrer"><img src={brandLogo} alt="KubeTre"/><span className="product-name">KubeTree</span></a><div className="header-actions"><span className="pill">READ ONLY · LOCAL</span><button type="button" className="theme-toggle" aria-label={theme==='light'?'Switch to dark theme':'Switch to light theme'} onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>{theme==='light'?'☾ Dark':'☀ Light'}</button></div></header><main><section className="toolbar"><label>Context <b>{context||'Not connected'}</b></label><label className="namespace-control">Namespace <select value={draft} disabled={busy} onChange={e=>T(e.target.value)}>
<option value="*">All namespaces</option>
{[...new Set(['default', ...(draft==='*'?[]:[draft]), ...names])].map(n=><option key={n} value={n}>{n}</option>)}
</select><button disabled={busy} onClick={()=>N(draft.trim()||'default')}>Apply</button></label><button disabled={busy||!context} onClick={load}>Refresh</button><button disabled={busy} onClick={connect}>Reconnect</button></section><div className="search-row">
<div className="search-box">
<span className="search-icon" aria-hidden="true">⌕</span>
<input className="search" aria-label="Search resources" placeholder="Search resources…" value={search} onChange={e=>Q(e.target.value)}/>
{search&&<button className="search-clear" aria-label="Clear search" onClick={()=>Q("")}>×</button>}
</div>
<span className="refresh-status" role="status">
{busy?"Refreshing…":lastRefresh?"Last refreshed: "+lastRefresh.toLocaleTimeString():"Not refreshed yet"}
</span>
</div>{error&&<p role="alert" className="error">{error}</p>}{warnings.map(w=><p className="error" key={w}>{w}</p>)}<div className={"panels "+(expanded?"graph-expanded":"")}><section className="resource-panel"><h2>Resource tree <small>{search?`${items.filter(x=>(x.kind+" "+x.metadata.name+" "+x.metadata.namespace).toLowerCase().includes(search.toLowerCase())).length} matches · ${items.length} total`:`${items.length} resources`}</small></h2><div className="view-controls"><button aria-pressed={view==='list'} onClick={()=>{expand(false);V('list')}}>List view</button><button aria-pressed={view==='graph'} onClick={()=>{setFit(true);V('graph')}}>Graph view</button><button aria-pressed={view==='dep'} onClick={()=>{expand(false);A(selected);V('dep')}}>Dependency view</button><button onClick={()=>F({})}>Expand all</button><button onClick={()=>F(Object.fromEntries(items.map(x=>[x.metadata.uid,true])))}>Collapse all</button>{view==='graph'&&<label>Zoom <input type="range" min="0.05" max="2" step="0.05" value={zoom} onChange={e=>changeZoom(Number(e.target.value))}/> <button aria-label="Zoom out" onClick={()=>changeZoom(zoom/1.2)}>−</button>
<span className="zoom-value">{Math.round(zoom*100)}%</span>
<button aria-label="Zoom in" onClick={()=>changeZoom(zoom*1.2)}>+</button>
<button onClick={()=>changeZoom(1)}>100%</button><button onClick={()=>{setFitMode("width");setFit(false);requestAnimationFrame(()=>setFit(true))}}>Fit to width</button>
<button onClick={()=>{setFitMode("screen");setFit(false);requestAnimationFrame(()=>setFit(true))}}>Fit to screen</button>
<button onClick={()=>{setFitMode("width");setFit(false);requestAnimationFrame(()=>setFit(true))}}>Reset view</button><button onClick={()=>{setFit(true);expand(v=>!v)}}>{expanded?"Exit full screen":"Full screen"}</button></label>}</div>{busy?<p role="status" className="loading-state">Loading resources…</p>:view==='dep'? (anchor?<><button onClick={()=>A(selected)} disabled={!selected}>Focus selected resource</button><Dependencies key={anchor.metadata.uid} context={context} resource={anchor} children={children} onSelect={x=>{const found=items.find(y=>y.kind===x.kind&&y.metadata.name===x.metadata.name&&y.metadata.namespace===x.metadata.namespace);select(found||x)}}/></>:<p>Select a resource in List or Graph view first.</p>):view==='list'?<ul className="tree">{roots.map(x=>node(x))}</ul>:<div ref={scrollRef} className="graph-scroll" tabIndex={0} aria-label="Interactive resource graph"
onPointerDown={startPan}
onPointerMove={movePan}
onPointerUp={stopPan}
onPointerCancel={stopPan}
onLostPointerCapture={stopPan}><div ref={canvasRef} className="graph-canvas" style={{zoom}}>{roots.filter(x=>matches(x)).map(x=><ul className="graph-root" key={x.metadata.uid}>{graph(x)}</ul>)}</div></div>}{!busy&&!items.length&&!error&&<div className="empty-state"><strong>No resources found</strong><p>Try selecting another namespace or refreshing your connection.</p></div>}</section><section><h2>Resource details</h2>{selected?<><h3>{selected.metadata.name}</h3><p>{selected.kind} · {selected.metadata.namespace}</p><div className="view-controls">{["Details","Logs","YAML"].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>Tab(t)}>{t}</button>)}</div>{tab==="YAML"?<ObjectDetails key={selected.metadata.uid+"yaml"} context={context} resource={selected} yaml/>:tab==="Logs"?<Logs key={selected.metadata.uid} resource={selected} children={children} context={context}/>:selected.metadata.uid.startsWith("ref:")||selected.kind==="Secret"?<ObjectDetails key={selected.metadata.uid} context={context} resource={selected}/>:<><h4>Labels</h4><pre>{JSON.stringify(selected.metadata.labels||{},null,2)}</pre><h4>Status</h4><pre>{JSON.stringify(selected.status||{},null,2)}</pre></>}</>:<p>Select a resource to inspect it.</p>}</section></div></main></>}
createRoot(document.getElementById('root')).render(<App/>);
