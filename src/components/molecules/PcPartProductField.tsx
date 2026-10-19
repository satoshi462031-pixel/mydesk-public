import { useEffect, useState } from 'react'
import { Keyboard, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../../context/AppContext'
import { useProductSuggestions } from '../../hooks/useProductSuggestions'
import { resolvePurchaseLinks, resolvePurchaseLinksSync } from '../../repositories/productRepository'
import { ProductSuggestion } from '../../utils/productSuggestions'
import { AppIcon } from '../atoms/AppIcon'
import { GADGET_NAME_MAX_LENGTH } from '../../constants/textLimits'
import { truncateChars } from '../../utils/truncateText'
import { TextField } from '../atoms/TextField'
import { ProductSearchButton } from '../atoms/ProductSearchButton'
import { ProductPickerModal } from '../organisms/ProductPickerModal'
import { analytics, EVENTS, errorProperties, linkProperties } from '../../services/analytics'
import { IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER, UI_METRICS } from '../../constants/ui'
import { affiliateDisclosure, purchaseLinkLabel } from '../../utils/url'
import type { PurchaseLink } from '../../types/product'
import { ICONS } from '../../constants/icons'

interface Props {
  label: string
  productCategory: string
  value: string
  productId?: string
  placeholder: string
  onChange: (value: string) => void
  onProductIdChange: (productId: string | undefined) => void
}

export function PcPartProductField({
  label,
  productCategory,
  value,
  productId,
  placeholder,
  onChange,
  onProductIdChange,
}: Props) {
  const { colors: C, lang } = useApp()
  const [focused, setFocused] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [purchaseLinks, setPurchaseLinks] = useState<PurchaseLink[]>([])
  const suggestions = useProductSuggestions(productCategory, value, lang, focused, 6, false, false)
  const showSuggestions = focused && suggestions.length > 0

  useEffect(() => {
    let alive = true
    if (!productId) { setPurchaseLinks([]); return () => { alive = false } }
    // 問い合わせを待たずに出せるぶんを先に出す（リンクが遅れて現れると行が動く）
    setPurchaseLinks(resolvePurchaseLinksSync({ name: value, productId }, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true }))
    resolvePurchaseLinks({ name: value, productId }, { country: lang === 'en' ? 'US' : 'JP', catalogOnly: true })
      .then((links) => {
        if (!alive) return
        setPurchaseLinks(links)
        for (const link of links) {
          analytics.track(EVENTS.AFFILIATE_LINK_DISPLAYED, {
            category: productCategory,
            product_id: productId,
            placement: 'pc_part_field',
            ...linkProperties(link.url),
          })
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [lang, productCategory, productId, value])

  const selectSuggestion = (suggestion: ProductSuggestion) => {
    analytics.track(EVENTS.PRODUCT_SUGGESTION_SELECTED, {
      category: productCategory,
      has_product_id: !!suggestion.productId,
      product_id: suggestion.productId,
      placement: 'pc_part_field',
    })
    onChange(suggestion.name)
    onProductIdChange(suggestion.productId)
    // 欄を選んだまま候補だけ閉じると、次に onFocus が来ないので打ち直しても候補が出ない
    Keyboard.dismiss()
    setFocused(false)
  }

  return (
    <>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: C.textSub }]}>{label}</Text>
      </View>

      <View>
        <TextField
          suggestionsOpen={showSuggestions}
          placeholder={placeholder}
          value={value}
          onChangeText={(text) => {
            onChange(truncateChars(text, GADGET_NAME_MAX_LENGTH))
            onProductIdChange(undefined)
          }}
          maxLength={GADGET_NAME_MAX_LENGTH}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          autoCorrect={false}
          trailing={<ProductSearchButton onPress={() => setPickerOpen(true)} />}
        />
        {showSuggestions && (
          <View style={[styles.suggestionBox, { backgroundColor: C.card, borderColor: C.inputBorder }]}>
            {suggestions.map((suggestion, index) => (
              <TouchableOpacity
                key={`${suggestion.productId ?? suggestion.name}-${index}`}
                style={[styles.suggestionRow, index < suggestions.length - 1 && { borderBottomColor: C.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}
                onPress={() => selectSuggestion(suggestion)}
              >
                <Text style={[styles.suggestionName, { color: C.text }]}>{suggestion.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {purchaseLinks.map((link) => (
        <TouchableOpacity key={link.url} style={styles.productLink} onPress={() => {
          const props = { category: productCategory, product_id: productId, placement: 'pc_part_field', ...linkProperties(link.url) }
          analytics.track(EVENTS.AFFILIATE_LINK_OPENED, props)
          Linking.openURL(link.url).catch((error) => {
            analytics.track(EVENTS.AFFILIATE_LINK_OPEN_FAILED, { ...props, ...errorProperties(error) })
          })
        }}>
          <AppIcon name={ICONS.openExternal} size={15} color={C.accentIcon} />
          <Text style={[styles.productLinkText, { color: C.accentText }]}>
            {purchaseLinkLabel(link, lang)}
          </Text>
        </TouchableOpacity>
      ))}
      {!!affiliateDisclosure(purchaseLinks, lang) && (
        <Text
          style={[styles.affiliateNote, { color: C.textSub }]}
          maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {affiliateDisclosure(purchaseLinks, lang)}
        </Text>
      )}

      <ProductPickerModal
        visible={pickerOpen}
        category={productCategory}
        categoryLabel={label}
        includeLocal={false}
        onClose={() => setPickerOpen(false)}
        onSelect={selectSuggestion}
      />
    </>
  )
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  // 下角は入力欄（controlRadius）と同じにする。ここだけ小さいと、
  // 入力欄にぶら下がっているのに輪郭が途中でずれる
  suggestionBox: { borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: UI_METRICS.controlRadius, borderBottomRightRadius: UI_METRICS.controlRadius, overflow: 'hidden' },
  suggestionRow: { paddingHorizontal: 14, paddingVertical: 11 },
  suggestionName: { fontSize: 14, fontWeight: '500' },
  productLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 7, paddingVertical: 3 },
  productLinkText: { fontSize: 12, fontWeight: '600' },
  affiliateNote: { fontSize: 12, lineHeight: 18, marginTop: 4 },
})
