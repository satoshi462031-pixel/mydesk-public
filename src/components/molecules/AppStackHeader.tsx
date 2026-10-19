import { useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Header, getHeaderTitle } from '@react-navigation/elements'
import type { NativeStackHeaderProps } from '@react-navigation/native-stack'
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context'
import { HeaderIconButton } from '../atoms/HeaderIconButton'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'

export function AppStackHeader({ options, route, navigation, back }: NativeStackHeaderProps) {
  const { colors, lang } = useApp()
  const frame = useSafeAreaFrame()
  const insets = useSafeAreaInsets()
  const [buttonWidths, setButtonWidths] = useState({ left: 0, right: 0 })
  const title = getHeaderTitle(options, route.name)
  const customTitle = options.headerTitle
  const tintColor = options.headerTintColor ?? colors.text
  const backgroundColor = StyleSheet.flatten(options.headerStyle)?.backgroundColor
    ?? (options.headerTransparent ? 'transparent' : colors.header)
  const canGoBack = back !== undefined
  const handleBack = () => {
    if (navigation.isFocused()) navigation.goBack()
  }

  const measureButtons = (side: 'left' | 'right', event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width
    setButtonWidths(previous => previous[side] === width ? previous : { ...previous, [side]: width })
  }

  const leftButton = options.headerLeft
    ? options.headerLeft({ tintColor, canGoBack, label: options.headerBackTitle ?? back?.title })
    : canGoBack && options.headerBackVisible !== false
      ? <HeaderIconButton
          name={ICONS.chevronLeft}
          size={25}
          color={tintColor}
          onPress={handleBack}
          accessibilityLabel={lang === 'ja' ? '戻る' : 'Back'}
        />
      : null
  const rightButton = options.headerRight?.({ tintColor, canGoBack })

  // 左右の大きい方を両側に予約し、片側に複数ボタンがあってもタイトルを画面中央に保つ。
  const sideWidth = Math.max(buttonWidths.left, buttonWidths.right)
  const titleMaxWidth = Math.max(0, frame.width - 2 * (
    sideWidth + Math.max(insets.left, insets.right) + UI_METRICS.screenGutter * 2
  ))

  return (
    <Header
      title={title}
      layout={frame}
      // native-stack は自身の HeaderShownContext を true にするので、上の余白は明示する。
      headerStatusBarHeight={insets.top}
      headerTitleAlign="center"
      headerTintColor={tintColor}
      headerTitleStyle={options.headerTitleStyle}
      headerTitle={typeof customTitle === 'function'
        ? () => customTitle({ children: title, tintColor })
        : undefined}
      headerTitleContainerStyle={{ maxWidth: titleMaxWidth }}
      headerLeftContainerStyle={styles.left}
      headerRightContainerStyle={styles.right}
      headerLeft={() => (
        <View onLayout={event => measureButtons('left', event)}>{leftButton}</View>
      )}
      headerRight={() => (
        <View onLayout={event => measureButtons('right', event)}>{rightButton}</View>
      )}
      headerTransparent={options.headerTransparent}
      headerBackground={options.headerBackground ?? (() => (
        <View style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor,
            borderBottomColor: colors.divider,
            borderBottomWidth: options.headerShadowVisible === false ? 0 : StyleSheet.hairlineWidth,
          },
        ]} />
      ))}
    />
  )
}

const styles = StyleSheet.create({
  left: { paddingLeft: UI_METRICS.screenGutter },
  right: { paddingRight: UI_METRICS.screenGutter },
})
