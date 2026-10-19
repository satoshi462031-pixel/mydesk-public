// デスクの写真を全画面で見るモーダル。マイデスク（WiringResultScreen）と
// 他人のデスク（PublicDeskScreen）が共用する。
//
// 2画面に手で書いていた頃、隣接1枚だけ載せる制限・拡大中の1枚だけを操作可能にする指定・
// 吸着の幅が片方にだけ入り、「拡大したまま別の写真へ飛ぶとめくれない」「上限まで写真を入れると
// 実寸のデコードがメモリに積み上がる」が画面ごとに別々に起きた。
//
// 持ち主だけに出る「写真の上限の案内」は content で差し込む（Pro への導線は画面が持つ）。
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { PinchZoomImage } from '../atoms/PinchZoomImage'
import { PhotoFilmstrip } from '../molecules/PhotoFilmstrip'
import { AdditionMotion } from '../molecules/AdditionMotion'
import { ICONS, MCIconName } from '../../constants/icons'
import { clampPhotoIndex, photoIndexFromOffset } from '../../utils/photoCarousel'

// 写真どうしの隙間。全画面の写真が隣とくっついていると、めくっている途中で境目が分からない
const PREVIEW_GUTTER = 20
// 下スワイプの手応え。引き量を画面高のこの割合で 0→1 に見立て、縮小・背景・上下の器に効かせる。
// 閉じるのは 80px なので、そこまでで 3 割ほど進む＝「離せば閉じる」より手前で反応が始まる
const DISMISS_TRAVEL_RATIO = 3
const DISMISS_MIN_SCALE = 0.75
const OVERLAY_ALPHA = 0.93
const OVERLAY_MIN_ALPHA = 0.3

export interface DeskPhotoPreviewItem {
  key: string
  /** 写真。content を渡すときは省く */
  uri?: string
  /** 写真の代わりに出す中身（写真の上限の案内） */
  content?: ReactNode
  /** content のときのサムネ列の見え方 */
  thumb?: { icon: MCIconName; tint: string }
}

interface Props {
  items: DeskPhotoPreviewItem[]
  /** 開いているか。null で閉じる */
  openIndex: number | null
  /** 今見ている枚。上部のカルーセルと共有するので画面が持つ */
  visibleIndex: number
  onVisibleIndex: (index: number) => void
  onClose: () => void
  lang: 'ja' | 'en'
  addedPhotos?: ReadonlySet<string>
  onPhotoEntered?: (uri: string) => void
}

export function DeskPhotoPreviewModal({ items, openIndex, visibleIndex, onVisibleIndex, onClose, lang, addedPhotos, onPhotoEntered }: Props) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const pageWidth = width + PREVIEW_GUTTER
  const scrollRef = useRef<ScrollView>(null)
  // 拡大中は横にめくらせない
  const [zoomed, setZoomed] = useState(false)
  const isOpen = openIndex !== null
  const [session, setSession] = useState({ open: isOpen, key: 0 })
  if (session.open !== isOpen) {
    setSession({ open: isOpen, key: session.key + (isOpen ? 1 : 0) })
    if (isOpen) setZoomed(false)
  }
  const ja = lang === 'ja'
  const safeVisibleIndex = clampPhotoIndex(visibleIndex, items.length)
  const photoCount = items.filter(item => item.uri != null).length
  const photoNumber = items.slice(0, safeVisibleIndex + 1).filter(item => item.uri != null).length
  // 下スワイプで引いた量。写真を動かすのはここ（PinchZoomImage 側で動かすと
  // viewport の overflow: hidden に裾を切られる）
  const dismissY = useSharedValue(0)

  useEffect(() => {
    // visible=false でもネイティブのフェード中は写真が見える。初期化は次に開くときだけ行う。
    if (openIndex !== null) dismissY.value = 0
  }, [dismissY, openIndex])

  const dragStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, dismissY.value / (height / DISMISS_TRAVEL_RATIO))
    return {
      transform: [
        { translateY: dismissY.value },
        { scale: 1 - (1 - DISMISS_MIN_SCALE) * progress },
      ],
    }
  })
  // 背景が薄くなって後ろのデスクが透けることで、どこへ戻るのかが引いている途中で分かる
  const overlayStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, dismissY.value / (height / DISMISS_TRAVEL_RATIO))
    return { backgroundColor: `rgba(0,0,0,${OVERLAY_ALPHA - (OVERLAY_ALPHA - OVERLAY_MIN_ALPHA) * progress})` }
  })
  // 閉じるボタンとサムネ列は写真より速く引く。引いている間だけ写真1枚に集中させる
  const chromeStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, dismissY.value / (height / DISMISS_TRAVEL_RATIO))
    return { opacity: Math.max(0, 1 - progress * 2) }
  })

  useEffect(() => {
    if (openIndex !== null && items.length === 0) {
      onClose()
      return
    }
    if (visibleIndex !== safeVisibleIndex) onVisibleIndex(safeVisibleIndex)
  }, [items.length, onClose, onVisibleIndex, openIndex, safeVisibleIndex, visibleIndex])

  const labelOf = (index: number): string => {
    const item = items[index]
    if (item?.uri == null) return ja ? '写真の上限の案内を表示' : 'Show the photo limit notice'
    return ja ? `${index + 1}枚目の写真を表示` : `Show photo ${index + 1}`
  }

  return (
    <Modal visible={openIndex !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Reanimated.View style={[styles.previewOverlay, overlayStyle]}>
        {/* 閉じるボタン */}
        {items[safeVisibleIndex]?.uri != null && (
          <Reanimated.View style={[styles.counter, { top: insets.top + 12, left: insets.left + 16 }, chromeStyle]} pointerEvents="none">
            <Text style={styles.counterText} accessibilityLabel={ja ? `${photoCount}枚中${photoNumber}枚目` : `Photo ${photoNumber} of ${photoCount}`}>
              {photoNumber} / {photoCount}
            </Text>
          </Reanimated.View>
        )}
        <Reanimated.View style={[styles.previewCloseBtn, { top: insets.top + 12, right: insets.right + 16 }, chromeStyle]}>
          <IconCircleButton
            name={ICONS.close}
            diameter={44}
            size={22}
            color="#fff"
            background="rgba(255,255,255,0.15)"
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel={ja ? '写真を閉じる' : 'Close photo'}
            accessibilityHint={ja ? 'デスク詳細画面に戻ります' : 'Returns to the desk details'}
          />
        </Reanimated.View>

        {/* スライド。下スワイプの追従はここごと動かす */}
        <Reanimated.View style={[styles.previewPager, dragStyle]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          // pagingEnabled はスクロールビューの幅ぴったりでしか止まらないので、
          // 隙間のぶんを含めた1ページ幅で吸着させる
          snapToInterval={pageWidth}
          disableIntervalMomentum
          decelerationRate="fast"
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          // 端で止まるだけだと引っ張った指に何も返らない。最後の1枚まで来たことは
          // 跳ね返りで分かる（1枚しかないときは動かす意味がないので殺す）
          bounces={items.length > 1}
          onLayout={() => {
            // 開いた枚ではなく今見ている枚に合わせる。回転などで呼び直されたときに
            // 開いた最初の1枚へ戻さない
            scrollRef.current?.scrollTo({ x: safeVisibleIndex * pageWidth, animated: false })
          }}
          // めくり終わりではなく、めくっている途中で現在位置を更新する。
          // 隣接する1枚しか載せていないので、確定を待つと続けて2枚めくったときに
          // 行き先が未マウントのまま止まり、白いページが出る
          onScroll={(e) => {
            const idx = photoIndexFromOffset(e.nativeEvent.contentOffset.x, pageWidth, items.length)
            if (idx !== safeVisibleIndex) onVisibleIndex(idx)
          }}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {items.map((item, index) => (
            <View key={item.key} style={[styles.previewSlide, { width, height }, index < items.length - 1 && styles.previewSlideGap]}>
              {item.uri == null ? item.content : (
                // 載せるのは表示中と左右1枚だけ。横スクロールの子は画面外でも全部マウントされるので、
                // 上限まで写真を入れると実寸のデコード結果がメモリに積み上がる。
                // 隣は常に載っているので1枚ずつめくるかぎり空かない
                Math.abs(index - safeVisibleIndex) <= 1 && (
                  <AdditionMotion added={addedPhotos?.has(item.uri) ?? false} active={isOpen && index === safeVisibleIndex} onEntered={() => onPhotoEntered?.(item.uri!)} reflow={false}>
                  <PinchZoomImage
                    key={`${session.key}:${item.key}`}
                    uri={item.uri}
                    width={width}
                    height={height}
                    lang={lang}
                    // 表示中の1枚だけを操作可能にする。全枚に同じ値を渡していた頃は、拡大したまま
                    // サムネで別の写真へ飛ぶと拡大が解けず、閉じるまで左右にめくれなくなっていた
                    // （外れた写真は active が落ちた時点で等倍に戻り、拡大中の印も下ろす）
                    // 閉じるフェード中も拡大・位置を保持し、次のセッションの key で初期化する。
                    active={index === safeVisibleIndex}
                    onZoomChange={setZoomed}
                    onPress={onClose}
                    dismissY={dismissY}
                    accessibilityLabel={ja ? `${index + 1}枚目の写真` : `Photo ${index + 1}`}
                    accessibilityHint={ja
                      ? 'ダブルタップまたは2本指のピンチ操作で拡大できます。閉じるには右上の閉じるボタンを使います'
                      : 'Double tap or pinch to zoom. Use the close button at the top right to close.'}
                  />
                  </AdditionMotion>
                )
              )}
            </View>
          ))}
        </ScrollView>
        </Reanimated.View>

        {/* 下部のサムネ列。ドットと違って、開いたまま目的の1枚へ直接飛べる。
            写真を持たない案内はアイコンで並べる */}
        <Reanimated.View style={chromeStyle}>
          <PhotoFilmstrip
            items={items.map((item) => item.uri == null
              ? { key: item.key, icon: item.thumb?.icon ?? 'image-multiple-outline', tint: item.thumb?.tint ?? '#fff' }
              : { key: item.key, uri: item.uri })}
            activeIndex={safeVisibleIndex}
            onSelect={(index) => {
              onVisibleIndex(index)
              scrollRef.current?.scrollTo({ x: index * pageWidth, animated: true })
            }}
            labelOf={labelOf}
          />
        </Reanimated.View>
      </Reanimated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.93)' },
  // 下スワイプで薄くするため Reanimated.View で包む。大きさと形はボタン側が持つ
  previewCloseBtn: { position: 'absolute', zIndex: 10 },
  counter: { position: 'absolute', zIndex: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)' },
  counterText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  previewPager: { flex: 1 },
  previewSlide: { alignItems: 'center', justifyContent: 'center' },
  // 最後の1枚には付けない。付けると末尾に何も無い余白まで送れてしまう
  previewSlideGap: { marginRight: PREVIEW_GUTTER },
})
