// Cifrado AES-GCM + derivación de clave PBKDF2
// Los datos NUNCA se envían sin cifrar a Supabase (zero-knowledge)

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

async function encryptData(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(password, salt);
  const enc  = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));

  const combined = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.byteLength);
  combined.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);
  return bufToB64(combined.buffer);
}

async function decryptDataWithIterations(ciphertextB64, password, iterations) {
  const combined  = new Uint8Array(b64ToBuf(ciphertextB64));
  const salt      = combined.slice(0, 16);
  const iv        = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key       = await deriveKey(password, salt, iterations);
  const dec       = new TextDecoder();
  const plain     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return dec.decode(plain);
}

async function decryptData(ciphertextB64, password) {
  try {
    return await decryptDataWithIterations(ciphertextB64, password, 200000);
  } catch {
    throw new Error('Contraseña incorrecta o datos corruptos');
  }
}

// Compatibilidad de lectura con la bóveda local anterior a la migración a Supabase.
// Solo se usa para importar; todos los datos nuevos siguen cifrándose con 200.000 iteraciones.
async function decryptLegacyLocalData(ciphertextB64, password) {
  try {
    return await decryptDataWithIterations(ciphertextB64, password, 100000);
  } catch {
    throw new Error('Contraseña incorrecta o datos corruptos');
  }
}
