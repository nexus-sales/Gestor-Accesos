// Cifrado AES-GCM + derivación de clave
// Los datos NUNCA se envían sin cifrar a Supabase (zero-knowledge)
//
// Formato de envelope:
//   v1 (legacy, solo lectura): base64(salt[16] | iv[12] | ciphertext[n])
//   v2 (Argon2id):             "v2:" + base64(header[20] | salt[32] | iv[12] | ciphertext[n])
//
// header v2 (20 bytes, big-endian uint32):
//   [0-3]  memorySize  KiB        (e.g. 65536 = 64 MiB)
//   [4-7]  iterations  time cost  (e.g. 3)
//   [8-11] parallelism            (e.g. 1)
//   [12-15] hashLength bytes      (e.g. 32)
//   [16-19] saltLength  bytes     (e.g. 32)

const ARGON2_DEFAULTS = {
  memorySize: 65536,  // 64 MiB
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};

function bufToB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ── Derivación de clave ───────────────────────────────────────

async function deriveKey(password, salt, iterations = 200000) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function deriveKeyArgon2(password, salt, params = ARGON2_DEFAULTS) {
  // hashwasm.argon2id acepta string|Uint8Array para password y salt.
  // Con outputType:'binary' devuelve Uint8Array directamente.
  // La inicialización WASM es lazy y mutex-protegida internamente;
  // no requiere un init() separado.
  const keyBytes = await hashwasm.argon2id({
    password,
    salt,
    memorySize:  params.memorySize,
    iterations:  params.iterations,
    parallelism: params.parallelism,
    hashLength:  params.hashLength,
    outputType:  'binary',
  });
  return crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );
}

// ── Cifrado (siempre escribe v2) ──────────────────────────────

async function encryptData(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKeyArgon2(password, salt);
  const enc  = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));

  // Serializar parámetros en cabecera de 20 bytes (big-endian)
  const header = new DataView(new ArrayBuffer(20));
  header.setUint32(0,  ARGON2_DEFAULTS.memorySize,  false);
  header.setUint32(4,  ARGON2_DEFAULTS.iterations,  false);
  header.setUint32(8,  ARGON2_DEFAULTS.parallelism,  false);
  header.setUint32(12, ARGON2_DEFAULTS.hashLength,   false);
  header.setUint32(16, salt.byteLength,               false);

  const headerBytes = new Uint8Array(header.buffer);
  const combined = new Uint8Array(20 + salt.byteLength + iv.byteLength + ciphertext.byteLength);
  let off = 0;
  combined.set(headerBytes,               off); off += 20;
  combined.set(salt,                      off); off += salt.byteLength;
  combined.set(iv,                        off); off += iv.byteLength;
  combined.set(new Uint8Array(ciphertext), off);

  return 'v2:' + bufToB64(combined.buffer);
}

// ── Descifrado v2 (Argon2id) ──────────────────────────────────

async function decryptV2(b64, password) {
  const combined = new Uint8Array(b64ToBuf(b64));
  const view = new DataView(combined.buffer);

  let off = 0;
  const memorySize  = view.getUint32(off, false); off += 4;
  const iterations  = view.getUint32(off, false); off += 4;
  const parallelism = view.getUint32(off, false); off += 4;
  const hashLength  = view.getUint32(off, false); off += 4;
  const saltLength  = view.getUint32(off, false); off += 4;

  const salt      = combined.slice(off, off + saltLength); off += saltLength;
  const iv        = combined.slice(off, off + 12);         off += 12;
  const encrypted = combined.slice(off);

  const key   = await deriveKeyArgon2(password, salt, { memorySize, iterations, parallelism, hashLength });
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(plain);
}

// ── Descifrado v1 (PBKDF2 legacy) ────────────────────────────

async function decryptDataWithIterations(ciphertextB64, password, iterations) {
  const combined  = new Uint8Array(b64ToBuf(ciphertextB64));
  const salt      = combined.slice(0, 16);
  const iv        = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key       = await deriveKey(password, salt, iterations);
  const plain     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(plain);
}

// ── Punto de entrada principal ────────────────────────────────

async function decryptData(ciphertextB64, password) {
  try {
    if (ciphertextB64.startsWith('v2:')) {
      return await decryptV2(ciphertextB64.slice(3), password);
    }
    return await decryptDataWithIterations(ciphertextB64, password, 200000);
  } catch {
    throw new Error('Contraseña incorrecta o datos corruptos');
  }
}

// Compatibilidad de lectura con la bóveda local anterior a la migración a Supabase.
// Solo se usa para importar; todos los datos nuevos siguen cifrándose con encryptData (v2).
async function decryptLegacyLocalData(ciphertextB64, password) {
  try {
    return await decryptDataWithIterations(ciphertextB64, password, 100000);
  } catch {
    throw new Error('Contraseña incorrecta o datos corruptos');
  }
}

// ── Argon2id crudo (bytes, sin importar a CryptoKey) ─────────
// Igual que deriveKeyArgon2 pero devuelve Uint8Array para concatenar con el
// secreto PRF antes del HKDF (slot de passkey).

async function deriveArgon2Raw(password, salt, params = ARGON2_DEFAULTS) {
  return hashwasm.argon2id({
    password,
    salt,
    memorySize:  params.memorySize,
    iterations:  params.iterations,
    parallelism: params.parallelism,
    hashLength:  params.hashLength,
    outputType:  'binary',
  });
}

// ── HKDF-SHA256 ───────────────────────────────────────────────
// Mezcla ikmBytes (Argon2Raw ‖ prfSecret) con un salt y un string de info.
// Devuelve Uint8Array de len bytes, listo para usar como dekBytes.

async function hkdfKey(ikmBytes, saltBytes, infoStr, len = 32) {
  const base = await crypto.subtle.importKey(
    'raw', ikmBytes, { name: 'HKDF' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: new TextEncoder().encode(infoStr),
    },
    base,
    len * 8
  );
  return new Uint8Array(bits);
}

// ── Cifrado/descifrado con DEK — formato k1 (sin KDF) ────────
// La DEK (32 bytes aleatorios) ya es material de clave; no se deriva con Argon2.
// Formato: "k1:" + base64(iv[12] | ciphertext)

async function encryptWithKey(plaintext, dekBytes) {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', dekBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return 'k1:' + bufToB64(combined.buffer);
}

async function decryptWithKey(blob, dekBytes) {
  if (!blob.startsWith('k1:')) throw new Error('Formato de envelope no reconocido');
  const combined = new Uint8Array(b64ToBuf(blob.slice(3)));
  const iv        = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  const key = await crypto.subtle.importKey('raw', dekBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Descifrado fallido: clave incorrecta o datos corruptos');
  }
}
