import { useEffect, useRef, useState } from 'react'
import { createCameraScanFile, MAX_SCAN_FILES, validateResidentScanFiles } from './registry-scan'

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/$/, '')
const OCR_ASSET_BASE = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/ocr`

const text = {
  en: {
    title: 'Scan paper forms on this device',
    privacy: 'Images and OCR text are processed locally in this browser and are not uploaded or saved by the scanner. Resident details you enter are sent to the registry only when you explicitly import checked rows. OCR can be wrong, especially for handwriting; compare every value with the original.',
    choose: 'Choose or photograph pages',
    openCamera: 'Open camera',
    capturePage: 'Capture page',
    stopCamera: 'Close camera',
    cameraUnavailable: 'Camera access requires a supported browser and a secure HTTPS connection. On your phone, open the secure preview link; localhost is secure only on this device.',
    cameraDenied: 'Camera permission was denied. Allow camera access in your browser settings and try again.',
    cameraFailed: 'Unable to start the camera. Check that your device has an available camera and try again.',
    cameraPreview: 'Live document camera preview',
    scan: 'Read text from selected pages',
    scanning: 'Reading page',
    empty: 'No text was recognized. Enter the details manually after checking the image.',
    ocrPage: 'Recognized text — page',
    draftTitle: 'Create reviewed resident rows',
    draftHelp: 'OCR does not create resident records or determine which words are names. Add each person manually from the original page, then check each row before importing.',
    addRow: 'Add resident row',
    rowLimit: 'The batch can contain up to 500 resident rows.',
    firstName: 'First name',
    lastName: 'Last name',
    birthDate: 'Birth date',
    sex: 'Sex',
    selectSex: 'Choose sex',
    male: 'Male',
    female: 'Female',
    household: 'Household ID',
    zone: 'Zone',
    purok: 'Purok',
    source: 'Source reference (page/line)',
    sourceDefault: 'Scanned page',
    checked: 'I checked these details against the original document',
    remove: 'Remove row',
    duplicate: 'Possible matches found. Review before choosing whether to continue.',
    confirmMatches: 'Continue after reviewing possible matches',
    cancelMatches: 'Return to editing',
    import: 'Import checked rows as pending',
    importing: 'Importing…',
    imported: 'rows imported as pending. Check the saved records against their sources before verification.',
    ready: 'Every row needs a first and last name, a Male/Female value, and a source check before import.',
    clear: 'Clear scan and draft',
    errors: {
      noFiles: 'Choose at least one image to scan.',
      tooMany: `Choose no more than ${MAX_SCAN_FILES} images at a time.`,
      format: 'Use JPEG, PNG, or WebP image files only.',
      fileSize: 'Each image must be 10 MB or smaller.',
      totalSize: 'The selected images must total 30 MB or less.',
      load: 'Unable to load the scanner. Check that the app has finished loading and try again.',
      capture: 'Unable to capture a page from the camera. Try again or choose an image instead.',
    },
  },
  fil: {
    title: 'I-scan ang mga papel sa device na ito',
    privacy: 'Sa browser na ito lamang pinoproseso ang mga larawan at OCR text, at hindi ito ina-upload o sine-save ng scanner. Ipinapadala lamang sa registry ang mga detalyeng mano-mano mong inilagay kapag tahasan mong ini-import ang mga nasuring tala. Maaaring mali ang OCR, lalo na sa sulat-kamay; ihambing ang bawat detalye sa orihinal.',
    choose: 'Pumili o kunan ng larawan ang mga pahina',
    openCamera: 'Buksan ang camera',
    capturePage: 'Kunan ang pahina',
    stopCamera: 'Isara ang camera',
    cameraUnavailable: 'Kailangan ng suportadong browser at secure na HTTPS connection para magamit ang camera. Buksan sa iyong phone ang secure preview link; secure lang ang localhost sa mismong device.',
    cameraDenied: 'Hindi pinayagan ang camera. Payagan ang paggamit nito sa browser settings at subukan muli.',
    cameraFailed: 'Hindi mabuksan ang camera. Tiyaking may magagamit na camera ang device at subukan muli.',
    cameraPreview: 'Live na preview ng document camera',
    scan: 'Basahin ang teksto sa mga pahina',
    scanning: 'Binabasa ang pahina',
    empty: 'Walang tekstong nakilala. Ilagay nang mano-mano ang detalye matapos suriin ang larawan.',
    ocrPage: 'Nakilalang teksto — pahina',
    draftTitle: 'Gumawa ng mga susuriing tala ng residente',
    draftHelp: 'Hindi gumagawa ng tala o tumutukoy ng pangalan ang OCR. Ilagay nang mano-mano ang bawat tao mula sa orihinal, at suriin ang bawat tala bago i-import.',
    addRow: 'Magdagdag ng tala ng residente',
    rowLimit: 'Maaaring maglaman ang batch ng hanggang 500 tala ng residente.',
    firstName: 'Pangalan',
    lastName: 'Apelyido',
    birthDate: 'Petsa ng kapanganakan',
    sex: 'Kasarian',
    selectSex: 'Hindi natukoy / hindi naitala',
    male: 'Lalaki',
    female: 'Babae',
    household: 'ID ng sambahayan',
    zone: 'Zone',
    purok: 'Purok',
    source: 'Sanggunian (pahina/linya)',
    sourceDefault: 'Na-scan na pahina',
    checked: 'Inihambing ko ang mga detalyeng ito sa orihinal na dokumento',
    remove: 'Alisin ang tala',
    duplicate: 'May posibleng katugma. Suriin bago magpatuloy.',
    confirmMatches: 'Ituloy matapos suriin ang mga posibleng tugma',
    cancelMatches: 'Bumalik sa pag-edit',
    import: 'I-import bilang pending ang mga nasuring tala',
    importing: 'Ini-import…',
    imported: 'tala ang na-import bilang pending. Ihambing ang mga ito sa sanggunian bago beripikahin.',
    ready: 'Kailangan ang pangalan at apelyido at dapat nasuri ang bawat tala bago i-import.',
    clear: 'Burahin ang scan at mga tala',
    errors: {
      noFiles: 'Pumili ng kahit isang larawang i-scan.',
      tooMany: `Pumili ng hindi hihigit sa ${MAX_SCAN_FILES} larawan sa isang pagkakataon.`,
      format: 'JPEG, PNG, o WebP na larawan lamang ang gamitin.',
      fileSize: 'Dapat 10 MB pababa ang bawat larawan.',
      totalSize: 'Dapat 30 MB pababa ang kabuuang laki ng mga larawan.',
      load: 'Hindi ma-load ang scanner. Hintaying matapos mag-load ang app at subukan muli.',
      capture: 'Hindi makunan ng larawan mula sa camera. Subukan muli o pumili na lamang ng larawan.',
    },
  },
}

function emptyResident(id, page) {
  return {
    id,
    firstName: '',
    lastName: '',
    birthDate: '',
    sex: '',
    householdId: '',
    zone: '',
    purok: '',
    sourceReference: `Scanned page ${page}`,
    checked: false,
  }
}

function userFileError(message, labels) {
  if (message.startsWith('Choose at least one')) return labels.errors.noFiles
  if (message.startsWith('Choose no more')) return labels.errors.tooMany
  if (message.startsWith('Use JPEG')) return labels.errors.format
  if (message.startsWith('Each image')) return labels.errors.fileSize
  if (message.startsWith('The selected images')) return labels.errors.totalSize
  return message
}

export default function ResidentDocumentScanner({ language = 'en' }) {
  const labels = text[language] || text.en
  const [files, setFiles] = useState([])
  const [imageUrls, setImageUrls] = useState([])
  const [recognizedPages, setRecognizedPages] = useState([])
  const [entries, setEntries] = useState([])
  const [matches, setMatches] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [pageProgress, setPageProgress] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const workerRef = useRef(null)
  const mountedRef = useRef(true)
  const cameraStreamRef = useRef(null)
  const cameraVideoRef = useRef(null)
  const imageUrlsRef = useRef([])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
      imageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      imageUrlsRef.current = []
      if (workerRef.current) {
        const worker = workerRef.current
        workerRef.current = null
        worker.terminate().catch((terminationError) => {
          console.error('terminate local resident document OCR worker failed', terminationError)
        })
      }
    }
  }, [])

  const replaceImageUrls = (urls) => {
    imageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    imageUrlsRef.current = urls
    setImageUrls(urls)
  }

  const appendImageUrl = (url) => {
    imageUrlsRef.current = [...imageUrlsRef.current, url]
    setImageUrls(imageUrlsRef.current)
  }

  useEffect(() => {
    const video = cameraVideoRef.current
    const stream = cameraActive ? cameraStreamRef.current : null
    if (!video || !stream) return undefined
    video.srcObject = stream
    video.play().catch((playError) => {
      console.error('play local resident document camera preview failed', playError)
      if (mountedRef.current) setError(labels.cameraFailed)
    })
    return () => {
      if (video.srcObject === stream) video.srcObject = null
    }
  }, [cameraActive, labels])

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    setCameraActive(false)
    setCameraStarting(false)
  }

  const openCamera = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(labels.cameraUnavailable)
      return
    }
    setCameraStarting(true)
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      cameraStreamRef.current = stream
      setCameraActive(true)
    } catch (cameraError) {
      console.error('open local resident document camera failed', cameraError)
      if (mountedRef.current) {
        setError(cameraError.name === 'NotAllowedError' || cameraError.name === 'SecurityError'
          ? labels.cameraDenied
          : labels.cameraFailed)
      }
    } finally {
      if (mountedRef.current) setCameraStarting(false)
    }
  }

  const capturePage = () => {
    const video = cameraVideoRef.current
    if (!video?.videoWidth || !video.videoHeight) {
      setError(labels.errors.capture)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      setError(labels.errors.capture)
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setError(labels.errors.capture)
        return
      }
      const capturedFile = createCameraScanFile(blob)
      const nextFiles = [...files, capturedFile]
      const validationError = userFileError(validateResidentScanFiles(nextFiles), labels)
      if (validationError) {
        setError(validationError)
        return
      }
      setError('')
      setMessage('')
      setMatches([])
      setRecognizedPages([])
      setEntries([])
      setFiles(nextFiles)
      appendImageUrl(URL.createObjectURL(capturedFile))
    }, 'image/jpeg', 0.9)
  }

  const chooseFiles = (event) => {
    const selected = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    stopCamera()
    const validationError = userFileError(validateResidentScanFiles(selected), labels)
    setError(validationError)
    setMessage('')
    setMatches([])
    setFiles(validationError ? [] : selected)
    replaceImageUrls(validationError ? [] : selected.map((file) => URL.createObjectURL(file)))
    setRecognizedPages([])
    setEntries([])
  }

  const scanDocuments = async () => {
    const validationError = userFileError(validateResidentScanFiles(files), labels)
    if (validationError) {
      setError(validationError)
      return
    }
    setScanning(true)
    setError('')
    setMessage('')
    setRecognizedPages([])
    setProgress(0)
    setCurrentPage(0)
    setPageProgress(0)
    try {
      const tesseract = await import('tesseract.js')
      const { createWorker, OEM } = tesseract.default || tesseract
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${OCR_ASSET_BASE}/worker.min.js`,
        langPath: OCR_ASSET_BASE,
        corePath: `${OCR_ASSET_BASE}/tesseract-core-lstm.wasm.js`,
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
        logger: (status) => {
          if (!mountedRef.current || typeof status.progress !== 'number') return
          setPageProgress(Math.round(status.progress * 100))
        },
      })
      workerRef.current = worker
      const results = []
      for (const [index, file] of files.entries()) {
        if (!mountedRef.current) return
        setCurrentPage(index + 1)
        setPageProgress(0)
        const { data } = await worker.recognize(file)
        results.push({ text: data.text || '', imageIndex: index })
        if (mountedRef.current) {
          setRecognizedPages([...results])
          setProgress(Math.round(((index + 1) / files.length) * 100))
        }
      }
      setEntries((current) => current.length ? current : files.flatMap((_, index) => [emptyResident(`scan-${index}-1`, index + 1)]))
    } catch (scanError) {
      console.error('resident document OCR failed', scanError)
      if (mountedRef.current) setError(scanError.message || labels.errors.load)
    } finally {
      const worker = workerRef.current
      workerRef.current = null
      if (worker) {
        try {
          await worker.terminate()
        } catch (terminationError) {
          console.error('terminate local resident document OCR worker failed', terminationError)
        }
      }
      if (mountedRef.current) setScanning(false)
    }
  }

  const updateEntry = (id, field, value) => {
    setEntries((current) => current.map((entry) => entry.id === id
      ? { ...entry, [field]: value, ...(field === 'checked' ? {} : { checked: false }) }
      : entry))
    setMatches([])
    setMessage('')
  }

  const importEntries = async (confirmPotentialMatches = false) => {
    const residents = entries.map((entry) => ({
      firstName: entry.firstName.trim(),
      lastName: entry.lastName.trim(),
      birthDate: entry.birthDate || null,
      sex: entry.sex || null,
      householdId: entry.householdId.trim() || null,
      zone: entry.zone || null,
      purok: entry.purok.trim() || null,
      sourceReference: entry.sourceReference.trim() || null,
    }))
    if (!entries.length || entries.some((entry) => (
      !entry.checked || !entry.firstName.trim() || !entry.lastName.trim() || !['Male', 'Female'].includes(entry.sex)
    ))) {
      setError(labels.ready)
      return
    }
    setImporting(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_BASE}/staff/residents/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'local-document-scan.csv',
          residents,
          confirmPotentialMatches,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.reviewRequired && Array.isArray(data.potentialMatches)) {
        setMatches(data.potentialMatches)
        return
      }
      if (!response.ok) throw new Error(data.message || labels.ready)
      setEntries([])
      setMatches([])
      setRecognizedPages([])
      setFiles([])
      replaceImageUrls([])
      setResetKey((key) => key + 1)
      setMessage(`${data.imported || residents.length} ${labels.imported}`)
    } catch (importError) {
      console.error('import reviewed local document scan failed', importError)
      setError(importError.message || labels.ready)
    } finally {
      setImporting(false)
    }
  }

  const clearScan = () => {
    if (scanning || importing) return
    stopCamera()
    setFiles([])
    replaceImageUrls([])
    setRecognizedPages([])
    setEntries([])
    setMatches([])
    setError('')
    setMessage('')
    setResetKey((key) => key + 1)
  }

  return (
    <section className="registry-scan" aria-labelledby="registry-scan-title">
      <div>
        <h4 id="registry-scan-title">{labels.title}</h4>
        <p>{labels.privacy}</p>
      </div>
      <div className="registry-scan-controls">
        <label>
          {labels.choose}
          <input key={resetKey} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple disabled={scanning || importing} onChange={chooseFiles} />
        </label>
        {!cameraActive
          ? <button type="button" className="secondary-btn small" disabled={scanning || importing || cameraStarting} onClick={openCamera}>{cameraStarting ? labels.scanning : labels.openCamera}</button>
          : <>
            <button type="button" className="primary-btn small" disabled={scanning || importing} onClick={capturePage}>{labels.capturePage}</button>
            <button type="button" className="secondary-btn small" disabled={scanning || importing} onClick={stopCamera}>{labels.stopCamera}</button>
          </>}
        <button type="button" className="primary-btn small" disabled={!files.length || scanning || importing} onClick={scanDocuments}>
          {scanning ? `${labels.scanning} ${currentPage}/${files.length} · ${pageProgress}%` : labels.scan}
        </button>
        {files.length > 0 && <button type="button" className="secondary-btn small" disabled={scanning || importing} onClick={clearScan}>{labels.clear}</button>}
      </div>
      {cameraActive && <video ref={cameraVideoRef} className="registry-scan-camera" autoPlay playsInline muted aria-label={labels.cameraPreview} />}
      {scanning && <progress className="registry-scan-progress" max="100" value={progress} aria-label={`${labels.scanning} ${currentPage}/${files.length}`} />}
      {error && <p className="registry-message error" role="alert">{error}</p>}
      {message && <p className="registry-message" role="status">{message}</p>}
      {recognizedPages.map((page, index) => (
        <details className="registry-scan-page" key={`${page.imageIndex}-${index}`} open>
          <summary>{labels.ocrPage} {page.imageIndex + 1}</summary>
          {imageUrls[page.imageIndex] && <img className="registry-scan-preview" src={imageUrls[page.imageIndex]} alt={`${labels.ocrPage} ${page.imageIndex + 1}`} />}
          <textarea aria-label={`${labels.ocrPage} ${page.imageIndex + 1}`} rows={8} readOnly value={page.text || labels.empty} />
        </details>
      ))}
      {recognizedPages.length > 0 && (
        <div className="registry-scan-draft">
          <div>
            <h4>{labels.draftTitle}</h4>
            <p>{labels.draftHelp}</p>
          </div>
          <div className="registry-scan-rows">
            {entries.map((entry) => (
              <fieldset className="registry-scan-row" key={entry.id}>
                <div className="registry-scan-fields">
                  <label>{labels.firstName}<input autoComplete="off" maxLength={100} value={entry.firstName} onChange={(event) => updateEntry(entry.id, 'firstName', event.target.value)} /></label>
                  <label>{labels.lastName}<input autoComplete="off" maxLength={100} value={entry.lastName} onChange={(event) => updateEntry(entry.id, 'lastName', event.target.value)} /></label>
                  <label>{labels.birthDate}<input type="date" value={entry.birthDate} onChange={(event) => updateEntry(entry.id, 'birthDate', event.target.value)} /></label>
                  <label>{labels.sex}<select value={entry.sex} onChange={(event) => updateEntry(entry.id, 'sex', event.target.value)} required><option value="">{labels.selectSex}</option><option value="Male">{labels.male}</option><option value="Female">{labels.female}</option></select></label>
                  <label>{labels.household}<input autoComplete="off" maxLength={100} value={entry.householdId} onChange={(event) => updateEntry(entry.id, 'householdId', event.target.value)} /></label>
                  <label>{labels.zone}<select value={entry.zone} onChange={(event) => updateEntry(entry.id, 'zone', event.target.value)}><option value="">—</option>{[1, 2, 3, 4, 5, 6, 7].map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
                  <label>{labels.purok}<input autoComplete="off" maxLength={100} value={entry.purok} onChange={(event) => updateEntry(entry.id, 'purok', event.target.value)} /></label>
                  <label>{labels.source}<input autoComplete="off" maxLength={255} value={entry.sourceReference} onChange={(event) => updateEntry(entry.id, 'sourceReference', event.target.value)} /></label>
                </div>
                <div className="registry-scan-row-actions">
                  <label className="registry-scan-check"><input type="checkbox" checked={entry.checked} onChange={(event) => updateEntry(entry.id, 'checked', event.target.checked)} />{labels.checked}</label>
                  <button type="button" className="secondary-btn small" disabled={importing} onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}>{labels.remove}</button>
                </div>
              </fieldset>
            ))}
          </div>
          <div className="registry-row-actions">
            <button type="button" className="secondary-btn small" disabled={importing || entries.length >= 500} onClick={() => setEntries((current) => [...current, emptyResident(`scan-${Date.now()}-${current.length}`, current.length + 1)])}>{labels.addRow}</button>
            <span>{labels.rowLimit}</span>
            <button type="button" className="primary-btn small" disabled={!entries.length || importing || entries.some((entry) => !entry.checked || !entry.firstName.trim() || !entry.lastName.trim() || !['Male', 'Female'].includes(entry.sex))} onClick={() => importEntries(false)}>{importing ? labels.importing : labels.import}</button>
          </div>
          {matches.length > 0 && (
            <div className="registry-message warning" role="alert">
              <strong>{labels.duplicate}</strong>
              <ul>{matches.map((match, index) => <li key={`${match.row}-${index}`}>Row {match.row}: {match.records.map((record) => `${record.firstName} ${record.lastName}`).join(', ')}</li>)}</ul>
              <div className="registry-row-actions">
                <button type="button" className="primary-btn small" disabled={importing} onClick={() => importEntries(true)}>{labels.confirmMatches}</button>
                <button type="button" className="secondary-btn small" disabled={importing} onClick={() => setMatches([])}>{labels.cancelMatches}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
