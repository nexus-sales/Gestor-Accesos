// Exportación a PDF cifrado con la contraseña maestra del usuario

async function exportToPDF() {
  if (!vaultKey) { showToast('Desbloquea la bóveda antes de exportar.'); return; }
  if (!crms.length && !domains.length && !privateItems.length && !notes.length) {
    showToast('No hay datos para exportar.'); return;
  }
  pendingPrivateAccess = { kind: 'pdf' };
  openPrivateAccessDialog('Exportar PDF cifrado');
}

async function generatePDF(dek, pdfPassword) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'p', unit: 'mm', format: 'a4',
    encryption: {
      userPassword: pdfPassword,
      ownerPassword: pdfPassword,
      userPermissions: ['print', 'copy']
    }
  });

  // Cabecera
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(28, 28, 26);
  doc.text('Gestor de Accesos', 15, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(136, 135, 128);
  doc.text(`Exportado el ${new Date().toLocaleString('es-ES')} · Protegido con contraseña`, 15, 26);
  doc.setDrawColor(218, 218, 215);
  doc.setLineWidth(0.3);
  doc.line(15, 30, 195, 30);

  let y = 37;

  // Servicios (clave interna: crms)
  if (crms.length > 0) {
    y = addSection(doc, y, '1. Accesos a servicios', [28, 28, 26],
      ['Sector', 'Servicio / Portal', 'URL', 'Usuario', 'Contacto', 'Contraseña', 'Observaciones'],
      crms.map(c => [
        c.sector||'—',
        c.marca||'—',
        c.url||'—',
        c.user||'—',
        [c.contactPerson, c.contactPhone, c.contactEmail].filter(Boolean).join(' · ') || '—',
        c.pass||'—',
        c.obs||'—'
      ])
    );
  }

  // Dominios
  if (domains.length > 0) {
    if (y > 255) { doc.addPage(); y = 20; }
    y = addSection(doc, y, '2. Dominios y Emails', [80, 80, 78],
      ['Proveedor', 'Dominio', 'URL', 'Email/Usuario', 'Contacto', 'Contraseña', 'Observaciones'],
      domains.map(d => [
        d.sector||'—',
        d.marca||'—',
        d.url||'—',
        d.user||'—',
        [d.contactPerson, d.contactPhone, d.contactEmail].filter(Boolean).join(' · ') || '—',
        d.pass||'—',
        d.obs||'—'
      ])
    );
  }

  // Contraseñas privadas
  if (privateItems.length > 0) {
    if (y > 255) { doc.addPage(); y = 20; }
    const privateRows = await Promise.all(privateItems.map(async item => {
      const data = item.secretData
        ? JSON.parse(await decryptWithKey(item.secretData, dek))
        : item;
      const category = ({ banking: 'Banca', email: 'Correo', social: 'Redes', work: 'Trabajo', api: 'API', ai: 'IA', shopping: 'Compras', other: 'Otros' })[item.category] || 'Otros';
      return [category, data.marca || '—', data.user || '—', data.pass || '—', data.obs || '—'];
    }));
    y = addSection(doc, y, '3. Contraseñas Privadas', [163, 45, 45],
      ['Categoría', 'Servicio/Título', 'Usuario/ID', 'Contraseña / API key', 'Observaciones'],
      privateRows,
      [252, 235, 235]
    );
  }

  // Notas
  if (notes.length > 0) {
    if (y > 245) { doc.addPage(); y = 20; }
    const noteRows = await Promise.all(notes.map(async n => {
      let data = n;
      if (n.private && n.secretData) {
        data = JSON.parse(await decryptWithKey(n.secretData, dek));
      }
      return [
        ({ procedure: 'Procedimiento', contact: 'Contacto', general: 'General' })[n.type] || 'General',
        data.title || '—',
        [data.company, data.phone, data.email].filter(Boolean).join(' · ') || '—',
        (data.tags || []).join(', ') || '—',
        data.content || '—'
      ];
    }));
    y = addSection(doc, y, '4. Notas', [36, 107, 253],
      ['Tipo', 'Título', 'Contacto', 'Etiquetas', 'Contenido'],
      noteRows,
      [239, 244, 255]
    );
  }

  // Paginación
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(136, 135, 128);
    doc.text(`Página ${i} de ${total}`, 105, 287, { align: 'center' });
  }

  doc.save('gestor_accesos_protegido.pdf');
}

function addSection(doc, y, title, color, head, body, altFill) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...color);
  doc.text(title, 15, y);

  const opts = {
    startY: y + 4,
    head: [head],
    body,
    theme: 'striped',
    headStyles: { fillColor: color, textColor: [255,255,255], fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    columnStyles: { [head.length - 1]: { cellWidth: 40 } },
    margin: { left: 15, right: 15 }
  };
  if (altFill) opts.alternateRowStyles = { fillColor: altFill };

  doc.autoTable(opts);
  return doc.lastAutoTable.finalY + 10;
}
