// ユーザーが入れた文字列を長さで切るときは必ずここを通す。
//
// JS の `slice` は UTF-16 のコード単位で切るので、絵文字（サロゲートペア）の
// 途中で切ると片割れだけが残り、そのまま保存・公開される。表示は `�` になる。
// 実際に「20文字目が絵文字の公開名」「30文字目が絵文字のデスク名のコピー」で起きる。
//
// 数える単位をコードポイントに変えるのは、サーバー側（Postgres の `LEFT(x, n)`）が
// コードポイントで数えるのと揃える意味もある。片方だけ UTF-16 で数えていると、
// 端末とサーバーで切れる位置がずれる。
//
// 書記素クラスタ（Intl.Segmenter）までは見ない。Hermes に載っている保証が無く、
// utf8ByteLength が TextEncoder を避けているのと同じ理由。代わりに、連結子で
// 終わる形だけは避ける（下の TRAILING_JOINERS）。

/**
 * 末尾に残すと絵文字の連結が途中で切れた形になる符号位置。
 * ZWJ（👨‍💻 のつなぎ）と、字形を絵文字/文字に倒す異体字セレクタ。
 */
const TRAILING_JOINERS = new Set(['‍', '️', '︎'])

/**
 * 対になっていないサロゲート1個か。
 *
 * `[...value]` はサロゲートペアを1要素（長さ2の文字列）にまとめるので、
 * **長さ1でサロゲート域** のときだけが壊れた片割れになる。
 * 長さを見ずに範囲だけで判定すると、正しい絵文字まで落ちる。
 */
function isLoneSurrogate(char: string): boolean {
  return char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff
}

/**
 * コードポイント単位で先頭 maxLength 個に切る。絵文字を割らない。
 *
 * @param maxLength 残すコードポイント数。0 以下なら空文字
 */
export function truncateChars(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  const chars = [...value]
  let end = Math.min(chars.length, maxLength)
  // 貼り付けられた時点で壊れている（対の無いサロゲート）ぶんは末尾から落とす。
  // ここを残すと、切っていない短い入力でも `�` が公開ページに出る
  while (end > 0 && isLoneSurrogate(chars[end - 1])) end--
  // 連結子（ZWJ）で終わると、次に来るはずの絵文字が無いまま繋ぎだけが残る。
  // 異体字セレクタは直前に字があれば「❤️」の正しい形なので残す。落とすと、切っていない
  // 短い名前まで保存のたびに絵文字の見た目が文字スタイルに化ける。
  // 直前に字が無い（先頭・連結子やセレクタの直後）ときだけ宙に浮くので落とす
  while (end > 0 && TRAILING_JOINERS.has(chars[end - 1])) {
    const isZwj = chars[end - 1] === '‍'
    const orphaned = end === 1 || TRAILING_JOINERS.has(chars[end - 2])
    if (!isZwj && !orphaned) break
    end--
  }
  if (end === chars.length) return value
  return chars.slice(0, end).join('')
}

/**
 * 両端に付いていても画面に何も出ない文字。`String.prototype.trim()` は空白（全角スペース・
 * BOM を含む）しか落とさず、ゼロ幅スペースや書式制御文字は残す。これだけで作った名前は
 * 「空ではない」と判定されて保存・公開され、画面には何も出ない（投稿者名が空欄の公開デスク、
 * 名前の無いガジェット）。サーバーの CHECK も char_length で数えるので素通りする。
 * 見えない名前に使われやすいハングルの埋め字と点字の空白もここに含める。
 * 落とすのは両端だけ。間に挟まる ZWJ（👨‍💻 のつなぎ）は絵文字の一部なので残す
 */
// 見えない文字はエスケープで書く。直に書くと U+034F（結合文字）が前の文字に付いて一字に見え、
// 範囲が読めない。U+034F は文字クラスに入れると前の文字と組んで解釈されうるので、外の選択肢に置く
const EDGE_INVISIBLE = /^(?:[\s\u00AD\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u2800\u3164\uFFA0]|\u034F)+|(?:[\s\u00AD\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u2800\u3164\uFFA0]|\u034F)+$/g

/** 両端の空白と見えない文字を落とす */
export function trimInvisible(value: string): string {
  return value.replace(EDGE_INVISIBLE, '')
}

/**
 * 1行の欄に入った改行・タブを空白に置き換える。前後の空白は1つにまとめる。
 * 1行の欄でも、貼り付け（Android は改行を残す）で改行が入る。名前に残ると、一覧の1行表示で
 * 改行より後ろが消え、公開ページでは名前の途中で折り返す
 */
export function toSingleLine(value: string): string {
  return /[\r\n\t\u2028\u2029]/.test(value)
    ? value.replace(/[ \t]*[\r\n\u2028\u2029]+[ \t]*/g, ' ').replace(/\t/g, ' ')
    : value
}

/**
 * 複数行の欄の保存形。両端の空白・見えない文字を落とし、行末の空白を消し、
 * 空行が2行以上続くところは1行にまとめる（Enter の押しすぎで、説明やメモの途中に大きな空白が残る）
 */
export function tidyMultilineText(value: string): string {
  return trimInvisible(
    value
      .replace(/\r\n?|\u2028|\u2029/g, '\n')
      .replace(/[ \t\u3000]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  )
}

/** 両端の空白と見えない文字を落としてから切る。入力欄から受けた値はほぼこの形で使う */
export function trimAndTruncate(value: string, maxLength: number): string {
  return truncateChars(trimInvisible(value), maxLength)
}

/**
 * 入力欄に渡す maxLength。値がすでに上限を超えているときは外す。
 *
 * iOS は「上限 − 今の長さ + 置き換える範囲」が 0 以下の変更を丸ごと拒む
 * （RCTTextInputComponentView の textInputShouldChangeText）。JS から上限を超えた値を
 * 流し込んだ欄は、1文字の入力も Backspace も効かず固まる。上限を入れる前（55ce31e）に
 * 保存した長い商品名・メモを開くとこれになる。超えている間の切り詰めは呼び出し側の
 * onChangeText（truncateChars）と保存時に任せる。長さは iOS と同じく UTF-16 で数える
 */
export function inputMaxLength(value: string | undefined, maxLength: number | undefined): number | undefined {
  if (maxLength == null) return undefined
  return (value?.length ?? 0) > maxLength ? undefined : maxLength
}
