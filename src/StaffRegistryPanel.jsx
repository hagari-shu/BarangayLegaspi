import { useEffect, useMemo, useState } from 'react'
import { parseRegistryCsv, registryCsvTemplate } from './registry-csv'
import './StaffRegistryPanel.css'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')

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
    privacyNotice: 'Use these records only for authorized barangay duties. Enter only information needed from an official source; leave unknown fields blank. Do not share screenshots or exports outside approved work. New entries stay pending, and resident, import, verification, status, and source-warning changes are recorded in the audit log.',
    search: 'Search full name',
    searchAction: 'Search',
    birthDate: 'Exact birthdate',
    age: 'Exact age',
    zone: 'Zone',
    allZones: 'All zones',
    selectZone: 'View zone',
    searchMatch: 'has search matches',
    zoneResidents: 'Residents by zone',
    selectZoneHelp: 'Choose a zone to browse its resident records, or search by name.',
    clearZone: 'All zones',
    details: 'Resident details',
    edit: 'Edit record',
    saveChanges: 'Save changes',
    cancelEdit: 'Cancel',
    maritalStatus: 'Marital status',
    occupation: 'Occupation',
    noDetails: 'Not recorded',
    household: 'Household',
    residents: 'Matching records',
    total: 'Verified population',
    male: 'Male',
    female: 'Female',
    unclassified: 'Unclassified sex',
    households: 'Households',
    byPurok: 'Population by zone',
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
    householdId: 'Household',
    sourceRef: 'Source record reference',
    sourceFile: 'Source filename',
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
    privacyNotice: 'Gamitin lamang ang mga tala para sa awtorisadong tungkulin ng barangay. Ilagay lamang ang impormasyong kailangan mula sa opisyal na sanggunian; iwang blangko ang hindi alam. Huwag magbahagi ng screenshot o kopya sa labas ng aprubadong gawain. Mananatiling pending ang mga bagong tala, at itinatala sa audit log ang pagbabago ng resident, import, beripikasyon, status, at source-warning.',
    search: 'Hanapin ang buong pangalan',
    searchAction: 'Maghanap',
    birthDate: 'Eksaktong petsa ng kapanganakan',
    age: 'Eksaktong edad',
    zone: 'Zone',
    allZones: 'Lahat ng zone',
    selectZone: 'Tingnan ang zone',
    searchMatch: 'may katugma sa paghahanap',
    zoneResidents: 'Mga residente ayon sa zone',
    selectZoneHelp: 'Pumili ng zone upang makita ang mga tala, o maghanap ayon sa pangalan.',
    clearZone: 'Lahat ng zone',
    details: 'Detalye ng residente',
    edit: 'I-edit ang tala',
    saveChanges: 'I-save ang mga pagbabago',
    cancelEdit: 'Kanselahin',
    maritalStatus: 'Katayuan sa pag-aasawa',
    occupation: 'Trabaho',
    noDetails: 'Hindi naitala',
    residents: 'Mga katugmang tala',
    total: 'Beripikadong populasyon',
    male: 'Lalaki',
    female: 'Babae',
    unclassified: 'Hindi natukoy na kasarian',
    households: 'Mga sambahayan',
    byPurok: 'Populasyon ayon sa zone',
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
    householdId: 'Sambahayan',
    sourceRef: 'Sanggunian ng pinagmulang tala',
    sourceFile: 'Pangalan ng source file',
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
  const [appliedSearch, setAppliedSearch] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [age, setAge] = useState('')
  const [zone, setZone] = useState('')
  const [debounced, setDebounced] = useState({ search: '', birthDate: '', age: '', zone: '' })
  const [records, setRecords] = useState([])
  const [selectedResidentId, setSelectedResidentId] = useState('')
  const [editForm, setEditForm] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
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
  const [refreshKey, setRefreshKey] = useState(0)
  const [form, setForm] = useState({
    firstName: '', lastName: '', birthDate: '', sex: '', householdId: '', maritalStatus: '', occupation: '', zone: '', sourceReference: '', sourceFilename: '',
  })

  const formValid = useMemo(() => form.firstName.trim() && form.lastName.trim(), [form.firstName, form.lastName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setDebounced({ search: appliedSearch, birthDate, age, zone })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [appliedSearch, birthDate, age, zone])

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
    const demographicParams = new URLSearchParams()
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

  const startResidentEdit = (resident) => {
    setEditForm({
      firstName: resident.firstName || '',
      lastName: resident.lastName || '',
      birthDate: resident.birthDate || '',
      sex: resident.sex === 'Unclassified' ? '' : resident.sex || '',
      householdId: resident.householdId || '',
      maritalStatus: resident.maritalStatus || '',
      occupation: resident.occupation || '',
      zone: resident.zone ? String(resident.zone) : '',
    })
    setEditError('')
  }

  const saveResidentEdit = async (event) => {
    event.preventDefault()
    setEditBusy(true)
    setEditError('')
    try {
      const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(selectedResidentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          birthDate: editForm.birthDate || null,
          sex: editForm.sex || 'Unclassified',
          householdId: editForm.householdId.trim() || null,
          maritalStatus: editForm.maritalStatus.trim() || null,
          occupation: editForm.occupation.trim() || null,
          zone: editForm.zone || null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.loadError)
      setEditForm(null)
      setRefreshKey((current) => current + 1)
    } catch (saveError) {
      console.error('update resident registry record failed', saveError)
      setEditError(saveError.message || labels.loadError)
    } finally {
      setEditBusy(false)
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
          householdId: form.householdId.trim() || null,
          maritalStatus: form.maritalStatus.trim() || null,
          occupation: form.occupation.trim() || null,
          zone: form.zone || null,
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
      setForm({ firstName: '', lastName: '', birthDate: '', sex: '', householdId: '', maritalStatus: '', occupation: '', zone: '', sourceReference: '', sourceFilename: '' })
      setPage(1)
      setRefreshKey((current) => current + 1)
      setSearch('')
      setAppliedSearch('')
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

  const count = demographics?.overall || { total: 0, male: 0, female: 0, unclassified: 0, households: 0 }
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const selectedResident = records.find((resident) => resident.id === selectedResidentId)
  const hasRegistryFilter = Boolean(appliedSearch || birthDate || age !== '' || zone)
  const zoneSummaries = Array.from({ length: 7 }, (_, index) => {
    const number = index + 1
    const groups = demographics?.byPurok?.filter((group) => Number(group.zone) === number) || []
    return {
      zone: number,
      residents: groups.reduce((sum, group) => sum + group.total, 0),
      households: new Set((demographics?.byHousehold || [])
        .filter((group) => Number(group.zone) === number)
        .map((group) => group.householdId)).size,
      hasMatch: Boolean(appliedSearch && records.some((resident) => Number(resident.zone) === number)),
    }
  })

  return (
    <section className="registry-panel" aria-labelledby="resident-registry-title">
      <div className="registry-panel-header">
        <div>
          <h2 id="resident-registry-title">{labels.title}</h2>
          <p>{labels.subtitle}</p>
        </div>
        <div className="registry-row-actions registry-toolbar-actions">
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
                  <thead><tr><th scope="col">{labels.name}</th><th scope="col">{labels.birthAndAge}</th><th scope="col">{labels.location}</th><th scope="col">{labels.household}</th><th scope="col">{labels.maritalStatus}</th><th scope="col">{labels.occupation}</th></tr></thead>
                  <tbody>{importRows.slice(0, 10).map((resident, index) => (
                    <tr key={`${index}-${resident.firstName}-${resident.lastName}`}>
                      <td>{resident.firstName} {resident.lastName}</td>
                      <td>{resident.birthDate || labels.noDob}</td>
                      <td>{resident.zone ? `Zone ${resident.zone}` : labels.unassigned}</td>
                      <td>{resident.householdId || labels.unassigned}</td>
                      <td>{resident.maritalStatus || labels.noDetails}</td>
                      <td>{resident.occupation || labels.noDetails}</td>
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
          <label>{labels.sex}<select value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value }))}><option value="">{labels.selectSex}</option><option value="Male">{labels.maleOption}</option><option value="Female">{labels.femaleOption}</option><option value="Unclassified">{labels.unclassifiedOption}</option></select></label>
          <label>{labels.householdId}<input value={form.householdId} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, householdId: event.target.value }))} /></label>
          <label>{labels.zone}<select value={form.zone} onChange={(event) => setForm((current) => ({ ...current, zone: event.target.value }))}><option value="">{labels.unassigned}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
          <label>{labels.maritalStatus}<input value={form.maritalStatus} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, maritalStatus: event.target.value }))} /></label>
          <label>{labels.occupation}<input value={form.occupation} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, occupation: event.target.value }))} /></label>
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

      <form className="registry-filters" aria-label={labels.title} onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim()); setPage(1) }}>
        <label>{labels.search}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>{labels.birthDate}<input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
        <label>{labels.age}<input type="number" min="0" max="130" inputMode="numeric" value={age} onChange={(event) => setAge(event.target.value)} /></label>
        <label>{labels.zone}<select value={zone} onChange={(event) => setZone(event.target.value)}><option value="">{labels.allZones}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
        <button type="submit" className="primary-btn small">{labels.searchAction}</button>
      </form>
      {age !== '' && (!/^\d+$/.test(age) || Number(age) > 130) && <p className="registry-message error" role="alert">{labels.invalidSearch}</p>}

      {error && <p className="registry-message error" role="alert">{error}</p>}
      <div className="registry-summary-grid" aria-label={labels.total}>
        <article><span>{labels.total}</span><strong>{count.total}</strong></article>
        <article><span>{labels.male}</span><strong>{count.male}</strong></article>
        <article><span>{labels.female}</span><strong>{count.female}</strong></article>
        <article><span>{labels.unclassified}</span><strong>{count.unclassified}</strong></article>
        <article><span>{labels.households}</span><strong>{count.households}</strong></article>
      </div>

      <section className="registry-zone-section" aria-labelledby="registry-zones-title">
        <div className="registry-zone-heading">
          <div><h3 id="registry-zones-title">{labels.zoneResidents}</h3><p>{labels.selectZoneHelp}</p></div>
          {zone && <button type="button" className="secondary-btn small" onClick={() => setZone('')}>{labels.clearZone}</button>}
        </div>
        <div className="registry-zone-grid">
          {zoneSummaries.map((summary) => (
            <button
              type="button"
              key={summary.zone}
              className={`registry-zone-card${zone === String(summary.zone) ? ' is-selected' : ''}${summary.hasMatch ? ' has-match' : ''}`}
              aria-pressed={zone === String(summary.zone)}
              aria-label={`${labels.zone} ${summary.zone}, ${summary.residents} ${labels.total.toLowerCase()}${summary.hasMatch ? `, ${labels.searchMatch}` : ''}`}
              onClick={() => { setZone(String(summary.zone)); setPage(1) }}
            >
              <span>Zone {summary.zone}</span>
              <strong>{summary.residents}</strong>
              <small>{labels.total} · {summary.households} {labels.households.toLowerCase()}</small>
            </button>
          ))}
        </div>
      </section>

      {loading && <p className="registry-message" role="status" aria-live="polite">{labels.loading}</p>}
      {!loading && !error && hasRegistryFilter && records.length === 0 && <p className="registry-message" role="status">{labels.noRecords}</p>}
      {hasRegistryFilter && records.length > 0 && (
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead><tr><th scope="col">{labels.name}</th><th scope="col">{labels.birthAndAge}</th><th scope="col">{labels.location}</th><th scope="col">{labels.household}</th><th scope="col">{labels.status}</th><th scope="col">{labels.recordStatus}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{records.map((resident) => (
              <tr key={resident.id}>
                <td><button type="button" className="registry-name-button" aria-expanded={selectedResidentId === resident.id} onClick={() => { setSelectedResidentId((current) => current === resident.id ? '' : resident.id); setEditForm(null); setEditError('') }}>{resident.firstName} {resident.lastName}</button><small>{resident.sex || labels.unclassifiedOption}</small></td>
                <td>{formatDate(resident.birthDate, language) || labels.noDob}<small>{resident.age === null ? labels.noDob : `${resident.age}`}</small></td>
                <td>{resident.zone ? `Zone ${resident.zone}` : labels.unassigned}</td>
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
      {selectedResident && hasRegistryFilter && (
        <aside className="registry-resident-details" aria-label={labels.details}>
          <div className="registry-zone-heading">
            <h3>{labels.details}: {selectedResident.firstName} {selectedResident.lastName}</h3>
            <button type="button" className="secondary-btn small" onClick={() => editForm ? setEditForm(null) : startResidentEdit(selectedResident)}>
              {editForm ? labels.cancelEdit : labels.edit}
            </button>
          </div>
          {editForm ? (
            <form className="registry-entry-form" onSubmit={saveResidentEdit}>
              <label>{labels.firstName}<input value={editForm.firstName} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, firstName: event.target.value }))} required /></label>
              <label>{labels.lastName}<input value={editForm.lastName} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, lastName: event.target.value }))} required /></label>
              <label>{labels.birthDate}<input type="date" value={editForm.birthDate} onChange={(event) => setEditForm((current) => ({ ...current, birthDate: event.target.value }))} /></label>
              <label>{labels.sex}<select value={editForm.sex} onChange={(event) => setEditForm((current) => ({ ...current, sex: event.target.value }))}><option value="">{labels.selectSex}</option><option value="Male">{labels.maleOption}</option><option value="Female">{labels.femaleOption}</option><option value="Unclassified">{labels.unclassifiedOption}</option></select></label>
              <label>{labels.household}<input value={editForm.householdId} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, householdId: event.target.value }))} /></label>
              <label>{labels.zone}<select value={editForm.zone} onChange={(event) => setEditForm((current) => ({ ...current, zone: event.target.value }))}><option value="">{labels.unassigned}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
              <label>{labels.maritalStatus}<input value={editForm.maritalStatus} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, maritalStatus: event.target.value }))} /></label>
              <label>{labels.occupation}<input value={editForm.occupation} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, occupation: event.target.value }))} /></label>
              {editError && <p className="registry-message error" role="alert">{editError}</p>}
              <button type="submit" className="primary-btn" disabled={editBusy || !editForm.firstName.trim() || !editForm.lastName.trim()}>{editBusy ? labels.saving : labels.saveChanges}</button>
            </form>
          ) : (
            <dl>
              <div><dt>{labels.maritalStatus}</dt><dd>{selectedResident.maritalStatus || labels.noDetails}</dd></div>
              <div><dt>{labels.occupation}</dt><dd>{selectedResident.occupation || labels.noDetails}</dd></div>
              <div><dt>{labels.household}</dt><dd>{selectedResident.householdId || labels.noDetails}</dd></div>
              <div><dt>{labels.location}</dt><dd>{selectedResident.zone ? `Zone ${selectedResident.zone}` : labels.unassigned}</dd></div>
            </dl>
          )}
        </aside>
      )}
    </section>
  )
}
