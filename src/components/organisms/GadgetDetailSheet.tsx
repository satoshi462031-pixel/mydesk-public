import { Alert } from '../../utils/alert'
import * as WebBrowser from 'expo-web-browser'
import { deskTopColorLabel } from '../../utils/deskTopColor'
import { useEffect, useMemo, useState } from 'react'
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { categoryIconColor, ICONS, categoryBaseColor } from '../../constants/icons'
import { cableLabel, cableSortRank, portIconColor, portLabel } from '../../constants/portTypes'
import { AppColors, useApp } from '../../context/AppContext'
import { UndoSnackbar } from '../molecules/UndoSnackbar'
import { resolveProduct, resolvePurchaseLinks, resolvePurchaseLinksSync } from '../../repositories/productRepository'
import { analytics, EVENTS, errorProperties, linkProperties } from '../../services/analytics'
import { Gadget, GadgetCategory, MapConnection } from '../../types'
import type { PurchaseLink } from '../../types/product'
import { gadgetSubNickname, gadgetTitle, localizedGadgetMemo, localizedGadgetName, gadgetGenreLabel } from '../../utils/localizedGadgetName'
import { isGroundedPort } from '../../utils/portRoles'
import { validGadgetPrice } from '../../utils/gadgetStats'
import { isWirelessPowerPort } from '../../utils/gadgetPorts'
import { mountedOn } from '../../utils/gadgetAttachments'
import { AppIcon } from '../atoms/AppIcon'
import { TogglePop } from '../atoms/TogglePop'
import { CopyProductNameButton } from '../atoms/CopyProductNameButton'
import { BrandChip } from '../molecules/BrandChip'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { GadgetPublicDesks } from './GadgetPublicDesks'
import { IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER, KIND_BADGE_COLORS, statusTextColor, UI_METRICS } from '../../constants/ui'
import { affiliateDisclosure, purchaseLinkLabel } from '../../utils/url'
import { GadgetLibraryDeskUsage, libraryPeriodLabel } from '../../utils/gadgetLibrary'

type Row = { label: string; value: string }

interface Props {
  visible: boolean
  gadget: Gadget | null
  connections?: MapConnection[]
  relatedGadgets?: Gadget[]
  readOnly: boolean
  colors: AppColors
  lang: 'ja' | 'en'
  fmtPrice: (n: number | null | undefined) => string
  fmtDimStr: (value: string) => string
  unitLabel: string
  onClose: () => void
  onEdit: (gadget: Gadget) => void
  onEditConnection?: (connection: MapConnection) => void
  onDrawConnection?: () => void
  onAddWirelessConnection?: () => void
  onDelete?: (gadget: Gadget) => void
  deleting?: boolean
  /** ブランド枠のタップ。渡さないと枠は押せない表示だけになる */
  onOpenBrand?: (key: string, label: string) => void
  /**
   * 同じガジェットを使っている公開デスクへ移る。渡さなければその段は出さない。
   * タイルは memo なので、呼び出し側で useCallback したものを渡す
   */
  onOpenDesk?: (deskId: string) => void
  /** 自分の機材全体で共通のお気に入り */
  favorite?: boolean
  recommended?: boolean
  onToggleRecommended?: () => void
  undoAction?: { message: string; undoing: boolean; disabled?: boolean; onUndo: () => void }
  usageHistory?: readonly GadgetLibraryDeskUsage[]
  /**
   * お気に入りの付け外し。渡さなければ星は出さない。
   * 一覧の右スワイプは気づかれにくく、読み上げでは操作できないので、ここにも入口を置く
   */
  onToggleFavorite?: () => void
}

const CONNECTION_CATEGORIES: GadgetCategory[] = ['Mouse', 'Keyboard', 'PenTablet', 'Controller', 'Headphone', 'Earphone', 'Speaker', 'Microphone', 'Webcam', 'Camera', 'SmallDevice', 'StreamingDevice', 'SmartHome', 'Light', 'Smartwatch', 'VRGlass', 'Router', 'GameConsole', 'Printer']
const PORT_CATEGORIES: GadgetCategory[] = ['PC', 'Monitor', 'TV', 'Projector', 'Hub', 'Dock', 'GameConsole', 'StreamingDevice', 'CaptureDevice', 'Camera', 'KVM', 'UPS', 'Smartphone', 'Tablet', 'Storage', 'AudioInterface', 'HeadphoneAmp', 'Mixer', 'WallPanel', 'Instrument', 'Cable', 'Printer', 'Printer3D', 'PenTablet', 'SmallDevice', 'Webcam', 'Microphone', 'Router', 'NetworkSwitch', 'Modem', 'MonitorArm', 'MicArm']

function portCount(count: number, ja: boolean): string {
  if (ja) return `${count}口`
  return `${count} port${count === 1 ? '' : 's'}`
}

export function GadgetDetailSheet({ visible, gadget, connections, relatedGadgets, readOnly, colors: C, lang, fmtPrice, fmtDimStr, unitLabel, onClose, onEdit, onEditConnection, onDrawConnection, onAddWirelessConnection, onDelete, deleting = false, onOpenDesk, onOpenBrand, favorite, usageHistory, onToggleFavorite, recommended, onToggleRecommended, undoAction }: Props) {
  const { isDark } = useApp()
  const ja = lang === 'ja'

  // 購入リンクは Gadget に焼き付けず、開くたびに商品マスタから引く。
  // shop_links に Amazon を足せば既存ガジェットにも反映される。
  // 商品一覧から選んだ機材にだけ出す（catalogOnly）。他人の画面（SharedGadgetDetailModal）と
  // 同じ判定にして、自分に見えているリンクがそのまま見る人にも出るようにする
  const [buyLinks, setBuyLinks] = useState<PurchaseLink[]>(
    () => (visible && gadget ? resolvePurchaseLinksSync(gadget, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true }) : []),
  )
  useEffect(() => {
    if (!visible || !gadget) {
      setBuyLinks([])
      return
    }
    // 商品マスタへの問い合わせを待つとボタンが数百ms遅れて現れ、レイアウトが飛ぶ。
    // 問い合わせ無しで決まるぶん（キャッシュ）を先に出し、
    // 確定したリンクで下の then が上書きする
    setBuyLinks(resolvePurchaseLinksSync(gadget, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true }))
    let alive = true
    resolvePurchaseLinks(gadget, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true })
      .then((links) => {
        if (!alive) return
        setBuyLinks(links)
        // ショップごとに出したぶんを記録する。Amazon と楽天で開かれ方が違うため
        for (const link of links) {
          analytics.track(EVENTS.AFFILIATE_LINK_DISPLAYED, {
            category: gadget.category,
            product_id: gadget.productId,
            placement: readOnly ? 'public_desk_sheet' : 'desk_sheet',
            ...linkProperties(link.url),
          })
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [visible, gadget, lang, readOnly])

  // 画像とブランドも購入リンクと同じ扱い。Gadget には焼き付けず、
  // 開くたびに商品マスタから引く（1往復にまとめてある）
  const [productImage, setProductImage] = useState<string | null>(null)
  const [favoritePopKey, setFavoritePopKey] = useState(0)
  const [productBrand, setProductBrand] = useState<string | null>(null)
  useEffect(() => {
    if (!visible || !gadget) {
      setProductImage(null)
      setProductBrand(null)
      return
    }
    setProductImage(null)
    setProductBrand(null)
    let alive = true
    resolveProduct(gadget)
      .then((product) => {
        if (!alive) return
        setProductImage(product?.image ?? null)
        setProductBrand(product?.brand ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [visible, gadget])

  const details = useMemo(() => {
    if (!gadget) return null
    const g = gadget
    const basic: Row[] = []
    const quantity = g.quantity ?? 1
    if (quantity > 1) basic.push({ label: ja ? '数量' : 'Quantity', value: String(quantity) })
    if (validGadgetPrice(g) != null) basic.push({ label: quantity > 1 ? (ja ? '単価' : 'Unit price') : (ja ? '購入価格' : 'Price'), value: fmtPrice(g.price) })
    if (validGadgetPrice(g) != null && quantity > 1) basic.push({ label: ja ? '小計' : 'Subtotal', value: fmtPrice((g.price ?? 0) * quantity) })
    if (g.purchasedAt) basic.push({ label: ja ? '導入日' : 'Added', value: g.purchasedAt })

    const dimBase = g.dimensions?.replace(/ ?cm$/, '')
    let size: string | undefined
    if (dimBase) {
      if (g.isHeightAdjustable && g.deskHeightMin && g.deskHeightMax) size = `${fmtDimStr(dimBase)} × ${fmtDimStr(g.deskHeightMin)}〜${fmtDimStr(g.deskHeightMax)}${unitLabel}`
      else if (g.deskHeight) size = `${fmtDimStr(dimBase)} × ${fmtDimStr(g.deskHeight)}${unitLabel}`
      else size = `${fmtDimStr(dimBase)}${unitLabel}`
    } else if (g.isHeightAdjustable && g.deskHeightMin && g.deskHeightMax) size = `${fmtDimStr(g.deskHeightMin)}〜${fmtDimStr(g.deskHeightMax)}${unitLabel}`
    else if (g.deskHeight) size = `${fmtDimStr(g.deskHeight)}${unitLabel}`
    if (size) basic.push({ label: ja ? 'サイズ' : 'Size', value: size })
    const topColor = g.category === 'Desk' ? deskTopColorLabel(g.deskTopColor, lang) : undefined
    if (topColor) basic.push({ label: ja ? '天板の色' : 'Desktop color', value: topColor })

    const connection: Row[] = []
    if (CONNECTION_CATEGORIES.includes(g.category)) {
      const hasBluetooth = g.ports.some((port) => port.type === 'Bluetooth')
      const hasWired = g.ports.some((port) => ['USB_C', 'USB_A', 'Thunderbolt', 'Audio3_5mm', 'HDMI', 'DisplayPort', 'Ethernet'].includes(port.type) && (port.direction === 'input' || port.direction === 'bidirectional'))
      if (hasBluetooth || hasWired) {
        const value = hasBluetooth && hasWired
          ? (ja ? '有線 / 無線' : 'Wired / Wireless')
          : hasBluetooth ? (ja ? '無線 (Bluetooth)' : 'Wireless (Bluetooth)') : (ja ? '有線' : 'Wired')
        connection.push({ label: ja ? '接続方式' : 'Connection', value })
      }
    }

    if (g.category === 'Charger') {
      const hasMagSafe = g.ports.some((port) => port.label?.includes('MagSafe'))
      const hasQi = g.ports.some((port) => port.label?.includes('Qi'))
      const wirelessPort = g.ports.find((port) => port.direction === 'output' && isWirelessPowerPort(port))
      const hasUsbOut = g.ports.some((port) => ['USB_C', 'USB_A'].includes(port.type) && port.direction === 'output')
      if (wirelessPort || hasUsbOut) connection.push({
        label: ja ? '充電方式' : 'Charging type',
        value: hasMagSafe ? (ja ? 'MagSafe ワイヤレス' : 'MagSafe Wireless') : hasQi ? (ja ? 'Qi ワイヤレス' : 'Qi Wireless') : wirelessPort ? (ja ? 'ワイヤレス' : 'Wireless') : (ja ? '有線 (USB)' : 'Wired (USB)'),
      })
      if (wirelessPort) connection.push({ label: ja ? 'ワイヤレス充電' : 'Wireless charging', value: portCount(wirelessPort.count, ja) })
      for (const port of g.ports.filter((item) => item.direction === 'output' && ['USB_C', 'USB_A'].includes(item.type))) {
        connection.push({ label: portLabel(port.type, lang), value: portCount(port.count, ja) })
      }
    }

    if (g.category === 'PowerStrip') {
      const labels: Array<[string, string]> = [['Power', ja ? 'コンセント' : 'Outlet'], ['USB_C', 'USB-C'], ['USB_A', 'USB-A']]
      for (const [type, label] of labels) {
        const port = g.ports.find((item) => item.type === type && item.direction === 'output')
        if (port) connection.push({ label, value: portCount(port.count, ja) })
      }
    }

    const inputs = g.ports.filter((port) => port.direction === 'input')
    const powerMethods: string[] = []
    if (inputs.some((port) => port.label?.includes('MagSafe'))) powerMethods.push('MagSafe')
    else if (inputs.some((port) => port.label?.includes('Qi'))) powerMethods.push(ja ? 'Qi ワイヤレス' : 'Qi Wireless')
    if (inputs.some((port) => port.type === 'Power' && !port.label?.includes('ワイヤレス') && !port.label?.includes('Wireless'))) powerMethods.push(ja ? 'AC電源' : 'AC Power')
    if (inputs.some((port) => ['USB_C', 'Thunderbolt'].includes(port.type))) powerMethods.push('USB-C')
    if (inputs.some((port) => port.type === 'USB_A')) powerMethods.push('USB-A')
    if (g.category === 'Charger' && powerMethods.length === 0) powerMethods.push(ja ? 'AC電源' : 'AC Power')
    if (powerMethods.length > 0) connection.push({ label: ja ? '給電方法' : 'Power Input', value: powerMethods.join(' / ') })

    const specs: Row[] = []
    const mountingTarget = relatedGadgets?.find((item) => item.id === g.mounting?.targetGadgetId)
    if (g.mounting && mountingTarget) {
      const mountingLabel = ({ mounted_on: ja ? '上に設置' : 'Mounted on', attached_to: ja ? '取り付け' : 'Attached to', stored_in: ja ? '収納' : 'Stored in', inside: ja ? '内部に組込' : 'Installed inside' } as const)[g.mounting.type]
      specs.push({ label: ja ? '設置・固定' : 'Mounting', value: `${mountingLabel}: ${localizedGadgetName(mountingTarget, lang)}${g.mounting.note ? ` (${g.mounting.note})` : ''}` })
    }
    // 逆向き。ケース・保護フィルムは付けた側にしか記録が無く、本体から辿れなかった
    const mountedItems = relatedGadgets ? mountedOn(g.id, relatedGadgets) : []
    if (mountedItems.length > 0) {
      specs.push({ label: ja ? '取り付け・収納しているもの' : 'Attached / stored', value: mountedItems.map((item) => localizedGadgetName(item, lang)).join(ja ? '、' : ', ') })
    }
    if (g.operationModes?.length) specs.push({ label: ja ? '運用モード' : 'Operating modes', value: g.operationModes.join(ja ? '、' : ', ') })
    if (g.activeOperationMode) specs.push({ label: ja ? '現在のモード' : 'Active mode', value: g.activeOperationMode })
    if (g.softwareSettings) specs.push({ label: ja ? 'ソフト・設定' : 'Software / settings', value: g.softwareSettings })
    if (g.category === 'Desk' && g.isHeightAdjustable) {
      specs.push({
        label: ja ? '昇降方式' : 'Lift type',
        value: g.deskLiftType === 'electric' ? (ja ? '電動' : 'Electric') : (ja ? '手動' : 'Manual'),
      })
    }
    if (g.category === 'PC') {
      if (g.pcOs) specs.push({ label: 'OS', value: g.pcOs })
      if (g.pcFormFactor) specs.push({ label: ja ? 'PC形状' : 'PC form factor', value: g.pcFormFactor === 'desktop' ? (ja ? 'デスクトップ' : 'Desktop') : g.pcFormFactor === 'laptop' ? (ja ? 'ノートPC' : 'Laptop') : 'Mini' })
      if (g.pcCpu) specs.push({ label: 'CPU', value: g.pcCpu })
      if (g.pcGpu) specs.push({ label: 'GPU', value: g.pcGpu })
      if (g.pcRam) specs.push({ label: 'RAM', value: g.pcRam })
      if (g.pcStorage) specs.push({ label: ja ? 'ストレージ' : 'Storage', value: g.pcStorage })
    }
    if (g.category === 'GameConsole' && g.consoleFormFactor) {
      specs.push({ label: ja ? 'ゲーム機種別' : 'Console form factor', value: g.consoleFormFactor === 'handheld' ? (ja ? '携帯機' : 'Handheld') : (ja ? '据え置き' : 'Stationary') })
    }
    if (g.category === 'Monitor') {
      if (g.monitorSizeInches) specs.push({ label: ja ? 'モニターサイズ' : 'Monitor size', value: `${g.monitorSizeInches}"` })
      if (g.monitorResolution) specs.push({ label: ja ? '解像度' : 'Resolution', value: g.monitorResolution })
      if (g.monitorRefreshRateHz) specs.push({ label: ja ? 'リフレッシュレート' : 'Refresh rate', value: `${g.monitorRefreshRateHz} Hz` })
    }
    if (['Smartphone', 'Tablet', 'Smartwatch'].includes(g.category) && g.smartDeviceScreenSize) {
      specs.push({ label: ja ? '画面サイズ' : 'Screen size', value: g.smartDeviceScreenSize })
    }
    if (['Smartphone', 'Tablet'].includes(g.category) && g.smartDeviceStorage) {
      specs.push({ label: ja ? 'ストレージ' : 'Storage', value: g.smartDeviceStorage })
    }
    if (g.category === 'Storage' && g.storageCapacity) specs.push({ label: ja ? '容量' : 'Capacity', value: g.storageCapacity })
    if (g.batteryCapacityMah) specs.push({ label: ja ? 'バッテリー容量' : 'Battery capacity', value: `${g.batteryCapacityMah} mAh` })
    if (g.batteryCapacityWh) specs.push({ label: ja ? 'バッテリー容量' : 'Battery capacity', value: `${g.batteryCapacityWh} Wh` })
    if (g.category === 'PowerStrip' && g.ports.some((port) => port.type === 'Power' && port.direction === 'output' && isGroundedPort(port))) specs.push({ label: ja ? 'アース' : 'Grounded', value: ja ? 'あり（3極）' : 'Yes (3-prong)' })
    if (g.category === 'Cable') {
      if (g.cableType) specs.push({ label: ja ? 'ケーブル種類' : 'Cable type', value: cableLabel(g.cableType, lang) })
      if (g.cableCount) specs.push({ label: ja ? 'ケーブル本数' : 'Cable count', value: String(g.cableCount) })
    }
    return { basic, connection, specs, showPorts: PORT_CATEGORIES.includes(g.category) && g.ports.length > 0 }
  }, [gadget, ja, fmtPrice, fmtDimStr, unitLabel, relatedGadgets, lang])

  // 配線図ではアームを支えているガジェットのカードへ畳んでいるので、
  // アームの情報にたどり着ける場所がここしかない。ケーブルの一覧に混ぜると
  // 「信号の通る線」に見えるため、支持関係は独立した節に出す。
  const supportArms = useMemo(() => {
    if (!gadget || !connections) return []
    const byId = new Map((relatedGadgets ?? []).map((item) => [item.id, item]))
    return connections
      .filter((c) =>
        (c.cableType === 'MonitorArm' || c.cableType === 'MicArm') && c.toGadgetId === gadget.id,
      )
      .map((c) => byId.get(c.fromGadgetId))
      .filter((arm): arm is Gadget => !!arm)
  }, [gadget, connections, relatedGadgets])

  const currentConnections = useMemo(() => {
    if (!gadget || !connections) return []
    const names = new Map((relatedGadgets ?? []).map((item) => [item.id, localizedGadgetName(item, lang)]))
    const sourceNames: Record<string, string> = {
      wall: ja ? 'コンセント' : 'Outlet',
      solar: ja ? 'ソーラーパネル' : 'Solar panel',
      battery: ja ? '電池・バッテリー' : 'Battery',
    }
    const rows = connections
      .filter((connection) => connection.fromGadgetId === gadget.id || connection.toGadgetId === gadget.id)
      // 支持関係は下の「アーム」節で出すので、ケーブルの一覧には並べない
      .filter((connection) => connection.cableType !== 'MonitorArm' && connection.cableType !== 'MicArm')
      .map((connection) => {
        const outgoing = connection.fromGadgetId === gadget.id
        const otherId = outgoing ? connection.toGadgetId : connection.fromGadgetId
        return {
          connection,
          outgoing,
          otherName: names.get(otherId) ?? sourceNames[otherId] ?? otherId,
        }
      })
    // 同じケーブル種別の行は必ず隣り合わせにする。従来の in → out 順は種別グループの順序として使う。
    const groupRank = new Map<string, number>()
    for (const row of rows) {
      groupRank.set(
        row.connection.cableType,
        Math.min(Number(row.outgoing), groupRank.get(row.connection.cableType) ?? Infinity),
      )
    }
    return rows.sort((a, b) =>
      (groupRank.get(a.connection.cableType)! - groupRank.get(b.connection.cableType)!) ||
      // 種類どうしは必要なケーブル・つなぎ方の一覧と同じ順。識別子の文字列順だと
      // Audio → HDMI → Power → USB になり、ほかの一覧と逆向きに出ていた
      cableSortRank(a.connection.cableType) - cableSortRank(b.connection.cableType) ||
      a.connection.cableType.localeCompare(b.connection.cableType) ||
      Number(a.outgoing) - Number(b.outgoing) ||
      a.otherName.localeCompare(b.otherName, lang))
  }, [connections, gadget, ja, lang, relatedGadgets])

  // 充電のときだけ挿す線は配線図に描いていないので、ここが唯一の確認先になる。
  // 常時つながっているものと同じ列に混ぜると読み分けられないため節を分ける
  const wiredConnections = currentConnections.filter((row) => row.connection.chargingOnly !== true)
  const chargeConnections = currentConnections.filter((row) => row.connection.chargingOnly === true)
  // 常時の接続と充電時の接続で同じ行を使うため、描画だけ切り出す
  const renderConnectionRow = ({ connection, outgoing, otherName }: (typeof currentConnections)[number]) => {
    const directionColor = outgoing ? KIND_BADGE_COLORS.out : KIND_BADGE_COLORS.in
    const editable = !readOnly && !!onEditConnection
    const ConnectionRow = editable ? TouchableOpacity : View
    return (
      <ConnectionRow
        key={connection.id}
        style={[styles.connectionRow, editable && { minHeight: UI_METRICS.touchMinSize }]}
        onPress={editable ? () => onEditConnection?.(connection) : undefined}
        accessibilityRole={editable ? 'button' : undefined}
        accessibilityLabel={editable ? (ja ? `${otherName}との接続を編集` : `Edit connection with ${otherName}`) : undefined}
      >
        <View style={[styles.connectionDirection, { backgroundColor: directionColor }]}>
          <Text style={[styles.connectionDirectionText, { color: KIND_BADGE_COLORS.text }]}>{outgoing ? 'OUT' : 'IN'}</Text>
        </View>
        <Text style={[styles.connectionName, { color: C.text }]} numberOfLines={1}>{otherName}</Text>
        <Text style={[styles.connectionType, { color: C.textSub }]} numberOfLines={1}>
          {cableLabel(connection.cableType, lang)}
        </Text>
        {editable && <AppIcon name={ICONS.chevronRight} size={16} color={C.textMuted} />}
      </ConnectionRow>
    )
  }
  if (!gadget || !details) return null

  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} sheetStyle={styles.sheet}>
          <View style={styles.header}>
            <View style={[styles.categoryIcon, { backgroundColor: (categoryBaseColor(gadget.category, gadget.customCategory?.color, '#888888')) + '22' }]}>
              <CategoryIcon category={gadget.category} pcFormFactor={gadget.pcFormFactor} customIcon={gadget.customCategory?.icon} size={24} color={categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.name, { color: C.text }]} numberOfLines={2}>{gadgetTitle(gadget, lang)}</Text>
              <CopyProductNameButton name={gadget.isPlaceholder ? '' : localizedGadgetName(gadget, lang)} colors={C} lang={lang} />
              {/* 見出しが商品名になるとジャンルが絵だけになる。ジャンル名は読み飛ばしてよい補足、呼び名は読ませたい補足 */}
              {(!!gadgetGenreLabel(gadget, lang) || !!gadgetSubNickname(gadget)) && (
                <Text style={styles.nickname} numberOfLines={1}>
                  {!!gadgetGenreLabel(gadget, lang) && <Text style={{ color: C.textMuted }}>{gadgetGenreLabel(gadget, lang)}</Text>}
                  {!!gadgetGenreLabel(gadget, lang) && !!gadgetSubNickname(gadget) && <Text style={{ color: C.textMuted }}>{'  ·  '}</Text>}
                  {!!gadgetSubNickname(gadget) && <Text style={{ color: C.textSub }}>{gadgetSubNickname(gadget)}</Text>}
                </Text>
              )}
              {/* ブランドは商品マスタ由来。onOpenBrand が無ければ押せない枠になる */}
              <BrandChip
                brand={productBrand}
                colors={C}
                lang={lang}
                style={styles.brandSlot}
                onPress={onOpenBrand}
              />
            </View>
            {onToggleFavorite && (
              <TouchableOpacity
                onPress={() => {
                  if (!favorite) setFavoritePopKey((key) => key + 1)
                  onToggleFavorite()
                }}
                // 右隣の閉じるボタンの押せる範囲（12）と重ねない
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
                style={styles.favoriteButton}
                accessibilityRole="button"
                accessibilityLabel={favorite ? (ja ? 'お気に入りを解除' : 'Remove from favorites') : (ja ? 'お気に入りに追加' : 'Add to favorites')}
                accessibilityHint={ja ? '自分のすべてのデスクとマイページで共通です' : 'Shared across your desks and My Page'}
                accessibilityState={{ selected: !!favorite }}
              >
                <TogglePop popKey={favoritePopKey}>
                  <AppIcon name={favorite ? ICONS.starFilled : ICONS.star} size={22} color={C.favorite} />
                </TogglePop>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}><AppIcon name={ICONS.close} size={20} color={C.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {productImage && (
              <View style={[styles.imageSection, { borderBottomColor: C.border }]}>
                <Image
                  source={{ uri: productImage }}
                  style={[styles.productImage, { borderColor: C.border }]}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                  // 404 や差し替えで読めない URL のときに枠だけ残さない
                  onError={() => setProductImage(null)}
                />
              </View>
            )}
            <DetailSection title={ja ? '基本情報' : 'Overview'} rows={details.basic} colors={C} />
            {(onToggleRecommended || recommended) && (
              <View style={[styles.section, { borderBottomColor: C.border }]}>
                <TouchableOpacity
                  style={styles.recommendationButton}
                  onPress={onToggleRecommended}
                  disabled={!onToggleRecommended}
                  accessibilityRole={onToggleRecommended ? 'button' : undefined}
                  accessibilityLabel={onToggleRecommended
                    ? (recommended ? (ja ? 'このデスクのおすすめを解除' : 'Remove desk recommendation') : (ja ? 'このデスクのおすすめにする' : 'Recommend for this desk'))
                    : (ja ? 'このデスクのおすすめ' : 'Recommended for this desk')}
                  accessibilityState={{ selected: !!recommended }}
                >
                  <AppIcon name={recommended ? 'thumb-up' : 'thumb-up-outline'} size={20} color={recommended ? C.accentText : C.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.recommendationTitle, { color: C.text }]}>{ja ? 'このデスクのおすすめ' : 'Recommended for this desk'}</Text>
                    <Text style={[styles.recommendationHint, { color: C.textMuted }]}>{ja ? '公開デスクにも表示されます' : 'Also shown on your public desk'}</Text>
                  </View>
                  {onToggleRecommended && <Text style={{ color: C.accentText }}>{recommended ? (ja ? '解除' : 'Remove') : (ja ? '設定' : 'Set')}</Text>}
                </TouchableOpacity>
              </View>
            )}
            {usageHistory !== undefined && (
              <View style={[styles.section, { borderBottomColor: C.border }]}>
                <Text style={[styles.sectionTitle, { color: C.textMuted }]}>{ja ? 'デスクごとの使用履歴' : 'Usage by desk'}</Text>
                {usageHistory.length === 0 && <Text style={[styles.emptyText, { color: C.textMuted }]}>{ja ? 'デスクでの使用履歴はまだありません' : 'No desk usage recorded yet'}</Text>}
                {usageHistory.map((desk) => (
                  <View key={desk.deskId} style={styles.usageHistoryDesk}>
                    <Text style={[styles.usageHistoryName, { color: C.text }]}>{desk.deskName.trim() || (ja ? '名称未設定のデスク' : 'Untitled desk')}{desk.current ? (ja ? ' · 使用中' : ' · In use') : ''}</Text>
                    {desk.periods.length > 0 ? desk.periods.map((period, index) => (
                      <Text key={index} style={[styles.usageHistoryPeriod, { color: C.textSub }]}>
                        {libraryPeriodLabel(period, lang, false, desk.current)}{period.mode === 'decor' ? (ja ? ' · 飾り' : ' · Decor') : ''}
                      </Text>
                    )) : <Text style={[styles.usageHistoryPeriod, { color: C.textSub }]}>{desk.removedAt ? `?〜${desk.removedAt.replace(/-/g, '/')}` : (ja ? '期間未設定' : 'Dates not set')}</Text>}
                  </View>
                ))}
              </View>
            )}
            <DetailSection title={ja ? '接続・電源' : 'Connection & power'} rows={details.connection} colors={C} />
            {connections && (
              <View style={[styles.section, { borderBottomColor: C.border }]}>
                <Text style={[styles.sectionTitle, { color: C.textMuted }]}>
                  {ja ? `現在の接続 (${wiredConnections.length})` : `Current connections (${wiredConnections.length})`}
                </Text>
                {wiredConnections.length === 0 ? (
                  chargeConnections.length === 0 && (
                    <Text style={[styles.emptyText, { color: C.textMuted }]}>
                      {ja ? 'まだ接続がありません' : 'No connections yet'}
                    </Text>
                  )
                ) : wiredConnections.map(renderConnectionRow)}
              </View>
            )}
            {connections && chargeConnections.length > 0 && (
              <View style={[styles.section, { borderBottomColor: C.border }]}>
                <Text style={[styles.sectionTitle, { color: C.textMuted }]}>
                  {ja ? `充電するとき (${chargeConnections.length})` : `When charging (${chargeConnections.length})`}
                </Text>
                <Text style={[styles.emptyText, { color: C.textMuted }]}>
                  {ja ? '必要なときだけ挿すので、配線図には線を引いていません' : 'Plugged in only while charging, so no wire is drawn'}
                </Text>
                {chargeConnections.map(renderConnectionRow)}
              </View>
            )}
            {!readOnly && (onDrawConnection || onAddWirelessConnection) && (
              <View style={[styles.section, styles.connectionActions, { borderBottomColor: C.border }]}>
                {onDrawConnection && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.connectionActionButton, { borderColor: C.accentIcon }]}
                    onPress={onDrawConnection}
                    accessibilityRole="button"
                    accessibilityHint={ja ? 'つなぐ相手の機材をタップします' : 'Then tap the gadget to connect to'}
                  >
                    <AppIcon name="ray-start-arrow" size={16} color={C.accentIcon} />
                    <Text style={[styles.actionButtonText, { color: C.accentText }]}>{ja ? 'ここから線を引く' : 'Draw a wire from here'}</Text>
                  </TouchableOpacity>
                )}
                {onAddWirelessConnection && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.connectionActionButton, { borderColor: statusTextColor('success', isDark) }]}
                    onPress={onAddWirelessConnection}
                    accessibilityRole="button"
                  >
                    <AppIcon name="lightning-bolt-circle" size={16} color={statusTextColor('success', isDark)} />
                    <Text style={[styles.actionButtonText, { color: C.text }]}>{ja ? 'ワイヤレス充電を追加' : 'Add wireless charging'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {supportArms.length > 0 && (
              <View style={[styles.section, { borderBottomColor: C.border }]}>
                <Text style={[styles.sectionTitle, { color: C.textMuted }]}>{ja ? 'アーム' : 'Arm'}</Text>
                {supportArms.map((arm) => (
                  <View key={arm.id} style={styles.connectionRow}>
                    <CategoryIcon category={arm.category} pcFormFactor={arm.pcFormFactor} customIcon={arm.customCategory?.icon} size={16} color={categoryIconColor(arm.category, isDark, undefined, arm.customCategory?.color)} />
                    <Text style={[styles.connectionName, { color: C.text }]} numberOfLines={1}>
                      {localizedGadgetName(arm, lang)}
                    </Text>
                    <Text style={[styles.connectionType, { color: C.textMuted }]} numberOfLines={1}>
                      {arm.price != null ? fmtPrice(arm.price) : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <DetailSection title={ja ? '詳細スペック' : 'Specs'} rows={details.specs} colors={C} />
            {details.showPorts && <View style={[styles.section, { borderBottomColor: C.border }]}><Text style={[styles.sectionTitle, { color: C.textMuted }]}>{ja ? 'ポート構成' : 'Ports'}</Text>{gadget.ports.map((port) => <View key={port.id} style={styles.portRow}><View style={[styles.portDot, { backgroundColor: portIconColor(port.type, isDark) }]} /><Text style={[styles.portType, { color: C.text }]}>{portLabel(port.type, lang)}{port.count > 1 ? ` × ${port.count}` : ''}</Text><Text style={[styles.portDirection, { color: C.textMuted }]}>{ja ? ({ input: '入力', output: '出力', bidirectional: '双方向' }[port.direction]) : ({ input: 'In', output: 'Out', bidirectional: 'In/Out' }[port.direction])}</Text></View>)}</View>}
            {!!gadget.games?.length && <View style={[styles.section, { borderBottomColor: C.border }]}><Text style={[styles.sectionTitle, { color: C.textMuted }]}>{ja ? 'ゲーム' : 'Games'}</Text><View style={styles.tags}>{gadget.games.map((game, index) => <View key={`${game}-${index}`} style={[styles.tag, { backgroundColor: C.chip, borderColor: C.border }]}><Text style={[styles.tagText, { color: C.text }]}>{game}</Text></View>)}</View></View>}
            {/* 旧形式の notes から移した memo は保存時の trim を通っていない。空白だけだと空の節が出る */}
            {!!gadget.memo?.trim() && <View style={[styles.section, { borderBottomColor: C.border }]}><Text style={[styles.sectionTitle, { color: C.textMuted }]}>{ja ? 'メモ' : 'Notes'}</Text><Text style={[styles.notes, { color: C.text }]}>{localizedGadgetMemo(gadget, lang)}</Text></View>}
            {/* 商品リンクの直前。同じものを置いている人のデスクを見てから買うほうが、
                スペックの表だけ見て決めるより間違いが少ない */}
            {onOpenDesk && (
              <GadgetPublicDesks
                gadget={gadget}
                visible={visible}
                colors={C}
                lang={lang}
                isDark={isDark}
                fmtPrice={fmtPrice}
                style={[styles.section, { borderBottomColor: C.border }]}
                titleStyle={[styles.sectionTitle, { color: C.textMuted }]}
                onOpenDesk={onOpenDesk}
              />
            )}
            {buyLinks.length > 0 && (
              <View style={[styles.section, { borderBottomColor: C.border }]}>
                <Text style={[styles.sectionTitle, { color: C.textMuted }]}>
                  {ja ? '商品リンク' : buyLinks.length > 1 ? 'Product links' : 'Product link'}
                </Text>
                {/* 先頭（Amazon → 楽天の優先順で1本目）だけ塗り、残りは枠線で並べる */}
                {buyLinks.map((link, index) => (
                  <View key={link.url} style={[styles.urlRow, index > 0 && styles.urlRowSpacing]}>
                    <TouchableOpacity
                      style={[
                        styles.buyButton,
                        index === 0
                          ? { backgroundColor: C.accent, borderColor: C.accentIcon }
                          : { borderColor: C.border },
                      ]}
                      onPress={() => {
                        const props = {
                          category: gadget.category,
                          product_id: gadget.productId,
                          placement: readOnly ? 'public_desk_sheet' : 'desk_sheet',
                          ...linkProperties(link.url),
                        }
                        analytics.track(EVENTS.AFFILIATE_LINK_OPENED, props)
                        WebBrowser.openBrowserAsync(link.url).catch((error) => {
                          analytics.track(EVENTS.AFFILIATE_LINK_OPEN_FAILED, { ...props, ...errorProperties(error) })
                          Alert.alert(ja ? 'リンクを開けませんでした' : 'Could not open the link')
                        })
                      }}
                      activeOpacity={0.85}
                    >
                      <AppIcon name={ICONS.openExternal} size={16} color={index === 0 ? C.onAccent : C.accentIcon} />
                      <Text style={[styles.buyText, { color: index === 0 ? C.onAccent : C.accentText }]}>
                        {purchaseLinkLabel(link, lang)}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {!!affiliateDisclosure(buyLinks, lang) && (
                  <Text
                    style={[styles.affiliateNote, { color: C.textSub }]}
                    maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  >
                    {affiliateDisclosure(buyLinks, lang)}
                  </Text>
                )}
              </View>
            )}
          </ScrollView>
          {!readOnly && (
            <View style={[styles.actionBar, { borderTopColor: C.border, backgroundColor: C.card }]}>
              <TouchableOpacity
                style={[styles.actionButton, { borderColor: C.border }]}
                onPress={() => onEdit(gadget)}
                disabled={deleting}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={ja ? 'このガジェットを編集' : 'Edit this gadget'}
              >
                <AppIcon name={ICONS.edit} size={16} color={C.text} />
                <Text style={[styles.actionButtonText, { color: C.text }]}>{ja ? '編集' : 'Edit'}</Text>
              </TouchableOpacity>
              {!!onDelete && (
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: C.danger }]}
                  onPress={() => onDelete(gadget)}
                  disabled={deleting}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? 'このガジェットを削除' : 'Delete this gadget'}
                >
                  <AppIcon name={ICONS.trash} size={16} color={C.danger} />
                  <Text style={[styles.actionButtonText, { color: C.danger }]}>
                    {deleting ? (ja ? '削除中…' : 'Deleting…') : (ja ? '削除' : 'Delete')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {undoAction && <UndoSnackbar
            visible
            message={undoAction.message}
            lang={lang}
            backgroundColor={C.text}
            textColor={C.card}
            accentColor={C.accent}
            onUndo={undoAction.onUndo}
            undoing={undoAction.undoing}
            disabled={undoAction.disabled}
            bottomOffset={80}
          />}
    </BottomSheetModal>
  )
}

function DetailSection({ title, rows, colors: C }: { title: string; rows: Row[]; colors: AppColors }) {
  if (rows.length === 0) return null
  return <View style={[styles.section, { borderBottomColor: C.border }]}><Text style={[styles.sectionTitle, { color: C.textMuted }]}>{title}</Text>{rows.map(({ label, value }) => <View key={`${label}-${value}`} style={styles.row}><Text style={[styles.label, { color: C.textMuted }]}>{label}</Text><Text style={[styles.value, { color: C.text }]}>{value}</Text></View>)}</View>
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '82%', paddingHorizontal: 0 },
  // 左右はシートの中身の sheetGutter（他人のデスクの詳細 SharedGadgetDetailModal と同じ）。20 と 18 で割れていた
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: UI_METRICS.sheetGutter, paddingBottom: 16 },
  categoryIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  // 見出しとブランド枠を縦に積む。flex は包む側が持つ
  headerText: { flex: 1, minWidth: 0 },
  favoriteButton: { marginRight: 4 },
  recommendationButton: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  recommendationTitle: { fontSize: 13, fontWeight: '600' },
  recommendationHint: { fontSize: 11, marginTop: 4 },
  name: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  nickname: { fontSize: 13, marginTop: 2 },
  brandSlot: { marginTop: 5 },
  // 下余白は sheet ではなくこちらが持つ。他のシートと同じ値にする
  // （sheet 側で safe-area も足していた頃は、ここだけ下に 66 空いていた）
  content: { paddingBottom: 12 },
  imageSection: { paddingHorizontal: UI_METRICS.sheetGutter, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  // 楽天の商品写真は 400x400 の正方形。枠を全幅にすると左右に白地が伸びるので枠も正方形にする。
  // 下地を白で固定するのは、透過 PNG がダークモードで潰れるため
  productImage: { width: 200, height: 200, borderRadius: UI_METRICS.panelRadius, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  section: { paddingHorizontal: UI_METRICS.sheetGutter, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 11, fontWeight: '700', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, gap: 16 },
  label: { flex: 1, fontSize: 13 }, value: { maxWidth: '62%', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  emptyText: { fontSize: 13, lineHeight: 20 },
  usageHistoryDesk: { marginBottom: 12, gap: 4 },
  usageHistoryName: { fontSize: 13, fontWeight: '600' },
  usageHistoryPeriod: { fontSize: 12, lineHeight: 18 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  connectionActions: { gap: 10 },
  connectionActionButton: { flex: 0 },
  connectionDirection: { width: 34, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  connectionDirectionText: { fontSize: 9, fontWeight: '800' },
  connectionName: { flex: 1, fontSize: 13 },
  connectionType: { maxWidth: '42%', fontSize: 12, fontWeight: '700', textAlign: 'right' },
  actionBar: { flexDirection: 'row', gap: 10, paddingHorizontal: UI_METRICS.sheetGutter, paddingTop: 12, paddingBottom: UI_METRICS.sheetBottom, borderTopWidth: StyleSheet.hairlineWidth },
  actionButton: { flex: 1, minHeight: UI_METRICS.touchMinSize, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionButtonText: { fontSize: 14, fontWeight: '700' },
  portRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 }, portDot: { width: 8, height: 8, borderRadius: 4 }, portType: { flex: 1, fontSize: 13 }, portDirection: { fontSize: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 }, tagText: { fontSize: 12 },
  notes: { fontSize: 13, lineHeight: 20 }, urlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, urlRowSpacing: { marginTop: 8 },
  // 塗りと枠線を並べるので、高さを揃えるため枠線は共通で持たせる
  buyButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: UI_METRICS.controlRadius, borderWidth: 1 },
  buyText: { fontSize: 14, fontWeight: '700' },
  affiliateNote: { fontSize: 12, lineHeight: 18, marginTop: 8 },
})
