import React, { useState } from 'react'
import { LayoutAnimation, Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { AppColors, useApp } from '../../context/AppContext'
import { nativePhraseBreakText, phraseBreakText } from '../../utils/phraseBreak'

interface Props {
  text: string
  lang: 'ja' | 'en'
  colors: AppColors
  style?: StyleProp<ViewStyle>
}

const COLLAPSED_LINES = 2

// 本文（14）だとデスク名の次に目立ち、写真と用途より先に読まれる。上部の補足として 13 に落とす。
// 書く欄も同じ字の大きさにする。詳細では文節に合わせるため、自動改行の位置は入力中と異なる。
export const DESK_DESCRIPTION_TEXT = { fontSize: 13, lineHeight: 18 } as const
/** 書く欄の左右の内側の余白。枠（1）と合わせた幅を、詳細の右側でも空けて折り返し幅を揃える */
export const DESK_DESCRIPTION_INPUT_PADDING = 14

// デスクのひとこと。マイデスク（WiringResultScreen）と他人のデスク（PublicDeskScreen）の
// 上部で同じ見え方にするため、畳み方はここにだけ置く
export function DeskDescription({ text, lang, colors, style }: Props) {
  const { reduceMotion } = useApp()
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ja = lang === 'ja'
  const displayText = ja ? (Platform.OS === 'web' ? phraseBreakText(text) : nativePhraseBreakText(text)) : text
  const phraseStyle = ja && Platform.OS === 'web' ? { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as unknown as import('react-native').TextStyle : undefined

  return (
    <View style={style}>
      {/* 畳むかどうかは全文の行数で決める。numberOfLines を付けた本体の onTextLayout は、
          切る前と後のどちらの行を返すかが iOS と Android で揃わないので、見えない複製で数える */}
      <Text
        style={[styles.text, styles.measure, phraseStyle]}
        textBreakStrategy="simple"
        onTextLayout={(e) => setOverflows(e.nativeEvent.lines.length > COLLAPSED_LINES)}
        pointerEvents="none"
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {displayText}
      </Text>
      <Pressable
        disabled={!overflows}
        onPress={(event) => {
          event.stopPropagation()
          if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
          setExpanded((value) => !value)
        }}
        accessibilityRole={overflows ? 'button' : 'text'}
        accessibilityState={overflows ? { expanded } : undefined}
        accessibilityHint={overflows
          ? (expanded
              ? (ja ? '2行に畳みます' : 'Collapses to two lines')
              : (ja ? '全文を表示します' : 'Shows the full text'))
          : undefined}
      >
        <Text
          style={[styles.text, phraseStyle, { color: colors.text }]}
          accessibilityLabel={text}
          textBreakStrategy="simple"
          numberOfLines={expanded ? undefined : COLLAPSED_LINES}
        >
          {displayText}
        </Text>
        {/* 2行目の右端に重ねる。下に1行足すと、畳んだ状態でも3行ぶんの高さを取る。
            地の色で塗って、下に隠れる2行目の末尾と省略記号を消す */}
        {overflows && !expanded && (
          <Text style={[styles.text, styles.moreOverlay, { backgroundColor: colors.card, color: colors.text }]}>
            {'… '}
            <Text style={[styles.toggle, { color: colors.accentText }]}>{ja ? '続きを読む' : 'Read more'}</Text>
          </Text>
        )}
        {overflows && expanded && (
          <Text style={[styles.text, styles.toggle, styles.lessToggle, { color: colors.accentText }]}>
            {ja ? '閉じる' : 'Show less'}
          </Text>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  text: DESK_DESCRIPTION_TEXT,
  measure: { position: 'absolute', left: 0, right: 0, opacity: 0 },
  moreOverlay: { position: 'absolute', right: 0, bottom: 0, paddingLeft: 4 },
  toggle: { fontWeight: '600' },
  lessToggle: { alignSelf: 'flex-end', marginTop: 2 },
})
