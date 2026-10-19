// 公開の前に名乗りを確定させる関門（PublicNameGateModal）を、画面側から1行で挟むための入れ物。
//
// 公開・再公開・公開ページの更新は、どれも投稿者名を desks.owner_name へ焼く。
// 名前が空のまま通る経路が1つでも残ると、公開ページから投稿者が消える。
// 画面ごとに確認の作りが違う（ネイティブの Alert・自前の確認シート）ので、
// 判定と入力欄はここに寄せ、呼び出し側は run() で包むだけにする。
import { useCallback, useRef, useState } from 'react'
import { getPublicNickname } from '../utils/publicNickname'

export interface PublicNameGate {
  /** 名前が決まっていればそのまま実行し、無ければ聞いてから実行する */
  run: (action: () => void) => void
  /** PublicNameGateModal へそのまま渡す */
  gateProps: {
    visible: boolean
    onSaved: (name: string) => void
    onCancel: () => void
  }
}

/** onNameSaved: 画面が投稿者名を控えている場合に更新するためのもの（表示の追従用） */
export function usePublicNameGate(onNameSaved?: (name: string) => void): PublicNameGate {
  const [visible, setVisible] = useState(false)
  const pendingRef = useRef<(() => void) | null>(null)

  const run = useCallback((action: () => void) => {
    // 控えではなく毎回読む。フォーカス時に控えた値だと、読み込みが終わる前に
    // 公開した人に「名前が無い」と誤判定して、決めてある名前をもう一度聞くことになる。
    //
    // 読み出しに失敗したときも「名前が無い」側へ倒す。ここで action を通すと
    // 空の名前で公開まで進んでしまう。聞いてから通せば、決めてある人に
    // もう一度聞く手間だけで済み、公開ページの投稿者名は空にならない
    void getPublicNickname()
      .catch(() => '')
      .then((name) => {
        if (name) { action(); return }
        pendingRef.current = action
        setVisible(true)
      })
  }, [])

  const savedRef = useRef(onNameSaved)
  savedRef.current = onNameSaved

  const onSaved = useCallback((name: string) => {
    setVisible(false)
    savedRef.current?.(name)
    const action = pendingRef.current
    pendingRef.current = null
    action?.()
  }, [])

  const onCancel = useCallback(() => {
    setVisible(false)
    pendingRef.current = null
  }, [])

  return { run, gateProps: { visible, onSaved, onCancel } }
}
