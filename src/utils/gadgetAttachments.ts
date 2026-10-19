import type { DeskPlan, Gadget, MapConnection } from '../types'

/** 支持先はデスクごとの選択なので、持ち物のポートを上書きせず表示・配線用に反映する。 */
export function applyMonitorArmAssignment(gadget: Gadget, plan: DeskPlan): Gadget {
  const armType = gadget.category === 'Monitor'
    ? 'MonitorArm' as const
    : gadget.category === 'Microphone'
      ? 'MicArm' as const
      : undefined
  if (!armType) return gadget
  const assigned = armType === 'MonitorArm'
    ? plan.monitorArmAssignments?.[gadget.id]
    : plan.micArmAssignments?.[gadget.id]
  if (assigned === undefined) return gadget
  const ports = gadget.ports.filter((port) => port.type !== armType || port.direction !== 'input')
  return { ...gadget, ports: assigned === null ? ports : [
    ...ports,
    { id: armType === 'MonitorArm' ? 'desk_monitor_arm' : 'desk_mic_arm', type: armType, direction: 'input', count: 1 },
  ] }
}

/**
 * タブレット用のペン（Apple Pencil 等）か。
 * Accessory には保護フィルムやケースも入るので、カテゴリだけで「ペン」と読まない。
 */
export function isStylusAccessory(g: Gadget): boolean {
  return g.category === 'Accessory' && (
    g.ports.some((p) => p.type === 'wirelessCharging' && p.direction !== 'output') ||
    /pencil|stylus|ペンシル|スタイラス/i.test(`${g.name} ${g.model ?? ''}`)
  )
}

/**
 * 配線図のカード右上に横へ並べるバッジのうち、何個まで絵で出すか。
 * ケース・フィルム・ペンと何点も付けるとカードの幅を越えて隣へはみ出すので、
 * 収まらないぶんは最後の1枠を「+n」にまとめる。寸法はカード側（右5・間隔20・枠22）に合わせる。
 */
export function badgeSlots(total: number, nodeWidth: number): { shown: number; hidden: number } {
  const slots = Math.max(1, Math.floor((nodeWidth - 7) / 20))
  if (total <= slots) return { shown: total, hidden: 0 }
  return { shown: slots - 1, hidden: total - (slots - 1) }
}

/** このガジェットへ取り付け・収納しているもの（`mounting` の向き先がこれのもの） */
export function mountedOn(hostId: string, gadgets: Gadget[]): Gadget[] {
  return gadgets.filter((g) => g.id !== hostId && g.mounting?.targetGadgetId === hostId)
}

/**
 * 並べ替え済みの一覧で、取り付けているものを本体の直後へ寄せる。
 *
 * 寄せるのは1段だけ。本体自身もどこかに付いている（ケース→スマホ→スタンド、相互参照）と
 * 字下げが何段にもなるか、互いの下に入って一覧から消えるので、その場合は元の位置に残す。
 * 本体が一覧に無いもの（別のデスクにある等）も元の位置に残す。
 */
export function orderWithMounted(sorted: Gadget[]): { gadget: Gadget; mounted: boolean }[] {
  const byId = new Map(sorted.map((g) => [g.id, g]))
  const parentOf = (g: Gadget): Gadget | undefined => {
    const target = g.mounting?.targetGadgetId
    return target && target !== g.id ? byId.get(target) : undefined
  }
  const hostOf = (g: Gadget): Gadget | undefined => {
    const host = parentOf(g)
    return host && !parentOf(host) ? host : undefined
  }
  const children = new Map<string, Gadget[]>()
  for (const g of sorted) {
    const host = hostOf(g)
    if (host) children.set(host.id, [...(children.get(host.id) ?? []), g])
  }
  const out: { gadget: Gadget; mounted: boolean }[] = []
  for (const g of sorted) {
    if (hostOf(g)) continue
    out.push({ gadget: g, mounted: false })
    for (const child of children.get(g.id) ?? []) out.push({ gadget: child, mounted: true })
  }
  return out
}

/**
 * モニター／マイクアームごとに、支えている機材を直前へまとめる。
 *
 * アームの「シングル／デュアル」は商品名ではなく、配線図に保存された支持線を正とする。
 * 並べ替えでアームが先に来る場合もモニターが先に来る場合も、グループ全体は最初の1台の位置に置く。
 */
export function orderWithMonitorArms(sorted: Gadget[], connections: MapConnection[]): Gadget[] {
  const byId = new Map(sorted.map((g) => [g.id, g]))
  const targetsByArm = new Map<string, Set<string>>()
  const armByTarget = new Map<string, string>()

  for (const connection of connections) {
    if (connection.cableType !== 'MonitorArm' && connection.cableType !== 'MicArm') continue
    const arm = byId.get(connection.fromGadgetId)
    const target = byId.get(connection.toGadgetId)
    const matches = connection.cableType === 'MonitorArm'
      ? arm?.category === 'MonitorArm' && target?.category === 'Monitor'
      : arm?.category === 'MicArm' && target?.category === 'Microphone'
    if (!matches || !arm || !target) continue
    // 壊れた手動データで1台が複数アームへつながっていても、一覧から重複・消失させない。
    if (armByTarget.has(target.id)) continue
    armByTarget.set(target.id, arm.id)
    const ids = targetsByArm.get(arm.id) ?? new Set<string>()
    ids.add(target.id)
    targetsByArm.set(arm.id, ids)
  }

  if (targetsByArm.size === 0) return sorted

  const emitted = new Set<string>()
  const out: Gadget[] = []
  for (const gadget of sorted) {
    if (emitted.has(gadget.id)) continue
    const armId = (gadget.category === 'MonitorArm' || gadget.category === 'MicArm') && targetsByArm.has(gadget.id)
      ? gadget.id
      : armByTarget.get(gadget.id)
    if (!armId) {
      out.push(gadget)
      emitted.add(gadget.id)
      continue
    }

    const targetIds = targetsByArm.get(armId) ?? new Set<string>()
    for (const candidate of sorted) {
      if (!targetIds.has(candidate.id) || emitted.has(candidate.id)) continue
      out.push(candidate)
      emitted.add(candidate.id)
    }
    const arm = byId.get(armId)
    if (arm && !emitted.has(arm.id)) {
      out.push(arm)
      emitted.add(arm.id)
    }
  }
  return out
}

/** 一覧固有のまとまりを作ってから、ケース等の取り付け関係を反映する。 */
export function orderDeskGadgets(
  sorted: Gadget[],
  connections: MapConnection[],
): { gadget: Gadget; mounted: boolean }[] {
  return orderWithMounted(orderWithMonitorArms(sorted, connections))
}
