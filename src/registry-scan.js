export const MAX_SCAN_FILES = 10
export const MAX_SCAN_FILE_SIZE = 10 * 1024 * 1024
export const MAX_SCAN_TOTAL_SIZE = 30 * 1024 * 1024

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function validateResidentScanFiles(files) {
  if (!files.length) return 'Choose at least one image to scan.'
  if (files.length > MAX_SCAN_FILES) return `Choose no more than ${MAX_SCAN_FILES} images at a time.`

  let totalSize = 0
  for (const file of files) {
    if (!supportedImageTypes.has(file.type)) return 'Use JPEG, PNG, or WebP image files only.'
    if (file.size > MAX_SCAN_FILE_SIZE) return 'Each image must be 10 MB or smaller.'
    totalSize += file.size
  }
  if (totalSize > MAX_SCAN_TOTAL_SIZE) return 'The selected images must total 30 MB or less.'
  return ''
}
