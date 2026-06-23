// Operaciones de bóveda — carga y guardado en Supabase (datos siempre cifrados)

let cachedVerifier   = null; // master_verifier legacy (para chequeo de Path 2)
let cachedWrappedDek = null; // wrapped_dek: DEK envuelta con la maestra

// ── Helpers DEK ───────────────────────────────────────────────

async function wrapDek(dek, master) {
  return encryptData(bufToB64(dek.buffer), master);
}

async function unwrapDek(wrapped, master) {
  const b64 = await decryptData(wrapped, master); // lanza si master incorrecto
  return new Uint8Array(b64ToBuf(b64));
}

// ── Meta de la bóveda ─────────────────────────────────────────

async function fetchMasterVerifier() {
  const { data, error } = await sb
    .from('vaults_ga')
    .select('wrapped_dek, master_verifier, encrypted_data')
    .eq('user_id', currentUser.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return { wrappedDek: null, hasVault: false, hasLegacyMaster: false };
    throw error;
  }

  cachedWrappedDek = data.wrapped_dek;
  cachedVerifier   = data.master_verifier;
  return {
    wrappedDek:      data.wrapped_dek,
    hasVault:        !!data.encrypted_data,
    hasLegacyMaster: !!data.master_verifier,
  };
}

async function checkMasterVerifier(pass) {
  if (!cachedVerifier) return false;
  try {
    return (await decryptData(cachedVerifier, pass)) === 'VERIFIED';
  } catch {
    return false;
  }
}

// ── Carga ─────────────────────────────────────────────────────

async function loadVaultFromSupabase() {
  if (!currentUser || !vaultKey) throw new Error('Sin autenticación');
  if (!(await hasAal2Session())) throw new Error('Verifica el 2FA antes de acceder a la bóveda');

  const { data, error } = await sb
    .from('vaults_ga')
    .select('encrypted_data')
    .eq('user_id', currentUser.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      crms = []; domains = []; privateItems = []; notes = [];
      return;
    }
    throw error;
  }

  if (!data.encrypted_data.startsWith('k1:')) {
    throw new Error('Bóveda no migrada al nuevo formato. Reinicia sesión para migrar.');
  }

  const plain   = await decryptWithKey(data.encrypted_data, vaultKey);
  const payload = JSON.parse(plain);
  crms         = Array.isArray(payload.crms)         ? payload.crms         : [];
  domains      = Array.isArray(payload.domains)      ? payload.domains      : [];
  privateItems = Array.isArray(payload.privateItems) ? payload.privateItems : [];
  notes        = Array.isArray(payload.notes)        ? payload.notes        : [];

  const itemsUpgraded = await protectLegacyPrivateItems();
  if (itemsUpgraded) await saveVaultToSupabase();
}

// ── Guardado normal (no toca wrapped_dek ni master_verifier) ──

async function saveVaultToSupabase() {
  if (!currentUser || !vaultKey) return;
  if (!(await hasAal2Session())) throw new Error('Verifica el 2FA antes de sincronizar la bóveda');

  setSyncStatus('syncing');
  try {
    const payload   = JSON.stringify({ crms, domains, privateItems, notes });
    const encrypted = await encryptWithKey(payload, vaultKey);

    const { error } = await sb.from('vaults_ga').upsert(
      { user_id: currentUser.id, encrypted_data: encrypted, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    setSyncStatus('ok');
  } catch (err) {
    setSyncStatus('error');
    throw err;
  }
}

// ── Primer upsert (creación de bóveda nueva) ──────────────────

async function createVaultInSupabase(dek, master) {
  if (!(await hasAal2Session())) throw new Error('Verifica el 2FA antes de crear la bóveda');

  const payload   = JSON.stringify({ crms: [], domains: [], privateItems: [], notes: [] });
  const encrypted = await encryptWithKey(payload, dek);
  const wrapped   = await wrapDek(dek, master);

  const { error } = await sb.from('vaults_ga').upsert(
    {
      user_id:         currentUser.id,
      encrypted_data:  encrypted,
      wrapped_dek:     wrapped,
      master_verifier: null,
      updated_at:      new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
  cachedWrappedDek = wrapped;
}

// ── Migración local (localStorage -> Supabase) ────────────────

async function migrateLocalVault(masterPass = null) {
  const LOCAL_VAULT  = 'crm_manager_v2_vault_data';
  const LOCAL_VERIFY = 'crm_manager_v1_private_verify';
  if (!localStorage.getItem(LOCAL_VAULT)) return;

  const confirmed = confirm(
    'Se detectaron datos guardados localmente.\n¿Migrarlos a tu cuenta en la nube?\n\n' +
    '(Introduce la contraseña local si es diferente a la que usabas antes.)'
  );
  if (!confirmed) return;

  const localPass = prompt('Contraseña local (deja vacío si es la misma que usabas antes):');
  const pass = (localPass && localPass.trim()) ? localPass.trim() : masterPass;

  try {
    const verToken = localStorage.getItem(LOCAL_VERIFY);
    if (verToken) {
      const check = await decryptLegacyLocalData(verToken, pass);
      if (check !== 'VERIFIED') { alert('Contraseña local incorrecta.'); return; }
    }
    const vaultEnc = localStorage.getItem(LOCAL_VAULT);
    const plain    = await decryptLegacyLocalData(vaultEnc, pass);
    const payload  = JSON.parse(plain);

    crms         = Array.isArray(payload.crms)         ? payload.crms         : [];
    domains      = Array.isArray(payload.domains)      ? payload.domains      : [];
    privateItems = Array.isArray(payload.privateItems) ? payload.privateItems : [];
    notes        = Array.isArray(payload.notes)        ? payload.notes        : [];

    await protectLegacyPrivateItems(); // cifra items en claro con la DEK

    await saveVaultToSupabase();

    ['crm_manager_v2_vault_data','crm_manager_v1_private_verify',
     'crm_manager_v1','crm_manager_v1_domains','crm_manager_v1_private_data']
      .forEach(k => localStorage.removeItem(k));

    buildColorMap();
    render();
    showToast(`Migrados ${crms.length + domains.length + privateItems.length + notes.length} registros a la nube`);
  } catch (err) {
    alert('Error al migrar datos locales: ' + err.message);
  }
}

// ── Red de seguridad: items legacy sin secretData ─────────────

async function protectLegacyPrivateItems() {
  let changed = false;
  privateItems = await Promise.all(privateItems.map(async item => {
    if (item.secretData) return item;
    changed = true;
    const text = `${item.marca || ''} ${item.obs || ''}`.toLowerCase();
    let category = 'other';
    if (/openai|anthropic|gemini|mistral|groq|hugging|inteligencia artificial|\bia\b/.test(text)) category = 'ai';
    else if (/api|token|github|gitlab|vercel|stripe|clave|\bkey\b/.test(text)) category = 'api';
    else if (/banco|bank|n26|finanz|tarjeta|paypal/.test(text)) category = 'banking';
    else if (/correo|email|gmail|outlook|mail/.test(text)) category = 'email';
    else if (/facebook|instagram|linkedin|twitter|tiktok|red social/.test(text)) category = 'social';
    else if (/trabajo|empresa|admin|gestión|laboral/.test(text)) category = 'work';
    else if (/compra|tienda|amazon|suscrip/.test(text)) category = 'shopping';
    return {
      id: item.id || crypto.randomUUID(),
      category,
      secretData: await encryptWithKey(JSON.stringify({
        marca: item.marca || '',
        user:  item.user  || '',
        pass:  item.pass  || '',
        obs:   item.obs   || ''
      }), vaultKey),
      created: item.created || Date.now(),
      updated: Date.now()
    };
  }));
  return changed;
}

// ── Migración a DEK (Path 2: vault v2 con master_verifier) ────
// Atómica: no escribe nada hasta tener todos los blobs. Ante cualquier
// fallo antes del upsert, vaultKey queda null y la fila de Supabase intacta.

async function migrateToDek(master) {
  const { data, error } = await sb
    .from('vaults_ga')
    .select('encrypted_data')
    .eq('user_id', currentUser.id)
    .single();
  if (error) throw error;

  let payload;
  try {
    payload = JSON.parse(await decryptData(data.encrypted_data, master));
  } catch {
    throw new Error('La contraseña maestra es incorrecta. Inténtalo de nuevo.');
  }

  const dek = crypto.getRandomValues(new Uint8Array(32));

  const reencryptedPrivateItems = await _reencryptPrivateItems(
    Array.isArray(payload.privateItems) ? payload.privateItems : [],
    master, dek
  );
  const reencryptedNotes = await _reencryptNotes(
    Array.isArray(payload.notes) ? payload.notes : [],
    master, dek
  );

  const newPayload = {
    crms:         Array.isArray(payload.crms)    ? payload.crms    : [],
    domains:      Array.isArray(payload.domains) ? payload.domains : [],
    privateItems: reencryptedPrivateItems,
    notes:        reencryptedNotes,
  };

  const newEncrypted = await encryptWithKey(JSON.stringify(newPayload), dek);
  const wrapped      = await wrapDek(dek, master);

  // Upsert atómico — solo cuando todos los blobs están listos
  const { error: saveError } = await sb.from('vaults_ga').upsert(
    {
      user_id:         currentUser.id,
      encrypted_data:  newEncrypted,
      wrapped_dek:     wrapped,
      master_verifier: null,
      updated_at:      new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );
  if (saveError) throw saveError;

  // Solo tras éxito persistimos en memoria
  vaultKey         = dek;
  cachedWrappedDek = wrapped;
  crms         = newPayload.crms;
  domains      = newPayload.domains;
  privateItems = newPayload.privateItems;
  notes        = newPayload.notes;
}

// ── Migración completa cuenta → maestra → DEK (Path 3) ───────
// Produce formato DEK directamente en un solo paso sin escritura intermedia.

async function migrateToMasterPasswordAndDek(accountPass, masterPass) {
  setSyncStatus('syncing');

  const { data, error } = await sb
    .from('vaults_ga')
    .select('encrypted_data')
    .eq('user_id', currentUser.id)
    .single();
  if (error) { setSyncStatus('error'); throw error; }

  let payload;
  try {
    payload = JSON.parse(await decryptData(data.encrypted_data, accountPass));
  } catch {
    setSyncStatus('error');
    throw new Error('La contraseña anterior es incorrecta. Inténtalo de nuevo.');
  }

  const dek = crypto.getRandomValues(new Uint8Array(32));

  const reencryptedPrivateItems = await _reencryptPrivateItems(
    Array.isArray(payload.privateItems) ? payload.privateItems : [],
    accountPass, dek
  );
  const reencryptedNotes = await _reencryptNotes(
    Array.isArray(payload.notes) ? payload.notes : [],
    accountPass, dek
  );

  const newPayload = {
    crms:         Array.isArray(payload.crms)    ? payload.crms    : [],
    domains:      Array.isArray(payload.domains) ? payload.domains : [],
    privateItems: reencryptedPrivateItems,
    notes:        reencryptedNotes,
  };

  const newEncrypted = await encryptWithKey(JSON.stringify(newPayload), dek);
  const wrapped      = await wrapDek(dek, masterPass); // 1 Argon2id con la nueva maestra

  const { error: saveError } = await sb.from('vaults_ga').upsert(
    {
      user_id:         currentUser.id,
      encrypted_data:  newEncrypted,
      wrapped_dek:     wrapped,
      master_verifier: null,
      updated_at:      new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );
  if (saveError) { setSyncStatus('error'); throw saveError; }

  cachedWrappedDek = wrapped;
  vaultKey         = dek;
  crms         = newPayload.crms;
  domains      = newPayload.domains;
  privateItems = newPayload.privateItems;
  notes        = newPayload.notes;
  setSyncStatus('ok');
}

// ── Helpers internos de re-cifrado ────────────────────────────

async function _reencryptPrivateItems(items, oldPass, dek) {
  return Promise.all(items.map(async item => {
    if (item.secretData) {
      const plain = await decryptData(item.secretData, oldPass);
      return { ...item, secretData: await encryptWithKey(plain, dek) };
    }
    // Item legacy en claro: clasificar y cifrar con DEK
    const text = `${item.marca || ''} ${item.obs || ''}`.toLowerCase();
    let category = 'other';
    if (/openai|anthropic|gemini|mistral|groq|hugging|inteligencia artificial|\bia\b/.test(text)) category = 'ai';
    else if (/api|token|github|gitlab|vercel|stripe|clave|\bkey\b/.test(text)) category = 'api';
    else if (/banco|bank|n26|finanz|tarjeta|paypal/.test(text)) category = 'banking';
    else if (/correo|email|gmail|outlook|mail/.test(text)) category = 'email';
    else if (/facebook|instagram|linkedin|twitter|tiktok|red social/.test(text)) category = 'social';
    else if (/trabajo|empresa|admin|gestión|laboral/.test(text)) category = 'work';
    else if (/compra|tienda|amazon|suscrip/.test(text)) category = 'shopping';
    return {
      id: item.id || crypto.randomUUID(),
      category,
      secretData: await encryptWithKey(JSON.stringify({
        marca: item.marca || '',
        user:  item.user  || '',
        pass:  item.pass  || '',
        obs:   item.obs   || ''
      }), dek),
      created: item.created || Date.now(),
      updated: Date.now()
    };
  }));
}

async function _reencryptNotes(notes, oldPass, dek) {
  return Promise.all(notes.map(async note => {
    if (!note.secretData) return note; // nota no privada, se queda igual
    const plain = await decryptData(note.secretData, oldPass);
    return { ...note, secretData: await encryptWithKey(plain, dek) };
  }));
}
