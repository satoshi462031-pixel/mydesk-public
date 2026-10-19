import { Alert } from './alert'

// ─── ゲストがアカウント固有の機能に触れたとき ────────────────────
//
// デスク作成・配線図・写真は端末内で完結するのでログイン不要。サーバーに残る
// 操作（公開・ブックマーク・購入）だけがアカウントを要る。
// ここで知らせるだけにすると、ゲストは公開したい瞬間に行き止まりになるので、
// その場からログイン画面へ送る。戻ってきたら元の画面で続きができる。

/** ログイン画面を開く。`navigation: any` の理由は promptLogin と同じ */
export function openLoginScreen(navigation: any, mode: 'signin' | 'signup'): void {
  navigation.navigate('Login', { mode })
}

/**
 * **`navigation: any` はここでは意図的。** Login はルートスタックにあり、
 * どの子スタック（Plan / Feed / MyPage）の ParamList にも載っていない。
 * 子からの navigate('Login') は親へ伝播して動くが、子の navigation の型は
 * 自分の ParamList のキーしか受け付けないので、正しい型では表現できない。
 * `{ navigate: (name: string) => void }` のような構造型も、React Navigation の
 * navigate がオーバーロードで定義されているため代入できない（試して確認済み）。
 *
 * 型を付け直すなら、ここではなく「同じ画面を複数のスタックに登録している」
 * ナビゲーター側の構成から直す必要がある。
 *
 * @param navigation 現在の画面の navigation
 * @param openLogin ログイン画面の開き方。モーダル（Paywall）やシート（RN の Modal）の中から
 *   呼ぶときに渡す。そのまま navigate するとログイン画面がモーダルの裏に積まれ、押しても何も起きない
 */
export function promptLogin(
  navigation: any,
  lang: 'ja' | 'en',
  message: string,
  openLogin: (mode: 'signin' | 'signup') => void = (mode) => openLoginScreen(navigation, mode),
): void {
  const ja = lang === 'ja'
  const title = ja ? 'ログインが必要です' : 'Login required'
  // アカウントが無い人もここから作るので、ログインと新規登録を別の行き先にする
  Alert.alert(title, message, [
    { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
    { text: ja ? 'ログイン' : 'Sign in', onPress: () => openLogin('signin') },
    { text: ja ? '新規登録' : 'Sign up', onPress: () => openLogin('signup') },
  ])
}
