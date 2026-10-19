import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { immediateRemoval } from './helpers/removalMotion'

const source = ts.transpileModule(readFileSync('src/components/organisms/PasskeySettingsSheet.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

function sheet(os: string) {
  let cursor = 0
  let closed = 0
  let visible = true
  let registrations = 0
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const slots: any[] = []
  const effects: (() => void)[] = []
  const react = {
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef: (initial: unknown) => { const index = cursor++; return slots[index] ??= { current: initial } },
    useCallback: (callback: unknown) => callback,
    useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) => {
      const index = cursor++
      const previous = slots[index]
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() } })
      }
    },
  }
  const jsx = (type: unknown, props: any) => ({ type, props })
  const module = { exports: {} as any }
  runInNewContext(source, { module, exports: module.exports, require: (id: string) => {
    if (id === 'react') return react
    if (id.endsWith('/RemovalMotion')) return { useRemovalMotion: () => immediateRemoval, RemovalMotion: 'RemovalMotion' }
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (id === 'react-native') return {
      Platform: { OS: os }, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }, Alert: {},
      ...Object.fromEntries(['ActivityIndicator', 'Modal', 'SafeAreaView', 'ScrollView', 'Text', 'TouchableOpacity', 'View'].map(name => [name, name])),
    }
    if (id.endsWith('/AppContext')) return { useApp: () => ({ colors: {}, lang: 'ja' }) }
    if (id.endsWith('/ui')) return { UI_METRICS: {} }
    if (id.endsWith('/passkeyService')) return { listPasskeys: async () => [], registerPasskey: async () => { registrations++; await pending } }
    if (id.endsWith('/passkeyErrors')) return { isPasskeyCancelled: () => false, passkeyErrorMessage: () => 'error' }
    return { [id.split('/').pop()!]: id.split('/').pop() }
  } })
  return {
    paint: () => { cursor = 0; const tree = module.exports.PasskeySettingsSheet({ visible, userId: 'me', onClose: () => { closed++ } }); effects.splice(0).forEach(effect => effect()); return tree },
    hide: () => { visible = false }, show: () => { visible = true }, finish,
    closed: () => closed, registrations: () => registrations,
  }
}

function find(tree: any, type: string): any {
  if (Array.isArray(tree)) return tree.map(node => find(node, type)).find(Boolean)
  if (!tree?.props) return undefined
  return tree.type === type ? tree : find(tree.props.children, type)
}

for (const os of ['ios', 'android']) {
  test(`${os}: 認証開始直後も閉じる操作を止め、完了後は閉じられる`, async () => {
    const h = sheet(os)
    h.paint(); await flush()
    const tree = h.paint()
    const pending = find(tree, 'Button').props.onPress()
    find(tree, 'Modal').props.onRequestClose()
    find(tree, 'HeaderIconButton').props.onPress()
    assert.equal(h.closed(), 0)
    assert.equal(h.registrations(), 1)
    h.finish(); await pending
    find(h.paint(), 'Modal').props.onRequestClose()
    assert.equal(h.closed(), 1)
  })

  test(`${os}: 非表示中に認証が完了しても再表示時に操作不能にならない`, async () => {
    const h = sheet(os)
    h.paint(); await flush()
    const pending = find(h.paint(), 'Button').props.onPress()
    h.hide(); h.paint()
    h.finish(); await pending
    h.show(); h.paint(); await flush()
    assert.equal(find(h.paint(), 'Button').props.disabled, false)
  })
}
