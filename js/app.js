// Lógica principal: tabs, CRUD, renderizado

let crms = [], domains = [], privateItems = [], notes = [];
let currentTab  = 'crms';
let editingId   = null;
let visiblePass = {};
let lockTimer   = null;
let pendingPrivateAccess = null;
const revealedNotes = new Map();
const privateNoteTimers = new Map();
const revealedPrivateItems = new Map();
const privateItemTimers = new Map();

const SECTOR_COLORS = ['sc-blue','sc-teal','sc-amber','sc-coral','sc-purple','sc-pink','sc-green','sc-red','sc-gray'];
const sectorColorMap = {};

// ── Guardar ──────────────────────────────────────────────────

async function save() {
  try { await saveVaultToSupabase(); }
  catch (err) { showToast('Error al sincronizar: ' + err.message); }
}

// ── Sync status ──────────────────────────────────────────────

function setSyncStatus(status) {
  const icon   = document.getElementById('syncIcon');
  const wrap   = document.getElementById('syncStatus');
  const textEl = document.getElementById('syncText');
  if (!icon || !wrap) return;
  const cfg = {
    syncing: ['ti ti-loader-2 spin', 'sync-syncing', 'Sincronizando…'],
    ok:      ['ti ti-cloud-check',   'sync-ok',      'Sincronizado'],
    error:   ['ti ti-cloud-x',       'sync-error',   'Error al sincronizar'],
  };
  const [cls, badge, label] = cfg[status] ?? cfg.ok;
  icon.className = cls;
  wrap.className = 'sync-badge ' + badge;
  wrap.title     = label;
  if (textEl) textEl.textContent = label;
}

// ── Inactividad ──────────────────────────────────────────────

function resetInactivity() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    lockVault();
    showToast('Bóveda bloqueada por inactividad');
  }, 600000);
}

['mousedown','keypress','scroll','touchstart'].forEach(ev =>
  document.addEventListener(ev, () => { if (vaultKey) resetInactivity(); }, true)
);

// ── Colores de sector ────────────────────────────────────────

function getSectorColor(sector) {
  const key = String(sector || '').trim().toLocaleLowerCase('es');
  if (!key) return 'sc-gray';
  if (!sectorColorMap[key]) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    }
    sectorColorMap[key] = SECTOR_COLORS[(hash >>> 0) % SECTOR_COLORS.length];
  }
  return sectorColorMap[key];
}

function buildColorMap() {
  [...new Set([...crms, ...domains].map(c => c.sector))].sort().forEach(getSectorColor);
}

// ── Tabs ─────────────────────────────────────────────────────

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.id === 'tab-' + tabId);
    b.setAttribute('aria-selected', b.id === 'tab-' + tabId);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(b => {
    const active = b.dataset.tab === tabId;
    b.classList.toggle('active', active);
    b.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.getElementById('filterSector').classList.toggle('hidden', tabId === 'private');
  document.getElementById('filterSector').value = '';
  document.getElementById('search').value = '';
  updateBtnNew();
  render();
}

function updateBtnNew() {
  const labels = { crms: 'Nuevo servicio', domains: 'Nuevo Dominio', private: 'Nueva Contraseña', notes: 'Nueva Nota' };
  const titles = { crms: 'Servicios', domains: 'Dominios y emails', private: 'Contraseñas privadas', notes: 'Notas' };
  const descriptions = {
    crms: 'Tus accesos de trabajo, ordenados y protegidos.',
    domains: 'Dominios, proveedores y cuentas de correo en un solo lugar.',
    private: 'Credenciales personales protegidas con cifrado AES-256.',
    notes: 'Procedimientos, contactos e información útil siempre a mano.'
  };
  const btn     = document.getElementById('btnNew');
  const titleEl = document.getElementById('pageTitle');
  if (btn)     btn.innerHTML    = `<i class="ti ti-plus"></i> ${labels[currentTab]}`;
  if (titleEl) titleEl.textContent = titles[currentTab];
  const descriptionEl = document.getElementById('pageDescription');
  if (descriptionEl) descriptionEl.textContent = descriptions[currentTab];
}

// ── Toast ─────────────────────────────────────────────────────

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

// ── Modal ─────────────────────────────────────────────────────

function openModal(id) {
  if (typeof id !== 'string') id = null;
  const requestedNote = currentTab === 'notes' && id ? notes.find(note => note.id === id) : null;
  if (requestedNote?.private && !revealedNotes.has(id)) {
    requestPrivateNoteAccess(id, 'edit');
    return;
  }
  const requestedPrivateItem = currentTab === 'private' && id ? privateItems.find(item => item.id === id) : null;
  if (requestedPrivateItem?.secretData && !revealedPrivateItems.has(id)) {
    requestPrivateItemAccess(id, 'edit');
    return;
  }
  editingId = id || null;
  const titles = { crms: 'servicio', domains: 'Dominio', private: 'Contraseña Privada', notes: 'Nota' };
  document.getElementById('modalTitle').textContent =
    (id ? 'Editar ' : 'Nuevo ') + titles[currentTab];

  configureModalFields();

  if (id) {
    const items = getCurrentCollection();
    const entry = items.find(x => x.id === id);
    if (entry) {
      const noteData = currentTab === 'notes' ? (revealedNotes.get(id)?.data || entry) : entry;
      const entryData = currentTab === 'private' ? (revealedPrivateItems.get(id)?.data || entry) : entry;
      document.getElementById('fSector').value = entry.sector || '';
      document.getElementById('fMarca').value  = currentTab === 'notes' ? (noteData.title || '') : (entryData.marca || '');
      document.getElementById('fUrl').value    = entry.url || '';
      document.getElementById('fUser').value   = entryData.user || '';
      document.getElementById('fPass').value   = entryData.pass || '';
      document.getElementById('fObs').value    = currentTab === 'notes' ? (noteData.content || '') : (entryData.obs || '');
      if (currentTab === 'private') {
        document.getElementById('fPrivateCategory').value = entry.category || 'other';
        configurePrivateCategory();
      }
      if (currentTab === 'notes') {
        document.getElementById('fNoteType').value = entry.type || 'general';
        document.getElementById('fTags').value = Array.isArray(noteData.tags) ? noteData.tags.join(', ') : (noteData.tags || '');
        document.getElementById('fPinned').checked = !!entry.pinned;
        document.getElementById('fNotePrivate').checked = !!entry.private;
        document.getElementById('fCompany').value = noteData.company || '';
        document.getElementById('fPhone').value = noteData.phone || '';
        document.getElementById('fContactEmail').value = noteData.email || '';
        configureNoteType();
      }
    }
  } else {
    ['fSector','fMarca','fUrl','fUser','fPass','fObs','fTags','fCompany','fPhone','fContactEmail'].forEach(f => {
      const el = document.getElementById(f);
      if (el) el.value = '';
    });
    document.getElementById('fNoteType').value = 'procedure';
    document.getElementById('fPinned').checked = false;
    document.getElementById('fNotePrivate').checked = false;
    document.getElementById('fPrivateCategory').value = 'other';
    configurePrivateCategory();
    configureNoteType();
  }

  document.getElementById('fPass').type = 'password';
  document.getElementById('fPassIcon').className = 'ti ti-eye';

  if (!['private', 'notes'].includes(currentTab)) updateDatalist();
  document.getElementById('modalOverlay').classList.remove('hidden');
  setTimeout(() => {
    const focus = ['private', 'notes'].includes(currentTab) ? 'fMarca' : 'fSector';
    document.getElementById(focus)?.focus();
  }, 50);
}

function closeModal() {
  const closingId = editingId;
  document.getElementById('modalOverlay').classList.add('hidden');
  editingId = null;
  if (closingId && notes.find(note => note.id === closingId)?.private && revealedNotes.has(closingId)) {
    hidePrivateNote(closingId, currentTab === 'notes');
  }
  if (closingId && privateItems.find(item => item.id === closingId)?.secretData && revealedPrivateItems.has(closingId)) {
    hidePrivateItem(closingId, currentTab === 'private');
  }
}

function overlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

function configureModalFields() {
  const grpSector = document.getElementById('grpSector');
  const grpUrl    = document.getElementById('grpUrl');
  const lblSector = document.getElementById('lblSector');
  const lblMarca  = document.getElementById('lblMarca');
  const lblUrl    = document.getElementById('lblUrl');
  const lblUser   = document.getElementById('lblUser');
  const fSector   = document.getElementById('fSector');
  const fMarca    = document.getElementById('fMarca');
  const fUrl      = document.getElementById('fUrl');
  const fUser     = document.getElementById('fUser');
  const rowSectorMarca = document.getElementById('rowSectorMarca');
  const rowCredentials = document.getElementById('rowCredentials');
  const grpNoteFields = document.getElementById('grpNoteFields');
  const grpPrivateCategory = document.getElementById('grpPrivateCategory');
  const lblObs = document.getElementById('lblObs');
  const lblPass = document.getElementById('lblPass');

  rowCredentials.classList.remove('hidden');
  grpNoteFields.classList.add('hidden');
  grpPrivateCategory.classList.add('hidden');
  lblObs.textContent = 'Observaciones';
  lblPass.textContent = 'Contraseña';
  document.getElementById('fObs').placeholder = 'Notas, módulos, permisos…';
  rowSectorMarca.classList.toggle('single-field', ['private', 'notes'].includes(currentTab));

  if (currentTab === 'crms') {
    grpSector.classList.remove('hidden'); grpUrl.classList.remove('hidden');
    lblSector.innerHTML = 'Sector <span class="required">*</span>';
    fSector.placeholder = 'ej. Automoción';
    lblMarca.innerHTML  = 'Servicio / Portal <span class="required">*</span>';
    fMarca.placeholder  = 'ej. Salesforce o Campus de formación';
    lblUrl.innerHTML    = 'URL del servicio <span class="required">*</span>';
    fUrl.placeholder    = 'https://portal.ejemplo.com';
    lblUser.textContent = 'Usuario';
    fUser.placeholder   = 'usuario@dominio.com';
  } else if (currentTab === 'domains') {
    grpSector.classList.remove('hidden'); grpUrl.classList.remove('hidden');
    lblSector.innerHTML = 'Proveedor / Registrador <span class="required">*</span>';
    fSector.placeholder = 'ej. GoDaddy';
    lblMarca.innerHTML  = 'Dominio <span class="required">*</span>';
    fMarca.placeholder  = 'ej. mi-web.com';
    lblUrl.innerHTML    = 'URL de acceso <span class="required">*</span>';
    fUrl.placeholder    = 'https://godaddy.com';
    lblUser.textContent = 'Email / Usuario';
    fUser.placeholder   = 'admin@mi-web.com';
  } else if (currentTab === 'private') {
    grpSector.classList.add('hidden'); grpUrl.classList.add('hidden');
    grpPrivateCategory.classList.remove('hidden');
    lblMarca.innerHTML  = 'Servicio / Título <span class="required">*</span>';
    fMarca.placeholder  = 'ej. Banco, Correo, App';
    lblUser.textContent = 'Usuario / Identificador';
    fUser.placeholder   = 'usuario123';
    configurePrivateCategory();
  } else {
    grpSector.classList.add('hidden'); grpUrl.classList.add('hidden');
    rowCredentials.classList.add('hidden'); grpNoteFields.classList.remove('hidden');
    lblMarca.innerHTML = 'Título <span class="required">*</span>';
    fMarca.placeholder = 'ej. Alta de un nuevo cliente';
    lblObs.innerHTML = 'Contenido <span class="required">*</span>';
    document.getElementById('fObs').placeholder = 'Escribe aquí el procedimiento, datos de contacto o información útil…';
    configureNoteType();
  }
}

function configurePrivateCategory() {
  if (currentTab !== 'private') return;
  const category = document.getElementById('fPrivateCategory').value;
  const lblMarca = document.getElementById('lblMarca');
  const lblUser = document.getElementById('lblUser');
  const lblPass = document.getElementById('lblPass');
  const fMarca = document.getElementById('fMarca');
  const fUser = document.getElementById('fUser');

  if (category === 'api') {
    lblMarca.innerHTML = 'Programa / Servicio <span class="required">*</span>';
    lblUser.textContent = 'Proyecto / Identificador';
    lblPass.textContent = 'API key / Token';
    fMarca.placeholder = 'ej. GitHub, Stripe, Vercel';
    fUser.placeholder = 'Proyecto, organización o ID';
  } else if (category === 'ai') {
    lblMarca.innerHTML = 'Proveedor / Modelo IA <span class="required">*</span>';
    lblUser.textContent = 'Organización / Proyecto';
    lblPass.textContent = 'API key / Token';
    fMarca.placeholder = 'ej. OpenAI, Anthropic, Gemini';
    fUser.placeholder = 'Organización o proyecto';
  } else {
    lblMarca.innerHTML = 'Servicio / Título <span class="required">*</span>';
    lblUser.textContent = 'Usuario / Identificador';
    lblPass.textContent = 'Contraseña';
    fMarca.placeholder = 'ej. Banco, Correo, App';
    fUser.placeholder = 'usuario123';
  }
}

function configureNoteType() {
  const isContact = document.getElementById('fNoteType')?.value === 'contact';
  document.getElementById('grpNoteContact')?.classList.toggle('hidden', !isContact);
  if (currentTab === 'notes') {
    document.getElementById('lblMarca').innerHTML = isContact
      ? 'Nombre del contacto <span class="required">*</span>'
      : 'Título <span class="required">*</span>';
    document.getElementById('lblObs').innerHTML = isContact
      ? 'Información adicional'
      : 'Contenido <span class="required">*</span>';
    document.getElementById('fObs').placeholder = isContact
      ? 'Horario, función, contexto o cualquier detalle útil…'
      : 'Escribe aquí el procedimiento o la información que quieras conservar…';
  }
}

function updateDatalist() {
  const source = currentTab === 'domains' ? domains : crms;
  const sectors = [...new Set(source.map(c => c.sector))].sort();
  document.getElementById('sectorList').innerHTML =
    sectors.map(s => `<option value="${esc(s)}">`).join('');
}

// ── CRUD ──────────────────────────────────────────────────────

async function saveEntry() {
  if (currentTab === 'notes') { await saveNoteEntry(); return; }
  if (currentTab === 'private') { await savePrivateEntry(); return; }
  const marca = document.getElementById('fMarca').value.trim();
  if (!marca) { alert('El nombre del servicio es obligatorio.'); return; }

  let sector = '', url = '';
  if (currentTab !== 'private') {
    sector = document.getElementById('fSector').value.trim();
    url    = normalizeUrl(document.getElementById('fUrl').value.trim());
    if (!sector || !url) { alert('Sector/Proveedor y URL son obligatorios.'); return; }
    if (!isAllowedUrl(url)) {
      alert('La URL debe empezar por http:// o https:// y ser válida.');
      document.getElementById('fUrl').focus();
      return;
    }
  }

  const entry = {
    id:      editingId || crypto.randomUUID(),
    sector,
    marca,
    url,
    user:    document.getElementById('fUser').value.trim(),
    pass:    document.getElementById('fPass').value.trim(),
    obs:     document.getElementById('fObs').value.trim(),
    created: Date.now()
  };

  const collections = { crms, domains, private: privateItems };
  const key = currentTab === 'private' ? 'private' : currentTab;
  const col = collections[key];

  if (editingId) {
    const idx = col.findIndex(x => x.id === editingId);
    if (idx !== -1) { entry.created = col[idx].created || Date.now(); col[idx] = entry; }
  } else {
    col.push(entry);
    if (currentTab !== 'private') getSectorColor(sector);
  }

  if (currentTab === 'private') privateItems = col;
  else if (currentTab === 'crms') crms = col;
  else domains = col;

  await save();
  closeModal();
  render();
  showToast(editingId ? 'Registro actualizado' : 'Registro guardado');
}

async function savePrivateEntry() {
  const marca = document.getElementById('fMarca').value.trim();
  if (!marca) { alert('El nombre del servicio es obligatorio.'); return; }

  const previous = editingId ? privateItems.find(item => item.id === editingId) : null;
  const entry = {
    id: editingId || crypto.randomUUID(),
    category: document.getElementById('fPrivateCategory').value,
    secretData: await encryptWithKey(JSON.stringify({
      marca,
      user: document.getElementById('fUser').value.trim(),
      pass: document.getElementById('fPass').value.trim(),
      obs: document.getElementById('fObs').value.trim()
    }), vaultKey),
    created: previous?.created || Date.now(),
    updated: Date.now()
  };

  if (previous) {
    if (privateItemTimers.has(previous.id)) clearTimeout(privateItemTimers.get(previous.id));
    privateItemTimers.delete(previous.id);
    revealedPrivateItems.delete(previous.id);
    privateItems[privateItems.findIndex(item => item.id === editingId)] = entry;
  } else {
    privateItems.push(entry);
  }

  await save();
  closeModal();
  render();
  showToast(previous ? 'Ficha privada actualizada' : 'Ficha privada guardada');
}

async function saveNoteEntry() {
  const title = document.getElementById('fMarca').value.trim();
  const content = document.getElementById('fObs').value.trim();
  const type = document.getElementById('fNoteType').value;
  const company = document.getElementById('fCompany').value.trim();
  const phone = document.getElementById('fPhone').value.trim();
  const email = document.getElementById('fContactEmail').value.trim();
  if (!title) { alert('El título es obligatorio.'); return; }
  if (type !== 'contact' && !content) { alert('El contenido es obligatorio.'); return; }
  if (type === 'contact' && !content && !company && !phone && !email) {
    alert('Añade al menos un dato de contacto o una observación.'); return;
  }

  const previous = editingId ? notes.find(note => note.id === editingId) : null;
  const isPrivate = document.getElementById('fNotePrivate').checked;
  const secretFields = {
    title,
    content,
    tags: [...new Set(document.getElementById('fTags').value.split(',').map(tag => tag.trim()).filter(Boolean))],
    company: type === 'contact' ? company : '',
    phone: type === 'contact' ? phone : '',
    email: type === 'contact' ? email : ''
  };
  const entry = {
    id: editingId || crypto.randomUUID(),
    type,
    pinned: document.getElementById('fPinned').checked,
    private: isPrivate,
    created: previous?.created || Date.now(),
    updated: Date.now()
  };

  if (isPrivate) {
    entry.secretData = await encryptWithKey(JSON.stringify(secretFields), vaultKey);
  } else {
    Object.assign(entry, secretFields);
  }

  if (previous) {
    if (privateNoteTimers.has(previous.id)) clearTimeout(privateNoteTimers.get(previous.id));
    privateNoteTimers.delete(previous.id);
    revealedNotes.delete(previous.id);
    notes[notes.findIndex(note => note.id === editingId)] = entry;
  }
  else notes.push(entry);

  await save();
  closeModal();
  render();
  showToast(previous ? 'Nota actualizada' : 'Nota guardada');
}

async function deleteEntry(id) {
  const col = getCurrentCollection();
  const entry = col.find(x => x.id === id);
  if (!entry) return;
  const displayTitle = revealedNotes.get(id)?.data?.title || revealedPrivateItems.get(id)?.data?.marca || entry.title || entry.marca || 'Ficha privada';
  if (!confirm(`¿Eliminar "${displayTitle}"?`)) return;

  const filtered = col.filter(x => x.id !== id);
  if (currentTab === 'crms') crms = filtered;
  else if (currentTab === 'domains') domains = filtered;
  else if (currentTab === 'private') privateItems = filtered;
  else notes = filtered;

  await save();
  render();
  showToast('Registro eliminado');
}

function getCurrentCollection() {
  return { crms, domains, private: privateItems, notes }[currentTab] || [];
}

// ── Mostrar/ocultar contraseña en card ────────────────────────

function toggleCardPass(id) {
  visiblePass[id] = !visiblePass[id];
  const col = currentTab === 'crms' ? crms : currentTab === 'domains' ? domains : privateItems;
  const entry = col.find(x => x.id === id);
  if (!entry) return;

  const el  = document.getElementById('pass-' + id);
  const btn = document.getElementById('passBtn-' + id);
  if (!el) return;

  el.textContent   = visiblePass[id] ? entry.pass : '•'.repeat(Math.min(entry.pass.length, 10));
  btn.innerHTML    = visiblePass[id] ? '<i class="ti ti-eye-off"></i>' : '<i class="ti ti-eye"></i>';
  resetInactivity();
}

// ── Copiado y generación de contraseñas ──────────────────────

function generatePassword() {
  const pass = createPassword(20);
  const input = document.getElementById('fPass');
  input.value = pass;
  input.type = 'text';
  document.getElementById('fPassIcon').className = 'ti ti-eye-off';
  input.focus();
  input.select();
  showToast('Contraseña generada');
}

function createPassword(length) {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%^&*()-_=+[]{}'
  ];
  const all = groups.join('');
  const picked = groups.map(chars => randomChar(chars));
  while (picked.length < length) picked.push(randomChar(all));
  return shuffle(picked).join('');
}

function randomChar(chars) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return chars[bytes[0] % chars.length];
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const j = bytes[0] % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

async function copyFieldValue(inputId, message) {
  const value = document.getElementById(inputId)?.value;
  if (!value) { showToast('No hay nada que copiar'); return; }
  await copyText(value, message);
}

async function copyEntryField(id, field, message) {
  const col = currentTab === 'crms' ? crms : currentTab === 'domains' ? domains : privateItems;
  const entry = col.find(x => x.id === id);
  const value = entry?.[field];
  if (!value) { showToast('No hay nada que copiar'); return; }
  await copyText(value, message);
  resetInactivity();
}

async function copyText(value, message) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    showToast(message);
  } catch {
    showToast('No se pudo copiar');
  }
}

// ── URLs seguras ──────────────────────────────────────────────

function normalizeUrl(value) {
  if (!value) return '';
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return 'https://' + value;
  return value;
}

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname;
  } catch {
    return false;
  }
}

// ── Renderizado ───────────────────────────────────────────────

function render() {
  const q  = document.getElementById('search').value.toLowerCase();
  const fs = document.getElementById('filterSector').value;

  if (currentTab === 'crms')    renderList(crms,    q, fs, 'Servicio', 'Servicios');
  else if (currentTab === 'domains') renderList(domains, q, fs, 'Dominio', 'Dominios');
  else if (currentTab === 'private') renderPrivate(q);
  else renderNotes(q, fs);
}

function renderList(items, q, fs, singular, plural) {
  const filtered = items.filter(c => {
    const text  = [c.sector, c.marca, c.url, c.user, c.obs].join(' ').toLowerCase();
    return (!q || text.includes(q)) && (!fs || c.sector === fs);
  });

  const allSectors = [...new Set(items.map(c => c.sector))].sort();
  const sel = document.getElementById('filterSector');
  const prev = sel.value;
  sel.innerHTML = `<option value="">Todos los ${plural.toLowerCase()}</option>` +
    allSectors.map(s => `<option value="${esc(s)}"${s === prev ? ' selected' : ''}>${esc(s)}</option>`).join('');

  document.getElementById('statusBar').innerHTML =
    `<span class="status-dot"></span> ${items.length} ${items.length !== 1 ? plural : singular} · ${allSectors.length} sector${allSectors.length !== 1 ? 'es' : ''}`;

  const list = document.getElementById('list');
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon"><i class="ti ${items.length === 0 ? 'ti-sparkles' : 'ti-search'}"></i></div>
      <h2>${items.length === 0 ? `Tu espacio de ${plural.toLowerCase()} está listo` : 'No encontramos coincidencias'}</h2>
      <p>${items.length === 0 ? `Añade tu primer ${singular.toLowerCase()} para tener sus accesos siempre a mano.` : 'Prueba con otro término o cambia el filtro seleccionado.'}</p>
      ${items.length === 0 ? `<button type="button" class="btn primary empty-action" data-action="open-modal"><i class="ti ti-plus"></i> Añadir ${singular.toLowerCase()}</button>` : ''}
    </div>`;
    return;
  }

  const grouped = {};
  [...filtered]
    .sort((a, b) => a.sector.localeCompare(b.sector, 'es') || a.marca.localeCompare(b.marca, 'es'))
    .forEach(c => { (grouped[c.sector] = grouped[c.sector] || []).push(c); });

  list.innerHTML = Object.keys(grouped).sort((a,b) => a.localeCompare(b,'es')).map(sector => {
    const cls   = getSectorColor(sector);
    const count = grouped[sector].length;
    const cards = grouped[sector].map(c => buildCard(c)).join('');
    return `<section class="sector-group">
      <div class="sector-header">
        <span class="sector-label ${cls}">${esc(sector)}</span>
        <span class="sector-count">${count} ${count !== 1 ? plural : singular}</span>
      </div>
      <div class="crm-grid">${cards}</div>
    </section>`;
  }).join('');
}

function renderPrivate(q) {
  const categories = {
    banking: ['Banca y finanzas', 'ti-building-bank', 'private-banking'],
    email: ['Correo', 'ti-mail', 'private-email'],
    social: ['Redes sociales', 'ti-users', 'private-social'],
    work: ['Trabajo', 'ti-briefcase', 'private-work'],
    api: ['APIs y desarrollo', 'ti-code', 'private-api'],
    ai: ['IA y modelos', 'ti-robot', 'private-ai'],
    shopping: ['Compras', 'ti-shopping-bag', 'private-shopping'],
    other: ['Otros', 'ti-lock', 'private-other']
  };
  document.getElementById('statusBar').innerHTML =
    `<span class="status-dot private-status-dot"></span> ${privateItems.length} ficha${privateItems.length !== 1 ? 's' : ''} privada${privateItems.length !== 1 ? 's' : ''} · Cifrado individual AES-256`;

  const filtered = privateItems.filter(item => {
    const view = revealedPrivateItems.get(item.id)?.data || {};
    const category = categories[item.category]?.[0] || categories.other[0];
    return !q || [view.marca, view.user, view.obs, category, 'privada'].join(' ').toLowerCase().includes(q);
  });

  const list = document.getElementById('list');
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon"><i class="ti ${privateItems.length === 0 ? 'ti-lock-heart' : 'ti-search'}"></i></div>
      <h2>${privateItems.length === 0 ? 'Tu espacio privado está preparado' : 'No encontramos coincidencias'}</h2>
      <p>${privateItems.length === 0 ? 'Guarda aquí credenciales personales con cifrado AES-256.' : 'Prueba con otro término de búsqueda.'}</p>
      ${privateItems.length === 0 ? '<button type="button" class="btn primary empty-action" data-action="open-modal"><i class="ti ti-plus"></i> Añadir contraseña</button>' : ''}
    </div>`;
    return;
  }

  list.innerHTML = `<div class="private-grid">${filtered.map(item => buildPrivateCard(item, categories)).join('')}</div>`;
}

function buildPrivateCard(item, categories) {
  const revealed = revealedPrivateItems.get(item.id)?.data;
  const isLocked = !!item.secretData && !revealed;
  const view = revealed || item;
  const [categoryLabel, categoryIcon, categoryClass] = categories[item.category] || categories.other;
  const passHidden = view.pass ? '•'.repeat(Math.min(view.pass.length, 10)) : '—';

  return `<article class="private-card ${categoryClass}${isLocked ? ' private-card-locked' : ''}">
    <div class="private-card-head">
      <span class="private-category"><i class="ti ${categoryIcon}"></i>${categoryLabel}</span>
      <div class="crm-actions">
        ${revealed ? `<button type="button" class="icon-btn" data-action="hide-private-item" data-id="${item.id}" aria-label="Ocultar ficha"><i class="ti ti-eye-off"></i></button>` : ''}
        <button type="button" class="icon-btn" data-action="${isLocked ? 'request-private-item' : 'open-modal'}" data-id="${item.id}" ${isLocked ? 'data-kind="edit"' : ''} aria-label="Editar ficha"><i class="ti ti-edit"></i></button>
        <button type="button" class="icon-btn danger" data-action="${isLocked ? 'request-private-item' : 'delete-entry'}" data-id="${item.id}" ${isLocked ? 'data-kind="delete"' : ''} aria-label="Eliminar ficha"><i class="ti ti-trash"></i></button>
      </div>
    </div>
    <h2>${isLocked ? '<i class="ti ti-lock"></i> Ficha privada' : esc(view.marca)}</h2>
    ${isLocked ? `<div class="private-card-placeholder">
      <div class="private-lock-orb"><i class="ti ti-shield-lock"></i></div>
      <p>Nombre, usuario, contraseña y observaciones están cifrados.</p>
      <button type="button" class="btn private-unlock-btn" data-action="request-private-item" data-id="${item.id}" data-kind="reveal"><i class="ti ti-key"></i> Introducir clave</button>
    </div>` : `<div class="private-card-data">
      <div class="crm-field"><label>Usuario / ID</label><div class="crm-field-val"><span>${esc(view.user || '—')}</span>${view.user ? `<button type="button" class="copy-field" data-action="copy-private-item-field" data-id="${item.id}" data-field="user" data-msg="Usuario copiado"><i class="ti ti-copy"></i></button>` : ''}</div></div>
      <div class="crm-field"><label>${['api','ai'].includes(item.category) ? 'API key / Token' : 'Contraseña'}</label><div class="crm-field-val"><span id="private-pass-${item.id}">${passHidden}</span>${view.pass ? `<span class="crm-inline-actions"><button type="button" class="toggle-pass" id="privatePassBtn-${item.id}" data-action="toggle-private-item-pass" data-id="${item.id}"><i class="ti ti-eye"></i></button><button type="button" class="copy-field" data-action="copy-private-item-field" data-id="${item.id}" data-field="pass" data-msg="${['api','ai'].includes(item.category) ? 'API key copiada' : 'Contraseña copiada'}"><i class="ti ti-copy"></i></button></span>` : ''}</div></div>
      ${view.obs ? `<div class="private-card-obs">${esc(view.obs)}</div>` : ''}
    </div>`}
  </article>`;
}

function renderNotes(q, typeFilter) {
  const typeLabels = { procedure: 'Procedimientos', contact: 'Contactos', general: 'Notas generales' };
  const filter = document.getElementById('filterSector');
  filter.innerHTML = '<option value="">Todas las notas</option>' +
    Object.entries(typeLabels).map(([value, label]) => `<option value="${value}"${value === typeFilter ? ' selected' : ''}>${label}</option>`).join('');
  const filtered = notes.filter(note => {
    const view = revealedNotes.get(note.id)?.data || note;
    const haystack = [view.title, view.content, typeLabels[note.type], view.company, view.phone, view.email, ...(view.tags || []), note.private ? 'privada' : '']
      .join(' ').toLowerCase();
    return (!q || haystack.includes(q)) && (!typeFilter || note.type === typeFilter);
  });
  const pinnedCount = notes.filter(note => note.pinned).length;
  document.getElementById('statusBar').innerHTML =
    `<span class="status-dot note-status-dot"></span> ${notes.length} nota${notes.length !== 1 ? 's' : ''}` +
    (pinnedCount ? ` · ${pinnedCount} fijada${pinnedCount !== 1 ? 's' : ''}` : '') + ' · Cifrado AES-256';

  const list = document.getElementById('list');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon"><i class="ti ${notes.length ? 'ti-search' : 'ti-notebook'}"></i></div>
      <h2>${notes.length ? 'No encontramos coincidencias' : 'Tu memoria de trabajo empieza aquí'}</h2>
      <p>${notes.length ? 'Prueba con otro título, etiqueta o término de búsqueda.' : 'Guarda procedimientos, contactos y cualquier información que necesites consultar después.'}</p>
      ${notes.length ? '' : '<button type="button" class="btn primary empty-action" data-action="open-modal"><i class="ti ti-plus"></i> Crear primera nota</button>'}
    </div>`;
    return;
  }

  list.innerHTML = `<div class="notes-grid">${[...filtered]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updated || b.created) - (a.updated || a.created))
    .map(buildNoteCard).join('')}</div>`;
}

function buildNoteCard(note) {
  const types = {
    procedure: ['Procedimiento', 'ti-list-check', 'note-procedure'],
    contact: ['Contacto', 'ti-address-book', 'note-contact'],
    general: ['Nota general', 'ti-note', 'note-general']
  };
  const revealed = revealedNotes.get(note.id)?.data;
  const view = revealed || note;
  const isLocked = !!note.private && !revealed;
  const [typeLabel, typeIcon, typeClass] = types[note.type] || types.general;
  const tags = (view.tags || []).map(tag => `<span class="note-tag">${esc(tag)}</span>`).join('');
  const contactMeta = note.type === 'contact' && !isLocked ? `<div class="note-contact-meta">
    ${view.company ? `<span><i class="ti ti-building"></i>${esc(view.company)}</span>` : ''}
    ${view.phone ? `<a href="tel:${escAttr(view.phone)}"><i class="ti ti-phone"></i>${esc(view.phone)}</a>` : ''}
    ${view.email ? `<a href="mailto:${escAttr(view.email)}"><i class="ti ti-mail"></i>${esc(view.email)}</a>` : ''}
  </div>` : '';
  const updated = new Date(note.updated || note.created || Date.now()).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

  return `<article class="note-card ${typeClass}${isLocked ? ' note-locked' : ''}">
    <div class="note-card-top">
      <span class="note-type"><i class="ti ${typeIcon}"></i>${typeLabel}</span>
      <div class="crm-actions">
        ${note.pinned ? '<span class="note-pinned" title="Nota fijada"><i class="ti ti-pin-filled"></i></span>' : ''}
        ${note.private && revealed ? `<button type="button" class="icon-btn" data-action="hide-private-note" data-id="${note.id}" aria-label="Ocultar nota"><i class="ti ti-eye-off"></i></button>` : ''}
        <button type="button" class="icon-btn" data-action="${isLocked ? 'request-private-note' : 'copy-note'}" data-id="${note.id}" ${isLocked ? 'data-kind="copy"' : ''} aria-label="Copiar nota"><i class="ti ti-copy"></i></button>
        <button type="button" class="icon-btn" data-action="${isLocked ? 'request-private-note' : 'open-modal'}" data-id="${note.id}" ${isLocked ? 'data-kind="edit"' : ''} aria-label="Editar nota"><i class="ti ti-edit"></i></button>
        <button type="button" class="icon-btn danger" data-action="delete-entry" data-id="${note.id}" aria-label="Eliminar nota"><i class="ti ti-trash"></i></button>
      </div>
    </div>
    <h2>${isLocked ? '<i class="ti ti-lock note-title-lock"></i> Nota privada' : esc(view.title)}</h2>
    ${contactMeta}
    ${isLocked ? `<div class="note-private-placeholder">
      <i class="ti ti-shield-lock"></i>
      <p>El contenido está cifrado y oculto.</p>
      <button type="button" class="btn" data-action="request-private-note" data-id="${note.id}" data-kind="reveal"><i class="ti ti-lock-open"></i> Desbloquear</button>
    </div>` : `<div class="note-content">${esc(view.content)}</div>`}
    <footer class="note-footer"><div class="note-tags">${tags}</div><time>${updated}</time></footer>
  </article>`;
}

async function copyNoteContent(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  const data = revealedNotes.get(id)?.data || note;
  if (note.private && !revealedNotes.has(id)) { requestPrivateNoteAccess(id, 'copy'); return; }
  const text = [data.title, data.company, data.phone, data.email, data.content].filter(Boolean).join('\n');
  await copyText(text, 'Contenido de la nota copiado');
  resetInactivity();
}

function requestPrivateNoteAccess(id, action = 'reveal') {
  const note = notes.find(item => item.id === id);
  if (!note?.private || !note.secretData) return;
  pendingPrivateAccess = { kind: 'note', id, action };
  openPrivateAccessDialog('Desbloquear nota privada');
}

function requestPrivateItemAccess(id, action = 'reveal') {
  const item = privateItems.find(entry => entry.id === id);
  if (!item?.secretData) return;
  pendingPrivateAccess = { kind: 'item', id, action };
  openPrivateAccessDialog('Desbloquear ficha privada');
}

function openPrivateAccessDialog(title) {
  document.getElementById('privateNoteTitle').textContent = title;
  document.getElementById('fPrivateNotePassword').value = '';
  document.getElementById('privateNoteError').classList.add('hidden');
  document.getElementById('privateNoteOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('fPrivateNotePassword').focus(), 50);
}

async function unlockPrivateNote(event) {
  event.preventDefault();
  if (!pendingPrivateAccess) return;
  const { kind, id, action } = pendingPrivateAccess;
  const password = document.getElementById('fPrivateNotePassword').value;
  const error = document.getElementById('privateNoteError');

  // 1) Verificar identidad — el fallo aquí siempre es contraseña incorrecta
  try { await unwrapDek(cachedWrappedDek, password); }
  catch {
    error.textContent = 'La contraseña no es correcta.';
    error.classList.remove('hidden');
    document.getElementById('fPrivateNotePassword').select();
    return;
  }

  // 2) Rama PDF — sale antes de tocar entry
  if (kind === 'pdf') {
    closePrivateNoteAccess();
    try {
      showToast('Generando PDF cifrado…');
      await generatePDF(vaultKey, password);
      showToast('PDF descargado correctamente.');
    } catch (e) {
      alert('Error al generar el PDF: ' + e.message);
    }
    return;
  }

  // 3) Rama enroll-passkey — registrar nuevo passkey (identidad ya verificada arriba)
  if (kind === 'enroll-passkey') {
    closePrivateNoteAccess();
    try {
      showToast('Iniciando registro de passkey…');
      await addPasskeySlot(password);
      showToast('Passkey registrado correctamente.');
    } catch (e) {
      alert('Error al registrar el passkey: ' + e.message);
    }
    openPasskeySettings(); // reabre el modal de gestión con la lista actualizada
    return;
  }

  // 4) Descifrado de nota / ficha privada con la DEK
  const entry = kind === 'note'
    ? notes.find(i => i.id === id)
    : privateItems.find(i => i.id === id);
  try {
    const data = JSON.parse(await decryptWithKey(entry.secretData, vaultKey));
    if (kind === 'note') revealPrivateNoteTemporarily(id, data);
    else revealPrivateItemTemporarily(id, data);
    closePrivateNoteAccess();
    resetInactivity();
    if (action === 'edit') openModal(id);
    else if (kind === 'item' && action === 'delete') { await deleteEntry(id); hidePrivateItem(id, false); }
    else if (action === 'copy') { await copyNoteContent(id); hidePrivateNote(id, false); }
    else render();
  } catch {
    error.textContent = 'No se pudo descifrar la ficha (datos corruptos).';
    error.classList.remove('hidden');
  }
}

function revealPrivateItemTemporarily(id, data) {
  if (privateItemTimers.has(id)) clearTimeout(privateItemTimers.get(id));
  revealedPrivateItems.set(id, { data });
  privateItemTimers.set(id, setTimeout(() => hidePrivateItem(id), 60000));
}

function hidePrivateItem(id, shouldRender = true) {
  if (privateItemTimers.has(id)) clearTimeout(privateItemTimers.get(id));
  privateItemTimers.delete(id);
  revealedPrivateItems.delete(id);
  if (editingId === id) {
    document.getElementById('modalOverlay').classList.add('hidden');
    editingId = null;
    showToast('La ficha privada se ha ocultado');
  }
  if (shouldRender && currentTab === 'private') render();
}

async function copyPrivateItemField(id, field, message) {
  const data = revealedPrivateItems.get(id)?.data;
  if (!data) { requestPrivateItemAccess(id, 'reveal'); return; }
  await copyText(data[field], message);
  resetInactivity();
}

function togglePrivateItemPass(id) {
  const data = revealedPrivateItems.get(id)?.data;
  const element = document.getElementById('private-pass-' + id);
  if (!data?.pass || !element) return;
  const showing = element.textContent === data.pass;
  element.textContent = showing ? '•'.repeat(Math.min(data.pass.length, 10)) : data.pass;
  const button = document.getElementById('privatePassBtn-' + id);
  if (button) button.innerHTML = showing ? '<i class="ti ti-eye"></i>' : '<i class="ti ti-eye-off"></i>';
  resetInactivity();
}

function revealPrivateNoteTemporarily(id, data) {
  if (privateNoteTimers.has(id)) clearTimeout(privateNoteTimers.get(id));
  revealedNotes.set(id, { data });
  privateNoteTimers.set(id, setTimeout(() => hidePrivateNote(id), 60000));
}

function hidePrivateNote(id, shouldRender = true) {
  if (privateNoteTimers.has(id)) clearTimeout(privateNoteTimers.get(id));
  privateNoteTimers.delete(id);
  revealedNotes.delete(id);
  if (editingId === id) {
    document.getElementById('modalOverlay').classList.add('hidden');
    editingId = null;
    showToast('La nota privada se ha ocultado');
  }
  if (shouldRender && currentTab === 'notes') render();
}

function clearAllPrivateNoteAccess() {
  privateNoteTimers.forEach(timer => clearTimeout(timer));
  privateNoteTimers.clear();
  revealedNotes.clear();
  privateItemTimers.forEach(timer => clearTimeout(timer));
  privateItemTimers.clear();
  revealedPrivateItems.clear();
  pendingPrivateAccess = null;
  document.getElementById('privateNoteOverlay')?.classList.add('hidden');
}

function closePrivateNoteAccess() {
  document.getElementById('privateNoteOverlay').classList.add('hidden');
  document.getElementById('fPrivateNotePassword').value = '';
  pendingPrivateAccess = null;
}

function privateNoteOverlayClick(event) {
  if (event.target === document.getElementById('privateNoteOverlay')) closePrivateNoteAccess();
}

function buildCard(c, isPrivate = false) {
  const passHidden = c.pass ? '•'.repeat(Math.min(c.pass.length, 10)) : '—';
  const border = isPrivate ? ' style="border-left:3px solid #a32d2d"' : '';
  const accentClass = isPrivate ? '' : getSectorColor(c.sector);
  const normalizedUrl = normalizeUrl(c.url);
  const url = normalizedUrl && isAllowedUrl(normalizedUrl) ? normalizedUrl : '';
  return `<article class="crm-card ${accentClass}"${border}>
    <div class="crm-card-header">
      <span class="crm-brand">${esc(c.marca)}</span>
      <div class="crm-actions">
        <button type="button" class="icon-btn" data-action="open-modal" data-id="${c.id}" aria-label="Editar ${esc(c.marca)}">
          <i class="ti ti-edit"></i>
        </button>
        <button type="button" class="icon-btn danger" data-action="delete-entry" data-id="${c.id}" aria-label="Eliminar ${esc(c.marca)}">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    </div>
    ${url ? `<a class="crm-url" href="${escAttr(url)}" target="_blank" rel="noopener">
      <i class="ti ti-external-link"></i>${esc(url)}
    </a>` : ''}
    <div class="crm-fields">
      <div class="crm-field">
        <label>${isPrivate ? 'Usuario / ID' : 'Usuario'}</label>
        <div class="crm-field-val">
          <span>${esc(c.user || '—')}</span>
          ${c.user ? `<button type="button" class="copy-field" data-action="copy-entry-field" data-id="${c.id}" data-field="user" data-msg="Usuario copiado" aria-label="Copiar usuario">
            <i class="ti ti-copy"></i>
          </button>` : ''}
        </div>
      </div>
      <div class="crm-field">
        <label>Contraseña</label>
        <div class="crm-field-val">
          <span id="pass-${c.id}">${c.pass ? passHidden : '—'}</span>
          ${c.pass ? `<span class="crm-inline-actions">
            <button type="button" class="toggle-pass" id="passBtn-${c.id}"
              data-action="toggle-card-pass" data-id="${c.id}" aria-label="Mostrar/ocultar contraseña">
              <i class="ti ti-eye"></i>
            </button>
            <button type="button" class="copy-field" data-action="copy-entry-field" data-id="${c.id}" data-field="pass" data-msg="Contraseña copiada" aria-label="Copiar contraseña">
              <i class="ti ti-copy"></i>
            </button>
          </span>` : ''}
        </div>
      </div>
    </div>
    ${c.obs ? `<div class="crm-obs">${esc(c.obs)}</div>` : ''}
  </article>`;
}

// ── Escapado seguro ───────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Teclado ───────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closePrivateNoteAccess();
  }
});

initApp();

// ── Gestión de passkeys ───────────────────────────────────────

function openPasskeySettings() {
  if (!isPasskeyUsableHere || !isPasskeyUsableHere()) {
    alert('Los passkeys solo funcionan en nexus-sales.eu y sus subdominios.');
    return;
  }
  renderPasskeyList();
  document.getElementById('passkeyModal').classList.remove('hidden');
  closeMenu();
  closeMobileMenu();
}

function closePasskeySettings() {
  document.getElementById('passkeyModal').classList.add('hidden');
}

function renderPasskeyList() {
  const container = document.getElementById('passkeyList');
  if (!cachedPasskeySlots.length) {
    container.innerHTML = '<p class="passkey-empty">No hay passkeys registrados.</p>';
    return;
  }
  container.innerHTML = cachedPasskeySlots.map(s => {
    const shortId = s.credentialId.slice(0, 16) + '…';
    const date    = s.addedAt
      ? new Date(s.addedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
    return `<div class="passkey-row">
      <div class="passkey-row-info">
        <span class="passkey-row-id" title="${esc(s.credentialId)}">${esc(shortId)}</span>
        <span class="passkey-row-date">Añadido: ${date}</span>
      </div>
      <button type="button" class="icon-btn danger" data-credential-id="${esc(s.credentialId)}" aria-label="Eliminar passkey">
        <i class="ti ti-trash"></i>
      </button>
    </div>`;
  }).join('');
}

function openAddPasskeyFlow() {
  if (!isPasskeySupported()) {
    alert('Tu navegador no soporta passkeys (WebAuthn).');
    return;
  }
  closePasskeySettings();
  pendingPrivateAccess = { kind: 'enroll-passkey' };
  openPrivateAccessDialog('Registrar passkey');
}

async function deletePasskey(credentialId) {
  if (!confirm('¿Eliminar este passkey? Podrás seguir usando la contraseña maestra.')) return;
  try {
    await removePasskeySlot(credentialId);
    renderPasskeyList();
    showToast('Passkey eliminado.');
  } catch (err) {
    alert('Error al eliminar el passkey: ' + err.message);
  }
}
