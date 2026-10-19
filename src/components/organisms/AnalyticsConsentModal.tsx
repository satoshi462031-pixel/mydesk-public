// 利用状況データ（PostHog）を送るかの初回の選択。オンボーディングを抜けるときに一度だけ出す。
// 設定画面にしか切り替えが無いと存在に気付かれず、ほとんど誰の分も届かない。
// 「許可しない」も同じ大きさのボタンにする。片方だけ目立たせて押させる作りにしない。
import { Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { ICONS } from '../../constants/icons'
import { PRIVACY_URL } from '../../constants/plans'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'

interface Props {
  visible: boolean
  lang: 'ja' | 'en'
  colors: AppColors
  onChoose: (enabled: boolean) => void
}

export function AnalyticsConsentModal({ visible, lang, colors, onChoose }: Props) {
  const en = lang === 'en'
  return (
    // 戻る操作で閉じても選ばなかったことにはしない。拒否として扱い、先へ進める
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onChoose(false)}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <AppIcon name={ICONS.stats} size={30} color={colors.accentIcon} />
          <Text style={[styles.title, { color: colors.text }]}>
            {en ? 'Help improve MyDesk?' : 'アプリの改善に協力しますか？'}
          </Text>
          <Text style={[styles.body, { color: colors.textSub }]}>
            {en
              ? 'We send usage, device info and an in-app ID to PostHog to improve the app. Your text and photos are not sent. Change this anytime in Settings.'
              : '操作状況・端末情報・アプリ内IDをPostHogへ送り、改善に使います。入力文と写真は送りません。設定から変更できます。'}
          </Text>
          <TouchableOpacity onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
            <Text style={[styles.privacyLink, { color: colors.accentText }]}>
              {en ? 'View Privacy Policy' : 'プライバシーポリシーを確認'}
            </Text>
          </TouchableOpacity>
          <Button title={en ? 'Allow' : '許可する'} onPress={() => onChoose(true)} style={styles.firstButton} />
          <Button title={en ? "Don't allow" : '許可しない'} variant="secondary" onPress={() => onChoose(false)} style={styles.secondButton} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:         { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: UI_METRICS.sheetRadius, padding: 22, alignItems: 'center' },
  title:        { fontSize: 19, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  body:         { fontSize: 14, lineHeight: 21, marginTop: 12 },
  privacyLink:  { fontSize: 13, fontWeight: '600', marginTop: 14, textDecorationLine: 'underline' },
  firstButton:  { width: '100%', marginTop: 20 },
  secondButton: { width: '100%', marginTop: 10 },
})
