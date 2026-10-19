// 公開の直前に名乗りを確定させる関門（061）。
//
// 名前は公開ページの投稿者名になるが、決める場所は登録直後の PublicTagSetupModal だけで、
// 061 より前に登録した人はそこを通っていない（migration が public_tag_chosen を TRUE で
// 埋めているため、次の起動でも聞かれない）。名前が空のまま公開すると、公開ページに
// 投稿者のいないデスクが並ぶ。
//
// **公開・再公開・公開ページの更新は、すべてこのモーダルを通してから publishPlan を呼ぶ。**
// 画面ごとに確認を持つと（配線図の結果画面はネイティブの Alert、デスク一覧も Alert、
// 公開シートは自前の確認画面）、名前を聞く場所を1つ足すたびにどれかで漏れる。
// 呼び出しは usePublicNameGate() の run() 経由に揃えてある。
//
// キーボードは KeyboardAvoidingView で避ける。画面下に貼り付くシートに入力欄を置くと、
// iOS では欄がキーボードの下へ完全に隠れて打っている文字が見えない。
import { useEffect, useState } from 'react'
import {
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { TextField } from '../atoms/TextField'
import { Button } from '../atoms/Button'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { AppColors } from '../../context/AppContext'
import { syncPublicOwnerName } from '../../services/publishService'
import { localizedErrorMessage } from '../../utils/localizedError'
import { assertPublicContentAllowed } from '../../utils/publicContentModeration'
import { trimAndTruncate } from '../../utils/truncateText'
import { setPublicNickname } from '../../utils/publicNickname'
import { QUICK_TIMEOUT_MS, withTimeout } from '../../utils/networkError'

const NAME_MAX_LENGTH = 20

interface Props {
  visible: boolean
  colors: AppColors
  lang: 'ja' | 'en'
  /** 名前が確定した。呼び出し側はここで本来の公開処理へ進む */
  onSaved: (name: string) => void
  onCancel: () => void
}

export function PublicNameGateModal({ visible, colors: C, lang, onSaved, onCancel }: Props) {
  const ja = lang === 'ja'
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!visible) return
    setName('')
    setError(null)
    setBusy(false)
  }, [visible])

  const submit = () => {
    if (busy) return
    const next = trimAndTruncate(name, NAME_MAX_LENGTH)
    if (!next) {
      setError(ja ? '名前を入力してください' : 'Please enter a name')
      return
    }
    try {
      assertPublicContentAllowed({ title: '', ownerName: next })
    } catch (e) {
      setError(localizedErrorMessage(e, lang, ja ? '名前を確認してください。' : 'Check your name.'))
      return
    }
    setBusy(true)
    void (async () => {
      try {
        await withTimeout((async () => {
          // 名前の正本は端末（publishService が公開の直前にここから読む）。先に確定させ、
          // サーバーへの反映が通信で落ちても公開そのものは止めない
          await setPublicNickname(next).catch(() => {})
          await syncPublicOwnerName(next)
        })(), QUICK_TIMEOUT_MS)
      } catch {
        // 同期は後から終わることもある。公開本体は端末の名前で続行する
      } finally {
        onSaved(next)
      }
    })()
  }

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onCancel}
      dismissDisabled={busy}
      avoidKeyboard
      sheetStyle={styles.sheet}
    >
            <Text style={[styles.title, { color: C.text }]}>
              {ja ? '公開する名前を決める' : 'Choose your public name'}
            </Text>
            <Text style={[styles.lead, { color: C.textMuted }]}>
              {ja
                ? '公開ページに投稿者として表示されます。本名でなくてかまいません。'
                : 'Shown as the author on your public page. It does not have to be your real name.'}
            </Text>
            <TextField
              size="prominent"
              invalid={!!error}
              value={name}
              onChangeText={(next) => { setName(next); setError(null) }}
              autoFocus
              maxLength={NAME_MAX_LENGTH}
              returnKeyType="done"
              onSubmitEditing={submit}
              placeholder={ja ? '例：ゆう' : 'e.g. Alex'}
              accessibilityLabel={ja ? '表示名' : 'Display name'}
              editable={!busy}
            />
            <Text style={[styles.hint, { color: error ? C.danger : C.textMuted }]}>
              {error ?? (ja
                ? 'あとからマイページのプロフィールで変えられます'
                : 'You can change it later from your profile on My Page.')}
            </Text>
            <View style={styles.actions}>
              <Button
                title={ja ? '決定して公開へ' : 'Save and continue'}
                size="compact"
                shape="control"
                style={styles.btn}
                onPress={submit}
                disabled={busy}
              />
              <Button
                title={ja ? 'キャンセル' : 'Cancel'}
                variant="neutral"
                size="compact"
                shape="control"
                style={styles.btn}
                onPress={() => { if (!busy) onCancel() }}
              />
            </View>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: { gap: 10 },
  title: { fontSize: 17, fontWeight: '800' },
  lead: { fontSize: 13, lineHeight: 19 },
  hint: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1 },
})
