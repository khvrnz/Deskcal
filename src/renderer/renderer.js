const cal = window.api;

const COLORS = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#3182ce', '#805ad5', '#d53f8c'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMOJIS = ['😀','😄','🎉','🎂','❤️','⭐','✅','📌','📞','💼','🛒','🏥','✈️','🏠','🎓','💊','🏋️','🍽️','☕','🎬','🎵','💡','⚠️','🔥','💰','📝','📅','⏰','🎁','🌟','👍','🚗','🐶','☀️','🌧️','💪','📚','🩺','🦷','🎯'];

let state = { notes: {}, settings: {}, runtime: {} };
let view = new Date();
let selectedKey = null;
let editorColor = '';
let editorTasks = [];
let editorOccurrenceBase = null; // when editing a recurring occurrence
let activeField = null;

const $ = (id) => document.getElementById(id);
const app = $('app');

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDaysKey = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const dayDelta = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
}

function matchesRecurrence(baseKey, pattern, d) {
  const dk = keyOf(d);
  if (dk <= baseKey) return false;
  const base = parseKey(baseKey);
  switch (pattern) {
    case 'daily': return true;
    case 'weekly': return d.getDay() === base.getDay();
    case 'monthly': return d.getDate() === base.getDate();
    case 'yearly': return d.getMonth() === base.getMonth() && d.getDate() === base.getDate();
    default: return false;
  }
}

async function init() {
  state = await cal.getState();
  applySettings(state.settings);
  view = new Date();
  view.setDate(1);
  render();
  bindUI();
  cal.onSettingsChanged((s) => { state.settings = s; applySettings(s); syncSettingsForm(); render(); });
  cal.onNotesChanged((n) => { state.notes = n; render(); });
  cal.onAuthState((s) => updateFbAuthUI(s));
  cal.onSyncStatus((t) => { const el = $('fbStatus'); if (el) el.textContent = t; });
}

function updateFbAuthUI(authState) {
  const signedIn = !!authState;
  $('fbAuth').classList.toggle('hidden', signedIn);
  $('fbSignedIn').classList.toggle('hidden', !signedIn);
  if (signedIn) $('fbUser').textContent = '✓ ' + authState.email;
  $('fbError').textContent = '';
}

async function refreshFirebasePanel() {
  const isFb = state.settings.syncProvider === 'firebase';
  $('firebasePanel').classList.toggle('hidden', !isFb);
  $('syncStatus').classList.toggle('hidden', isFb);
  if (!isFb) return;
  const cfg = state.settings.firebaseConfig || {};
  $('fbApiKey').value = cfg.apiKey || '';
  $('fbDbUrl').value = cfg.databaseURL || '';
  try {
    const info = await cal.fbInfo();
    $('fbConfigFields').classList.toggle('hidden', info.baked); // end-users never see config
    // In a baked build, users just log in & sync — hide the provider chooser.
    $('syncProviderRow').classList.toggle('hidden', info.baked);
    $('syncSectionLabel').textContent = info.baked ? 'Account & sync' : 'Cloud sync';
  } catch { /* ignore */ }
  try { updateFbAuthUI(await cal.fbState()); } catch { /* ignore */ }
}

const FONT_STACKS = {
  system: '"Segoe UI", system-ui, -apple-system, sans-serif',
  sans: 'Arial, Helvetica, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", Cambria, serif',
  rounded: '"Segoe UI Rounded", "Segoe UI", system-ui, sans-serif',
  mono: '"Cascadia Code", Consolas, "Courier New", monospace'
};

function applySettings(s) {
  app.classList.toggle('theme-dark', s.theme === 'dark');
  app.classList.toggle('theme-light', s.theme !== 'dark');
  app.style.setProperty('--font-family', FONT_STACKS[s.fontFamily] || FONT_STACKS.system);
  app.style.setProperty('--font-scale', s.fontScale ?? 1);
  app.style.setProperty('--text-weight', s.fontWeight === 'bold' ? '700' : '400');
  app.style.setProperty('--text-style', s.italic ? 'italic' : 'normal');
  app.style.setProperty('--bg-alpha', s.opacity ?? 0.97);
  app.style.setProperty('--cell-gap', (s.cellSpacing ?? 2) + 'px');
  app.classList.toggle('cell-borders', !!s.cellBorders);
  app.classList.toggle('hl-weekends', !!s.highlightWeekends);
  applyLockUI(!!s.locked);
}

function applyLockUI(locked) {
  app.classList.toggle('unlocked', !locked);
  const b = $('lockBtn');
  if (b) {
    b.textContent = locked ? '🔒' : '🔓';
    b.title = locked ? 'Locked — click to unlock move/resize' : 'Unlocked — click to lock in place';
    b.classList.toggle('active', !locked);
  }
}

const weekStart = () => Number(state.settings.weekStart) || 0;
const showWeeks = () => !!state.settings.showWeekNumbers;

function renderWeekdays() {
  const wd = $('weekdays');
  wd.innerHTML = '';
  wd.classList.toggle('with-weeks', showWeeks());
  if (showWeeks()) {
    const blank = document.createElement('div');
    blank.className = 'wk-head';
    blank.textContent = 'Wk';
    wd.appendChild(blank);
  }
  const ws = weekStart();
  for (let i = 0; i < 7; i++) {
    const idx = (i + ws) % 7;
    const el = document.createElement('div');
    el.textContent = WEEKDAYS[idx];
    if (idx === 0 || idx === 6) el.classList.add('wknd');
    wd.appendChild(el);
  }
}

function recurringOccurrencesOn(d, excludeKey) {
  const out = [];
  const dk = keyOf(d);
  for (const k in state.notes) {
    if (k === excludeKey) continue;
    const n = state.notes[k];
    if (n.repeat && n.repeat !== 'none' && matchesRecurrence(k, n.repeat, d) &&
      !(n.exceptions || []).includes(dk)) out.push(n);
  }
  return out;
}

// notes whose multi-day range covers dk as a continuation day (after the start)
function spanningOn(dk) {
  const out = [];
  for (const k in state.notes) {
    const n = state.notes[k];
    if (n.endKey && k < dk && dk <= n.endKey) out.push(n);
  }
  return out;
}

function render() {
  renderWeekdays();
  $('monthLabel').textContent = MONTHS[view.getMonth()];
  $('yearLabel').textContent = view.getFullYear();

  const grid = $('grid');
  grid.innerHTML = '';
  grid.classList.toggle('with-weeks', showWeeks());

  const ws = weekStart();
  const firstDow = (view.getDay() - ws + 7) % 7;
  const start = new Date(view);
  start.setDate(1 - firstDow);
  const today = new Date();
  const dark = app.classList.contains('theme-dark');

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = keyOf(d);
    const note = state.notes[key];

    if (showWeeks() && i % 7 === 0) {
      const wk = document.createElement('div');
      wk.className = 'wk';
      wk.textContent = isoWeek(d);
      grid.appendChild(wk);
    }

    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.key = key;
    if (d.getMonth() !== view.getMonth()) cell.classList.add('other');
    if (d.getDay() === 0 || d.getDay() === 6) cell.classList.add('wknd');
    if (sameDay(d, today)) cell.classList.add('today');
    if (key === selectedKey) cell.classList.add('selected');

    const occ = recurringOccurrencesOn(d, key);
    const spans = spanningOn(key);
    const tintColor = (note && note.color) ||
      (spans.find((n) => n.color) || {}).color ||
      (occ.find((n) => n.color) || {}).color;
    if (tintColor) cell.style.background = hexToRgba(tintColor, dark ? 0.32 : 0.18);
    if (note && note.endKey) cell.classList.add('range-start');
    if (spans.length) cell.classList.add('range-mid');

    const top = document.createElement('div');
    top.className = 'cell-top';
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = d.getDate();
    top.appendChild(num);
    const badges = document.createElement('div');
    badges.className = 'badges';
    if (note && note.remind) badges.appendChild(makeBadge('⏰', 'Reminder ' + note.remind));
    if (note && note.repeat && note.repeat !== 'none') badges.appendChild(makeBadge('🔁', 'Repeats ' + note.repeat));
    if (note && note.endKey) badges.appendChild(makeBadge('↔', 'Multi-day'));
    top.appendChild(badges);
    cell.appendChild(top);

    if (note && note.text) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = note.text;
      cell.appendChild(n);
    }
    if (note && note.tasks && note.tasks.length) {
      note.tasks.slice(0, 4).forEach((t) => cell.appendChild(taskRow(key, t)));
    }
    // multi-day continuation
    spans.slice(0, 2).forEach((n) => {
      const r = document.createElement('div');
      r.className = 'note cont';
      r.textContent = '↳ ' + (n.text || 'Event');
      cell.appendChild(r);
    });
    // recurring occurrences
    occ.slice(0, 2).forEach((n) => {
      const r = document.createElement('div');
      r.className = 'note occ';
      r.textContent = '🔁 ' + (n.text || (n.tasks && n.tasks[0] && n.tasks[0].text) || 'Event');
      cell.appendChild(r);
    });

    // Drag to move (only the start day owns the note)
    if (note) {
      cell.draggable = true;
      cell.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; });
    }
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-target'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault(); cell.classList.remove('drop-target');
      const src = e.dataTransfer.getData('text/plain');
      if (src && src !== key) moveNote(src, key);
    });

    cell.addEventListener('click', () => selectCell(key));
    cell.addEventListener('dblclick', () => openEditor(key));
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); openColorPopup(key, e.clientX, e.clientY); });
    grid.appendChild(cell);
  }
}

function taskRow(key, t) {
  const row = document.createElement('div');
  row.className = 'task' + (t.done ? ' done' : '');
  const box = document.createElement('span');
  box.className = 'box' + (t.done ? ' checked' : '');
  box.textContent = t.done ? '✓' : '';
  box.title = 'Toggle task';
  box.addEventListener('click', (e) => { e.stopPropagation(); toggleCellTask(key, t.id); });
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = t.text;
  row.appendChild(box);
  row.appendChild(label);
  return row;
}

function makeBadge(text, title) {
  const s = document.createElement('span');
  s.className = 'badge';
  s.textContent = text;
  s.title = title;
  return s;
}

function selectCell(key) { selectedKey = key; render(); }

async function moveNote(srcKey, dstKey) {
  const n = state.notes[srcKey];
  if (!n) return;
  const delta = dayDelta(srcKey, dstKey);
  const moved = { ...n };
  if (moved.endKey) moved.endKey = addDaysKey(moved.endKey, delta);
  const dst = state.notes[dstKey];
  let final = moved;
  if (dst) {
    final = { ...dst };
    final.tasks = [...(dst.tasks || []), ...(moved.tasks || [])];
    final.text = [dst.text, moved.text].filter(Boolean).join(' / ');
    final.color = dst.color || moved.color;
    if (moved.remind && !final.remind) final.remind = moved.remind;
    if (moved.endKey && !final.endKey) final.endKey = moved.endKey;
  }
  const r1 = await cal.setNote(dstKey, final);
  if (r1) state.notes[dstKey] = r1;
  await cal.setNote(srcKey, null);
  delete state.notes[srcKey];
  selectedKey = dstKey;
  render();
}

async function toggleCellTask(key, taskId) {
  const note = state.notes[key];
  if (!note || !note.tasks) return;
  const t = note.tasks.find((x) => x.id === taskId);
  if (!t) return;
  t.done = !t.done;
  const res = await cal.setNote(key, note);
  if (res) state.notes[key] = res; else delete state.notes[key];
  render();
}

function hexToRgba(hex, a) {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function prettyDate(key) {
  const dt = parseKey(key);
  return `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}
function prettyShort(key) {
  const dt = parseKey(key);
  return `${WEEKDAYS[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
}

// ---------- Editor ----------
function findOccurrenceBase(key) {
  if (state.notes[key]) return null;
  const d = parseKey(key);
  for (const k in state.notes) {
    const n = state.notes[k];
    if (n.repeat && n.repeat !== 'none' && matchesRecurrence(k, n.repeat, d) &&
      !(n.exceptions || []).includes(key)) return k;
  }
  return null;
}

function openEditor(key) {
  selectedKey = key;
  editorOccurrenceBase = findOccurrenceBase(key);
  let note;
  if (editorOccurrenceBase) {
    const b = state.notes[editorOccurrenceBase];
    note = { text: b.text || '', color: b.color || '', tasks: (b.tasks || []).map((t) => ({ ...t })), remind: b.remind || '', repeat: 'none', endKey: '' };
  } else {
    note = state.notes[key] || {};
  }
  editorColor = note.color || '';
  editorTasks = (note.tasks || []).map((t) => ({ ...t }));
  $('editorDate').textContent = prettyDate(key);
  $('editorText').value = note.text || '';
  $('editorRemind').value = note.remind || '';
  $('editorRepeat').value = note.repeat || 'none';
  $('editorEnd').value = note.endKey || '';
  $('emojiPanel').classList.add('hidden');

  const occBar = $('occBar');
  if (editorOccurrenceBase) {
    occBar.classList.remove('hidden');
    $('occText').textContent = 'Repeat of ' + prettyShort(editorOccurrenceBase) + ' — changes apply to this day only.';
  } else {
    occBar.classList.add('hidden');
  }
  renderSwatches();
  renderTaskList();
  $('editor').classList.remove('hidden');
  setTimeout(() => $('editorText').focus(), 30);
  render();
}

function closeEditor() { $('editor').classList.add('hidden'); $('emojiPanel').classList.add('hidden'); editorOccurrenceBase = null; }

function renderTaskList() {
  const ul = $('taskList');
  ul.innerHTML = '';
  editorTasks.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'task-item' + (t.done ? ' done' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!t.done;
    cb.addEventListener('change', () => { t.done = cb.checked; renderTaskList(); });
    const span = document.createElement('span');
    span.className = 'task-text';
    span.textContent = t.text;
    const del = document.createElement('button');
    del.className = 'task-del';
    del.textContent = '✕';
    del.title = 'Delete task';
    del.addEventListener('click', () => { editorTasks = editorTasks.filter((x) => x.id !== t.id); renderTaskList(); });
    li.appendChild(cb);
    li.appendChild(span);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

function addTaskFromInput() {
  const input = $('taskInput');
  const text = input.value.trim();
  if (!text) return;
  editorTasks.push({ id: uid(), text, done: false });
  input.value = '';
  renderTaskList();
  input.focus();
}

function renderSwatches() {
  const box = $('swatches');
  box.innerHTML = '';
  const none = document.createElement('div');
  none.className = 'swatch none' + (editorColor === '' ? ' active' : '');
  none.title = 'No color';
  none.addEventListener('click', () => { editorColor = ''; renderSwatches(); });
  box.appendChild(none);
  COLORS.forEach((c) => {
    const s = document.createElement('div');
    s.className = 'swatch' + (editorColor === c ? ' active' : '');
    s.style.background = c;
    s.addEventListener('click', () => { editorColor = c; renderSwatches(); });
    box.appendChild(s);
  });
}

function renderEmojiPanel() {
  const box = $('emojiPanel');
  if (box.childElementCount) return;
  EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.className = 'emoji';
    b.textContent = em;
    b.addEventListener('click', () => insertEmoji(em));
    box.appendChild(b);
  });
}

function insertEmoji(em) {
  const field = activeField && document.contains(activeField) ? activeField : $('editorText');
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + em + field.value.slice(end);
  field.focus();
  const pos = start + em.length;
  field.setSelectionRange(pos, pos);
}

async function saveEditor() {
  const text = $('editorText').value.trim();
  const tasks = editorTasks.filter((t) => t.text.trim());
  const remind = $('editorRemind').value || '';
  let repeat = $('editorRepeat').value || 'none';
  let endKey = $('editorEnd').value || '';
  if (endKey && endKey <= selectedKey) endKey = ''; // end must be after start

  if (editorOccurrenceBase) {
    // detach this occurrence: add an exception to the series, save a standalone note
    const base = { ...state.notes[editorOccurrenceBase] };
    base.exceptions = [...(base.exceptions || []), selectedKey];
    const rb = await cal.setNote(editorOccurrenceBase, base);
    if (rb) state.notes[editorOccurrenceBase] = rb;
    repeat = 'none';
  }

  const existing = (!editorOccurrenceBase && state.notes[selectedKey]) ? state.notes[selectedKey] : {};
  const has = text || editorColor || tasks.length || remind || repeat !== 'none' || endKey;
  const note = has ? { ...existing, text, color: editorColor, tasks, remind, repeat, endKey } : null;
  const res = await cal.setNote(selectedKey, note);
  if (res) state.notes[selectedKey] = res; else delete state.notes[selectedKey];
  closeEditor();
  render();
}

async function clearEditor() {
  await cal.setNote(selectedKey, null);
  delete state.notes[selectedKey];
  closeEditor();
  render();
}

async function skipOccurrence() {
  if (!editorOccurrenceBase) return;
  const base = { ...state.notes[editorOccurrenceBase] };
  base.exceptions = [...(base.exceptions || []), selectedKey];
  const rb = await cal.setNote(editorOccurrenceBase, base);
  if (rb) state.notes[editorOccurrenceBase] = rb;
  closeEditor();
  render();
}

function editSeries() {
  const base = editorOccurrenceBase;
  closeEditor();
  if (base) openEditor(base);
}

// ---------- Right-click color popup ----------
function openColorPopup(key, x, y) {
  selectedKey = key;
  const pop = $('colorPopup');
  pop.innerHTML = '';
  const mk = (color) => {
    const s = document.createElement('div');
    s.className = 'swatch' + (color === '' ? ' none' : '');
    if (color) s.style.background = color;
    s.title = color || 'No color';
    s.addEventListener('click', async () => {
      const existing = state.notes[key] || {};
      const hasOther = existing.text || (existing.tasks && existing.tasks.length) || existing.remind || (existing.repeat && existing.repeat !== 'none') || existing.endKey;
      const note = (hasOther || color) ? { ...existing, color } : null;
      const res = await cal.setNote(key, note);
      if (res) state.notes[key] = res; else delete state.notes[key];
      pop.classList.add('hidden');
      render();
    });
    pop.appendChild(s);
  };
  mk('');
  COLORS.forEach(mk);
  pop.classList.remove('hidden');
  const rect = pop.getBoundingClientRect();
  pop.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  pop.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  render();
}

// ---------- Search ----------
function openSearch() {
  $('searchPanel').classList.remove('hidden');
  $('searchInput').value = '';
  $('searchResults').innerHTML = '';
  setTimeout(() => $('searchInput').focus(), 20);
}
function closeSearch() { $('searchPanel').classList.add('hidden'); }
function runSearch(q) {
  q = q.trim().toLowerCase();
  const box = $('searchResults');
  box.innerHTML = '';
  if (!q) return;
  const matches = [];
  for (const k in state.notes) {
    const n = state.notes[k];
    const hay = ((n.text || '') + ' ' + (n.tasks || []).map((t) => t.text).join(' ')).toLowerCase();
    if (hay.includes(q)) matches.push(k);
  }
  matches.sort((a, b) => (a < b ? 1 : -1));
  if (!matches.length) { box.innerHTML = '<div class="search-empty">No matches</div>'; return; }
  matches.slice(0, 50).forEach((k) => {
    const n = state.notes[k];
    const item = document.createElement('div');
    item.className = 'search-item';
    const dt = document.createElement('div'); dt.className = 'search-date'; dt.textContent = prettyDate(k);
    const sn = document.createElement('div'); sn.className = 'search-snip';
    sn.textContent = n.text || (n.tasks || []).map((t) => (t.done ? '✓ ' : '') + t.text).join(', ');
    item.append(dt, sn);
    item.addEventListener('click', () => { jumpTo(k); closeSearch(); openEditor(k); });
    box.appendChild(item);
  });
}

function jumpTo(key) {
  const dt = parseKey(key);
  view = new Date(dt.getFullYear(), dt.getMonth(), 1);
  selectedKey = key;
  render();
}

// ---------- Agenda / upcoming ----------
function openAgenda() {
  const box = $('agendaList');
  box.innerHTML = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const items = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const dk = keyOf(d);
    const direct = state.notes[dk];
    if (direct && (direct.text || (direct.tasks && direct.tasks.length))) items.push({ dk, n: direct });
    recurringOccurrencesOn(d, dk).forEach((n) => items.push({ dk, n, recur: true }));
    spanningOn(dk).forEach((n) => items.push({ dk, n, cont: true }));
  }
  if (!items.length) { box.innerHTML = '<div class="search-empty">Nothing in the next 30 days</div>'; }
  items.forEach((it) => {
    const el = document.createElement('div');
    el.className = 'search-item';
    const dt = document.createElement('div'); dt.className = 'search-date';
    dt.textContent = prettyShort(it.dk) + (it.n.remind ? ' · ⏰ ' + it.n.remind : '');
    const sn = document.createElement('div'); sn.className = 'search-snip';
    sn.textContent = (it.recur ? '🔁 ' : '') + (it.cont ? '↳ ' : '') +
      (it.n.text || (it.n.tasks || []).map((t) => (t.done ? '✓ ' : '') + t.text).join(', '));
    el.append(dt, sn);
    el.addEventListener('click', () => { jumpTo(it.dk); $('agendaPanel').classList.add('hidden'); openEditor(it.dk); });
    box.appendChild(el);
  });
  $('agendaPanel').classList.remove('hidden');
}

// ---------- Quick add (natural language) ----------
function parseQuickAdd(raw) {
  let s = ' ' + raw.trim() + ' ';
  let remind = '';
  let tm = s.match(/\s(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i);
  if (!tm) tm = s.match(/\s(\d{1,2}):(\d{2})\s/);
  if (tm) {
    let h = +tm[1];
    let mn = tm[2] ? +tm[2] : 0;
    const ap = tm[3] ? tm[3].toLowerCase() : null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h >= 0 && h < 24 && mn < 60) { remind = pad(h) + ':' + pad(mn); s = s.replace(tm[0], ' '); }
  }
  const date = new Date(); date.setHours(0, 0, 0, 0);
  const lower = s.toLowerCase();
  const wd = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let m;
  if (/\b(today|tonight)\b/.test(lower)) { s = s.replace(/\b(today|tonight)\b/i, ' '); }
  else if (/\b(tomorrow|tmrw)\b/.test(lower)) { date.setDate(date.getDate() + 1); s = s.replace(/\b(tomorrow|tmrw)\b/i, ' '); }
  else if ((m = lower.match(/\bin (\d+) days?\b/))) { date.setDate(date.getDate() + +m[1]); s = s.replace(m[0], ' '); }
  else if ((m = lower.match(/\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/))) {
    const target = wd[m[2]];
    let diff = (target - date.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    date.setDate(date.getDate() + diff);
    s = s.replace(m[0], ' ');
  } else if ((m = lower.match(/\b([a-z]{3,9})\s+(\d{1,2})\b/)) || (m = lower.match(/\b(\d{1,2})\s+([a-z]{3,9})\b/))) {
    let mname, dy;
    if (isNaN(+m[1])) { mname = m[1]; dy = +m[2]; } else { dy = +m[1]; mname = m[2]; }
    const mi = months.findIndex((mm) => mname.startsWith(mm));
    if (mi >= 0 && dy >= 1 && dy <= 31) {
      let cand = new Date(date.getFullYear(), mi, dy);
      if (cand < date) cand = new Date(date.getFullYear() + 1, mi, dy);
      date.setTime(cand.getTime());
      s = s.replace(m[0], ' ');
    }
  }
  const title = s.replace(/\s+/g, ' ').trim();
  return { dateKey: keyOf(date), title, remind };
}

function openQuickAdd() {
  $('quickPanel').classList.remove('hidden');
  $('quickInput').value = '';
  setTimeout(() => $('quickInput').focus(), 20);
}
async function submitQuickAdd() {
  const v = $('quickInput').value;
  if (!v.trim()) return;
  const { dateKey, title, remind } = parseQuickAdd(v);
  const existing = state.notes[dateKey] || {};
  const note = { ...existing, text: existing.text ? existing.text + ' / ' + title : title, remind: remind || existing.remind || '' };
  const res = await cal.setNote(dateKey, note);
  if (res) state.notes[dateKey] = res;
  $('quickPanel').classList.add('hidden');
  jumpTo(dateKey);
}

// ---------- Settings ----------
function syncSettingsForm() {
  const s = state.settings;
  $('setTheme').value = s.theme || 'light';
  $('setWeekStart').value = String(s.weekStart || 0);
  $('setFont').value = s.fontFamily || 'system';
  $('setFontScale').value = s.fontScale ?? 1;
  $('setWeight').value = s.fontWeight || 'normal';
  $('setItalic').checked = !!s.italic;
  $('setOpacity').value = s.opacity ?? 0.97;
  $('setSpacing').value = s.cellSpacing ?? 2;
  $('setWeekNumbers').checked = !!s.showWeekNumbers;
  $('setBorders').checked = !!s.cellBorders;
  $('setHlWeekends').checked = !!s.highlightWeekends;
  $('setLead').value = String(s.reminderLeadMinutes ?? 0);
  $('setSnooze').value = String(s.snoozeMinutes ?? 10);
  $('setRollover').checked = !!s.rollOverTasks;
  $('setPin').checked = !!s.pinToDesktop;
  $('setLocked').checked = !!s.locked;
  $('setAlwaysOnTop').checked = !!s.alwaysOnTop;
  $('setAlwaysOnTop').disabled = !!s.pinToDesktop;
  $('setStartWithWindows').checked = !!s.startWithWindows;
  $('setSync').value = s.syncProvider || 'none';
  if (state.runtime && state.runtime.pinAvailable === false) $('setPin').disabled = true;
}

async function refreshSyncStatus() {
  try {
    const info = await cal.detectSync();
    const s = state.settings;
    const el = $('syncStatus');
    if (s.syncProvider === 'none') { el.textContent = 'Sync is off. Notes are stored locally.'; return; }
    if (info.current) el.textContent = 'Syncing via: ' + info.current;
    else if (s.syncProvider === 'onedrive') el.textContent = 'OneDrive folder not found on this PC.';
    else if (s.syncProvider === 'gdrive') el.textContent = 'Google Drive folder not found on this PC.';
    else el.textContent = 'No sync folder selected.';
  } catch { /* ignore */ }
}

function openSettings() {
  syncSettingsForm();
  $('dataBox').classList.add('hidden');
  $('applyImportBtn').classList.add('hidden');
  $('settingsModal').classList.remove('hidden');
  refreshSyncStatus();
  refreshFirebasePanel();
}

async function fbAuth(mode) {
  const email = $('fbEmail').value.trim();
  const password = $('fbPassword').value;
  $('fbError').textContent = '';
  if (!email || !password) { $('fbError').textContent = 'Enter email and password.'; return; }
  $('fbError').textContent = 'Working…';
  const res = mode === 'up' ? await cal.fbSignUp(email, password) : await cal.fbSignIn(email, password);
  if (res.ok) { $('fbPassword').value = ''; $('fbError').textContent = ''; updateFbAuthUI(res.state); }
  else $('fbError').textContent = res.error || 'Failed.';
}

async function pushSettings(partial) {
  state.settings = await cal.setSettings(partial);
  applySettings(state.settings);
  syncSettingsForm();
  render();
}

// ---------- Keyboard navigation ----------
function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
}
function anyOverlayOpen() {
  return !$('settingsModal').classList.contains('hidden') ||
    !$('editor').classList.contains('hidden') ||
    !$('searchPanel').classList.contains('hidden') ||
    !$('quickPanel').classList.contains('hidden') ||
    !$('agendaPanel').classList.contains('hidden');
}
function moveSel(delta) {
  const base = selectedKey ? parseKey(selectedKey) : new Date();
  base.setDate(base.getDate() + delta);
  selectedKey = keyOf(base);
  if (base.getMonth() !== view.getMonth() || base.getFullYear() !== view.getFullYear()) {
    view = new Date(base.getFullYear(), base.getMonth(), 1);
  }
  render();
}

// ---------- UI bindings ----------
function bindUI() {
  $('prev').addEventListener('click', () => { view.setMonth(view.getMonth() - 1); render(); });
  $('next').addEventListener('click', () => { view.setMonth(view.getMonth() + 1); render(); });
  $('today').addEventListener('click', () => {
    view = new Date(); view.setDate(1);
    selectedKey = keyOf(new Date());
    render();
  });
  $('title-mid').addEventListener('click', (e) => { e.stopPropagation(); openMonthPicker(); });

  $('quickBtn').addEventListener('click', (e) => { e.stopPropagation(); openQuickAdd(); });
  $('agendaBtn').addEventListener('click', (e) => { e.stopPropagation(); openAgenda(); });
  $('searchBtn').addEventListener('click', openSearch);
  $('settingsBtn').addEventListener('click', openSettings);
  $('lockBtn').addEventListener('click', () => pushSettings({ locked: !state.settings.locked }));

  $('editorClose').addEventListener('click', closeEditor);
  $('editorSave').addEventListener('click', saveEditor);
  $('editorClear').addEventListener('click', clearEditor);
  $('occSkip').addEventListener('click', skipOccurrence);
  $('occSeries').addEventListener('click', editSeries);
  $('taskAddBtn').addEventListener('click', addTaskFromInput);
  $('emojiBtn').addEventListener('click', () => { renderEmojiPanel(); $('emojiPanel').classList.toggle('hidden'); });
  $('editorText').addEventListener('focus', () => { activeField = $('editorText'); });
  $('taskInput').addEventListener('focus', () => { activeField = $('taskInput'); });
  $('taskInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTaskFromInput(); } });
  $('editorText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEditor();
    if (e.key === 'Escape') closeEditor();
  });

  $('searchInput').addEventListener('input', (e) => runSearch(e.target.value));
  $('searchClose').addEventListener('click', closeSearch);
  $('quickInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); } });
  $('quickClose').addEventListener('click', () => $('quickPanel').classList.add('hidden'));
  $('quickGo').addEventListener('click', submitQuickAdd);
  $('agendaClose').addEventListener('click', () => $('agendaPanel').classList.add('hidden'));

  $('settingsCloseBtn').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('setTheme').addEventListener('change', (e) => pushSettings({ theme: e.target.value }));
  $('setWeekStart').addEventListener('change', (e) => pushSettings({ weekStart: Number(e.target.value) }));
  $('setFont').addEventListener('change', (e) => pushSettings({ fontFamily: e.target.value }));
  $('setFontScale').addEventListener('input', (e) => pushSettings({ fontScale: Number(e.target.value) }));
  $('setWeight').addEventListener('change', (e) => pushSettings({ fontWeight: e.target.value }));
  $('setItalic').addEventListener('change', (e) => pushSettings({ italic: e.target.checked }));
  $('setOpacity').addEventListener('input', (e) => pushSettings({ opacity: Number(e.target.value) }));
  $('setSpacing').addEventListener('input', (e) => pushSettings({ cellSpacing: Number(e.target.value) }));
  $('setWeekNumbers').addEventListener('change', (e) => pushSettings({ showWeekNumbers: e.target.checked }));
  $('setBorders').addEventListener('change', (e) => pushSettings({ cellBorders: e.target.checked }));
  $('setHlWeekends').addEventListener('change', (e) => pushSettings({ highlightWeekends: e.target.checked }));
  $('setLead').addEventListener('change', (e) => pushSettings({ reminderLeadMinutes: Number(e.target.value) }));
  $('setSnooze').addEventListener('change', (e) => pushSettings({ snoozeMinutes: Number(e.target.value) }));
  $('setRollover').addEventListener('change', (e) => pushSettings({ rollOverTasks: e.target.checked }));
  $('setPin').addEventListener('change', (e) => pushSettings({ pinToDesktop: e.target.checked }));
  $('setLocked').addEventListener('change', (e) => pushSettings({ locked: e.target.checked }));
  $('setAlwaysOnTop').addEventListener('change', (e) => pushSettings({ alwaysOnTop: e.target.checked }));
  $('setStartWithWindows').addEventListener('change', (e) => pushSettings({ startWithWindows: e.target.checked }));

  $('setSync').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (v === 'custom') {
      const folder = await cal.pickSyncFolder();
      if (!folder) { e.target.value = state.settings.syncProvider || 'none'; return; }
      await pushSettings({ syncProvider: 'custom', syncFolder: folder });
    } else {
      await pushSettings({ syncProvider: v });
    }
    refreshSyncStatus();
    refreshFirebasePanel();
  });

  $('fbSaveConfig').addEventListener('click', async () => {
    const apiKey = $('fbApiKey').value.trim();
    const databaseURL = $('fbDbUrl').value.trim();
    await pushSettings({ syncProvider: 'firebase', firebaseConfig: { apiKey, databaseURL } });
    $('fbError').textContent = 'Config saved. Now sign in or create an account.';
    refreshFirebasePanel();
  });
  $('fbSignIn').addEventListener('click', () => fbAuth('in'));
  $('fbSignUp').addEventListener('click', () => fbAuth('up'));
  $('fbSignOut').addEventListener('click', async () => { await cal.fbSignOut(); updateFbAuthUI(null); });
  $('fbPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') fbAuth('in'); });

  $('exportBtn').addEventListener('click', async () => {
    const box = $('dataBox');
    box.classList.remove('hidden');
    box.value = await cal.exportData();
    box.select();
    $('applyImportBtn').classList.add('hidden');
  });
  $('importBtn').addEventListener('click', () => {
    const box = $('dataBox');
    box.classList.remove('hidden');
    box.value = '';
    $('applyImportBtn').classList.remove('hidden');
  });
  $('applyImportBtn').addEventListener('click', async () => {
    const res = await cal.importData($('dataBox').value);
    if (res.ok) {
      state.notes = res.state.notes;
      state.settings = res.state.settings;
      applySettings(state.settings);
      $('settingsModal').classList.add('hidden');
      render();
    } else {
      alert('Import failed: ' + res.error);
    }
  });

  document.addEventListener('click', (e) => {
    for (const id of ['colorPopup', 'monthPicker']) {
      const pop = $(id);
      if (!pop.classList.contains('hidden') && !pop.contains(e.target)) pop.classList.add('hidden');
    }
    const ep = $('emojiPanel');
    if (!ep.classList.contains('hidden') && !ep.contains(e.target) && e.target.id !== 'emojiBtn') ep.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['colorPopup', 'monthPicker', 'emojiPanel', 'settingsModal', 'searchPanel', 'quickPanel', 'agendaPanel'].forEach((id) => $(id).classList.add('hidden'));
      closeEditor();
      return;
    }
    if (isTyping() || anyOverlayOpen()) return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveSel(-1); break;
      case 'ArrowRight': e.preventDefault(); moveSel(1); break;
      case 'ArrowUp': e.preventDefault(); moveSel(-7); break;
      case 'ArrowDown': e.preventDefault(); moveSel(7); break;
      case 'PageUp': view.setMonth(view.getMonth() - 1); render(); break;
      case 'PageDown': view.setMonth(view.getMonth() + 1); render(); break;
      case 'Enter': openEditor(selectedKey || keyOf(new Date())); break;
      case 't': case 'T': view = new Date(); view.setDate(1); selectedKey = keyOf(new Date()); render(); break;
      case '/': e.preventDefault(); openSearch(); break;
      case 'a': case 'A': openAgenda(); break;
      case 'n': case 'N': openQuickAdd(); break;
    }
  });
}

// ---------- Month/Year picker ----------
function openMonthPicker() {
  const pop = $('monthPicker');
  pop.innerHTML = '';
  let pYear = view.getFullYear();
  const head = document.createElement('div');
  head.className = 'mp-head';
  const yLabel = document.createElement('span'); yLabel.className = 'mp-year';
  const prevY = document.createElement('button'); prevY.textContent = '‹'; prevY.className = 'nav-btn';
  const nextY = document.createElement('button'); nextY.textContent = '›'; nextY.className = 'nav-btn';
  prevY.addEventListener('click', () => { pYear--; build(); });
  nextY.addEventListener('click', () => { pYear++; build(); });
  head.append(prevY, yLabel, nextY);
  const grid = document.createElement('div'); grid.className = 'mp-grid';
  pop.append(head, grid);
  function build() {
    yLabel.textContent = pYear;
    grid.innerHTML = '';
    MONTHS.forEach((mn, i) => {
      const b = document.createElement('button');
      b.className = 'mp-month' + (i === view.getMonth() && pYear === view.getFullYear() ? ' active' : '');
      b.textContent = mn.slice(0, 3);
      b.addEventListener('click', () => { view = new Date(pYear, i, 1); pop.classList.add('hidden'); render(); });
      grid.appendChild(b);
    });
  }
  build();
  pop.classList.remove('hidden');
}

init();
