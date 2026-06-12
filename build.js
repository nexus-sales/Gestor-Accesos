// Script de build para Vercel
// Lee las variables de entorno y genera js/env.js en tiempo de despliegue
const fs = require('fs');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('ERROR: Faltan las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY');
  console.error('Añádelas en Vercel > Settings > Environment Variables');
  process.exit(1);
}

const content = `// Generado automáticamente en el build — no editar
const SUPABASE_URL      = '${url}';
const SUPABASE_ANON_KEY = '${key}';
`;

fs.writeFileSync('js/env.js', content, 'utf8');
console.log('✓ js/env.js generado correctamente');
