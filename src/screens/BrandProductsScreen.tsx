// ─── お気に入りブランドの商品一覧（074）──────────────────────────
//
// 商品DB（products）をブランドで引いて並べるだけの画面。**ここは在庫を売る場所ではない。**
// 価格も在庫も持たず、押したら予測変換と同じ商品詳細へ渡す。
//
// products.brand は表記ゆれを含むので、引き当ては brandFollows.listProductsByBrand が
// 辞書の別名すべてで当てる（074 冒頭）。画面側は key しか知らない。
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { EmptyState } from '../components/molecules/EmptyState'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { RetryState } from '../components/molecules/RetryState'
import { UI_METRICS } from '../constants/ui'
import { categoryIconColor } from '../constants/colors'
import { useApp } from '../context/AppContext'
import { listProductsByBrand } from '../services/brandFollows'
import type { ProductRow } from '../supabase/types'
import { GadgetCategory, PublicStackParamList } from '../types'
import { productIdentity } from '../utils/productName'
import { navigateInTab } from '../utils/tabNavigation'

type Props = NativeStackScreenProps<PublicStackParamList, 'BrandProducts'>

export function BrandProductsScreen({ route, navigation }: Props) {
  const { brandKey, brandLabel } = route.params
  const { colors: C, lang, isDark } = useApp()
  const ja = lang === 'ja'
  const [items, setItems] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const reload = useCallback(async () => {
    setLoadError(false)
    setLoading(true)
    try {
      setItems(await listProductsByBrand(brandKey))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [brandKey])

  useEffect(() => { void reload() }, [reload])
  // useEffect だと既定の表題が一度描かれてから差し替わる
  useLayoutEffect(() => { navigation.setOptions({ title: brandLabel }) }, [navigation, brandLabel])

  if (loading) {
    return <View style={[styles.fill, { backgroundColor: C.bgList }]}><ListSkeleton count={6} variant="row" rowSize="image" inset="gutter" /></View>
  }
  if (loadError) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: C.bgList }]}>
        <RetryState
          message={ja ? '商品を読み込めませんでした。' : 'Could not load products.'}
          onRetry={() => { void reload() }}
        />
      </View>
    )
  }

  return (
    <FlatList
      style={{ backgroundColor: C.bgList }}
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={items.length === 0 ? styles.emptyContent : styles.listContent}
      ListEmptyComponent={
        <EmptyState
          icon="package-variant-closed"
          title={ja ? 'このブランドの商品はまだありません' : 'No products from this brand yet'}
          description={ja
            ? '商品DBに入るとここに並びます'
            : 'They appear here once they are in the product database.'}
          colors={C}
        />
      }
      renderItem={({ item }) => {
        const identity = productIdentity(item.name, item.brand, item.product_name, item.source === 'preset')
        return (
          <TouchableOpacity
            style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={identity.displayName}
            accessibilityHint={ja ? 'この商品でガジェットを登録します' : 'Adds a gadget from this product'}
            onPress={() => navigateInTab(navigation, 'PlanTab', 'AddGadget', {
              // 一覧はブランド見出しの下なので製品名だけ、登録フォームにはブランドも渡す。
              presetId: item.id,
              presetName: identity.displayName,
            })}
          >
            {item.image
              ? <Image source={{ uri: item.image }} style={styles.image} resizeMode="contain" />
              : (
                <View style={[styles.image, styles.iconWrap, { backgroundColor: C.chip }]}>
                  <CategoryIcon category={(item.category ?? 'Other') as GadgetCategory} size={26} color={categoryIconColor(item.category ?? 'Other', isDark)} />
                </View>
              )}
            <View style={styles.body}>
              <Text style={[styles.name, { color: C.text }]} numberOfLines={2}>
                {identity.productName}
              </Text>
              {!!item.category && (
                <Text style={[styles.meta, { color: C.textMuted }]}>{item.category}</Text>
              )}
            </View>
          </TouchableOpacity>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: UI_METRICS.screenGutter, gap: 10 },
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.cardRadius, padding: 10,
  },
  image: { width: 68, height: 68, borderRadius: UI_METRICS.controlRadius, backgroundColor: '#FFFFFF' },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  meta: { fontSize: 11, marginTop: 5 },
})
