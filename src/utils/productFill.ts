import { Gadget, Port } from '../types'
import { isPowerFeedPort } from './portRoles'
import { cableTypeFromName } from './cableTypeFromName'
import { ProductSuggestion } from './productSuggestions'
import { normalizeHttpUrl } from './url'
import { GADGET_NAME_MAX_LENGTH } from '../constants/textLimits'
import { trimAndTruncate } from './truncateText'

// ─── 枠への商品割り当て ──────────────────────────────────────────
//
// テンプレートで作られた枠（isPlaceholder）に「どの商品か」を確定させる。
// ポートの手編集・寸法・PCパーツなどの細かい設定は詳細画面の担当で、
// ここは商品を決めるのに要るぶんだけを触る。

/** 充電・給電のためだけに付いている入力ポートか */
function isPowerInputPort(port: Port): boolean {
  if (port.direction !== 'input') return false
  if (port.type === 'Power' || port.type === 'wirelessCharging') return true
  // テンプレートが付ける「給電 (C)」。データ用の USB-C 入力と区別する
  return port.type === 'USB_C' && isPowerFeedPort(port)
}

/**
 * 商品側のポートに給電の口が無いときだけ、枠が持っていた給電ポートを引き継ぐ。
 * 商品DBのポートは映像・データ端子しか登録されていないものがあり、そのまま
 * 載せ替えると電源線が1本も引けないガジェットになってしまう。
 */
function mergePowerInput(productPorts: Port[], previousPorts: Port[]): Port[] {
  const ports = productPorts.map((p) => ({ ...p }))
  if (ports.some(isPowerInputPort)) return ports
  const carried = previousPorts.filter(isPowerInputPort)
  const usedIds = new Set(ports.map((p) => p.id))
  return [
    ...ports,
    ...carried.map((p, i) => ({ ...p, id: usedIds.has(p.id) ? `pw_${i}` : p.id })),
  ]
}

const isArmInputPort = (port: Port) =>
  port.direction === 'input' && (port.type === 'MonitorArm' || port.type === 'MicArm')

/**
 * 枠が持っていたアームの受け口を、商品ポートに無ければ引き継ぐ。
 * 商品DB・プリセットは受け口を持たないため、載せ替えるとアームの支持線が引けなくなる
 */
function mergeArmInput(productPorts: Port[], previousPorts: Port[]): Port[] {
  const usedIds = new Set(productPorts.map((p) => p.id))
  const carried = previousPorts.filter((prev) =>
    isArmInputPort(prev) && !productPorts.some((p) => p.type === prev.type && p.direction === 'input'))
  return [
    ...productPorts,
    ...carried.map((p, i) => ({ ...p, id: usedIds.has(p.id) ? `arm_${i}` : p.id })),
  ]
}

export interface ProductFillInput {
  /** 入力欄の商品名。予測変換から選んだ場合は suggestion.name と同じ */
  name: string
  /** 予測変換・商品一覧から選んだ候補。手入力だけのときは無い */
  suggestion?: ProductSuggestion
  /** 解決済みの購入URL。無ければ候補が持っているURLを使う */
  purchaseUrl?: string | null
}

export function applyProductToGadget(gadget: Gadget, input: ProductFillInput): Gadget {
  const { name, suggestion, purchaseUrl } = input
  const normalizedName = trimAndTruncate(name, GADGET_NAME_MAX_LENGTH)
  // 整えると空になる名前（見えない文字だけ）なら枠のまま返す。呼び出し側が trim() だけで
  // 「入力あり」と判定して渡してくると、ここで枠の印を外して名前の無い実物のガジェットに
  // 変えてしまう。判定をどの画面が持つかに関係なく、ここで止める
  if (!normalizedName) return gadget
  const isCable = gadget.category === 'Cable'
  // ケーブルは線そのものなので端子を持たない（配線エンジンもポートを見ない）。
  // 商品のポートを載せると、編集画面にポート欄が無いぶん見ることも消すこともできない
  // データが増え、公開デスクにも出てしまう
  const ports = !isCable && suggestion?.ports?.length
    ? mergeArmInput(mergePowerInput(suggestion.ports, gadget.ports), gadget.ports)
    : gadget.ports
  const url = normalizeHttpUrl(purchaseUrl)
    ?? normalizeHttpUrl(suggestion?.affiliateUrl)
    ?? normalizeHttpUrl(suggestion?.officialUrl)
    ?? gadget.url

  return {
    ...gadget,
    // 名前はここで上限に収める。入力欄の上限は打った文字にしか効かず、予測変換・
    // 商品一覧から選んだ名前（商品DBの名前は長いまま入っている）は素通りしてくる。
    // テンプレートの枠埋め（ProductFill）と作成時の枠（TemplateDetail）の両方がここを通る
    name: normalizedName,
    isPlaceholder: undefined,
    ports,
    productId: suggestion?.productId ?? gadget.productId,
    url: url ?? undefined,
    // 商品DBの価格は取り込み時点のスナップショットで実売とズレるため、
    // 金額が未入力のときだけ埋める
    price: gadget.price == null && suggestion?.priceJpy != null ? suggestion.priceJpy : gadget.price,
    pcFormFactor: gadget.category === 'PC'
      ? (suggestion?.pcFormFactor ?? gadget.pcFormFactor)
      : gadget.pcFormFactor,
    // 商品DBもプリセットもケーブルの種別を持たないので商品名から読む。
    // すでに決まっているものは上書きしない
    cableType: isCable ? (gadget.cableType ?? cableTypeFromName(name)) : gadget.cableType,
  }
}
