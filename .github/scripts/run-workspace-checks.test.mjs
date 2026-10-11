import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./run-workspace-checks.mjs', import.meta.url))

test('rejects invalid concurrency instead of reporting an empty run as green', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workspace-checks-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const npm = path.join(dir, 'npm')
  const marker = path.join(dir, 'ran-check')
  writeFileSync(
    npm,
    `#!/bin/sh\nif [ "$1" = query ]; then printf '%s\\n' '[{"location":"sample","scripts":{"check":"true"}}]'; else touch "$MARKER"; fi\n`,
  )
  chmodSync(npm, 0o755)

  const result = spawnSync(process.execPath, [script, '--concurrency', 'not-a-number'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MARKER: marker },
  })

  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /--concurrency must be a finite number/)
  assert.doesNotMatch(result.stdout, /all 1 checks passed/)
})
