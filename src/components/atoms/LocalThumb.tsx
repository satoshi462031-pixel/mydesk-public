import { useState } from 'react'
import { Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import { useApp } from '../../context/AppContext'
import { localThumbUri } from '../../utils/planImages'
import { AppIcon } from './AppIcon'

// ─── 手元の写真のサムネイル表示 ────────────────────────────────────
// 公開デスク側の RemoteThumb と同じ役目をローカルファイルに対して果たす。
//
// React Native の Image はローカルファイルを表示枠に合わせて間引かないので、
// 高さ80の枠に長辺3840の写真を並べると、原寸のデコード結果がそのまま
// メモリに積む。取り込み時に添えた長辺400のサムネイルを読む。
//
// サムネイルが無い写真（この仕組みより前に取り込んだもの、取り込み時に
// 生成に失敗したもの）は onError でマスタへ落として空欄にしない。

export function LocalThumb({
  uri,
  style,
  resizeMode = 'cover',
}: {
  uri: string
  style?: StyleProp<ImageStyle>
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center'
}) {
  const { colors: C } = useApp()
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const [failedFinalUri, setFailedFinalUri] = useState<string | null>(null)
  const thumbUri = localThumbUri(uri)
  // localThumbUri は .jpg 以外の URI をそのまま返すので、その場合はマスタしかない
  const useThumb = thumbUri !== uri && failedUri !== thumbUri

  if (failedFinalUri === uri) {
    return (
      <View style={[style as StyleProp<ViewStyle>, styles.unavailable, { backgroundColor: C.chip }]}>
        <AppIcon name="image-off-outline" size={20} color={C.textMuted} />
      </View>
    )
  }

  return (
    <Image
      source={{ uri: useThumb ? thumbUri : uri }}
      style={style}
      resizeMode={resizeMode}
      onError={() => {
        if (useThumb) setFailedUri(thumbUri)
        else setFailedFinalUri(uri)
      }}
    />
  )
}

const styles = StyleSheet.create({
  unavailable: { alignItems: 'center', justifyContent: 'center' },
})
