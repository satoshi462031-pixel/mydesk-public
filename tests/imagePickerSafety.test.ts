import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(path)
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) yield path
  }
}

describe('image picker safety', () => {
  it('写真ライブラリはユーザー操作を失わない共通関数からだけ開く', () => {
    const root = join(__dirname, '..')
    const src = join(root, 'src')
    const owner = 'src/utils/imagePicker.ts'
    const violations: string[] = []

    for (const path of sourceFiles(src)) {
      const file = relative(root, path).replace(/\\/g, '/')
      if (file === owner) continue
      const source = readFileSync(path, 'utf8')
      if (/\b(?:launchImageLibraryAsync|requestMediaLibraryPermissionsAsync)\s*\(/.test(source)) {
        violations.push(file)
      }
    }

    assert.deepEqual(violations, [])
  })
})
