import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Reanimated, { cancelAnimation, makeMutable, ReduceMotion, runOnJS, runOnUI, SharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated'
import { useApp } from '../../context/AppContext'
import { Gadget } from '../../types'
import { moveGadgetId } from '../../utils/gadgetOrder'
import { hapticLight, hapticMedium, hapticSelection } from '../../utils/haptics'

interface Props {
  gadgets: Gadget[]
  enabled: boolean
  scrollGesture: ReturnType<typeof Gesture.Native>
  renderRow: (gadget: Gadget, dragging: boolean) => ReactNode
  onReorder: (ids: string[]) => void
  onDraggingChange: (dragging: boolean) => void
  measureViewport: (callback: (top: number, bottom: number) => void) => void
  scrollBy: (delta: number) => number
}

type Drag = {
  id: string
  ids: string[]
  from: number
  to: number
  startTranslation: number
  translation: number
  scrollDelta: number
  pointerY: number
  top: number
  bottom: number
}

const SETTLE = { damping: 28, stiffness: 340, mass: 0.7, overshootClamping: true, reduceMotion: ReduceMotion.Never }

export function ReorderableGadgetList(props: Props) {
  const { colors: C, reduceMotion } = useApp()
  const propsRef = useRef(props)
  propsRef.current = props
  const layouts = useRef(new Map<string, { y: number; height: number }>())
  const translations = useRef(new Map<string, SharedValue<number>>())
  const drag = useRef<Drag | null>(null)
  // 掴んだ行は指への追従を UI スレッドで行う（ReorderRow の onUpdate）。JS スレッドで値を入れていた頃は、
  // 機材の多いデスクで JS が詰まると行が指から遅れた。JS 側は掴んだ行の id・起点・自動スクロール量だけを渡す
  const dragShared = useMemo(() => ({ id: makeMutable(''), start: makeMutable(0), scroll: makeMutable(0) }), [])
  const frame = useRef<number | null>(null)
  const targets = useRef(new Map<string, number>())
  const settling = useRef(new Set<string>())
  const [activeId, setActiveId] = useState<string | null>(null)

  // includeDragged: 自動スクロールで指が止まっている間は onUpdate が来ないので、掴んだ行もここで動かす
  const update = useCallback((includeDragged = false) => {
    const d = drag.current
    if (!d) return
    const origin = layouts.current.get(d.id)!
    const delta = d.translation - d.startTranslation + d.scrollDelta
    const center = origin.y + origin.height / 2 + delta
    let to = d.from
    d.ids.forEach((id, index) => {
      const row = layouts.current.get(id)
      if (!row || index === d.from) return
      if (index > d.from && center > row.y + row.height / 2) to = Math.max(to, index)
      if (index < d.from && center < row.y + row.height / 2) to = Math.min(to, index)
    })
    if (to !== d.to) hapticSelection()
    d.to = to
    d.ids.forEach((id, index) => {
      if (id === d.id && !includeDragged) return
      const shift = id === d.id ? delta
        : index > d.from && index <= to ? -origin.height
          : index < d.from && index >= to ? origin.height : 0
      const value = translations.current.get(id)
      if (!value) return
      if (id === d.id) value.value = shift
      else if (targets.current.get(id) !== shift) {
        targets.current.set(id, shift)
        value.value = reduceMotion ? shift : withSpring(shift, SETTLE)
      }
    })
  }, [reduceMotion])

  const finish = useCallback((id: string | null, success: boolean) => {
    const d = drag.current
    if (!d || (id !== null && d.id !== id)) return
    drag.current = null
    dragShared.id.value = ''
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    targets.current.clear()
    setActiveId(null)
    propsRef.current.onDraggingChange(false)
    if (success && d.from !== d.to) {
      settling.current = new Set(d.ids.slice(Math.min(d.from, d.to), Math.max(d.from, d.to) + 1))
      propsRef.current.onReorder(moveGadgetId(d.ids, d.from, d.to))
      hapticLight()
    } else {
      translations.current.forEach((value) => { value.value = reduceMotion ? 0 : withSpring(0, SETTLE) })
    }
  }, [dragShared, reduceMotion])

  const start = useCallback((id: string, translation: number, pointerY: number, offset = 0) => {
    const ids = propsRef.current.gadgets.map((g) => g.id)
    if (drag.current || ids.some((item) => !layouts.current.has(item))) {
      // UI スレッド側で先に掴んだことにしているので、受け付けないときはそれを外す
      if (dragShared.id.value === id) dragShared.id.value = ''
      return
    }
    drag.current = { id, ids, from: ids.indexOf(id), to: ids.indexOf(id), startTranslation: translation - offset, translation, scrollDelta: 0, pointerY, top: 0, bottom: 0 }
    setActiveId(id)
    propsRef.current.onDraggingChange(true)
    hapticMedium()
    propsRef.current.measureViewport((top, bottom) => {
      if (drag.current?.id === id) Object.assign(drag.current, { top, bottom })
    })
    let last = 0
    const scroll = (timestamp: number) => {
      const d = drag.current
      if (!d) return
      // 停止していた JS が復帰しても、大きな移動を一度に取り戻さない。
      const elapsed = last === 0 ? 0 : Math.min(32, timestamp - last)
      last = timestamp
      if (d.bottom > d.top) {
        const edge = Math.min(56, (d.bottom - d.top) / 2)
        const top = Math.max(0, Math.min(1, (d.top + edge - d.pointerY) / edge))
        const bottom = Math.max(0, Math.min(1, (d.pointerY - d.bottom + edge) / edge))
        const delta = (bottom * bottom - top * top) * 500 * elapsed / 1000
        if (delta !== 0) {
          d.scrollDelta += propsRef.current.scrollBy(delta)
          dragShared.scroll.value = d.scrollDelta
          update(true)
        }
      }
      frame.current = requestAnimationFrame(scroll)
    }
    frame.current = requestAnimationFrame(scroll)
  }, [update, dragShared])

  const move = useCallback((id: string, translation: number, pointerY: number) => {
    const d = drag.current
    if (d?.id !== id) return
    d.translation = translation
    d.pointerY = pointerY
    update()
  }, [update])

  useEffect(() => {
    if (drag.current && (!props.enabled || drag.current.ids.join(',') !== props.gadgets.map((g) => g.id).join(','))) finish(null, false)
  }, [props.enabled, props.gadgets, finish])

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    translations.current.forEach((value) => cancelAnimation(value))
    if (drag.current) propsRef.current.onDraggingChange(false)
  }, [])

  return <View>
    {props.gadgets.map((gadget) => {
      if (!translations.current.has(gadget.id)) translations.current.set(gadget.id, makeMutable(0))
      const active = activeId === gadget.id
      return <ReorderRow
        key={gadget.id}
        id={gadget.id}
        enabled={props.enabled && props.gadgets.length > 1}
        scrollGesture={props.scrollGesture}
        onStart={start}
        onMove={move}
        onFinish={finish}
        onLayout={(e) => {
          const previous = layouts.current.get(gadget.id)
          const next = e.nativeEvent.layout
          layouts.current.set(gadget.id, next)
          if (previous && previous.y !== next.y && !drag.current && settling.current.delete(gadget.id)) {
            const value = translations.current.get(gadget.id)!
            // 並び順の確定で変わるレイアウト座標を相殺し、見えていた位置から着地する。
            runOnUI((delta: number, reduced: boolean) => {
              'worklet'
              value.value = reduced ? 0 : value.value + delta
              if (!reduced) value.value = withSpring(0, SETTLE)
            })(previous.y - next.y, reduceMotion)
          }
        }}
        translation={translations.current.get(gadget.id)!}
        dragShared={dragShared}
        active={active}
        color={C.accentIcon}
      >{props.renderRow(gadget, activeId !== null)}</ReorderRow>
    })}
  </View>
}

function ReorderRow({ id, enabled, scrollGesture, onStart, onMove, onFinish, onLayout, translation, dragShared, active, color, children }: {
  id: string
  enabled: boolean
  scrollGesture: Props['scrollGesture']
  onStart: (id: string, translation: number, pointerY: number, offset: number) => void
  onMove: (id: string, translation: number, pointerY: number) => void
  onFinish: (id: string | null, success: boolean) => void
  onLayout: (e: LayoutChangeEvent) => void
  translation: SharedValue<number>
  dragShared: { id: SharedValue<string>; start: SharedValue<number>; scroll: SharedValue<number> }
  active: boolean
  color: string
  children: ReactNode
}) {
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(350)
    .maxPointers(1)
    .blocksExternalGesture(scrollGesture)
    .onStart((e) => {
      'worklet'
      // 掴めるのは同時に1行だけ。JS 側（onStart）が受け付けなければ外される
      if (dragShared.id.value === '') {
        dragShared.id.value = id
        cancelAnimation(translation)
        dragShared.start.value = e.translationY - translation.value
        dragShared.scroll.value = 0
      }
      runOnJS(onStart)(id, e.translationY, e.absoluteY, translation.value)
    })
    .onUpdate((e) => {
      'worklet'
      if (dragShared.id.value === id) translation.value = e.translationY - dragShared.start.value + dragShared.scroll.value
      runOnJS(onMove)(id, e.translationY, e.absoluteY)
    })
    .onFinalize((_e, success) => {
      'worklet'
      runOnJS(onFinish)(id, success)
    }), [enabled, id, onStart, onMove, onFinish, scrollGesture, translation, dragShared])
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translation.value }] }))

  return <GestureDetector gesture={gesture}>
    <Reanimated.View onLayout={onLayout} style={[{ zIndex: active ? 10 : 0 }, animatedStyle]}>
      {children}
      {active && <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderWidth: 2, borderColor: color }]} />}
    </Reanimated.View>
  </GestureDetector>
}
