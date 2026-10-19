import { cloneElement, createContext, ReactElement, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { Image, Keyboard, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScreenAnnotationGuide, type ScreenGuideShot } from '../components/organisms/ScreenAnnotationGuide'
import { measureCoachTarget } from '../utils/coachMarkMeasurement'
import type { CoachRect } from '../utils/coachMarkLayout'
import { resolveCoachSteps } from '../utils/coachMarkResolution'
import { hapticLight } from '../utils/haptics'

export interface CoachStep {
  target?: string
  title?: { ja: string; en: string }
  emphasis?: { ja: string[]; en: string[] }
  ja: string
  en: string
  pad?: number
  radius?: number
  within?: string
  header?: boolean
  coveredBy?: string[]
}

interface Measurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void
}
type TargetRef = (node: Measurable | null) => void
export type CoachTargetRef = TargetRef
type TargetFactory = (id: string) => TargetRef
export const COACH_SCREEN = '__screen'

type CoachOpen = (steps: CoachStep[]) => Promise<void>
interface CoachScopeValue { target: TargetFactory; open: CoachOpen }
const CoachScopeContext = createContext<CoachScopeValue | null>(null)

export function CoachScope({ coach, children, enabled = true }: { coach: CoachScopeValue; children: ReactNode; enabled?: boolean }) {
  const { target, open } = coach
  const value = useMemo(() => ({ target, open }), [target, open])
  return <CoachScopeContext.Provider value={enabled ? value : null}>{children}</CoachScopeContext.Provider>
}
export function useCoachTarget(id: string | null | undefined): TargetRef | undefined {
  const target = useContext(CoachScopeContext)?.target
  return useMemo(() => (target && id ? target(id) : undefined), [target, id])
}
export function useCoachOpen(): CoachOpen | null {
  return useContext(CoachScopeContext)?.open ?? null
}
export function CoachAnchor({ id, also, children }: { id: string; also?: string; children: ReactElement }) {
  const ref = useCoachTarget(id)
  const secondary = useCoachTarget(also)
  const attach = useCallback<TargetRef>((node) => { ref?.(node); secondary?.(node) }, [ref, secondary])
  return ref || secondary ? cloneElement(children as ReactElement<{ ref?: CoachTargetRef; collapsable?: boolean }>, { ref: attach, collapsable: false }) : children
}

async function captureCurrentScreen(width: number, height: number): Promise<ScreenGuideShot> {
  try {
    const { captureScreen } = await import('react-native-view-shot')
    const uri = await captureScreen({ format: 'jpg', quality: 0.9, result: 'tmpfile' })
    const size = await new Promise<{ width: number; height: number }>((resolve) => Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), () => resolve({ width, height })))
    return { uri, width, height: size.height * width / size.width }
  } catch {
    // 撮影部品の入っていないビルドや撮影の失敗では、写しの無い枠だけの見取り図で案内する
    return { uri: null, width, height }
  }
}

async function releaseScreenCapture(uri: string) {
  try {
    const { releaseCapture } = await import('react-native-view-shot')
    releaseCapture(uri)
  } catch {
    // 撮影部品が利用できないビルドでも、ガイドを閉じる操作を完了させる。
  }
}

export function useCoachMarks(measureExternalTarget?: (id: string) => Promise<CoachRect | null>) {
  const [steps, setSteps] = useState<(CoachStep & { rect: CoachRect | null })[] | null>(null)
  const [opening, setOpening] = useState(false)
  const [shot, setShot] = useState<ScreenGuideShot | null>(null)
  const shotUri = useRef<string | null>(null)
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const request = useRef(0)
  const showing = useRef(false)
  const focused = useIsFocused()
  const close = useCallback(() => {
    request.current++
    showing.current = false
    setSteps(null)
    setOpening(false)
    if (shotUri.current) void releaseScreenCapture(shotUri.current)
    shotUri.current = null
    setShot(null)
  }, [])
  useEffect(() => { if (!focused) close() }, [focused, close])
  useEffect(() => { close() }, [width, height, close])
  useEffect(() => () => {
    request.current++
    if (shotUri.current) void releaseScreenCapture(shotUri.current)
  }, [])
  const nodes = useRef(new Map<string, Set<Measurable>>()).current
  const target = useCallback<TargetFactory>((id) => {
    let attached: Measurable | null = null
    return (node) => {
      if (attached) {
        nodes.get(id)?.delete(attached)
        if (!nodes.get(id)?.size) nodes.delete(id)
      }
      attached = node
      if (node) {
        const entries = nodes.get(id) ?? new Set<Measurable>()
        entries.add(node)
        nodes.set(id, entries)
      }
    }
  }, [nodes])
  const open = useCallback(async (nextSteps: CoachStep[]) => {
    if (!focused || showing.current) return
    showing.current = true
    const currentRequest = ++request.current
    // 撮影と計測で案内が出るまで間がある。画面に印を出すと写しに入るので、押せたことは触覚で返す
    hapticLight()
    const keyboardOpen = Keyboard.isVisible()
    Keyboard.dismiss()
    setOpening(true)
    // キーボードと再生中の画面が止まってから、同じフレームの対象を測る。
    // キーボードが閉じきるのを待つときだけ長く待つ（再生の一時停止は数フレームで済む）
    await new Promise<void>((resolve) => setTimeout(resolve, keyboardOpen ? 300 : 120))
    if (request.current !== currentRequest) return
    const ids = new Set([...nodes.keys(), ...nextSteps.flatMap(step => [step.target, step.within, ...(step.coveredBy ?? [])].filter((id): id is string => !!id))])
    const measured = new Map(await Promise.all([...ids].map(async (id) => {
      const rects = await Promise.all([...(nodes.get(id) ?? [])].map(node => measureCoachTarget(node)))
      if (!rects.some(rect => rect !== null) && measureExternalTarget) rects.push(await measureExternalTarget(id))
      return [id, rects.filter((rect): rect is CoachRect => rect !== null)] as const
    })))
    if (request.current !== currentRequest) return
    const resolved = resolveCoachSteps(nextSteps, measured, { width, height, top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right })
    // 案内を重ねる前の画面を撮る。説明はこの写しの上の座標を指す
    const captured = await captureCurrentScreen(width, height)
    if (request.current !== currentRequest) { if (captured.uri) void releaseScreenCapture(captured.uri); return }
    shotUri.current = captured.uri
    setShot(captured)
    setSteps(resolved)
    setOpening(false)
  }, [nodes, width, height, insets.top, insets.bottom, insets.left, insets.right, focused, measureExternalTarget])
  const overlay = focused && steps && shot ? <ScreenAnnotationGuide steps={steps} shot={shot} onClose={close} /> : null
  return { target, open, close, overlay, active: focused && (opening || steps !== null) }
}
