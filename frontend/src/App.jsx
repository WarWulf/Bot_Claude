import { useEffect, useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const C={bg:'#0a0e17',card:'#111827',border:'#1e293b',green:'#22c55e',red:'#ef4444',amber:'#f59e0b',blue:'#3b82f6',purple:'#8b5cf6',cyan:'#06b6d4',text:'#e2e8f0',muted:'#64748b',dim:'#334155'};
const fmt=(v,d=2)=>{const n=Number(v);return Number.isNaN(n)?'-':n.toFixed(d);};
const mono={fontFamily:'JetBrains Mono,monospace'};

const ERR_HELP={'aborted':'LLM-Provider zu langsam. Erhöhe LLM Timeout (z.B. 30000ms).','http 401':'API-Key ungültig.','http 429':'Rate Limit! Zu viele Anfragen. Erhöhe "Delay zwischen Märkten" (z.B. 5000ms) oder reduziere "Top N" auf 5.','http 500':'Server-Fehler beim Provider.','ECONNREFUSED':'URL falsch oder Server nicht erreichbar.','fetch failed':'Netzwerk-Problem.','no_llm_provider':'Kein LLM konfiguriert.','llm_disabled':'LLM deaktiviert — Heuristik wird benutzt.'};
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
  const [nightlyStatus,setNightlyStatus]=useState(null);
  const [compoundStatus,setCompoundStatus]=useState(null);
  const [busy,setBusy]=useState({});
  const [msg,setMsg]=useState('');
  const [uiAuthed,setUiAuthed]=useState(false);
  const [uiPw,setUiPw]=useState('');
  const [pwInput,setPwInput]=useState('');
  const [saving,setSaving]=useState(false);
  const [scanResult,setScanResult]=useState(null);
  const [sourceTest,setSourceTest]=useState(null);
  const [llmTest,setLlmTest]=useState(null);

  const apiFetch=useCallback(async(path,opts={})=>{const h={...(opts.headers||{})};if(uiPw)h['x-ui-password']=uiPw;return fetch(path,{...opts,headers:h});},[uiPw]);
  const apiJson=useCallback(async(path,fb=null)=>{try{const r=await apiFetch(path);if(!r.ok)throw 0;return await r.json();}catch{return fb;}},[apiFetch]);
  const reload=useCallback(async()=>{
    const[st,sc,au,he,ss,stp,ps,cal,cor,rs,es,rsk,ni,co]=await Promise.all([
      apiJson('/api/state'),apiJson('/api/scan',{markets:[],runs:[]}),apiJson('/api/auth/status'),
      apiJson('/api/health'),apiJson('/api/scan/status'),apiJson('/api/status/steps'),
      apiJson('/api/predict/status'),apiJson('/api/predict/calibration'),
      apiJson('/api/predict/correlations'),apiJson('/api/research/status'),apiJson('/api/execute/status'),apiJson('/api/risk/status'),
      apiJson('/api/nightly/status'),apiJson('/api/compound/status')
    ]);
    if(st)setState(st);setScan(sc||{markets:[],runs:[]});setAuth(au);setHealth(he);setScanStatus(ss);setSteps(stp);
    setPredictStatus(ps);setCalibration(cal);setCorrelations(cor);setResearchStatus(rs);setExecStatus(es);setRiskStatus(rsk);
    setNightlyStatus(ni);setCompoundStatus(co);
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
  const dailyPnlData=useMemo(()=>(nightlyStatus?.reviews||[]).slice(0,30).reverse().map(r=>({date:r.date?.slice(5)||'',pnl:Number(r.pnl||0)})),[nightlyStatus]);
  const [exchangeBalance,setExchangeBalance]=useState(null);

  const srcStatus=useMemo(()=>{
    const rss=Boolean(cfg.research_source_rss!==false&&String(cfg.research_rss_feeds||'').trim());
    const reddit=Boolean(cfg.research_source_reddit!==false);
    const newsapi=Boolean(cfg.research_source_newsapi&&String(cfg.research_newsapi_key||'').trim());
    const gdelt=Boolean(cfg.research_source_gdelt);
    const llm=['openai','claude','gemini','ollama_cloud','local_ollama','kimi_direct'].some(n=>{const p=state?.providers?.[n]||{};return p.enabled&&(String(p.api_key||'').trim()||n==='local_ollama');});
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

        {/* P&L Übersicht */}
        <Card title="💰 Gewinn & Verlust" help="Aktuelle Performance auf einen Blick. Tägliches P&L aus den Nightly Reviews, Bankroll-Verlauf aus den Trades.">
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
            <Metric label="Bankroll" value={`$${fmt(bankroll+totalPnl,0)}`} good={totalPnl>=0}/>
            <Metric label="P&L" value={`${totalPnl>=0?'+':''}$${fmt(totalPnl,0)}`} good={totalPnl>=0}/>
            <Metric label="Trades" value={`${closedTrades.length} ✓ / ${openTrades.length} offen`}/>
            <Metric label="Win Rate" value={closedTrades.length?`${fmt(closedTrades.filter(t=>Number(t.netPnlUsd||0)>0).length/closedTrades.length*100,0)}%`:'-'} target="≥60%" good={closedTrades.length?closedTrades.filter(t=>Number(t.netPnlUsd||0)>0).length/closedTrades.length>=0.6:true}/>
          </div>
          {/* Bankroll Chart */}
          {equityData.length>1&&<div style={{marginBottom:8}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:3}}>Bankroll-Verlauf</div>
            <ResponsiveContainer width="100%" height={120}><AreaChart data={equityData}>
              <defs><linearGradient id="eq2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.cyan} stopOpacity={0.3}/><stop offset="100%" stopColor={C.cyan} stopOpacity={0}/></linearGradient></defs>
              <XAxis dataKey="i" tick={{fontSize:8,fill:C.muted}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:8,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
              <Tooltip content={<ChartTip/>}/><Area type="monotone" dataKey="v" stroke={C.cyan} fill="url(#eq2)" strokeWidth={2} name="Bankroll"/>
            </AreaChart></ResponsiveContainer>
          </div>}
          {/* Tägliches P&L Chart */}
          {dailyPnlData.length>1&&<div>
            <div style={{fontSize:11,color:C.muted,marginBottom:3}}>Tägliches P&L (aus Nightly Reviews)</div>
            <ResponsiveContainer width="100%" height={100}><BarChart data={dailyPnlData}>
              <XAxis dataKey="date" tick={{fontSize:8,fill:C.muted}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:8,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
              <Tooltip content={<ChartTip/>}/>
              <Bar dataKey="pnl" name="Tages-P&L" radius={[2,2,0,0]}>{dailyPnlData.map((e,i)=><Cell key={i} fill={e.pnl>=0?C.green:C.red}/>)}</Bar>
            </BarChart></ResponsiveContainer>
          </div>}
          {!equityData.length&&!dailyPnlData.length&&<div style={{color:C.muted,fontSize:12}}>Noch keine Trades oder Nightly Reviews. Starte die Pipeline.</div>}
          {/* Balance Sync */}
          <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center'}}>
            <Btn onClick={()=>act('balance',async()=>{const r=await apiFetch('/api/balance');const p=await r.json();setExchangeBalance(p);if(p.balances?.kalshi?.balance!=null)setMsg(`✅ Kalshi Balance: $${p.balances.kalshi.balance.toFixed(2)}`);else setMsg('⚠️ Kalshi Balance nicht verfügbar (API-Key nötig)');})} busy={busy.balance} help="Holt die aktuelle Balance von Kalshi">🏦 Balance von Börse laden</Btn>
            {exchangeBalance?.balances?.kalshi?.balance!=null&&<span style={{fontSize:11,...mono,color:C.green}}>Kalshi: ${fmt(exchangeBalance.balances.kalshi.balance,2)} (verfügbar: ${fmt(exchangeBalance.balances.kalshi.available,2)})</span>}
            {exchangeBalance?.balances?.kalshi?.error&&<span style={{fontSize:11,...mono,color:C.red}}>Fehler: {exchangeBalance.balances.kalshi.error}</span>}
          </div>
        </Card>

        {/* Offene Trades */}
        {openTrades.length>0&&<Card title={`📈 Laufende Trades (${openTrades.length})`} help="Alle aktuell offenen Paper-Trades. Zeigt wann eröffnet, wie lange offen, Restlaufzeit des Marktes, Edge und Einsatz.">
          {openTrades.map((t,i)=>{
            const openedAt=new Date(t.time||Date.now());
            const hoursOpen=Math.round((Date.now()-openedAt.getTime())/3600000);
            const daysOpen=Math.floor(hoursOpen/24);
            const openStr=`${openedAt.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})} ${openedAt.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}`;
            const durationStr=daysOpen>0?`${daysOpen}T ${hoursOpen%24}h`:`${hoursOpen}h`;
            // Calculate remaining time from end_date or days_to_expiry
            let remainStr='';
            if(t.end_date){
              const endMs=new Date(t.end_date).getTime();
              if(endMs>Date.now()){
                const remainDays=Math.ceil((endMs-Date.now())/86400000);
                const remainHours=Math.ceil((endMs-Date.now())/3600000)%24;
                remainStr=remainDays>0?`${remainDays}T ${remainHours}h`:`${remainHours}h`;
              }else{remainStr='abgelaufen';}
            }else if(Number(t.days_to_expiry)>0){
              const approxRemain=Math.max(0,Number(t.days_to_expiry)-daysOpen);
              remainStr=approxRemain>0?`~${approxRemain}T`:'bald';
            }
            const endDateStr=t.end_date?new Date(t.end_date).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit'}):'';
            return<div key={i} style={{padding:'7px 0',borderBottom:`1px solid ${C.border}11`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,flex:1}}>{(t.title||t.market_id||'').slice(0,55)}</span>
                <span style={{fontSize:11,...mono,fontWeight:600,color:t.direction==='BUY_YES'?C.green:C.red}}>{t.direction}</span>
              </div>
              <div style={{display:'flex',gap:10,fontSize:10,...mono,color:C.muted,marginTop:3,flexWrap:'wrap'}}>
                <span title="Eröffnet am">📅 {openStr}</span>
                <span title="Wie lange schon offen">⏱ seit {durationStr}</span>
                {remainStr&&<span title={`Markt endet: ${endDateStr}`} style={{color:remainStr==='abgelaufen'?C.red:Number(remainStr.replace(/\D/g,''))<=3?C.amber:C.muted}}>🏁 noch {remainStr}{endDateStr?` (${endDateStr})`:''}</span>}
                <span title="Einsatz">💰 ${fmt(t.positionUsd,0)}</span>
                <span title="Edge bei Eröffnung" style={{color:Number(t.edge||0)>0.05?C.green:C.muted}}>Edge:{fmt(Number(t.edge||0)*100,1)}%</span>
                {t.category&&t.category!=='other'&&<span style={{fontSize:9,padding:'1px 4px',borderRadius:3,background:`${C.amber}15`,color:C.amber}}>{t.category}</span>}
                <span style={{fontSize:9,padding:'1px 4px',borderRadius:3,background:t.platform==='kalshi'?`${C.purple}20`:`${C.cyan}20`,color:t.platform==='kalshi'?C.purple:C.cyan}}>{t.platform||t.source}</span>
              </div>
            </div>;})}
        </Card>}
        {!openTrades.length&&trades.length===0&&<Card help="Noch keine Trades. Starte die Full Pipeline oben."><div style={{color:C.muted,fontSize:12,textAlign:'center',padding:8}}>Noch keine Trades. Starte die Pipeline.</div></Card>}

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
              {['openai','claude','gemini','ollama_cloud','local_ollama','kimi_direct'].map(n=>{const p=state?.providers?.[n]||{};const ok=p.enabled&&(String(p.api_key||'').trim()||n==='local_ollama');return<StatusLight key={n} ok={ok?true:null} label={`${n}${ok?' ✓':''}`}/>;})}</div>
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
        <Card title="Fortschritt" help="Jeder Step hat Checks. Grün = 100%. Gelb = manche Checks fehlen. Klicke auf einen fehlgeschlagenen Check für Details.">
          {[{n:1,k:'step1',l:'Scan'},{n:2,k:'step2',l:'Research'},{n:3,k:'step3',l:'Predict'},{n:4,k:'step4',l:'Execute'},{n:5,k:'step5',l:'Risk'}].map(({n,k,l})=>{
            const v=Number(steps?.[k]?.progress_pct||0);const checks=steps?.[k]?.checks||[];const fails=checks.filter(c=>!c.ok);
            return<div key={k} style={{marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:C.muted,marginBottom:2,...mono}}><span>Step {n}: {l}</span><span style={{color:v>=100?C.green:v>0?C.amber:C.muted}}>{fmt(v,0)}%</span></div>
              <div style={{height:5,background:C.dim,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${v}%`,background:v>=100?C.green:v>0?C.amber:C.dim,borderRadius:3,transition:'width 0.4s'}}/></div>
              {fails.length>0&&<div style={{marginTop:3}}>
                {fails.map((c,i)=><div key={i} style={{fontSize:10,color:C.amber,display:'flex',alignItems:'flex-start',gap:4,marginTop:1}}>
                  <span>❌</span><span>{c.desc||c.key.replace(/_/g,' ')}</span>
                </div>)}
              </div>}
              {v>=100&&<div style={{fontSize:10,color:C.green,marginTop:2}}>✅ Alle Checks bestanden</div>}
            </div>;})}
        </Card>

        {/* Self-Test — alle Steps */}
        <Card title="🧪 Self-Test — alle Schritte" help="Jeder Schritt hat eigene Checks. Grün = bestanden. Rot = fehlt etwas. Die Beschreibung erklärt was los ist und was du tun kannst.">
          {[{n:1,k:'step1',l:'Scan',emoji:'🔍'},{n:2,k:'step2',l:'Research',emoji:'📰'},{n:3,k:'step3',l:'Predict',emoji:'🎯'},{n:4,k:'step4',l:'Execute',emoji:'⚡'},{n:5,k:'step5',l:'Risk',emoji:'🛡️'}].map(({n,k,l,emoji})=>{
            const checks=steps?.[k]?.checks||[];
            const pct=Number(steps?.[k]?.progress_pct||0);
            if(!checks.length)return null;
            const passed=checks.filter(c=>c.ok).length;
            return<div key={k} style={{marginBottom:10,padding:'8px 10px',background:C.bg,borderRadius:6,border:`1px solid ${pct>=100?C.green:pct>0?C.amber:C.border}33`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600}}>{emoji} Step {n}: {l}</span>
                <span style={{fontSize:11,...mono,color:pct>=100?C.green:C.amber}}>{passed}/{checks.length} Checks — {fmt(pct,0)}%</span>
              </div>
              {checks.map((c,i)=><div key={i} style={{display:'flex',alignItems:'flex-start',gap:5,padding:'2px 0',fontSize:11}}>
                <span style={{color:c.ok?C.green:C.red,fontSize:12,lineHeight:1,minWidth:16}}>{c.ok?'✅':'❌'}</span>
                <div style={{flex:1}}>
                  <span style={{color:c.ok?C.text:C.amber}}>{c.desc||c.key.replace(/_/g,' ')}</span>
                  {!c.ok&&<div style={{color:C.red,fontSize:10,...mono,marginTop:1}}>→ {
                    c.key==='recent_scan_fresh'||c.key==='scan_freshness'?'Starte einen neuen Scan.':
                    c.key==='tradeable_target'||c.key==='tradeable_target_reached'?'Senke Min Volume + Min Liquidität (z.B. auf 200).':
                    c.key==='auth_configured_any'?'Trage API-Keys ein oder starte einen Scan.':
                    c.key==='breaker_closed'||c.key==='breaker_closed_main'?'Warte auf Cooldown oder prüfe die Verbindung.':
                    c.key==='scheduler_config_valid'?'Scan-Intervall muss zwischen 5 und 60 Minuten sein.':
                    c.key==='breaker_config_valid'?'Setze Breaker Schwelle auf mind. 1 und Cooldown auf mind. 30s.':
                    c.key==='scan_pipeline_ranked'?'Scanner kann Beispieldaten nicht ranken. Prüfe Markt-Kategorien — eventuell zu restriktiv.':
                    c.key==='runtime_present'?'Backend neu starten.':
                    c.key==='research_runs_exist'||c.key==='briefs_present'?'Klicke "Research" nachdem der Scan Ergebnisse hat.':
                    c.key==='source_diversity'?'Keine Quelle aktiv. Aktiviere RSS oder Reddit in Einstellungen.':
                    c.key==='coverage_present'?'Keine Headlines matchen die Märkte. Senke "Min Keyword Overlap" auf 1.':
                    c.key==='avg_confidence'?'Confidence zu niedrig. Mehr Quellen aktivieren.':
                    c.key==='predict_runs_exist'||c.key==='predictions_present'?'Klicke "Predict" nach Research.':
                    c.key==='actionable_exist'?'Kein Markt hat genug Edge. Min Edge senken.':
                    c.key==='brier_tracking'?'Kein Handlungsbedarf — füllt sich wenn Märkte auslaufen.':
                    c.key==='execution_runs_exist'?'Klicke "Execute" nach Predict.':
                    c.key==='kelly_configured'?'Kelly Fraction setzen (empf: 0.25).':
                    c.key==='no_correlation_conflicts'?'Korrelierte Trades blockiert — Bot schützt sich.':
                    c.key==='risk_runs_exist'?'Klicke "Risk" oder Full Pipeline.':
                    c.key==='risk_limits_set'?'Setze max_pos_pct und max_drawdown.':
                    c.key==='drawdown_ok'?'Drawdown zu hoch! Klicke "Trades Reset" zum Zurücksetzen.':
                    c.key==='compound_exists'?'Full Pipeline starten — Compound läuft automatisch.':
                    'Prüfe die Einstellungen.'
                  }</div>}
                </div>
              </div>)}
            </div>;})}
          {!steps&&<div style={{color:C.muted,fontSize:12}}>Lade Self-Test Daten...</div>}
        </Card>

        {/* Quellen-Test */}
        <Card title="Verbindungen testen" help="Testet ob Nachrichtenquellen, Börsen und LLM-Provider wirklich erreichbar sind und Daten liefern.">
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
            <Btn onClick={()=>act('srcTest',async()=>{const r=await apiFetch('/api/sources/test');const p=await r.json();setSourceTest(p);setMsg(p.ok?'✅ Quellen liefern Daten':'❌ Keine Quelle liefert Daten');})} busy={busy.srcTest}>📰 Quellen testen</Btn>
            <Btn onClick={()=>act('connTest',async()=>{const r=await apiFetch('/api/connection/test');const p=await r.json();setConnTest(p);setMsg(p.ok?'✅ Börse erreichbar':'❌ Keine Börse erreichbar');})} busy={busy.connTest}>🏦 Börsen testen</Btn>
            <Btn onClick={()=>act('llmTest',async()=>{const r=await apiFetch('/api/llm/test');const p=await r.json();setLlmTest(p);const working=Object.values(p.providers||{}).filter(x=>x.ok).length;const total=Object.values(p.providers||{}).filter(x=>x.enabled!==false).length;setMsg(p.ok?`✅ ${working}/${total} LLM-Provider erreichbar`:'❌ Kein LLM erreichbar — prüfe API-Keys und Timeout');})} busy={busy.llmTest}>🤖 LLM testen</Btn>
          </div>

          {/* LLM Test Results */}
          {llmTest&&<div style={{fontSize:11,...mono,marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:4}}>🤖 LLM-Provider Status</div>
            {Object.entries(llmTest.providers||{}).map(([name,r])=><div key={name} style={{display:'flex',alignItems:'flex-start',gap:6,padding:'3px 0',borderBottom:`1px solid ${C.border}11`}}>
              <span style={{color:r.ok?C.green:r.enabled===false?C.dim:C.red,fontSize:13}}>{r.ok?'✅':r.enabled===false?'⚪':'❌'}</span>
              <div>
                <span style={{fontWeight:500,color:r.ok?C.green:r.enabled===false?C.muted:C.red}}>{name}</span>
                {r.ok&&<span style={{color:C.muted}}> — {r.ms}ms Antwortzeit {r.ms>10000?'(langsam!)':r.ms>5000?'(ok)':'(schnell)'}</span>}
                {r.enabled===false&&<span style={{color:C.dim}}> — deaktiviert</span>}
                {r.error&&<span style={{color:C.red}}> — {r.error}</span>}
              </div>
            </div>)}
            {llmTest.health&&Object.keys(llmTest.health).length>0&&<div style={{marginTop:6,fontSize:10,color:C.muted}}>
              Gesamt-Statistik: {Object.entries(llmTest.health).map(([n,h])=><span key={n} style={{marginRight:8}}>{n}: {h.ok}✓/{h.fail}✗{h.ok>0?` ø${Math.round(h.totalMs/h.ok)}ms`:''}</span>)}
            </div>}
          </div>}
          {sourceTest&&<div style={{fontSize:11,...mono}}>
            {Object.entries(sourceTest.sources||{}).map(([name,s])=><div key={name} style={{display:'flex',alignItems:'flex-start',gap:6,padding:'4px 0',borderBottom:`1px solid ${C.border}11`}}>
              <span style={{color:s.working?C.green:s.enabled?C.red:C.dim,fontSize:13}}>{s.working?'✅':s.enabled?'❌':'⚪'}</span>
              <div>
                <span style={{fontWeight:500,color:s.working?C.green:s.enabled?C.red:C.muted}}>{name.toUpperCase()}</span>
                {!s.enabled&&<span style={{color:C.dim}}> — deaktiviert in Einstellungen</span>}
                {s.enabled&&!s.working&&<span style={{color:C.red}}> — keine Daten! {s.error||''}{s.key_missing?' (API-Key fehlt)':''}</span>}
                {s.working&&name==='rss'&&<span style={{color:C.muted}}> — {(s.feeds_tested||[]).filter(f=>f.ok).length}/{(s.feeds_tested||[]).length} Feeds OK, {(s.feeds_tested||[]).reduce((sum,f)=>sum+(f.items||0),0)} Artikel gefunden</span>}
                {s.working&&name==='reddit'&&<span style={{color:C.muted}}> — {s.posts_found} Posts gefunden</span>}
                {s.working&&name==='newsapi'&&<span style={{color:C.muted}}> — {s.total_results} Ergebnisse</span>}
                {s.working&&name==='gdelt'&&<span style={{color:C.muted}}> — {s.articles} Artikel</span>}
                {name==='rss'&&(s.feeds_tested||[]).map((f,j)=><div key={j} style={{fontSize:10,color:f.ok?C.dim:C.red,marginLeft:8}}>{f.ok?'✓':'✗'} {f.url} {f.ok?`(${f.items} items)`:f.error||''}</div>)}
              </div>
            </div>)}
          </div>}
          {connTest&&<div style={{fontSize:11,...mono,marginTop:6}}>
            <div style={{color:connTest.polymarket?.reachable?C.green:C.red}}>Polymarket: {connTest.polymarket?.reachable?`✅ erreichbar (${connTest.polymarket?.markets_sampled} Märkte)`:'❌ nicht erreichbar'}</div>
            <div style={{color:connTest.kalshi?.reachable?C.green:C.red}}>Kalshi: {connTest.kalshi?.reachable?`✅ erreichbar (${connTest.kalshi?.markets_sampled} Märkte)`:'❌ nicht erreichbar'}</div>
          </div>}
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
              {m.category&&m.category!=='other'&&<span style={{fontSize:9,padding:'2px 5px',borderRadius:3,background:`${C.amber}15`,color:C.amber}}>{m.category}</span>}
              <span title="Marktpreis">P:{fmt(m.market_price,2)}</span><span title="Volumen">V:{Number(m.volume||0).toLocaleString()}</span>
            </div>
          </div>)}
          {!markets.length&&<div style={{color:C.muted,fontSize:12}}>Keine Märkte. Starte einen Scan im Pipeline-Tab.</div>}
        </Card>

        {/* Research Search Log */}
        {researchStatus?.summary?.search_log&&<Card title="🔎 Research — wo wurde gesucht?" help="Zeigt welche Quellen mit welchen Suchbegriffen abgefragt wurden und wie viele Headlines gefunden wurden.">
          <div style={{fontSize:11,...mono}}>
            <div style={{color:C.muted,marginBottom:6}}>Headlines total: <strong style={{color:C.text}}>{researchStatus.summary.search_log.total_headlines_fetched||0}</strong></div>
            {(researchStatus.summary.search_log.sources_queried||[]).map((s,i)=><div key={i} style={{padding:'4px 0',borderBottom:`1px solid ${C.border}11`}}>
              <span style={{color:C.cyan,fontWeight:600}}>{s.type.toUpperCase()}</span>
              {s.type==='rss'&&<span style={{color:C.muted}}> — {s.count} Feeds: {(s.feeds||[]).map(f=><span key={f} style={{color:C.dim,fontSize:10}}>{f} </span>)}</span>}
              {s.type==='reddit'&&<span style={{color:C.muted}}> — Subreddits: {(s.subreddits||[]).map(r=><span key={r} style={{color:C.purple,fontSize:10}}>r/{r} </span>)} · Query: <span style={{color:C.amber}}>{s.search_query}</span></span>}
              {s.type==='newsapi'&&<span style={{color:C.muted}}> — Query: <span style={{color:C.amber}}>{s.query}</span></span>}
              {s.type==='gdelt'&&<span style={{color:C.muted}}> — Query: <span style={{color:C.amber}}>{s.query}</span></span>}
              {s.type==='x_rss'&&<span style={{color:C.muted}}> — Feeds: {(s.feeds||[]).join(', ')}</span>}
              {researchStatus.summary.search_log.headlines_per_source?.[s.type]!=null&&<span style={{color:C.green}}> → {researchStatus.summary.search_log.headlines_per_source[s.type]} Headlines</span>}
            </div>)}
          </div>
        </Card>}

        {/* Research Briefs mit Keywords */}
        {briefs.length>0&&<Card title={`Research Briefs (${briefs.length})`} help="Für jeden Markt: welche Keywords gesucht wurden, welche Headlines matched haben, und was die Stimmung ist.">
          {briefs.map((b,i)=><div key={i} style={{padding:'7px 0',borderBottom:`1px solid ${C.border}11`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:12,fontWeight:500}}>{b.question}</span>
              <span style={{fontSize:10,...mono,color:b.sentiment==='bullish'?C.green:b.sentiment==='bearish'?C.red:C.muted}}>{b.sentiment}</span>
            </div>
            {(b.search_keywords||[]).length>0&&<div style={{fontSize:10,color:C.dim,marginTop:2}}>
              🔍 Suchbegriffe: {(b.search_keywords||[]).map((k,j)=><span key={j} style={{color:(b.matched_keywords||[]).includes(k)?C.green:C.dim,marginRight:4}}>{k}{(b.matched_keywords||[]).includes(k)?'✓':''}</span>)}
            </div>}
            {(b.matched_keywords||[]).length>0&&<div style={{fontSize:10,color:C.green,marginTop:1,...mono}}>✅ Matched: {b.matched_keywords.join(', ')}</div>}
            <div style={{fontSize:10,color:C.muted,marginTop:2,...mono}}>conf: {fmt(b.confidence,3)} · gap: {fmt(b.consensus_vs_market_gap,3)} · stance: {b.stance} · sources: {(b.sources||[]).filter(s=>s.source_type!=='none').length}</div>
            {b.thesis&&<div style={{fontSize:11,color:C.dim,marginTop:2,fontStyle:'italic'}}>{b.thesis}</div>}
            {(b.sources||[]).filter(s=>s.source_type!=='none').slice(0,3).map((s,j)=><div key={j} style={{fontSize:10,color:C.muted,marginTop:1,marginLeft:12}}>
              📰 [{s.source_type}] {(s.title||'').slice(0,60)} <span style={{color:C.dim}}>({s.domain}) kw:{(s.matched_keywords||[]).join(',')}</span>
            </div>)}
          </div>)}
        </Card>}

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
        {/* Risk Level Banner */}
        {riskStatus?.summary?.risk_level&&riskStatus.summary.risk_level!=='OK'&&<div style={{padding:'8px 12px',marginBottom:12,borderRadius:8,background:riskStatus.summary.risk_level==='CRITICAL'?'rgba(239,68,68,0.1)':'rgba(245,158,11,0.1)',border:`1px solid ${riskStatus.summary.risk_level==='CRITICAL'?C.red:C.amber}44`}}>
          <div style={{fontSize:13,fontWeight:600,color:riskStatus.summary.risk_level==='CRITICAL'?C.red:C.amber}}>{riskStatus.summary.risk_level==='CRITICAL'?'🚨 KRITISCH — Drawdown Limit erreicht! Alle neuen Trades blockiert.':'⚠️ WARNUNG — Drawdown über 5%. Positionen werden auf ⅛ Kelly reduziert.'}</div>
        </div>}

        <Card title="Risk Gauges" help="Grün = sicher. Gelb = Vorsicht. Rot = Limit erreicht.">
          <Gauge label="Drawdown (max. Verlust vom Höchststand)" value={Number(state?.risk?.drawdown_pct||0)} max={Number(cfg.max_drawdown_pct||0.08)} warning={0.05}/>
          <Gauge label="Exposure (Geld im Risiko)" value={bankroll>0?openExposure/bankroll:0} max={Number(cfg.max_total_exposure_pct||0.5)} warning={Number(cfg.max_total_exposure_pct||0.5)*0.7}/>
          <Gauge label="Positionen" value={openTrades.length/Math.max(1,Number(cfg.max_concurrent_positions||15))} max={1} warning={0.8}/>
          <Gauge label="Tagesverlust" value={bankroll>0?Math.abs(Math.min(0,Number(state?.risk?.daily_realized_pnl||0)))/bankroll:0} max={Number(cfg.daily_loss_limit_pct||0.15)} warning={0.1}/>
        </Card>

        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Equity" value={`$${fmt(riskStatus?.summary?.current_equity||bankroll+totalPnl,0)}`} good={totalPnl>=0} help="Aktuelles Kapital (Bankroll + P&L)"/>
          <Metric label="Peak" value={`$${fmt(riskStatus?.summary?.peak_bankroll||bankroll,0)}`} help="Höchster Stand des Bankrolls"/>
          <Metric label="Violations" value={riskStatus?.summary?.violations||0} good={!Number(riskStatus?.summary?.violations||0)}/>
          <Metric label="Sharpe" value={fmt(compoundStatus?.summary?.sharpe_ratio,2)} target="≥2.0" good={Number(compoundStatus?.summary?.sharpe_ratio||0)>=2} help="Risk-adjusted Return. Über 2.0 ist sehr gut."/>
          <Metric label="Risk Level" value={riskStatus?.summary?.risk_level||'—'} good={riskStatus?.summary?.risk_level==='OK'}/>
        </div>

        {/* Detailed Risk Checks */}
        {(riskStatus?.summary?.checks||[]).length>0&&<Card title="Risk Checks" help="Jeder Check muss bestanden sein damit neue Trades erlaubt sind.">
          {(riskStatus.summary.checks||[]).map((c,i)=><div key={i} style={{display:'flex',alignItems:'flex-start',gap:5,padding:'3px 0',fontSize:11}}>
            <span style={{color:c.ok?C.green:C.red,fontSize:12}}>{c.ok?'✅':'❌'}</span>
            <span style={{color:c.ok?C.text:C.amber}}>{c.desc}</span>
          </div>)}
        </Card>}

        {openTrades.length>0&&<Card title={`Offene Positionen (${openTrades.length})`} help="Alle aktuell laufenden Trades. Zeigt wie lange offen, Restlaufzeit, Edge und Einsatz.">
          {openTrades.map((t,i)=>{
            const openedAt=new Date(t.time||Date.now());
            const hoursOpen=Math.round((Date.now()-openedAt.getTime())/3600000);
            const daysOpen=Math.floor(hoursOpen/24);
            const durationStr=daysOpen>0?`${daysOpen}T ${hoursOpen%24}h`:`${hoursOpen}h`;
            return<div key={i} style={{padding:'6px 0',borderBottom:`1px solid ${C.border}11`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,flex:1}}>{(t.title||t.market_id||'').slice(0,55)}</span>
                <span style={{fontSize:11,...mono,fontWeight:600,color:t.direction==='BUY_YES'?C.green:C.red}}>{t.direction}</span>
              </div>
              <div style={{display:'flex',gap:10,fontSize:10,...mono,color:C.muted,marginTop:2}}>
                <span title="Einsatz">💰${fmt(t.positionUsd,0)}</span>
                <span title="Edge bei Eröffnung">Edge:{fmt(Number(t.edge||0)*100,1)}%</span>
                <span title="Confidence">Conf:{fmt(Number(t.confidence||0)*100,0)}%</span>
                <span title="Wie lange schon offen">⏱{durationStr}</span>
                {Number(t.days_to_expiry||0)>0&&<span title="Restlaufzeit des Marktes">📅{t.days_to_expiry}T</span>}
                <span title="Plattform" style={{fontSize:9,padding:'1px 4px',borderRadius:3,background:t.platform==='kalshi'?`${C.purple}20`:`${C.cyan}20`,color:t.platform==='kalshi'?C.purple:C.cyan}}>{t.platform||t.source}</span>
              </div>
            </div>;})}
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
              {key:'starting_bankroll',label:'Start-Bankroll ($)',rec:1000,desc:'Bankroll zu Beginn (für P&L-Berechnung).',why:'Gleich wie Bankroll setzen.'},
              {key:'paper_mode',label:'Paper Mode',rec:true,desc:'AN = nur simuliert, kein echtes Geld.',why:'IMMER zuerst Paper Mode!',type:'bool'},
              {key:'kelly_fraction',label:'Kelly Fraction',rec:0.25,desc:'Wie aggressiv gewettet wird. 0.25=vorsichtig, 1.0=sehr riskant.',why:'0.25 (Quarter-Kelly) ist der sichere Standard.'},
              {key:'min_edge',label:'Min Edge',rec:0.04,desc:'Minimaler Vorteil zum Handeln. 0.04 = 4%.',why:'Unter 4% lohnt das Risiko selten.'},
              {key:'max_pos_pct',label:'Max Position %',rec:0.05,desc:'Max Anteil des Bankrolls pro Trade.',why:'5% begrenzt Einzelverluste.'},
              {key:'max_total_exposure_pct',label:'Max Exposure %',rec:0.5,desc:'Max Gesamtrisiko aller offenen Trades.',why:'50% = nie mehr als Hälfte im Risiko.'},
              {key:'max_concurrent_positions',label:'Max Positionen',rec:15,desc:'Max gleichzeitig offene Trades.',why:'Mehr als 15 ist schwer zu überblicken.'},
              {key:'max_drawdown_pct',label:'Max Drawdown',rec:0.08,desc:'Bei diesem Verlust vom Höchststand stoppt der Bot.',why:'8% ist der Notfall-Stopp. Ab 5% wird auf ⅛ Kelly reduziert.'},
              {key:'daily_loss_limit_pct',label:'Daily Loss Limit',rec:0.15,desc:'Max Tagesverlust bevor der Bot pausiert.',why:'15% verhindert Katastrophen-Tage.'},
              {key:'paper_trade_risk_pct',label:'Paper Trade Risk %',rec:0.02,desc:'Positions-Größe im Paper Mode (% des Bankrolls).',why:'2% pro Paper-Trade.'},
              {key:'top_n',label:'Top N',rec:10,desc:'Wie viele Märkte pro Scan in die Pipeline gehen.',why:'10 ist ein guter Kompromiss.'},
              {key:'auto_running',label:'Auto-Pipeline',rec:false,desc:'Wenn AN: läuft die komplette Pipeline automatisch alle X Minuten.',why:'Erst einschalten wenn du manuell getestet hast!',type:'bool'},
              {key:'auto_sync_bankroll',label:'Bankroll von Börse synchen',rec:false,desc:'Wenn AN: holt der Bot bei jedem Balance-Check die Bankroll automatisch von Kalshi.',why:'Nur einschalten wenn Kalshi API-Key gesetzt und korrekt ist.',type:'bool'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </Card>
          {/* Scanner */}
          <Card title="🔍 Scanner" help="Steuert wie der Bot Märkte sucht und filtert.">
            {[{key:'scanner_source',label:'Quelle',rec:'both',desc:'Wo suchen.',why:'both = Polymarket + Kalshi.',type:'select',opts:['polymarket','kalshi','both']},
              {key:'scan_interval_minutes',label:'Intervall (Min)',rec:15,desc:'Wie oft automatisch gescannt wird.',why:'15 ist Standard.'},
              {key:'scanner_min_volume',label:'Min Volume',rec:50000,desc:'Mindest-Handelsvolumen eines Marktes.',why:'Zum Testen: 200. Produktion: 50000.'},
              {key:'scanner_min_liquidity',label:'Min Liquidität',rec:10000,desc:'Mindest-Orderbuch-Tiefe.',why:'Zum Testen: 200. Produktion: 10000.'},
              {key:'scanner_max_days',label:'Max Tage',rec:30,desc:'Nur Märkte die in so vielen Tagen ablaufen.',why:'30 Tage ist Standard.'},
              {key:'scanner_min_anomaly_score',label:'Min Anomalie Score',rec:1.2,desc:'Mindest-Auffälligkeits-Score.',why:'Niedriger = mehr Märkte, mehr Rauschen.'},
              {key:'scanner_max_slippage_pct',label:'Max Slippage',rec:0.02,desc:'Max erlaubte Slippage beim Einstieg.',why:'2% schützt vor teuren Ausführungen.'},
              {key:'scanner_max_spread',label:'Max Spread',rec:0.05,desc:'Spreads über diesem Wert werden als Anomalie geflaggt.',why:'5 Cent ist Standard.'},
              {key:'scanner_price_move_threshold',label:'Preisbewegung-Schwelle',rec:0.1,desc:'Preisbewegungen über diesem Wert werden geflaggt.',why:'10% = deutliche Bewegung.'},
              {key:'scanner_volume_spike_ratio',label:'Volume Spike Ratio',rec:2,desc:'Ab dem Vielfachen des 7-Tage-Schnitts gilt als Spike.',why:'2x = doppelt so viel wie normal.'},
              {key:'min_market_price',label:'Min Marktpreis',rec:0.05,desc:'Märkte unter diesem Preis ignorieren.',why:'Unter 5¢ = extrem unwahrscheinliche Events.'},
              {key:'max_market_price',label:'Max Marktpreis',rec:0.95,desc:'Märkte über diesem Preis ignorieren.',why:'Über 95¢ = fast sicher, kaum Gewinn.'},
              {key:'step1_min_tradeable',label:'Min Tradeable',rec:5,desc:'Mindestanzahl handelbarer Märkte für Step-1-Bestanden.',why:'5 ist realistisch.'},
              {key:'scanner_http_retries',label:'HTTP Retries',rec:2,desc:'Wiederholungsversuche bei API-Fehlern.',why:'2 fängt kurze Netzwerkprobleme.'},
              {key:'scanner_http_timeout_ms',label:'HTTP Timeout (ms)',rec:8000,desc:'Max Wartezeit pro API-Request.',why:'8s verhindert Hänger.'},
              {key:'scanner_breaker_threshold',label:'Breaker Schwelle',rec:3,desc:'Nach so vielen Fehlern pausiert der Scanner.',why:'Schützt gegen Endlosschleifen.'},
              {key:'scanner_breaker_cooldown_sec',label:'Breaker Cooldown (s)',rec:300,desc:'Wartezeit nach Breaker-Auslösung.',why:'5 Min geben APIs Zeit.'},
              {key:'scanner_active_from_utc',label:'Aktiv ab (UTC Stunde)',rec:0,desc:'Scanner nur in diesem Zeitfenster aktiv.',why:'0 = rund um die Uhr.'},
              {key:'scanner_active_to_utc',label:'Aktiv bis (UTC Stunde)',rec:24,desc:'Scanner nur bis zu dieser Stunde aktiv.',why:'24 = rund um die Uhr.'},
              {key:'scanner_history_retention_days',label:'History Tage',rec:14,desc:'Wie lange Preishistorie gespeichert wird.',why:'14 Tage für 7-Tage-Schnitt.'},
              {key:'scanner_ws_enabled',label:'WebSocket aktiv',rec:false,desc:'Live-Orderbook Updates über WebSocket.',why:'Optional, nur für fortgeschrittene Setups.',type:'bool'},
              {key:'scanner_market_categories',label:'Markt-Kategorien',rec:'',desc:'Nur bestimmte Themen scannen (komma-getrennt). Leer = alle Märkte.',why:'Verfügbar: finance, crypto, politics, sports, weather, tech, entertainment, economy, legal, science, geopolitics. Z.B. "finance,crypto,economy" für Finanz-Fokus.',type:'text'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </Card>
          {/* Research */}
          <Card title="📰 Research Quellen" help="Woher der Bot Nachrichten holt. RSS und Reddit gehen sofort ohne API-Key.">
            {[{key:'research_source_rss',label:'RSS Feeds',rec:true,desc:'Reuters, AP und andere Nachrichtenfeeds.',why:'Funktioniert sofort.',type:'bool'},
              {key:'research_rss_feeds',label:'RSS URLs',rec:'',desc:'Komma-getrennte Feed-URLs.',why:'Schon voreingestellt mit Reuters.',type:'text'},
              {key:'research_source_reddit',label:'Reddit',rec:true,desc:'Sucht in Reddit-Subreddits.',why:'Kostenlos, gut für Stimmung.',type:'bool'},
              {key:'research_reddit_subreddits',label:'Reddit Subreddits',rec:'politics,worldnews,PredictionMarkets',desc:'Welche Subreddits durchsucht werden.',why:'Komma-getrennt.',type:'text'},
              {key:'research_reddit_query',label:'Reddit Suchbegriff',rec:'election OR policy OR legal OR odds',desc:'Wonach in den Subreddits gesucht wird.',why:'Breite Begriffe für gute Abdeckung.',type:'text'},
              {key:'research_source_newsapi',label:'NewsAPI',rec:false,desc:'Breitere Nachrichtensuche. Braucht API-Key.',why:'Optional, kostenloser Tier bei newsapi.org.',type:'bool'},
              {key:'research_newsapi_key',label:'NewsAPI Key',rec:'',desc:'API-Schlüssel von newsapi.org.',why:'Nur nötig wenn NewsAPI AN.',type:'password'},
              {key:'research_newsapi_query',label:'NewsAPI Suchbegriff',rec:'(polymarket OR kalshi OR prediction market)',desc:'Wonach in NewsAPI gesucht wird.',why:'Spezifisch für Prediction Markets.',type:'text'},
              {key:'research_source_gdelt',label:'GDELT',rec:false,desc:'Globale Event-Datenbank.',why:'Kostenlos, manchmal langsam.',type:'bool'},
              {key:'research_gdelt_query',label:'GDELT Suchbegriff',rec:'(polymarket OR kalshi OR prediction market)',desc:'Wonach in GDELT gesucht wird.',why:'Spezifisch für Prediction Markets.',type:'text'},
              {key:'research_source_x',label:'X/Twitter RSS',rec:false,desc:'Twitter via RSS-Bridge Feeds.',why:'Schnelle Sentiment-Daten, braucht RSS-Bridge URLs.',type:'bool'},
              {key:'research_x_rss_feeds',label:'X RSS Feed URLs',rec:'',desc:'Komma-getrennte RSS-Bridge URLs für Twitter.',why:'Z.B. über nitter oder RSS-Bridge.',type:'text'},
              {key:'research_max_headlines',label:'Max Headlines',rec:80,desc:'Maximale Anzahl gesammelter Headlines.',why:'80 reicht für gute Abdeckung.'},
              {key:'research_min_keyword_overlap',label:'Min Keyword Overlap',rec:1,desc:'Mindest-Wortübereinstimmung zwischen Headline und Markt.',why:'1 = ein gemeinsames Keyword reicht. 2 = strenger, weniger Treffer aber genauer.'},
              {key:'research_min_credibility',label:'Min Credibility',rec:0.4,desc:'Mindest-Glaubwürdigkeit der Quelle (0-1).',why:'0.4 lässt die meisten durch. Höher = nur Premium-Quellen.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </Card>
          {/* LLM */}
          <Card title="🤖 KI & Predict" help="Für bessere Predictions. Ohne KI nutzt der Bot Heuristiken. Gemini hat kostenlosen Tier!">
            {[{key:'llm_enabled',label:'LLM aktiv',rec:true,desc:'KI für Vorhersagen nutzen.',why:'Deutlich besser als ohne.',type:'bool'},
              {key:'llm_timeout_ms',label:'LLM Timeout (ms)',rec:25000,desc:'Max Wartezeit pro LLM-Request.',why:'25s ist Standard. Bei häufigen Timeouts auf 35000 erhöhen.'},
              {key:'llm_retries',label:'LLM Retries bei Timeout',rec:2,desc:'Wie oft bei Timeout nochmal versuchen.',why:'2 = bei Timeout wird nochmal mit doppelter Wartezeit versucht.'},
              {key:'llm_delay_between_markets_ms',label:'Delay zwischen Märkten (ms)',rec:4000,desc:'Wartezeit zwischen LLM-Anfragen pro Markt. Verhindert Rate Limits.',why:'4000ms = max 15 Märkte/Min. Für Gemini Free Tier nötig. Mit bezahltem Tier auf 1000 senken.'},
              {key:'llm_temperature',label:'Temperature',rec:0.1,desc:'0=konsistent, 1=kreativ.',why:'0.1 für stabile Schätzungen.'},
              {key:'llm_max_tokens',label:'Max Tokens',rec:220,desc:'Max Antwortlänge der KI.',why:'220 reicht für JSON mit Wahrscheinlichkeit + Begründung.'},
              {key:'llm_require_provider',label:'LLM zwingend',rec:false,desc:'Fehler wenn keine KI antwortet (statt Heuristik-Fallback).',why:'AUS lassen — Fallback ist besser als gar kein Signal.',type:'bool'},
              {key:'step3_min_edge',label:'Predict Min Edge',rec:0.04,desc:'Minimum Edge für ein Predict-Signal.',why:'4% = nur handeln wenn deutlicher Vorteil.'},
              {key:'step3_min_confidence',label:'Predict Min Confidence',rec:0.6,desc:'Minimum Confidence für ein Signal (0-1).',why:'0.6 = mäßig sicher. Höher = weniger aber bessere Signale.'},
              {key:'model_prob_offset',label:'Model Prob Offset',rec:0,desc:'Manueller Offset auf alle Schätzungen.',why:'Normalerweise 0. Zum Kalibrieren nutzen.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
            <div style={{fontSize:12,fontWeight:600,marginTop:8,marginBottom:4}}>LLM Gewichte (bestimmt wie stark jeder Provider zählt)</div>
            {[{key:'llm_weight_openai',label:'OpenAI Gewicht',rec:0.35,desc:'Anteil von OpenAI im Ensemble.',why:'0.35 = 35%. Alle Gewichte zusammen müssen nicht genau 1.0 ergeben.'},
              {key:'llm_weight_claude',label:'Claude Gewicht',rec:0.25,desc:'Anteil von Claude.',why:'0.25 = 25%.'},
              {key:'llm_weight_gemini',label:'Gemini Gewicht',rec:0.2,desc:'Anteil von Gemini.',why:'0.20 = 20%.'},
              {key:'llm_weight_ollama_cloud',label:'Ollama Cloud Gewicht',rec:0.2,desc:'Anteil von Ollama Cloud.',why:'0.20 = 20%.'},
              {key:'llm_weight_local_ollama',label:'Lokales Ollama Gewicht',rec:0.15,desc:'Anteil des lokalen Ollama.',why:'0.15 = 15%. Nur relevant wenn Ollama auf dem VPS läuft.'},
              {key:'llm_weight_kimi',label:'Kimi Gewicht',rec:0.15,desc:'Anteil von Kimi/Moonshot.',why:'0.15 = 15%.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
            <div style={{fontSize:12,fontWeight:600,marginTop:8,marginBottom:6}}>Provider</div>
            {['openai','claude','gemini','ollama_cloud','local_ollama','kimi_direct'].map(name=>{const p=state?.providers?.[name]||{};return<div key={name} style={{marginBottom:6,padding:'6px 8px',background:C.bg,borderRadius:5,border:`1px solid ${C.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
                <span style={{fontSize:12,fontWeight:600,color:p.enabled?C.cyan:C.muted}}>{name}</span>
                <label style={{display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={!!p.enabled} onChange={e=>setProvider(name,'enabled',e.target.checked)}/><span style={{fontSize:10,color:C.muted}}>aktiv</span></label>
              </div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>
                {name==='openai'&&'OpenAI (GPT-4o-mini). Gewicht: 35%.'}{name==='claude'&&'Anthropic Claude. Gewicht: 25%.'}{name==='gemini'&&'Google Gemini. Kostenloser Tier! Gewicht: 20%.'}{name==='ollama_cloud'&&'Ollama Cloud. Gewicht: 20%.'}{name==='local_ollama'&&'Lokales Ollama auf deinem VPS. KOSTENLOS, braucht keinen API-Key! Model z.B. qwen2.5:14b.'}{name==='kimi_direct'&&'Kimi/Moonshot API. Braucht API-Key von moonshot.ai.'}
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
          {/* System */}
          <Card title="🔧 System" help="Logging und sonstige Einstellungen.">
            {[{key:'log_to_file',label:'Log in Datei',rec:true,desc:'Logs in tägliche Dateien schreiben.',why:'Wichtig für Debugging.',type:'bool'},
              {key:'log_retention_days',label:'Log Aufbewahrung (Tage)',rec:14,desc:'Wie lange Log-Dateien behalten werden.',why:'14 Tage reicht. Ältere werden gelöscht.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </Card>
        </div>
        <div style={{textAlign:'center',marginTop:8}}><Btn onClick={save} busy={saving} variant="green">💾 Alle Einstellungen speichern</Btn></div>
      </div>}

      {/* ═══════════════════════════════════════════ */}
      {/* TAB: LOG                                    */}
      {/* ═══════════════════════════════════════════ */}
      {tab==='log'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Brier Score" value={fmt(nightlyStatus?.brier_score,4)} target="< 0.250" good={Number(nightlyStatus?.brier_score??1)<0.25} help="Wie gut deine Vorhersagen sind. 0=perfekt, 0.25=Münzwurf. Unter 0.25 ist gut!"/>
          <Metric label="Brier Samples" value={nightlyStatus?.brier_samples||0} help="Wie viele Outcomes erfasst wurden"/>
          <Metric label="Win Rate" value={compoundStatus?.summary?.winRate?`${(compoundStatus.summary.winRate*100).toFixed(0)}%`:'-'} target="≥60%" good={Number(compoundStatus?.summary?.winRate||0)>=0.6} help="Anteil gewonnener Trades"/>
          <Metric label="Profit Factor" value={compoundStatus?.summary?.profitFactor||'-'} target="≥1.5" good={Number(compoundStatus?.summary?.profitFactor||0)>=1.5} help="Bruttogewinn / Bruttoverlust. Über 1.5 ist gesund."/>
          <Metric label="Breaker" value={scanStatus?.runtime?.breaker_open?'OPEN':'OK'} good={!scanStatus?.runtime?.breaker_open}/>
        </div>

        {/* Brier Score Erklärung */}
        <Card title="📐 Brier Score — wie gut sind die Vorhersagen?" help="Der Brier Score misst ob deine Wahrscheinlichkeits-Schätzungen stimmen. Beispiel: Du sagst '70% Wahrscheinlichkeit' → wenn es eintritt: (0.7-1)²=0.09 (gut). Wenn nicht: (0.7-0)²=0.49 (schlecht). Der Durchschnitt über alle Predictions ist dein Brier Score.">
          <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>
            <strong>0.00</strong> = Perfekte Vorhersagen · <strong>0.25</strong> = So gut wie Münzwurf · <strong>&gt;0.25</strong> = Schlecht<br/>
            Aktuell: <strong style={{color:Number(nightlyStatus?.brier_score??1)<0.25?C.green:C.red}}>{nightlyStatus?.brier_score!=null?nightlyStatus.brier_score:'Noch keine Daten'}</strong> über {nightlyStatus?.brier_samples||0} Outcomes.<br/>
            <span style={{fontSize:11,color:C.dim}}>Outcomes werden erfasst wenn Märkte auslaufen. Mehr Samples = zuverlässigerer Score.</span>
          </div>
        </Card>

        {/* Compound Status */}
        {compoundStatus?.summary?.updated_at&&<Card title="🧠 Learning Status (Compound)" help="Der Bot analysiert abgeschlossene Trades und schreibt Verluste in die failure_log.md. So vermeidet er beim nächsten Scan dieselben Fehler.">
          <div style={{fontSize:11,...mono,color:C.muted}}>
            Letzte Analyse: {(compoundStatus.summary.updated_at||'').slice(0,19)}<br/>
            Trades analysiert: {compoundStatus.summary.total_trades||0} · Wins: {compoundStatus.summary.wins||0} · Losses: {compoundStatus.summary.losses||0}<br/>
            Win Rate: <span style={{color:Number(compoundStatus.summary.winRate||0)>=0.6?C.green:C.amber}}>{((compoundStatus.summary.winRate||0)*100).toFixed(1)}%</span> · 
            Profit Factor: <span style={{color:Number(compoundStatus.summary.profitFactor||0)>=1.5?C.green:C.amber}}>{compoundStatus.summary.profitFactor}</span> · 
            P&L: <span style={{color:Number(compoundStatus.summary.totalPnl||0)>=0?C.green:C.red}}>${compoundStatus.summary.totalPnl}</span>
          </div>
        </Card>}

        {/* Nightly Reviews */}
        {(nightlyStatus?.reviews||[]).length>0&&<Card title="🌙 Nightly Reviews" help="Einmal täglich (Mitternacht UTC) analysiert der Bot den ganzen Tag: Trades, Win Rate, P&L, Brier Score. Hier die letzten Tage.">
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:10,...mono}}>
              <thead><tr style={{color:C.muted,textAlign:'left'}}>{['Datum','Trades','Wins','Losses','P&L','Brier'].map(h=><th key={h} style={{padding:'4px 6px',borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
              <tbody>{(nightlyStatus.reviews||[]).slice(0,14).map((r,i)=><tr key={i} style={{borderBottom:`1px solid ${C.border}11`}}>
                <td style={{padding:'4px 6px'}}>{r.date}</td>
                <td style={{padding:'4px 6px'}}>{r.trades}</td>
                <td style={{padding:'4px 6px',color:C.green}}>{r.wins}</td>
                <td style={{padding:'4px 6px',color:C.red}}>{r.losses}</td>
                <td style={{padding:'4px 6px',color:Number(r.pnl||0)>=0?C.green:C.red}}>${fmt(r.pnl,0)}</td>
                <td style={{padding:'4px 6px',color:Number(r.brier_score??1)<0.25?C.green:C.amber}}>{r.brier_score!=null?fmt(r.brier_score,4):'-'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Card>}

        {/* Pipeline Runs */}
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
