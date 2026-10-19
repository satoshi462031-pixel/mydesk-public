import { StyleSheet, Text, View } from 'react-native'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { Button } from '../atoms/Button'
import { HeaderIconButton } from '../atoms/HeaderIconButton'
import { BottomSheetModal } from './BottomSheetModal'

interface Props {
  visible: boolean
  count: number
  onChoose: (owned: boolean) => void
  onDismiss: () => void
  onDismissed?: () => void
}

export function NewGearOwnershipSheet({ visible, count, onChoose, onDismiss, onDismissed }: Props) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  return (
    <BottomSheetModal visible={visible} onDismiss={onDismiss} onDismissed={onDismissed} sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: C.text }]} accessibilityRole="header">
          {ja ? '持っている機材ですか？' : 'Do you own this gear?'}
        </Text>
        <HeaderIconButton name={ICONS.close} color={C.textMuted} onPress={onDismiss} accessibilityLabel={ja ? '入力へ戻る' : 'Back to input'} />
      </View>
      <Text style={[styles.description, { color: C.textSub }]}>
        {ja
          ? `商品名を入れた${count}件の機材を、持ち物として登録しますか？`
          : `Register the ${count} named ${count === 1 ? 'item' : 'items'} as gear you own?`}
      </Text>
      <Text style={[styles.description, { color: C.textMuted }]}>
        {ja
          ? '候補にすると、所有数・購入総額には含めません。あとから変更できます。'
          : 'Candidates are excluded from owned counts and purchase totals. You can change this later.'}
      </Text>
      <Button title={ja ? '持ち物として登録' : 'Register as owned'} onPress={() => onChoose(true)} shape="control" />
      <Button title={ja ? '候補として保存' : 'Save as candidates'} variant="secondary" onPress={() => onChoose(false)} shape="control" />
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', flex: 1 },
  description: { fontSize: 14, lineHeight: 21 },
})
