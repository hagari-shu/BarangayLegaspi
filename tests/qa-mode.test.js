import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('local QA launcher refuses to start when DATABASE_URL is configured', () => {
  const result = spawnSync(process.execPath, ['scripts/qa.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://localhost/production',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /refuses to start while DATABASE_URL is set/)
})
