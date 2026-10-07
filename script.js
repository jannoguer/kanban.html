const STATUSES = [
  ['backlog', 'Backlog'], ['ready', 'Ready'], ['progress', 'In Progress'],
  ['review', 'In Review'], ['done', 'Done'], ['cancelled', 'Cancelled'],
];
const TASKS_KEY = 'planning-board:tasks';
const THEME_KEY = 'planning-board:theme';
const NAME_KEY = 'planning-board:name';
const DEFAULT_NAME = 'PLANNING BOARD';
const DRAG_TYPE = 'application/x-planning-board-task';
const root = document.documentElement;
const board = document.querySelector('main');
const dialog = document.querySelector('dialog');
const form = dialog.querySelector('form');
const fields = form.elements;
const deleteButton = document.getElementById('delete');
const boardName = document.getElementById('board-name');
const search = document.getElementById('search');
const toast = document.getElementById('toast');
// Carries data over from the old unprefixed keys, which are left in place since another local page may own them.
for (const [oldKey, newKey] of [['tasks', TASKS_KEY], ['theme', THEME_KEY]]) {
  const old = localStorage.getItem(oldKey);
  if (old !== null && localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
}
let tasks = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
let editingId = null;

root.dataset.theme = localStorage.getItem(THEME_KEY)
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
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
  if (e.key === 'Escape') boardName.value = nameBeforeEdit;
  if (e.key === 'Enter' || e.key === 'Escape') boardName.blur();
};
// Closing or reloading mid-edit fires no blur, so the edit is committed here.
addEventListener('pagehide', () => {
  if (nameBeforeEdit !== null) saveName(boardName.value);
});

const PLUS_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
for (const [id, name] of STATUSES) {
  board.insertAdjacentHTML('beforeend',
    `<section data-status="${id}"><h2>${name}<span></span><button aria-label="Add task to ${name}">${PLUS_ICON}</button></h2><div class="list"></div></section>`);
  board.lastElementChild.querySelector('button').onclick = () => openDialog(null, id);
  fields.status.add(new Option(name, id));
}

function createCard(task) {
  const el = document.createElement('article');
  el.className = 'task';
  el.draggable = true;
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

function render() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  const query = search.value.trim().toLowerCase();
  // join() because imported tasks may lack a description.
  const matches = t => [t.title, t.description].join('\n').toLowerCase().includes(query);
  for (const section of board.children) {
    const items = tasks.filter(t => t.status === section.dataset.status);
    const shown = items.filter(matches);
    section.querySelector('span').textContent = query ? `${shown.length}/${items.length}` : items.length;
    section.querySelector('.list').replaceChildren(...shown.map(createCard));
  }
}

search.oninput = render;
search.onkeydown = e => {
  if (e.key !== 'Escape') return;
  search.value = '';
  search.blur();
  render();
};
document.addEventListener('keydown', e => {
  if (dialog.open || e.ctrlKey || e.metaKey || e.altKey || e.target.matches('input, textarea, select')) return;
  if (e.key === '/') {
    e.preventDefault();
    search.focus();
  } else if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openDialog(null);
  }
});

function openDialog(task, status = 'backlog') {
  editingId = task?.id ?? null;
  dialog.querySelector('h3').textContent = task ? 'Edit task' : 'New task';
  fields.title.value = task?.title ?? '';
  fields.description.value = task?.description ?? '';
  fields.status.value = task?.status ?? status;
  deleteButton.hidden = !task;
  dialog.showModal();
}

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
  const task = tasks.find(t => t.id === editingId);
  if (task) {
    if (task.status !== data.status) moveTask(task.id, data.status, null);
    Object.assign(task, data);
  } else {
    tasks.push({ id: crypto.randomUUID(), ...data });
  }
  render();
};

document.getElementById('add').onclick = () => openDialog(null);
document.getElementById('cancel').onclick = () => dialog.close();
let toastTimer;
function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
}
deleteButton.onclick = () => {
  // -1 when another tab already deleted it.
  const index = tasks.findIndex(t => t.id === editingId);
  if (index !== -1) {
    const [task] = tasks.splice(index, 1);
    document.getElementById('undo').onclick = () => {
      // Skipped if another tab restored it meanwhile; an index past the end appends.
      if (!tasks.some(t => t.id === task.id)) tasks.splice(index, 0, task);
      hideToast();
      render();
    };
    clearTimeout(toastTimer);
    toast.hidden = false;
    toastTimer = setTimeout(hideToast, 5000);
  }
  dialog.close();
  render();
};
// Clicks on the dialog element itself (not the form) land on the backdrop.
dialog.onclick = e => {
  if (e.target === dialog) dialog.close();
};
// Opened from the body (a card click or a shortcut), there is no focus to restore, so it would stay on a hidden field and block the shortcuts.
dialog.onclose = () => {
  if (dialog.contains(document.activeElement)) document.activeElement.blur();
};

// Fires only in other tabs; render() writing back the same value raises no further event.
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
  const task = tasks.find(t => t.id === id);
  if (!task || id === beforeId) return;
  tasks.splice(tasks.indexOf(task), 1);
  task.status = status;
  // A target removed by another tab mid-drag yields -1, which falls back to the end.
  const index = tasks.findIndex(t => t.id === beforeId);
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
  render();
};

document.getElementById('export').onclick = () => {
  const link = document.createElement('a');
  link.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(tasks, null, 2));
  link.download = 'planning-board.json';
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
  render();
};

render();
