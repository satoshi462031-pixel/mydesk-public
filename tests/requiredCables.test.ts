import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, MapConnection, Port, PortDirection, PortType } from '../src/types'
import { cabledConnectionGroups, countRequiredCables, generateWiring } from '../src/utils/wiringEngine'
import { MAX_CABLE_COUNT } from '../src/constants/portTypes'
import { reconcileMap } from '../src/utils/connectionMapLayout'
import { normalizePlan } from '../src/utils/portTypeMigration'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `cable-port-${++seq}`,
  type,
  direction,
  count,
  ...extra,
})
const g = (id: string, category: GadgetCategory, ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...extra,
})
const plan = (gadgets: Gadget[], saved: MapConnection[] = []): DeskPlan => ({
  id: 'required-cables-plan',
  name: 'required cables',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount: 4,
  outletCountVersion: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...(saved.length > 0 ? { connectionMap: { connections: saved } } : {}),
})
const branch = (from: string, to: string, cableType: MapConnection['cableType'], branchGroupId: string): MapConnection =>
  ({ id: `saved-${from}-${to}`, fromGadgetId: from, toGadgetId: to, cableType, origin: 'auto', confirmed: true, branchGroupId })

const pc = () => g('pc', 'PC', [
  p('Power', 'input'),
  p('USB_A', 'output', 4),
  p('USB_C', 'output', 2),
  p('HDMI', 'output', 1, { supportsVideo: true }),
], { pcFormFactor: 'desktop' })
const monitor = () => g('monitor', 'Monitor', [p('HDMI', 'input', 1, { supportsVideo: true }), p('Power', 'input')])
/** 2.4GHz レシーバーを直挿しするマウス（実物のケーブルは要らない） */
const dongleMouse = () => g('mouse', 'Mouse', [
  p('USB_A', 'input', 1, { label: '2.4GHzレシーバー', directAttach: true }),
], { powerUsage: 'replaceable' })
const wiredKeyboard = () => g('keyboard', 'Keyboard', [p('USB_C', 'input', 1, { label: '有線接続' })])
const wiredHeadset = () => g('headset', 'Headphone', [p('USB_A', 'input', 1, { label: '有線接続' })])

const countOf = (result: ReturnType<typeof generateWiring>, cableType: string) =>
  result.requiredCables.find((item) => item.cableType === cableType && item.chargingOnly !== true)?.count ?? 0
const chargingCountOf = (result: ReturnType<typeof generateWiring>, cableType: string) =>
  result.requiredCables.find((item) => item.cableType === cableType && item.chargingOnly === true)?.count ?? 0

/** 充電のときだけ挿す無線マウスと、その相手の充電器 */
const wirelessMouse = () => g('wmouse', 'Mouse', [
  p('Bluetooth', 'bidirectional'),
  p('USB_C', 'input', 1, { label: '給電 (C)' }),
], { powerUsage: 'rechargeable' })
const charger = () => g('charger', 'Charger', [
  p('Power', 'input', 1, { label: '給電 (コンセント)' }),
  p('USB_C', 'output', 2),
])

describe('required cables', () => {
  it('does not count a direct-attach receiver as a cable', () => {
    const gadgets = [pc(), monitor(), dongleMouse(), wiredKeyboard()]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(countOf(result, 'USB_A'), 0)
    assert.equal(countOf(result, 'USB_C'), 1)
    assert.equal(countOf(result, 'HDMI'), 1)
  })

  it('counts a declared 2-in-1 branch as a single cable', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard(), wiredHeadset()]
    const result = generateWiring(gadgets, plan(gadgets, [
      branch('pc', 'keyboard', 'USB_C', 'branch-1'),
      branch('pc', 'headset', 'USB_A', 'branch-1'),
    ]))

    assert.equal(countOf(result, 'USB_C') + countOf(result, 'USB_A'), 1)
  })

  it('keeps counting the real cable when a direct-attach line shares the branch group', () => {
    // 束ねた枝の1本目が直挿しでも、2本目の実物のケーブルは数える
    const gadgets = [pc(), monitor(), dongleMouse(), wiredKeyboard()]
    const result = generateWiring(gadgets, plan(gadgets, [
      branch('pc', 'mouse', 'USB_A', 'branch-2'),
      branch('pc', 'keyboard', 'USB_C', 'branch-2'),
    ]))

    assert.equal(countOf(result, 'USB_A'), 0)
    assert.equal(countOf(result, 'USB_C'), 1)
  })

  // 充電線は配線図に描かれない（ConnectionMap が chargingOnly を落とす）。
  // 常時つなぐぶんと同じ行にまとめると、図に無い線の本数が紛れ込む
  it('separates charge-only cables from the ones that stay plugged in', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard(), wirelessMouse(), charger()]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(chargingCountOf(result, 'USB_C'), 1)
    assert.equal(countOf(result, 'USB_C'), 1)
    assert.equal(countOf(result, 'HDMI'), 1)
  })

  it('keeps the grand total unchanged by the split', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard(), wirelessMouse(), charger()]
    const result = generateWiring(gadgets, plan(gadgets))
    const total = result.requiredCables.reduce((sum, row) => sum + row.count, 0)

    // デスク一覧のバッジはこの合計を出しているので、分類を足しても本数は変わらない
    assert.equal(total, result.connections.filter((c) =>
      c.cableType !== 'Bluetooth' && c.cableType !== 'WiFi' && c.cableType !== 'wirelessCharging').length)
  })
})

describe('つなぎ方の行（cabledConnectionGroups）', () => {
  // 一覧の行数と「必要なケーブル」の本数は同じ判定から出す。別々に数えると、
  // 直挿しのレシーバーに「本体付属／商品を選ぶ」を出しながら本数には入らない、が起きる
  const rowsFor = (gadgets: Gadget[], saved: MapConnection[] = []) => {
    const base = plan(gadgets, saved)
    const result = generateWiring(gadgets, base)
    const withMap: DeskPlan = {
      ...base,
      wiringResult: result,
      connectionMap: {
        ...(base.connectionMap ?? {}),
        connections: saved.length > 0 ? saved : result.connections.map((c, i) => ({
          id: `auto-${i}`,
          fromGadgetId: c.fromGadgetId,
          toGadgetId: c.toGadgetId,
          cableType: c.cableType,
          origin: 'auto' as const,
          confirmed: false,
        })),
      },
    }
    return { rows: cabledConnectionGroups(gadgets, withMap), result }
  }

  // 同じケーブルが「必要なケーブル」と「つなぎ方」で別の位置に出ていた。保存された線の順ではなく、
  // 常時の線 → 充電のときだけの線、それぞれ種類の順（cableSortRank）で並べる
  it('並びが必要なケーブルの一覧と同じ', () => {
    const saved: MapConnection[] = [
      { id: 's-usbc', fromGadgetId: 'pc', toGadgetId: 'keyboard', cableType: 'USB_C', origin: 'auto', confirmed: true },
      { id: 's-charge', fromGadgetId: 'charger', toGadgetId: 'wmouse', cableType: 'USB_C', origin: 'auto', confirmed: true, chargingOnly: true },
      { id: 's-hdmi', fromGadgetId: 'pc', toGadgetId: 'monitor', cableType: 'HDMI', origin: 'auto', confirmed: true },
      { id: 's-power', fromGadgetId: 'wall', toGadgetId: 'pc', cableType: 'Power', origin: 'auto', confirmed: true },
    ]
    const gadgets = [pc(), monitor(), wiredKeyboard(), wirelessMouse(), charger()]
    const { rows } = rowsFor(gadgets, saved)
    assert.deepEqual(rows.map((group) => group[0].id), ['s-power', 's-usbc', 's-hdmi', 's-charge'])
  })

  it('直挿しのレシーバーは行にしない', () => {
    const gadgets = [pc(), monitor(), dongleMouse(), wiredKeyboard()]
    const { rows } = rowsFor(gadgets)
    assert.equal(rows.some((group) => group[0].toGadgetId === 'mouse'), false)
  })

  it('行数が必要本数と一致する', () => {
    const gadgets = [pc(), monitor(), dongleMouse(), wiredKeyboard(), wiredHeadset()]
    const { rows, result } = rowsFor(gadgets)
    const required = result.requiredCables.reduce((n, r) => n + r.count, 0)
    assert.equal(rows.length, required)
  })

  it('2in1 の枝は1行にまとめる', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard(), wiredHeadset()]
    const { rows } = rowsFor(gadgets, [
      branch('pc', 'keyboard', 'USB_C', 'branch-1'),
      branch('pc', 'headset', 'USB_A', 'branch-1'),
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].length, 2)
  })
})

describe('つなぎ方の引き継ぎ（reconcileMap）', () => {
  const choice = { kind: 'product' as const, name: 'Anker USB-C 240W 0.9m' }

  it('配線を引き直しても申告が残る', () => {
    // ガジェットを1台足すたびに自動生成の線は作り直される。ここで落とすと、
    // 申告した内容が黙って消える
    const gadgets = [pc(), monitor(), wiredKeyboard()]
    const base = plan(gadgets)
    const auto = generateWiring(gadgets, base).connections
      .filter((c) => c.cableType === 'HDMI')
      .map((c, i) => ({
        id: `auto-${i}`,
        fromGadgetId: c.fromGadgetId,
        toGadgetId: c.toGadgetId,
        cableType: c.cableType,
        origin: 'auto' as const,
        confirmed: false,
        cableChoice: choice,
      }))
    assert.equal(auto.length, 1)
    const next = reconcileMap(auto, gadgets, { ...base, connectionMap: { connections: auto } })
    const kept = next.find((c) => c.fromGadgetId === 'pc' && c.toGadgetId === 'monitor' && c.cableType === 'HDMI')
    assert.deepEqual(kept?.cableChoice, choice)
  })

  it('ケーブル種別が変わった線には移さない', () => {
    // route（長さ・取り回し）は種別が変わっても同じ経路だが、つなぎ方は
    // 「その種別のケーブル1本」を指しているので移すと別物の申告になる
    const gadgets = [pc(), monitor(), wiredKeyboard()]
    const base = plan(gadgets)
    const stale = [{
      id: 'auto-old',
      fromGadgetId: 'pc',
      toGadgetId: 'monitor',
      cableType: 'DisplayPort' as const,
      origin: 'auto' as const,
      confirmed: false,
      cableChoice: choice,
    }]
    const next = reconcileMap(stale, gadgets, { ...base, connectionMap: { connections: stale } })
    const hdmi = next.find((c) => c.toGadgetId === 'monitor' && c.cableType === 'HDMI')
    assert.equal(hdmi?.cableChoice, undefined)
  })
})

describe('同じ組み合わせを複数本で繋ぐ（ステレオの L/R・デュアル電源）', () => {
  it('本数の宣言ぶんだけ必要本数が増える', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard()]
    const single = generateWiring(gadgets, plan(gadgets))
    const doubled = generateWiring(gadgets, plan(gadgets, [{
      id: 'saved-hdmi', fromGadgetId: 'pc', toGadgetId: 'monitor', cableType: 'HDMI',
      origin: 'auto', confirmed: true, count: 2,
    }]))
    assert.equal(countOf(single, 'HDMI'), 1)
    assert.equal(countOf(doubled, 'HDMI'), 2)
  })

  it('つなぎ方は1行のまま（申告は2本まとめて1つ）', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard()]
    const saved: MapConnection[] = [{
      id: 'saved-hdmi', fromGadgetId: 'pc', toGadgetId: 'monitor', cableType: 'HDMI',
      origin: 'auto', confirmed: true, count: 2,
    }]
    const base = plan(gadgets, saved)
    const rows = cabledConnectionGroups(gadgets, { ...base, wiringResult: generateWiring(gadgets, base) })
    assert.equal(rows.length, 1)
    assert.equal(rows[0][0].count, 2)
  })

  it('プランを読み直しても2本目が消えない', () => {
    // 以前は dedupeMapConnections が2本目を捨てていて、アプリを開き直すと
    // 申告ごと消えていた。本数に畳んで残す
    const gadgets = [pc(), monitor()]
    const twice: MapConnection[] = ['a', 'b'].map((id) => ({
      id, fromGadgetId: 'audio-if', toGadgetId: 'speaker', cableType: 'Audio6_3mm',
      origin: 'manual' as const, confirmed: true,
    }))
    const normalized = normalizePlan(plan(gadgets, twice))
    const trs = (normalized.connectionMap?.connections ?? []).filter((c) => c.cableType === 'Audio6_3mm')
    assert.equal(trs.length, 1)
    assert.equal(trs[0].count, 2)
  })

  it('引き直しても本数が残る', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard()]
    const base = plan(gadgets)
    const hdmi = generateWiring(gadgets, base).connections.find((c) => c.cableType === 'HDMI')!
    const saved: MapConnection[] = [{
      id: 'auto-hdmi', fromGadgetId: hdmi.fromGadgetId, toGadgetId: hdmi.toGadgetId,
      cableType: 'HDMI', origin: 'auto', confirmed: false, count: 2,
    }]
    const next = reconcileMap(saved, gadgets, { ...base, connectionMap: { connections: saved } })
    assert.equal(next.find((c) => c.cableType === 'HDMI')?.count, 2)
  })

  it('読み直して畳んでも上限を超えない（DB の CHECK は 1〜8）', () => {
    const gadgets = [pc(), monitor()]
    const many: MapConnection[] = Array.from({ length: MAX_CABLE_COUNT + 3 }, (_, i) => ({
      id: `l-${i}`, fromGadgetId: 'pc', toGadgetId: 'monitor', cableType: 'HDMI',
      origin: 'manual' as const, confirmed: true,
    }))
    const normalized = normalizePlan(plan(gadgets, many))
    assert.equal(normalized.connectionMap?.connections?.[0].count, MAX_CABLE_COUNT)
  })
})

describe('複数本の宣言は口も本数ぶん使う', () => {
  // 2口タップ（壁コンセント1口に挿す）に、デュアル電源の PC とモニター
  const strip = () => g('strip', 'PowerStrip', [p('Power', 'output', 2, { label: '2極' }), p('Power', 'input')])
  const dualPsuPc = (extra: Partial<Gadget> = {}) => g('pc', 'PC', [
    p('Power', 'input', 2),
    p('HDMI', 'output', 1, { supportsVideo: true }),
  ], { pcFormFactor: 'desktop', ...extra })
  const powerLine = (from: string, to: string, count: number): MapConnection => ({
    id: `power-${to}`, fromGadgetId: from, toGadgetId: to, cableType: 'Power', origin: 'auto', confirmed: true, count,
  })
  const deskPlan = (gadgets: Gadget[], saved: MapConnection[], outletCount = 1): DeskPlan => ({
    ...plan(gadgets, saved), outletCount,
  })
  const poweredFrom = (result: ReturnType<typeof generateWiring>, id: string) =>
    result.connections.find((c) => c.toGadgetId === id && c.cableType === 'Power')?.fromGadgetId

  it('デュアル電源（×2）はタップの口を2つ使い、あふれた機器を知らせる', () => {
    const gadgets = [strip(), dualPsuPc(), monitor()]
    const result = generateWiring(gadgets, deskPlan(gadgets, [powerLine('strip', 'pc', 2)]))
    assert.equal(poweredFrom(result, 'pc'), 'strip')
    // 以前はモニターもタップに挿さり、3口要るのに警告も出なかった
    assert.notEqual(poweredFrom(result, 'monitor'), 'strip')
    assert.ok(result.warnings.some((w) => w.includes('monitor')), result.warnings.join('\n'))
  })

  it('宣言のある機器が後から足されたものでも、先に口を確保する', () => {
    // モニターの方が導入が古い（割り当ての順番が先）構成
    const gadgets = [strip(), dualPsuPc({ createdAt: '2026-09-01T00:00:00.000Z' }), monitor()]
    const result = generateWiring(gadgets, deskPlan(gadgets, [powerLine('strip', 'pc', 2)]))
    assert.equal(poweredFrom(result, 'pc'), 'strip')
    assert.notEqual(poweredFrom(result, 'monitor'), 'strip')
  })

  it('宣言した本数ぶんの空きが無ければ知らせる', () => {
    const oneOutlet = g('strip', 'PowerStrip', [p('Power', 'output', 1, { label: '2極' }), p('Power', 'input')])
    const gadgets = [oneOutlet, dualPsuPc()]
    const result = generateWiring(gadgets, deskPlan(gadgets, [powerLine('strip', 'pc', 2)]))
    assert.equal(poweredFrom(result, 'pc'), 'strip')
    assert.ok(result.warnings.some((w) => w.includes('空きが1つ')), result.warnings.join('\n'))
  })

  it('英語の警告は空きが1つのとき単数で出す', () => {
    const oneOutlet = g('strip', 'PowerStrip', [p('Power', 'output', 1, { label: '2極' }), p('Power', 'input')])
    const gadgets = [oneOutlet, dualPsuPc()]
    const result = generateWiring(gadgets, deskPlan(gadgets, [powerLine('strip', 'pc', 2)]), 'en')
    assert.ok(
      result.warnings.some((w) => w === 'pc: Set to use 2 plugs on strip, but only 1 is free.'),
      result.warnings.join('\n'),
    )
  })

  it('壁コンセントから ×2 と宣言したら壁の口を2つ数える', () => {
    const gadgets = [strip(), dualPsuPc(), monitor()]
    // 壁2口。電源タップは先に壁へ挿す（配下へ配るため優先して通電させる）ので、PC に残るのは1口
    const result = generateWiring(gadgets, deskPlan(gadgets, [powerLine('wall', 'pc', 2)], 2))
    // タップの空きがあっても、宣言どおり壁から取る（別の給電元へ回すと宣言が外れる）
    assert.equal(poweredFrom(result, 'pc'), 'wall')
    assert.ok(result.warnings.some((w) => w.includes('壁コンセント') && w.includes('空きが1つ')), result.warnings.join('\n'))
  })

  it('ステレオの L/R（×2）はオーディオIFの出力を2つ使う', () => {
    const audioIf = g('if', 'AudioInterface', [
      p('USB_C', 'input', 1, { label: 'USB-C (PC接続)' }),
      p('Audio6_3mm', 'output', 2, { label: '6.3mm TRS モニター出力' }),
    ])
    const pair = g('speakers', 'Speaker', [p('Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' })])
    const sub = g('sub', 'Speaker', [p('Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' })])
    const gadgets = [pc(), audioIf, pair, sub]
    const baseline = generateWiring(gadgets, plan(gadgets))
    const toSpeaker = baseline.connections.find((c) => c.fromGadgetId === 'if' && c.toGadgetId === 'speakers')
    assert.ok(toSpeaker, '前提：IF → スピーカーの線がある')
    assert.ok(baseline.connections.some((c) => c.fromGadgetId === 'if' && c.toGadgetId === 'sub'), '前提：宣言が無ければ2台目も IF に挿さる')
    const declared = generateWiring(gadgets, plan(gadgets, [{
      id: 'l-r', fromGadgetId: 'if', toGadgetId: 'speakers', cableType: toSpeaker.cableType,
      origin: 'auto', confirmed: true, count: 2,
    }]))
    // L/R で2口とも埋まるので、2台目は IF の出力に挿さらない
    assert.equal(declared.connections.some((c) => c.fromGadgetId === 'if' && c.toGadgetId === 'sub'), false)
  })
})

describe('手で引いた線も必要本数に入る', () => {
  // エンジンは HDMI で繋ぐ。USB-C（映像）はエンジンが引かない組み合わせ
  const usbcMonitor = () => g('monitor', 'Monitor', [
    p('HDMI', 'input', 1, { supportsVideo: true }),
    p('USB_C', 'input', 1, { supportsVideo: true }),
    p('Power', 'input'),
  ])
  const autoLinesOf = (gadgets: Gadget[]): MapConnection[] =>
    generateWiring(gadgets, plan(gadgets)).connections.map((c, i) => ({
      id: `auto-${i}`, fromGadgetId: c.fromGadgetId, toGadgetId: c.toGadgetId, cableType: c.cableType,
      origin: 'auto' as const, confirmed: false, chargingOnly: c.chargingOnly,
    }))
  const total = (rows: { count: number }[]) => rows.reduce((n, r) => n + r.count, 0)

  it('エンジンが引かない線を手で足すと、その本数ぶん増える', () => {
    const gadgets = [pc(), usbcMonitor()]
    const saved = [...autoLinesOf(gadgets), {
      id: 'map-manual-1', fromGadgetId: 'monitor', toGadgetId: 'pc', cableType: 'USB_C' as const,
      origin: 'manual' as const, confirmed: true, count: 2,
    }]
    const withManual = plan(gadgets, saved)
    const result = generateWiring(gadgets, withManual)
    assert.equal(countOf(result, 'USB_C'), 2)
    // つなぎ方の行（1行＝1本の線）と本数の宣言を足した数が合う
    const rows = cabledConnectionGroups(gadgets, { ...withManual, wiringResult: result })
    assert.equal(total(result.requiredCables), rows.reduce((n, group) => n + (group[0].count ?? 1), 0))
  })

  it('逆向きに引いた本数の宣言もエンジンの線に効く', () => {
    const gadgets = [pc(), monitor()]
    const result = generateWiring(gadgets, plan(gadgets, [{
      id: 'saved-hdmi', fromGadgetId: 'monitor', toGadgetId: 'pc', cableType: 'HDMI',
      origin: 'manual', confirmed: true, count: 2,
    }]))
    assert.equal(countOf(result, 'HDMI'), 2)
  })

  it('デスクから外した機材への手動の線は数えない', () => {
    const gadgets = [pc(), usbcMonitor()]
    const saved: MapConnection[] = [{
      id: 'map-manual-1', fromGadgetId: 'pc', toGadgetId: 'gone', cableType: 'USB_C',
      origin: 'manual', confirmed: true,
    }]
    assert.equal(countOf(generateWiring(gadgets, plan(gadgets, saved)), 'USB_C'), 0)
  })

  it('配線図で消した直後は、保存済みの出力から数え直しても消した線が入らない', () => {
    // 手で直した直後は generateWiring を回し直さず countRequiredCables だけで数える
    const gadgets = [pc(), monitor()]
    const base = plan(gadgets)
    const stale = generateWiring(gadgets, base)
    const hdmi = stale.connections.find((c) => c.cableType === 'HDMI')!
    const afterDelete: DeskPlan = {
      ...base,
      connectionMap: {
        connections: autoLinesOf(gadgets).filter((c) => c.cableType !== 'HDMI'),
        dismissedPairs: [[hdmi.fromGadgetId, hdmi.toGadgetId].sort().join('~') + '|HDMI'],
      },
    }
    const recounted = countRequiredCables(gadgets, afterDelete, stale.connections)
    assert.equal(recounted.find((r) => r.cableType === 'HDMI')?.count ?? 0, 0)
    // 作り直した場合と同じ本数になる
    assert.deepEqual(recounted, generateWiring(gadgets, afterDelete).requiredCables)
  })

  it('充電時のみの線を手で常時の線にしたら、常時の側で数える', () => {
    const gadgets = [pc(), monitor(), wiredKeyboard(), wirelessMouse(), charger()]
    const promoted = autoLinesOf(gadgets).map((c) => c.chargingOnly
      ? { ...c, chargingOnly: false, origin: 'manual' as const, confirmed: true }
      : c)
    const result = generateWiring(gadgets, plan(gadgets, promoted))
    assert.equal(chargingCountOf(result, 'USB_C'), 0)
    assert.equal(countOf(result, 'USB_C'), 2)
  })
})
