import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp } from '../../context/AppContext'
import { useProductSuggestionsState } from '../../hooks/useProductSuggestions'
import { ProductSuggestion } from '../../utils/productSuggestions'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { SearchField } from '../atoms/SearchField'
import { BrandChip } from '../molecules/BrandChip'
import { UI_METRICS } from '../../constants/ui'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { PRODUCT_BROWSE_ENABLED } from '../../constants/features'
import { productMarketplaceLabel } from '../../utils/productMarketplace'

interface Props {
  visible: boolean
  category: string
  categoryLabel?: string
  title?: string
  includeLocal?: boolean
  marketplaceOnly?: boolean
  onClose: () => void
  onSelect: (suggestion: ProductSuggestion) => void
}

const LIST_LIMIT = 200

export function ProductPickerModal({ visible, category, categoryLabel, title, includeLocal = true, marketplaceOnly = false, onClose, onSelect }: Props) {
  const searchVisible = PRODUCT_BROWSE_ENABLED && visible
  const insets = useSafeAreaInsets()
  const { colors: C, lang, t, isDark, reduceMotion } = useApp()
  const [query, setQuery] = useState('')
  const { suggestions: allSuggestions, loading, error } = useProductSuggestionsState(
    category,
    query,
    lang,
    searchVisible,
    LIST_LIMIT,
    true,
    includeLocal,
  )
  const suggestions = marketplaceOnly
    ? allSuggestions.filter((suggestion) => productMarketplaceLabel(suggestion, lang) !== null)
    : allSuggestions

  useEffect(() => {
    if (!searchVisible) setQuery('')
  }, [searchVisible])

  if (!searchVisible) return null

  return (
    <Modal visible={searchVisible} animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: C.bg, paddingTop: insets.top }]} accessibilityViewIsModal>
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <View>
            <Text style={[styles.title, { color: C.text }]}>
              {title ?? (lang === 'en' ? 'Find a product' : '商品を探す')}
            </Text>
            <Text style={[styles.category, { color: C.textSub }]}>{categoryLabel ?? t(`category.${category}`)}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <AppIcon name={ICONS.close} size={24} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <SearchField
            containerStyle={styles.searchWrap}
            value={query}
            onChangeText={setQuery}
            placeholder={lang === 'en' ? 'Search products' : '商品名を検索'}
            autoFocus={visible}
            onSubmitEditing={Keyboard.dismiss}
            accessibilityLabel={lang === 'en' ? 'Search products' : '商品名を検索'}
            onClear={() => setQuery('')}
        />

        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.productId ?? item.name.normalize('NFKC').toLowerCase()}
          keyboardShouldPersistTaps="handled"
          // 検索中は結果の下のほうがキーボードの裏に入り、スクロールしても届かなかった
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={suggestions.length === 0 ? styles.emptyContainer : undefined}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { backgroundColor: C.card, borderBottomColor: C.separator }]}
              onPress={() => {
                onSelect(item)
                onClose()
              }}
              accessibilityRole="button"
              accessibilityLabel={item.name}
            >
              <View style={[styles.productImage, { backgroundColor: C.chip, borderColor: C.border }]}>
                {item.image ? (
                  <Image
                    source={{ uri: item.image }}
                    style={styles.productImageContent}
                    resizeMode="contain"
                    accessible={false}
                  />
                ) : (
                  <CategoryIcon
                    category={item.category ?? category}
                    pcFormFactor={item.pcFormFactor}
                    size={22}
                    color={categoryIconColor(item.category ?? category, isDark)}
                  />
                )}
              </View>
              <View style={styles.rowBody}>
                <Text style={[styles.name, { color: C.text }]}>{item.name}</Text>
                {/* ここは商品を選ぶ場所なので押せない枠にする。
                    ブランドで別画面へ飛ぶと、選びかけの入力が消える */}
                <BrandChip brand={item.brand} colors={C} lang={lang} style={styles.brandSlot} />
                {marketplaceOnly && (
                  <Text style={[styles.marketplace, { color: C.textMuted }]}>
                    {productMarketplaceLabel(item, lang)}
                  </Text>
                )}
              </View>
              <AppIcon name={ICONS.chevronRight} size={20} color={C.chevron} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={(
            <View style={styles.emptyState}>
              {loading && <ActivityIndicator color={C.accentIcon} />}
              <Text style={[styles.empty, { color: C.textSub }]}>
                {loading
                  ? (lang === 'en' ? 'Loading products…' : '商品を読み込んでいます…')
                  : error
                    ? (lang === 'en' ? 'Could not load products' : '商品を読み込めませんでした')
                    : marketplaceOnly
                      ? (lang === 'en' ? 'No matching Rakuten products' : '楽天に該当する商品がありません')
                      : (lang === 'en' ? 'No matching products' : '該当する商品がありません')}
              </Text>
            </View>
          )}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 64,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '700' },
  category: { fontSize: 12, marginTop: 2 },
  searchWrap: {
    margin: 14,
  },
  row: {
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  productImage: {
    width: 48,
    height: 48,
    flexShrink: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: UI_METRICS.chipRadius,
  },
  productImageContent: { width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  // 商品名とブランド枠を縦に積む。flex はこちらが持つ
  rowBody: { flex: 1, gap: 4 },
  name: { fontSize: 14, lineHeight: 20 },
  brandSlot: { marginBottom: 2 },
  marketplace: { fontSize: 11, fontWeight: '600' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyState: { alignItems: 'center', gap: 10, padding: 24 },
  empty: { textAlign: 'center' },
})
