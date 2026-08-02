'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 es obligatorio en Docker: Traefik (u otro proxy) corre en una red
// separada y no puede alcanzar 127.0.0.1 del contenedor de la app.
const HOST = '0.0.0.0';
const ROOT = __dirname;

const MIME = {
  '.css':  'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico':  'image/x-icon',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
};

// env.js contiene las claves de Supabase bakeadas en build; index.html es el
// punto de entrada — ambos deben llegar siempre frescos al cliente.
const NO_STORE = new Set(['/index.html', '/js/env.js']);

function cacheControl(urlPath) {
  if (NO_STORE.has(urlPath))            return 'no-store';
  if (urlPath.startsWith('/assets/'))   return 'public, max-age=604800, immutable';
  return 'public, max-age=3600';
}

// Estos headers se añaden a todas las respuestas.
// CSP sigue en el <meta> de index.html; el resto aquí cubre lo que el meta no puede.
const SECURITY_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':          'DENY',
  'Referrer-Policy':          'strict-origin-when-cross-origin',
  'Permissions-Policy':       'publickey-credentials-create=(self), publickey-credentials-get=(self)',
  // HSTS: Traefik termina TLS y pasa este header al cliente (que sí está en HTTPS).
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS).end('Bad request');
    return;
  }

  const urlPath  = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, '.' + urlPath);

  // Protección path traversal: el archivo resuelto debe estar dentro de ROOT.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, SECURITY_HEADERS).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, SECURITY_HEADERS).end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type':  MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl(urlPath),
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Gestor de Accesos escuchando en ${HOST}:${PORT}`);
});

// Cierre limpio en Docker: SIGTERM lo envía el runtime al parar el contenedor.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
