// Panel de administración — solo accesible para usuarios con is_admin = true

function updateAdminNav() {
  const visible = !!currentUser?.is_admin;
  document.getElementById('menu-admin-btn')?.classList.toggle('hidden', !visible);
  document.getElementById('menu-admin-sep')?.classList.toggle('hidden', !visible);
  document.getElementById('mobile-menu-admin-btn')?.classList.toggle('hidden', !visible);
  document.getElementById('mobile-menu-admin-sep')?.classList.toggle('hidden', !visible);
}

async function openAdminPanel() {
  closeMenu();
  closeMobileMenu();
  document.getElementById('admin-panel').classList.remove('hidden');
  await loadAdminUsers();
}

function closeAdminPanel() {
  document.getElementById('admin-panel').classList.add('hidden');
  document.getElementById('admin-error').classList.add('hidden');
}

async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-body');
  const errEl = document.getElementById('admin-error');
  errEl.classList.add('hidden');
  tbody.innerHTML = '<tr><td colspan="4" class="admin-empty"><i class="ti ti-loader-2 spin"></i> Cargando…</td></tr>';

  try {
    const { users } = await apiFetch('/admin/users');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="admin-empty">No hay usuarios registrados.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(u => {
      const date    = new Date(u.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
      const isSelf  = u.id === currentUser?.id;
      const actions = (u.is_admin || isSelf)
        ? `<span class="admin-self-badge">${u.is_admin ? 'Admin' : 'Tú'}</span>`
        : `<button type="button" class="btn admin-btn-sm ${u.is_blocked ? 'admin-btn-unblock' : 'admin-btn-block'}"
              data-admin-action="toggle-block"
              data-user-id="${u.id}"
              data-is-blocked="${u.is_blocked}">
              ${u.is_blocked ? '<i class="ti ti-lock-open"></i> Desbloquear' : '<i class="ti ti-ban"></i> Bloquear'}
           </button>
           <button type="button" class="btn admin-btn-sm admin-btn-delete"
              data-admin-action="delete-user"
              data-user-id="${u.id}"
              data-user-email="${escapeHtml(u.email)}">
              <i class="ti ti-trash"></i> Eliminar
           </button>`;
      return `<tr>
        <td class="admin-col-email">${escapeHtml(u.email)}</td>
        <td class="admin-col-date">${date}</td>
        <td><span class="admin-status ${u.is_blocked ? 'admin-status--blocked' : 'admin-status--active'}">${u.is_blocked ? 'Bloqueado' : 'Activo'}</span></td>
        <td class="admin-col-actions">${actions}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    tbody.innerHTML = '';
  }
}

async function adminToggleBlock(userId, isBlocked) {
  const errEl = document.getElementById('admin-error');
  try {
    await apiFetch(`/admin/users/${userId}`, { method: 'PATCH', body: { is_blocked: !isBlocked } });
    await loadAdminUsers();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function adminDeleteUser(userId, email) {
  if (!confirm(`¿Eliminar permanentemente la cuenta de ${email}?\n\nEsta acción borrará el usuario y su bóveda completa. Es irreversible.`)) return;
  const typed = prompt(`Para confirmar, escribe el email exactamente:\n\n${email}`);
  if (typed === null) return; // canceló
  if (typed !== email) { alert('El email no coincide. Operación cancelada.'); return; }

  const errEl = document.getElementById('admin-error');
  try {
    await apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });
    showToast(`Cuenta ${email} eliminada`);
    await loadAdminUsers();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Event listeners ───────────────────────────────────────────

document.getElementById('btn-admin-close')?.addEventListener('click', closeAdminPanel);

// Cierra el panel al hacer clic fuera del recuadro blanco
document.getElementById('admin-panel')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeAdminPanel();
});

// Delegación de acciones en la tabla
document.getElementById('admin-users-body')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-admin-action]');
  if (!btn) return;
  const { adminAction, userId, userEmail, isBlocked } = btn.dataset;
  if (adminAction === 'toggle-block') adminToggleBlock(userId, isBlocked === 'true');
  if (adminAction === 'delete-user')  adminDeleteUser(userId, userEmail);
});

// Menú desktop + móvil
document.querySelectorAll('[data-action="admin"]').forEach(el =>
  el.addEventListener('click', openAdminPanel)
);
