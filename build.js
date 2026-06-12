// Lee .env en local; en Vercel usa las variables del dashboard
require('dotenv').config();
const fs = require('fs');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('ERROR: Faltan SUPABASE_URL y SUPABASE_ANON_KEY');
  console.error('Local: añádelas en .env  |  Vercel: Settings > Environment Variables');
  process.exit(1);
}

fs.writeFileSync('js/env.js',
  `const SUPABASE_URL      = '${url}';\nconst SUPABASE_ANON_KEY = '${key}';\n`,
  'utf8'
);
console.log('js/env.js generado correctamente');
