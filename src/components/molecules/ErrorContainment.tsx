import { Alert } from '../../utils/alert'
import React, { ComponentType, ErrorInfo, ReactNode, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp } from '../../context/AppContext'
import { analytics } from '../../services/analytics'
import { RetryState } from './RetryState'
import { UI_METRICS } from '../../constants/ui'
import { PUBLISH_TIMEOUT_MS, withTimeout } from '../../utils/networkError'

// ─── 描画の失敗を、壊れた場所の中に閉じ込める ─────────────────────────────
//
// 以前はアプリ全体に1つだけ境界があり、どこか1画面の描画が例外を投げると、アプリ全体が
// 「再起動してください」に置き換わっていた。原因が保存データ（壊れたデスク1件など）だと、
// 再起動しても同じ画面でまた落ち、他の画面にも入れなくなる。
// 画面ごと・重い部品ごとに境界を置き、壊れた所だけを差し替えて、戻る・他の画面を使う道を残す。

interface CoreProps {
  name: string
  resetKey?: unknown
  fallback: (reset: () => void) => ReactNode
  children: ReactNode
}

class BoundaryCore extends React.Component<CoreProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    try { analytics.error('render_contained', error, { boundary: this.props.name }) } catch {}
  }

  componentDidUpdate(previous: CoreProps) {
    // 同じ画面で別のデスクなどに切り替えたとき、前の対象の失敗を持ち越さない。
    if (this.state.failed && (previous.name !== this.props.name || previous.resetKey !== this.props.resetKey)) this.reset()
  }

  reset = () => this.setState({ failed: false })

  render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children
  }
}

interface ScreenNavigation {
  canGoBack?: () => boolean
  goBack?: () => void
}

function ScreenFallback({ navigation, onRetry }: { navigation?: ScreenNavigation; onRetry: () => void }) {
  const { colors: C, lang } = useApp()
  const insets = useSafeAreaInsets()
  const canGoBack = !!navigation?.canGoBack?.()
  return (
    // ヘッダーの無い画面（ログイン・オンボーディングなど）でも時計・ノッチ・ホームバーに
    // 重ならないよう、上下の安全領域を空ける
    <View style={[styles.screen, { backgroundColor: C.bgList, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <RetryState
        message={lang === 'ja'
          ? 'この画面を表示できませんでした。ほかの画面はそのまま使えます。'
          : 'This screen could not be shown. The rest of the app still works.'}
        onRetry={onRetry}
      />
      {canGoBack && (
        <TouchableOpacity
          style={styles.back}
          onPress={() => navigation?.goBack?.()}
          accessibilityRole="button"
        >
          {/* 主の操作（もう一度試す）がアクセントの塗りなので、補助は中立の色にして並びを分ける */}
          <Text style={[styles.backText, { color: C.textSub }]}>{lang === 'ja' ? '前の画面に戻る' : 'Go back'}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

/** 画面1枚を境界で包む。ナビゲーターへ渡す component は描画のたびに作り直さないこと（画面が作り直される） */
export function withScreenBoundary<P extends object>(Screen: ComponentType<P>, name: string): (props: P) => React.JSX.Element {
  function GuardedScreen(props: P) {
    const { navigation, route } = props as { navigation?: ScreenNavigation; route?: { params?: unknown } }
    return (
      <BoundaryCore name={`screen:${name}`} resetKey={route?.params} fallback={(reset) => <ScreenFallback navigation={navigation} onRetry={reset} />}>
        <Screen {...props} />
      </BoundaryCore>
    )
  }
  GuardedScreen.displayName = `Guarded(${name})`
  return GuardedScreen
}

/** 画面の中の重い部品（配線図・統計など）を包む。落ちてもその部分だけが差し替わり、画面の他の操作は続けられる */
/**
 * 「もう一度試す」で直らない失敗（保存データの中身が原因）向けの、その部分を作り直す操作。
 * 押すと確認を取り、終わったら境界を戻して描き直す
 */
export interface SectionRecovery {
  label: string
  confirmTitle: string
  confirmMessage: string
  run: () => Promise<void>
}

export function SectionBoundary({ name, recovery, children }: { name: string; recovery?: SectionRecovery; children: ReactNode }) {
  return (
    <BoundaryCore name={`section:${name}`} fallback={(reset) => <SectionFallback onRetry={reset} recovery={recovery} name={name} />}>
      {children}
    </BoundaryCore>
  )
}

function SectionFallback({ onRetry, recovery, name }: { onRetry: () => void; recovery?: SectionRecovery; name: string }) {
  const { colors: C, lang } = useApp()
  const [running, setRunning] = useState(false)
  const [stalled, setStalled] = useState(false)
  const runningRef = useRef(false)
  const ja = lang === 'ja'
  const runRecovery = () => {
    if (!recovery || runningRef.current) return
    Alert.alert(recovery.confirmTitle, recovery.confirmMessage, [
      { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
      {
        text: recovery.label,
        style: 'destructive',
        onPress: () => {
          if (runningRef.current) return
          runningRef.current = true
          setRunning(true)
          setStalled(false)
          // 同期例外も同じ失敗経路へ流し、処理中を必ず解除する。
          const work = Promise.resolve().then(() => recovery.run()).then(onRetry)
          // 保存が後から完了しても、別のリセットと並行してデータを書き換えない。
          void work.finally(() => { runningRef.current = false; setRunning(false) }).catch(() => {})
          void withTimeout(work, PUBLISH_TIMEOUT_MS)
            .catch((error: unknown) => {
              setStalled(true)
              try { analytics.error('section_recovery', error, { boundary: name }) } catch {}
              Alert.alert(ja ? 'リセットを完了できませんでした' : 'Could not finish reset')
            })
        },
      },
    ])
  }
  return (
    <View style={styles.section}>
      <RetryState
        message={running && stalled
          ? (ja ? '復旧処理が応答していません。改善しない場合はアプリを開き直してください。' : 'Recovery is not responding. If it persists, reopen the app.')
          : ja
          ? 'この部分を表示できませんでした。機材の編集など、ほかの操作は続けられます。'
          : 'This part could not be shown. You can keep editing the rest.'}
        onRetry={onRetry}
        disabled={running}
      />
      {recovery && (
        <TouchableOpacity
          style={styles.recovery}
          onPress={runRecovery}
          disabled={running}
          accessibilityRole="button"
        >
          {running && !stalled
            ? <ActivityIndicator color={C.textMuted} />
            : <Text style={[styles.backText, { color: C.accentText }]}>{recovery.label}</Text>}
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  section: { flex: 1 },
  recovery: { minHeight: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  back: { minHeight: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  backText: { fontSize: 15, fontWeight: '600' },
})
