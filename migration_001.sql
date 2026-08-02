-- Migración 001 — Panel de administración
-- Ejecutar UNA VEZ sobre la base de datos existente (no recrea las tablas).
-- Requiere PostgreSQL 13+.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin   BOOLEAN NOT NULL DEFAULT false;

-- Para marcar tu cuenta como admin, ejecuta este comando UNA VEZ
-- sustituyendo 'tu@email.com' por el email con el que te registraste:
--
--   UPDATE users SET is_admin = true WHERE email = 'tu@email.com';
--
-- Verifica el resultado con:
--   SELECT id, email, is_admin FROM users WHERE email = 'tu@email.com';
