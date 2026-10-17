import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(projectRoot, 'public', 'ocr')
const tesseractDirectory = path.resolve(path.dirname(require.resolve('tesseract.js')), '..')
const coreDirectory = path.dirname(require.resolve('tesseract.js-core'))
const englishDataDirectory = path.dirname(require.resolve('@tesseract.js-data/eng'))

const assets = [
  [path.join(tesseractDirectory, 'dist', 'worker.min.js'), 'worker.min.js'],
  [path.join(tesseractDirectory, 'dist', 'worker.min.js.LICENSE.txt'), 'worker.min.js.LICENSE.txt'],
  [path.join(tesseractDirectory, 'LICENSE.md'), 'tesseract.js.LICENSE.md'],
  [path.join(coreDirectory, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [path.join(coreDirectory, 'tesseract-core-lstm.wasm'), 'tesseract-core-lstm.wasm'],
  [path.join(coreDirectory, 'LICENSE'), 'tesseract-core.LICENSE'],
  [path.join(englishDataDirectory, '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
]

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

for (const [source, destination] of assets) {
  await copyFile(source, path.join(outputDirectory, destination))
}
