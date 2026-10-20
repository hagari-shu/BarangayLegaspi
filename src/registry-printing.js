const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const formatDate = (value, language) => {
  if (!value) return '—'
  const parsed = new Date(`${value}T12:00:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  }).format(parsed)
}

const printStyles = `
  @page { size: A4 portrait; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172923; font: 12pt/1.5 Arial, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 20pt; }
  h2 { margin: 0 0 8px; font-size: 16pt; }
  p { margin: 5px 0; }
  .heading { margin-bottom: 18px; padding-bottom: 12px; border-bottom: 2px solid #245b47; }
  .meta { color: #40534a; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { border: 1px solid #829187; padding: 6px; text-align: left; vertical-align: top; }
  th { background: #edf3ef; }
  .person { break-inside: avoid; padding: 12px 0; border-bottom: 1px solid #cbd5cf; }
  .person dl { display: grid; grid-template-columns: 1fr 2fr; gap: 4px 12px; margin: 10px 0; }
  dt { color: #40534a; font-weight: 700; }
  dd { margin: 0; }
  .individual { min-height: 250mm; break-after: page; padding: 14mm 8mm; border: 1px solid #cbd5cf; }
  .individual:last-child { break-after: auto; }
  .certificate { min-height: 245mm; break-after: page; padding: 20mm 16mm; border: 1px solid #cbd5cf; }
  .certificate:last-child { break-after: auto; }
  .certificate-title { margin: 28mm 0 16mm; text-align: center; font-size: 24pt; text-transform: uppercase; }
  .certificate-body { white-space: pre-wrap; font-size: 14pt; line-height: 1.9; }
  .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 26mm; }
  .signature span { display: block; margin-top: 18mm; padding-top: 5px; border-top: 1px solid #172923; text-align: center; }
  .footnote { margin-top: 18px; color: #40534a; font-size: 9pt; }
  @media screen { body { max-width: 210mm; margin: 16px auto; padding: 12mm; box-shadow: 0 2px 18px #0002; } }
`

const documentShell = (title, body, language, autoPrint = true) => `<!doctype html>
<html lang="${language === 'fil' ? 'fil' : 'en'}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${printStyles}</style></head>
  <body>${body}${autoPrint ? '<script>window.addEventListener("load", () => window.print())</script>' : ''}</body>
</html>`

export function createRegistryPrintHtml({ title, subtitle, records, mode = 'roster', language = 'en', labels }) {
  const heading = `<header class="heading"><h1>${escapeHtml(labels.barangayName)}</h1><p>${escapeHtml(title)}</p><p class="meta">${escapeHtml(subtitle)} · ${escapeHtml(labels.generated)}: ${escapeHtml(formatDate(new Date().toISOString().slice(0, 10), language))} · ${records.length} ${escapeHtml(labels.residents)}</p></header>`
  const content = mode === 'individuals'
    ? records.map((resident) => `<article class="individual"><h2>${escapeHtml(resident.firstName)} ${escapeHtml(resident.lastName)}</h2><dl>
        <dt>${escapeHtml(labels.birthDate)}</dt><dd>${escapeHtml(formatDate(resident.birthDate, language))}</dd>
        <dt>${escapeHtml(labels.zone)}</dt><dd>${escapeHtml(resident.zone ? `Zone ${resident.zone}` : labels.unassigned)}</dd>
        <dt>${escapeHtml(labels.household)}</dt><dd>${escapeHtml(resident.householdId || '—')}</dd>
        <dt>${escapeHtml(labels.sex)}</dt><dd>${escapeHtml(resident.sex || '—')}</dd>
        <dt>${escapeHtml(labels.maritalStatus)}</dt><dd>${escapeHtml(resident.maritalStatus || '—')}</dd>
        <dt>${escapeHtml(labels.occupation)}</dt><dd>${escapeHtml(resident.occupation || '—')}</dd>
        <dt>${escapeHtml(labels.address)}</dt><dd>${escapeHtml(resident.address || '—')}</dd>
        <dt>${escapeHtml(labels.verification)}</dt><dd>${escapeHtml(resident.verificationStatus || '—')}</dd>
        <dt>${escapeHtml(labels.recordStatus)}</dt><dd>${escapeHtml(resident.status || '—')}</dd>
      </dl></article>`).join('')
    : `<table><thead><tr>
        <th>${escapeHtml(labels.name)}</th><th>${escapeHtml(labels.birthDate)}</th><th>${escapeHtml(labels.zone)}</th>
        <th>${escapeHtml(labels.household)}</th><th>${escapeHtml(labels.maritalStatus)}</th><th>${escapeHtml(labels.occupation)}</th>
        <th>${escapeHtml(labels.verification)}</th><th>${escapeHtml(labels.recordStatus)}</th>
      </tr></thead><tbody>${records.map((resident) => `<tr>
        <td>${escapeHtml(resident.firstName)} ${escapeHtml(resident.lastName)}</td><td>${escapeHtml(formatDate(resident.birthDate, language))}</td>
        <td>${escapeHtml(resident.zone ? `Zone ${resident.zone}` : labels.unassigned)}</td><td>${escapeHtml(resident.householdId || '—')}</td>
        <td>${escapeHtml(resident.maritalStatus || '—')}</td><td>${escapeHtml(resident.occupation || '—')}</td>
        <td>${escapeHtml(resident.verificationStatus || '—')}</td><td>${escapeHtml(resident.status || '—')}</td>
      </tr>`).join('')}</tbody></table>`
  return documentShell(title, `${heading}${content}<p class="footnote">${escapeHtml(labels.confidentialNotice)}</p>`, language)
}

const templateValues = (resident, values) => ({
  full_name: `${resident.firstName || ''} ${resident.lastName || ''}`.trim(),
  first_name: resident.firstName || '',
  last_name: resident.lastName || '',
  birth_date: formatDate(resident.birthDate, values.language),
  zone: resident.zone ? `Zone ${resident.zone}` : '',
  household_id: resident.householdId || '',
  address: resident.address || '',
  purpose: values.purpose || '',
  issue_date: formatDate(values.issueDate, values.language),
  signatory: values.signatory || '',
  position: values.position || '',
})

export function renderCertificateTemplate(template, resident, values = {}) {
  const replacements = templateValues(resident, values)
  return String(template || '').replace(/\{([a-z_]+)\}/gi, (token, key) => (
    Object.hasOwn(replacements, key.toLowerCase()) ? replacements[key.toLowerCase()] : token
  ))
}

export function createCertificatePrintHtml({ title, body, residents, values, labels, language = 'en', autoPrint = true }) {
  const pages = residents.map((resident) => {
    const renderedBody = renderCertificateTemplate(body, resident, { ...values, language })
    const paragraphs = escapeHtml(renderedBody).split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replaceAll('\n', '<br>')}</p>`).join('')
    const signatory = values.signatory ? `${escapeHtml(values.signatory)}<br>` : ''
    const signatoryRole = values.position || labels.authorizedOfficial
    return `<article class="certificate">
      <header class="heading"><h1>${escapeHtml(labels.barangayName)}</h1><p>${escapeHtml(labels.location)}</p></header>
      <h2 class="certificate-title">${escapeHtml(title)}</h2>
      <div class="certificate-body">${paragraphs}</div>
      <div class="signature"><span>${signatory}${escapeHtml(signatoryRole)}</span><span>${escapeHtml(labels.dateIssued)}: ${escapeHtml(formatDate(values.issueDate, language))}</span></div>
      <p class="footnote">${escapeHtml(labels.reviewBeforeSigning)}</p>
    </article>`
  }).join('')
  return documentShell(title, pages, language, autoPrint)
}

export function writePrintWindow(printWindow, html) {
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}
