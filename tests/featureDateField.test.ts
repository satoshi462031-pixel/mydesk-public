import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as dateFormat from '../src/utils/dateFormat'

function dateField(
  lang: 'ja' | 'en', props: Record<string, any>,
  platform = 'web', initialNow = new Date(),
) {
  let now = initialNow.getTime()
  let stateIndex = 0
  let mounted = false
  const states: any[] = []
  const effects: Array<() => () => void> = []
  const timers = new Map<number, { callback: () => void; at: number }>()
  let timerId = 0
  let onAppState: (state: string) => void = () => {}
  let removed = false
  const module = { exports: {} as Record<string, (props: any) => any> }
  const code = ts.transpileModule(readFileSync('src/components/molecules/DateField.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const runtime = {
    module, exports: module.exports,
    Date: class extends Date {
      constructor(value?: any) { super(value ?? now) }
    },
    setTimeout: (callback: () => void, delay: number) => {
      timers.set(++timerId, { callback, at: now + delay })
      return timerId
    },
    clearTimeout: (id: number) => { timers.delete(id) },
    require: (id: string) => {
      if (id === 'react') return {
        useState: (initial: any) => {
          const index = stateIndex++
          if (!mounted) states[index] = typeof initial === 'function' ? initial() : initial
          return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
        },
        useEffect: (effect: () => () => void) => { if (!mounted) effects.push(effect) },
      }
      if (id === 'react/jsx-runtime') {
        const jsx = (type: string, props: any) => ({ type, props })
        return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      }
      if (id === 'react-native') return {
        Platform: { OS: platform }, StyleSheet: { create: (value: any) => value },
        TouchableOpacity: 'TouchableOpacity', Pressable: 'Pressable',
        AppState: { addEventListener: (_event: string, listener: typeof onAppState) => {
          onAppState = listener
          return { remove: () => { removed = true } }
        } },
      }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ lang, colors: {} }) }
      if (id.endsWith('/dateFormat')) return dateFormat
      if (id.endsWith('/useToday')) {
        const hookModule = { exports: {} }
        const hookCode = ts.transpileModule(readFileSync('src/hooks/useToday.ts', 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText
        runInNewContext(hookCode, { ...runtime, module: hookModule, exports: hookModule.exports })
        return hookModule.exports
      }
      if (id.endsWith('/icons')) return { ICONS: {} }
      const component = id.split('/').at(-1)!
      return { [component]: component }
    },
  }
  runInNewContext(code, runtime)
  const render = () => {
    stateIndex = 0
    return module.exports.DateField({ value: '', label: '導入日', ...props })
  }
  render()
  mounted = true
  const cleanups = effects.map((effect) => effect())
  return {
    render,
    field: () => {
      const tree = render()
      return platform === 'web' ? tree.props.children[0] : tree.props.children[0].props.children
    },
    advanceTo: (date: Date, runTimers = true) => {
      now = date.getTime()
      if (runTimers) for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.callback()
        }
      }
    },
    resume: () => onAppState('active'),
    nextDelay: () => [...timers.values()][0].at - now,
    unmount: () => {
      cleanups.forEach((cleanup) => cleanup())
      assert.equal(timers.size, 0)
      assert.equal(removed, true)
    },
  }
}

function webDateField(lang: 'ja' | 'en', props: Record<string, any>) {
  return dateField(lang, props).field()
}

for (const platform of ['web', 'android', 'ios']) {
  test(`${platform}の未入力日付は端末の今日を表示し、年越しとアプリ復帰で更新する`, () => {
    const changes: string[] = []
    const view = dateField('ja', { onChange: (value: string) => changes.push(value) }, platform, new Date(2026, 11, 31, 23, 59))
    assert.equal(view.field().props.placeholder, '2026/12/31')
    assert.equal(view.field().props.value, '')
    view.advanceTo(new Date(2027, 0, 1, 0, 0))
    assert.equal(view.field().props.placeholder, '2027/01/01')
    view.advanceTo(new Date(2027, 0, 2, 9, 0), false)
    view.resume()
    assert.equal(view.field().props.placeholder, '2027/01/02')
    assert.equal(view.field().props.value, '')
    assert.deepEqual(changes, [])
    if (platform === 'android') {
      view.render().props.children[0].props.onPress()
      const picker = view.render().props.children[1]
      assert.equal(dateFormat.formatDate(picker.props.value, 'ja'), '2027/01/02')
    }
    view.unmount()
  })
}

test('夏時間の切り替え日も固定の24時間後ではなく、端末の次の0時で日付を更新する', () => {
  const previousZone = process.env.TZ
  try {
    process.env.TZ = 'America/Los_Angeles'
    for (const [month, day, hours] of [[2, 8, 23], [10, 1, 25]]) {
      const view = dateField('ja', { onChange: () => {} }, 'web', new Date(2026, month, day))
      assert.equal(view.nextDelay(), hours * 60 * 60 * 1000)
      const tomorrow = new Date(2026, month, day + 1)
      view.advanceTo(tomorrow)
      assert.equal(view.field().props.placeholder, dateFormat.formatDate(tomorrow, 'ja'))
      view.unmount()
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ
    else process.env.TZ = previousZone
  }
})

test('英語の今日表示を更新しても入力済みの導入日は変更しない', () => {
  const view = dateField('en', { value: '10/01/2026', onChange: () => assert.fail('表示更新で値を保存しない') }, 'web', new Date(2026, 9, 8, 23, 59))
  assert.equal(view.field().props.placeholder, '10/08/2026')
  view.advanceTo(new Date(2026, 9, 9))
  assert.equal(view.field().props.placeholder, '10/09/2026')
  assert.equal(view.field().props.value, '10/01/2026')
  view.unmount()
})

test('Webの日付欄は入力でき、全角数字を日本語の保存可能な書式に整える', () => {
  let changed = ''
  const field = webDateField('ja', { onChange: (value: string) => { changed = value } })
  assert.equal(field.type, 'TextField')
  assert.notEqual(field.props.editable, false)
  field.props.onChangeText('２０２６０９０１')
  assert.equal(changed, '2026/09/01')
  assert.equal(dateFormat.parseDateInput(changed, 'ja'), '2026-09-01')
})

test('Webの日付入力もピッカーと同じ最小・最大日を守る', () => {
  let changed = ''
  const field = webDateField('ja', {
    onChange: (value: string) => { changed = value },
    minimumDate: new Date(2026, 0, 1), maximumDate: new Date(2026, 9, 3),
  })
  field.props.onChangeText('20261231')
  assert.equal(changed, '2026/10/03')
  field.props.onChangeText('20251231')
  assert.equal(changed, '2026/01/01')
  field.props.onChangeText('20260230')
  assert.equal(dateFormat.parseDateInput(changed, 'ja'), undefined)
})

test('Webの英語日付入力とクリアを確認する', () => {
  let changed = 'original'
  const field = webDateField('en', { value: '09/01/2026', onChange: (value: string) => { changed = value } })
  field.props.onChangeText('09022026')
  assert.equal(changed, '09/02/2026')
  assert.equal(dateFormat.parseDateInput(changed, 'en'), '2026-09-02')
  field.props.onClear()
  assert.equal(changed, '')
})

test('Webの日付選択は選んだだけでは保存せず、取消と範囲付きの確定ができる', () => {
  const changes: string[] = []
  const view = dateField('en', {
    value: '09/01/2026', onChange: (value: string) => changes.push(value),
    minimumDate: new Date(2026, 0, 1), maximumDate: new Date(2026, 9, 3),
  })
  const sheet = () => view.render().props.children[1]
  const calendar = () => view.field().props.trailing
  calendar().props.onPress()
  assert.equal(sheet().props.visible, true)
  let input = sheet().props.children[1]
  assert.equal(input.type, 'input')
  assert.equal(input.props.type, 'date')
  assert.equal(input.props.value, '2026-09-01')
  assert.equal(input.props.min, '2026-01-01')
  assert.equal(input.props.max, '2026-10-03')
  input.props.onChange({ currentTarget: { value: '2026-09-02' } })
  assert.deepEqual(changes, [])
  sheet().props.onDismiss()
  assert.equal(sheet().props.visible, false)
  calendar().props.onPress()
  input = sheet().props.children[1]
  assert.equal(input.props.value, '2026-09-01', '取り消した下書きを次回に持ち越さない')
  input.props.onChange({ currentTarget: { value: '2026-12-31' } })
  sheet().props.children[0].props.children[2].props.onPress()
  assert.deepEqual(changes, ['10/03/2026'])
  assert.equal(sheet().props.visible, false)
  view.unmount()
})

test('Webの幅の狭い日付欄にも選択の入口があり、無効な下書きを確定できない', () => {
  const changes: string[] = []
  const view = dateField('ja', {
    value: '2026/09/01', showCalendarIcon: false, size: 'compact', clearable: false,
    onChange: (value: string) => changes.push(value),
  })
  const sheet = () => view.render().props.children[1]
  const done = () => sheet().props.children[0].props.children[2]
  view.field().props.trailing.props.onPress()
  assert.equal(sheet().props.visible, true)
  for (const value of ['', '2026-02-30']) {
    sheet().props.children[1].props.onChange({ currentTarget: { value } })
    assert.equal(done().props.disabled, true)
    done().props.onPress()
    assert.deepEqual(changes, [])
  }
  sheet().props.children[1].props.onChange({ currentTarget: { value: '2026-09-02' } })
  assert.equal(done().props.disabled, false)
  done().props.onPress()
  assert.deepEqual(changes, ['2026/09/02'])
  view.unmount()
})
