import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated'
import { categoryIconColor, DECOR_COLOR, themeIconColor, themeTintBase, categoryBaseColor } from '../../constants/icons'
import { isWirelessPortType, PORT_ICONS, portColor, portIconColor } from '../../constants/portTypes'
import { AppColors, useApp } from '../../context/AppContext'
import { CableType, Gadget } from '../../types'
import { gadgetGenreLabel, localizedGadgetName } from '../../utils/localizedGadgetName'
import { baseMapNodeId, MapEdge, MapLayout, MapNode, pointsToPath, pointsToRoundedPath, wavyPath } from '../../utils/connectionMapLayout'
import { MapNodeLabel, POWER_SOURCE_COLORS } from '../atoms/MapNodeLabel'
import { AppIcon } from '../atoms/AppIcon'
import { WIRE_CASING_WIDTH, WIRE_LINE_WIDTH } from '../../constants/wiring'
import { branchJunctionsForDrawing, CrossingCut, crossingCutPath, crossingCutsForDrawing, sortEdgesForDrawing } from '../../utils/wireStacking'
import { isStylusAccessory } from '../../utils/gadgetAttachments'
import { SectionBoundary } from '../molecules/ErrorContainment'
import { HistoryMotionNumber, HistoryMotionPath as AnimatedPath, HistoryMotionProgress, HistoryMotionView, useHistoryMotionClock } from '../molecules/HistoryMotion'

// 進行クロックのイージング（従来 Animated.timing の既定と同じ）
const EASE = Easing.inOut(Easing.ease)

// 1イベントの演出タイムライン（0..1 の正規化時間）。フェーズは重ねずに順番に流す：
//  ① 0.00–0.05  経路が変わる配線がフェードアウト（線を動かさず、いったん消す）
//  ② 0.05–0.24  MOVE：残るガジェット（と撤去予定のガジェット）が前日の位置から当日の位置へ滑らかに移動
//  ③ 0.24–0.32  移動後の位置で、すでにある配線がフェードインして現れる
//  ④ 0.36–0.48  OUT：撤去される配線が末端から段ごとに引っ込む（しまう）
//  ⑤ 〜0.54     OUT：線が離れたガジェットから順にフェードアウト（④と重なって進む）
//  ⑥ 0.56–1.00  IN：新しい配線が段ごとに伸び、到着直前にその先のガジェットが現れる
//
// 配線は動かさない：移動中は消えていて、ガジェットが落ち着いてから新しい経路で現れる。
// しまう線・撤去ガジェットも「当日のレイアウト」に含めてルーティングされている（deskTimeline の
// renderGadgets / renderConnections）ため、座標の借用や位置補正は一切不要。
const WIRE_FADE_OUT = [0, 0.05] as const
const MOVE_SPAN     = [0.05, 0.24] as const
const WIRE_FADE_IN  = [0.25, 0.33] as const
const EXIT_WIRE  = [0.36, 0.48] as const
// 同じ集約期間内で導入・撤去した機材は、導入演出が終わってから片付ける。
const TRANSIENT_EXIT_WIRE = [0.92, 1] as const
const EXIT_NODE_MAX = 0.54
const WIRE_START = 0.56
// しまうものが無い日は、配線が現れ終わりしだい引き始める
const NO_EXIT_WIRE_START = 0.36
// 移動もしまうものも無い日（先頭イベント含む）は、待たずに配線を伸ばす
const FIRST_WIRE_START = 0.12
// 入場配線を「引き終える」時刻。ここを 1.0 にすると連鎖の最後の配線
// （コンセント→充電器→スマホ の「充電器→スマホ」など）が演出のちょうど最後の瞬間に
// 描き終わり、直後の日送りで一瞬しか見えない。手前で引き終えて、残りを
// 「配線し終わった図を眺める時間」に充てる。
const WIRE_ENTER_END = 0.9

// 配線が繋がる先のガジェットは「線が到着する直前」にフェードインさせる。
// どの配線にも繋がらないガジェット（コンセントすら持たない）は、すべての配線を引き終えてから現れる。
// NODE_ISOLATED_T はその上限。実際の登場時刻は「その日に引く配線を引き終えた直後」で、
// 引く配線が無い日は待たずに出す（下の isolatedT）。
const NODE_FADE_SPAN = 0.1
const NODE_ISOLATED_T = 0.9
// 線が到着する側のガジェット：到着の NODE_ARRIVE_FADE 前から現れるが、線を NODE_ARRIVE_AFTER の割合まで
// 引くまでは待つ。短い線でフェードが一瞬（＝ポップ）にならないよう、最短の尺だけは到着後へはみ出して確保する
const NODE_ARRIVE_FADE = 0.05
const NODE_ARRIVE_AFTER = 0.6
const NODE_ARRIVE_MIN_FADE = 0.025
// 撤去されたガジェットのうち、線が出ていく側として残るものが消えるときのフェード幅と、
// その線をしまい終えてから消え始めるまでの間（線が入ってくる側は NODE_ARRIVE_* を裏返して使う）
const NODE_EXIT_FADE_SPAN = 0.07
const NODE_EXIT_DELAY = 0.03

// 配線は依存する段（ウェーブ）ごとに流す。線と線のあいだに置く小さな間（正規化時間比）
const WIRE_GAP_RATIO = 0.06
// 1本あたりの尺は長さに比例させる（伸びる速度を一定に保つ）が、下限を設ける
const WIRE_MIN_WEIGHT = 0.35

const WIRE_REF_LEN = 420

const PHASE_EPS = 1e-4

/** 進行値 value の時点で跨ぎ終えている最後の境界（boundaries は昇順）。どれも跨いでいなければ 0 */
function phaseAt(value: number, boundaries: readonly number[]): number {
  'worklet'
  let p = 0
  for (let i = 0; i < boundaries.length; i++) {
    if (value + PHASE_EPS >= boundaries[i]) p = boundaries[i]
    else break
  }
  return p
}

// ケーブルを買った・替えた日に、同じ種類の線を光らせる尺（線が現れ終わってから）。
// 線そのものの太さは変えず、下に敷いた後光だけを2回膨らませる。線を太らせると
// 縁取りと重なり順（交差の上下）が崩れ、隣の線と重なって見える
const GLOW_SPAN = 0.24
const GLOW_OPACITY = [0, 0.5, 0.12, 0.5, 0]
const GLOW_WIDTH = [0, 10, 4, 10, 0].map((extra) => WIRE_CASING_WIDTH + extra)
// 演出の終わり際に伸びた線は残り時間が短い。2回を詰め込むと点滅に見えるので1回にする
const GLOW_SINGLE_BELOW = GLOW_SPAN * 0.6
const GLOW_OPACITY_SINGLE = [0, 0.5, 0]
const GLOW_WIDTH_SINGLE = [0, 10, 0].map((extra) => WIRE_CASING_WIDTH + extra)
const NO_GLOW: ReadonlySet<CableType> = new Set()

interface Props {
  layout: MapLayout            // 当日の配線図（撤去されるガジェット・しまう線も含む合算）
  prevLayout: MapLayout | null // 直前イベントの配線図（ガジェット移動モーフとカメラ補間に使う）
  /**
   * イベント切り替えごとに変化 → 演出を再生。`${index}-${nonce}` の形で渡すこと。
   * index だけだと、リプレイで末尾→先頭（0）に戻る際に「たまたま同じ index」に
   * なるケース（1件しかない歴史など）で変化を検知できず、進行値がリセットされずに
   * 配線が最初から描き直されない（すでに完了した状態のまま静止して見える）。
   */
  animKey: string
  durationMs: number           // 1イベントの演出尺（速度で調整済み）
  /**
   * animKey が変わったときに演出をどこから始めるか（0..1・演出尺に対する経過の割合）。
   * 再生バーで日の途中へ動かしたときに使う。既定は 0（頭から）
   */
  startAt?: number
  /** true の間は進行クロックを止める（再生バーを指で動かしている間など）。false に戻すと今の位置から続ける */
  frozen?: boolean
  /**
   * 進行位置（0..1・演出尺に対する経過の割合）を外から合わせる関数の受け口。
   * 再生バーのドラッグに合わせて毎フレーム呼ぶので、再レンダーを経由させない。frozen の間だけ使う
   */
  seekRef?: React.MutableRefObject<((x: number) => void) | null>
  /** ガジェットを前日位置から当日位置へ滑らかに動かすか。false なら当日位置に瞬時に置く */
  morph?: boolean
  reduceMotion?: boolean
  width: number
  height: number
  /** 直前ページの実測表示領域。下部パネルの高さが変わっても開始画角を一致させる。 */
  prevViewport?: { w: number; h: number }
  hudRects?: { x: number; y: number; w: number; h: number }[]
  prevHudRects?: { x: number; y: number; w: number; h: number }[]
  colors: AppColors
  /** 最終「今日」ページでは、全体フィットより少し引いて俯瞰する。 */
  overview?: boolean
  // 新規（IN）は「前日のレイアウトに無かったもの」として内部で判定する。
  // 撤去（OUT）は当日のレイアウトにも残っている（しまう演出のため）ので、外から教えてもらう。
  exitingNodeIds: Set<string>   // ガジェットID（分割ノード __L/__R は内部で解決する）
  exitingEdgeIds: Set<string>   // 接続ID
  /** 導入ガジェットID → 同じイベントで撤去される置換元ガジェットID */
  replacementPairs?: ReadonlyMap<string, string>
  /**
   * この日に追加・交換されたケーブルの種類。同じ種類の線を光らせる。
   * ケーブルの登録は「どの線か」を持たないので、同じ種類の線が複数あれば全部光る
   */
  glowCableTypes?: ReadonlySet<CableType>
  /**
   * 進行クロックのイージング。既定は履歴アニメ従来の inOut。
   * 演出中は張り直さないので、レンダーごとに作り直さない関数を渡すこと。
   */
  clockEasing?: (t: number) => number
  /** 配線1本が伸びるときのイージング。既定は等速（履歴アニメ従来の挙動） */
  wireEasing?: (t: number) => number
  /**
   * ガジェットのタップ。**渡されたときだけ**キャンバスが指を受け取る。
   *
   * 再生中は undefined にすること。上に重なるストーリー操作（左＝前へ / 中央＝再生停止 /
   * 右＝次へ）を潰してしまうのと、MOVE フェーズではノードが動いていて押した先が
   * 別のガジェットになるため。渡していない間はキャンバス全体が pointerEvents="none" で、
   * 触り心地も処理も従来どおり変わらない。
   */
  onSelectGadget?: (gadget: Gadget) => void
}

function polylineLength(points: { x: number; y: number }[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return Math.max(1, len)
}

// レイアウトの実コンテンツ外接矩形。
// layout.width/height は帯（band）の理論幅で余白が残るため、実測で画面フィットさせる
function contentBounds(layout: MapLayout): { x: number; y: number; w: number; h: number } {
  const PAD = 8
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of layout.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h)
  }
  for (const e of layout.edges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: layout.width, h: layout.height }
  return {
    x: minX - PAD,
    y: minY - PAD,
    w: Math.max(1, maxX - minX + PAD * 2),
    h: Math.max(1, maxY - minY + PAD * 2),
  }
}

type Bounds = { x: number; y: number; w: number; h: number }
type HudRect = { x: number; y: number; w: number; h: number }

function cameraIntersectsHud(
  layout: MapLayout,
  bounds: Bounds,
  scale: number,
  shiftX: number,
  shiftY: number,
  width: number,
  height: number,
  hudRects: HudRect[],
): boolean {
  if (hudRects.length === 0) return false
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  const sx = (x: number) => width / 2 + shiftX + scale * (x - cx)
  const sy = (y: number) => height / 2 + shiftY + scale * (y - cy)
  const overlaps = (a: HudRect, b: HudRect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  const hits = (rect: HudRect) => hudRects.some((hud) => overlaps(rect, hud))

  for (const node of layout.nodes) {
    if (hits({ x: sx(node.x), y: sy(node.y), w: node.w * scale, h: node.h * scale })) return true
  }
  const pad = 6
  for (const edge of layout.edges) {
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]
      const b = edge.points[i]
      const x1 = sx(a.x), y1 = sy(a.y), x2 = sx(b.x), y2 = sy(b.y)
      if (hits({
        x: Math.min(x1, x2) - pad,
        y: Math.min(y1, y2) - pad,
        w: Math.abs(x2 - x1) + pad * 2,
        h: Math.abs(y2 - y1) + pad * 2,
      })) return true
    }
  }
  return false
}

/** 左右のHUDを必要なときだけ避け、中央上の空間は通常のフィットに残す。 */
function fitCamera(
  layout: MapLayout,
  bounds: Bounds,
  width: number,
  height: number,
  hudRects: HudRect[],
  overview: boolean,
): { scale: number; shiftX: number; shiftY: number } {
  const overviewScale = overview ? 0.88 : 1
  const baseScale = Math.min(width / bounds.w, height / bounds.h, 1) * overviewScale
  if (!cameraIntersectsHud(layout, bounds, baseScale, 0, 0, width, height, hudRects)) {
    return { scale: baseScale, shiftX: 0, shiftY: 0 }
  }

  const maxHudBottom = Math.max(0, ...hudRects.map((rect) => rect.y + rect.h))
  const maxDown = Math.max(0, height / 2 - baseScale * bounds.h / 2 - 4)
  for (let down = 2; down <= maxDown; down += 2) {
    if (!cameraIntersectsHud(layout, bounds, baseScale, 0, down, width, height, hudRects)) {
      return { scale: baseScale, shiftX: 0, shiftY: down }
    }
  }

  const safeTop = Math.min(height - 1, maxHudBottom + 8)
  const availableH = Math.max(1, height - safeTop)
  const scale = Math.min(width / bounds.w, availableH / bounds.h, 1) * overviewScale
  return {
    scale,
    shiftX: 0,
    shiftY: safeTop + availableH / 2 - height / 2,
  }
}

/**
 * コンセント（wall）から各ノードまでのホップ数。
 * 「電源に近い配線から引く／遠い配線から片付ける」順序付けの基準に使う。
 *
 * @param edges 距離を測るのに使う配線。
 *   新設の順序を決めるときは「当日残る線」だけを渡すこと。撤去される線を含めると
 *   （例：電源タップを買った日に、まだ残っている旧「コンセント→充電器」の直結線を通って）
 *   充電器のホップ数が小さく見積もられ、コンセント→タップ→充電器 の順序が崩れる。
 */
function hopsFromWall(layout: MapLayout, edges: MapEdge[]): Map<string, number> {
  const dist = new Map<string, number>()
  const wall = layout.nodes.find((n) => n.isWall)
  if (!wall) return dist

  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!adj.has(e.from.id)) adj.set(e.from.id, [])
    if (!adj.has(e.to.id)) adj.set(e.to.id, [])
    adj.get(e.from.id)!.push(e.to.id)
    adj.get(e.to.id)!.push(e.from.id)
  }

  dist.set(wall.id, 0)
  const queue = [wall.id]
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]
    const d = dist.get(cur)!
    for (const next of adj.get(cur) ?? []) {
      if (dist.has(next)) continue
      dist.set(next, d + 1)
      queue.push(next)
    }
  }
  return dist
}

// wall から遠いノードほど大きい値（未接続は最遠として扱う）
const hopOf = (dist: Map<string, number>, id: string) => dist.get(id) ?? Number.MAX_SAFE_INTEGER

// 無線接続（Bluetooth / Wi-Fi / ワイヤレス給電）。ケーブルのように「伸ばす」ものではないので、
// 演出の順番でも描き方でも有線と区別する
const isWirelessEdge = (e: MapEdge) => isWirelessPortType(e.conn.cableType)
// Wi-Fi は配線図と同じく線を引かず、ガジェットカード右上のマークで示す。
// ここで線を出すと、配線図では無線バッジだけの機器が履歴では有線と同じ線で繋がって見える
const isBadgeOnlyEdge = (e: MapEdge) => e.conn.cableType === 'WiFi'
const isMobileBatteryChargeEdge = (e: MapEdge) =>
  e.conn.chargingOnly === true && e.from.gadget.category === 'MobileBattery'

/**
 * 配線を「依存する段（ウェーブ）」に分けて、[from, to] の尺へ順番に流し込む。
 * 同じウェーブの独立した線は並行して伸ばす（電源タップから2台の充電器へ、など）。
 * 各ウェーブの尺は、その中で最も長い線に合わせる（同時に伸びるので、伸びる速度が揃う）。
 * 新設時は接続元への線が届きしだい次の線を引き、無関係な長い線の完了を待たない。
 */
function assignWaveSpans(
  waves: MapEdge[][],
  from: number,
  to: number,
  startWhenSourceReady = false,
): Map<string, { start: number; end: number }> {
  const spans = new Map<string, { start: number; end: number }>()
  const active = waves.filter((w) => w.length > 0)
  if (active.length === 0) return spans

  const weights = active.map((wave) =>
    Math.max(WIRE_MIN_WEIGHT, Math.max(...wave.map((e) => polylineLength(e.points))) / WIRE_REF_LEN),
  )
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const totalGap = WIRE_GAP_RATIO * (active.length - 1)
  const unit = (to - from) / (totalWeight + totalGap)
  const sourceReady = new Map<string, number>()

  let cursor = from
  active.forEach((wave, i) => {
    const dur = weights[i] * unit
    const end = Math.min(to, cursor + dur)
    // 開始を前倒ししても線の尺は長さに比例させ、伸びる速度を揃える。
    const longest = Math.max(...wave.map((e) => polylineLength(e.points))) || 1
    for (const e of wave) {
      // 無線は線全体のフェードなので、短い経路だけ一瞬で表示・消去しない。
      const ratio = isWirelessEdge(e) ? 1 : polylineLength(e.points) / longest
      const start = startWhenSourceReady && !isWirelessEdge(e) && !e.isPairLink
        ? Math.min(cursor, sourceReady.get(e.from.id) ?? cursor)
        : cursor
      spans.set(e.conn.id, { start, end: start + (end - cursor) * ratio })
    }
    // 同じ段の線は同時に決め、配列の並び順で開始時刻が変わらないようにする。
    for (const e of wave) {
      if (isWirelessEdge(e) || e.isPairLink) continue
      const arrival = spans.get(e.conn.id)!.end
      sourceReady.set(e.to.id, Math.min(sourceReady.get(e.to.id) ?? Infinity, arrival))
    }
    cursor = end + WIRE_GAP_RATIO * unit
  })
  return spans
}

/**
 * 配線をウェーブ（同時に引いてよい線のまとまり）へ分ける。
 * コンセントからのホップ数が同じ線は互いに独立とみなして同時に引く。
 * @param wirelessLast true なら無線を最後のウェーブ群に回す（給電が通ってから無線が繋がる）
 * @param farthestFirst true なら遠い線から（撤去時：末端から片付ける）
 */
function buildWaves(edges: MapEdge[], hops: Map<string, number>, wirelessLast: boolean, farthestFirst: boolean): MapEdge[][] {
  if (edges.length === 0) return []
  const keyHop = (e: MapEdge) =>
    farthestFirst
      ? Math.max(hopOf(hops, e.from.id), hopOf(hops, e.to.id))
      : Math.min(hopOf(hops, e.from.id), hopOf(hops, e.to.id))

  const groups = new Map<string, MapEdge[]>()
  for (const e of edges) {
    const wireless = isWirelessEdge(e)
    const phase = wirelessLast ? (wireless ? 1 : 0) : (wireless ? 0 : 1)
    const key = `${phase}#${keyHop(e)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const [pa, ha] = a.split('#').map(Number)
      const [pb, hb] = b.split('#').map(Number)
      if (pa !== pb) return pa - pb
      return farthestFirst ? hb - ha : ha - hb
    })
    .map(([, wave]) => wave)
}

type Pt = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }

const samePath = (a: Pt[], b: Pt[]) =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y)

const pathIntersectsRect = (points: Pt[], rect: Rect, padding = 6) => {
  const left = rect.x - padding
  const right = rect.x + rect.w + padding
  const top = rect.y - padding
  const bottom = rect.y + rect.h + padding
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x)
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y)
    if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) return true
  }
  return false
}

/**
 * 歴史アニメーションの配線図。
 *   移動（MOVE）→ 残るガジェットが前日の位置から滑らかに動き、配線も追従
 *   撤去（OUT）→ 配線が末端から引っ込み、しまい終えたガジェットが消える
 *   導入（IN） → 配線が伸び、到着直前にガジェットがフェードイン
 */
function HistoryWiringCanvasInner({
  layout, prevLayout, animKey, durationMs, startAt = 0, frozen = false, seekRef,
  width, height, prevViewport, hudRects = [], prevHudRects = [], colors,
  exitingNodeIds, exitingEdgeIds, replacementPairs = new Map(), morph = true, overview = false, reduceMotion = false,
  clockEasing = EASE, wireEasing, onSelectGadget, glowCableTypes = NO_GLOW,
}: Props) {
  const fresh = !prevLayout
  // 移動モーフを行うか。OFF または先頭イベントでは前日位置を使わず、当日位置に据える。
  const animateMove = morph && !fresh && !reduceMotion
  // 最終ページの俯瞰だけは、滑らか移動設定がOFFでもカメラを引く演出を残す。
  const animateCamera = !fresh && !reduceMotion && (morph || overview)

  // ─── 進行クロック ───
  // JS には操作用の経過位置と計測だけを残す。描画と境界判定は UI クロックへ任せる。
  const startValue = reduceMotion ? 1 : clockEasing(Math.max(0, Math.min(1, startAt)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => ({}), [animKey])
  const tRef = useRef(startValue)
  // 演出尺に対する経過の割合（イージング前）。途中から再開するときに同じ曲線の続きを走らせるため、
  // イージング後の値（tRef）とは別に持つ
  const xRef = useRef(Math.max(0, Math.min(1, startAt)))
  const visualSeekRef = useRef<((x: number) => void) | null>(null)
  // 進行値のリセットは useEffect ではなくレンダー中に行う。子（LayoutLayer）の effect は
  // 親より先に走るため、effect でリセットすると、子が「前イベントの最終値（1）」を読んで
  // フェーズを最後まで進め、配線が描き終わった状態で1フレーム表示されてしまう。
  const tKeyRef = useRef(t)
  // 計測（__DEV__ のみ）：重さの正体を「落ちフレーム数」「LayoutLayer の再レンダー回数」
  // 「同時に演出中の要素の最大数」の3つで1イベントごとに出す。
  const perf = useRef({ frames: 0, dropped: 0, worst: 0, layerRenders: 0, peakAnimated: 0, last: 0 })
  if (tKeyRef.current !== t) {
    tKeyRef.current = t
    xRef.current = Math.max(0, Math.min(1, startAt))
    tRef.current = startValue
    const p = perf.current
    p.frames = 0; p.dropped = 0; p.worst = 0; p.layerRenders = 0; p.peakAnimated = 0; p.last = 0
  }

  useEffect(() => {
    if (reduceMotion) {
      xRef.current = 1
      tRef.current = 1
      return
    }
    if (frozen) return
    const from = xRef.current
    if (from >= 1) return
    // 従来の Animated.timing と同じ尺（残りぶん）・イージングで進める。
    // 途中（速度変更・再生バーで動かした位置）からは、同じイージング曲線の続きを走らせる
    const total = durationMs * (1 - from)
    const startTs = Date.now()
    // 速度変更で張り直したときは同じイベントの計測を続ける。フレーム間隔だけは
    // 張り直しの空白を落ちフレームに数えないようリセットする。
    perf.current.last = 0
    let raf = 0
    const tick = () => {
      const now = Date.now()
      if (__DEV__) {
        const p = perf.current
        if (p.last > 0) {
          const dt = now - p.last
          p.frames += 1
          if (dt > 32) p.dropped += 1
          if (dt > p.worst) p.worst = dt
        }
        p.last = now
      }
      const x = from + (1 - from) * Math.min(1, (now - startTs) / total)
      const v = clockEasing(x)
      xRef.current = x
      tRef.current = v
      // 演出を終えたらループを止める。次のイベント（animKey 変化）で張り直される
      if (x < 1) raf = requestAnimationFrame(tick)
      else if (__DEV__) {
        const p = perf.current
        console.log(
          `[perf] history "${animKey}": ${p.frames}f dropped(>32ms)=${p.dropped} worst=${p.worst}ms` +
          ` renders=${p.layerRenders} peakAnimated=${p.peakAnimated}` +
          ` edges=${layout.edges.length} nodes=${layout.nodes.length}`,
        )
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // durationMs を含める：速度変更時は現在地から新しい速度で進み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, durationMs, reduceMotion, frozen])

  // 再生バーのドラッグに合わせて進行位置を直接置く。戻す方向にも動かせる：
  // 線の伸び・ガジェットの出入りと移動・カメラはどれも進行値だけで決まり、フェーズ追跡も
  // 「進行値以下で最後の境界」を引き直すので、値を戻せば描画もそのまま巻き戻る
  useEffect(() => {
    if (!seekRef) return
    seekRef.current = (x: number) => {
      const clamped = Math.max(0, Math.min(1, x))
      const v = reduceMotion ? 1 : clockEasing(clamped)
      xRef.current = clamped
      tRef.current = v
      visualSeekRef.current?.(clamped)
    }
    return () => { seekRef.current = null }
  }, [seekRef, t, reduceMotion, clockEasing])

  // ─── カメラ補間 ───
  const motion = useHistoryMotionClock({ animKey, startAt, durationMs, frozen, reduceMotion, clockEasing, seekRef: visualSeekRef })
  // ガジェットの移動と同じ区間で、フィット倍率と原点を前日 → 当日へ滑らかに動かす
  const bounds     = useMemo(() => {
    const b = contentBounds(layout)
    if (!prevLayout || !animateMove) return b
    // 移動するガジェットは前日位置から動く。その前日位置も外接矩形に含めておかないと、
    // 移動の開始側が枠外に出て見切れる（左右に離れた分割スピーカー等で起きやすい）。
    const currById = new Map(layout.nodes.map((n) => [n.id, n]))
    let minX = b.x, minY = b.y, maxX = b.x + b.w, maxY = b.y + b.h
    for (const pn of prevLayout.nodes) {
      const cn = currById.get(pn.id)
      if (!cn || (cn.x === pn.x && cn.y === pn.y)) continue
      minX = Math.min(minX, pn.x); minY = Math.min(minY, pn.y)
      maxX = Math.max(maxX, pn.x + pn.w); maxY = Math.max(maxY, pn.y + pn.h)
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }, [layout, prevLayout, animateMove])
  const prevBounds = useMemo(() => (prevLayout ? contentBounds(prevLayout) : null), [prevLayout])
  const currentCamera = fitCamera(layout, bounds, width, height, hudRects, overview)
  const currScale = currentCamera.scale
  const prevWidth = prevViewport?.w ?? width
  const prevHeight = prevViewport?.h ?? height
  const previousCamera = prevLayout && prevBounds
    ? fitCamera(prevLayout, prevBounds, prevWidth, prevHeight, prevHudRects, false)
    : currentCamera
  const prevScale = previousCamera.scale
  const prevViewportShiftX = ((prevViewport?.w ?? width) - width) / 2 / Math.max(prevScale, 0.001)
  const prevViewportShiftY = ((prevViewport?.h ?? height) - height) / 2 / Math.max(prevScale, 0.001)
  const startShiftX = prevBounds
    ? bounds.x + bounds.w / 2 - (prevBounds.x + prevBounds.w / 2) + prevViewportShiftX + previousCamera.shiftX / Math.max(prevScale, 0.001)
    : currentCamera.shiftX / Math.max(currScale, 0.001)
  const startShiftY = prevBounds
    ? bounds.y + bounds.h / 2 - (prevBounds.y + prevBounds.h / 2) + prevViewportShiftY + previousCamera.shiftY / Math.max(prevScale, 0.001)
    : currentCamera.shiftY / Math.max(currScale, 0.001)
  const endShiftX = currentCamera.shiftX / Math.max(currScale, 0.001)
  const endShiftY = currentCamera.shiftY / Math.max(currScale, 0.001)
  const camScale: HistoryMotionNumber =
    !animateCamera || prevScale === currScale
      ? currScale
      : motion.interpolate({ inputRange: [...MOVE_SPAN], outputRange: [prevScale, currScale], extrapolate: 'clamp' })
  const camShiftX: HistoryMotionNumber =
    !animateCamera || !prevBounds
      ? endShiftX
      : motion.interpolate({
          inputRange: [...MOVE_SPAN],
          outputRange: [startShiftX, endShiftX],
          extrapolate: 'clamp',
        })
  const camShiftY: HistoryMotionNumber =
    !animateCamera || !prevBounds
      ? endShiftY
      : motion.interpolate({
          inputRange: [...MOVE_SPAN],
          outputRange: [startShiftY, endShiftY],
          extrapolate: 'clamp',
        })

  return (
    // box-none にするのはガジェットのタップを受け付けるときだけ。ノード以外は素通しなので、
    // 下に敷いたストーリー操作（左＝前へ / 中央＝再生停止 / 右＝次へ）はそのまま効く
    <View
      style={[styles.viewport, { width, height, backgroundColor: colors.bgList }]}
      pointerEvents={onSelectGadget ? 'box-none' : 'none'}
    >
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="box-none">
        <LayoutLayer
          layout={layout}
          prevLayout={prevLayout}
          bounds={bounds}
          scale={camScale}
          shiftX={camShiftX}
          shiftY={camShiftY}
          colors={colors}
          progress={motion}
          progressRef={tRef}
          perfCounter={perf.current}
          exitingNodes={exitingNodeIds}
          exitingEdges={exitingEdgeIds}
          replacementPairs={replacementPairs}
          glowCableTypes={reduceMotion ? NO_GLOW : glowCableTypes}
          animateMove={animateMove}
          wireEasing={wireEasing}
          onSelectGadget={onSelectGadget}
        />
      </View>
    </View>
  )
}

interface LayerProps {
  onSelectGadget?: (gadget: Gadget) => void
  layout: MapLayout
  prevLayout: MapLayout | null
  bounds: { x: number; y: number; w: number; h: number }
  scale: HistoryMotionNumber
  shiftX: HistoryMotionNumber
  shiftY: HistoryMotionNumber
  colors: AppColors
  progress: HistoryMotionProgress
  /** 初回描画のフェーズを途中位置に合わせるための進行値 */
  progressRef: React.MutableRefObject<number>
  /** 計測の集計先（__DEV__ のときだけ書き込む） */
  perfCounter: { layerRenders: number; peakAnimated: number }
  exitingNodes: Set<string>   // ガジェットID
  exitingEdges: Set<string>   // 接続ID
  replacementPairs: ReadonlyMap<string, string>
  glowCableTypes: ReadonlySet<CableType>
  /** ガジェットの移動モーフを行うか。false なら前日位置を使わず当日位置に据える */
  animateMove: boolean
  /** 配線1本が伸びるときのイージング。未指定なら等速 */
  wireEasing?: (t: number) => number
}

// 描画用に前処理した配線・ガジェット（再レンダーのたびに経路文字列を作り直さないための束）
type EdgeRender = {
  key: string
  dFinal: string
  lenFinal: number
  col: string
  /**
   * 線を伸ばさず、その場でフェードさせる線。
   * 無線（引き回すケーブルが無い）と、左右スピーカーの対を示す装飾線が該当する。
   * 伸長アニメは strokeDasharray を占有するので、破線パターンはこちらでしか付けられない。
   */
  fade: boolean
  dash: string | undefined
  width: number
  /** 通常表示時の不透明度（装飾線は控えめに敷く） */
  baseOpacity: number
  /** 背景色のケーシング（縁取り）を敷くか。交差の上下関係を出すためのもので、装飾線には要らない */
  casing: boolean
  span: { start: number; end: number } | null   // 新設（伸びる）
  exit: { start: number; end: number } | null   // 撤去（しまう）
  /** ガジェットの移動で経路が変わる線：前日の経路。移動前に消し、移動後に新経路で現れる */
  dPrev: string | null
  /** この日に買った・替えたケーブルの線を光らせる時間帯 */
  glow: { start: number; end: number } | null
}
type NodeRender = {
  n: MapNode
  /**
   * 位置を親（Animated.View）側で持つときに渡す、原点に寄せた同じノード。
   * 毎レンダー `{...n, x:0, y:0}` を作ると参照が変わって HistoryNode の memo が
   * 効かず、フェーズ境界を跨ぐたびに全ノードが再描画される。ここで1回だけ作る。
   */
  atOrigin: MapNode
  prevPos: { x: number; y: number } | null      // 前日の位置（移動の始点）
  replacement: boolean                          // 買い替え品は移動・拡大せず、その場でフェードだけ行う
  enterRange: [number, number] | null
  exitRange: [number, number] | null
  /** Wi-Fi 接続を持つ（線は引かず、配線図と同じくカード右上のマークで示す） */
  wifi: boolean
}

// 1つの配線図レイアウトを表示領域に収めて（スケール＋中央寄せ）描画する。
//
// 毎フレームの補間と SVG 更新は UI スレッドで行う。JS はフェーズ境界でだけ
// 描画対象を切り替え、演出前後の配線まで更新し続けないようにする。
function LayoutLayer({
  layout, prevLayout, bounds, scale, shiftX, shiftY, colors: C, progress, progressRef,
  exitingNodes, exitingEdges, replacementPairs, glowCableTypes, animateMove, perfCounter, wireEasing, onSelectGadget,
}: LayerProps) {
  const { isDark } = useApp()

  // ── 前処理（レイアウトが変わったときだけ再計算）──
  const prepared = useMemo(() => {
    if (layout.nodes.length === 0) return null

    // Wi-Fi はバッジで示すので線としては扱わない。layout からは外さないので、
    // 線を消してもガジェットの位置は配線図と同じまま。
    // 充電のときだけ挿す線は通常どおり省略する。ただしモバイルバッテリーが供給元の線は、
    // 外出構成で電源経路そのものを表すため残す。通常配線と区別できるよう下で破線にする。
    const drawnEdges = layout.edges.filter((e) =>
      !isBadgeOnlyEdge(e) && (e.conn.chargingOnly !== true || isMobileBatteryChargeEdge(e)))
    const wifiNodeIds = new Set(
      layout.edges.filter(isBadgeOnlyEdge).flatMap((e) => [e.from.id, e.to.id]),
    )

    // 前日の経路・位置（ガジェット移動の始点）
    const prevEdgeById = new Map((prevLayout?.edges ?? []).map((e) => [e.conn.id, e]))
    const prevNodeById = new Map((prevLayout?.nodes ?? []).map((n) => [n.id, n]))

    // 前日から残っていて、位置が動いたガジェット（分割ノードは __L/__R 単位で判定）。
    // モーフ OFF のときは動かさない（当日位置に据える）ので、移動集合は空にする。
    const movedNodeIds = new Set<string>()
    if (animateMove) {
      for (const n of layout.nodes) {
        const p = prevNodeById.get(n.id)
        if (p && (p.x !== n.x || p.y !== n.y)) movedNodeIds.add(n.id)
      }
    }
    const movedNodeSweeps: Rect[] = [...movedNodeIds].map((id) => {
      const before = prevNodeById.get(id)!
      const after = layout.nodes.find((node) => node.id === id)!
      const x = Math.min(before.x, after.x)
      const y = Math.min(before.y, after.y)
      return {
        x,
        y,
        w: Math.max(before.x + before.w, after.x + after.w) - x,
        h: Math.max(before.y + before.h, after.y + after.h) - y,
      }
    })

    // ── 新規・撤去の判定はレイアウトのノードID／接続IDで行う ──
    // 親から渡る exiting はガジェットID。ノードIDは分割スピーカーだと `id__L` / `id__R`、
    // コンセントは wall なので、そのまま突き合わせると一致せず
    // 「出るべきガジェットが出ない」「消えるべきガジェットが消えない」が起きる。ここで解決する。
    const isExitingNode = (nodeId: string) => exitingNodes.has(baseMapNodeId(nodeId))
    // 撤去接続。ペアリンク（pair-*：computeMapLayout が生成する装飾線で event.connections に
    // 存在しない）は、両端ノードが撤去されるときに一緒に消す。放置すると宙に線が残る。
    const isExitingEdge = (e: MapEdge) =>
      exitingEdges.has(e.conn.id) ||
      (e.isPairLink && isExitingNode(e.from.id) && isExitingNode(e.to.id))
    // 新規＝前日のレイアウトに存在しなかったもの（wall や __L/__R も正しく拾える）。
    // 先頭イベントのコンセントだけはポップインさせず最初から置いておく。
    const isEnteringNode = (n: MapNode) =>
      !prevNodeById.has(n.id) && !(prevLayout === null && n.isWall)
    const isEnteringEdge = (e: MapEdge) => !prevEdgeById.has(e.conn.id)
    // 左右とも新しく置くスピーカーのペア線は、配線の段に入れず左右の登場と同時に出す。
    // 段に入れると最後の段まで待たされ、左右が出揃ってからしばらく線だけ欠けて見える
    const followsNode = (e: MapEdge) => !!e.isPairLink && isEnteringNode(e.from) && isEnteringNode(e.to)

    const enteringEdgeList = drawnEdges.filter((e) => isEnteringEdge(e))
    const exitingEdgeList  = drawnEdges.filter((e) => isExitingEdge(e))
    const stayingEdgeList  = drawnEdges.filter((e) => !isExitingEdge(e))

    const hasExit = exitingEdgeList.length > 0 || layout.nodes.some((n) => isExitingNode(n.id))
    // ガジェットが実際に動いたか（再配置による僅かな経路変化だけでは移動演出しない）
    const hasMove = movedNodeIds.size > 0

    // 新しい配線を引き始める時刻。移動もしまうものも無い日は待たずに始める
    const wireStart =
      !prevLayout   ? FIRST_WIRE_START
      : hasExit     ? WIRE_START
      : hasMove     ? NO_EXIT_WIRE_START
      :               FIRST_WIRE_START

    // 新規配線を「依存する段」に分けて引く。
    // 前の線が繋がって初めて成り立つ線（コンセント→タップ→充電器）だけを順番にし、
    // 互いに関係のない線（タップから2台の充電器へ）は同時に伸ばす。
    // ホップ数は「当日残る線」だけで測る（撤去予定の旧線を経路に使わない）。
    const hops = hopsFromWall(layout, stayingEdgeList)
    const enteringWaves = buildWaves(
      enteringEdgeList.filter((e) => !followsNode(e)),
      hops,
      true,   // Bluetooth は給電が通ってから
      false,  // コンセントに近い線から
    )
    const edgeSpan = assignWaveSpans(enteringWaves, wireStart, WIRE_ENTER_END, true)

    // 撤去される配線：末端から段ごとにしまう。
    // 距離は「前日のつながり」で測る（当日には無い線なので、当日のホップ数では測れない）
    const exitHops = prevLayout ? hopsFromWall(layout, prevLayout.edges) : hops
    const exitingWaves = buildWaves(
      exitingEdgeList.filter((e) => !isEnteringEdge(e)),
      exitHops,
      false,  // 無線は物理的に抜く手間がないので先に消す
      true,   // コンセントから遠い（末端の）線から
    )
    const exitSpan = assignWaveSpans(exitingWaves, EXIT_WIRE[0], EXIT_WIRE[1])
    const transientWaves = buildWaves(exitingEdgeList.filter(isEnteringEdge), hops, false, true)
    for (const [id, span] of assignWaveSpans(transientWaves, TRANSIENT_EXIT_WIRE[0], TRANSIENT_EXIT_WIRE[1])) {
      exitSpan.set(id, span)
    }

    // どの新規配線とも関わらないガジェット（配線を持たない置物・Bluetooth も電源もないガジェット）が
    // 現れる時刻。引く配線がある日はそれを引き終えた直後に出す。引く配線が無い日は
    // 新規要素を出してよい時刻（wireStart）まで前倒しする：ここを固定の NODE_ISOLATED_T に
    // していると、配線が1本も無い日に演出尺のほぼ全部が「何も起きない待ち時間」になる。
    const wireEnds = [...edgeSpan.values()].map((s) => s.end)
    const isolatedT = Math.min(
      NODE_ISOLATED_T,
      (wireEnds.length > 0 ? Math.max(...wireEnds) : wireStart) + NODE_FADE_SPAN,
    )

    // 新規ノードの登場タイミング：
    //   線が到着する側 → 線の先端が届く直前に現れ、届く瞬間に出揃う / 線が出ていく側 → 描き始まる前
    // 到着側を「到着の NODE_FADE_SPAN 前から」にすると、短い線（尺が NODE_FADE_SPAN より短い）では
    // 線が伸び始める前にガジェットが見えてしまう。到着側は線の尺の中に収める。
    const enterRangeOf = (nodeId: string): [number, number] => {
      // 左右に分かれた機材は、最初に配線が届く側に合わせて一緒に表示する。
      const gadgetId = baseMapNodeId(nodeId)
      let best: [number, number] | null = null
      let arrival: [number, number] | null = null
      for (const e of drawnEdges) {
        const sp = edgeSpan.get(e.conn.id)
        if (!sp) continue
        let range: [number, number] | null = null
        if (isWirelessEdge(e) && (baseMapNodeId(e.from.id) === gadgetId || baseMapNodeId(e.to.id) === gadgetId)) {
          range = [sp.start, sp.end]
        } else if (baseMapNodeId(e.to.id) === gadgetId) {
          const start = Math.max(sp.start + (sp.end - sp.start) * NODE_ARRIVE_AFTER, sp.end - NODE_ARRIVE_FADE)
          range = [start, Math.max(sp.end, start + NODE_ARRIVE_MIN_FADE)]
          if (!arrival || range[0] < arrival[0]) arrival = range
        } else if (baseMapNodeId(e.from.id) === gadgetId) {
          range = [Math.max(0, sp.start - NODE_FADE_SPAN), sp.start]
        }
        if (range && (!best || range[0] < best[0])) best = range
      }
      // 次の線を早く引く場合も、接続元の登場は手前の線が到着する時刻に合わせる。
      if (arrival && best && arrival[1] <= best[1]) best = arrival
      if (best) return best[1] < 0.04 ? [0, 0.04] : best
      const end = Math.max(isolatedT, 0.04)
      return [Math.max(0, end - NODE_FADE_SPAN), end]
    }

    const edges: EdgeRender[] = []
    // 配線図と同じ上下関係で描く（再生と配線図で交差の上下が食い違わないように）
    const stackedEdges = sortEdgesForDrawing(drawnEdges)
    for (const e of stackedEdges) {
      const prevE = prevEdgeById.get(e.conn.id)
      // 移動演出（消して→ガジェットが動いて→新経路でフェードイン）は、実際に端点が動いた線だけ。
      // 端点が動いていないのに経路が僅かに変わっただけ（他機器の追加による再配置）の線は、
      // 消さずに当日の経路で据え置く。これをしないと、ガジェットを1台足しただけの日に
      // 既存配線がいっせいに薄く消えて「配線されていない」ように見えてしまう。
      const endpointMoved = movedNodeIds.has(e.from.id) || movedNodeIds.has(e.to.id)
      const crossesMovingSweep = !!prevE && movedNodeSweeps.some((rect) =>
        pathIntersectsRect(prevE.points, rect) || pathIntersectsRect(e.points, rect))
      const routeChanged = !!prevE && (
        (endpointMoved && !samePath(prevE.points, e.points)) || crossesMovingSweep
      )
      // ワイヤレス給電は配線図と同じ波線で描く（線を伸ばす演出には使わないので長さは要らない）。
      // ペア線も配線図と同じく、角を丸めない細い破線で控えめに敷く
      const wavy = e.conn.cableType === 'wirelessCharging'
      const pair = !!e.isPairLink
      const mobileCharge = isMobileBatteryChargeEdge(e)
      const nodeRange = followsNode(e) ? enterRangeOf(e.from.id) : null
      const span = nodeRange ? { start: nodeRange[0], end: nodeRange[1] } : edgeSpan.get(e.conn.id) ?? null
      const exit = exitSpan.get(e.conn.id) ?? null
      // 伸びてくる線は伸び終えてから、据え置きの線は前日の線が出揃ってから光らせる。しまう線は光らせない
      const glowStart = span ? span.end : WIRE_FADE_IN[1]
      const glow = !pair && !exit && glowCableTypes.has(e.conn.cableType)
        ? { start: glowStart, end: Math.min(1, glowStart + GLOW_SPAN) }
        : null
      edges.push({
        key: e.conn.id,
        dFinal: pair ? pointsToPath(e.points) : wavy ? wavyPath(e.points) : pointsToRoundedPath(e.points),
        lenFinal: polylineLength(e.points),
        col: pair ? C.textMuted : (portColor(e.conn.cableType, isDark) ?? '#888'),
        fade: isWirelessEdge(e) || pair,
        dash: pair ? '4 4' : mobileCharge ? '7 5' : e.conn.cableType === 'Bluetooth' ? '6 5' : undefined,
        width: pair ? 2 : mobileCharge ? 4 : WIRE_LINE_WIDTH,
        baseOpacity: pair ? 0.5 : mobileCharge ? 0.78 : 1,
        casing: !pair,
        span,
        exit,
        dPrev: routeChanged ? pointsToRoundedPath(prevE!.points) : null,
        glow: glow && glow.end > glow.start ? glow : null,
      })
    }

    // 撤去されるガジェット：登場の裏返しにする。
    //   線が入ってくる側 → その線が離れ始めたら消え始める / 線が出ていく側 → その線をしまい終えてから消す
    // しまう線は到着側の端から縮むので、「すべてしまい終えてから」消すと、線が離れていくあいだ
    // ガジェットだけが取り残されて見える。どの線より後に消えるよう、候補のうち最も遅いものを採る
    const exitRangeOf = (nodeId: string, transient = false): [number, number] => {
      const gadgetId = baseMapNodeId(nodeId)
      let best: [number, number] | null = null
      for (const e of drawnEdges) {
        const sp = exitSpan.get(e.conn.id)
        if (!sp) continue
        let range: [number, number] | null = null
        if (isWirelessEdge(e) && (baseMapNodeId(e.from.id) === gadgetId || baseMapNodeId(e.to.id) === gadgetId)) {
          range = [sp.start, sp.end]
        } else if (baseMapNodeId(e.to.id) === gadgetId) {
          const fade = Math.max(NODE_ARRIVE_MIN_FADE, Math.min(NODE_ARRIVE_FADE, (sp.end - sp.start) * (1 - NODE_ARRIVE_AFTER)))
          range = [sp.start, sp.start + fade]
        } else if (baseMapNodeId(e.from.id) === gadgetId) {
          const start = sp.end + NODE_EXIT_DELAY
          range = [start, start + NODE_EXIT_FADE_SPAN]
        }
        if (range && (!best || range[0] > best[0])) best = range
      }
      const fallbackStart = transient ? TRANSIENT_EXIT_WIRE[0] : EXIT_WIRE[0]
      const [start, end] = best ?? [fallbackStart, fallbackStart + NODE_EXIT_FADE_SPAN]
      if (transient) return [start >= 1 ? 1 - NODE_ARRIVE_MIN_FADE : start, Math.min(1, end)]
      return [start, Math.min(EXIT_NODE_MAX, end)]
    }

    const nodes: NodeRender[] = []
    for (const n of layout.nodes) {
      const prevN = prevNodeById.get(n.id)
      const moved = animateMove && !!prevN && (prevN.x !== n.x || prevN.y !== n.y)
      const entering = isEnteringNode(n)
      const replacementId = entering ? replacementPairs.get(baseMapNodeId(n.id)) : undefined
      nodes.push({
        n,
        atOrigin: { ...n, x: 0, y: 0 },
        prevPos: moved ? { x: prevN!.x, y: prevN!.y } : null,
        replacement: replacementId !== undefined,
        enterRange: entering            ? enterRangeOf(n.id) : null,
        exitRange:  isExitingNode(n.id) ? exitRangeOf(n.id, entering) : null,
        wifi: wifiNodeIds.has(n.id),
      })
    }

    // フェーズ境界：この時刻を跨いだときだけ再レンダーして Animated ⇔ 静的 を切り替える
    const boundarySet = new Set<number>([
      WIRE_FADE_OUT[1], MOVE_SPAN[0], MOVE_SPAN[1], WIRE_FADE_IN[0], WIRE_FADE_IN[1],
    ])
    for (const e of edges) {
      if (e.span) { boundarySet.add(e.span.start); boundarySet.add(e.span.end) }
      if (e.exit) { boundarySet.add(e.exit.start); boundarySet.add(e.exit.end) }
      if (e.glow) { boundarySet.add(e.glow.start); boundarySet.add(e.glow.end) }
    }
    for (const nd of nodes) {
      if (nd.enterRange) { boundarySet.add(nd.enterRange[0]); boundarySet.add(nd.enterRange[1]) }
      if (nd.exitRange)  { boundarySet.add(nd.exitRange[0]);  boundarySet.add(nd.exitRange[1]) }
    }
    const boundaries = [...boundarySet].sort((a, b) => a - b)

    return { edges, nodes, boundaries, stackedEdges }
  }, [layout, prevLayout, exitingNodes, exitingEdges, replacementPairs, glowCableTypes, C, animateMove, isDark])

  // ── フェーズ追跡：進行値が境界を跨いだときだけ setState → 再レンダー ──
  const [phaseT, setPhaseT] = useState(() => phaseAt(progressRef.current, prepared?.boundaries ?? []))
  // 境界判定も描画と同じ UI クロックで行い、カメラ・配線・ノードの位相を揃える。
  const clock = progress.value
  const boundaries = prepared?.boundaries ?? []
  const updatePhase = useCallback((value: number) => {
    setPhaseT(value)
  }, [])
  useAnimatedReaction(
    () => phaseAt(clock.value, boundaries),
    (value, previous) => { if (value !== previous) runOnJS(updatePhase)(value) },
    [clock, boundaries, updatePhase],
  )

  const { junctions, crossingCuts } = useMemo(() => {
    if (!prepared) return { junctions: new Map<string, { x: number; y: number }[]>(), crossingCuts: new Map<string, CrossingCut[]>() }
    // 枝が揃ってから印を出す。一部撤去後は、残った枝へ印の描画担当も付け替える。
    // 交差の切れ目も同じで、伸びている途中の線の先に切れ目だけが先に出ないようにする。
    const readyIds = new Set(prepared.edges.filter((edge) => (
      (!edge.span || phaseT + PHASE_EPS >= edge.span.end)
      && (!edge.dPrev || phaseT + PHASE_EPS >= WIRE_FADE_IN[1])
      && (!edge.exit || phaseT + PHASE_EPS < edge.exit.start)
    )).map((edge) => edge.key))
    const readyEdges = prepared.stackedEdges.filter((edge) => readyIds.has(edge.conn.id))
    return {
      junctions: new Map([...branchJunctionsForDrawing(readyEdges)].map(([edge, points]) => [edge.conn.id, points])),
      crossingCuts: new Map([...crossingCutsForDrawing(readyEdges)].map(([edge, cuts]) => [edge.conn.id, cuts])),
    }
  }, [prepared, phaseT])

  if (!prepared) {
    return <Text style={{ color: C.textMuted, fontSize: 13 }}>—</Text>
  }

  const passed = (v: number) => phaseT + PHASE_EPS >= v

  // 計測：このレンダー時点で演出中の要素の数（線は縁取り＋色線で2本）。
  // 下の描画分岐と同じ条件を並べているので、分岐を変えたらここも合わせる。
  if (__DEV__) {
    perfCounter.layerRenders += 1
    let animated = 0
    for (const e of prepared.edges) {
      if (e.glow && passed(e.glow.start) && !passed(e.glow.end)) animated += 1
      const paths = e.casing ? 2 : 1
      if (e.span && !(e.exit && passed(e.exit.start))) {
        if (passed(e.span.start) && !passed(e.span.end)) animated += paths
      } else if (e.dPrev && !passed(WIRE_FADE_IN[1])) {
        if (!passed(WIRE_FADE_OUT[1]) || passed(WIRE_FADE_IN[0])) animated += paths
      } else if (e.exit && passed(e.exit.start) && !passed(e.exit.end)) {
        animated += paths
      }
    }
    for (const nd of prepared.nodes) {
      if (nd.enterRange && !(nd.exitRange && passed(nd.exitRange[0]))) {
        if (passed(nd.enterRange[0]) && !passed(nd.enterRange[1])) animated += 1
      } else if (nd.prevPos && !passed(MOVE_SPAN[1])) {
        if (passed(MOVE_SPAN[0])) animated += 1
      } else if (nd.exitRange && passed(nd.exitRange[0]) && !passed(nd.exitRange[1])) {
        animated += 1
      }
    }
    if (animated > perfCounter.peakAnimated) perfCounter.peakAnimated = animated
  }

  const drawCrossingCuts = (edge: EdgeRender) => edge.casing && crossingCuts.get(edge.key)?.map((cut, index) => (
    <Path key={`cut-${index}`} d={crossingCutPath(cut)} stroke={C.bgList} strokeWidth={cut.halfWidth * 2} fill="none" />
  ))

  const drawJunctions = (edge: EdgeRender) => junctions.get(edge.key)?.map((point, index) => (
    <Circle key={index} cx={point.x} cy={point.y} r={WIRE_LINE_WIDTH} fill={edge.col} opacity={edge.baseOpacity} />
  ))

  // 線1本ぶんの描画。ケーシング（背景色の縁取り）＋色線の2枚重ねが基本で、
  // 装飾線だけケーシングを敷かない。reveal を渡すと strokeDasharray を伸長アニメに使うので、
  // そのときは破線パターン（e.dash）は載せられない
  const drawEdge = (
    e: EdgeRender,
    d: string,
    opacity: HistoryMotionNumber,
    reveal?: HistoryMotionNumber,
  ) => {
    const revealDash = reveal !== undefined ? `${e.lenFinal} ${e.lenFinal}` : undefined
    return (
      <React.Fragment key={e.key}>
        {e.casing && (
          <AnimatedPath progress={progress} d={d} opacity={opacity} stroke={C.bgList} strokeWidth={WIRE_CASING_WIDTH} fill="none"
            strokeDasharray={revealDash} strokeDashoffset={reveal}
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {drawCrossingCuts(e)}
        <AnimatedPath progress={progress} d={d} opacity={opacity} stroke={e.col} strokeWidth={e.width} fill="none"
          strokeDasharray={revealDash ?? e.dash} strokeDashoffset={reveal}
          strokeLinejoin="round" strokeLinecap="round" />
        {drawJunctions(e)}
      </React.Fragment>
    )
  }

  // 移動中は前日の座標も描くため、キャンバスは両レイアウトを覆う大きさにする
  const canvasW = Math.max(layout.width, prevLayout?.width ?? 0)
  const canvasH = Math.max(layout.height, prevLayout?.height ?? 0)

  return (
    <HistoryMotionView progress={progress} style={{ width: bounds.w, height: bounds.h, transform: [{ scale }] }} pointerEvents="box-none">
      {/* 外接矩形の左上を原点に合わせる。カメラ原点も MOVE に合わせて滑らかに動く */}
      <HistoryMotionView progress={progress}
        style={{
          position: 'absolute', left: -bounds.x, top: -bounds.y, width: canvasW, height: canvasH,
          transform: [{ translateX: shiftX }, { translateY: shiftY }],
        }}
        pointerEvents="box-none"
      >
      {/* 接続線：路線図風のケーシング（背景色の縁取り）＋色線。
          canvasW/H（ノード基準）だと左右に迂回して負座標を通る配線が SVG 外で見切れるため、
          コンテンツ外接矩形（bounds＝配線の折れ点も含む）全体を viewBox で覆って描く。 */}
      {/* 線は押させない。2px の線に指は当たらず、当たり判定用の太いパスを重ねると
          JS 駆動の Path が倍になる（このファイルで一番効くのがその本数）。
          View で包むのは、SVG 側の pointerEvents の効き方に依存させないため */}
      <View pointerEvents="none" style={{ position: 'absolute', left: bounds.x, top: bounds.y }}>
      <Svg
        width={bounds.w}
        height={bounds.h}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
      >
        {/* 光らせる線の後光。全部の線より先に敷き、ほかの線の上に被らないようにする。
            光っている間だけ描くので、それ以外の時間は Animated 要素を増やさない */}
        {prepared.edges.map((e) => {
          if (!e.glow || !passed(e.glow.start) || passed(e.glow.end)) return null
          const { start, end } = e.glow
          const single = end - start < GLOW_SINGLE_BELOW
          const opacityKeys = single ? GLOW_OPACITY_SINGLE : GLOW_OPACITY
          const inputRange = opacityKeys.map((_, i) => start + ((end - start) * i) / (opacityKeys.length - 1))
          return (
            <AnimatedPath progress={progress} key={`glow-${e.key}`} d={e.dFinal} stroke={e.col} fill="none"
              opacity={progress.interpolate({ inputRange, outputRange: opacityKeys, extrapolate: 'clamp' })}
              strokeWidth={progress.interpolate({ inputRange, outputRange: single ? GLOW_WIDTH_SINGLE : GLOW_WIDTH, extrapolate: 'clamp' })}
              strokeLinejoin="round" strokeLinecap="round" />
          )
        })}
        {prepared.edges.map((e) => {
          // 導入された配線：自分の番になるまで非表示 → 演出中だけ Animated → 完了後は静的
          if (e.span && !(e.exit && passed(e.exit.start))) {
            if (!passed(e.span.start)) return null
            const active = !passed(e.span.end)
            if (e.fade) {
              return drawEdge(e, e.dFinal, active
                ? progress.interpolate({ inputRange: [e.span.start, e.span.end], outputRange: [0, e.baseOpacity], extrapolate: 'clamp' })
                : e.baseOpacity)
            }
            return drawEdge(e, e.dFinal, e.baseOpacity, active
              ? progress.interpolate({ inputRange: [e.span.start, e.span.end], outputRange: [e.lenFinal, 0], easing: wireEasing, extrapolate: 'clamp' })
              : 0)
          }

          // ガジェットの移動で経路が変わる線：線は動かさず、消してから新しい経路で現れる
          //   〜0.05 前日の経路でフェードアウト ／ 移動中は非表示 ／ 0.24〜 当日の経路でフェードイン
          if (e.dPrev && !passed(WIRE_FADE_IN[1])) {
            if (!passed(WIRE_FADE_OUT[1])) {
              return drawEdge(e, e.dPrev, progress.interpolate({
                inputRange: [...WIRE_FADE_OUT], outputRange: [e.baseOpacity, 0], extrapolate: 'clamp',
              }))
            }
            // 移動中は線を出さない（ガジェットだけが動く）
            if (!passed(WIRE_FADE_IN[0])) return null
            return drawEdge(e, e.dFinal, progress.interpolate({
              inputRange: [...WIRE_FADE_IN], outputRange: [0, e.baseOpacity], extrapolate: 'clamp',
            }))
          }

          // 撤去された配線：自分の番まで静的表示 → 演出中だけ Animated → しまい終えたら消す
          if (e.exit) {
            if (passed(e.exit.end)) return null
            const active = passed(e.exit.start)
            if (e.fade) {
              return drawEdge(e, e.dFinal, active
                ? progress.interpolate({ inputRange: [e.exit.start, e.exit.end], outputRange: [e.baseOpacity, 0], extrapolate: 'clamp' })
                : e.baseOpacity)
            }
            return drawEdge(e, e.dFinal, e.baseOpacity, active
              ? progress.interpolate({ inputRange: [e.exit.start, e.exit.end], outputRange: [0, e.lenFinal], extrapolate: 'clamp' })
              : 0)
          }

          // 据え置きの配線（移動後は当日の経路で静的表示）。Animated を挟まない素の Path で描く
          return (
            <React.Fragment key={e.key}>
              {e.casing && (
                <Path d={e.dFinal} stroke={C.bgList} strokeWidth={WIRE_CASING_WIDTH} fill="none"
                  strokeLinejoin="round" strokeLinecap="round" />
              )}
              {drawCrossingCuts(e)}
              <Path d={e.dFinal} stroke={e.col} strokeWidth={e.width} fill="none" opacity={e.baseOpacity}
                strokeDasharray={e.dash} strokeLinejoin="round" strokeLinecap="round" />
              {drawJunctions(e)}
            </React.Fragment>
          )
        })}
      </Svg>
      </View>

      {/* ノード */}
      {prepared.nodes.map(({ n, atOrigin, prevPos, replacement, enterRange, exitRange, wifi }) => {
        // 導入されたガジェット：線が到着する直前だけ Animated でフェードイン
        if (enterRange && !(exitRange && passed(exitRange[0]))) {
          if (!passed(enterRange[0])) return null
          const active = !passed(enterRange[1])
          const opacity = active
            ? progress.interpolate({ inputRange: enterRange, outputRange: [0, 1], extrapolate: 'clamp' })
            : 1
          const nodeScale = active && !replacement
            ? progress.interpolate({ inputRange: enterRange, outputRange: [0.82, 1], extrapolate: 'clamp' })
            : 1
          return (
            <HistoryMotionView progress={progress}
              key={n.id}
              pointerEvents="box-none"
              style={{
                position: 'absolute', left: n.x, top: n.y, width: n.w, height: n.h, opacity,
                transform: [{ scale: nodeScale }],
              }}
            >
              <HistoryNode node={atOrigin} colors={C} wifi={wifi} onSelect={onSelectGadget} />
            </HistoryMotionView>
          )
        }

        // ガジェット移動フェーズ：前日の位置から当日の位置へ滑らかに移動（撤去予定のガジェットも一緒に動く）
        if (prevPos && !passed(MOVE_SPAN[1])) {
          if (!passed(MOVE_SPAN[0])) {
            return (
              <View key={n.id} pointerEvents="box-none" style={{ position: 'absolute', left: prevPos.x, top: prevPos.y, width: n.w, height: n.h }}>
                <HistoryNode node={atOrigin} colors={C} wifi={wifi} onSelect={onSelectGadget} />
              </View>
            )
          }
          const tx = progress.interpolate({ inputRange: [...MOVE_SPAN], outputRange: [0, n.x - prevPos.x], extrapolate: 'clamp' })
          const ty = progress.interpolate({ inputRange: [...MOVE_SPAN], outputRange: [0, n.y - prevPos.y], extrapolate: 'clamp' })
          return (
            <HistoryMotionView progress={progress}
              key={n.id}
              pointerEvents="box-none"
              style={{ position: 'absolute', left: prevPos.x, top: prevPos.y, width: n.w, height: n.h, transform: [{ translateX: tx }, { translateY: ty }] }}
            >
              <HistoryNode node={atOrigin} colors={C} wifi={wifi} onSelect={onSelectGadget} />
            </HistoryMotionView>
          )
        }

        // 撤去されたガジェット：線をすべてしまい終えてから Animated でフェードアウト
        if (exitRange) {
          if (passed(exitRange[1])) return null
          const active = passed(exitRange[0])
          const opacity = active
            ? progress.interpolate({ inputRange: exitRange, outputRange: [1, 0], extrapolate: 'clamp' })
            : 1
          const nodeScale = active
            ? progress.interpolate({ inputRange: exitRange, outputRange: [1, 0.86], extrapolate: 'clamp' })
            : 1
          return (
            <HistoryMotionView progress={progress}
              key={n.id}
              pointerEvents="box-none"
              style={{ position: 'absolute', left: n.x, top: n.y, width: n.w, height: n.h, opacity, transform: [{ scale: nodeScale }] }}
            >
              <HistoryNode node={atOrigin} colors={C} wifi={wifi} onSelect={onSelectGadget} />
            </HistoryMotionView>
          )
        }

        return <HistoryNode key={n.id} node={n} colors={C} wifi={wifi} onSelect={onSelectGadget} />
      })}
      </HistoryMotionView>
    </HistoryMotionView>
  )
}

// ConnectionMap の NodeCard と同じ見た目を使う。
// ドラッグや選択枠は持たない。押せるのは onSelect が渡っているとき（＝一時停止中）だけで、
// そのときも動きは「情報を開く」のひとつしかない。
//
// memo 必須：親（LayoutLayer）は演出のフェーズ境界を跨ぐたびに再レンダーされる。
// ガジェットが多い日は1イベントで数十回になるため、素のままだと毎回すべてのガジェットカード
// （MapNodeLabel のテキスト調整を含む）を描き直してフレームを落とす。
// node は prepared の中で1回だけ作られ、colors も AppContext で memo 化されている。
// onSelect も memo を壊さないよう、呼び出し側で参照を固定して渡すこと。
const HistoryNode = React.memo(function HistoryNode({ node, colors: C, wifi, onSelect }: {
  node: MapNode
  colors: AppColors
  wifi?: boolean
  onSelect?: (gadget: Gadget) => void
}) {
  const { isDark, lang } = useApp()
  const g = node.gadget
  // themeIconColor のダークモード補正は #RRGGBB のみ対象（3桁だと補正が効かない）
  const rawCol = node.isWall
    ? '#555555'
    : node.powerSource
      ? POWER_SOURCE_COLORS[node.powerSource]
      : node.isDecor ? DECOR_COLOR : (categoryBaseColor(g.category, g.customCategory?.color, '#888888'))
  const col = node.isWall || node.powerSource || node.isDecor
    ? themeIconColor(rawCol, isDark)
    : categoryIconColor(g.category, isDark, undefined, g.customCategory?.color)
  const isPseudo = node.isWall || !!node.powerSource

  const badges: { key: string; icon: React.ReactNode }[] = []
  if (wifi) badges.push({ key: 'wifi', icon: <AppIcon name="wifi" size={16} color={portIconColor('WiFi', isDark)} /> })
  if (g.category === 'PC' && (g.pcThunderbolt || g.ports.some((p) => p.type === 'Thunderbolt'))) {
    badges.push({ key: 'tb', icon: <AppIcon name="lightning-bolt" size={16} color={portIconColor('USB_C', isDark)} /> })
  }
  // タブレットに内包したペン。配線図の NodeCard と同じく、線の代わりにカードへ印を付ける
  if (g.category === 'Tablet' && PORT_ICONS.Stylus) {
    for (const a of node.attached ?? []) {
      // ケースや保護フィルムも Accessory として内包されるので、ペンだけを拾う
      if (!isStylusAccessory(a)) continue
      badges.push({ key: a.id, icon: <AppIcon name={PORT_ICONS.Stylus} size={16} color={portIconColor('Stylus', isDark)} /> })
    }
  }

  const nodeStyle = [
    styles.node,
    {
      left: node.x, top: node.y, width: node.w, height: node.h,
      backgroundColor: isPseudo ? C.chip : C.card,
      borderColor: col,
      borderWidth: 3,
      borderStyle: (isPseudo || node.isDecor ? 'dashed' : 'solid') as 'dashed' | 'solid',
    },
  ]

  // コンセント・ソーラー・電池は実ガジェットを持たないので、押しても出す情報が無い。
  // 押せないほうは指を通して、下のストーリー操作（再生停止・前へ / 次へ）を塞がない
  const content = (
    <>
      {node.sideLabel && (
        <View style={[styles.sideLabel, { backgroundColor: themeTintBase(rawCol, isDark) + '33' }]}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: C.text }}>{node.sideLabel}</Text>
        </View>
      )}
      {/* 右上のバッジ。線を引かない Wi-Fi 接続をここで示す（配線図の NodeCard と同じ並べ方） */}
      {badges.map((badge, i) => (
        <View key={badge.key} style={[styles.thunderboltBadge, { right: 5 + i * 20 }]}>{badge.icon}</View>
      ))}
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
    </>
  )

  if (!onSelect || isPseudo) {
    return <View style={nodeStyle} pointerEvents="none">{content}</View>
  }
  return (
    <Pressable
      style={nodeStyle}
      onPress={() => onSelect(g)}
      accessibilityRole="button"
      // 図の枠はジャンル名が主。読み上げもジャンル名から（配線図の ConnectionMap と同じ）
      accessibilityLabel={[gadgetGenreLabel(g, lang), localizedGadgetName(g, lang)].filter(Boolean).join(lang === 'ja' ? '、' : ', ')}
    >
      {content}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  viewport: { borderRadius: 16, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  node: {
    position: 'absolute',
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    overflow: 'hidden',
  },
  // L/R の一文字バッジは円。ConnectionMap の同じ表示（インライン）と対で変えること
  sideLabel: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  thunderboltBadge: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
})

// 過去の日付の構成から毎回組み立てる。壊れた1日分で履歴の再生全体を落とさない
export function HistoryWiringCanvas(props: Props) {
  return <SectionBoundary name="history_wiring"><HistoryWiringCanvasInner key={props.animKey} {...props} /></SectionBoundary>
}
