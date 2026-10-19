/**
 * 配線図レイアウトの品質監査（テンプレート以外＝ユーザープラン想定）
 *   1. 配線がガジェット（ノード矩形）を貫通していないか
 *   2. 配線同士が平行に重なっていないか
 *   3. 端点がノードの辺上にあり、辺に垂直へ出ているか
 *   4. ノード同士が重なっていないか / 未描画配線がないか
 */
import * as PRESETS from '../src/constants/gadgetPresets'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { DESK_TEMPLATES } from '../src/constants/deskTemplates'
import { GADGET_PRESETS, GadgetPreset } from '../src/constants/gadgetPresets'
import { applyTemplate, buildTemplateItems } from '../src/services/templateService'
import { buildAutoDraft, computeMapLayout, MapEdge, MapLayout, reconcileMap } from '../src/utils/connectionMapLayout'
import { buildGadgetPorts } from '../src/utils/gadgetPorts'
import { DeskPlan, DeskZone, Gadget, GadgetCategory, MapConnection, NodeOffset, Port } from '../src/types'

// ─── 乱数（決定論的）────────────────────────────────────────────
// AUDIT_SEED で種を変えられる（同じモードを並列シャードで回すときに使う）
let seed = Number(process.env.AUDIT_SEED ?? 20260802) >>> 0
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]

const ZONES: DeskZone[] = [
  'back_left', 'back_center', 'back_right',
  'front_left', 'front_center', 'front_right',
  'desk_left', 'desk_right', 'under_desk', 'desk_back',
]

const OUT = 13          // connectionMapLayout の OUT（CLEAR 9 + 4）
const LANE_GAP = 12     // 視認上の最小レーン間隔

type Seg = { horiz: boolean; c: number; lo: number; hi: number; i: number }
const segsOf = (pts: { x: number; y: number }[]): Seg[] => {
  const out: Seg[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1]
    if (Math.abs(p.y - q.y) < 0.5) out.push({ horiz: true, c: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x), i })
    else if (Math.abs(p.x - q.x) < 0.5) out.push({ horiz: false, c: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y), i })
    else out.push({ horiz: false, c: NaN, lo: 0, hi: 0, i })   // 斜め＝異常
  }
  return out
}

type Finding = { kind: string; detail: string }

const analyze = (layout: MapLayout): Finding[] => {
  const findings: Finding[] = []
  const nodes = layout.nodes
  // Wi-Fi は線を描かない（ConnectionMap の isBadgeOnlyEdge）
  const edges = layout.edges.filter((e) => e.conn.cableType !== 'WiFi')

  // ── 未描画・斜め ────────────────────────────────────────────
  for (const e of edges) {
    if (e.points.length < 2) {
      findings.push({ kind: 'undrawn', detail: `${e.conn.fromGadgetId}→${e.conn.toGadgetId} 経路探索失敗(点1個)` })
      continue
    }
    for (const s of segsOf(e.points)) {
      if (Number.isNaN(s.c)) {
        findings.push({ kind: 'diagonal', detail: `${e.conn.fromGadgetId}→${e.conn.toGadgetId} 斜め区間 #${s.i}` })
      }
    }
  }

  // ── ① 配線がノードを貫通 ────────────────────────────────────
  for (const e of edges) {
    if (e.points.length < 2) continue
    const own = new Set([e.from.id, e.to.id])
    for (let i = 0; i < e.points.length - 1; i++) {
      const p = e.points[i], q = e.points[i + 1]
      const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x)
      const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y)
      for (const n of nodes) {
        // 端点ノードの内部貫通も異常（枠上のタッチのみ許容）
        const inside = x1 > n.x + 0.5 && x0 < n.x + n.w - 0.5 && y1 > n.y + 0.5 && y0 < n.y + n.h - 0.5
        if (!inside) continue
        // 端点ノード同士がそもそも重なっている構成は別種の問題として扱う
        findings.push({
          kind: own.has(n.id) ? 'pierce-own' : 'pierce-other',
          detail: `${e.conn.cableType} ${e.from.id}→${e.to.id} 区間#${i} が ${n.gadget.name}(${n.id}) を貫通`,
        })
      }
    }
  }

  // ── ② 配線同士の平行重なり ──────────────────────────────────
  // 給電元の同一口を共有する束（＝端点が完全一致）は意図した合流なので除外
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j]
      if (a.points.length < 2 || b.points.length < 2) continue
      const bundled =
        a.from.id === b.from.id &&
        !!a.conn.sourcePortId &&
        a.conn.sourcePortId === b.conn.sourcePortId
      let exact = 0, near = 0, minDist = Infinity, nearLen = 0
      for (const sa of segsOf(a.points)) {
        for (const sb of segsOf(b.points)) {
          if (sa.horiz !== sb.horiz || Number.isNaN(sa.c) || Number.isNaN(sb.c)) continue
          const dist = Math.abs(sa.c - sb.c)
          if (dist >= LANE_GAP) continue
          const len = Math.min(sa.hi, sb.hi) - Math.max(sa.lo, sb.lo)
          if (len <= 0) continue
          if (dist < 0.5) exact += len
          else { near += len; if (len > nearLen) { nearLen = len; minDist = dist } }
        }
      }
      if (bundled) continue   // 合流バンドルは意図的
      const tag = (e: MapEdge) => e.isPairLink ? 'pair' : e.conn.cableType === 'Power' && (e.from.id === 'wall' || e.to.id === 'wall') ? 'trunk' : 'wire'
      const who = `${a.from.id}→${a.to.id}[${tag(a)}] と ${b.from.id}→${b.to.id}[${tag(b)}]`
      if (exact >= 12) {
        findings.push({ kind: 'overlap-exact', detail: `${who} が同一座標で ${exact.toFixed(0)}px 重複` })
      } else if (near >= 24) {
        findings.push({
          kind: minDist >= 10.5 ? 'overlap-near-11px' : 'overlap-near',
          detail: `${who} が間隔${minDist.toFixed(1)}pxで ${near.toFixed(0)}px 並走`,
        })
      }
    }
  }

  // ── ③ 端点の垂直出し ────────────────────────────────────────
  const checkTerminal = (e: MapEdge, atStart: boolean) => {
    const pts = atStart ? e.points : [...e.points].reverse()
    if (pts.length < 2) return
    const n = atStart ? e.from : e.to
    const p = pts[0], next = pts[1]
    const onTop = Math.abs(p.y - n.y) < 0.5 && p.x >= n.x - 0.5 && p.x <= n.x + n.w + 0.5
    const onBottom = Math.abs(p.y - (n.y + n.h)) < 0.5 && p.x >= n.x - 0.5 && p.x <= n.x + n.w + 0.5
    const onLeft = Math.abs(p.x - n.x) < 0.5 && p.y >= n.y - 0.5 && p.y <= n.y + n.h + 0.5
    const onRight = Math.abs(p.x - (n.x + n.w)) < 0.5 && p.y >= n.y - 0.5 && p.y <= n.y + n.h + 0.5
    if (!onTop && !onBottom && !onLeft && !onRight) {
      findings.push({ kind: 'terminal-off-node', detail: `${e.from.id}→${e.to.id} の${atStart ? '始' : '終'}点が ${n.gadget.name} の辺上にない (${p.x},${p.y}) vs [${n.x},${n.y},${n.w},${n.h}]` })
      return
    }
    const dx = next.x - p.x, dy = next.y - p.y
    const ok =
      (onTop && Math.abs(dx) < 0.5 && -dy >= OUT - 0.5) ||
      (onBottom && Math.abs(dx) < 0.5 && dy >= OUT - 0.5) ||
      (onLeft && Math.abs(dy) < 0.5 && -dx >= OUT - 0.5) ||
      (onRight && Math.abs(dy) < 0.5 && dx >= OUT - 0.5)
    if (!ok) {
      const sides = [onTop && 'top', onBottom && 'bottom', onLeft && 'left', onRight && 'right'].filter(Boolean).join('/')
      findings.push({
        kind: 'terminal-not-upright',
        detail: `${e.conn.cableType} ${e.from.id}→${e.to.id} の${atStart ? '始' : '終'}点(${sides}, ${n.gadget.name}) 第1区間 d=(${dx.toFixed(0)},${dy.toFixed(0)})`,
      })
    }
  }
  for (const e of edges) { checkTerminal(e, true); checkTerminal(e, false) }

  // ── ③-b 端点（出発点・到着点）の重なり ──────────────────────
  // 同じノードから出る配線は接続点をファンアウトして分けているはずで、同じ座標に
  // 2本が乗ると「1本にしか見えない」「どの機器へ伸びているか読めない」状態になる。
  // 充電器の1口を共有する合流バンドルだけは意図的に同じ点から出るので除外する。
  // 判定材料：バンドルは必ず「同じ給電元ノードが from 側」かつ両方に sourcePortId がある。
  // ── ③-0 内包された機器（吸着給電のペン等）は独立ノードも線も持たない ────
  // タブレットに吸着するペンはホストのノードへ内包してバッジで示す設計。
  // 内包に失敗して独立ノードが残ると、線1本ぶんの幅を取るだけのノードが図に増える
  const attachedIds = new Set<string>()
  for (const n of nodes) for (const g of n.attached ?? []) attachedIds.add(g.id)
  for (const id of attachedIds) {
    if (nodes.some((n) => n.gadget?.id === id)) {
      findings.push({ kind: 'attached-has-own-node', detail: `${id} は内包されているのに独立ノードもある` })
    }
    const edge = edges.find((e) => e.conn.fromGadgetId === id || e.conn.toGadgetId === id)
    if (edge) {
      findings.push({ kind: 'attached-has-edge', detail: `${id} は内包されているのに線が引かれている (${edge.conn.cableType})` })
    }
  }

  // ── ③-a 分岐ケーブル（branchGroupId）の枝は分岐元で1点にまとまる ────────
  // 2in1・3in1 ケーブルの枝は、同じ物理ケーブルなので分岐元ノードの同じ接続点から出す。
  // 逆に言うと、この束だけは端点が重なっているのが正しい状態なので、
  // 下の terminal-same-point / terminal-too-close からは除外する
  const branchGroups = new Map<string, MapEdge[]>()
  for (const e of edges) {
    const groupId = e.conn.branchGroupId
    if (!groupId) continue
    branchGroups.set(groupId, [...(branchGroups.get(groupId) ?? []), e])
  }
  const bundledTerminals = new Set<string>()
  for (const [groupId, list] of branchGroups) {
    if (list.length < 2) continue
    const shared = list.reduce<string[]>(
      (acc, e) => acc.filter((id) => [e.from.id, e.to.id].includes(id)),
      [list[0].from.id, list[0].to.id],
    )
    // 分岐元が一意に決まらない指定は束ねない、というのが connectionMapLayout の仕様
    if (shared.length !== 1) continue
    const trunk = shared[0]
    const pts = list.map((e) => ({
      e,
      p: e.from.id === trunk ? e.points[0] : e.points[e.points.length - 1],
    }))
    for (const { e } of pts) bundledTerminals.add(`${e.conn.id}|${trunk}`)
    const base = pts[0].p
    const strayed = pts.filter(({ p }) => Math.hypot(p.x - base.x, p.y - base.y) > 0.5)
    if (strayed.length > 0) {
      findings.push({
        kind: 'branch-not-bundled',
        detail: `${groupId} の枝が分岐元 ${trunk} で別々の点から出ている (${pts.map(({ p }) => `(${p.x},${p.y})`).join(' ')})`,
      })
    }
  }

  const MIN_TERMINAL_GAP = 14   // connectionMapLayout の MIN_CP_STEP
  type Terminal = { e: MapEdge; p: { x: number; y: number }; atStart: boolean }
  const terminalsByNode = new Map<string, Terminal[]>()
  for (const e of edges) {
    if (e.points.length < 2) continue
    for (const atStart of [true, false]) {
      const n = atStart ? e.from : e.to
      const p = atStart ? e.points[0] : e.points[e.points.length - 1]
      terminalsByNode.set(n.id, [...(terminalsByNode.get(n.id) ?? []), { e, p, atStart }])
    }
  }
  for (const [nodeId, list] of terminalsByNode) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        const dist = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y)
        if (dist >= MIN_TERMINAL_GAP - 0.5) continue
        // 分岐ケーブルの枝は、分岐元で重なっているのが正しい
        if (bundledTerminals.has(`${a.e.conn.id}|${nodeId}`) &&
            bundledTerminals.has(`${b.e.conn.id}|${nodeId}`)) continue
        const who = `${a.e.from.id}→${a.e.to.id} の${a.atStart ? '出発点' : '到着点'} と ` +
          `${b.e.from.id}→${b.e.to.id} の${b.atStart ? '出発点' : '到着点'}`
        if (dist < 0.5) {
          findings.push({ kind: 'terminal-same-point', detail: `${who} が ${nodeId} 上で完全に一致 (${a.p.x},${a.p.y})` })
        } else {
          findings.push({
            kind: 'terminal-too-close',
            detail: `${who} が ${nodeId} 上で ${dist.toFixed(1)}px しか離れていない (${a.p.x},${a.p.y})/(${b.p.x},${b.p.y})`,
          })
        }
      }
    }
  }

  // ── ⑤ 同じ2本が2回以上交差 ──────────────────────────────────
  // connectionMapLayout の交差補修（「同じ配線同士が2回以上交差しないよう補修する」）が
  // 保証しているはずの不変条件。端点を共有するペアは0回、それ以外は1回まで。
  // 破れているなら補修そのものではなく「補修より後の工程」が壊した疑いが強い。
  const crossPoints = (a: MapEdge, b: MapEdge): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = []
    for (const sa of segsOf(a.points)) {
      for (const sb of segsOf(b.points)) {
        if (sa.horiz === sb.horiz || Number.isNaN(sa.c) || Number.isNaN(sb.c)) continue
        const h = sa.horiz ? sa : sb
        const v = sa.horiz ? sb : sa
        // connectionMapLayout の segmentsCross と同じ 1px 内側の判定に合わせる
        if (v.c > h.lo + 1 && v.c < h.hi - 1 && h.c > v.lo + 1 && h.c < v.hi - 1) out.push({ x: v.c, y: h.c })
      }
    }
    return out
  }
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j]
      if (a.points.length < 2 || b.points.length < 2) continue
      const shared = [a.from.id, a.to.id].some((id) => id === b.from.id || id === b.to.id)
      const hits = crossPoints(a, b)
      if (hits.length <= (shared ? 0 : 1)) continue
      findings.push({
        kind: shared ? 'cross-shared-node' : 'cross-twice',
        detail: `${a.from.id}→${a.to.id} と ${b.from.id}→${b.to.id} が ${hits.length}回交差 ` +
          `(${hits.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' ')})`,
      })
    }
  }

  // ── ⑥ 回り込み（障害物がないのに遠回りする経路）──────────────
  // 「もっと素直な経路が実際に引けるのに引いていない」かどうかで判定する。
  // 単に長い・曲がりが多いだけでは障害物回避と区別できないため、
  // 同じ端点・同じ出足（第1区間と最終区間）を保った L 字の代替経路を組み立て、
  // それがノードを避けきり・他の線との並走も増やさないときだけ回り込みとみなす。
  const CLEAR = 9    // connectionMapLayout の NODE_CLEARANCE
  const lenOf = (pts: { x: number; y: number }[]) =>
    pts.slice(1).reduce((t, p, k) => t + Math.abs(p.x - pts[k].x) + Math.abs(p.y - pts[k].y), 0)
  const clearsNodes = (pts: { x: number; y: number }[], own: Set<string>) => {
    for (const s of segsOf(pts)) {
      if (Number.isNaN(s.c)) return false
      const x0 = s.horiz ? s.lo : s.c, x1 = s.horiz ? s.hi : s.c
      const y0 = s.horiz ? s.c : s.lo, y1 = s.horiz ? s.c : s.hi
      for (const n of nodes) {
        // 端点ノードは辺に触れるのが正常なので実寸、それ以外は経路探索と同じ CLEAR ぶん膨らませる
        const m = own.has(n.id) ? 0.5 : -CLEAR + 0.5
        if (x1 > n.x + m && x0 < n.x + n.w - m && y1 > n.y + m && y0 < n.y + n.h - m) return false
      }
    }
    return true
  }
  // 他の線と 12px 未満で並走する長さ（＝1本に見えてしまう長さ）の合計
  const parallelRun = (pts: { x: number; y: number }[], self: MapEdge) => {
    let total = 0
    for (const other of edges) {
      if (other === self) continue
      for (const s of segsOf(pts)) {
        for (const o of segsOf(other.points)) {
          if (s.horiz !== o.horiz || Number.isNaN(s.c) || Number.isNaN(o.c)) continue
          if (Math.abs(s.c - o.c) >= LANE_GAP) continue
          total += Math.max(0, Math.min(s.hi, o.hi) - Math.max(s.lo, o.lo))
        }
      }
    }
    return total
  }
  const crossCount = (pts: { x: number; y: number }[], self: MapEdge) => {
    let total = 0
    for (const other of edges) {
      if (other === self) continue
      total += crossPoints({ ...self, points: pts } as MapEdge, other).length
    }
    return total
  }
  const simplify = (pts: { x: number; y: number }[]) => {
    const out: { x: number; y: number }[] = []
    for (const p of pts) {
      const last = out[out.length - 1]
      if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue
      out.push(p)
    }
    for (let i = 1; i < out.length - 1; ) {
      const a = out[i - 1], b = out[i], c = out[i + 1]
      const straight = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
        (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)
      if (straight) out.splice(i, 1)
      else i++
    }
    return out
  }
  for (const e of edges) {
    if (e.points.length < 4) continue   // 出足＋L字で足りる経路は回り込みようがない
    const own = new Set([e.from.id, e.to.id])
    const p0 = e.points[0], p1 = e.points[1]
    const qn = e.points[e.points.length - 1], q1 = e.points[e.points.length - 2]
    const actualLen = lenOf(e.points)
    const actualPar = parallelRun(e.points, e)
    const actualCross = crossCount(e.points, e)
    // 出足（辺から垂直に出る第1区間・最終区間）は接続点の仕様なので固定し、間だけを引き直す
    const candidates = [
      simplify([p0, p1, { x: q1.x, y: p1.y }, q1, qn]),
      simplify([p0, p1, { x: p1.x, y: q1.y }, q1, qn]),
    ]
    let best: { pts: { x: number; y: number }[]; gain: number } | null = null
    for (const c of candidates) {
      // 短絡で出足まで併合されることがある。13未満の口元を作る候補は製品側では採用できない。
      if (c.length < 2 || lenOf(c.slice(0, 2)) < OUT || lenOf(c.slice(-2)) < OUT) continue
      const gain = actualLen - lenOf(c)
      if (gain < 40) continue
      if (!clearsNodes(c, own)) continue
      if (parallelRun(c, e) > actualPar + 0.5) continue
      if (crossCount(c, e) > actualCross) continue
      if (!best || gain > best.gain) best = { pts: c, gain }
    }
    if (best) {
      findings.push({
        kind: 'detour-avoidable',
        detail: `${e.conn.cableType} ${e.from.id}→${e.to.id} が ${best.gain.toFixed(0)}px 遠回り ` +
          `(実際 ${e.points.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join('')} / ` +
          `素直な経路 ${best.pts.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join('')})`,
      })
    }
    // 同じ軸で「進んで戻って また進む」経路は、障害物回避でも読めない形になる
    for (const horiz of [true, false]) {
      const deltas: number[] = []
      for (let i = 0; i < e.points.length - 1; i++) {
        const d = horiz ? e.points[i + 1].x - e.points[i].x : e.points[i + 1].y - e.points[i].y
        if (Math.abs(d) > 0.5) deltas.push(Math.sign(d))
      }
      let reversals = 0
      for (let i = 1; i < deltas.length; i++) if (deltas[i] !== deltas[i - 1]) reversals++
      if (reversals >= 2) {
        findings.push({
          kind: 'detour-backtrack',
          detail: `${e.conn.cableType} ${e.from.id}→${e.to.id} が ${horiz ? '横' : '縦'}方向に ${reversals}回折り返す ` +
            `(${e.points.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join('')})`,
        })
      }
    }
  }

  // ── ④ ノード同士の重なり ────────────────────────────────────
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox > 0.5 && oy > 0.5) {
        findings.push({ kind: 'node-overlap', detail: `${a.gadget.name}(${a.id}) と ${b.gadget.name}(${b.id}) が ${ox.toFixed(0)}x${oy.toFixed(0)}px 重なり` })
      }
    }
  }

  return findings
}

// ─── シナリオ生成 ───────────────────────────────────────────────
const presetIndexByCategory = new Map<GadgetCategory, number[]>()
GADGET_PRESETS.forEach((p, i) => {
  presetIndexByCategory.set(p.category, [...(presetIndexByCategory.get(p.category) ?? []), i])
})

const makeGadget = (presetIndex: number, i: number): Gadget => {
  const p = GADGET_PRESETS[presetIndex]
  return { ...p, id: `g${i}`, createdAt: '2026-01-01T00:00:00.000Z' } as Gadget
}

type Scenario = {
  name: string
  gadgets: Gadget[]
  placements: { gadgetId: string; zone: DeskZone }[]
  outletCount: number
  connections?: MapConnection[]
  nodeOffsets?: Record<string, NodeOffset>
  sourceUrls?: string[]
}

const buildRandomScenario = (index: number, big = false): Scenario => {
  const size = big ? 18 + Math.floor(rnd() * 13) : 3 + Math.floor(rnd() * 16)   // 3〜18台 / 18〜30台
  const chosen: number[] = []
  // 現実的な構成になるよう、よく使うカテゴリを優先的に混ぜる
  const seedCats: GadgetCategory[] = big
    ? ['PC', 'Monitor', 'Keyboard', 'Mouse', 'PowerStrip', 'Charger', 'Dock', 'Speaker', 'Smartphone', 'Smartwatch']
    : ['PC', 'Monitor', 'Keyboard', 'Mouse', 'PowerStrip']
  for (const cat of seedCats) {
    if (rnd() < (big ? 0.95 : 0.7)) {
      const list = presetIndexByCategory.get(cat)
      if (list?.length) chosen.push(pick(list))
    }
  }
  while (chosen.length < size) chosen.push(Math.floor(rnd() * GADGET_PRESETS.length))
  const gadgets = chosen.slice(0, size).map((pi, i) => makeGadget(pi, i))
  // ノートPC / デスクトップの形状も振る
  for (const g of gadgets) {
    if (g.category === 'PC') g.pcFormFactor = rnd() < 0.5 ? 'laptop' : 'desktop'
    if (g.category === 'Speaker' && rnd() < 0.3) g.stereoPair = false
    if (g.category === 'Keyboard' && rnd() < 0.2) g.splitKeyboard = true
    if (rnd() < 0.05) g.displayOnly = true
  }
  const placements = gadgets
    .filter(() => rnd() < 0.35)
    .map((g) => ({ gadgetId: g.id, zone: pick(ZONES) }))
  return { name: `${big ? 'big' : 'random'}#${index}(${size}台)`, gadgets, placements, outletCount: rnd() < 0.2 ? 0 : 2 }
}

// ─── 現実的なデスク構成 ─────────────────────────────────────────
// カテゴリを一様乱数で混ぜると「キーボード4台・プリンター3台」のような実在しない
// 構成になる。実際のユーザーがつくるデスクへ寄せるため、用途アーキタイプごとに
// 「必ずある機器」と「あることがある機器（確率つき）」を定義して組み立てる。
type Spec = [GadgetCategory, number, number?]   // [カテゴリ, 出現確率, 台数(既定1)]
type Archetype = { name: string; specs: Spec[]; laptop?: number }

const ARCHETYPES: Archetype[] = [
  {
    name: 'ノート1台', laptop: 1,
    specs: [
      ['PC', 1], ['Charger', 1], ['Mouse', 0.8], ['Smartphone', 0.7], ['Monitor', 0.4],
      ['Keyboard', 0.4], ['Headphone', 0.5], ['Earphone', 0.3], ['PowerStrip', 0.5],
      ['Hub', 0.3], ['Smartwatch', 0.3], ['Desk', 0.2], ['Chair', 0.2],
    ],
  },
  {
    name: '在宅ワーク', laptop: 0.8,
    specs: [
      ['PC', 1], ['Monitor', 1], ['Keyboard', 1], ['Mouse', 1], ['Dock', 0.5], ['Hub', 0.3],
      ['PowerStrip', 0.9], ['Webcam', 0.5], ['Headphone', 0.6], ['Microphone', 0.3],
      ['Speaker', 0.3], ['Charger', 0.8], ['Smartphone', 0.8], ['Smartwatch', 0.4],
      ['Light', 0.4], ['MonitorArm', 0.4], ['Desk', 0.3], ['Chair', 0.3], ['Router', 0.3],
    ],
  },
  {
    name: '開発デュアル', laptop: 0.4,
    specs: [
      ['PC', 1], ['Monitor', 1, 2], ['Keyboard', 1], ['Mouse', 1], ['Dock', 0.7], ['Hub', 0.4],
      ['PowerStrip', 1], ['MonitorArm', 0.6, 2], ['Speaker', 0.5], ['Headphone', 0.7],
      ['Webcam', 0.5], ['Microphone', 0.4], ['Storage', 0.5], ['Light', 0.5],
      ['Charger', 0.7], ['Smartphone', 0.7], ['Smartwatch', 0.4], ['Tablet', 0.4],
      ['Router', 0.4], ['KVM', 0.15], ['Desk', 0.3], ['Chair', 0.3],
    ],
  },
  {
    name: 'ゲーミング', laptop: 0.1,
    specs: [
      ['PC', 1], ['Monitor', 1, 2], ['Keyboard', 1], ['Mouse', 1], ['Headphone', 1],
      ['Speaker', 0.5], ['Microphone', 0.5], ['MicArm', 0.4], ['GameConsole', 0.6, 2],
      ['Controller', 0.7, 2], ['Light', 0.7, 2], ['PowerStrip', 1], ['Webcam', 0.4],
      ['CaptureDevice', 0.25], ['VRGlass', 0.25], ['Router', 0.4], ['Charger', 0.5],
      ['Smartphone', 0.6], ['Chair', 0.4], ['Desk', 0.3],
    ],
  },
  {
    name: '配信', laptop: 0.2,
    specs: [
      ['PC', 1], ['Monitor', 1, 2], ['Webcam', 1], ['Microphone', 1], ['MicArm', 0.8],
      ['AudioInterface', 0.6], ['Mixer', 0.35], ['Light', 1, 2], ['CaptureDevice', 0.5],
      ['Headphone', 0.9], ['Keyboard', 1], ['Mouse', 1], ['PowerStrip', 1],
      ['GameConsole', 0.4], ['Speaker', 0.5], ['Storage', 0.4], ['SmallDevice', 0.3],
    ],
  },
  {
    name: 'DTM', laptop: 0.5,
    specs: [
      ['PC', 1], ['Monitor', 1], ['AudioInterface', 1], ['Speaker', 0.9],
      ['Headphone', 0.9], ['HeadphoneAmp', 0.3], ['Instrument', 0.9, 2], ['Mixer', 0.4],
      ['Microphone', 0.6], ['MicArm', 0.3], ['Keyboard', 1], ['Mouse', 1],
      ['PowerStrip', 1], ['Storage', 0.4], ['Tablet', 0.3],
    ],
  },
  {
    name: 'クリエイター', laptop: 0.5,
    specs: [
      ['PC', 1], ['Monitor', 1, 2], ['PenTablet', 0.7], ['Tablet', 0.5], ['Storage', 0.8, 2],
      ['Dock', 0.6], ['Keyboard', 1], ['Mouse', 1], ['Printer', 0.3], ['Printer3D', 0.2],
      ['Charger', 0.6], ['PowerStrip', 1], ['Speaker', 0.4], ['Headphone', 0.6],
      ['Light', 0.4], ['MonitorArm', 0.4],
    ],
  },
  {
    name: 'リビング寄り', laptop: 0.7,
    specs: [
      ['Smartphone', 1], ['Charger', 1, 2], ['Tablet', 0.6], ['Smartwatch', 0.5],
      ['PowerStrip', 0.8], ['Router', 0.5], ['Modem', 0.3], ['SmartHome', 0.5, 2],
      ['Light', 0.4], ['Printer', 0.4], ['Earphone', 0.4], ['PC', 0.5], ['Monitor', 0.3],
      ['MobileBattery', 0.3], ['GameConsole', 0.3], ['Accessory', 0.3],
    ],
  },
  {
    name: '全部盛り', laptop: 0.3,
    specs: [
      ['PC', 1], ['Monitor', 1, 3], ['Keyboard', 1], ['Mouse', 1], ['Dock', 0.8], ['Hub', 0.6],
      ['PowerStrip', 1, 2], ['Charger', 0.9, 2], ['Speaker', 0.8], ['Headphone', 0.8],
      ['Microphone', 0.7], ['MicArm', 0.5], ['Webcam', 0.7], ['AudioInterface', 0.5],
      ['Light', 0.8, 2], ['Storage', 0.7, 2], ['Router', 0.6], ['GameConsole', 0.5],
      ['Controller', 0.5], ['Tablet', 0.5], ['Smartphone', 0.8], ['Smartwatch', 0.6],
      ['MonitorArm', 0.6, 2], ['Printer', 0.3], ['VRGlass', 0.3], ['UPS', 0.2],
      ['Desk', 0.5], ['Chair', 0.5],
    ],
  },
]

// カテゴリごとの現実的な設置場所（ユーザーが指定するときに選ぶであろう場所）
const REAL_ZONES: Partial<Record<GadgetCategory, DeskZone[]>> = {
  Monitor: ['back_center', 'back_left', 'back_right'],
  VRGlass: ['back_left', 'back_right', 'desk_left'],
  Webcam: ['back_center'],
  Light: ['back_center', 'back_left', 'back_right'],
  Speaker: ['back_left', 'back_right'],
  Keyboard: ['front_center'],
  Mouse: ['front_right', 'front_center'],
  PenTablet: ['front_center', 'front_left'],
  Controller: ['front_left', 'front_right', 'desk_left'],
  Tablet: ['desk_left', 'desk_right', 'front_left'],
  MonitorArm: ['desk_back', 'back_center'],
  Microphone: ['desk_left', 'desk_right', 'back_center'],
  MicArm: ['desk_back', 'desk_left'],
  AudioInterface: ['desk_back', 'desk_left', 'front_left'],
  Mixer: ['desk_back', 'desk_right'],
  HeadphoneAmp: ['desk_back', 'desk_right'],
  Headphone: ['desk_left', 'desk_right'],
  Earphone: ['desk_left', 'desk_right'],
  Smartphone: ['desk_left', 'desk_right'],
  Smartwatch: ['desk_left', 'desk_right'],
  MobileBattery: ['desk_left', 'desk_right'],
  Storage: ['desk_back', 'desk_right', 'under_desk'],
  Dock: ['desk_back', 'desk_left', 'desk_right'],
  Hub: ['desk_back', 'desk_left', 'desk_right'],
  Router: ['under_desk', 'desk_back'],
  Modem: ['under_desk', 'desk_back'],
  PowerStrip: ['under_desk'],
  UPS: ['under_desk'],
  Charger: ['desk_left', 'desk_right', 'under_desk'],
  Printer: ['desk_right', 'under_desk'],
  Printer3D: ['under_desk', 'desk_right'],
  GameConsole: ['under_desk', 'desk_right', 'back_right'],
  CaptureDevice: ['desk_back', 'desk_right'],
  KVM: ['desk_back', 'under_desk'],
  SmartHome: ['desk_left', 'desk_right', 'back_left'],
  Instrument: ['front_center', 'desk_left'],
  Accessory: ['desk_left', 'desk_right'],
  SmallDevice: ['desk_left', 'desk_right'],
}

// 予測変換の商品プール（getProductSuggestions と同じ割り当て）。カテゴリによっては
// GADGET_PRESETS 以外の配列が本体なので、そちらから引かないと実際の商品と違う
// ポート構成でテストしてしまう（充電器・ヘッドホン・PC など）。
const CATEGORY_POOLS: Partial<Record<GadgetCategory, GadgetPreset[]>> = {
  AudioInterface: PRESETS.AUDIO_INTERFACE_PRESETS,
  Chair: PRESETS.CHAIR_PRESETS as GadgetPreset[],
  Charger: PRESETS.CHARGER_PRESETS,
  Controller: PRESETS.CONTROLLER_PRESETS,
  Desk: PRESETS.DESK_PRESETS as GadgetPreset[],
  Headphone: PRESETS.HEADPHONE_PRESETS,
  HeadphoneAmp: PRESETS.HEADPHONE_AMP_PRESETS,
  Earphone: PRESETS.EARPHONE_PRESETS,
  Instrument: PRESETS.INSTRUMENT_PRESETS,
  Mixer: PRESETS.MIXER_PRESETS,
  MobileBattery: PRESETS.MOBILE_BATTERY_PRESETS,
  MonitorArm: PRESETS.MONITOR_ARM_PRESETS,
  MicArm: PRESETS.MIC_ARM_PRESETS,
  Modem: PRESETS.MODEM_PRESETS,
  PC: [...PRESETS.PC_LAPTOP_SUGGESTIONS, ...PRESETS.PC_DESKTOP_SUGGESTIONS] as GadgetPreset[],
  SmartHome: PRESETS.SMART_HOME_PRESETS,
  Smartphone: PRESETS.SMARTPHONE_PRESETS,
  Smartwatch: PRESETS.SMARTWATCH_PRESETS,
  Accessory: PRESETS.STYLUS_ACCESSORY_PRESETS,
  Tablet: PRESETS.TABLET_PRESETS,
  VRGlass: PRESETS.VR_GLASS_PRESETS,
  WallPanel: PRESETS.WALL_PANEL_PRESETS as GadgetPreset[],
}
const poolFor = (cat: GadgetCategory): GadgetPreset[] =>
  CATEGORY_POOLS[cat] ?? GADGET_PRESETS.filter((p) => p.category === cat)

// PC は商品リストがポートを持たない（ユーザーが追加画面で構成する）。実際の保存内容と
// 同じ形にするため、アプリ本体の buildGadgetPorts へ現実的な入力値を渡して組み立てる。
const buildPcPorts = (formFactor: 'laptop' | 'desktop'): Port[] => {
  const portState = formFactor === 'laptop'
    ? {
        tb: 1 + Math.floor(rnd() * 3), usbc: rnd() < 0.4 ? 1 : 0, usbc_video: 0,
        usba: rnd() < 0.5 ? 1 + Math.floor(rnd() * 2) : 0, hdmi: rnd() < 0.6 ? 1 : 0,
        dp: 0, eth: rnd() < 0.1, bt: true, audio_in: rnd() < 0.4,
      }
    : {
        tb: rnd() < 0.4 ? 1 + Math.floor(rnd() * 2) : 0, usbc: 1 + Math.floor(rnd() * 2),
        usbc_video: rnd() < 0.3 ? 1 : 0, usba: 3 + Math.floor(rnd() * 4),
        hdmi: 1, dp: 1 + Math.floor(rnd() * 3), eth: rnd() < 0.8, bt: rnd() < 0.8,
        audio_in: rnd() < 0.6,
      }
  return buildGadgetPorts({
    category: 'PC',
    portState,
    mouseConnType: 'wireless',
    periConnType: 'wireless',
    powerInput: formFactor === 'laptop' ? 'from_c' : 'outlet',
    charge: { usbC: 0, usbA: 0, wirelessCount: 0 },
    strip: { outlets: 0, usbC: 0, usbA: 0, grounded: false },
  })
}

const buildRealisticScenario = (index: number): Scenario => {
  const arch = pick(ARCHETYPES)
  const gadgets: Gadget[] = []
  for (const [cat, prob, maxN] of arch.specs) {
    if (rnd() >= prob) continue
    const pool = poolFor(cat)
    if (!pool.length) continue
    // 台数指定があるものは 1〜maxN 台。同カテゴリでも別商品を選ぶ
    const n = maxN && maxN > 1 ? 1 + Math.floor(rnd() * maxN) : 1
    for (let k = 0; k < n; k++) {
      const p = pick(pool)
      gadgets.push({ ...p, category: cat, id: `g${gadgets.length}`, ports: p.ports ?? [], createdAt: '2026-01-01T00:00:00.000Z' } as Gadget)
    }
  }
  for (const g of gadgets) {
    if (g.category === 'PC') {
      g.pcFormFactor = g.pcFormFactor ?? (rnd() < (arch.laptop ?? 0.4) ? 'laptop' : 'desktop')
      if (g.ports.length === 0) g.ports = buildPcPorts(g.pcFormFactor === 'laptop' ? 'laptop' : 'desktop')
    }
    if (g.category === 'Speaker' && rnd() < 0.25) g.stereoPair = false
    if (g.category === 'Keyboard' && rnd() < 0.15) g.splitKeyboard = true
    // 飾り登録（配線しない置き物）は実際にも少数いる
    if (rnd() < 0.04) g.displayOnly = true
  }
  // 設置場所を指定するユーザーは一部。指定するときは現実的な場所を選ぶ
  const zoneRate = rnd()   // シナリオ単位で「几帳面さ」を振る（0=未指定〜1=全指定）
  const placements = gadgets
    .filter(() => rnd() < zoneRate)
    .map((g) => ({ gadgetId: g.id, zone: pick(REAL_ZONES[g.category] ?? ZONES) }))
    .filter((p) => p.zone !== undefined)
  const r = rnd()
  return {
    name: `real:${arch.name}#${index}(${gadgets.length}台)`,
    gadgets,
    placements,
    outletCount: r < 0.1 ? 0 : r < 0.3 ? 1 : 2,
  }
}

const planOf = (s: Scenario): DeskPlan => ({
  id: 'plan-' + s.name,
  name: s.name,
  goal: 'first_setup',
  selectedGadgetIds: s.gadgets.map((g) => g.id),
  placements: s.placements,
  outletCount: s.outletCount,
  outletCountVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

let deskTourScenarios: Scenario[] = []
const loadDeskTourScenarios = async () => {
  process.env.DESK_TOUR_IMPORT_ONLY = '1'
  const { scenarios } = await import('./auditDeskTourWiring')
  deskTourScenarios = scenarios().map((tour) => {
    const scenario: Scenario = {
      name: `tour:${tour.name}`, gadgets: tour.gadgets,
      placements: tour.planOverrides?.placements ?? [], outletCount: tour.outletCount,
      nodeOffsets: tour.planOverrides?.connectionMap?.nodeOffsets,
    }
    scenario.connections = buildAutoDraft(tour.gadgets, { ...planOf(scenario), ...tour.planOverrides }, 'ja')
    return scenario
  })
}

// ─── 実在のデスクツアー記事から写した構成 ───────────────────────
// ARCHETYPES は「カテゴリごとの出現確率」で組み立てるため、同じカテゴリが
// 2台以上になる構成がほとんど出ない。実際のデスクツアー記事（りんこスタイル /
// mitsu-blog / Slow Standard / DTM・ゲーミング系ブログ等）を読むと
// 「キーボード3台・充電器4台・モニター4枚・PC2台」のような重複所有が普通で、
// そこでこそ配線の並走・端点の詰まりが起きる。記事の機材リストをそのまま
// 固定台数の構成として並べ、商品の引き当てと設置場所だけを振る。
type BlogDesk = {
  name: string
  items: [GadgetCategory, number][]
  /** PC が複数のとき、何台目までをノートPCにするか */
  laptops?: number
  outlets?: number
  /** 設置場所を指定する割合（記事のとおり配置が決まっている構成ほど高い） */
  zoneRate?: number
}

const BLOG_DESKS: BlogDesk[] = [
  // ① 4Kデュアル×電動昇降デスクの作業基地（Mac mini + MacBook / モバイルモニター2枚）
  { name: '4Kデュアル作業基地', laptops: 1, zoneRate: 0.8, items: [
    ['PC', 2], ['Monitor', 4], ['Keyboard', 3], ['Mouse', 1], ['Dock', 1], ['PowerStrip', 2],
    ['Charger', 1], ['MonitorArm', 1], ['Light', 1], ['Headphone', 1], ['Speaker', 1],
    ['Desk', 1], ['Chair', 1], ['Accessory', 1]] },
  // ② ガジェットブロガーの充電ステーション主体デスク
  { name: '充電ステーション主体', laptops: 1, zoneRate: 0.6, items: [
    ['PC', 2], ['Tablet', 1], ['Monitor', 3], ['Keyboard', 2], ['Mouse', 2], ['MonitorArm', 2],
    ['Light', 1], ['Charger', 4], ['Headphone', 1], ['Earphone', 1], ['SmartHome', 1],
    ['Desk', 1], ['Chair', 1]] },
  // ③ ウルトラワイド1枚のミニマル在宅デスク
  { name: 'ウルトラワイド1枚', laptops: 1, zoneRate: 0.9, items: [
    ['PC', 1], ['Monitor', 1], ['Keyboard', 1], ['Mouse', 1], ['MonitorArm', 1], ['Light', 1],
    ['Charger', 1], ['Smartphone', 1], ['Headphone', 1]] },
  // ④ MacBook 1本 + ドックのクラムシェル運用
  { name: 'クラムシェル運用', laptops: 1, zoneRate: 0.7, items: [
    ['PC', 1], ['Monitor', 2], ['Dock', 1], ['Keyboard', 1], ['Mouse', 1], ['PowerStrip', 1],
    ['Charger', 1], ['Speaker', 2], ['Webcam', 1], ['Smartphone', 1], ['Smartwatch', 1]] },
  // ⑤ 昇降デスク + デスクシェルフの整理デスク
  { name: 'デスクシェルフ整理', laptops: 1, zoneRate: 0.85, items: [
    ['PC', 1], ['Monitor', 2], ['Keyboard', 1], ['Mouse', 1], ['Hub', 1], ['Light', 1],
    ['Charger', 2], ['Smartphone', 1], ['Smartwatch', 1], ['Storage', 1], ['Desk', 1], ['Chair', 1]] },
  // ⑥ 開発者のトリプルモニター
  { name: '開発トリプル', laptops: 1, zoneRate: 0.75, items: [
    ['PC', 2], ['Monitor', 3], ['MonitorArm', 2], ['Keyboard', 2], ['Mouse', 2], ['Dock', 1],
    ['Hub', 1], ['PowerStrip', 2], ['Storage', 2], ['Headphone', 1], ['Webcam', 1],
    ['Light', 1], ['Charger', 1], ['Router', 1]] },
  // ⑦ KVMで仕事用/私物を切り替えるデスク
  { name: 'KVM切替', laptops: 1, zoneRate: 0.8, items: [
    ['PC', 2], ['Monitor', 2], ['KVM', 1], ['Keyboard', 1], ['Mouse', 1], ['Dock', 1],
    ['PowerStrip', 1], ['Headphone', 1], ['Webcam', 1], ['Microphone', 1], ['Charger', 1]] },
  // ⑧ ゲーミング（PC + 据置機2台 + キャプチャ）
  { name: 'ゲーミング据置併用', laptops: 0, zoneRate: 0.7, items: [
    ['PC', 1], ['Monitor', 2], ['GameConsole', 2], ['Controller', 3], ['CaptureDevice', 1],
    ['Keyboard', 1], ['Mouse', 1], ['Headphone', 1], ['Microphone', 1], ['MicArm', 1],
    ['Speaker', 1], ['Light', 2], ['PowerStrip', 2], ['Router', 1], ['Chair', 1], ['Desk', 1]] },
  // ⑨ 配信（オーディオIF + ミキサー + ライト2灯）
  { name: '配信スタジオ', laptops: 0, zoneRate: 0.8, items: [
    ['PC', 1], ['Monitor', 3], ['Webcam', 1], ['Microphone', 1], ['MicArm', 1],
    ['AudioInterface', 1], ['Mixer', 1], ['Light', 2], ['CaptureDevice', 1], ['GameConsole', 1],
    ['Headphone', 1], ['Speaker', 1], ['Keyboard', 1], ['Mouse', 1], ['PowerStrip', 2], ['Storage', 1]] },
  // ⑩ DTM（オーディオIF + モニタースピーカー + MIDI鍵盤）
  { name: 'DTM宅録', laptops: 1, zoneRate: 0.75, items: [
    ['PC', 1], ['Monitor', 2], ['AudioInterface', 1], ['Speaker', 1], ['HeadphoneAmp', 1],
    ['Headphone', 2], ['Instrument', 2], ['Microphone', 1], ['MicArm', 1], ['Mixer', 1],
    ['Keyboard', 1], ['Mouse', 1], ['PowerStrip', 2], ['Storage', 1]] },
  // ⑪ 写真・動画編集（外付けSSDが多い）
  { name: '映像編集', laptops: 1, zoneRate: 0.7, items: [
    ['PC', 2], ['Monitor', 2], ['Dock', 1], ['Storage', 4], ['Keyboard', 1], ['Mouse', 1],
    ['PenTablet', 1], ['Speaker', 1], ['Headphone', 1], ['Light', 1], ['PowerStrip', 2],
    ['Charger', 1], ['MonitorArm', 2]] },
  // ⑫ イラスト（液タブ + タブレット）
  { name: 'イラスト液タブ', laptops: 1, zoneRate: 0.7, items: [
    ['PC', 1], ['Monitor', 2], ['PenTablet', 1], ['Tablet', 1], ['Accessory', 1],
    ['Keyboard', 1], ['Mouse', 1], ['Hub', 1], ['Light', 1], ['Charger', 2], ['PowerStrip', 1]] },
  // ⑬ 一人暮らしのリビング兼デスク
  { name: 'リビング兼用', laptops: 1, zoneRate: 0.4, items: [
    ['PC', 1], ['Monitor', 1], ['Tablet', 1], ['Smartphone', 1], ['Smartwatch', 1],
    ['Charger', 2], ['MobileBattery', 1], ['Earphone', 1], ['Router', 1], ['Modem', 1],
    ['SmartHome', 2], ['PowerStrip', 1]] },
  // ⑭ 省スペース（モバイルモニター1枚）
  { name: '省スペース', laptops: 1, zoneRate: 0.5, items: [
    ['PC', 1], ['Monitor', 1], ['Hub', 1], ['Mouse', 1], ['Earphone', 1], ['Charger', 1],
    ['Smartphone', 1]] },
  // ⑮ 全部盛り（記事でいう「デスク沼」構成）
  { name: 'デスク沼', laptops: 1, zoneRate: 0.6, items: [
    ['PC', 2], ['Monitor', 3], ['Keyboard', 2], ['Mouse', 2], ['Dock', 1], ['Hub', 2],
    ['PowerStrip', 2], ['Charger', 3], ['Speaker', 1], ['Headphone', 2], ['Microphone', 1],
    ['MicArm', 1], ['Webcam', 1], ['AudioInterface', 1], ['Light', 2], ['Storage', 3],
    ['Router', 1], ['GameConsole', 1], ['Controller', 2], ['Tablet', 1], ['Smartphone', 1],
    ['Smartwatch', 1], ['MonitorArm', 2], ['Desk', 1], ['Chair', 1], ['UPS', 1]] },
  // ⑯ 学習・受験デスク
  { name: '学習デスク', laptops: 1, zoneRate: 0.5, items: [
    ['PC', 1], ['Monitor', 1], ['Tablet', 1], ['Accessory', 1], ['Light', 1], ['Charger', 1],
    ['Earphone', 1], ['PowerStrip', 1], ['Printer', 1]] },
  // ⑰ 4面マルチモニター
  { name: '4面マルチ', laptops: 0, zoneRate: 0.85, items: [
    ['PC', 1], ['Monitor', 4], ['MonitorArm', 2], ['Keyboard', 1], ['Mouse', 1],
    ['PowerStrip', 2], ['UPS', 1], ['Router', 1], ['Light', 1], ['Chair', 1], ['Desk', 1]] },
  // ⑱ 会議中心（Web会議デスク）
  { name: 'Web会議', laptops: 1, zoneRate: 0.75, items: [
    ['PC', 1], ['Monitor', 2], ['Webcam', 1], ['Microphone', 1], ['Speaker', 1],
    ['Headphone', 1], ['Light', 2], ['Dock', 1], ['Keyboard', 1], ['Mouse', 1],
    ['Charger', 1], ['PowerStrip', 1]] },
  // ⑲ VR併用デスク
  { name: 'VR併用', laptops: 0, zoneRate: 0.6, items: [
    ['PC', 1], ['Monitor', 2], ['VRGlass', 1], ['Controller', 2], ['Keyboard', 1], ['Mouse', 1],
    ['Headphone', 1], ['Light', 1], ['PowerStrip', 2], ['Charger', 1], ['Router', 1]] },
  // ⑳ 3Dプリンタ工作デスク
  { name: '3Dプリンタ工作', laptops: 1, zoneRate: 0.6, items: [
    ['PC', 1], ['Monitor', 2], ['Printer3D', 1], ['Printer', 1], ['Storage', 1],
    ['Keyboard', 1], ['Mouse', 1], ['Light', 1], ['PowerStrip', 2], ['SmartHome', 1], ['Hub', 1]] },
  // ㉑ 分割キーボード + トラックボールの自作沼
  { name: '自作キーボード沼', laptops: 1, zoneRate: 0.7, items: [
    ['PC', 1], ['Monitor', 2], ['Keyboard', 2], ['Mouse', 2], ['Hub', 2], ['Light', 1],
    ['Speaker', 1], ['Charger', 1], ['PowerStrip', 1], ['MonitorArm', 2]] },
  // ㉒ ノート1台の完全ミニマル
  { name: '完全ミニマル', laptops: 1, zoneRate: 0.3, items: [
    ['PC', 1], ['Charger', 1], ['Mouse', 1], ['Earphone', 1]] },
  // ㉓ スマートホーム連携デスク
  { name: 'スマートホーム連携', laptops: 1, zoneRate: 0.6, items: [
    ['PC', 1], ['Monitor', 2], ['SmartHome', 3], ['Light', 2], ['Router', 1], ['Modem', 1],
    ['Keyboard', 1], ['Mouse', 1], ['Charger', 2], ['PowerStrip', 2], ['Speaker', 1]] },
  // ㉔ デスクトップ自作機 + 周辺機器全部有線
  { name: '自作機フル有線', laptops: 0, zoneRate: 0.8, items: [
    ['PC', 1], ['Monitor', 3], ['Keyboard', 1], ['Mouse', 1], ['Speaker', 1], ['Headphone', 1],
    ['Microphone', 1], ['Webcam', 1], ['Storage', 2], ['Hub', 1], ['PowerStrip', 2],
    ['UPS', 1], ['Router', 1], ['MonitorArm', 2], ['Desk', 1], ['Chair', 1]] },
]

const buildBlogScenario = (index: number): Scenario => {
  const desk = BLOG_DESKS[index % BLOG_DESKS.length]
  const gadgets: Gadget[] = []
  let pcCount = 0
  for (const [cat, n] of desk.items) {
    const pool = poolFor(cat)
    if (!pool.length) continue
    for (let k = 0; k < n; k++) {
      const p = pick(pool)
      const g = { ...p, category: cat, id: `g${gadgets.length}`, ports: p.ports ?? [], createdAt: '2026-01-01T00:00:00.000Z' } as Gadget
      if (cat === 'PC') {
        g.pcFormFactor = pcCount < (desk.laptops ?? 1) ? 'laptop' : 'desktop'
        pcCount++
        if (g.ports.length === 0) g.ports = buildPcPorts(g.pcFormFactor)
      }
      gadgets.push(g)
    }
  }
  for (const g of gadgets) {
    if (g.category === 'Speaker' && rnd() < 0.25) g.stereoPair = false
    if (g.category === 'Keyboard' && rnd() < 0.2) g.splitKeyboard = true
  }
  const zoneRate = desk.zoneRate ?? 0.6
  const placements = gadgets
    .filter(() => rnd() < zoneRate)
    .map((g) => ({ gadgetId: g.id, zone: pick(REAL_ZONES[g.category] ?? ZONES) }))
  return {
    name: `blog:${desk.name}#${index}(${gadgets.length}台)`,
    gadgets,
    placements,
    outletCount: desk.outlets ?? 2,
  }
}

// テンプレート表示（主役を中央軸へ固定する配置）でも検査したいときは AUDIT_CENTER=1
const CENTER_PRIMARY = process.env.AUDIT_CENTER === '1'

const isReal = (mode: string) => mode === 'real' || mode === 'real-size'
const builtDemos = buildAllDemoDesks('ja')
const demoScenarios = builtDemos.map(({ demo, plan, activeGadgets }) => ({
  name: demo.id,
  gadgets: activeGadgets,
  placements: plan.placements,
  outletCount: plan.outletCount ?? 2,
  connections: plan.connectionMap?.connections ?? [],
  nodeOffsets: plan.connectionMap?.nodeOffsets,
}))
// 2in1・3in1 ケーブルの枝（branchGroupId）。ユーザーが線編集シートで宣言したときだけ付く値で、
// reconcileMap も buildAutoDraft も生成しない。そのため乱数・デモのどのシナリオにも現れず、
// 分岐の描画（connectionMapLayout の16箇所）が丸ごと未検査だった。
// デモデスクの「同じ充電器の同じ口から複数機器へ伸びる充電線」を分岐ケーブルとして宣言する
const buildBranchScenarios = (): Scenario[] =>
  demoScenarios.flatMap((base) => {
    const conns = base.connections ?? []
    const groups = new Map<string, MapConnection[]>()
    // 2in1・3in1 ケーブルは充電まわりの製品。L/R スピーカーへの XLR 2本のように
    // 同じ音声出力ポートを共有するだけの線は、物理的には別々のケーブルなので除く
    const BRANCH_CABLE_TYPES = ['USB_C', 'USB_A', 'USB_A_to_C', 'USB_C_to_Lightning', 'USB_A_to_Lightning']
    for (const c of conns) {
      if (!c.sourcePortId) continue
      if (!BRANCH_CABLE_TYPES.includes(c.cableType)) continue
      const key = `${c.fromGadgetId}|${c.sourcePortId}`
      groups.set(key, [...(groups.get(key) ?? []), c])
    }
    // 同じ口を共有している線が2本以上あるものだけが分岐ケーブルになりうる
    const shared = [...groups.values()].filter((list) => list.length >= 2)
    if (shared.length === 0) return []
    const tagged = new Map<string, string>()
    shared.forEach((list, index) => {
      for (const c of list.slice(0, 3)) tagged.set(c.id, `branch-${index}`)
    })
    return [{
      ...base,
      name: `branch:${base.name}`,
      connections: conns.map((c) =>
        tagged.has(c.id) ? { ...c, branchGroupId: tagged.get(c.id) } : c),
    }]
  })
// デモデスクは分岐にできる形（同じ口を2台以上で共有）が1件しか無く、それ任せだと
// カバーが薄い。3in1・2in1 を明示的に組んだ構成を足して、束ね処理を確実に踏ませる
const buildSyntheticBranchScenario = (): Scenario => {
  const charger = internetGadget('br-charger', 'Anker 3in1 充電器', 'Charger')
  const phone = internetGadget('br-phone', 'iPhone', 'Smartphone')
  const watch = internetGadget('br-watch', 'Apple Watch', 'Smartwatch')
  const buds = internetGadget('br-buds', 'AirPods Pro', 'Earphone')
  const pad = internetGadget('br-tablet', 'iPad', 'Tablet')
  // タブレットへ吸着給電されるペン。ノードを持たずタブレットへ内包されるのが正しい
  const pencil = internetGadget('br-pencil', 'Apple Pencil', 'Accessory', {
    ports: [{ id: 'pw1', type: 'wirelessCharging', direction: 'input', count: 1 }],
    powerUsage: 'rechargeable',
  })
  const pc = internetGadget('br-pc', 'MacBook Pro', 'PC')
  const monitor = internetGadget('br-monitor', 'Dell U2723QE', 'Monitor')
  const gadgets = [pc, monitor, charger, phone, watch, buds, pad, pencil]
  // 3in1（充電器の1口 → スマホ・時計・イヤホン）と 2in1（別の口 → タブレット・PC）
  const branch = (id: string, to: string, port: string, group: string): MapConnection => ({
    id,
    fromGadgetId: charger.id,
    toGadgetId: to,
    cableType: 'USB_C',
    origin: 'manual',
    confirmed: true,
    chargingOnly: true,
    sourcePortId: port,
    branchGroupId: group,
  })
  return {
    name: 'branch:synthetic-3in1',
    gadgets,
    outletCount: 2,
    placements: [
      { gadgetId: pc.id, zone: 'desk_left' },
      { gadgetId: monitor.id, zone: 'back_center' },
      { gadgetId: charger.id, zone: 'under_desk' },
      { gadgetId: phone.id, zone: 'front_right' },
      { gadgetId: watch.id, zone: 'front_right' },
      { gadgetId: buds.id, zone: 'desk_right' },
      { gadgetId: pad.id, zone: 'front_left' },
      { gadgetId: pencil.id, zone: 'front_left' },
    ],
    connections: [
      branch('br-1', phone.id, 'pc1#0', 'g3in1'),
      branch('br-2', watch.id, 'pc1#0', 'g3in1'),
      branch('br-3', buds.id, 'pc1#0', 'g3in1'),
      branch('br-4', pad.id, 'pc1#1', 'g2in1'),
      branch('br-5', pc.id, 'pc1#1', 'g2in1'),
      {
        id: 'br-pencil-attach',
        fromGadgetId: pad.id,
        toGadgetId: pencil.id,
        cableType: 'wirelessCharging',
        origin: 'auto',
        confirmed: true,
        wireless: true,
        chargingOnly: true,
      },
      {
        id: 'br-video',
        fromGadgetId: pc.id,
        toGadgetId: monitor.id,
        cableType: 'HDMI',
        origin: 'auto',
        confirmed: false,
      },
    ],
  }
}
// internetGadget の定義より前に評価されるので、初回参照まで組み立てを遅らせる
let branchScenariosCache: Scenario[] | null = null
const branchScenarioAt = (i: number): Scenario => {
  branchScenariosCache ??= [...buildBranchScenarios(), buildSyntheticBranchScenario()]
  return branchScenariosCache[i % branchScenariosCache.length]
}
let templateScenarios: Scenario[] = []
const buildTemplateScenarios = async (): Promise<Scenario[]> => {
  const scenarios: Scenario[] = []
  for (const template of DESK_TEMPLATES) {
    let gadgets: Gadget[] = []
    let createdPlan: DeskPlan | undefined
    await applyTemplate(template, {
      addGadgets: async (next) => { gadgets = next },
      addPlan: async (next) => { createdPlan = next },
      existingGadgets: [],
      items: buildTemplateItems(template, 'ja'),
      selections: {},
      outletCount: 2,
      lang: 'ja',
    })
    if (!createdPlan) throw new Error(`テンプレートのプラン生成に失敗: ${template.id}`)
    scenarios.push({
      name: `template:${template.id}`,
      gadgets,
      placements: createdPlan.placements,
      outletCount: createdPlan.outletCount ?? 2,
    })
  }
  return scenarios
}
const internetGadget = (
  id: string,
  name: string,
  category: GadgetCategory,
  extra: Partial<Gadget> = {},
): Gadget => {
  const fallbackCategory: Partial<Record<GadgetCategory, GadgetCategory>> = { KVM: 'Hub' }
  const preset = poolFor(category)[0]
    ?? GADGET_PRESETS.find((p) => p.category === category)
    ?? poolFor(fallbackCategory[category] ?? category)[0]
  if (!preset) throw new Error(`インターネット実例用プリセットがないカテゴリ: ${category}`)
  return {
    ...preset,
    ...extra,
    id,
    name,
    category,
    ports: extra.ports ?? preset.ports ?? [],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Gadget
}
const internetScenario = (
  name: string,
  sourceUrl: string,
  specs: Array<[string, string, GadgetCategory, DeskZone?, Partial<Gadget>?]>,
): Scenario => {
  const gadgets = specs.map(([id, label, category, , extra]) => internetGadget(id, label, category, extra))
  return {
    name: `internet:${name}`,
    gadgets,
    placements: specs.flatMap(([id, , , zone]) => zone ? [{ gadgetId: id, zone }] : []),
    outletCount: 2,
    sourceUrls: [sourceUrl],
  }
}
const internetScenarios: Scenario[] = [
  internetScenario('joe-granitto-creator', 'https://www.joegranitto.com/blog/2025-desk-setup-tour', [
    ['joe-pc', 'MacBook Pro M3 Max 16-inch', 'PC', 'desk_left', { pcFormFactor: 'laptop' }],
    ['joe-monitor-main', 'LG 29-inch Ultrawide Monitor', 'Monitor', 'back_center'],
    ['joe-monitor-game', 'ASUS Gaming Monitor', 'Monitor', 'back_right'],
    ['joe-dock', 'HP Docking Station', 'Dock', 'desk_left'],
    ['joe-camera', 'Sony A7 IV', 'Webcam', 'back_left'],
    ['joe-capture', 'Elgato Cam Link 4K', 'CaptureDevice', 'desk_back'],
    ['joe-audio', 'Scarlett Solo Gen 3', 'AudioInterface', 'desk_right'],
    ['joe-speaker', 'M-Audio BX5', 'Speaker', 'back_right', { stereoPair: true }],
    ['joe-mic', 'Tonor USB Microphone', 'Microphone', 'desk_left'],
    ['joe-lightbar', 'Quntis Monitor Light Bar', 'Light', 'desk_back'],
    ['joe-keylight', 'Amaran 60d', 'Light', 'back_left'],
    ['joe-rimlight', 'GVM PL60C', 'Light', 'back_right'],
    ['joe-desk', 'IKEA Karlby + Huanuo Motorized Legs', 'Desk'],
  ]),
  internetScenario('dawid-rylko-workstation', 'https://dawidrylko.com/setup/', [
    ['dawid-pc', 'Mac mini M4', 'PC', 'desk_left', { pcFormFactor: 'desktop' }],
    ['dawid-dock', 'RayCue ALL-in-One Charger Dock', 'Dock', 'desk_left'],
    ['dawid-monitor', 'Iiyama G-Master GCB3481WQSU-B1', 'Monitor', 'back_center'],
    ['dawid-kvm', 'Ugreen DisplayPort 1.4 KVM Switch', 'KVM', 'desk_back'],
    ['dawid-hub', 'Ugreen USB-C Hub 7-in-1', 'Hub', 'desk_right'],
    ['dawid-mouse', 'Logitech MX Master 3S', 'Mouse', 'front_right'],
    ['dawid-keyboard', 'NuPhy Air75 v1', 'Keyboard', 'front_center'],
    ['dawid-mic', 'Novox NC-1', 'Microphone', 'desk_left'],
    ['dawid-light', 'Xiaomi Mi Computer Monitor Light Bar', 'Light', 'desk_back'],
    ['dawid-nas', 'Synology DiskStation DS423+', 'Storage', 'under_desk'],
    ['dawid-printer', 'Brother HL-L2352DW', 'Printer', 'desk_right'],
    ['dawid-desk', 'Oak Rustic Desktop + Silver Monkey EDF-180', 'Desk'],
  ]),
  internetScenario('seory-consultant', 'https://seory.co.jp/desk-tour/', [
    ['seory-pc', '自作PC', 'PC', 'under_desk', { pcFormFactor: 'desktop' }],
    ['seory-laptop', 'LIFEBOOK U938/T', 'PC', 'desk_left', { pcFormFactor: 'laptop' }],
    ['seory-monitor-main', 'LG ウルトラワイドモニター', 'Monitor', 'back_center'],
    ['seory-monitor-sub1', 'IODATA WQHDモニター', 'Monitor', 'back_left'],
    ['seory-monitor-sub2', 'FHDサブモニター', 'Monitor', 'back_right'],
    ['seory-speaker', 'Creative Pebble', 'Speaker', 'back_right', { stereoPair: true }],
    ['seory-audio', 'PreSonus Revelator io24', 'AudioInterface', 'desk_right'],
    ['seory-mic', 'SHURE MV7X', 'Microphone', 'desk_left'],
    ['seory-keyboard', 'REALFORCE R2', 'Keyboard', 'front_center'],
    ['seory-mouse', 'Logitech MX MASTER 3S', 'Mouse', 'front_right'],
    ['seory-streamdeck', 'Elgato Stream Deck +', 'SmallDevice', 'desk_left'],
  ]),
  internetScenario('reddit-battlestation', 'https://www.reddit.com/r/battlestations/comments/1sf9pxm/my_battle_station_desk_setup_now_completed/', [
    ['reddit-pc', 'Intel i5-13400F / RTX 4060 PC', 'PC', 'under_desk', { pcFormFactor: 'desktop' }],
    ['reddit-monitor-main', 'LG UltraGear 1000R 2K 180Hz', 'Monitor', 'back_center'],
    ['reddit-monitor-sub', 'Acer Nitro FHD 100Hz', 'Monitor', 'back_right'],
    ['reddit-keyboard', 'Kreo Swarm X Wireless 75%', 'Keyboard', 'front_center'],
    ['reddit-mouse', 'Cosmic Byte Hypernova 8K', 'Mouse', 'front_right'],
    ['reddit-controller', 'PowerA Battle Dragon Wireless Controller', 'Controller', 'front_left'],
    ['reddit-headphone', 'Razer Barracuda X Wireless', 'Headphone', 'desk_left'],
    ['reddit-mic', 'Razer Seiren V3 Mini', 'Microphone', 'desk_right'],
    ['reddit-light', 'Quntis Monitor Light Bar', 'Light', 'desk_back'],
    ['reddit-speaker', 'Edifier R33BT', 'Speaker', 'back_left', { stereoPair: true }],
  ]),
  internetScenario('alli-will-video-editing', 'https://www.alliandwill.com/blog/new-modern-desk-setup-tour-pro-video-editing-dream-desk-build', [
    ['alli-pc', 'Mac Studio M1 Ultra', 'PC', 'desk_left', { pcFormFactor: 'desktop' }],
    ['alli-monitor', 'LG 40-inch 5K2K Ultrawide', 'Monitor', 'back_center'],
    ['alli-speaker', 'Yamaha HS8', 'Speaker', 'back_right', { stereoPair: true }],
    ['alli-audio', 'Focusrite Scarlett 18i8', 'AudioInterface', 'desk_right'],
    ['alli-mic', 'Shure SM7B', 'Microphone', 'desk_left'],
    ['alli-mic-arm', 'Adjustable Mic Boom Arm', 'MicArm', 'desk_back'],
    ['alli-headphone', 'Sennheiser Headphones', 'Headphone', 'desk_left'],
    ['alli-keyboard', 'Apple Magic Keyboard', 'Keyboard', 'front_center'],
    ['alli-mouse', 'SteelSeries Rival 3 Wired Mouse', 'Mouse', 'front_right'],
    ['alli-storage', 'Crucial External 4TB SSD', 'Storage', 'desk_right'],
    ['alli-light', 'RGB Tube Light', 'Light', 'desk_back'],
    ['alli-desk', 'IKEA LAGKAPTEN 78-inch Desk', 'Desk'],
  ]),
]
const reconcileScenarioIncrementally = (base: Scenario, prefix: string): Scenario => {
  let connections: MapConnection[] = []
  for (let size = 1; size <= base.gadgets.length; size++) {
    const gadgets = base.gadgets.slice(0, size)
    const selected = new Set(gadgets.map((g) => g.id))
    const plan: DeskPlan = {
      ...planOf(base),
      selectedGadgetIds: [...selected],
      placements: base.placements.filter((p) => selected.has(p.gadgetId)),
      connectionMap: { connections },
    }
    connections = reconcileMap(connections, gadgets, plan, 'ja')
  }
  return { ...base, name: `${prefix}:${base.name}`, connections }
}
const buildIncrementalScenario = (i: number): Scenario =>
  reconcileScenarioIncrementally(buildRandomScenario(i), 'incremental')
const buildMutationScenario = (i: number): Scenario => {
  const added = buildIncrementalScenario(i)
  let gadgets = [...added.gadgets]
  let connections = added.connections ?? []
  const removalIds = gadgets.filter((_, index) => index % 4 === 2).map((g) => g.id)
  for (const removalId of removalIds) {
    gadgets = gadgets.filter((g) => g.id !== removalId)
    const selected = new Set(gadgets.map((g) => g.id))
    const plan: DeskPlan = {
      ...planOf(added),
      selectedGadgetIds: [...selected],
      placements: added.placements.filter((p) => selected.has(p.gadgetId)),
      connectionMap: { connections },
    }
    connections = reconcileMap(connections, gadgets, plan, 'ja')
  }
  const selected = new Set(gadgets.map((g) => g.id))
  return {
    ...added,
    name: `mutation:${added.name}`,
    gadgets,
    placements: added.placements.filter((p) => selected.has(p.gadgetId)),
    connections,
  }
}
const buildScenario = (i: number, mode: string): Scenario =>
  mode === 'tour'
    ? deskTourScenarios[i % deskTourScenarios.length]
    : mode === 'branch'
    ? branchScenarioAt(i)
    : mode === 'demo'
    ? demoScenarios[i % demoScenarios.length]
    : mode === 'template'
      ? templateScenarios[i % templateScenarios.length]
      : mode === 'incremental'
        ? buildIncrementalScenario(i)
        : mode === 'mutation'
          ? buildMutationScenario(i)
          : mode === 'internet'
            ? internetScenarios[i % internetScenarios.length]
            : mode === 'internet-create'
              ? reconcileScenarioIncrementally(internetScenarios[i % internetScenarios.length], 'create')
    : mode === 'blog' || mode === 'blog-size'
    ? buildBlogScenario(i)
    : isReal(mode) ? buildRealisticScenario(i) : buildRandomScenario(i, mode === 'big')

/**
 * 手動リサイズ（ノードの拡大・縮小）。NODE_MIN〜NODE_MAX の全域を使い、
 * 「1台だけ極端に大きい」「ほぼ全台を変えている」の両方が出るようにする。
 */
const rollSizes = (gadgets: Gadget[]): Record<string, { w: number; h: number }> => {
  const sizes: Record<string, { w: number; h: number }> = {}
  const rate = 0.15 + rnd() * 0.75      // シナリオごとに変更率を振る
  const huge = rnd() < 0.25             // 極端に大きくする回
  for (const g of gadgets) {
    if (rnd() >= rate) continue
    const w = huge && rnd() < 0.4 ? 300 + Math.round(rnd() * 180) : 68 + Math.round(rnd() * 260)
    const h = huge && rnd() < 0.4 ? 240 + Math.round(rnd() * 240) : 68 + Math.round(rnd() * 200)
    sizes[g.id] = { w, h }
  }
  return sizes
}

// シナリオ生成の直後に同じ順で乱数を消費する（debug 再現とループで挙動を揃える）
const rollPerturb = (mode: string, gadgets: Gadget[]) => {
  const offsets: Record<string, { dx: number; dy: number }> = {}
  let sizes: Record<string, { w: number; h: number }> = {}
  if (mode === 'drag') {
    for (const g of gadgets) {
      if (rnd() < 0.25) offsets[g.id] = { dx: Math.round((rnd() - 0.5) * 160), dy: Math.round((rnd() - 0.5) * 120) }
      if (rnd() < 0.1) sizes[g.id] = { w: 68 + Math.round(rnd() * 200), h: 68 + Math.round(rnd() * 160) }
    }
  } else if (mode === 'real-size' || mode === 'blog-size') {
    sizes = rollSizes(gadgets)
  }
  return { offsets, sizes }
}

const debugMain = async (target: number) => {
  const mode = process.argv[4] ?? 'plain'
  if (mode === 'template') templateScenarios = await buildTemplateScenarios()
  if (mode === 'tour') await loadDeskTourScenarios()
  // 監査ループと同じ順で乱数を消費し、同じ構成・同じドラッグ量を再現する
  let s = buildScenario(0, mode)
  let rolled = rollPerturb(mode, s.gadgets)
  for (let i = 1; i <= target; i++) {
    s = buildScenario(i, mode)
    rolled = rollPerturb(mode, s.gadgets)
  }
  const plan = planOf(s)
  const conns = s.connections ?? buildAutoDraft(s.gadgets, plan, 'ja')
  const nodeOffsets = { ...(s.nodeOffsets ?? {}), ...rolled.offsets }
  const nodeSizes = rolled.sizes
  const layout = await computeMapLayout(s.gadgets, conns, s.placements, nodeOffsets, nodeSizes, CENTER_PRIMARY)
  console.log(`── ${s.name} ──`)
  for (const n of layout.nodes) {
    console.log(`node ${n.id.padEnd(8)} ${n.gadget.category.padEnd(14)} x=${n.x} y=${n.y} w=${n.w} h=${n.h} tier=${n.tier} ${n.gadget.name}`)
  }
  for (const e of layout.edges) {
    console.log(`edge ${e.from.id}→${e.to.id} [${e.conn.cableType}] port=${e.conn.sourcePortId ?? '-'} : ${e.points.map((p) => `(${p.x},${p.y})`).join(' ')}`)
  }
  analyze(layout).forEach((f) => console.log(`  ! [${f.kind}] ${f.detail}`))
}

;(globalThis as any).__auditLog = process.env.AUDIT_LOG === "1"

const main = async () => {
  const count = Number(process.argv[2] ?? 120)
  const mode = process.argv[3] ?? 'plain'   // plain | big | drag | real | real-size | debug
  if (mode === 'debug') { await debugMain(count); return }
  if (mode === 'template') templateScenarios = await buildTemplateScenarios()
  if (mode === 'tour') await loadDeskTourScenarios()
  const summary = new Map<string, number>()
  const worst: { label: string; findings: Finding[]; gadgets: string[] }[] = []
  let scenariosWithIssues = 0
  let totalEdges = 0

  for (let i = 0; i < count; i++) {
    const s = buildScenario(i, mode)
    // ドラッグ移動・手動リサイズ（テンプレート以外でユーザーが行う操作）
    const { offsets, sizes: nodeSizes } = rollPerturb(mode, s.gadgets)
    const nodeOffsets = { ...(s.nodeOffsets ?? {}), ...offsets }
    const plan = planOf(s)
    const conns = s.connections ?? buildAutoDraft(s.gadgets, plan, 'ja')
    const t0 = Date.now()
    const layout = await computeMapLayout(s.gadgets, conns, s.placements, nodeOffsets, nodeSizes, CENTER_PRIMARY)
    const ms = Date.now() - t0
    totalEdges += layout.edges.length
    ;(globalThis as any).__sizeW = ((globalThis as any).__sizeW ?? 0) + layout.width
    ;(globalThis as any).__sizeH = ((globalThis as any).__sizeH ?? 0) + layout.height
    ;(globalThis as any).__ms = ((globalThis as any).__ms ?? 0) + ms
    const findings = analyze(layout)
    for (const f of findings) summary.set(f.kind, (summary.get(f.kind) ?? 0) + 1)
    if (findings.length > 0) {
      scenariosWithIssues++
      worst.push({
        label: `${s.name} nodes=${layout.nodes.length} edges=${layout.edges.length} ${ms}ms`,
        findings,
        gadgets: s.gadgets.map((g) => `${g.category}:${g.name}${g.displayOnly ? '(飾り)' : ''}`),
      })
    }
    const step = count >= 2000 ? 500 : 20
    if ((i + 1) % step === 0) console.log(`  ...${i + 1}/${count} 完了`)
  }

  console.log('\n══════ 集計 ══════')
  const g = globalThis as any
  console.log(`mode=${mode} seed=${process.env.AUDIT_SEED ?? 20260802}`)
  console.log(`シナリオ数: ${count} / 問題あり: ${scenariosWithIssues} / 総エッジ数: ${totalEdges}`)
  console.log(`平均キャンバス: ${(g.__sizeW / count).toFixed(0)} x ${(g.__sizeH / count).toFixed(0)} / 平均計算時間: ${(g.__ms / count).toFixed(0)}ms`)
  if (mode === 'internet' || mode === 'internet-create') {
    for (const scenario of internetScenarios) {
      console.log(`  source ${scenario.name}: ${(scenario.sourceUrls ?? []).join(', ')}`)
    }
  }
  for (const [kind, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${n}`)
  }
  console.log('\n══════ 詳細（上位20シナリオ）══════')
  worst
    .sort((a, b) => b.findings.length - a.findings.length)
    .slice(0, 20)
    .forEach((w) => {
      console.log(`\n▼ ${w.label}  [${w.findings.length}件]`)
      console.log(`   構成: ${w.gadgets.join(', ')}`)
      w.findings.slice(0, 12).forEach((f) => console.log(`   - [${f.kind}] ${f.detail}`))
      if (w.findings.length > 12) console.log(`   - ...他 ${w.findings.length - 12} 件`)
    })
}

main()
