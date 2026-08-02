# Gestor de Accesos

Bóveda web para centralizar credenciales de servicios y portales, dominios, cuentas privadas, notas y aprendizaje. Sustituye documentos dispersos, mensajes y hojas de cálculo por un espacio único, ordenado y protegido con cifrado de extremo a extremo.

## Funciones principales

### Servicios
- Organización por sectores, búsqueda y filtros.
- URL de acceso, usuario, contraseña, persona de contacto, teléfono, email y observaciones.
- Copia rápida de credenciales.

### Dominios y correo
- Registro de dominios por proveedor o registrador.
- Acceso directo al panel del proveedor, email y contraseña asociados.

### Contraseñas privadas
- Fichas individuales cifradas: nombre, usuario, contraseña y observaciones.
- Reautenticación con la contraseña maestra para revelar o editar cada ficha.
- Categorías: banca, correo, redes sociales, trabajo, APIs, IA, compras u otros.
- Ocultado automático después de 60 segundos.

### Notas
- Tipos: **Procedimiento**, **Contacto**, **Nota general**, **Aprendizaje**.
- Contenido en **Markdown** (encabezados, negrita, cursiva, código, listas).
- Etiquetas, búsqueda por título y contenido, notas fijadas.
- Notas privadas con segunda capa de cifrado independiente.
- Reautenticación con la contraseña maestra para revelar, copiar o editar.
- Ocultado automático después de 60 segundos.

### Otras funciones
- Generador de contraseñas seguras.
- Exportación a PDF protegido por contraseña.
- Bloqueo automático por inactividad (10 minutos).
- Navegación adaptada a escritorio y móvil.
- Passkeys (WebAuthn) como segundo factor de desbloqueo.
- Panel de administración para gestionar usuarios (bloquear, desbloquear, eliminar).

---

## Seguridad y arquitectura

### Zero-knowledge
El servidor nunca recibe datos legibles. Todo el cifrado y descifrado ocurre en el navegador.

### Clave de datos (DEK)
- Al crear la bóveda se generan 32 bytes aleatorios — la **DEK** (Data Encryption Key).
- La DEK se cifra con la contraseña maestra usando **Argon2id** y se guarda en el servidor como `wrapped_dek` (opaca sin la maestra).
- La bóveda se cifra con **AES-GCM 256 bits** usando la DEK.
- La DEK solo existe en memoria mientras la bóveda está abierta.

### Autenticación
- Registro e inicio de sesión con email y contraseña (hash **bcrypt**, 12 rondas).
- **2FA TOTP obligatorio** (TOTP RFC 6238 vía otplib) para obtener sesión `aal2`.
- Sesión mediante cookie **httpOnly** (`ga_session`, JWT HS256, 8 h).
- **Passkeys WebAuthn** con extensión PRF: la clave derivada del autenticador se combina con la maestra para abrir la bóveda sin escribirla cada vez.

### Servidor
- API propia en Node.js (`api/index.js`) sobre **PostgreSQL**.
- Sin dependencias de terceros para autenticación o almacenamiento.
- Rate limiting en memoria, queries parametrizadas (sin SQL injection).
- Cabeceras de seguridad: CSP, X-Content-Type-Options, X-Frame-Options, HSTS.

> [!IMPORTANT]
> La contraseña maestra es la clave de cifrado. Si se pierde, la bóveda no puede descifrarse desde el servidor. Esta limitación es intencional: impide que el servidor o cualquier tercero acceda a los datos.

---

## Tecnología

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript sin framework |
| Cifrado | Web Crypto API — AES-GCM 256 bit |
| Derivación de clave | Argon2id (WebAssembly) |
| Autenticación | Node.js + bcryptjs + jsonwebtoken |
| 2FA | otplib (TOTP RFC 6238) |
| Passkeys | WebAuthn API + extensión PRF |
| Base de datos | PostgreSQL (node-postgres) |
| PDF | jsPDF + AutoTable |
| Despliegue | Dokploy + Nixpacks |

---

## Puesta en marcha

### Requisitos

- Node.js 18 o posterior.
- PostgreSQL 13 o posterior.

### Configuración local

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea un archivo `.env` en la raíz:

   ```env
   DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/gestor_accesos
   JWT_SECRET=cadena-aleatoria-larga-y-segura
   NODE_ENV=development
   ```

3. Crea las tablas en PostgreSQL ejecutando `init.sql`:

   ```bash
   psql $DATABASE_URL < init.sql
   ```

4. (Opcional) Si ya tienes la base de datos de una versión anterior, añade las columnas de administración:

   ```bash
   psql $DATABASE_URL < migration_001.sql
   ```

5. Marca tu cuenta como administrador:

   ```sql
   UPDATE users SET is_admin = true WHERE email = 'tu@email.com';
   ```

6. Inicia el servidor de desarrollo:

   ```bash
   npm run dev
   ```

   La aplicación queda disponible en `http://localhost:3000`.

### Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL |
| `JWT_SECRET` | Secreto para firmar tokens JWT (mín. 32 caracteres aleatorios) |
| `NODE_ENV` | `production` activa HTTPS-only para la cookie de sesión |
| `PORT` | Puerto del servidor (por defecto 3000) |
| `HOST` | Interfaz de red (usar `0.0.0.0` en producción con Dokploy) |

---

## Despliegue en producción (Dokploy)

1. Conecta el repositorio en Dokploy como aplicación **Nixpacks**.
2. Configura las variables de entorno `DATABASE_URL`, `JWT_SECRET` y `NODE_ENV=production` como **Runtime Environment Variables** (no como build args).
3. Asegúrate de que `HOST=0.0.0.0` está configurado.
4. El script de inicio es `npm start` → `node server.js`.

---

## Estructura del proyecto

```text
api/index.js            API REST: autenticación, bóveda y panel de admin
server.js               Servidor HTTP (enruta /api/* y sirve estáticos)
init.sql                DDL completo: tablas users, vaults, totp_factors
migration_001.sql       Añade columnas is_blocked e is_admin a users
css/styles.css          Interfaz y diseño responsive
assets/icons/           Favicons, iconos móviles y Web App Manifest
js/config.js            Cliente HTTP (apiFetch y funciones API)
js/app.js               Navegación, formularios y CRUD
js/auth.js              Autenticación, 2FA, desbloqueo y bloqueo
js/admin.js             Panel de administración de usuarios
js/crypto.js            Cifrado AES-GCM y derivación Argon2id
js/vault.js             Carga, guardado y migración de la bóveda
js/markdown.js          Renderizador Markdown ligero para notas
js/passkey.js           WebAuthn — registro y uso de passkeys
js/pdf.js               Exportación a PDF protegido
index.html              Estructura principal de la aplicación
```

---

## Privacidad

Este repositorio no debe contener contraseñas, bóvedas exportadas, archivos `.env` ni claves privadas. Antes de compartir una exportación PDF, recuerda que contiene información sensible aunque esté protegida por contraseña.
