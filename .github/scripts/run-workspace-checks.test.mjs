import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./run-workspace-checks.mjs', import.meta.url))

function makeFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'workspace-checks-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const npm = path.join(dir, 'npm')
  const marker = path.join(dir, 'ran-checks')
  writeFileSync(
    npm,
    `#!/bin/sh\nif [ "$1" = query ]; then printf '%s\\n' '[{"location":"sample-a","scripts":{"check":"true"}},{"location":"sample-b","scripts":{"check":"true"}}]'; else printf '%s\\n' "$3" >> "$MARKER"; fi\n`,
  )
  chmodSync(npm, 0o755)
  return { dir, marker }
}

function runRunner(dir, marker, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MARKER: marker },
  })
}

test('rejects non-finite and fractional concurrency before running any checks', (t) => {
  for (const value of ['1.9', 'not-a-number', 'NaN', 'Infinity', '-1.5']) {
    const { dir, marker } = makeFixture(t)
    const result = runRunner(dir, marker, ['--concurrency', value])

    assert.notEqual(result.status, 0, `${value}: ${result.stdout}`)
    assert.match(result.stderr, /--concurrency must be a finite integer/, value)
    assert.equal(existsSync(marker), false, `${value}: a workspace check ran`)
  }
})

test('runs checks with a normal explicit concurrency and reports that worker count', (t) => {
  const { dir, marker } = makeFixture(t)
  const result = runRunner(dir, marker, ['--concurrency', '2'])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /running 2 checks, up to 2 at a time:/)
  assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n').sort(), ['sample-a', 'sample-b'])
})

test('caps and reports the worker count to the number of discovered checks', (t) => {
  const { dir, marker } = makeFixture(t)
  const result = runRunner(dir, marker, ['--concurrency', '9'])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /running 2 checks, up to 2 at a time:/)
  assert.equal(readFileSync(marker, 'utf8').trim().split('\n').length, 2)
})

test('reports the default concurrency used when the flag is omitted', (t) => {
  const { dir, marker } = makeFixture(t)
  const result = runRunner(dir, marker)
  const expected = Math.min(2, availableParallelism())

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`running 2 checks, up to ${expected} at a time:`))
  assert.equal(readFileSync(marker, 'utf8').trim().split('\n').length, 2)
})

test('clamps empty, zero, and negative integer values to one worker', (t) => {
  for (const value of ['', '0', '-3']) {
    const { dir, marker } = makeFixture(t)
    const result = runRunner(dir, marker, ['--concurrency', value])

    assert.equal(result.status, 0, `${value}: ${result.stderr}`)
    assert.match(result.stdout, /running 2 checks, up to 1 at a time:/, value)
    assert.equal(readFileSync(marker, 'utf8').trim().split('\n').length, 2, value)
  }
})
