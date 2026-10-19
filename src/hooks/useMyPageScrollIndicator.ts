import { createContext, useContext, useEffect, useState } from 'react'
import { Animated } from 'react-native'

// マイページの4つのタブの一覧は、プロフィールとタブの帯を一覧の頭に持ち、流れたタブの帯を
// 上に重ねて止める（MyPageScreen の renderStickyTabBar）。スクロールバーは一覧の右端を上から
// 下まで動くので、重ねた帯の裏に潜って見えなくなっていた。バーが動く範囲の上端を、
// いまタブの帯の下端がある位置に合わせる。
export const MyPageScrollIndicatorContext = createContext<{ top: number } | undefined>(undefined)

/** 一覧の scrollIndicatorInsets に渡す。マイページの外では undefined（既定のまま） */
export function useMyPageScrollIndicatorInsets(): { top: number } | undefined {
  return useContext(MyPageScrollIndicatorContext)
}

// 帯の位置は流れた量で毎フレーム変わるが、バーの範囲は数 pt ずれても見分けられない。
// 一覧ごと描き直すのを、この刻みを越えたときだけにする
const STEP = 8

/**
 * タブの帯の下端の位置。止まるまではプロフィールの高さ＋帯の高さから流れたぶんを引き、
 * 止まったあと（流れた量がプロフィールの高さ以上）は帯の高さで一定。
 */
export function useStickyBarBottom(
  scrollY: Animated.Value,
  /** 切り替えた時点の流れた量。タブごとに別の scrollY を持つので、切り替えた先の位置から始める */
  initialY: number,
  profileHeight: number,
  tabBarHeight: number,
): number {
  const compute = (y: number) => {
    const exact = profileHeight + tabBarHeight - Math.min(Math.max(0, y), profileHeight)
    return Math.max(tabBarHeight, Math.round(exact / STEP) * STEP)
  }
  const [bottom, setBottom] = useState(() => compute(0))
  useEffect(() => {
    if (profileHeight <= 0 || tabBarHeight <= 0) return
    setBottom(compute(initialY))
    const id = scrollY.addListener(({ value }) => {
      const next = compute(value)
      setBottom((prev) => (prev === next ? prev : next))
    })
    return () => scrollY.removeListener(id)
    // compute は profileHeight と tabBarHeight だけに依る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollY, profileHeight, tabBarHeight])
  return bottom
}
