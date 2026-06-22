// Cross-device login + realtime sync via Firebase, with NO firebase SDK
// dependency. Uses:
//   - Firebase Auth REST  (sign up / sign in / token refresh)
//   - Realtime Database REST (PUT to write) + Server-Sent Events (live pushes)
// Everything runs in the main process. The renderer only sends email/password
// over IPC for the user's own login; we never store the password — only an
// encrypted refresh token (Electron safeStorage / Windows DPAPI).
const https = require('https');
const fs = require('fs');
const path = require('path');

let cfg = null;            // { apiKey, databaseURL }
let session = null;        // { idToken, refreshToken, uid, email, expiresAt }
let sseReq = null;
let refreshTimer = null;
let reconnectTimer = null;
let tokenFile = null;
let safeStorage = null;

let onNotes = () => {};    // (notes, updatedAt) => void
let onAuth = () => {};     // (state|null) => void
let onStatus = () => {};   // (text) => void
let getLocal = () => ({ notes: {}, updatedAt: 0 });

function configure({ config, file, safeStorageRef }) {
  cfg = config || null;
  tokenFile = file;
  safeStorage = safeStorageRef;
}
function setHandlers(h) {
  if (h.onNotes) onNotes = h.onNotes;
  if (h.onAuth) onAuth = h.onAuth;
  if (h.onStatus) onStatus = h.onStatus;
  if (h.getLocal) getLocal = h.getLocal;
}
function isConfigured() { return !!(cfg && cfg.apiKey && cfg.databaseURL); }
function authState() { return session ? { email: session.email, uid: session.uid } : null; }
const base = () => cfg.databaseURL.replace(/\/$/, '');

async function authCall(method, body) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${cfg.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (j.error) throw new Error(friendly(j.error.message));
  return j;
}

function friendly(code) {
  const map = {
    EMAIL_EXISTS: 'That email already has an account — try signing in.',
    EMAIL_NOT_FOUND: 'No account with that email.',
    INVALID_PASSWORD: 'Wrong password.',
    INVALID_LOGIN_CREDENTIALS: 'Email or password is incorrect.',
    WEAK_PASSWORD: 'Password should be at least 6 characters.',
    INVALID_EMAIL: 'That email address looks invalid.'
  };
  return map[code] || code;
}

function applyTokens(j) {
  // Accept both signIn/signUp (idToken/refreshToken/localId/expiresIn) and
  // token-refresh (id_token/refresh_token/user_id/expires_in) shapes.
  const idToken = j.idToken || j.id_token;
  const refreshToken = j.refreshToken || j.refresh_token;
  const uid = j.localId || j.user_id || (session && session.uid);
  const email = j.email || (session && session.email);
  const expiresIn = Number(j.expiresIn || j.expires_in || 3600);
  session = { idToken, refreshToken, uid, email, expiresAt: Date.now() + expiresIn * 1000 };
  persistToken();
  scheduleRefresh(expiresIn);
}

async function signUp(email, password) {
  const j = await authCall('signUp', { email, password, returnSecureToken: true });
  applyTokens(j); afterAuth(); return authState();
}
async function signIn(email, password) {
  const j = await authCall('signInWithPassword', { email, password, returnSecureToken: true });
  applyTokens(j); afterAuth(); return authState();
}

// Exchange an OAuth credential (from Google/Microsoft/GitHub) for a Firebase session.
async function signInWithProvider(tokens) {
  const postBody = `${tokens.credKey}=${encodeURIComponent(tokens[tokens.credKey])}&providerId=${tokens.providerId}`;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${cfg.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody, requestUri: 'http://127.0.0.1', returnIdpCredential: true, returnSecureToken: true })
  });
  const j = await r.json();
  if (j.error) throw new Error(friendly(j.error.message));
  applyTokens(j); afterAuth(); return authState();
}
function signOut() {
  stopListen();
  clearTimeout(refreshTimer);
  session = null;
  try { if (tokenFile && fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile); } catch {}
  onAuth(null);
  onStatus('Signed out');
}

function afterAuth() {
  onAuth(authState());
  onStatus('Signed in as ' + session.email);
  startListen();
  reconcile().catch((e) => console.error('[fb] reconcile failed', e && e.message));
}

// First-sync reconcile: adopt the cloud if it's newer, otherwise seed the cloud
// from local — so logging in on a new device never wipes existing notes.
async function reconcile() {
  if (!session) return;
  await ensureToken();
  const r = await fetch(`${base()}/calendars/${session.uid}.json?auth=${session.idToken}`);
  const remote = await r.json();
  const local = getLocal();
  if (remote && remote.notes !== undefined && (remote.updatedAt || 0) > (local.updatedAt || 0)) {
    onNotes(remote.notes || {}, remote.updatedAt || 0);
  } else if (local.notes && Object.keys(local.notes).length) {
    await writeNotes(local.notes, local.updatedAt || Date.now());
  }
}

async function refresh() {
  if (!session || !session.refreshToken) throw new Error('no session');
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'refresh failed');
  applyTokens(j);
}

function scheduleRefresh(expiresIn) {
  clearTimeout(refreshTimer);
  const ms = Math.max(30, expiresIn - 120) * 1000; // refresh ~2 min before expiry
  refreshTimer = setTimeout(() => {
    refresh().then(startListen).catch((e) => console.error('[fb] refresh failed', e.message));
  }, ms);
}

async function ensureToken() {
  if (session && Date.now() > session.expiresAt - 60000) { try { await refresh(); } catch {} }
}

// Restore a previous session from the encrypted refresh token on disk.
async function restore() {
  try {
    if (!isConfigured() || !tokenFile || !fs.existsSync(tokenFile)) return false;
    const raw = fs.readFileSync(tokenFile);
    let rt;
    if (safeStorage && safeStorage.isEncryptionAvailable()) rt = safeStorage.decryptString(raw);
    else rt = raw.toString('utf8');
    if (!rt) return false;
    session = { refreshToken: rt, expiresAt: 0 };
    await refresh();
    afterAuth();
    return true;
  } catch (e) {
    console.error('[fb] restore failed', e && e.message);
    session = null;
    return false;
  }
}

function persistToken() {
  try {
    if (!tokenFile || !session) return;
    const rt = session.refreshToken;
    const data = (safeStorage && safeStorage.isEncryptionAvailable())
      ? safeStorage.encryptString(rt) : Buffer.from(rt, 'utf8');
    fs.writeFileSync(tokenFile, data);
  } catch (e) { console.error('[fb] persist failed', e && e.message); }
}

// ---- Realtime DB ----
async function writeNotes(notes, updatedAt) {
  if (!session || !isConfigured()) return;
  await ensureToken();
  try {
    await fetch(`${base()}/calendars/${session.uid}.json?auth=${session.idToken}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, updatedAt })
    });
    onStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (e) { console.error('[fb] write failed', e && e.message); }
}

async function fetchOnce() {
  if (!session) return;
  await ensureToken();
  try {
    const r = await fetch(`${base()}/calendars/${session.uid}.json?auth=${session.idToken}`);
    const d = await r.json();
    if (d && d.notes !== undefined) onNotes(d.notes || {}, d.updatedAt || 0);
  } catch (e) { console.error('[fb] fetch failed', e && e.message); }
}

function stopListen() {
  if (sseReq) { try { sseReq.destroy(); } catch {} sseReq = null; }
  clearTimeout(reconnectTimer);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { if (session) startListen(); }, 5000);
}

function startListen() {
  stopListen();
  if (!session || !isConfigured()) return;
  const url = new URL(`${base()}/calendars/${session.uid}.json`);
  url.searchParams.set('auth', session.idToken);
  onStatus('Connecting…');
  sseReq = https.get(url, { headers: { Accept: 'text/event-stream' } }, (res) => {
    if (res.statusCode === 401) { res.resume(); refresh().then(startListen).catch(() => {}); return; }
    if (res.statusCode !== 200) { res.resume(); scheduleReconnect(); return; }
    onStatus('Live · syncing');
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        handleEvent(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    });
    res.on('end', scheduleReconnect);
  });
  sseReq.on('error', (e) => { console.error('[fb] sse error', e.message); scheduleReconnect(); });
}

function handleEvent(raw) {
  let event = null, dataStr = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  if (!event || event === 'keep-alive') return;
  if (event === 'auth_revoked') { refresh().then(startListen).catch(() => {}); return; }
  if (event === 'cancel') { scheduleReconnect(); return; }
  try {
    const payload = JSON.parse(dataStr); // { path, data }
    if (payload && payload.path === '/' && payload.data && payload.data.notes !== undefined) {
      onNotes(payload.data.notes || {}, payload.data.updatedAt || 0);
    } else {
      fetchOnce(); // partial update — re-read the whole record to stay correct
    }
  } catch { /* ignore */ }
}

module.exports = {
  configure, setHandlers, isConfigured, authState,
  signUp, signIn, signInWithProvider, signOut, restore, writeNotes, stop: stopListen
};
