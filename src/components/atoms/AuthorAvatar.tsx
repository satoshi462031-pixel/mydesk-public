import { useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Ellipse } from 'react-native-svg'
import { getThumbUrl } from '../../services/storage'
import { isOfficialPublicTag, normalizePublicTag } from '../../utils/publicTag'
import { contrastRatio } from '../../constants/colors'

// ─── 投稿者のアバター ────────────────────────────────────────────────
// 本人が写真を選んでいれば出す（059 で desks へ非正規化した owner_avatar_url）。
// 選んでいなければ名前とタグから組み立てる — 未設定の人のほうが多いので、
// 文字アイコンのほうが既定。写真の読み込みに失敗しても同じ絵に落ちる。
//
// **文字はニックネームの頭文字、色は @tag から引く。**
// タグは 049 で NOT NULL なので、名前を変えても色が動かない
// （名前を種にすると改名のたびに色が変わり、同じ人だと分からなくなる）。
// 060 で @ID は本人が変えられるようになったため、変えれば色も動く。種は大文字に
// 揃えてから引く — 綴りの大小を直しただけで色が変わらないようにする。
// accent 一色にしないのは、accent が「見ている人が選んだテーマ色」だからで、
// 一覧に並ぶ全員が同じ色になって見分けがつかなくなる。

// テーマトークンではなく固定色。見る人のテーマではなく投稿者の識別に使う色で、
// ダークでもライトでも同じ人は同じ色でなければ意味がない
const AVATAR_COLORS = ['#E67E22', '#27AE60', '#2980B9', '#8E44AD', '#C0392B', '#16A085', '#D35400', '#2C3E50']

// ホーム画面のアプリアイコンと同じ絵（app.json の icon）。角丸四角の brand-mark.png は
// 円に切ると四隅の透明が欠けて見えるので、全面塗りのこちらを円に切る
const OFFICIAL_ICON = require('../../../assets/icon.png')

// 頭文字が無い人の絵（Google の既定アイコンと同じ形）。灰色の地に人影を置き、肩を円の下端で切る。
// 色付きの地に記号を置くと、頭文字の丸と並んだときに「何かの機能のボタン」に見えていた。
// 誰のものでもない絵なので、@tag の色ではなく中立の灰色にする
const SILHOUETTE_BG = '#BDC1C6'
const SILHOUETTE_FG = '#F1F3F4'

function seedColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

interface Props {
  name?: string | null
  tag?: string | null
  /** 本人が選んだアイコン。未設定・読み込み失敗なら文字アイコンに落ちる */
  imageUrl?: string | null
  size: number
}

export function AuthorAvatar({ name, tag, imageUrl, size }: Props) {
  // 公式アカウントはアプリと同じマークにする。頭文字の丸だと、一般の投稿者と見分けがつかない。
  // 同梱の画像なので通信を待たず、公式が写真を登録しても上書きされない
  if (isOfficialPublicTag(tag)) {
    return (
      <Image
        source={OFFICIAL_ICON}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        fadeDuration={0}
        accessibilityIgnoresInvertColors
      />
    )
  }
  return <MemberAvatar name={name} tag={tag} imageUrl={imageUrl} size={size} />
}

// フックを持つので、公式の早期 return とは別の部品にする（呼ぶ順を変えない）
function MemberAvatar({ name, tag, imageUrl, size }: Props) {
  const cleanName = name?.trim() ?? ''
  const cleanTag = normalizePublicTag(tag)
  // 名前が未設定ならタグの頭文字。ただし自動で振られるタグ（46729D など）は数字で始まることがあり、
  // 円に数字1文字だと件数や順位に読まれるので、文字で始まらないときは人影の絵にする
  const tagInitial = cleanTag.charAt(0).toUpperCase()
  const initial = cleanName.charAt(0) || (/[A-Z]/.test(tagInitial) ? tagInitial : '')
  const backgroundColor = initial ? seedColor((cleanTag || cleanName || 'mydesk').toUpperCase()) : SILHOUETTE_BG
  const initialColor = contrastRatio('#FFFFFF', backgroundColor) >= 4.5 ? '#FFFFFF' : '#000000'
  // 読み込みに失敗した URL を覚えておく。毎回描画のたびに取りに行かせない
  const [failed, setFailed] = useState<string[]>([])

  // 出るのは最大 88pt の円なので、全画面用の本体（長辺1280）ではなく
  // サムネ（長辺320）を読む。落ち方は3段：サムネ → 本体 → 文字アイコン。
  // 本体まで見るのは、サムネを入れる前に登録されたアイコンが 404 になるため
  const thumbUrl = imageUrl ? getThumbUrl(imageUrl) : null
  const photo = !imageUrl
    ? null
    : thumbUrl && thumbUrl !== imageUrl && !failed.includes(thumbUrl)
      ? thumbUrl
      : !failed.includes(imageUrl)
        ? imageUrl
        : null

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
        },
      ]}
    >
      {initial
        ? <Text style={[styles.text, { color: initialColor, fontSize: Math.round(size * 0.42) }]}>{initial}</Text>
        : (
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Circle cx={50} cy={39} r={19} fill={SILHOUETTE_FG} />
            <Ellipse cx={50} cy={100} rx={37} ry={31} fill={SILHOUETTE_FG} />
          </Svg>
        )}
      {photo && (
        <Image
          source={{ uri: photo }}
          style={[StyleSheet.absoluteFill, { width: size, height: size, borderRadius: size / 2 }]}
          fadeDuration={0}
          onError={() => setFailed((prev) => prev.includes(photo) ? prev : [...prev, photo])}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // 人影の肩を円で切るので overflow を隠す
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  text: { fontWeight: '700' },
})
