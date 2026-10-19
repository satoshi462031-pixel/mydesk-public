// 上部の収納（hooks/useCollapsibleHeader）の判定。
//
// UI スレッドのスクロールハンドラから毎フレーム呼ぶので worklet にしてあるが、
// React Native には依存させない（tests/collapsibleHeader.test.ts が node で直接確かめる）。
// 2画面に同じ式を手で書いていた頃は、片方だけ直した式が食い違ったまま残っていた。

export type CollapsibleTab = 'gadgets' | 'wiring' | 'info'

export function clampHeaderOffset(y: number, max: number): number {
  'worklet'
  return y < 0 ? 0 : y > max ? max : y
}

export function maxScrollOffset(content: number, viewport: number): number {
  'worklet'
  return Math.max(0, content - viewport)
}

/** 手動で開いた位置からも、次のドラッグの移動量だけで収納を再開する。 */
export function headerOffsetForScroll(scrollY: number, collapseH: number, bias = 0): number {
  'worklet'
  return clampHeaderOffset(scrollY + bias, collapseH)
}

export function headerParallaxOffset(offset: number): number {
  'worklet'
  return -offset / 2
}

/** 収納と一覧に同じ移動を二重に加えず、読んでいる行を保ったまま上部だけ開閉する。 */
export function scrollOffsetAfterHeaderChange(scrollY: number, previousHeader: number, nextHeader: number): number {
  'worklet'
  return Math.max(0, scrollY - previousHeader) + nextHeader
}

/** 写真の追加や概要の展開で高さが変わっても、途中の収納率を維持する。 */
export function headerOffsetAfterLayout(offset: number, previousHeight: number, nextHeight: number): number {
  return previousHeight > 0 ? clampHeaderOffset(offset / previousHeight * nextHeight, nextHeight) : 0
}

/**
 * 作り直した一覧へ直前位置を戻す手順。寸法が揃っていなければ null（まだ戻せない）。
 * done が false の間は中身が足りず途中までしか戻せていないので、次の寸法でもう一度戻す。
 * 高さが決まる前に1回だけ scrollTo していた頃は、届かないまま上部だけが畳まれ、
 * 一覧の先頭で引いても上部が開かなくなっていた
 */
export function planScrollRestore(target: number, content: number, viewport: number): { y: number; done: boolean } | null {
  if (content <= 0 || viewport <= 0) return null
  const max = maxScrollOffset(content, viewport)
  return { y: Math.min(target, max), done: target <= max }
}

/**
 * 配線は写真ボタンで選んだ状態、一覧は途中の収納量も引き継ぐ。
 * 行き先を既に読み進めていれば、その一覧を写真で覆い直さない。
 */
export function headerOffsetOnTabChange(input: {
  tab: CollapsibleTab
  scrollY: number
  headerOffset: number
  collapseH: number
  wiringPhotoExpanded: boolean
}): number {
  if (input.tab === 'wiring') return input.wiringPhotoExpanded ? 0 : input.collapseH
  return clampHeaderOffset(Math.max(input.headerOffset, input.scrollY), input.collapseH)
}
