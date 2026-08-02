// Renderizador Markdown ligero — solo para preview de notas
// El contenido se escapa ANTES de cualquier transformación para prevenir XSS.
// Soporta: # encabezados, **negrita**, *cursiva*, `código`, bloques ```, listas, ---

function renderMarkdown(raw) {
  if (!raw) return '';

  // Escapa HTML primero; las transformaciones solo añaden etiquetas seguras
  const esc = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Transforma marcado inline dentro de texto ya escapado
  const inline = s => esc(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/`([^`\n]+)`/g,       '<code class="md-code">$1</code>');

  const lines  = raw.split('\n');
  const out    = [];
  let inCode   = false;
  let codeBuf  = [];
  let inUl     = false;
  let inOl     = false;

  const closeList = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  for (const line of lines) {
    // ── Bloques de código ─────────────────────────────────────
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        closeList();
        inCode = true; codeBuf = [];
      } else {
        inCode = false;
        out.push(`<pre class="md-pre"><code>${esc(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // ── Encabezados ───────────────────────────────────────────
    if (line.startsWith('### ')) {
      closeList();
      out.push(`<h3 class="md-h">${inline(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      closeList();
      out.push(`<h2 class="md-h">${inline(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      out.push(`<h1 class="md-h">${inline(line.slice(2))}</h1>`);

    // ── Línea horizontal ──────────────────────────────────────
    } else if (/^-{3,}$/.test(line.trim())) {
      closeList();
      out.push('<hr class="md-hr">');

    // ── Lista sin orden ───────────────────────────────────────
    } else if (/^[-*+] /.test(line)) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul class="md-ul">'); inUl = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);

    // ── Lista numerada ────────────────────────────────────────
    } else if (/^\d+\. /.test(line)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol class="md-ol">'); inOl = true; }
      out.push(`<li>${inline(line.replace(/^\d+\. /, ''))}</li>`);

    // ── Línea en blanco ───────────────────────────────────────
    } else if (line.trim() === '') {
      closeList();
      out.push('<div class="md-gap"></div>');

    // ── Párrafo normal ────────────────────────────────────────
    } else {
      closeList();
      out.push(`<p class="md-p">${inline(line)}</p>`);
    }
  }

  closeList();
  if (inCode) {
    out.push(`<pre class="md-pre"><code>${esc(codeBuf.join('\n'))}</code></pre>`);
  }

  return out.join('');
}
