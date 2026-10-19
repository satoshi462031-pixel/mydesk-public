import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { CONTROL_TEST_SEEDS, seededRandom } from './helpers/seededRandom'

// フックを素の関数として何度も呼べるよう、React の最小限だけを差し替えて読み込む
function harness(animated = true) {
  const slots: any[] = []
  let cursor = 0
  const effects: (() => void)[] = []
  let focused = true
  const react = {
    useRef: (current: unknown) => { const i = cursor++; return slots[i] ??= { current } },
    useMemo: (create: () => unknown, deps: unknown[]) => {
      const i = cursor++
      if (!slots[i] || deps.some((d, k) => !Object.is(d, slots[i].deps[k]))) slots[i] = { value: create(), deps }
      return slots[i].value
    },
    useCallback: (fn: unknown, deps: unknown[]) => react.useMemo(() => fn, deps),
    useEffect: (run: () => unknown, deps: unknown[]) => {
      const i = cursor++
      const prev = slots[i]
      if (prev && deps.every((d, k) => Object.is(d, prev.deps[k]))) return
      slots[i] = { deps }
      effects.push(() => { prev?.cleanup?.(); slots[i].cleanup = run() })
    },
  }
  const reactModule = { ...react, useLayoutEffect: react.useEffect }
  const exports: any = {}
  const code = ts.transpileModule(readFileSync('src/hooks/useScrollSyncRetry.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, { exports, require: (id: string) => id === 'react' ? reactModule
    : id === '@react-navigation/native' ? { useIsFocused: () => focused } : {} })

  const listeners = new Map<number, (event: { value: number }) => void>()
  let nextId = 0
  const scrollY = {
    addListener: (fn: (event: { value: number }) => void) => { listeners.set(++nextId, fn); return nextId },
    removeListener: (id: number) => { listeners.delete(id) },
    emit: (value: number) => listeners.forEach(fn => fn({ value })),
    setValue: (value: number) => listeners.forEach(fn => fn({ value })),
  }
  const scrolled: number[] = []
  const render = (active: boolean, request?: { id: number; offset: number }) => {
    cursor = 0
    const result = exports.useScrollSyncRetry(request, active, (offset: number) => { scrolled.push(offset) }, animated ? scrollY : undefined)
    effects.splice(0).forEach(run => run())
    return result
  }
  return { render, scrollY, scrolled, focus: (value: boolean) => { focused = value } }
}

test('スクロールの勢いが残ったままタブを替えても、隠れる一覧を隠れた時点の位置で止める', () => {
  const h = harness()
  h.render(true)
  h.scrollY.emit(120)
  h.scrollY.emit(180)
  h.render(false)
  assert.deepEqual(h.scrolled, [180])
  // 隠れたあとに流れた分は覚えない（行き先の位置合わせは押した瞬間の値で決めてある）
  h.scrollY.emit(260)
  h.render(true)
  h.render(false)
  assert.ok(h.scrolled.every(y => y === 180))
})

test('慣性中に詳細へ移るとその位置で止まり、戻っても古い位置合わせへ巻き戻さない', () => {
  const h = harness()
  const request = { id: 1, offset: 40 }
  const first = h.render(true, request)
  first.handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
  first.handlers.onContentSizeChange(390, 2000)
  first.handlers.onScrollBeginDrag()
  h.scrollY.emit(480)
  h.focus(false)
  h.render(true, request)
  assert.equal(h.scrolled.at(-1), 480)
  h.scrollY.emit(700)
  h.focus(true)
  h.render(true, request)
  assert.equal(h.scrolled.at(-1), 480)
})

test('位置合わせを消費した後の手動スクロールは、タブの往復で古い要求を再適用しない', () => {
  const h = harness()
  const request = { id: 1, offset: 180 }
  const list = h.render(true, request)
  list.handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
  list.handlers.onContentSizeChange(390, 2000)
  list.handlers.onScrollBeginDrag()
  h.scrollY.emit(650)
  h.render(false, request)
  h.render(true, request)
  assert.equal(h.scrolled.at(-1), 650)
  const next = { id: 2, offset: 60 }
  h.render(true, next)
  assert.equal(h.scrolled.at(-1), 60)
})

test('Animated値を使わない一覧もスクロール位置を記録し、別画面への移動で慣性を止める', () => {
  const h = harness(false)
  const list = h.render(true)
  list.handlers.onScroll({ nativeEvent: { contentOffset: { y: 320 } } })
  h.focus(false)
  h.render(true)
  assert.equal(h.scrolled.at(-1), 320)
  list.handlers.onScroll({ nativeEvent: { contentOffset: { y: 500 } } })
  h.focus(true)
  h.render(true)
  assert.equal(h.scrolled.at(-1), 320)
})

test('一度も位置が届いていない一覧や、出たままの一覧は動かさない', () => {
  const h = harness()
  h.render(false)
  h.render(true)
  h.render(true)
  assert.deepEqual(h.scrolled, [])
  h.render(false)
  assert.deepEqual(h.scrolled, [])
})

test('指を置いた直後と慣性終了直後は、間引かれたonScrollより最新の操作位置を保存する', () => {
  for (const name of ['onScrollBeginDrag', 'onScrollEndDrag', 'onMomentumScrollEnd']) {
    const h = harness(false)
    const list = h.render(true)
    list.handlers.onScroll({ nativeEvent: { contentOffset: { y: 120 } } })
    list.handlers[name]({ nativeEvent: { contentOffset: { y: 145 } } })
    h.focus(false)
    h.render(true)
    assert.equal(h.scrolled.at(-1), 145, name)
  }
})

test('読み込みで一覧が縮んでから戻っても、届く高さまで復元し、手動操作後は当て直さない', () => {
  const h = harness(false)
  let list = h.render(true)
  const layout = { nativeEvent: { layout: { height: 600 } } }
  list.handlers.onLayout(layout)
  list.handlers.onContentSizeChange(390, 1800)
  list.handlers.onScroll({ nativeEvent: { contentOffset: { y: 720 } } })
  h.focus(false); list = h.render(true)
  list.rearm(720)
  list.handlers.onContentSizeChange(390, 700)
  h.focus(true); list = h.render(true)
  assert.equal(h.scrolled.at(-1), 720)
  list.handlers.onContentSizeChange(390, 1900)
  assert.equal(h.scrolled.at(-1), 720)
  list.handlers.onScrollBeginDrag({ nativeEvent: { contentOffset: { y: 680 } } })
  const before = h.scrolled.length
  list.handlers.onContentSizeChange(390, 2100)
  assert.equal(h.scrolled.length, before)
})

test('スクロール・画面移動・戻る・位置合わせをランダムに混ぜても、非表示中の慣性を引き継がない', () => {
  for (const seed of CONTROL_TEST_SEEDS) for (const animated of [true, false]) {
    const random = seededRandom(seed)
    const h = harness(animated)
    let request = { id: 1, offset: 0 }
    let list = h.render(true, request)
    list.handlers.onLayout({ nativeEvent: { layout: { height: 600 } } })
    list.handlers.onContentSizeChange(390, 3000)
    for (let i = 0; i < 300; i++) {
      let position = random(2000)
      list.handlers.onScrollBeginDrag({ nativeEvent: { contentOffset: { y: position } } })
      if (animated) h.scrollY.emit(position)
      else list.handlers.onScroll({ nativeEvent: { contentOffset: { y: position } } })
      h.focus(false); list = h.render(true, request)
      assert.equal(h.scrolled.at(-1), position)
      for (let n = random(5); n > 0; n--) {
        if (animated) h.scrollY.emit(random(2000))
        else list.handlers.onScroll({ nativeEvent: { contentOffset: { y: random(2000) } } })
      }
      if (random(4) === 0) { position = random(1500); request = { id: request.id + 1, offset: position } }
      h.focus(true); list = h.render(true, request)
      assert.equal(h.scrolled.at(-1), position)
    }
  }
})
