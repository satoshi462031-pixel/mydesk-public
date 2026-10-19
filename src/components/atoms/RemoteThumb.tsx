import { useState } from 'react'
import { Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import { useApp } from '../../context/AppContext'
import { getMediumUrl, getThumbUrl } from '../../services/storage'
import { AppIcon } from './AppIcon'

// ─── 公開デスク写真のサムネイル表示 ────────────────────────────────
// 公開時に長辺400pxのサムネイルも一緒にアップロードしているので、一覧や
// 写真ストリップのような小さい枠ではそちらを読む。フルサイズは長辺1920pxあり、
// 一覧に何枚も並べると転送量・デコード時間がそのまま体感速度に効く。
//
// サムネイルが存在しない写真（サムネイル生成を入れる前に公開されたデスク）は
// 404 になるため、onError でフルサイズへ落として空欄にならないようにする。
//
// variant="medium" は画面幅いっぱいの枠（一覧の1列のタイル）用で、長辺1200を読む。
// 中サイズを入れる前の写真には無いので、公開写真はフルサイズへ、手元の写真（マスタが
// 長辺3840）はサムネイルへ落とす。手元の写真も同じ名前の付け方（planImages）なので
// 1つの部品で両方を扱える。

// 読めなかった URL はモジュールで覚える。部品の state に持っていた頃は、一覧を
// 勢いよくスクロールして行き来するたびに仮想化で再マウントされ、古い写真ほど
// 「404 を待ってからフルサイズを取り直す」を毎回繰り返して白いタイルが続いた
const missingSources = new Set<string>()

export function RemoteThumb({
  uri,
  style,
  resizeMode = 'cover',
  variant = 'thumb',
  fallbackLabel,
}: {
  uri: string
  style?: StyleProp<ImageStyle>
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center'
  variant?: 'thumb' | 'medium'
  fallbackLabel?: string
}) {
  const { colors: C } = useApp()
  const [, setMissingVersion] = useState(0)
  const [failedFinalUri, setFailedFinalUri] = useState<string | null>(null)
  const thumbUri = getThumbUrl(uri)
  // 読む順。getThumbUrl / getMediumUrl は .jpg 以外の URL をそのまま返すので、その場合は本体しかない
  const candidates = variant === 'medium'
    ? [getMediumUrl(uri), /^https?:/.test(uri) ? uri : thumbUri, uri]
    : [thumbUri, uri]
  const sources = candidates.filter((c, i) => candidates.indexOf(c) === i)
  const last = sources[sources.length - 1]
  const source = sources.find((s) => !missingSources.has(s)) ?? last

  if (failedFinalUri === uri) {
    return (
      <View
        style={[style as StyleProp<ViewStyle>, styles.unavailable, { backgroundColor: C.chip }]}
        accessible={!!fallbackLabel}
        accessibilityRole="image"
        accessibilityLabel={fallbackLabel}
      >
        <AppIcon name="image-off-outline" size={28} color={C.textMuted} />
      </View>
    )
  }

  return (
    <Image
      source={{ uri: source }}
      style={style}
      resizeMode={resizeMode}
      onError={() => {
        if (source === last) {
          setFailedFinalUri(uri)
          return
        }
        missingSources.add(source)
        setMissingVersion((v) => v + 1)
      }}
    />
  )
}

const styles = StyleSheet.create({
  unavailable: { alignItems: 'center', justifyContent: 'center' },
})
