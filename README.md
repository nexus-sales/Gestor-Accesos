# Gestor de Accesos

Gestor de Accesos es una bóveda web para centralizar credenciales de servicios y portales, dominios, cuentas privadas, procedimientos y contactos. Se creó para sustituir documentos dispersos, mensajes y hojas de cálculo por un espacio único, ordenado y protegido.

La aplicación combina una interfaz sencilla con cifrado en el navegador, autenticación mediante Supabase y verificación obligatoria en dos pasos.

## ¿Para qué se ha creado?

En el trabajo diario es frecuente acumular accesos, proveedores, instrucciones y contactos en lugares diferentes. Esto dificulta encontrarlos, mantenerlos actualizados y controlar quién puede consultarlos.

Gestor de Accesos permite:

- Encontrar rápidamente la información de cada servicio.
- Mantener separadas las credenciales profesionales y privadas.
- Conservar procedimientos y contactos junto al resto de la operativa.
- Sincronizar una única bóveda cifrada entre dispositivos.
- Reducir la exposición de contraseñas y datos sensibles.

## Funciones principales

### Servicios

- Organización por sectores y servicios.
- Compatible con CRMs, portales de formación, extranets y otras herramientas web.
- URL de acceso, usuario, contraseña y observaciones.
- Búsqueda, filtros y copia rápida de credenciales.
- Normalización y validación de enlaces antes de abrirlos.

### Dominios y correo

- Registro de dominios por proveedor o registrador.
- Acceso directo al panel del proveedor.
- Almacenamiento de email, contraseña y notas asociadas.

### Contraseñas privadas

- Espacio separado para cuentas personales o especialmente sensibles.
- Cifrado individual del nombre, usuario, contraseña y observaciones de cada ficha.
- Reautenticación con la contraseña maestra para revelar o editar cada ficha.
- Clasificación visual por banca, correo, redes sociales, trabajo, APIs, inteligencia artificial, compras u otros.
- Campos adaptados para guardar API keys y tokens de programas o proveedores de IA.
- Ocultado automático después de 60 segundos.

### Notas

- Procedimientos, contactos y notas generales.
- Etiquetas, búsqueda, filtros y notas fijadas.
- Contactos con empresa, teléfono y correo electrónico.
- Copia rápida del contenido.
- Notas privadas con una segunda capa de cifrado.
- Reautenticación con la contraseña maestra para revelar, copiar o editar una nota privada.
- Ocultado automático del contenido privado después de 60 segundos.

### Otras funciones

- Generador de contraseñas seguras.
- Bloqueo automático por inactividad.
- Navegación adaptada a escritorio y móvil.
- Exportación de la bóveda a un PDF protegido por contraseña.
- Indicador del estado de sincronización.
- Iconos propios para pestañas del navegador, accesos directos y pantalla de inicio móvil.

## Seguridad

Los datos se cifran en el navegador mediante **AES-GCM de 256 bits**. La clave se deriva de la contraseña maestra con **PBKDF2-SHA-256 y 200.000 iteraciones**.

- Supabase almacena el contenido cifrado, no la bóveda en texto legible.
- La contraseña maestra solo se conserva temporalmente en memoria mientras la bóveda está abierta.
- El acceso requiere autenticación y un segundo factor TOTP.
- Las políticas RLS restringen la tabla de la bóveda al propietario con una sesión `aal2`.
- Las fichas privadas y las notas privadas vuelven a cifrar su contenido dentro de la propia bóveda.

> [!IMPORTANT]
> La contraseña maestra es también la clave de cifrado. Si se olvida, Supabase puede recuperar el acceso a la cuenta, pero no puede descifrar la bóveda anterior. Esta limitación evita que el servidor o un tercero puedan recuperar los datos sin autorización.

## Tecnología

- HTML, CSS y JavaScript sin framework.
- [Supabase](https://supabase.com/) para autenticación, 2FA y almacenamiento.
- Web Crypto API para el cifrado local.
- jsPDF y AutoTable para la exportación protegida.
- Web App Manifest para definir la identidad visual al instalar o añadir la aplicación a la pantalla de inicio.
- Vercel como opción de despliegue.

## Puesta en marcha

### Requisitos

- Node.js 18 o posterior.
- Un proyecto de Supabase.
- Una tabla `public.vaults_ga` configurada para la bóveda.

### Configuración local

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea un archivo `.env` en la raíz:

   ```env
   SUPABASE_URL=https://tu-proyecto.supabase.co
   SUPABASE_ANON_KEY=tu_clave_anonima
   ```

3. Genera la configuración del navegador:

   ```bash
   npm run build
   ```

4. Sirve la carpeta con un servidor web local y abre `index.html`.

El archivo generado `js/env.js` contiene configuración pública del cliente y está excluido del repositorio. No utilices en el navegador la clave `service_role` de Supabase.

## Configuración de Supabase

Los usuarios se gestionan desde `auth.users`. La información cifrada de la aplicación se guarda en `public.vaults_ga`, relacionada mediante el identificador del usuario:

```text
public.vaults_ga.user_id = auth.users.id
```

Después de crear la tabla, ejecuta [`supabase-rls-mfa.sql`](supabase-rls-mfa.sql) en el SQL Editor de Supabase. Este script activa RLS y exige una sesión con 2FA real para leer o modificar la bóveda.

## Estructura del proyecto

```text
css/styles.css          Interfaz y diseño responsive
assets/icons/           Favicons, iconos móviles y Web App Manifest
js/app.js               Navegación, formularios y CRUD
js/auth.js              Autenticación, 2FA y bloqueo
js/crypto.js            Cifrado y derivación de clave
js/vault.js             Carga, guardado y migración de la bóveda
js/pdf.js               Exportación a PDF protegido
index.html              Estructura principal de la aplicación
supabase-rls-mfa.sql    Políticas de seguridad de Supabase
```

## Iconos de la aplicación

Los recursos visuales se encuentran en `assets/icons/`. `index.html` enlaza los favicons en formatos ICO, SVG y PNG, el icono de Apple y el archivo `manifest.json`.

El manifiesto identifica la aplicación como **Gestor de Accesos** e incluye imágenes de 192, 512 y 1024 píxeles para accesos directos y dispositivos compatibles. Si se sustituyen los diseños, deben conservarse los nombres y dimensiones actuales o actualizar también sus rutas en `index.html` y `assets/icons/manifest.json`.

## Privacidad

Este repositorio no debe contener contraseñas, bóvedas exportadas, archivos `.env` ni claves privadas. Antes de compartir una exportación PDF, recuerda que contiene información sensible aunque esté protegida por contraseña.
