// 初回に見せる公式デモデスクへ「未読」を出すための記録。開いたら消える。
//
// 061 の更新マークとは別物で、こちらは「この端末でまだ開いていない」ことしか言わない。
// 一緒にしないのは、片方が嘘になるため：デモデスクは更新されていないので
// 「機材更新」と出すのは事実に反し、そういうマークは数回で読み飛ばされるようになる。
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = '@demo_desk_opened'

export async function loadOpenedDemoDesks(): Promise<ReadonlySet<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    // 読めなければ全部未読のまま。バッジが1回多く出るだけで害はない
    return new Set()
  }
}

/**
 * 一覧の控え（開いた集合）を持っていない画面用。読み込んでから足す。
 * 既読は「開いた画面」で書く（一覧側だけに置くと、共有リンクや公開プロフィール
 * から開いた人にはいつまでも未読が残る）
 */
export async function markDemoDeskOpenedById(deskId: string): Promise<void> {
  await markDemoDeskOpened(deskId, await loadOpenedDemoDesks())
}

export async function markDemoDeskOpened(
  deskId: string,
  opened: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  if (opened.has(deskId)) return opened
  const next = new Set(opened).add(deskId)
  await AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {})
  return next
}
