const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, globalShortcut, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const desktopPin = require('./desktop-pin');
const cloudSync = require('./cloud-sync');
const firebaseSync = require('./firebase-sync');
const fbBaked = require('./firebase-config');

// Effective Firebase config: prefer the baked-in dev config, fall back to any
// per-device config the user typed in settings.
function effectiveFbConfig() {
  if (fbBaked.apiKey && fbBaked.databaseURL) {
    return { apiKey: fbBaked.apiKey, databaseURL: fbBaked.databaseURL };
  }
  return state.settings.firebaseConfig || { apiKey: '', databaseURL: '' };
}
const fbIsBaked = () => !!(fbBaked.apiKey && fbBaked.databaseURL);

const DATA_FILE = path.join(app.getPath('userData'), 'deskcal-data.json');

const DEFAULTS = {
  notes: {},
  settings: {
    theme: 'light',
    opacity: 0.97,       // BACKGROUND translucency only (text stays opaque)
    alwaysOnTop: false,
    startWithWindows: false,
    weekStart: 0,        // 0 = Sunday, 1 = Monday
    fontFamily: 'system',// system | sans | serif | rounded | mono
    fontScale: 1,        // text size multiplier
    fontWeight: 'normal',// normal | bold
    italic: false,
    cellSpacing: 2,      // gap between days/weeks, in px
    showWeekNumbers: false,
    cellBorders: false,
    highlightWeekends: false,
    reminderLeadMinutes: 0,  // fire this many minutes before the set time
    snoozeMinutes: 10,       // re-notify interval until acknowledged (0 = off)
    rollOverTasks: false,    // move past unfinished tasks to today
    pinToDesktop: false, // glue to the wallpaper, behind all windows
    locked: true,        // freeze position/size by default; unlock via 🔒 button
    syncProvider: 'none',// none | onedrive | gdrive | custom | firebase
    syncFolder: '',      // used when syncProvider === 'custom'
    firebaseConfig: { apiKey: '', databaseURL: '' } // used when syncProvider === 'firebase'
  },
  bounds: null,
  updatedAt: 0
};

let win = null;
let tray = null;
let isPinned = false;
let syncFile = null;       // absolute path of the synced data file, if enabled
let lastSyncJson = '';     // last content we wrote, to ignore our own watch events
let state = loadState();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      notes: raw.notes || {},
      settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
      bounds: raw.bounds || null,
      updatedAt: raw.updatedAt || 0
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function writeLocal() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

function saveState(touch = true) {
  if (touch) state.updatedAt = Date.now();
  writeLocal();
  if (state.settings.syncProvider === 'firebase') firebaseSync.writeNotes(state.notes, state.updatedAt);
  else writeSyncFile();
}

// Adopt notes pushed from a remote source (file watch or Firebase) if newer.
function adoptRemoteNotes(notes, updatedAt) {
  if ((updatedAt || 0) <= (state.updatedAt || 0)) return;
  state.notes = notes || {};
  state.updatedAt = updatedAt || Date.now();
  writeLocal();
  if (win && !win.isDestroyed()) win.webContents.send('notes:changed', state.notes);
}

// ---------- Cloud sync ----------
function configureSync() {
  // Tear down whichever sync was active.
  if (syncWatcher) { fs.unwatchFile(syncFile, syncWatcher); syncWatcher = null; }
  syncFile = null;
  firebaseSync.stop();

  if (state.settings.syncProvider === 'firebase') {
    firebaseSync.configure({
      config: effectiveFbConfig(),
      file: path.join(app.getPath('userData'), 'fb-session.bin'),
      safeStorageRef: safeStorage
    });
    firebaseSync.setHandlers({
      onNotes: (notes, updatedAt) => adoptRemoteNotes(notes, updatedAt),
      onAuth: (s) => { if (win && !win.isDestroyed()) win.webContents.send('auth:state', s); },
      onStatus: (t) => { if (win && !win.isDestroyed()) win.webContents.send('sync:status', t); },
      getLocal: () => ({ notes: state.notes, updatedAt: state.updatedAt })
    });
    firebaseSync.restore().catch(() => {});
    return;
  }

  // File-based providers (OneDrive / Google Drive / custom folder).
  syncFile = cloudSync.resolveFile(state.settings.syncProvider, state.settings.syncFolder);
  if (!syncFile) return;
  try {
    fs.mkdirSync(path.dirname(syncFile), { recursive: true });
    if (fs.existsSync(syncFile)) {
      const remote = JSON.parse(fs.readFileSync(syncFile, 'utf8'));
      if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
        state.notes = remote.notes || {};
        state.updatedAt = remote.updatedAt || Date.now();
        writeLocal();
      } else {
        writeSyncFile();
      }
    } else {
      writeSyncFile();
    }
    watchSyncFile();
  } catch (e) {
    console.error('[sync] configure failed:', e && e.message);
  }
}

function writeSyncFile() {
  if (!syncFile) return;
  try {
    const payload = JSON.stringify({ notes: state.notes, updatedAt: state.updatedAt }, null, 2);
    lastSyncJson = payload;
    fs.mkdirSync(path.dirname(syncFile), { recursive: true });
    fs.writeFileSync(syncFile, payload, 'utf8');
  } catch (e) {
    console.error('[sync] write failed:', e && e.message);
  }
}

let syncWatcher = null;
function watchSyncFile() {
  if (!syncFile) return;
  syncWatcher = () => {
    try {
      const txt = fs.readFileSync(syncFile, 'utf8');
      if (txt === lastSyncJson) return; // our own write
      const remote = JSON.parse(txt);
      if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
        state.notes = remote.notes || {};
        state.updatedAt = remote.updatedAt || Date.now();
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
        if (win && !win.isDestroyed()) win.webContents.send('notes:changed', state.notes);
      }
    } catch {}
  };
  // Polling watch is the reliable choice for cloud-synced files.
  fs.watchFile(syncFile, { interval: 2000 }, syncWatcher);
}

function applyLoginItem(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

// ---------- Reminders ----------
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
let firedReminders = new Set();
let acked = new Set();
let snoozeTimers = new Map();
let firedDay = '';

function reminderOccursToday(baseKey, repeat, exceptions, today) {
  const tk = dayKey(today);
  if ((exceptions || []).includes(tk)) return false;
  if (tk === baseKey) return true;
  if (!repeat || repeat === 'none' || tk < baseKey) return false;
  const [y, m, d] = baseKey.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  switch (repeat) {
    case 'daily': return true;
    case 'weekly': return today.getDay() === base.getDay();
    case 'monthly': return today.getDate() === base.getDate();
    case 'yearly': return today.getMonth() === base.getMonth() && today.getDate() === base.getDate();
    default: return false;
  }
}

// Time (HH:MM) at which to fire, given the set time and a lead in minutes.
function fireTimeOf(remind, lead) {
  const [h, m] = remind.split(':').map(Number);
  let total = h * 60 + m - (lead || 0);
  if (total < 0) total = 0;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function checkReminders() {
  const now = new Date();
  const cur = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const tk = dayKey(now);
  if (firedDay !== tk) {
    firedReminders.clear(); acked.clear(); firedDay = tk;
    backupData();
    if (state.settings.rollOverTasks) rollOverTasks();
  }
  const lead = Number(state.settings.reminderLeadMinutes) || 0;
  for (const key of Object.keys(state.notes)) {
    const n = state.notes[key];
    if (!n.remind) continue;
    if (fireTimeOf(n.remind, lead) !== cur) continue;
    if (!reminderOccursToday(key, n.repeat, n.exceptions, now)) continue;
    const id = `${key}|${tk}|${n.remind}`;
    if (firedReminders.has(id)) continue;
    firedReminders.add(id);
    fireReminder(n, id, 0);
  }
}

function fireReminder(n, id, count) {
  if (!Notification.isSupported()) return;
  const tasks = (n.tasks || []).filter((t) => !t.done).map((t) => '• ' + t.text);
  const body = [n.text, ...tasks].filter(Boolean).join('\n') || 'You have a reminder.';
  const notif = new Notification({
    title: '📅 Desktop Calendar' + (count ? ' (snoozed)' : ''),
    body,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    silent: false
  });
  notif.on('click', () => {
    acked.add(id);
    const t = snoozeTimers.get(id);
    if (t) { clearTimeout(t); snoozeTimers.delete(id); }
    showWindow();
  });
  notif.show();
  const snooze = Number(state.settings.snoozeMinutes) || 0;
  if (snooze > 0 && count < 5) {
    const timer = setTimeout(() => {
      if (!acked.has(id)) fireReminder(n, id, count + 1);
    }, snooze * 60000);
    snoozeTimers.set(id, timer);
  }
}

// Move unfinished tasks from past days onto today (one-way, non-recurring notes).
function rollOverTasks() {
  const todayK = dayKey(new Date());
  let changed = false;
  const carried = [];
  for (const key of Object.keys(state.notes)) {
    if (key >= todayK) continue;
    const n = state.notes[key];
    if (n.repeat && n.repeat !== 'none') continue; // leave recurring series intact
    if (!n.tasks || !n.tasks.length) continue;
    const undone = n.tasks.filter((t) => !t.done);
    if (!undone.length) continue;
    carried.push(...undone);
    n.tasks = n.tasks.filter((t) => t.done);
    if (!n.text && !n.color && !n.tasks.length && !n.remind && !n.endKey) delete state.notes[key];
    changed = true;
  }
  if (carried.length) {
    const t = state.notes[todayK] || { text: '', color: '', tasks: [] };
    t.tasks = [...(t.tasks || []), ...carried];
    state.notes[todayK] = t;
  }
  if (changed) {
    saveState();
    if (win && !win.isDestroyed()) win.webContents.send('notes:changed', state.notes);
  }
}

// Keep a rolling set of daily local backups as a safety net against corruption
// or accidental wipes. One file per day, newest 7 retained.
function backupData() {
  try {
    if (!state.notes || Object.keys(state.notes).length === 0) return; // never back up an empty state
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `deskcal-${dayKey(new Date())}.json`), JSON.stringify(state, null, 2), 'utf8');
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('deskcal-') && f.endsWith('.json')).sort();
    while (files.length > 7) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch {} }
  } catch (e) {
    console.error('[backup] failed:', e && e.message);
  }
}

// ---------- Window ----------
function createWindow() {
  const display = screen.getPrimaryDisplay().workAreaSize;
  const defaultW = 380, defaultH = 460;
  const b = state.bounds || {
    width: defaultW, height: defaultH,
    x: display.width - defaultW - 40, y: 80
  };
  const locked = !!state.settings.locked;
  const pinned = !!state.settings.pinToDesktop;

  win = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 300, minHeight: 360,
    frame: false,
    transparent: true,
    resizable: !locked,
    movable: !locked,
    skipTaskbar: pinned,
    alwaysOnTop: !pinned && !!state.settings.alwaysOnTop,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Note: we intentionally do NOT call win.setOpacity — that would fade the
  // text too. Translucency is applied to the background only, in the renderer.
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.DCAL_DEBUG) {
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('console-message', (_e, level, msg, line, src) => {
      console.log(`[renderer:${level}] ${msg} (${src}:${line})`);
    });
  }

  win.once('ready-to-show', () => { if (pinned) applyPin(true); });

  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); persistBounds(); win.hide(); }
  });
  ['resize', 'move'].forEach(ev => win.on(ev, debounce(persistBounds, 400)));
}

function sinkToDesktop() { if (isPinned && win && !win.isDestroyed()) desktopPin.toBottom(win); }

function applyPin(on) {
  if (!win) return;
  if (on) {
    // Desktop-widget mode: behind other windows, off the taskbar, but still a
    // normal interactive window. It re-sinks to the bottom whenever it loses
    // focus, so it stays out of the way yet you can click/type when focused.
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(true);
    isPinned = true;
    win.removeListener('blur', sinkToDesktop);
    win.on('blur', sinkToDesktop);
    desktopPin.toBottom(win);
  } else {
    isPinned = false;
    win.removeListener('blur', sinkToDesktop);
    win.setSkipTaskbar(false);
    win.setAlwaysOnTop(!!state.settings.alwaysOnTop);
    win.show();
    win.focus();
  }
}

function applyLock(locked) {
  if (!win) return;
  win.setResizable(!locked);
  win.setMovable(!locked);
}

function persistBounds() {
  if (win && !win.isDestroyed() && !isPinned) {
    state.bounds = win.getBounds();
    saveState(false); // bounds change shouldn't bump the sync clock
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function showWindow() {
  if (!win) { createWindow(); return; }
  win.show();
  win.focus(); // bring it up to interact even when pinned; it re-sinks on blur
}

// ---------- Tray ----------
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Desktop Calendar');
  rebuildTrayMenu();
  tray.on('double-click', showWindow);
}

function toggleSetting(key, value) {
  state.settings[key] = value;
  applySetting(key, value);
  saveState(false);
  rebuildTrayMenu();
  if (win) win.webContents.send('settings:changed', state.settings);
}

function applySetting(key, value) {
  if (!win) return;
  switch (key) {
    case 'pinToDesktop': applyPin(value); break;
    case 'locked': applyLock(value); break;
    case 'alwaysOnTop': if (!isPinned) win.setAlwaysOnTop(!!value); break;
    case 'startWithWindows': applyLoginItem(!!value); break;
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const s = state.settings;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Calendar', click: showWindow },
    { type: 'separator' },
    { label: 'Pin to Desktop (wallpaper)', type: 'checkbox', checked: !!s.pinToDesktop, click: (i) => toggleSetting('pinToDesktop', i.checked) },
    { label: 'Lock Position', type: 'checkbox', checked: !!s.locked, click: (i) => toggleSetting('locked', i.checked) },
    { label: 'Always on Top', type: 'checkbox', checked: !!s.alwaysOnTop, enabled: !s.pinToDesktop, click: (i) => toggleSetting('alwaysOnTop', i.checked) },
    { label: 'Start with Windows', type: 'checkbox', checked: !!s.startWithWindows, click: (i) => toggleSetting('startWithWindows', i.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

// ---------- IPC ----------
ipcMain.handle('state:get', () => ({ ...state, runtime: { pinned: isPinned, pinAvailable: desktopPin.available() } }));

ipcMain.handle('notes:set', (_e, { key, note }) => {
  const hasContent = note && (note.text || note.color || (note.tasks && note.tasks.length) ||
    note.remind || (note.repeat && note.repeat !== 'none') || note.endKey ||
    (note.exceptions && note.exceptions.length));
  if (hasContent) state.notes[key] = note; else delete state.notes[key];
  saveState();
  return state.notes[key] || null;
});

ipcMain.handle('settings:set', (_e, settings) => {
  const prev = { ...state.settings };
  state.settings = { ...state.settings, ...settings };
  for (const k of Object.keys(settings)) {
    if (settings[k] !== prev[k]) applySetting(k, settings[k]);
  }
  if (settings.syncProvider !== undefined || settings.syncFolder !== undefined || settings.firebaseConfig !== undefined) configureSync();
  saveState(false);
  rebuildTrayMenu();
  return state.settings;
});

ipcMain.handle('sync:detect', () => ({ ...cloudSync.detect(), current: cloudSync.resolveFile(state.settings.syncProvider, state.settings.syncFolder) }));

// ---- Firebase auth (login lives in main; renderer only passes the user's own credentials) ----
ipcMain.handle('fb:signIn', async (_e, { email, password }) => {
  try { return { ok: true, state: await firebaseSync.signIn(email, password) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('fb:signUp', async (_e, { email, password }) => {
  try { return { ok: true, state: await firebaseSync.signUp(email, password) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('fb:signOut', () => { firebaseSync.signOut(); return { ok: true }; });
ipcMain.handle('fb:state', () => firebaseSync.authState());

// Tell the renderer whether config is baked (so it hides config fields for end-users).
ipcMain.handle('fb:info', () => ({
  baked: fbIsBaked(),
  configured: !!(effectiveFbConfig().apiKey && effectiveFbConfig().databaseURL)
}));

ipcMain.handle('sync:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Choose a sync folder' });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:hide', () => { persistBounds(); win && win.hide(); });
ipcMain.on('win:quit', () => { app.isQuitting = true; app.quit(); });

ipcMain.handle('data:export', () => JSON.stringify({ notes: state.notes, settings: state.settings }, null, 2));
ipcMain.handle('data:import', (_e, json) => {
  try {
    const parsed = JSON.parse(json);
    if (parsed.notes) state.notes = parsed.notes;
    if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
    saveState();
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

app.on('second-instance', showWindow);
app.whenReady().then(() => {
  app.setAppUserModelId('com.harshacal.desktopcalendar');
  applyLoginItem(!!state.settings.startWithWindows);
  // When a build ships with baked Firebase config, clients sync via Firebase —
  // they just log in (no provider/config choices needed).
  if (fbIsBaked()) state.settings.syncProvider = 'firebase';
  configureSync();
  createWindow();
  createTray();
  globalShortcut.register('Control+Alt+C', showWindow);
  backupData();
  if (state.settings.rollOverTasks) rollOverTasks();
  firedDay = dayKey(new Date());
  checkReminders();
  setInterval(checkReminders, 20000); // poll every 20s; fires once per matching minute
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
app.on('before-quit', () => { app.isQuitting = true; persistBounds(); });
