const STATUSES = [
  ['backlog', 'Backlog'], ['ready', 'Ready'], ['progress', 'In Progress'],
  ['review', 'In Review'], ['done', 'Done'], ['cancelled', 'Cancelled'],
];
const TASKS_KEY = 'planning-board:tasks';
const THEME_KEY = 'planning-board:theme';
const ROOM_KEY = 'planning-board:room';
const DEFAULT_STATUS = STATUSES[0][0];
const root = document.documentElement;
const board = document.querySelector('main');
const dialog = document.getElementById('task-dialog');
const help = document.getElementById('help');
const form = dialog.querySelector('form');
const fields = form.elements;
const deleteButton = document.getElementById('delete');
const search = document.getElementById('search');
const dialogTitle = dialog.querySelector('h3');
const storageToast = document.getElementById('storage-full');
// The longest theme value, with its key.
const SETTINGS_ROOM = THEME_KEY.length + 'light'.length;
// Storage counts as full when not even this would fit.
const SMALLEST_TASK = JSON.stringify({ id: crypto.randomUUID(), title: 'x', description: '', status: DEFAULT_STATUS }).length + 1;
// Matches the .list gap in styles.css.
const GAP = 8;
// Keyed by text, so an edited card is measured again.
const heights = new Map();
// join() because imported tasks may lack a description.
const textOf = t => [t.title, t.description].join('\n');
const byId = id => x => x.id === id;
// Carries data over from the old unprefixed keys, which are left in place since another local page may own them.
for (const [oldKey, newKey] of [['tasks', TASKS_KEY], ['theme', THEME_KEY]]) {
  const old = localStorage.getItem(oldKey);
  if (old !== null && localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
}
let tasks = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
let editingId = null;

// Keyboard only, but the pointer may still select text: presses on controls neither focus them nor open a select, clicks do nothing, and the wheel does not scroll.
const pointerHint = document.getElementById('pointer-hint');
let hintTimer;
let pressedAt;
addEventListener('mousedown', e => {
  pressedAt = [e.clientX, e.clientY];
  if (e.target.closest('button, select')) e.preventDefault();
});
// A click from Enter or Space has no click count, so the keyboard still activates buttons; a click that ends a drag is a selection, so it stays quiet.
addEventListener('click', e => {
  if (!e.detail) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > 3) return;
  pointerHint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { pointerHint.hidden = true; }, 3000);
}, true);
addEventListener('wheel', e => e.preventDefault(), { passive: false });

root.dataset.theme = localStorage.getItem(THEME_KEY)
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
// The theme is written directly: hasRoom() reserves space for it, so it cannot hit the quota.
document.getElementById('theme').onclick = e => {
  // Enabled on the first toggle only, so applying the stored theme on load does not animate.
  e.currentTarget.classList.add('animate');
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, root.dataset.theme);
};

const columns = STATUSES.map(([id, name]) => {
  board.insertAdjacentHTML('beforeend',
    `<section data-status="${id}"><h2>${name}<span></span></h2><div class="list"></div></section>`);
  const section = board.lastElementChild;
  fields.status.add(new Option(name, id));
  const column = { id, list: section.querySelector('.list'), counter: section.querySelector('span'), items: [], sizes: [], start: 0, end: 0 };
  column.list.onscroll = () => layout(column);
  return column;
});

// Marks every match of the search; empty slices are skipped so an empty description still matches :empty.
function setText(el, text) {
  el.replaceChildren();
  let i = 0;
  for (const m of pattern ? text.matchAll(pattern) : []) {
    if (m.index > i) el.append(text.slice(i, m.index));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    el.append(mark);
    i = m.index + m[0].length;
  }
  if (i < text.length) el.append(text.slice(i));
}

function createCard(task) {
  const el = document.createElement('article');
  el.className = 'task';
  el.tabIndex = 0;
  el.innerHTML = '<strong></strong><p></p>';
  setText(el.querySelector('strong'), task.title);
  setText(el.querySelector('p'), task.description ?? '');
  el.dataset.id = task.id;
  return el;
}

// Only the cards within a screen of the view are built; spacers stand in for the rest at their measured heights.
function layout(column) {
  const { list, items, sizes } = column;
  const top = list.scrollTop - list.clientHeight;
  const bottom = list.scrollTop + 2 * list.clientHeight;
  let i = 0;
  let above = 0;
  while (i < items.length && above + sizes[i] < top) above += sizes[i++];
  const start = i;
  let y = above;
  while (i < items.length && y < bottom) y += sizes[i++];
  const end = i;
  let below = 0;
  while (i < items.length) below += sizes[i++];
  if (start >= column.end || end <= column.start) {
    list.replaceChildren(...items.slice(start, end).map(createCard));
  } else {
    const cards = list.children;
    for (; column.start < start; column.start++) cards[0].remove();
    for (; column.end > end; column.end--) cards[cards.length - 1].remove();
    list.prepend(...items.slice(start, column.start).map(createCard));
    list.append(...items.slice(column.end, end).map(createCard));
  }
  column.start = start;
  column.end = end;
  list.style.setProperty('--above', `${above}px`);
  list.style.setProperty('--below', `${below}px`);
}

// Each new text is measured once, in its own column, after the built cards so the scroll position is untouched.
function measureNew() {
  const fresh = tasks.filter(t => !heights.has(textOf(t)));
  const cards = fresh.map(createCard);
  cards.forEach((card, i) => columns.find(byId(fresh[i].status)).list.append(card));
  cards.forEach((card, i) => heights.set(textOf(fresh[i]), card.getBoundingClientRect().height));
  cards.forEach(card => card.remove());
}

// A new search starts each column at the top; any other change keeps the scroll position.
let lastQuery = '';
let pattern = null;
function render() {
  // Rebuilding the cards drops focus, so it is carried over by id.
  const focusedId = board.contains(document.activeElement) ? document.activeElement.dataset.id : undefined;
  measureNew();
  const query = search.value.trim().toLowerCase();
  const newSearch = query !== lastQuery;
  lastQuery = query;
  pattern = query && new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = t => textOf(t).search(pattern) !== -1;
  for (const column of columns) {
    const all = tasks.filter(t => t.status === column.id);
    column.items = query ? all.filter(matches) : all;
    column.sizes = column.items.map(t => heights.get(textOf(t)) + GAP);
    column.counter.textContent = query ? `${column.items.length}/${all.length}` : all.length;
    column.start = column.end = 0;
    if (newSearch) column.list.scrollTop = 0;
    layout(column);
  }
  if (focusedId) focusTask(focusedId);
}

// A task outside the built window is scrolled to first, so its card exists.
function focusTask(id) {
  const task = tasks.find(byId(id));
  const column = task && columns.find(byId(task.status));
  const index = column ? column.items.indexOf(task) : -1;
  if (index === -1) return;
  if (index < column.start || index >= column.end) {
    column.list.scrollTop = column.sizes.slice(0, index).reduce((a, b) => a + b, 0);
    layout(column);
  }
  column.list.children[index - column.start].focus();
}

// Wrapping follows the column width, so every card is measured again once resizing settles.
let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    heights.clear();
    render();
  }, 150);
});

// False only when storage is full; any other failure is a real error.
function store(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e.name !== 'QuotaExceededError') throw e;
    return false;
  }
}

// The extra room keeps the board name and theme saveable, as an export cannot bring them back.
function hasRoom(chars) {
  const fits = store(ROOM_KEY, 'x'.repeat(chars + SETTINGS_ROOM));
  localStorage.removeItem(ROOM_KEY);
  return fits;
}

// Whole snapshots, so every kind of change undoes the same way.
const past = [];
const future = [];
function saveTasks(record = true) {
  const json = JSON.stringify(tasks);
  const before = localStorage.getItem(TASKS_KEY) ?? '[]';
  const growth = json.length - before.length;
  // Room is proven before writing, so other tabs never see a change that has to be taken back.
  const saved = (growth <= 0 || hasRoom(growth)) && store(TASKS_KEY, json);
  if (saved && record && json !== before) {
    past.push(before);
    future.length = 0;
  }
  storageToast.hidden = saved && hasRoom(SMALLEST_TASK);
  render();
}
function travel(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(tasks));
  tasks = JSON.parse(from.pop());
  saveTasks(false);
}
document.getElementById('storage-dismiss').onclick = () => { storageToast.hidden = true; };

search.oninput = render;
search.onfocus = () => search.select();
search.onkeydown = e => {
  if (e.key === 'Enter') focusFirst();
};
function focusFirst() {
  const first = columns.find(c => c.items.length)?.items[0];
  if (first) focusTask(first.id);
  return Boolean(first);
}
// Shift is left out: it types ?.
const hasModifier = e => e.ctrlKey || e.metaKey || e.altKey;
const typesHere = e => e.target.matches('input, textarea, select');
const actions = {
  f: () => search.focus(),
  '?': openHelp,
  n: () => openDialog(null),
  c: () => {
    search.value = '';
    render();
  },
  u: () => travel(past, future),
  y: () => travel(future, past),
};
document.addEventListener('keydown', e => {
  // Esc closes an open dialog natively.
  if (anyOpen()) return;
  const key = hasModifier(e) || typesHere(e) ? '' : e.key.toLowerCase();
  if (e.key === 'Escape') return e.target.blur();
  if (key in actions) {
    e.preventDefault();
    actions[key]();
  } else if (key in STEPS && e.target === document.body) {
    e.preventDefault();
    // With nothing focused there is no position to measure from: I starts the toolbar at its first button, the rest start at the first card.
    if (key === 'i' || !focusFirst()) toolbar[0].focus();
  }
});

// Lowercased so Shift and Caps Lock change nothing.
const STEPS = { j: [-1, 0], l: [1, 0], i: [0, -1], k: [0, 1] };
const stepOf = e => STEPS[e.key.toLowerCase()];
// Held rather than toggled, so letting go always ends moving; leaving the window fires no keyup, so blur ends it too.
let holdingG = false;
for (const type of ['keydown', 'keyup']) addEventListener(type, e => {
  if (e.key.toLowerCase() === 'g') holdingG = type === 'keydown';
});
addEventListener('blur', () => { holdingG = false; });
// The search is left out: the letters type there.
const toolbar = [...document.querySelectorAll('nav button')];
const centerX = el => el.getBoundingClientRect().left + el.offsetWidth / 2;
// Moving between the toolbar and the columns keeps the horizontal position, like moving between columns keeps the row.
const nearestTo = (x, list, elOf) => list.reduce((a, b) => Math.abs(centerX(elOf(b)) - x) < Math.abs(centerX(elOf(a)) - x) ? b : a);
document.querySelector('nav').onkeydown = e => {
  const i = toolbar.indexOf(e.target);
  if (i === -1 || !stepOf(e) || hasModifier(e)) return;
  e.preventDefault();
  const [dx, dy] = stepOf(e);
  if (dx) {
    toolbar[i + dx]?.focus();
  } else if (dy > 0) {
    const filled = columns.filter(c => c.items.length);
    if (filled.length) focusTask(nearestTo(centerX(e.target), filled, c => c.list).items[0].id);
  }
};
// IJKL move focus between cards; with G held they move the focused task instead.
board.onkeydown = e => {
  const card = e.target.closest('.task');
  if (!card || hasModifier(e)) return;
  const task = tasks.find(byId(card.dataset.id));
  if (e.key === 'Enter') {
    e.preventDefault();
    openDialog(task);
    return;
  }
  if (!stepOf(e)) return;
  e.preventDefault();
  const [dx, dy] = stepOf(e);
  const c = columns.findIndex(byId(task.status));
  const { items } = columns[c];
  const i = items.indexOf(task);
  if (holdingG) {
    if (dx) {
      const target = columns[c + dx];
      if (!target) return;
      moveTask(task.id, target.id, target.items[i]?.id ?? null);
    } else {
      if (!items[i + dy]) return;
      // Moving down means landing before the task after the next one.
      moveTask(task.id, task.status, items[i + (dy < 0 ? -1 : 2)]?.id ?? null);
    }
    saveTasks();
  } else if (dx) {
    // Empty columns are skipped; the row is kept where the next column is long enough.
    for (let n = c + dx; columns[n]; n += dx) {
      const next = columns[n].items;
      if (next.length) return focusTask(next[Math.min(i, next.length - 1)].id);
    }
  } else if (items[i + dy]) {
    focusTask(items[i + dy].id);
  } else if (dy < 0) {
    nearestTo(centerX(columns[c].list), toolbar, b => b).focus();
  }
};

function openDialog(task) {
  editingId = task?.id ?? null;
  dialogTitle.textContent = task ? 'Edit task' : 'New task';
  fields.title.value = task?.title ?? '';
  fields.description.value = task?.description ?? '';
  fields.status.value = task?.status ?? DEFAULT_STATUS;
  deleteButton.hidden = !task;
  setHash(task ? hashOf(task) : '#new');
  dialog.showModal();
}

function openHelp() {
  setHash('#help');
  help.showModal();
}

// Replaced rather than pushed, so dialogs leave no history entries; this fires no hashchange either.
const setHash = hash => history.replaceState(null, '', hash || location.pathname + location.search);
const hashOf = task => `#${encodeURIComponent(task.id)}`;
const anyOpen = () => dialog.open || help.open;

// The hash names the open dialog, so it can be linked to and survives a reload; an unknown one is dropped.
function openFromHash() {
  const hash = location.hash;
  dialog.close();
  help.close();
  const task = tasks.find(t => hashOf(t) === hash);
  if (hash === '#help') openHelp();
  else if (hash === '#new') openDialog(null);
  else if (task) openDialog(task);
  else setHash('');
}
addEventListener('hashchange', openFromHash);

form.onkeydown = e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    form.requestSubmit();
  }
};
form.onsubmit = () => {
  const data = {
    title: fields.title.value.trim(),
    description: fields.description.value.trim(),
    status: fields.status.value,
  };
  // Looked up by id because a sync from another tab replaces the task objects; a task deleted there is re-created.
  const task = tasks.find(byId(editingId));
  if (task) {
    if (task.status !== data.status) moveTask(task.id, data.status, null);
    Object.assign(task, data);
  } else {
    tasks.push({ id: crypto.randomUUID(), ...data });
  }
  saveTasks();
};

document.getElementById('add').onclick = () => openDialog(null);
document.getElementById('help-button').onclick = openHelp;
document.getElementById('cancel').onclick = () => dialog.close();
deleteButton.onclick = () => {
  tasks = tasks.filter(t => t.id !== editingId);
  dialog.close();
  saveTasks();
};
// Close events arrive late, so one may come after the hash already opened another dialog; it is then ignored.
// Opened by a shortcut, there is no focus to restore, so it would stay on a hidden element and block the shortcuts.
function settleClose(d) {
  if (anyOpen()) return false;
  if (d.contains(document.activeElement)) document.activeElement.blur();
  setHash('');
  return true;
}
help.onclose = () => settleClose(help);
// Saving rebuilds the cards, so focus goes back to the edited task by id.
dialog.onclose = () => {
  if (settleClose(dialog) && editingId) focusTask(editingId);
};

// Fires only in other tabs, which have already saved the change.
addEventListener('storage', e => {
  if (e.key === TASKS_KEY) {
    tasks = JSON.parse(e.newValue || '[]');
    // Undoing here would silently revert the other tab's change, so history starts over.
    past.length = 0;
    future.length = 0;
    render();
  } else if (e.key === THEME_KEY && e.newValue) {
    root.dataset.theme = e.newValue;
  }
});

// The array order is the column order, so moving means re-inserting before another task, or at the end when beforeId is null.
function moveTask(id, status, beforeId) {
  const task = tasks.find(byId(id));
  if (!task || id === beforeId) return;
  tasks.splice(tasks.indexOf(task), 1);
  task.status = status;
  // A target removed by another tab yields -1, which falls back to the end.
  const index = tasks.findIndex(byId(beforeId));
  tasks.splice(index === -1 ? tasks.length : index, 0, task);
}

document.getElementById('export').onclick = () => {
  const link = document.createElement('a');
  link.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(tasks, null, 2));
  // Swedish dates are ISO-shaped and, unlike toISOString(), in local time.
  link.download = `${document.title}-${new Date().toLocaleDateString('sv')}.json`;
  link.click();
};

function parseTasks(text) {
  try {
    const data = JSON.parse(text);
    const isTask = t => typeof t?.id === 'string' && typeof t.title === 'string'
      && STATUSES.some(([id]) => id === t.status);
    return Array.isArray(data) && data.every(isTask) ? data : null;
  } catch {
    return null;
  }
}

const importFile = document.getElementById('import-file');
document.getElementById('import').onclick = () => importFile.click();
importFile.onchange = async () => {
  const imported = parseTasks(await importFile.files[0].text());
  // Without the reset, picking the same file again fires no change event.
  importFile.value = '';
  if (!imported) {
    alert('That file is not a planning board export.');
    return;
  }
  if (tasks.length && !confirm(`Replace the ${tasks.length} current tasks with the ${imported.length} in the file?`)) return;
  tasks = imported;
  saveTasks();
};

document.getElementById('delete-all').onclick = () => {
  const n = tasks.length;
  if (!n) return;
  const what = n === 1 ? 'the 1 task' : `all ${n} tasks`;
  if (!confirm(`Delete ${what}?`)) return;
  tasks = [];
  saveTasks();
};

render();
storageToast.hidden = hasRoom(SMALLEST_TASK);
openFromHash();
