import { useEffect, useRef, useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ProductSearchButton } from '../atoms/ProductSearchButton'
import { TextField } from '../atoms/TextField'
import { UI_METRICS } from '../../constants/ui'
import { GADGET_NAME_MAX_LENGTH } from '../../constants/textLimits'
import { trimInvisible, truncateChars } from '../../utils/truncateText'
import { AppColors } from '../../context/AppContext'
import { useProductSuggestions } from '../../hooks/useProductSuggestions'
import { GadgetCategory } from '../../types'
import { ProductSuggestion } from '../../utils/productSuggestions'

interface Props {
  /** 候補を絞るジャンル。枠のカテゴリをそのまま渡す */
  category: GadgetCategory
  value: string
  colors: AppColors
  lang: 'ja' | 'en'
  onChangeText: (value: string) => void
  onSelectSuggestion: (suggestion: ProductSuggestion) => void
  /** 候補に無いものを探す導線（ジャンルの商品一覧モーダル） */
  onOpenPicker: () => void
  inputRef?: (node: TextInput | null) => void
  onFocusChange?: (focused: boolean) => void
  onSubmitEditing?: () => void
  isLast?: boolean
  accessibilityLabel?: string
  /**
   * 候補を重ねずに、欄の下へ差し込んで開く（後続の行が押し下がる）。
   * 重ねて開くには祖先の器が外へはみ出して描ける必要があり、横スワイプの行の中では
   * 器のはみ出しを許すと、スワイプで動かした行までカードの外へはみ出す
   */
  inlineSuggestions?: boolean
}

/**
 * 枠に入れる商品名の入力欄。入力するとその場に予測変換が開く。
 *
 * 候補は入力欄の高さを変えず、後続の行の上へ重ねて開く（inlineSuggestions のときは差し込む）。
 */
export const PRODUCT_NAME_SUGGESTION_MAX_HEIGHT = 260

export function ProductNameField({
  category, value, colors: C, lang,
  onChangeText, onSelectSuggestion, onOpenPicker,
  inputRef, onFocusChange, onSubmitEditing, isLast = false, accessibilityLabel, inlineSuggestions = false,
}: Props) {
  const [focused, setFocused] = useState(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurPendingRef = useRef(false)
  const suggestionTouchRef = useRef(false)
  // 候補の問い合わせはフォーカス中の欄だけが投げる（枠が10個あっても同時に走るのは1本）
  const suggestions = useProductSuggestions(category, value, lang, focused, 6)
  // 空欄ではジャンルのプリセットが並ぶが、欄を選んだだけで一覧が開くと下の欄に被さる。打ち始めてから出す
  const open = focused && trimInvisible(value) !== '' && suggestions.length > 0

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
  }, [])

  const handleFocus = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    blurPendingRef.current = false
    setFocused(true)
    onFocusChange?.(true)
  }

  const closeAfterBlur = (delay = 150) => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    blurTimerRef.current = setTimeout(() => {
      if (suggestionTouchRef.current) return
      blurPendingRef.current = false
      setFocused(false)
      onFocusChange?.(false)
    }, delay)
  }

  const handleBlur = () => {
    // キーボードを閉じる blur が候補の onPress より先に来ても、タッチ中は候補を残す
    blurPendingRef.current = true
    closeAfterBlur()
  }

  const beginSuggestionTouch = () => {
    suggestionTouchRef.current = true
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
  }

  const endSuggestionTouch = () => {
    suggestionTouchRef.current = false
    // onPress は touchEnd の直後に届くため、先に候補を外さない
    if (blurPendingRef.current) closeAfterBlur(100)
  }

  const selectSuggestion = (suggestion: ProductSuggestion) => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    blurPendingRef.current = false
    onSelectSuggestion(suggestion)
    // 欄を選んだまま候補だけ閉じると、次に onFocus が来ないので打ち直しても候補が出ない
    Keyboard.dismiss()
    setFocused(false)
    onFocusChange?.(false)
  }

  return (
    // zIndex は開閉で付け外ししない。付くと平坦化されていた View が実体になり、中の入力欄が
    // 新しい親へ付け替えられて iOS がフォーカスを外す（欄を選んだ瞬間にキーボードが閉じていた）
    <View style={styles.root}>
      <TextField
          ref={inputRef}
          suggestionsOpen={open}
          accentColor={open ? C.accent : undefined}
          placeholder={lang === 'ja' ? '商品名' : 'Product name'}
          value={value}
          onChangeText={(text) => onChangeText(truncateChars(text, GADGET_NAME_MAX_LENGTH))}
          maxLength={GADGET_NAME_MAX_LENGTH}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoCorrect={false}
          returnKeyType={isLast ? 'done' : 'next'}
          submitBehavior={isLast ? 'blurAndSubmit' : 'submit'}
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel={accessibilityLabel}
          trailing={<ProductSearchButton onPress={onOpenPicker} />}
      />
      {open && (
        <ScrollView
          style={[styles.suggestionBox, !inlineSuggestions && styles.suggestionOverlay, { backgroundColor: C.card, borderColor: C.accentIcon }]}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          onTouchStart={beginSuggestionTouch}
          onTouchEnd={endSuggestionTouch}
          onTouchCancel={endSuggestionTouch}
        >
          {suggestions.map((suggestion, index) => (
            <TouchableOpacity
              key={`${suggestion.productId ?? suggestion.name}-${index}`}
              style={[
                styles.suggestionRow,
                index < suggestions.length - 1 && { borderBottomColor: C.separator, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              onPress={() => selectSuggestion(suggestion)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={[styles.suggestionName, { color: C.text }]} numberOfLines={2}>{suggestion.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { zIndex: 10 },
  suggestionBox: {
    maxHeight: PRODUCT_NAME_SUGGESTION_MAX_HEIGHT,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: UI_METRICS.controlRadius,
    borderBottomRightRadius: UI_METRICS.controlRadius,
    overflow: 'hidden',
  },
  // 後続の行の上へ重ねる置き方（inlineSuggestions でないとき）
  suggestionOverlay: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10 },
  suggestionRow: { paddingHorizontal: 12, paddingVertical: 11 },
  suggestionName: { fontSize: 14, fontWeight: '500' },
})
