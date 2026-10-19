import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ACCENT_PRESETS } from '../src/constants/accentColors'
import * as colors from '../src/constants/colors'
import { isBootReady } from '../src/utils/bootGate'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../src/utils/networkError'

function loadModule(file: string, require: (id: string) => any) {
  const module = { exports: {} as Record<string, any> }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  runInNewContext(code, { module, exports: module.exports, require })
  return module.exports
}

function themeStartup(systemScheme: 'light' | 'dark', migration: () => Promise<void> = async () => {}, systemMotion: () => Promise<boolean> = async () => false) {
  const states: any[] = []
  const dependencies: unknown[][] = []
  const effects: (() => void)[] = []
  const layouts: (() => void)[] = []
  const callbacks: { value: unknown; deps: unknown[] }[] = []
  const nativeSchemes: (string | null)[] = []
  const writes: [string, string][] = []
  let stateIndex = 0
  let effectIndex = 0
  let callbackIndex = 0
  let finishRead!: (values: [string, string | null][]) => void
  let failRead!: (error: Error) => void
  const pendingRead = new Promise<[string, string | null][]>((resolve, reject) => { finishRead = resolve; failRead = reject })
  const storage = {
    multiGet: (keys: string[]) => pendingRead.then(values => keys.map(key => [key, values.find(([saved]) => saved === key)?.[1] ?? null])),
    multiSet: async (entries: [string, string][]) => {
      if (entries.some(([key]) => key === '@advanced_categories')) await migration()
      else entries.forEach(([key, value]) => writes.push([key, value]))
    },
    setItem: async (key: string, value: string) => { writes.push([key, value]) },
  }
  const categories = loadModule('src/constants/categoryOrder.ts', () => storage)
  const appearance = loadModule('src/store/appearanceStore.ts', (id) => id.endsWith('/accentColors') ? { ACCENT_PRESETS } : storage)
  function effect(queue: (() => void)[], run: () => void, deps: unknown[]) {
    const index = effectIndex++
    const previous = dependencies[index]
    if (!previous || deps.some((value, i) => value !== previous[i])) queue.push(run)
    dependencies[index] = deps
  }
  const provider = loadModule('src/context/AppContext.tsx', (id) => {
    if (id === '@react-native-async-storage/async-storage') return storage
    if (id === 'expo-localization') return { getLocales: () => [{ languageCode: 'ja', measurementSystem: 'metric' }] }
    if (id === 'react') return {
      createContext: () => ({ Provider: 'Provider' }),
      useState: (initial: any) => {
        const index = stateIndex++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      },
      useRef: (initial: any) => {
        const index = stateIndex++
        if (!(index in states)) states[index] = { current: initial }
        return states[index]
      },
      useEffect: (run: () => void, deps: unknown[]) => effect(effects, run, deps),
      useLayoutEffect: (run: () => void, deps: unknown[]) => effect(layouts, run, deps),
      useMemo: (run: () => unknown) => run(),
      useCallback: (run: unknown, deps: unknown[]) => {
        const index = callbackIndex++
        if (!callbacks[index] || deps.some((value, i) => value !== callbacks[index].deps[i])) callbacks[index] = { value: run, deps }
        return callbacks[index].value
      },
    }
    if (id === 'react/jsx-runtime') return { jsx: (_type: unknown, props: any) => ({ props }) }
    if (id === 'react-native') return {
      useColorScheme: () => systemScheme,
      Appearance: { setColorScheme: (mode: string | null) => { nativeSchemes.push(mode) } },
      AccessibilityInfo: { isReduceMotionEnabled: systemMotion, addEventListener: () => ({ remove() {} }) },
    }
    if (id.endsWith('/appearanceStore')) return appearance
    if (id.endsWith('/colors')) return colors
    if (id.endsWith('/accentColors')) return { ACCENT_PRESETS }
    if (id.endsWith('/categoryLabels')) return { CATEGORY_LABELS: {}, CATEGORY_LABELS_EN: {} }
    if (id.endsWith('/categoryOrder')) return categories
    if (id.endsWith('/useHistoryPlayback')) return { isPlaybackSpeed: (value: unknown) => value === 1 }
    if (id.endsWith('/networkError')) return { STORAGE_TIMEOUT_MS, withTimeout }
    if (id.endsWith('/timeoutFetch')) return { timeoutFetch: () => assert.fail('日本語で為替を取得している') }
    throw new Error(`Unexpected dependency: ${id}`)
  })
  function render() {
    stateIndex = 0
    effectIndex = 0
    callbackIndex = 0
    const value = provider.AppProvider({ children: null }).props.value
    layouts.splice(0).forEach(run => run())
    effects.splice(0).forEach(run => run())
    return value
  }
  return {
    render, nativeSchemes, writes, failRead, appearance,
    finishRead: (theme: string | null) => finishRead([
      ['app_theme', theme], ['app_language', 'ja'], ['app_accent', 'blue'], ['app_unit', null],
      ['app_reduce_motion', null], ['app_history_node_morph', null], ['app_history_grain', null],
      ['app_history_speed', null], ['app_history_show_inout', null],
      [categories.ADVANCED_CATEGORIES_KEY, null], [categories.ADVANCED_CATEGORIES_VERSION_KEY, null],
    ]),
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const navigationReady = (themeReady: boolean) => isBootReady({ themeReady, authLoading: false, onboarded: true, authSkipped: true, initialDataReady: true })

test('端末の動き設定が未取得の間は演出を抑え、取得後に実際の設定へ合わせる', async () => {
  for (const reduced of [true, false]) {
    let finishMotion!: (value: boolean) => void
    const pendingMotion = new Promise<boolean>(resolve => { finishMotion = resolve })
    const startup = themeStartup('light', async () => {}, () => pendingMotion)
    assert.equal(startup.render().reduceMotion, true)
    assert.equal(startup.render().reduceMotionSystem, false, '未取得の状態を端末設定ONと表示しない')
    startup.finishRead('light')
    await flush()
    assert.equal(startup.render().themeReady, true)
    assert.equal(startup.render().reduceMotion, true)
    finishMotion(reduced)
    await flush()
    assert.equal(startup.render().reduceMotion, reduced)
    assert.equal(startup.render().reduceMotionSystem, reduced)
  }
})

test('保存済みダークテーマの読み込みが遅くても、ライト画面を表示せず端末外観を上書きしない', async () => {
  const startup = themeStartup('light')
  const initial = startup.render()
  assert.equal(initial.themeReady, false)
  assert.equal(navigationReady(initial.themeReady), false)
  assert.deepEqual(startup.nativeSchemes, [])
  await flush()
  assert.equal(startup.render().themeReady, false)
  startup.finishRead('dark')
  await flush()
  const loaded = startup.render()
  assert.equal(loaded.themeReady, true)
  assert.equal(loaded.isDark, true)
  assert.equal(loaded.colors.bg, '#000000')
  assert.equal(loaded.accentKey, 'blue')
  assert.equal(navigationReady(loaded.themeReady), true)
  assert.deepEqual(startup.nativeSchemes, ['dark'])
})

test('テーマ設定の読み込みが停止しても起動待ちを解除し、期限後の古い応答で画面を切り替えない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const startup = themeStartup('light')
  assert.equal(startup.render().themeReady, false)
  t.mock.timers.tick(5_000)
  await flush()
  assert.equal(startup.render().themeReady, true)
  startup.finishRead('dark')
  await flush()
  assert.equal(startup.render().isDark, false)
  assert.equal(startup.writes.length, 0)
})

test('カテゴリ設定の移行書き込みが遅くてもテーマ確定と起動を待たせない', async () => {
  const startup = themeStartup('light', () => new Promise<void>(() => {}))
  startup.render()
  startup.finishRead('dark')
  await flush()
  const loaded = startup.render()
  assert.equal(loaded.themeReady, true)
  assert.equal(loaded.isDark, true)
})

test('読み込み待ちに変更したジャンルの振り分けを、遅い起動時の値で上書きしない', async () => {
  const startup = themeStartup('light')
  const initial = startup.render()
  assert.equal(initial.isAdvancedCategory('Mouse'), false)
  await initial.toggleAdvancedCategory('Mouse')
  assert.equal(startup.render().isAdvancedCategory('Mouse'), true)
  startup.finishRead('light')
  await flush()
  assert.equal(startup.render().isAdvancedCategory('Mouse'), true)
  assert.equal(startup.render().themeReady, true)
})

test('カテゴリ設定の移行に失敗しても保存済みテーマを反映する', async () => {
  const startup = themeStartup('light', async () => { throw new Error('write failed') })
  startup.render()
  startup.finishRead('dark')
  await flush()
  assert.equal(startup.render().isDark, true)
  assert.equal(startup.render().themeReady, true)
})

test('ライト・システム・未保存のテーマも読み込み後の最初の画面に反映する', async () => {
  for (const [saved, system, expectedDark, native] of [
    ['light', 'dark', false, 'light'], ['system', 'dark', true, null],
    [null, 'dark', true, null], ['invalid', 'light', false, null],
  ] as const) {
    const startup = themeStartup(system)
    startup.render()
    startup.finishRead(saved)
    await flush()
    const loaded = startup.render()
    assert.equal(loaded.themeReady, true)
    assert.equal(loaded.isDark, expectedDark)
    assert.deepEqual(startup.nativeSchemes, [native])
  }
})

test('設定の読み取り失敗時は端末のテーマで起動し、スプラッシュで止まらない', async () => {
  const startup = themeStartup('dark')
  startup.render()
  startup.failRead(new Error('read failed'))
  await flush()
  const loaded = startup.render()
  assert.equal(loaded.themeReady, true)
  assert.equal(loaded.isDark, true)
  assert.equal(navigationReady(loaded.themeReady), true)
})

test('起動後にテーマを変えると保存値と端末の外観も追従する', async () => {
  const startup = themeStartup('light')
  startup.render()
  startup.finishRead('light')
  await flush()
  const loaded = startup.render()
  await loaded.setThemeMode('dark')
  assert.equal(startup.render().isDark, true)
  assert.deepEqual(startup.writes, [['app_theme', 'dark']])
  assert.deepEqual(startup.nativeSchemes, ['light', 'dark'])
})
test('Free表示の標準色は保存したProの色を消さず、Proへ戻れば元の色を使う', async () => {
  const startup = themeStartup('light')
  startup.render()
  startup.finishRead('dark')
  await flush()
  const loaded = startup.render()
  loaded.setAccentColorAllowed(false)
  const free = startup.render()
  assert.equal(free.accentKey, 'orange')
  assert.equal(free.colors.accent, ACCENT_PRESETS.find(preset => preset.key === 'orange')!.color)
  assert.equal(startup.writes.length, 0)
  free.setAccentColorAllowed(true)
  assert.equal(startup.render().accentKey, 'blue')
})

test('再ログインで外観を復元すると、再起動なしでAppProviderのテーマと色も変わる', async () => {
  const startup = themeStartup('light')
  startup.render()
  startup.finishRead('light')
  await flush()
  startup.render()
  await startup.appearance.restoreAppearancePreferences({ themeMode: 'dark', accentKey: 'purple' })
  const restored = startup.render()
  assert.equal(restored.themeMode, 'dark')
  assert.equal(restored.isDark, true)
  assert.equal(restored.accentKey, 'purple')
  assert.equal(restored.colors.accent, ACCENT_PRESETS.find(preset => preset.key === 'purple')!.color)
  assert.deepEqual(startup.nativeSchemes, ['light', 'dark'])
})
test('起動読み込みの途中で復旧したテーマを、遅れて返る復旧前の設定で上書きしない', async () => {
  const startup = themeStartup('light')
  startup.render()
  startup.appearance.notifyAppearancePreferences({ themeMode: 'dark', accentKey: 'purple' })
  startup.finishRead('light')
  await flush()
  const restored = startup.render()
  assert.equal(restored.themeReady, true)
  assert.equal(restored.isDark, true)
  assert.equal(restored.accentKey, 'purple')
  assert.deepEqual(startup.nativeSchemes, ['dark'])
})
