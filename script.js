const STATUSES = [
  ['backlog', 'Backlog'], ['ready', 'Ready'], ['progress', 'In Progress'],
  ['review', 'In Review'], ['done', 'Done'], ['cancelled', 'Cancelled'],
];
const TASKS_KEY = 'planning-board:tasks';
const THEME_KEY = 'planning-board:theme';
const NAME_KEY = 'planning-board:name';
const DEFAULT_NAME = 'PLANNING BOARD';
const root = document.documentElement;
const board = document.querySelector('main');
const dialog = document.querySelector('dialog');
const form = dialog.querySelector('form');
const fields = form.elements;
const deleteButton = document.getElementById('delete');
const boardName = document.getElementById('board-name');
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

for (const [id, name] of STATUSES) {
  board.insertAdjacentHTML('beforeend',
    `<section data-status="${id}"><h2>${name}<span></span></h2><div class="list"></div></section>`);
  fields.status.add(new Option(name, id));
}

function createCard(task) {
  const el = document.createElement('article');
  el.className = 'task';
  el.draggable = true;
  el.innerHTML = '<strong></strong><p></p>';
  el.querySelector('strong').textContent = task.title;
  el.querySelector('p').textContent = task.description;
  el.onclick = () => openDialog(task);
  el.ondragstart = e => e.dataTransfer.setData('text/plain', task.id);
  return el;
}

function render() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  for (const section of board.children) {
    const items = tasks.filter(t => t.status === section.dataset.status);
    section.querySelector('span').textContent = items.length;
    section.querySelector('.list').replaceChildren(...items.map(createCard));
  }
}

function openDialog(task) {
  editingId = task?.id ?? null;
  dialog.querySelector('h3').textContent = task ? 'Edit task' : 'New task';
  fields.title.value = task?.title ?? '';
  fields.description.value = task?.description ?? '';
  fields.status.value = task?.status ?? 'backlog';
  deleteButton.hidden = !task;
  dialog.showModal();
}

form.onsubmit = () => {
  const data = {
    title: fields.title.value.trim(),
    description: fields.description.value.trim(),
    status: fields.status.value,
  };
  // Looked up by id because a sync from another tab replaces the task objects; a task deleted there is re-created.
  const task = tasks.find(t => t.id === editingId);
  if (task) Object.assign(task, data);
  else tasks.push({ id: crypto.randomUUID(), ...data });
  render();
};

document.getElementById('add').onclick = () => openDialog(null);
document.getElementById('cancel').onclick = () => dialog.close();
deleteButton.onclick = () => {
  tasks = tasks.filter(t => t.id !== editingId);
  dialog.close();
  render();
};
// Clicks on the dialog element itself (not the form) land on the backdrop.
dialog.onclick = e => {
  if (e.target === dialog) dialog.close();
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

board.ondragover = e => e.preventDefault();
board.ondrop = e => {
  const section = e.target.closest('section');
  const task = tasks.find(t => t.id === e.dataTransfer.getData('text/plain'));
  if (section && task) {
    task.status = section.dataset.status;
    render();
  }
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
