// Operaciones de bóveda — carga y guardado en Supabase (datos siempre cifrados)

async function loadVaultFromSupabase() {
  if (!currentUser || !vaultPassword) throw new Error('Sin autenticación');
  if (!(await hasAal2Session())) throw new Error('Verifica el 2FA antes de acceder a la bóveda');

  const { data, error } = await sb
    .from('vaults_ga')
    .select('encrypted_data')
    .eq('user_id', currentUser.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Bóveda nueva — sin datos aún
      crms = []; domains = []; privateItems = []; notes = [];
      return;
    }
    throw error;
  }

  const plain   = await decryptData(data.encrypted_data, vaultPassword);
  const payload = JSON.parse(plain);
  crms         = Array.isArray(payload.crms)         ? payload.crms         : [];
  domains      = Array.isArray(payload.domains)      ? payload.domains      : [];
  privateItems = Array.isArray(payload.privateItems) ? payload.privateItems : [];
  notes        = Array.isArray(payload.notes)        ? payload.notes        : [];
  if (await protectLegacyPrivateItems()) await saveVaultToSupabase();
}

async function saveVaultToSupabase() {
  if (!currentUser || !vaultPassword) return;
  if (!(await hasAal2Session())) throw new Error('Verifica el 2FA antes de sincronizar la bóveda');

  setSyncStatus('syncing');
  try {
    const payload   = JSON.stringify({ crms, domains, privateItems, notes });
    const encrypted = await encryptData(payload, vaultPassword);

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

async function migrateLocalVault() {
  const LOCAL_VAULT   = 'crm_manager_v2_vault_data';
  const LOCAL_VERIFY  = 'crm_manager_v1_private_verify';
  if (!localStorage.getItem(LOCAL_VAULT)) return;

  const confirmed = confirm(
    'Se detectaron datos guardados localmente.\n¿Migrarlos a tu cuenta en la nube?\n\n' +
    '(Introduce la contraseña local si es diferente a la cuenta actual.)'
  );
  if (!confirmed) return;

  const localPass = prompt('Contraseña local (deja vacío si es la misma que tu cuenta):');
  const pass = (localPass && localPass.trim()) ? localPass.trim() : vaultPassword;

  try {
    const verToken = localStorage.getItem(LOCAL_VERIFY);
    if (verToken) {
      const check = await decryptData(verToken, pass);
      if (check !== 'VERIFIED') { alert('Contraseña local incorrecta.'); return; }
    }
    const vaultEnc = localStorage.getItem(LOCAL_VAULT);
    const plain    = await decryptData(vaultEnc, pass);
    const payload  = JSON.parse(plain);

    crms         = Array.isArray(payload.crms)         ? payload.crms         : [];
    domains      = Array.isArray(payload.domains)      ? payload.domains      : [];
    privateItems = Array.isArray(payload.privateItems) ? payload.privateItems : [];
    notes        = Array.isArray(payload.notes)        ? payload.notes        : [];

    await protectLegacyPrivateItems();

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
      secretData: await encryptData(JSON.stringify({
        marca: item.marca || '',
        user: item.user || '',
        pass: item.pass || '',
        obs: item.obs || ''
      }), vaultPassword),
      created: item.created || Date.now(),
      updated: Date.now()
    };
  }));
  return changed;
}
