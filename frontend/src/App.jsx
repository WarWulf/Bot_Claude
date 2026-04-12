import { useEffect, useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ═══════════════════════════════════════════
// FARBEN & HELFER
// ═══════════════════════════════════════════
const C = { bg:'#0a0e17',card:'#111827',border:'#1e293b',green:'#22c55e',red:'#ef4444',amber:'#f59e0b',blue:'#3b82f6',purple:'#8b5cf6',cyan:'#06b6d4',text:'#e2e8f0',muted:'#64748b',dim:'#334155' };
const fmt = (v,d=2) => { const n=Number(v); return Number.isNaN(n)?'-':n.toFixed(d); };
const mono = { fontFamily:'JetBrains Mono,monospace' };

// ═══════════════════════════════════════════
// ERKLÄRUNGSTEXTE
// ═══════════════════════════════════════════
const PIPELINE_EXPLAIN = {
  scan: { title:'Schritt 1: Scan', emoji:'🔍', what:'Der Bot schaut auf Polymarket und Kalshi welche Märkte es gibt und filtert nach Volumen, Liquidität und Auffälligkeiten.', when:'Läuft automatisch alle 15 Min oder wenn du "Scan" klickst.', result:'Eine Liste der besten handelbaren Märkte.' },
  research: { title:'Schritt 2: Research', emoji:'📰', what:'Für jeden Markt aus Schritt 1 sammelt der Bot Nachrichten (RSS, Reddit, etc.) und analysiert die Stimmung.', when:'Klicke "Research" nachdem ein Scan Ergebnisse hat.', result:'Research Briefs mit Sentiment (bullish/bearish/neutral) und Confidence.' },
  predict: { title:'Schritt 3: Predict', emoji:'🎯', what:'Der Bot schätzt die echte Wahrscheinlichkeit jedes Events und vergleicht sie mit dem Marktpreis. Wenn er denkt der Markt liegt falsch, gibt er ein Signal.', when:'Klicke "Predict" nachdem Research Briefs da sind.', result:'BUY_YES (Markt unterbewertet), BUY_NO (überbewertet), oder NO_TRADE.' },
  execute: { title:'Schritt 4: Execute', emoji:'⚡', what:'Der Bot platziert Trades basierend auf den Predict-Signalen. Im Paper Mode wird nur simuliert, kein echtes Geld.', when:'Klicke "Execute" oder nutze die Full Pipeline.', result:'Paper-Trades werden angelegt und im Risk-Tab angezeigt.' },
  risk: { title:'Schritt 5: Risk Check', emoji:'🛡️', what:'Prüft ob alle offenen Positionen innerhalb der Risiko-Limits sind (max. Position, Drawdown, Tagesverlust).', when:'Wird automatisch nach Execute ausgeführt.', result:'Warnung bei Verstößen, blockiert neue Trades wenn nötig.' },
};

const ERROR_HELP = {
  'aborted':'Request abgebrochen — der LLM-Provider war zu langsam. Erhöhe "LLM Timeout" in den Einstellungen (z.B. 20000ms).',
  'http 401':'API-Key ungültig. Prüfe den Key in den Einstellungen.',
  'http 429':'Zu viele Anfragen. Warte ein paar Minuten.',
  'http 500':'Server-Fehler beim Provider. Nicht dein Problem — später nochmal versuchen.',
  'ECONNREFUSED':'Verbindung verweigert. Ist die URL korrekt?',
  'fetch failed':'Netzwerk-Problem. Prüfe die Internetverbindung des Servers.',
  'no_llm_provider':'Kein LLM konfiguriert. Gehe zu Einstellungen und trage einen API-Key ein.',
  'llm_disabled':'LLM ist deaktiviert. Der Bot nutzt einfache Heuristiken statt KI.',
};
function helpForError(msg) { const s=String(msg||'').toLowerCase(); for(const [k,v] of Object.entries(ERROR_HELP)) if(s.includes(k.toLowerCase())) return v; return null; }

function directionExplain(p) {
  if(!p) return '';
  const e=Number(p.edge||0), m=Number(p.market_prob||0), mdl=Number(p.model_prob||0), c=Number(p.confidence||0);
  if(p.direction==='BUY_YES') return `Der Bot denkt die Wahrscheinlichkeit ist ${(mdl*100).toFixed(0)}%, aber der Markt sagt nur ${(m*100).toFixed(0)}%. Das ist ein Vorteil von ${(e*100).toFixed(1)}% → YES kaufen.`;
  if(p.direction==='BUY_NO') return `Der Bot denkt die Wahrscheinlichkeit ist nur ${(mdl*100).toFixed(0)}%, aber der Markt sagt ${(m*100).toFixed(0)}%. Der Markt ist zu hoch → NO kaufen.`;
  return `Der Unterschied zwischen Bot-Schätzung (${(mdl*100).toFixed(0)}%) und Markt (${(m*100).toFixed(0)}%) ist zu klein oder die Confidence zu niedrig für einen Trade.`;
}

// ═══════════════════════════════════════════
// UI BAUSTEINE
// ═══════════════════════════════════════════
function Card({title,help,children,accent}) {
  return <div style={{background:C.card,border:`1px solid ${accent||C.border}`,borderRadius:10,padding:'14px 16px',marginBottom:14}}>
    {title&&<div style={{fontSize:14,fontWeight:600,marginBottom:help?4:10}}>{title}</div>}
    {help&&<div style={{fontSize:12,color:C.muted,marginBottom:10,lineHeight:1.5}}>{help}</div>}
    {children}
  </div>;
}
function Metric({label,value,unit='',target,good,help}) {
  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px',flex:'1 1 120px',minWidth:120}} title={help||''}>
    <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:1,...mono}}>{label}</div>
    <div style={{fontSize:18,fontWeight:700,color:(good!==undefined?good:true)?C.green:C.red,marginTop:2,...mono}}>{value}{unit}</div>
    {target&&<div style={{fontSize:9,color:C.dim,...mono}}>Ziel: {target}</div>}
  </div>;
}
function Gauge({label,value,max,warning,help}) {
  const p=Math.min((value/max)*100,100); const color=value>=max*0.95?C.red:value>=warning?C.amber:C.green;
  return <div style={{marginBottom:8}} title={help||''}>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted,marginBottom:2,...mono}}><span>{label}</span><span style={{color}}>{fmt(value*100,1)}%/{fmt(max*100,0)}%</span></div>
    <div style={{height:5,background:C.dim,borderRadius:3,overflow:'hidden',position:'relative'}}>
      <div style={{position:'absolute',left:`${(warning/max)*100}%`,top:0,bottom:0,width:2,background:C.amber,opacity:0.5}}/>
      <div style={{height:'100%',width:`${p}%`,background:color,borderRadius:3,transition:'width 0.4s'}}/>
    </div>
  </div>;
}
function Pill({ok,label}) { return <span style={{fontSize:10,padding:'3px 9px',borderRadius:14,background:ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',color:ok?C.green:C.red,...mono,border:`1px solid ${ok?C.green:C.red}22`}}>{label}</span>; }
function Btn({children,onClick,disabled,variant,busy,help}) {
  const a=variant==='danger'?C.red:variant==='warn'?C.amber:variant==='green'?C.green:C.cyan;
  return <button onClick={onClick} disabled={disabled||busy} title={help||''} style={{padding:'7px 15px',fontSize:11,...mono,background:`${a}15`,color:disabled?C.muted:a,border:`1px solid ${disabled?C.dim:a}44`,borderRadius:6,cursor:disabled?'not-allowed':'pointer',opacity:busy?0.6:1}}>{busy?'⏳ läuft...':children}</button>;
}
function StatusLight({ok,label,help}) {
  return <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0'}} title={help||''}>
    <div style={{width:8,height:8,borderRadius:'50%',background:ok===true?C.green:ok===false?C.red:C.dim}}/>
    <span style={{fontSize:12,color:ok===true?C.green:ok===false?C.red:C.muted}}>{label}</span>
  </div>;
}
function Tip({children}) { return <div style={{fontSize:11,color:C.amber,padding:'6px 10px',background:'rgba(245,158,11,0.06)',borderRadius:6,border:`1px solid ${C.amber}22`,marginBottom:10}}>💡 {children}</div>; }
function ChartTip({active,payload,label}) {
  if(!active||!payload?.length)return null;
  return <div style={{background:C.card,border:`1px solid ${C.border}`,padding:'5px 9px',borderRadius:5,fontSize:10,...mono}}>
    <div style={{color:C.muted}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color||C.text}}>{p.name}: {typeof p.value==='number'?p.value.toFixed(2):p.value}</div>)}
  </div>;
}

function PipelineStep({step,status,onRun,busy,result}) {
  const s=PIPELINE_EXPLAIN[step];
  const pct=Number(status?.progress_pct||0);
  const ok=pct>=100;
  return <div style={{background:C.card,border:`1px solid ${ok?C.green:pct>0?C.amber:C.border}44`,borderRadius:8,padding:'10px 12px',marginBottom:8}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
      <div style={{fontSize:13,fontWeight:600}}>{s.emoji} {s.title} <span style={{fontSize:11,color:ok?C.green:pct>0?C.amber:C.muted,...mono}}>{fmt(pct,0)}%</span></div>
      {onRun&&<Btn onClick={onRun} busy={busy} variant={ok?'green':undefined}>{ok?'✓ Nochmal':'Starten'}</Btn>}
    </div>
    <div style={{fontSize:11,color:C.muted,marginBottom:3}}><strong>Was passiert:</strong> {s.what}</div>
    <div style={{fontSize:11,color:C.dim}}><strong>Wann:</strong> {s.when}</div>
    {result&&<div style={{fontSize:11,color:C.cyan,marginTop:3,...mono}}>→ {result}</div>}
    {(status?.checks||[]).filter(c=>!c.ok).map((c,i)=><div key={i} style={{fontSize:10,color:C.amber,marginTop:2,...mono}}>⚠ {c.key.replace(/_/g,' ')}</div>)}
  </div>;
}

// ═══════════════════════════════════════════
// HAUPT-APP
// ═══════════════════════════════════════════
export default function App() {
  const [state,setState]=useState(null);
  const [scan,setScan]=useState({markets:[],runs:[]});
  const [auth,setAuth]=useState(null);
  const [health,setHealth]=useState(null);
  const [scanStatus,setScanStatus]=useState(null);
  const [steps,setSteps]=useState(null);
  const [improvements,setImprovements]=useState(null);
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
  const [showAdvanced,setShowAdvanced]=useState(false);
  const [lastResults,setLastResults]=useState({});

  const apiFetch=useCallback(async(path,opts={})=>{const h={...(opts.headers||{})};if(uiPw)h['x-ui-password']=uiPw;return fetch(path,{...opts,headers:h});},[uiPw]);
  const apiJson=useCallback(async(path,fb=null)=>{try{const r=await apiFetch(path);if(!r.ok)throw 0;return await r.json();}catch{return fb;}},[apiFetch]);
  const reload=useCallback(async()=>{
    const [st,sc,au,he,ss,stp,imp,ps,cal,cor,rs,es,rsk]=await Promise.all([
      apiJson('/api/state'),apiJson('/api/scan',{markets:[],runs:[]}),apiJson('/api/auth/status'),
      apiJson('/api/health'),apiJson('/api/scan/status'),apiJson('/api/status/steps'),
      apiJson('/api/improvements'),apiJson('/api/predict/status'),apiJson('/api/predict/calibration'),
      apiJson('/api/predict/correlations'),apiJson('/api/research/status'),apiJson('/api/execute/status'),apiJson('/api/risk/status')
    ]);
    if(st)setState(st);setScan(sc||{markets:[],runs:[]});setAuth(au);setHealth(he);setScanStatus(ss);setSteps(stp);
    setImprovements(imp);setPredictStatus(ps);setCalibration(cal);setCorrelations(cor);setResearchStatus(rs);setExecStatus(es);setRiskStatus(rsk);
  },[apiJson]);

  async function doLogin(){try{const r=await fetch('/api/ui-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwInput})});if(!r.ok)throw new Error('Falsches Passwort');localStorage.setItem('ui_pw',pwInput);setUiPw(pwInput);setPwInput('');setUiAuthed(true);}catch(e){setMsg(e.message);}}
  useEffect(()=>{(async()=>{const r=await fetch('/api/ui-auth/status');const p=await r.json();if(!p.enabled){setUiAuthed(true);return;}const saved=localStorage.getItem('ui_pw')||'';if(!saved)return;const lr=await fetch('/api/ui-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:saved})});if(lr.ok){setUiPw(saved);setUiAuthed(true);}else localStorage.removeItem('ui_pw');})();},[]);
  useEffect(()=>{if(uiAuthed)reload();},[uiAuthed,reload]);
  useEffect(()=>{if(!uiAuthed)return;const t=setInterval(async()=>{const d=await apiJson('/api/scan/live-log',{items:[]});setLiveLog(d?.items||[]);},5000);return()=>clearInterval(t);},[uiAuthed,apiJson]);

  async function act(key,fn){setBusy(p=>({...p,[key]:true}));try{const r=await fn();setLastResults(p=>({...p,[key]:r}));await reload();return r;}catch(e){setMsg(`❌ ${e.message}`);return null;}finally{setBusy(p=>({...p,[key]:false}));}}
  async function save(){setSaving(true);try{await apiFetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:state.config,providers:state.providers})});setMsg('✅ Einstellungen gespeichert');await reload();}catch(e){setMsg('❌ '+e.message);}finally{setSaving(false);}}
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

  // Source status
  const sourceStatus=useMemo(()=>{
    const rssOk=Boolean(cfg.research_source_rss!==false && String(cfg.research_rss_feeds||'').trim());
    const redditOk=Boolean(cfg.research_source_reddit!==false);
    const newsapiOk=Boolean(cfg.research_source_newsapi && String(cfg.research_newsapi_key||'').trim());
    const gdeltOk=Boolean(cfg.research_source_gdelt);
    const xOk=Boolean(cfg.research_source_x && String(cfg.research_x_rss_feeds||'').trim());
    const anyLlm=['openai','claude','gemini','ollama_cloud'].some(n=>{const p=state?.providers?.[n]||{};return p.enabled&&String(p.api_key||'').trim()&&String(p.model||'').trim();});
    const pmOk=auth?.polymarket?.configured;
    const kaOk=auth?.kalshi?.configured;
    return{rssOk,redditOk,newsapiOk,gdeltOk,xOk,anyLlm,pmOk,kaOk,anySource:rssOk||redditOk||newsapiOk||gdeltOk||xOk};
  },[cfg,state?.providers,auth]);

  // ═══════════ LOGIN ═══════════
  if(!uiAuthed)return(
    <div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans,sans-serif'}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:32,width:360,textAlign:'center'}}>
        <div style={{fontSize:28,marginBottom:8}}><span style={{color:C.cyan}}>&#9670;</span></div>
        <h2 style={{color:C.text,fontSize:18,fontWeight:600,margin:'0 0 4px'}}>Prediction Market Bot</h2>
        <p style={{color:C.muted,fontSize:13,marginBottom:6}}>Dashboard Login</p>
        <p style={{color:C.dim,fontSize:11,marginBottom:16}}>Standard-Passwort: <code style={{...mono,color:C.amber}}>changeme</code><br/>Bitte in .env ändern!</p>
        <input type="password" value={pwInput} onChange={e=>setPwInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doLogin()} placeholder="Passwort eingeben..." style={{width:'100%',padding:'10px 12px',borderRadius:6,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,marginBottom:12,...mono,boxSizing:'border-box'}}/>
        <button onClick={doLogin} style={{width:'100%',padding:'10px',borderRadius:6,border:'none',background:C.cyan,color:'#000',fontWeight:600,fontSize:14,cursor:'pointer'}}>Login</button>
        {msg&&<p style={{color:C.red,fontSize:12,marginTop:10}}>{msg}</p>}
      </div>
    </div>);

  if(!state)return<div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.muted}}>Lade Dashboard...</div>;

  // ═══════════ DASHBOARD ═══════════
  return(
    <div style={{background:C.bg,color:C.text,minHeight:'100vh',fontFamily:'IBM Plex Sans,-apple-system,sans-serif',padding:'18px 14px',maxWidth:900,margin:'0 auto'}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>

      {/* ═══════════ HEADER ═══════════ */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
        <div>
          <h1 style={{margin:0,fontSize:19,fontWeight:700}}><span style={{color:C.cyan}}>&#9670;</span> Prediction Market Bot</h1>
          <div style={{fontSize:11,color:C.muted,marginTop:2,...mono}}>{cfg.paper_mode?'📋 Paper-Modus (kein echtes Geld)':'🔴 LIVE MODUS'} · ${fmt(bankroll+totalPnl,0)} Bankroll</div>
        </div>
        <div style={{display:'flex',gap:5,alignItems:'center'}}>
          <Btn onClick={reload}>↻ Refresh</Btn>
          <Btn onClick={save} busy={saving} variant="green">💾 Speichern</Btn>
        </div>
      </div>

      {msg&&<div style={{fontSize:11,color:msg.startsWith('✅')?C.green:msg.startsWith('❌')?C.red:C.cyan,marginBottom:10,...mono,padding:'6px 10px',background:`${C.cyan}08`,borderRadius:6,border:`1px solid ${C.cyan}15`,display:'flex',justifyContent:'space-between'}}>
        <span>{msg}</span><button onClick={()=>setMsg('')} style={{background:'none',border:'none',color:C.muted,cursor:'pointer'}}>✕</button>
      </div>}

      {/* ═══════════ WIE FUNKTIONIERT DER BOT? ═══════════ */}
      <Card title="Wie funktioniert der Bot?" help="Der Bot arbeitet in 5 Schritten. Jeder Schritt baut auf dem vorherigen auf. Du kannst sie einzeln oder alle zusammen starten.">
        <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap',marginBottom:10,fontSize:12}}>
          {['🔍 Scan','→','📰 Research','→','🎯 Predict','→','⚡ Execute','→','🛡️ Risk'].map((s,i)=>
            <span key={i} style={{color:s==='→'?C.dim:C.text,fontWeight:s==='→'?400:500}}>{s}</span>
          )}
        </div>
        <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
          <strong>Scan</strong> findet Märkte → <strong>Research</strong> sammelt Nachrichten → <strong>Predict</strong> schätzt Wahrscheinlichkeiten → <strong>Execute</strong> platziert Trades → <strong>Risk</strong> prüft die Limits.<br/>
          Du kannst auch <strong>"Full Pipeline"</strong> klicken — dann laufen alle 5 Schritte automatisch nacheinander.
        </div>
      </Card>

      {/* ═══════════ VERBINDUNGS-STATUS ═══════════ */}
      <Card title="Verbindungen — Was ist angeschlossen?" help="Grün = funktioniert. Rot = fehlt oder kaputt. Grau = nicht konfiguriert. Du brauchst mindestens eine Nachrichtenquelle (RSS ist Standard) und optional einen LLM-Provider für bessere Vorhersagen.">
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4}}>
          <div>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4}}>Märkte</div>
            <StatusLight ok={sourceStatus.pmOk} label="Polymarket" help="Crypto-Börse. API Key nötig."/>
            <StatusLight ok={sourceStatus.kaOk} label="Kalshi" help="US-regulierte Börse. API Key nötig."/>
            <StatusLight ok={!sourceStatus.pmOk&&!sourceStatus.kaOk?false:null} label={sourceStatus.pmOk||sourceStatus.kaOk?'Mindestens eine Börse ✓':'Keine Börse konfiguriert!'} />
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4}}>Nachrichten</div>
            <StatusLight ok={sourceStatus.rssOk} label={`RSS Feeds ${sourceStatus.rssOk?'(aktiv)':'(inaktiv)'}`} help="Reuters, AP etc. Standard-Quelle, funktioniert sofort."/>
            <StatusLight ok={sourceStatus.redditOk} label={`Reddit ${sourceStatus.redditOk?'(aktiv)':'(inaktiv)'}`} help="Reddit Subreddits. Braucht keinen API-Key."/>
            <StatusLight ok={sourceStatus.newsapiOk} label={`NewsAPI ${sourceStatus.newsapiOk?'(aktiv+Key)':'(inaktiv)'}`} help="Braucht kostenlosen API-Key von newsapi.org"/>
            <StatusLight ok={sourceStatus.gdeltOk} label={`GDELT ${sourceStatus.gdeltOk?'(aktiv)':'(inaktiv)'}`} help="Global Event DB. Kostenlos."/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4}}>KI-Provider (für Predict)</div>
            {['openai','claude','gemini','ollama_cloud'].map(n=>{const p=state?.providers?.[n]||{};const ok=p.enabled&&String(p.api_key||'').trim();return<StatusLight key={n} ok={ok?true:p.enabled?false:null} label={`${n} ${ok?'✓':p.enabled?'Key fehlt!':'(aus)'}`}/>;})}
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4}}>System</div>
            <StatusLight ok={health?.status==='ok'} label="Backend"/>
            <StatusLight ok={!scanStatus?.runtime?.breaker_open} label={`Scanner ${scanStatus?.runtime?.breaker_open?'PAUSIERT':'OK'}`}/>
            <StatusLight ok={!cfg.kill_switch} label={cfg.kill_switch?'Kill Switch AKTIV!':'Kill Switch aus'}/>
          </div>
        </div>
        {!sourceStatus.anySource&&<Tip>Keine Nachrichtenquelle aktiv! RSS ist standardmäßig eingeschaltet — prüfe in den Einstellungen ob RSS Feed URLs eingetragen sind.</Tip>}
        {!sourceStatus.anyLlm&&<Tip>Kein KI-Provider konfiguriert. Der Bot nutzt einfache Heuristiken. Für bessere Vorhersagen: trage einen API-Key ein (Gemini hat einen kostenlosen Tier).</Tip>}
      </Card>

      {/* ═══════════ KORRELATIONS-WARNUNG ═══════════ */}
      {(correlations?.conflicts||[]).length>0&&<Card title="⚠️ Problem: Widersprüchliche Trades erkannt" accent={C.red+'66'}>
        <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Der Bot will bei mehreren Märkten gleichzeitig "YES" kaufen, obwohl es nur einen Gewinner geben kann (z.B. Präsidentschaftswahl, FIFA WM). Das ist logisch unmöglich.</div>
        {correlations.conflicts.map((c,i)=><div key={i} style={{marginBottom:6,padding:'6px 8px',background:'rgba(239,68,68,0.05)',borderRadius:5}}>
          <div style={{fontSize:12,color:C.red,fontWeight:500}}>{c.message}</div>
          <div style={{fontSize:11,color:C.amber,marginTop:2}}>→ Empfehlung: Nur den mit dem höchsten Edge handeln: {c.recommendation}</div>
        </div>)}
      </Card>}

      {/* ═══════════ PIPELINE — SCHRITT FÜR SCHRITT ═══════════ */}
      <Card title="Pipeline — Was tun?" help="Klicke die Schritte von oben nach unten, oder nutze 'Full Pipeline' für alles auf einmal.">
        <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>
          <Btn onClick={()=>act('pipeline',async()=>{const r=await apiFetch('/api/pipeline/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg('✅ Full Pipeline fertig — alle 5 Schritte durchlaufen');return p;})} busy={busy.pipeline} help="Führt Scan→Research→Predict→Execute→Risk nacheinander aus">🚀 Full Pipeline</Btn>
          <Btn variant={cfg.kill_switch?'danger':'warn'} onClick={()=>act('kill',async()=>{await apiFetch('/api/kill-switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!cfg.kill_switch})});setMsg(cfg.kill_switch?'✅ Kill Switch deaktiviert':'⚠️ Kill Switch aktiviert — keine neuen Trades');})} help="Notfall-Stopp: blockiert alle neuen Trades sofort">{cfg.kill_switch?'🔴 Kill Switch AUS':'🛑 Kill Switch'}</Btn>
        </div>

        <PipelineStep step="scan" status={steps?.step1} busy={busy.scan}
          result={lastResults.scan?`${lastResults.scan.tradeable_count||0} tradeable Märkte gefunden`:null}
          onRun={()=>act('scan',async()=>{const r=await apiFetch('/api/scan/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Scan fertig: ${p.tradeable_count} Märkte gefunden`);return p;})}/>

        <PipelineStep step="research" status={steps?.step2} busy={busy.research}
          result={lastResults.research?`${(lastResults.research.briefs||[]).length} Briefs erstellt`:null}
          onRun={()=>act('research',async()=>{const r=await apiFetch('/api/research/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Research fertig: ${(p.briefs||[]).length} Briefs`);return p;})}/>

        <PipelineStep step="predict" status={steps?.step3} busy={busy.predict}
          result={lastResults.predict?`${(lastResults.predict.predictions||[]).length} Predictions`:null}
          onRun={()=>act('predict',async()=>{const r=await apiFetch('/api/predict/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Predict fertig: ${(p.predictions||[]).length} Predictions, ${p.summary?.actionable_pct||0}% actionable`);return p;})}/>

        <PipelineStep step="execute" status={steps?.step4} busy={busy.execute}
          onRun={()=>act('execute',async()=>{const r=await apiFetch('/api/execute/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Execute fertig: ${p.summary?.executed_orders||0} Orders, ${p.summary?.risk_blocked_orders||0} blockiert`);return p;})}/>

        <PipelineStep step="risk" status={steps?.step5} busy={busy.risk}
          onRun={()=>act('risk',async()=>{const r=await apiFetch('/api/risk/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Risk Check: ${p.summary?.violations||0} Verstöße`);return p;})}/>
      </Card>

      {/* ═══════════ RESET ═══════════ */}
      <Card title="Daten zurücksetzen" help="Für Tests: lösche gescannte Märkte, Trades oder alles. Die Einstellungen und API-Keys bleiben erhalten.">
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          <Btn variant="warn" onClick={()=>act('resetM',async()=>{const r=await apiFetch('/api/markets/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'ui reset'})});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`✅ Märkte zurückgesetzt (${p.previous_markets} gelöscht). Scan starten für neue Daten.`);})} busy={busy.resetM} help="Löscht alle gescannten Märkte, Research Briefs und Predictions. Du musst danach neu scannen.">🗑 Märkte + Research + Predictions löschen</Btn>
          <Btn variant="danger" onClick={()=>{if(!confirm('Wirklich ALLE Trades löschen?'))return;act('resetT',async()=>{const r=await apiFetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{...cfg},providers:state.providers})});setState(p=>({...p,trades:[],signals:[],orders:[]}));setMsg('✅ Trades gelöscht. Bankroll bleibt unverändert.');});}} busy={busy.resetT} help="Löscht alle offenen und geschlossenen Trades. Bankroll wird nicht verändert.">🗑 Alle Trades löschen</Btn>
        </div>
      </Card>

      {/* ═══════════ ÜBERSICHT — BANKROLL & TRADES ═══════════ */}
      <Card title="Übersicht — Wie läuft's?" help={closedTrades.length?`${closedTrades.length} abgeschlossene Trades. ${openTrades.length} offen.`:'Noch keine Trades. Starte die Pipeline oben.'}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          <Metric label="Bankroll" value={`$${fmt(bankroll+totalPnl,0)}`} good={totalPnl>=0} help="Dein aktuelles Kapital inkl. Gewinne/Verluste"/>
          <Metric label="P&L" value={`${totalPnl>=0?'+':''}$${fmt(totalPnl,0)}`} good={totalPnl>=0} help="Profit & Loss — Summe aller abgeschlossenen Trades"/>
          <Metric label="Offen" value={openTrades.length} target="max 15" good={openTrades.length<=15} help="Wie viele Trades gerade laufen"/>
          <Metric label="Brier" value={fmt(calibration?.brier_score,3)} target="< 0.250" good={Number(calibration?.brier_score??1)<0.25} help="Wie gut die Vorhersagen sind. Niedriger = besser. Unter 0.25 ist gut."/>
        </div>
        {equityData.length>1&&<div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Bankroll-Verlauf (je mehr es steigt, desto besser)</div>
          <ResponsiveContainer width="100%" height={160}><AreaChart data={equityData}>
            <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.cyan} stopOpacity={0.3}/><stop offset="100%" stopColor={C.cyan} stopOpacity={0}/></linearGradient></defs>
            <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
            <Tooltip content={<ChartTip/>}/><Area type="monotone" dataKey="v" stroke={C.cyan} fill="url(#eq)" strokeWidth={2} name="Bankroll"/>
          </AreaChart></ResponsiveContainer>
        </div>}
      </Card>

      {/* ═══════════ GESCANNTE MÄRKTE ═══════════ */}
      {markets.length>0&&<Card title={`Gescannte Märkte (${markets.length})`} help="Diese Märkte hat der Scanner gefunden. Sie sind nach Opportunity Score sortiert — je höher, desto interessanter.">
        {markets.slice(0,12).map((m,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${C.border}11`,fontSize:12}}>
          <span style={{flex:1}}>{m.question||m.market}</span>
          <div style={{display:'flex',gap:8,fontSize:10,...mono,color:C.muted,alignItems:'center'}}>
            <span style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:m.platform==='kalshi'?`${C.purple}20`:`${C.cyan}20`,color:m.platform==='kalshi'?C.purple:C.cyan}}>{m.platform}</span>
            <span title="Marktpreis (implied probability)">P:{fmt(m.market_price,2)}</span>
            <span title="Handelsvolumen">V:{Number(m.volume||0).toLocaleString()}</span>
            <span title="Opportunity Score — höher = interessanter">S:{fmt(m.opportunity_score,0)}</span>
          </div>
        </div>)}
      </Card>}

      {/* ═══════════ PREDICTIONS ═══════════ */}
      {predictions.length>0&&<Card title={`Predictions (${predictions.length})`} help="Was der Bot denkt: BUY_YES = Markt unterbewertet, BUY_NO = überbewertet, NO_TRADE = kein Signal. Klicke ℹ️ für die Erklärung.">
        {predictions.slice(0,15).map((p,i)=><div key={i} style={{padding:'6px 0',borderBottom:`1px solid ${C.border}11`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,flex:1}}>{p.question}</span>
            <div style={{display:'flex',gap:6,alignItems:'center',fontSize:10,...mono}}>
              <span style={{color:C.muted}}>Mkt:{fmt(p.market_prob,2)}</span>
              <span style={{color:C.muted}}>Bot:{fmt(p.model_prob,2)}</span>
              <span style={{color:Number(p.edge)>0?C.green:C.red}}>Edge:{fmt(p.edge,3)}</span>
              <span style={{color:p.direction==='BUY_YES'?C.green:p.direction==='BUY_NO'?C.red:C.muted,fontWeight:600}}>{p.direction}</span>
            </div>
          </div>
          <div style={{fontSize:10,color:C.dim,marginTop:2}}>💡 {directionExplain(p)}</div>
          {(p.llm_notes||[]).filter(n=>n).map((n,j)=>{const h=helpForError(n);return<div key={j} style={{fontSize:10,color:C.amber,...mono,marginTop:1}}>⚠ {n}{h&&<span style={{color:C.muted,fontStyle:'italic'}}> → {h}</span>}</div>;})}
        </div>)}
      </Card>}

      {/* ═══════════ RISK & OFFENE POSITIONEN ═══════════ */}
      <Card title="Risk Management" help="Die Balken zeigen wie nah du an den Limits bist. Grün = sicher. Gelb = Vorsicht. Rot = Grenze erreicht.">
        <Gauge label="Drawdown (max. Verlust vom Höchststand)" value={Number(state?.risk?.drawdown_pct||0)} max={0.08} warning={0.05} help="Ab 5% wird auf ⅛ Kelly reduziert. Ab 8% stoppt der Bot komplett."/>
        <Gauge label="Exposure (wie viel Geld im Risiko)" value={bankroll>0?openExposure/bankroll:0} max={Number(cfg.max_total_exposure_pct||0.5)} warning={Number(cfg.max_total_exposure_pct||0.5)*0.7} help="Anteil des Bankrolls der gerade in offenen Trades steckt."/>
        <Gauge label="Positionen" value={openTrades.length/Number(cfg.max_concurrent_positions||15)} max={1} warning={0.8} help="Wie viele Trades gleichzeitig offen sind vs. dem Maximum."/>
        {openTrades.length>0&&<>
          <div style={{fontSize:12,fontWeight:600,marginTop:8,marginBottom:6}}>Offene Positionen</div>
          {openTrades.map((t,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.border}11`,fontSize:11,...mono}}>
            <span style={{color:C.text}}>{(t.title||t.market_id||'').slice(0,45)}</span>
            <div style={{display:'flex',gap:8,color:C.muted}}>
              <span title={t.direction==='BUY_YES'?'Bot denkt YES gewinnt':'Bot denkt NO gewinnt'} style={{color:t.direction==='BUY_YES'?C.green:C.red}}>{t.direction}</span>
              <span>${fmt(t.positionUsd,0)}</span>
            </div>
          </div>)}
        </>}
      </Card>

      {/* ═══════════ EINSTELLUNGEN ═══════════ */}
      <Card title="Einstellungen" help="Hier stellst du ein wie der Bot arbeitet. Jede Einstellung hat eine Erklärung und einen empfohlenen Wert (grün = du bist auf dem Empfohlenen, gelb = abweichend).">
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10}}>
          {/* Allgemein */}
          <div style={{background:C.bg,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>💰 Allgemein</div>
            {[
              {key:'bankroll',label:'Bankroll ($)',rec:1000,desc:'Dein Startkapital.',why:'Starte mit $100–500 zum Testen.'},
              {key:'paper_mode',label:'Paper Mode',rec:true,desc:'Wenn AN: nur simulierte Trades, kein echtes Geld.',why:'IMMER zuerst im Paper Mode testen!',type:'bool'},
              {key:'kelly_fraction',label:'Kelly Fraction',rec:0.25,desc:'Wie aggressiv der Bot wettet (0.25 = vorsichtig, 1.0 = sehr aggressiv).',why:'0.25 (Quarter-Kelly) ist der sichere Standard.'},
              {key:'min_edge',label:'Min Edge',rec:0.04,desc:'Minimaler Vorteil um zu handeln. 0.04 = 4%.',why:'Unter 4% lohnt das Risiko selten.'},
              {key:'max_pos_pct',label:'Max Position %',rec:0.05,desc:'Max. Anteil des Bankrolls pro Trade. 0.05 = 5%.',why:'Begrenzt den Verlust pro Einzeltrade.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </div>
          {/* Scanner */}
          <div style={{background:C.bg,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🔍 Scanner</div>
            {[
              {key:'scanner_source',label:'Quelle',rec:'both',desc:'Wo der Bot Märkte sucht.',why:'both = Polymarket + Kalshi.',type:'select',opts:['polymarket','kalshi','both']},
              {key:'scan_interval_minutes',label:'Intervall (Min)',rec:15,desc:'Wie oft automatisch gescannt wird.',why:'15 Min ist ein guter Kompromiss.'},
              {key:'scanner_min_volume',label:'Min Volume',rec:50000,desc:'Nur Märkte mit mindestens so viel Handelsvolumen.',why:'Niedriger = mehr Märkte aber oft illiquide. Zum Testen auf 200 setzen.'},
              {key:'scanner_min_liquidity',label:'Min Liquidität',rec:10000,desc:'Mindest-Orderbuch-Tiefe.',why:'Niedriger = mehr Märkte. Zum Testen auf 200 setzen.'},
              {key:'scanner_max_days',label:'Max Tage',rec:30,desc:'Nur Märkte die in so vielen Tagen ablaufen.',why:'30 Tage ist Standard.'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </div>
          {/* Research */}
          <div style={{background:C.bg,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>📰 Research Quellen</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Woher der Bot Nachrichten holt. RSS und Reddit funktionieren sofort ohne API-Key.</div>
            {[
              {key:'research_source_rss',label:'RSS Feeds aktiv',rec:true,desc:'Reuters, AP und andere Nachrichtenfeeds.',why:'Standard-Quelle, funktioniert sofort.',type:'bool'},
              {key:'research_rss_feeds',label:'RSS Feed URLs',rec:'',desc:'Komma-getrennte URLs der Feeds.',why:'Schon voreingestellt mit Reuters.',type:'text'},
              {key:'research_source_reddit',label:'Reddit aktiv',rec:true,desc:'Durchsucht Reddit-Subreddits.',why:'Kostenlos, gut für Stimmungsanalyse.',type:'bool'},
              {key:'research_source_newsapi',label:'NewsAPI aktiv',rec:false,desc:'Breitere Nachrichtensuche. Braucht API-Key von newsapi.org.',why:'Optional. Kostenloser Tier verfügbar.',type:'bool'},
              {key:'research_source_gdelt',label:'GDELT aktiv',rec:false,desc:'Globale Events-Datenbank.',why:'Kostenlos aber manchmal langsam.',type:'bool'},
            ].map(s=><SettingRow key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
          </div>
          {/* LLM */}
          <div style={{background:C.bg,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🤖 KI-Provider</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Für bessere Vorhersagen. Ohne KI nutzt der Bot einfache Heuristiken. Gemini hat einen kostenlosen Tier!</div>
            {['openai','claude','gemini','ollama_cloud'].map(name=>{const p=state?.providers?.[name]||{};return<div key={name} style={{marginBottom:8,padding:'6px 8px',background:C.card,borderRadius:5,border:`1px solid ${C.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                <span style={{fontSize:12,fontWeight:600,color:p.enabled?C.cyan:C.muted}}>{name}</span>
                <label style={{display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={!!p.enabled} onChange={e=>setProvider(name,'enabled',e.target.checked)}/><span style={{fontSize:10,color:C.muted}}>aktiv</span></label>
              </div>
              {p.enabled&&<>
                <input placeholder="API Key" type="password" value={p.api_key||''} onChange={e=>setProvider(name,'api_key',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
                <input placeholder="Model" value={p.model||''} onChange={e=>setProvider(name,'model',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
                <input placeholder="Base URL" value={p.base_url||''} onChange={e=>setProvider(name,'base_url',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
              </>}
            </div>;})}
          </div>
          {/* Market APIs */}
          <div style={{background:C.bg,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>🏦 Börsen API-Keys</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Nötig um echte Marktdaten zu laden. Ohne diese Keys kann der Scanner nichts finden.</div>
            <div style={{marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:600,color:C.cyan}}>Polymarket</div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Crypto-Börse auf Polygon. Anleitung: docs.polymarket.com</div>
              <input placeholder="Wallet Address" value={state?.providers?.polymarket?.wallet_address||''} onChange={e=>setProvider('polymarket','wallet_address',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
              <input placeholder="EIP-712 Signature" type="password" value={state?.providers?.polymarket?.eip712_signature||''} onChange={e=>setProvider('polymarket','eip712_signature',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:C.purple}}>Kalshi</div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>US-reguliert. Hat Demo-Modus mit Fake-Geld! Anleitung: trading-api.readme.io</div>
              <input placeholder="Key ID" value={state?.providers?.kalshi?.key_id||''} onChange={e=>setProvider('kalshi','key_id',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
              <input placeholder="Key Secret" type="password" value={state?.providers?.kalshi?.key_secret||''} onChange={e=>setProvider('kalshi','key_secret',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
            </div>
            <div style={{marginTop:8}}><Btn onClick={()=>act('connTest',async()=>{const r=await apiFetch('/api/connection/test');const p=await r.json();setConnTest(p);setMsg(p.ok?'✅ Verbindung OK':'❌ Keine Börse erreichbar');return p;})} busy={busy.connTest}>🔌 Verbindung testen</Btn></div>
            {connTest&&<div style={{fontSize:10,color:C.muted,marginTop:6,...mono}}>
              Polymarket: {connTest.polymarket?.reachable?'✅ erreichbar':'❌ nicht erreichbar'} · Kalshi: {connTest.kalshi?.reachable?'✅ erreichbar':'❌ nicht erreichbar'}
            </div>}
          </div>
        </div>
        <div style={{marginTop:10,textAlign:'center'}}><Btn onClick={save} busy={saving} variant="green">💾 Alle Einstellungen speichern</Btn></div>
      </Card>

      {/* ═══════════ LOG ═══════════ */}
      <Card title="Was ist passiert? (Live Log)" help="Zeigt was der Bot gerade tut. Grün = erfolgreich. Rot = Fehler. Bei Fehlern steht eine Erklärung dabei.">
        <div style={{maxHeight:250,overflow:'auto',...mono,fontSize:10}}>
          {liveLog.slice(0,40).map((e,i)=>{
            const isErr=String(e.event||'').includes('error');
            const isOk=String(e.event||'').includes('ok')||String(e.event||'').includes('completed');
            const help=isErr?helpForError(e.message||e.event||''):null;
            return<div key={i} style={{padding:'2px 0',color:isErr?C.red:isOk?C.green:C.muted}}>
              <span style={{color:C.dim}}>{(e.t||'').slice(11,19)}</span> {e.event} {e.source?`[${e.source}]`:''} {e.message||e.label||''}
              {help&&<div style={{color:C.amber,fontSize:9,marginLeft:52,fontStyle:'italic'}}>→ {help}</div>}
            </div>;})}
          {!liveLog.length&&<div style={{color:C.dim,padding:8}}>Noch keine Events. Starte einen Scan oder die Pipeline oben.</div>}
        </div>
      </Card>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}*{box-sizing:border-box}::-webkit-scrollbar{height:4px;width:4px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.dim};border-radius:2px}code{background:${C.dim};padding:1px 4px;border-radius:3px;font-size:11px}`}</style>
    </div>);
}

function SettingRow({item,value,onChange}) {
  const isRec=String(value)===String(item.rec);
  return<div style={{marginBottom:6}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <span style={{fontSize:11,fontWeight:500,color:C.text}}>{item.label}</span>
      {item.rec!==undefined&&item.rec!==''&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,...mono,background:isRec?'rgba(34,197,94,0.1)':'rgba(245,158,11,0.1)',color:isRec?C.green:C.amber}}>Empf: {String(item.rec)}</span>}
    </div>
    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{item.desc} {item.why&&<span style={{fontStyle:'italic'}}>— {item.why}</span>}</div>
    {item.type==='select'?<select value={value||item.rec} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono}}>{(item.opts||[]).map(o=><option key={o} value={o}>{o}</option>)}</select>
    :item.type==='bool'?<label style={{display:'flex',alignItems:'center',gap:5}}><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}/><span style={{fontSize:11,color:value?C.green:C.muted}}>{value?'AN':'AUS'}</span></label>
    :item.type==='text'?<input value={value||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
    :item.type==='password'?<input type="password" value={value||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
    :<input type="number" step="any" value={value??''} onChange={e=>onChange(Number(e.target.value))} style={{width:'100%',padding:'4px 6px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>}
  </div>;
}
