import { useEffect, useMemo, useRef, useState } from 'react'
import { parseRegistryCsv, registryCsvTemplate } from './registry-csv'
import { createRegistryPrintHtml, writePrintWindow } from './registry-printing'
import './StaffRegistryPanel.css'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')

const text = {
  en: {
    title: 'Resident and household registry',
    subtitle: 'Restricted staff workspace. Browse residents by assigned zone.',
    zoneDirectoryTitle: 'Residents by zone',
    zoneDirectoryHelp: 'Choose Zone 1–7 to view its assigned residents.',
    zoneResidentsTitle: 'Residents in Zone',
    assignedResidents: 'assigned residents',
    zoneResidentsEmpty: 'No resident records are assigned to this zone yet.',
    printZoneRoster: 'Print zone roster',
    printZoneSheets: 'Print individual sheets',
    printResident: 'Print resident sheet',
    printFamilyRoster: 'Print family roster',
    printFamilySheets: 'Print family sheets',
    selectedForPrint: 'selected for printing',
    clearSelection: 'Clear selection',
    printSelectedRoster: 'Print selected roster',
    printSelectedSheets: 'Print selected sheets',
    selectedBatchTitle: 'Selected resident batch',
    selectResidentForPrint: 'Select resident for printing',
    selectPageForPrint: 'Select all residents on this page',
    printLoading: 'Preparing printout…',
    printError: 'Unable to prepare the registry printout.',
    popupBlocked: 'Allow pop-ups for this site to open the print view.',
    noFamilyId: 'No household ID is recorded for this resident.',
    printResidents: 'residents',
    printGenerated: 'Printed',
    printConfidential: 'Personal information — authorized barangay use only. Do not share this printout outside approved work.',
    zoneCountsError: 'Unable to load zone totals.',
    editResident: 'Edit resident',
    saveChanges: 'Save changes',
    editSaved: 'Resident information updated.',
    editError: 'Unable to update resident information.',
    maritalStatus: 'Marital status',
    chooseMaritalStatus: 'Choose if known',
    single: 'Single',
    married: 'Married',
    widowed: 'Widowed',
    legallySeparated: 'Legally separated',
    annulled: 'Annulled',
    occupation: 'Occupation',
    chooseOccupation: 'Choose or type an occupation',
    student: 'Student',
    governmentEmployee: 'Government employee',
    privateEmployee: 'Private employee',
    selfEmployed: 'Self-employed',
    farmer: 'Farmer',
    homemaker: 'Homemaker',
    unemployed: 'Unemployed',
    otherOccupation: 'Other',
    customOccupation: 'Type occupation',
    optional: 'Optional',
    required: 'Required',
    addFamily: 'Add resident(s)',
    familyStepHousehold: 'Household',
    familyStepMembers: 'Family members',
    familyStepReview: 'Review',
    familyZoneRequired: 'Choose a zone before adding this household.',
    familyAddMember: 'Add another family member',
    familyRemoveMember: 'Remove',
    familyMember: 'Family member',
    familySubmit: 'Save family records',
    familySaved: 'Family records saved as pending verification.',
    familySaveError: 'Unable to save family records.',
    familyReviewMatches: 'Possible matches found. Review the existing records before continuing.',
    familyContinueAnyway: 'Confirm after reviewing matches',
    familyHouseholdId: 'Household ID',
    familyAddress: 'Address or location description',
    familyStepNext: 'Next',
    familyStepBack: 'Back',
    familyReviewHelp: 'Check the household zone and each family member before saving.',
    familyPrivacy: 'Only names and zone are required. Add other details only when available from an official source.',
    searchAutofill: 'Exact match found. Birthdate and zone were filled from the registry.',
    searchNoMatch: 'No exact full-name match found yet.',
    searchChooseMatch: 'Several residents share this full name. Choose the correct record.',
    searchResultsHelp: 'Choose a resident to fill their birthdate and zone.',
    openZone: 'View residents',
    sexOptional: 'Sex (optional)',
    manualOccupation: 'Type an occupation instead',
    incompleteTitle: 'Incomplete resident information',
    incompleteHelp: 'Review records marked incomplete here. They stay outside the Zone 1–7 resident lists until staff finishes checking the information.',
    incompleteCount: 'records need information review',
    incompleteOpen: 'View incomplete records',
    incompleteClose: 'Hide incomplete records',
    incompleteLoading: 'Loading records for review…',
    incompleteLoadError: 'Unable to load incomplete resident records.',
    incompleteEmpty: 'No resident records are waiting for information review.',
    incompletePage: 'Page {page} of {pages}',
    markInformationComplete: 'Information complete — send to verification',
    confirmInformationComplete: 'Confirm the record has been checked and its available information is complete. It will move to the verification queue.',
    informationReady: 'Record moved to the verification queue.',
    verificationQueue: 'Ready for verification',
    verificationQueueHelp: 'Review the source record, then mark the resident verified.',
    privacyTitle: 'Personal information — authorized use only',
    privacyNotice: 'Use these records only for authorized barangay duties. Enter only information needed from an official source; leave unknown fields blank. Do not share screenshots or exports outside approved work. New entries stay pending, and resident, import, verification, review-status, and record-status changes are recorded in the audit log.',
    search: 'Search full name',
    birthDate: 'Exact birthdate',
    zone: 'Zone',
    allZones: 'All zones',
    residents: 'Matching records',
    male: 'Male',
    female: 'Female',
    name: 'Resident',
    birthAndAge: 'Birthdate / age',
    location: 'Purok / zone',
    household: 'Household',
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
    loading: 'Loading resident records…',
    loadError: 'Unable to load the staff registry.',
    add: 'Add a resident for verification',
    firstName: 'First name',
    lastName: 'Last name',
    sex: 'Sex',
    maleOption: 'Male',
    femaleOption: 'Female',
    householdId: 'Household identifier',
    address: 'Address / location description',
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
    subtitle: 'Limitado sa awtorisadong kawani. Tingnan ang mga residente ayon sa nakatalagang zone.',
    zoneDirectoryTitle: 'Mga residente ayon sa zone',
    zoneDirectoryHelp: 'Pumili ng Zone 1–7 upang makita ang mga residenteng nakatalaga rito.',
    zoneResidentsTitle: 'Mga residente sa Zone',
    assignedResidents: 'residenteng nakatalaga',
    zoneResidentsEmpty: 'Wala pang residenteng nakatalaga sa zone na ito.',
    printZoneRoster: 'I-imprenta ang talaan ng zone',
    printZoneSheets: 'I-imprenta ang indibidwal na tala',
    printResident: 'I-imprenta ang tala ng residente',
    printFamilyRoster: 'I-imprenta ang talaan ng pamilya',
    printFamilySheets: 'I-imprenta ang mga tala ng pamilya',
    selectedForPrint: 'napili para i-imprenta',
    clearSelection: 'Alisin ang napili',
    printSelectedRoster: 'I-imprenta ang napiling talaan',
    printSelectedSheets: 'I-imprenta ang mga napiling tala',
    selectedBatchTitle: 'Napiling batch ng residente',
    selectResidentForPrint: 'Piliin ang residente para i-imprenta',
    selectPageForPrint: 'Piliin ang lahat ng residente sa pahinang ito',
    printLoading: 'Inihahanda ang imprenta…',
    printError: 'Hindi naihanda ang imprenta ng registry.',
    popupBlocked: 'Payagan ang pop-up ng site na ito upang buksan ang pahina ng imprenta.',
    noFamilyId: 'Walang nakatalang household ID para sa residenteng ito.',
    printResidents: 'residente',
    printGenerated: 'Inimprenta',
    printConfidential: 'Personal na impormasyon — para lamang sa awtorisadong gamit ng barangay. Huwag ibahagi sa labas ng aprubadong gawain.',
    zoneCountsError: 'Hindi makuha ang bilang ng bawat zone.',
    editResident: 'I-edit ang residente',
    saveChanges: 'I-save ang mga pagbabago',
    editSaved: 'Na-update ang impormasyon ng residente.',
    editError: 'Hindi ma-update ang impormasyon ng residente.',
    maritalStatus: 'Katayuang sibil',
    chooseMaritalStatus: 'Pumili kung alam',
    single: 'Walang asawa',
    married: 'May asawa',
    widowed: 'Balo',
    legallySeparated: 'Legal na hiwalay',
    annulled: 'Pinawalang-bisa ang kasal',
    occupation: 'Trabaho',
    chooseOccupation: 'Pumili o mag-type ng trabaho',
    student: 'Estudyante',
    governmentEmployee: 'Empleyado ng pamahalaan',
    privateEmployee: 'Empleyado sa pribadong sektor',
    selfEmployed: 'Sariling hanapbuhay',
    farmer: 'Magsasaka',
    homemaker: 'Tagapamahala ng tahanan',
    unemployed: 'Walang trabaho',
    otherOccupation: 'Iba pa',
    customOccupation: 'I-type ang trabaho',
    optional: 'Opsyonal',
    required: 'Kinakailangan',
    addFamily: 'Magdagdag ng residente',
    familyStepHousehold: 'Sambahayan',
    familyStepMembers: 'Mga miyembro ng pamilya',
    familyStepReview: 'Suriin',
    familyZoneRequired: 'Pumili muna ng zone bago idagdag ang sambahayan.',
    familyAddMember: 'Magdagdag ng miyembro ng pamilya',
    familyRemoveMember: 'Alisin',
    familyMember: 'Miyembro ng pamilya',
    familySubmit: 'I-save ang mga tala ng pamilya',
    familySaved: 'Na-save bilang naghihintay na beripikasyon ang mga tala ng pamilya.',
    familySaveError: 'Hindi ma-save ang mga tala ng pamilya.',
    familyReviewMatches: 'May posibleng kaparehong tala. Suriin muna ang mga ito bago magpatuloy.',
    familyContinueAnyway: 'Kumpirmahin matapos suriin',
    familyHouseholdId: 'ID ng sambahayan',
    familyAddress: 'Tirahan o paglalarawan ng lokasyon',
    familyStepNext: 'Susunod',
    familyStepBack: 'Bumalik',
    familyReviewHelp: 'Suriin ang zone ng sambahayan at bawat miyembro bago i-save.',
    familyPrivacy: 'Pangalan at zone lamang ang kailangan. Ilagay lamang ang ibang detalye kung mayroon mula sa opisyal na sanggunian.',
    searchAutofill: 'May eksaktong tugma. Awtomatikong inilagay ang petsa ng kapanganakan at zone mula sa talaan.',
    searchNoMatch: 'Wala pang eksaktong tugma sa buong pangalan.',
    searchChooseMatch: 'Maraming residente ang may ganitong pangalan. Piliin ang tamang tala.',
    searchResultsHelp: 'Pumili ng residente upang mailagay ang petsa ng kapanganakan at zone.',
    openZone: 'Tingnan ang mga residente',
    sexOptional: 'Kasarian (opsyonal)',
    manualOccupation: 'Mag-type ng ibang trabaho',
    incompleteTitle: 'Kulang na impormasyon ng residente',
    incompleteHelp: 'Suriin dito ang mga markadong kulang na tala. Hindi muna sila isasama sa mga listahan ng Zone 1–7 hanggang matapos ang pagsusuri.',
    incompleteCount: 'tala ang kailangang suriin',
    incompleteOpen: 'Tingnan ang mga kulang na tala',
    incompleteClose: 'Itago ang mga kulang na tala',
    incompleteLoading: 'Kinukuha ang mga tala para suriin…',
    incompleteLoadError: 'Hindi makuha ang mga residenteng kulang ang impormasyon.',
    incompleteEmpty: 'Walang residenteng naghihintay ng pagsusuri sa impormasyon.',
    incompletePage: 'Pahina {page} sa {pages}',
    markInformationComplete: 'Kumpleto na — ipadala para beripikahin',
    confirmInformationComplete: 'Kumpirmahing nasuri at kumpleto na ang makukuhang impormasyon. Ililipat ito sa pila para beripikahin.',
    informationReady: 'Inilipat ang tala sa pila para beripikahin.',
    verificationQueue: 'Handa nang beripikahin',
    verificationQueueHelp: 'Suriin ang source record, saka markahang beripikado ang residente.',
    privacyTitle: 'Personal na impormasyon — para lamang sa awtorisadong gawain',
    privacyNotice: 'Gamitin lamang ang mga tala para sa awtorisadong tungkulin ng barangay. Ilagay lamang ang impormasyong kailangan mula sa opisyal na sanggunian; iwang blangko ang hindi alam. Huwag magbahagi ng screenshot o kopya sa labas ng aprubadong gawain. Mananatiling pending ang mga bagong tala, at itinatala sa audit log ang pagbabago ng resident, import, beripikasyon, review status, at status ng tala.',
    search: 'Hanapin ang buong pangalan',
    birthDate: 'Eksaktong petsa ng kapanganakan',
    zone: 'Zone',
    allZones: 'Lahat ng zone',
    residents: 'Mga katugmang tala',
    male: 'Lalaki',
    female: 'Babae',
    name: 'Residente',
    birthAndAge: 'Kapanganakan / edad',
    location: 'Purok / zone',
    household: 'Sambahayan',
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
    loading: 'Kinukuha ang mga tala…',
    loadError: 'Hindi makuha ang pribadong talaan ng kawani.',
    add: 'Magdagdag ng residente para beripikahin',
    firstName: 'Pangalan',
    lastName: 'Apelyido',
    sex: 'Kasarian',
    maleOption: 'Lalaki',
    femaleOption: 'Babae',
    householdId: 'ID ng sambahayan',
    address: 'Tirahan / paglalarawan ng lokasyon',
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
  const [birthDate, setBirthDate] = useState('')
  const [zone, setZone] = useState('')
  const [debounced, setDebounced] = useState({ search: '', birthDate: '', zone: '' })
  const [records, setRecords] = useState([])
  const [zones, setZones] = useState(Array.from({ length: 7 }, (_, index) => ({ zone: index + 1, total: 0 })))
  const [zonesLoading, setZonesLoading] = useState(true)
  const [zonesError, setZonesError] = useState('')
  const [zoneDialog, setZoneDialog] = useState(null)
  const [zoneRecords, setZoneRecords] = useState([])
  const [zoneTotal, setZoneTotal] = useState(0)
  const [zonePage, setZonePage] = useState(1)
  const [zoneLoading, setZoneLoading] = useState(false)
  const [zoneError, setZoneError] = useState('')
  const [selectedForPrint, setSelectedForPrint] = useState({})
  const [printBusy, setPrintBusy] = useState(false)
  const [printError, setPrintError] = useState('')
  const [incompleteResidents, setIncompleteResidents] = useState([])
  const [incompleteTotal, setIncompleteTotal] = useState(0)
  const [incompletePage, setIncompletePage] = useState(1)
  const [incompleteOpen, setIncompleteOpen] = useState(false)
  const [incompleteLoading, setIncompleteLoading] = useState(false)
  const [incompleteError, setIncompleteError] = useState('')
  const [incompleteMessage, setIncompleteMessage] = useState('')
  const [incompleteBusy, setIncompleteBusy] = useState(false)
  const [pageSize] = useState(25)
  const incompletePageSize = 10
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [familyWizardOpen, setFamilyWizardOpen] = useState(false)
  const [familyStep, setFamilyStep] = useState(1)
  const [familyBusy, setFamilyBusy] = useState(false)
  const [familyError, setFamilyError] = useState('')
  const [familyMessage, setFamilyMessage] = useState('')
  const [familyMatches, setFamilyMatches] = useState([])
  const [familyReviewedMatches, setFamilyReviewedMatches] = useState([])
  const [familyHousehold, setFamilyHousehold] = useState({ zone: '', householdId: '', address: '' })
  const [familyMembers, setFamilyMembers] = useState([{ firstName: '', lastName: '', birthDate: '', sex: '', maritalStatus: '', occupation: '' }])
  const [editingResident, setEditingResident] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [editMessage, setEditMessage] = useState('')
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
  const autoFilledSearchRef = useRef('')
  const familyFormValid = useMemo(() => (
    familyHousehold.zone
    && familyMembers.length > 0
    && familyMembers.every((member) => member.firstName.trim() && member.lastName.trim())
  ), [familyHousehold.zone, familyMembers])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced({ search: search.trim(), birthDate, zone })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, birthDate, zone])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const params = new URLSearchParams({
      search: debounced.search,
      birthDate: debounced.birthDate,
      zone: debounced.zone,
      excludeVerificationStatus: 'needs_review',
      page: '1',
      pageSize: String(pageSize),
    })
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const residentResponse = await fetch(`${API_BASE}/staff/residents?${params}`, { signal: controller.signal })
        const residentData = await residentResponse.json().catch(() => ({}))
        if (!residentResponse.ok) throw new Error(residentData.message || labels.loadError)
        if (active) {
          const nextRecords = Array.isArray(residentData.residents) ? residentData.residents : []
          setRecords(nextRecords)
          const normalizedSearch = debounced.search.toLocaleLowerCase()
          const exactMatches = nextRecords.filter((resident) => `${resident.firstName} ${resident.lastName}`.trim().toLocaleLowerCase() === normalizedSearch)
          if (normalizedSearch && exactMatches.length === 1 && autoFilledSearchRef.current !== normalizedSearch) {
            autoFilledSearchRef.current = normalizedSearch
            setBirthDate(exactMatches[0].birthDate || '')
            setZone(exactMatches[0].zone ? String(exactMatches[0].zone) : '')
          }
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
  }, [debounced, pageSize, labels.loadError, refreshKey])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const loadZones = async () => {
      setZonesLoading(true)
      setZonesError('')
      try {
        const response = await fetch(`${API_BASE}/staff/residents/zones`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.zones)) throw new Error(data.message || labels.zoneCountsError)
        if (active) setZones(data.zones)
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active) {
          console.error('load registry zone counts failed', loadError)
          setZonesError(loadError.message || labels.zoneCountsError)
        }
      } finally {
        if (active) setZonesLoading(false)
      }
    }
    loadZones()
    return () => {
      active = false
      controller.abort()
    }
  }, [labels.zoneCountsError, refreshKey])

  useEffect(() => {
    if (zoneDialog === null) return undefined
    let active = true
    const controller = new AbortController()
    const params = new URLSearchParams({
      zone: String(zoneDialog),
      excludeVerificationStatus: 'needs_review',
      page: String(zonePage),
      pageSize: String(pageSize),
    })
    const loadZoneResidents = async () => {
      setZoneLoading(true)
      setZoneError('')
      try {
        const response = await fetch(`${API_BASE}/staff/residents?${params}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || labels.loadError)
        if (active) {
          setZoneRecords(Array.isArray(data.residents) ? data.residents : [])
          setZoneTotal(Number(data.total) || 0)
        }
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active) {
          console.error('load residents for zone failed', loadError)
          setZoneError(loadError.message || labels.loadError)
        }
      } finally {
        if (active) setZoneLoading(false)
      }
    }
    loadZoneResidents()
    return () => {
      active = false
      controller.abort()
    }
  }, [zoneDialog, zonePage, pageSize, labels.loadError, refreshKey])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const loadIncompleteResidents = async () => {
      setIncompleteLoading(true)
      setIncompleteError('')
      try {
        const params = new URLSearchParams({
          verificationStatus: 'needs_review',
          page: String(incompleteOpen ? incompletePage : 1),
          pageSize: String(incompleteOpen ? incompletePageSize : 1),
        })
        const response = await fetch(`${API_BASE}/staff/residents?${params}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !Array.isArray(data.residents)) throw new Error(data.message || labels.incompleteLoadError)
        if (active) {
          setIncompleteTotal(Number(data.total) || 0)
          setIncompleteResidents(incompleteOpen ? data.residents : [])
        }
      } catch (loadError) {
        if (loadError.name !== 'AbortError' && active) {
          console.error('load incomplete resident records failed', loadError)
          setIncompleteError(loadError.message || labels.incompleteLoadError)
        }
      } finally {
        if (active) setIncompleteLoading(false)
      }
    }
    loadIncompleteResidents()
    return () => {
      active = false
      controller.abort()
    }
  }, [incompleteOpen, incompletePage, incompletePageSize, labels.incompleteLoadError, refreshKey])

  const openFamilyWizard = () => {
    const householdId = `HH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    setFamilyHousehold({ zone: '', householdId, address: '' })
    setFamilyMembers([{ firstName: '', lastName: '', birthDate: '', sex: '', maritalStatus: '', occupation: '' }])
    setFamilyStep(1)
    setFamilyError('')
    setFamilyMessage('')
    setFamilyMatches([])
    setFamilyReviewedMatches([])
    setFamilyWizardOpen(true)
  }

  const saveFamily = async (confirmPotentialMatches = false) => {
    if (!familyFormValid) {
      setFamilyError(labels.familyZoneRequired)
      return
    }
    setFamilyBusy(true)
    setFamilyError('')
    setFamilyMessage('')
    try {
      const residents = familyMembers.map((member) => ({
        ...member,
        firstName: member.firstName.trim(),
        lastName: member.lastName.trim(),
        birthDate: member.birthDate || '',
        sex: member.sex || '',
        maritalStatus: member.maritalStatus || '',
        occupation: member.occupation.trim(),
        householdId: familyHousehold.householdId.trim(),
        zone: familyHousehold.zone,
        address: familyHousehold.address.trim(),
      }))
      const response = await fetch(`${API_BASE}/staff/residents/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'family-intake.csv',
          familyBatch: true,
          residents,
          confirmPotentialMatches,
          reviewedMatches: familyReviewedMatches,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.reviewRequired && Array.isArray(data.potentialMatches)) {
        setFamilyMatches(data.potentialMatches)
        setFamilyReviewedMatches(data.reviewedMatches || [])
        return
      }
      if (!response.ok) {
        const details = Array.isArray(data.validationErrors)
          ? data.validationErrors.slice(0, 10).map((item) => `${labels.row} ${item.row}: ${item.message}`).join(' ')
          : ''
        throw new Error(details || data.message || labels.familySaveError)
      }
      setFamilyMessage(`${data.imported} ${labels.familySaved}`)
      setFamilyMatches([])
      setFamilyReviewedMatches([])
      setFamilyWizardOpen(false)
      setRefreshKey((current) => current + 1)
    } catch (saveError) {
      console.error('save family resident records failed', saveError)
      setFamilyError(saveError.message || labels.familySaveError)
    } finally {
      setFamilyBusy(false)
    }
  }

  const saveResidentDetails = async (event) => {
    event.preventDefault()
    if (!editingResident) return
    setEditBusy(true)
    setEditError('')
    setEditMessage('')
    try {
      const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(editingResident.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          birthDate: editForm.birthDate || null,
          sex: editForm.sex || null,
          maritalStatus: editForm.maritalStatus || null,
          occupation: editForm.occupation.trim() || null,
          householdId: editForm.householdId.trim() || null,
          zone: editForm.zone || null,
          address: editForm.address.trim() || null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.editError)
      setZoneRecords((current) => current.map((resident) => resident.id === data.resident.id ? { ...resident, ...data.resident } : resident))
      setRecords((current) => current.map((resident) => resident.id === data.resident.id ? { ...resident, ...data.resident } : resident))
      setEditingResident(data.resident)
      setEditForm({
        firstName: data.resident.firstName || '',
        lastName: data.resident.lastName || '',
        birthDate: data.resident.birthDate || '',
        sex: data.resident.sex || '',
        maritalStatus: data.resident.maritalStatus || '',
        occupation: data.resident.occupation || '',
        householdId: data.resident.householdId || '',
        zone: data.resident.zone ? String(data.resident.zone) : '',
        address: data.resident.address || '',
      })
      setEditMessage(labels.editSaved)
      setRefreshKey((current) => current + 1)
    } catch (saveError) {
      console.error('update resident registry details failed', saveError)
      setEditError(saveError.message || labels.editError)
    } finally {
      setEditBusy(false)
    }
  }

  const openResidentEditor = async (resident) => {
    setEditingResident(resident)
    setEditForm({
      firstName: resident.firstName || '',
      lastName: resident.lastName || '',
      birthDate: resident.birthDate || '',
      sex: resident.sex || '',
      maritalStatus: resident.maritalStatus || '',
      occupation: resident.occupation || '',
      householdId: resident.householdId || '',
      zone: resident.zone ? String(resident.zone) : '',
      address: '',
    })
    setEditError('')
    setEditMessage('')
    setEditBusy(true)
    try {
      const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(resident.id)}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || labels.editError)
      setEditingResident(data.resident)
      setEditForm({
        firstName: data.resident.firstName || '',
        lastName: data.resident.lastName || '',
        birthDate: data.resident.birthDate || '',
        sex: data.resident.sex || '',
        maritalStatus: data.resident.maritalStatus || '',
        occupation: data.resident.occupation || '',
        householdId: data.resident.householdId || '',
        zone: data.resident.zone ? String(data.resident.zone) : '',
        address: data.resident.address || '',
      })
    } catch (loadError) {
      console.error('load resident details for editing failed', loadError)
      setEditError(loadError.message || labels.editError)
    } finally {
      setEditBusy(false)
    }
  }

  const updateVerification = async (resident, verificationStatus) => {
    const message = verificationStatus === 'verified'
      ? labels.confirmVerify
      : verificationStatus === 'pending'
        ? labels.confirmInformationComplete
        : labels.confirmFlag
    if (!window.confirm(message)) return
    setError('')
    setIncompleteMessage('')
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
      setZoneRecords((current) => current.map((item) => item.id === resident.id
        ? { ...item, verificationStatus: data.resident.verificationStatus }
        : item))
      if (verificationStatus === 'pending') setIncompleteMessage(labels.informationReady)
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
      setZoneRecords((current) => current.map((item) => item.id === resident.id ? { ...item, status: data.resident.status } : item))
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

  const exactSearchMatches = search.trim()
    ? records.filter((resident) => `${resident.firstName} ${resident.lastName}`.trim().toLocaleLowerCase() === search.trim().toLocaleLowerCase())
    : []
  const exactSearchMatch = exactSearchMatches.length === 1 ? exactSearchMatches[0] : null
  const zonePageCount = Math.max(1, Math.ceil(zoneTotal / pageSize))
  const openZone = (zoneNumber) => {
    setZoneDialog(zoneNumber)
    setZonePage(1)
    setZoneRecords([])
    setZoneError('')
    setPrintError('')
  }

  const fetchAllZoneResidents = async (zoneNumber) => {
    const residents = []
    let total = 0
    let page = 1
    do {
      const params = new URLSearchParams({
        zone: String(zoneNumber),
        excludeVerificationStatus: 'needs_review',
        page: String(page),
        pageSize: '100',
      })
      const response = await fetch(`${API_BASE}/staff/residents?${params}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(data.residents) || !Number.isFinite(Number(data.total))) {
        throw new Error(data.message || labels.printError)
      }
      residents.push(...data.residents)
      total = Number(data.total)
      if (data.residents.length === 0 && residents.length < total) throw new Error(labels.printError)
      page += 1
    } while (residents.length < total)
    return residents
  }

  const printRegistryRecords = async (title, subtitle, mode, loadRecords) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setPrintError(labels.popupBlocked)
      return
    }
    setPrintBusy(true)
    setPrintError('')
    try {
      let residents = typeof loadRecords === 'function' ? await loadRecords() : loadRecords
      if (!residents.length) throw new Error(labels.zoneResidentsEmpty)
      if (mode === 'individuals') {
        const residentsWithDetails = []
        for (let start = 0; start < residents.length; start += 10) {
          const batch = await Promise.all(residents.slice(start, start + 10).map(async (resident) => {
            const response = await fetch(`${API_BASE}/staff/residents/${encodeURIComponent(resident.id)}`)
            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data.resident) throw new Error(data.message || labels.printError)
            return { ...resident, ...data.resident }
          }))
          residentsWithDetails.push(...batch)
        }
        residents = residentsWithDetails
      }
      const html = createRegistryPrintHtml({
        title,
        subtitle,
        records: residents,
        mode,
        language,
        labels: {
          barangayName: 'Barangay Legaspi',
          generated: labels.printGenerated,
          residents: labels.printResidents,
          name: labels.name,
          birthDate: labels.birthDate,
          zone: labels.zone,
          household: labels.household,
          sex: labels.sex,
          maritalStatus: labels.maritalStatus,
          occupation: labels.occupation,
          address: labels.address,
          verification: labels.status,
          recordStatus: labels.recordStatus,
          unassigned: labels.unassigned,
          confidentialNotice: labels.printConfidential,
        },
      })
      writePrintWindow(printWindow, html)
    } catch (printFailure) {
      printWindow.close()
      console.error('prepare resident registry printout failed', printFailure)
      setPrintError(printFailure.message || labels.printError)
    } finally {
      setPrintBusy(false)
    }
  }

  const togglePrintSelection = (resident, selected) => {
    setSelectedForPrint((current) => {
      const next = { ...current }
      if (selected) next[resident.id] = resident
      else delete next[resident.id]
      return next
    })
  }

  const selectedPrintRecords = Object.values(selectedForPrint)
  const selectedZoneLabels = [...new Set(selectedPrintRecords.map((resident) => resident.zone ? `Zone ${resident.zone}` : labels.unassigned))]
  const selectedBatchSubtitle = selectedZoneLabels.join(', ')
  const pageIsSelected = zoneRecords.length > 0 && zoneRecords.every((resident) => selectedForPrint[resident.id])
  const incompletePages = Math.max(1, Math.ceil(incompleteTotal / incompletePageSize))

  return (
    <section className="registry-panel" aria-labelledby="resident-registry-title">
      <div className="registry-panel-header">
        <div>
          <h2 id="resident-registry-title">{labels.title}</h2>
          <p>{labels.subtitle}</p>
        </div>
        <div className="registry-row-actions registry-toolbar-actions">
          <button type="button" className="secondary-btn small" onClick={() => setImportOpen((open) => !open)}>{labels.importTitle}</button>
          <button type="button" className="primary-btn small" onClick={openFamilyWizard}>
            {labels.addFamily}
          </button>
        </div>
      </div>

      <aside className="registry-privacy-notice" aria-label={labels.privacyTitle}>
        <strong>{labels.privacyTitle}</strong>
        <p>{labels.privacyNotice}</p>
      </aside>

      <section className="registry-incomplete-review" aria-labelledby="registry-incomplete-title">
        <div className="registry-incomplete-header">
          <div>
            <h3 id="registry-incomplete-title">{labels.incompleteTitle}</h3>
            <p>{labels.incompleteHelp}</p>
          </div>
          <button
            type="button"
            className="secondary-btn small"
            aria-expanded={incompleteOpen}
            aria-controls="registry-incomplete-list"
            onClick={() => { setIncompletePage(1); setIncompleteOpen((open) => !open) }}
          >
            {incompleteOpen ? labels.incompleteClose : `${labels.incompleteOpen} (${incompleteTotal})`}
          </button>
        </div>
        <strong className="registry-incomplete-count">{incompleteTotal} {labels.incompleteCount}</strong>
        {incompleteError && <p className="registry-message error" role="alert">{incompleteError}</p>}
        {incompleteMessage && <p className="registry-message" role="status">{incompleteMessage}</p>}
        {incompleteOpen && (
          <div id="registry-incomplete-list" className="registry-incomplete-list" aria-busy={incompleteLoading}>
            {incompleteLoading && <p className="registry-message" role="status">{labels.incompleteLoading}</p>}
            {!incompleteLoading && incompleteResidents.length > 0 && (
              <>
                <ul className="registry-incomplete-records">
                  {incompleteResidents.map((resident) => (
                    <li key={resident.id}>
                      <div>
                        <strong>{resident.firstName} {resident.lastName}</strong>
                        <small>{resident.birthDate ? formatDate(resident.birthDate, language) : labels.noDob} · {resident.zone ? `Zone ${resident.zone}` : labels.unassigned}</small>
                      </div>
                      <div className="registry-row-actions">
                        <button type="button" className="secondary-btn small" onClick={() => openResidentEditor(resident)}>{labels.editResident}</button>
                        <button type="button" className="primary-btn small" disabled={incompleteBusy} onClick={async () => {
                          setIncompleteBusy(true)
                          await updateVerification(resident, 'pending')
                          setIncompleteBusy(false)
                        }}>{labels.markInformationComplete}</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="registry-incomplete-pagination">
                  <span>{labels.incompletePage.replace('{page}', String(incompletePage)).replace('{pages}', String(incompletePages))}</span>
                  <div className="registry-row-actions">
                    <button type="button" className="secondary-btn small" disabled={incompleteLoading || incompletePage <= 1} onClick={() => setIncompletePage((page) => Math.max(1, page - 1))}>{labels.previous}</button>
                    <button type="button" className="secondary-btn small" disabled={incompleteLoading || incompletePage >= incompletePages} onClick={() => setIncompletePage((page) => Math.min(incompletePages, page + 1))}>{labels.next}</button>
                  </div>
                </div>
              </>
            )}
            {!incompleteLoading && incompleteResidents.length === 0 && !incompleteError && <p className="registry-source-review-empty">{labels.incompleteEmpty}</p>}
          </div>
        )}
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
                <button type="button" className="primary-btn small" disabled={importBusy} onClick={() => submitImport(true)}>{labels.confirmImport}</button>
                <button type="button" className="secondary-btn small" disabled={importBusy} onClick={() => { setImportMatches([]); setImportReviewedMatches([]); setImportRows([]); setImportFile(null) }}>{labels.cancelAdd}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {familyMessage && <p className="registry-message" role="status">{familyMessage}</p>}

      {familyWizardOpen && (
        <div className="registry-modal-backdrop" role="presentation">
          <section className="registry-modal family-wizard" role="dialog" aria-modal="true" aria-labelledby="family-wizard-title">
            <div className="registry-modal-header">
              <div>
                <p className="registry-step-label">{labels.familyStepHousehold} · {labels.familyStepMembers} · {labels.familyStepReview} ({familyStep}/3)</p>
                <h2 id="family-wizard-title">{labels.addFamily}</h2>
              </div>
              <button type="button" className="secondary-btn small" disabled={familyBusy} onClick={() => setFamilyWizardOpen(false)}>{labels.close}</button>
            </div>
            <p className="registry-wizard-help">{labels.familyPrivacy}</p>
            {familyStep === 1 && (
              <div className="registry-entry-form">
                <h3>{labels.familyStepHousehold}</h3>
                <label>{labels.zone} <span className="registry-required">{labels.required}</span>
                  <select value={familyHousehold.zone} onChange={(event) => setFamilyHousehold((current) => ({ ...current, zone: event.target.value }))} required>
                    <option value="">{labels.unassigned}</option>
                    {[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>Zone {number}</option>)}
                  </select>
                </label>
                <label>{labels.familyHouseholdId} <span className="registry-optional">{labels.optional}</span>
                  <input value={familyHousehold.householdId} maxLength={100} onChange={(event) => setFamilyHousehold((current) => ({ ...current, householdId: event.target.value }))} />
                </label>
                <label>{labels.familyAddress} <span className="registry-optional">{labels.optional}</span>
                  <input value={familyHousehold.address} maxLength={255} onChange={(event) => setFamilyHousehold((current) => ({ ...current, address: event.target.value }))} />
                </label>
                <div className="registry-modal-actions">
                  <button type="button" className="primary-btn small" disabled={!familyHousehold.zone} onClick={() => setFamilyStep(2)}>{labels.familyStepNext}</button>
                </div>
              </div>
            )}
            {familyStep === 2 && (
              <div className="registry-family-members">
                <h3>{labels.familyStepMembers}</h3>
                {familyMembers.map((member, index) => (
                  <fieldset className="registry-family-member" key={`member-${index}`}>
                    <legend>{labels.familyMember} {index + 1}</legend>
                    <button type="button" className="secondary-btn tiny" disabled={familyMembers.length === 1} onClick={() => setFamilyMembers((current) => current.filter((_, memberIndex) => memberIndex !== index))}>{labels.familyRemoveMember}</button>
                    <label>{labels.firstName} <span className="registry-required">{labels.required}</span>
                      <input value={member.firstName} maxLength={100} onChange={(event) => setFamilyMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, firstName: event.target.value } : item))} required />
                    </label>
                    <label>{labels.lastName} <span className="registry-required">{labels.required}</span>
                      <input value={member.lastName} maxLength={100} onChange={(event) => setFamilyMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, lastName: event.target.value } : item))} required />
                    </label>
                    <label>{labels.birthDate} <span className="registry-optional">{labels.optional}</span>
                      <input type="date" max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} value={member.birthDate} onChange={(event) => setFamilyMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, birthDate: event.target.value } : item))} />
                    </label>
                    <label>{labels.sexOptional}
                      <select value={member.sex} onChange={(event) => setFamilyMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, sex: event.target.value } : item))}>
                        <option value="">{labels.optional}</option><option value="Male">{labels.maleOption}</option><option value="Female">{labels.femaleOption}</option>
                      </select>
                    </label>
                    <label>{labels.maritalStatus} <span className="registry-optional">{labels.optional}</span>
                      <select value={member.maritalStatus} onChange={(event) => setFamilyMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, maritalStatus: event.target.value } : item))}>
                        <option value="">{labels.chooseMaritalStatus}</option>
                        <option value="Single">{labels.single}</option><option value="Married">{labels.married}</option><option value="Widowed">{labels.widowed}</option>
                        <option value="Legally Separated">{labels.legallySeparated}</option><option value="Annulled">{labels.annulled}</option>
                      </select>
                    </label>
                    <label>{labels.occupation} <span className="registry-optional">{labels.optional}</span>
                      <input list="registry-occupation-options" value={member.occupation} maxLength={120} placeholder={labels.chooseOccupation} onChange={(event) => setFamilyMembers((current) => current.map((item, memberIndex) => memberIndex === index ? { ...item, occupation: event.target.value } : item))} />
                    </label>
                  </fieldset>
                ))}
                <div className="registry-modal-actions registry-family-actions">
                  <button type="button" className="secondary-btn small" onClick={() => setFamilyMembers((current) => [...current, { firstName: '', lastName: current[0]?.lastName || '', birthDate: '', sex: '', maritalStatus: '', occupation: '' }])}>{labels.familyAddMember}</button>
                  <button type="button" className="secondary-btn small" onClick={() => setFamilyStep(1)}>{labels.familyStepBack}</button>
                  <button type="button" className="primary-btn small" disabled={!familyMembers.every((member) => member.firstName.trim() && member.lastName.trim())} onClick={() => { setFamilyError(''); setFamilyStep(3) }}>{labels.familyStepNext}</button>
                </div>
              </div>
            )}
            {familyStep === 3 && (
              <div className="registry-family-review">
                <h3>{labels.familyStepReview}</h3>
                <p>{labels.familyReviewHelp}</p>
                <p><strong>Zone {familyHousehold.zone}</strong> · {familyHousehold.householdId || labels.unassigned}{familyHousehold.address ? ` · ${familyHousehold.address}` : ''}</p>
                <ul>{familyMembers.map((member, index) => (
                  <li key={`review-${index}`}>
                    <strong>{member.firstName} {member.lastName}</strong>
                    <span>{member.birthDate ? formatDate(member.birthDate, language) : labels.noDob}</span>
                    <span>{member.maritalStatus ? labels[member.maritalStatus === 'Legally Separated' ? 'legallySeparated' : member.maritalStatus.toLowerCase()] : labels.chooseMaritalStatus}</span>
                    <span>{member.occupation || labels.chooseOccupation}</span>
                  </li>
                ))}</ul>
                {familyMatches.length > 0 && (
                  <div className="registry-message warning" role="alert">
                    <strong>{labels.familyReviewMatches}</strong>
                    <ul>{familyMatches.map((match, index) => <li key={`${match.row}-${index}`}>{labels.row} {match.row}: {match.records.map((record) => `${record.firstName} ${record.lastName} (${record.birthDate || labels.noDob})`).join(', ')}</li>)}</ul>
                  </div>
                )}
                {familyError && <p className="registry-message error" role="alert">{familyError}</p>}
                <div className="registry-modal-actions">
                  <button type="button" className="secondary-btn small" disabled={familyBusy} onClick={() => setFamilyStep(2)}>{labels.familyStepBack}</button>
                  {familyMatches.length > 0
                    ? <button type="button" className="primary-btn small" disabled={familyBusy} onClick={() => saveFamily(true)}>{familyBusy ? labels.saving : labels.familyContinueAnyway}</button>
                    : <button type="button" className="primary-btn small" disabled={familyBusy || !familyFormValid} onClick={() => saveFamily(false)}>{familyBusy ? labels.saving : labels.familySubmit}</button>}
                </div>
              </div>
            )}
            {familyError && familyStep !== 3 && <p className="registry-message error" role="alert">{familyError}</p>}
          </section>
        </div>
      )}

      <div className="registry-filters" aria-label={labels.title}>
        <label>{labels.search}<input type="search" value={search} onChange={(event) => {
          autoFilledSearchRef.current = ''
          setBirthDate('')
          setZone('')
          setSearch(event.target.value)
        }} /></label>
        <label>{labels.birthDate}<input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
        <label>{labels.zone}<select value={zone} onChange={(event) => setZone(event.target.value)}><option value="">{labels.allZones}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>Zone {number}</option>)}</select></label>
      </div>
      {search.trim() && exactSearchMatch && <p className="registry-message" role="status">{labels.searchAutofill}</p>}
      {search.trim() && exactSearchMatches.length > 1 && <div className="registry-search-match-list" aria-label={labels.search}>
        <p>{labels.searchChooseMatch}</p>
        {exactSearchMatches.map((resident) => (
          <button type="button" className="registry-search-match" key={resident.id} onClick={() => {
            setBirthDate(resident.birthDate || '')
            setZone(resident.zone ? String(resident.zone) : '')
            if (resident.zone) openZone(resident.zone)
          }}>
            <span>{resident.firstName} {resident.lastName} · {formatDate(resident.birthDate, language) || labels.noDob} · {resident.zone ? `Zone ${resident.zone}` : labels.unassigned}</span>
          </button>
        ))}
      </div>}
      {search.trim() && records.length > 0 && !exactSearchMatch && exactSearchMatches.length === 0 && (
        <div className="registry-search-match-list" aria-label={labels.search}>
          <p>{labels.searchResultsHelp}</p>
          {records.slice(0, 5).map((resident) => (
            <button type="button" className="registry-search-match" key={resident.id} onClick={() => {
              setBirthDate(resident.birthDate || '')
              setZone(resident.zone ? String(resident.zone) : '')
              if (resident.zone) openZone(resident.zone)
            }}>
              <span>{resident.firstName} {resident.lastName} · {formatDate(resident.birthDate, language) || labels.noDob} · {resident.zone ? `Zone ${resident.zone}` : labels.unassigned}</span>
            </button>
          ))}
        </div>
      )}
      {search.trim() && !loading && exactSearchMatches.length === 0 && records.length === 0 && <p className="registry-message" role="status">{labels.searchNoMatch}</p>}
      {error && <p className="registry-message error" role="alert">{error}</p>}
      <section className="registry-zone-directory" aria-labelledby="registry-zone-title">
        <div>
          <h3 id="registry-zone-title">{labels.zoneDirectoryTitle}</h3>
          <p>{labels.zoneDirectoryHelp}</p>
        </div>
        {zonesError && <p className="registry-message error" role="alert">{zonesError}</p>}
        {zonesLoading && <p className="registry-message" role="status">{labels.loading}</p>}
        {!zonesLoading && !zonesError && (
          <div className="registry-zone-grid">
            {zones.map((item) => (
              <button type="button" className="registry-zone-card" key={item.zone} onClick={() => openZone(item.zone)}>
                <span>Zone {item.zone}</span>
                <strong>{item.total}</strong>
                <small>{labels.openZone}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      {exactSearchMatch?.zone && (
        <div className="registry-search-match">
          <span>{exactSearchMatch.firstName} {exactSearchMatch.lastName} · {formatDate(exactSearchMatch.birthDate, language) || labels.noDob} · Zone {exactSearchMatch.zone}</span>
          <button type="button" className="secondary-btn small" onClick={() => openZone(exactSearchMatch.zone)}>{labels.openZone}</button>
        </div>
      )}

      {zoneDialog !== null && (
        <div className="registry-modal-backdrop" role="presentation">
          <section className="registry-modal registry-zone-modal" role="dialog" aria-modal="true" aria-labelledby="zone-dialog-title">
            <div className="registry-modal-header">
              <div><h2 id="zone-dialog-title">{labels.zoneResidentsTitle} {zoneDialog}</h2><p>{zoneTotal} {labels.assignedResidents}</p></div>
              <button type="button" className="secondary-btn small" onClick={() => setZoneDialog(null)}>{labels.close}</button>
            </div>
            {zoneLoading && <p className="registry-message" role="status">{labels.loading}</p>}
            {zoneError && <p className="registry-message error" role="alert">{zoneError}</p>}
            {printError && <p className="registry-message error" role="alert">{printError}</p>}
            <div className="registry-print-actions">
              <button type="button" className="secondary-btn small" disabled={printBusy || zoneTotal === 0} onClick={() => printRegistryRecords(`Zone ${zoneDialog} resident roster`, `Zone ${zoneDialog}`, 'roster', () => fetchAllZoneResidents(zoneDialog))}>{printBusy ? labels.printLoading : labels.printZoneRoster}</button>
              <button type="button" className="secondary-btn small" disabled={printBusy || zoneTotal === 0} onClick={() => printRegistryRecords(`Zone ${zoneDialog} resident sheets`, `Zone ${zoneDialog}`, 'individuals', () => fetchAllZoneResidents(zoneDialog))}>{printBusy ? labels.printLoading : labels.printZoneSheets}</button>
              {selectedPrintRecords.length > 0 && (
                <>
                  <span className="registry-print-selected-count">{selectedPrintRecords.length} {labels.selectedForPrint}</span>
                  <button type="button" className="secondary-btn small" disabled={printBusy} onClick={() => printRegistryRecords(labels.selectedBatchTitle, selectedBatchSubtitle, 'roster', selectedPrintRecords)}>{labels.printSelectedRoster}</button>
                  <button type="button" className="secondary-btn small" disabled={printBusy} onClick={() => printRegistryRecords(labels.selectedBatchTitle, selectedBatchSubtitle, 'individuals', selectedPrintRecords)}>{labels.printSelectedSheets}</button>
                  <button type="button" className="secondary-btn small" disabled={printBusy} onClick={() => setSelectedForPrint({})}>{labels.clearSelection}</button>
                </>
              )}
            </div>
            {!zoneLoading && !zoneError && zoneRecords.length === 0 && <p className="registry-message">{labels.zoneResidentsEmpty}</p>}
            {zoneRecords.length > 0 && (
              <>
                <div className="registry-table-wrap">
                  <table className="registry-table">
                    <thead><tr>
                      <th><input type="checkbox" checked={pageIsSelected} aria-label={labels.selectPageForPrint} onChange={(event) => {
                        const checked = event.currentTarget.checked
                        setSelectedForPrint((current) => {
                          const next = { ...current }
                          zoneRecords.forEach((resident) => {
                            if (checked) next[resident.id] = resident
                            else delete next[resident.id]
                          })
                          return next
                        })
                      }} /></th>
                      <th>{labels.name}</th><th>{labels.birthDate}</th><th>{labels.maritalStatus}</th><th>{labels.occupation}</th><th>{labels.household}</th><th>{labels.status}</th><th>{labels.recordStatus}</th><th>{labels.editResident}</th>
                    </tr></thead>
                    <tbody>{zoneRecords.map((resident) => (
                      <tr key={resident.id}>
                        <td><input type="checkbox" checked={Boolean(selectedForPrint[resident.id])} aria-label={`${labels.selectResidentForPrint}: ${resident.firstName} ${resident.lastName}`} onChange={(event) => togglePrintSelection(resident, event.target.checked)} /></td>
                        <td>{resident.firstName} {resident.lastName}</td>
                        <td>{formatDate(resident.birthDate, language) || labels.noDob}</td>
                        <td>{resident.maritalStatus ? labels[resident.maritalStatus === 'Legally Separated' ? 'legallySeparated' : resident.maritalStatus.toLowerCase()] || resident.maritalStatus : '—'}</td>
                        <td>{resident.occupation || '—'}</td>
                        <td>{resident.householdId || '—'}</td>
                        <td><span className={`registry-status is-${resident.verificationStatus}`}>{resident.verificationStatus === 'verified' ? labels.verified : resident.verificationStatus === 'needs_review' ? labels.needsReview : labels.pending}</span></td>
                        <td><label className="registry-status-select"><span className="sr-only">{labels.updateStatus}: {resident.firstName} {resident.lastName}</span><select value={resident.status} onChange={(event) => updateRecordStatus(resident, event.target.value)}><option value="active">{labels.active}</option><option value="inactive">{labels.inactive}</option><option value="deceased">{labels.deceased}</option><option value="archived">{labels.archived}</option></select></label></td>
                        <td><div className="registry-row-actions">
                          <button type="button" className="secondary-btn tiny" disabled={printBusy} onClick={() => printRegistryRecords(`${labels.printResident}: ${resident.firstName} ${resident.lastName}`, `Zone ${zoneDialog}`, 'individuals', [resident])}>{labels.printResident}</button>
                          {resident.householdId && <button type="button" className="secondary-btn tiny" disabled={printBusy} onClick={() => printRegistryRecords(`${labels.printFamilyRoster}: ${resident.householdId}`, `Zone ${zoneDialog}`, 'roster', async () => (await fetchAllZoneResidents(zoneDialog)).filter((member) => member.householdId === resident.householdId))}>{labels.printFamilyRoster}</button>}
                          {resident.householdId && <button type="button" className="secondary-btn tiny" disabled={printBusy} onClick={() => printRegistryRecords(`${labels.printFamilySheets}: ${resident.householdId}`, `Zone ${zoneDialog}`, 'individuals', async () => (await fetchAllZoneResidents(zoneDialog)).filter((member) => member.householdId === resident.householdId))}>{labels.printFamilySheets}</button>}
                          <button type="button" className="secondary-btn tiny" onClick={() => openResidentEditor(resident)}>{labels.editResident}</button>
                          {resident.verificationStatus !== 'verified' && <><button type="button" className="secondary-btn tiny" onClick={() => updateVerification(resident, 'verified')}>{labels.markVerified}</button><button type="button" className="secondary-btn tiny" onClick={() => updateVerification(resident, 'needs_review')}>{labels.flagReview}</button></>}
                        </div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="registry-pagination">
                  <span>{labels.page} {zonePage} {labels.of} {zonePageCount} · {zoneTotal}</span>
                  <div><button type="button" className="secondary-btn small" disabled={zonePage <= 1 || zoneLoading} onClick={() => setZonePage((current) => current - 1)}>{labels.previous}</button><button type="button" className="secondary-btn small" disabled={zonePage >= zonePageCount || zoneLoading} onClick={() => setZonePage((current) => current + 1)}>{labels.next}</button></div>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {editingResident && (
        <div className="registry-modal-backdrop registry-edit-backdrop" role="presentation">
          <form className="registry-modal registry-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-resident-title" onSubmit={saveResidentDetails}>
            <div className="registry-modal-header">
              <h2 id="edit-resident-title">{labels.editResident}</h2>
              <button type="button" className="secondary-btn small" onClick={() => setEditingResident(null)}>{labels.close}</button>
            </div>
            <div className="registry-entry-form">
              <label>{labels.firstName}<input value={editForm.firstName || ''} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, firstName: event.target.value }))} required /></label>
              <label>{labels.lastName}<input value={editForm.lastName || ''} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, lastName: event.target.value }))} required /></label>
              <label>{labels.birthDate}<input type="date" max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())} value={editForm.birthDate || ''} onChange={(event) => setEditForm((current) => ({ ...current, birthDate: event.target.value }))} /></label>
              <label>{labels.sexOptional}<select value={editForm.sex || ''} onChange={(event) => setEditForm((current) => ({ ...current, sex: event.target.value }))}><option value="">{labels.optional}</option><option value="Male">{labels.maleOption}</option><option value="Female">{labels.femaleOption}</option></select></label>
              <label>{labels.maritalStatus}<select value={editForm.maritalStatus || ''} onChange={(event) => setEditForm((current) => ({ ...current, maritalStatus: event.target.value }))}><option value="">{labels.chooseMaritalStatus}</option><option value="Single">{labels.single}</option><option value="Married">{labels.married}</option><option value="Widowed">{labels.widowed}</option><option value="Legally Separated">{labels.legallySeparated}</option><option value="Annulled">{labels.annulled}</option></select></label>
              <label>{labels.occupation}<input list="registry-occupation-options" value={editForm.occupation || ''} maxLength={120} onChange={(event) => setEditForm((current) => ({ ...current, occupation: event.target.value }))} /></label>
              <label>{labels.zone}<select value={editForm.zone || ''} onChange={(event) => setEditForm((current) => ({ ...current, zone: event.target.value }))}><option value="">{labels.unassigned}</option>{[1, 2, 3, 4, 5, 6, 7].map((number) => <option key={number} value={number}>Zone {number}</option>)}</select></label>
              <label>{labels.familyHouseholdId}<input value={editForm.householdId || ''} maxLength={100} onChange={(event) => setEditForm((current) => ({ ...current, householdId: event.target.value }))} /></label>
              <label>{labels.familyAddress}<input value={editForm.address || ''} maxLength={255} onChange={(event) => setEditForm((current) => ({ ...current, address: event.target.value }))} /></label>
            </div>
            {editError && <p className="registry-message error" role="alert">{editError}</p>}
            {editMessage && <p className="registry-message" role="status">{editMessage}</p>}
            <div className="registry-modal-actions">
              <button type="button" className="secondary-btn small" disabled={editBusy} onClick={() => setEditingResident(null)}>{labels.close}</button>
              <button type="submit" className="primary-btn small" disabled={editBusy}>{editBusy ? labels.saving : labels.saveChanges}</button>
            </div>
          </form>
        </div>
      )}
      <datalist id="registry-occupation-options">
        {[labels.student, labels.governmentEmployee, labels.privateEmployee, labels.selfEmployed, labels.farmer, labels.homemaker, labels.unemployed].map((occupation) => <option key={occupation} value={occupation} />)}
      </datalist>
    </section>
  )
}
