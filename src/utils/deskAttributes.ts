import { DeskPlan, Gadget, PlanPurpose } from '../types'

/**
 * デスクの属性。「同じ条件のデスクを探す」ための軸で、閲覧者はここから横断する。
 *
 * 大半はガジェットの構成から計算できるので保存しない（構成を変えたら属性も追従する）。
 * 保存するのは構成から導けない用途だけで、それは DeskPlan が持つ。
 */
export type DeskAttributeGroup = 'purpose' | 'os' | 'form' | 'desk'

export interface DeskAttribute {
  /**
   * 絞り込みに使うキー。表示名は言語で変わるので、判定には必ずこちらを使う
   * （`${group}:${値}` の形。値は言語に依存しない）
   */
  key: string
  group: DeskAttributeGroup
  label: string
}

/** キーから値の部分だけ取り出す（'purpose:gaming' → 'gaming'） */
export function attributeValue(attr: DeskAttribute): string {
  return attr.key.slice(attr.key.indexOf(':') + 1)
}

const purposeLabels: Record<PlanPurpose, [string, string]> = {
  gaming:    ['ゲーム', 'Gaming'],
  work:      ['仕事', 'Work'],
  dev:       ['開発', 'Development'],
  creative:  ['クリエイティブ', 'Creative'],
  streaming: ['配信・録画', 'Streaming'],
  study:     ['学習', 'Study'],
  music:     ['音楽・DTM', 'Music'],
  other:     ['その他', 'Other'],
}

// OS の表示名。保存値（pcOs）はそのままキーに使い、表示だけ通りの良い呼び方にする
const OS_LABELS: Record<string, string> = {
  macOS: 'Mac',
  Windows: 'Windows',
  Linux: 'Linux',
  ChromeOS: 'ChromeOS',
}

export function deskAttributes(
  plan: Pick<DeskPlan, 'purposes' | 'otherPurposeLabel'>,
  gadgets: Gadget[],
  lang: 'ja' | 'en',
): DeskAttribute[] {
  const ja = lang === 'ja'
  const out: DeskAttribute[] = []

  // 手入力ぶん。探す人が最初に見る軸なので、自動導出属性より先に並べる
  for (const purpose of plan.purposes ?? []) {
    const custom = purpose === 'other' ? plan.otherPurposeLabel?.trim() : undefined
    out.push({
      key: `purpose:${purpose}`,
      group: 'purpose',
      label: custom || purposeLabels[purpose][ja ? 0 : 1],
    })
  }
  // ここから構成による自動導出

  // OS は PC の台数ぶん重複するので種類だけ出す
  const osSet = new Set<string>()
  for (const g of gadgets) {
    if (g.pcOs) osSet.add(g.pcOs)
  }
  for (const os of osSet) out.push({ key: `os:${os}`, group: 'os', label: OS_LABELS[os] ?? os })

  // 形態はノートPC・ミニPCだけ出す。デスクトップは大多数で、あっても探す軸にならない
  const forms = new Set(gadgets.map((g) => g.pcFormFactor).filter(Boolean) as string[])
  if (forms.has('laptop')) out.push({ key: 'form:laptop', group: 'form', label: ja ? 'ノートPC' : 'Laptop' })
  if (forms.has('mini')) out.push({ key: 'form:mini', group: 'form', label: ja ? 'ミニPC' : 'Mini PC' })

  // 昇降デスクかどうかは机そのものの性格が変わるので出す。
  // 幅とモニター枚数は「探す軸」としては効かないので属性にしない
  if (gadgets.some((g) => g.category === 'Desk' && g.isHeightAdjustable)) {
    out.push({ key: 'desk:standing', group: 'desk', label: ja ? '昇降デスク' : 'Standing desk' })
  }

  return out
}

/**
 * 公開時に desks.attributes へ入れるキー列（058）。
 *
 * 保存するのはキーだけ。ラベルを保存すると、ja で公開したデスクが
 * en の閲覧者にも日本語で出る。表示名は閲覧側の言語で引き直す。
 */
export function deskAttributeKeys(
  plan: Parameters<typeof deskAttributes>[0],
  gadgets: Gadget[],
): string[] {
  return deskAttributes(plan, gadgets, 'en').map((a) => a.key)
}

/**
 * キーから表示名を引く（`deskAttributeKeys` の逆）。
 *
 * 用途「その他」の自由入力は保存していないので総称に落ちる。閲覧側の一覧に
 * 他人の自由入力をそのまま並べる面でもあり、ここは総称のままでよい。
 * 知らないキー（新しい端末が書いたもの）は null を返して落とす。
 */
export function attributeLabelFromKey(key: string, lang: 'ja' | 'en'): string | null {
  const sep = key.indexOf(':')
  if (sep < 0) return null
  const group = key.slice(0, sep) as DeskAttributeGroup
  const value = key.slice(sep + 1)
  const ja = lang === 'ja'
  switch (group) {
    case 'purpose':
      return purposeLabels[value as PlanPurpose]?.[ja ? 0 : 1] ?? null
    case 'os':
      return OS_LABELS[value] ?? value
    case 'form':
      if (value === 'laptop') return ja ? 'ノートPC' : 'Laptop'
      if (value === 'mini') return ja ? 'ミニPC' : 'Mini PC'
      return null
    case 'desk':
      return value === 'standing' ? (ja ? '昇降デスク' : 'Standing desk') : null
    default:
      return null
  }
}

// 公開プロフィールに並べるときの群の順。探す人が最初に見る軸から並べる
const GROUP_ORDER: DeskAttributeGroup[] = ['purpose', 'os', 'form', 'desk']

/**
 * 複数の公開デスクの属性を人単位にまとめる。
 *
 * デスクをまたいで同じ属性が付くのが普通（同じ人は同じ OS を使い続ける）なので
 * 重複は畳む。件数は出さない — 公開デスクが1〜3件では「2件で使用」がノイズになる。
 */
export function profileAttributes(keyLists: (string[] | undefined)[], lang: 'ja' | 'en'): DeskAttribute[] {
  const seen = new Set<string>()
  const out: DeskAttribute[] = []
  for (const key of keyLists.flatMap((keys) => keys ?? [])) {
    if (seen.has(key)) continue
    seen.add(key)
    const label = attributeLabelFromKey(key, lang)
    if (!label) continue
    out.push({ key, group: key.slice(0, key.indexOf(':')) as DeskAttributeGroup, label })
  }
  return out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
}
