-- Gestor de Accesos — esquema inicial PostgreSQL
-- Ejecuta este script UNA VEZ en tu base de datos antes del primer despliegue.
-- Requiere PostgreSQL 13+ (gen_random_uuid está en pgcrypto o en core desde PG13).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Usuarios (auth propio, sin Supabase)
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  pass_hash  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Factores TOTP para 2FA
-- Un usuario puede tener un factor 'unverified' (en matrícula) y uno 'verified'.
CREATE TABLE IF NOT EXISTS totp_factors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'unverified', -- 'unverified' | 'verified'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_totp_factors_user ON totp_factors(user_id);

-- Bóvedas cifradas (una por usuario)
-- El servidor nunca descifra estos campos; son blobs opacos del cliente.
CREATE TABLE IF NOT EXISTS vaults (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_data  TEXT,                          -- JSON cifrado con la DEK (formato k1:...)
  wrapped_dek     TEXT,                          -- DEK envuelta con la contraseña maestra
  master_verifier TEXT,                          -- legado — null en bóvedas v3+
  passkey_slots   JSONB NOT NULL DEFAULT '[]',   -- slots adicionales para passkeys WebAuthn
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
