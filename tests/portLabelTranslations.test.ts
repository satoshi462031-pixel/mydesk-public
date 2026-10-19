import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

// ポートのラベルは日本語で保存され、表示のときだけ辞書で英語へ引き直す
// （localizedPortLabel / portFormFieldLabel）。どちらも辞書に無ければ
// `?? もとのラベル` で素通しするため、訳を足し忘れても何も起きず、
// 英語表示に日本語だけが残る。実際に 290 種のうち 279 種が抜けていた。
//
// ソースを読んで突き合わせるのは、ラベルがプリセット・フォーム定義・
// テンプレートに散っていて、実行時に import して集められないため。
// tsconfig の include を増やさずに済む利点もある。

const ROOT = path.join(__dirname, '..')
const JP = /[぀-ヿ一-龯]/

/** `const NAME = { ... }` の中身からキーだけを抜く */
function dictKeys(src: string, name: string): Set<string> {
  const at = src.indexOf(name)
  assert.notEqual(at, -1, `${name} が見つからない`)
  const open = src.indexOf('{', at)
  let depth = 0, i = open, quote = ''
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = ''
      i++; continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i++; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return new Set([...src.slice(open, i).matchAll(/'([^']+)'\s*:/g)].map((m) => m[1]))
}

/** ポートを定義しているファイル。ここに label / portLabel を書くと保存値になる */
const PORT_SOURCES = [
  'src/constants/gadgetPresets.ts',
  'src/constants/portFormConfig.ts',
  'src/constants/demoDesks.ts',
  'src/constants/deskTemplates.ts',
  'src/utils/gadgetPorts.ts',
  'src/utils/wiringEngine.ts',
  'src/services/templateService.ts',
  'src/store/gadgetStore.ts',
]

test('日本語のポートラベルには必ず英訳がある', () => {
  const portTypes = fs.readFileSync(path.join(ROOT, 'src/constants/portTypes.ts'), 'utf8')
  const portForm = fs.readFileSync(path.join(ROOT, 'src/constants/portFormConfig.ts'), 'utf8')
  const covered = new Set([
    ...dictKeys(portTypes, 'SAVED_PORT_LABELS_EN'),
    ...dictKeys(portForm, 'PORT_FORM_LABELS_EN'),
  ])

  const found = new Set<string>()
  for (const rel of PORT_SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    for (const m of src.matchAll(/(?:portLabel|label)\s*:\s*'([^']+)'/g)) {
      if (JP.test(m[1])) found.add(m[1])
    }
  }

  const missing = [...found].filter((label) => !covered.has(label)).sort()
  assert.deepEqual(
    missing,
    [],
    `英訳の無いポートラベルがある。src/constants/portTypes.ts の SAVED_PORT_LABELS_EN へ足すこと:\n  ${missing.join('\n  ')}`,
  )
})

test('英訳辞書に、もう使われていないラベルが残っていない', () => {
  const portTypes = fs.readFileSync(path.join(ROOT, 'src/constants/portTypes.ts'), 'utf8')
  const saved = dictKeys(portTypes, 'SAVED_PORT_LABELS_EN')

  // 保存済みのガジェットは古いラベルを持ち続けるので、辞書から消すのは危険。
  // ここは「消し忘れ」ではなく「打ち間違い」を見つけるための確認にとどめ、
  // 実際に使われている語との差だけを報告する。
  const all = PORT_SOURCES
    .map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    .join('\n')

  const orphans = [...saved].filter((label) => !all.includes(`'${label}'`))
  assert.ok(
    orphans.length <= saved.size,
    `辞書のキーが全部どこにも無い。突き合わせが壊れている: ${orphans.length}/${saved.size}`,
  )
})
