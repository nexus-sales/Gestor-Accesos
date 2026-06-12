// Lógica principal: tabs, CRUD, renderizado

let crms = [], domains = [], privateItems = [];
let currentTab  = 'crms';
let editingId   = null;
let visiblePass = {};
let lockTimer   = null;

const SECTOR_COLORS = ['sc-blue','sc-teal','sc-amber','sc-coral','sc-purple','sc-pink','sc-green','sc-red','sc-gray'];
const sectorColorMap = {};
let colorIdx = 0;

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
  document.addEventListener(ev, () => { if (vaultPassword) resetInactivity(); }, true)
);

// ── Colores de sector ────────────────────────────────────────

function getSectorColor(sector) {
  if (!sectorColorMap[sector]) {
    sectorColorMap[sector] = SECTOR_COLORS[colorIdx++ % SECTOR_COLORS.length];
  }
  return sectorColorMap[sector];
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
  document.getElementById('search').value = '';
  updateBtnNew();
  render();
}

function updateBtnNew() {
  const labels = { crms: 'Nuevo CRM', domains: 'Nuevo Dominio', private: 'Nueva Contraseña' };
  const titles = { crms: 'CRMs', domains: 'Dominios y Emails', private: 'Contraseñas Privadas' };
  const btn     = document.getElementById('btnNew');
  const titleEl = document.getElementById('pageTitle');
  if (btn)     btn.innerHTML    = `<i class="ti ti-plus"></i> ${labels[currentTab]}`;
  if (titleEl) titleEl.textContent = titles[currentTab];
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
  editingId = id || null;
  const titles = { crms: 'CRM', domains: 'Dominio', private: 'Contraseña Privada' };
  document.getElementById('modalTitle').textContent =
    (id ? 'Editar ' : 'Nuevo ') + titles[currentTab];

  configureModalFields();

  if (id) {
    const items = currentTab === 'crms' ? crms : currentTab === 'domains' ? domains : privateItems;
    const entry = items.find(x => x.id === id);
    if (entry) {
      document.getElementById('fSector').value = entry.sector || '';
      document.getElementById('fMarca').value  = entry.marca  || '';
      document.getElementById('fUrl').value    = entry.url    || '';
      document.getElementById('fUser').value   = entry.user   || '';
      document.getElementById('fPass').value   = entry.pass   || '';
      document.getElementById('fObs').value    = entry.obs    || '';
    }
  } else {
    ['fSector','fMarca','fUrl','fUser','fPass','fObs'].forEach(f => {
      const el = document.getElementById(f);
      if (el) el.value = '';
    });
  }

  document.getElementById('fPass').type = 'password';
  document.getElementById('fPassIcon').className = 'ti ti-eye';

  if (currentTab !== 'private') updateDatalist();
  document.getElementById('modalOverlay').classList.remove('hidden');
  setTimeout(() => {
    const focus = currentTab === 'private' ? 'fMarca' : 'fSector';
    document.getElementById(focus)?.focus();
  }, 50);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  editingId = null;
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

  if (currentTab === 'crms') {
    grpSector.classList.remove('hidden'); grpUrl.classList.remove('hidden');
    lblSector.innerHTML = 'Sector <span class="required">*</span>';
    fSector.placeholder = 'ej. Automoción';
    lblMarca.innerHTML  = 'Marca <span class="required">*</span>';
    fMarca.placeholder  = 'ej. Toyota';
    lblUrl.innerHTML    = 'URL del CRM <span class="required">*</span>';
    fUrl.placeholder    = 'https://crm.ejemplo.com';
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
  } else {
    grpSector.classList.add('hidden'); grpUrl.classList.add('hidden');
    lblMarca.innerHTML  = 'Servicio / Título <span class="required">*</span>';
    fMarca.placeholder  = 'ej. Banco, Correo, App';
    lblUser.textContent = 'Usuario / Identificador';
    fUser.placeholder   = 'usuario123';
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

async function deleteEntry(id) {
  const col = currentTab === 'crms' ? crms : currentTab === 'domains' ? domains : privateItems;
  const entry = col.find(x => x.id === id);
  if (!entry) return;
  if (!confirm(`¿Eliminar "${entry.marca}"?`)) return;

  const filtered = col.filter(x => x.id !== id);
  if (currentTab === 'crms') crms = filtered;
  else if (currentTab === 'domains') domains = filtered;
  else privateItems = filtered;

  await save();
  render();
  showToast('Registro eliminado');
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

  if (currentTab === 'crms')    renderList(crms,    q, fs, 'CRM',    'CRMs');
  else if (currentTab === 'domains') renderList(domains, q, fs, 'Dominio', 'Dominios');
  else renderPrivate(q);
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
      <i class="ti ti-database-off"></i>
      <p>${items.length === 0 ? `No hay ${plural.toLowerCase()} registrados.` : 'Sin resultados.'}</p>
      ${items.length === 0 ? `<button type="button" class="btn primary" onclick="openModal()"><i class="ti ti-plus"></i> Añadir</button>` : ''}
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
  document.getElementById('statusBar').innerHTML =
    `<span class="status-dot" style="background:#a32d2d"></span> ${privateItems.length} registro${privateItems.length !== 1 ? 's' : ''} privado${privateItems.length !== 1 ? 's' : ''} · Cifrado AES-256`;

  const filtered = privateItems.filter(c =>
    !q || [c.marca, c.user, c.obs].join(' ').toLowerCase().includes(q)
  );

  const list = document.getElementById('list');
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">
      <i class="ti ti-shield-off"></i>
      <p>${privateItems.length === 0 ? 'No hay contraseñas privadas.' : 'Sin resultados.'}</p>
      ${privateItems.length === 0 ? '<button type="button" class="btn primary" onclick="openModal()"><i class="ti ti-plus"></i> Añadir</button>' : ''}
    </div>`;
    return;
  }

  list.innerHTML = `<div class="crm-grid">${filtered.map(c => buildCard(c, true)).join('')}</div>`;
}

function buildCard(c, isPrivate = false) {
  const passHidden = c.pass ? '•'.repeat(Math.min(c.pass.length, 10)) : '—';
  const border = isPrivate ? ' style="border-left:3px solid #a32d2d"' : '';
  const normalizedUrl = normalizeUrl(c.url);
  const url = normalizedUrl && isAllowedUrl(normalizedUrl) ? normalizedUrl : '';
  return `<article class="crm-card"${border}>
    <div class="crm-card-header">
      <span class="crm-brand">${esc(c.marca)}</span>
      <div class="crm-actions">
        <button type="button" class="icon-btn" onclick="openModal('${c.id}')" aria-label="Editar ${esc(c.marca)}">
          <i class="ti ti-edit"></i>
        </button>
        <button type="button" class="icon-btn danger" onclick="deleteEntry('${c.id}')" aria-label="Eliminar ${esc(c.marca)}">
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
          ${c.user ? `<button type="button" class="copy-field" onclick="copyEntryField('${c.id}','user','Usuario copiado')" aria-label="Copiar usuario">
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
              onclick="toggleCardPass('${c.id}')" aria-label="Mostrar/ocultar contraseña">
              <i class="ti ti-eye"></i>
            </button>
            <button type="button" class="copy-field" onclick="copyEntryField('${c.id}','pass','Contraseña copiada')" aria-label="Copiar contraseña">
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
  return String(s || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Teclado ───────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

initApp();
