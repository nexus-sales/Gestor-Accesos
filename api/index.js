'use strict';

const { Pool }          = require('pg');
const bcrypt            = require('bcryptjs');
const jwt               = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode            = require('qrcode');

// ── Config ────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET debe tener al menos 32 caracteres');
  process.exit(1);
}

const COOKIE    = 'ga_session';
const TOKEN_TTL = 8 * 60 * 60;    // 8 horas en segundos
const BCRYPT_R  = 12;
const IS_DEV    = process.env.NODE_ENV === 'development';

// Tolerancia de ±1 ventana (30s) para desfases de reloj en TOTP
authenticator.options = { window: 1 };

// ── Rate limiting (in-memory, instancia única) ────────────────
// Para múltiples réplicas se necesitaría un store compartido (Redis).

const RL = new Map(); // key → { count, resetAt }

function rateCheck(key, maxHits, windowMs) {
  const now = Date.now();
  let r = RL.get(key);
  if (!r || now >= r.resetAt) {
    r = { count: 0, resetAt: now + windowMs };
    RL.set(key, r);
  }
  r.count++;
  if (r.count > maxHits) {
    const retryAfter = Math.ceil((r.resetAt - now) / 1000);
    const e = new Error(`Demasiados intentos. Espera ${retryAfter} s.`);
    e.status      = 429;
    e.retryAfter  = retryAfter;
    throw e;
  }
}

// Limpia entradas expiradas cada 5 minutos para evitar fugas de memoria
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of RL) if (now >= v.resetAt) RL.delete(k);
}, 5 * 60 * 1000).unref();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

// ── Cookie helpers ────────────────────────────────────────────

function setCookieHeader(token) {
  const secure = IS_DEV ? '' : '; Secure';
  return `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Strict; Max-Age=${TOKEN_TTL}; Path=/`;
}

function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/`;
}

function extractToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

// ── JWT helpers ───────────────────────────────────────────────

function sign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function parseSession(req) {
  const t = extractToken(req);
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); }
  catch { return null; }
}

// ── Request / Response helpers ────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 256 * 1024) reject(new Error('Payload too large')); });
    req.on('end',  () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

function fail(res, status, message, headers = {}) {
  send(res, status, { error: message }, headers);
}

// ── Auth guards ───────────────────────────────────────────────

function needSession(req) {
  const s = parseSession(req);
  if (!s) { const e = new Error('No autenticado'); e.status = 401; throw e; }
  return s;
}

function needAal2(req) {
  const s = needSession(req);
  if (s.aal !== 'aal2') { const e = new Error('Se requiere 2FA verificado'); e.status = 403; throw e; }
  return s;
}

function needAdmin(req) {
  const s = needAal2(req);
  if (!s.is_admin) { const e = new Error('Acceso denegado'); e.status = 403; throw e; }
  return s;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Router ────────────────────────────────────────────────────

async function handleApi(req, res, pathname) {
  const m = req.method;
  try {
    if (pathname === '/api/auth/register'      && m === 'POST') return await register(req, res);
    if (pathname === '/api/auth/login'         && m === 'POST') return await login(req, res);
    if (pathname === '/api/auth/logout'        && m === 'POST') return await logout(req, res);
    if (pathname === '/api/auth/session'       && m === 'GET')  return await session(req, res);
    if (pathname === '/api/auth/refresh'       && m === 'POST') return await refresh(req, res);
    if (pathname === '/api/auth/mfa/aal'       && m === 'GET')  return await mfaAal(req, res);
    if (pathname === '/api/auth/mfa/factors'   && m === 'GET')  return await mfaFactors(req, res);
    if (pathname === '/api/auth/mfa/enroll'    && m === 'POST') return await mfaEnroll(req, res);
    if (pathname === '/api/auth/mfa/challenge' && m === 'POST') return await mfaChallenge(req, res);
    if (pathname === '/api/auth/mfa/verify'    && m === 'POST') return await mfaVerify(req, res);
    if (pathname === '/api/vault'              && m === 'GET')  return await vaultGet(req, res);
    if (pathname === '/api/vault'              && m === 'PUT')  return await vaultSave(req, res);
    if (pathname === '/api/admin/users'        && m === 'GET')  return await adminListUsers(req, res);
    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch) {
      if (m === 'PATCH')  return await adminPatchUser(req, res, adminUserMatch[1]);
      if (m === 'DELETE') return await adminDeleteUser(req, res, adminUserMatch[1]);
    }
    fail(res, 404, 'Ruta no encontrada');
  } catch (e) {
    if (e.status) {
      const extra = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {};
      return fail(res, e.status, e.message, extra);
    }
    console.error('[api error]', e.message);
    fail(res, 500, 'Error interno del servidor');
  }
}

// ── Auth: registro ────────────────────────────────────────────

async function register(req, res) {
  rateCheck(`reg:${clientIp(req)}`, 5, 60 * 60 * 1000); // 5 registros/IP/hora
  const { email, password } = await readBody(req);
  if (!email || !password)    return fail(res, 400, 'Email y contraseña requeridos');
  if (password.length < 10)   return fail(res, 400, 'La contraseña debe tener al menos 10 caracteres');

  const hash = await bcrypt.hash(password, BCRYPT_R);
  let user;
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, pass_hash) VALUES ($1, $2) RETURNING id, email',
      [email.toLowerCase().trim(), hash]
    );
    user = rows[0];
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'Este email ya está registrado.');
    throw e;
  }

  const token = sign({ sub: user.id, email: user.email, aal: 'aal1', is_admin: false });
  send(res, 201, { user: { id: user.id, email: user.email, is_admin: false } },
    { 'Set-Cookie': setCookieHeader(token) });
}

// ── Auth: login ───────────────────────────────────────────────

async function login(req, res) {
  const { email, password } = await readBody(req);
  if (!email || !password) return fail(res, 400, 'Email y contraseña requeridos');

  const ip = clientIp(req);
  const emailNorm = email.toLowerCase().trim();
  rateCheck(`login:ip:${ip}`,            10, 15 * 60 * 1000); // 10 intentos/IP/15min
  rateCheck(`login:email:${emailNorm}`,   5, 15 * 60 * 1000); // 5 intentos/cuenta/15min

  const { rows } = await pool.query(
    'SELECT id, email, pass_hash, is_blocked, is_admin FROM users WHERE email = $1',
    [emailNorm]
  );

  // bcrypt.compare siempre se ejecuta para evitar timing attacks
  const fakeHash = '$2b$12$invalidhashfortimingprotectionXXXXXXXXXXX';
  const hash     = rows[0]?.pass_hash ?? fakeHash;
  const valid    = await bcrypt.compare(password, hash);

  if (!valid || !rows[0]) return fail(res, 401, 'Invalid login credentials');

  const user = rows[0];
  if (user.is_blocked) return fail(res, 403, 'Tu cuenta ha sido suspendida. Contacta con el administrador.');

  const token = sign({ sub: user.id, email: user.email, aal: 'aal1', is_admin: user.is_admin });
  send(res, 200, { user: { id: user.id, email: user.email, is_admin: user.is_admin } },
    { 'Set-Cookie': setCookieHeader(token) });
}

// ── Auth: logout ──────────────────────────────────────────────

async function logout(req, res) {
  send(res, 200, {}, { 'Set-Cookie': clearCookieHeader() });
}

// ── Auth: sesión actual ───────────────────────────────────────

async function session(req, res) {
  const s = parseSession(req);
  if (!s) return send(res, 200, { session: null });
  send(res, 200, { session: { user: { id: s.sub, email: s.email, is_admin: s.is_admin ?? false }, aal: s.aal } });
}

// ── Auth: refrescar sesión (renueva TTL, mantiene AAL) ────────

async function refresh(req, res) {
  const s     = needSession(req);
  const token = sign({ sub: s.sub, email: s.email, aal: s.aal, is_admin: s.is_admin ?? false });
  send(res, 200, { session: { user: { id: s.sub, email: s.email, is_admin: s.is_admin ?? false }, aal: s.aal } },
    { 'Set-Cookie': setCookieHeader(token) });
}

// ── MFA: nivel de aseguramiento ───────────────────────────────

async function mfaAal(req, res) {
  const s = parseSession(req);
  send(res, 200, { currentLevel: s?.aal ?? 'aal0' });
}

// ── MFA: listar factores ──────────────────────────────────────

async function mfaFactors(req, res) {
  const s = needSession(req);
  const { rows } = await pool.query(
    'SELECT id, status FROM totp_factors WHERE user_id = $1 ORDER BY created_at',
    [s.sub]
  );
  send(res, 200, { totp: rows });
}

// ── MFA: matricular factor TOTP ───────────────────────────────

async function mfaEnroll(req, res) {
  const s = needSession(req);

  // Elimina matrículas previas sin verificar para este usuario
  await pool.query(
    "DELETE FROM totp_factors WHERE user_id = $1 AND status = 'unverified'", [s.sub]
  );

  const secret = authenticator.generateSecret();
  const { rows } = await pool.query(
    "INSERT INTO totp_factors (user_id, secret, status) VALUES ($1, $2, 'unverified') RETURNING id",
    [s.sub, secret]
  );

  const uri    = authenticator.keyuri(s.email, 'Gestor de Accesos', secret);
  const qrCode = await QRCode.toDataURL(uri);

  send(res, 200, { id: rows[0].id, totp: { qr_code: qrCode, secret, uri } });
}

// ── MFA: challenge (TOTP es time-based, no requiere challenge de servidor) ──

async function mfaChallenge(req, res) {
  needSession(req);
  const { factorId } = await readBody(req);
  // Devolvemos un ID dummy para compatibilidad con el flujo de auth.js
  send(res, 200, { id: `${factorId}:totp` });
}

// ── MFA: verificar código TOTP → sube sesión a AAL2 ──────────

async function mfaVerify(req, res) {
  const s = needSession(req);
  const { factorId, code } = await readBody(req);
  if (!factorId || !code) return fail(res, 400, 'factorId y code requeridos');

  rateCheck(`mfa:${s.sub}`, 5, 5 * 60 * 1000); // 5 intentos/usuario/5min

  const { rows } = await pool.query(
    'SELECT secret, status FROM totp_factors WHERE id = $1 AND user_id = $2',
    [factorId, s.sub]
  );
  if (!rows[0]) return fail(res, 404, 'Factor no encontrado');

  const valid = authenticator.verify({ token: code.replace(/\s/g, ''), secret: rows[0].secret });
  if (!valid)  return fail(res, 422, 'Código incorrecto. Inténtalo de nuevo.');

  if (rows[0].status !== 'verified') {
    await pool.query("UPDATE totp_factors SET status = 'verified' WHERE id = $1", [factorId]);
  }

  const token = sign({ sub: s.sub, email: s.email, aal: 'aal2' });
  send(res, 200, {}, { 'Set-Cookie': setCookieHeader(token) });
}

// ── Vault: leer bóveda ────────────────────────────────────────

async function vaultGet(req, res) {
  const s = needAal2(req);
  const { rows } = await pool.query(
    'SELECT encrypted_data, wrapped_dek, master_verifier, passkey_slots FROM vaults WHERE user_id = $1',
    [s.sub]
  );
  // Nunca logueamos el contenido — solo confirmamos éxito
  send(res, 200, { data: rows[0] ?? null });
}

// ── Vault: guardar / actualizar bóveda ────────────────────────
// Solo actualiza los campos presentes en el body; campos ausentes se preservan.
// Esto permite actualizaciones parciales (solo encrypted_data, o solo passkey_slots, etc.)

async function vaultSave(req, res) {
  const s    = needAal2(req);
  const body = await readBody(req);

  const ALLOWED = ['encrypted_data', 'wrapped_dek', 'master_verifier', 'passkey_slots'];
  const fields  = {};
  for (const k of ALLOWED) {
    if (k in body) {
      // passkey_slots debe ser JSONB; los demás campos son TEXT
      fields[k] = k === 'passkey_slots' ? JSON.stringify(body[k] ?? []) : (body[k] ?? null);
    }
  }

  if (Object.keys(fields).length === 0) return send(res, 200, {});

  const keys      = Object.keys(fields);
  const vals      = Object.values(fields);
  const colList   = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 2}`).join(', ');
  const setClause = keys.map(k => `${k} = EXCLUDED.${k}`).join(', ');

  await pool.query(`
    INSERT INTO vaults (user_id, ${colList}, updated_at)
    VALUES ($1, ${placeholders}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      ${setClause},
      updated_at = now()
  `, [s.sub, ...vals]);

  send(res, 200, {});
}

// ── Admin: listar usuarios ────────────────────────────────────
// Devuelve id, email, fecha de registro, estado bloqueado/admin.
// Nunca devuelve pass_hash ni datos de la bóveda.

async function adminListUsers(req, res) {
  needAdmin(req);
  const { rows } = await pool.query(
    'SELECT id, email, created_at, is_blocked, is_admin FROM users ORDER BY created_at DESC'
  );
  send(res, 200, { users: rows });
}

// ── Admin: bloquear / desbloquear usuario ─────────────────────

async function adminPatchUser(req, res, userId) {
  const s = needAdmin(req);
  if (!UUID_RE.test(userId)) return fail(res, 400, 'ID de usuario inválido');
  if (userId === s.sub)      return fail(res, 400, 'No puedes modificar tu propia cuenta desde el panel');

  const body = await readBody(req);
  if (typeof body.is_blocked !== 'boolean') return fail(res, 400, 'Campo is_blocked requerido (boolean)');

  // No se puede bloquear a otro admin
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return fail(res, 404, 'Usuario no encontrado');
  if (rows[0].is_admin) return fail(res, 403, 'No se puede bloquear a otro administrador');

  await pool.query('UPDATE users SET is_blocked = $1 WHERE id = $2', [body.is_blocked, userId]);
  console.log(`[admin] ${new Date().toISOString()} | ${body.is_blocked ? 'BLOCK' : 'UNBLOCK'} | admin=${s.sub} target=${userId}`);
  send(res, 200, {});
}

// ── Admin: eliminar usuario y su bóveda ───────────────────────

async function adminDeleteUser(req, res, userId) {
  const s = needAdmin(req);
  if (!UUID_RE.test(userId)) return fail(res, 400, 'ID de usuario inválido');
  if (userId === s.sub)      return fail(res, 400, 'No puedes eliminar tu propia cuenta desde el panel');

  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return fail(res, 404, 'Usuario no encontrado');
  if (rows[0].is_admin) return fail(res, 403, 'No se puede eliminar a otro administrador');

  // ON DELETE CASCADE en vaults y totp_factors — borra todo con el usuario
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  console.log(`[admin] ${new Date().toISOString()} | DELETE | admin=${s.sub} target=${userId}`);
  send(res, 200, {});
}

module.exports = { handleApi };
