import { Alert } from '../../utils/alert'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { HeaderIconButton } from '../atoms/HeaderIconButton'
import { listPasskeys, PasskeyListItem, registerPasskey, removePasskey } from '../../services/passkeyService'
import { isPasskeyCancelled, passkeyErrorMessage } from '../../utils/passkeyErrors'
import { RemovalMotion, useRemovalMotion } from '../molecules/RemovalMotion'

interface Props {
  visible: boolean
  userId: string
  onClose: () => void
}

export function PasskeySettingsSheet({ visible, userId, onClose }: Props) {
  const { colors: C, lang, reduceMotion } = useApp()
  const removal = useRemovalMotion()
  const [passkeys, setPasskeys] = useState<PasskeyListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inFlightRef = useRef(false)
  const activeRef = useRef(false)

  const close = () => {
    if (!inFlightRef.current) onClose()
  }

  const refresh = useCallback(async () => {
    const items = await listPasskeys(userId)
    if (activeRef.current) setPasskeys(items)
  }, [userId])

  useEffect(() => {
    activeRef.current = visible
    if (!visible) return
    let active = true
    setLoading(true)
    setError('')
    setNotice('')
    void listPasskeys(userId).then(items => {
      if (active) setPasskeys(items)
    }).catch((e: unknown) => {
      if (active) setError(passkeyErrorMessage(e, lang))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; activeRef.current = false }
  }, [visible, userId, lang])

  const add = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await registerPasskey(userId)
      if (activeRef.current) setNotice(lang === 'ja' ? 'パスキーを登録しました。次回からパスキーでログインできます。' : 'Passkey registered. You can use it the next time you sign in.')
      await refresh()
    } catch (e: unknown) {
      if (activeRef.current && !isPasskeyCancelled(e)) setError(passkeyErrorMessage(e, lang))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (inFlightRef.current || !activeRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await removePasskey(userId, id)
      if (activeRef.current) {
        await removal.run(id, () => { if (activeRef.current) setPasskeys(items => items.filter(item => item.id !== id)) }, 'fade')
        setNotice(lang === 'ja' ? 'パスキーの登録を解除しました。' : 'Passkey removed.')
      }
    } catch (e: unknown) {
      if (activeRef.current) setError(passkeyErrorMessage(e, lang))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const confirmRemove = (item: PasskeyListItem) => {
    Alert.alert(
      lang === 'ja' ? 'パスキーの登録を解除' : 'Remove passkey',
      lang === 'ja'
        ? 'このパスキーではログインできなくなります。別のログイン方法が使えることを確認してください。端末のパスワード管理サービスに保存されたパスキーは残ります。'
        : 'This passkey will no longer work. Make sure you can use another sign-in method. The saved passkey remains in your device password manager.',
      [
        { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: lang === 'ja' ? '登録を解除' : 'Remove', style: 'destructive', onPress: () => { void remove(item.id) } },
      ],
    )
  }

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.separator }]}>
          <Text style={[styles.title, { color: C.text }]}>{lang === 'ja' ? 'パスキー' : 'Passkeys'}</Text>
          <HeaderIconButton name="close" color={busy ? C.textMuted : C.textSub} onPress={close} accessibilityLabel={lang === 'ja' ? '閉じる' : 'Close'} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.description, { color: C.textSub }]}>
            {Platform.OS === 'android'
              ? (lang === 'ja'
                ? '指紋認証や画面ロックなどで、パスワードを入力せずにログインできます。まず現在のアカウントにパスキーを登録してください。'
                : 'Sign in using your fingerprint or screen lock without typing a password. Register a passkey for your current account first.')
              : (lang === 'ja'
                ? 'Face IDやTouch IDなどで、パスワードを入力せずにログインできます。まず現在のアカウントにパスキーを登録してください。'
                : 'Sign in using Face ID or Touch ID without typing a password. Register a passkey for your current account first.')}
          </Text>
          {loading ? <ActivityIndicator color={C.accent} /> : <>
            {passkeys.length === 0 && !error && (
              <Text style={[styles.description, { color: C.textMuted }]}>{lang === 'ja' ? '登録済みのパスキーはありません。' : 'No passkeys registered.'}</Text>
            )}
            {passkeys.map(item => (
              <RemovalMotion key={item.id} ref={(handle) => removal.setRef(item.id, handle)}>
              <View key={item.id} style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}>
                <AppIcon name="key-outline" size={22} color={C.textSub} />
                <View style={styles.rowText}>
                  <Text style={[styles.name, { color: C.text }]}>{item.friendly_name || (lang === 'ja' ? 'パスキー' : 'Passkey')}</Text>
                  <Text style={[styles.date, { color: C.textMuted }]}>
                    {new Date(item.created_at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => confirmRemove(item)} disabled={busy} accessibilityRole="button"
                  accessibilityLabel={lang === 'ja' ? `${item.friendly_name || 'パスキー'}の登録を解除` : `Remove ${item.friendly_name || 'passkey'}`}
                  style={styles.remove}>
                  <Text style={{ color: C.danger }}>{lang === 'ja' ? '解除' : 'Remove'}</Text>
                </TouchableOpacity>
              </View>
              </RemovalMotion>
            ))}
          </>}
          {!!notice && <Text accessibilityRole="alert" style={[styles.description, { color: C.textSub }]}>{notice}</Text>}
          {!!error && <Text accessibilityRole="alert" style={[styles.description, { color: C.danger }]}>{error}</Text>}
          <Button title={lang === 'ja' ? 'パスキーを登録' : 'Register a passkey'} shape="control" onPress={add} disabled={loading || busy} loading={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: UI_METRICS.modalGutter, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: '700' },
  content: { padding: UI_METRICS.modalGutter, gap: 16 },
  description: { fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.cardRadius },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  date: { fontSize: 12, marginTop: 4 },
  remove: { padding: 8 },
})
