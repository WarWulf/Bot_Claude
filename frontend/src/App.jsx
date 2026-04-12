import { useEffect, useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const C={bg:'#0a0e17',card:'#111827',border:'#1e293b',green:'#22c55e',red:'#ef4444',amber:'#f59e0b',blue:'#3b82f6',purple:'#8b5cf6',cyan:'#06b6d4',text:'#e2e8f0',muted:'#64748b',dim:'#334155'};
const fmt=(v,d=2)=>{const n=Number(v);return Number.isNaN(n)?'-':n.toFixed(d);};
const mono={fontFamily:'JetBrains Mono,monospace'};

const ERR_HELP={'aborted':'LLM-Provider zu langsam. Erhöhe LLM Timeout (z.B. 20000ms).','http 401':'API-Key ungültig.','http 429':'Zu viele Anfragen. Warte ein paar Minuten.','http 500':'Server-Fehler beim Provider.','ECONNREFUSED':'URL falsch oder Server nicht erreichbar.','fetch failed':'Netzwerk-Problem.','no_llm_provider':'Kein LLM konfiguriert.','llm_disabled':'LLM deaktiviert — Heuristik wird benutzt.'};
function helpErr(msg){const s=String(msg||'').toLowerCase();for(const[k,v]of Object.entries(ERR_HELP))if(s.includes(k.toLowerCase()))return v;return null;}
function dirExplain(p){if(!p)return'';const e=Number(p.edge||0),m=Number(p.market_prob||0),mdl=Number(p.model_prob||0);
  if(p.direction==='BUY_YES')return`Bot: ${(mdl*100).toFixed(0)}% vs Markt: ${(m*100).toFixed(0)}% → Vorteil +${(e*100).toFixed(1)}%. Markt unterbewertet → YES kaufen.`;
  if(p.direction==='BUY_NO')return`Bot: ${(mdl*100).toFixed(0)}% vs Markt: ${(m*100).toFixed(0)}% → Markt zu hoch → NO kaufen.`;
  return`Unterschied zu klein oder Confidence zu niedrig.`;}

function Card({title,help,children,accent}){return<div style={{background:C.card,border:`1px solid ${accent||C.border}`,borderRadius:10,padding:'14px 16px',marginBottom:14}}>{title&&<div style={{fontSize:14,fontWeight:600,marginBottom:help?4:10}}>{title}</div>}{help&&<div style={{fontSize:12,color:C.muted,marginBottom:10,lineHeight:1.5}}>{help}</div>}{children}</div>;}
function Metric({label,value,unit='',target,good,help}){return<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px',flex:'1 1 120px',minWidth:120}} title={help||''}><div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:1,...mono}}>{label}</div><div style={{fontSize:18,fontWeight:700,color:(good!==undefined?good:true)?C.green:C.red,marginTop:2,...mono}}>{value}{unit}</div>{target&&<div style={{fontSize:9,color:C.dim,...mono}}>Ziel: {target}</div>}</div>;}
function Gauge({label,value,max,warning,help}){const p=Math.min((value/max)*100,100);const color=value>=max*0.95?C.red:value>=warning?C.amber:C.green;return<div style={{marginBottom:8}} title={help||''}><div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted,marginBottom:2,...mono}}><span>{label}</span><span style={{color}}>{fmt(value*100,1)}%/{fmt(max*100,0)}%</span></div><div style={{height:5,background:C.dim,borderRadius:3,overflow:'hidden',position:'relative'}}><div style={{position:'absolute',left:`${(warning/max)*100}%`,top:0,bottom:0,width:2,background:C.amber,opacity:0.5}}/><div style={{height:'100%',width:`${p}%`,background:color,borderRadius:3,transition:'width 0.4s'}}/></div></div>;}
function Pill({ok,label}){return<span style={{fontSize:10,padding:'3px 9px',borderRadius:14,background:ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',color:ok?C.green:C.red,...mono,border:`1px solid ${ok?C.green:C.red}22`}}>{label}</span>;}
function Btn({children,onClick,disabled,variant,busy,help}){const a=variant==='danger'?C.red:variant==='warn'?C.amber:variant==='green'?C.green:C.cyan;return<button onClick={onClick} disabled={disabled||busy} title={help||''} style={{padding:'7px 15px',fontSize:11,...mono,background:`${a}15`,color:disabled?C.muted:a,border:`1px solid ${disabled?C.dim:a}44`,borderRadius:6,cursor:disabled?'not-allowed':'pointer',opacity:busy?0.6:1}}>{busy?'⏳...':children}</button>;}
function StatusLight({ok,label}){return<div style={{display:'flex',alignItems:'center',gap:6,padding:'3px 0'}}><div style={{width:8,height:8,borderRadius:'50%',background:ok===true?C.green:ok===false?C.red:C.dim}}/><span style={{fontSize:11,color:ok===true?C.green:ok===false?C.red:C.muted}}>{label}</span></div>;}
function Tip({children}){return<div style={{fontSize:11,color:C.amber,padding:'6px 10px',background:'rgba(245,158,11,0.06)',borderRadius:6,border:`1px solid ${C.amber}22`,marginBottom:8}}>💡 {children}</div>;}
function ChartTip({active,payload,label}){if(!active||!payload?.length)return null;return<div style={{background:C.card,border:`1px solid ${C.border}`,padding:'5px 9px',borderRadius:5,fontSize:10,...mono}}><div style={{color:C.muted}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color||C.text}}>{p.name}: {typeof p.value==='number'?p.value.toFixed(2):p.value}</div>)}</div>;}

function SettingRow({item,value,onChange}){
  const isRec=String(value)===String(item.rec);
  return<div style={{marginBottom:6}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:11,fontWeight:500,color:C.text}}>{item.label}</span>
      {item.rec!==undefined&&item.rec!==''&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,...mono,background:isRec?'rgba(34,197,94,0.1)':'rgba(245,158,11,0.1)',color:isRec?C.green:C.amber}}>Empf: {String(item.rec)}</span>}</div>
    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{item.desc}{item.why&&<span style={{fontStyle:'italic'}}> — {item.why}</span>}</div>
    {item.type==='select'?<select value={value||item.rec} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono}}>{(item.opts||[]).map(o=><option key={o} value={o}>{o}</option>)}</select>
    :item.type==='bool'?<label style={{display:'flex',alignItems:'center',gap:5}}><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}/><span style={{fontSize:11,color:value?C.green:C.muted}}>{value?'AN':'AUS'}</span></label>
    :item.type==='text'?<input value={value||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
    :item.type==='password'?<input type="password" value={value||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
    :<input type="number" step="any" value={value??''} onChange={e=>onChange(Number(e.target.value))} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>}
  </div>;
}

const TABS=['pipeline','ergebnisse','risk','settings','log'];
const TL={pipeline:'🚀 Pipeline',ergebnisse:'📊 Ergebnisse & Trades',risk:'🛡️ Risk',settings:'⚙️ Einstellungen',log:'📋 Log'};

export default function App(){
  const [tab,setTab]=useState('pipeline');
  const [state,setState]=useState(null);
  const [scan,setScan]=useState({markets:[],runs:[]});
  const [auth,setAuth]=useState(null);
  const [health,setHealth]=useState(null);
  const [scanStatus,setScanStatus]=useState(null);
  const [steps,setSteps]=useState(null);
  const [liveLog,setLiveLog]=useState([]);
  const [connTest,setConnTest]=useState(null);
  const [predictStatus,setPredictStatus]=useState(null);
  const [calibration,setCalibration]=useState(null);
  const [correlations,setCorrelations]=useState(null);
  const [researchStatus,setResearchStatus]=useState(null);
  const [execStatus,setExecStatus]=useState(null);
  const [riskStatus,setRiskStatus]=useState(null);
  const [busy,setBusy]=useState({});
  const [msg,setMsg]=useState('');
  const [uiAuthed,setUiAuthed]=useState(false);
  const [uiPw,setUiPw]=useState('');
  const [pwInput,setPwInput]=useState('');
  const [saving,setSaving]=useState(false);
  const [scanResult,setScanResult]=useState(null);

  const apiFetch=useCallback(async(path,opts={})=>{const h={...(opts.headers||{})};if(uiPw)h['x-ui-password']=uiPw;return fetch(path,{...opts,headers:h});},[uiPw]);
  const apiJson=useCallback(async(path,fb=null)=>{try{const r=await apiFetch(path);if(!r.ok)throw 0;return await r.json();}catch{return fb;}},[apiFetch]);
  const reload=useCallback(async()=>{
    const[st,sc,au,he,ss,stp,ps,cal,cor,rs,es,rsk]=await Promise.all([
      apiJson('/api/state'),apiJson('/api/scan',{markets:[],runs:[]}),apiJson('/api/auth/status'),
      apiJson('/api/health'),apiJson('/api/scan/status'),apiJson('/api/status/steps'),
      apiJson('/api/predict/status'),apiJson('/api/predict/calibration'),
      apiJson('/api/predict/correlations'),apiJson('/api/research/status'),apiJson('/api/execute/status'),apiJson('/api/risk/status')
    ]);
    if(st)setState(st);setScan(sc||{markets:[],runs:[]});setAuth(au);setHealth(he);setScanStatus(ss);setSteps(stp);
    setPredictStatus(ps);setCalibration(cal);setCorrelations(cor);setResearchStatus(rs);setExecStatus(es);setRiskStatus(rsk);
  },[apiJson]);

  async function doLogin(){try{const r=await fetch('/api/ui-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwInput})});if(!r.ok)throw new Error('Falsches Passwort');localStorage.setItem('ui_pw',pwInput);setUiPw(pwInput);setPwInput('');setUiAuthed(true);}catch(e){setMsg(e.message);}}
  useEffect(()=>{(async()=>{const r=await fetch('/api/ui-auth/status');const p=await r.json();if(!p.enabled){setUiAuthed(true);return;}const saved=localStorage.getItem('ui_pw')||'';if(!saved)return;const lr=await fetch('/api/ui-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:saved})});if(lr.ok){setUiPw(saved);setUiAuthed(true);}else localStorage.removeItem('ui_pw');})();},[]);
  useEffect(()=>{if(uiAuthed)reload();},[uiAuthed,reload]);
  useEffect(()=>{if(!uiAuthed||tab!=='log')return;const t=setInterval(async()=>{const d=await apiJson('/api/scan/live-log',{items:[]});setLiveLog(d?.items||[]);},4000);return()=>clearInterval(t);},[tab,uiAuthed,apiJson]);

  async function act(key,fn){setBusy(p=>({...p,[key]:true}));try{return await fn();}catch(e){setMsg(`❌ ${e.message}`);return null;}finally{setBusy(p=>({...p,[key]:false}));await reload();}}
  async function save(){setSaving(true);try{await apiFetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:state.config,providers:state.providers})});setMsg('✅ Gespeichert');await reload();}catch(e){setMsg('❌ '+e.message);}finally{setSaving(false);}}
  function setConfig(k,v){setState(p=>({...p,config:{...p.config,[k]:v}}));}
  function setProvider(name,k,v){setState(p=>({...p,providers:{...p.providers,[name]:{...(p.providers?.[name]||{}),[k]:v}}}));}

  const cfg=state?.config||{};
  const bankroll=Number(cfg.bankroll||1000);
  const trades=state?.trades||[];
  const openTrades=trades.filter(t=>t.status==='OPEN');
  const closedTrades=trades.filter(t=>t.status!=='OPEN');
  const totalPnl=closedTrades.reduce((s,t)=>s+Number(t.netPnlUsd||0),0);
  const openExposure=openTrades.reduce((s,t)=>s+Number(t.positionUsd||0),0);
  const predictions=predictStatus?.predictions||[];
  const briefs=researchStatus?.briefs||[];
  const markets=scan?.markets||[];

  const equityData=useMemo(()=>{if(!closedTrades.length)return[];let cum=0;return[{i:0,v:bankroll},...closedTrades.map((t,i)=>{cum+=Number(t.netPnlUsd||0);return{i:i+1,v:Math.round(bankroll+cum)};})];},[closedTrades,bankroll]);
  const pnlData=useMemo(()=>closedTrades.slice(-30).map((t,i)=>({i,pnl:Number(t.netPnlUsd||0),name:(t.title||'').slice(0,18)})),[closedTrades]);

  const srcStatus=useMemo(()=>{
    const rss=Boolean(cfg.research_source_rss!==false&&String(cfg.research_rss_feeds||'').trim());
    const reddit=Boolean(cfg.research_source_reddit!==false);
    const newsapi=Boolean(cfg.research_source_newsapi&&String(cfg.research_newsapi_key||'').trim());
    const gdelt=Boolean(cfg.research_source_gdelt);
    const llm=['openai','claude','gemini','ollama_cloud'].some(n=>{const p=state?.providers?.[n]||{};return p.enabled&&String(p.api_key||'').trim();});
    return{rss,reddit,newsapi,gdelt,llm,any:rss||reddit||newsapi||gdelt};
  },[cfg,state?.providers]);

  const step1Pct=Number(steps?.step1?.progress_pct||0);
  const step1Fails=(steps?.step1?.checks||[]).filter(c=>!c.ok).map(c=>c.key);

  // ═══════════ LOGIN ═══════════
  if(!uiAuthed)return(
    <div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans,sans-serif'}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:32,width:360,textAlign:'center'}}>
        <div style={{fontSize:28,marginBottom:8}}><span style={{color:C.cyan}}>&#9670;</span></div>
        <h2 style={{color:C.text,fontSize:18,fontWeight:600,margin:'0 0 4px'}}>Prediction Market Bot</h2>
        <p style={{color:C.muted,fontSize:13,marginBottom:6}}>Dashboard Login</p>
        <p style={{color:C.dim,fontSize:11,marginBottom:16}}>Standard-Passwort: <code style={{...mono,color:C.amber}}>changeme</code></p>
        <input type="password" value={pwInput} onChange={e=>setPwInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doLogin()} placeholder="Passwort..." style={{width:'100%',padding:'10px 12px',borderRadius:6,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,marginBottom:12,...mono,boxSizing:'border-box'}}/>
        <button onClick={doLogin} style={{width:'100%',padding:'10px',borderRadius:6,border:'none',background:C.cyan,color:'#000',fontWeight:600,cursor:'pointer'}}>Login</button>
        {msg&&<p style={{color:C.red,fontSize:12,marginTop:10}}>{msg}</p>}
      </div>
    </div>);

  if(!state)return<div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.muted}}>Lade...</div>;

  // ═══════════ DASHBOARD ═══════════
  return(
    <div style={{background:C.bg,color:C.text,minHeight:'100vh',fontFamily:'IBM Plex Sans,-apple-system,sans-serif',padding:'18px 14px',maxWidth:900,margin:'0 auto'}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>

      {/* HEADER */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:8}}>
        <div>
          <h1 style={{margin:0,fontSize:19,fontWeight:700}}><span style={{color:C.cyan}}>◆</span> Prediction Market Bot</h1>
          <div style={{fontSize:11,color:C.muted,marginTop:2,...mono}}>{cfg.paper_mode?'📋 Paper-Modus':'🔴 LIVE'} · ${fmt(bankroll+totalPnl,0)} · {openTrades.length} offene Trades</div>
        </div>
        <div style={{display:'flex',gap:5}}><Btn onClick={reload}>↻</Btn><Btn onClick={save} busy={saving} variant="green">💾 Speichern</Btn></div>
      </div>

      {msg&&<div style={{fontSize:11,color:msg.startsWith('✅')?C.green:C.red,marginBottom:10,...mono,padding:'6px 10px',background:`${C.cyan}08`,borderRadius:6,display:'flex',justifyContent:'space-between'}}><span>{msg}</span><button onClick={()=>setMsg('')} style={{background:'none',border:'none',color:C.muted,cursor:'pointer'}}>✕</button></div>}

      {/* STATUS PILLS */}
      <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:12}}>
        <Pill ok={health?.status==='ok'} label={`Backend: ${health?.status||'?'}`}/>
        <Pill ok={step1Pct>=100} label={`Step1: ${fmt(step1Pct,0)}%`}/>
        <Pill ok={srcStatus.any} label={srcStatus.any?'News: ok':'News: fehlt'}/>
        <Pill ok={srcStatus.llm} label={srcStatus.llm?'LLM: ok':'LLM: fehlt'}/>
        <Pill ok={!cfg.kill_switch} label={cfg.kill_switch?'KILL AKTIV':'Kill: aus'}/>
      </div>

      {/* TABS */}
      <div style={{display:'flex',gap:2,marginBottom:14,background:C.card,padding:3,borderRadius:7,flexWrap:'wrap'}}>
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:'7px 14px',fontSize:11,...mono,background:tab===t?C.blue:'transparent',color:tab===t?'#fff':C.muted,border:'none',borderRadius:5,cursor:'pointer'}}>{TL[t]}</button>)}
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: PIPELINE                              */}
      {/* ═══════════════════════════════════════════ */}
      {tab==='pipeline'&&<div>
        <Card title="Wie funktioniert der Bot?" help="Der Bot arbeitet in 5 Schritten. Jeder baut auf dem vorherigen auf. Klicke sie von oben nach unten, oder nutze 'Full Pipeline' für alles auf einmal.">
          <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap',marginBottom:8,fontSize:12}}>
            {['🔍 Scan','→','📰 Research','→','🎯 Predict','→','⚡ Execute','→','🛡️ Risk'].map((s,i)=><span key={i} style={{color:s==='→'?C.dim:C.text,fontWeight:s==='→'?400:500}}>{s}</span>)}
          </div>
        </Card>

        {/* Verbindungen */}
        <Card title="Verbindungen" help="Grün = funktioniert. Rot = fehlt. Du brauchst mindestens eine Nachrichtenquelle (RSS geht sofort). Für die Börsen brauchst du API-Keys (siehe Einstellungen).">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
            <div><div style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:600}}>Börsen</div>
              <StatusLight ok={auth?.polymarket?.configured} label="Polymarket"/>
              <StatusLight ok={auth?.kalshi?.configured} label="Kalshi"/></div>
            <div><div style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:600}}>Nachrichten</div>
              <StatusLight ok={srcStatus.rss} label={`RSS ${srcStatus.rss?'✓':'✗'}`}/>
              <StatusLight ok={srcStatus.reddit} label={`Reddit ${srcStatus.reddit?'✓':'✗'}`}/>
              <StatusLight ok={srcStatus.newsapi} label={`NewsAPI ${srcStatus.newsapi?'✓':'—'}`}/></div>
            <div><div style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:600}}>KI</div>
              {['openai','claude','gemini','ollama_cloud'].map(n=>{const p=state?.providers?.[n]||{};const ok=p.enabled&&String(p.api_key||'').trim();return<StatusLight key={n} ok={ok?true:null} label={`${n}${ok?' ✓':''}`}/>;})}</div>
          </div>
        </Card>

        {/* Korrelations-Warnung */}
        {(correlations?.conflicts||[]).length>0&&<Card title="⚠️ Widersprüchliche Trades" accent={C.red+'66'} help="Der Bot will bei mehreren Kandidaten gleichzeitig YES kaufen, obwohl es nur einen Gewinner geben kann.">
          {correlations.conflicts.map((c,i)=><div key={i} style={{fontSize:12,marginBottom:6}}><div style={{color:C.red}}>{c.message}</div><div style={{color:C.amber,fontSize:11}}>→ Nur handeln: {c.recommendation}</div></div>)}
        </Card>}

        {/* Action Buttons */}
        <Card title="Aktionen">
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
            <Btn onClick={()=>act('pipeline',async()=>{const r=await apiFetch('/api/pipeline/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg('✅ Pipeline fertig — alle 5 Schritte durchlaufen');})} busy={busy.pipeline} help="Alle 5 Schritte nacheinander">🚀 Full Pipeline</Btn>
            <Btn onClick={()=>act('scan',async()=>{const r=await apiFetch('/api/scan/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setScanResult(p);setMsg(`✅ Scan: ${p.tradeable_count} Märkte, Self-Test ${p.self_test?.ok?'✅ bestanden':`⚠️ ${p.self_test?.passed}/${p.self_test?.total}`}`);})} busy={busy.scan} help="Märkte suchen und filtern">🔍 Scan</Btn>
            <Btn onClick={()=>act('research',async()=>{const r=await apiFetch('/api/research/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Research: ${(p.briefs||[]).length} Briefs`);})} busy={busy.research} help="Nachrichten sammeln">📰 Research</Btn>
            <Btn onClick={()=>act('predict',async()=>{const r=await apiFetch('/api/predict/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Predict: ${(p.predictions||[]).length} Signale, ${p.summary?.actionable_pct||0}% actionable`);})} busy={busy.predict} help="Wahrscheinlichkeiten schätzen">🎯 Predict</Btn>
            <Btn onClick={()=>act('execute',async()=>{const r=await apiFetch('/api/execute/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Execute: ${p.summary?.executed_orders||0} Orders`);})} busy={busy.execute} help="Trades platzieren">⚡ Execute</Btn>
            <Btn onClick={()=>act('risk',async()=>{const r=await apiFetch('/api/risk/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Risk: ${p.summary?.violations||0} Verstöße`);})} busy={busy.risk} help="Positionen prüfen">🛡️ Risk</Btn>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            <Btn variant={cfg.kill_switch?'danger':'warn'} onClick={()=>act('kill',async()=>{await apiFetch('/api/kill-switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!cfg.kill_switch})});setMsg(cfg.kill_switch?'✅ Kill Switch aus':'⚠️ Kill Switch AN — keine neuen Trades');})}>{cfg.kill_switch?'🔴 Kill AUS':'🛑 Kill Switch'}</Btn>
            <Btn variant="warn" onClick={()=>act('resetM',async()=>{const r=await apiFetch('/api/markets/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'ui'})});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ ${p.previous_markets} Märkte gelöscht. Scanne neu.`);})} busy={busy.resetM} help="Löscht Märkte, Research, Predictions">🗑 Märkte Reset</Btn>
            <Btn variant="danger" onClick={()=>{if(!confirm('Alle Trades löschen?'))return;act('resetT',async()=>{const r=await apiFetch('/api/trades/reset',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ ${p.previous_trades} Trades gelöscht.`);});}} busy={busy.resetT} help="Löscht alle Trades und Orders">🗑 Trades Reset</Btn>
          </div>
        </Card>

        {/* Step Progress */}
        <Card title="Fortschritt">
          {[{n:1,k:'step1',l:'Scan'},{n:2,k:'step2',l:'Research'},{n:3,k:'step3',l:'Predict'},{n:4,k:'step4',l:'Execute'},{n:5,k:'step5',l:'Risk'}].map(({n,k,l})=>{
            const v=Number(steps?.[k]?.progress_pct||0);const fails=(steps?.[k]?.checks||[]).filter(c=>!c.ok);
            return<div key={k} style={{marginBottom:6}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:C.muted,marginBottom:2,...mono}}><span>Step {n}: {l}</span><span style={{color:v>=100?C.green:v>0?C.amber:C.muted}}>{fmt(v,0)}%</span></div>
              <div style={{height:5,background:C.dim,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${v}%`,background:v>=100?C.green:v>0?C.amber:C.dim,borderRadius:3,transition:'width 0.4s'}}/></div>
              {fails.length>0&&<div style={{fontSize:10,color:C.amber,marginTop:2}}>{fails.map(c=>c.key.replace(/_/g,' ')).join(' · ')}</div>}
            </div>;})}
          {step1Pct<100&&step1Pct>0&&<Tip>
            {step1Fails.includes('self_test')&&'Self-Test nicht bestanden. '}
            {step1Fails.includes('tradeable_target')&&'Zu wenige Märkte gefunden — senke Min Volume (z.B. 200) in den Einstellungen. '}
            {step1Fails.includes('scan_freshness')&&'Scan ist veraltet — klicke "Scan". '}
            {!step1Fails.length&&'Scan nochmal starten.'}
          </Tip>}
          {scanResult?.self_test&&<div style={{fontSize:11,color:scanResult.self_test.ok?C.green:C.amber,...mono,marginTop:4}}>Letzter Self-Test: {scanResult.self_test.passed}/{scanResult.self_test.total} Checks bestanden{scanResult.self_test.ok?' ✅':''}</div>}
        </Card>
      </div>}

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: ERGEBNISSE & TRADES                   */}
      {/* ═══════════════════════════════════════════ */}
      {tab==='ergebnisse'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Bankroll" value={`$${fmt(bankroll+totalPnl,0)}`} good={totalPnl>=0} help="Start + Gewinne/Verluste"/>
          <Metric label="P&L" value={`${totalPnl>=0?'+':''}$${fmt(totalPnl,0)}`} good={totalPnl>=0} help="Summe aller abgeschlossenen Trades"/>
          <Metric label="Offen" value={openTrades.length} target="max 15" good={openTrades.length<=15}/>
          <Metric label="Brier" value={fmt(calibration?.brier_score,3)} target="< 0.250" good={Number(calibration?.brier_score??1)<0.25} help="Vorhersage-Qualität. Niedriger = besser."/>
        </div>

        {equityData.length>1&&<Card title="Bankroll-Verlauf" help="So hat sich dein Kapital über die Trades entwickelt. Steigt die Linie = du verdienst Geld.">
          <ResponsiveContainer width="100%" height={160}><AreaChart data={equityData}>
            <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.cyan} stopOpacity={0.3}/><stop offset="100%" stopColor={C.cyan} stopOpacity={0}/></linearGradient></defs>
            <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
            <Tooltip content={<ChartTip/>}/><Area type="monotone" dataKey="v" stroke={C.cyan} fill="url(#eq)" strokeWidth={2} name="Bankroll"/>
          </AreaChart></ResponsiveContainer>
        </Card>}

        {pnlData.length>0&&<Card title="Gewinn/Verlust pro Trade" help="Grün = Gewinn. Rot = Verlust. Je höher der Balken, desto mehr Gewinn/Verlust.">
          <ResponsiveContainer width="100%" height={120}><BarChart data={pnlData}>
            <XAxis dataKey="name" tick={{fontSize:8,fill:C.muted}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
            <Tooltip content={<ChartTip/>}/><Bar dataKey="pnl" name="P&L" radius={[3,3,0,0]}>{pnlData.map((e,i)=><Cell key={i} fill={e.pnl>=0?C.green:C.red}/>)}</Bar>
          </BarChart></ResponsiveContainer>
        </Card>}

        {/* Gescannte Märkte */}
        <Card title={`Gescannte Märkte (${markets.length})`} help="Vom Scanner gefunden. Sortiert nach Opportunity Score — je höher, desto interessanter.">
          {markets.slice(0,12).map((m,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${C.border}11`,fontSize:12}}>
            <span style={{flex:1}}>{m.question||m.market}</span>
            <div style={{display:'flex',gap:8,fontSize:10,...mono,color:C.muted,alignItems:'center'}}>
              <span style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:m.platform==='kalshi'?`${C.purple}20`:`${C.cyan}20`,color:m.platform==='kalshi'?C.purple:C.cyan}}>{m.platform}</span>
              <span title="Marktpreis">P:{fmt(m.market_price,2)}</span><span title="Volumen">V:{Number(m.volume||0).toLocaleString()}</span>
            </div>
          </div>)}
          {!markets.length&&<div style={{color:C.muted,fontSize:12}}>Keine Märkte. Starte einen Scan im Pipeline-Tab.</div>}
        </Card>

        {/* Predictions */}
        {predictions.length>0&&<Card title={`Predictions (${predictions.length})`} help="BUY_YES = Markt unterbewertet. BUY_NO = überbewertet. NO_TRADE = kein Signal. Die Erklärung steht unter jeder Prediction.">
          {predictions.slice(0,15).map((p,i)=><div key={i} style={{padding:'6px 0',borderBottom:`1px solid ${C.border}11`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:4}}>
              <span style={{fontSize:12,flex:1,minWidth:200}}>{p.question}</span>
              <div style={{display:'flex',gap:6,fontSize:10,...mono}}>
                <span style={{color:C.muted}}>Mkt:{fmt(p.market_prob,2)}</span>
                <span style={{color:C.muted}}>Bot:{fmt(p.model_prob,2)}</span>
                <span style={{color:p.direction==='BUY_YES'?C.green:p.direction==='BUY_NO'?C.red:C.muted,fontWeight:600}}>{p.direction}</span>
              </div>
            </div>
            <div style={{fontSize:10,color:C.dim,marginTop:2}}>💡 {dirExplain(p)}</div>
            {(p.llm_notes||[]).filter(n=>n).map((n,j)=>{const h=helpErr(n);return<div key={j} style={{fontSize:10,color:C.amber,...mono,marginTop:1}}>⚠ {n}{h&&<span style={{color:C.muted}}> → {h}</span>}</div>;})}
          </div>)}
        </Card>}

        {/* Trade History */}
        {closedTrades.length>0&&<Card title={`Trade-Historie (${closedTrades.length})`} help="Alle abgeschlossenen Trades. Grüner Punkt = Gewinn, Roter = Verlust.">
          {closedTrades.slice(0,25).map((t,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.border}11`,fontSize:11,...mono}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:7,height:7,borderRadius:'50%',background:Number(t.netPnlUsd||0)>=0?C.green:C.red}}/><span style={{color:C.text}}>{(t.title||t.market_id||'').slice(0,40)}</span></div>
            <div style={{display:'flex',gap:8,color:C.muted}}><span style={{color:t.direction==='BUY_YES'?C.green:C.red}}>{t.direction}</span><span style={{color:Number(t.netPnlUsd||0)>=0?C.green:C.red,fontWeight:600}}>{Number(t.netPnlUsd||0)>=0?'+':''}${fmt(t.netPnlUsd,0)}</span></div>
          </div>)}
        </Card>}
      </div>}

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: RISK                                  */}
      {/* ═══════════════════════════════════════════ */}
      {tab==='risk'&&<div>
        <Card title="Risk Gauges" help="Zeigt wie nah du an den Limits bist. Grün = sicher. Gelb = Vorsicht (der gelbe Strich ist die Warnschwelle). Rot = Limit erreicht.">
          <Gauge label="Drawdown (max. Verlust vom Höchststand)" value={Number(state?.risk?.drawdown_pct||0)} max={0.08} warning={0.05} help="Ab 5% → kleinere Positionen. Ab 8% → Bot stoppt."/>
          <Gauge label="Exposure (Geld im Risiko)" value={bankroll>0?openExposure/bankroll:0} max={Number(cfg.max_total_exposure_pct||0.5)} warning={Number(cfg.max_total_exposure_pct||0.5)*0.7} help="Anteil des Bankrolls in offenen Trades."/>
          <Gauge label="Positionen" value={openTrades.length/Math.max(1,Number(cfg.max_concurrent_positions||15))} max={1} warning={0.8}/>
        </Card>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Kelly" value={`${fmt(Number(cfg.kelly_fraction||0.25)*100,0)}%`} help="Wie aggressiv gewettet wird. 25% = Quarter Kelly (sicher)."/>
          <Metric label="Max Pos" value={`${fmt(Number(cfg.max_pos_pct||0.05)*100,0)}%`} help="Max. Anteil pro Trade."/>
          <Metric label="Violations" value={riskStatus?.summary?.violations||0} good={!Number(riskStatus?.summary?.violations||0)} help="Anzahl Trades die ein Limit verletzen."/>
          <Metric label="Exposure" value={`$${fmt(openExposure,0)}`} good={bankroll>0?openExposure/bankroll<0.5:true}/>
        </div>
        {openTrades.length>0&&<Card title={`Offene Positionen (${openTrades.length})`} help="Alle aktuell laufenden Trades.">
          {openTrades.map((t,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.border}11`,fontSize:11,...mono}}>
            <span style={{color:C.text}}>{(t.title||t.market_id||'').slice(0,45)}</span>
            <div style={{display:'flex',gap:8,color:C.muted}}><span style={{color:t.direction==='BUY_YES'?C.green:C.red}}>{t.direction}</span><span>${fmt(t.positionUsd,0)}</span></div>
          </div>)}
        </Card>}
        {!openTrades.length&&<div style={{color:C.muted,fontSize:12,padding:10}}>Keine offenen Positionen.</div>}
      </div>}

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: EINSTELLUNGEN                          */}
      {/* ═══════════════════════════════════════════ */}
      {tab==='settings'&&<div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
          {/* Allgemein */}
          <Card title="💰 Allgemein" help="Grundeinstellungen für den Bot.">
            {[{key:'bankroll',label:'Bankroll ($)',rec:1000,desc:'Dein Kapital.',why:'Starte mit $100–500.'},
              {key:'paper_mode',label:'Paper Mode',rec:true,desc:'AN = nur simuliert.',why:'IMMER zuerst Paper Mode!',type:'bool'},
              {key:'kelly_fraction',label:'Kelly Fraction',rec:0.25,desc:'Wie aggressiv (0.25=vorsichtig).',why:'0.25 ist sicher.'},
              {key:'min_edge',label:'Min Edge',rec:0.04,desc:'Mind. Vorteil zum Handeln.',why:'Unter 4% lohnt selten.'},
              {key:'max_pos_pct',label:'Max Position %',rec:0.05,desc:'Max pro Trade.',why:'5% begrenzt Einzelverluste.'},
              {key:'max_total_exposure_pct',label:'Max Exposure %',rec:0.5,desc:'Max alles zusammen.',why:'50% = nie mehr als Hälfte im Risiko.'},
              {key:'max_drawdown_pct',label:'Max Drawdown',rec:0.08,desc:'Hard-Stop bei diesem Verlust.',why:'8% ist der Notfall-Stopp.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </Card>
          {/* Scanner */}
          <Card title="🔍 Scanner" help="Steuert wie der Bot Märkte sucht.">
            {[{key:'scanner_source',label:'Quelle',rec:'both',desc:'Wo suchen.',why:'both = beide Börsen.',type:'select',opts:['polymarket','kalshi','both']},
              {key:'scan_interval_minutes',label:'Intervall (Min)',rec:15,desc:'Auto-Scan alle X Min.',why:'15 ist Standard.'},
              {key:'scanner_min_volume',label:'Min Volume',rec:50000,desc:'Min Handelsvolumen.',why:'Zum Testen: 200. Produktion: 50000.'},
              {key:'scanner_min_liquidity',label:'Min Liquidität',rec:10000,desc:'Min Orderbuch-Tiefe.',why:'Zum Testen: 200. Produktion: 10000.'},
              {key:'scanner_max_days',label:'Max Tage',rec:30,desc:'Max Restlaufzeit.',why:'30 Tage Standard.'},
              {key:'scanner_min_anomaly_score',label:'Min Anomalie',rec:1.2,desc:'Mind. Auffälligkeits-Score.',why:'Niedriger = mehr Märkte.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </Card>
          {/* Research */}
          <Card title="📰 Research Quellen" help="Woher der Bot Nachrichten holt. RSS und Reddit gehen sofort ohne API-Key.">
            {[{key:'research_source_rss',label:'RSS Feeds',rec:true,desc:'Reuters, AP etc.',why:'Funktioniert sofort.',type:'bool'},
              {key:'research_rss_feeds',label:'RSS URLs',rec:'',desc:'Komma-getrennte Feed-URLs.',why:'Schon voreingestellt.',type:'text'},
              {key:'research_source_reddit',label:'Reddit',rec:true,desc:'Sucht in Subreddits.',why:'Kostenlos.',type:'bool'},
              {key:'research_source_newsapi',label:'NewsAPI',rec:false,desc:'Braucht API-Key.',why:'Optional, kostenloser Tier.',type:'bool'},
              {key:'research_newsapi_key',label:'NewsAPI Key',rec:'',desc:'Von newsapi.org.',why:'Nur wenn NewsAPI AN.',type:'password'},
              {key:'research_source_gdelt',label:'GDELT',rec:false,desc:'Globale Event-DB.',why:'Kostenlos, manchmal langsam.',type:'bool'},
              {key:'research_max_headlines',label:'Max Headlines',rec:80,desc:'Max gesammelte Headlines.',why:'80 reicht.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </Card>
          {/* LLM */}
          <Card title="🤖 KI-Provider" help="Für bessere Predictions. Ohne KI nutzt der Bot Heuristiken. Gemini hat kostenlosen Tier!">
            {[{key:'llm_enabled',label:'LLM aktiv',rec:true,desc:'KI für Vorhersagen nutzen.',why:'Deutlich besser als ohne.',type:'bool'},
              {key:'llm_timeout_ms',label:'Timeout (ms)',rec:12000,desc:'Max Wartezeit.',why:'12s Standard. Erhöhen bei Abbrüchen.'},
              {key:'llm_temperature',label:'Temperature',rec:0.1,desc:'0=konsistent, 1=kreativ.',why:'0.1 für stabile Schätzungen.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
            <div style={{fontSize:12,fontWeight:600,marginTop:8,marginBottom:6}}>Provider</div>
            {['openai','claude','gemini','ollama_cloud'].map(name=>{const p=state?.providers?.[name]||{};return<div key={name} style={{marginBottom:6,padding:'6px 8px',background:C.bg,borderRadius:5,border:`1px solid ${C.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
                <span style={{fontSize:12,fontWeight:600,color:p.enabled?C.cyan:C.muted}}>{name}</span>
                <label style={{display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={!!p.enabled} onChange={e=>setProvider(name,'enabled',e.target.checked)}/><span style={{fontSize:10,color:C.muted}}>aktiv</span></label>
              </div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>
                {name==='openai'&&'OpenAI (GPT-4o-mini). Gewicht: 35%.'}{name==='claude'&&'Anthropic Claude. Gewicht: 25%.'}{name==='gemini'&&'Google Gemini. Kostenloser Tier! Gewicht: 20%.'}{name==='ollama_cloud'&&'Ollama Cloud. Gewicht: 20%.'}
              </div>
              {p.enabled&&<><input placeholder="API Key" type="password" value={p.api_key||''} onChange={e=>setProvider(name,'api_key',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:2,boxSizing:'border-box'}}/>
              <input placeholder="Model" value={p.model||''} onChange={e=>setProvider(name,'model',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:2,boxSizing:'border-box'}}/>
              <input placeholder="Base URL" value={p.base_url||''} onChange={e=>setProvider(name,'base_url',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/></>}
            </div>;})}
          </Card>
          {/* Börsen */}
          <Card title="🏦 Börsen API-Keys" help="Nötig um echte Marktdaten zu laden. Kalshi hat einen Demo-Modus mit Fake-Geld!">
            <div style={{marginBottom:8}}><div style={{fontSize:12,fontWeight:600,color:C.cyan}}>Polymarket</div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Crypto-Börse. docs.polymarket.com</div>
              <input placeholder="Wallet Address" value={state?.providers?.polymarket?.wallet_address||''} onChange={e=>setProvider('polymarket','wallet_address',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:11,...mono,marginBottom:2,boxSizing:'border-box'}}/>
              <input placeholder="EIP-712 Signature" type="password" value={state?.providers?.polymarket?.eip712_signature||''} onChange={e=>setProvider('polymarket','eip712_signature',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/></div>
            <div><div style={{fontSize:12,fontWeight:600,color:C.purple}}>Kalshi</div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>US-reguliert. Demo-Modus verfügbar! trading-api.readme.io</div>
              <input placeholder="Key ID" value={state?.providers?.kalshi?.key_id||''} onChange={e=>setProvider('kalshi','key_id',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:11,...mono,marginBottom:2,boxSizing:'border-box'}}/>
              <input placeholder="Key Secret" type="password" value={state?.providers?.kalshi?.key_secret||''} onChange={e=>setProvider('kalshi','key_secret',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/></div>
            <div style={{marginTop:8}}><Btn onClick={()=>act('connTest',async()=>{const r=await apiFetch('/api/connection/test');const p=await r.json();setConnTest(p);setMsg(p.ok?'✅ Verbindung OK':'❌ Keine Börse erreichbar');})} busy={busy.connTest}>🔌 Testen</Btn></div>
            {connTest&&<div style={{fontSize:10,...mono,marginTop:4,color:C.muted}}>PM: {connTest.polymarket?.reachable?'✅':'❌'} · Kalshi: {connTest.kalshi?.reachable?'✅':'❌'}</div>}
          </Card>
        </div>
        <div style={{textAlign:'center',marginTop:8}}><Btn onClick={save} busy={saving} variant="green">💾 Alle Einstellungen speichern</Btn></div>
      </div>}

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: LOG                                    */}
      {/* ═══════════════════════════════════════════ */}
      {tab==='log'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Breaker" value={scanStatus?.runtime?.breaker_open?'OPEN':'OK'} good={!scanStatus?.runtime?.breaker_open} help="Scanner Circuit Breaker"/>
          <Metric label="Scan Fails" value={scanStatus?.runtime?.consecutiveFailures||0} good={Number(scanStatus?.runtime?.consecutiveFailures||0)<3}/>
          <Metric label="Pipeline Runs" value={(state?.pipeline_runs||[]).length}/>
        </div>
        {(state?.pipeline_runs||[]).length>0&&<Card title="Pipeline Runs" help="Zeigt wann die Pipeline gelaufen ist und was dabei rauskam.">
          {(state?.pipeline_runs||[]).slice(0,8).map((run,i)=><div key={i} style={{padding:'4px 0',borderBottom:`1px solid ${C.border}11`,fontSize:10,...mono}}>
            <span style={{color:C.muted}}>{(run.time||'').slice(0,19)}</span>
            {(run.trace||[]).map((t,j)=><span key={j} style={{marginLeft:6,color:C.text}}>S{t.step}={Object.values(t).filter(v=>typeof v==='number'&&v>0)[0]||'ok'}</span>)}
          </div>)}
        </Card>}
        <Card title={`Live Log (${liveLog.length})`} help="Was der Bot gerade tut. Grün = OK. Rot = Fehler mit Erklärung.">
          <div style={{maxHeight:350,overflow:'auto',...mono,fontSize:10}}>
            {liveLog.slice(0,50).map((e,i)=>{const isErr=String(e.event||'').includes('error');const isOk=String(e.event||'').includes('ok')||String(e.event||'').includes('completed');const h=isErr?helpErr(e.message||e.event||''):null;
              return<div key={i} style={{padding:'2px 0',color:isErr?C.red:isOk?C.green:C.muted}}>
                <span style={{color:C.dim}}>{(e.t||'').slice(11,19)}</span> {e.event} {e.source?`[${e.source}]`:''} {e.message||e.label||''}
                {h&&<div style={{color:C.amber,fontSize:9,marginLeft:52,fontStyle:'italic'}}>→ {h}</div>}
              </div>;})}
            {!liveLog.length&&<div style={{color:C.dim,padding:8}}>Keine Events. Starte die Pipeline.</div>}
          </div>
        </Card>
      </div>}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}*{box-sizing:border-box}::-webkit-scrollbar{height:4px;width:4px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.dim};border-radius:2px}code{background:${C.dim};padding:1px 4px;border-radius:3px;font-size:11px}`}</style>
    </div>);
}
