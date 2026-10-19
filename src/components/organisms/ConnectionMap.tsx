import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ActivityIndicator, Animated as NativeAnimated, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { hapticLight, hapticMedium } from '../../utils/haptics'
import Reanimated, { measure, ReduceMotion, runOnJS, useAnimatedProps, useAnimatedRef, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated'
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg'
import { AppIcon } from '../atoms/AppIcon'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { useCoachTarget } from '../../hooks/useCoachMarks'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { ArmMountIcon } from '../atoms/ArmMountIcon'
import { MapNodeLabel, POWER_SOURCE_COLORS } from '../atoms/MapNodeLabel'
import { TextField } from '../atoms/TextField'
import { SetupActionFooter } from '../molecules/SetupActionFooter'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { useKeyboardReveal } from '../../hooks/useKeyboardReveal'
import { categoryIconColor, DECOR_COLOR, ICONS, themeIconColor, themeTintBase, categoryBaseColor } from '../../constants/icons'
import { cableLabel, cableSortRank, determineCableType, isWirelessPortType, MAX_CABLE_COUNT, PORT_COMPATIBILITY, PORT_ICONS, portColor, portIconColor, requiresPhysicalCable } from '../../constants/portTypes'
import { cableChoiceLabel } from '../../utils/cableChoice'
import { AppColors, useApp } from '../../context/AppContext'
import { CableType, DeskPlan, Gadget, MapConnection, NodeOffset } from '../../types'
import { baseMapNodeId, dragEdgePoints, BATTERY_ID, DECOR_ID, MapEdge, MapLayout, MapNode, NODE_H, NODE_MIN, NODE_W, pairedSplitKeyboardNodeId, patchLayoutNodeMove, POWER_SOURCE_IDS, pointsToPath, pointsToRoundedPath, SOLAR_ID, WALL_ID, wavyPath } from '../../utils/connectionMapLayout'
import { gadgetGenreLabel, localizedGadgetName } from '../../utils/localizedGadgetName'
import { armMountCategory, isWirelessPowerPort } from '../../utils/gadgetPorts'
import { getOrComputeMapLayout, loadCachedMapLayout, makeLayoutInputKey, tryGetCachedLayout } from '../../utils/mapLayoutCache'
import { statusTextColor, UI_METRICS, UI_STATUS_COLORS } from '../../constants/ui'
import { ROUTE_NOTE_MAX_LENGTH } from '../../constants/textLimits'
import { WIRE_CASING_WIDTH, WIRE_LINE_WIDTH } from '../../constants/wiring'
import { inputMaxLength, tidyMultilineText, truncateChars } from '../../utils/truncateText'
import { branchJunctionsForDrawing, crossingCutPath, crossingCutsForDrawing, sortEdgesForDrawing } from '../../utils/wireStacking'
import { badgeSlots, isStylusAccessory } from '../../utils/gadgetAttachments'
import { SectionBoundary, SectionRecovery } from '../molecules/ErrorContainment'
import { boundedPlacementPan, nearestPlacement, overlappingPlacementIds, placementEdgeVelocity, placementMoveBounds, resolvePlacementDrag, resolvePlacementResize, type PlacementRect } from '../../utils/placementGesture'
import { layoutRestorePan } from '../../utils/mapLayoutUndo'

const WIRE_TAP_TOLERANCE = 24   // pickEdge のタップ判定許容距離（線が太い分、広めに取る）
const WireRemovalGroup = NativeAnimated.createAnimatedComponent(G)
const WIRE_PICK_AMBIGUITY = WIRE_LINE_WIDTH

const MAP_MIN_LOADING_MS = 700
const MAX_CANVAS_SCALE = 2.5
const RESIZE_HIT_EXTENSION = 12
const FIT_PADDING = 8
// 上12ptから始まる凡例を、下16pt・48ptの操作HUDより8pt上で止める。
const LEGEND_VERTICAL_CLEARANCE = 12 + 8 + 48 + 16

const routePathLabel = (path: NonNullable<MapConnection['route']>['path'] | undefined, lang: 'ja' | 'en') => {
  const labels = {
    direct: ['直結', 'Direct'], under_desk: ['机の下', 'Under desk'], cable_tray: ['ケーブルトレー', 'Cable tray'],
    along_wall: ['壁沿い', 'Along wall'], through_wall: ['壁内・貫通', 'Through wall'], floor: ['床沿い', 'Floor'],
  } as const
  return labels[path ?? 'direct'][lang === 'en' ? 1 : 0]
}
const routeVisibilityLabel = (visibility: NonNullable<MapConnection['route']>['visibility'] | undefined, lang: 'ja' | 'en') => {
  const labels = { visible: ['見える', 'Visible'], partial: ['一部隠す', 'Partly hidden'], hidden: ['隠す', 'Hidden'] } as const
  return labels[visibility ?? 'visible'][lang === 'en' ? 1 : 0]
}

// レイアウト未計算のときの空ノード配列。毎回 [] を作ると参照が変わり、
// ノードカードのメモ化（下の nodeCardModels）が無駄に作り直される
const EMPTY_NODES: MapNode[] = []


// 接続方法の候補（よく使う順）。自動生成されうる種別を欠かすと、異なる端子間の
// おすすめが選択肢に現れず、手動追加時に別の種別で保存される。
const CABLE_OPTIONS: CableType[] = [
  'USB_C', 'USB_A', 'USB_A_to_C', 'USB_A_to_B', 'USB_C_to_B',
  'USB_A_to_Lightning', 'USB_C_to_Lightning', 'USB_A_to_microUSB', 'USB_C_to_microUSB', 'Thunderbolt',
  'HDMI', 'DisplayPort', 'MiniDisplayPort', 'MiniDisplayPort_to_DisplayPort',
  'USB_C_to_DisplayPort', 'USB_C_to_HDMI', 'DisplayPort_to_HDMI', 'HDMI_to_DisplayPort', 'HDMI_to_DVI', 'DVI', 'VGA',
  'Ethernet', 'Audio3_5mm', 'Audio6_3mm', 'Audio4_4mm', 'Audio3_5_to_6_3',
  'OpticalAudio', 'CoaxialAudio', 'SpeakerTerminal', 'XLR', 'XLR4pin', 'MIDI', 'MIDI_TRS',
  'Power', 'Bluetooth', 'XboxWireless', 'WiFi', 'wirelessCharging', 'Battery',
  'MonitorArm', 'MicArm', 'Stylus', 'SDCard', 'microSDCard', 'CFexpress',
]

// wirelessCharging/Battery は短縮表示

const CHIP_LABEL_JA: Partial<Record<CableType, string>> = {
  wirelessCharging: 'ワイヤレス',
  Battery: '電池',
}

const WIRELESS_COLOR = UI_STATUS_COLORS.success
// 給電方法で「ワイヤレス」が選択されている（＝ワイヤレス給電の入力ポートを持つ）ガジェット
// isWirelessPowerPort で wirelessCharging 型および旧形式の Power 型（ラベル: Qi/ワイヤレス）を対応
const hasWirelessInputPort = (g: Gadget) =>
  g.ports.some((p) => p.direction === 'input' && isWirelessPowerPort(p))

// 配線を再計算する間も、確定したカードの位置を保つ。
function moveNodeInLayout(current: MapLayout, nodeId: string, dx: number, dy: number): MapLayout | null {
  if (dx === 0 && dy === 0) return null
  const target = current.nodes.find((n) => n.id === nodeId)
  if (!target || target.x + dx < 0 || target.y + dy < 0) return null
  const nodes = current.nodes.map((n) => n.id === nodeId
    ? { ...n, x: n.x + dx, y: n.y + dy, cx: n.cx + dx, cy: n.cy + dy }
    : n)
  const bounds = {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + n.w)),
    maxY: Math.max(...nodes.map((n) => n.y + n.h)),
  }
  // 右下へはみ出したぶんはキャンバスを広げる。広げないと置いた先が切れて見える
  return {
    ...current,
    nodes,
    width: Math.max(current.width, bounds.maxX + FIT_PADDING),
    height: Math.max(current.height, bounds.maxY + FIT_PADDING),
    bounds,
  }
}

/**
 * 折れ線の長さの半分の位置。折れ点の真ん中（points[length/2]）で代用すると、
 * 折れの無い直線（2点）では終点＝相手のカードの縁になり、ラベルがカードの下に隠れる
 */
function polylineMidpoint(points: { x: number; y: number }[]): { x: number; y: number } | null {
  if (points.length === 0) return null
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let remaining = lengths.reduce((sum, l) => sum + l, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const t = remaining / lengths[i]
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      }
    }
    remaining -= lengths[i]
  }
  return points[0]
}

/**
 * 動かしたあとの NodeOffset。動かした時点の基準位置（node.baseX/baseY）を一緒に持たせ、
 * 以後は構成が変わっても置いた場所に留める（types の NodeOffset の注記）。
 * すでに基準位置を持っているものはそれを保ったまま移動量だけ足す
 */
function offsetAfterMove(prev: NodeOffset, node: MapNode | undefined, moveX: number, moveY: number): NodeOffset {
  const bx = prev.bx ?? (node?.baseX != null ? Math.round(node.baseX) : undefined)
  const by = prev.by ?? (node?.baseY != null ? Math.round(node.baseY) : undefined)
  return {
    dx: node && bx != null ? Math.round(node.x + moveX - bx) : prev.dx + moveX,
    dy: node && by != null ? Math.round(node.y + moveY - by) : prev.dy + moveY,
    ...(bx != null && by != null ? { bx, by } : {}),
  }
}

// ほかの機材からこれ以上は離せない距離（図の座標）。縮小した図では指の1回の移動が
// 数千に化けるので、離せる距離を決めないと、繰り返し動かすだけでキャンバスと配線の探索盤面
// （面積に比例）がいくらでも広がる
const NODE_MOVE_REACH = 600

/** 移動量を、動かした先がほかの機材の範囲から NODE_MOVE_REACH 以内に収まるよう詰める */
function clampNodeMove(layout: MapLayout | null, nodeId: string, moveX: number, moveY: number): { moveX: number; moveY: number } {
  const node = layout?.nodes.find((n) => n.id === nodeId)
  const others = layout?.nodes.filter((n) => n.id !== nodeId) ?? []
  if (!node || others.length === 0) return { moveX, moveY }
  // 範囲には今の位置も含める。すでに外にある（以前の保存値）ときに、触っただけで引き戻さない
  const minX = Math.min(node.x, Math.min(...others.map((n) => n.x)) - NODE_MOVE_REACH - node.w)
  const maxX = Math.max(node.x, Math.max(...others.map((n) => n.x + n.w)) + NODE_MOVE_REACH)
  const minY = Math.min(node.y, Math.min(...others.map((n) => n.y)) - NODE_MOVE_REACH - node.h)
  const maxY = Math.max(node.y, Math.max(...others.map((n) => n.y + n.h)) + NODE_MOVE_REACH)
  return {
    moveX: Math.round(Math.min(maxX, Math.max(minX, node.x + moveX)) - node.x),
    moveY: Math.round(Math.min(maxY, Math.max(minY, node.y + moveY)) - node.y),
  }
}

// 配置モード中の移動をまとめて反映する（裏で計算し直された layout へ移し替えるため）
function applyNodeDelta(current: MapLayout, delta: Record<string, { dx: number; dy: number }>): MapLayout {
  let next = current
  for (const [id, d] of Object.entries(delta)) next = moveNodeInLayout(next, id, d.dx, d.dy) ?? next
  return next
}

// 点と線分の距離（配線タップ判定用）
function distToSeg(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - a.x, py - a.y)
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

// 配線凡例だけの折りたたみ状態。画面を離れても状態を維持する。
// 展開した凡例は小画面でノードと線を大きく覆うため、最初は図を優先する。
let cableLegendCollapsedLast = true

// ノードを一度でも動かしたら消す（端末ごとに1回だけ）
const MOVE_HINT_KEY = 'map_move_hint_done'

type RoutePatch = Partial<NonNullable<MapConnection['route']>>
/** 打ちかけの取り回し。触った欄だけ持つ（触っていない欄を保存で上書きしない） */
type RouteDraft = { id: string; lengthDigits?: string; note?: string }

function routePatchOfDraft(draft: RouteDraft): RoutePatch {
  const patch: RoutePatch = {}
  if (draft.lengthDigits !== undefined) {
    // 0 は 1 へ丸めず未入力として扱う（「0」が「1」に化けると、続けて 5 を打つと 15 になる）
    const cm = Number(draft.lengthDigits)
    patch.lengthCm = draft.lengthDigits && cm > 0 ? cm : undefined
  }
  if (draft.note !== undefined) {
    patch.note = truncateChars(tidyMultilineText(draft.note), ROUTE_NOTE_MAX_LENGTH) || undefined
  }
  return patch
}

function applyRoutePatch(id: string, patch: RoutePatch) {
  return (current: MapConnection[]): MapConnection[] => current.map((item) =>
    item.id === id ? { ...item, route: { ...item.route, ...patch }, confirmed: true } : item)
}

export interface MapGadgetActions {
  editConnection: (connection: MapConnection) => void
  drawConnection: () => void
  addWirelessConnection?: () => void
}

export interface MapLayoutRestoreRequest {
  nodeIds: readonly string[]
  onComplete: () => void
  onError: (error: unknown) => void
}

interface Props {
  gadgets: Gadget[]
  connections: MapConnection[]
  plan: DeskPlan
  readOnly?: boolean
  /**
   * 図が描けなかったときに出す「配置と配線をリセット」の中身（utils/planWiring.ts の resetPlanLayout）。
   * 自分のデスクだけが渡す。他人のデスクは直せないので、再試行だけを出す
   */
  onResetLayout?: () => Promise<void>
  /**
   * readOnly のまま、ノードの移動・リサイズだけを許可する。
   * 接続の追加/削除・再構成・全削除は readOnly のまま無効のまま。
   * （歴史アニメーションの「配置を編集」で使う）
   */
  layoutEditable?: boolean
  // タブ非表示時などに false を渡すと、キャンバスのパン/ピンチを無効化する。
  // display:none で保持したままでも gesture-handler が全画面でタッチを奪い、
  // 他タブの ScrollView がスクロール不能になるのを防ぐ。
  active?: boolean
  // レイアウト計算が完了し配線図を初めて描画できる状態になったら一度だけ呼ぶ。
  // 呼び元は「準備完了までローディングを被せる」ことで一瞬の空白を防げる。
  onReady?: () => void
  /**
   * 編集は「今の線 → 次の線」の関数で渡す。呼び元が保存時点の最新の線に当てる。
   * 配列で渡すと、裏の再計算と重なったときに再計算の結果を編集前の線で上書きする
   */
  onChange?: (update: (current: MapConnection[]) => MapConnection[]) => void
  nodeOffsets?: Record<string, NodeOffset>
  onNodeOffsetsChange?: (offsets: Record<string, NodeOffset>, changedIds?: readonly string[]) => void
  nodeSizes?: Record<string, { w: number; h: number }>
  // リサイズは対角固定のため位置(offsets)も同時に動く → 1回の保存で両方更新する
  onNodeSizesChange?: (sizes: Record<string, { w: number; h: number }>, offsets: Record<string, NodeOffset>, changedIds?: readonly string[], offsetIds?: readonly string[]) => void
  onLayoutEditStart?: () => boolean
  onLayoutEditEnd?: () => void
  layoutRestoreRequest?: MapLayoutRestoreRequest | null
  onOpenGadget?: (gadgetId: string, actions?: MapGadgetActions) => void
  /**
   * 線に割り当てる実物のケーブル（つなぎ方）を編集させる。
   * 編集の実体は一覧画面（ConnectionMethodScreen）1つに寄せて、ここでは今の値を出すだけにする。
   * 渡さないと値の表示だけになる（公開デスクの閲覧）。
   */
  onEditCableChoice?: (connectionId: string) => void
  /**
   * 配線を引く前に配置だけ決めてもらうモード。線は引かず、ノードを動かしても
   * 配線は計算しない（「配線する」を押した時点で、その配置を基準に1回だけ計算する）。
   */
  placementMode?: boolean
  /** rewired: 配置が動いていて、これから配線を計算し直すか */
  onConfirmPlacement?: (rewired: boolean, offsets?: Record<string, NodeOffset>) => void
  placementConfirmLabel?: string
  /**
   * シートの一覧（つなぐ機材・飾り）に出す順。機材タブと同じ順を渡す。
   * gadgets の順は配置の入力なので並べ替えずに渡し、表示の順はこちらで決める
   */
  listOrder?: readonly string[]
  /**
   * 「全体」を押したとき、図の枠を広げられるなら広げる（デスク詳細の写真を畳む）。広げたら true。
   * 写真を出したままの配線タブは図の枠が 200pt ほどしかなく、そこへ合わせると図が豆粒になっていた
   */
  onFitPress?: () => boolean
}

/**
 * 配置モードでできる操作。デスク作成の3歩目（画面上部の説明）と、配線図の中の帯
 * （完了ボタンのすぐ上）の両方に出るので、文言はここ1つにする。
 * 別々に書いていたときは、片方が移動だけを案内したままになっていた。
 */
export const PLACEMENT_HINT = {
  ja: '長押しで移動、右下の角で大きさを変えられます',
  en: 'Hold to move, drag the bottom-right corner to resize',
} as const
export const PLACEMENT_MOVE_HINT = {
  ja: '長押しで移動、2本指で図を拡大できます',
  en: 'Hold to move, pinch to zoom the map',
} as const

const AnimatedWirePath = Reanimated.createAnimatedComponent(Path)

function DragWirePath({ edge, draggingNode, dragX, dragY, ...props }: React.ComponentProps<typeof Path> & {
  edge: MapEdge; draggingNode: string | null; dragX: SharedValue<number>; dragY: SharedValue<number>
}) {
  const originalPoints = edge.points
  const from = edge.from.id === draggingNode, to = edge.to.id === draggingNode
  const pairLink = !!edge.isPairLink, wireless = edge.conn.cableType === 'wirelessCharging'
  const originalPath = props.d as string
  const animatedProps = useAnimatedProps(() => {
    if (!from && !to) return { d: originalPath }
    const points = dragEdgePoints(originalPoints, from, to, pairLink, dragX.value, dragY.value)
    return { d: pairLink ? pointsToPath(points) : wireless ? wavyPath(points) : pointsToRoundedPath(points) }
  })
  return <AnimatedWirePath {...props} animatedProps={animatedProps} />
}

function LiftedMapCard({ dragging, tracking, reduceMotion, width, height, surface, children }: {
  dragging: boolean; tracking: SharedValue<boolean>; reduceMotion: boolean; children: React.ReactNode
  width: number; height: number; surface: string
}) {
  const lift = useDerivedValue(() =>
    reduceMotion ? 0 : withSpring(dragging && tracking.value ? 1 : 0, {
      damping: 22, stiffness: 360, mass: 0.65, reduceMotion: ReduceMotion.Never,
    })
  )
  const style = useAnimatedStyle(() => ({
    shadowOpacity: 0.18 * lift.value,
    shadowRadius: 8 * lift.value,
    elevation: 6 * lift.value,
  }))
  return <Reanimated.View style={[{ width, height, backgroundColor: surface, shadowColor: '#000', shadowOffset: { width: 0, height: 4 } }, style]}>{children}</Reanimated.View>
}

function ConnectionMapInner({ gadgets, connections, plan, readOnly, layoutEditable, active = true, onReady, onChange, nodeOffsets, onNodeOffsetsChange, nodeSizes, onNodeSizesChange, onLayoutEditStart, onLayoutEditEnd, layoutRestoreRequest, onOpenGadget, onEditCableChoice, placementMode, onConfirmPlacement, placementConfirmLabel, listOrder, onFitPress }: Props) {
  const { colors: C, lang, isDark, reduceMotion } = useApp()
  const T = (ja: string, en: string) => (lang === 'ja' ? ja : en)

  // レイアウト入力の方針：
  // 未接続の機器は残す。配線を持たない家具・小物と飾りは、歴史と共通のレイアウト計算で除く。
  const layoutInput = useMemo(
    () => ({ gadgets, connections }),
    [gadgets, connections],
  )

  // レイアウト計算は描画後に非同期実行し、計算中はローディング表示する。
  // 初回計算時だけは MIN_LOADING_MS のあいだ読み込み表示を残す。
  // メモリ／永続キャッシュのヒット時は待たせず、そのまま表示する。
  // 2回目以降の引き直し（ドラッグ後の再ルーティング等）は据え置きなしで即反映する。
  const [layout, setLayout] = useState<MapLayout | null>(null)
  const layoutInputKey = useMemo(() => makeLayoutInputKey(gadgets, connections, plan.placements, nodeOffsets ?? {}, nodeSizes ?? {}, !!plan.templateId),
    [gadgets, connections, plan.placements, nodeOffsets, nodeSizes, plan.templateId])
  const displayedInputKeyRef = useRef('')
  // 手動移動で局所更新した図も控える。Undoで同じ入力へ戻ったら、見えていた経路ごと戻す。
  const displayedLayoutsRef = useRef(new Map<string, MapLayout>())
  const rememberLayout = useCallback((key: string, value: MapLayout) => {
    const cached = displayedLayoutsRef.current
    cached.delete(key)
    cached.set(key, value)
    if (cached.size > 6) cached.delete(cached.keys().next().value!)
    displayedInputKeyRef.current = key
  }, [])
  // 凡例から1種類だけを強調する。密集した図で線を目で追う距離を短くし、
  // 色を見分けにくい場合も文字ラベルから対象を選べるようにする。
  const [focusedCableType, setFocusedCableType] = useState<CableType | null>(null)
  // 「配線する」を押してから新しい経路が出来上がるまでの待ち。押した瞬間に既存の線を
  // 出すと、動かす前の配置のまま引かれていた経路が一瞬見えてしまう
  const [awaitingWiring, setAwaitingWiring] = useState(false)
  // 配置モード中に動かしたぶん（保存済み nodeOffsets からの差分）。ここに溜めるだけで
  // 保存しない。保存すると nodeOffsets が変わり、動かすたびに配線の計算が走ってしまう
  const placementDeltaRef = useRef<Record<string, { dx: number; dy: number }> | null>(null)
  const mountedAtRef = useRef(Date.now())
  const firstRevealDoneRef = useRef(false)
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current) }, [])
  const revealLayout = useCallback((next: MapLayout, immediate = false, key = '') => {
    const wait = immediate || firstRevealDoneRef.current
      ? 0
      : Math.max(0, MAP_MIN_LOADING_MS - (Date.now() - mountedAtRef.current))
    const commit = () => {
      firstRevealDoneRef.current = true
      // 配置モード中に動かしたぶんは、裏で計算し直された layout にも移し替える。
      // 移し替えないと、保存直後の引き直しが届いた時点で「動かしたのに元へ戻る」
      const delta = placementDeltaRef.current
      if (key) rememberLayout(key, next)
      setLayout(delta ? applyNodeDelta(next, delta) : next)
      setRelayouting(false)
      setAwaitingWiring(false)
    }
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
    if (wait === 0) { commit(); return }
    revealTimerRef.current = setTimeout(commit, wait)
  }, [rememberLayout])
  const localLayoutCommitRef = useRef<{
    offsets: Record<string, NodeOffset>
    inputKey: string
    layout: MapLayout
    /** 足だけ引き直した近似。表示はするが、フル再計算の結果で差し替える */
    provisional: boolean
  } | null>(null)
  // 再計算中フラグ：既存の図を表示したまま「再計算中…」ピルを出す
  // （ドラッグ後の引き直し・再構成・全削除など、タップ直後の手ごたえ用）
  const [relayouting, setRelayouting] = useState(false)
  // 配置計算の失敗（下の catch）。描画中に投げ直して、外側の SectionBoundary に受け止めさせる
  const [layoutFailure, setLayoutFailure] = useState<Error | null>(null)
  if (layoutFailure) throw layoutFailure
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const restoreRequestRef = useRef(layoutRestoreRequest)
  restoreRequestRef.current = layoutRestoreRequest
  useEffect(() => () => { restoreRequestRef.current?.onComplete() }, [])
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const localCommit = localLayoutCommitRef.current
    if (localCommit) {
      const currentOffsets = nodeOffsets ?? {}
      const currentKeys = Object.keys(currentOffsets)
      const committedKeys = Object.keys(localCommit.offsets)
      const matches = localCommit.inputKey === layoutInputKey && currentKeys.length === committedKeys.length && committedKeys.every((id) => {
        const current = currentOffsets[id]
        const committed = localCommit.offsets[id]
        return current?.dx === committed.dx && current?.dy === committed.dy
      })
      if (matches) {
        localLayoutCommitRef.current = null
        setLayout(localCommit.layout)
        // 確定版ならここで終わり。暫定版は見せたまま、下でフル再計算して差し替える。
        if (!localCommit.provisional) {
          rememberLayout(layoutInputKey, localCommit.layout)
          setRelayouting(false)
          return
        }
      }
    }
    const displayed = displayedLayoutsRef.current.get(layoutInputKey)
    if (displayed && !placementDeltaRef.current) { revealLayout(displayed, true, layoutInputKey); return }
    const cached = tryGetCachedLayout(plan.id, layoutInput.gadgets, layoutInput.connections, plan.placements, nodeOffsets ?? {}, nodeSizes ?? {}, !!plan.templateId)
    if (cached) { revealLayout(cached, true, layoutInputKey); return }
    // キャッシュミス：先に「再計算中」の表示を描画してから重い計算を開始する
    setRelayouting(true)
    const t = setTimeout(() => {
      if (cancelled) return
      void loadCachedMapLayout(plan.id, layoutInput.gadgets, layoutInput.connections, plan.placements, nodeOffsets ?? {}, nodeSizes ?? {}, !!plan.templateId)
        .then(async (persistedLayout) => {
          if (cancelled) return
          if (persistedLayout) {
            revealLayout(persistedLayout, true, layoutInputKey)
            return
          }
          const result = await getOrComputeMapLayout(plan.id, layoutInput.gadgets, layoutInput.connections, plan.placements, nodeOffsets ?? {}, nodeSizes ?? {}, !!plan.templateId, controller.signal)
          if (!cancelled) revealLayout(result, false, layoutInputKey)
        })
        // 計算の失敗は非同期なので境界に届かず、「再計算中」のまま止まる。呼び出し側も
        // onReady を待って読み込み表示を外せない。準備完了を知らせてから、描画の例外として
        // 投げ直し、SectionBoundary に「もう一度表示」へ差し替えさせる
        .catch((error: unknown) => {
          if (cancelled) return
          onReadyRef.current?.()
          restoreRequestRef.current?.onError(error)
          setLayoutFailure(error instanceof Error ? error : new Error(String(error)))
        })
    }, 0)
    return () => { cancelled = true; controller.abort(); clearTimeout(t) }
  }, [plan.id, layoutInput, plan.placements, nodeOffsets, nodeSizes, revealLayout, plan.templateId, layoutInputKey, rememberLayout])

  // 初めてレイアウトが確定した（＝配線図を描画できる）タイミングで一度だけ通知。
  // 呼び元はこれを受けてローディングオーバーレイを外す。
  const readyFiredRef = useRef(false)
  useEffect(() => {
    if (layout && !readyFiredRef.current) {
      readyFiredRef.current = true
      onReady?.()
    }
  }, [layout, onReady])


  const visibleNodes = layout?.nodes ?? EMPTY_NODES
  const overlappingIds = useMemo(() => overlappingPlacementIds(visibleNodes), [visibleNodes])
  const [overlapListOpen, setOverlapListOpen] = useState(false)
  const [selectedOverlapId, setSelectedOverlapId] = useState<string | null>(null)
  // Wi-Fi は線を引かず、ガジェットカード右上のマークで無線接続を示す（線が増えて図が読みにくくなるため）。
  // レイアウトの入力からは外さないので、線を消してもガジェットの位置は変わらない
  const isBadgeOnlyEdge = (edge: MapEdge) => edge.conn.cableType === 'WiFi'
  // 充電のときだけ挿す線（chargingOnly）は引かない。配線図が示すのは作業中の状態で、
  // そこに「挿したり抜いたりする線」が混ざると、いま何が繋がっているのかが読めなくなる。
  // 充電の相手はノードをタップしたシートに一覧で出す（Wi-Fi をバッジで示すのと同じ考え方）。
  // レイアウトの入力からは外さないので、線を消してもガジェットの位置は変わらない
  // layout.edges の conn は計算した時点の接続のコピーで、キャッシュのキー（mapLayoutCache）に
  // 入っていない本数・つなぎ方・取り回しは古いまま返ってくる。形だけを layout から借り、
  // 接続そのものは今の connections から引き直す。古いコピーを編集シートへ渡すと、
  // 取り回しを変えたときに本数とつなぎ方を巻き戻して保存してしまう
  const visibleEdges = useMemo(() => {
    const liveById = new Map(connections.map((c) => [c.id, c]))
    const subwooferParents = new Set((layout?.edges ?? [])
      .filter((edge) => edge.conn.id.startsWith('subwoofer-power-'))
      .map((edge) => edge.conn.id.slice('subwoofer-power-'.length)))
    return (layout?.edges ?? [])
      .flatMap((edge) => {
        if (edge.isPairLink) return [edge]
        if (edge.conn.id.startsWith('subwoofer-power-')) {
          const parent = liveById.get(edge.conn.id.slice('subwoofer-power-'.length))
          if (!parent || (parent.cableType !== 'Power' && parent.cableType !== 'DCPower')) return []
          return [{ ...edge, conn: { ...edge.conn, chargingOnly: parent.chargingOnly } }]
        }
        const live = liveById.get(edge.conn.id)
        if (!live) return []
        // ウーファーへ分けた1本は別の線で描くため、親へ全本数を戻すと二重に数える。
        const conn = subwooferParents.has(live.id) && (live.cableType === 'Power' || live.cableType === 'DCPower')
          ? { ...live, count: Math.max(1, (live.count ?? 2) - 1) }
          : live
        return [{ ...edge, conn }]
      })
      .filter((edge) => !isBadgeOnlyEdge(edge) && edge.conn.chargingOnly !== true)
  }, [layout?.edges, connections])
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const dragX = useSharedValue(0)
  const dragY = useSharedValue(0)
  const dragOwner = useSharedValue('')
  // 配線の SVG 要素。ノードのリサイズ中は onUpdate ごとに再レンダーが走るため、
  // ここを毎回組み立て直すと本数ぶんの Path 生成がフレームに乗る。
  // 見た目は layout・配色だけで決まるので、それらが変わったときだけ作る。
  const drawingEdges = useMemo(() => {
    const stacked = sortEdgesForDrawing(visibleEdges)
    return focusedCableType
      ? stacked.sort((a, b) => Number(a.conn.cableType === focusedCableType) - Number(b.conn.cableType === focusedCableType))
      : stacked
  }, [visibleEdges, focusedCableType])
  const branchJunctions = useMemo(() => branchJunctionsForDrawing(drawingEdges), [drawingEdges])
  const crossingCuts = useMemo(() => crossingCutsForDrawing(drawingEdges), [drawingEdges])
  const addedConnectionIds = useRef(new Set<string>())
  const removalOpacities = useRef(new Map<string, NativeAnimated.Value>())
  const removingConnections = useRef(new Set<string>())
  const connectionOpacity = useCallback((id: string) => {
    const key = id.startsWith('subwoofer-power-') ? id.slice('subwoofer-power-'.length) : id
    let opacity = removalOpacities.current.get(key)
    if (!opacity) {
      opacity = new NativeAnimated.Value(addedConnectionIds.current.has(key) && !reduceMotion ? 0 : 1)
      removalOpacities.current.set(key, opacity)
    }
    return opacity
  }, [reduceMotion])
  useEffect(() => {
    const visibleIds = new Set(visibleEdges.map((edge) => edge.conn.id.startsWith('subwoofer-power-')
      ? edge.conn.id.slice('subwoofer-power-'.length) : edge.conn.id))
    const animations: NativeAnimated.CompositeAnimation[] = []
    for (const id of addedConnectionIds.current) {
      if (!visibleIds.has(id)) continue
      const opacity = connectionOpacity(id)
      if (reduceMotion) {
        opacity.setValue(1)
        addedConnectionIds.current.delete(id)
        continue
      }
      const animation = NativeAnimated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: false })
      animations.push(animation)
      animation.start(({ finished }) => { if (finished) addedConnectionIds.current.delete(id) })
    }
    return () => animations.forEach((animation) => animation.stop())
  }, [visibleEdges, connectionOpacity, reduceMotion])
  const edgePaths = useMemo(() => drawingEdges.map((e) => {
    const focused = focusedCableType == null || e.conn.cableType === focusedCableType
    const wireOpacity = focused ? 1 : 0.12
    if (e.isPairLink) {
      // 左右スピーカーの対を示す装飾線：常に直線・破線で控えめに
      return (
        <DragWirePath edge={e} draggingNode={draggingNode} dragX={dragX} dragY={dragY} key={e.conn.id} d={pointsToPath(e.points)} stroke={C.textMuted}
          strokeWidth={2} strokeOpacity={focusedCableType == null ? 0.5 : 0.1} strokeDasharray="4 4" fill="none" />
      )
    }
    const isWireless = e.conn.cableType === 'wirelessCharging'
    const isBluetooth = e.conn.cableType === 'Bluetooth' || e.conn.cableType === 'XboxWireless' || e.conn.cableType === 'WiFi'
    const isSupport = e.conn.cableType === 'MonitorArm' || e.conn.cableType === 'MicArm'
    const isChargingOnly = e.conn.chargingOnly === true
    const d = isWireless ? wavyPath(e.points) : pointsToRoundedPath(e.points)
    const col = portColor(e.conn.cableType, isDark) ?? '#888'

    // 路線図風：背景色のケーシング（縁取り）を下に敷き、
    // 交差箇所で「下を通る線」に切れ目が入って上下関係が読めるようにする。
    // 交差点では切れ目をさらに広げ、縮小表示でも分岐（丸印）と見分けられるようにする。
    // Bluetooth と充電時のみの配線は点線にして常時接続と区別する。
    return (
      <WireRemovalGroup key={e.conn.id} opacity={connectionOpacity(e.conn.id)}>
        <DragWirePath edge={e} draggingNode={draggingNode} dragX={dragX} dragY={dragY} d={d} stroke={C.bgList} strokeWidth={focused ? WIRE_CASING_WIDTH + (focusedCableType ? 2 : 0) : WIRE_CASING_WIDTH}
          strokeOpacity={wireOpacity} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {!draggingNode && crossingCuts.get(e)?.map((cut) => (
          <Path key={`cut-${cut.x},${cut.y}`} d={crossingCutPath(cut)} stroke={C.bgList}
            strokeWidth={cut.halfWidth * 2} strokeOpacity={wireOpacity} fill="none" />
        ))}
        <DragWirePath edge={e} draggingNode={draggingNode} dragX={dragX} dragY={dragY} d={d} stroke={col} strokeWidth={focused ? WIRE_LINE_WIDTH + (focusedCableType ? 2 : 0) : WIRE_LINE_WIDTH}
          strokeOpacity={wireOpacity} fill="none"
          strokeDasharray={isBluetooth ? '6 5' : isSupport ? '2 4' : isChargingOnly ? '3 5' : undefined}
          strokeLinejoin="round" strokeLinecap="round" />
        {!draggingNode && branchJunctions.get(e)?.map((point) => (
          <Circle key={`${point.x},${point.y}`} cx={point.x} cy={point.y}
            r={WIRE_LINE_WIDTH} fill={col} opacity={wireOpacity} />
        ))}
      </WireRemovalGroup>
    )
  }), [drawingEdges, branchJunctions, crossingCuts, focusedCableType, C.textMuted, C.bgList, isDark, draggingNode, dragX, dragY, connectionOpacity])
  // 同じ組み合わせを複数本で繋いでいる線（ステレオの L/R・デュアル電源）。
  // 線を増やすと配置が変わるので、1本の線に本数だけ載せる。
  // 線とは別に、全部の線を引いたあとに重ねる。線と同じ Fragment に入れると、
  // 後から引いた線の縁取りが上を横切ったときに文字が欠ける
  const edgeCountLabels = useMemo(() => visibleEdges.map((e) => {
    if (e.isPairLink || (e.conn.count ?? 1) <= 1 || e.from.id === draggingNode || e.to.id === draggingNode) return null
    const mid = polylineMidpoint(e.points)
    if (!mid) return null
    const col = portColor(e.conn.cableType, isDark) ?? '#888'
    return (
      <WireRemovalGroup key={`count-${e.conn.id}`} opacity={connectionOpacity(e.conn.id)}>
        {/* 背景色で1枚敷いてから本体を重ねる。線の上に置くので、これが無いと読めない
            （SVG の paint-order は react-native-svg の型に無い） */}
        <SvgText
          x={mid.x} y={mid.y - 5} stroke={C.bgList} strokeWidth={4} fill={C.bgList}
          fontSize={11} fontWeight="700" textAnchor="middle"
        >
          {`×${e.conn.count}`}
        </SvgText>
        <SvgText
          x={mid.x} y={mid.y - 5} fill={col}
          fontSize={11} fontWeight="700" textAnchor="middle"
        >
          {`×${e.conn.count}`}
        </SvgText>
      </WireRemovalGroup>
    )
  }), [visibleEdges, C.bgList, isDark, draggingNode, connectionOpacity])

  // ノードカードへ渡す「原点に寄せた同じノード」。位置は親のラッパー側で持つ。
  // 毎レンダー {...n, x: 0, y: 0} を作ると参照が変わって NodeCard の memo が効かず、
  // リサイズ中（毎フレーム setState）に全ノードのラベル文字サイズ計算が走り直す。
  // 線（visibleEdges）と同じ理由で、カードに出すガジェットも今の gadgets から引き直す。
  // layout.nodes の gadget はキャッシュのキー外の項目（給電方法＝電池バッジ等）が古いまま返る。
  // コンセント等の擬似ノードは gadgets に居ないので layout のものを使う
  const nodeCardModels = useMemo(() => {
    const liveById = new Map(gadgets.map((g) => [g.id, g]))
    return new Map(visibleNodes.map((n) => [n.id, { ...n, x: 0, y: 0, gadget: liveById.get(n.gadget.id) ?? n.gadget }]))
  }, [visibleNodes, gadgets])

  const wifiGadgetIds = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of layout?.edges ?? []) {
      if (edge.conn.cableType !== 'WiFi') continue
      ids.add(edge.conn.fromGadgetId)
      ids.add(edge.conn.toGadgetId)
    }
    return ids
  }, [layout?.edges])
  const usedCableTypes = useMemo(() => {
    const types = new Set<CableType>()
    for (const edge of visibleEdges) {
      if (edge.isPairLink) continue
      types.add(edge.conn.cableType)
    }
    // 必要なケーブル・つなぎ方・機材タブのケーブルと同じ種類の順にする。選ぶ候補の順
    // （CABLE_OPTIONS）で並べていて、同じデスクのケーブルが画面ごとに違う順で出ていた。
    // 種類の順に無い無線・アーム類は後ろへ、その中は CABLE_OPTIONS の順
    const optionRank = (type: CableType) => {
      const index = CABLE_OPTIONS.indexOf(type)
      return index < 0 ? CABLE_OPTIONS.length : index
    }
    return [...types].sort((a, b) => cableSortRank(a) - cableSortRank(b) || optionRank(a) - optionRank(b))
  }, [visibleEdges])
  const cableTypeCounts = useMemo(() => {
    const counts = new Map<CableType, number>()
    for (const edge of visibleEdges) {
      if (edge.isPairLink) continue
      const count = requiresPhysicalCable(edge.conn.cableType) ? (edge.conn.count ?? 1) : 1
      counts.set(edge.conn.cableType, (counts.get(edge.conn.cableType) ?? 0) + count)
    }
    return counts
  }, [visibleEdges])
  useEffect(() => {
    if (focusedCableType && !usedCableTypes.includes(focusedCableType)) setFocusedCableType(null)
  }, [focusedCableType, usedCableTypes])

  const cableTypeLabel = (type: CableType) => {
    return lang === 'ja' ? (CHIP_LABEL_JA[type] ?? cableLabel(type, lang)) : cableLabel(type, lang)
  }

  const byId = useMemo(() => new Map(gadgets.map((g) => [g.id, g])), [gadgets])
  // 一覧は機材タブと同じ順で出す。gadgets の順（登録の新しい順）のままだと、同じデスクの機材が
  // 機材タブとシートで違う順に並ぶ
  const listedGadgets = useMemo(() => {
    if (!listOrder || listOrder.length === 0) return gadgets
    const rank = new Map(listOrder.map((id, index) => [id, index]))
    return [...gadgets].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
  }, [gadgets, listOrder])
  const decorGadgets = useMemo(() => listedGadgets.filter((g) => g.displayOnly), [listedGadgets])
  const wireableGadgets = useMemo(() => listedGadgets.filter((g) => !g.displayOnly), [listedGadgets])
  const nameOf = (id: string) => {
    const base = baseMapNodeId(id)
    const name = base === WALL_ID ? T('コンセント', 'Outlet')
      : base === SOLAR_ID ? T('ソーラーパネル', 'Solar panel')
      : base === BATTERY_ID ? T('電池・バッテリー', 'Battery')
      : base === DECOR_ID ? T('飾り', 'Decor')
      : byId.get(base)?.name ?? '—'
    // L・R・ウーファーは1台のスピーカーから分かれた仮想ノード。base はどれも同じ
    // ガジェットIDに戻るので、どこを指しているかを名前へ添えないと、接続の一覧に
    // 同じ名前が並んで見分けられない
    if (id.endsWith('__SUB')) return `${name} (${T('ウーファー', 'Subwoofer')})`
    if (id.endsWith('__L')) return `${name} (L)`
    if (id.endsWith('__R')) return `${name} (R)`
    return name
  }

  // 自分の配線図は常に編集可能。共有側は layoutEditable が明示された場合だけ配置を編集できる。
  const effectiveEditMode = !readOnly || !!layoutEditable

  // 配置モードの間は線を引かない。配置が済んで「配線する」を押したら、その位置を
  // 基準に1回だけ経路を計算する
  const wiresHidden = !!placementMode || awaitingWiring
  // 配置モードでは接続の追加・変更の入口を閉じる（線を出していない段階で
  // 線を足せてしまうと、押しても何も起きていないように見える）。移動・リサイズは通す
  const wiringEditable = !readOnly && effectiveEditMode && !placementMode
  const confirmPlacement = useCallback(() => {
    // 別の指で機材を動かしている最中に押されたら受けない。その移動は指を離したときに
    // 差分へ足されるので、ここで確定すると動かした分を落として配線を組んでしまう
    if (activeNodeGesture.current || relayouting) return
    const delta = placementDeltaRef.current
    placementDeltaRef.current = null
    const moved = delta != null && Object.values(delta).some((d) => d.dx !== 0 || d.dy !== 0)
    // 動かしていなければ、いま持っている layout の経路がそのまま使える（計算し直さない）
    if (!moved) {
      onConfirmPlacement?.(false, nodeOffsets)
      return
    }
    const base = nodeOffsets ?? {}
    const next = { ...base }
    for (const node of layout?.nodes ?? []) {
      next[node.id] = offsetAfterMove(base[node.id] ?? { dx: 0, dy: 0 }, node, 0, 0)
    }
    // 呼び元へ完成形を先に渡す。既存画面はここで取り消し通知を抑止し、新規作成画面は
    // この値を使って生成を始める。そのあと同じ値を保存経路へ流す。
    onConfirmPlacement?.(true, next)
    setAwaitingWiring(true)
    onNodeOffsetsChange?.(next)
  }, [nodeOffsets, onNodeOffsetsChange, onConfirmPlacement, layout, relayouting])

  // ── ジェスチャ（ピンチ＋パン）──
  // 表示用の値とパン・ピンチが読み書きする状態はすべて SharedValue にする。
  // これで指の追従が UI スレッドだけで完結し、レイアウト再計算や再レンダリングで
  // JS スレッドが詰まっていてもパン・ズームが止まらない。
  const vp = useRef({ w: 0, h: 0 }).current
  // 下端の操作行の高さ。キャンバスは画面の下まで使い、全体表示のときだけこの帯を避ける
  const fitBottomInsetRef = useRef(0)
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
  const scale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedS = useSharedValue(1)
  const pinchNeedsRebase = useSharedValue(false)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  const [cableLegendCollapsed, setCableLegendCollapsed] = useState(cableLegendCollapsedLast)
  const cableLegendCollapsedRef = useRef(cableLegendCollapsedLast)
  // 「？」の吹き出しで指す所。隠れたタブにある間は測っても見えないので飛ばされる
  const mapTarget = useCoachTarget('map')
  const editTarget = useCoachTarget(active && effectiveEditMode && onNodeOffsetsChange && onNodeSizesChange ? 'map-edit' : null)
  const viewportRef = useAnimatedRef<View>()
  const setViewportRef = useCallback((view: View | null) => {
    viewportRef(view)
    mapTarget?.(view)
    editTarget?.(view)
  }, [viewportRef, mapTarget, editTarget])
  const legendTarget = useCoachTarget('map-legend')
  const fitTarget = useCoachTarget('map-fit')
  const addTarget = useCoachTarget('map-add')
  const compactLegendViewportRef = useRef(false)
  const setLegendCollapsed = (next: boolean) => {
    cableLegendCollapsedRef.current = next
    cableLegendCollapsedLast = next
    setCableLegendCollapsed(next)
  }
  const toggleCableLegend = () => {
    setLegendCollapsed(!cableLegendCollapsedRef.current)
  }
  const focusCableType = (type: CableType) => {
    setFocusedCableType((current) => current === type ? null : type)
    // 選択直後は図を見たいので凡例を閉じる。選択中の種類は閉じた見出しにも残る。
    setLegendCollapsed(true)
  }

  // ピンチで縮小できる下限。ガジェットが多い配線図は全体表示（fit）の倍率自体が小さくなるため、
  // 下限を固定値にすると「開いた時点で既に下限」となり、ピンチしても何も起きない
  // （＝拡大縮小を受け付けない）状態になる。全体表示の倍率より必ず下に取る。
  const minScale = useSharedValue(0.35)
  const editingGesture = useSharedValue(false)

  // 中央合わせ。キャンバス（layout.width/height）ではなく、実際にノードと配線が占めている
  // 範囲を基準にする。キャンバスは左右の帯ぶんを予約しているため、
  // 片側の帯が空のときにキャンバス基準で中央合わせすると、図が片側に寄って
  // 反対側に大きな余白ができてしまう。
  const fit = () => {
    if (!layout) return
    const b = { ...layout.bounds }
    for (const edge of visibleEdges) {
      for (const point of edge.points) {
        b.minX = Math.min(b.minX, point.x)
        b.minY = Math.min(b.minY, point.y)
        b.maxX = Math.max(b.maxX, point.x)
        b.maxY = Math.max(b.maxY, point.y)
      }
    }
    if (plan.templateId) {
      const focusNode = layout.nodes.find((node) => node.gadget.category === 'Monitor')
        ?? layout.nodes.find((node) => node.gadget.category === 'PC' && node.gadget.pcFormFactor === 'laptop')
      if (focusNode) {
        const radius = Math.max(focusNode.cx - b.minX, b.maxX - focusNode.cx)
        b.minX = focusNode.cx - radius
        b.maxX = focusNode.cx + radius
      }
    }
    const cw = Math.max(1, b.maxX - b.minX)
    const ch = Math.max(1, b.maxY - b.minY)
    const fitH = Math.max(1, vp.h - fitBottomInsetRef.current)
    const sw = vp.w > 0 ? Math.max(1, vp.w - FIT_PADDING * 2) / cw : 1
    const sh = vp.h > 0 ? Math.max(1, fitH - FIT_PADDING * 2) / ch : 1
    const s0 = Math.min(1, sw, sh)

    const contentCx = (b.minX + b.maxX) / 2
    const contentCy = (b.minY + b.maxY) / 2
    const x0 = vp.w / 2 - s0 * contentCx
    const y0 = fitH / 2 - s0 * contentCy

    minScale.value = Math.min(0.35, s0 * 0.6)
    savedS.value = s0; savedX.value = x0; savedY.value = y0
    scale.value = s0; tx.value = x0; ty.value = y0
    pinchNeedsRebase.value = true
  }

  // 中央合わせ：ビューポートのサイズ確定（onViewportLayout）とレイアウト計算完了（非同期）は
  // どちらが先に起きるか保証がなく、さらに配線図タブは非表示のまま先にマウントされるため
  // 最初の onLayout はサイズ 0 で来ることがある。「一度だけ fit する」実装だとその 0 の
  // タイミングを初回とみなしてしまい、以降ずっと中央に来ない。
  // そこで、ユーザーがまだ自分で拡大縮小・移動していない間は、サイズやレイアウトが
  // 確定するたびに何度でも中央合わせし直す。
  const userAdjusted = useSharedValue(false)
  const tryFit = () => {
    if (userAdjusted.value || !layout || vp.w <= 0 || vp.h <= 0) return
    fit()
  }


  // 「全体」で枠を広げたとき、広がり終えた寸法でもう一度合わせる（押した時点の枠はまだ狭い）
  const refitOnResizeRef = useRef(false)
  const handleFitPress = () => {
    if (activeNodeGesture.current || pinching.value) return
    userAdjusted.value = false
    if (onFitPress?.()) refitOnResizeRef.current = true
    fit()
  }

  const onViewportLayout = (e: any) => {
    const { width, height } = e.nativeEvent.layout
    if (width > 0 && height > 0) {
      const compact = width < 360 || height < 300
      // 狭いキャンバスでは展開済みの凡例が下部HUDまで塞ぐ。狭くなった瞬間だけ畳み、
      // その後ユーザーが展開した場合は、次の画面サイズ変更まで選択を尊重する。
      if (compact && !compactLegendViewportRef.current && !cableLegendCollapsedRef.current) {
        setLegendCollapsed(true)
      }
      compactLegendViewportRef.current = compact
    }
    if (width === vp.w && height === vp.h) return
    vp.w = width
    vp.h = height
    setViewportSize({ w: width, h: height })
    if (refitOnResizeRef.current && width > 0 && height > 0) {
      refitOnResizeRef.current = false
      fit()
      return
    }
    tryFit()
  }

  // 「再構成」「すべて削除」の直後は、ユーザーが動かしたあとでも新しいレイアウトへ中央合わせする
  const pendingFitRef = useRef(false)
  useEffect(() => {
    if (pendingFitRef.current) {
      pendingFitRef.current = false
      userAdjusted.value = false
      fit()
      return
    }
    tryFit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, active, readOnly, usedCableTypes.length])

  useLayoutEffect(() => {
    if (!layoutRestoreRequest || !layout || displayedInputKeyRef.current !== layoutInputKey) return
    const nodes = layout.nodes.filter(node => layoutRestoreRequest.nodeIds.includes(node.id))
    if (active && nodes.length && vp.w > 0 && vp.h > 0) {
      const bounds = {
        minX: Math.min(...nodes.map(node => node.x)), maxX: Math.max(...nodes.map(node => node.x + node.w)),
        minY: Math.min(...nodes.map(node => node.y)), maxY: Math.max(...nodes.map(node => node.y + node.h)),
      }
      const pan = layoutRestorePan(bounds, { w: vp.w, h: Math.max(1, vp.h - fitBottomInsetRef.current) }, scale.value, tx.value, ty.value)
      savedX.value = tx.value = pan.x
      savedY.value = ty.value = pan.y
      pinchNeedsRebase.value = true
    }
    layoutRestoreRequest.onComplete()
  }, [layoutRestoreRequest, layout, layoutInputKey, active, vp, scale, tx, ty, savedX, savedY, pinchNeedsRebase])

  // パンとピンチは Simultaneous で同時に走りうる。どちらも saved を書き換えると
  // 移動量が二重に適用され、2本目の指を置いた瞬間に図が別の場所へ飛ぶ。
  // ・パンはイベント間の差分を足し、ピンチ中に蓄積された移動をあとから重ねない
  // ・ピンチ中はパンの反映を止める（ピンチ側が焦点固定で平行移動も行うため）
  const pinching = useSharedValue(false)

  const panG = useMemo(() =>
    Gesture.Pan()
      .minDistance(8)
      .maxPointers(1)
      // iPad のトラックパッドの二本指スクロールでも図を動かせるようにする
      // （既定ではクリックしたままのドラッグしか届かず、ピンチだけ効いて移動できなかった）
      .enableTrackpadTwoFingerGesture(true)
      // saved は onEnd を待たずに毎フレーム合わせる。着信やコントロールセンターでパンが
      // 中断されると onEnd が来ず、見た目だけ動いた位置から次のパン・ピンチが古い起点で始まって飛ぶ
      .onChange((e) => {
        'worklet'
        if (pinching.value || editingGesture.value) return
        tx.value += e.changeX
        ty.value += e.changeY
        savedX.value = tx.value
        savedY.value = ty.value
        userAdjusted.value = true
      })
  , []) // eslint-disable-line react-hooks/exhaustive-deps

  // ピンチ開始時の状態（焦点＝指の中点を固定して拡大縮小するため）
  const pinchStartS = useSharedValue(1)
  const pinchStartX = useSharedValue(0)
  const pinchStartY = useSharedValue(0)
  const pinchStartFx = useSharedValue(0)
  const pinchStartFy = useSharedValue(0)
  // 起点を取った時点の e.scale。iOS のピンチは指が1本になっても終わらず、焦点が残った指へ
  // 飛ぶので、1本の間は動かさず、2本に戻った時点を新しい起点にする
  const pinchBaseScale = useSharedValue(1)

  const pinchG = useMemo(() =>
    Gesture.Pinch()
      .onStart(() => {
        'worklet'
        pinching.value = true
        pinchNeedsRebase.value = true
      })
      .onUpdate((e) => {
        'worklet'
        if (editingGesture.value || e.numberOfPointers < 2 || !(e.scale > 0)) { pinchNeedsRebase.value = true; return }
        if (pinchNeedsRebase.value) {
          pinchNeedsRebase.value = false
          pinchStartS.value = savedS.value
          pinchStartX.value = savedX.value
          pinchStartY.value = savedY.value
          pinchStartFx.value = e.focalX
          pinchStartFy.value = e.focalY
          pinchBaseScale.value = e.scale
        }
        const s = Math.min(MAX_CANVAS_SCALE, Math.max(minScale.value, pinchStartS.value * e.scale / pinchBaseScale.value))
        const k = s / pinchStartS.value
        const nx = e.focalX - k * (pinchStartFx.value - pinchStartX.value)
        const ny = e.focalY - k * (pinchStartFy.value - pinchStartY.value)
        scale.value = s
        tx.value = nx
        ty.value = ny
        savedS.value = s
        savedX.value = nx
        savedY.value = ny
        userAdjusted.value = true
      })
      // 指を離したあと、次のパンが「ピンチ後の位置」を起点にできるようにフラグを戻す
      .onFinalize(() => { 'worklet'; pinching.value = false })
  , []) // eslint-disable-line react-hooks/exhaustive-deps

  // 非表示で事前マウントしたときに panG/pinchG 自体を disabled にすると、表示後も
  // 同じネイティブハンドラが無効状態のまま残る端末がある。操作用ジェスチャーは常に
  // enabled のまま保持し、非表示時だけ別の無効ジェスチャーへ差し替える。
  // パン・ピンチが書き込む SharedValue をそのまま transform に流す。
  // JS スレッドを一切経由しないので、レイアウト再計算中でも指に追従し続ける
  const canvasStyle = useAnimatedStyle(() => ({
    // 再配線でキャンバス寸法が変わっても、拡大の原点を動かさない。
    transformOrigin: [0, 0, 0],
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  const composed = useMemo(() => Gesture.Simultaneous(panG, pinchG), [panG, pinchG])
  const disabledGesture = useMemo(() => Gesture.Native().enabled(false), [])

  const openPickedEdge = (edge: MapEdge) => {
    if (removingConnections.current.has(edge.conn.id)) return
    setEdgeCandidates([])
    // 左右スピーカー・ウーファーの関係線は配線編集の対象ではないので、ノードタップと同じ反応にする
    if (edge.isPairLink) { onNodeTap(edge.conn.fromGadgetId); return }
    // ウーファーへ分けた電源線もレイアウト専用。保存データには親スピーカーへの×2として持つ
    if (edge.conn.id.startsWith('subwoofer-power-')) { onNodeTap(edge.conn.toGadgetId); return }
    const current = connections.find((connection) => connection.id === edge.conn.id)
    if (current) setEdgeEdit(current)
  }

  // タップ座標(content系)に近い配線を選ぶ（表示中の配線のみ対象）。交差点や
  // 並走区間では距離がほぼ同じ線を候補として出し、配列順だけで別の線を開かない。
  const pickEdge = (x: number, y: number) => {
    if (draggingNode || dragOwner.value) return
    // locationX/Y は縮小前のキャンバス座標。全体表示で縮小しても、画面上の
    // 当たり判定が24pxより細くならないよう現在倍率で戻す。
    const touchTolerance = WIRE_TAP_TOLERANCE / Math.max(scale.value, 0.1)
    const ambiguity = WIRE_PICK_AMBIGUITY / Math.max(scale.value, 0.1)
    const pickableEdges = focusedCableType
      ? visibleEdges.filter((edge) => edge.conn.cableType === focusedCableType)
      : visibleEdges
    const ranked = pickableEdges.map((edge) => {
      let distance = Infinity
      for (let i = 0; i < edge.points.length - 1; i++) {
        distance = Math.min(distance, distToSeg(x, y, edge.points[i], edge.points[i + 1]))
      }
      return { edge, distance }
    }).filter(({ distance }) => distance <= touchTolerance)
      .sort((a, b) => a.distance - b.distance)
    const best = ranked[0]
    if (!best) return
    const candidates = ranked
      .filter(({ distance }) => distance <= best.distance + ambiguity)
      .map(({ edge }) => edge)
    if (candidates.length > 1) {
      setEdgeCandidates(candidates)
      return
    }
    openPickedEdge(best.edge)
  }

  // ── 編集インタラクション状態 ──
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const [methodFor, setMethodFor] = useState<{ from: string; to: string } | null>(null)
  const [edgeEdit, setEdgeEdit] = useState<MapConnection | null>(null)
  const [edgeCandidates, setEdgeCandidates] = useState<MapEdge[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [decorListOpen, setDecorListOpen] = useState(false)
  const [wirelessPickerFor, setWirelessPickerFor] = useState<string | null>(null)
  // 接続を足すシートは1回開くごとに1回だけ足す。閉じる前に「追加」が2回通ると、同じ2台・同じ種別は
  // 線ではなく本数に足す（addConnection）ので、黙って ×2 になる。配線の再計算で JS が詰まっていると
  // 2回のタップが再描画の前に続けて届く
  const addLockRef = useRef(false)
  useEffect(() => {
    if (addOpen || methodFor) addLockRef.current = false
  }, [addOpen, methodFor])
  // 「接続先をタップ」の途中で、つなぎ元を機材タブから外したり編集できない状態になったら取りやめる。
  // 残すと次に触った機材への接続方法が開き、図に居ない機材への線が保存されていた
  useEffect(() => {
    if (pendingFrom && (!wiringEditable || !byId.has(pendingFrom))) setPendingFrom(null)
  }, [pendingFrom, wiringEditable, byId])

  // 取り回しの長さ・メモは打っている間ここに置き、シートを閉じるか、シートで別の編集をする直前に
  // 1回だけ保存する。1文字ごとに onChange を呼ぶと、そのたびにデスクを丸ごと保存し、
  // 取り消しの控えも1文字前で取り直すので「取り消す」で最後の1文字しか戻らなかった
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null)
  const routeDraftRef = useRef<RouteDraft | null>(null)
  const editRouteDraft = (id: string, patch: Omit<RouteDraft, 'id'>) => {
    const base = routeDraftRef.current?.id === id ? routeDraftRef.current : { id }
    const next = { ...base, ...patch }
    routeDraftRef.current = next
    setRouteDraft(next)
  }
  const flushRouteDraft = (): ((current: MapConnection[]) => MapConnection[]) | null => {
    const draft = routeDraftRef.current
    if (!draft) return null
    routeDraftRef.current = null
    setRouteDraft(null)
    const patch = routePatchOfDraft(draft)
    const current = connections.find((item) => item.id === draft.id)
    const unchanged = !!current && (Object.keys(patch) as (keyof RoutePatch)[])
      .every((key) => current.route?.[key] === patch[key])
    if (unchanged) return null
    const apply = applyRoutePatch(draft.id, patch)
    onChange?.(apply)
    return apply
  }

  // 編集は関数のまま呼び元へ渡し、保存時点の最新の線に当ててもらう（onChange の注記）。
  // 戻り値は今の props に当てた結果で、編集シートの表示を先に更新するためだけに使う。
  // 取り回しの下書きは別の1回として先に保存する。混ぜると、この編集の取り消しで打った文字まで戻る
  const mutate = (update: (current: MapConnection[]) => MapConnection[]): MapConnection[] => {
    const flushed = flushRouteDraft()
    onChange?.(update)
    return update(flushed ? flushed(connections) : connections)
  }
  const updateRoute = (connection: MapConnection, patch: RoutePatch) => {
    const next = mutate(applyRoutePatch(connection.id, patch))
    setEdgeEdit(next.find((item) => item.id === connection.id) ?? { ...connection, route: { ...connection.route, ...patch } })
  }
  const closeEdgeEdit = () => {
    flushRouteDraft()
    setEdgeEdit(null)
  }
  const edgeRouteDraft = edgeEdit && routeDraft?.id === edgeEdit.id ? routeDraft : null

  const isAcDistributor = (gadget?: Gadget) => !!gadget && (
    gadget.category === 'PowerStrip' ||
    gadget.category === 'UPS' ||
    (gadget.category === 'SmartHome' && gadget.ports.some((port) =>
      port.type === 'Power' && (port.direction === 'output' || port.direction === 'bidirectional'),
    ))
  )
  const isEditableAcConnection = (connection: MapConnection) =>
    connection.cableType === 'Power' &&
    !isAcDistributor(byId.get(connection.toGadgetId)) &&
    (connection.fromGadgetId === WALL_ID || isAcDistributor(byId.get(connection.fromGadgetId)))
  const powerSourceOptions = (connection: MapConnection) => {
    // 口の数は線の数ではなく本数で数える。デュアル電源の PC（×2）は1本の線で2口ふさぐ
    const outletsUsed = (items: MapConnection[]) => items.reduce((n, item) => n + (item.count ?? 1), 0)
    const needed = connection.count ?? 1
    const wallCapacity = Math.max(0, Math.floor(plan.outletCount ?? 2))
    const wallUsedByOthers = outletsUsed(connections.filter((item) =>
      item.id !== connection.id && item.fromGadgetId === WALL_ID && item.cableType === 'Power',
    ))
    const options = [{
      id: WALL_ID,
      label: T('壁コンセント', 'Wall outlet'),
      remaining: Math.max(0, wallCapacity - wallUsedByOthers),
      available: wallUsedByOthers + needed <= wallCapacity,
    }]
    for (const source of gadgets.filter(isAcDistributor)) {
      if (source.id === connection.toGadgetId) continue
      const powered = connections.some((item) =>
        item.toGadgetId === source.id && item.cableType === 'Power',
      )
      const capacity = source.ports.reduce((total, port) => total + (
        port.type === 'Power' && (port.direction === 'output' || port.direction === 'bidirectional')
          ? Math.max(0, port.count)
          : 0
      ), 0)
      const usedByOthers = outletsUsed(connections.filter((item) =>
        item.id !== connection.id && item.fromGadgetId === source.id && item.cableType === 'Power',
      ))
      options.push({
        id: source.id,
        label: source.name,
        remaining: Math.max(0, capacity - usedByOthers),
        available: powered && usedByOthers + needed <= capacity,
      })
    }
    return options
  }
  const changePowerSource = (connection: MapConnection, sourceId: string) => {
    if (connection.fromGadgetId === sourceId) return
    const replacementId = `map-manual-${Date.now()}`
    const replace = (item: MapConnection): MapConnection => ({
      ...item,
      id: replacementId,
      fromGadgetId: sourceId,
      origin: 'manual',
      confirmed: true,
      sourcePortId: undefined,
    })
    // 表示も mutate の結果から取る。手元の connection には直前に保存した取り回しの下書きが入っていない
    const next = mutate((cur) => cur.map((item) => item.id === connection.id ? replace(item) : item))
    setEdgeEdit(next.find((item) => item.id === replacementId) ?? replace(connection))
  }

  // ── 2in1・3in1 ケーブル（1本が枝分かれして複数へ挿さる）──
  // 分岐ケーブルを持っているかは本人にしか分からないので、自動では束ねずここで宣言してもらう。
  // まとめられるのは同じ機器から出ている有線どうし（＝分岐元が1つに定まる組み合わせ）だけ。
  const branchOptions = (connection: MapConnection) => {
    if (connection.wireless || !requiresPhysicalCable(connection.cableType)) return []
    return connections.filter((item) =>
      item.id !== connection.id &&
      item.fromGadgetId === connection.fromGadgetId &&
      !item.wireless &&
      requiresPhysicalCable(item.cableType),
    )
  }
  const isBranchedWith = (connection: MapConnection, other: MapConnection) =>
    !!connection.branchGroupId && connection.branchGroupId === other.branchGroupId
  const toggleBranch = (connection: MapConnection, otherId: string) => {
    if (!connections.some((item) => item.id === otherId)) return
    const next = mutate((cur) => {
      const self = cur.find((item) => item.id === connection.id)
      const other = cur.find((item) => item.id === otherId)
      if (!self || !other) return cur
      const linked = isBranchedWith(self, other)
      // 解除は操作した線だけを抜く。3本目以降が残っていれば、その枝はまとまったまま。
      const groupId = other.branchGroupId ?? self.branchGroupId ?? `branch-${self.id}`
      const applied = cur.map((item) => {
        if (item.id === self.id) {
          return { ...item, branchGroupId: linked ? undefined : groupId, confirmed: true }
        }
        if (item.id === other.id && !linked) {
          return { ...item, branchGroupId: groupId, confirmed: true }
        }
        return item
      })
      // 相方が居なくなったグループは分岐ではないので宣言ごと落とす
      const remaining = new Map<string, number>()
      for (const item of applied) {
        if (!item.branchGroupId) continue
        remaining.set(item.branchGroupId, (remaining.get(item.branchGroupId) ?? 0) + 1)
      }
      return applied.map((item) =>
        item.branchGroupId && remaining.get(item.branchGroupId)! < 2
          ? { ...item, branchGroupId: undefined }
          : item,
      )
    })
    setEdgeEdit(next.find((item) => item.id === connection.id) ?? null)
  }

  // ── ノードのドラッグ微調整（長押しでドラッグ開始 → 離すと保存＆配線引き直し）──
  // 配置モードの下部バーの実測高さ。図の描画領域をこのぶん上で終わらせて、
  // 図がバーの裏に潜らないようにする（バーは中身が2行に折り返すと高さが変わるので測る）
  const [placementBarH, setPlacementBarH] = useState(0)
  // 掴んでいる機材の移動量（content 座標）。指への追従は UI スレッドだけで完結させる。
  // JS スレッドで値を入れていた頃は、機材の多い配置の画面などで JS が詰まると機材が指から遅れた
  // 掴んでいる機材の id（空なら誰も掴んでいない）と、掴んだ時点の図の倍率
  const dragScale = useSharedValue(1)
  // 離したあと、配線の引き直しまで離した位置で待たせている間。次の機材を掴ませて上書きさせない
  const dragHold = useSharedValue(false)
  const dragTracking = useSharedValue(false)
  const dragMoved = useSharedValue(false)
  const dragRawX = useSharedValue(0)
  const dragRawY = useSharedValue(0)
  const dragStartPan = useSharedValue({ x: 0, y: 0 })
  const dragPointer = useSharedValue({ x: 0, y: 0 })
  const dragViewport = useSharedValue({ x: 0, y: 0, w: 0, h: 0 })
  const dragBottomInset = useSharedValue(0)
  const dragNode = useSharedValue<PlacementRect | null>(null)
  const dragPeers = useSharedValue<PlacementRect[]>([])
  const dragNodes = useSharedValue<PlacementRect[]>([])
  const dragGuides = useSharedValue<{ x: number | null; y: number | null }>({ x: null, y: null })
  const dragDestination = useSharedValue<{ dx: number; dy: number; valid: boolean; adjusted: boolean }>({ dx: 0, dy: 0, valid: false, adjusted: false })
  const dragLastValid = useSharedValue<{ x: number; y: number } | null>(null)
  useEffect(() => {
    dragNodes.value = (layout?.nodes ?? []).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))
  }, [layout, dragNodes])
  useEffect(() => { dragBottomInset.value = placementMode ? placementBarH + 80 : 80 }, [placementMode, placementBarH, dragBottomInset])
  const updateDragPosition = () => {
    'worklet'
    if (!dragNode.value || !dragMoved.value) return
    const next = resolvePlacementDrag(dragNode.value, dragPeers.value,
      dragRawX.value + (dragStartPan.value.x - tx.value) / dragScale.value,
      dragRawY.value + (dragStartPan.value.y - ty.value) / dragScale.value,
      6 / dragScale.value)
    dragX.value = next.dx; dragY.value = next.dy
    dragGuides.value = { x: next.guideX, y: next.guideY }
    const target = nearestPlacement(dragNode.value, dragPeers.value,
      dragNode.value.x + next.dx, dragNode.value.y + next.dy)
    if (target) dragLastValid.value = target
    const destination = target ?? dragLastValid.value
    dragDestination.value = {
      dx: destination ? destination.x - dragNode.value.x : 0,
      dy: destination ? destination.y - dragNode.value.y : 0,
      valid: destination !== null,
      adjusted: !target || target.x !== dragNode.value.x + next.dx || target.y !== dragNode.value.y + next.dy,
    }
  }
  useFrameCallback((frame) => {
    'worklet'
    if (!dragTracking.value || !dragMoved.value || pinching.value) return
    const dt = Math.min(32, frame.timeSincePreviousFrame ?? 16) / 1000
    const area = dragViewport.value
    const panX = placementEdgeVelocity(dragPointer.value.x, area.w) * dt
    const panY = placementEdgeVelocity(dragPointer.value.y, Math.max(0, area.h - dragBottomInset.value)) * dt
    const node = dragNode.value
    if ((panX === 0 && panY === 0) || !node) return
    const bounds = placementMoveBounds(node, dragPeers.value)
    const nextX = boundedPlacementPan(tx.value, panX,
      dragStartPan.value.x + (dragRawX.value - bounds.maxX + node.x) * dragScale.value,
      dragStartPan.value.x + (dragRawX.value - bounds.minX + node.x) * dragScale.value)
    const nextY = boundedPlacementPan(ty.value, panY,
      dragStartPan.value.y + (dragRawY.value - bounds.maxY + node.y) * dragScale.value,
      dragStartPan.value.y + (dragRawY.value - bounds.minY + node.y) * dragScale.value)
    // カメラと移動量を同じフレームで更新して、掴んだ位置を指の下に保つ。
    tx.value = nextX; ty.value = nextY
    savedX.value = tx.value; savedY.value = ty.value
    updateDragPosition()
  })
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.value }, { translateY: dragY.value }] }))
  const destinationStyle = useAnimatedStyle(() => ({
    opacity: dragTracking.value && dragDestination.value.valid ? 1 : 0,
    left: (dragNode.value?.x ?? 0) + dragDestination.value.dx - 3 / scale.value,
    top: (dragNode.value?.y ?? 0) + dragDestination.value.dy - 3 / scale.value,
    width: (dragNode.value?.w ?? 0) + 6 / scale.value,
    height: (dragNode.value?.h ?? 0) + 6 / scale.value,
    borderWidth: 1.5 / scale.value,
  }))
  const adjustedDestinationStyle = useAnimatedStyle(() => ({
    opacity: dragTracking.value && dragDestination.value.adjusted && dragDestination.value.valid ? 1 : 0,
  }))
  const blockedDestinationStyle = useAnimatedStyle(() => ({
    opacity: dragTracking.value && dragDestination.value.adjusted && !dragDestination.value.valid ? 1 : 0,
  }))
  const guideXStyle = useAnimatedStyle(() => ({
    opacity: dragTracking.value && dragGuides.value.x !== null ? 1 : 0,
    left: dragGuides.value.x ?? 0, width: 1 / scale.value,
  }))
  const guideYStyle = useAnimatedStyle(() => ({
    opacity: dragTracking.value && dragGuides.value.y !== null ? 1 : 0,
    top: dragGuides.value.y ?? 0, height: 1 / scale.value,
  }))
  // 掴んだ機材の表示から移動量が外れてから戻す（先に戻すと、引き直し前の古い位置へ一瞬戻って見える）
  useEffect(() => {
    if (draggingNode !== null) return
    dragX.value = 0
    dragY.value = 0
    dragHold.value = false
  }, [draggingNode, dragX, dragY, dragHold])

  // 親から渡される最新値をrefに保持する（ジェスチャーはノードIDごとに1回だけ生成してキャッシュし、
  // 再レンダーのたびに Gesture.Pan()/.Pinch() を作り直して GestureDetector を再登録するコストを避けるため。
  // コールバック内はこの ref 経由で読むことで、クロージャの陳腐化なく最新値を参照できる）
  // 「長押しで動かせる」ことは画面上に手がかりが無く、初回案内で一度言うだけだった。
  // 実際に1回動かすまでは、キャンバスの下にヒントを出す。
  const [moveHintDone, setMoveHintDone] = useState(true)
  useEffect(() => {
    if (readOnly && !layoutEditable) return
    let alive = true
    AsyncStorage.getItem(MOVE_HINT_KEY)
      .then((v) => { if (alive) setMoveHintDone(v === '1') })
      .catch(() => {})
    return () => { alive = false }
  }, [readOnly, layoutEditable])

  const dismissMoveHint = useCallback(() => {
    setMoveHintDone(true)
    void AsyncStorage.setItem(MOVE_HINT_KEY, '1').catch(() => {})
  }, [])

  const latestRef = useRef({ nodeOffsets, onNodeOffsetsChange, nodeSizes, onNodeSizesChange, onLayoutEditStart, onLayoutEditEnd, layout, placementMode, relayouting, layoutInputKey, gadgets, connections, plan, nodesById: new Map<string, MapNode>() })
  latestRef.current.nodeOffsets = nodeOffsets
  latestRef.current.onNodeOffsetsChange = onNodeOffsetsChange
  latestRef.current.nodeSizes = nodeSizes
  latestRef.current.onNodeSizesChange = onNodeSizesChange
  latestRef.current.onLayoutEditStart = onLayoutEditStart
  latestRef.current.onLayoutEditEnd = onLayoutEditEnd
  latestRef.current.layoutInputKey = layoutInputKey
  latestRef.current.gadgets = gadgets
  latestRef.current.connections = connections
  latestRef.current.plan = plan
  latestRef.current.layout = layout
  latestRef.current.placementMode = placementMode
  latestRef.current.relayouting = relayouting
  useEffect(() => () => {
    latestRef.current.onLayoutEditEnd?.()
  }, [])
  useEffect(() => {
    latestRef.current.nodesById = new Map((layout?.nodes ?? []).map((n) => [n.id, n]))
  }, [layout])


  // ── ノードのリサイズ（右下の角をそのままドラッグ：1本指）──
  //
  // 以前はノード上の「2本指ピンチ」でリサイズしていたが、配線図全体のズームも同じ
  // 2本指ピンチであり、同一の操作を親子で奪い合う構造になっていた。
  // どちらが勝つかは指を置いた位置や順序で変わり、勝敗が決まらないと
  // 「拡大縮小も移動も一切効かない」状態に陥る（今回の不具合の根本原因）。
  //
  // 操作そのものを分離して競合をなくす：
  //   2本指ピンチ … 配線図全体のズーム（常にこれだけ。競合相手なし）
  //   1本指 長押し＋ドラッグ（ノード本体）… ノードの移動
  //   1本指 ドラッグ（ノード右下の角）… ノードのリサイズ（長押し不要）
  const RSZ_MIN = NODE_MIN, RSZ_MAX = 320
  const clampSize = (v: number) => Math.round(Math.min(RSZ_MAX, Math.max(RSZ_MIN, v)))
  const [resizePrev, setResizePrev] = useState<{ id: string; pairedId?: string; w: number; h: number; limited?: boolean } | null>(null)
  const resizeStart = useRef({ w0: NODE_W, h0: NODE_H, scale0: 1 }).current
  // 保存が非同期キューへ反映されるまで、古い offsets を起点に次の操作を重ねない。
  const nodeCommitBusyUntil = useRef(0)
  const NODE_COMMIT_BUSY_MS = 600
  // 掴める機材は同時に1つだけ。別々の指で別の機材を掴むと UIKit は両方を通すが、
  // 掴んでいる機材（draggingNode）と移動量（dragXY）は図に1つしかなく、離したあとの保存も
  // 互いに反映前の nodeOffsets を起点に組むので、後に離した方が先の移動を消していた
  const activeNodeGesture = useRef<string | null>(null)

  const nodeGestureCache = useRef(new Map<string, {
    drag: ReturnType<typeof Gesture.Pan>
    resize: ReturnType<typeof Gesture.Pan>
    moveTo: (dx: number, dy: number) => void
  }>()).current

  useEffect(() => {
    if (!layout) return
    const currentIds = new Set(layout.nodes.map(n => n.id))
    const staleIds = [...nodeGestureCache.keys()].filter(id => !currentIds.has(id))
    staleIds.forEach(id => nodeGestureCache.delete(id))
    // 掴んだまま機材が図から消えると onFinalize が来ず、以後どの機材も掴めなくなる
    const holder = activeNodeGesture.current
    if (holder && staleIds.includes(holder.slice(holder.indexOf(':') + 1))) {
      activeNodeGesture.current = null; editingGesture.value = false
      dragTracking.value = false; dragOwner.value = ''
      setDraggingNode(null)
      latestRef.current.onLayoutEditEnd?.()
    }
    // nodeGestureCache は useRef(...).current なので実体は固定。入れても再実行は増えない
  }, [layout, nodeGestureCache, editingGesture, dragTracking, dragOwner])

  // 操作の途中でジェスチャーが外れたら（掴んだまま・ピンチしたまま別の指でタブを切り替えた等）、
  // 途中の状態を捨てる。外れたジェスチャーの onFinalize は来ない（gesture-handler は外した時点で
  // コールバックの登録を消す）ので、掴んだ機材が半透明でずれたまま残り、以後どの機材も掴めず、
  // ピンチ中の印が残って1本指で図を動かせなくなっていた
  const nodeGesturesMounted = effectiveEditMode && active && !!onNodeOffsetsChange
  useEffect(() => {
    if (nodeGesturesMounted) return
    activeNodeGesture.current = null
    editingGesture.value = false
    setDraggingNode(null)
    setResizePrev(null)
    dragOwner.value = ''
    dragX.value = 0
    dragY.value = 0
    dragHold.value = false
    dragTracking.value = false
    dragGuides.value = { x: null, y: null }
    latestRef.current.onLayoutEditEnd?.()
  }, [nodeGesturesMounted, dragX, dragY, dragOwner, dragHold, editingGesture, dragTracking, dragGuides])
  useEffect(() => {
    if (!active) pinching.value = false
  }, [active, pinching])

  const getNodeGestures = (nodeId: string) => {
    const cached = nodeGestureCache.get(nodeId)
    if (cached) return cached
    // ノードの移動・リサイズは React の state と layout 再計算に踏み込むため、
    // 全体パン・ピンチと違って UI スレッドだけでは終えられない。
    // 移動は、指への追従（onUpdate）だけを UI スレッドで行い、掴んだ・離したの処理は runOnJS で JS へ渡す。
    // リサイズは寸法で中身の描き方が変わるので JS スレッドのまま（runOnJS(true)）にする
    let dragIgnored = false
    let resizeIgnored = false
    let editStarted = false
    let dragCommitPending = false
    const finishEdit = () => {
      if (!editStarted) return
      editStarted = false
      latestRef.current.onLayoutEditEnd?.()
    }
    const dragToken = `drag:${nodeId}`
    const resizeToken = `resize:${nodeId}`
    // 長押しに届かず始まらなかっただけでも onFinalize は来るので、解放は自分が持っているときだけ
    const releaseNodeGesture = (token: string) => {
      if (activeNodeGesture.current === token) { activeNodeGesture.current = null; editingGesture.value = false }
    }
    const dragStartJS = () => {
      dragIgnored = Date.now() < nodeCommitBusyUntil.current || activeNodeGesture.current !== null
        || (latestRef.current.relayouting && !latestRef.current.placementMode)
        || latestRef.current.onLayoutEditStart?.() === false
      if (dragIgnored) {
        if (dragOwner.value === nodeId) {
          dragOwner.value = ''; dragTracking.value = false
          if (activeNodeGesture.current === null) editingGesture.value = false
        }
        return
      }
      editStarted = true
      activeNodeGesture.current = dragToken
      editingGesture.value = true; userAdjusted.value = true
      // 長押しで掴めた瞬間は見た目の変化が小さいので触覚で知らせる
      hapticMedium()
      dismissMoveHint()
      setDraggingNode(nodeId)
    }
    const dragEndJS = (translationX: number, translationY: number, success: boolean) => {
      if (!success || dragIgnored || activeNodeGesture.current !== dragToken) return
      const { nodeOffsets, placementMode: placing } = latestRef.current
      const prev = nodeOffsets?.[nodeId] ?? { dx: 0, dy: 0 }
      const { moveX, moveY } = clampNodeMove(
        latestRef.current.layout, nodeId,
        Math.round(translationX), Math.round(translationY),
      )
      // 長押ししただけで離したときは何も保存しない。保存すると、動かしていないのに
      // 置いた場所に固定され（基準位置を持つ）、「配置を変更しました」の取り消しが出て、
      // デスクの更新日時とその日の配置の履歴まで書き換わっていた
      if (moveX === 0 && moveY === 0) {
        dragX.value = 0
        dragY.value = 0
        return
      }
      hapticLight()
      if (!placing) nodeCommitBusyUntil.current = Date.now() + NODE_COMMIT_BUSY_MS
      // 補正後の位置を、新しい layout が描画されるまで共有する。
      dragX.value = moveX
      dragY.value = moveY
      const nextOffset = offsetAfterMove(prev, latestRef.current.nodesById.get(nodeId), moveX, moveY)
      if (placing) {
        // 配置モードでは差分を溜めるだけで保存しない（保存すると nodeOffsets が変わり、
        // 動かすたびに配線の計算が走る）。引き直しを待つ理由もないのでその場で反映する。
        // 新しい位置と演出の解除を同じ描画に載せる（別々だと、ずれた位置が一瞬見える）
        const latest = latestRef.current
        const moved = latest.layout ? moveNodeInLayout(latest.layout, nodeId, moveX, moveY) : null
        if (moved) {
          const delta = placementDeltaRef.current ?? {}
          const prevDelta = delta[nodeId] ?? { dx: 0, dy: 0 }
          placementDeltaRef.current = { ...delta, [nodeId]: { dx: prevDelta.dx + moveX, dy: prevDelta.dy + moveY } }
          setLayout(moved)
          setDraggingNode((cur) => (cur === nodeId ? null : cur))
        }
        return
      }
      dragHold.value = true
      dragCommitPending = true
      {
        const latest = latestRef.current
        const nextOffsets = { ...(latest.nodeOffsets ?? {}), [nodeId]: nextOffset }
        for (const node of latest.nodesById.values()) {
          if (node.id !== nodeId) nextOffsets[node.id] = offsetAfterMove(nextOffsets[node.id] ?? { dx: 0, dy: 0 }, node, 0, 0)
        }
        const patched = !latest.layout ? null
          : moveX !== 0 || moveY !== 0
            ? patchLayoutNodeMove(latest.layout, nodeId, moveX, moveY)
            : { layout: latest.layout, provisional: false }
        if (patched) {
          const inputKey = makeLayoutInputKey(latest.gadgets, latest.connections, latest.plan.placements, nextOffsets, latest.nodeSizes ?? {}, !!latest.plan.templateId)
          localLayoutCommitRef.current = { offsets: nextOffsets, inputKey, ...patched }
          setLayout(patched.layout)
          // 暫定版のときは「再計算中」を出したまま、裏の計算結果を待つ
          setRelayouting(patched.provisional)
        } else {
          const moved = latest.layout ? moveNodeInLayout(latest.layout, nodeId, moveX, moveY) : null
          if (moved) setLayout(moved)
          setAwaitingWiring(true)
          setRelayouting(true)
        }
        setDraggingNode((cur) => (cur === nodeId ? null : cur))
        try { latest.onNodeOffsetsChange?.(nextOffsets, [nodeId, ...Object.keys(nextOffsets).filter(id => id !== nodeId)]) }
        finally { dragCommitPending = false; finishEdit() }
      }
    }
    const dragFinalizeJS = (success: boolean) => {
      if (dragIgnored) { dragIgnored = false; return }
      if (activeNodeGesture.current !== dragToken) return
      releaseNodeGesture(dragToken)
      if (!dragCommitPending) finishEdit()
      if (dragOwner.value === nodeId) dragOwner.value = ''
      if (!success) {
        dragX.value = 0; dragY.value = 0; setDraggingNode(cur => cur === nodeId ? null : cur)
        return
      }
      if (!dragCommitPending) setDraggingNode(cur => cur === nodeId ? null : cur)
    }
    const drag = Gesture.Pan()
      .activateAfterLongPress(300)
      .failOffsetX([-7, 7])
      .failOffsetY([-7, 7])
      .maxPointers(1)
      .simultaneousWithExternalGesture(pinchG)
      .onStart((e) => {
        'worklet'
        // 掴めるのは同時に1つだけ。引き直しを待っている機材があるときも、その位置を上書きしない
        if (dragOwner.value === '' && !dragHold.value && !editingGesture.value) {
          dragOwner.value = nodeId
          editingGesture.value = true
          dragScale.value = savedS.value
          dragX.value = 0
          dragY.value = 0
          dragRawX.value = 0; dragRawY.value = 0
          dragMoved.value = false
          dragNode.value = dragNodes.value.find(node => node.id === nodeId) ?? null
          dragPeers.value = dragNodes.value.filter(node => node.id !== nodeId)
          const origin = dragNode.value
          dragLastValid.value = origin ? nearestPlacement(origin, dragPeers.value, origin.x, origin.y, 0) : null
          dragDestination.value = { dx: 0, dy: 0, valid: dragLastValid.value !== null, adjusted: false }
          dragStartPan.value = { x: tx.value, y: ty.value }
          const area = measure(viewportRef)
          dragViewport.value = area ? { x: area.pageX, y: area.pageY, w: area.width, h: area.height } : { x: 0, y: 0, w: 0, h: 0 }
          dragPointer.value = { x: e.absoluteX - dragViewport.value.x, y: e.absoluteY - dragViewport.value.y }
          dragTracking.value = true
          runOnJS(dragStartJS)()
        }
      })
      .onUpdate((e) => {
        'worklet'
        if (dragOwner.value !== nodeId) return
        if (!dragTracking.value) return
        dragRawX.value = e.translationX / dragScale.value
        dragRawY.value = e.translationY / dragScale.value
        if (Math.hypot(e.translationX, e.translationY) > 3) dragMoved.value = true
        dragPointer.value = { x: e.absoluteX - dragViewport.value.x, y: e.absoluteY - dragViewport.value.y }
        updateDragPosition()
      })
      .onEnd((e, success) => {
        'worklet'
        if (dragOwner.value !== nodeId || !dragTracking.value) return
        dragRawX.value = e.translationX / dragScale.value
        dragRawY.value = e.translationY / dragScale.value
        updateDragPosition()
        dragTracking.value = false
        runOnJS(dragEndJS)(dragDestination.value.dx, dragDestination.value.dy, success && dragDestination.value.valid)
      })
      .onFinalize((_e, success) => {
        'worklet'
        if (dragOwner.value === nodeId) dragTracking.value = false
        runOnJS(dragFinalizeJS)(success && dragDestination.value.valid)
      })

    // 右下の角をつまんで引っぱる。左上を固定したまま幅・高さを変える（1本指なので
    // 全体ズーム＝2本指ピンチと衝突しない）。
    // 長押しは不要：つまみに触れてそのまま動かせばリサイズが始まる。
    // ただし全体パン（panG）も1本指ドラッグで即起動するため、つまみを触っている間は
    // blocksExternalGesture でこちらを明示的に優先させる（親子の暗黙の優先順に頼らない）。
    let pairedResizeNodeId: string | undefined
    const resizeCandidate = (translationX: number, translationY: number) => {
      const candidate = resolvePlacementResize(
        [...latestRef.current.nodesById.values()], pairedResizeNodeId ? [nodeId, pairedResizeNodeId] : [nodeId],
        clampSize(resizeStart.w0 + translationX / resizeStart.scale0),
        clampSize(resizeStart.h0 + translationY / resizeStart.scale0),
      )
      // 自動サイズには手動リサイズの最小寸法より小さいカードもある。
      return candidate.w < NODE_MIN || candidate.h < NODE_MIN
        ? { w: resizeStart.w0, h: resizeStart.h0, limited: true } : candidate
    }
    const resize = Gesture.Pan()
      .runOnJS(true)
      .minDistance(2)
      .maxPointers(1)
      .simultaneousWithExternalGesture(pinchG)
      .blocksExternalGesture(panG)
      .onStart(() => {
        resizeIgnored = Date.now() < nodeCommitBusyUntil.current || activeNodeGesture.current !== null
          || (latestRef.current.relayouting && !latestRef.current.placementMode)
          || latestRef.current.onLayoutEditStart?.() === false
        if (resizeIgnored) return
        editStarted = true
        activeNodeGesture.current = resizeToken
        editingGesture.value = true; userAdjusted.value = true
        const node = latestRef.current.nodesById.get(nodeId)
        resizeStart.w0 = node?.w ?? NODE_W
        resizeStart.h0 = node?.h ?? NODE_H
        resizeStart.scale0 = savedS.value
        const pairedId = node ? pairedSplitKeyboardNodeId(nodeId, node.gadget.category) : undefined
        pairedResizeNodeId = pairedId && latestRef.current.nodesById.has(pairedId) ? pairedId : undefined
        setResizePrev({ id: nodeId, pairedId: pairedResizeNodeId, w: resizeStart.w0, h: resizeStart.h0 })
      })
      .onUpdate((e) => {
        if (resizeIgnored || activeNodeGesture.current !== resizeToken) return
        // 画面上の移動量を content 座標へ戻す（配線図をズームしていても手応えを一定に）
        setResizePrev({
          id: nodeId,
          pairedId: pairedResizeNodeId,
          ...resizeCandidate(e.translationX, e.translationY),
        })
      })
      .onEnd((e, success) => {
        if (!success || resizeIgnored || activeNodeGesture.current !== resizeToken) return
        const { w, h } = resizeCandidate(e.translationX, e.translationY)
        // 引いて元の大きさへ戻したとき（上限・下限に当たったままのときも）は保存しない。
        // 保存すると、変わっていないのに「大きさを変えました」の取り消しが出る
        if (w === Math.round(resizeStart.w0) && h === Math.round(resizeStart.h0)) return
        nodeCommitBusyUntil.current = Date.now() + NODE_COMMIT_BUSY_MS
        const { nodeSizes, nodeOffsets, onNodeSizesChange } = latestRef.current
        const nextSizes = { ...(nodeSizes ?? {}), [nodeId]: { w, h } }
        if (pairedResizeNodeId) nextSizes[pairedResizeNodeId] = { w, h }
        // 寸法によって自動配置の基準も変わるため、見えている全カードの位置を固定する。
        const offsets = { ...nodeOffsets }
        for (const node of latestRef.current.nodesById.values()) {
          offsets[node.id] = offsetAfterMove(offsets[node.id] ?? { dx: 0, dy: 0 }, node, 0, 0)
        }
        placementDeltaRef.current = null
        const current = latestRef.current.layout
        if (current) {
          const resized = { ...current, nodes: current.nodes.map(node => node.id === nodeId || node.id === pairedResizeNodeId
            ? { ...node, w, h, cx: node.x + w / 2, cy: node.y + h / 2 } : node) }
          resized.bounds = { ...current.bounds, maxX: Math.max(...resized.nodes.map(node => node.x + node.w)), maxY: Math.max(...resized.nodes.map(node => node.y + node.h)) }
          resized.width = Math.max(current.width, resized.bounds.maxX + FIT_PADDING)
          resized.height = Math.max(current.height, resized.bounds.maxY + FIT_PADDING)
          setLayout(resized)
        }
        setRelayouting(true)
        setAwaitingWiring(true)
        onNodeSizesChange?.(nextSizes, offsets, pairedResizeNodeId ? [nodeId, pairedResizeNodeId] : [nodeId], Object.keys(offsets))
      })
      .onFinalize(() => {
        if (resizeIgnored) { resizeIgnored = false; return }
        releaseNodeGesture(resizeToken)
        finishEdit()
        setResizePrev((cur) => (cur?.id === nodeId ? null : cur))
      })

    const moveTo = (dx: number, dy: number) => {
      dragStartJS()
      if (dragIgnored) return
      dragEndJS(dx, dy, true)
      dragFinalizeJS(true)
    }
    const g = { drag, resize, moveTo }
    nodeGestureCache.set(nodeId, g)
    return g
  }

  const focusOverlap = (node: MapNode) => {
    setSelectedOverlapId(node.id)
    setOverlapListOpen(false)
    userAdjusted.value = true
    const pan = layoutRestorePan({ minX: node.x, minY: node.y, maxX: node.x + node.w, maxY: node.y + node.h },
      { w: vp.w, h: Math.max(1, vp.h - fitBottomInsetRef.current) }, scale.value, tx.value, ty.value)
    tx.value = pan.x; savedX.value = pan.x
    ty.value = pan.y; savedY.value = pan.y
  }
  const separateOverlap = (node: MapNode) => {
    if (!effectiveEditMode || activeNodeGesture.current || relayouting || !onNodeOffsetsChange) return
    const target = nearestPlacement(node, visibleNodes.filter(peer => peer.id !== node.id), node.x, node.y, 600)
    if (!target) return
    focusOverlap({ ...node, x: target.x, y: target.y })
    getNodeGestures(node.id).moveTo(target.x - node.x, target.y - node.y)
  }

  // NodeCard は memo。ここが毎レンダー新しい関数になると memo が効かないので useCallback で束ねる
  const onNodeTap = useCallback((id: string) => {
    const base = baseMapNodeId(id)
    // 電源ソース（コンセント・ソーラー・電池）は実ガジェットを持たないので詳細も接続元にもしない
    if (POWER_SOURCE_IDS.has(base)) { setPendingFrom(null); return }
    if (base === DECOR_ID) { setPendingFrom(null); setDecorListOpen(true); return }
    if (pendingFrom) {
      if (pendingFrom === base) { setPendingFrom(null); return }
      setMethodFor({ from: pendingFrom, to: base })
      setPendingFrom(null)
      return
    }
    onOpenGadget?.(base, wiringEditable ? {
      editConnection: setEdgeEdit,
      drawConnection: () => setPendingFrom(base),
      addWirelessConnection: byId.get(base)?.category === 'Charger' ? () => setWirelessPickerFor(base) : undefined,
    } : undefined)
  }, [pendingFrom, onOpenGadget, wiringEditable, byId])

  const markAddedConnections = (next: MapConnection[]) => {
    const previous = new Map(connections.map((connection) => [connection.id, connection]))
    for (const connection of next) {
      const old = previous.get(connection.id)
      if ((!old || old.chargingOnly === true) && !connection.chargingOnly && connection.cableType !== 'WiFi') {
        addedConnectionIds.current.add(connection.id)
        connectionOpacity(connection.id).setValue(reduceMotion ? 1 : 0)
      }
    }
  }

  const addConnection = (from: string, to: string, cable: CableType) => {
    const newId = `map-manual-${Date.now()}`
    const next = mutate((cur) => {
      // 同じ2台を同じ種別で繋ぐ2本目（ステレオの L/R・デュアル電源）は、線を増やさず
      // 本数に足す。線を2本持つと pairKey を前提にした引き継ぎが片方を落とす
      const same = cur.find((c) =>
        c.cableType === cable &&
        ((c.fromGadgetId === from && c.toGadgetId === to) || (c.fromGadgetId === to && c.toGadgetId === from)))
      if (same) {
        if (!requiresPhysicalCable(cable)) return cur
        // 充電のときだけ挿す線は配線図に描いていない。そこへ本数を足しても何も現れないので、
        // 手で引いたこと（＝常に挿している）を優先して、描く線に格上げする
        if (same.chargingOnly || same.wireless) {
          return cur.map((c) => c.id === same.id
            ? { ...c, chargingOnly: false, wireless: false, origin: 'manual' as const, confirmed: true }
            : c)
        }
        if ((same.count ?? 1) >= MAX_CABLE_COUNT) return cur
        return cur.map((c) => c.id === same.id ? { ...c, count: (c.count ?? 1) + 1 } : c)
      }
      return [...cur, {
        id: newId,
        fromGadgetId: from, toGadgetId: to, cableType: cable,
        origin: 'manual' as const, confirmed: true,
        // 自動下書き（buildAutoDraft）と同じく種別から引く。付け忘れると Bluetooth なのに
        // 有線扱いになり、ケーブルの長さを聞かれ、2in1 の束ね候補にも並ぶ
        wireless: isWirelessPortType(cable),
      }]
    })
    markAddedConnections(next)
  }

  /** 同じ組み合わせの本数を増減する。0本にはしない（線を消すのは削除の役目） */
  const clampCount = (count: number) => Math.min(MAX_CABLE_COUNT, Math.max(1, count))
  const changeCount = (id: string, delta: number) =>
    mutate((cur) => cur.map((c) =>
      c.id === id ? { ...c, count: clampCount((c.count ?? 1) + delta) } : c))

  const addWirelessConnections = (chargerId: string, targetIds: string[]) => {
    const stamp = Date.now()
    const next = mutate((cur) => {
      const newConns: MapConnection[] = targetIds
        .filter((id) =>
          !cur.some(
            (c) =>
              ((c.fromGadgetId === chargerId && c.toGadgetId === id) ||
               (c.fromGadgetId === id && c.toGadgetId === chargerId)) &&
              c.cableType === 'wirelessCharging',
          ),
        )
        .map((id) => ({
          id: `map-wireless-${stamp}-${id}`,
          fromGadgetId: chargerId,
          toGadgetId: id,
          cableType: 'wirelessCharging' as CableType,
          origin: 'manual' as const,
          confirmed: true,
          wireless: true,
        }))
      if (newConns.length === 0) return cur
      const wirelessTargetSet = new Set(targetIds)
      const filtered = cur.filter((c) => {
        const pair = (c.fromGadgetId === chargerId && wirelessTargetSet.has(c.toGadgetId))
                 || (c.toGadgetId === chargerId && wirelessTargetSet.has(c.fromGadgetId))
        return !(pair && c.cableType !== 'wirelessCharging')
      })
      return [...filtered, ...newConns]
    })
    markAddedConnections(next)
  }

  // ユーザーが明示的に選んだ配線はエンジンの再生成で上書きさせない（manual へ昇格）。
  // 自動接続だった場合は id も付け替える：呼び元が「元の自動接続が消えた」と検知して
  // dismissedPairs へ記録できるようにし、元のケーブル種別で復活するのを防ぐ。
  // 差し替えた後の線を返す。自動の線は id が変わるので、呼び元（線編集シート）が
  // 古い id を持ち続けると、続けて押した削除・本数・取り回しが存在しない線に向かって空振りする
  const updateCable = (id: string, cable: CableType): MapConnection | null => {
    // 保存時点の線にも同じ id を振るため、ここで1回だけ決める
    const manualId = `map-manual-${Date.now()}`
    const next = mutate((cur) => cur.map((c) => {
      if (c.id !== id) return c
      // 種別に紐づく属性は引き直す。cableType だけ差し替えると「HDMI なのに無線」の線が残り、
      // ケーブルの取り回しを入力できず、2in1 の束ね候補からも外れる。
      // 種別を選び直していないときだけ元の値を残す：ワイヤレス給電は cableType が Power の
      // まま wireless だけ true なので、引き直すと有線の電源線に化ける
      const wireless = cable === c.cableType ? c.wireless : isWirelessPortType(cable)
      // つなぎ方（選んだ1本）も種別に紐づく。HDMI へ変えた線に
      // 「Anker USB-C 0.9m」が残ったまま公開されるのを防ぐ
      const cableChoice = cable === c.cableType ? c.cableChoice : undefined
      // ケーブルの要らない種別（Bluetooth 等）に本数は無い。残すと点線に「×2」が載り、公開もされる
      const count = !wireless && requiresPhysicalCable(cable) ? c.count : undefined
      const changed = { ...c, cableType: cable, confirmed: true, wireless, cableChoice, count }
      return c.origin === 'auto'
        ? { ...changed, id: manualId, origin: 'manual' as const }
        : changed
    }))
    return next.find((c) => c.id === id || c.id === manualId) ?? null
  }

  const deleteConn = (id: string) => { mutate((cur) => cur.filter((c) => c.id !== id)) }
  // 手動配線もそのまま消す。以前は「元に戻せない」と確認ダイアログを挟んでいたが、
  // 削除後に取り消しのスナックバーが出るようになったので、確認は二重になる。
  const requestDeleteConn = (connection: MapConnection) => {
    if (removingConnections.current.has(connection.id)) return
    removingConnections.current.add(connection.id)
    setEdgeEdit(null)
    NativeAnimated.sequence([
      NativeAnimated.delay(reduceMotion ? 0 : 200),
      NativeAnimated.timing(connectionOpacity(connection.id), { toValue: 0, duration: reduceMotion ? 0 : 120, useNativeDriver: false }),
    ]).start(() => {
      deleteConn(connection.id)
      removalOpacities.current.delete(connection.id)
      removingConnections.current.delete(connection.id)
    })
  }

  const recommendCables = (a?: Gadget, b?: Gadget): Set<CableType> => {
    const set = new Set<CableType>()
    if (!a || !b) return set
    const outputs = a.ports.filter((p) => p.count > 0 && (p.direction === 'output' || p.direction === 'bidirectional'))
    const inputs = b.ports.filter((p) => p.count > 0 && (p.direction === 'input' || p.direction === 'bidirectional'))
    for (const output of outputs) {
      for (const input of inputs) {
        const compatible = output.type === input.type || PORT_COMPATIBILITY[output.type]?.includes(input.type)
        if (compatible) set.add(determineCableType(output.type, input.type))
      }
    }
    return set
  }

  // 全体・履歴の操作行の裏に機材や線が隠れないよう、全体表示はこの帯より上に収める。
  // 余白としてキャンバスから切り離すと、図を動かしても使えない灰色の帯が残る
  const viewportBottomInset = !active ? 0
    : placementMode ? placementBarH + 80
    : effectiveEditMode && !moveHintDone ? 120 : 80
  fitBottomInsetRef.current = viewportBottomInset
  // 帯の高さが変わってもキャンバスの寸法は変わらず onViewportLayout が来ないので、ここで合わせ直す
  useEffect(() => { tryFit() }, [viewportBottomInset]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 空状態 ──
  if (gadgets.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: C.bgList }]}>
        <AppIcon name="lan-disconnect" size={40} color={C.textMuted} />
        <Text style={[styles.emptyText, { color: C.textMuted }]}>{T('機材がありません', 'No gadgets')}</Text>
      </View>
    )
  }

  // ── レイアウト計算中（キャッシュミス時のみ発生。非同期計算が終わるまでの間）──
  if (!layout) {
    return (
      <View style={[styles.center, { backgroundColor: C.bgList }]}>
        <ActivityIndicator color={C.accentIcon} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.card }}>
      {/* 接続先選択ヒント */}
      {wiringEditable && pendingFrom && (
        <View style={[styles.banner, { backgroundColor: C.card, borderColor: C.border }]}>
          <AppIcon name="cursor-default-click-outline" size={16} color={C.accentIcon} />
          <Text style={[styles.bannerText, { color: C.text }]}>{T('接続先をタップ', 'Tap a target node')}</Text>
          <TouchableOpacity style={[styles.bannerBtn, { backgroundColor: C.chip }]} onPress={() => setPendingFrom(null)}>
            <Text style={[styles.bannerBtnText, { color: C.text }]}>{T('キャンセル', 'Cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {active && effectiveEditMode && onNodeOffsetsChange && overlappingIds.size > 0 && (
        <TouchableOpacity
          style={[styles.banner, { backgroundColor: C.card, borderColor: C.border }]}
          onPress={() => setOverlapListOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={T(`${overlappingIds.size}個のカードが重なっています。機材を選択`, `${overlappingIds.size} cards overlap. Select a gadget`)}
        >
          <AppIcon name="layers-outline" size={18} color={C.accentIcon} />
          <Text style={[styles.bannerText, { color: C.text }]}>{T(`${overlappingIds.size}個のカードが重なっています`, `${overlappingIds.size} cards overlap`)}</Text>
          <Text style={{ color: C.accentText }}>{T('選択・解消', 'Resolve')}</Text>
        </TouchableOpacity>
      )}

      {/* キャンバス */}
      <GestureDetector gesture={active ? composed : disabledGesture}>
        <Reanimated.View
          ref={setViewportRef}
          collapsable={false}
          style={[styles.viewport, { backgroundColor: C.bgList }]}
          onLayout={onViewportLayout}
        >
          {/* 接続が1本もない場合：未接続ガジェットはノード非表示のため白紙になる。
              無言の白紙だと故障に見えるので、案内を出す */}
          {visibleNodes.length === 0 && !relayouting && (
            <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
              <AppIcon name="lan-disconnect" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>{T('まだ接続がありません', 'No connections yet')}</Text>
              {wiringEditable && (
                <Text style={[styles.emptyText, { color: C.textMuted, fontSize: 12 }]}>
                  {T('右下の＋ボタンから接続を追加できます', 'Tap the + button to add a connection')}
                </Text>
              )}
            </View>
          )}
          {/* 再計算中ピル：既存の図を表示したまま、上部中央に手ごたえを出す */}
          {((relayouting && !placementMode) || awaitingWiring) && (
            <View style={[styles.relayoutPill, { backgroundColor: C.card + 'D9', borderColor: C.border }]} pointerEvents="none">
              <ActivityIndicator size="small" color={C.accentIcon} />
              <Text style={[styles.relayoutPillText, { color: C.textSub }]}>
                {awaitingWiring ? T('配線を計算中…', 'Wiring…') : T('配線を再計算中…', 'Rewiring…')}
              </Text>
            </View>
          )}
          {!wiresHidden && usedCableTypes.length > 0 && (
            <View
              ref={legendTarget}
              style={[
                styles.cableLegend,
                viewportSize.h > 0 && { maxHeight: Math.max(44, viewportSize.h - LEGEND_VERTICAL_CLEARANCE) },
                { backgroundColor: C.card + 'D9', borderColor: C.border },
              ]}
            >
              <TouchableOpacity
                style={styles.cableLegendHeader}
                // 見た目は図を塞がないよう低くしてあり、押せる高さは hitSlop で 44pt まで足す
                hitSlop={{ top: 11, bottom: 11, left: 8, right: 8 }}
                onPress={toggleCableLegend}
                accessibilityRole="button"
                accessibilityLabel={cableLegendCollapsed ? T('配線HUDを展開', 'Expand wire HUD') : T('配線HUDを折りたたむ', 'Collapse wire HUD')}
                accessibilityState={{ expanded: !cableLegendCollapsed }}
              >
                <Text style={[styles.cableLegendTitle, { color: C.textSub }]} numberOfLines={1}>
                  {focusedCableType
                    ? T(`${cableTypeLabel(focusedCableType)}のみ`, `${cableTypeLabel(focusedCableType)} only`)
                    : T('配線', 'Wires')}
                </Text>
                <AppIcon name={cableLegendCollapsed ? ICONS.chevronDown : ICONS.chevronUp} size={16} color={C.textMuted} />
              </TouchableOpacity>
              {!cableLegendCollapsed && (
                <ScrollView
                  style={styles.cableLegendItemsScroll}
                  // 行の右端（本数・選択の✓）は枠の端から 4pt しか離れておらず、
                  // スクロールバーを出すときはその上に重なるので、バーの幅ぶん空ける
                  contentContainerStyle={[styles.cableLegendItems, usedCableTypes.length > 4 && styles.cableLegendItemsBarRoom]}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={usedCableTypes.length > 4}
                >
                  {usedCableTypes.map((type) => {
                    const selected = focusedCableType === type
                    return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.cableLegendItem, selected && { backgroundColor: C.chip }]}
                      onPress={() => focusCableType(type)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={T(`${cableTypeLabel(type)}の配線を強調`, `Highlight ${cableTypeLabel(type)} wires`)}
                    >
                      <View style={[styles.cableLegendLine, { backgroundColor: portIconColor(type, isDark) }]} />
                      <Text style={[styles.cableLegendText, { color: C.text }]} numberOfLines={1}>{cableTypeLabel(type)}</Text>
                      <Text style={[styles.cableLegendCount, { color: C.textMuted }]}>{cableTypeCounts.get(type) ?? 0}</Text>
                      {selected && <AppIcon name={ICONS.check} size={14} color={C.accentIcon} />}
                    </TouchableOpacity>
                  )})}
                </ScrollView>
              )}
            </View>
          )}
          <Reanimated.View
            style={[{ width: layout.width, height: layout.height }, canvasStyle]}
          >
            {/* 接続線（配置モードの間は引かない） */}
            {!wiresHidden && (
              <Svg width={layout.width} height={layout.height} style={[StyleSheet.absoluteFill, { overflow: 'visible' }]}>
                {edgePaths}
                {edgeCountLabels}
              </Svg>
            )}

            {/* 配線タップ判定：最近傍の線を拾う（重なっても確実に反応）。
                閲覧時も拾う。他人のデスクでケーブルの種類を知りたい場面があるため、
                シート側を表示専用に切り替えて対応する（編集の入口は出さない）*/}
            {/* 当たり判定だけの要素なので読み上げ対象から外す（フォーカスを奪うだけで読む内容が無い）*/}
            {!wiresHidden && (
              <Pressable
                accessible={false}
                style={StyleSheet.absoluteFill}
                onPress={(ev) => pickEdge(ev.nativeEvent.locationX, ev.nativeEvent.locationY)}
              />
            )}

            {/* ノード（1本指：本体=長押しドラッグで移動／右下の角=そのままドラッグでリサイズ） */}
            {visibleNodes.map((n) => {
              const rp = resizePrev && (resizePrev.id === n.id || resizePrev.pairedId === n.id) ? resizePrev : null
              // 引っぱっている最中のノードだけは寸法が毎フレーム変わる。それ以外は
              // メモ化済みの同じ参照を渡して NodeCard の再描画を避ける
              const model = rp ? { ...nodeCardModels.get(n.id)!, w: rp.w, h: rp.h } : nodeCardModels.get(n.id)!
              const card = (
                <NodeCard
                  node={model} colors={C}
                  glow={selectedOverlapId === n.id || (pendingFrom != null && baseMapNodeId(n.id) === pendingFrom)}
                  wifi={wifiGadgetIds.has(n.gadget.id)}
                  onPress={onNodeTap}
                />
              )
              const wrapStyle = [
                { position: 'absolute' as const, left: n.x, top: n.y, width: rp?.w ?? n.w, height: rp?.h ?? n.h },
                selectedOverlapId === n.id && { zIndex: 8 },
                draggingNode === n.id && { zIndex: 10 },
                rp != null && { zIndex: 10, opacity: 0.85 },
              ]
              // layoutEditable のときは readOnly でもノードの移動・リサイズだけ許可する
              if (!effectiveEditMode || !active || !onNodeOffsetsChange) {
                return <View key={n.id} style={wrapStyle}>{card}</View>
              }
              const gestures = getNodeGestures(n.id)
              const editableWrapStyle = [
                wrapStyle,
                {
                  width: (rp?.w ?? n.w) + RESIZE_HIT_EXTENSION,
                  height: (rp?.h ?? n.h) + RESIZE_HIT_EXTENSION,
                },
              ]
              return (
                <GestureDetector key={n.id} gesture={gestures.drag}>
                  <Reanimated.View style={[editableWrapStyle, draggingNode === n.id && dragStyle]}>
                    <LiftedMapCard dragging={draggingNode === n.id} tracking={dragTracking} reduceMotion={reduceMotion}
                      width={model.w} height={model.h} surface={model.isWall || model.powerSource ? C.chip : C.card}>
                      {card}
                    </LiftedMapCard>
                    {/* 右下の角＝リサイズのつまみ（子の GestureDetector が優先されるので、
                        ここからドラッグすると移動や全体パンではなくリサイズになる） */}
                    {effectiveEditMode && onNodeSizesChange && (
                      <GestureDetector gesture={gestures.resize}>
                        <View style={styles.resizeGrip}>
                          <View style={[styles.resizeGripDot, { borderColor: C.textMuted }]} />
                        </View>
                      </GestureDetector>
                    )}
                  </Reanimated.View>
                </GestureDetector>
              )
            })}

            <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', zIndex: 9, borderRadius: 12, borderColor: C.accentIcon }, destinationStyle]} />
            <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, height: layout.height, zIndex: 11, backgroundColor: C.accentIcon }, guideXStyle]} />
            <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, width: layout.width, zIndex: 11, backgroundColor: C.accentIcon }, guideYStyle]} />
          </Reanimated.View>

          <Reanimated.View pointerEvents="none" style={[styles.placementNotice, { backgroundColor: C.card, borderColor: C.border }, adjustedDestinationStyle]}>
            <Text style={{ color: C.text }}>{T('重ならない枠の位置に置きます', 'Release to place in the free outline')}</Text>
          </Reanimated.View>
          <Reanimated.View pointerEvents="none" style={[styles.placementNotice, { backgroundColor: C.card, borderColor: C.border }, blockedDestinationStyle]}>
            <Text style={{ color: C.text }}>{T('ここには置けません。空いている場所へ動かしてください', 'No space here. Move to a free area')}</Text>
          </Reanimated.View>
          {resizePrev?.limited && (
            <View pointerEvents="none" style={[styles.placementNotice, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={{ color: C.text }}>{T('ほかの機材に重ならない大きさまで変更できます', 'Size is limited to avoid other gadgets')}</Text>
            </View>
          )}

        </Reanimated.View>
      </GestureDetector>

        {/* 機材に重ならず、パンジェスチャーにも操作を奪われないようキャンバスの外に置く。 */}
        {active && !readOnly && !placementMode && (
          <IconCircleButton
            name={ICONS.add}
            diameter={48}
            size={24}
            color={C.onAccent}
            background={C.accent}
            style={styles.fab}
            onPress={() => setAddOpen(true)}
            buttonRef={addTarget}
            accessibilityLabel={T('機材同士をつなぐ', 'Connect two gadgets')}
            accessibilityHint={T('つなぐ機材と方法を選ぶ画面を開きます', 'Opens choices for the gadgets and connection method')}
          />
        )}

      {/* 配置モード：線を引く前に置き場所を決めてもらう。押した時点で配線を計算する */}
      {placementMode && active && (
        <SetupActionFooter
          showGuide
          absolute
          title={placementConfirmLabel ?? T('完了', 'Done')}
          onPress={confirmPlacement}
          accessibilityLabel={placementConfirmLabel ?? T('完了', 'Done')}
          accessibilityHint={T('いまの配置を基準に配線図を作ります', 'Builds the wiring map from the current layout')}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height
            setPlacementBarH((prev) => (Math.abs(prev - h) < 0.5 ? prev : h))
          }}
        >
          <Text style={[styles.placementHint, { color: C.textSub }]}>
            {onNodeSizesChange ? T(PLACEMENT_HINT.ja, PLACEMENT_HINT.en) : T(PLACEMENT_MOVE_HINT.ja, PLACEMENT_MOVE_HINT.en)}
          </Text>
        </SetupActionFooter>
      )}

      {active && effectiveEditMode && !placementMode && !moveHintDone && (
        <View style={[styles.moveHint, { backgroundColor: C.card, borderColor: C.border }]}>
          <AppIcon name="gesture-tap-hold" size={16} color={C.textMuted} />
          <Text style={[styles.moveHintText, { color: C.textSub }]} numberOfLines={2}>
            {T('機材を長押しすると動かせます', 'Press and hold a gadget to move it')}
          </Text>
          <TouchableOpacity
            onPress={dismissMoveHint}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityRole="button"
            accessibilityLabel={T('ヒントを閉じる', 'Dismiss hint')}
          >
            <AppIcon name={ICONS.close} size={16} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* 親のパンジェスチャーにボタン操作を奪われないよう、検出領域の外に置く */}
      {active && (
        <View
          // 配置モードでは下部バーが同じ場所に来るので、その上へ逃がす
          style={[
            styles.zoomBar,
            { backgroundColor: C.card + 'D9', borderColor: C.border },
            placementMode && placementBarH > 0 && { bottom: placementBarH + 16 },
          ]}
        >
          <TouchableOpacity
            ref={fitTarget}
            style={styles.playbackBtn}
            onPress={handleFitPress}
            accessibilityRole="button"
            accessibilityLabel={T('全体を画面に収める', 'Fit the whole diagram')}
            accessibilityHint={T('すべての機材と線が見える大きさに戻します', 'Resizes the view so every gadget and connection is visible')}
          >
            <AppIcon name="fit-to-screen-outline" size={18} color={C.text} />
            <Text style={[styles.fitLabel, { color: C.text }]}>{T('全体', 'Fit')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 飾り一覧シート ── */}
      <BottomSheet visible={overlapListOpen && active && effectiveEditMode && !!onNodeOffsetsChange} onClose={() => setOverlapListOpen(false)}>
        <Text style={[styles.detailName, { color: C.text }]}>{T('重なった機材', 'Overlapping gadgets')}</Text>
        <Text style={[styles.sheetLabel, { color: C.textSub }]}>{T('機材名で手前に表示するか、空き位置へ移動できます', 'Select a name to bring it forward, or move it to a free position')}</Text>
        {overlapListOpen && visibleNodes.filter(node => overlappingIds.has(node.id)).map(node => {
          const part = node.id.endsWith('__L') ? T('（左）', ' (Left)') : node.id.endsWith('__R') ? T('（右）', ' (Right)') : node.id.endsWith('__SUB') ? T('（サブ）', ' (Sub)') : ''
          const name = localizedGadgetName(node.gadget, lang) + part
          const canSeparate = !!nearestPlacement(node, visibleNodes.filter(peer => peer.id !== node.id), node.x, node.y, 600)
          return (
            <View key={node.id} style={[styles.overlapRow, { borderColor: C.border }]}>
              <TouchableOpacity style={styles.overlapName} onPress={() => focusOverlap(node)} accessibilityRole="button" accessibilityLabel={T(`${name}を手前に表示`, `Bring ${name} forward`)}>
                <Text style={{ color: C.text }}>{name}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.overlapAction} disabled={!canSeparate || relayouting} onPress={() => separateOverlap(node)} accessibilityRole="button" accessibilityLabel={T(`${name}を空き位置へ移動`, `Move ${name} to free space`)}>
                <Text style={{ color: canSeparate && !relayouting ? C.accentText : C.textMuted }}>{T('空き位置へ移動', 'Move to free space')}</Text>
              </TouchableOpacity>
            </View>
          )
        })}
      </BottomSheet>
      <BottomSheet visible={decorListOpen} onClose={() => setDecorListOpen(false)}>
        <View style={styles.detailHead}>
          <View style={[styles.detailIcon, { backgroundColor: DECOR_COLOR + '22' }]}>
            <AppIcon name={ICONS.decor} size={26} color={DECOR_COLOR} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.detailName, { color: C.text }]}>{T('飾り', 'Decor')}</Text>
            <Text style={[styles.detailBrand, { color: C.textMuted }]}>
              {T('通電・配線をしない飾りをまとめて表示しています', 'Decorative items with no power or wiring, grouped together')}
            </Text>
          </View>
        </View>
        <Text style={[styles.sheetLabel, { color: C.textSub }]}>
          {T(`飾っているもの (${decorGadgets.length})`, `Decor items (${decorGadgets.length})`)}
        </Text>
        {decorGadgets.map((dg) => {
          const dcol = categoryBaseColor(dg.category, dg.customCategory?.color, '#888')
          return (
            <TouchableOpacity
              key={dg.id}
              style={styles.detailConnRow}
              disabled={!onOpenGadget}
              onPress={() => { setDecorListOpen(false); onOpenGadget?.(dg.id) }}
            >
              <View style={[styles.subBadge, { backgroundColor: dcol + '22' }]}>
                <CategoryIcon category={dg.category} pcFormFactor={dg.pcFormFactor} customIcon={dg.customCategory?.icon} size={15} color={categoryIconColor(dg.category, isDark, undefined, dg.customCategory?.color)} />
              </View>
              <Text style={[styles.detailConnName, { color: C.text }]} numberOfLines={1}>{dg.name}</Text>
              {onOpenGadget && <AppIcon name={ICONS.chevronRight} size={18} color={C.textMuted} />}
            </TouchableOpacity>
          )
        })}
      </BottomSheet>

      {/* ── 接続方法選択（2タップ後）── */}
      <BottomSheet visible={!!methodFor} onClose={() => setMethodFor(null)}>
        {methodFor && (
          <MethodPicker
            from={byId.get(methodFor.from)} to={byId.get(methodFor.to)}
            recommend={recommendCables(byId.get(methodFor.from), byId.get(methodFor.to))}
            colors={C} T={T} lang={lang}
            onPick={(cable) => {
              if (addLockRef.current) return
              addLockRef.current = true
              // シートを開いたまま片方が外れていたら、居ない機材への線になるので足さない
              if (!byId.has(methodFor.from) || !byId.has(methodFor.to)) { setMethodFor(null); return }
              addConnection(methodFor.from, methodFor.to, cable)
              setMethodFor(null)
            }}
          />
        )}
      </BottomSheet>

      {/* 交差点・並走区間。最短の1本を勝手に開かず、利用者が線を選ぶ。 */}
      <BottomSheet visible={edgeCandidates.length > 1} onClose={() => setEdgeCandidates([])}>
        {edgeCandidates.length > 1 && (
          <>
            <Text style={[styles.sheetTitle, { color: C.text }]}>{T('この場所の配線', 'Wires at this point')}</Text>
            <Text style={[styles.detailBrand, { color: C.textSub, marginBottom: 8 }]}>
              {T('確認する配線を選んでください', 'Choose the wire to inspect')}
            </Text>
            <View style={[styles.methodSelectPanel, { backgroundColor: C.card, borderColor: C.border }]}>
              {edgeCandidates.map((edge, index) => {
                const color = edge.isPairLink
                  ? C.textMuted
                  : portIconColor(edge.conn.cableType, isDark)
                return (
                  <TouchableOpacity
                    key={`${edge.conn.id}-${index}`}
                    style={[
                      styles.methodSelectRow,
                      { borderBottomColor: C.separator },
                      index === edgeCandidates.length - 1 && { borderBottomWidth: 0 },
                    ]}
                    onPress={() => openPickedEdge(edge)}
                    accessibilityRole="button"
                    accessibilityLabel={`${nameOf(edge.conn.fromGadgetId)}、${nameOf(edge.conn.toGadgetId)}、${cableLabel(edge.conn.cableType, lang)}`}
                  >
                    <View style={[styles.cableLegendLine, { backgroundColor: color }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.methodSelectRowText, styles.stackedRowTitle, { color: C.text }]} numberOfLines={1}>
                        {nameOf(edge.conn.fromGadgetId)} → {nameOf(edge.conn.toGadgetId)}
                      </Text>
                      <Text style={[styles.detailBrand, { color: C.textSub }]} numberOfLines={1}>
                        {cableLabel(edge.conn.cableType, lang)}
                      </Text>
                    </View>
                    <AppIcon name={ICONS.chevronRight} size={16} color={C.textMuted} />
                  </TouchableOpacity>
                )
              })}
            </View>
          </>
        )}
      </BottomSheet>

      {/* ── 線編集シート ── */}
      <BottomSheet visible={!!edgeEdit} onClose={closeEdgeEdit}>
        {edgeEdit && (
          <>
            <View style={styles.edgeHead}>
              {edgeEdit.cableType === 'wirelessCharging' && (
                <AppIcon name="lightning-bolt-circle" size={18} color={statusTextColor('success', isDark)} />
              )}
              <Text style={[styles.detailName, { color: C.text, flex: 1 }]} numberOfLines={2}>
                {nameOf(edgeEdit.fromGadgetId)} {edgeEdit.cableType === 'wirelessCharging' ? '≈' : '→'} {nameOf(edgeEdit.toGadgetId)}
              </Text>
            </View>
            {readOnly ? (
              // 閲覧時はケーブルの種類だけ見せる。変更・削除の導線は出さない
              <View style={[styles.methodSelectPanel, { backgroundColor: C.card, borderColor: C.border, marginTop: 12 }]}>
                <View style={[styles.methodSelectRow, { borderBottomWidth: 0 }]}>
                  <View style={[styles.cableLegendLine, { backgroundColor: portIconColor(edgeEdit.cableType, isDark) }]} />
                  <Text style={[styles.methodSelectRowText, { color: C.text }]} numberOfLines={1}>
                    {cableLabel(edgeEdit.cableType, lang)}
                  </Text>
                  {edgeEdit.chargingOnly && (
                    <Text style={[styles.methodRecommended, { color: C.textSub }]}>
                      {T('充電時のみ', 'Charge only')}
                    </Text>
                  )}
                </View>
              </View>
            ) : edgeEdit.cableType !== 'wirelessCharging' && (
              <>
                <Text style={[styles.sheetLabel, { color: C.textSub }]}>{T('接続方法を変更', 'Change cable')}</Text>
                <CableSelect
                  value={edgeEdit.cableType}
                  recommend={recommendCables(byId.get(edgeEdit.fromGadgetId), byId.get(edgeEdit.toGadgetId))}
                  colors={C}
                  lang={lang}
                  onPick={(cable) => { setEdgeEdit(updateCable(edgeEdit.id, cable) ?? edgeEdit) }}
                />
              </>
            )}
            {!readOnly && isEditableAcConnection(edgeEdit) && (
              <>
                <Text style={[styles.sheetLabel, { color: C.textSub }]}>{T('給電元を変更', 'Change power source')}</Text>
                <View style={[styles.methodSelectPanel, { backgroundColor: C.card, borderColor: C.border }]}>
                  {powerSourceOptions(edgeEdit).map((source) => {
                    const active = edgeEdit.fromGadgetId === source.id
                    return (
                      <TouchableOpacity
                        key={source.id}
                        style={[styles.methodSelectRow, { borderBottomColor: C.separator }, active && { backgroundColor: C.accent + '12' }]}
                        disabled={!source.available && !active}
                        onPress={() => changePowerSource(edgeEdit, source.id)}
                      >
                        <AppIcon name={source.id === WALL_ID ? 'power-socket-jp' : 'power-plug-outline'} size={17} color={active ? C.accentIcon : source.available ? C.textSub : C.textMuted} />
                        <Text style={[styles.methodSelectRowText, { color: active ? C.accentText : source.available ? C.text : C.textMuted }]} numberOfLines={1}>
                          {source.label}
                        </Text>
                        <Text style={[styles.methodRecommended, { color: source.available || active ? C.textSub : C.textMuted }]}>
                          {T(`空き ${source.remaining}口`, `${source.remaining} free`)}
                        </Text>
                        <AppIcon name={active ? 'radiobox-marked' : 'radiobox-blank'} size={17} color={active ? C.accentIcon : C.textMuted} />
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            )}
            {!readOnly && branchOptions(edgeEdit).length > 0 && (
              <>
                <Text style={[styles.sheetLabel, { color: C.textSub }]}>
                  {T('1本のケーブルでまとめる（2in1・3in1）', 'Same cable (2-in-1 / 3-in-1)')}
                </Text>
                <View style={[styles.methodSelectPanel, { backgroundColor: C.card, borderColor: C.border }]}>
                  {branchOptions(edgeEdit).map((item) => {
                    const linked = isBranchedWith(edgeEdit, item)
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.methodSelectRow, { borderBottomColor: C.separator }, linked && { backgroundColor: C.accent + '12' }]}
                        onPress={() => toggleBranch(edgeEdit, item.id)}
                      >
                        <AppIcon name="call-split" size={17} color={linked ? C.accentIcon : C.textSub} />
                        <Text style={[styles.methodSelectRowText, { color: linked ? C.accentText : C.text }]} numberOfLines={1}>
                          {nameOf(item.toGadgetId)}
                        </Text>
                        <Text style={[styles.methodRecommended, { color: C.textSub }]}>
                          {cableLabel(item.cableType, lang)}
                        </Text>
                        <AppIcon
                          name={linked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={17}
                          color={linked ? C.accentIcon : C.textMuted}
                        />
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            )}
            {/* 同じ組み合わせを何本で繋いでいるか（ステレオの L/R・デュアル電源）。
                線を増やさず本数で持つ理由は types/index.ts の count を参照 */}
            {!readOnly && !edgeEdit.wireless && requiresPhysicalCable(edgeEdit.cableType) && (
              <>
                <Text style={[styles.sheetLabel, { color: C.textSub }]}>{T('本数', 'How many')}</Text>
                <View style={[styles.choiceSummary, { backgroundColor: C.card, borderColor: C.border }]}>
                  <Text style={[styles.routeSummaryText, { color: C.text, flex: 1 }]}>
                    {T(`${edgeEdit.count ?? 1}本`, `${edgeEdit.count ?? 1} cable${(edgeEdit.count ?? 1) > 1 ? 's' : ''}`)}
                  </Text>
                  {([-1, 1] as const).map((delta) => {
                    const atLimit = delta < 0 ? (edgeEdit.count ?? 1) <= 1 : (edgeEdit.count ?? 1) >= MAX_CABLE_COUNT
                    return (
                      <TouchableOpacity
                        key={delta}
                        style={[styles.countStep, { borderColor: C.border }]}
                        disabled={atLimit}
                        onPress={() => {
                          changeCount(edgeEdit.id, delta)
                          // 直前の表示から足す。描画を待たずに続けて押されると、この edgeEdit は
                          // 2回とも同じ古い値で、保存は2本増えるのに表示は1本しか増えなかった
                          setEdgeEdit((cur) => cur && { ...cur, count: clampCount((cur.count ?? 1) + delta) })
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={delta < 0 ? T('1本減らす', 'Remove one') : T('1本増やす', 'Add one')}
                        accessibilityState={{ disabled: atLimit }}
                      >
                        <AppIcon
                          name={delta < 0 ? ICONS.subtract : ICONS.add}
                          size={16}
                          color={atLimit ? C.textMuted : C.accentIcon}
                        />
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            )}
            {!edgeEdit.wireless && requiresPhysicalCable(edgeEdit.cableType)
              && (!!cableChoiceLabel(edgeEdit.cableChoice, lang) || !!onEditCableChoice) && (
              <>
                <Text style={[styles.sheetLabel, { color: C.textSub }]}>{T('つなぎ方', "How it's connected")}</Text>
                <TouchableOpacity
                  style={[styles.choiceSummary, { backgroundColor: C.card, borderColor: C.border }]}
                  disabled={!onEditCableChoice}
                  onPress={() => { const id = edgeEdit.id; setEdgeEdit(null); onEditCableChoice?.(id) }}
                  activeOpacity={0.7}
                  accessibilityRole={onEditCableChoice ? 'button' : 'text'}
                  accessibilityLabel={T('つなぎ方', "How it's connected")}
                >
                  <Text
                    style={[
                      styles.routeSummaryText,
                      { color: cableChoiceLabel(edgeEdit.cableChoice, lang) ? C.text : C.textMuted, flex: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    {cableChoiceLabel(edgeEdit.cableChoice, lang) ?? T('未設定', 'Not set')}
                  </Text>
                  {onEditCableChoice && <AppIcon name={ICONS.chevronRight} size={16} color={C.textMuted} />}
                </TouchableOpacity>
              </>
            )}
            {!edgeEdit.wireless && requiresPhysicalCable(edgeEdit.cableType) && (
              <>
                <Text style={[styles.sheetLabel, { color: C.textSub }]}>{T('ケーブルの取り回し', 'Cable routing')}</Text>
                {readOnly ? (
                  <View style={[styles.routeSummary, { backgroundColor: C.card, borderColor: C.border }]}>
                    <Text style={[styles.routeSummaryText, { color: C.text }]}>
                      {edgeEdit.route?.lengthCm ? `${edgeEdit.route.lengthCm} cm · ` : ''}
                      {routePathLabel(edgeEdit.route?.path, lang)} · {routeVisibilityLabel(edgeEdit.route?.visibility, lang)}
                    </Text>
                    {!!edgeEdit.route?.note && <Text style={[styles.routeNote, { color: C.textSub }]}>{edgeEdit.route.note}</Text>}
                  </View>
                ) : (
                  <>
                    <TextField
                      containerStyle={styles.routeField}
                      value={edgeRouteDraft?.lengthDigits
                        ?? (edgeEdit.route?.lengthCm == null ? '' : String(edgeEdit.route.lengthCm))}
                      onChangeText={(value) => editRouteDraft(edgeEdit.id, { lengthDigits: value.replace(/[^0-9]/g, '') })}
                      keyboardType="number-pad"
                      placeholder={T('長さ（cm）', 'Length (cm)')}
                    />
                    <View style={styles.routeChipWrap}>
                      {(['direct', 'under_desk', 'cable_tray', 'along_wall', 'through_wall', 'floor'] as const).map((path) => {
                        const active = (edgeEdit.route?.path ?? 'direct') === path
                        return <TouchableOpacity key={path} style={[styles.routeChip, { borderColor: active ? C.accentIcon : C.border, backgroundColor: active ? C.accent + '18' : C.chip }]} onPress={() => updateRoute(edgeEdit, { path })}>
                          <Text style={[styles.routeChipText, { color: active ? C.accentText : C.textSub }]}>{routePathLabel(path, lang)}</Text>
                        </TouchableOpacity>
                      })}
                    </View>
                    <View style={styles.routeChipWrap}>
                      {(['visible', 'partial', 'hidden'] as const).map((visibility) => {
                        const active = (edgeEdit.route?.visibility ?? 'visible') === visibility
                        return <TouchableOpacity key={visibility} style={[styles.routeChip, { borderColor: active ? C.accentIcon : C.border, backgroundColor: active ? C.accent + '18' : C.chip }]} onPress={() => updateRoute(edgeEdit, { visibility })}>
                          <Text style={[styles.routeChipText, { color: active ? C.accentText : C.textSub }]}>{routeVisibilityLabel(visibility, lang)}</Text>
                        </TouchableOpacity>
                      })}
                    </View>
                    <TextInput
                      style={[styles.routeInput, styles.routeNoteInput, { color: C.text, backgroundColor: C.input, borderColor: C.inputBorder }]}
                      value={edgeRouteDraft?.note ?? edgeEdit.route?.note ?? ''}
                      onChangeText={(note) => editRouteDraft(edgeEdit.id, { note: note.trimStart() })}
                      multiline
                      maxLength={inputMaxLength(edgeRouteDraft?.note ?? edgeEdit.route?.note, ROUTE_NOTE_MAX_LENGTH)}
                      placeholder={T('例：天板の裏にクリップで固定。余りは脚の内側にまとめる。', 'e.g. Clip under the desktop; coil the slack beside the leg.')}
                      accessibilityLabel={T('配線のメモ', 'Cable routing notes')}
                      placeholderTextColor={C.textMuted}
                    />
                  </>
                )}
              </>
            )}
            {!readOnly && (
              <TouchableOpacity style={[styles.deleteBtn, { borderColor: C.danger }]} onPress={() => requestDeleteConn(edgeEdit)}>
                <AppIcon name={ICONS.trash} size={16} color={C.danger} />
                <Text style={[styles.sheetBtnText, { color: C.danger }]}>{T('接続を削除', 'Delete link')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </BottomSheet>

      {/* ── 接続追加（FAB フル）── */}
      {/* 飾り（displayOnly）は配線図上で個別ノードを持たないため、接続元/先の候補から外す */}
      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <AddConnectionSheet
          gadgets={wireableGadgets} colors={C} T={T} lang={lang} recommendCables={recommendCables}
          onAdd={(from, to, cable) => {
            if (addLockRef.current) return
            addLockRef.current = true
            addConnection(from, to, cable)
            setAddOpen(false)
          }}
        />
      </BottomSheet>

      {/* ── ワイヤレス充電ピッカー ── */}
      <BottomSheet visible={!!wirelessPickerFor} onClose={() => setWirelessPickerFor(null)}>
        {wirelessPickerFor && byId.get(wirelessPickerFor) && (
          <WirelessPickerSheet
            charger={byId.get(wirelessPickerFor)!}
            allGadgets={wireableGadgets}
            existingConns={connections}
            colors={C}
            T={T}
            onAdd={(ids) => { addWirelessConnections(wirelessPickerFor, ids); setWirelessPickerFor(null) }}
          />
        )}
      </BottomSheet>
    </View>
  )
}

// 画面側のモーダル開閉やタブ内UI更新では、保持中の大きな配線図ツリーを再評価しない。
// props が実際に変わった場合は標準の浅い比較で通常どおり再描画する。
const ConnectionMapMemo = React.memo(ConnectionMapInner)
// 配線図は保存データ（線・位置）から毎回組み立てるので、壊れた1件で描画が落ちうる。
// 落ちてもデスクの画面ごと巻き込まないよう、図の部分だけを差し替える
export const ConnectionMap = React.memo(function GuardedConnectionMap(props: Props) {
  const { lang } = useApp()
  const ja = lang === 'ja'
  const recovery: SectionRecovery | undefined = props.onResetLayout
    ? {
        label: ja ? '配置と配線をリセット' : 'Reset layout and wiring',
        confirmTitle: ja ? '配置と配線をリセットしますか？' : 'Reset layout and wiring?',
        confirmMessage: ja
          ? '機材はそのまま残ります。手で動かした位置は元に戻り、配線は作り直します。'
          : 'Your gear stays. Moved positions are cleared and the wiring is rebuilt.',
        run: props.onResetLayout,
      }
    : undefined
  return <SectionBoundary name="connection_map" recovery={recovery}><ConnectionMapMemo {...props} /></SectionBoundary>
})

// ─── ノードカード ─────────────────────────────────────────────────
// ジャンル名を主表示し、空きがある場合だけ商品名を小さく添える。
//
// memo 必須：ノードのリサイズ中は onUpdate ごとに親が再レンダーされる。素のままだと
// 毎フレーム全ノードのラベル文字サイズ探索（fitNodeFontSize）まで走り直してフレームを落とす。
// node は nodeCardModels で1回だけ作られ、colors は AppContext で memo 化されている。
const NodeCard = React.memo(function NodeCard({ node, colors: C, glow, wifi, onPress }: { node: MapNode; colors: AppColors; glow: boolean; wifi?: boolean; onPress: (id: string) => void }) {
  const { isDark, lang } = useApp()
  const g = node.gadget
  // themeIconColor のダークモード補正は #RRGGBB のみ対象。3桁だと補正されず、
  // 暗いノード面の上でコンセントのアイコンがほぼ見えなくなる
  const rawCol = node.isWall
    ? '#555555'
    : node.powerSource
      ? POWER_SOURCE_COLORS[node.powerSource]
      : node.isDecor ? DECOR_COLOR : (categoryBaseColor(g.category, g.customCategory?.color, '#888888'))
  const col = node.isWall || node.powerSource || node.isDecor
    ? themeIconColor(rawCol, isDark)
    : categoryIconColor(g.category, isDark, undefined, g.customCategory?.color)
  const isPseudo = node.isWall || !!node.powerSource

  // 右上のバッジ。線を引かない情報（無線・充電時のみ・内包したガジェット）をここにまとめ、
  // 複数あっても重ならないよう横に並べる
  const badges: { key: string; icon: React.ReactNode }[] = []
  if (wifi) badges.push({ key: 'wifi', icon: <AppIcon name="wifi" size={16} color={portIconColor('WiFi', isDark)} /> })
  if (g.powerUsage === 'replaceable') {
    badges.push({ key: 'battery', icon: <AppIcon name="battery" size={16} color={themeIconColor('#34C759', isDark)} /> })
  }
  if (g.category === 'PC' && (g.pcThunderbolt || g.ports.some((p) => p.type === 'Thunderbolt'))) {
    badges.push({ key: 'tb', icon: <AppIcon name="lightning-bolt" size={16} color={portIconColor('USB_C', isDark)} /> })
  }
  if ((g.category === 'Monitor' || g.category === 'Microphone') && armMountCategory(g)) {
    badges.push({ key: 'arm', icon: <ArmMountIcon gadget={g} size={16} isDark={isDark} /> })
  }
  // 吸着給電のペンなど、このカードに内包したガジェット
  for (const a of node.attached ?? []) {
    // ペンは「アクセサリ」の絵では何が付いているのか分からない。ケースや保護フィルムは
    // 同じ Accessory でもペンではないので、名前と端子で見分ける
    const icon = g.category === 'Tablet' && isStylusAccessory(a) && PORT_ICONS.Stylus
      ? <AppIcon name={PORT_ICONS.Stylus} size={16} color={portIconColor('Stylus', isDark)} />
      : <CategoryIcon category={a.category} pcFormFactor={a.pcFormFactor} customIcon={a.customCategory?.icon} size={16} color={categoryIconColor(a.category, isDark, undefined, a.customCategory?.color)} />
    badges.push({ key: a.id, icon })
  }
  const badgeFit = badgeSlots(badges.length, node.w)

  // 読み上げ用。カードは色とアイコンで種類を示しているので、見えている情報を言葉にし直す。
  // 配線図で唯一の主要なタップ対象なので、ボタンであることと押した先も伝える
  const ja = lang === 'ja'
  const a11yLabel = [
    node.isWall ? (ja ? 'コンセント' : 'Wall outlet')
      : node.powerSource ? (ja ? '電源' : 'Power source')
      : node.isDecor ? (ja ? '飾り' : 'Decor')
      : node.isSubwoofer ? (ja ? 'ウーファー' : 'Subwoofer')
      // 図の枠にはジャンル名が主に出る。読み上げが商品名だけだと、音声で使う人にだけジャンルが伝わらない
      : gadgetGenreLabel(g, lang),
    node.isWall || node.powerSource || node.isDecor || node.isSubwoofer ? null : localizedGadgetName(g, lang),
    node.sideLabel,
    wifi ? 'Wi-Fi' : null,
    (node.attached?.length ?? 0) > 0
      ? (ja ? `ほか${node.attached!.length}点` : `plus ${node.attached!.length} more`)
      : null,
  ].filter(Boolean).join('、')

  return (
    <Pressable
      onPress={() => onPress(node.id)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={ja ? '接続の一覧と使用中のポートを開きます' : 'Opens its connections and ports in use'}
      // 押したことが分かるように沈ませる。Pressable は既定で見た目が変わらないため、
      // タップしても無反応に見えてしまう（配線図のカードは詳細シートを開く主要な導線）
      style={({ pressed }) => [styles.node, {
        left: node.x, top: node.y, width: node.w, height: node.h,
        backgroundColor: isPseudo ? C.chip : C.card,
        borderColor: glow ? C.accentIcon : col,
        borderWidth: glow ? 4 : 3,
        borderStyle: isPseudo || node.isDecor ? 'dashed' : 'solid',
        opacity: pressed ? 0.6 : 1,
      }]}
    >
      {node.sideLabel && (
        <View style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: themeTintBase(rawCol, isDark) + '33', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: C.text }}>{node.sideLabel}</Text>
        </View>
      )}
      {badges.slice(0, badgeFit.shown).map((badge, i) => (
        <View key={badge.key} style={[styles.thunderboltBadge, { right: 5 + i * 20 }]}>{badge.icon}</View>
      ))}
      {badgeFit.hidden > 0 && (
        <View style={[styles.thunderboltBadge, { right: 5 + badgeFit.shown * 20 }]}>
          <Text style={[styles.badgeOverflow, { color: C.textMuted }]}>+{badgeFit.hidden}</Text>
        </View>
      )}
      <MapNodeLabel
        gadget={g}
        width={node.w}
        height={node.h}
        isWall={node.isWall}
        powerSource={node.powerSource}
        isDecor={node.isDecor}
        isSubwoofer={node.isSubwoofer}
        textColor={C.text}
        subTextColor={C.textMuted}
        surfaceColor={C.card}
      />
    </Pressable>
  )
})

// ─── 接続方法ピッカー ─────────────────────────────────────────────
function MethodPicker({ from, to, recommend, colors: C, T, lang, onPick }: {
  from?: Gadget; to?: Gadget; recommend: Set<CableType>; colors: AppColors; T: (a: string, b: string) => string; lang: 'ja' | 'en'; onPick: (c: CableType) => void
}) {
  const [sel, setSel] = useState<CableType | null>(() => {
    const r = CABLE_OPTIONS.find((t) => recommend.has(t))
    return r ?? null
  })
  return (
    <>
      <View style={styles.methodHead}>
        <Text style={[styles.detailName, styles.methodHeadName, { color: C.text }]} numberOfLines={1}>{from?.name}</Text>
        <AppIcon name="ray-start-arrow" size={18} color={C.textMuted} />
        <Text style={[styles.detailName, styles.methodHeadName, { color: C.text }]} numberOfLines={1}>{to?.name}</Text>
      </View>
      <Text style={[styles.sheetLabel, { color: C.textSub }]}>{T('接続方法を選択', 'Select cable')}</Text>
      <CableSelect value={sel} recommend={recommend} colors={C} lang={lang} onPick={setSel} />
      <TouchableOpacity
        style={[styles.confirmBtn, { backgroundColor: sel ? C.accent : C.chip }]}
        disabled={!sel}
        onPress={() => sel && onPick(sel)}
      >
        <Text style={[styles.confirmBtnText, { color: sel ? C.onAccent : C.textMuted }]}>{T('接続する', 'Connect')}</Text>
      </TouchableOpacity>
    </>
  )
}

// ─── ケーブル選択（ドロップダウン式・おすすめ先頭）─────────────────────
function CableSelect({ value, recommend, colors: C, lang, onPick }: {
  value: CableType | null; recommend: Set<CableType>; colors: AppColors; lang: 'ja' | 'en'; onPick: (c: CableType) => void
}) {
  const { isDark } = useApp()
  const [expanded, setExpanded] = useState(false)
  const ordered = useMemo(() => {
    const rec = CABLE_OPTIONS.filter((t) => recommend.has(t))
    const rest = CABLE_OPTIONS.filter((t) => !recommend.has(t))
    return [...rec, ...rest]
  }, [recommend])
  const labelFor = (t: CableType) => (lang === 'ja' ? (CHIP_LABEL_JA[t] ?? cableLabel(t, lang)) : cableLabel(t, lang))
  return (
    <>
      <TouchableOpacity
        style={[styles.methodSelectTrigger, { backgroundColor: C.card, borderColor: expanded ? C.accentIcon : C.border }]}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        {value ? (
          <>
            <AppIcon name={PORT_ICONS[value] ?? 'cable-data'} size={17} color={portIconColor(value, isDark)} />
            <Text style={[styles.methodSelectLabel, { color: C.text }]} numberOfLines={1}>{labelFor(value)}</Text>
            {recommend.has(value) && <Text style={[styles.methodRecommended, { color: C.accentText }]}>{lang === 'ja' ? 'おすすめ' : 'Recommended'}</Text>}
          </>
        ) : (
          <Text style={[styles.methodSelectLabel, { color: C.textMuted }]}>{lang === 'ja' ? '選択してください' : 'Select a method'}</Text>
        )}
        <AppIcon name={expanded ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={C.textMuted} />
      </TouchableOpacity>
      {expanded && (
        <View style={[styles.methodSelectPanel, { backgroundColor: C.card, borderColor: C.border }]}>
          {ordered.map((t) => {
            const active = value === t
            const col = portIconColor(t, isDark)
            return (
              <TouchableOpacity
                key={t}
                style={[styles.methodSelectRow, { borderBottomColor: C.separator }, active && { backgroundColor: C.chip }]}
                onPress={() => { onPick(t); setExpanded(false) }}
              >
                <AppIcon name={PORT_ICONS[t] ?? 'cable-data'} size={17} color={col} />
                <Text style={[styles.methodSelectRowText, { color: C.text }]} numberOfLines={1}>{labelFor(t)}</Text>
                {recommend.has(t) && <Text style={[styles.methodRecommended, { color: C.accentText }]}>{lang === 'ja' ? 'おすすめ' : 'Recommended'}</Text>}
                <AppIcon name={active ? 'radiobox-marked' : 'radiobox-blank'} size={17} color={active ? C.accentIcon : C.textMuted} />
              </TouchableOpacity>
            )
          })}
        </View>
      )}
    </>
  )
}

// ─── 接続追加フルシート ───────────────────────────────────────────
function AddConnectionSheet({ gadgets, colors: C, T, lang, recommendCables, onAdd }: {
  gadgets: Gadget[]; colors: AppColors; T: (a: string, b: string) => string; lang: 'ja' | 'en'
  recommendCables: (a?: Gadget, b?: Gadget) => Set<CableType>
  onAdd: (from: string, to: string, cable: CableType) => void
}) {
  const { isDark } = useApp()
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [cable, setCable] = useState<CableType | null>(null)
  const [cableExpanded, setCableExpanded] = useState(false)
  const fromG = gadgets.find((g) => g.id === from)
  const toG = gadgets.find((g) => g.id === to)
  const rec = recommendCables(fromG, toG)
  const selectedCable = cable ?? (CABLE_OPTIONS.find((t) => rec.has(t)) ?? null)
  const orderedCables = [
    ...CABLE_OPTIONS.filter((t) => rec.has(t)),
    ...CABLE_OPTIONS.filter((t) => !rec.has(t)),
  ]

  const GadgetGrid = ({ value, exclude, onSelect }: { value: string | null; exclude?: string | null; onSelect: (id: string) => void }) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gGridRow}>
      {gadgets.filter((g) => g.id !== exclude).map((g) => {
        const on = value === g.id
        const col = categoryBaseColor(g.category, g.customCategory?.color, '#888')
        return (
          <TouchableOpacity key={g.id} style={[styles.gGridCell, { borderColor: on ? C.accentIcon : C.border, backgroundColor: on ? C.accent + '12' : C.card }]} onPress={() => onSelect(g.id)}>
            <View style={[styles.nodeIcon, { backgroundColor: col + '22' }]}>
              <CategoryIcon category={g.category} pcFormFactor={g.pcFormFactor} customIcon={g.customCategory?.icon} size={18} color={categoryIconColor(g.category, isDark, undefined, g.customCategory?.color)} />
            </View>
            {!!gadgetGenreLabel(g, lang) && (
              <Text style={[styles.gGridGenre, { color: C.textMuted }]} numberOfLines={1}>{gadgetGenreLabel(g, lang)}</Text>
            )}
            <Text style={[styles.gGridName, { color: C.text }]} numberOfLines={2}>{localizedGadgetName(g, lang)}</Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )

  return (
    <>
      <Text style={[styles.sheetTitle, { color: C.text }]}>{T('接続を追加', 'Add connection')}</Text>
      <Text style={[styles.sheetLabel, { color: C.textSub }]}>① {T('接続元', 'From')}</Text>
      <GadgetGrid value={from} exclude={to} onSelect={(id) => { setFrom((prev) => (prev === id ? null : id)); setCable(null); setCableExpanded(false) }} />
      <Text style={[styles.sheetLabel, { color: C.textSub }]}>② {T('接続先', 'To')}</Text>
      <GadgetGrid value={to} exclude={from} onSelect={(id) => { setTo((prev) => (prev === id ? null : id)); setCable(null); setCableExpanded(false) }} />
      <Text style={[styles.sheetLabel, { color: C.textSub }]}>③ {T('接続方法', 'Cable')}</Text>
      <TouchableOpacity
        style={[styles.methodSelectTrigger, { backgroundColor: C.card, borderColor: cableExpanded ? C.accentIcon : C.border }]}
        onPress={() => setCableExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={T('接続方法を選ぶ', 'Choose a connection method')}
        accessibilityState={{ expanded: cableExpanded }}
      >
        {selectedCable ? (
          <>
            <AppIcon name={PORT_ICONS[selectedCable] ?? 'cable-data'} size={17} color={portIconColor(selectedCable, isDark)} />
            <Text style={[styles.methodSelectLabel, { color: C.text }]} numberOfLines={1}>
                  {lang === 'ja' ? (CHIP_LABEL_JA[selectedCable] ?? cableLabel(selectedCable, lang)) : cableLabel(selectedCable, lang)}
            </Text>
            {rec.has(selectedCable) && <Text style={[styles.methodRecommended, { color: C.accentText }]}>{T('おすすめ', 'Recommended')}</Text>}
          </>
        ) : (
          <Text style={[styles.methodSelectLabel, { color: C.textMuted }]}>{T('選択してください', 'Select a method')}</Text>
        )}
        <AppIcon name={cableExpanded ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={C.textMuted} />
      </TouchableOpacity>
      {cableExpanded && (
        <View style={[styles.methodSelectPanel, { backgroundColor: C.card, borderColor: C.border }]}>
          {orderedCables.map((type) => {
            const active = selectedCable === type
            const color = portIconColor(type, isDark)
            return (
              <TouchableOpacity
                key={type}
                style={[styles.methodSelectRow, { borderBottomColor: C.separator }, active && { backgroundColor: C.chip }]}
                onPress={() => { setCable(type); setCableExpanded(false) }}
              >
                <AppIcon name={PORT_ICONS[type] ?? 'cable-data'} size={17} color={color} />
                <Text style={[styles.methodSelectRowText, { color: C.text }]} numberOfLines={1}>
                  {lang === 'ja' ? (CHIP_LABEL_JA[type] ?? cableLabel(type, lang)) : cableLabel(type, lang)}
                </Text>
                {rec.has(type) && <Text style={[styles.methodRecommended, { color: C.accentText }]}>{T('おすすめ', 'Recommended')}</Text>}
                <AppIcon name={active ? 'radiobox-marked' : 'radiobox-blank'} size={17} color={active ? C.accentIcon : C.textMuted} />
              </TouchableOpacity>
            )
          })}
        </View>
      )}
      <TouchableOpacity
        style={[styles.confirmBtn, { backgroundColor: from && to && selectedCable ? C.accent : C.chip }]}
        disabled={!from || !to || !selectedCable}
        onPress={() => {
          if (!from || !to || !selectedCable) return
          onAdd(from, to, selectedCable)
        }}
      >
        <Text style={[styles.confirmBtnText, { color: from && to && selectedCable ? C.onAccent : C.textMuted }]}>{T('追加', 'Add')}</Text>
      </TouchableOpacity>
    </>
  )
}

// ─── ワイヤレス充電ピッカー ──────────────────────────────────────
function WirelessPickerSheet({
  charger,
  allGadgets,
  existingConns,
  colors: C,
  T,
  onAdd,
}: {
  charger: Gadget
  allGadgets: Gadget[]
  existingConns: MapConnection[]
  colors: AppColors
  T: (a: string, b: string) => string
  onAdd: (targetIds: string[]) => void
}) {
  // lang は下の localizedGadgetName で使う。兄弟のシートは props で受け取っているが、
  // ここは useApp() を既に呼んでいるので同じところから引く
  const { isDark, lang } = useApp()
  const eligible = allGadgets.filter(hasWirelessInputPort)

  const alreadyLinked = new Set(
    existingConns
      .filter((c) =>
        (c.fromGadgetId === charger.id || c.toGadgetId === charger.id) &&
        c.cableType === 'wirelessCharging',
      )
      .map((c) => (c.fromGadgetId === charger.id ? c.toGadgetId : c.fromGadgetId)),
  )

  const [sel, setSel] = useState<Set<string>>(() =>
    new Set(
      charger.wirelessTargetGadgetIds?.filter(
        (id) => eligible.some((g) => g.id === id) && !alreadyLinked.has(id),
      ) ?? [],
    ),
  )

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <Text style={[styles.sheetTitle, { color: C.text }]}>{T('充電する機材を選択', 'Select gadgets to charge')}</Text>
      {eligible.length === 0 ? (
        <Text style={[styles.detailBrand, { color: C.textMuted, marginVertical: 20, textAlign: 'center' }]}>
          {T('ワイヤレス充電対応の機材がデスクにありません', 'No wireless-chargeable gadgets in this desk')}
        </Text>
      ) : (
        eligible.map((g) => {
          const linked = alreadyLinked.has(g.id)
          const on = sel.has(g.id)
          const col = categoryBaseColor(g.category, g.customCategory?.color, '#888')
          return (
            <TouchableOpacity
              key={g.id}
              style={[styles.wirelessRow, { borderBottomColor: C.border }]}
              onPress={() => !linked && toggle(g.id)}
              activeOpacity={linked ? 1 : 0.7}
            >
              <View style={[styles.nodeIcon, { backgroundColor: col + '22' }]}>
                <CategoryIcon category={g.category} pcFormFactor={g.pcFormFactor} customIcon={g.customCategory?.icon} size={18} color={categoryIconColor(g.category, isDark, undefined, g.customCategory?.color)} />
              </View>
              <View style={styles.wirelessRowText}>
                <Text style={[styles.detailConnName, styles.stackedRowTitle, { color: linked ? C.textMuted : C.text }]} numberOfLines={1}>
                  {localizedGadgetName(g, lang)}
                </Text>
                {!!gadgetGenreLabel(g, lang) && (
                  <Text style={[styles.wirelessRowGenre, { color: C.textMuted }]} numberOfLines={1}>{gadgetGenreLabel(g, lang)}</Text>
                )}
              </View>
              {linked ? (
                <AppIcon name="check-circle" size={20} color={C.textMuted} />
              ) : (
                <AppIcon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} color={on ? statusTextColor('success', isDark) : C.textMuted} />
              )}
            </TouchableOpacity>
          )
        })
      )}
      <TouchableOpacity
        style={[styles.confirmBtn, { backgroundColor: sel.size > 0 ? WIRELESS_COLOR : C.chip, marginTop: 16 }]}
        disabled={sel.size === 0}
        onPress={() => onAdd([...sel])}
      >
        <Text style={[styles.confirmBtnText, { color: sel.size > 0 ? '#fff' : C.textMuted }]}>
          {sel.size > 0
            ? T(`${sel.size}台を接続`, `Connect ${sel.size} device${sel.size !== 1 ? 's' : ''}`)
            : T('機材を選択してください', 'Select a gadget')}
        </Text>
      </TouchableOpacity>
    </>
  )
}

// ─── ボトムシート ─────────────────────────────────────────────────
function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  // 線編集シートの長さ・メモ欄はシートの下のほうにあり、押し上げが無いとキーボードの裏に入っていた。
  // 押し上げても縮んだシートの中でスクロールの外に残ることがあるので、欄まで送る
  const scrollRef = useRef<ScrollView>(null)
  useKeyboardReveal(scrollRef)
  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} sheetStyle={styles.sheet} avoidKeyboard>
        {/* 線編集シートは長さ・メモの入力と経路チップが同居する。指定が無いと、
            入力中にチップを押した1回目がキーボードを閉じるだけで消える */}
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { fontSize: 14 },

  viewport: { flex: 1, overflow: 'hidden' },

  cableLegend: {
    position: 'absolute', top: 12, left: 12, zIndex: 25,
    maxWidth: '72%', paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: UI_METRICS.controlRadius, borderWidth: 1, gap: 4,
  },
  cableLegendHeader: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  cableLegendTitle: { flexShrink: 1, fontSize: 10, fontWeight: '700' },
  cableLegendItemsScroll: { flexShrink: 1 },
  cableLegendItems: { flexDirection: 'column', gap: 2 },
  cableLegendItemsBarRoom: { paddingRight: 8 },
  cableLegendItem: { minWidth: 0, minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 6, paddingHorizontal: 4 },
  cableLegendLine: { width: 18, height: 4, borderRadius: UI_METRICS.pillRadius },
  cableLegendText: { flexShrink: 1, fontSize: 10, fontWeight: '600' },
  cableLegendCount: { marginLeft: 'auto', fontSize: 9, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // ノード右下のリサイズつまみ。当たり判定を確保しつつ、見た目は控えめにする
  resizeGrip: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 36,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingRight: 16,
    paddingBottom: 16,
  },
  resizeGripDot: {
    width: 9,
    height: 9,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    opacity: 0.55,
  },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: UI_METRICS.panelRadius, borderWidth: 1 },
  placementNotice: { position: 'absolute', top: 56, left: 12, right: 12, padding: 10, borderWidth: 1, borderRadius: UI_METRICS.panelRadius, zIndex: 20 },
  overlapRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  overlapName: { flex: 1, minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  overlapAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '500' },
  bannerBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: UI_METRICS.controlRadius },

  bannerBtnText: { fontSize: 12, fontWeight: '700' },

  node: { position: 'absolute', borderRadius: 0, alignItems: 'center', justifyContent: 'center', padding: 0, overflow: 'hidden' },
  thunderboltBadge: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  badgeOverflow: { fontSize: 11, fontWeight: '700' },
  nodeIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  // 下端の行には、ズームバー・履歴再生のピル（WiringResultScreen の wiringHistoryOverlay）・
  // FAB が並ぶ（下16・高さ最大48）。同じ高さに置くと、後から描かれるピルがこのバーを覆い、
  // ヒントを閉じる × が押せなくなる。16 + 48 + 8 でその上へ逃がす
  moveHint: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 72,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  moveHintText: { flex: 1, fontSize: 12, lineHeight: 16 },

  placementHint: { fontSize: 12, lineHeight: 16, textAlign: 'center' },

  zoomBar: {
    position: 'absolute',
    left: 12,
    bottom: 16,
    zIndex: 30,
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: UI_METRICS.panelRadius,
    overflow: 'hidden',
  },
  playbackBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', gap: 1 },
  fitLabel: { fontSize: 9, fontWeight: '700', lineHeight: 11 },

  // 大きさと形は IconCircleButton が持つ。ここは置き場所だけ
  fab: { position: 'absolute', right: 16, bottom: 16 },

  sheet: { maxHeight: '80%' },
  sheetTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  sheetLabel: { fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 8 },

  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  detailIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  detailName: { fontSize: 16, fontWeight: '700' },
  detailBrand: { fontSize: 12, marginTop: 2 },
  detailConnRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  detailConnName: { flex: 1, fontSize: 14 },
  // 無線・BT・WiFi のグリフ1つを載せるだけのバッジ。同じファイルの fab と同じ円
  subBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  sheetBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: UI_METRICS.controlRadius, borderWidth: 1 },
  sheetBtnText: { fontSize: 14, fontWeight: '600' },

  edgeHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: UI_METRICS.controlRadius, borderWidth: 1, marginTop: 18 },
  routeSummary: { borderWidth: 1, borderRadius: UI_METRICS.controlRadius, padding: 11 },
  choiceSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, padding: 11 },
  countStep: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.controlRadius, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  routeSummaryText: { fontSize: 13, fontWeight: '600' },
  routeNote: { fontSize: 12, marginTop: 5 },
  routeInput: { minHeight: UI_METRICS.inputHeight, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 12, marginBottom: 8 },
  routeField: { marginBottom: 8 },
  // 伸びる上限。シートの中なので、伸び続けると保存の行が画面の外へ出る
  routeNoteInput: { minHeight: 64, maxHeight: 120, paddingTop: 10, textAlignVertical: 'top' },
  routeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  routeChip: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderRadius: UI_METRICS.pillRadius, paddingHorizontal: 10 },
  routeChipText: { fontSize: 11, fontWeight: '600' },

  methodHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  // 2台の名前が横に並ぶので、縮めないと長い名前で2台目がシートの外へ出る
  methodHeadName: { flexShrink: 1 },
  methodSelectTrigger: { height: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: UI_METRICS.controlRadius },
  methodSelectLabel: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700' },
  methodRecommended: { fontSize: 10, fontWeight: '700' },
  methodSelectPanel: { marginTop: 6, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, overflow: 'hidden' },
  methodSelectRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  methodSelectRowText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600' },

  confirmBtn: { marginTop: 18, paddingVertical: 13, borderRadius: UI_METRICS.controlRadius, alignItems: 'center' },
  confirmBtnText: { fontSize: 15, fontWeight: '700' },

  gGridRow: { gap: 8, paddingVertical: 2 },
  gGridCell: { width: 76, borderRadius: UI_METRICS.panelRadius, borderWidth: 1.5, alignItems: 'center', padding: 8, gap: 5 },
  gGridName: { fontSize: 10, fontWeight: '600', textAlign: 'center', lineHeight: 12 },
  // 商品名を入れた機材は名前がジャンルを表さないので、名前の上・下に添える
  gGridGenre: { fontSize: 10, textAlign: 'center', lineHeight: 12, marginBottom: -3 },
  wirelessRowText: { flex: 1, minWidth: 0 },
  // detailConnName / methodSelectRowText の flex: 1 は横並びの行のためのもの。2行目（ジャンル・ケーブル名）と
  // 縦に積む入れ物の中では縦方向に効いて1行目の高さが潰れ、上下が切れる
  stackedRowTitle: { flex: 0 },
  wirelessRowGenre: { fontSize: 12, marginTop: 1 },

  wirelessRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },

  relayoutPill: {
    position: 'absolute', top: 12, alignSelf: 'center', zIndex: 20,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: UI_METRICS.pillRadius, borderWidth: 1,
  },
  relayoutPillText: { fontSize: 12, fontWeight: '700' },
  // 一発アクション用（トグルではないので状態を示す枠線なし）
  // 「…」ボタンの下に展開するパネル（電源・Bluetooth・充電器・再構成・全削除を縦に並べる）
  // 「…」ボタン(mapToggleBtn)と全く同じ大きさ（width/height/borderRadius）に揃える
})
