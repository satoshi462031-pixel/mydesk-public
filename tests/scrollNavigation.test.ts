import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function scrollToTop() {
  let focused = true
  let pressed: (event: { defaultPrevented: boolean }) => void = () => {}
  const frames: (() => void)[] = []
  const calls: string[] = []
  let target: any = { scrollToOffset: () => { calls.push('first') } }
  const route = { key: 'list' }
  const navigation = {
    isFocused: () => focused,
    getState: () => ({ type: 'tab', routes: [route] }),
    getParent: () => undefined,
    addListener: (_type: string, fn: typeof pressed) => { pressed = fn; return () => {} },
  }
  const react = {
    useRef: (current: unknown) => ({ current }), useMemo: (create: () => unknown) => create(),
    useEffect: (effect: () => unknown) => effect(), useContext: () => navigation,
  }
  const load = (file: string, require: (name: string) => unknown) => {
    const module = { exports: {} as any }
    runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { module, exports: module.exports, require, requestAnimationFrame: (fn: () => void) => { frames.push(fn) } })
    return module.exports
  }
  const native = load('node_modules/@react-navigation/native/src/useScrollToTop.tsx', name => name === 'react'
    ? react : { NavigationContext: {}, useRoute: () => route })
  const wrapper = load('src/hooks/useScrollToTopOf.ts', name => name === 'react' ? react
    : { useScrollToTop: native.default, useNavigation: () => navigation })
  wrapper.useScrollToTopOf(() => target)
  return { calls, press: (prevented = false) => pressed({ defaultPrevented: prevented }),
    focus: (next: boolean) => { focused = next }, flush: () => frames.splice(0).forEach(fn => fn()),
    changeTarget: () => { target = { scrollToOffset: () => { calls.push('second') } } } }
}

test('先頭へ戻る予約の直後に別画面を開いても、非表示の一覧を先頭へ動かさない', () => {
  const h = scrollToTop()
  h.press()
  h.focus(false)
  h.flush()
  assert.deepEqual(h.calls, [])
  h.focus(true)
  h.flush()
  assert.deepEqual(h.calls, [])
  h.press(); h.flush()
  assert.deepEqual(h.calls, ['first'])
})

test('先頭へ戻る実行時に現在の一覧を選び、キャンセルされたタブ操作では動かさない', () => {
  const h = scrollToTop()
  h.press()
  h.changeTarget()
  h.flush()
  assert.deepEqual(h.calls, ['second'])
  h.press(true); h.flush()
  assert.deepEqual(h.calls, ['second'])
})
