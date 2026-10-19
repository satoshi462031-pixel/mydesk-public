import React, { useEffect, useRef } from 'react'
import { ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppIcon } from '../atoms/AppIcon'
import { RemoteThumb } from '../atoms/RemoteThumb'
import { ICONS, MCIconName } from '../../constants/icons'

// ─── 全画面プレビュー下部のサムネ列（写真アプリと同じ形）────────────────
// ドットは「何枚あるか」しか分からず、めくらないと次が何か分からない。
// サムネを並べると、開いたまま目的の1枚へ直接飛べる。

const ITEM = 44
const GAP = 6
const PAD = 16

export interface FilmstripItem {
  key: string
  /** 写真。持たないものはアイコンで代替する（写真上限の案内スライドなど） */
  uri?: string
  icon?: MCIconName
  tint?: string
}

interface Props {
  items: FilmstripItem[]
  activeIndex: number
  onSelect: (index: number) => void
  /** 読み上げ用。番号だけでは何を選ぶのか分からないため呼び元で組み立てる */
  labelOf: (index: number) => string
}

export function PhotoFilmstrip({ items, activeIndex, onSelect, labelOf }: Props) {
  const { width: screenWidth } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const viewportWidth = screenWidth - insets.left - insets.right
  const scrollRef = useRef<ScrollView>(null)
  const offsetRef = useRef(0)

  // 選んだサムネが見えていないときだけ、可視範囲の中央へ寄せる。
  // 写真はめくっている途中で半分を越えるたびに番号が変わるので、常に寄せていた頃は
  // 指を離す前に列が流れ、指を戻すと列も行って戻っていた。
  // 列が画面に収まっているときは contentContainerStyle 側で中央寄せになり、全部見えているので動かない
  useEffect(() => {
    const left = PAD + activeIndex * (ITEM + GAP)
    const offset = offsetRef.current
    if (left >= offset + PAD && left + ITEM <= offset + viewportWidth - PAD) return
    // 画面幅の半分から戻す。固定値で寄せると、幅の違う端末では中央に来ない
    scrollRef.current?.scrollTo({
      x: Math.max(0, left + ITEM / 2 - viewportWidth / 2),
      animated: true,
    })
  }, [activeIndex, viewportWidth])

  if (items.length < 2) return null

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 12, left: insets.left, right: insets.right }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.x }}
        scrollEventThrottle={16}
      >
        {items.map((item, index) => {
          const active = index === activeIndex
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.cell, active ? styles.cellActive : styles.cellIdle]}
              onPress={() => onSelect(index)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={labelOf(index)}
              accessibilityState={{ selected: active }}
            >
              {item.uri
                ? <RemoteThumb uri={item.uri} style={styles.thumb} />
                : (
                  <View style={styles.iconCell}>
                    <AppIcon name={item.icon ?? ICONS.image} size={20} color={item.tint ?? '#fff'} />
                  </View>
                )}
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', height: ITEM + 8 },
  // 収まるときは中央寄せ、溢れたらそのままスクロールさせる
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: GAP, paddingHorizontal: PAD },
  cell: { width: ITEM, height: ITEM, borderRadius: 5, overflow: 'hidden', borderWidth: 2 },
  // 選択中だけ縁を白く強調する。並びが動くと目的のサムネを見失うので大きさは変えない
  cellActive: { borderColor: '#fff', opacity: 1 },
  cellIdle: { borderColor: 'transparent', opacity: 0.5 },
  thumb: { width: '100%', height: '100%' },
  iconCell: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
})
