import { useEffect, useRef, useState } from 'react'
import { createCertificatePrintHtml, writePrintWindow } from './registry-printing'
import './StaffPrintCenter.css'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')
const dateToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const copy = {
  en: {
    title: 'Certificate printing',
    intro: 'Find an active, verified resident. An exact full-name match fills the certificate automatically; review every document before signing or release.',
    certificateType: 'Certificate type',
    clearance: 'Barangay clearance',
    residency: 'Certificate of residency',
    indigency: 'Certificate of indigency',
    custom: 'Custom certificate',
    searchResident: 'Resident full name',
    searchPlaceholder: 'Start typing the resident’s full name',
    searchSuggestions: 'Choose the correct verified resident.',
    loading: 'Searching verified residents…',
    noMatch: 'No active, verified resident matches this name.',
    chooseMatch: 'More than one exact name match. Choose the correct resident using birthdate and zone.',
    exactMatch: 'Exact resident match selected. The certificate preview will use this registered name and resident information.',
    birthDate: 'Birthdate',
    zone: 'Zone',
    addBatch: 'Add resident to batch',
    remove: 'Remove',
    batch: 'Print batch',
    batchEmpty: 'Add one or more verified residents to print the same certificate for a batch.',
    purpose: 'Purpose',
    purposePlaceholder: 'Enter the resident’s stated purpose',
    issueDate: 'Issue date',
    signatory: 'Authorized signatory name',
    signatoryPosition: 'Position',
    captainTitle: 'Barangay Captain',
    customTitle: 'Custom certificate title',
    customBody: 'Custom certificate wording',
    customBodyPlaceholder: 'Write the certificate wording. Use the placeholders listed below to insert resident information.',
    placeholders: 'Available placeholders: {full_name}, {first_name}, {last_name}, {birth_date}, {zone}, {household_id}, {address}, {purpose}, {issue_date}. Custom certificates leave the captain’s signature line blank.',
    saveTemplate: 'Save custom wording on this device',
    savedTemplate: 'Custom certificate wording saved on this device.',
    saveFailed: 'Unable to save the custom wording on this device.',
    printSingle: 'Print certificate',
    printBatch: 'Print certificates for batch',
    fullPrintPreview: 'Full certificate print preview',
    printPreviewDescription: 'This is the complete A4 layout that will be sent to the printer.',
    printing: 'Preparing print…',
    printFailed: 'Unable to prepare the printout. Allow pop-ups and try again.',
    popupBlocked: 'Allow pop-ups for this site to open the print view.',
    confidential: 'Confidential resident information — for authorized barangay use only.',
    barangayName: 'Barangay Legaspi',
    location: 'Tayug, Pangasinan',
    dateIssued: 'Date issued',
    authorizedOfficial: 'Authorized official',
    reviewBeforeSigning: 'Draft generated from registry information. Verify every statement, the stated purpose, and issuing authority before signing or releasing.',
    activeVerifiedOnly: 'Only active residents with verified registry records can be selected.',
    selectResident: 'Select resident',
  },
  fil: {
    title: 'Pag-imprenta ng sertipiko',
    intro: 'Maghanap ng aktibo at beripikadong residente. Awtomatikong pupunan ang eksaktong buong pangalan; suriin ang bawat dokumento bago lagdaan o ibigay.',
    certificateType: 'Uri ng sertipiko',
    clearance: 'Barangay clearance',
    residency: 'Sertipiko ng paninirahan',
    indigency: 'Sertipiko ng indigency',
    custom: 'Pasadyang sertipiko',
    searchResident: 'Buong pangalan ng residente',
    searchPlaceholder: 'Simulang ilagay ang buong pangalan ng residente',
    searchSuggestions: 'Piliin ang wastong beripikadong residente.',
    loading: 'Naghahanap ng beripikadong residente…',
    noMatch: 'Walang aktibo at beripikadong residenteng tumutugma sa pangalan.',
    chooseMatch: 'May higit sa isang eksaktong pangalan. Piliin ang wastong residente gamit ang petsa ng kapanganakan at zone.',
    exactMatch: 'Napili ang eksaktong residente. Gagamitin ng sertipiko ang nakarehistrong pangalan at impormasyon.',
    birthDate: 'Petsa ng kapanganakan',
    zone: 'Zone',
    addBatch: 'Idagdag sa batch',
    remove: 'Alisin',
    batch: 'I-imprenta ang batch',
    batchEmpty: 'Magdagdag ng isa o higit pang beripikadong residente para sa batch na sertipiko.',
    purpose: 'Layunin',
    purposePlaceholder: 'Ilagay ang layuning sinabi ng residente',
    issueDate: 'Petsa ng pag-isyu',
    signatory: 'Pangalan ng awtorisadong lumagda',
    signatoryPosition: 'Posisyon',
    captainTitle: 'Punong Barangay',
    customTitle: 'Pamagat ng pasadyang sertipiko',
    customBody: 'Nilalaman ng pasadyang sertipiko',
    customBodyPlaceholder: 'Isulat ang nilalaman ng sertipiko. Gamitin ang mga placeholder sa ibaba upang maglagay ng impormasyon ng residente.',
    placeholders: 'Mga placeholder: {full_name}, {first_name}, {last_name}, {birth_date}, {zone}, {household_id}, {address}, {purpose}, {issue_date}. Iiwanang blangko ang linya ng pirma ng punong barangay sa pasadyang sertipiko.',
    saveTemplate: 'I-save ang pasadyang nilalaman sa device na ito',
    savedTemplate: 'Na-save ang pasadyang nilalaman sa device na ito.',
    saveFailed: 'Hindi ma-save ang pasadyang nilalaman sa device na ito.',
    printSingle: 'I-imprenta ang sertipiko',
    printBatch: 'I-imprenta ang mga sertipiko para sa batch',
    fullPrintPreview: 'Buong preview ng sertipiko',
    printPreviewDescription: 'Ito ang buong A4 na ayos na ipapadala sa printer.',
    printing: 'Inihahanda ang pag-imprenta…',
    printFailed: 'Hindi naihanda ang imprenta. Payagan ang pop-up at subukang muli.',
    popupBlocked: 'Payagan ang pop-up ng site na ito upang buksan ang pahina ng imprenta.',
    confidential: 'Kumpidensiyal na impormasyon ng residente — para lamang sa awtorisadong gamit ng barangay.',
    barangayName: 'Barangay Legaspi',
    location: 'Tayug, Pangasinan',
    dateIssued: 'Petsa ng pag-isyu',
    authorizedOfficial: 'Awtorisadong opisyal',
    reviewBeforeSigning: 'Draft mula sa impormasyon ng registry. Beripikahin ang bawat pahayag, layunin, at awtoridad bago lagdaan o ibigay.',
    activeVerifiedOnly: 'Mga aktibong residenteng may beripikadong registry record lamang ang maaaring piliin.',
    selectResident: 'Piliin ang residente',
  },
}

const defaultTemplates = (language) => language === 'fil'
  ? {
      clearance: `Si {full_name}, na nakatala bilang residente ng {zone}, Barangay Legaspi, Tayug, Pangasinan, ay humiling ng barangay clearance para sa layuning ito: {purpose}.\n\nInilalabas ang sertipikong ito sa kahilingan ng residente, alinsunod sa beripikasyon ng impormasyon at mga naaangkop na patakaran ng barangay.`,
      residency: `Pinatutunayan na si {full_name} ay nakatala sa registry ng Barangay Legaspi bilang residente ng {zone}, Tayug, Pangasinan.\n\nIbinibigay ang sertipikasyong ito sa kahilingan ng residente para sa layuning ito: {purpose}.`,
      indigency: `Si {full_name}, na nakatala sa registry ng Barangay Legaspi sa {address}, {zone}, ay humiling ng sertipiko ng indigency para sa layuning ito: {purpose}.\n\nDapat suriin at beripikahin ng awtorisadong tanggapan ang batayan ng indigency bago lagdaan o ilabas ang sertipikong ito.`,
    }
  : {
      clearance: `{full_name}, a resident of {zone}, Barangay Legaspi, Tayug, Pangasinan, has requested this barangay clearance for the following purpose: {purpose}.\n\nThis certificate is issued upon the request of the named resident, subject to verification of the information and applicable barangay requirements.`,
      residency: `This is to certify that {full_name} is listed in the Barangay Legaspi resident registry as residing in {zone}, Tayug, Pangasinan.\n\nThis certification is issued upon the request of the named resident for the following purpose: {purpose}.`,
      indigency: `This is to certify that {full_name}, listed in the Barangay Legaspi resident registry at {address}, {zone}, has requested a certificate of indigency for the following purpose: {purpose}.\n\nThe basis for indigency must be reviewed and verified by the authorized issuing office before this certificate is signed or released.`,
    }

const isEligible = (resident) => resident.verificationStatus === 'verified' && resident.status === 'active'
const normalizedName = (resident) => `${resident.firstName || ''} ${resident.lastName || ''}`.trim().toLocaleLowerCase()

function loadCustomTemplate() {
  try {
    const saved = JSON.parse(window.localStorage.getItem('barangay-custom-certificate-template') || '{}')
    return {
      title: typeof saved.title === 'string' ? saved.title : '',
      body: typeof saved.body === 'string' ? saved.body : '',
      failed: false,
    }
  } catch (loadError) {
    console.error('load saved custom certificate template failed', loadError)
    return { title: '', body: '', failed: true }
  }
}

export default function StaffPrintCenter({ language = 'en' }) {
  const labels = copy[language] || copy.en
  const [initialTemplate] = useState(loadCustomTemplate)
  const [certificateType, setCertificateType] = useState('clearance')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedResident, setSelectedResident] = useState(null)
  const [batch, setBatch] = useState([])
  const [purpose, setPurpose] = useState('')
  const [issueDate, setIssueDate] = useState(dateToday)
  const [signatory, setSignatory] = useState('')
  const [position, setPosition] = useState('')
  const [customTitle, setCustomTitle] = useState(initialTemplate.title)
  const [customBody, setCustomBody] = useState(initialTemplate.body)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialTemplate.failed ? labels.saveFailed : '')
  const [message, setMessage] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const autoMatchRef = useRef('')
  const currentSearchRef = useRef('')
  const selectionRequestRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!debouncedSearch) return undefined
    const controller = new AbortController()
    let active = true
    const loadMatches = async () => {
      try {
        const params = new URLSearchParams({ search: debouncedSearch, page: '1', pageSize: '100' })
        const response = await fetch(`${API_BASE}/staff/residents?${params}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.residents)) throw new Error(data.message || labels.printFailed)
        if (!active || currentSearchRef.current !== debouncedSearch) return
        const eligible = data.residents.filter(isEligible)
        setSearchResults(eligible)
        const exactMatches = eligible.filter((resident) => normalizedName(resident) === debouncedSearch.toLocaleLowerCase())
        if (exactMatches.length === 1 && autoMatchRef.current !== debouncedSearch.toLocaleLowerCase()) {
          autoMatchRef.current = debouncedSearch.toLocaleLowerCase()
          const resident = exactMatches[0]
          setSelectedResident(resident)
        }
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active && currentSearchRef.current === debouncedSearch) {
          console.error('search verified residents for certificate printing failed', loadError)
          setError(loadError.message || labels.printFailed)
        }
      } finally {
        if (active && currentSearchRef.current === debouncedSearch) setLoading(false)
      }
    }
    loadMatches()
    return () => {
      active = false
      controller.abort()
    }
  }, [debouncedSearch, labels.printFailed])

  const getFullResident = async (resident, signal) => {
    const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(resident.id)}`, { signal })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.resident) throw new Error(data.message || labels.printFailed)
    if (!isEligible(data.resident)) throw new Error(labels.activeVerifiedOnly)
    return { ...resident, ...data.resident }
  }

  const chooseResident = async (resident) => {
    const requestId = ++selectionRequestRef.current
    setSelectedResident(resident)
    setSearch(`${resident.firstName} ${resident.lastName}`)
    autoMatchRef.current = normalizedName(resident)
    setError('')
    try {
      const fullResident = await getFullResident(resident)
      if (selectionRequestRef.current === requestId) setSelectedResident(fullResident)
    } catch (detailError) {
      if (selectionRequestRef.current === requestId) {
        console.error('load resident details for certificate printing failed', detailError)
        setError(detailError.message || labels.printFailed)
      }
    }
  }

  const addToBatch = (resident) => {
    setBatch((current) => current.some((item) => item.id === resident.id) ? current : [...current, resident])
    setMessage('')
  }

  const saveCustomTemplate = () => {
    try {
      localStorage.setItem('barangay-custom-certificate-template', JSON.stringify({ title: customTitle, body: customBody }))
      setMessage(labels.savedTemplate)
      setError('')
    } catch (saveError) {
      console.error('save custom certificate template failed', saveError)
      setError(labels.saveFailed)
    }
  }

  const printCertificates = async (residents) => {
    if (!residents.length || !purpose.trim() || (certificateType === 'custom' && (!customTitle.trim() || !customBody.trim()))) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError(labels.popupBlocked)
      return
    }
    printWindow.document.write(`<p>${labels.printing}</p>`)
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const fullResidents = await Promise.all(residents.map((resident) => getFullResident(resident)))
      const titles = {
        clearance: labels.clearance,
        residency: labels.residency,
        indigency: labels.indigency,
        custom: customTitle.trim(),
      }
      const body = certificateType === 'custom'
        ? customBody
        : defaultTemplates(language)[certificateType]
      const html = createCertificatePrintHtml({
        title: titles[certificateType],
        body,
        residents: fullResidents,
        values: {
          purpose: purpose.trim(),
          issueDate,
          signatory: certificateType === 'custom' ? '' : signatory.trim(),
          position: certificateType === 'custom' ? labels.captainTitle : position.trim(),
        },
        labels,
        language,
      })
      writePrintWindow(printWindow, html)
      setMessage(labels.printing)
    } catch (printError) {
      printWindow.close()
      console.error('prepare certificate printout failed', printError)
      setError(printError.message || labels.printFailed)
    } finally {
      setBusy(false)
    }
  }

  const exactMatches = search.trim()
    ? searchResults.filter((resident) => normalizedName(resident) === search.trim().toLocaleLowerCase())
    : []
  const currentTitle = certificateType === 'custom'
    ? customTitle
    : { clearance: labels.clearance, residency: labels.residency, indigency: labels.indigency }[certificateType]
  const previewBody = certificateType === 'custom'
    ? customBody
    : defaultTemplates(language)[certificateType]
  const previewHtml = createCertificatePrintHtml({
    title: currentTitle || labels.custom,
    body: previewBody,
    residents: [selectedResident || { firstName: '', lastName: '' }],
    values: {
      purpose: purpose.trim(),
      issueDate,
      signatory: certificateType === 'custom' ? '' : signatory.trim(),
      position: certificateType === 'custom' ? labels.captainTitle : position.trim(),
    },
    labels,
    language,
    autoPrint: false,
  })

  return (
    <section className="staff-print-center" aria-labelledby="staff-print-title">
      <article className="panel-card staff-print-intro">
        <h2 id="staff-print-title">{labels.title}</h2>
        <p>{labels.intro}</p>
        <p className="field-note">{labels.activeVerifiedOnly}</p>
      </article>

      <div className="staff-print-layout">
        <article className="panel-card staff-print-form">
          <label>{labels.certificateType}
            <select value={certificateType} onChange={(event) => { setCertificateType(event.target.value); setError(''); setMessage('') }}>
              <option value="clearance">{labels.clearance}</option>
              <option value="residency">{labels.residency}</option>
              <option value="indigency">{labels.indigency}</option>
              <option value="custom">{labels.custom}</option>
            </select>
          </label>

          <label>{labels.searchResident}
            <input type="search" autoComplete="off" value={search} placeholder={labels.searchPlaceholder} onChange={(event) => {
              const value = event.target.value
              selectionRequestRef.current += 1
              currentSearchRef.current = value.trim()
              setSearch(value)
              setSearchResults([])
              setLoading(Boolean(value.trim()))
              setSelectedResident(null)
              autoMatchRef.current = ''
              setError('')
            }} />
          </label>
          {loading && <p className="field-note" role="status">{labels.loading}</p>}
          {exactMatches.length > 1 && <p className="field-note">{labels.chooseMatch}</p>}
          {searchResults.length > 0 && exactMatches.length === 0 && <p className="field-note">{labels.searchSuggestions}</p>}
          {debouncedSearch === search.trim() && search.trim() && !loading && searchResults.length === 0 && <p className="field-note">{labels.noMatch}</p>}
          {searchResults.length > 0 && !selectedResident && <ul className="staff-print-match-list">
            {(exactMatches.length > 1 ? exactMatches : searchResults.slice(0, 10)).map((resident) => (
              <li key={resident.id}>
                <span>{resident.firstName} {resident.lastName} · {resident.birthDate || '—'} · Zone {resident.zone}</span>
                <button type="button" className="secondary-btn small" onClick={() => chooseResident(resident)}>{labels.selectResident}</button>
              </li>
            ))}
          </ul>}
          {selectedResident && isEligible(selectedResident) && (
            <div className="staff-print-selected" role="status">
              <strong>{selectedResident.firstName} {selectedResident.lastName}</strong>
              <span>{labels.exactMatch}</span>
              <small>{labels.birthDate}: {selectedResident.birthDate || '—'} · {labels.zone}: {selectedResident.zone ? `Zone ${selectedResident.zone}` : '—'}</small>
              <button type="button" className="secondary-btn small" onClick={() => addToBatch(selectedResident)}>{labels.addBatch}</button>
            </div>
          )}

          <label>{labels.purpose}
            <input value={purpose} maxLength={240} placeholder={labels.purposePlaceholder} onChange={(event) => setPurpose(event.target.value)} required />
          </label>
          <label>{labels.issueDate}
            <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required />
          </label>
          {certificateType !== 'custom' && <>
            <label>{labels.signatory}
              <input value={signatory} maxLength={120} onChange={(event) => setSignatory(event.target.value)} />
            </label>
            <label>{labels.signatoryPosition}
              <input value={position} maxLength={120} onChange={(event) => setPosition(event.target.value)} />
            </label>
          </>}

          {certificateType === 'custom' && (
            <div className="staff-print-custom-fields">
              <label>{labels.customTitle}
                <input value={customTitle} maxLength={120} onChange={(event) => setCustomTitle(event.target.value)} required />
              </label>
              <label>{labels.customBody}
                <textarea rows={9} value={customBody} maxLength={8000} placeholder={labels.customBodyPlaceholder} onChange={(event) => setCustomBody(event.target.value)} required />
              </label>
              <p className="field-note">{labels.placeholders}</p>
              <button type="button" className="secondary-btn small" onClick={saveCustomTemplate}>{labels.saveTemplate}</button>
            </div>
          )}
          {error && <p className="staff-print-message error" role="alert">{error}</p>}
          {message && <p className="staff-print-message" role="status">{message}</p>}
          <div className="staff-print-actions">
            <button type="button" className="primary-btn small" disabled={busy || !selectedResident || !purpose.trim() || (certificateType === 'custom' && (!customTitle.trim() || !customBody.trim()))} onClick={() => printCertificates([selectedResident])}>
              {busy ? labels.printing : labels.printSingle}
            </button>
          </div>
        </article>

        <aside className="panel-card staff-print-batch">
          <h2>{labels.batch}</h2>
          {batch.length ? (
            <>
              <ul>{batch.map((resident) => (
                <li key={resident.id}>
                  <span>{resident.firstName} {resident.lastName} · Zone {resident.zone}</span>
                  <button type="button" className="small-action danger" aria-label={`${labels.remove} ${resident.firstName} ${resident.lastName}`} onClick={() => setBatch((current) => current.filter((item) => item.id !== resident.id))}>{labels.remove}</button>
                </li>
              ))}</ul>
              <button type="button" className="primary-btn small" disabled={busy || !purpose.trim() || (certificateType === 'custom' && (!customTitle.trim() || !customBody.trim()))} onClick={() => printCertificates(batch)}>
                {busy ? labels.printing : `${labels.printBatch} (${batch.length})`}
              </button>
            </>
          ) : <p>{labels.batchEmpty}</p>}
        </aside>
      </div>

      <article className="panel-card staff-print-preview">
        <div className="staff-print-preview-heading">
          <div><h2>{currentTitle || labels.custom}</h2><p>{labels.location}</p></div>
          <span>{labels.issueDate}: {issueDate}</span>
        </div>
        <p className="field-note">{labels.printPreviewDescription}</p>
        <iframe className="staff-print-preview-frame" title={labels.fullPrintPreview} srcDoc={previewHtml} />
      </article>
    </section>
  )
}
