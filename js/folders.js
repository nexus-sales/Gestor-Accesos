// Gestión de carpetas de notas

let currentFolderId  = null;
let editingFolderId  = null;
let newFolderParentId = null;

// ── Render barra de carpetas ──────────────────────────────────────

function renderFolderBar() {
  const bar = document.getElementById('folder-bar');
  if (!bar) return;

  if (currentTab !== 'notes' || folders.length === 0) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  const roots = folders
    .filter(f => !f.parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (!currentFolderId) {
    // ── Vista raíz ────────────────────────────────────────────────
    let html = `<button class="folder-chip folder-chip--all active" data-folder-action="switch" data-folder-id="">
      <i class="ti ti-files"></i> Todas
    </button>`;

    roots.forEach(f => {
      const count = folderNoteCount(f.id);
      html += `<span class="folder-chip-wrap">
        <button class="folder-chip" data-folder-action="switch" data-folder-id="${f.id}">
          <i class="ti ti-folder"></i> ${esc(f.name)}
          ${count ? `<span class="folder-count">${count}</span>` : ''}
        </button>
        <span class="folder-chip-btns">
          <button class="folder-tiny-btn" data-folder-action="edit" data-folder-id="${f.id}" title="Renombrar"><i class="ti ti-pencil"></i></button>
          <button class="folder-tiny-btn danger" data-folder-action="delete" data-folder-id="${f.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
        </span>
      </span>`;
    });

    html += `<button class="folder-chip folder-chip--add" data-folder-action="new" data-folder-parent="">
      <i class="ti ti-folder-plus"></i> Nueva carpeta
    </button>`;

    bar.innerHTML = html;

  } else {
    // ── Vista dentro de una carpeta ───────────────────────────────
    const currentFolder = folders.find(f => f.id === currentFolderId);
    if (!currentFolder) { currentFolderId = null; renderFolderBar(); return; }

    const parentId   = currentFolder.parentId || '';
    const backLabel  = parentId
      ? (folders.find(f => f.id === parentId)?.name || 'Atrás')
      : 'Todas';
    const subfolders = folders
      .filter(f => f.parentId === currentFolderId)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    let html = `<button class="folder-chip folder-chip--back" data-folder-action="switch" data-folder-id="${parentId}">
      <i class="ti ti-arrow-left"></i> ${esc(backLabel)}
    </button>
    <span class="folder-current-label">
      <i class="ti ti-folder-open"></i> ${esc(currentFolder.name)}
    </span>`;

    subfolders.forEach(f => {
      const count = notes.filter(n => n.folderId === f.id).length;
      html += `<span class="folder-chip-wrap">
        <button class="folder-chip" data-folder-action="switch" data-folder-id="${f.id}">
          <i class="ti ti-folder"></i> ${esc(f.name)}
          ${count ? `<span class="folder-count">${count}</span>` : ''}
        </button>
        <span class="folder-chip-btns">
          <button class="folder-tiny-btn" data-folder-action="edit" data-folder-id="${f.id}" title="Renombrar"><i class="ti ti-pencil"></i></button>
          <button class="folder-tiny-btn danger" data-folder-action="delete" data-folder-id="${f.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
        </span>
      </span>`;
    });

    // Subcarpetas solo un nivel; si estamos en raíz ofrecemos crear
    if (!currentFolder.parentId) {
      html += `<button class="folder-chip folder-chip--add" data-folder-action="new" data-folder-parent="${currentFolderId}">
        <i class="ti ti-folder-plus"></i> Nueva subcarpeta
      </button>`;
    }

    bar.innerHTML = html;
  }
}

function folderNoteCount(folderId) {
  const subIds = folders.filter(f => f.parentId === folderId).map(f => f.id);
  return notes.filter(n => n.folderId === folderId || subIds.includes(n.folderId)).length;
}

// ── Select de carpeta en el formulario de nota ────────────────────

function populateFolderSelect(selectedId) {
  const sel = document.getElementById('fNoteFolder');
  if (!sel) return;

  const roots = folders
    .filter(f => !f.parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  let html = '<option value="">Sin carpeta</option>';
  roots.forEach(f => {
    html += `<option value="${f.id}"${f.id === selectedId ? ' selected' : ''}>📁 ${esc(f.name)}</option>`;
    folders
      .filter(sf => sf.parentId === f.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .forEach(sf => {
        html += `<option value="${sf.id}"${sf.id === selectedId ? ' selected' : ''}>  ↳ ${esc(sf.name)}</option>`;
      });
  });

  sel.innerHTML = html;
}

// ── CRUD ─────────────────────────────────────────────────────────

function openFolderModal(editId, parentId) {
  editingFolderId   = editId || null;
  newFolderParentId = (parentId !== undefined && parentId !== null) ? parentId : null;

  const isEdit  = !!editingFolderId;
  const isSub   = !isEdit && !!newFolderParentId;
  document.getElementById('folder-modal-title').textContent =
    isEdit ? 'Renombrar carpeta' : (isSub ? 'Nueva subcarpeta' : 'Nueva carpeta');

  const existing = isEdit ? folders.find(f => f.id === editId) : null;
  document.getElementById('folder-name-input').value = existing?.name || '';
  document.getElementById('folder-modal-error').classList.add('hidden');
  document.getElementById('folder-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('folder-name-input').focus(), 40);
}

function closeFolderModal() {
  document.getElementById('folder-modal').classList.add('hidden');
  editingFolderId = null;
  newFolderParentId = null;
}

async function saveFolderModal() {
  const name  = document.getElementById('folder-name-input').value.trim();
  const errEl = document.getElementById('folder-modal-error');

  if (!name) {
    errEl.textContent = 'El nombre es obligatorio.';
    errEl.classList.remove('hidden');
    return;
  }
  if (name.length > 40) {
    errEl.textContent = 'El nombre no puede superar 40 caracteres.';
    errEl.classList.remove('hidden');
    return;
  }

  if (editingFolderId) {
    const f = folders.find(f => f.id === editingFolderId);
    if (f) f.name = name;
  } else {
    folders.push({
      id: crypto.randomUUID(),
      name,
      parentId: newFolderParentId || null
    });
  }

  closeFolderModal();
  await save();
  render();
}

async function deleteFolderConfirm(folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const subIds  = folders.filter(f => f.parentId === folderId).map(f => f.id);
  const allIds  = [folderId, ...subIds];
  const affected = notes.filter(n => allIds.includes(n.folderId)).length;

  const msg = affected
    ? `¿Eliminar la carpeta "${folder.name}"?\n\n${affected} nota${affected !== 1 ? 's' : ''} quedarán sin carpeta.`
    : `¿Eliminar la carpeta "${folder.name}"?`;

  if (!confirm(msg)) return;

  notes.forEach(n => { if (allIds.includes(n.folderId)) n.folderId = null; });
  folders = folders.filter(f => !allIds.includes(f.id));
  if (allIds.includes(currentFolderId)) currentFolderId = null;

  await save();
  render();
}

// ── Event listeners ───────────────────────────────────────────────

document.getElementById('folder-bar')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-folder-action]');
  if (!btn) return;
  const { folderAction, folderId, folderParent } = btn.dataset;
  if (folderAction === 'switch') { currentFolderId = folderId || null; render(); }
  else if (folderAction === 'edit')   openFolderModal(folderId, null);
  else if (folderAction === 'delete') deleteFolderConfirm(folderId);
  else if (folderAction === 'new')    openFolderModal(null, folderParent || null);
});

document.getElementById('folder-modal-close')?.addEventListener('click', closeFolderModal);
document.getElementById('folder-modal-cancel')?.addEventListener('click', closeFolderModal);
document.getElementById('folder-modal-save')?.addEventListener('click', saveFolderModal);
document.getElementById('folder-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeFolderModal();
});
document.getElementById('folder-name-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); saveFolderModal(); }
  if (e.key === 'Escape') closeFolderModal();
});
