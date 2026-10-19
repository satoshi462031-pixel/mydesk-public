import { sanitizeDigitsInput } from './numericInput'

/**
 * 日付の表示・入力フォーマット。
 *
 * 保存は常に YYYY-MM-DD のまま（既存データ・タイムライン・Supabase と互換）で、
 * 画面に出す並びだけを言語に合わせる。英語UIで YYYY/MM/DD を出すと、
 * 12/01 のような日付を月日の順で読み違える。
 */

/** 入力欄のプレースホルダー */
export function datePlaceholder(lang: 'ja' | 'en', now = new Date()): string {
  return formatDate(now, lang)
}

/** エラーメッセージなどで示す書式名 */
export function dateFormatHint(lang: 'ja' | 'en'): string {
  return lang === 'en' ? 'MM/DD/YYYY' : 'YYYY/MM/DD'
}

/** 入力途中の文字列を書式へ整形する。IME の全角数字と変換結果はここで落ちる */
export function formatDateInput(text: string, lang: 'ja' | 'en'): string {
  const digits = sanitizeDigitsInput(text).slice(0, 8)
  if (lang === 'en') {
    if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`
    if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`
    return digits
  }
  if (digits.length > 6) return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)}`
  if (digits.length > 4) return `${digits.slice(0, 4)}/${digits.slice(4)}`
  return digits
}

function isRealDate(y: number, mo: number, d: number): boolean {
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]
}

/** 入力欄の文字列 → 保存形式 YYYY-MM-DD。実在しない日付なら undefined */
export function parseDateInput(raw: string, lang: 'ja' | 'en'): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const parts = trimmed.split(/[/\-.]/)
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return undefined
  const [a, b, c] = parts.map((p) => parseInt(p, 10))
  // 英語UIでも、4桁が先頭にある入力は YYYY/MM/DD として受ける（貼り付け・旧データ対策）
  const [y, mo, d] = lang === 'en' && parts[0].length <= 2 ? [c, a, b] : [a, b, c]
  if (parts[lang === 'en' && parts[0].length <= 2 ? 2 : 0].length !== 4) return undefined
  if (!isRealDate(y, mo, d)) return undefined
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * 保存値（YYYY-MM-DD / YYYY-MM）→ **端末のローカル暦日**の Date。無効値は null。
 *
 * `new Date('2026-09-12')` を使わないこと。日付だけの文字列は仕様で UTC 00:00 と
 * 解釈されるので、UTC より西の端末ではローカル時刻が前日になる。日付ピッカーの
 * 初期値をそれで作っていたため、購入日を編集しようと開くだけで前日が選ばれ、
 * 確定すると保存値が1日巻き戻っていた（日本では起きず、アメリカでだけ起きる）。
 *
 * 日だけを省いた `YYYY-MM` は 1 日として扱う（統計の月次集計が渡す）。
 */
export function parseLocalDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const match = raw.trim().match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3] ?? 1)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

/** Date → 入力欄・一覧の表示文字列 */
export function formatDate(date: Date, lang: 'ja' | 'en'): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return lang === 'en' ? `${m}/${d}/${y}` : `${y}/${m}/${d}`
}

/** 保存値（YYYY-MM-DD / YYYY/MM/DD / ISO 日時）→ 表示文字列。無効値は空文字 */
export function formatStoredDate(stored: string | null | undefined, lang: 'ja' | 'en'): string {
  const s = stored?.trim()
  if (!s) return ''
  const m = s.replace(/\//g, '-').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const [, y, mo, d] = m
  return lang === 'en' ? `${mo}/${d}/${y}` : `${y}/${mo}/${d}`
}

/** ISO日時をカレンダー日単位の相対表示へ変換する。DSTや0時跨ぎの影響を受けない。 */
export function formatRelativeDay(
  iso: string,
  lang: 'ja' | 'en',
  now = new Date(),
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const dayNumber = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  const diff = Math.max(0, Math.round((dayNumber(now) - dayNumber(date)) / 86_400_000))
  if (lang === 'en') {
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Yesterday'
    if (diff < 7) return `${diff}d ago`
  } else {
    if (diff === 0) return '今日'
    if (diff === 1) return '昨日'
    if (diff < 7) return `${diff}日前`
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * 一覧のタイルの時刻。YouTube と同じく、いつでも経過で言う（分・時間・日・週・か月・年）。
 * 一覧は更新の新しい順なので、知りたいのは日付そのものより「どれくらい前か」で、
 * 「2026/03/12」のような日付は頭の中で引き算させていた
 */
export function formatListTimestamp(
  iso: string,
  lang: 'ja' | 'en',
  now = new Date(),
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const elapsedMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (elapsedMinutes < 1) return lang === 'en' ? 'Just now' : 'たった今'
  if (elapsedMinutes < 60) return lang === 'en' ? `${elapsedMinutes}m ago` : `${elapsedMinutes}分前`
  if (elapsedMinutes < 24 * 60) {
    const hours = Math.floor(elapsedMinutes / 60)
    return lang === 'en' ? `${hours}h ago` : `${hours}時間前`
  }
  const dayNumber = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  const days = Math.round((dayNumber(now) - dayNumber(date)) / 86_400_000)
  if (days <= 1) return lang === 'en' ? 'Yesterday' : '昨日'
  if (days < 7) return lang === 'en' ? `${days}d ago` : `${days}日前`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return lang === 'en' ? `${weeks}w ago` : `${weeks}週間前`
  }
  // 月はカレンダーで数える（30日割りだと、月末から月初で「1か月前」が1日ずれる）
  let months = (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth()
  if (now.getDate() < date.getDate()) months -= 1
  months = Math.max(1, months)
  if (months < 12) return lang === 'en' ? `${months}mo ago` : `${months}か月前`
  const years = Math.floor(months / 12)
  return lang === 'en' ? `${years}y ago` : `${years}年前`
}
