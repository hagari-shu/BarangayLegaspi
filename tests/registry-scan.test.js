import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SCAN_FILE_SIZE,
  MAX_SCAN_FILES,
  validateResidentScanFiles,
} from '../src/registry-scan.js'

const image = (size, type = 'image/jpeg') => ({ size, type })

test('document scanner accepts supported images within file and batch limits', () => {
  assert.equal(validateResidentScanFiles([image(MAX_SCAN_FILE_SIZE), image(1, 'image/png')]), '')
})

test('document scanner rejects missing files, unsupported formats, and oversized files', () => {
  assert.match(validateResidentScanFiles([]), /at least one image/)
  assert.match(validateResidentScanFiles([image(1, 'application/pdf')]), /JPEG, PNG, or WebP/)
  assert.match(validateResidentScanFiles([image(MAX_SCAN_FILE_SIZE + 1)]), /10 MB or smaller/)
})

test('document scanner limits image count and total batch size', () => {
  assert.match(validateResidentScanFiles(Array.from({ length: MAX_SCAN_FILES + 1 }, () => image(1))), /no more than/)
  assert.match(validateResidentScanFiles(Array.from({ length: 4 }, () => image(8 * 1024 * 1024))), /total 30 MB or less/)
})
