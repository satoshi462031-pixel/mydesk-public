import React, { ErrorInfo } from 'react'
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as NativeSplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RootNavigator } from './src/navigation/RootNavigator'
import { analytics } from './src/services/analytics'
import { Sentry } from './src/services/crashReporting'
import { UI_METRICS } from './src/constants/ui'
import { BrowserDialogs, webAlert } from './src/utils/webAlert'

const SPLASH_BG = '#232F3E'

// react-native-web の Alert.alert は何もしないので、ブラウザのダイアログへ送る（utils/webAlert.ts）
if (Platform.OS === 'web') {
  Alert.alert = (title, message, buttons, options) =>
    webAlert(globalThis as unknown as BrowserDialogs, title, message, buttons, options)
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // 起動中に落ちても復旧画面をスプラッシュの裏に隠さず、記録の失敗もここで止める。
    if (Platform.OS !== 'web') {
      try { void NativeSplashScreen.hideAsync().catch(() => {}) } catch {}
    }
    try { analytics.error('react_render', error) } catch {}
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={styles.errorFallback}>
          <Text style={styles.errorTitle}>画面を表示できませんでした</Text>
          <Text style={styles.errorBody}>もう一度表示するか、アプリを再起動してください。</Text>
          {/* 画面ごとの境界（ErrorContainment）の外で落ちたときの最後の受け皿。
              一時的な失敗なら再起動せずに戻れるようにする */}
          <TouchableOpacity
            style={styles.errorRetry}
            onPress={() => this.setState({ failed: false })}
            accessibilityRole="button"
          >
            <Text style={styles.errorRetryText}>もう一度表示</Text>
          </TouchableOpacity>
        </View>
      )
    }
    return this.props.children
  }
}

function App() {
  return (
    // Provider をルートに置く。各ナビゲータも内部に持っているが、
    // モーダルなどナビゲータの外側で描画される要素はそれを参照できない
    <AppErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView style={styles.root}>
          <View style={styles.appFrame}>
            <RootNavigator />
          </View>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </AppErrorBoundary>
  )
}

export default Sentry.wrap(App)

const styles = StyleSheet.create({
  errorFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: SPLASH_BG },
  errorTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  errorBody: { color: '#D5DEE5', fontSize: 14 },
  errorRetry: { marginTop: 20, minHeight: UI_METRICS.touchMinSize, paddingHorizontal: 20, justifyContent: 'center', borderRadius: UI_METRICS.controlRadius, borderWidth: 1, borderColor: '#D5DEE5' },
  errorRetryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  root: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? '#E7EDF3' : SPLASH_BG,
    alignItems: Platform.OS === 'web' ? 'center' : undefined,
  },
  appFrame: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 480 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' : undefined,
    marginVertical: Platform.OS === 'web' ? 16 : 0,
    borderRadius: Platform.OS === 'web' ? 20 : 0,
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'web' ? '#FFFFFF' : SPLASH_BG,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    borderColor: '#CFD9DE',
    shadowColor: '#0F1419',
    shadowOpacity: Platform.OS === 'web' ? 0.16 : 0,
    shadowRadius: Platform.OS === 'web' ? 24 : 0,
    shadowOffset: { width: 0, height: 8 },
    elevation: Platform.OS === 'web' ? 8 : 0,
  },
})
