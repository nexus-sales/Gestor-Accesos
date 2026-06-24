// WebAuthn: registro y autenticación con passkeys (extensión PRF para DEK-wrapping)
//
// Los passkeys quedan atados a RP_ID. En cualquier otro host (*.vercel.app,
// localhost) isPasskeyUsableHere() devuelve false, la UI se oculta y el flujo
// de contraseña maestra sigue funcionando sin tocar nada de WebAuthn.
//
// NOTA: el passkey principal (Google Password Manager) está sincronizado E2E
// entre los dispositivos del usuario. Se recomienda un segundo passkey de
// respaldo (p.ej. YubiKey USB-C/NFC) para el caso de pérdida de acceso a GPM.
// Esto será crítico en modo búnker (3c); en 3b la contraseña es la red de seguridad.

const RP_ID   = 'nexus-sales.eu';
const RP_NAME = 'Gestor de Accesos';

// ── Feature detection ─────────────────────────────────────────

function isPasskeySupported() {
  return !!window.PublicKeyCredential;
}

function isPasskeyUsableHere() {
  const h = location.hostname;
  return h === RP_ID || h.endsWith('.' + RP_ID);
}

// ── Helpers base64url ─────────────────────────────────────────
// Los IDs de credencial se almacenan en base64url (estándar WebAuthn).
// b64ToBuf/bufToB64 vienen de crypto.js (cargado antes).

function bufToB64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlToBuf(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  return b64ToBuf(padded);
}

// ── Registro de passkey ───────────────────────────────────────
// existingSlots: cachedPasskeySlots — evita registrar el mismo autenticador dos veces.
// Devuelve { rawId: Uint8Array }.
// Lanza si el autenticador no soporta PRF o el usuario cancela.

async function registerPasskey(userId, userEmail, existingSlots = []) {
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp:   { id: RP_ID, name: RP_NAME },
        user: {
          id:          new TextEncoder().encode(userId),
          name:        userEmail,
          displayName: userEmail,
        },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7   },  // ES256
          { type: 'public-key', alg: -257 },  // RS256
        ],
        authenticatorSelection: {
          residentKey:      'preferred',
          userVerification: 'required',
        },
        excludeCredentials: existingSlots.map(s => ({
          type: 'public-key',
          id:   b64urlToBuf(s.credentialId),
        })),
        extensions: { prf: {} },
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') throw new Error('Registro de passkey cancelado.');
    throw err;
  }

  const prfEnabled = cred.getClientExtensionResults().prf?.enabled;
  if (!prfEnabled) {
    throw new Error(
      'Tu autenticador no soporta la extensión PRF requerida. ' +
      'Usa otro dispositivo o desbloquea con la contraseña maestra.'
    );
  }

  return { rawId: new Uint8Array(cred.rawId) };
}

// ── Obtener secreto PRF ───────────────────────────────────────
// slots: [{ credentialId (base64url), prfSalt (base64) }]
// Un único get() con evalByCredential; cada credencial usa su propio prfSalt.
// Devuelve { usedCredentialId (base64url), prfSecret (Uint8Array 32B) }.

async function getPasskeyPrf(slots) {
  const evalByCredential = {};
  for (const s of slots) {
    evalByCredential[s.credentialId] = {
      first: new Uint8Array(b64ToBuf(s.prfSalt)),
    };
  }

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        rpId:             RP_ID,
        allowCredentials: slots.map(s => ({
          type: 'public-key',
          id:   b64urlToBuf(s.credentialId),
        })),
        userVerification: 'required',
        extensions: { prf: { evalByCredential } },
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') throw new Error('Passkey cancelado.');
    throw err;
  }

  const usedCredentialId = bufToB64url(new Uint8Array(assertion.rawId));
  const prfResult = assertion.getClientExtensionResults().prf?.results?.first;
  if (!prfResult) {
    throw new Error('El autenticador no devolvió el resultado PRF. Inténtalo de nuevo.');
  }

  return { usedCredentialId, prfSecret: new Uint8Array(prfResult) };
}
