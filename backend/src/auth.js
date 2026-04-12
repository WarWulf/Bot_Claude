// auth.js — UI password authentication and middleware

import crypto from 'node:crypto';
import { loadState, saveState, logLine } from './appState.js';

const envUiPassword = String(process.env.UI_PASSWORD || 'changeme');

if (envUiPassword === 'changeme') {
  console.warn('[security] UI_PASSWORD is not set. Using default "changeme". Please set a strong password in .env.');
}

function hashUiPassword(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function resolveUiPasswordHash() {
  const state = loadState();
  const persisted = String(state?.config?.ui_password_hash || '').trim();
  if (persisted) return persisted;
  return hashUiPassword(envUiPassword);
}

function isValidUiPassword(provided = '') {
  if (!provided) return false;
  return hashUiPassword(provided) === resolveUiPasswordHash();
}

export function registerAuthRoutes(app) {
  app.get('/api/ui-auth/status', (_, res) => {
    const state = loadState();
    const persisted = Boolean(String(state?.config?.ui_password_hash || '').trim());
    res.json({ enabled: true, persisted_password: persisted, default_password_active: !persisted && envUiPassword === 'changeme' });
  });

  app.post('/api/ui-auth/login', (req, res) => {
    const provided = String(req.body?.password || '');
    if (isValidUiPassword(provided)) return res.json({ ok: true, enabled: true, default_password_active: envUiPassword === 'changeme' });
    return res.status(401).json({ ok: false, enabled: true, message: 'invalid password' });
  });

  app.post('/api/ui-auth/password', (req, res) => {
    const currentPassword = String(req.body?.current_password || '');
    const newPassword = String(req.body?.new_password || '');
    if (!isValidUiPassword(currentPassword)) return res.status(401).json({ ok: false, message: 'current password invalid' });
    if (newPassword.length < 10) return res.status(400).json({ ok: false, message: 'new password too short (min 10 chars)' });
    const state = loadState();
    state.config = state.config || {};
    state.config.ui_password_hash = hashUiPassword(newPassword);
    logLine(state, 'info', 'ui password updated and persisted');
    saveState(state);
    return res.json({ ok: true, persisted_password: true });
  });

  // Auth middleware for all /api/* routes except health and auth endpoints
  app.use('/api', (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (req.path === '/health') return next();
    if (req.path.startsWith('/ui-auth/')) return next();
    const provided = String(req.header('x-ui-password') || '');
    if (isValidUiPassword(provided)) return next();
    return res.status(401).json({ ok: false, message: 'ui password required' });
  });
}
