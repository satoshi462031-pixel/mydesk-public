import { useMemo, useRef } from 'react'
import { useNavigation, useScrollToTop } from '@react-navigation/native'

/**
 * 下のタブを押し直したときに先頭へ戻す一覧を、押された時点で選ぶ useScrollToTop。
 * null を返すと何もしない（表示していないタブの一覧は戻さない）。
 *
 * 一覧の ref を effect で別の ref へ写していた頃は、写した時点で一覧がまだ無い
 * （読み込み中は骨組みを出している）・あとで作り直された（key の切り替え）と、
 * 空か古いまま残り、押しても先頭へ戻らなかった
 */
export function useScrollToTopOf(getTarget: () => unknown): void {
  const navigation = useNavigation()
  const getTargetRef = useRef(getTarget)
  getTargetRef.current = getTarget
  // useScrollToTop は押されたあとの次のフレームで current を読む。そこで今の一覧を引く
  const ref = useMemo(() => ({ get current() { return navigation.isFocused() ? getTargetRef.current() : null } }), [navigation])
  useScrollToTop(ref as never)
}
