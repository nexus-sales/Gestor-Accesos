// Cliente API — reemplaza el SDK de Supabase.
// Todas las llamadas van a /api/* en el mismo origen (sin CORS).
// La sesión se gestiona con una cookie httpOnly; el JS nunca ve el token.

async function apiFetch(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Auth ─────────────────────────────────────────────────────
const apiGetSession     = ()                   => apiFetch('/auth/session');
const apiLogin          = (email, pass)        => apiFetch('/auth/login',    { method: 'POST', body: { email, password: pass } });
const apiRegister       = (email, pass)        => apiFetch('/auth/register', { method: 'POST', body: { email, password: pass } });
const apiLogout         = ()                   => apiFetch('/auth/logout',   { method: 'POST' });
const apiRefreshSession = ()                   => apiFetch('/auth/refresh',  { method: 'POST' });

// ── MFA ──────────────────────────────────────────────────────
const apiMfaGetAal      = ()                   => apiFetch('/auth/mfa/aal');
const apiMfaListFactors = ()                   => apiFetch('/auth/mfa/factors');
const apiMfaEnroll      = ()                   => apiFetch('/auth/mfa/enroll',    { method: 'POST' });
const apiMfaChallenge   = factorId             => apiFetch('/auth/mfa/challenge', { method: 'POST', body: { factorId } });
const apiMfaVerify      = (fId, cId, code)     => apiFetch('/auth/mfa/verify',   { method: 'POST', body: { factorId: fId, challengeId: cId, code } });

// ── Vault ─────────────────────────────────────────────────────
const apiVaultGet       = ()                   => apiFetch('/vault');
const apiVaultSave      = fields               => apiFetch('/vault', { method: 'PUT', body: fields });
