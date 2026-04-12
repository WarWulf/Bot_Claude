// websockets.js — WebSocket connection management for Polymarket and Kalshi

import { loadState, saveState } from './appState.js';
import { pushLiveComm, safeJsonParse } from './utils.js';

export const websocketState = {
  polymarket: { connected: false, url: '', lastEventAt: null, lastError: '' },
  kalshi: { connected: false, url: '', lastEventAt: null, lastError: '' }
};

const websocketClients = { polymarket: null, kalshi: null };
const wsEventBuffer = [];

function onWebsocketMessage(name, raw) {
  const text = String(raw || '').slice(0, 5000);
  let parsed = null;
  try {
    const obj = JSON.parse(text);
    if (name === 'polymarket') {
      parsed = { event_type: obj.type || obj.eventType || 'message', market: obj.market || obj.condition_id || obj.asset_id || '', price: Number(obj.price ?? obj.best_ask ?? obj.best_bid ?? 0), bid: Number(obj.best_bid ?? 0), ask: Number(obj.best_ask ?? 0), volume: Number(obj.volume ?? 0) };
    } else if (name === 'kalshi') {
      parsed = { event_type: obj.type || obj.cmd || 'message', market: obj.market_ticker || obj.ticker || '', price: Number(obj.last_price ?? obj.price ?? 0), bid: Number(obj.yes_bid ?? 0), ask: Number(obj.yes_ask ?? 0), volume: Number(obj.volume ?? 0) };
    } else parsed = { event_type: 'message' };
  } catch { parsed = { event_type: 'raw', raw: text.slice(0, 1000) }; }
  wsEventBuffer.unshift({ t: new Date().toISOString(), source: name, ...parsed });
  pushLiveComm('ws_tick', { source: name, event_type: parsed?.event_type || 'message', market: parsed?.market || '', price: Number(parsed?.price || 0) });
  if (wsEventBuffer.length > 500) wsEventBuffer.length = 500;
}

export function flushWsTicksBuffer() {
  if (!wsEventBuffer.length) return;
  const state = loadState();
  state.ws_ticks = state.ws_ticks || [];
  state.ws_ticks = [...wsEventBuffer.splice(0, wsEventBuffer.length), ...state.ws_ticks].slice(0, 200);
  saveState(state);
}

function connectWebsocket(name, url, autoReconnect = true) {
  if (!url) return;
  if (typeof WebSocket === 'undefined') { websocketState[name].lastError = 'WebSocket runtime not available'; return; }
  if (websocketClients[name]) websocketClients[name].close();
  try {
    const ws = new WebSocket(url);
    websocketClients[name] = ws;
    websocketState[name] = { ...websocketState[name], connected: false, url, lastError: '' };
    ws.onopen = () => { websocketState[name].connected = true; websocketState[name].lastEventAt = new Date().toISOString(); pushLiveComm('ws_open', { source: name, url: String(url).slice(0, 240) }); if (name === 'polymarket') ws.send(JSON.stringify({ type: 'subscribe', channel: 'market' })); if (name === 'kalshi') ws.send(JSON.stringify({ cmd: 'subscribe', channels: ['ticker'] })); };
    ws.onmessage = (event) => { websocketState[name].lastEventAt = new Date().toISOString(); onWebsocketMessage(name, event.data || ''); };
    ws.onerror = (event) => { websocketState[name].lastError = `websocket error: ${event?.message || 'unknown'}`; pushLiveComm('ws_error', { source: name, message: websocketState[name].lastError }); };
    ws.onclose = () => { websocketState[name].connected = false; pushLiveComm('ws_close', { source: name, autoReconnect: Boolean(autoReconnect) }); if (autoReconnect) setTimeout(() => connectWebsocket(name, url, autoReconnect), 5000); };
  } catch (error) { websocketState[name].lastError = error.message; pushLiveComm('ws_error', { source: name, message: String(error?.message || 'unknown') }); }
}

export function stopWebsocket(name) {
  if (websocketClients[name]) { websocketClients[name].close(); websocketClients[name] = null; }
  websocketState[name].connected = false;
  pushLiveComm('ws_stop', { source: name });
}

export function applyWebsocketConfig() {
  const cfg = loadState().config || {};
  if (!cfg.scanner_ws_enabled) { stopWebsocket('polymarket'); stopWebsocket('kalshi'); return; }
  connectWebsocket('polymarket', cfg.polymarket_ws_url, Boolean(cfg.scanner_ws_auto_reconnect));
  connectWebsocket('kalshi', cfg.kalshi_ws_url, Boolean(cfg.scanner_ws_auto_reconnect));
}
