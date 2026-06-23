// Event wiring — extraído de index.html para cumplir la CSP sin 'unsafe-inline'
// Corre como último script del body, por lo que todas las funciones ya están definidas.

// Formularios
document.getElementById('form-login').addEventListener('submit', onLogin);
document.getElementById('form-register').addEventListener('submit', onRegister);
document.getElementById('form-mfa-verify').addEventListener('submit', onMfaVerify);
document.getElementById('form-mfa-enroll').addEventListener('submit', onMfaEnroll);
document.getElementById('form-unlock').addEventListener('submit', onUnlock);
document.getElementById('form-create-master').addEventListener('submit', onCreateMaster);
document.getElementById('form-migrate').addEventListener('submit', onMigrate);
document.getElementById('form-private-note').addEventListener('submit', unlockPrivateNote);

// Navegación entre vistas de auth
document.getElementById('btn-show-register').addEventListener('click', () => showView('register'));
document.getElementById('btn-show-login').addEventListener('click', () => showView('login'));
document.getElementById('btn-cancel-mfa').addEventListener('click', () => onLogout(true));
document.getElementById('btn-cancel-enroll').addEventListener('click', () => onLogout(true));
document.getElementById('btn-copy-secret').addEventListener('click', copySecret);
document.getElementById('btn-toggle-secret').addEventListener('click', toggleSecret);
document.getElementById('btn-unlock-logout').addEventListener('click', onLogout);
document.getElementById('btn-migrate-logout').addEventListener('click', onLogout);

// Botones de visibilidad de contraseña
document.getElementById('lPass-eye').addEventListener('click', () => togglePassField('lPass', 'lPassIcon'));
document.getElementById('rPass-eye').addEventListener('click', () => togglePassField('rPass', 'rPassIcon'));
document.getElementById('uPass-eye').addEventListener('click', () => togglePassField('uPass', 'uPassIcon'));
document.getElementById('cmMasterPass-eye').addEventListener('click', () => togglePassField('cmMasterPass', 'cmMasterPassIcon'));
document.getElementById('cmMasterPass2-eye').addEventListener('click', () => togglePassField('cmMasterPass2', 'cmMasterPass2Icon'));
document.getElementById('migOldPass-eye').addEventListener('click', () => togglePassField('migOldPass', 'migOldPassIcon'));
document.getElementById('migMasterPass-eye').addEventListener('click', () => togglePassField('migMasterPass', 'migMasterPassIcon'));
document.getElementById('migMasterPass2-eye').addEventListener('click', () => togglePassField('migMasterPass2', 'migMasterPass2Icon'));
document.getElementById('fPass-eye').addEventListener('click', () => togglePassField('fPass', 'fPassIcon'));

// Tabs — sidebar (escritorio) y barra inferior (móvil)
document.getElementById('tab-crms').addEventListener('click', () => switchTab('crms'));
document.getElementById('tab-domains').addEventListener('click', () => switchTab('domains'));
document.getElementById('tab-private').addEventListener('click', () => switchTab('private'));
document.getElementById('tab-notes').addEventListener('click', () => switchTab('notes'));

document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(btn =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
);

// Menús de usuario (desktop + móvil comparten data-action)
document.getElementById('sidebar-menu-btn').addEventListener('click', toggleMenu);
document.getElementById('mobile-menu-btn').addEventListener('click', toggleMobileMenu);

document.querySelectorAll('[data-action="2fa"]').forEach(el => el.addEventListener('click', openTwoFASettings));
document.querySelectorAll('[data-action="lock"]').forEach(el => el.addEventListener('click', lockVault));
document.querySelectorAll('[data-action="logout"]').forEach(el => el.addEventListener('click', onLogout));

// Barra de herramientas
document.getElementById('search').addEventListener('input', render);
document.getElementById('filterSector').addEventListener('change', render);
document.getElementById('btn-export-pdf').addEventListener('click', exportToPDF);
document.getElementById('btnNew').addEventListener('click', openModal);

// Overlays (cierre al pulsar fuera del modal)
document.getElementById('modalOverlay').addEventListener('click', overlayClick);
document.getElementById('privateNoteOverlay').addEventListener('click', privateNoteOverlayClick);

// Modal de entrada
document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
document.getElementById('modal-save-btn').addEventListener('click', saveEntry);
document.getElementById('fPrivateCategory').addEventListener('change', configurePrivateCategory);
document.getElementById('fNoteType').addEventListener('change', configureNoteType);
document.getElementById('btn-generate-pass').addEventListener('click', generatePassword);
document.getElementById('btn-copy-pass').addEventListener('click', () => copyFieldValue('fPass', 'Contraseña copiada'));

// Modal de nota privada
document.getElementById('private-note-cancel-btn').addEventListener('click', closePrivateNoteAccess);
