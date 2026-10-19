import { Alert } from '../../utils/alert'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppColors } from '../../context/AppContext'
import { Gadget } from '../../types'
import type { PurchaseLink } from '../../types/product'
import { AppIcon } from '../atoms/AppIcon'
import { RecommendedGadgetMark } from '../atoms/RecommendedGadgetMark'
import { TogglePop } from '../atoms/TogglePop'
import { CopyProductNameButton } from '../atoms/CopyProductNameButton'
import { BrandChip } from '../molecules/BrandChip'
import { gadgetSubNickname, gadgetTitle, gadgetGenreLabel, localizedGadgetName } from '../../utils/localizedGadgetName'
import { hapticSelection } from '../../utils/haptics'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { localizedPortLabel } from '../../constants/portTypes'
import { affiliateDisclosure, normalizeHttpUrl, shopLabelForUrl } from '../../utils/url'
import { resolveProduct, resolvePurchaseLinks, resolvePurchaseLinksSync } from '../../repositories/productRepository'
import { analytics, EVENTS, errorProperties, linkProperties } from '../../services/analytics'
import { recordDeskTraffic } from '../../services/deskTraffic'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { GadgetPublicDesks } from './GadgetPublicDesks'
import { isGadgetBookmarked, toggleGadgetBookmark } from '../../services/gadgetBookmarks'
import { ICONS, categoryIconColor } from '../../constants/icons'
import { IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER, UI_METRICS } from '../../constants/ui'
import { sharedGadgetSpecRows } from '../../utils/sharedGadgetSpecRows'

interface Props {
  gadget: Gadget | null
  recommended?: boolean
  gadgets: Gadget[]
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
  // 実体（useApp().fmtPrice）は null も受ける。DeskGridTile へそのまま渡すので広いまま持つ
  fmtPrice: (price: number | null | undefined) => string
  /** 今開いている公開デスク。同じデスクを「このガジェットを使っているデスク」に出さない */
  deskId?: string
  userId?: string
  isOwnDesk?: boolean
  onRequireLogin?: () => void
  /** ブランド枠のタップ。渡さないと枠は押せない表示だけになる */
  onOpenBrand?: (key: string, label: string) => void
  onClose: () => void
  /** 別の公開デスクへ移る。渡さなければ逆引きの段は出さない */
  onOpenDesk?: (deskId: string) => void
}

export function SharedGadgetDetailModal({ gadget, recommended, gadgets, colors: C, lang, isDark, fmtPrice, deskId, userId, isOwnDesk, onRequireLogin, onClose, onOpenDesk, onOpenBrand }: Props) {
  const ja = lang === 'ja'
  const [purchaseLinks, setPurchaseLinks] = useState<PurchaseLink[]>(
    () => (gadget ? resolvePurchaseLinksSync(gadget, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true }) : []),
  )
  // 保存だけ。ガジェット単位の「いいね」は作らない（理由は 066 の冒頭）
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [savePopKey, setSavePopKey] = useState(0)
  const bookmarkInFlightRef = useRef(false)

  useEffect(() => {
    let alive = true
    setBookmarked(false)
    if (!gadget || !deskId || !userId || isOwnDesk) return () => { alive = false }
    isGadgetBookmarked(gadget, userId)
      .then((next) => { if (alive) setBookmarked(next) })
      .catch(() => {})
    return () => { alive = false }
  }, [deskId, gadget, isOwnDesk, userId])

  const toggleBookmark = useCallback(async () => {
    if (!gadget || !deskId) return
    if (!userId) {
      onRequireLogin?.()
      return
    }
    if (isOwnDesk || bookmarkInFlightRef.current) return
    bookmarkInFlightRef.current = true
    setBookmarkLoading(true)
    // 押した瞬間に替える（公開デスクの保存・拍手と同じ）。返事を待ってから替えると、
    // 通信の間は押せたのか分からない。結果はサーバーの返す状態に合わせ、失敗したら戻す
    const previous = bookmarked
    setBookmarked(!previous)
    hapticSelection()
    if (!previous) setSavePopKey((key) => key + 1)
    try {
      const active = await toggleGadgetBookmark(gadget, userId, deskId)
      setBookmarked(active)
      analytics.track(EVENTS.GADGET_BOOKMARK_TOGGLED, {
        active,
        placement: 'shared_gadget_modal',
        category: gadget.category,
        product_id: gadget.productId,
      })
    } catch {
      setBookmarked(previous)
      Alert.alert(ja ? '操作を完了できませんでした' : 'Could not complete the action')
    } finally {
      bookmarkInFlightRef.current = false
      setBookmarkLoading(false)
    }
  }, [bookmarked, deskId, gadget, isOwnDesk, ja, onRequireLogin, userId])

  useEffect(() => {
    if (!gadget) {
      setPurchaseLinks([])
      return
    }
    // 問い合わせ無しで決まるぶんを先に出す（GadgetDetailSheet と同じ理由）
    setPurchaseLinks(resolvePurchaseLinksSync(gadget, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true }))
    let alive = true
    resolvePurchaseLinks(gadget, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true })
      .then((links) => {
        if (!alive) return
        setPurchaseLinks(links)
        for (const link of links) {
          analytics.track(EVENTS.AFFILIATE_LINK_DISPLAYED, {
            category: gadget.category,
            product_id: gadget.productId,
            placement: 'shared_gadget_modal',
            ...linkProperties(link.url),
          })
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [gadget, lang])

  // 画像とブランドは共有データに載せず、購入リンクと同じく商品マスタから引く
  const [productImage, setProductImage] = useState<string | null>(null)
  const [productBrand, setProductBrand] = useState<string | null>(null)
  useEffect(() => {
    if (!gadget) {
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
  }, [gadget])

  if (!gadget) return null

  const rows = sharedGadgetSpecRows(gadget, gadgets, lang, fmtPrice, purchaseLinks.map((link) => link.url))

  return (
    <BottomSheetModal visible onDismiss={onClose} sheetStyle={styles.sheet}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: C.chip }]}>
              <CategoryIcon category={gadget.category} pcFormFactor={gadget.pcFormFactor} customIcon={gadget.customCategory?.icon} size={22} color={categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>{gadgetTitle(gadget, lang)}</Text>
              <CopyProductNameButton name={gadget.isPlaceholder ? '' : localizedGadgetName(gadget, lang)} colors={C} lang={lang} />
              {/* 見出しが商品名になるとジャンルが絵だけになる。ジャンル名は読み飛ばしてよい補足、呼び名は読ませたい補足 */}
              {(!!gadgetGenreLabel(gadget, lang) || !!gadgetSubNickname(gadget)) && (
                <Text style={styles.nickname} numberOfLines={1}>
                  {!!gadgetGenreLabel(gadget, lang) && <Text style={{ color: C.textMuted }}>{gadgetGenreLabel(gadget, lang)}</Text>}
                  {!!gadgetGenreLabel(gadget, lang) && !!gadgetSubNickname(gadget) && <Text style={{ color: C.textMuted }}>{'  ·  '}</Text>}
                  {!!gadgetSubNickname(gadget) && <Text style={{ color: C.textSub }}>{gadgetSubNickname(gadget)}</Text>}
                </Text>
              )}
              <Text style={[styles.subtitle, { color: C.textMuted }]}>{ja ? '共有された商品情報' : 'Shared product details'}</Text>
              {/* ブランドは商品マスタ由来。onOpenBrand が無ければ押せない枠になる */}
              <BrandChip
                brand={productBrand}
                colors={C}
                lang={lang}
                style={styles.brandSlot}
                onPress={onOpenBrand}
              />
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}>
              <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {recommended && <RecommendedGadgetMark color={C.accentText} lang={lang} />}
            {productImage && (
              <Image
                source={{ uri: productImage }}
                style={[styles.productImage, { borderColor: C.border }]}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
                // 404 や差し替えで読めない URL のときに枠だけ残さない
                onError={() => setProductImage(null)}
              />
            )}
            {!isOwnDesk && deskId && (
              <View style={styles.reactionRow}>
                <TouchableOpacity
                  style={[styles.reactionButton, { backgroundColor: C.bgList, borderColor: C.border }]}
                  onPress={() => { void toggleBookmark() }}
                  disabled={bookmarkLoading}
                  accessibilityRole="button"
                  accessibilityState={{ selected: bookmarked, disabled: bookmarkLoading }}
                  accessibilityLabel={bookmarked ? (ja ? '保存を解除' : 'Remove from saved') : (ja ? 'このガジェットを保存' : 'Save this gadget')}
                >
                  <TogglePop popKey={savePopKey}>
                    <AppIcon name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={20} color={bookmarked ? C.saved : C.textMuted} />
                  </TogglePop>
                  <Text style={[styles.reactionText, { color: C.textSub }]}>
                    {bookmarked ? (ja ? '保存済み' : 'Saved') : (ja ? '保存' : 'Save')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {rows.map(([label, value], index) => {
              const openableUrl = label === (ja ? '商品リンク' : 'Product link') ? normalizeHttpUrl(value) : null
              const RowContainer = openableUrl ? TouchableOpacity : View
              return (
              <RowContainer
                key={`${label}-${index}`}
                style={[styles.row, { borderBottomColor: C.border }]}
                {...(openableUrl ? {
                  activeOpacity: 0.7,
                  onPress: () => {
                    const props = {
                      category: gadget.category,
                      product_id: gadget.productId,
                      placement: 'shared_gadget_modal',
                      ...linkProperties(openableUrl),
                    }
                    analytics.track(EVENTS.AFFILIATE_LINK_OPENED, props)
                    if (deskId && !isOwnDesk) recordDeskTraffic(deskId, 'shop_open')
                    WebBrowser.openBrowserAsync(openableUrl).catch((error) => {
                      analytics.track(EVENTS.AFFILIATE_LINK_OPEN_FAILED, { ...props, ...errorProperties(error) })
                      Alert.alert(ja ? 'リンクを開けませんでした' : 'Could not open the link')
                    })
                  },
                } : {})}
              >
                <Text style={[styles.label, { color: C.textMuted }]}>{label}</Text>
                {/* 楽天のアフィリエイトURLは200文字を超える。生のまま出すと
                    シートがURLで埋まるので、ショップ名だけ見せてタップで開く */}
                <Text
                  style={[styles.value, { color: openableUrl ? C.accentText : C.text }]}
                  selectable={!openableUrl}
                >
                  {openableUrl ? shopLabelForUrl(openableUrl, lang) : value}
                </Text>
              </RowContainer>
              )
            })}

            {/* 他人のデスクを見ている画面なので、リンクが「持ち主の参考リンク」に
                見えてしまう。報酬を得る側の表示である以上ここで明示する */}
            {!!affiliateDisclosure(purchaseLinks, lang) && (
              <Text
                style={[styles.affiliateNote, { color: C.textSub }]}
                maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              >
                {affiliateDisclosure(purchaseLinks, lang)}
              </Text>
            )}

            {/* 買うかどうかを決めるのは、このガジェットの仕様よりも、実際に置いている
                デスクの絵。ポート構成より前に出す */}
            {onOpenDesk && (
              <GadgetPublicDesks
                gadget={gadget}
                visible
                excludeDeskId={deskId}
                colors={C}
                lang={lang}
                isDark={isDark}
                fmtPrice={fmtPrice}
                titleStyle={[styles.sectionTitle, { color: C.text }]}
                onOpenDesk={onOpenDesk}
              />
            )}

            <Text style={[styles.sectionTitle, { color: C.text }]}>{ja ? 'ポート構成' : 'Ports'}</Text>
            {gadget.ports.length === 0 ? (
              <Text style={[styles.empty, { color: C.textMuted }]}>{ja ? 'ポート情報なし' : 'No port information'}</Text>
            ) : gadget.ports.map((port) => (
              <View key={port.id} style={[styles.portRow, { backgroundColor: C.bgList, borderColor: C.border }]}>
                <Text style={[styles.portType, { color: C.text }]}>{localizedPortLabel(port.type, port.label, lang)}</Text>
                <Text style={[styles.portMeta, { color: C.textMuted }]}>
                  {(ja ? { input: '入力', output: '出力', bidirectional: '双方向' } : { input: 'In', output: 'Out', bidirectional: 'In/Out' })[port.direction]} × {port.count}
                  {port.supportsVideo ? (ja ? ' ・ 映像対応' : ' ・ Video') : ''}
                </Text>
              </View>
            ))}
          </ScrollView>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '88%', paddingHorizontal: 0 },
  // 左右はシートの中身の sheetGutter（自分のデスクの詳細 GadgetDetailSheet と同じ）
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: UI_METRICS.sheetGutter, paddingBottom: 14, gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '800' },
  subtitle: { fontSize: 11, marginTop: 2 },
  nickname: { fontSize: 13, marginTop: 2 },
  brandSlot: { marginTop: 6 },
  close: { padding: 8 },
  content: { paddingHorizontal: UI_METRICS.sheetGutter, paddingBottom: 16 },
  // 楽天の商品写真は 400x400 の正方形。枠を全幅にすると左右に白地が伸びるので枠も正方形にする。
  // 下地を白で固定するのは、透過 PNG がダークモードで潰れるため
  productImage: { width: 200, height: 200, borderRadius: UI_METRICS.panelRadius, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignSelf: 'center', marginBottom: 14 },
  reactionRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  reactionButton: { flex: 1, minHeight: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.panelRadius },
  reactionText: { fontSize: 13, fontWeight: '800' },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 11, marginBottom: 3 },
  value: { fontSize: 14, lineHeight: 20 },
  affiliateNote: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  empty: { fontSize: 13 },
  portRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.controlRadius, padding: 10, marginBottom: 8 },
  portType: { fontSize: 13, fontWeight: '700' },
  portMeta: { fontSize: 11, marginTop: 3 },
})
