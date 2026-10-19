import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import { cableLabel } from '../constants/portTypes'
import type { Gadget } from '../types'
import { customCategoryOf } from './customCategory'
import { deskTopColorLabel } from './deskTopColor'
import { mountedOn } from './gadgetAttachments'
import { localizedGadgetMemo } from './localizedGadgetName'
import { isGroundedPort } from './portRoles'

// 他人のデスクの機材詳細に並べる「項目名と値」。アプリ（SharedGadgetDetailModal）と
// Web の公開デスク（GadgetDetailSheet）で同じ項目を出すため、ここにだけ置く。
// 商品リンクは値の出し方が画面ごとに違うので、行の位置だけ受け取る
export function sharedGadgetSpecRows(
  gadget: Gadget,
  gadgets: Gadget[],
  lang: 'ja' | 'en',
  fmtPrice: (price: number) => string,
  purchaseLinkUrls: string[] = [],
): Array<[string, string]> {
  const ja = lang === 'ja'
  const gadgetNames = new Map(gadgets.map((g) => [g.id, g.name]))
  const yesNo = (value: boolean) => value ? (ja ? 'ON' : 'On') : (ja ? 'OFF' : 'Off')
  const namesFor = (ids?: string[]) => ids?.map((id) => gadgetNames.get(id)).filter(Boolean).join(ja ? '、' : ', ')
  const rows: Array<[string, string | undefined]> = [
    [ja ? 'ジャンル' : 'Category', customCategoryOf(gadget)?.name ?? (ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN)[gadget.category] ?? gadget.category],
    [ja ? '数量' : 'Quantity', (gadget.quantity ?? 1) > 1 ? String(gadget.quantity) : undefined],
    [ja ? '型番' : 'Model', gadget.model],
    [ja ? '購入価格' : 'Price', gadget.price != null ? fmtPrice(gadget.price) : undefined],
    [ja ? '小計' : 'Subtotal', gadget.price != null && (gadget.quantity ?? 1) > 1 ? fmtPrice(gadget.price * (gadget.quantity ?? 1)) : undefined],
    [ja ? '導入日' : 'Added', gadget.purchasedAt],
    [ja ? '撤去日' : 'Removed', gadget.removedAt],
    ...purchaseLinkUrls.map((url) => [ja ? '商品リンク' : 'Product link', url] as [string, string]),
    [ja ? 'メモ' : 'Notes', localizedGadgetMemo(gadget, lang)],
    [ja ? 'サイズ' : 'Size', gadget.dimensions],
    [ja ? '天板の色' : 'Desktop color', gadget.category === 'Desk' ? deskTopColorLabel(gadget.deskTopColor, lang) : undefined],
    [ja ? 'デスク高さ' : 'Desk height', gadget.deskHeight],
    [ja ? '最小高さ' : 'Minimum height', gadget.deskHeightMin],
    [ja ? '最大高さ' : 'Maximum height', gadget.deskHeightMax],
    [ja ? '昇降方式' : 'Lift type', gadget.isHeightAdjustable ? (gadget.deskLiftType === 'electric' ? (ja ? '電動' : 'Electric') : (ja ? '手動' : 'Manual')) : undefined],
    [ja ? 'PC形状' : 'PC form factor', gadget.pcFormFactor
      ? (gadget.pcFormFactor === 'desktop' ? (ja ? 'デスクトップ' : 'Desktop')
        : gadget.pcFormFactor === 'laptop' ? (ja ? 'ノートPC' : 'Laptop') : 'Mini')
      : undefined],
    [ja ? 'ゲーム機種別' : 'Console form factor', gadget.consoleFormFactor
      ? (gadget.consoleFormFactor === 'handheld' ? (ja ? '携帯機' : 'Handheld') : (ja ? '据え置き' : 'Stationary'))
      : undefined],
    [ja ? 'モニターサイズ' : 'Monitor size', gadget.monitorSizeInches ? `${gadget.monitorSizeInches}"` : undefined],
    [ja ? '解像度' : 'Resolution', gadget.monitorResolution],
    [ja ? 'リフレッシュレート' : 'Refresh rate', gadget.monitorRefreshRateHz ? `${gadget.monitorRefreshRateHz} Hz` : undefined],
    [ja ? '画面サイズ' : 'Screen size', gadget.smartDeviceScreenSize],
    [ja ? 'ストレージ' : 'Storage', gadget.smartDeviceStorage],
    [ja ? '容量' : 'Capacity', gadget.storageCapacity],
    [ja ? 'バッテリー容量' : 'Battery capacity', gadget.batteryCapacityMah ? `${gadget.batteryCapacityMah} mAh` : gadget.batteryCapacityWh ? `${gadget.batteryCapacityWh} Wh` : undefined],
    [ja ? 'ケーブル本数' : 'Cable count', gadget.cableCount ? String(gadget.cableCount) : undefined],
    [ja ? 'ケーブル種類' : 'Cable type', gadget.cableType ? cableLabel(gadget.cableType, lang) : undefined],
    [ja ? 'アース' : 'Grounded', gadget.category === 'PowerStrip' ? yesNo(gadget.ports.some((port) => port.type === 'Power' && port.direction === 'output' && isGroundedPort(port))) : undefined],
    [ja ? 'OS' : 'OS', gadget.pcOs],
    ['CPU', gadget.pcCpu],
    ['GPU', gadget.pcGpu],
    ['RAM', gadget.pcRam],
    [ja ? 'ストレージ' : 'Storage', gadget.pcStorage],
    ['Thunderbolt', gadget.category === 'PC' ? yesNo(!!gadget.pcThunderbolt) : undefined],
    [ja ? 'ステレオペア' : 'Stereo pair', gadget.category === 'Speaker' ? yesNo(!!gadget.stereoPair) : undefined],
    [ja ? '入力側' : 'Input side', gadget.category === 'Speaker' && gadget.stereoPair ? gadget.speakerInputSide : undefined],
    [ja ? 'ウーファー' : 'Subwoofer', gadget.category === 'Speaker' ? yesNo(!!gadget.hasSubwoofer) : undefined],
    [ja ? '分割キーボード' : 'Split keyboard', gadget.category === 'Keyboard' ? yesNo(!!gadget.splitKeyboard) : undefined],
    [ja ? '飾りとして表示' : 'Display only', gadget.displayOnly != null ? yesNo(gadget.displayOnly) : undefined],
    [ja ? 'ゲーム' : 'Games', gadget.games?.join(ja ? '、' : ', ')],
    [ja ? 'ワイヤレス給電先' : 'Wireless charging targets', namesFor(gadget.wirelessTargetGadgetIds)],
    [ja ? 'Bluetooth接続先' : 'Bluetooth targets', namesFor(gadget.bluetoothTargetGadgetIds)],
    [ja ? 'スマートホーム電源' : 'Smart home power', gadget.smartHomePowerSource],
    [ja ? '設置・固定先' : 'Mounted / stored with', gadget.mounting ? gadgetNames.get(gadget.mounting.targetGadgetId) : undefined],
    [ja ? '固定方法の補足' : 'Mounting details', gadget.mounting?.note],
    [ja ? '取り付け・収納しているもの' : 'Attached / stored', namesFor(mountedOn(gadget.id, gadgets).map((item) => item.id))],
    [ja ? '運用モード' : 'Operating modes', gadget.operationModes?.join(ja ? '、' : ', ')],
    [ja ? '現在のモード' : 'Active mode', gadget.activeOperationMode],
    [ja ? 'ソフト・設定' : 'Software / settings', gadget.softwareSettings],
  ]
  return rows.filter((row): row is [string, string] => !!row[1])
}
