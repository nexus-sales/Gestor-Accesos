// Autenticación: login, registro, 2FA (TOTP), desbloqueo de bóveda

let currentUser    = null;
let vaultPassword  = null;  // DEPRECATED — sustituido por vaultKey (DEK)
let vaultKey       = null;  // DEK (32 bytes) — clave de datos real; solo en memoria
let cachedHasLegacyMaster = false;
let pendingFactorId   = null;
let pendingChallengeId = null;
let enrollingFactorId = null;

// ── Pantallas ────────────────────────────────────────────────

function showLoading() {
  document.getElementById('screen-loading').classList.remove('hidden');
  document.getElementById('screen-auth').classList.add('hidden');
  document.getElementById('screen-app').classList.add('hidden');
}

function showAuth(view) {
  document.getElementById('screen-loading').classList.add('hidden');
  document.getElementById('screen-auth').classList.remove('hidden');
  document.getElementById('screen-app').classList.add('hidden');
  showView(view);
}

function showApp() {
  document.getElementById('screen-loading').classList.add('hidden');
  document.getElementById('screen-auth').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
  document.getElementById('menuEmail').textContent = currentUser?.email || '';
  updateBtnNew();
  buildColorMap();
  render();
}

function showView(name) {
  ['login','register','mfa-verify','mfa-enroll','unlock','create-master','migrate'].forEach(v => {
    document.getElementById('view-' + v).classList.toggle('hidden', v !== name);
  });
  const view = document.getElementById('view-' + name);
  const first = view?.querySelector('input');
  if (first) setTimeout(() => first.focus(), 60);
}

// ── Init ─────────────────────────────────────────────────────

async function initApp() {
  showLoading();
  try {
    const { data: { session } } = await sb.auth.getSession();

    if (!session) { showAuth('login'); return; }

    currentUser = session.user;
    const factors = await getVerifiedTotpFactors();

    if (factors.length === 0) {
      await startEnrollment();
      showAuth('mfa-enroll');
      return;
    }

    if (!(await hasAal2Session())) {
      await beginMfaChallenge(factors);
      showAuth('mfa-verify');
      return;
    }

    await initUnlockFlow();
  } catch {
    showAuth('login');
  }
}

// ── Login ────────────────────────────────────────────────────

async function onLogin(e) {
  e.preventDefault();
  const email = document.getElementById('lEmail').value.trim();
  const pass  = document.getElementById('lPass').value;

  setBtnLoading('lBtn', true);
  hideMsg('lError');

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;

    currentUser = data.user;

    const factors = await getVerifiedTotpFactors();
    if (factors.length === 0) {
      await startEnrollment();
      showAuth('mfa-enroll');
    } else if (!(await hasAal2Session())) {
      await beginMfaChallenge(factors);
      showAuth('mfa-verify');
    } else {
      await initUnlockFlow();
    }
  } catch (err) {
    showMsg('lError', authError(err.message));
  } finally {
    setBtnLoading('lBtn', false);
  }
}

// ── Registro ─────────────────────────────────────────────────

async function onRegister(e) {
  e.preventDefault();
  const email = document.getElementById('rEmail').value.trim();
  const pass1 = document.getElementById('rPass').value;
  const pass2 = document.getElementById('rPass2').value;

  if (pass1 !== pass2) { showMsg('rError', 'Las contraseñas no coinciden.'); return; }

  setBtnLoading('rBtn', true);
  hideMsg('rError'); hideMsg('rInfo');

  try {
    const { data, error } = await sb.auth.signUp({ email, password: pass1 });
    if (error) throw error;

    if (data.user && !data.session) {
      showMsg('rInfo', `Confirma tu email en ${email} y vuelve a iniciar sesión.`);
      return;
    }

    currentUser = data.user;

    await startEnrollment();
    showAuth('mfa-enroll');
  } catch (err) {
    showMsg('rError', authError(err.message));
  } finally {
    setBtnLoading('rBtn', false);
  }
}

// ── Verificar 2FA (login) ────────────────────────────────────

async function onMfaVerify(e) {
  e.preventDefault();
  const code = document.getElementById('mfaCode').value.trim();

  setBtnLoading('mfaBtn', true);
  hideMsg('mfaError');

  try {
    const { error } = await sb.auth.mfa.verify({
      factorId: pendingFactorId,
      challengeId: pendingChallengeId,
      code
    });
    if (error) throw error;
    await requireAal2Session();
    await initUnlockFlow();
  } catch (err) {
    showMsg('mfaError', err.message || 'Código incorrecto. Inténtalo de nuevo.');
    document.getElementById('mfaCode').value = '';
    document.getElementById('mfaCode').focus();
  } finally {
    setBtnLoading('mfaBtn', false);
  }
}

// ── Activar 2FA (registro) ───────────────────────────────────

async function onMfaEnroll(e) {
  e.preventDefault();
  const code = document.getElementById('enrollCode').value.trim();
  hideMsg('enrollError');

  try {
    const { data: challenge } = await sb.auth.mfa.challenge({ factorId: enrollingFactorId });
    const { error } = await sb.auth.mfa.verify({
      factorId: enrollingFactorId,
      challengeId: challenge.id,
      code
    });
    if (error) throw error;
    await requireAal2Session();

    showToast('2FA activado correctamente');
    await initUnlockFlow();
  } catch (err) {
    showMsg('enrollError', err.message || 'Código incorrecto. Verifica tu app de autenticación.');
    document.getElementById('enrollCode').value = '';
  }
}

// ── Desbloquear bóveda ───────────────────────────────────────

async function onUnlock(e) {
  e.preventDefault();
  const pass = document.getElementById('uPass').value;

  setBtnLoading('uBtn', true);
  hideMsg('uError');

  try {
    if (!(await ensureMfaSatisfied())) return;

    if (cachedWrappedDek) {
      // Path 1: DEK envuelta — solo un descifrado AES-GCM
      try {
        vaultKey = await unwrapDek(cachedWrappedDek, pass);
      } catch {
        showMsg('uError', 'Contraseña maestra incorrecta.');
        document.getElementById('uPass').value = '';
        return;
      }
    } else {
      // Path 2: vault v2 + master_verifier — migración transparente a DEK
      if (!(await checkMasterVerifier(pass))) {
        showMsg('uError', 'Contraseña maestra incorrecta.');
        document.getElementById('uPass').value = '';
        return;
      }
      showToast('Actualizando bóveda…');
      await migrateToDek(pass); // atómico; setea vaultKey + vars globales
    }

    await loadVaultFromSupabase();
    showApp();
    resetInactivity();
    migrateLocalVault(pass);
  } catch (err) {
    vaultKey = null;
    showMsg('uError', err.message);
    document.getElementById('uPass').value = '';
  } finally {
    setBtnLoading('uBtn', false);
  }
}

// ── Flujo de unlock tras 2FA ──────────────────────────────────

async function initUnlockFlow() {
  document.getElementById('unlockEmail').textContent = currentUser?.email || '';
  const { wrappedDek, hasVault, hasLegacyMaster } = await fetchMasterVerifier();
  cachedHasLegacyMaster = hasLegacyMaster;
  // Path 1: wrapped_dek → unlock normal
  // Path 2: sin wrapped_dek + vault + master_verifier → unlock (migración transparente)
  // Path 3: sin wrapped_dek + vault + sin master_verifier → migrate
  // Path 4: sin vault → create-master
  if (wrappedDek || (hasVault && hasLegacyMaster)) {
    showAuth('unlock');
    const showPasskey = cachedPasskeySlots.length > 0
      && typeof isPasskeyUsableHere === 'function'
      && isPasskeyUsableHere()
      && isPasskeySupported();
    document.getElementById('passkey-unlock-section').classList.toggle('hidden', !showPasskey);
  } else if (hasVault) {
    showAuth('migrate');
  } else {
    showAuth('create-master');
  }
}

// ── Crear contraseña maestra (usuario nuevo) ──────────────────

async function onCreateMaster(e) {
  e.preventDefault();
  const pass1 = document.getElementById('cmMasterPass').value;
  const pass2 = document.getElementById('cmMasterPass2').value;

  hideMsg('cmError');
  if (pass1 !== pass2) { showMsg('cmError', 'Las contraseñas maestras no coinciden.'); return; }

  setBtnLoading('cmBtn', true);
  try {
    const dek = crypto.getRandomValues(new Uint8Array(32));
    vaultKey = dek;
    crms = []; domains = []; privateItems = []; notes = [];
    await createVaultInSupabase(dek, pass1);
    showApp();
    resetInactivity();
    migrateLocalVault(pass1);
  } catch (err) {
    vaultKey = null;
    showMsg('cmError', 'Error al crear la bóveda: ' + err.message);
  } finally {
    setBtnLoading('cmBtn', false);
  }
}

// ── Migrar bóveda legacy ──────────────────────────────────────

async function onMigrate(e) {
  e.preventDefault();
  const oldPass  = document.getElementById('migOldPass').value;
  const pass1    = document.getElementById('migMasterPass').value;
  const pass2    = document.getElementById('migMasterPass2').value;

  hideMsg('migError');
  if (pass1 !== pass2) { showMsg('migError', 'Las contraseñas maestras no coinciden.'); return; }

  setBtnLoading('migBtn', true);
  try {
    await migrateToMasterPasswordAndDek(oldPass, pass1); // atómico; setea vaultKey + vars globales
    showApp();
    resetInactivity();
    migrateLocalVault(pass1);
  } catch (err) {
    showMsg('migError', err.message);
  } finally {
    setBtnLoading('migBtn', false);
  }
}

// ── Desbloquear con passkey (AND: maestra + passkey físico) ──

async function onUnlockWithPasskey(e) {
  e.preventDefault();
  const pass = document.getElementById('uPass').value;
  if (!pass) {
    showMsg('uError', 'Introduce la contraseña maestra — los passkeys la necesitan para abrir.');
    document.getElementById('uPass').focus();
    return;
  }

  setBtnLoading('uPasskeyBtn', true);
  hideMsg('uError');

  try {
    if (!(await ensureMfaSatisfied())) return;
    await unlockWithPasskey(pass);      // setea vaultKey
    await loadVaultFromSupabase();
    showApp();
    resetInactivity();
    migrateLocalVault(pass);
  } catch (err) {
    vaultKey = null;
    showMsg('uError', err.message);
  } finally {
    setBtnLoading('uPasskeyBtn', false);
  }
}

// ── Logout / Lock ────────────────────────────────────────────

async function onLogout(silent = false) {
  clearVaultData();
  await sb.auth.signOut();
  currentUser = null;
  if (!silent) showToast('Sesión cerrada');
  showAuth('login');
}

function lockVault() {
  clearVaultData();
  closeMenu();
  closeMobileMenu();
  document.getElementById('unlockEmail').textContent = currentUser?.email || '';
  showAuth('unlock');
  const showPasskey = cachedPasskeySlots.length > 0
    && typeof isPasskeyUsableHere === 'function'
    && isPasskeyUsableHere()
    && isPasskeySupported();
  document.getElementById('passkey-unlock-section').classList.toggle('hidden', !showPasskey);
}

function clearVaultData() {
  clearAllPrivateNoteAccess();
  crms = []; domains = []; privateItems = []; notes = [];
  vaultPassword = null;
  vaultKey = null;
  visiblePass = {};
  if (lockTimer) clearTimeout(lockTimer);
}

// ── Menú usuario ─────────────────────────────────────────────

function toggleMenu() {
  document.getElementById('userMenu').classList.toggle('hidden');
}

function closeMenu() {
  document.getElementById('userMenu').classList.add('hidden');
}

function toggleMobileMenu() {
  document.getElementById('mobileUserMenu').classList.toggle('hidden');
}

function closeMobileMenu() {
  document.getElementById('mobileUserMenu')?.classList.add('hidden');
}

document.addEventListener('click', e => {
  const wrap = document.querySelector('.user-wrap');
  if (wrap && !wrap.contains(e.target)) closeMenu();
  const mobileWrap = document.querySelector('.mobile-user-wrap');
  if (mobileWrap && !mobileWrap.contains(e.target)) closeMobileMenu();
});

async function openTwoFASettings() {
  closeMenu();
  closeMobileMenu();
  const { data: factors } = await sb.auth.mfa.listFactors();
  const totp = getVerifiedFromList(factors?.totp ?? []);

  if (totp.length > 0) {
    alert('2FA es obligatorio para proteger la bóveda. No se puede desactivar desde la app.');
  } else {
    const ok = confirm('¿Activar la autenticación en dos pasos (2FA)?');
    if (!ok) return;
    try {
      await startEnrollment();
      showAuth('mfa-enroll');
      document.getElementById('screen-app').classList.add('hidden');
    } catch (err) {
      alert('Error al iniciar 2FA: ' + err.message);
    }
  }
}

// ── Helpers internos ─────────────────────────────────────────

async function ensureMfaSatisfied() {
  const factors = await getVerifiedTotpFactors();
  if (factors.length === 0) {
    await startEnrollment();
    showAuth('mfa-enroll');
    return false;
  }
  if (!(await hasAal2Session())) {
    await beginMfaChallenge(factors);
    showAuth('mfa-verify');
    return false;
  }
  return true;
}

async function hasAal2Session() {
  const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return aal?.currentLevel === 'aal2';
}

async function requireAal2Session() {
  if (await hasAal2Session()) return;
  await sb.auth.refreshSession();
  if (!(await hasAal2Session())) {
    throw new Error('La sesión todavía no está verificada con 2FA. Vuelve a intentarlo.');
  }
}

async function getVerifiedTotpFactors() {
  const { data: factors, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return getVerifiedFromList(factors?.totp ?? []);
}

function getVerifiedFromList(factors) {
  return factors.filter(f => (f.status || f.factor_status) === 'verified');
}

async function beginMfaChallenge(knownFactors) {
  const totp = knownFactors || await getVerifiedTotpFactors();
  if (totp.length === 0) return;
  pendingFactorId = totp[0].id;
  const { data: ch, error } = await sb.auth.mfa.challenge({ factorId: pendingFactorId });
  if (error) throw error;
  pendingChallengeId = ch.id;
}

async function startEnrollment() {
  const { data, error } = await sb.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'Gestor de Accesos'
  });
  if (error) throw error;

  enrollingFactorId = data.id;

  const qrBox = document.getElementById('qrBox');
  qrBox.innerHTML = '';
  if (data.totp?.qr_code) {
    const qrCode = data.totp.qr_code;
    if (qrCode.startsWith('data:')) {
      const img = document.createElement('img');
      img.src = qrCode;
      img.alt = 'QR 2FA';
      img.style.cssText = 'width:260px;height:260px;display:block;margin:0 auto;';
      qrBox.appendChild(img);
    } else {
      qrBox.innerHTML = qrCode;
      const svg = qrBox.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', '260');
        svg.setAttribute('height', '260');
        svg.style.cssText = 'display:block;margin:0 auto;';
      }
    }
  }
  document.getElementById('secretCode').textContent = data.totp?.secret ?? '';
}

function toggleSecret() {
  document.getElementById('secretBox').classList.toggle('hidden');
}

function copySecret() {
  const code = document.getElementById('secretCode').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Clave copiada'));
}

// ── UI helpers ───────────────────────────────────────────────

function togglePassField(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  if (icon) icon.className = show ? 'ti ti-eye-off' : 'ti ti-eye';
}

function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn._html = btn.innerHTML;
    btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> Cargando…';
  } else if (btn._html) {
    btn.innerHTML = btn._html;
  }
}

function showMsg(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function hideMsg(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function authError(msg) {
  const map = {
    'Invalid login credentials': 'Email o contraseña incorrectos.',
    'Email not confirmed': 'Confirma tu email antes de iniciar sesión.',
    'User already registered': 'Este email ya está registrado.',
  };
  return map[msg] ?? msg;
}
