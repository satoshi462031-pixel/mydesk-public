import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { PUBLISH_TIMEOUT_MS, withTimeout } from '../src/utils/networkError'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

function harness(file: 'App.tsx' | 'src/components/molecules/ErrorContainment.tsx', options: { platform?: string; hide?: () => Promise<void>; loggingFails?: boolean } = {}) {
  const slots: any[] = []
  let cursor = 0
  const alerts: any[] = []
  const calls: string[] = []
  class Component {
    props: any
    state: any
    constructor(props: any) { this.props = props }
    setState(next: any) { this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) } }
  }
  const React = {
    Component,
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => {
      const at = cursor++
      if (!(at in slots)) slots[at] = initial
      return [slots[at], (value: any) => { slots[at] = value }]
    },
    useRef: (initial: any) => {
      const at = cursor++
      if (!(at in slots)) slots[at] = { current: initial }
      return slots[at]
    },
  }
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const extra = file === 'App.tsx' ? '\nexports.AppErrorBoundary = AppErrorBoundary;' : '\nexports.BoundaryCore = BoundaryCore; exports.SectionFallback = SectionFallback;'
  runInNewContext(code + extra, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === 'react') return React
      if (id.endsWith('/alert')) return { Alert: { alert: (...args: any[]) => { alerts.push(args) } } }
      if (id === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator', TouchableOpacity: 'TouchableOpacity', View: 'View', Text: 'Text',
        StyleSheet: { create: (styles: any) => styles },
        Platform: { OS: options.platform ?? 'ios' },
        Alert: { alert: (...args: any[]) => { alerts.push(args) } },
      }
      if (id === 'expo-splash-screen') return { hideAsync: () => { calls.push('hideSplash'); return options.hide?.() ?? Promise.resolve() } }
      if (id === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }
      if (id === 'react-native-gesture-handler') return { GestureHandlerRootView: 'GestureHandlerRootView' }
      if (id.endsWith('/analytics')) return { analytics: { error: () => { calls.push('report'); if (options.loggingFails) throw new Error('report unavailable') } } }
      if (id.endsWith('/crashReporting')) return { Sentry: { wrap: (app: any) => app } }
      if (id.endsWith('/RootNavigator')) return { RootNavigator: 'RootNavigator' }
      if (id.endsWith('/webAlert')) return { webAlert: () => {} }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ lang: 'ja', colors: {} }) }
      if (id.endsWith('/ui')) return { UI_METRICS: { touchMinSize: 44, controlRadius: 10 } }
      if (id === './RetryState') return { RetryState: 'RetryState' }
      if (id.endsWith('/networkError')) return { PUBLISH_TIMEOUT_MS, withTimeout }
      throw new Error('Unexpected module: ' + id)
    },
  })
  return {
    exports: module.exports, calls, alerts,
    renderSection: (props: any) => { cursor = 0; return module.exports.SectionFallback(props) },
  }
}

function find(tree: any, type: string): any {
  if (!tree) return undefined
  if (Array.isArray(tree)) return tree.map(child => find(child, type)).find(Boolean)
  return tree.type === type ? tree : find(tree.props?.children, type)
}

test('起動中の描画エラーでもネイティブスプラッシュを解除して復旧ボタンを表示する', async () => {
  const h = harness('App.tsx')
  const boundary = new h.exports.AppErrorBoundary({ children: 'app' })
  boundary.state = h.exports.AppErrorBoundary.getDerivedStateFromError()
  boundary.componentDidCatch(new Error('boot failure'), {})
  assert.ok(h.calls.includes('hideSplash'))
  const button = find(boundary.render(), 'TouchableOpacity')
  assert.ok(button)
  button.props.onPress()
  assert.equal(boundary.render(), 'app')
})

test('スプラッシュ解除やエラー記録が失敗しても、最後の復旧画面は使える', async () => {
  const h = harness('App.tsx', { hide: async () => { throw new Error('unavailable') }, loggingFails: true })
  const boundary = new h.exports.AppErrorBoundary({ children: 'app' })
  boundary.state = { failed: true }
  assert.doesNotThrow(() => boundary.componentDidCatch(new Error('boot failure'), {}))
  await flush()
  assert.ok(find(boundary.render(), 'TouchableOpacity'))
})

test('Webの描画エラーではネイティブスプラッシュへアクセスしない', () => {
  const h = harness('App.tsx', { platform: 'web' })
  new h.exports.AppErrorBoundary({}).componentDidCatch(new Error('render failure'), {})
  assert.equal(h.calls.includes('hideSplash'), false)
})

test('画面や部品の例外を記録する処理が失敗しても、境界の復旧画面を巻き込まない', () => {
  const h = harness('src/components/molecules/ErrorContainment.tsx', { loggingFails: true })
  const boundary = new h.exports.BoundaryCore({ name: 'screen:PublicDesk', fallback: () => 'fallback', children: 'screen' })
  boundary.state = { failed: true }
  assert.doesNotThrow(() => boundary.componentDidCatch(new Error('render failure'), {}))
  assert.equal(boundary.render(), 'fallback')
  boundary.reset()
  assert.equal(boundary.render(), 'screen')
})

test('同じ画面で表示対象を変えたら以前のエラー状態を持ち越さず、同じ対象では自動再試行を繰り返さない', () => {
  const h = harness('src/components/molecules/ErrorContainment.tsx')
  const params = { deskId: 'broken' }
  const Screen = h.exports.withScreenBoundary(() => null, 'PublicDesk')
  const element = Screen({ route: { params } })
  assert.equal(element.props.resetKey, params)
  const boundary = new h.exports.BoundaryCore(element.props)
  boundary.state = { failed: true }
  boundary.componentDidUpdate(element.props)
  assert.equal(boundary.state.failed, true)
  boundary.props = Screen({ route: { params: { deskId: 'healthy' } } }).props
  boundary.componentDidUpdate(element.props)
  assert.equal(boundary.state.failed, false)
})

test('復旧処理が同期例外を投げても、通知後に処理中を解除して再試行できる', async () => {
  const h = harness('src/components/molecules/ErrorContainment.tsx')
  let attempts = 0
  const props = { name: 'map', onRetry: () => {}, recovery: { label: 'reset', confirmTitle: 'confirm', confirmMessage: 'message', run: () => { attempts++; throw new Error('sync failure') } } }
  find(h.renderSection(props), 'TouchableOpacity').props.onPress()
  assert.doesNotThrow(() => h.alerts[0][2][1].onPress())
  await flush()
  assert.equal(attempts, 1)
  assert.equal(h.alerts.length, 2)
  assert.equal(find(h.renderSection(props), 'TouchableOpacity').props.disabled, false)
  find(h.renderSection(props), 'TouchableOpacity').props.onPress()
  h.alerts[2][2][1].onPress()
  await flush()
  assert.equal(attempts, 2)
})

test('複数の確認ダイアログを開いても復旧を二重実行せず、処理中は通常の再試行も止める', async () => {
  const h = harness('src/components/molecules/ErrorContainment.tsx')
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  let attempts = 0
  let retries = 0
  const props = { name: 'map', onRetry: () => { retries++ }, recovery: { label: 'reset', confirmTitle: 'confirm', confirmMessage: 'message', run: () => { attempts++; return pending } } }
  const button = find(h.renderSection(props), 'TouchableOpacity')
  button.props.onPress()
  button.props.onPress()
  h.alerts[0][2][1].onPress()
  h.alerts[1][2][1].onPress()
  await flush()
  assert.equal(attempts, 1)
  assert.equal(find(h.renderSection(props), 'RetryState').props.disabled, true)
  finish()
  await flush()
  assert.equal(retries, 1)
  assert.equal(find(h.renderSection(props), 'RetryState').props.disabled, false)
})

test('復旧の非同期失敗と記録の失敗が重なっても、エラー通知と再操作を残す', async () => {
  const h = harness('src/components/molecules/ErrorContainment.tsx', { loggingFails: true })
  const props = { name: 'map', onRetry: () => {}, recovery: { label: 'reset', confirmTitle: 'confirm', confirmMessage: 'message', run: async () => { throw new Error('failed') } } }
  find(h.renderSection(props), 'TouchableOpacity').props.onPress()
  h.alerts[0][2][1].onPress()
  await flush()
  assert.equal(h.alerts.length, 2)
  assert.equal(find(h.renderSection(props), 'TouchableOpacity').props.disabled, false)
})

test('復旧の保存が止まったらスピナーを解除し、遅い処理へ重ねてリセットを実行しない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness('src/components/molecules/ErrorContainment.tsx')
  let finish!: () => void
  let retries = 0
  const props = { name: 'map', onRetry: () => { retries++ }, recovery: { label: 'reset', confirmTitle: 'confirm', confirmMessage: 'message', run: () => new Promise<void>(resolve => { finish = resolve }) } }
  find(h.renderSection(props), 'TouchableOpacity').props.onPress()
  h.alerts[0][2][1].onPress()
  await flush()
  assert.ok(find(h.renderSection(props), 'ActivityIndicator'))
  t.mock.timers.tick(60_000)
  await flush()
  const fallback = h.renderSection(props)
  assert.equal(find(fallback, 'ActivityIndicator'), undefined)
  assert.match(find(fallback, 'RetryState').props.message, /応答していません/)
  find(fallback, 'TouchableOpacity').props.onPress()
  assert.equal(h.alerts.length, 2)
  assert.equal(retries, 0)
  finish()
  await flush()
  assert.equal(retries, 1)
  assert.equal(find(h.renderSection(props), 'RetryState').props.disabled, false)
})
