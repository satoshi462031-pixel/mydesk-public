import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function motion() {
  let cursor = 0
  const slots: any[] = []
  let effect: (() => void | (() => void)) | undefined
  let cleanup: void | (() => void)
  let previous: unknown[] | undefined
  let reduced = false
  const animations: { done?: (result: { finished: boolean }) => void; stopped: boolean }[] = []
  const react = {
    useRef: (current: unknown) => slots[cursor++] ??= { current },
    useEffect: (next: typeof effect, deps: unknown[]) => {
      if (!previous || deps.some((value, i) => value !== previous![i])) { effect = next; previous = deps }
    },
  }
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value }
  }
  const jsx = (type: unknown, props: any) => ({ type, props })
  const module = { exports: {} as any }
  const source = ts.transpileModule(readFileSync('src/components/molecules/AdditionMotion.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(source, { module, exports: module.exports, require: (id: string) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (id === 'react-native') return {
      Easing: { out: () => {}, cubic: {} },
      Animated: {
        Value, View: 'AnimatedView', timing: () => {
          const animation: typeof animations[number] = { stopped: false }
          animations.push(animation)
          return {
            start: (done: typeof animation.done) => { animation.done = done },
            stop: () => { animation.stopped = true; animation.done?.({ finished: false }) },
          }
        },
      },
    }
    if (id === 'react-native-reanimated') return { default: { View: 'LayoutView' }, LinearTransition: { duration: () => ({}) } }
    return { useApp: () => ({ reduceMotion: reduced }) }
  } })
  return {
    paint: (props: Record<string, unknown>) => {
      cursor = 0
      const tree = module.exports.AdditionMotion(props)
      if (effect) { cleanup?.(); const next = effect; effect = undefined; cleanup = next() }
      return tree
    },
    animations,
    reduce: () => { reduced = true },
    unmount: () => cleanup?.(),
  }
}

test('既存の行は初回表示や再描画でフェードさせず、新しい行だけを表示する', () => {
  const old = motion()
  const props = { added: false, onEntered: () => assert.fail('Existing row must not enter') }
  assert.equal(old.paint(props).props.children.props.style[1].opacity.value, 1)
  old.paint(props)
  assert.equal(old.animations.length, 0)
  const added = motion()
  let entered = 0
  const next = { added: true, onEntered: () => { entered++ } }
  assert.equal(added.paint(next).props.children.props.style[1].opacity.value, 0)
  added.paint(next)
  assert.equal(added.animations.length, 1)
  added.animations[0].done!({ finished: true })
  assert.equal(entered, 1)
})

test('詳細設定やプレビューの背後では消費せず、見える画面へ戻ってから追加を示す', () => {
  const h = motion()
  let entered = 0
  const props = { added: true, active: false, onEntered: () => { entered++ } }
  assert.equal(h.paint(props).props.children.props.style[1].opacity.value, 1)
  assert.equal(h.animations.length, 0)
  h.paint({ ...props, active: true })
  assert.equal(h.animations.length, 1)
  h.paint(props)
  assert.equal(h.animations[0].stopped, true)
  assert.equal(entered, 0)
  h.paint({ ...props, active: true })
  h.animations[1].done!({ finished: true })
  assert.equal(entered, 1)
})

test('動きを減らす設定では追加項目をすぐ表示し、削除中の詰め直しには干渉しない', () => {
  const h = motion()
  h.reduce()
  let entered = 0
  const tree = h.paint({ added: true, onEntered: () => { entered++ } })
  assert.equal(tree.props.children.props.style[1].opacity.value, 1)
  assert.equal(tree.props.layout, undefined)
  assert.equal(h.animations.length, 0)
  assert.equal(entered, 1)
  const normal = motion()
  assert.equal(normal.paint({ added: true, reflow: false, onEntered: () => {} }).props.layout, undefined)
})

test('退場・画面離脱で中断した追加表示は完了扱いにしない', () => {
  const h = motion()
  let entered = 0
  h.paint({ added: true, onEntered: () => { entered++ } })
  h.unmount()
  assert.equal(h.animations[0].stopped, true)
  assert.equal(entered, 0)
})

test('配線の追加は新しい線と常設へ変えた線だけを対象にし、本数変更やWi-Fiは対象外にする', () => {
  const file = 'src/components/organisms/ConnectionMap.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'markAddedConnections') found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found)
  const pending = new Set<string>()
  const changed: string[] = []
  const mark = runInNewContext(ts.transpileModule(`(${found.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    connections: [{ id: 'old', cableType: 'USB-A' }, { id: 'charging', cableType: 'USB-C', chargingOnly: true }],
    addedConnectionIds: { current: pending }, reduceMotion: false,
    connectionOpacity: (id: string) => ({ setValue: () => { changed.push(id) } }),
  })
  mark([{ id: 'old', cableType: 'USB-A', count: 2 }, { id: 'new', cableType: 'HDMI' },
    { id: 'charging', cableType: 'USB-C', chargingOnly: false }, { id: 'wifi', cableType: 'WiFi' }])
  assert.deepEqual([...pending], ['new', 'charging'])
  assert.deepEqual(changed, ['new', 'charging'])
})
