// ─── 写真1枚の全画面表示 ──────────────────────────────────────────
//
// デスクの写真は横に流せるカルーセルで見せるが（WiringResultScreen /
// PublicDeskScreen）、アイコンのように1枚しかないものにカルーセルは要らない。
// 操作は揃える：ピンチとダブルタップで拡大、閉じるのは右上の×。
// 1本指タップで閉じないのは PinchZoomImage が iOS の写真アプリに合わせているため。
import { useState } from 'react'
import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { PinchZoomImage } from '../atoms/PinchZoomImage'
import { ICONS } from '../../constants/icons'

interface Props {
  /** null なら閉じている。URI を渡すと開く */
  uri: string | null
  lang: 'ja' | 'en'
  onClose: () => void
  /** 何の写真かを読み上げる。既定は「写真」 */
  label?: string
}

export function PhotoViewerModal({ uri, lang, onClose, label }: Props) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const ja = lang === 'ja'
  const [photo, setPhoto] = useState({ uri, open: !!uri, key: 0 })
  if (photo.open !== !!uri || (uri && photo.uri !== uri)) {
    // uri=null はフェード開始であって終了ではない。写真を外すのは次の写真へ切り替えるとき。
    setPhoto({ uri: uri ?? photo.uri, open: !!uri, key: photo.key + (uri ? 1 : 0) })
  }

  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <IconCircleButton
          name={ICONS.close}
          diameter={44}
          size={22}
          color="#fff"
          background="rgba(0,0,0,0.45)"
          style={[styles.close, { top: insets.top + 12, right: insets.right + 16 }]}
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel={ja ? '写真を閉じる' : 'Close photo'}
        />
        {photo.uri && (
          <PinchZoomImage
            key={photo.key}
            uri={photo.uri}
            width={width}
            height={height}
            active
            lang={lang}
            accessibilityLabel={label ?? (ja ? '写真' : 'Photo')}
            accessibilityHint={ja
              ? 'ダブルタップまたは2本指のピンチ操作で拡大できます。閉じるには右上の閉じるボタンを使います'
              : 'Double tap or pinch to zoom. Use the close button at the top right to close.'}
          />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  // 写真の上に載るので、テーマ色ではなく白で固定する
  // 大きさと形は IconCircleButton が持つ。ここは置き場所だけ
  close: { position: 'absolute', zIndex: 2 },
})
