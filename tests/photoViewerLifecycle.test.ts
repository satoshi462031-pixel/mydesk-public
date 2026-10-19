import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Element = { type: string; key?: string; props: Record<string, any> }

// ネイティブの描画だけを差し替え、実際のコンポーネントのフックとジェスチャーを実行する。
function mountSource(file: string, name: string) {
  let reduceMotion = false
  const timings: { value: number; duration?: number }[] = []
  const insets = { top: 59, bottom: 34, left: 0, right: 0 }
  const values: any[] = []
  const dependencies: Array<unknown[] | undefined> = []
  const effects = new Map<number, () => void>()
  const gestures: Array<Record<string, any>> = []
  let cursor = 0
  let dirty = false
  const useState = (initial: any) => {
    const slot = cursor++
    if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial
    return [values[slot], (next: any) => {
      const result = typeof next === 'function' ? next(values[slot]) : next
      if (!Object.is(result, values[slot])) { values[slot] = result; dirty = true }
    }]
  }
  const react = {
    useState,
    useRef: (initial: any) => useState(() => ({ current: initial }))[0],
    useMemo: (factory: () => any) => factory(),
    useCallback: (callback: any) => callback,
    useEffect: (effect: () => void, deps: unknown[]) => {
      const slot = cursor++
      if (!dependencies[slot] || deps.some((dep, i) => !Object.is(dep, dependencies[slot]?.[i]))) {
        effects.set(slot, effect)
        dependencies[slot] = deps
      }
    },
  }
  const makeGesture = (kind: string) => {
    const callbacks: Record<string, any> = { kind }
    const gesture = new Proxy({}, { get: (_target, key: string) => (...args: any[]) => {
      callbacks[key] = args[0]
      return gesture
    } })
    gestures.push(callbacks)
    return gesture
  }
  const reanimated = {
    default: { View: 'AnimatedView', Image: 'AnimatedImage' },
    useSharedValue: (value: number | boolean) => useState(() => ({ value }))[0],
    useAnimatedStyle: (factory: () => any) => factory(),
    runOnJS: (fn: any) => fn,
    withTiming: (value: number, config?: { duration?: number }) => { timings.push({ value, duration: config?.duration }); return value },
    cancelAnimation: () => {},
    __esModule: true,
  }
  const module = { exports: {} as Record<string, (props: any) => Element> }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') {
        const jsx = (type: string, props: any, key?: string) => ({ type, props, key })
        return { jsx, jsxs: jsx }
      }
      if (id === 'react-native') return {
        Modal: 'Modal', View: 'View', ScrollView: 'ScrollView', Text: 'Text',
        TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator',
        StyleSheet: { create: (styles: any) => styles },
        Image: { getSize: () => {} }, useWindowDimensions: () => ({ width: 390, height: 844 }),
      }
      if (id === 'react-native-reanimated') return reanimated
      if (id.endsWith('/AppContext')) return { useApp: () => ({ reduceMotion }) }
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => insets }
      if (id === 'react-native-gesture-handler') return {
        GestureDetector: 'GestureDetector',
        Gesture: {
          Pan: () => makeGesture('pan'), Pinch: () => makeGesture('pinch'),
          Tap: () => makeGesture('tap'), Simultaneous: (...items: any[]) => items,
        },
      }
      if (id.endsWith('/icons')) return { ICONS: { close: 'close' } }
      if (id.endsWith('/photoCarousel')) return { clampPhotoIndex: (index: number) => index }
      const component = id.split('/').at(-1)!
      return { [component]: component }
    },
  })
  return {
    insets,
    gestures,
    timings,
    reduceMotion: (value: boolean) => { reduceMotion = value },
    render(props: any) {
      let element: Element
      for (let pass = 0; pass < 20; pass++) {
        cursor = 0
        dirty = false
        gestures.length = 0
        element = module.exports[name](props)
        if (dirty) continue
        const pending = [...effects.values()]
        effects.clear()
        pending.forEach(effect => effect())
        if (!dirty) return element
      }
      throw new Error('Render did not settle')
    },
  }
}

function child(element: Element, type: string): Element {
  if (element?.type === type) return element
  const children = [element?.props?.children].flat(Infinity).filter(Boolean)
  for (const value of children) {
    try { return child(value, type) } catch { /* 次の子を確認する */ }
  }
  throw new Error(`Missing ${type}`)
}

test('下へ引いた位置と拡大状態は閉じるフェード中に戻さず、再表示で初期化する', () => {
  const viewer = mountSource('src/components/organisms/DeskPhotoPreviewModal.tsx', 'DeskPhotoPreviewModal')
  const props = { items: [{ key: 'photo', uri: 'photo.jpg' }], openIndex: 0, visibleIndex: 0, onVisibleIndex: () => {}, onClose: () => {}, lang: 'ja' }
  const first = child(viewer.render(props)!, 'PinchZoomImage')
  first.props.dismissY.value = 140
  first.props.onZoomChange(true)
  const closingTree = viewer.render({ ...props, openIndex: null })!
  const closing = child(closingTree, 'PinchZoomImage')
  assert.equal(closing.props.dismissY.value, 140)
  assert.equal(closing.props.active, true)
  assert.equal(closing.key, first.key)
  assert.equal(child(closingTree, 'ScrollView').props.scrollEnabled, false)
  const reopenedTree = viewer.render(props)!
  const reopened = child(reopenedTree, 'PinchZoomImage')
  assert.equal(reopened.props.dismissY.value, 0)
  assert.notEqual(reopened.key, first.key)
  assert.equal(child(reopenedTree, 'ScrollView').props.scrollEnabled, true)
})

test('単一写真もフェード中に外さず、同じURIの再表示でも拡大状態を持ち越さない', () => {
  const viewer = mountSource('src/components/organisms/PhotoViewerModal.tsx', 'PhotoViewerModal')
  const props = { uri: 'avatar.jpg', lang: 'ja', onClose: () => {} }
  const first = child(viewer.render(props)!, 'PinchZoomImage')
  const closing = child(viewer.render({ ...props, uri: null })!, 'PinchZoomImage')
  assert.equal(closing.props.uri, props.uri)
  assert.equal(closing.key, first.key)
  const reopened = child(viewer.render(props)!, 'PinchZoomImage')
  assert.notEqual(reopened.key, first.key)
})

function swipeFixture() {
  const image = mountSource('src/components/atoms/PinchZoomImage.tsx', 'PinchZoomImage')
  const dismissY = { value: 0 }
  let closes = 0
  image.render({ uri: 'photo.jpg', width: 390, height: 844, active: true, dismissY, onPress: () => closes++ })
  const swipe = image.gestures.find(gesture => gesture.activeOffsetY === 12)!
  swipe.onBegin()
  swipe.onChange({ changeY: 140 })
  return { image, swipe, dismissY, closes: () => closes }
}

test('動きを減らしても写真のダブルタップ拡大とピンチは使え、補間だけを省く', () => {
  for (const reduced of [false, true]) {
    const image = mountSource('src/components/atoms/PinchZoomImage.tsx', 'PinchZoomImage')
    image.reduceMotion(reduced)
    const zooms: boolean[] = []
    const props = { uri: 'photo.jpg', width: 390, height: 844, active: true, onZoomChange: (zoomed: boolean) => zooms.push(zoomed) }
    image.render(props)
    const tap = image.gestures.find(gesture => gesture.numberOfTaps === 2)!
    tap.onEnd({ x: 120, y: 200 }, true)
    assert.deepEqual(image.timings.map(timing => timing.duration), [reduced ? 0 : 300, reduced ? 0 : 300, reduced ? 0 : 300])
    assert.equal(image.timings[0].value, 2.5)
    assert.equal(zooms.at(-1), true)
    tap.onEnd({ x: 120, y: 200 }, true)
    assert.equal(image.timings[3].value, 1)
    assert.equal(zooms.at(-1), false)
    const pinch = image.gestures.find(gesture => gesture.kind === 'pinch')!
    const before = image.timings.length
    pinch.onStart()
    pinch.onUpdate({ numberOfPointers: 2, scale: 1, focalX: 195, focalY: 422 })
    pinch.onUpdate({ numberOfPointers: 2, scale: 2, focalX: 195, focalY: 422 })
    assert.equal(image.timings.length, before, '指に直接追従する操作には補間を挟まない')
    assert.equal(zooms.at(-1), true)
  }
})

test('成立した下スワイプは最終処理でも位置を保持する', () => {
  const fixture = swipeFixture()
  fixture.swipe.onEnd({ translationY: 140, velocityY: 0 }, true)
  fixture.swipe.onFinalize()
  assert.equal(fixture.closes(), 1)
  assert.equal(fixture.dismissY.value, 140)
})

test('キャンセルや引き量不足では閉じず、写真を戻す', () => {
  for (const mode of ['cancel', 'failed', 'short']) {
    const fixture = swipeFixture()
    if (mode !== 'cancel') fixture.swipe.onEnd({ translationY: mode === 'short' ? 20 : 140, velocityY: 0 }, mode === 'short')
    fixture.swipe.onFinalize()
    assert.equal(fixture.closes(), 0)
    assert.equal(fixture.dismissY.value, 0)
  }
})

test('途中でピンチへ移った操作を下スワイプで閉じる操作にしない', () => {
  const fixture = swipeFixture()
  fixture.image.gestures.find(gesture => gesture.kind === 'pinch')!.onStart()
  fixture.swipe.onEnd({ translationY: 140, velocityY: 1000 }, true)
  fixture.swipe.onFinalize()
  assert.equal(fixture.swipe.maxPointers, 1)
  assert.equal(fixture.closes(), 0)
  assert.equal(fixture.dismissY.value, 0)
})

test('写真の読み込み失敗から再試行でき、前のリクエストの完了通知は現在の表示に影響しない', () => {
  const image = mountSource('src/components/atoms/PinchZoomImage.tsx', 'PinchZoomImage')
  const props = { uri: 'first.jpg', width: 390, height: 844, active: true, lang: 'ja' }
  const loading = image.render(props)
  assert.equal(child(loading, 'ActivityIndicator').props.accessibilityLabel, '写真を読み込み中')
  const first = child(loading, 'AnimatedImage')
  first.props.onError()
  const failed = image.render(props)
  assert.equal(child(failed, 'Text').props.children, '写真を読み込めませんでした')
  const retry = child(failed, 'TouchableOpacity')
  assert.equal(retry.props.accessibilityLabel, '写真を再読み込み')
  retry.props.onPress()
  const retrying = image.render(props)
  const second = child(retrying, 'AnimatedImage')
  assert.notEqual(second.key, first.key)
  first.props.onLoad()
  first.props.onError()
  assert.ok(child(image.render(props), 'ActivityIndicator'))
  second.props.onLoad()
  assert.throws(() => child(image.render(props), 'ActivityIndicator'), /Missing/)
  const nextProps = { ...props, uri: 'second.jpg', lang: 'en' }
  image.render(nextProps)
  second.props.onError()
  const next = image.render(nextProps)
  assert.equal(child(next, 'ActivityIndicator').props.accessibilityLabel, 'Loading photo')
  child(next, 'AnimatedImage').props.onError()
  assert.equal(child(image.render(nextProps), 'TouchableOpacity').props.accessibilityLabel, 'Reload photo')
  image.render(props)
  second.props.onLoad()
  assert.ok(child(image.render(props), 'ActivityIndicator'))
})

test('全画面表示の写真枚数には案内カードを含めず、閉じるボタンは画面端の余白に追随する', () => {
  const viewer = mountSource('src/components/organisms/DeskPhotoPreviewModal.tsx', 'DeskPhotoPreviewModal')
  const props = {
    items: [{ key: 'first', uri: 'first.jpg' }, { key: 'second', uri: 'second.jpg' }, { key: 'limit', content: 'limit' }],
    openIndex: 0, visibleIndex: 1, onVisibleIndex: () => {}, onClose: () => {}, lang: 'ja',
  }
  const tree = viewer.render(props)
  assert.equal(child(tree, 'Text').props.accessibilityLabel, '2枚中2枚目')
  viewer.insets.top = 0
  viewer.insets.right = 44
  const landscape = viewer.render(props)
  const close = child(landscape, 'IconCircleButton')
  const findParent = (element: Element): Element | undefined => {
    if ([element?.props?.children].flat(Infinity).includes(close)) return element
    for (const value of [element?.props?.children].flat(Infinity).filter(Boolean)) {
      const result = findParent(value)
      if (result) return result
    }
  }
  const style = Object.assign({}, ...findParent(landscape)!.props.style)
  assert.ok(style.top >= viewer.insets.top)
  assert.ok(style.right >= viewer.insets.right)
  assert.ok(close.props.diameter >= 44)
  assert.throws(() => child(viewer.render({ ...props, visibleIndex: 2 }), 'Text'), /Missing/)
})
