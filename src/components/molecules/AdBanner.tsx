import { StyleSheet, Text, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { useApp } from '../../context/AppContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { UI_METRICS } from '../../constants/ui'

// Free会員向けの広告枠。広告SDK（AdMob等）は未導入。
//
// ADS_ENABLED=false の間は枠ごと何も描画しない（プレースホルダーの点線枠も出さない）。
// 実際に広告を入れるときは、このフラグを true に戻したうえで、下の View を
// 広告SDKのバナーコンポーネントに差し替える。呼び出し側（マイデスク一覧・
// ガジェット一覧のフッター）は変更不要。
const ADS_ENABLED = false

export function AdBanner() {
  const { isPro, isLoading } = useSubscription()
  const { colors, lang } = useApp()

  if (!ADS_ENABLED) return null
  // 課金状態の解決前は出さない。Pro のユーザーに起動直後だけ広告が見える
  if (isPro || isLoading) return null

  return (
    <View style={[styles.wrap, { backgroundColor: colors.chip, borderColor: colors.border }]}>
      <AppIcon name="bullhorn-outline" size={14} color={colors.textMuted} />
      <Text style={[styles.text, { color: colors.textMuted }]}>
        {lang === 'ja' ? '広告（Proで非表示）' : 'Ad (hidden with Pro)'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    marginHorizontal: 16,
    marginTop:      4,
    marginBottom:   16,
    paddingVertical: 14,
    borderRadius:   UI_METRICS.panelRadius,
    borderWidth:    1,
    borderStyle:    'dashed',
  },
  text: { fontSize: 12, fontWeight: '600' },
})
