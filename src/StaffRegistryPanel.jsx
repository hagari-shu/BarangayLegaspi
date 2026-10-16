import { useEffect, useMemo, useState } from 'react'
import { parseRegistryCsv, registryCsvTemplate } from './registry-csv'
import './StaffRegistryPanel.css'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')

const text = {
  en: {
    title: 'Resident and household registry',
    subtitle: 'Restricted staff workspace. Counts include active, verified records only.',
    privacyTitle: 'Personal information — authorized use only',
    privacyNotice: 'Use these records only for authorized barangay duties. Enter only information needed from an official source; leave unknown fields blank. Do not share screenshots or exports outside approved work. New entries stay pending, and create, import, verification, and status changes are recorded in the audit log.',
    search: 'Search full name',
    birthDate: 'Exact birthdate',
    age: 'Exact age',
    zone: 'Zone',
    allZones: 'All zones',
    purok: 'Purok (exact)',
    anyPurok: 'Any purok',
    residents: 'Matching records',
    total: 'Verified population',
    male: 'Male',
    female: 'Female',
    unclassified: 'Unclassified sex',
    households: 'Households',
    byPurok: 'Population by purok / zone',
    byHousehold: 'Population by household',
    name: 'Resident',
    birthAndAge: 'Birthdate / age',
    location: 'Purok / zone',
    household: 'Household',
    status: 'Verification',
    recordStatus: 'Record status',
    verified: 'Verified',
    pending: 'Pending verification',
    needsReview: 'Needs review',
    active: 'Active',
    inactive: 'Inactive',
    deceased: 'Deceased',
    archived: 'Archived',
    markVerified: 'Mark verified',
    flagReview: 'Flag for review',
    noRecords: 'No matching registry records. The reference roster may not have been imported yet.',
    noGroup: 'No verified demographic records for this filter.',
    loading: 'Loading resident records…',
    loadError: 'Unable to load the staff registry.',
    invalidSearch: 'Use a valid birthdate and an age from 0 to 130.',
    add: 'Add a resident for verification',
    firstName: 'First name',
    lastName: 'Last name',
    sex: 'Sex',
    selectSex: 'Choose or leave unclassified',
    maleOption: 'Male',
    femaleOption: 'Female',
    unclassifiedOption: 'Unclassified',
    householdId: 'Household identifier',
    address: 'Address / location description',
    sourceRef: 'Source record reference',
    sourceFile: 'Source filename',
    save: 'Save as pending verification',
    confirmAdd: 'Continue after reviewing possible matches',
    cancelAdd: 'Cancel and review',
    saving: 'Saving…',
    saved: 'Saved to the review queue; it is excluded from population counts until verified.',
    duplicate: 'Possible matching record(s) found. Review them before verifying this registration.',
    confirmVerify: 'Confirm this record was checked against the source registry?',
    confirmFlag: 'Flag this record for manual review?',
    confirmStatus: 'Change this resident record status?',
    updateStatus: 'Update status',
    noDob: 'Not recorded',
    unassigned: 'Unassigned — needs verification',
    page: 'Page',
    of: 'of',
    previous: 'Previous',
    next: 'Next',
    importTitle: 'Import reviewed CSV',
    importHelp: 'Select a CSV to preview the first 10 rows locally. Review them, then explicitly choose Import pending records. Imported rows remain pending verification and do not affect population totals.',
    chooseCsv: 'Choose CSV file',
    importRecords: 'Import pending records',
    importDuplicates: 'Possible matches found. Review these rows before confirming; every imported row will remain pending verification.',
    importDone: 'Pending records imported. Verify each record against its source before counting it.',
    importTemplate: 'Download CSV template',
    importInvalid: 'Unable to preview this CSV.',
    importValidation: 'Import validation errors',
    previewRows: 'Preview (first 10 records)',
    row: 'CSV row',
    noFile: 'Choose a CSV file to preview.',
  },
  fil: {
    title: 'Talaan ng mga residente at sambahayan',
    subtitle: 'Limitado sa awtorisadong kawani. Kasama lamang sa bilang ang aktibo at beripikadong tala.',
    privacyTitle: 'Personal na impormasyon — para lamang sa awtorisadong gawain',
    privacyNotice: 'Gamitin lamang ang mga tala para sa awtorisadong tungkulin ng barangay. Ilagay lamang ang impormasyong kailangan mula sa opisyal na sanggunian; iwang blangko ang hindi alam. Huwag magbahagi ng screenshot o kopya sa labas ng aprubadong gawain. Mananatiling pending ang mga bagong tala, at itinatala sa audit log ang paglikha, pag-import, beripikasyon, at pagbabago ng katayuan.',
    search: 'Hanapin ang buong pangalan',
    birthDate: 'Eksaktong petsa ng kapanganakan',
    age: 'Eksaktong edad',
    zone: 'Zone',
    allZones: 'Lahat ng zone',
    purok: 'Purok (eksakto)',
    anyPurok: 'Anumang purok',
    residents: 'Mga katugmang tala',
    total: 'Beripikadong populasyon',
    male: 'Lalaki',
    female: 'Babae',
    unclassified: 'Hindi natukoy na kasarian',
    households: 'Mga sambahayan',
    byPurok: 'Populasyon ayon sa purok / zone',
    byHousehold: 'Populasyon ayon sa sambahayan',
    name: 'Residente',
    birthAndAge: 'Kapanganakan / edad',
    location: 'Purok / zone',
    household: 'Sambahayan',
    status: 'Beripikasyon',
    recordStatus: 'Katayuan ng tala',
    verified: 'Beripikado',
    pending: 'Naghihintay ng beripikasyon',
    needsReview: 'Kailangang suriin',
    active: 'Aktibo',
    inactive: 'Hindi aktibo',
    deceased: 'Pumanaw',
    archived: 'Naka-archive',
    markVerified: 'Markahang beripikado',
    flagReview: 'Ipa-review',
    noRecords: 'Walang tugmang tala. Maaaring hindi pa na-import ang talaan.',
    noGroup: 'Walang beripikadong demograpikong tala para sa filter na ito.',
    loading: 'Kinukuha ang mga tala…',
    loadError: 'Hindi makuha ang pribadong talaan ng kawani.',
    invalidSearch: 'Gumamit ng wastong petsa ng kapanganakan at edad na 0 hanggang 130.',
    add: 'Magdagdag ng residente para beripikahin',
    firstName: 'Pangalan',
    lastName: 'Apelyido',
    sex: 'Kasarian',
    selectSex: 'Pumili o iwang hindi natukoy',
    maleOption: 'Lalaki',
    femaleOption: 'Babae',
    unclassifiedOption: 'Hindi natukoy',
    householdId: 'ID ng sambahayan',
    address: 'Tirahan / paglalarawan ng lokasyon',
    sourceRef: 'Sanggunian ng pinagmulang tala',
    sourceFile: 'Pangalan ng source file',
    save: 'I-save bilang naghihintay ng beripikasyon',
    confirmAdd: 'Ituloy matapos suriin ang mga posibleng tugma',
    cancelAdd: 'Kanselahin at suriin',
    saving: 'Sine-save…',
    saved: 'Nasa pila na para suriin; hindi kasama sa bilang hangga’t hindi beripikado.',
    duplicate: 'May posibleng katugmang tala. Suriin muna bago beripikahin ang rehistrasyon.',
    confirmVerify: 'Kumpirmahing naikumpara ang tala sa opisyal na sanggunian?',
    confirmFlag: 'I-flag ang talang ito para sa manu-manong pagsusuri?',
    confirmStatus: 'Baguhin ang katayuan ng tala ng residenteng ito?',
    updateStatus: 'I-update ang katayuan',
    noDob: 'Hindi naitala',
    unassigned: 'Hindi nakatalaga — kailangang beripikahin',
    page: 'Pahina',
    of: 'sa',
    previous: 'Nakaraan',
    next: 'Susunod',
    importTitle: 'Mag-import ng nasuring CSV',
    importHelp: 'Pumili ng CSV para makita nang lokal ang unang 10 row. Suriin ang mga ito, saka piliin ang I-import bilang pending. Nananatiling pending ang mga tala at hindi isasama sa bilang ng populasyon.',
    chooseCsv: 'Pumili ng CSV file',
    importRecords: 'I-import bilang pending',
    importDuplicates: 'May posibleng katugmang tala. Suriin muna ang mga row bago kumpirmahin; pending pa rin ang lahat ng i-import.',
    importDone: 'Na-import na ang mga pending na tala. Beripikahin ang bawat tala gamit ang source bago isama sa bilang.',
    importTemplate: 'I-download ang CSV template',
    importInvalid: 'Hindi ma-preview ang CSV na ito.',
    importValidation: 'Mga error sa validation ng import',
    previewRows: 'Preview (unang 10 tala)',
    row: 'CSV row',
    noFile: 'Pumili ng CSV file para sa preview.',
  },
}

function formatDate(value, language) {
  if (!value) return null
  const parsed = new Date(`${value}T12:00:00+08:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(parsed)
}

export default function StaffRegistryPanel({ language = 'en' }) {
  const labels = text[language] || text.en
  const [search, setSearch] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [age, setAge] = useState('')
  const [zone, setZone] = useState('')
  const [purok, setPurok] = useState('')
  const [debounced, setDebounced] = useState({ search: '', birthDate: '', age: '', zone: '', purok: '' })
  const [records, setRecords] = useState([])
  const [demographics, setDemographics] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [potentialMatches, setPotentialMatches] = useState([])
  const [confirmMatchRequired, setConfirmMatchRequired] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importRows, setImportRows] = useState([])
  const [importMatches, setImportMatches] = useState([])
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [form, setForm] = useState({
    firstName: '', lastName: '', birthDate: '', sex: '', householdId: '', purok: '', zone: '', address: '', sourceReference: '', sourceFilename: '',
  })

  const formValid = useMemo(() => form.firstName.trim() && form.lastName.trim(), [form.firstName, form.lastName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setDebounced({ search: search.trim(), birthDate, age, zone, purok: purok.trim() })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, birthDate, age, zone, purok])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const params = new URLSearchParams({
      search: debounced.search,
      birthDate: debounced.birthDate,
      age: debounced.age,
      zone: debounced.zone,
      purok: debounced.purok,
      page: String(page),
      pageSize: String(pageSize),
    })
    const demographicParams = new URLSearchParams({ zone: debounced.zone, purok: debounced.purok })
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [residentResponse, demographicResponse] = await Promise.all([
          fetch(`${API_BASE}/staff/residents?${params}`, { signal: controller.signal }),
          fetch(`${API_BASE}/staff/demographics?${demographicParams}`, { signal: controller.signal }),
        ])
        const [residentData, demographicData] = await Promise.all([
          residentResponse.json().catch(() => ({})),
          demographicResponse.json().catch(() => ({})),
        ])
        if (!residentResponse.ok) throw new Error(residentData.message || labels.loadError)
        if (!demographicResponse.ok) throw new Error(demographicData.message || labels.loadError)
        if (active) {
          setRecords(Array.isArray(residentData.residents) ? residentData.residents : [])
          setTotal(Number(residentData.total) || 0)
          setDemographics(demographicData)
        }
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active) {
          console.error('load resident registry failed', loadError)
          setError(loadError.message || labels.loadError)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
      controller.abort()
    }
  }, [debounced, page, pageSize, labels.loadError, refreshKey])

  const saveResident = async (event, confirmPotentialMatch = false) => {
    event?.preventDefault()
    setFormBusy(true)
    setFormError('')
    setFormMessage('')
    setPotentialMatches([])
    try {
      const response = await fetch(`${API_BASE}/staff/residents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          birthDate: form.birthDate || null,
          sex: form.sex || null,
          householdId: form.householdId.trim() || null,
          purok: form.purok.trim() || null,
          zone: form.zone || null,
          address: form.address.trim() || null,
          sourceReference: form.sourceReference.trim() || null,
          sourceFilename: form.sourceFilename.trim() || null,
          confirmPotentialMatch,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.reviewRequired && Array.isArray(data.potentialMatches)) {
        setPotentialMatches(data.potentialMatches)
        setConfirmMatchRequired(true)
        return
      }
      if (!response.ok) throw new Error(data.message || labels.loadError)
      setPotentialMatches([])
      setConfirmMatchRequired(false)
      setFormMessage(labels.saved)
      setForm({ firstName: '', lastName: '', birthDate: '', sex: '', householdId: '', purok: '', zone: '', address: '', sourceReference: '', sourceFilename: '' })
      setPage(1)
      setRefreshKey((current) => current + 1)
      setSearch('')
    } catch (saveError) {
      console.error('save resident registry record failed', saveError)
      setFormError(saveError.message || labels.loadError)
    } finally {
      setFormBusy(false)
    }
  }
  const submitResident = (event) => saveResident(event, false)

  const updateVerification = async (resident, verificationStatus) => {
    const message = verificationStatus === 'verified' ? labels.confirmVerify : labels.confirmFlag
    if (!window.confirm(message)) return
    setError('')
    try {
      const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(resident.id)}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationStatus }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.loadError)
      setRecords((current) => current.map((item) => item.id === resident.id
        ? { ...item, verificationStatus: data.resident.verificationStatus }
        : item))
      setRefreshKey((current) => current + 1)
    } catch (verifyError) {
      console.error('update resident verification failed', verifyError)
      setError(verifyError.message || labels.loadError)
    }
  }

  const updateRecordStatus = async (resident, status) => {
    if (!window.confirm(labels.confirmStatus)) return
    setError('')
    try {
      const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(resident.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.loadError)
      setRecords((current) => current.map((item) => item.id === resident.id ? { ...item, status: data.resident.status } : item))
      setRefreshKey((current) => current + 1)
    } catch (statusError) {
      console.error('update resident registry status failed', statusError)
      setError(statusError.message || labels.loadError)
    }
  }

  const previewImport = async (file) => {
    setImportFile(file || null)
    setImportRows([])
    setImportMatches([])
    setImportMessage('')
    setImportError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 1024 * 1024) {
      setImportError(file.size > 1024 * 1024 ? 'CSV files must be 1 MB or smaller.' : labels.importInvalid)
      return
    }
    try {
      const rows = parseRegistryCsv(await file.text())
      setImportRows(rows)
    } catch (parseError) {
      setImportError(parseError.message || labels.importInvalid)
    }
  }

  const submitImport = async (confirmPotentialMatches = false) => {
    if (!importFile || !importRows.length) {
      setImportError(labels.noFile)
      return
    }
    setImportBusy(true)
    setImportError('')
    setImportMessage('')
    try {
      const response = await fetch(`${API_BASE}/staff/residents/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: importFile.name,
          residents: importRows,
          confirmPotentialMatches,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.reviewRequired && Array.isArray(data.potentialMatches)) {
        setImportMatches(data.potentialMatches)
        return
      }
      if (!response.ok) {
        const details = Array.isArray(data.validationErrors)
          ? data.validationErrors.slice(0, 10).map((item) => `${labels.row} ${item.row}: ${item.message}`).join(' ')
          : ''
        throw new Error(details || data.message || labels.importInvalid)
      }
      setImportRows([])
      setImportMatches([])
      setImportFile(null)
      setImportMessage(`${data.imported} — ${labels.importDone}`)
      setPage(1)
      setRefreshKey((current) => current + 1)
    } catch (submitError) {
      console.error('import resident registry CSV failed', submitError)
      setImportError(submitError.message || labels.importInvalid)
    } finally {
      setImportBusy(false)
    }
  }

  const downloadImportTemplate = () => {
    const url = URL.createObjectURL(new Blob([registryCsvTemplate], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'resident-registry-template.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const count = demographics?.overall || { total: 0, male: 0, female: 0, unclassified: 0, households: 0 }
  const maxPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="registry-panel" aria-labelledby="resident-registry-title">
      <div className="registry-panel-header">
        <div>
          <h2 id="resident-registry-title">{labels.title}</h2>
          <p>{labels.subtitle}</p>
        </div>
        <div className="registry-row-actions registry-toolbar-actions">
          <button type="button" className="secondary-btn small" onClick={() => setImportOpen((open) => !open)}>{labels.importTitle}</button>
          <button type="button" className="primary-btn small" onClick={() => { setFormOpen((open) => !open); setFormMessage(''); setFormError(''); setPotentialMatches([]); setConfirmMatchRequired(false) }}>
            {formOpen ? 'Close' : labels.add}
          </button>
        </div>
      </div>

      <aside className="registry-privacy-notice" aria-label={labels.privacyTitle}>
        <strong>{labels.privacyTitle}</strong>
        <p>{labels.privacyNotice}</p>
      </aside>

      {importOpen && (
        <section className="registry-import" aria-label={labels.importTitle}>
          <h3>{labels.importTitle}</h3>
          <p>{labels.importHelp}</p>
          <div className="registry-import-controls">
            <label>{labels.chooseCsv}<input type="file" accept=".csv,text/csv" onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              previewImport(file)
            }} /></label>
            <button type="button" className="secondary-btn small" onClick={downloadImportTemplate}>{labels.importTemplate}</button>
            <button type="button" className="primary-btn small" disabled={!importRows.length || importBusy} onClick={() => submitImport(false)}>{importBusy ? labels.saving : labels.importRecords}</button>
          </div>
          {importError && <p className="registry-message error" role="alert">{labels.importValidation}: {importError}</p>}
          {importMessage && <p className="registry-message" role="status">{importMessage}</p>}
          {importRows.length > 0 && (
            <div>
              <p><strong>{importFile?.name}</strong> · {importRows.length} {labels.residents}</p>
              <h4>{labels.previewRows}</h4>
              <div className="registry-table-wrap">
                <table className="registry-table registry-residents-table">
                  <thead><tr><th scope="col">{labels.name}</th><th scope="col">{labels.birthAndAge}</th><th scope="col">{labels.location}</th><th scope="col">{labels.household}</th></tr></thead>
                  <tbody>{importRows.slice(0, 10).map((resident, index) => (
                    <tr key={`${index}-${resident.firstName}-${resident.lastName}`}>
                      <td>{resident.firstName} {resident.lastName}</td>
                      <td>{resident.birthDate || labels.noDob}</td>
                      <td>{resident.purok || (resident.zone ? `Zone ${resident.zone}` : labels.unassigned)}{resident.zone && resident.purok ? ` · Zone ${resident.zone}` : ''}</td>
                      <td>{resident.householdId || labels.unassigned}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          {importMatches.length > 0 && (
            <div className="registry-message warning" role="alert">
              <strong>{labels.importDuplicates}</strong>
              <ul>{importMatches.map((match, index) => (
                <li key={`${match.row}-${index}`}>{labels.row} {match.row}: {match.records.map((record) => `${record.firstName} ${record.lastName} (${record.birthDate || labels.noDob})`).join(', ')}</li>
              ))}</ul>
              <div className="registry-row-actions">
                <button type="button" className="primary-btn small" disabled={importBusy} onClick={() => submitImport(true)}>{labels.importRecords}</button>
                <button type="button" className="secondary-btn small" disabled={importBusy} onClick={() => { setImportMatches([]); setImportRows([]); setImportFile(null) }}>{labels.cancelAdd}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {formOpen && (
        <form className="registry-entry-form" onSubmit={submitResident}>
          <label>{labels.firstName}<input value={form.firstName} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} required /></label>
          <label>{labels.lastName}<input value={form.lastName} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} required /></label>
          <label>{labels.birthDate}<input type="date" max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} value={form.birthDate} onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))} /></label>
          <label>{labels.sex}<select value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value }))}><option value="">{labels.selectSex}</option><option value="Male">{labels.maleOption}</option><option value="Female">{labels.femaleOption}</option><option value="Unclassified">{labels.unclassifiedOption}</option></select></label>
          <label>{labels.householdId}<input value={form.householdId} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, householdId: event.target.value }))} /></label>
          <label>{labels.zone}<select value={form.zone} onChange={(event) => setForm((current) => ({ ...current, zone: event.target.value }))}><option value="">{labels.unassigned}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
          <label>{labels.purok}<input value={form.purok} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, purok: event.target.value }))} /></label>
          <label>{labels.address}<input value={form.address} maxLength={255} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></label>
          <label>{labels.sourceRef}<input value={form.sourceReference} maxLength={255} onChange={(event) => setForm((current) => ({ ...current, sourceReference: event.target.value }))} /></label>
          <label>{labels.sourceFile}<input value={form.sourceFilename} maxLength={255} onChange={(event) => setForm((current) => ({ ...current, sourceFilename: event.target.value }))} /></label>
          {formError && <p className="registry-message error" role="alert">{formError}</p>}
          {formMessage && <p className="registry-message" role="status">{formMessage}</p>}
          {potentialMatches.length > 0 && (
            <div className="registry-message warning" role="alert">
              <strong>{labels.duplicate}</strong>
              <ul>{potentialMatches.map((match) => <li key={match.id}>{match.firstName} {match.lastName} · {formatDate(match.birthDate, language) || labels.noDob} · {match.purok || (match.zone ? `Zone ${match.zone}` : labels.unassigned)} · {match.verificationStatus}</li>)}</ul>
              {confirmMatchRequired && <div className="registry-row-actions"><button type="button" className="primary-btn small" disabled={formBusy} onClick={() => saveResident(null, true)}>{labels.confirmAdd}</button><button type="button" className="secondary-btn small" disabled={formBusy} onClick={() => { setConfirmMatchRequired(false); setPotentialMatches([]) }}>{labels.cancelAdd}</button></div>}
            </div>
          )}
          <button type="submit" className="primary-btn" disabled={!formValid || formBusy}>{formBusy ? labels.saving : labels.save}</button>
        </form>
      )}

      <div className="registry-filters" aria-label={labels.title}>
        <label>{labels.search}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>{labels.birthDate}<input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
        <label>{labels.age}<input type="number" min="0" max="130" inputMode="numeric" value={age} onChange={(event) => setAge(event.target.value)} /></label>
        <label>{labels.zone}<select value={zone} onChange={(event) => { setZone(event.target.value); setPurok('') }}><option value="">{labels.allZones}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
        <label>{labels.purok}<input value={purok} onChange={(event) => setPurok(event.target.value)} /></label>
      </div>
      {age !== '' && (!/^\d+$/.test(age) || Number(age) > 130) && <p className="registry-message error" role="alert">{labels.invalidSearch}</p>}

      {error && <p className="registry-message error" role="alert">{error}</p>}
      <div className="registry-summary-grid" aria-label={labels.total}>
        <article><span>{labels.total}</span><strong>{count.total}</strong></article>
        <article><span>{labels.male}</span><strong>{count.male}</strong></article>
        <article><span>{labels.female}</span><strong>{count.female}</strong></article>
        <article><span>{labels.unclassified}</span><strong>{count.unclassified}</strong></article>
        <article><span>{labels.households}</span><strong>{count.households}</strong></article>
      </div>

      {loading && <p className="registry-message" role="status" aria-live="polite">{labels.loading}</p>}
      {!loading && !error && records.length === 0 && <p className="registry-message" role="status">{labels.noRecords}</p>}
      {records.length > 0 && (
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead><tr><th scope="col">{labels.name}</th><th scope="col">{labels.birthAndAge}</th><th scope="col">{labels.location}</th><th scope="col">{labels.household}</th><th scope="col">{labels.status}</th><th scope="col">{labels.recordStatus}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{records.map((resident) => (
              <tr key={resident.id}>
                <td>{resident.firstName} {resident.lastName}<small>{resident.sex || labels.unclassifiedOption}</small></td>
                <td>{formatDate(resident.birthDate, language) || labels.noDob}<small>{resident.age === null ? labels.noDob : `${resident.age}`}</small></td>
                <td>{resident.purok || (resident.zone ? `Zone ${resident.zone}` : labels.unassigned)}</td>
                <td>{resident.householdId || labels.unassigned}</td>
                <td><span className={`registry-status is-${resident.verificationStatus}`}>{resident.verificationStatus === 'verified' ? labels.verified : resident.verificationStatus === 'needs_review' ? labels.needsReview : labels.pending}</span></td>
                <td><label className="registry-status-select"><span className="sr-only">{labels.updateStatus}: {resident.firstName} {resident.lastName}</span><select value={resident.status} onChange={(event) => updateRecordStatus(resident, event.target.value)}><option value="active">{labels.active}</option><option value="inactive">{labels.inactive}</option><option value="deceased">{labels.deceased}</option><option value="archived">{labels.archived}</option></select></label></td>
                <td>{resident.verificationStatus !== 'verified' && <div className="registry-row-actions"><button type="button" className="secondary-btn tiny" onClick={() => updateVerification(resident, 'verified')}>{labels.markVerified}</button><button type="button" className="secondary-btn tiny" onClick={() => updateVerification(resident, 'needs_review')}>{labels.flagReview}</button></div>}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="registry-pagination">
            <span>{labels.page} {page} {labels.of} {maxPage} · {total}</span>
            <div><button type="button" className="secondary-btn small" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>{labels.previous}</button><button type="button" className="secondary-btn small" disabled={page >= maxPage || loading} onClick={() => setPage((current) => current + 1)}>{labels.next}</button></div>
          </div>
        </div>
      )}
      <div className="registry-breakdowns">
        <section>
          <h3>{labels.byPurok}</h3>
          {demographics?.byPurok?.length ? (
            <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>{labels.location}</th><th>{labels.total}</th><th>{labels.male}</th><th>{labels.female}</th><th>{labels.unclassified}</th><th>{labels.households}</th></tr></thead><tbody>{demographics.byPurok.map((group) => <tr key={`${group.zone ?? 'none'}-${group.purok || 'none'}`}><td>{group.label}</td><td>{group.total}</td><td>{group.male}</td><td>{group.female}</td><td>{group.unclassified}</td><td>{group.households}</td></tr>)}</tbody></table></div>
          ) : <p>{labels.noGroup}</p>}
        </section>
        <section>
          <h3>{labels.byHousehold}</h3>
          {demographics?.byHousehold?.length ? (
            <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>{labels.household}</th><th>{labels.location}</th><th>{labels.total}</th><th>{labels.male}</th><th>{labels.female}</th><th>{labels.unclassified}</th></tr></thead><tbody>{demographics.byHousehold.map((group) => <tr key={`${group.zone ?? 'none'}-${group.purok || 'none'}-${group.householdId}`}><td>{group.householdId}</td><td>{group.purok || (group.zone ? `Zone ${group.zone}` : labels.unassigned)}</td><td>{group.total}</td><td>{group.male}</td><td>{group.female}</td><td>{group.unclassified}</td></tr>)}</tbody></table></div>
          ) : <p>{labels.noGroup}</p>}
        </section>
      </div>
    </section>
  )
}
