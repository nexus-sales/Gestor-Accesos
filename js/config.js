// Las credenciales vienen de env.js (cargado antes en index.html)
// env.js está en .gitignore — nunca se sube a GitHub

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});
