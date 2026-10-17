import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { parseRegistryCsv, registryCsvTemplate } from './registry-csv'
import { createResidentRegistryCsv } from './resident-registry-export'
import './StaffRegistryPanel.css'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')
const isScaleDemo = import.meta.env.VITE_REGISTRY_SCALE_DEMO === 'true'
const maritalStatusOptions = ['Single', 'Married', 'Widowed', 'Live-in', 'Divorced', 'Annulled', 'Separate']

const text = {
  en: {
    title: 'Resident and household registry',
    subtitle: 'Restricted staff workspace. Counts include active, verified records only.',
    sourceReviewTitle: 'Source list follow-up',
    sourceReviewHelp: 'Record an incomplete or unclear source sheet for follow-up. Do not include resident names or sensitive details; resolve the warning only after the source list is reconciled.',
    sourceReviewAttention: 'Source list is incomplete or contains unclear entries; staff review is required.',
    sourceReviewLocation: 'Location for follow-up',
    sourceReviewOpen: 'Add warning',
    sourceReviewResolve: 'Mark resolved',
    sourceReviewConfirm: 'Confirm the source list for this location has been reconciled and all remaining residents have been accounted for?',
    sourceReviewLoadError: 'Unable to load source-review warnings.',
    sourceReviewCreateError: 'Unable to add the source-review warning.',
    sourceReviewResolveError: 'Unable to resolve the source-review warning.',
    sourceReviewCreated: 'Source-review warning added.',
    sourceReviewAlreadyOpen: 'An open warning already exists for this location.',
    sourceReviewNone: 'No open source-review warnings.',
    privacyTitle: 'Personal information — authorized use only',
    privacyNotice: 'Use these records only for authorized barangay duties. Enter only information needed from an official source; leave unknown fields blank. Do not share screenshots or exports outside approved work. New entries stay pending, and resident, import, edit, verification, status, and source-warning changes are recorded in the audit log.',
    search: 'Search full name',
    searchButton: 'Search',
    clearSearch: 'Clear',
    searchHint: 'Enter the start of each name word',
    searchResultsTitle: 'Search results',
    searchMatchZone: 'Search match',
    birthDate: 'Exact birthdate',
    birthDateDetail: 'Birthdate',
    age: 'Exact age',
    ageDetail: 'Age',
    zone: 'Zone',
    residentDetails: 'Resident details',
    viewResidentDetails: 'View all resident details',
    closeDetails: 'Close details',
    allZones: 'All zones',
    zoneTabLabel: 'Filter registry by zone',
    zoneCardHelp: 'Search residents by name or details to highlight their zone. Select a zone to view its residents.',
    zoneResidentCount: 'active, verified residents',
    closeZone: 'Close zone',
    birthdateAndAge: 'Birthdate and age',
    editRecord: 'Edit record',
    editResident: 'Edit resident record',
    hiddenNameHint: 'Stored name is hidden. Enter a replacement only if it needs correction.',
    saveChanges: 'Save changes',
    cancelEdit: 'Cancel editing',
    updateError: 'Unable to update the resident record.',
    updateSuccess: 'Resident record updated.',
    noZoneRecords: 'No resident records were found for this zone.',
    maritalStatus: 'Marital status',
    optional: 'Not provided',
    occupation: 'Occupation',
    household: 'Household',
    residents: 'Matching records',
    total: 'Verified population',
    male: 'Male',
    female: 'Female',
    households: 'Households',
    byHousehold: 'Population by household',
    name: 'Resident',
    birthAndAge: 'Birthdate / age',
    location: 'Zone',
    status: 'Verification',
    recordStatus: 'Record status',
    verified: 'Verified',
    pending: 'Pending verification',
    needsReview: 'Needs review',
    close: 'Close',
    confirmImport: 'Import after reviewing current possible matches',
    active: 'Active',
    inactive: 'Inactive',
    deceased: 'Deceased',
    archived: 'Archived',
    markVerified: 'Mark verified',
    flagReview: 'Flag for review',
    noRecords: 'No matching registry records. The reference roster may not have been imported yet.',
    noGroup: 'No verified demographic records for this filter.',
    loading: 'Searching resident records…',
    loadError: 'Unable to load the staff registry.',
    demographicsLoadError: 'Unable to load the registry summary.',
    invalidSearch: 'Use a valid birthdate and an age from 0 to 130.',
    add: 'Add a resident for verification',
    firstName: 'First name',
    lastName: 'Last name',
    sex: 'Sex',
    selectSex: 'Choose sex',
    maleOption: 'Male',
    femaleOption: 'Female',
    sexNeedsCorrection: 'Sex needs correction from source',
    sourceRef: 'Source record reference (optional)',
    sourceFile: 'Source filename (optional)',
    save: 'Save as pending verification',
    confirmAdd: 'Continue after reviewing possible matches',
    cancelAdd: 'Cancel and review',
    saving: 'Saving…',
    saved: 'Saved to the review queue; it is excluded from population counts until verified.',
    alreadySaved: 'This exact record was already present; no duplicate was added.',
    skippedDuplicates: 'identical duplicate(s) skipped',
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
    exportSpreadsheet: 'Download Excel-ready CSV',
    exportConfirm: 'Download all resident records matching the current filters? The file contains private resident information and must be kept in approved storage.',
    exportError: 'Unable to export the resident spreadsheet.',
    exportBusy: 'Preparing spreadsheet…',
    exportDone: 'Spreadsheet downloaded. Keep it in approved storage and do not share it outside authorized work.',
    exportLimit: 'Add filters to keep the export at or below 10,000 records.',
  },
  fil: {
    title: 'Talaan ng mga residente at sambahayan',
    subtitle: 'Limitado sa awtorisadong kawani. Kasama lamang sa bilang ang aktibo at beripikadong tala.',
    sourceReviewTitle: 'Follow-up sa source list',
    sourceReviewHelp: 'Itala para sa follow-up ang hindi kumpleto o hindi malinaw na source sheet. Huwag ilagay ang pangalan ng residente o sensitibong detalye; lutasin lamang ang babala kapag naitugma na ang source list.',
    sourceReviewAttention: 'Hindi kumpleto ang source list o may hindi malinaw na tala; kailangan itong suriin ng kawani.',
    sourceReviewLocation: 'Lokasyong susuriin',
    sourceReviewOpen: 'Magdagdag ng babala',
    sourceReviewResolve: 'Markahang nalutas',
    sourceReviewConfirm: 'Kumpirmahing naitugma na ang source list para sa lokasyong ito at naisama na ang lahat ng natitirang residente?',
    sourceReviewLoadError: 'Hindi makuha ang mga babala sa pagsusuri ng source.',
    sourceReviewCreateError: 'Hindi maidagdag ang babala sa pagsusuri ng source.',
    sourceReviewResolveError: 'Hindi malutas ang babala sa pagsusuri ng source.',
    sourceReviewCreated: 'Naidagdag ang babala sa pagsusuri ng source.',
    sourceReviewAlreadyOpen: 'May bukas nang babala para sa lokasyong ito.',
    sourceReviewNone: 'Walang bukas na babala sa pagsusuri ng source.',
    privacyTitle: 'Personal na impormasyon — para lamang sa awtorisadong gawain',
    privacyNotice: 'Gamitin lamang ang mga tala para sa awtorisadong tungkulin ng barangay. Ilagay lamang ang impormasyong kailangan mula sa opisyal na sanggunian; iwang blangko ang hindi alam. Huwag magbahagi ng screenshot o kopya sa labas ng aprubadong gawain. Mananatiling pending ang mga bagong tala, at itinatala sa audit log ang pagbabago ng resident, import, pag-edit, beripikasyon, status, at source-warning.',
    search: 'Hanapin ang buong pangalan',
    searchHint: 'Ilagay ang paunang bahagi ng bawat salita sa pangalan',
    searchButton: 'Maghanap',
    clearSearch: 'I-clear',
    searchResultsTitle: 'Mga resulta ng paghahanap',
    searchMatchZone: 'Tugma sa paghahanap',
    birthDate: 'Eksaktong petsa ng kapanganakan',
    birthDateDetail: 'Petsa ng kapanganakan',
    age: 'Eksaktong edad',
    ageDetail: 'Edad',
    zone: 'Zone',
    residentDetails: 'Detalye ng residente',
    viewResidentDetails: 'Tingnan ang buong detalye ng residente',
    closeDetails: 'Isara ang detalye',
    allZones: 'Lahat ng zone',
    zoneTabLabel: 'Salain ang rehistro ayon sa zone',
    zoneCardHelp: 'Maghanap ayon sa pangalan o detalye upang ma-highlight ang zone. Pumili ng zone upang makita ang mga residente nito.',
    zoneResidentCount: 'aktibo at beripikadong residente',
    closeZone: 'Isara ang zone',
    birthdateAndAge: 'Petsa ng kapanganakan at edad',
    editRecord: 'I-edit ang tala',
    editResident: 'I-edit ang tala ng residente',
    hiddenNameHint: 'Nakatago ang naka-save na pangalan. Maglagay lamang ng pamalit kung kailangang itama.',
    saveChanges: 'I-save ang mga pagbabago',
    cancelEdit: 'Kanselahin ang pag-edit',
    updateError: 'Hindi ma-update ang tala ng residente.',
    updateSuccess: 'Na-update ang tala ng residente.',
    noZoneRecords: 'Walang nakitang tala ng residente para sa zone na ito.',
    maritalStatus: 'Katayuan sa pag-aasawa',
    optional: 'Hindi ibinigay',
    occupation: 'Trabaho',
    household: 'Sambahayan',
    residents: 'Mga katugmang tala',
    total: 'Beripikadong populasyon',
    male: 'Lalaki',
    female: 'Babae',
    households: 'Mga sambahayan',
    byHousehold: 'Populasyon ayon sa sambahayan',
    name: 'Residente',
    birthAndAge: 'Kapanganakan / edad',
    location: 'Zone',
    status: 'Beripikasyon',
    recordStatus: 'Katayuan ng tala',
    verified: 'Beripikado',
    pending: 'Naghihintay ng beripikasyon',
    needsReview: 'Kailangang suriin',
    close: 'Isara',
    confirmImport: 'I-import matapos suriin ang kasalukuyang mga posibleng tugma',
    active: 'Aktibo',
    inactive: 'Hindi aktibo',
    deceased: 'Pumanaw',
    archived: 'Naka-archive',
    markVerified: 'Markahang beripikado',
    flagReview: 'Ipa-review',
    noRecords: 'Walang tugmang tala. Maaaring hindi pa na-import ang talaan.',
    noGroup: 'Walang beripikadong demograpikong tala para sa filter na ito.',
    loading: 'Hinahanap ang mga tala ng residente…',
    loadError: 'Hindi makuha ang pribadong talaan ng kawani.',
    demographicsLoadError: 'Hindi makuha ang buod ng rehistro.',
    invalidSearch: 'Gumamit ng wastong petsa ng kapanganakan at edad na 0 hanggang 130.',
    add: 'Magdagdag ng residente para beripikahin',
    firstName: 'Pangalan',
    lastName: 'Apelyido',
    sex: 'Kasarian',
    selectSex: 'Pumili ng kasarian',
    maleOption: 'Lalaki',
    femaleOption: 'Babae',
    sexNeedsCorrection: 'Kailangang itama ang kasarian mula sa source',
    sourceRef: 'Sanggunian ng pinagmulang tala (opsyonal)',
    sourceFile: 'Pangalan ng source file (opsyonal)',
    save: 'I-save bilang naghihintay ng beripikasyon',
    confirmAdd: 'Ituloy matapos suriin ang mga posibleng tugma',
    cancelAdd: 'Kanselahin at suriin',
    saving: 'Sine-save…',
    saved: 'Nasa pila na para suriin; hindi kasama sa bilang hangga’t hindi beripikado.',
    alreadySaved: 'Nasa talaan na ang eksaktong rekord na ito; walang idinagdag na kopya.',
    skippedDuplicates: 'magkaparehong duplicate ang nilaktawan',
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
    exportSpreadsheet: 'I-download ang CSV para sa Excel',
    exportConfirm: 'I-download ang lahat ng tala ng residente na tumutugma sa kasalukuyang mga filter? May pribadong impormasyon ang file at dapat itong itago sa aprubadong imbakan.',
    exportError: 'Hindi ma-export ang spreadsheet ng rehistro.',
    exportBusy: 'Inihahanda ang spreadsheet…',
    exportDone: 'Na-download ang spreadsheet. Itago ito sa aprubadong imbakan at huwag ibahagi sa labas ng awtorisadong gawain.',
    exportLimit: 'Magdagdag ng mga filter upang hindi lumampas sa 10,000 tala ang export.',
  },
}

function formatDate(value, language) {
  if (!value) return null
  const parsed = new Date(`${value}T12:00:00+08:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(parsed)
}

function ResidentDetails({ resident, labels, language }) {
  return (
    <section className="registry-resident-quick-view" aria-label={labels.residentDetails}>
      <h4>{[resident.firstName, resident.lastName].filter(Boolean).join(' ') || labels.name}</h4>
      <dl>
        <div><dt>{labels.birthDateDetail}</dt><dd>{formatDate(resident.birthDate, language) || labels.noDob}</dd></div>
        <div><dt>{labels.ageDetail}</dt><dd>{resident.age === null || resident.age === undefined ? labels.noDob : resident.age}</dd></div>
        <div><dt>{labels.zone}</dt><dd>{resident.zone ? `${labels.zone} ${resident.zone}` : labels.unassigned}</dd></div>
        <div><dt>{labels.household}</dt><dd>{resident.household || resident.householdId || labels.unassigned}</dd></div>
        <div><dt>{labels.sex}</dt><dd>{resident.sex || labels.noDob}</dd></div>
        <div><dt>{labels.maritalStatus}</dt><dd>{resident.maritalStatus || labels.noDob}</dd></div>
        <div><dt>{labels.occupation}</dt><dd>{resident.occupation || labels.noDob}</dd></div>
        <div><dt>{labels.status}</dt><dd>{resident.verificationStatus === 'verified' ? labels.verified : resident.verificationStatus === 'needs_review' ? labels.needsReview : labels.pending}</dd></div>
      </dl>
    </section>
  )
}

export default function StaffRegistryPanel({ language = 'en' }) {
  const labels = text[language] || text.en
  const [search, setSearch] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [age, setAge] = useState('')
  const [zone, setZone] = useState('')
  const [debounced, setDebounced] = useState({ search: '', birthDate: '', age: '', zone: '' })
  const [records, setRecords] = useState([])
  const [residentDetailsId, setResidentDetailsId] = useState(null)
  const [demographics, setDemographics] = useState(null)
  const [sourceReviews, setSourceReviews] = useState([])
  const [sourceReviewPurok, setSourceReviewPurok] = useState('')
  const [sourceReviewZone, setSourceReviewZone] = useState('')
  const [sourceReviewError, setSourceReviewError] = useState('')
  const [sourceReviewMessage, setSourceReviewMessage] = useState('')
  const [sourceReviewBusy, setSourceReviewBusy] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [demographicsError, setDemographicsError] = useState('')
  const [selectedZone, setSelectedZone] = useState('')
  const [editResident, setEditResident] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [editMessage, setEditMessage] = useState('')
  const [editForm, setEditForm] = useState(null)
  const residentDialogRef = useRef(null)
  const closeResidentDialogRef = useRef(null)
  const searchDebounceRef = useRef(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [potentialMatches, setPotentialMatches] = useState([])
  const [reviewedMatches, setReviewedMatches] = useState([])
  const [confirmMatchRequired, setConfirmMatchRequired] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importRows, setImportRows] = useState([])
  const [importMatches, setImportMatches] = useState([])
  const [importReviewedMatches, setImportReviewedMatches] = useState([])
  const [importPreviewBusy, setImportPreviewBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [form, setForm] = useState({
    firstName: '', lastName: '', birthDate: '', sex: '', household: '', maritalStatus: '', zone: '', occupation: '', sourceReference: '', sourceFilename: '',
  })

  const formValid = useMemo(() => (
    form.firstName.trim()
    && form.lastName.trim()
    && ['Male', 'Female'].includes(form.sex)
  ), [form.firstName, form.lastName, form.sex])
  const queryPending = search.trim() !== debounced.search
    || birthDate !== debounced.birthDate
    || age !== debounced.age
    || zone !== debounced.zone
  const hasActiveFilters = Boolean(search.trim() || birthDate || age || zone)
  const hasDebouncedFilters = Boolean(
    debounced.search || debounced.birthDate || debounced.age || debounced.zone,
  )
  const matchedZones = useMemo(() => new Set(
    hasActiveFilters && !queryPending
      ? records.map((resident) => resident.zone).filter((residentZone) => residentZone !== null && residentZone !== undefined).map(String)
      : [],
  ), [hasActiveFilters, queryPending, records])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      searchDebounceRef.current = null
      setPage(1)
      setDebounced({
        search: search.trim(),
        birthDate,
        age,
        zone,
      })
    }, 150)
    searchDebounceRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (searchDebounceRef.current === timer) searchDebounceRef.current = null
    }
  }, [search, birthDate, age, zone])

  useEffect(() => {
    if (!selectedZone) return undefined
    const dialog = residentDialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    closeResidentDialogRef.current?.focus()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [selectedZone])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const params = new URLSearchParams({
      search: debounced.search,
      birthDate: debounced.birthDate,
      age: debounced.age,
      zone: debounced.zone,
      page: String(page),
      pageSize: String(pageSize),
    })
    const load = async () => {
      if (!hasDebouncedFilters || queryPending) {
        setRecords([])
        setTotal(0)
        setResidentDetailsId(null)
        setLoading(hasDebouncedFilters && queryPending)
        setError('')
        return
      }
      setLoading(true)
      setError('')
      try {
        const residentResponse = await fetch(`${API_BASE}/staff/residents?${params}`, { signal: controller.signal })
        const residentData = await residentResponse.json().catch(() => ({}))
        if (!residentResponse.ok) throw new Error(residentData.message || labels.loadError)
        if (active) {
          const resultResidents = Array.isArray(residentData.residents) ? residentData.residents : []
          setRecords(resultResidents)
          setTotal(Number(residentData.total) || 0)
          const normalizeName = (value) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
          const exactFullName = resultResidents.length === 1
            && Number(residentData.total) === 1
            && normalizeName(`${resultResidents[0].firstName || ''} ${resultResidents[0].lastName || ''}`) === normalizeName(debounced.search)
          setResidentDetailsId(exactFullName ? resultResidents[0].id : null)
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
  }, [debounced, hasDebouncedFilters, page, pageSize, labels.loadError, queryPending, refreshKey])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const params = new URLSearchParams()
    const loadDemographics = async () => {
      try {
        const response = await fetch(`${API_BASE}/staff/demographics?${params}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || labels.demographicsLoadError)
        if (active) {
          setDemographics(data)
          setDemographicsError('')
        }
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active) {
          console.error('load resident registry summary failed', loadError)
          setDemographicsError(loadError.message || labels.demographicsLoadError)
        }
      }
    }
    loadDemographics()
    return () => {
      active = false
      controller.abort()
    }
  }, [labels.demographicsLoadError, refreshKey])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const loadSourceReviews = async () => {
      setSourceReviewError('')
      try {
        const response = await fetch(`${API_BASE}/staff/registry-source-reviews`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || labels.sourceReviewLoadError)
        if (active) setSourceReviews(Array.isArray(data.reviews) ? data.reviews : [])
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active) {
          console.error('load registry source-review warnings failed', loadError)
          setSourceReviewError(loadError.message || labels.sourceReviewLoadError)
        }
      }
    }
    loadSourceReviews()
    return () => {
      active = false
      controller.abort()
    }
  }, [labels.sourceReviewLoadError, refreshKey])

  const openSourceReview = async (event) => {
    event.preventDefault()
    setSourceReviewBusy(true)
    setSourceReviewError('')
    setSourceReviewMessage('')
    try {
      const response = await fetch(`${API_BASE}/staff/registry-source-reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purok: sourceReviewPurok.trim(), zone: sourceReviewZone || null }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.sourceReviewCreateError)
      setSourceReviews((current) => current.some((review) => review.id === data.review.id) ? current : [...current, data.review])
      setSourceReviewError('')
      setSourceReviewMessage(data.created ? labels.sourceReviewCreated : labels.sourceReviewAlreadyOpen)
    } catch (openError) {
      console.error('create registry source-review warning failed', openError)
      setSourceReviewError(openError.message || labels.sourceReviewCreateError)
    } finally {
      setSourceReviewBusy(false)
    }
  }

  const resolveSourceReview = async (review) => {
    if (!window.confirm(labels.sourceReviewConfirm)) return
    setSourceReviewBusy(true)
    setSourceReviewError('')
    try {
      const response = await fetch(`${API_BASE}/staff/registry-source-reviews/${encodeURIComponent(review.id)}/resolve`, {
        method: 'PATCH',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.sourceReviewResolveError)
      setSourceReviews((current) => current.filter((item) => item.id !== review.id))
      setSourceReviewMessage('')
    } catch (resolveError) {
      console.error('resolve registry source-review warning failed', resolveError)
      setSourceReviewError(resolveError.message || labels.sourceReviewResolveError)
    } finally {
      setSourceReviewBusy(false)
    }
  }

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
          household: form.household.trim() || null,
          maritalStatus: form.maritalStatus.trim() || null,
          zone: form.zone || null,
          occupation: form.occupation.trim() || null,
          sourceReference: form.sourceReference.trim() || null,
          sourceFilename: form.sourceFilename.trim() || null,
          confirmPotentialMatch,
          reviewedMatches,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.reviewRequired && Array.isArray(data.potentialMatches)) {
        setPotentialMatches(data.potentialMatches)
        setReviewedMatches(data.reviewedMatches || [])
        setConfirmMatchRequired(true)
        return
      }
      if (!response.ok) throw new Error(data.message || labels.loadError)
      setPotentialMatches([])
      setReviewedMatches([])
      setConfirmMatchRequired(false)
      setFormMessage(data.created === false ? labels.alreadySaved : labels.saved)
      setForm({ firstName: '', lastName: '', birthDate: '', sex: '', household: '', maritalStatus: '', zone: '', occupation: '', sourceReference: '', sourceFilename: '' })
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

  const beginResidentEdit = (resident) => {
    setEditResident(resident)
    setEditError('')
    setEditMessage('')
    setEditForm({
      firstName: '',
      lastName: '',
      birthDate: resident.birthDate || '',
      sex: resident.sex || '',
      household: resident.household || resident.householdId || '',
      zone: resident.zone ? String(resident.zone) : '',
      maritalStatus: resident.maritalStatus || '',
      occupation: resident.occupation || '',
      sourceReference: resident.sourceReference || '',
      sourceFilename: resident.sourceFilename || '',
      verificationStatus: resident.verificationStatus || 'pending',
      status: resident.status || 'active',
    })
  }

  const saveResidentEdit = async (event) => {
    event.preventDefault()
    if (!editResident || !editForm) return
    setEditBusy(true)
    setEditError('')
    setEditMessage('')
    const updates = {
      birthDate: editForm.birthDate || null,
      household: editForm.household.trim() || null,
      zone: editForm.zone || null,
      maritalStatus: editForm.maritalStatus.trim() || null,
      occupation: editForm.occupation.trim() || null,
      sourceReference: editForm.sourceReference.trim() || null,
      sourceFilename: editForm.sourceFilename.trim() || null,
      status: editForm.status,
      verificationStatus: editForm.verificationStatus,
    }
    if (editForm.firstName.trim()) updates.firstName = editForm.firstName.trim()
    if (editForm.lastName.trim()) updates.lastName = editForm.lastName.trim()
    if (editForm.sex) updates.sex = editForm.sex
    try {
      const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(editResident.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.updateError)
      setRecords((current) => current.map((record) => record.id === editResident.id ? { ...record, ...data.resident } : record))
      setEditMessage(labels.updateSuccess)
      setEditResident(null)
      setEditForm(null)
      setRefreshKey((current) => current + 1)
    } catch (updateError) {
      console.error('update resident registry record failed', updateError)
      setEditError(updateError.message || labels.updateError)
    } finally {
      setEditBusy(false)
    }
  }

  const previewImport = async (file) => {
    setImportFile(file || null)
    setImportRows([])
    setImportMatches([])
    setImportReviewedMatches([])
    setImportMessage('')
    setImportError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 1024 * 1024) {
      setImportError(file.size > 1024 * 1024 ? 'CSV files must be 1 MB or smaller.' : labels.importInvalid)
      return
    }
    setImportPreviewBusy(true)
    try {
      const rows = parseRegistryCsv(await file.text())
      setImportRows(rows)
    } catch (parseError) {
      setImportError(parseError.message || labels.importInvalid)
    } finally {
      setImportPreviewBusy(false)
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
          reviewedMatches: importReviewedMatches,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.reviewRequired && Array.isArray(data.potentialMatches)) {
        setImportMatches(data.potentialMatches)
        setImportReviewedMatches(data.reviewedMatches || [])
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
      setImportReviewedMatches([])
      setImportFile(null)
      setImportMessage(`${data.imported} ${labels.importDone}${data.skipped ? ` (${data.skipped} ${labels.skippedDuplicates})` : ''}`)
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

  const downloadResidentSpreadsheet = async () => {
    if (exportBusy || queryPending || !window.confirm(labels.exportConfirm)) return
    setExportBusy(true)
    setExportError('')
    setExportMessage('')
    try {
      const filters = {
        search: debounced.search,
        birthDate: debounced.birthDate,
        age: debounced.age,
        zone: debounced.zone,
      }
      const residents = []
      let expectedTotal = null
      for (let exportPage = 1; expectedTotal === null || residents.length < expectedTotal; exportPage += 1) {
        const params = new URLSearchParams({ ...filters, page: String(exportPage), pageSize: '100' })
        const response = await fetch(`${API_BASE}/staff/residents?${params}`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || labels.exportError)
        if (!Array.isArray(data.residents) || !Number.isInteger(data.total) || data.total < 0) {
          throw new Error(labels.exportError)
        }
        if (expectedTotal === null) expectedTotal = data.total
        if (data.total !== expectedTotal || data.residents.length === 0 && residents.length < expectedTotal) {
          throw new Error(labels.exportError)
        }
        if (expectedTotal > 10000) throw new Error(labels.exportLimit)
        residents.push(...data.residents)
      }
      if (residents.length !== expectedTotal || new Set(residents.map((resident) => resident.id)).size !== residents.length) {
        throw new Error(labels.exportError)
      }
      if (residents.length === 0) throw new Error(labels.noRecords)

      const auditResponse = await fetch(`${API_BASE}/staff/residents/export-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: residents.length,
          grouping: 'zone_household_name',
          format: 'csv',
          filters: {
            hasSearch: Boolean(filters.search),
            hasBirthDate: Boolean(filters.birthDate),
            hasAge: Boolean(filters.age),
            hasZone: Boolean(filters.zone),
            hasMaritalStatusFilter: false,
            hasOccupationFilter: false,
          },
        }),
      })
      const auditData = await auditResponse.json().catch(() => ({}))
      if (!auditResponse.ok) throw new Error(auditData.message || labels.exportError)

      const csv = createResidentRegistryCsv(residents)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `resident-registry-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportMessage(labels.exportDone)
    } catch (downloadError) {
      console.error('download resident registry spreadsheet failed', downloadError)
      setExportError(downloadError.message || labels.exportError)
    } finally {
      setExportBusy(false)
    }
  }

  const maxPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="registry-panel" aria-labelledby="resident-registry-title">
      {isScaleDemo && (
        <aside className="registry-scale-demo-banner" role="note">
          <strong>Synthetic scale demo — fictional records only</strong>
          <span>This local preview uses a temporary isolated database. It is not connected to production or real resident information.</span>
        </aside>
      )}
      <div className="registry-panel-header">
        <div>
          <h2 id="resident-registry-title">{labels.title}</h2>
          <p>{labels.subtitle}</p>
        </div>
        <div className="registry-row-actions registry-toolbar-actions">
          <button type="button" className="secondary-btn small" onClick={downloadResidentSpreadsheet} disabled={exportBusy || queryPending}>{exportBusy ? labels.exportBusy : labels.exportSpreadsheet}</button>
          <button type="button" className="secondary-btn small" onClick={() => setImportOpen((open) => !open)}>{labels.importTitle}</button>
          <button type="button" className="primary-btn small" onClick={() => { setFormOpen((open) => !open); setFormMessage(''); setFormError(''); setPotentialMatches([]); setReviewedMatches([]); setConfirmMatchRequired(false) }}>
            {formOpen ? labels.close : labels.add}
          </button>
        </div>
      </div>

      <aside className="registry-privacy-notice" aria-label={labels.privacyTitle}>
        <strong>{labels.privacyTitle}</strong>
        <p>{labels.privacyNotice}</p>
      </aside>
      {exportError && <p className="registry-message error" role="alert">{exportError}</p>}
      {exportMessage && <p className="registry-message" role="status">{exportMessage}</p>}

      <form className="registry-filters" onSubmit={(event) => {
        event.preventDefault()
        if (searchDebounceRef.current !== null) {
          window.clearTimeout(searchDebounceRef.current)
          searchDebounceRef.current = null
        }
        setPage(1)
        setDebounced({
          search: search.trim(),
          birthDate,
          age,
          zone,
        })
      }}>
        <label>{labels.search}
          <input value={search} maxLength={120} onChange={(event) => { setSearch(event.target.value); setResidentDetailsId(null) }} placeholder={labels.searchHint} />
        </label>
        <label>{labels.birthDate}
          <input type="date" value={birthDate} onChange={(event) => { setBirthDate(event.target.value); setResidentDetailsId(null) }} />
        </label>
        <label>{labels.age}
          <input type="number" min="0" max="130" value={age} onChange={(event) => { setAge(event.target.value); setResidentDetailsId(null) }} />
        </label>
        <label>{labels.zone}
          <select value={zone} onChange={(event) => { setZone(event.target.value); setResidentDetailsId(null) }}>
            <option value="">{labels.allZones}</option>
            {[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}
          </select>
        </label>
        <div className="registry-row-actions registry-filter-actions">
          <button type="submit" className="primary-btn small">{labels.searchButton}</button>
          <button type="button" className="secondary-btn small" onClick={() => {
            if (searchDebounceRef.current !== null) {
              window.clearTimeout(searchDebounceRef.current)
              searchDebounceRef.current = null
            }
            setSearch('')
            setBirthDate('')
            setAge('')
            setZone('')
            setPage(1)
            setDebounced({ search: '', birthDate: '', age: '', zone: '' })
            setResidentDetailsId(null)
          }}>{labels.clearSearch}</button>
        </div>
      </form>

      <section className="registry-source-reviews" aria-labelledby="registry-source-review-title">
        <div className="registry-source-review-heading">
          <div>
            <h3 id="registry-source-review-title">{labels.sourceReviewTitle}</h3>
            <p>{labels.sourceReviewHelp}</p>
          </div>
        </div>
        {sourceReviewError && <p className="registry-message error" role="alert">{sourceReviewError}</p>}
        {sourceReviews.length ? (
          <ul className="registry-source-review-list">
            {sourceReviews.map((review) => (
              <li key={review.id}>
                <div><strong><span className="registry-warning-icon" aria-hidden="true">⚠</span> {review.purok}{review.zone ? ` · Zone ${review.zone}` : ''}</strong><small>{labels.sourceReviewAttention}</small></div>
                <button type="button" className="secondary-btn small" disabled={sourceReviewBusy} onClick={() => resolveSourceReview(review)}>{labels.sourceReviewResolve}</button>
              </li>
            ))}
          </ul>
        ) : !sourceReviewError && <p className="registry-source-review-empty">{labels.sourceReviewNone}</p>}
        {sourceReviewMessage && <p className="registry-message" role="status">{sourceReviewMessage}</p>}
        <form className="registry-source-review-form" onSubmit={openSourceReview}>
          <label>{labels.sourceReviewLocation}<input value={sourceReviewPurok} maxLength={100} onChange={(event) => setSourceReviewPurok(event.target.value)} required /></label>
          <label>{labels.zone}<select value={sourceReviewZone} onChange={(event) => setSourceReviewZone(event.target.value)}><option value="">{labels.unassigned}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
          <button type="submit" className="secondary-btn small" disabled={!sourceReviewPurok.trim() || sourceReviewBusy}>{labels.sourceReviewOpen}</button>
        </form>
      </section>

      {importOpen && (
        <section className="registry-import" aria-label={labels.importTitle}>
          <h3>{labels.importTitle}</h3>
          <p>{labels.importHelp}</p>
          <div className="registry-import-controls">
            <label>{labels.chooseCsv}<input type="file" accept=".csv,text/csv" onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              previewImport(file)
            }} disabled={importPreviewBusy || importBusy || importMatches.length > 0} /></label>
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
                      <td>{resident.zone ? `${labels.zone} ${resident.zone}` : labels.unassigned}</td>
                      <td>{resident.household || resident.householdId || labels.unassigned}</td>
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
                <button type="button" className="primary-btn small" disabled={importBusy} onClick={() => submitImport(true)}>{labels.confirmImport}</button>
                <button type="button" className="secondary-btn small" disabled={importBusy} onClick={() => { setImportMatches([]); setImportReviewedMatches([]); setImportRows([]); setImportFile(null) }}>{labels.cancelAdd}</button>
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
          <label>{labels.sex}<select value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value }))} required><option value="">{labels.selectSex}</option><option value="Male">{labels.maleOption}</option><option value="Female">{labels.femaleOption}</option></select></label>
          <label>{labels.household}<input value={form.household} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, household: event.target.value }))} /></label>
          <label>{labels.zone}<select value={form.zone} onChange={(event) => setForm((current) => ({ ...current, zone: event.target.value }))}><option value="">{labels.unassigned}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
          <label>{labels.maritalStatus}<select value={form.maritalStatus} onChange={(event) => setForm((current) => ({ ...current, maritalStatus: event.target.value }))}><option value="">{labels.optional}</option>{maritalStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label>{labels.occupation}<input value={form.occupation} maxLength={255} onChange={(event) => setForm((current) => ({ ...current, occupation: event.target.value }))} /></label>
          <label>{labels.sourceRef}<input value={form.sourceReference} maxLength={255} onChange={(event) => setForm((current) => ({ ...current, sourceReference: event.target.value }))} /></label>
          <label>{labels.sourceFile}<input value={form.sourceFilename} maxLength={255} onChange={(event) => setForm((current) => ({ ...current, sourceFilename: event.target.value }))} /></label>
          {formError && <p className="registry-message error" role="alert">{formError}</p>}
          {formMessage && <p className="registry-message" role="status">{formMessage}</p>}
          {potentialMatches.length > 0 && (
            <div className="registry-message warning" role="alert">
              <strong>{labels.duplicate}</strong>
              <ul>{potentialMatches.map((match) => <li key={match.id}>{match.firstName} {match.lastName} · {formatDate(match.birthDate, language) || labels.noDob} · {match.zone ? `Zone ${match.zone}` : labels.unassigned} · {match.verificationStatus === 'verified' ? labels.verified : match.verificationStatus === 'needs_review' ? labels.needsReview : labels.pending}</li>)}</ul>
              {confirmMatchRequired && <div className="registry-row-actions"><button type="button" className="primary-btn small" disabled={formBusy} onClick={() => saveResident(null, true)}>{labels.confirmAdd}</button><button type="button" className="secondary-btn small" disabled={formBusy} onClick={() => { setConfirmMatchRequired(false); setPotentialMatches([]) }}>{labels.cancelAdd}</button></div>}
            </div>
          )}
          <button type="submit" className="primary-btn" disabled={!formValid || formBusy}>{formBusy ? labels.saving : labels.save}</button>
        </form>
      )}

      {error && <p className="registry-message error" role="alert">{error}</p>}
      {demographicsError && <p className="registry-message error" role="alert">{demographicsError}</p>}
      <p className="registry-zone-help">{labels.zoneCardHelp}</p>
      <div className="registry-zone-cards" role="group" aria-label={labels.zoneTabLabel}>
        {[1, 2, 3, 4, 5, 6, 7].map((number) => {
          const value = String(number)
          const zoneResidents = demographics?.byPurok
            ?.filter((group) => Number(group.zone) === number)
            .reduce((sum, group) => sum + Number(group.total || 0), 0) || 0
          const hasSearchMatch = matchedZones.has(value)
          return (
            <button
              key={value}
              type="button"
              className={`registry-zone-card${hasSearchMatch ? ' is-search-match' : ''}`}
              aria-label={`${labels.zone} ${number}: ${zoneResidents} ${labels.zoneResidentCount}${hasSearchMatch ? `, ${labels.searchMatchZone}` : ''}`}
              onClick={() => {
                setZone(value)
                setSelectedZone(value)
                setResidentDetailsId(null)
                setPage(1)
                setEditResident(null)
              }}
            >
              <strong>{labels.zone} {number}</strong>
              <span>{zoneResidents}</span>
              <small>{labels.zoneResidentCount}</small>
              {hasSearchMatch && <small className="registry-zone-match-label">{labels.searchMatchZone}</small>}
            </button>
          )
        })}
      </div>
      {hasActiveFilters && !selectedZone && (
        <section className="registry-search-results" aria-labelledby="registry-search-results-title">
          <h3 id="registry-search-results-title">{labels.searchResultsTitle}</h3>
          {queryPending || loading ? (
            <p className="registry-message" role="status" aria-live="polite">{labels.loading}</p>
          ) : records.length ? (
            <>
              <p>{total} {labels.residents}</p>
              <div className="registry-table-wrap">
                <table className="registry-table registry-search-results-table">
                  <thead><tr><th scope="col">{labels.name}</th><th scope="col">{labels.birthAndAge}</th><th scope="col">{labels.household}</th><th scope="col">{labels.location}</th></tr></thead>
                  <tbody>{records.map((resident) => {
                    const residentName = [resident.firstName, resident.lastName].filter(Boolean).join(' ') || labels.name
                    const detailsOpen = residentDetailsId === resident.id
                    return (
                      <Fragment key={resident.id}>
                        <tr>
                          <td><button type="button" className="registry-resident-link" aria-expanded={detailsOpen} onClick={() => setResidentDetailsId(detailsOpen ? null : resident.id)}>{residentName}</button></td>
                          <td>{formatDate(resident.birthDate, language) || labels.noDob} · {resident.age === null || resident.age === undefined ? labels.noDob : resident.age}</td>
                          <td>{resident.household || resident.householdId || labels.unassigned}</td>
                          <td>{resident.zone ? `${labels.zone} ${resident.zone}` : labels.unassigned}</td>
                        </tr>
                        {detailsOpen && <tr key={`${resident.id}-details`}><td colSpan={4}><ResidentDetails resident={resident} labels={labels} language={language} /></td></tr>}
                      </Fragment>
                    )
                  })}</tbody>
                </table>
              </div>
              <div className="registry-pagination">
                <span>{labels.page} {page} {labels.of} {maxPage} · {total}</span>
                <div>
                  <button type="button" className="secondary-btn small" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>{labels.previous}</button>
                  <button type="button" className="secondary-btn small" disabled={page >= maxPage || loading} onClick={() => setPage((current) => current + 1)}>{labels.next}</button>
                </div>
              </div>
            </>
          ) : (
            <p className="registry-message">{labels.noRecords}</p>
          )}
        </section>
      )}
      {(loading || (selectedZone && queryPending)) && <p className="registry-message" role="status" aria-live="polite">{labels.loading}</p>}
      {selectedZone && (
        <dialog
          ref={residentDialogRef}
          className="registry-resident-modal registry-zone-modal"
          aria-labelledby="registry-zone-modal-title"
          onCancel={(event) => { event.preventDefault(); residentDialogRef.current?.close() }}
          onClose={() => {
            setSelectedZone('')
            setZone('')
            setEditResident(null)
            setEditForm(null)
          }}
          onClick={(event) => { if (event.target === event.currentTarget) residentDialogRef.current?.close() }}
        >
          <div className="registry-resident-modal-heading">
            <div><h3 id="registry-zone-modal-title">{labels.zone} {selectedZone}</h3>{editResident && <p>{labels.editResident}</p>}</div>
            <button ref={closeResidentDialogRef} type="button" className="secondary-btn small" onClick={() => {
              if (editResident) {
                setEditResident(null)
                setEditForm(null)
                setEditError('')
              } else {
                residentDialogRef.current?.close()
              }
            }}>{editResident ? labels.cancelEdit : labels.closeZone}</button>
          </div>
          {editResident && editForm ? (
            <form className="registry-entry-form registry-edit-form" onSubmit={saveResidentEdit}>
              <p className="registry-field-help">{labels.hiddenNameHint}</p>
              <label>{labels.firstName}<input value={editForm.firstName} maxLength={100} placeholder="••••••••" onChange={(event) => setEditForm((current) => ({ ...current, firstName: event.target.value }))} /></label>
              <label>{labels.lastName}<input value={editForm.lastName} maxLength={100} placeholder="••••••••" onChange={(event) => setEditForm((current) => ({ ...current, lastName: event.target.value }))} /></label>
              <label>{labels.birthDate}<input type="date" max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} value={editForm.birthDate} onChange={(event) => setEditForm((current) => ({ ...current, birthDate: event.target.value }))} /></label>
              <label>{labels.sex}<select value={editForm.sex} onChange={(event) => setEditForm((current) => ({ ...current, sex: event.target.value }))}><option value="">{labels.selectSex}</option><option value="Male">{labels.maleOption}</option><option value="Female">{labels.femaleOption}</option></select></label>
              <label>{labels.household}<input value={editForm.household} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, household: event.target.value }))} /></label>
              <label>{labels.zone}<select value={editForm.zone} onChange={(event) => setEditForm((current) => ({ ...current, zone: event.target.value }))}><option value="">{labels.unassigned}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
              <label>{labels.maritalStatus}<select value={editForm.maritalStatus} onChange={(event) => setEditForm((current) => ({ ...current, maritalStatus: event.target.value }))}><option value="">{labels.optional}</option>{maritalStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
              <label>{labels.occupation}<input value={editForm.occupation} maxLength={255} onChange={(event) => setEditForm((current) => ({ ...current, occupation: event.target.value }))} /></label>
              <label>{labels.sourceRef}<input value={editForm.sourceReference} maxLength={255} onChange={(event) => setEditForm((current) => ({ ...current, sourceReference: event.target.value }))} /></label>
              <label>{labels.sourceFile}<input value={editForm.sourceFilename} maxLength={255} onChange={(event) => setEditForm((current) => ({ ...current, sourceFilename: event.target.value }))} /></label>
              <label>{labels.status}<select value={editForm.verificationStatus} onChange={(event) => setEditForm((current) => ({ ...current, verificationStatus: event.target.value }))}><option value="pending">{labels.pending}</option><option value="verified">{labels.verified}</option><option value="needs_review">{labels.needsReview}</option></select></label>
              <label>{labels.recordStatus}<select value={editForm.status} onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}><option value="active">{labels.active}</option><option value="inactive">{labels.inactive}</option><option value="deceased">{labels.deceased}</option><option value="archived">{labels.archived}</option></select></label>
              {editError && <p className="registry-message error" role="alert">{editError}</p>}
              <div className="registry-row-actions registry-edit-actions">
                <button type="submit" className="primary-btn small" disabled={editBusy}>{editBusy ? labels.saving : labels.saveChanges}</button>
                <button type="button" className="secondary-btn small" disabled={editBusy} onClick={() => { setEditResident(null); setEditForm(null); setEditError('') }}>{labels.cancelEdit}</button>
              </div>
            </form>
          ) : (
            <>
              {editMessage && <p className="registry-message" role="status">{editMessage}</p>}
              {loading ? <p className="registry-message" role="status">{labels.loading}</p> : records.length ? (
                <div className="registry-zone-resident-list">
                  {records.map((resident) => {
                    const residentName = [resident.firstName, resident.lastName].filter(Boolean).join(' ') || labels.name
                    return (
                      <article key={resident.id} className="registry-zone-resident">
                        <div>
                          <button type="button" className="registry-resident-link" aria-expanded={residentDetailsId === resident.id} onClick={() => setResidentDetailsId(residentDetailsId === resident.id ? null : resident.id)}>{residentName}</button>
                          <span>{formatDate(resident.birthDate, language) || labels.noDob} · {resident.age === null ? labels.noDob : `${resident.age}`}</span>
                          {resident.zone && <small>{labels.zone} {resident.zone}</small>}
                          {residentDetailsId === resident.id && <ResidentDetails resident={resident} labels={labels} language={language} />}
                        </div>
                        <button type="button" className="secondary-btn small" onClick={() => beginResidentEdit(resident)}>{labels.editRecord}</button>
                      </article>
                    )
                  })}
                  <div className="registry-pagination">
                    <span>{labels.page} {page} {labels.of} {maxPage} · {total}</span>
                    <div><button type="button" className="secondary-btn small" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>{labels.previous}</button><button type="button" className="secondary-btn small" disabled={page >= maxPage || loading} onClick={() => setPage((current) => current + 1)}>{labels.next}</button></div>
                  </div>
                </div>
              ) : !loading && <p className="registry-message">{labels.noZoneRecords}</p>}
            </>
          )}
        </dialog>
      )}
    </section>
  )
}
