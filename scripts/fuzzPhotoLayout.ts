/**
 * デスク写真に写っているような配置を再現し、配線図がどうなるかを試す。
 *
 * fuzzManualLayout.ts はノードを無作為に飛ばす極端な配置を撃つが、こちらは
 * 「実物の机の上の並び」を作る。写真の机は自動配置よりずっと詰まっていて、
 * モニターの真下にキーボードが接し、スピーカーは本体の真横に密着し、
 * 手前の機器は奥の機器と重なって写る。実ユーザーがドラッグで作る配置はこちら。
 *
 * 机の型は国内の定番だけでなく、海外のセットアップ記事と外出・車載の実例から取っている
 * （ウルトラワイド＋モニターアーム＋USB-Cドック、ポータブルモニター＋モバイルバッテリー、
 * ポータブル電源＋ソーラー＋Starlink など）。外出構成はコンセントが無く、
 * 電源ソースが wall ではなく battery / solar になるため配線エンジンの別経路を通る。
 *
 *   npx tsx scripts/fuzzPhotoLayout.ts [件数] [--seed=N] [--compare] [--shard=i/N]
 */
import { fork } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { generateWiring } from '../src/utils/wiringEngine'
import {
  AUDIO_INTERFACE_PRESETS, GADGET_PRESETS, PASSIVE_SPEAKER_PRESETS,
} from '../src/constants/gadgetPresets'
import type { DeskPlan, DeskZone, Gadget, GadgetCategory, MapConnection } from '../src/types'
import {
  computeMapLayout, reconcileMap, type MapLayout, type MapNode,
} from '../src/utils/connectionMapLayout'

// yieldToEventLoop の setTimeout(0) は Node では最低 1ms 待つ。計算内容は変えずに待ちだけ潰す。
const realSetTimeout = globalThis.setTimeout
;(globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  if (!ms) { queueMicrotask(() => fn(...args)); return 0 }
  return realSetTimeout(fn, ms, ...(args as []))
}) as typeof setTimeout

type Rng = () => number
const makeRandom = (seed: number): Rng => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 0x100000000
  }
}
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length]
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))
const range = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo)

// ─── 写真に写るデスクの型 ───────────────────────────────────────
// region: 'jp' 国内 / 'intl' 海外の記事に多い構成 / 'mobile' 外出・車載
type DeskKind = {
  name: string
  region: 'jp' | 'intl' | 'mobile'
  categories: GadgetCategory[]
  zones: Partial<Record<GadgetCategory, DeskZone>>
  /** 壁コンセントの口数。外出構成は 0（電源は本体バッテリー・モバイルバッテリー・ソーラー） */
  outlets: [number, number]
  /** ノートPCが主役か（写真では本体が机の中央に来る） */
  laptop?: boolean
  /** 一部の機器を充電式・ソーラー給電にする（外出構成で wall 以外の電源ソースを踏むため） */
  offGrid?: boolean
}

const DESK_KINDS: DeskKind[] = [
  // ── 国内の定番 ──
  {
    name: '在宅ワーク',
    region: 'jp',
    categories: ['PC', 'Monitor', 'Keyboard', 'Mouse', 'Dock', 'Desk', 'Chair', 'PowerStrip', 'Light', 'Headphone'],
    zones: { Monitor: 'back_center', Keyboard: 'front_center', Mouse: 'front_right', PC: 'under_desk', PowerStrip: 'under_desk', Light: 'back_left' },
    outlets: [2, 6],
  },
  {
    name: 'デュアルモニター',
    region: 'jp',
    categories: ['PC', 'Monitor', 'Monitor', 'Keyboard', 'Mouse', 'Speaker', 'Speaker', 'Webcam', 'Desk', 'Chair', 'PowerStrip', 'Hub'],
    zones: { Monitor: 'back_center', Keyboard: 'front_center', Mouse: 'front_right', PC: 'under_desk', PowerStrip: 'under_desk', Webcam: 'back_center' },
    outlets: [2, 6],
  },
  {
    name: 'ノートPC中心',
    region: 'jp',
    categories: ['PC', 'Monitor', 'Mouse', 'Dock', 'Desk', 'Chair', 'PowerStrip', 'Storage'],
    zones: { PC: 'front_center', Monitor: 'back_center', Mouse: 'front_right', Dock: 'desk_right', PowerStrip: 'under_desk' },
    outlets: [2, 5],
    laptop: true,
  },
  {
    name: 'ゲーミング',
    region: 'jp',
    categories: ['PC', 'Monitor', 'Monitor', 'GameConsole', 'Keyboard', 'Mouse', 'Headphone', 'Speaker', 'Controller', 'Light', 'PowerStrip', 'Desk', 'Chair'],
    zones: { Monitor: 'back_center', GameConsole: 'desk_right', Keyboard: 'front_center', Mouse: 'front_right', PowerStrip: 'under_desk', PC: 'under_desk' },
    outlets: [3, 8],
  },
  {
    name: '配信',
    region: 'jp',
    categories: ['PC', 'Monitor', 'Monitor', 'Webcam', 'Microphone', 'MicArm', 'Light', 'Light', 'CaptureDevice', 'Keyboard', 'Mouse', 'Headphone', 'PowerStrip', 'Desk'],
    zones: { Monitor: 'back_center', Webcam: 'back_center', Microphone: 'desk_left', Light: 'back_left', Keyboard: 'front_center', Mouse: 'front_right', PowerStrip: 'under_desk' },
    outlets: [3, 8],
  },
  {
    name: 'DTM',
    region: 'jp',
    categories: ['PC', 'Monitor', 'AudioInterface', 'Speaker', 'Speaker', 'Microphone', 'Headphone', 'Keyboard', 'Mouse', 'Storage', 'PowerStrip', 'Desk'],
    zones: { Monitor: 'back_center', AudioInterface: 'desk_right', Speaker: 'back_left', Microphone: 'desk_left', Keyboard: 'front_center', PowerStrip: 'under_desk' },
    outlets: [3, 6],
  },

  // ── 海外のセットアップ記事に多い構成 ──
  // ウルトラワイド1枚をアームで浮かせ、USB-Cドック1本に集約してケーブルトレイへ落とす
  {
    name: '海外ウルトラワイド',
    region: 'intl',
    categories: ['PC', 'Monitor', 'MonitorArm', 'Dock', 'Keyboard', 'Mouse', 'Speaker', 'Speaker', 'Webcam', 'Headphone', 'Light', 'PowerStrip', 'Desk', 'Chair'],
    zones: { Monitor: 'back_center', Keyboard: 'front_center', Mouse: 'front_right', Dock: 'desk_right', PC: 'under_desk', PowerStrip: 'under_desk', Light: 'back_left' },
    outlets: [2, 6],
  },
  // デュアルをそれぞれアームで支え、ネットワーク機器まで机に載る欧米の在宅勤務構成
  {
    name: '海外デュアルアーム',
    region: 'intl',
    categories: ['PC', 'Monitor', 'Monitor', 'MonitorArm', 'MonitorArm', 'Dock', 'Keyboard', 'Mouse', 'Webcam', 'Microphone', 'Router', 'NetworkSwitch', 'PowerStrip', 'Desk', 'Chair'],
    zones: { Monitor: 'back_center', Keyboard: 'front_center', Mouse: 'front_right', Dock: 'desk_right', Router: 'under_desk', PowerStrip: 'under_desk', PC: 'under_desk' },
    outlets: [4, 8],
  },
  // 大画面1枚にPCとゲーム機を集約する構成（TVカテゴリは商品データが無いので大型モニターで代用）
  {
    name: '海外大画面ゲーム',
    region: 'intl',
    categories: ['Monitor', 'PC', 'GameConsole', 'GameConsole', 'Speaker', 'Speaker', 'Headphone', 'Keyboard', 'Mouse', 'PowerStrip', 'Desk', 'Chair'],
    zones: { Monitor: 'back_center', GameConsole: 'desk_right', Keyboard: 'front_center', Mouse: 'front_right', PowerStrip: 'under_desk', PC: 'under_desk' },
    outlets: [4, 8],
  },
  // ネットワーク機器と外付けストレージを机の下に固定するホームラボ寄りの構成
  // （KVM・スイッチングハブ・UPS は商品データが無いのでルーター／USBハブ／電源タップで代用）
  {
    name: '海外ホームラボ',
    region: 'intl',
    categories: ['PC', 'Monitor', 'Monitor', 'MonitorArm', 'MonitorArm', 'Router', 'Hub', 'Dock', 'Storage', 'Storage', 'Storage', 'Keyboard', 'Mouse', 'PowerStrip', 'PowerStrip', 'Desk', 'Chair'],
    zones: { Monitor: 'back_center', Keyboard: 'front_center', Mouse: 'front_right', Router: 'under_desk', PowerStrip: 'under_desk', PC: 'under_desk', Dock: 'desk_right' },
    outlets: [4, 8],
  },

  // ── 外出・持ち運び（コンセントが無い / 1口だけ）──
  // カフェのテーブル。ノートPC＋ポータブルモニターをUSB-C1本で繋ぎ、電源はモバイルバッテリー
  {
    name: 'カフェ',
    region: 'mobile',
    categories: ['PC', 'Monitor', 'Mouse', 'MobileBattery', 'Headphone', 'Smartphone'],
    zones: { PC: 'front_center', Monitor: 'back_center', Mouse: 'front_right' },
    outlets: [0, 0],
    laptop: true,
    offGrid: true,
  },
  // ホテル・コワーキング。コンセントが1〜2口あり、充電器を挟む
  {
    name: 'ホテル/コワーキング',
    region: 'mobile',
    categories: ['PC', 'Monitor', 'Keyboard', 'Mouse', 'Charger', 'Smartphone', 'Headphone', 'MobileBattery'],
    zones: { PC: 'front_center', Monitor: 'back_center', Keyboard: 'front_center', Mouse: 'front_right' },
    outlets: [1, 2],
    laptop: true,
  },
  // バンライフ・車載。ポータブル電源とソーラー、通信は Starlink（Router）
  {
    name: 'バンライフ',
    region: 'mobile',
    categories: ['PC', 'Monitor', 'Router', 'MobileBattery', 'Storage', 'Smartphone', 'Speaker', 'Light'],
    zones: { PC: 'front_center', Monitor: 'back_center', Router: 'desk_right' },
    outlets: [0, 0],
    laptop: true,
    offGrid: true,
  },
  // 機内・移動中。膝の上でノートPCとタブレット、電源はモバイルバッテリーだけ
  {
    name: '移動中',
    region: 'mobile',
    categories: ['PC', 'Headphone', 'MobileBattery', 'Smartphone', 'Tablet'],
    zones: { PC: 'front_center' },
    outlets: [0, 0],
    laptop: true,
    offGrid: true,
  },
]

const presetsByCategory = new Map<GadgetCategory, Gadget[]>()
const registerPresets = (list: readonly unknown[]) => {
  for (const raw of list as Gadget[]) {
    const bucket = presetsByCategory.get(raw.category) ?? []
    bucket.push(raw)
    presetsByCategory.set(raw.category, bucket)
  }
}
registerPresets(GADGET_PRESETS)
registerPresets(AUDIO_INTERFACE_PRESETS)
registerPresets(PASSIVE_SPEAKER_PRESETS)

const demos = buildAllDemoDesks('ja')
// プリセットに実商品が無いカテゴリ（Desk / Chair / MicArm など）はデモの実データから借りる
const demoByCategory = new Map<GadgetCategory, Gadget[]>()
for (const g of demos.flatMap((d) => d.activeGadgets)) {
  demoByCategory.set(g.category, [...(demoByCategory.get(g.category) ?? []), g])
}

// プリセットにはポート情報を持たない項目がある（PC の2件は名前だけのひな型）。
// ポートが無いガジェットは配線が1本も引かれず机の飾りになってしまうので、
// ポートを持つ実データを優先し、無い場合だけポート無しを使う。
const poolFor = new Map<GadgetCategory, { withPorts: Gadget[]; any: Gadget[] }>()
for (const category of new Set([...presetsByCategory.keys(), ...demoByCategory.keys()])) {
  const all = [...(presetsByCategory.get(category) ?? []), ...(demoByCategory.get(category) ?? [])]
  poolFor.set(category, { withPorts: all.filter((g) => (g.ports ?? []).length > 0), any: all })
}

const gadgetForCategory = (
  rng: Rng, category: GadgetCategory, index: number, prefer?: (g: Gadget) => boolean,
): Gadget | null => {
  const pool = poolFor.get(category)
  if (!pool || pool.any.length === 0) return null
  let candidates = pool.withPorts.length ? pool.withPorts : pool.any
  if (prefer) {
    const preferred = candidates.filter(prefer)
    if (preferred.length) candidates = preferred
  }
  const base = pick(rng, candidates)
  return { ...base, id: `${category}-${index}`, createdAt: '2026-01-01T00:00:00.000Z', removedAt: undefined }
}

// 机の型に合った実機を選ぶ。持ち出す構成にデスクトップPCや27インチが来ると
// ポート構成ごと現実から外れるので、ノートPC・ポータブルモニターを優先する。
const preferFor = (kind: DeskKind, category: GadgetCategory) => (g: Gadget) => {
  if (category === 'PC' && kind.laptop) return g.pcFormFactor === 'laptop'
  if (category === 'Monitor' && kind.region === 'mobile') return /ポータブル|Portable/i.test(g.name)
  return true
}

type PhotoCase = {
  seed: number
  kind: string
  gadgets: Gadget[]
  plan: DeskPlan
  connections: MapConnection[]
}

// 写真の机にはたいてい写り込んでいる、型を問わない小物
const EXTRAS: GadgetCategory[] = [
  'Smartphone', 'Charger', 'Storage', 'Tablet', 'Router', 'Light', 'MonitorArm', 'Speaker', 'Headphone', 'Webcam',
]
// 外出構成で足されるのはこの範囲（カバンに入るものだけ）
const MOBILE_EXTRAS: GadgetCategory[] = ['Smartphone', 'Charger', 'Storage', 'Tablet', 'Earphone', 'MobileBattery']

const buildComposition = (seed: number, kind: DeskKind, useZone = true): PhotoCase => {
  const rng = makeRandom(seed)
  for (let i = 0; i < 8; i++) rng()   // seed が等差なので初期値の相関を捨てる
  const gadgets: Gadget[] = []
  const categories = [...kind.categories]
  // 写真の机は型どおりではない。小物が数点写り込む
  const extras = kind.region === 'mobile' ? MOBILE_EXTRAS : EXTRAS
  const extraCount = kind.region === 'mobile' ? int(rng, 0, 2) : int(rng, 0, 5)
  for (let i = 0; i < extraCount; i++) categories.push(pick(rng, extras))
  categories.forEach((category, index) => {
    // 写真ごとに機器の増減はある。土台（PC・モニター・机）は必ず残す
    const essential = category === 'PC' || category === 'Monitor' || category === 'Desk' || category === 'TV'
    if (!essential && rng() < 0.18) return
    const g = gadgetForCategory(rng, category, index, preferFor(kind, category))
    if (g) gadgets.push(g)
  })

  for (const g of gadgets) {
    // ステレオスピーカーは写真では必ず左右対。データ上も対で持たせる
    if (g.category === 'Speaker' && rng() < 0.6) g.stereoPair = true
    // コンセントが無い構成では、充電式・ソーラー給電の機器が混ざる
    if (kind.offGrid && rng() < 0.35) {
      g.powerUsage = pick(rng, ['rechargeable', 'continuous'] as const)
      if (g.category === 'Light' || g.category === 'SmartHome') {
        g.smartHomePowerSource = pick(rng, ['solar', 'battery'] as const)
      }
    }
    // パススルー充電対応のモバイルバッテリー（本体を充電しながら給電できるか）
    if (g.category === 'MobileBattery') g.supportsPassThroughCharging = rng() < 0.5
  }

  const placements = useZone
    ? gadgets
      .map((g) => ({ gadgetId: g.id, zone: kind.zones[g.category] }))
      .filter((p): p is { gadgetId: string; zone: DeskZone } => !!p.zone)
    : []
  const plan: DeskPlan = {
    id: `photo-${seed}`,
    name: kind.name,
    goal: 'clean_wiring',
    selectedGadgetIds: gadgets.map((g) => g.id),
    placements,
    outletCount: int(rng, kind.outlets[0], kind.outlets[1]),
    outletCountVersion: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const connections = reconcileMap([], gadgets, plan, 'ja').map((c) => ({ ...c, confirmed: true }))
  return { seed, kind: kind.name, gadgets, plan, connections }
}

// ─── 自動配置を「写真の机」へ並べ直す ───────────────────────────
// 写真の机は自動配置より遥かに詰まっている。行間は配線用の余白ではなく実物の奥行きで決まり、
// キーボードはモニターの真下、スピーカーは本体の真横に来る。
type PhotoStyle = {
  name: string
  gapY: number       // 行と行の間隔（px）。負なら手前の機器が奥に重なって写る
  gapX: number       // 同じ行の機器同士の間隔
  alignToMonitor: number  // モニター中心へ手前の行を揃える度合い（0..1）
}
const STYLES: PhotoStyle[] = [
  { name: 'ゆったり', gapY: 44, gapX: 26, alignToMonitor: 0.4 },
  { name: 'standard', gapY: 26, gapX: 16, alignToMonitor: 0.7 },
  { name: '詰まった机', gapY: 12, gapX: 8, alignToMonitor: 0.85 },
  { name: '密着', gapY: 2, gapX: 2, alignToMonitor: 1 },
  { name: '手前が重なる', gapY: -18, gapX: 4, alignToMonitor: 1 },
  { name: '奥行き圧縮', gapY: -34, gapX: 0, alignToMonitor: 0.9 },
]

const arrangeLikePhoto = (
  layout: MapLayout,
  style: PhotoStyle,
  rng: Rng,
): Record<string, { dx: number; dy: number }> => {
  const tiers = [...new Set(layout.nodes.map((n) => n.tier))].sort((a, b) => a - b)
  const nodesByTier = new Map<number, MapNode[]>()
  for (const n of layout.nodes) {
    nodesByTier.set(n.tier, [...(nodesByTier.get(n.tier) ?? []), n])
  }
  // モニターの中心。写真の机はここを軸に左右が組まれる
  const monitors = layout.nodes.filter((n) => n.gadget.category === 'Monitor' || n.gadget.category === 'TV')
  const axis = monitors.length
    ? monitors.reduce((sum, n) => sum + n.cx, 0) / monitors.length
    : layout.nodes.reduce((sum, n) => sum + n.cx, 0) / Math.max(1, layout.nodes.length)

  const offsets: Record<string, { dx: number; dy: number }> = {}
  let cursorY = layout.nodes.reduce((min, n) => Math.min(min, n.y), Infinity)
  for (const tier of tiers) {
    const row = (nodesByTier.get(tier) ?? []).sort((a, b) => a.cx - b.cx || a.id.localeCompare(b.id))
    const rowH = Math.max(...row.map((n) => n.h))
    const totalW = row.reduce((sum, n) => sum + n.w, 0) + style.gapX * (row.length - 1)
    // 行はモニター軸へ寄せる。写真では左右対称に組まれることが多い
    let cursorX = axis - totalW / 2 + range(rng, -14, 14)
    for (const n of row) {
      const targetX = cursorX
      // 実物の高さの差は写真では下端が揃って見える（机に載っているので）
      const targetY = cursorY + (rowH - n.h) * range(rng, 0.6, 1)
      offsets[n.id] = { dx: Math.round(targetX - n.x), dy: Math.round(targetY - n.y) }
      cursorX += n.w + style.gapX
    }
    cursorY += rowH + style.gapY
  }

  // キーボード・マウスはモニターの真下へ引き込む（写真で最も普遍的な並び）
  const keyboard = layout.nodes.find((n) => n.gadget.category === 'Keyboard')
  if (keyboard && offsets[keyboard.id] && style.alignToMonitor > 0) {
    const current = keyboard.x + offsets[keyboard.id].dx + keyboard.w / 2
    offsets[keyboard.id].dx += Math.round((axis - current) * style.alignToMonitor)
  }
  return offsets
}

// ─── 検証 ───────────────────────────────────────────────────────
type P = { x: number; y: number }
const finite = (...vals: number[]) => vals.every((v) => Number.isFinite(v))
const crossesNode = (a: P, b: P, n: MapNode) => {
  const x0 = n.x + 1.5, x1 = n.x + n.w - 1.5, y0 = n.y + 1.5, y1 = n.y + n.h - 1.5
  if (x1 <= x0 || y1 <= y0) return false
  for (let k = 1; k < 24; k++) {
    const x = a.x + ((b.x - a.x) * k) / 24
    const y = a.y + ((b.y - a.y) * k) / 24
    if (x > x0 && x < x1 && y > y0 && y < y1) return true
  }
  return false
}
const overlapping = (a: MapNode, b: MapNode) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0

type Check = {
  violations: string[]
  overlapPairs: number
  piercedFree: number   // 他ノードと重なっていないノードを貫通した数（＝迂回できたはずの線）
  piercedStuck: number  // 重なって塞がれたノードの貫通（重ねた以上避けられない）
}

const check = (layout: MapLayout, conns: MapConnection[]): Check => {
  const violations: string[] = []
  const add = (s: string) => { if (violations.length < 4) violations.push(s) }
  const ids = new Set<string>()
  for (const n of layout.nodes) {
    if (ids.has(n.id)) add(`node-duplicate ${n.id}`)
    ids.add(n.id)
    if (!finite(n.x, n.y, n.w, n.h, n.cx, n.cy)) add(`node-finite ${n.id}`)
    else if (n.w <= 0 || n.h <= 0) add(`node-size ${n.id} ${n.w}x${n.h}`)
    else if (Math.abs(n.cx - (n.x + n.w / 2)) > 0.51 || Math.abs(n.cy - (n.y + n.h / 2)) > 0.51) {
      add(`node-center ${n.id}`)
    } else if (n.x < layout.bounds.minX - 0.5 || n.y < layout.bounds.minY - 0.5 ||
      n.x + n.w > layout.bounds.maxX + 0.5 || n.y + n.h > layout.bounds.maxY + 0.5) {
      add(`bounds-contains ${n.id}`)
    }
  }
  if (!finite(layout.width, layout.height)) add('canvas-finite')
  if (!finite(layout.bounds.minX, layout.bounds.minY, layout.bounds.maxX, layout.bounds.maxY)) add('bounds-finite')
  const drawn = new Set<string>()
  for (const e of layout.edges) {
    if (e.points.length < 2) { add(`edge-points ${e.conn.id}`); continue }
    if (!e.points.every((p) => finite(p.x, p.y))) { add(`edge-finite ${e.conn.id}`); continue }
    if (!e.isPairLink) {
      drawn.add(e.conn.id)
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1], b = e.points[i]
        if (Math.abs(a.x - b.x) >= 0.6 && Math.abs(a.y - b.y) >= 0.6) { add(`edge-axial ${e.conn.id}`); break }
      }
    }
  }
  // アーム類とタブレットに吸着する小物はノードごと畳まれる仕様なので、線が無くて当然。
  // ノードとして残っている両端を結ぶ接続だけが「消えてはいけない線」。
  const nodeIds = new Set(layout.nodes.map((n) => n.id))
  const attachedIds = new Set(layout.nodes.flatMap((n) => (n.attached ?? []).map((g) => g.id)))
  const nodesOf = (id: string) =>
    nodeIds.has(id) ? [id] : [id + '__L', id + '__R'].filter((x) => nodeIds.has(x))
  for (const conn of conns) {
    if (attachedIds.has(conn.fromGadgetId) || attachedIds.has(conn.toGadgetId)) continue
    if (nodesOf(conn.fromGadgetId).length === 0 || nodesOf(conn.toGadgetId).length === 0) continue
    if (!drawn.has(conn.id)) add(`edge-missing ${conn.id} ${conn.fromGadgetId}->${conn.toGadgetId}`)
  }

  let overlapPairs = 0
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      if (overlapping(layout.nodes[i], layout.nodes[j])) overlapPairs++
    }
  }
  let piercedFree = 0
  let piercedStuck = 0
  for (const e of layout.edges) {
    if (e.isPairLink) continue
    const hit = new Map<string, boolean>()   // ノードID → 貫通した区間が水平か
    for (let i = 1; i < e.points.length; i++) {
      const horiz = Math.abs(e.points[i - 1].y - e.points[i].y) < 0.5
      for (const n of layout.nodes) {
        if (n.id === e.from.id || n.id === e.to.id) continue
        if (crossesNode(e.points[i - 1], e.points[i], n)) hit.set(n.id, horiz)
      }
    }
    for (const [id, horiz] of hit) {
      const n = layout.nodes.find((x) => x.id === id)!
      // 「重なっていない＝迂回できたはず」は甘い。ノード自体が重なっていなくても、
      // 迂回先の廊下が 34px 未満なら線は物理的に通れない。貫通した向きに対して
      // 直角の隙間だけを見て、片側でも 34px 空いているものだけを本当の失敗と数える。
      const spans = layout.nodes.filter((o) => o.id !== n.id && (horiz
        ? o.x < n.x + n.w && o.x + o.w > n.x
        : o.y < n.y + n.h && o.y + o.h > n.y))
      const before = spans.filter((o) => horiz ? o.y + o.h <= n.y : o.x + o.w <= n.x)
        .map((o) => horiz ? n.y - (o.y + o.h) : n.x - (o.x + o.w))
      const after = spans.filter((o) => horiz ? o.y >= n.y + n.h : o.x >= n.x + n.w)
        .map((o) => horiz ? o.y - (n.y + n.h) : o.x - (n.x + n.w))
      const widest = Math.max(before.length ? Math.min(...before) : Infinity,
        after.length ? Math.min(...after) : Infinity)
      if (widest >= 34) piercedFree++
      else piercedStuck++
    }
  }
  return { violations, overlapPairs, piercedFree, piercedStuck }
}

// 今回入れた到達不能スキップだけを外した版（現実的な配置での効果を測る）
const loadWithoutSkip = (): typeof computeMapLayout => {
  const file = path.resolve('src/utils/connectionMapLayout.ts')
  const source = fs.readFileSync(file, 'utf8').split(String.fromCharCode(13)).join('')
  const needle = '      if (!reachable) return null' + String.fromCharCode(10)
  const disabled = source.replace(needle, '      if (!reachable) { void 0 }' + String.fromCharCode(10))
  if (disabled === source) throw new Error('比較版を作れませんでした')
  const compiled = ts.transpileModule(disabled, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const run = new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)
  run(module.exports, createRequire(file), module, file, path.dirname(file))
  return module.exports.computeMapLayout as typeof computeMapLayout
}

// ─── 集計 ───────────────────────────────────────────────────────
type Bucket = {
  n: number; totalMs: number; worstMs: number; worstSeed: number; slow: number
  overlapFigs: number; piercedFree: number; piercedStuck: number; gadgets: number; edges: number
}
const emptyBucket = (): Bucket => ({
  n: 0, totalMs: 0, worstMs: 0, worstSeed: 0, slow: 0,
  overlapFigs: 0, piercedFree: 0, piercedStuck: 0, gadgets: 0, edges: 0,
})
const mergeBucket = (a: Bucket, b: Bucket): Bucket => ({
  n: a.n + b.n, totalMs: a.totalMs + b.totalMs,
  worstMs: Math.max(a.worstMs, b.worstMs),
  worstSeed: a.worstMs >= b.worstMs ? a.worstSeed : b.worstSeed,
  slow: a.slow + b.slow, overlapFigs: a.overlapFigs + b.overlapFigs,
  piercedFree: a.piercedFree + b.piercedFree, piercedStuck: a.piercedStuck + b.piercedStuck,
  gadgets: a.gadgets + b.gadgets, edges: a.edges + b.edges,
})

type WorstRow = { seed: number; index: number; kind: string; style: string; gadgets: number; edges: number; autoMs: number; photoMs: number; skipOffMs: number; overlapPairs: number }
type ShardResult = {
  done: number
  autoMs: number
  photoMs: number
  skipOffMs: number
  byStyle: Record<string, Bucket>
  byKind: Record<string, Bucket>
  violations: Array<{ seed: number; index: number; kind: string; style: string; rules: string[] }>
  piercedCases: WorstRow[]
  worst: WorstRow[]
}

const SLOW_MS = 3000

const runShard = async (
  shardIndex: number, shardCount: number, total: number, baseSeed: number,
  withoutSkip: typeof computeMapLayout | null, progress: boolean,
): Promise<ShardResult> => {
  const out: ShardResult = {
    done: 0, autoMs: 0, photoMs: 0, skipOffMs: 0,
    byStyle: {}, byKind: {}, violations: [], piercedCases: [], worst: [],
  }
  for (let i = shardIndex; i < total; i += shardCount) {
    const seed = (baseSeed + i * 2654435761) >>> 0
    const style = STYLES[i % STYLES.length]
    const kind = DESK_KINDS[Math.floor(i / STYLES.length) % DESK_KINDS.length]
    const c = buildComposition(seed, kind)

    const t0 = Date.now()
    const auto = await computeMapLayout(c.gadgets, c.connections, c.plan.placements, {}, {})
    const autoMs = Date.now() - t0

    const rng = makeRandom(seed ^ 0x9e3779b9)
    const offsets = arrangeLikePhoto(auto, style, rng)
    const t1 = Date.now()
    const photo = await computeMapLayout(c.gadgets, c.connections, c.plan.placements, offsets, {})
    const photoMs = Date.now() - t1

    let skipOffMs = 0
    if (withoutSkip) {
      const t2 = Date.now()
      await withoutSkip(c.gadgets, c.connections, c.plan.placements, offsets, {})
      skipOffMs = Date.now() - t2
    }
    const result = check(photo, c.connections)

    out.done++
    out.autoMs += autoMs
    out.photoMs += photoMs
    out.skipOffMs += skipOffMs
    const row: WorstRow = {
      seed, index: i, kind: kind.name, style: style.name,
      gadgets: c.gadgets.length, edges: photo.edges.length, autoMs, photoMs, skipOffMs,
      overlapPairs: result.overlapPairs,
    }
    for (const [key, map] of [[style.name, out.byStyle], [kind.name, out.byKind]] as const) {
      const bucket = map[key] ?? emptyBucket()
      bucket.n++
      bucket.totalMs += photoMs
      if (photoMs > bucket.worstMs) { bucket.worstMs = photoMs; bucket.worstSeed = seed }
      if (photoMs > SLOW_MS) bucket.slow++
      if (result.overlapPairs > 0) bucket.overlapFigs++
      bucket.piercedFree += result.piercedFree
      bucket.piercedStuck += result.piercedStuck
      bucket.gadgets += c.gadgets.length
      bucket.edges += photo.edges.length
      map[key] = bucket
    }
    if (result.violations.length && out.violations.length < 40) {
      out.violations.push({ seed, index: i, kind: kind.name, style: style.name, rules: result.violations })
    }
    if (result.piercedFree > 0 && out.piercedCases.length < 40) out.piercedCases.push(row)
    out.worst.push(row)
    out.worst.sort((a, b) => b.photoMs - a.photoMs)
    if (out.worst.length > 12) out.worst.length = 12

    if (progress && out.done % 200 === 0) {
      process.stderr.write(`  進捗(shard0) ${out.done} / ${Math.ceil(total / shardCount)} 件\n`)
    }
  }
  return out
}

const main = async () => {
  const args = process.argv.slice(2)
  const total = Number(args.find((a) => /^\d+$/.test(a)) ?? 100)
  const baseSeed = Number(args.find((a) => a.startsWith('--seed='))?.slice(7) ?? 20260826)
  const compare = args.includes('--compare')
  const shardArg = args.find((a) => a.startsWith('--shard='))?.slice(8)

  if (shardArg) {
    const [i, n] = shardArg.split('/').map(Number)
    const result = await runShard(i, n, total, baseSeed, compare ? loadWithoutSkip() : null, i === 0)
    process.send?.(result)
    return
  }

  const parallel = total >= 400 ? Math.min(12, Math.max(1, os.cpus().length - 2)) : 1
  const started = Date.now()
  console.log(`デスク写真ふうの配置: ${total} 件 / ${parallel} プロセス / seed=${baseSeed}${compare ? '（到達不能スキップ有無を比較）' : ''}`)
  console.log(`机の型 ${DESK_KINDS.length}種（国内${DESK_KINDS.filter((k) => k.region === 'jp').length} / 海外${DESK_KINDS.filter((k) => k.region === 'intl').length} / 外出${DESK_KINDS.filter((k) => k.region === 'mobile').length}） × 詰め方 ${STYLES.length}段階`)

  const shards: ShardResult[] = parallel === 1
    ? [await runShard(0, 1, total, baseSeed, compare ? loadWithoutSkip() : null, total > 200)]
    : await Promise.all(Array.from({ length: parallel }, (_, i) => new Promise<ShardResult>((resolve, reject) => {
      const child = fork(process.argv[1], [
        String(total), `--shard=${i}/${parallel}`, `--seed=${baseSeed}`, ...(compare ? ['--compare'] : []),
      ], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
      child.on('message', (m) => resolve(m as ShardResult))
      child.on('exit', (code) => { if (code !== 0) reject(new Error(`shard ${i} exited ${code}`)) })
    })))

  const done = shards.reduce((a, s) => a + s.done, 0)
  const autoMs = shards.reduce((a, s) => a + s.autoMs, 0)
  const photoMs = shards.reduce((a, s) => a + s.photoMs, 0)
  const skipOffMs = shards.reduce((a, s) => a + s.skipOffMs, 0)
  const merge = (get: (s: ShardResult) => Record<string, Bucket>) => {
    const all: Record<string, Bucket> = {}
    for (const s of shards) {
      for (const [key, bucket] of Object.entries(get(s))) {
        all[key] = all[key] ? mergeBucket(all[key], bucket) : bucket
      }
    }
    return all
  }
  const byStyle = merge((s) => s.byStyle)
  const byKind = merge((s) => s.byKind)
  const violations = shards.flatMap((s) => s.violations)
  const piercedCases = shards.flatMap((s) => s.piercedCases)
  const worst = shards.flatMap((s) => s.worst).sort((a, b) => b.photoMs - a.photoMs).slice(0, 10)
  const totalSlow = Object.values(byStyle).reduce((a, b) => a + b.slow, 0)
  const totalPiercedFree = Object.values(byStyle).reduce((a, b) => a + b.piercedFree, 0)
  const totalPiercedStuck = Object.values(byStyle).reduce((a, b) => a + b.piercedStuck, 0)
  const totalOverlapFigs = Object.values(byStyle).reduce((a, b) => a + b.overlapFigs, 0)

  console.log(`\n─── 結果 ${done} 件 / ${((Date.now() - started) / 1000 / 60).toFixed(1)}分 ───`)
  console.log(`自動配置のまま : 合計 ${(autoMs / 1000).toFixed(1)}s`)
  console.log(`写真ふうの配置 : 合計 ${(photoMs / 1000).toFixed(1)}s  最遅 ${worst[0]?.photoMs ?? 0}ms`)
  if (compare) console.log(`  到達不能スキップ無し: 合計 ${(skipOffMs / 1000).toFixed(1)}s`)
  console.log(`${SLOW_MS}ms超: ${totalSlow} 件 (${(100 * totalSlow / done).toFixed(2)}%)`)
  console.log(`ノード重なりを含む図: ${totalOverlapFigs} 件 (${(100 * totalOverlapFigs / done).toFixed(1)}%)`)
  console.log(`貫通(重なりで塞がれたノード): ${totalPiercedStuck} 箇所`)
  console.log(`貫通(空いているノード・迂回できたはず): ${totalPiercedFree} 箇所`)
  console.log(`不変条件違反: ${violations.length} 件${violations.length >= 40 ? '（各シャード40件で打ち切り）' : ''}`)
  for (const v of violations.slice(0, 10)) {
    console.log(`  --explain=${v.seed}:${v.index}  ${v.kind}/${v.style}  ${v.rules.join(' , ')}`)
  }

  const line = (label: string, b: Bucket) =>
    `  ${label.padEnd(18)} n=${String(b.n).padStart(6)}  平均 ${String(Math.round(b.totalMs / b.n)).padStart(5)}ms  最遅 ${String(b.worstMs).padStart(6)}ms  ` +
    `${SLOW_MS}ms超 ${String(b.slow).padStart(4)}  重なり図 ${String(Math.round(100 * b.overlapFigs / b.n)).padStart(3)}%  ` +
    `貫通(空) ${String(b.piercedFree).padStart(4)}  平均台数 ${(b.gadgets / b.n).toFixed(1)}  平均線数 ${(b.edges / b.n).toFixed(1)}`

  console.log('\n─── 机の型ごと ───')
  for (const kind of DESK_KINDS) {
    const b = byKind[kind.name]
    if (b) console.log(line(`[${kind.region}] ${kind.name}`, b))
  }
  console.log('\n─── 配置の詰め方ごと ───')
  for (const style of STYLES) {
    const b = byStyle[style.name]
    if (b) console.log(line(style.name, b))
  }
  if (piercedCases.length) {
    console.log('\n─── 空いているノードを貫通した図（迂回できたはず）───')
    for (const r of piercedCases.slice(0, 10)) {
      console.log(`  --explain=${r.seed}:${r.index}  ${r.kind}/${r.style} 台数${r.gadgets} 線${r.edges} 重なり対${r.overlapPairs} ${r.photoMs}ms`)
    }
  }
  console.log('\n─── 最も重かった図 ───')
  for (const r of worst) {
    console.log(`  --explain=${r.seed}:${r.index}  ${r.kind}/${r.style} 台数${r.gadgets} 線${r.edges}  自動 ${r.autoMs}ms → 写真配置 ${r.photoMs}ms${r.skipOffMs ? ` (スキップ無し ${r.skipOffMs}ms)` : ''}  重なり対 ${r.overlapPairs}`)
  }
}

// 1件だけ取り出して、迂回する隙間が本当にあったのかを見る
const explain = async (seed: number, index: number) => {
  const style = STYLES[index % STYLES.length]
  const kind = DESK_KINDS[Math.floor(index / STYLES.length) % DESK_KINDS.length]
  const c = buildComposition(seed, kind)
  const rng = makeRandom(seed ^ 0x9e3779b9)
  const auto = await computeMapLayout(c.gadgets, c.connections, c.plan.placements, {}, {})
  const offsets = arrangeLikePhoto(auto, style, rng)
  const layout = await computeMapLayout(c.gadgets, c.connections, c.plan.placements, offsets, {})
  console.log(`\nseed=${seed} [${kind.region}] ${kind.name}/${style.name} 台数${c.gadgets.length} ノード${layout.nodes.length} 線${layout.edges.length} コンセント${c.plan.outletCount}口`)
  console.log(`  構成: ${c.gadgets.map((g) => g.category).join(', ')}`)
  const drawnIds = new Set(layout.edges.filter((e) => !e.isPairLink).map((e) => e.conn.id))
  console.log('  入力した接続と描画結果:')
  for (const conn of c.connections) {
    const drawn = drawnIds.has(conn.id)
    const node = (id: string) => layout.nodes.find((n) => n.id === id || n.id === id + '__L' || n.id === id + '__R')
    console.log(`    ${drawn ? '描画' : '★消失'} ${conn.id} ${conn.fromGadgetId}-[${conn.cableType}]->${conn.toGadgetId}` +
      ` from=${node(conn.fromGadgetId) ? 'ノードあり' : 'ノードなし'} to=${node(conn.toGadgetId) ? 'ノードあり' : 'ノードなし'}` +
      `${conn.wireless ? ' 無線' : ''}${conn.chargingOnly ? ' 充電のみ' : ''}`)
  }
  const wiring = generateWiring(c.gadgets, c.plan, 'ja')
  console.log(`  配線エンジンの警告: ${wiring.warnings.join(' / ') || 'なし'}`)
  for (const g of c.gadgets) {
    console.log(`    ${g.id} (${g.name}) ${g.pcFormFactor ?? ''} ports=[${g.ports.map((p) => `${p.type}:${p.direction}x${p.count}`).join(', ')}]`)
  }
  for (const e of layout.edges) {
    if (e.isPairLink) continue
    for (let i = 1; i < e.points.length; i++) {
      for (const n of layout.nodes) {
        if (n.id === e.from.id || n.id === e.to.id) continue
        if (!crossesNode(e.points[i - 1], e.points[i], n)) continue
        const stuck = layout.nodes.filter((o) => o.id !== n.id && overlapping(n, o))
        const gapTo = (dir: 'left' | 'right' | 'top' | 'bottom') => {
          const others = layout.nodes.filter((o) => o.id !== n.id)
          const spans = others.filter((o) =>
            dir === 'left' || dir === 'right'
              ? o.y < n.y + n.h && o.y + o.h > n.y
              : o.x < n.x + n.w && o.x + o.w > n.x)
          const gaps =
            dir === 'left' ? spans.filter((o) => o.x + o.w <= n.x).map((o) => n.x - (o.x + o.w))
            : dir === 'right' ? spans.filter((o) => o.x >= n.x + n.w).map((o) => o.x - (n.x + n.w))
            : dir === 'top' ? spans.filter((o) => o.y + o.h <= n.y).map((o) => n.y - (o.y + o.h))
            : spans.filter((o) => o.y >= n.y + n.h).map((o) => o.y - (n.y + n.h))
          return gaps.length ? Math.min(...gaps) : Infinity
        }
        const fmt = (v: number) => (v === Infinity ? '∞' : Math.round(v) + 'px')
        console.log(`  ${e.conn.cableType}: ${e.from.gadget.category} → ${e.to.gadget.category}`)
        console.log(`    貫通されたノード: ${n.gadget.category}(${n.id}) 位置(${Math.round(n.x)},${Math.round(n.y)}) ${Math.round(n.w)}x${Math.round(n.h)}`)
        console.log(`    重なっている相手: [${stuck.map((o) => o.gadget.category).join(',') || 'なし'}]`)
        console.log(`    周囲の隙間: 左${fmt(gapTo('left'))} 右${fmt(gapTo('right'))} 上${fmt(gapTo('top'))} 下${fmt(gapTo('bottom'))}  （線が通るには34px 必要）`)
      }
    }
  }
}

export const EVAL_KINDS = DESK_KINDS
export { STYLES, arrangeLikePhoto, makeRandom }
export const buildEvalCase = buildComposition

// 別スクリプトから構成生成だけ借りる場合があるので、直接起動されたときだけ走らせる
if ((process.argv[1] ?? '').includes('fuzzPhotoLayout')) {
  const explainArg = process.argv.slice(2).find((a) => a.startsWith('--explain='))
  if (explainArg) {
    const [seed, index] = explainArg.slice(10).split(':').map(Number)
    explain(seed, index ?? 0).catch((e) => { console.error(e); process.exit(1) })
  } else {
    main().catch((e) => { console.error(e); process.exit(1) })
  }
}
