import { Image, StyleSheet, View } from 'react-native'
import { useApp } from '../../context/AppContext'

interface Props {
  onImageReady?: () => void
}

// 初期化中はネイティブスプラッシュと同じ地だけを出す。
// 配線演出の最後にアイコンが出るよう、ここでは画像を非表示で先に読み込む。
export function BrandSplash({ onImageReady }: Props) {
  const { colors } = useApp()
  return (
    <View style={[styles.container, { backgroundColor: colors.bgList }]}>
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Image
            source={require('../../../assets/brand-mark.png')}
            style={styles.icon}
            fadeDuration={0}
            onLoadEnd={onImageReady}
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inner: { alignItems: 'center' },
  iconWrap: {
    width: 152,
    height: 152,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: 152, height: 152, opacity: 0 },
})
