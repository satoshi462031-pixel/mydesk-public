/**
 * 上部の収納（写真・概要をタブの一覧に合わせて畳む）を、画面に書き直していないかを検査する。
 * `npm run audit:collapsible-header`
 *
 * 2026-09 に、デスク詳細（PublicDeskScreen）と自分のデスク（WiringResultScreen）で次が起きた。
 *   - 下のはみ出しを切る枠を片方の画面にだけ足し、枠の中で中身を上へずらしたので上端まで切られた
 *     （写真が透ける・空白の帯・一覧の先頭が隠れる）
 *   - 一覧末尾の余白も片方にだけ足し、もう片方では短い一覧の末尾に届かなかった
 *   - 未コミットのまま別の作りへ2度書き換えられ、高さを毎フレーム動かす方式でガタついた
 *   - 作り直した一覧への位置戻しを setTimeout(0) で1回だけ呼び、届かないまま上部が畳まれた
 * どれも「同じ処理を2画面に手で書き、同一に保つようコメントで頼んでいた」ことから来ている。
 * 仕組みは hooks/useCollapsibleHeader と molecules/CollapsibleTabContent の1か所に置き、
 * 画面側に同じものを書き直していないかをここで止める。見た目は実機でしか確かめられない。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// AUDIT_ROOT は、過去の版（git archive で書き出した src）にこの検査が効くかを確かめるときだけ使う
const ROOT = process.env.AUDIT_ROOT ?? join(__dirname, '..')
const SRC = join(ROOT, 'src')
const SCREENS = ['PublicDeskScreen.tsx', 'WiringResultScreen.tsx'].map((name) => join(SRC, 'screens', name))
// 仕組みそのものを持つファイル。ここだけは収納の実装語を含んでよい
const OWNERS = new Set([
  join(SRC, 'hooks', 'useCollapsibleHeader.ts'),
  join(SRC, 'components', 'molecules', 'CollapsibleTabContent.tsx'),
  join(SRC, 'utils', 'collapsibleHeader.ts'),
])

const problems: string[] = []

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** `<Tag` から、同じ字下げで閉じる `>` / `/>` までの属性部分を切り出す（このリポジトリの整形に合わせた読み方） */
function elementProps(source: string, tag: string): Array<{ text: string; line: number }> {
  const found: Array<{ text: string; line: number }> = []
  const opener = new RegExp(`^([ \\t]*)<${tag}\\b`, 'gm')
  for (let m = opener.exec(source); m; m = opener.exec(source)) {
    const indent = m[1]
    const rest = source.slice(m.index)
    const sameLine = rest.split('\n')[0]
    let end: number
    if (/\/?>\s*$/.test(sameLine) && !/=>\s*$/.test(sameLine)) {
      end = sameLine.length
    } else {
      const close = new RegExp(`\\n${indent}\\/?>`).exec(rest)
      end = close ? close.index + close[0].length : sameLine.length
    }
    found.push({ text: rest.slice(0, end), line: lineOf(source, m.index) })
  }
  return found
}

// 1) 2画面は共通の仕組みを使う
for (const file of SCREENS) {
  const source = readFileSync(file, 'utf8')
  const name = relative(ROOT, file)
  if (!/\buseCollapsibleHeader\(/.test(source)) problems.push(`${name}: useCollapsibleHeader を使っていない`)
  if (!/<CollapsibleTabContent\b/.test(source)) problems.push(`${name}: タブの中身を <CollapsibleTabContent> で包んでいない`)
  if (!/<GestureDetector gesture=\{[^}]*headerPan\}/.test(source)) {
    problems.push(`${name}: 上部を headerPan の GestureDetector で包んでいない（上部から縦に動かしても一覧が動かない）`)
  }
  if (!/style=\{\[[^\]]*headerContainerStyle[^\]]*\]\}/.test(source)
    || !/style=\{\[[^\]]*headerParallaxStyle[^\]]*\]\}/.test(source)) {
    problems.push(`${name}: 上部の切り取り枠とパララックスの共通スタイルが無い`)
  }
  if (!/<Reanimated\.View style=\{listContentStyle\}>/.test(source)) {
    problems.push(`${name}: 一覧の中身に listContentStyle が無い（収納中に指より速く流れる）`)
  }

  // 2) 一覧の下端に収納量ぶんの余白を足す。片方の画面にだけ足していた。
  //    書き方（Reanimated / Animated / 素の ScrollView）ではなく、収納のスクロールハンドラに
  //    つながっている一覧かで見る（写真プレビューや共有シートの ScrollView は対象外）
  for (const el of elementProps(source, '(?:Reanimated\\.|Animated\\.)?ScrollView')) {
    if (!/onScroll=\{handle(?:Gadget|Info)Scroll\}/.test(el.text)) continue
    if (!/listBottomInset/.test(el.text)) {
      problems.push(`${name}:${el.line} 一覧に listBottomInset の余白が無い（短い一覧で末尾に届かない）`)
    }
    if (!/listContentMinHeight/.test(el.text)) {
      problems.push(`${name}:${el.line} 一覧に listContentMinHeight が無い（短い一覧で畳んだ直後に開き直す）`)
    }
  }
  for (const el of elementProps(source, 'GadgetStatsPanel')) {
    if (!/contentShiftStyle=\{listContentStyle\}/.test(el.text)) {
      problems.push(`${name}:${el.line} GadgetStatsPanel に contentShiftStyle={listContentStyle} が無い`)
    }
    if (!/contentBottomInset=\{[^}]*listBottomInset/.test(el.text)) {
      problems.push(`${name}:${el.line} GadgetStatsPanel に contentBottomInset={…listBottomInset} が無い`)
    }
    if (!/contentMinHeight=\{listContentMinHeight\}/.test(el.text)) {
      problems.push(`${name}:${el.line} GadgetStatsPanel に contentMinHeight={listContentMinHeight} が無い（短い一覧で畳んだ直後に開き直す）`)
    }
  }

  // 3) 位置戻しをタイマー任せにしない（高さが決まる前の scrollTo は届かない）
  // セミコロンを書かない流儀なので、範囲を文字数で区切らないと遠く離れた scrollTo まで拾う
  const timerRestore = /setTimeout\([^;]{0,300}?scrollTo\(/gs
  for (let m = timerRestore.exec(source); m; m = timerRestore.exec(source)) {
    problems.push(`${name}:${lineOf(source, m.index)} setTimeout で一覧の位置を戻している（useCollapsibleHeader に任せる）`)
  }
}

// 4) 収納の実装を画面や部品に書き直していない
const REIMPLEMENTATION: Array<[RegExp, string]> = [
  [/\bheaderOverride\b/, '明示操作の目標（headerOverride）を独自に持っている'],
  [/\bsyncHeaderForScroll\b/, 'スクロール追従（syncHeaderForScroll）を独自に書いている'],
  [/translateY:\s*-?\s*headerY\b/, '上部のずらし（translateY: headerY）を独自に書いている'],
  [/Animated\.subtract\(\s*collapseH|height:\s*collapseH\b/, '収納を高さで表している（毎フレームのレイアウト引き直しでガタつく）'],
  [/\bcontentClip\b/, '切り取り枠を独自に置いている（上端まで切って写真が透ける）'],
  [/marginTop:\s*-collapseH/, '切り取り枠の上端延長を独自に書いている'],
]
for (const file of walk(SRC)) {
  if (OWNERS.has(file)) continue
  const source = readFileSync(file, 'utf8')
  for (const [pattern, message] of REIMPLEMENTATION) {
    const m = pattern.exec(source)
    if (m) problems.push(`${relative(ROOT, file)}:${lineOf(source, m.index)} ${message}`)
  }
}

// 5) 並べた写真の拡大は表示中の1枚だけ有効にする。全枚に同じ active を渡すと、拡大したまま
//    別の写真へ飛んだとき拡大が解けず、閉じるまで左右にめくれなくなる（1枚だけのビューアは例外）
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8')
  for (const el of elementProps(source, 'PinchZoomImage')) {
    const active = /\bactive=\{([^}]*)\}/.exec(el.text)
    if (!active) continue
    if (!/===/.test(active[1])) {
      problems.push(`${relative(ROOT, file)}:${el.line} PinchZoomImage の active が表示中の1枚に絞られていない（index === visibleIndex を含める）`)
    }
  }
}

if (problems.length > 0) {
  console.error('上部の収納の監査で問題が見つかった:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('上部の収納: 問題なし')
