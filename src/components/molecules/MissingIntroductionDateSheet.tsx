import { StyleSheet, Text, View } from 'react-native'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { Button } from '../atoms/Button'
import { HeaderIconButton } from '../atoms/HeaderIconButton'
import { BottomSheetModal } from './BottomSheetModal'

export type MissingIntroductionDateChoice = 'unset' | 'today'

interface Props {
  visible: boolean
  count: number
  continuousAddition?: boolean
  /** 商品名の無い枠は数に入れず、どちらを選んでも未設定のまま残す画面 */
  leavesUnnamedUnset?: boolean
  onChoose: (choice: MissingIntroductionDateChoice) => void
  onDismiss: () => void
  onDismissed?: () => void
}

export function MissingIntroductionDateSheet({ visible, count, continuousAddition, leavesUnnamedUnset, onChoose, onDismiss, onDismissed }: Props) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  return (
    <BottomSheetModal visible={visible} onDismiss={onDismiss} onDismissed={onDismissed} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: C.text }]} accessibilityRole="header">
          {ja ? '導入日が未入力です' : 'Introduction date not set'}
        </Text>
        <HeaderIconButton name={ICONS.close}color={C.textMuted} onPress={onDismiss} accessibilityLabel={ja ? '入力へ戻る' : 'Back to input'} />
      </View>
      <Text style={[styles.description, { color: C.textSub }]}>
        {ja
          ? `${count}件の機材の導入日をどう保存しますか？入力済みの日付は変更しません。`
          : `How should we save the introduction dates for ${count} ${count === 1 ? 'item' : 'items'}? Entered dates stay unchanged.`}
      </Text>
      <Text style={[styles.description, { color: C.textMuted }]}>
        {ja ? 'わからない場合は未設定のまま保存できます。あとから変更できます。' : 'If unsure, leave the dates unset. You can edit them later.'}
        {leavesUnnamedUnset && (ja ? '\n商品名が未入力の枠は、どちらを選んでも未設定のままです。' : '\nSlots without a product name stay unset either way.')}
        {continuousAddition && (ja ? '\nこの画面で続けて追加する機材にも同じ選択を適用します。' : '\nThis choice also applies to further items added on this screen.')}
      </Text>
      <Button title={ja ? '未設定のまま保存（推奨）' : 'Save with dates unset (recommended)'} onPress={() => onChoose('unset')} shape="control" />
      <Button title={ja ? '未入力分を今日の日付にする' : 'Use today for unset dates'} variant="secondary" onPress={() => onChoose('today')} shape="control" />
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', flex: 1 },
  description: { fontSize: 14, lineHeight: 21 },
})
