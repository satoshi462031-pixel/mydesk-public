import { useEffect, useRef, useState } from 'react'
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { UI_METRICS } from '../../constants/ui'
import { RemoteThumb } from '../atoms/RemoteThumb'
import { AppIcon } from '../atoms/AppIcon'
import { AdditionMotion } from './AdditionMotion'
import { clampPhotoIndex, photoIndexFromOffset } from '../../utils/photoCarousel'

interface DeskPhotoCarouselProps {
  photos: string[]
  activeIndex: number
  onIndexChange: (index: number) => void
  onOpen: (index: number) => void
  lang: 'ja' | 'en'
  backgroundColor: string
  addedPhotos?: ReadonlySet<string>
  onPhotoEntered?: (uri: string) => void
  motionActive?: boolean
}

export function DeskPhotoCarousel({
  photos,
  activeIndex,
  onIndexChange,
  onOpen,
  lang,
  backgroundColor,
  addedPhotos,
  onPhotoEntered,
  motionActive = true,
}: DeskPhotoCarouselProps) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const { width, height } = viewport
  const scrollRef = useRef<ScrollView>(null)
  const safeIndex = clampPhotoIndex(activeIndex, photos.length)
  // 自分のスワイプで親へ伝えた番号。親（デスク画面）の再描画を待つ間に次のスワイプを
  // 始めていると、戻ってきた番号で scrollTo し直したときに指の下で前の写真へ引き戻される
  const swipedIndexRef = useRef<number | null>(null)

  const handleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout
    if (!(next.width > 0) || !(next.height > 0)) return
    setViewport((prev) => (
      Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5
        ? prev
        : { width: next.width, height: next.height }
    ))
  }

  useEffect(() => {
    if (safeIndex !== activeIndex) onIndexChange(safeIndex)
  }, [activeIndex, onIndexChange, safeIndex])

  useEffect(() => {
    if (!(width > 0)) return
    const swiped = swipedIndexRef.current === safeIndex
    swipedIndexRef.current = null
    if (swiped) return
    scrollRef.current?.scrollTo({ x: safeIndex * width, animated: false })
  }, [safeIndex, width])

  const finishSwipe = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = photoIndexFromOffset(event.nativeEvent.contentOffset.x, width, photos.length)
    if (index === activeIndex) return
    swipedIndexRef.current = index
    onIndexChange(index)
  }

  if (photos.length === 0) return null

  return (
    <View style={[styles.wrap, { backgroundColor }]} onLayout={handleLayout}>
      {width > 0 && height > 0 && <ScrollView
        ref={scrollRef}
        style={StyleSheet.absoluteFill}
        horizontal
        pagingEnabled
        bounces={photos.length > 1}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={finishSwipe}
        scrollEventThrottle={16}
      >
        {photos.map((uri, index) => (
          <TouchableOpacity
            key={`${uri}:${index}`}
            style={{ width, height }}
            activeOpacity={0.96}
            onPress={(event) => {
              event.stopPropagation()
              onOpen(index)
            }}
            accessibilityRole="button"
            accessibilityLabel={lang === 'ja' ? `${index + 1}枚目の写真` : `Photo ${index + 1}`}
            accessibilityHint={lang === 'ja'
              ? '左右にスワイプして写真を切り替え、タップすると全画面で表示します'
              : 'Swipe left or right to change photos, or tap to view full screen'}
          >
            <AdditionMotion added={addedPhotos?.has(uri) ?? false} active={motionActive && index === safeIndex} onEntered={() => onPhotoEntered?.(uri)} reflow={false} style={styles.photo} contentStyle={styles.photo}>
            <RemoteThumb
              uri={uri}
              variant="medium"
              style={styles.photo}
              fallbackLabel={lang === 'ja' ? '写真を読み込めません' : 'Photo unavailable'}
            />
            </AdditionMotion>
          </TouchableOpacity>
        ))}
      </ScrollView>}

      <View style={styles.expandHint} pointerEvents="none">
        <AppIcon name="arrow-expand" size={14} color="#fff" />
        <Text style={styles.counterText}>{lang === 'ja' ? '拡大' : 'Expand'}</Text>
      </View>

      {photos.length > 1 && (
        <>
          <View style={styles.counter} pointerEvents="none">
            <Text style={styles.counterText}>{safeIndex + 1} / {photos.length}</Text>
          </View>
          <View style={styles.dots} pointerEvents="none">
            {photos.map((uri, index) => (
              <View key={`${uri}:${index}`} style={[styles.dot, index === safeIndex && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 16 / 9, position: 'relative', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  counter: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: UI_METRICS.pillRadius,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counterText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  expandHint: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: UI_METRICS.pillRadius, backgroundColor: 'rgba(0,0,0,0.55)' },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { width: 16, backgroundColor: '#fff' },
})
