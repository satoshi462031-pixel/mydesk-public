import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp } from '../../context/AppContext'
import { AppAlert, currentAlert, finishAlert, subscribeAlerts } from '../../utils/alert'
import { UI_METRICS } from '../../constants/ui'

export function AlertHost() {
  const request = useSyncExternalStore(subscribeAlerts, currentAlert, currentAlert)
  return request ? <AlertDialog key={request.id} request={request} /> : null
}

function AlertDialog({ request }: { request: AppAlert }) {
  const { colors: C, lang } = useApp()
  const insets = useSafeAreaInsets()
  const [visible, setVisible] = useState(true)
  const selection = useRef<{ index?: number } | null>(null)
  const complete = () => {
    if (!selection.current) return
    finishAlert(request, selection.current.index)
  }
  const choose = (index?: number) => {
    if (selection.current) return
    selection.current = { index }
    setVisible(false)
    // Webの共有・コピー・ファイル選択は、クリックの呼び出し中に始める必要がある。
    if (Platform.OS === 'web') finishAlert(request, index)
  }
  const cancel = () => {
    const index = request.buttons.findIndex(button => button.style === 'cancel')
    if (index >= 0) choose(index)
    else if (request.options?.cancelable) choose()
  }

  useEffect(() => {
    // AndroidのModalにはonDismissがない。アニメーションなしで閉じた次のフレームで処理する。
    if (visible || Platform.OS !== 'android') return
    const frame = requestAnimationFrame(() => finishAlert(request, selection.current?.index))
    return () => cancelAnimationFrame(frame)
  }, [visible, request])

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={cancel} onDismiss={complete}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessible={false} />
        <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: Math.max(16, insets.bottom) }]} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={[styles.title, { color: C.text }]}>{request.title}</Text>
            {!!request.message && <Text selectable style={[styles.message, { color: C.textSub }]}>{request.message}</Text>}
            {request.buttons.map((button, index) => (
              <Pressable key={index} onPress={() => choose(index)} accessibilityRole="button"
                style={[styles.button, { borderTopColor: C.border }]}>
                <Text style={[styles.label, { color: button.style === 'destructive' ? C.danger : C.accentText }]}>
                  {button.text || (lang === 'ja' ? '閉じる' : 'Close')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: UI_METRICS.sheetRadius, borderTopRightRadius: UI_METRICS.sheetRadius, paddingHorizontal: UI_METRICS.sheetGutter },
  title: { fontSize: 17, fontWeight: '700', paddingTop: 20, paddingBottom: 12 },
  message: { fontSize: 14, lineHeight: 21, paddingBottom: 16 },
  button: { minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, justifyContent: 'center', paddingVertical: 12 },
  label: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
})
