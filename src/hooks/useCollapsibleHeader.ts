// 写真・名前・概要の収納を、公開デスクと自分のデスクで共用する。
// 収納量を一覧のスクロールと二重に加算しないため、中身に listContentStyle を渡す。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import type { LayoutChangeEvent } from 'react-native'
import { useApp } from '../context/AppContext'
import { Gesture } from 'react-native-gesture-handler'
import Reanimated, {
  cancelAnimation,
  Easing,
  runOnJS,
  scrollTo,
  SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated'
import {
  clampHeaderOffset,
  CollapsibleTab,
  headerOffsetAfterLayout,
  headerOffsetForScroll,
  headerOffsetOnTabChange,
  headerParallaxOffset,
  maxScrollOffset,
  planScrollRestore,
  scrollOffsetAfterHeaderChange,
} from '../utils/collapsibleHeader'

const DOUBLE_TAP_MS = 320
const COLLAPSE_TIMING = { duration: 320, easing: Easing.bezier(0.42, 0, 0.35, 1) }
const EXPAND_TIMING = { duration: 220 }
const HEADER_CLIP_STYLE = { overflow: 'hidden' as const }
const LIST_NONE = 0
const LIST_GADGETS = 1
const LIST_INFO = 2

interface Options {
  tab: CollapsibleTab
  editing?: boolean
  initialWiringPhotoExpanded?: boolean
}

export function useCollapsibleHeader({ tab, editing = false, initialWiringPhotoExpanded = false }: Options) {
  const { reduceMotion } = useApp()
  const focused = useIsFocused()
  const focusedSV = useSharedValue(focused)
  const headerY = useSharedValue(0)
  const headerTargetY = useSharedValue(0)
  const [collapseH, setCollapseH] = useState(0)
  const collapseHRef = useRef(0)
  const collapseHSV = useSharedValue(0)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const editingSV = useSharedValue(editing)
  useEffect(() => { editingSV.value = editing }, [editing, editingSV])
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const [headerSettledOpen, setHeaderSettledOpen] = useState(true)
  useAnimatedReaction(() => ({
    collapsed: collapseHSV.value > 0 && headerY.value >= collapseHSV.value,
    open: headerY.value === 0,
  }), (next, previous) => {
    if (next.collapsed !== previous?.collapsed) runOnJS(setHeaderCollapsed)(next.collapsed)
    if (next.open !== previous?.open) runOnJS(setHeaderSettledOpen)(next.open)
  }, [])

  const [wiringPhotoExpanded, setWiringPhotoExpanded] = useState(initialWiringPhotoExpanded)
  const wiringPhotoExpandedRef = useRef(wiringPhotoExpanded)
  wiringPhotoExpandedRef.current = wiringPhotoExpanded
  const lastHeaderTapRef = useRef(0)
  const editingRestoreRef = useRef<{ tab: CollapsibleTab; progress: number } | null>(null)
  const gadgetScrollRef = useAnimatedRef<Reanimated.ScrollView>()
  const infoScrollRef = useAnimatedRef<Reanimated.ScrollView>()
  const gadgetScrollY = useSharedValue(0)
  const infoScrollY = useSharedValue(0)
  const gadgetHeaderY = useSharedValue(0)
  const infoHeaderY = useSharedValue(0)
  const gadgetMaxScrollSV = useSharedValue(0)
  const infoMaxScrollSV = useSharedValue(0)
  const activeListSV = useSharedValue(tab === 'gadgets' ? LIST_GADGETS : tab === 'info' ? LIST_INFO : LIST_NONE)
  const holdHeaderSV = useSharedValue(false)
  const headerScrollBias = useSharedValue(0)
  const manualListBase = useSharedValue(0)
  const headerFlingY = useSharedValue(0)
  const headerDraggingSV = useSharedValue(false)
  const headerFlingingSV = useSharedValue(false)
  const gadgetBoxRef = useRef({ content: 0, viewport: 0 })
  const infoBoxRef = useRef({ content: 0, viewport: 0 })
  const pendingGadgetRestoreRef = useRef<number | null>(null)
  const pendingInfoRestoreRef = useRef<number | null>(null)
  const [listViewportH, setListViewportH] = useState(0)
  const noteListViewport = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height)
    if (h > 0) setListViewportH((prev) => prev === h ? prev : h)
  }, [])

  const restoreGadgetScroll = useCallback(() => {
    const target = pendingGadgetRestoreRef.current
    if (target === null) return
    const plan = planScrollRestore(target, gadgetBoxRef.current.content, gadgetBoxRef.current.viewport)
    if (!plan) return
    gadgetScrollRef.current?.scrollTo({ y: plan.y, animated: false })
    if (plan.done) pendingGadgetRestoreRef.current = null
  }, [gadgetScrollRef])
  const restoreInfoScroll = useCallback(() => {
    const target = pendingInfoRestoreRef.current
    if (target === null) return
    const plan = planScrollRestore(target, infoBoxRef.current.content, infoBoxRef.current.viewport)
    if (!plan) return
    infoScrollRef.current?.scrollTo({ y: plan.y, animated: false })
    if (plan.done) pendingInfoRestoreRef.current = null
  }, [infoScrollRef])
  const cancelScrollRestore = useCallback(() => {
    pendingGadgetRestoreRef.current = null
    pendingInfoRestoreRef.current = null
  }, [])
  const onGadgetLayout = useCallback((e: LayoutChangeEvent) => {
    const box = gadgetBoxRef.current
    box.viewport = e.nativeEvent.layout.height
    gadgetMaxScrollSV.value = maxScrollOffset(box.content, box.viewport)
    noteListViewport(e)
    restoreGadgetScroll()
  }, [gadgetMaxScrollSV, noteListViewport, restoreGadgetScroll])
  const onGadgetContentSize = useCallback((_w: number, h: number) => {
    const box = gadgetBoxRef.current
    box.content = h
    gadgetMaxScrollSV.value = maxScrollOffset(box.content, box.viewport)
    restoreGadgetScroll()
  }, [gadgetMaxScrollSV, restoreGadgetScroll])
  const onInfoLayout = useCallback((e: LayoutChangeEvent) => {
    const box = infoBoxRef.current
    box.viewport = e.nativeEvent.layout.height
    infoMaxScrollSV.value = maxScrollOffset(box.content, box.viewport)
    noteListViewport(e)
    restoreInfoScroll()
  }, [infoMaxScrollSV, noteListViewport, restoreInfoScroll])
  const onInfoContentSize = useCallback((_w: number, h: number) => {
    const box = infoBoxRef.current
    box.content = h
    infoMaxScrollSV.value = maxScrollOffset(box.content, box.viewport)
    restoreInfoScroll()
  }, [infoMaxScrollSV, restoreInfoScroll])

  const scrollActiveListTo = useCallback((y: number) => {
    'worklet'
    if (activeListSV.value === LIST_GADGETS) scrollTo(gadgetScrollRef, 0, y, false)
    else if (activeListSV.value === LIST_INFO) scrollTo(infoScrollRef, 0, y, false)
  }, [activeListSV, gadgetScrollRef, infoScrollRef])

  // 手動開閉の間は、収納量とネイティブの位置を一緒に動かして読んでいる行を保つ。
  useAnimatedReaction(() => ({ y: headerY.value, held: holdHeaderSV.value, list: activeListSV.value, base: manualListBase.value }), (next) => {
    if (!focusedSV.value || !next.held || next.list === LIST_NONE) return
    const y = next.base + next.y
    if (next.list === LIST_GADGETS) {
      gadgetScrollY.value = y
      gadgetHeaderY.value = next.y
    } else {
      infoScrollY.value = y
      infoHeaderY.value = next.y
    }
    scrollActiveListTo(y)
  }, [scrollActiveListTo])

  const animateHeaderTo = useCallback((target: number) => {
    cancelAnimation(headerFlingY)
    headerFlingingSV.value = false
    if (target > 0 || headerY.value !== 0) setHeaderSettledOpen(false)
    const scrollY = activeListSV.value === LIST_GADGETS ? gadgetScrollY.value : infoScrollY.value
    manualListBase.value = Math.max(0, scrollY - headerY.value)
    holdHeaderSV.value = true
    headerScrollBias.value = -manualListBase.value
    headerTargetY.value = target
    headerY.value = withTiming(target, reduceMotion ? { duration: 0 } : target > headerY.value ? COLLAPSE_TIMING : EXPAND_TIMING)
  }, [activeListSV, gadgetScrollY, headerFlingY, headerFlingingSV, headerScrollBias, headerTargetY, headerY, holdHeaderSV, infoScrollY, manualListBase, reduceMotion])

  const handleCollapsibleLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height)
    const previousHeight = collapseHRef.current
    if (h <= 0 || h === previousHeight) return
    cancelAnimation(headerFlingY)
    headerFlingingSV.value = false
    const previousHeader = headerY.value
    const target = editingRef.current ? 0 : tab === 'wiring'
      ? (wiringPhotoExpandedRef.current ? 0 : h)
      : headerOffsetAfterLayout(previousHeader, previousHeight, h)
    const scrollY = tab === 'gadgets' ? gadgetScrollY.value : infoScrollY.value
    holdHeaderSV.value = false
    manualListBase.value = Math.max(0, scrollY - previousHeader)
    headerScrollBias.value = -manualListBase.value
    collapseHRef.current = h
    collapseHSV.value = h
    setCollapseH(h)
    headerTargetY.value = target
    headerY.value = target
    holdHeaderSV.value = true
    if (tab === 'gadgets') pendingGadgetRestoreRef.current = manualListBase.value + target
    if (tab === 'info') pendingInfoRestoreRef.current = manualListBase.value + target
  }, [collapseHSV, gadgetScrollY, headerFlingY, headerFlingingSV, headerScrollBias, headerTargetY, headerY, holdHeaderSV, infoScrollY, manualListBase, tab])

  useLayoutEffect(() => {
    cancelAnimation(headerFlingY)
    headerFlingingSV.value = false
    const nextList = tab === 'gadgets' ? LIST_GADGETS : tab === 'info' ? LIST_INFO : LIST_NONE
    if (editing) {
      if (!editingRestoreRef.current) {
        editingRestoreRef.current = { tab, progress: collapseHRef.current > 0 ? headerY.value / collapseHRef.current : 0 }
      }
      holdHeaderSV.value = false
      activeListSV.value = nextList
      animateHeaderTo(0)
      return
    }
    const editingRestore = editingRestoreRef.current
    editingRestoreRef.current = null
    if (editingRestore?.tab === tab) {
      holdHeaderSV.value = false
      activeListSV.value = nextList
      animateHeaderTo(editingRestore.progress * collapseHRef.current)
      return
    }
    const savedY = tab === 'gadgets' ? gadgetScrollY.value : infoScrollY.value
    const savedHeader = tab === 'gadgets' ? gadgetHeaderY.value : infoHeaderY.value
    const target = headerOffsetOnTabChange({
      tab, scrollY: savedY, headerOffset: headerY.value,
      collapseH: collapseHRef.current, wiringPhotoExpanded: wiringPhotoExpandedRef.current,
    })
    const restoredY = scrollOffsetAfterHeaderChange(savedY, savedHeader, target)
    // UI側の位置合わせが、切替途中の値で行き先の保存位置を上書きしないよう退避してから切り替える。
    holdHeaderSV.value = false
    activeListSV.value = LIST_NONE
    manualListBase.value = restoredY - target
    headerScrollBias.value = -manualListBase.value
    headerTargetY.value = target
    headerY.value = target
    setHeaderSettledOpen(target === 0)
    if (tab === 'gadgets') {
      gadgetBoxRef.current = { content: 0, viewport: 0 }
      pendingGadgetRestoreRef.current = restoredY
      gadgetScrollY.value = restoredY
      gadgetHeaderY.value = target
    } else if (tab === 'info') {
      pendingInfoRestoreRef.current = restoredY
      infoScrollY.value = restoredY
      infoHeaderY.value = target
    }
    activeListSV.value = nextList
    holdHeaderSV.value = true
    if (tab === 'info') restoreInfoScroll()
  }, [tab, editing, activeListSV, animateHeaderTo, gadgetHeaderY, gadgetScrollY, headerFlingY, headerFlingingSV, headerScrollBias, headerTargetY, headerY, holdHeaderSV, infoHeaderY, infoScrollY, manualListBase, restoreInfoScroll])

  const wasFocusedRef = useRef(focused)
  useLayoutEffect(() => {
    const wasFocused = wasFocusedRef.current
    wasFocusedRef.current = focused
    focusedSV.value = focused
    if (focused) {
      if (wasFocused) return
      if (activeListSV.value === LIST_GADGETS) {
        pendingGadgetRestoreRef.current = gadgetScrollY.value
        restoreGadgetScroll()
      } else if (activeListSV.value === LIST_INFO) {
        pendingInfoRestoreRef.current = infoScrollY.value
        restoreInfoScroll()
      }
      return
    }
    cancelAnimation(headerFlingY)
    cancelAnimation(headerY)
    headerTargetY.value = headerY.value
    headerFlingingSV.value = false
    headerDraggingSV.value = false
    lastHeaderTapRef.current = 0
    cancelScrollRestore()
    if (activeListSV.value === LIST_GADGETS) gadgetScrollRef.current?.scrollTo({ y: gadgetScrollY.value, animated: false })
    else if (activeListSV.value === LIST_INFO) infoScrollRef.current?.scrollTo({ y: infoScrollY.value, animated: false })
  }, [focused, focusedSV, activeListSV, cancelScrollRestore, gadgetScrollRef, gadgetScrollY, headerDraggingSV, headerFlingY, headerFlingingSV, headerTargetY, headerY, infoScrollRef, infoScrollY, restoreGadgetScroll, restoreInfoScroll])

  const syncHeaderForScroll = useCallback((scrollYOf: SharedValue<number>, y: number) => {
    'worklet'
    scrollYOf.value = y
    if (editingSV.value || holdHeaderSV.value) return
    const next = headerOffsetForScroll(y, collapseHSV.value, headerScrollBias.value)
    headerTargetY.value = next
    headerY.value = next
    if (activeListSV.value === LIST_GADGETS) gadgetHeaderY.value = next
    else if (activeListSV.value === LIST_INFO) infoHeaderY.value = next
    // 完全収納後は一覧の途中で逆に動かしても写真を開かず、先頭付近で再表示する。
    if (next >= collapseHSV.value) headerScrollBias.value = 0
  }, [activeListSV, collapseHSV, editingSV, gadgetHeaderY, headerScrollBias, headerTargetY, headerY, holdHeaderSV, infoHeaderY])
  const beginListDrag = useCallback((scrollYOf: SharedValue<number>, y: number) => {
    'worklet'
    cancelAnimation(headerFlingY)
    cancelAnimation(headerY)
    headerTargetY.value = headerY.value
    headerFlingingSV.value = false
    headerDraggingSV.value = false
    holdHeaderSV.value = false
    headerScrollBias.value = headerY.value >= collapseHSV.value || y <= 0 ? 0 : headerY.value - y
    scrollYOf.value = y
    runOnJS(cancelScrollRestore)()
  }, [cancelScrollRestore, collapseHSV, headerDraggingSV, headerFlingY, headerFlingingSV, headerScrollBias, headerTargetY, headerY, holdHeaderSV])
  const handleGadgetScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      if (focusedSV.value && activeListSV.value === LIST_GADGETS && !headerDraggingSV.value && !headerFlingingSV.value) syncHeaderForScroll(gadgetScrollY, e.contentOffset.y)
    },
    onBeginDrag: (e) => { if (focusedSV.value && activeListSV.value === LIST_GADGETS) beginListDrag(gadgetScrollY, e.contentOffset.y) },
  }, [activeListSV, beginListDrag, focusedSV, gadgetScrollY, headerDraggingSV, headerFlingingSV, syncHeaderForScroll])
  const handleInfoScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      if (focusedSV.value && activeListSV.value === LIST_INFO && !headerDraggingSV.value && !headerFlingingSV.value) syncHeaderForScroll(infoScrollY, e.contentOffset.y)
    },
    onBeginDrag: (e) => { if (focusedSV.value && activeListSV.value === LIST_INFO) beginListDrag(infoScrollY, e.contentOffset.y) },
  }, [activeListSV, beginListDrag, focusedSV, headerDraggingSV, headerFlingingSV, infoScrollY, syncHeaderForScroll])

  const headerDragStartY = useSharedValue(0)
  const driveListScroll = useCallback((y: number) => {
    'worklet'
    if (activeListSV.value === LIST_GADGETS) syncHeaderForScroll(gadgetScrollY, y)
    else if (activeListSV.value === LIST_INFO) syncHeaderForScroll(infoScrollY, y)
    scrollActiveListTo(y)
  }, [activeListSV, gadgetScrollY, infoScrollY, scrollActiveListTo, syncHeaderForScroll])
  const headerPan = useMemo(() => Gesture.Pan()
    .enabled(focused && tab !== 'wiring' && !editing)
    .activeOffsetY([-10, 10])
    .failOffsetX([-12, 12])
    .onStart(() => {
      'worklet'
      if (!focusedSV.value) return
      const scrollY = activeListSV.value === LIST_GADGETS ? gadgetScrollY : infoScrollY
      beginListDrag(scrollY, scrollY.value)
      headerDraggingSV.value = true
      headerDragStartY.value = scrollY.value
    })
    .onUpdate((e) => {
      'worklet'
      if (!focusedSV.value || activeListSV.value === LIST_NONE) return
      const max = activeListSV.value === LIST_GADGETS ? gadgetMaxScrollSV.value : infoMaxScrollSV.value
      // scrollTo の通知を待つと、写真上から動かしたときだけ追従が1フレーム遅れる。
      driveListScroll(clampHeaderOffset(headerDragStartY.value - e.translationY, max))
    })
    .onEnd((e) => {
      'worklet'
      if (!focusedSV.value || activeListSV.value === LIST_NONE) return
      const max = activeListSV.value === LIST_GADGETS ? gadgetMaxScrollSV.value : infoMaxScrollSV.value
      headerFlingY.value = activeListSV.value === LIST_GADGETS ? gadgetScrollY.value : infoScrollY.value
      headerFlingingSV.value = true
      headerFlingY.value = withDecay({ velocity: -e.velocityY, clamp: [0, max] }, (finished) => {
        if (finished) driveListScroll(headerFlingY.value)
        headerFlingingSV.value = false
      })
    })
    .onFinalize(() => { headerDraggingSV.value = false }),
  [tab, editing, focused, focusedSV, activeListSV, beginListDrag, driveListScroll, gadgetMaxScrollSV, gadgetScrollY, headerDragStartY, headerDraggingSV, headerFlingY, headerFlingingSV, infoMaxScrollSV, infoScrollY])
  useAnimatedReaction(() => headerFlingY.value, (y, previous) => {
    if (focusedSV.value && headerFlingingSV.value && previous !== null && y !== previous) driveListScroll(y)
  }, [driveListScroll])

  const captureTouchDuringFling = useCallback(() => {
    // JSへの完了通知を待つと、停止後のタップまで慣性停止として奪ってしまう。
    if (!headerFlingingSV.value) return false
    cancelAnimation(headerFlingY)
    headerFlingingSV.value = false
    return true
  }, [headerFlingY, headerFlingingSV])
  const handleHeaderDoubleTap = useCallback(() => {
    if (editingRef.current) return
    const now = Date.now()
    if (now - lastHeaderTapRef.current <= DOUBLE_TAP_MS) {
      lastHeaderTapRef.current = 0
      cancelScrollRestore()
      const expanded = headerTargetY.value >= collapseHRef.current / 2
      if (tab === 'wiring') {
        wiringPhotoExpandedRef.current = expanded
        setWiringPhotoExpanded(expanded)
      }
      animateHeaderTo(expanded ? 0 : collapseHRef.current)
    } else lastHeaderTapRef.current = now
  }, [tab, animateHeaderTo, cancelScrollRestore, headerTargetY])
  const handleWiringPhotoToggle = useCallback(() => {
    const next = !wiringPhotoExpandedRef.current
    wiringPhotoExpandedRef.current = next
    setWiringPhotoExpanded(next)
    animateHeaderTo(next ? 0 : collapseHRef.current)
  }, [animateHeaderTo])
  const hideWiringPhotoForFit = useCallback(() => {
    if (tab !== 'wiring' || editingRef.current || !wiringPhotoExpandedRef.current) return false
    wiringPhotoExpandedRef.current = false
    setWiringPhotoExpanded(false)
    animateHeaderTo(collapseHRef.current)
    return true
  }, [tab, animateHeaderTo])

  const headerShiftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -headerY.value }] }))
  const headerParallaxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reduceMotion ? -headerY.value : headerParallaxOffset(headerY.value) }],
  }))
  // 箱の上移動は収納を、ネイティブのスクロールは収納＋一覧を表すので、重複分を相殺する。
  const listContentStyle = useAnimatedStyle(() => ({ transform: [{ translateY: headerY.value }] }))

  return {
    collapseH, headerCollapsed, headerShiftStyle, headerParallaxStyle,
    headerContainerStyle: HEADER_CLIP_STYLE,
    listContentStyle, handleCollapsibleLayout, handleHeaderDoubleTap, headerPan,
    captureTouchDuringFling, wiringPhotoExpanded, handleWiringPhotoToggle, hideWiringPhotoForFit,
    gadgetScrollRef, infoScrollRef, gadgetScrollY, infoScrollY,
    handleGadgetScroll, handleInfoScroll, onGadgetLayout, onGadgetContentSize, onInfoLayout, onInfoContentSize,
    paneExtension: { marginBottom: -collapseH },
    wiringPaneExtension: { marginBottom: headerSettledOpen ? 0 : -collapseH },
    // 毎フレーム余白を変えるとスクロール上限も変わるため、収納用の距離は固定で確保する。
    listBottomInset: collapseH,
    listContentMinHeight: listViewportH > 0 ? listViewportH + collapseH : 0,
  }
}
