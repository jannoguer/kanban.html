const STATUSES = [
  ['backlog', 'Backlog'], ['ready', 'Ready'], ['progress', 'In Progress'],
  ['review', 'In Review'], ['done', 'Done'], ['cancelled', 'Cancelled'],
];
const TASKS_KEY = 'planning-board:tasks';
const THEME_KEY = 'planning-board:theme';
const NAME_KEY = 'planning-board:name';
const ROOM_KEY = 'planning-board:room';
const DEFAULT_NAME = 'PLANNING BOARD';
const DEFAULT_STATUS = STATUSES[0][0];
const DRAG_TYPE = 'application/x-planning-board-task';
const root = document.documentElement;
const board = document.querySelector('main');
const dialog = document.getElementById('task-dialog');
const help = document.getElementById('help');
const form = dialog.querySelector('form');
const fields = form.elements;
const deleteButton = document.getElementById('delete');
const boardName = document.getElementById('board-name');
const search = document.getElementById('search');
const dialogTitle = dialog.querySelector('h3');
const undoToast = document.getElementById('undo-toast');
const undoButton = document.getElementById('undo');
const undoTitle = undoToast.querySelector('.title');
const undoCountdown = undoToast.querySelector('.countdown');
const storageToast = document.getElementById('storage-full');
// Longest board name and theme values, with their keys.
const SETTINGS_ROOM = NAME_KEY.length + boardName.maxLength + THEME_KEY.length + 'light'.length;
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

root.dataset.theme = localStorage.getItem(THEME_KEY)
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
// Theme and name are written directly: hasRoom() reserves space for them, so they cannot hit the quota.
document.getElementById('theme').onclick = e => {
  // Enabled on first click only, so applying the stored theme on load does not animate.
  e.currentTarget.classList.add('animate');
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, root.dataset.theme);
};

function saveName(value) {
  const name = value.trim() || DEFAULT_NAME;
  document.title = name;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

// Null when not editing. Tracked by focus/blur because activeElement stays set while the tab is in the background.
let nameBeforeEdit = null;
boardName.value = document.title = localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
boardName.onfocus = () => { nameBeforeEdit = boardName.value; };
boardName.onblur = () => {
  boardName.value = saveName(boardName.value);
  nameBeforeEdit = null;
};
boardName.onkeydown = e => {
  if (e.key === 'Enter') boardName.blur();
};
// Closing or reloading mid-edit fires no blur, so the edit is committed here.
addEventListener('pagehide', () => {
  if (nameBeforeEdit !== null) saveName(boardName.value);
});

const columns = STATUSES.map(([id, name]) => {
  board.insertAdjacentHTML('beforeend',
    `<section data-status="${id}"><h2>${name}<span></span></h2><div class="list"></div></section>`);
  const section = board.lastElementChild;
  fields.status.add(new Option(name, id));
  const column = { id, list: section.querySelector('.list'), counter: section.querySelector('span'), items: [], sizes: [], start: 0, end: 0 };
  column.list.onclick = e => {
    if (!e.target.closest('.task')) openDialog(null, id);
  };
  column.list.onscroll = () => layout(column);
  return column;
});

function createCard(task) {
  const el = document.createElement('article');
  el.className = 'task';
  el.draggable = true;
  el.tabIndex = 0;
  el.innerHTML = '<strong></strong><p></p>';
  el.querySelector('strong').textContent = task.title;
  el.querySelector('p').textContent = task.description;
  el.dataset.id = task.id;
  el.onclick = () => openDialog(task);
  el.ondragstart = e => {
    e.dataTransfer.setData(DRAG_TYPE, task.id);
    e.dataTransfer.effectAllowed = 'move';
    // Deferred so the drag image is captured before the card is dimmed.
    requestAnimationFrame(() => el.classList.add('dragging'));
  };
  el.ondragend = () => {
    el.classList.remove('dragging');
    marker.remove();
  };
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
    // Live, and skips the drop marker.
    const cards = list.getElementsByClassName('task');
    // Only the edges change, so a card being dragged stays in place.
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
function render() {
  // Rebuilding the cards drops focus, so it is carried over by id.
  const focusedId = board.contains(document.activeElement) ? document.activeElement.dataset.id : undefined;
  measureNew();
  const query = search.value.trim().toLowerCase();
  const newSearch = query !== lastQuery;
  lastQuery = query;
  const matches = t => textOf(t).toLowerCase().includes(query);
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
  column.list.getElementsByClassName('task')[index - column.start].focus();
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

function saveTasks() {
  const json = JSON.stringify(tasks);
  const growth = json.length - (localStorage.getItem(TASKS_KEY)?.length ?? 0);
  // Room is proven before writing, so other tabs never see a change that has to be taken back.
  const saved = (growth <= 0 || hasRoom(growth)) && store(TASKS_KEY, json);
  storageToast.hidden = saved && hasRoom(SMALLEST_TASK);
  render();
}
document.getElementById('storage-dismiss').onclick = () => { storageToast.hidden = true; };

search.oninput = render;
// The mouseup of a focusing click would collapse the selection, so that one is cancelled; a click into the focused field still places the caret.
let selectedOnFocus = false;
search.onfocus = () => {
  search.select();
  selectedOnFocus = true;
};
search.onmousedown = () => { selectedOnFocus = false; };
search.onmouseup = e => {
  if (selectedOnFocus) e.preventDefault();
  selectedOnFocus = false;
};
search.onkeydown = e => {
  if (e.key === 'Enter') focusFirst();
};
function focusFirst() {
  const first = columns.find(c => c.items.length)?.items[0];
  if (first) focusTask(first.id);
}
// Esc cancels what the focused control is doing and drops the focus.
function escape() {
  const el = document.activeElement;
  if (el === boardName) boardName.value = nameBeforeEdit;
  if (el === search) {
    search.value = '';
    render();
  }
  el.blur();
}
document.addEventListener('keydown', e => {
  if (anyOpen()) return;
  if (e.key === 'Escape') return escape();
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches('input, textarea, select')) return;
  if (e.key === '/') {
    e.preventDefault();
    search.focus();
  } else if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openDialog(null);
  } else if (e.key === '?') {
    e.preventDefault();
    openHelp();
  } else if (e.key in STEPS && e.target === document.body) {
    e.preventDefault();
    focusFirst();
  }
});

const STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// The board name and search are left out: the arrows edit text there.
const toolbar = [...document.querySelectorAll('nav button')];
const centerX = el => el.getBoundingClientRect().left + el.offsetWidth / 2;
// Moving between the toolbar and the columns keeps the horizontal position, like moving between columns keeps the row.
const nearestTo = (x, list, elOf) => list.reduce((a, b) => Math.abs(centerX(elOf(b)) - x) < Math.abs(centerX(elOf(a)) - x) ? b : a);
document.querySelector('nav').onkeydown = e => {
  const i = toolbar.indexOf(e.target);
  if (i === -1 || !(e.key in STEPS) || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  const [dx, dy] = STEPS[e.key];
  if (dx) {
    toolbar[i + dx]?.focus();
  } else if (dy > 0) {
    const filled = columns.filter(c => c.items.length);
    if (filled.length) focusTask(nearestTo(centerX(e.target), filled, c => c.list).items[0].id);
  }
};
// Arrows move focus between cards; with Shift they move the focused task instead.
board.onkeydown = e => {
  const card = e.target.closest('.task');
  if (!card || e.ctrlKey || e.metaKey || e.altKey) return;
  const task = tasks.find(byId(card.dataset.id));
  if (e.key === 'Enter') {
    e.preventDefault();
    openDialog(task);
    return;
  }
  if (!(e.key in STEPS)) return;
  e.preventDefault();
  const [dx, dy] = STEPS[e.key];
  const c = columns.findIndex(byId(task.status));
  const { items } = columns[c];
  const i = items.indexOf(task);
  if (e.shiftKey) {
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

function openDialog(task, status = DEFAULT_STATUS) {
  editingId = task?.id ?? null;
  dialogTitle.textContent = task ? 'Edit task' : 'New task';
  fields.title.value = task?.title ?? '';
  fields.description.value = task?.description ?? '';
  fields.status.value = task?.status ?? status;
  deleteButton.hidden = !task;
  setHash(task ? `#${encodeURIComponent(task.id)}` : '#new');
  dialog.showModal();
}

function openHelp() {
  setHash('#help');
  help.showModal();
}

// Replaced rather than pushed, so dialogs leave no history entries; this fires no hashchange either.
const setHash = hash => history.replaceState(null, '', hash || location.pathname + location.search);
const anyOpen = () => dialog.open || help.open;

// The hash names the open dialog, so it can be linked to and survives a reload; an unknown one is dropped.
function openFromHash() {
  const hash = location.hash;
  dialog.close();
  help.close();
  const task = tasks.find(t => `#${encodeURIComponent(t.id)}` === hash);
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
// The bar's animation is the timer, so the bar and the hide can never drift apart.
let countdown;
function hideToast() {
  countdown?.cancel();
  undoToast.hidden = true;
}
deleteButton.onclick = () => {
  // -1 when another tab already deleted it.
  const index = tasks.findIndex(byId(editingId));
  if (index !== -1) {
    const [task] = tasks.splice(index, 1);
    undoButton.onclick = () => {
      // Skipped if another tab restored it meanwhile; an index past the end appends.
      if (!tasks.some(byId(task.id))) tasks.splice(index, 0, task);
      hideToast();
      saveTasks();
    };
    undoTitle.textContent = task.title;
    countdown?.cancel();
    undoToast.hidden = false;
    countdown = undoCountdown.animate([{ scale: '1 1' }, { scale: '0 1' }], 5000);
    countdown.onfinish = hideToast;
  }
  dialog.close();
  saveTasks();
};
// Clicks on the dialog element itself (not the form) land on the backdrop.
for (const d of [dialog, help]) d.onclick = e => {
  if (e.target === d) d.close();
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
    render();
  } else if (e.key === THEME_KEY && e.newValue) {
    root.dataset.theme = e.newValue;
  } else if (e.key === NAME_KEY && e.newValue && nameBeforeEdit === null) {
    // An edit in progress here is left alone; it saves its own value when it finishes.
    boardName.value = document.title = e.newValue;
  }
});

// The array order is the column order, so moving means re-inserting before another task, or at the end when beforeId is null.
function moveTask(id, status, beforeId) {
  const task = tasks.find(byId(id));
  if (!task || id === beforeId) return;
  tasks.splice(tasks.indexOf(task), 1);
  task.status = status;
  // A target removed by another tab mid-drag yields -1, which falls back to the end.
  const index = tasks.findIndex(byId(beforeId));
  tasks.splice(index === -1 ? tasks.length : index, 0, task);
}

function dropPoint(e) {
  const list = e.target.closest('section')?.querySelector('.list');
  if (!list) return null;
  const before = [...list.querySelectorAll('.task:not(.dragging)')].find(card => {
    const box = card.getBoundingClientRect();
    return e.clientY < box.top + box.height / 2;
  });
  return { list, before: before ?? null };
}

const marker = document.createElement('div');
marker.className = 'drop-marker';
// Checked by type because the data itself is unreadable until drop; this also ignores dragged files and text.
const isTaskDrag = e => e.dataTransfer.types.includes(DRAG_TYPE);

board.ondragover = e => {
  if (!isTaskDrag(e)) return;
  e.preventDefault();
  const point = dropPoint(e);
  if (point) point.list.insertBefore(marker, point.before);
  else marker.remove();
};
board.ondragleave = e => {
  if (!board.contains(e.relatedTarget)) marker.remove();
};
board.ondrop = e => {
  if (!isTaskDrag(e)) return;
  e.preventDefault();
  marker.remove();
  const point = dropPoint(e);
  if (!point) return;
  moveTask(e.dataTransfer.getData(DRAG_TYPE), point.list.parentElement.dataset.status, point.before?.dataset.id ?? null);
  saveTasks();
};

document.getElementById('export').onclick = () => {
  const link = document.createElement('a');
  link.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(tasks, null, 2));
  // Swedish dates are ISO-shaped and, unlike toISOString(), in local time.
  link.download = `${boardName.value}-${new Date().toLocaleDateString('sv')}.json`;
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

render();
storageToast.hidden = hasRoom(SMALLEST_TASK);
openFromHash();
