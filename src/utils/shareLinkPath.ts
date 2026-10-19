import { decodeDeskId, isShortDeskId, isUuid } from './shortDeskId'
import { isPublicTagSegment } from '../constants/siteRoutes'

// ─── 共有リンクのパスを画面のパスへ均す ─────────────────────────────
//
// 外から来る形は5通りある。
//   /<@ID>/<22文字>      … 現行の共有URL
//   /setup/<22文字>      … 一つ前の共有URL
//   /setup/<uuid> /d/<22文字> /desk/<uuid> … さらに前
//   /<@ID>               … プロフィール（現行）
//   /u/<@ID>             … プロフィール（一つ前）
// 画面側（linking の screens）は setup/:deskId と u/:tag の2つだけを知っていればよいので、
// ここで全部そこへ寄せる。worker 側の振り分けと対で動く。**片方だけ変えない。**
//
// @ID の段は見るだけで、デスクは2つ目の ID だけで引く（@ID は本人が変えられる）。

/**
 * 外から来たリンクを React Navigation の解析へ渡してよいか。
 *
 * React Navigation 6 のクエリ解析（query-string → decode-uri-component 0.2）は、
 * 壊れた % 列を1つずつ組み替えて読もうとし、`%C0` を1000個並べた3000文字で30秒近く固まる。
 * 全体が decodeURIComponent で読める文字列なら、& や = で割った各部分も必ず読めて
 * その遅い経路に入らないので、全体を一度読めるかだけを見る。
 * React Navigation 7 へ上げれば不要になる（decode-uri-component を使わない）。
 */
export function isParsableLinkPath(path: string): boolean {
  if (path.length > 8192) return false
  try {
    decodeURIComponent(path)
    const query = path.split('#', 1)[0].split('?')[1] ?? ''
    for (const pair of query.split('&')) {
      const key = decodeURIComponent(pair.split('=')[0].replace(/\+/g, ' '))
      // React Navigation はクエリでパスの識別子まで上書きするため、異なるデスクへの誘導を防ぐ。
      if (key === 'deskId' || key === 'tag') return false
    }
    return true
  } catch {
    return false
  }
}

export function isTrustedAppLink(url: string, publicBase: string): boolean {
  if (!isParsableLinkPath(url) || /[\u0000-\u0020\u007f\\]/.test(url)) return false
  return url.startsWith('mydesk://')
    || (url.startsWith(publicBase) && /^(?:$|[/?#])/.test(url.slice(publicBase.length)))
}

/** クエリ・ハッシュを落として段に割る。末尾に付け直すために元の文字列も返す */
function splitPath(path: string): { segments: string[]; suffix: string } {
  const cut = path.search(/[?#]/)
  const head = cut < 0 ? path : path.slice(0, cut)
  return {
    segments: head.split('/').filter(Boolean),
    suffix: cut < 0 ? '' : path.slice(cut),
  }
}

function deskIdOrNull(segment: string): string | null {
  if (isUuid(segment)) return segment
  return isShortDeskId(segment) ? decodeDeskId(segment) : null
}

export function normalizeShareLinkPath(path: string): string {
  const { segments, suffix } = splitPath(path)
  // Web の linking は初期URLを route.path に保持し、その値を history.replaceState へ
  // そのまま渡す。先頭の / を落とすと現在位置からの相対URLになり、
  // /setup/<id> の再読込が /setup/setup/<id> へ増殖する。
  const root = path.startsWith('/') ? '/' : ''

  if (segments.length === 2) {
    const [first, second] = segments
    // 旧形式の段名は @ID として読まない（setup / d / desk / u は SITE_PATH_SEGMENTS にある）
    if (first === 'u') return `${root}u/${second}${suffix}`
    if (first === 'setup' || first === 'd' || first === 'desk') {
      const deskId = deskIdOrNull(second)
      return deskId ? `${root}setup/${deskId}${suffix}` : path
    }
    if (isPublicTagSegment(first)) {
      const deskId = deskIdOrNull(second)
      // ID の形をしていない2段目は共有URLではない。何の画面にも載せずそのまま返す
      return deskId ? `${root}setup/${deskId}${suffix}` : path
    }
    return path
  }

  if (segments.length === 1 && isPublicTagSegment(segments[0])) {
    return `${root}u/${segments[0]}${suffix}`
  }

  return path
}
