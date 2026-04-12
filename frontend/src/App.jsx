import { useEffect, useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const C = { bg:'#0a0e17',card:'#111827',border:'#1e293b',green:'#22c55e',red:'#ef4444',amber:'#f59e0b',blue:'#3b82f6',purple:'#8b5cf6',cyan:'#06b6d4',text:'#e2e8f0',muted:'#64748b',dim:'#334155' };
const fmt = (v,d=2) => { const n=Number(v); return Number.isNaN(n)?'-':n.toFixed(d); };
const mono = { fontFamily:'JetBrains Mono,monospace' };

// ==================== SETTING GUIDES ====================
const GENERAL_SETTINGS = [
  { key:'bankroll', label:'Bankroll ($)', rec:1000, desc:'Dein Gesamtkapital für den Bot.', why:'Bestimmt die Positionsgrößen. Starte mit $100–500 zum Testen.' },
  { key:'top_n', label:'Top N Märkte', rec:10, desc:'Wie viele Märkte pro Scan in die Pipeline gehen.', why:'10 ist ein guter Kompromiss zwischen Diversität und Übersichtlichkeit.' },
  { key:'kelly_fraction', label:'Kelly Fraction', rec:0.25, desc:'Bruchteil der Kelly-Formel für Position Sizing.', why:'0.25 = Quarter-Kelly. Sicherer als Full Kelly (1.0), das extrem volatil ist.' },
  { key:'min_edge', label:'Min Edge', rec:0.04, desc:'Minimaler Vorteil (Model vs. Markt) um zu handeln.', why:'4% Edge filtert schwache Signale raus. Unter 3% lohnt sich das Risiko selten.' },
  { key:'max_pos_pct', label:'Max Position %', rec:0.05, desc:'Maximaler Anteil des Bankrolls pro Trade.', why:'5% begrenzt den Verlust pro Einzeltrade auf ein erträgliches Maß.' },
  { key:'max_total_exposure_pct', label:'Max Exposure %', rec:0.5, desc:'Maximales Gesamtrisiko aller offenen Positionen.', why:'50% heißt: nie mehr als die Hälfte des Bankrolls gleichzeitig im Risiko.' },
  { key:'max_concurrent_positions', label:'Max Positionen', rec:15, desc:'Maximale Anzahl gleichzeitig offener Trades.', why:'Begrenzt Komplexität. Mehr als 15 ist schwer zu überblicken.' },
  { key:'max_drawdown_pct', label:'Max Drawdown', rec:0.08, desc:'Bei diesem Verlust vom Höchststand stoppt der Bot komplett.', why:'8% ist der Hard-Stop. Ab 5% wird automatisch auf ⅛ Kelly reduziert.' },
  { key:'daily_loss_limit_pct', label:'Daily Loss Limit', rec:0.15, desc:'Maximaler Tagesverlust bevor der Bot pausiert.', why:'15% verhindert Katastrophen-Tage. Der Bot handelt erst am nächsten Tag wieder.' },
];

const SCANNER_SETTINGS = [
  { key:'scanner_source', label:'Quelle', rec:'both', desc:'Welche Börsen gescannt werden.', why:'Beide Quellen maximieren die Marktabdeckung.', type:'select', opts:['polymarket','kalshi','both'] },
  { key:'scan_interval_minutes', label:'Scan Interval (min)', rec:15, desc:'Wie oft automatisch gescannt wird.', why:'15 Min balanciert Aktualität mit API-Kosten.' },
  { key:'scanner_min_volume', label:'Min Volume', rec:50000, desc:'Mindest-Handelsvolumen.', why:'Zu niedrig = illiquide Märkte wo man nicht rein/rauskommt. Produktionswert: 50k.' },
  { key:'scanner_min_liquidity', label:'Min Liquidität', rec:10000, desc:'Mindest-Orderbuch-Tiefe.', why:'Stellt sicher dass genug Gegenpartei da ist. Produktionswert: 10k.' },
  { key:'scanner_max_days', label:'Max Tage bis Ablauf', rec:30, desc:'Nur Märkte die innerhalb dieser Tage auslaufen.', why:'Kürzere Laufzeiten = klarere Signale. 30 Tage ist Standard.' },
  { key:'scanner_min_anomaly_score', label:'Min Anomalie Score', rec:1.2, desc:'Mindestpunktzahl für auffällige Märkte.', why:'Höher = nur starke Anomalien. Niedriger = mehr Signale, mehr Rauschen.' },
  { key:'scanner_max_slippage_pct', label:'Max Slippage', rec:0.02, desc:'Maximale geschätzte Slippage.', why:'2% schützt vor zu teuren Ausführungen in dünnen Märkten.' },
  { key:'scanner_http_retries', label:'HTTP Retries', rec:2, desc:'Wiederholungsversuche bei API-Fehlern.', why:'2 fängt kurze Netzwerkprobleme ab.' },
  { key:'scanner_http_timeout_ms', label:'HTTP Timeout (ms)', rec:8000, desc:'Maximale Wartezeit pro API-Request.', why:'8s verhindert Hänger bei langsamen Endpunkten.' },
  { key:'scanner_breaker_threshold', label:'Breaker Schwelle', rec:3, desc:'Nach so vielen Fehlern pausiert der Scanner.', why:'Schützt gegen Endlosschleifen bei API-Ausfällen.' },
  { key:'scanner_breaker_cooldown_sec', label:'Breaker Cooldown (s)', rec:300, desc:'Wartezeit nach Breaker-Auslösung.', why:'5 Min geben APIs Zeit zur Erholung.' },
];

const RESEARCH_SETTINGS = [
  { key:'research_source_rss', label:'RSS Feeds', rec:true, desc:'Reuters, AP und eigene RSS Feeds als Quellen nutzen.', why:'RSS ist die zuverlässigste und schnellste Nachrichtenquelle.', type:'bool' },
  { key:'research_rss_feeds', label:'RSS Feed URLs', rec:'reuters,ap', desc:'Komma-getrennte Liste von RSS Feed URLs.', why:'Mehr Feeds = breitere Abdeckung. Qualitätsquellen bevorzugen.', type:'text' },
  { key:'research_source_reddit', label:'Reddit', rec:true, desc:'Reddit-Subreddits als Sentiment-Quelle.', why:'Reddit fängt Community-Stimmung ein.', type:'bool' },
  { key:'research_reddit_subreddits', label:'Subreddits', rec:'politics,worldnews,PredictionMarkets', desc:'Welche Subreddits durchsucht werden.', why:'Relevante Subreddits für Prediction Markets.', type:'text' },
  { key:'research_source_newsapi', label:'NewsAPI', rec:false, desc:'NewsAPI für breitere Nachrichtensuche (API Key nötig).', why:'Kostenpflichtig aber sehr breite Abdeckung.', type:'bool' },
  { key:'research_newsapi_key', label:'NewsAPI Key', rec:'', desc:'API-Schlüssel von newsapi.org.', why:'Nur nötig wenn NewsAPI aktiviert ist.', type:'password' },
  { key:'research_source_gdelt', label:'GDELT', rec:false, desc:'GDELT Global Event Database.', why:'Kostenlos, aber manchmal langsam. Gut für globale Events.', type:'bool' },
  { key:'research_source_x', label:'X/Twitter RSS', rec:false, desc:'Twitter via RSS-Bridge Feeds.', why:'Schnelle Sentiment-Daten. Braucht RSS-Bridge URLs.', type:'bool' },
  { key:'research_max_headlines', label:'Max Headlines', rec:80, desc:'Maximale Anzahl gesammelter Headlines pro Research-Lauf.', why:'80 ist genug für gute Coverage ohne API-Limits zu sprengen.' },
  { key:'research_min_keyword_overlap', label:'Min Keyword Overlap', rec:2, desc:'Mindest-Keyword-Übereinstimmung zwischen Headline und Markt.', why:'2 filtert Fehlzuordnungen. 1 = zu viele false positives.' },
  { key:'research_min_credibility', label:'Min Credibility', rec:0.4, desc:'Mindest-Glaubwürdigkeit der Quelle (0-1).', why:'0.4 lässt die meisten Quellen durch. Höher = nur Premium-Quellen.' },
];

const LLM_SETTINGS = [
  { key:'llm_enabled', label:'LLM Ensemble aktiv', rec:true, desc:'Nutzt LLM Provider für Probability-Schätzungen.', why:'Mit LLMs deutlich bessere Vorhersagen. Ohne fällt der Bot auf Heuristiken zurück.', type:'bool' },
  { key:'llm_timeout_ms', label:'LLM Timeout (ms)', rec:12000, desc:'Maximale Wartezeit pro LLM-Request.', why:'12s ist genug für die meisten Provider. Zu kurz = Abbrüche.' },
  { key:'llm_temperature', label:'Temperature', rec:0.1, desc:'Kreativität der LLM-Antworten (0=deterministisch, 1=kreativ).', why:'0.1 für konsistente, reproduzierbare Wahrscheinlichkeitsschätzungen.' },
  { key:'llm_max_tokens', label:'Max Tokens', rec:220, desc:'Maximale Antwortlänge.', why:'220 reicht für JSON mit probability + confidence + rationale.' },
  { key:'llm_require_provider', label:'LLM zwingend', rec:false, desc:'Fehler wenn kein LLM antwortet (statt Heuristik-Fallback).', why:'Auf false lassen — der Heuristik-Fallback ist besser als gar kein Signal.', type:'bool' },
];

const ERROR_EXPLANATIONS = {
  'aborted': 'Der Request wurde abgebrochen — meist weil der LLM-Provider zu langsam war. Erhöhe llm_timeout_ms oder prüfe die Verbindung.',
  'http 401': 'API-Key ungültig oder abgelaufen. Prüfe den Key in den Einstellungen.',
  'http 403': 'Zugriff verweigert. Der API-Key hat möglicherweise nicht die nötigen Rechte.',
  'http 429': 'Rate Limit erreicht — zu viele Anfragen. Warte ein paar Minuten oder reduziere die Scan-Frequenz.',
  'http 500': 'Server-Fehler beim Provider. Liegt nicht an dir — versuche es später nochmal.',
  'http 502': 'Gateway-Fehler. Der Provider hat temporäre Probleme.',
  'http 503': 'Provider überlastet. Versuche es in ein paar Minuten nochmal.',
  'ECONNREFUSED': 'Verbindung verweigert. Ist die base_url korrekt? Für lokales Ollama muss der Server laufen.',
  'ETIMEDOUT': 'Verbindungs-Timeout. Netzwerk prüfen oder Timeout erhöhen.',
  'fetch failed': 'Netzwerk-Problem. Prüfe die Internetverbindung des Servers.',
  'no_llm_provider_available': 'Kein LLM-Provider konfiguriert oder aktiviert. Gehe zu Einstellungen → LLM Providers.',
  'llm_disabled': 'LLM ist in den Einstellungen deaktiviert. Heuristik-Fallback wird verwendet.',
};

function explainError(msg) {
  const s = String(msg||'').toLowerCase();
  for (const [key,exp] of Object.entries(ERROR_EXPLANATIONS)) {
    if (s.includes(key.toLowerCase())) return exp;
  }
  return null;
}

function explainDirection(p) {
  if (!p) return '';
  const edge = Number(p.edge||0);
  const conf = Number(p.confidence||0);
  const mkt = Number(p.market_prob||0);
  const mdl = Number(p.model_prob||0);
  if (p.direction === 'BUY_YES') return `Model sagt ${(mdl*100).toFixed(0)}% (Markt: ${(mkt*100).toFixed(0)}%). Edge +${(edge*100).toFixed(1)}% bei ${(conf*100).toFixed(0)}% Confidence → Markt unterbewertet, YES kaufen.`;
  if (p.direction === 'BUY_NO') return `Model sagt ${(mdl*100).toFixed(0)}% (Markt: ${(mkt*100).toFixed(0)}%). Edge ${(edge*100).toFixed(1)}% bei ${(conf*100).toFixed(0)}% Confidence → Markt überbewertet, NO kaufen.`;
  if (Math.abs(edge) < Number(p.min_edge||0.04)) return `Edge ${(edge*100).toFixed(1)}% ist zu klein (Min: 4%). Kein Trade.`;
  return `Confidence ${(conf*100).toFixed(0)}% zu niedrig oder Edge zu klein für ein Signal.`;
}

// ==================== COMPONENTS ====================
function Metric({label,value,unit='',target,good}) {
  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'11px 13px',flex:'1 1 125px',minWidth:125}}>
    <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:1,...mono}}>{label}</div>
    <div style={{fontSize:20,fontWeight:700,color:(good!==undefined?good:true)?C.green:C.red,marginTop:3,...mono}}>{value}{unit}</div>
    {target&&<div style={{fontSize:9,color:C.dim,marginTop:1,...mono}}>target: {target}</div>}
  </div>;
}

function Gauge({label,value,max,warning}) {
  const p=Math.min((value/max)*100,100); const d=value>=max*0.95; const w=value>=warning;
  const color=d?C.red:w?C.amber:C.green;
  return <div style={{marginBottom:9}}>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted,marginBottom:3,...mono}}><span>{label}</span><span style={{color}}>{fmt(value*100,1)}% / {fmt(max*100,0)}%</span></div>
    <div style={{height:5,background:C.dim,borderRadius:3,overflow:'hidden',position:'relative'}}>
      <div style={{position:'absolute',left:`${(warning/max)*100}%`,top:0,bottom:0,width:2,background:C.amber,opacity:0.5,zIndex:2}}/>
      <div style={{height:'100%',width:`${p}%`,background:color,borderRadius:3,transition:'width 0.4s'}}/>
    </div>
  </div>;
}

function Pill({ok,label}) { return <span style={{fontSize:10,padding:'3px 9px',borderRadius:14,background:ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',color:ok?C.green:C.red,...mono,border:`1px solid ${ok?C.green:C.red}22`}}>{label}</span>; }
function Btn({children,onClick,disabled,variant,busy}) {
  const a=variant==='danger'?C.red:variant==='warn'?C.amber:C.cyan;
  return <button onClick={onClick} disabled={disabled||busy} style={{padding:'6px 14px',fontSize:11,...mono,background:disabled?C.dim:`${a}18`,color:disabled?C.muted:a,border:`1px solid ${disabled?C.dim:a}44`,borderRadius:5,cursor:disabled?'not-allowed':'pointer',opacity:busy?0.6:1}}>{busy?'...':children}</button>;
}
function ChartTip({active,payload,label}) {
  if(!active||!payload?.length)return null;
  return <div style={{background:C.card,border:`1px solid ${C.border}`,padding:'5px 9px',borderRadius:5,fontSize:10,...mono}}>
    <div style={{color:C.muted}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color||C.text}}>{p.name}: {typeof p.value==='number'?p.value.toFixed(2):p.value}</div>)}
  </div>;
}

function SettingField({item,value,onChange}) {
  const isRec = String(value)===String(item.rec);
  return <div style={{marginBottom:10,padding:'8px 10px',background:C.bg,borderRadius:6,border:`1px solid ${C.border}`}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
      <span style={{fontSize:12,fontWeight:600,color:C.text}}>{item.label}</span>
      <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,...mono,background:isRec?'rgba(34,197,94,0.1)':'rgba(245,158,11,0.1)',color:isRec?C.green:C.amber}}>Empf: {String(item.rec)}</span>
    </div>
    <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{item.desc}</div>
    <div style={{fontSize:10,color:C.dim,marginBottom:6,fontStyle:'italic'}}>{item.why}</div>
    {item.type==='select'?<select value={value||item.rec} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'5px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,...mono}}>{(item.opts||[]).map(o=><option key={o} value={o}>{o}</option>)}</select>
    :item.type==='bool'?<label style={{display:'flex',alignItems:'center',gap:6}}><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}/><span style={{fontSize:11,color:C.text}}>{value?'Aktiv':'Inaktiv'}</span></label>
    :item.type==='password'?<input type="password" value={value||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'5px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,...mono,boxSizing:'border-box'}}/>
    :item.type==='text'?<input value={value||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'5px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,...mono,boxSizing:'border-box'}}/>
    :<input type="number" step="any" value={value??''} onChange={e=>onChange(Number(e.target.value))} style={{width:'100%',padding:'5px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,...mono,boxSizing:'border-box'}}/>}
  </div>;
}

function Card({title,children}) { return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'12px 14px',marginBottom:12}}>{title&&<div style={{fontSize:13,fontWeight:600,marginBottom:10}}>{title}</div>}{children}</div>; }

// ==================== MAIN ====================
const TABS=['overview','scan','research','predict','risk','settings','ops'];
const TL={overview:'Overview',scan:'Scan',research:'Research',predict:'Predict',risk:'Risk & Trades',settings:'Einstellungen',ops:'Ops & Logs'};

export default function App() {
  const [tab,setTab]=useState('overview');
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
  const [tooltip,setTooltip]=useState(null);

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
  useEffect(()=>{if(!uiAuthed||tab!=='ops')return;const t=setInterval(async()=>{const d=await apiJson('/api/scan/live-log',{items:[]});setLiveLog(d?.items||[]);},4000);return()=>clearInterval(t);},[tab,uiAuthed,apiJson]);

  async function act(key,fn,okMsg){setBusy(p=>({...p,[key]:true}));try{await fn();if(okMsg)setMsg(okMsg);await reload();}catch(e){setMsg(`Fehler: ${e.message}`);}finally{setBusy(p=>({...p,[key]:false}));}}
  async function save(){setSaving(true);try{await apiFetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:state.config,providers:state.providers})});setMsg('Gespeichert');await reload();}catch(e){setMsg(e.message);}finally{setSaving(false);}}
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
  const pipelineRuns=state?.pipeline_runs||[];
  const signals=state?.signals||[];

  const equityData=useMemo(()=>{if(!closedTrades.length)return[{i:0,v:bankroll}];let cum=0;return[{i:0,v:bankroll},...closedTrades.map((t,i)=>{cum+=Number(t.netPnlUsd||0);return{i:i+1,v:Math.round(bankroll+cum)};})];},[closedTrades,bankroll]);
  const pnlData=useMemo(()=>closedTrades.slice(-30).map((t,i)=>({i,pnl:Number(t.netPnlUsd||0),name:(t.title||'').slice(0,18)})),[closedTrades]);

  const step1Issues=useMemo(()=>{
    const checks=steps?.step1?.checks||[];
    const failed=checks.filter(c=>!c.ok);
    const tips=[];
    if(failed.some(c=>c.key==='scan_freshness'||c.key==='recent_scan_fresh'))tips.push('Scan ist veraltet — starte einen neuen Scan.');
    if(failed.some(c=>c.key==='tradeable_target'||c.key==='tradeable_target_reached'))tips.push('Zu wenige tradeable Märkte. Versuche: scanner_min_volume senken (z.B. 10000), scanner_min_liquidity senken, oder scanner_min_anomaly_score reduzieren.');
    if(failed.some(c=>c.key==='auth_configured_any'))tips.push('Kein API-Key konfiguriert. Gehe zu Einstellungen → Market APIs.');
    if(failed.some(c=>c.key==='breaker_closed'))tips.push('Circuit Breaker ist offen — der Scanner hatte zu viele Fehler. Warte auf Cooldown oder prüfe die API-Verbindung.');
    return{pct:Number(steps?.step1?.progress_pct||0),failed,tips};
  },[steps]);

  const tabS=(t)=>({padding:'6px 13px',fontSize:10,...mono,textTransform:'uppercase',letterSpacing:0.7,background:tab===t?C.blue:'transparent',color:tab===t?'#fff':C.muted,border:'none',borderRadius:4,cursor:'pointer'});

  // ==================== LOGIN ====================
  if(!uiAuthed)return(
    <div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'IBM Plex Sans,sans-serif'}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:32,width:340,textAlign:'center'}}>
        <div style={{fontSize:28,marginBottom:8}}><span style={{color:C.cyan}}>&#9670;</span></div>
        <h2 style={{color:C.text,fontSize:18,fontWeight:600,margin:'0 0 4px'}}>Prediction Market Bot</h2>
        <p style={{color:C.muted,fontSize:13,marginBottom:20}}>Dashboard Login</p>
        <input type="password" value={pwInput} onChange={e=>setPwInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doLogin()} placeholder="Passwort" style={{width:'100%',padding:'10px 12px',borderRadius:6,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,marginBottom:12,...mono,boxSizing:'border-box'}}/>
        <button onClick={doLogin} style={{width:'100%',padding:'10px',borderRadius:6,border:'none',background:C.cyan,color:'#000',fontWeight:600,fontSize:14,cursor:'pointer'}}>Login</button>
        {msg&&<p style={{color:C.red,fontSize:12,marginTop:10}}>{msg}</p>}
      </div>
    </div>);

  if(!state)return<div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.muted}}>Lade...</div>;

  // ==================== MAIN RENDER ====================
  return(
    <div style={{background:C.bg,color:C.text,minHeight:'100vh',fontFamily:'IBM Plex Sans,-apple-system,sans-serif',padding:'18px 14px'}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>

      {/* HEADER */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <div>
          <h1 style={{margin:0,fontSize:19,fontWeight:700,letterSpacing:-0.5}}><span style={{color:C.cyan}}>&#9670;</span> Prediction Market Bot</h1>
          <div style={{fontSize:11,color:C.muted,marginTop:2,...mono}}>{markets.length} märkte &middot; {openTrades.length} offen &middot; ${fmt(bankroll+totalPnl,0)} bankroll</div>
        </div>
        <div style={{display:'flex',gap:5,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',background:cfg.kill_switch?'rgba(239,68,68,0.1)':health?.status==='ok'?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',border:`1px solid ${cfg.kill_switch?C.red:health?.status==='ok'?C.green:C.red}33`,borderRadius:14,fontSize:10,...mono,color:cfg.kill_switch?C.red:health?.status==='ok'?C.green:C.red}}>
            <span style={{width:5,height:5,borderRadius:'50%',background:'currentColor',animation:'pulse 2s infinite'}}/>{cfg.kill_switch?'KILL SWITCH':cfg.paper_mode?'PAPER':'LIVE'}
          </div>
          <Btn onClick={()=>reload()}>Refresh</Btn><Btn onClick={save} busy={saving}>Save</Btn>
        </div>
      </div>

      {msg&&<div style={{fontSize:11,color:C.cyan,marginBottom:10,...mono,padding:'5px 9px',background:`${C.cyan}0a`,borderRadius:5,border:`1px solid ${C.cyan}22`}}>{msg}<button onClick={()=>setMsg('')} style={{float:'right',background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:10}}>&#10005;</button></div>}

      {/* PILLS */}
      <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:12}}>
        <Pill ok={health?.status==='ok'} label={`Backend: ${health?.status||'?'}`}/>
        <Pill ok={auth?.polymarket?.configured} label={`Polymarket: ${auth?.polymarket?.configured?'ok':'fehlt'}`}/>
        <Pill ok={auth?.kalshi?.configured} label={`Kalshi: ${auth?.kalshi?.configured?'ok':'fehlt'}`}/>
        {['openai','claude','gemini','ollama_cloud'].filter(n=>auth?.[n]?.configured).map(n=><Pill key={n} ok label={`${n}: ok`}/>)}
      </div>

      {/* CORRELATION WARNINGS */}
      {(correlations?.conflicts||[]).length>0&&<div style={{background:'rgba(239,68,68,0.08)',border:`1px solid ${C.red}33`,borderRadius:8,padding:'10px 12px',marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:600,color:C.red,marginBottom:6}}>&#9888; Korrelierte Märkte erkannt</div>
        {correlations.conflicts.map((c,i)=><div key={i} style={{fontSize:11,color:C.text,marginBottom:4}}>
          <div>{c.message}</div>
          <div style={{color:C.muted,fontSize:10}}>Empfehlung: Nur handeln → {c.recommendation}</div>
        </div>)}
      </div>}

      {/* ACTION BAR */}
      <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:12}}>
        <Btn onClick={()=>act('scan',async()=>{const r=await apiFetch('/api/scan/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`Scan: ${p.tradeable_count} tradeable`);})} busy={busy.scan}>Scan</Btn>
        <Btn onClick={()=>act('research',async()=>{const r=await apiFetch('/api/research/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);})} busy={busy.research}>Research</Btn>
        <Btn onClick={()=>act('predict',async()=>{const r=await apiFetch('/api/predict/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);})} busy={busy.predict}>Predict</Btn>
        <Btn onClick={()=>act('execute',async()=>{const r=await apiFetch('/api/execute/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);})} busy={busy.execute}>Execute</Btn>
        <Btn onClick={()=>act('risk',async()=>{const r=await apiFetch('/api/risk/run',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);})} busy={busy.risk}>Risk</Btn>
        <Btn onClick={()=>act('pipeline',async()=>{const r=await apiFetch('/api/pipeline/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg('Pipeline fertig');})} busy={busy.pipeline}>Full Pipeline</Btn>
        <Btn variant={cfg.kill_switch?'danger':'warn'} onClick={()=>act('kill',async()=>{await apiFetch('/api/kill-switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!cfg.kill_switch})});})}>{cfg.kill_switch?'Kill OFF':'Kill Switch'}</Btn>
        <Btn onClick={()=>act('finalize',async()=>{const r=await apiFetch('/api/step1/finalize',{method:'POST'});const p=await r.json();if(!p.ok)throw new Error(p.message);setMsg(`Step 1 finalisiert: ${p.step1_progress_pct||0}%`);})} busy={busy.finalize}>Step 1 finalisieren</Btn>
      </div>

      {/* STEP PROGRESS */}
      <Card>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          {[1,2,3,4,5].map(n=>{const v=Number(steps?.[`step${n}`]?.progress_pct||0);const labels=['Scan','Research','Predict','Execute','Risk'];
            return<div key={n} style={{flex:'1 1 90px',minWidth:90}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted,marginBottom:2,...mono}}><span>S{n} {labels[n-1]}</span><span>{fmt(v,0)}%</span></div>
              <div style={{height:4,background:C.dim,borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${v}%`,background:v>=100?C.green:v>0?C.amber:C.dim,borderRadius:2,transition:'width 0.4s'}}/></div>
            </div>;})}
        </div>
        {step1Issues.tips.length>0&&<div style={{marginTop:8,padding:'6px 8px',background:'rgba(245,158,11,0.06)',borderRadius:5,border:`1px solid ${C.amber}22`}}>
          <div style={{fontSize:10,fontWeight:600,color:C.amber,marginBottom:3,...mono}}>Step 1 erreicht nur {step1Issues.pct}%</div>
          {step1Issues.tips.map((t,i)=><div key={i} style={{fontSize:11,color:C.muted,marginBottom:2}}>&#8226; {t}</div>)}
        </div>}
      </Card>

      {/* TABS */}
      <div style={{display:'flex',gap:2,marginBottom:14,background:C.card,padding:3,borderRadius:6,width:'fit-content',flexWrap:'wrap'}}>
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={tabS(t)}>{TL[t]}</button>)}
      </div>

      {/* ==================== OVERVIEW ==================== */}
      {tab==='overview'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Bankroll" value={`$${fmt(bankroll+totalPnl,0)}`} good={totalPnl>=0}/>
          <Metric label="P&L" value={`${totalPnl>=0?'+':''}$${fmt(totalPnl,0)}`} good={totalPnl>=0}/>
          <Metric label="Trades" value={`${closedTrades.length} / ${openTrades.length} offen`}/>
          <Metric label="Exposure" value={`$${fmt(openExposure,0)}`} good={bankroll>0?openExposure/bankroll<0.5:true}/>
          <Metric label="Brier" value={fmt(calibration?.brier_score,4)} target="< 0.25" good={Number(calibration?.brier_score??1)<0.25}/>
        </div>
        {equityData.length>1&&<Card title="Equity curve"><ResponsiveContainer width="100%" height={180}>
          <AreaChart data={equityData}><defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.cyan} stopOpacity={0.3}/><stop offset="100%" stopColor={C.cyan} stopOpacity={0}/></linearGradient></defs>
          <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
          <Tooltip content={<ChartTip/>}/><Area type="monotone" dataKey="v" stroke={C.cyan} fill="url(#eq)" strokeWidth={2} name="equity"/></AreaChart></ResponsiveContainer></Card>}
        {pnlData.length>0&&<Card title="Trade P&L"><ResponsiveContainer width="100%" height={140}>
          <BarChart data={pnlData}><XAxis dataKey="name" tick={{fontSize:8,fill:C.muted}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
          <Tooltip content={<ChartTip/>}/><Bar dataKey="pnl" name="pnl" radius={[3,3,0,0]}>{pnlData.map((e,i)=><Cell key={i} fill={e.pnl>=0?C.green:C.red}/>)}</Bar></BarChart></ResponsiveContainer></Card>}
        {/* Trade History */}
        {closedTrades.length>0&&<Card title={`Trade History (${closedTrades.length})`}>
          {closedTrades.slice(0,20).map((t,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${C.border}11`,fontSize:11,...mono}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:Number(t.netPnlUsd||0)>=0?C.green:C.red}}/>
              <span style={{color:C.text}}>{(t.title||t.market_id||'').slice(0,40)}</span>
            </div>
            <div style={{display:'flex',gap:10,color:C.muted}}>
              <span style={{color:t.direction==='BUY_YES'?C.green:C.red}}>{t.direction}</span>
              <span style={{color:Number(t.netPnlUsd||0)>=0?C.green:C.red,fontWeight:600}}>{Number(t.netPnlUsd||0)>=0?'+':''}${fmt(t.netPnlUsd,0)}</span>
            </div>
          </div>)}
        </Card>}
      </div>}

      {/* ==================== SCAN ==================== */}
      {tab==='scan'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Gesamt" value={state?.scanner_health?.total||0}/><Metric label="Tradeable" value={markets.length}/>
          <Metric label="Scan ms" value={`${fmt(scanStatus?.runtime?.lastDurationMs||0,0)}`}/><Metric label="PM" value={scanStatus?.runtime?.lastCoverage?.polymarket||0}/><Metric label="Kalshi" value={scanStatus?.runtime?.lastCoverage?.kalshi||0}/>
        </div>
        <Card title="Top tradeable markets">
          {markets.slice(0,15).map((m,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:i<14?`1px solid ${C.border}11`:'none'}}>
            <div style={{flex:1,fontSize:12}}>{m.question||m.market}</div>
            <div style={{display:'flex',gap:8,fontSize:10,color:C.muted,...mono,alignItems:'center'}}>
              <span style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:m.platform==='kalshi'?`${C.purple}20`:`${C.cyan}20`,color:m.platform==='kalshi'?C.purple:C.cyan}}>{m.platform}</span>
              <span>P:{fmt(m.market_price,2)}</span><span>V:{Number(m.volume||0).toLocaleString()}</span><span>S:{fmt(m.opportunity_score,0)}</span>
              {(m.anomaly_flags||[]).length>0&&<span title={(m.anomaly_flags||[]).join(', ')} style={{color:C.amber,cursor:'help'}}>&#9888;</span>}
            </div>
          </div>)}
          {!markets.length&&<div style={{color:C.muted,fontSize:12,padding:8}}>Noch keine Ergebnisse. Klicke "Scan".</div>}
        </Card>
      </div>}

      {/* ==================== RESEARCH ==================== */}
      {tab==='research'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Briefs" value={briefs.length}/><Metric label="Coverage" value={`${fmt(researchStatus?.summary?.coverage_pct||0,0)}%`} good={Number(researchStatus?.summary?.coverage_pct||0)>50}/>
          <Metric label="Confidence" value={fmt(researchStatus?.summary?.avg_confidence||0,3)}/><Metric label="Sources" value={researchStatus?.summary?.source_diversity||0}/>
        </div>
        <Card title="Research Briefs">
          {briefs.map((b,i)=><div key={i} style={{padding:'7px 0',borderBottom:`1px solid ${C.border}11`}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:12}}>{b.question}</span>
              <span style={{fontSize:10,...mono,color:b.sentiment==='bullish'?C.green:b.sentiment==='bearish'?C.red:C.muted}}>{b.sentiment}</span></div>
            <div style={{fontSize:10,color:C.muted,marginTop:2,...mono}}>conf: {fmt(b.confidence,3)} · gap: {fmt(b.consensus_vs_market_gap,3)} · stance: {b.stance} · sources: {(b.sources||[]).length}</div>
            {b.thesis&&<div style={{fontSize:11,color:C.dim,marginTop:2,fontStyle:'italic'}}>{b.thesis}</div>}
          </div>)}
          {!briefs.length&&<div style={{color:C.muted,fontSize:12}}>Keine Briefs. Scan → Research starten.</div>}
        </Card>
      </div>}

      {/* ==================== PREDICT ==================== */}
      {tab==='predict'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Predictions" value={predictions.length}/><Metric label="Avg Edge" value={fmt(predictStatus?.summary?.avg_edge||0,4)}/>
          <Metric label="Actionable" value={`${fmt(predictStatus?.summary?.actionable_pct||0,0)}%`}/><Metric label="Brier" value={fmt(calibration?.brier_score,4)} target="< 0.25" good={Number(calibration?.brier_score??1)<0.25}/>
        </div>
        <Card title="Predictions">
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11,...mono}}>
            <thead><tr style={{color:C.muted,textAlign:'left'}}>{['Market','Mkt','Model','Edge','EV','Conf','Signal',''].map(h=><th key={h} style={{padding:'5px 6px',borderBottom:`1px solid ${C.border}`,fontWeight:500}}>{h}</th>)}</tr></thead>
            <tbody>{predictions.slice(0,20).map((p,i)=><tr key={i} style={{borderBottom:`1px solid ${C.border}11`}}>
              <td style={{padding:'5px 6px',color:C.text,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.question}</td>
              <td style={{padding:'5px 6px'}}>{fmt(p.market_prob,2)}</td><td style={{padding:'5px 6px'}}>{fmt(p.model_prob,2)}</td>
              <td style={{padding:'5px 6px',color:Number(p.edge)>0?C.green:C.red}}>{fmt(p.edge,3)}</td>
              <td style={{padding:'5px 6px'}}>{fmt(p.expected_value,3)}</td><td style={{padding:'5px 6px'}}>{fmt(p.confidence,2)}</td>
              <td style={{padding:'5px 6px',color:p.direction==='BUY_YES'?C.green:p.direction==='BUY_NO'?C.red:C.muted,fontWeight:600}}>{p.direction}</td>
              <td style={{padding:'5px 6px'}}><span title={explainDirection(p)} style={{cursor:'help',color:C.blue,fontSize:10}}>&#9432;</span></td>
            </tr>)}</tbody></table></div>
          {!predictions.length&&<div style={{color:C.muted,fontSize:12}}>Keine Predictions. Pipeline starten.</div>}
        </Card>
        {(predictions.some(p=>p.llm_notes?.length>0))&&<Card title="LLM Status">
          {predictions.filter(p=>(p.llm_notes||[]).length>0).slice(0,5).map((p,i)=><div key={i} style={{fontSize:11,marginBottom:6}}>
            <div style={{color:C.text}}>{(p.question||'').slice(0,50)}</div>
            {(p.llm_notes||[]).map((n,j)=><div key={j} style={{color:C.amber,fontSize:10,...mono}}>
              {n}{explainError(n)&&<span style={{color:C.muted,fontStyle:'italic'}}> → {explainError(n)}</span>}
            </div>)}
          </div>)}
        </Card>}
      </div>}

      {/* ==================== RISK & TRADES ==================== */}
      {tab==='risk'&&<div>
        <Card title="Risk Gauges">
          <Gauge label="Drawdown" value={Number(state?.risk?.drawdown_pct||0)} max={0.08} warning={0.05}/>
          <Gauge label="Exposure" value={bankroll>0?openExposure/bankroll:0} max={Number(cfg.max_total_exposure_pct||0.5)} warning={Number(cfg.max_total_exposure_pct||0.5)*0.7}/>
          <Gauge label="Positions" value={openTrades.length/Number(cfg.max_concurrent_positions||15)} max={1} warning={0.8}/>
          <Gauge label="Daily Loss" value={Number(state?.risk?.daily_realized_pnl||0)<0?Math.abs(Number(state?.risk?.daily_realized_pnl||0))/bankroll:0} max={Number(cfg.daily_loss_limit_pct||0.15)} warning={0.1}/>
        </Card>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Kelly" value={`${fmt(Number(cfg.kelly_fraction||0.25)*100,0)}%`}/><Metric label="Max Pos" value={`${fmt(Number(cfg.max_pos_pct||0.05)*100,0)}%`}/>
          <Metric label="Violations" value={riskStatus?.summary?.violations||0} good={!Number(riskStatus?.summary?.violations||0)}/>
          <Metric label="Exec Orders" value={execStatus?.summary?.executed_orders||0}/><Metric label="Risk Blocked" value={execStatus?.summary?.risk_blocked_orders||0} good={true}/>
        </div>
        <Card title={`Offene Positionen (${openTrades.length})`}>
          {openTrades.map((t,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${C.border}11`,fontSize:11,...mono}}>
            <span style={{color:C.text}}>{(t.title||t.market_id||'').slice(0,45)}</span>
            <div style={{display:'flex',gap:8,color:C.muted}}><span style={{color:t.direction==='BUY_YES'?C.green:C.red}}>{t.direction}</span><span>${fmt(t.positionUsd,0)}</span></div>
          </div>)}
          {!openTrades.length&&<div style={{color:C.muted,fontSize:12}}>Keine offenen Positionen.</div>}
        </Card>
      </div>}

      {/* ==================== SETTINGS ==================== */}
      {tab==='settings'&&<div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
          <Card title="Allgemein">{GENERAL_SETTINGS.map(s=><SettingField key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}</Card>
          <Card title="Scanner">{SCANNER_SETTINGS.map(s=><SettingField key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}</Card>
          <Card title="Research Quellen">{RESEARCH_SETTINGS.map(s=><SettingField key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}</Card>
          <Card title="LLM Einstellungen">
            {LLM_SETTINGS.map(s=><SettingField key={s.key} item={s} value={cfg[s.key]} onChange={v=>setConfig(s.key,v)}/>)}
            <div style={{fontSize:12,fontWeight:600,color:C.text,margin:'12px 0 8px'}}>Provider</div>
            {['openai','claude','gemini','ollama_cloud'].map(name=>{const p=state?.providers?.[name]||{};return<div key={name} style={{marginBottom:10,padding:'8px 10px',background:C.bg,borderRadius:6,border:`1px solid ${C.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600,color:p.enabled?C.cyan:C.muted}}>{name}</span>
                <label style={{display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={!!p.enabled} onChange={e=>setProvider(name,'enabled',e.target.checked)}/><span style={{fontSize:10,color:C.muted}}>aktiv</span></label>
              </div>
              <div style={{fontSize:10,color:C.dim,marginBottom:4}}>
                {name==='openai'&&'OpenAI API (GPT-4o-mini empfohlen). Gewicht: 35%.'}{name==='claude'&&'Anthropic Claude API. Gewicht: 25%.'}{name==='gemini'&&'Google Gemini. Kostenloser Tier verfügbar! Gewicht: 20%.'}{name==='ollama_cloud'&&'Ollama Cloud / Kimi. Gewicht: 20%.'}
              </div>
              <input placeholder="API Key" type="password" value={p.api_key||''} onChange={e=>setProvider(name,'api_key',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
              <input placeholder="Model" value={p.model||''} onChange={e=>setProvider(name,'model',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
              <input placeholder="Base URL" value={p.base_url||''} onChange={e=>setProvider(name,'base_url',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
            </div>;})}
          </Card>
          <Card title="Market APIs">
            <div style={{marginBottom:10,padding:'8px 10px',background:C.bg,borderRadius:6,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,fontWeight:600,color:C.cyan,marginBottom:4}}>Polymarket</div>
              <div style={{fontSize:10,color:C.dim,marginBottom:4}}>Crypto-native auf Polygon. Braucht Wallet Address + EIP-712 Signatur. Docs: docs.polymarket.com</div>
              <input placeholder="Wallet Address" value={state?.providers?.polymarket?.wallet_address||''} onChange={e=>setProvider('polymarket','wallet_address',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
              <input placeholder="EIP-712 Signature" type="password" value={state?.providers?.polymarket?.eip712_signature||''} onChange={e=>setProvider('polymarket','eip712_signature',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
            </div>
            <div style={{padding:'8px 10px',background:C.bg,borderRadius:6,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,fontWeight:600,color:C.purple,marginBottom:4}}>Kalshi</div>
              <div style={{fontSize:10,color:C.dim,marginBottom:4}}>US-regulierte Börse. Demo-Modus verfügbar. Docs: trading-api.readme.io</div>
              <input placeholder="Key ID" value={state?.providers?.kalshi?.key_id||''} onChange={e=>setProvider('kalshi','key_id',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,marginBottom:3,boxSizing:'border-box'}}/>
              <input placeholder="Key Secret" type="password" value={state?.providers?.kalshi?.key_secret||''} onChange={e=>setProvider('kalshi','key_secret',e.target.value)} style={{display:'block',width:'100%',padding:'4px 7px',borderRadius:4,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:11,...mono,boxSizing:'border-box'}}/>
            </div>
            <div style={{marginTop:10}}><Btn onClick={()=>act('connTest',async()=>{const r=await apiFetch('/api/connection/test');setConnTest(await r.json());})} busy={busy.connTest}>Verbindung testen</Btn></div>
            {connTest&&<pre style={{fontSize:9,color:C.muted,marginTop:6,overflow:'auto',maxHeight:100,...mono}}>{JSON.stringify(connTest,null,2)}</pre>}
          </Card>
        </div>
      </div>}

      {/* ==================== OPS & LOGS ==================== */}
      {tab==='ops'&&<div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          <Metric label="Breaker" value={scanStatus?.runtime?.breaker_open?'OPEN':'CLOSED'} good={!scanStatus?.runtime?.breaker_open}/>
          <Metric label="Fails" value={scanStatus?.runtime?.consecutiveFailures||0} good={Number(scanStatus?.runtime?.consecutiveFailures||0)<3}/>
          <Metric label="Pipeline Runs" value={pipelineRuns.length}/>
        </div>
        {(improvements?.improvements||[]).length>0&&<Card title="Verbesserungspotential">
          {improvements.improvements.map((item,i)=><div key={i} style={{padding:'5px 0',borderBottom:`1px solid ${C.border}11`}}>
            <div style={{fontSize:11}}><span style={{color:item.severity==='high'?C.red:item.severity==='medium'?C.amber:C.muted,fontWeight:600}}>{item.severity}</span> — {item.area}</div>
            <div style={{fontSize:10,color:C.muted}}>{item.recommendation}</div>
          </div>)}
        </Card>}
        {pipelineRuns.length>0&&<Card title="Pipeline Runs">
          {pipelineRuns.slice(0,10).map((run,i)=><div key={i} style={{padding:'5px 0',borderBottom:`1px solid ${C.border}11`,fontSize:10,...mono}}>
            <span style={{color:C.muted}}>{(run.time||'').slice(0,19)}</span>
            {(run.trace||[]).map((t,j)=><span key={j} style={{marginLeft:8,color:C.text}}>S{t.step}:{t.key}={Object.values(t).filter(v=>typeof v==='number')[0]||'ok'}</span>)}
          </div>)}
        </Card>}
        <Card title={`Live Log (${liveLog.length} events)`}>
          <div style={{maxHeight:300,overflow:'auto',...mono,fontSize:10}}>
            {liveLog.slice(0,60).map((e,i)=>{
              const isErr=String(e.event||'').includes('error');
              const isOk=String(e.event||'').includes('ok')||String(e.event||'').includes('completed');
              const errExp=isErr?explainError(e.message||e.event||''):null;
              return<div key={i} style={{padding:'2px 0',color:isErr?C.red:isOk?C.green:C.muted}}>
                <span style={{color:C.dim}}>{(e.t||'').slice(11,19)}</span> {e.event} {e.source?`[${e.source}]`:''} {e.message||e.label||''}
                {errExp&&<div style={{color:C.amber,fontSize:9,marginLeft:52,fontStyle:'italic'}}>↳ {errExp}</div>}
              </div>;})}
            {!liveLog.length&&<div style={{color:C.dim}}>Keine Events. Starte einen Scan.</div>}
          </div>
        </Card>
      </div>}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}*{box-sizing:border-box}::-webkit-scrollbar{height:4px;width:4px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.dim};border-radius:2px}`}</style>
    </div>);
}
