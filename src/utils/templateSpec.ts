import { Gadget, GadgetCategory, Port, PortType } from '../types'

// ─── テンプレート作成直前に聞く「実物に合わせる」値 ─────────────────
//
// テンプレートの枠はカテゴリ標準のポートで作られるため、口数・「1台が左右に割れるか」・
// アームに載せるかを当て推量している。外れると配線図の本数・形がそのまま間違うので、
// 作成前に聞いて枠へ反映する。

export type TemplateSpecCountField =
  | 'usbC'
  | 'usbA'
  | 'wireless'
  | 'outlets'
  | 'hdmiInput'
  | 'displayPortInput'
  | 'videoUsbCInput'
  | 'lan'

export interface TemplateSpec {
  usbC?: number
  usbA?: number
  wireless?: number
  outlets?: number
  hdmiInput?: number
  displayPortInput?: number
  videoUsbCInput?: number
  lan?: number
  stereoPair?: boolean
  speakerInputSide?: 'L' | 'R'
  hasSubwoofer?: boolean
  splitKeyboard?: boolean
  /** モニター・マイクをアームに載せるか */
  onArm?: boolean
  /** アームが支える台数の下限。候補から選んだデュアルアームの2台を1台へ減らさないよう、増やす方向にだけ効かせる */
  armHolds?: number
  /**
   * PC の形。給電の口・図の置き場所まで変わるので、ガジェットへ当てずに枠そのもの（TemplateItem）を
   * 作り替えて反映する（TemplateDetailScreen の items）。以前はジャンルの段で聞いていた
   */
  pcFormFactor?: 'desktop' | 'laptop' | 'mini'
}

/**
 * 口数を聞くカテゴリと、聞く口の並び。
 * PC・ドックの映像出力（HDMI・DisplayPort・USB-C 映像）は聞かない。作成前に答えられる人が少なく、
 * モニターへの線は標準の口で足りる。USB-C も映像の有無で分けず「USB-C」1つで聞く
 */
export const TEMPLATE_SPEC_COUNT_FIELDS: Partial<Record<GadgetCategory, TemplateSpecCountField[]>> = {
  PC: ['usbA', 'usbC'],
  Monitor: ['hdmiInput', 'displayPortInput', 'videoUsbCInput'],
  Charger: ['usbC', 'usbA', 'wireless'],
  PowerStrip: ['outlets'],
  Hub: ['usbA'],
  Dock: ['usbA'],
  Router: ['lan'],
}

/** 1台が左右2ノードに割れうるカテゴリ */
export const TEMPLATE_SPEC_SPLIT_CATEGORIES: GadgetCategory[] = ['Speaker', 'Keyboard']

/** アームに載せられるカテゴリと、そのアーム */
export const TEMPLATE_SPEC_ARM_FOR: Partial<Record<GadgetCategory, 'MonitorArm' | 'MicArm'>> = {
  Monitor: 'MonitorArm',
  Microphone: 'MicArm',
}

const FIELD_PORT: Record<TemplateSpecCountField, {
  type: PortType
  direction: Port['direction']
  extra?: Partial<Port>
  matches?: (port: Port) => boolean
}> = {
  // 映像の有無で分けない。増減は先頭の USB-C の口（映像の可否もその口のまま）で数える
  usbC: { type: 'USB_C', direction: 'output' },
  usbA: { type: 'USB_A', direction: 'output' },
  // 追加・編集画面の充電器と同じラベル。配線エンジンはラベルでワイヤレス出力を見分ける箇所がある
  wireless: { type: 'wirelessCharging', direction: 'output', extra: { label: 'ワイヤレス出力' } },
  outlets: { type: 'Power', direction: 'output' },
  hdmiInput: { type: 'HDMI', direction: 'input', extra: { supportsVideo: true } },
  displayPortInput: { type: 'DisplayPort', direction: 'input', extra: { supportsVideo: true } },
  videoUsbCInput: { type: 'USB_C', direction: 'input', extra: { supportsVideo: true }, matches: (port) => port.supportsVideo === true },
  lan: { type: 'Ethernet', direction: 'output' },
}

export function templateSpecFieldPortType(field: TemplateSpecCountField): PortType {
  return FIELD_PORT[field].type
}

export const TEMPLATE_SPEC_COUNT_RANGE: Record<TemplateSpecCountField, { min: number; max: number }> = {
  usbC: { min: 0, max: 10 },
  usbA: { min: 0, max: 10 },
  wireless: { min: 0, max: 10 },
  // 口が0の電源タップは置く意味が無く、給電元として選ばれないノードが浮くだけになる
  outlets: { min: 1, max: 20 },
  hdmiInput: { min: 0, max: 10 },
  displayPortInput: { min: 0, max: 10 },
  videoUsbCInput: { min: 0, max: 10 },
  lan: { min: 0, max: 10 },
}

const isPortOf = (port: Port, type: PortType, direction: Port['direction']) =>
  port.type === type && port.direction === direction

/** ポート構成から口数を読む（ページの初期値を枠の標準ポートと一致させるため） */
export function readTemplateSpecCounts(category: GadgetCategory, ports: Port[]): TemplateSpec {
  const spec: TemplateSpec = {}
  for (const field of TEMPLATE_SPEC_COUNT_FIELDS[category] ?? []) {
    const { type, direction, matches } = FIELD_PORT[field]
    spec[field] = ports
      .filter((port) => isPortOf(port, type, direction) && (!matches || matches(port)))
      .reduce((sum, port) => sum + port.count, 0)
  }
  return spec
}

function setPortCount(
  ports: Port[],
  type: PortType,
  direction: Port['direction'],
  count: number,
  extra?: Partial<Port>,
  matchesField?: (port: Port) => boolean,
  idSuffix?: string,
): Port[] {
  const matches = (port: Port) => isPortOf(port, type, direction) && (!matchesField || matchesField(port))
  const firstIndex = ports.findIndex(matches)
  const rest = ports.filter((port) => !matches(port))
  if (count <= 0) return rest
  const base = firstIndex >= 0 ? ports[firstIndex] : { id: `spec_${idSuffix ?? `${direction}_${type}`}`, type, direction, count, ...extra }
  const next: Port = { ...base, count }
  // 元の位置に戻す。ポートの並びは配線エンジンが口を選ぶ順に効く
  const insertAt = firstIndex >= 0 ? ports.slice(0, firstIndex).filter((port) => !matches(port)).length : rest.length
  return [...rest.slice(0, insertAt), next, ...rest.slice(insertAt)]
}

/**
 * 作成済みのガジェットが今持っている答え。機材の段に戻ってきたとき、ページの初期値を
 * 枠の標準ではなく前に答えた内容にする（標準で出すと、答え直さずに作成しただけで戻る）
 */
export function readGadgetTemplateSpec(gadget: Gadget): TemplateSpec {
  const spec = readTemplateSpecCounts(gadget.category, gadget.ports)
  if (gadget.category === 'Speaker') {
    return { ...spec, stereoPair: !!gadget.stereoPair, speakerInputSide: gadget.speakerInputSide ?? 'R', hasSubwoofer: !!gadget.hasSubwoofer }
  }
  if (gadget.category === 'Keyboard') return { ...spec, splitKeyboard: !!gadget.splitKeyboard }
  const armType = TEMPLATE_SPEC_ARM_FOR[gadget.category]
  if (armType) return { ...spec, onArm: gadget.ports.some((port) => isPortOf(port, armType, 'input')) }
  return spec
}

/**
 * 口数を外した答え。候補から選んだ商品の口数は商品のポートが正なので、ページで聞かない。
 * 聞いていない口数を答えとして渡すと、作成時に商品の端子を枠の標準の口数で書き換える
 */
export function withoutSpecCounts(category: GadgetCategory, spec: TemplateSpec): TemplateSpec {
  const next = { ...spec }
  for (const field of TEMPLATE_SPEC_COUNT_FIELDS[category] ?? []) delete next[field]
  return next
}

/** 聞いた値を枠のガジェットへ反映する。未回答の項目は触らない */
export function applyTemplateSpec(gadget: Gadget, spec: TemplateSpec | undefined): Gadget {
  if (!spec) return gadget
  let ports = gadget.ports
  for (const field of TEMPLATE_SPEC_COUNT_FIELDS[gadget.category] ?? []) {
    const value = spec[field]
    const definition = FIELD_PORT[field]
    if (value !== undefined) {
      ports = setPortCount(ports, definition.type, definition.direction, value, definition.extra, definition.matches, field)
    }
  }
  if ((gadget.category === 'MonitorArm' || gadget.category === 'MicArm') && spec.armHolds !== undefined) {
    const current = ports.filter((port) => isPortOf(port, gadget.category as PortType, 'output')).reduce((sum, port) => sum + port.count, 0)
    if (spec.armHolds > current) ports = setPortCount(ports, gadget.category, 'output', spec.armHolds)
  }
  const armType = TEMPLATE_SPEC_ARM_FOR[gadget.category]
  // 枠は受け口を持たないので、載せるときだけ足す。載せないと答えても既にある受け口は外さない
  // （商品ポートが元から持つ受け口は、その商品の実際の状態として扱う）
  if (armType && spec.onArm) {
    const isArmInput = (port: Port) => port.type === armType && port.direction === 'input'
    if (!ports.some(isArmInput)) ports = [...ports, { id: 'spec_arm', type: armType, direction: 'input', count: 1 }]
  }
  const next: Gadget = { ...gadget, ports }
  // 保存形は追加・編集画面と揃える（false を持たせず undefined にする項目がある）
  if (gadget.category === 'Speaker') {
    if (spec.stereoPair !== undefined) {
      next.stereoPair = spec.stereoPair
      next.speakerInputSide = spec.stereoPair ? (spec.speakerInputSide ?? 'R') : undefined
    }
    if (spec.hasSubwoofer !== undefined) next.hasSubwoofer = spec.hasSubwoofer ? true : undefined
  }
  if (gadget.category === 'Keyboard' && spec.splitKeyboard !== undefined) {
    next.splitKeyboard = spec.splitKeyboard ? true : undefined
  }
  return next
}

export interface SpecArmPlan {
  armCategory: 'MonitorArm' | 'MicArm'
  holds: number
  /** 構成に既にあるアーム。無ければ新しく枠を作る */
  existingKey?: string
}

/**
 * 「アームに載せる」の答えから、足すアーム・広げるアームを決める。
 * アームを自分で足していない人がほとんどなので、載せる台数ぶんを支える1本を用意する。
 * 既にアームがある構成では増やさず、1本目の支える台数で不足を埋める（デュアルアーム相当）
 */
export function planSpecArms(
  items: { key: string; category: GadgetCategory }[],
  specs: Record<string, TemplateSpec>,
  /**
   * 枠 → 割り当てた持ち物。持ち物の枠は仕様を聞かず、作成時に作り直しもしない。
   * 載っているかは持ち物のアームの受け口で数え、持ち物のアームは支えられる台数を差し引く
   * （広げる先には選ばない。選ぶと台数の答えが持ち物に反映されず、載せきれない図になる）
   */
  owned: Record<string, Gadget> = {},
): SpecArmPlan[] {
  const plans: SpecArmPlan[] = []
  for (const [target, armCategory] of Object.entries(TEMPLATE_SPEC_ARM_FOR) as [GadgetCategory, 'MonitorArm' | 'MicArm'][]) {
    const mounted = items.filter((item) => {
      if (item.category !== target) return false
      const gadget = owned[item.key]
      return gadget
        ? gadget.ports.some((port) => port.type === armCategory && port.direction === 'input')
        : !!specs[item.key]?.onArm
    }).length
    if (mounted === 0) continue
    const arms = items.filter((item) => item.category === armCategory)
    const ownedCapacity = arms.reduce((sum, item) => {
      const gadget = owned[item.key]
      if (!gadget) return sum
      const holds = gadget.ports.filter((port) => isPortOf(port, armCategory, 'output')).reduce((n, port) => n + port.count, 0)
      return sum + Math.max(1, holds)
    }, 0)
    const need = mounted - ownedCapacity
    if (need <= 0) continue
    const slots = arms.filter((item) => !owned[item.key])
    plans.push(slots.length === 0
      ? { armCategory, holds: need }
      : { armCategory, holds: Math.max(1, need - (slots.length - 1)), existingKey: slots[0].key })
  }
  return plans
}
