/**
 * オンボーディングの配線図アニメが使うレイアウトを事前計算して焼き込むスクリプト。
 *
 *   npm run build:onboarding-wiring                 # demo-gaming で作り直す
 *   npm run build:onboarding-wiring -- --demo=dtm   # 別のデモデスクで作る（id の後半で部分一致）
 *
 * 起動直後に computeMapLayout を走らせるとオンボーディングの初回描画がそのぶん遅れる
 * （3,500行のルーティング計算が丸ごと乗る）。「すぐ始められる」ことを最優先するので、
 * 計算結果をここで JSON にしておき、アプリ側は読むだけにする。
 *
 * 出力は JS のオブジェクトリテラルではなく JSON 文字列にしている。
 * Hermes ではリテラルの評価より JSON.parse のほうが速く、tsc も中身の巨大な
 * リテラル型を推論しなくて済む。
 *
 * レイアウト計算（connectionMapLayout.ts）を変えたら LAYOUT_VERSION と一緒に
 * これも作り直す。焼いた版が古いと、アプリ内の配線図と見た目が食い違う。
 * 同時に配線図の出力の指紋を tests/fixtures/layoutSignature.json へ書く。出力が変わったのに
 * LAYOUT_VERSION が同じなら、焼かずに止まる（上げ忘れの検出）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CATEGORY_LABELS } from '../src/constants/categoryLabels'
import { buildDemoDesk, DEMO_DESKS } from '../src/constants/demoDesks'
import { DeskPlan, Gadget, GadgetPlacement, Port, PortDirection, PortType } from '../src/types'
import { computeMapLayout, MAP_STUB_OUT, MapLayout, reconcileMap } from '../src/utils/connectionMapLayout'
import { LAYOUT_VERSION } from '../src/utils/mapLayoutCache'
import { demoLayoutSignature } from './demoLayoutSignature'

const OUT_PATH = resolve(__dirname, '../src/constants/onboardingWiring.generated.ts')
// 配線図の出力の指紋と LAYOUT_VERSION の組。tests/layoutVersionGuard.test.ts が照合する
const SIGNATURE_PATH = resolve(__dirname, '../tests/fixtures/layoutSignature.json')
const DEFAULT_DEMO = 'demo-gaming'

const arg = process.argv.slice(2).find((a) => a.startsWith('--demo='))?.slice('--demo='.length)
const demo = arg
  ? DEMO_DESKS.find((d) => d.id === arg || d.id.endsWith(`-${arg}`))
  : DEMO_DESKS.find((d) => d.id === DEFAULT_DEMO)

if (!demo) {
  console.error(`デモデスクが見つかりません: ${arg ?? DEFAULT_DEMO}`)
  console.error(`使えるのは: ${DEMO_DESKS.map((d) => d.id).join(', ')}`)
  process.exit(1)
}

// 起動直後のオープニング（OnboardingIntro）で組み上げて見せる、いちばん基本のデスク。
// 接続と機器の寸法は本編と共通にし、起動画面の経路だけ指定の曲がり数に整える。
// 名前はカテゴリ名そのものにして、英語表示では localizedGadgetName が訳す
const OPENING_AT = '2026-01-01'
const openingPort = (id: string, type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port =>
  ({ id, type, direction, count, ...extra })
const openingGadget = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id: `opening-${id}`, name: CATEGORY_LABELS[category], category, ports,
  purchasedAt: OPENING_AT, createdAt: `${OPENING_AT}T00:00:00.000Z`, ...extra,
})
const OPENING_GADGETS: Gadget[] = [
  openingGadget('strip', 'PowerStrip', [openingPort('p1', 'Power', 'input'), openingPort('p2', 'Power', 'output', 4)]),
  openingGadget('pc', 'PC', [
    openingPort('p1', 'DisplayPort', 'output', 1, { supportsVideo: true }),
    openingPort('p2', 'Audio3_5mm', 'output'),
    openingPort('p3', 'USB_A', 'output', 4),
    openingPort('p4', 'Power', 'input'),
    openingPort('p5', 'USB_C', 'output'),
  ], { pcFormFactor: 'desktop' }),
  // キーボードはUSB-Cでつなぎ、映像・音声と線色を分ける。
  openingGadget('keyboard', 'Keyboard', [openingPort('p1', 'USB_C', 'input')]),
  openingGadget('mouse', 'Mouse', [openingPort('p1', 'USB_A', 'input')]),
  openingGadget('headphone', 'Headphone', [openingPort('p1', 'Audio3_5mm', 'input')]),
  openingGadget('monitor', 'Monitor', [openingPort('p1', 'DisplayPort', 'input', 1, { supportsVideo: true }), openingPort('p2', 'Power', 'input')]),
]
const OPENING_PLACEMENTS: GadgetPlacement[] = [
  { gadgetId: 'opening-pc', zone: 'under_desk' },
  { gadgetId: 'opening-strip', zone: 'under_desk' },
  { gadgetId: 'opening-monitor', zone: 'back_center' },
  { gadgetId: 'opening-keyboard', zone: 'front_center' },
  { gadgetId: 'opening-mouse', zone: 'front_right' },
  { gadgetId: 'opening-headphone', zone: 'under_desk' },
]

async function buildOpeningLayout(): Promise<MapLayout> {
  // 壁のコンセントは1口。電源タップを通らないと全部をつなげない形にする
  const plan = {
    id: 'opening', name: 'opening', goal: 'desk_tour', purposes: [],
    selectedGadgetIds: OPENING_GADGETS.map((g) => g.id), placements: OPENING_PLACEMENTS,
    outletCount: 1, outletCountVersion: 2,
    createdAt: `${OPENING_AT}T00:00:00.000Z`, updatedAt: `${OPENING_AT}T00:00:00.000Z`,
  } as DeskPlan
  const connections = reconcileMap([], OPENING_GADGETS, plan, 'ja').map((c) => ({ ...c, confirmed: true }))
  return arrangeOpeningLayout(await computeMapLayout(OPENING_GADGETS, connections, OPENING_PLACEMENTS))
}

// PCの左に映像線、右に音声線、外周にモニターの電源線を通し、中央の機器と交差させない。
function arrangeOpeningLayout(layout: MapLayout): MapLayout {
  const centerX = 280
  const sourcePc = layout.nodes.find(n => n.id === 'opening-pc')!
  const sourceHeadphone = layout.nodes.find(n => n.id === 'opening-headphone')!
  const sourceKeyboard = layout.nodes.find(n => n.id === 'opening-keyboard')!
  const positions: Record<string, { x?: number; y: number }> = {
    'opening-monitor': { y: 40 },
    'opening-keyboard': { y: 238 },
    'opening-mouse': { x: centerX + sourceKeyboard.w / 2 + 64, y: 238 },
    'opening-headphone': { x: centerX + sourcePc.w / 2 + 64, y: 370 + (sourcePc.h - sourceHeadphone.h) / 2 + 32 },
    'opening-pc': { y: 370 },
    'opening-strip': { y: 572 },
    wall: { y: 708 },
  }
  const nodes = layout.nodes.map(n => {
    const { y, x = centerX - n.w / 2 } = positions[n.id]
    return { ...n, x, y, cx: x + n.w / 2, cy: y + n.h / 2,
      ...(n.baseX !== undefined ? { baseX: x } : {}), ...(n.baseY !== undefined ? { baseY: y } : {}) }
  })
  const node = (id: string) => {
    const found = nodes.find((n) => n.id === id)
    if (!found) throw new Error(`オープニングのデスクに ${id} が無い`)
    return found
  }
  const pc = node('opening-pc'), monitor = node('opening-monitor'), headphone = node('opening-headphone')
  const strip = node('opening-strip'), wall = node('wall'), keyboard = node('opening-keyboard'), mouse = node('opening-mouse')
  const videoX = Math.min(monitor.x, keyboard.x) - 48
  const powerX = Math.max(mouse.x + mouse.w, headphone.x + headphone.w, strip.x + strip.w, monitor.x + monitor.w) + 36
  // 音声線の上からマウスへ出し、ヘッドフォン本体も避ける。
  const mouseWireY = headphone.y - MAP_STUB_OUT
  const routes: Record<string, MapLayout['edges'][number]['points']> = {
    [`${wall.id}:${strip.id}`]: [{ x: centerX, y: wall.y }, { x: centerX, y: strip.y + strip.h }],
    [`${strip.id}:${pc.id}`]: [{ x: centerX, y: strip.y }, { x: centerX, y: pc.y + pc.h }],
    [`${strip.id}:${monitor.id}`]: [
      { x: strip.x + strip.w, y: strip.cy }, { x: powerX, y: strip.cy },
      { x: powerX, y: monitor.cy }, { x: monitor.x + monitor.w, y: monitor.cy },
    ],
    [`${pc.id}:${monitor.id}`]: [
      { x: pc.x, y: pc.cy }, { x: videoX, y: pc.cy },
      { x: videoX, y: monitor.cy }, { x: monitor.x, y: monitor.cy },
    ],
    [`${pc.id}:opening-keyboard`]: [{ x: centerX, y: pc.y }, { x: centerX, y: keyboard.y + keyboard.h }],
    [`${pc.id}:${headphone.id}`]: [
      { x: pc.x + pc.w, y: headphone.cy }, { x: headphone.x, y: headphone.cy },
    ],
    [`${pc.id}:${mouse.id}`]: [
      { x: pc.x + pc.w, y: mouseWireY }, { x: mouse.cx, y: mouseWireY }, { x: mouse.cx, y: mouse.y + mouse.h },
    ],
  }
  const byId = new Map(nodes.map(n => [n.id, n]))
  const edges = layout.edges.map((e) => {
    const points = routes[`${e.from.id}:${e.to.id}`]
    if (!points) throw new Error(`オープニングの経路が未定義: ${e.from.id} → ${e.to.id}`)
    return { ...e, from: byId.get(e.from.id)!, to: byId.get(e.to.id)!, points }
  })
  const points = edges.flatMap(e => e.points)
  const bounds = {
    minX: Math.min(...nodes.map(n => n.x), ...points.map(p => p.x)) - 28,
    minY: Math.min(...nodes.map(n => n.y), ...points.map(p => p.y)) - 28,
    maxX: Math.max(...nodes.map(n => n.x + n.w), ...points.map(p => p.x)) + 28,
    maxY: Math.max(...nodes.map(n => n.y + n.h), ...points.map(p => p.y)) + 28,
  }
  return { ...layout, nodes, edges, bounds, width: bounds.maxX + 28, height: bounds.maxY + 28 }
}

// edges の from/to は nodes と同じ実体なので、そのまま JSON にすると
// ノード（ガジェット丸ごと）が接続の数だけ重複する。id だけ持たせて読み込み側で繋ぎ直す
const serializeLayout = (layout: MapLayout, demoId: string) => JSON.stringify({
  layoutVersion: LAYOUT_VERSION,
  demoId,
  width: layout.width,
  height: layout.height,
  bounds: layout.bounds,
  nodes: layout.nodes,
  edges: layout.edges.map((e) => ({
    conn: e.conn,
    fromId: e.from.id,
    toId: e.to.id,
    points: e.points,
    ...(e.isPairLink ? { isPairLink: true } : {}),
  })),
})

async function main() {
  // 出力が変わったのに版が同じなら焼かない。焼いてしまうとテストも通り、端末のキャッシュに
  // 古い図が残ったまま出荷される（LAYOUT_VERSION を上げ忘れる事故を、ここで止める）
  const signature = await demoLayoutSignature()
  const recorded = existsSync(SIGNATURE_PATH)
    ? JSON.parse(readFileSync(SIGNATURE_PATH, 'utf8')) as { layoutVersion: number; signature: string }
    : null
  if (recorded && recorded.signature !== signature && recorded.layoutVersion === LAYOUT_VERSION) {
    console.error(`配線図の出力が変わったが LAYOUT_VERSION が ${LAYOUT_VERSION} のまま。`)
    console.error('src/utils/mapLayoutCache.ts の LAYOUT_VERSION を上げてから、もう一度実行する。')
    console.error('（上げないと、利用者の端末に保存された古い配線図が出続ける）')
    process.exit(1)
  }

  const built = buildDemoDesk(demo!, 'ja')
  const connections = built.plan.connectionMap?.connections ?? []
  // 画面側（ConnectionMap）と同じ入力で計算する。ここがずれると
  // オンボーディングで見せた図とアプリ内の図が別物になる
  // 画面は配線図にケーブル（持ち物としての登録）を渡さない（WiringResultScreen の nonCableGadgets）
  const layout = await computeMapLayout(
    built.activeGadgets.filter((g) => g.category !== 'Cable'),
    connections,
    built.plan.placements,
    {},
    {},
    !!built.plan.templateId,
  )

  const json = serializeLayout(layout, demo!.id)
  const opening = await buildOpeningLayout()
  const openingJson = serializeLayout(opening, 'opening')
  const source = `// 自動生成ファイル。手で編集しない。\n`
    + `// 作り直す: npm run build:onboarding-wiring\n`
    + `// 生成元: ${demo!.id}（src/constants/demoDesks.ts）・オープニングのデスク（scripts/buildOnboardingWiring.ts）/ LAYOUT_VERSION=${LAYOUT_VERSION}\n`
    + `export const ONBOARDING_WIRING_JSON = ${JSON.stringify(json)}\n`
    + `export const OPENING_WIRING_JSON = ${JSON.stringify(openingJson)}\n`

  writeFileSync(OUT_PATH, source, 'utf8')
  writeFileSync(SIGNATURE_PATH, `${JSON.stringify({ layoutVersion: LAYOUT_VERSION, signature }, null, 2)}\n`, 'utf8')
  console.log(`${demo!.id}: ノード ${layout.nodes.length} / 配線 ${layout.edges.length} / ${(json.length / 1024).toFixed(1)}KB`)
  console.log(`opening: ノード ${opening.nodes.length} / 配線 ${opening.edges.length} / ${(openingJson.length / 1024).toFixed(1)}KB`)
  console.log(`→ ${OUT_PATH}`)
}

void main()
