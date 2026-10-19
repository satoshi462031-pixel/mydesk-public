/**
 * アイコンの「輪郭の中心 → 行ボックスの中心」のズレを MaterialCommunityIcons.ttf から求めて
 * src/constants/iconOptics.generated.ts を焼く。`npm run build:icon-optics`
 *
 * MaterialCommunityIcons は全字形の advance width が em と同じ 512 だが、輪郭はその中央に
 * あるとは限らない（多くは 24 グリッドの中央だが、下寄り・片寄りの字形がある）。円の器に
 * flex の中央寄せで置くと、その字形だけ中心から外れて見える。字形ごとのズレは実行時には
 * 測れないので、ここで先に出しておく。中心は輪郭の点から求めた外接矩形の中心（outline の注記）。
 *
 * 字形を足した・アイコンを差し替えたときは打ち直す。打ち直さないと新しいアイコンだけ
 * 補正が 0 のまま（＝これまでと同じ見た目）になる。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const VENDOR = join(ROOT, 'node_modules', '@expo', 'vector-icons', 'build', 'vendor', 'react-native-vector-icons')
const FONT = join(VENDOR, 'Fonts', 'MaterialCommunityIcons.ttf')
const GLYPHMAP = join(VENDOR, 'glyphmaps', 'MaterialCommunityIcons.json')
const OUT = join(SRC, 'constants', 'iconOptics.generated.ts')

// 補正値はこの字面サイズを基準に出し、実際の size で按分する
const BASE_SIZE = 24
// 0.05pt 未満は実機で差が出ないので載せない。表を短く保つ
const EPSILON = 0.05

const buf = readFileSync(FONT)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

const tables: Record<string, { offset: number; length: number }> = {}
const numTables = dv.getUint16(4)
for (let i = 0; i < numTables; i++) {
  const p = 12 + i * 16
  const tag = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3])
  tables[tag] = { offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12) }
}

const head = tables.head.offset
const unitsPerEm = dv.getUint16(head + 18)
const indexToLocFormat = dv.getInt16(head + 50)

const hhea = tables.hhea.offset
const ascender = dv.getInt16(hhea + 4)
const descender = dv.getInt16(hhea + 6)
const numberOfHMetrics = dv.getUint16(hhea + 34)

// 行ボックスの中心。RN は lineHeight を指定した <Text> の行を ascent/descent で組むので、
// 字形の中心をここへ寄せると円の中心に乗る
const LINE_CENTER = (ascender + descender) / 2

function locaAt(index: number): number {
  const loca = tables.loca.offset
  return indexToLocFormat === 0 ? dv.getUint16(loca + index * 2) * 2 : dv.getUint32(loca + index * 4)
}

function advanceWidth(gid: number): number {
  const hmtx = tables.hmtx.offset
  return dv.getUint16(hmtx + Math.min(gid, numberOfHMetrics - 1) * 4)
}

type Point = { x: number; y: number; onCurve: boolean }

// 字形の輪郭（点の列の集まり）。複合字形は部品を平行移動して並べる。
// glyf の見出しの外接矩形は使わない。このフォントは見出しの xMin / yMin がほぼすべて 0 で
// 書かれており（右上だけが正しい）、以前はそれを信じて chevron-left を「4.3pt 左寄り」、
// 左右対称の pause を「3pt 左寄り」と読み、中央にある字形を右へ押し出していた
function outline(gid: number): Point[][] {
  const start = locaAt(gid)
  const end = locaAt(gid + 1)
  // 輪郭を持たない字形（空白など）
  if (end <= start) return []
  const g = tables.glyf.offset + start
  const contours = dv.getInt16(g)
  return contours < 0 ? compositeOutline(g) : simpleOutline(g, contours)
}

function simpleOutline(g: number, contourCount: number): Point[][] {
  let p = g + 10
  const ends: number[] = []
  for (let i = 0; i < contourCount; i++) { ends.push(dv.getUint16(p)); p += 2 }
  const count = (ends[ends.length - 1] ?? -1) + 1
  if (count <= 0) return []
  p += 2 + dv.getUint16(p)
  const flags: number[] = []
  while (flags.length < count) {
    const flag = buf[p++]
    flags.push(flag)
    // 繰り返し指定（bit 3）。次の1バイトが追加の回数
    if (flag & 0x08) {
      for (let repeat = buf[p++]; repeat > 0; repeat--) flags.push(flag)
    }
  }
  const xs: number[] = []
  let x = 0
  for (const flag of flags) {
    if (flag & 0x02) { const d = buf[p++]; x += flag & 0x10 ? d : -d }
    else if (!(flag & 0x10)) { x += dv.getInt16(p); p += 2 }
    xs.push(x)
  }
  const ys: number[] = []
  let y = 0
  for (const flag of flags) {
    if (flag & 0x04) { const d = buf[p++]; y += flag & 0x20 ? d : -d }
    else if (!(flag & 0x20)) { y += dv.getInt16(p); p += 2 }
    ys.push(y)
  }
  const result: Point[][] = []
  let from = 0
  for (const last of ends) {
    const contour: Point[] = []
    for (let i = from; i <= last; i++) contour.push({ x: xs[i], y: ys[i], onCurve: (flags[i] & 0x01) === 1 })
    result.push(contour)
    from = last + 1
  }
  return result
}

// 拡大・回転つきの部品はこのフォントに無い前提。あれば黙って誤った補正を焼かずに止める
function compositeOutline(g: number): Point[][] {
  let p = g + 10
  const result: Point[][] = []
  for (;;) {
    const flags = dv.getUint16(p)
    const component = dv.getUint16(p + 2)
    p += 4
    const wordArgs = flags & 0x0001
    const dx = wordArgs ? dv.getInt16(p) : dv.getInt8(p)
    const dy = wordArgs ? dv.getInt16(p + 2) : dv.getInt8(p + 1)
    p += wordArgs ? 4 : 2
    if (!(flags & 0x0002)) throw new Error(`字形 ${component}: 点の対応で置く複合字形には対応していない`)
    if (flags & (0x0008 | 0x0040 | 0x0080)) throw new Error(`字形 ${component}: 拡大・回転つきの複合字形には対応していない`)
    for (const contour of outline(component)) result.push(contour.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })))
    if (!(flags & 0x0020)) return result
  }
}

// 二次ベジェの輪郭を折れ線にする。連続する制御点の間には暗黙の端点がある（TrueType の規則）
const CURVE_STEPS = 8
function flatten(contour: Point[]): { x: number; y: number }[] {
  if (contour.length === 0) return []
  const firstOn = contour.findIndex((pt) => pt.onCurve)
  // 全点が制御点の輪郭は、最初の2点の中点から始める
  const start = firstOn >= 0
    ? contour[firstOn]
    : { x: (contour[0].x + contour[1 % contour.length].x) / 2, y: (contour[0].y + contour[1 % contour.length].y) / 2, onCurve: true }
  const offset = firstOn >= 0 ? firstOn : 0
  const out = [{ x: start.x, y: start.y }]
  let current = start
  let control: Point | null = null
  for (let k = 1; k <= contour.length; k++) {
    const pt = firstOn >= 0 && k === contour.length ? start : contour[(offset + k) % contour.length]
    if (!pt.onCurve) {
      if (control) {
        const mid = { x: (control.x + pt.x) / 2, y: (control.y + pt.y) / 2, onCurve: true }
        pushCurve(out, current, control, mid)
        current = mid
      }
      control = pt
      continue
    }
    if (control) pushCurve(out, current, control, pt)
    else out.push({ x: pt.x, y: pt.y })
    current = pt
    control = null
  }
  if (control) pushCurve(out, current, control, start)
  return out
}

function pushCurve(out: { x: number; y: number }[], a: Point, c: Point, b: Point) {
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS
    const u = 1 - t
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y })
  }
}

// 輪郭の外接矩形の中心。曲線は折れ線にしてから測る（制御点で測ると曲線の外側まで含む）
function inkCenter(gid: number): { x: number; y: number } | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const contour of outline(gid)) {
    for (const pt of flatten(contour)) {
      if (pt.x < xMin) xMin = pt.x
      if (pt.x > xMax) xMax = pt.x
      if (pt.y < yMin) yMin = pt.y
      if (pt.y > yMax) yMax = pt.y
    }
  }
  if (xMin > xMax) return null
  return { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 }
}

// 図案のほうで見た目の中心に置いてある字形。外接矩形の中心へ寄せると崩れるので補正しない。
// 再生の三角形は重心を中央に置くために右へ寄せて描かれており、矩形の中心に揃えると左に偏って見える。
// （重心で揃える方式も試したが、人の形・三日月などが 2〜5pt 動いて行き過ぎた）
const KEEP_DESIGNED_POSITION = new Set(['play', 'play-outline'])

function buildCmap(): Map<number, number> {
  const cmap = tables.cmap.offset
  const count = dv.getUint16(cmap + 2)
  let chosen: { offset: number; format: number } | null = null
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8
    const offset = cmap + dv.getUint32(record + 4)
    const format = dv.getUint16(offset)
    // format 12 があればそちらを優先する（BMP 外の字形まで引ける）
    if (format === 12) chosen = { offset, format }
    else if (format === 4 && !chosen) chosen = { offset, format }
  }
  if (!chosen) throw new Error('MaterialCommunityIcons.ttf に読める cmap が無い')

  const map = new Map<number, number>()
  if (chosen.format === 4) {
    const { offset } = chosen
    const segX2 = dv.getUint16(offset + 6)
    const segments = segX2 / 2
    const endP = offset + 14
    const startP = endP + segX2 + 2
    const deltaP = startP + segX2
    const rangeP = deltaP + segX2
    for (let s = 0; s < segments; s++) {
      const endCode = dv.getUint16(endP + s * 2)
      const startCode = dv.getUint16(startP + s * 2)
      const delta = dv.getInt16(deltaP + s * 2)
      const rangeOffset = dv.getUint16(rangeP + s * 2)
      for (let code = startCode; code <= endCode && code !== 0xffff; code++) {
        let gid: number
        if (rangeOffset === 0) gid = (code + delta) & 0xffff
        else {
          gid = dv.getUint16(rangeP + s * 2 + rangeOffset + (code - startCode) * 2)
          if (gid !== 0) gid = (gid + delta) & 0xffff
        }
        if (gid !== 0) map.set(code, gid)
      }
    }
  } else {
    const { offset } = chosen
    const groups = dv.getUint32(offset + 12)
    for (let g = 0; g < groups; g++) {
      const p = offset + 16 + g * 12
      const startCode = dv.getUint32(p)
      const endCode = dv.getUint32(p + 4)
      const startGid = dv.getUint32(p + 8)
      for (let code = startCode; code <= endCode; code++) map.set(code, startGid + (code - startCode))
    }
  }
  return map
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const glyphmap = JSON.parse(readFileSync(GLYPHMAP, 'utf8')) as Record<string, number>
const cmap = buildCmap()

// src に出てくる文字列のうち、字形として存在するものだけを拾う。
// ICONS / CATEGORY_ICONS の値もここで一緒に拾われる
const used = new Set<string>()
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"]/g)) {
    const name = match[1]
    if (glyphmap[name] !== undefined) used.add(name)
  }
}

const entries: string[] = []
let skipped = 0
for (const name of [...used].sort()) {
  const gid = cmap.get(glyphmap[name])
  if (gid === undefined) continue
  if (KEEP_DESIGNED_POSITION.has(name)) continue
  const center = inkCenter(gid)
  if (!center) continue
  const scale = BASE_SIZE / unitsPerEm
  const dx = (advanceWidth(gid) / 2 - center.x) * scale
  const dy = (center.y - LINE_CENTER) * scale
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
    skipped++
    continue
  }
  const round = (v: number) => (Math.abs(v) < EPSILON ? 0 : Number(v.toFixed(2)))
  entries.push(`  '${name}': [${round(dx)}, ${round(dy)}],`)
}

const out = `// 自動生成（npm run build:icon-optics）。手で編集しない。
// 字形の輪郭の中心と行ボックスの中心のズレ。${BASE_SIZE}pt 基準で [x, y]（右・下が正）。
// 円の器にアイコンを置くとき、この量だけずらすと中心に乗る。
export const ICON_OPTICAL_OFFSETS: Readonly<Record<string, readonly [x: number, y: number]>> = {
${entries.join('\n')}
}

// 補正値を出したときの字面サイズ。実際の size ではこの比で按分する
export const ICON_OPTICS_BASE_SIZE = ${BASE_SIZE}
`

writeFileSync(OUT, out)
console.log(`アイコンの光学補正: ${entries.length} 件を書き出した（ズレ無し ${skipped} 件は省略）`)
