import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { MCIconName } from '../../constants/icons'
import { AppColors } from '../../constants/colors'
import { attributeValue, DeskAttribute } from '../../utils/deskAttributes'
import { PlanPurpose } from '../../types'
import { purposeIcon, purposeIconColor, purposeTintColor } from '../../screens/PurposeSelectionScreen'
import { UI_METRICS } from '../../constants/ui'

// 用途（自分で決めた属性）は色を持たせ、構成から自動で出た属性は中立色にする。
// どこまでが本人の申告で、どこからが登録内容から出たものかが色で分かる。

const OS_ICONS: Record<string, MCIconName> = {
  macOS: 'apple',
  Windows: 'microsoft-windows',
  Linux: 'linux',
  ChromeOS: 'google-chrome',
}

const FORM_ICONS: Record<string, MCIconName> = {
  laptop: 'laptop',
  mini: 'desktop-tower',
}

function iconOf(attr: DeskAttribute, otherPurposeIcon?: string): MCIconName {
  const value = attributeValue(attr)
  switch (attr.group) {
    case 'purpose': return purposeIcon(value as PlanPurpose, otherPurposeIcon)
    case 'os':      return OS_ICONS[value] ?? 'monitor'
    case 'form':    return FORM_ICONS[value] ?? 'desktop-tower'
    case 'desk':    return 'arrow-up-down'
  }
}

interface Props {
  attributes: DeskAttribute[]
  colors: AppColors
  isDark: boolean
  otherPurposeIcon?: string
  lang?: 'ja' | 'en'
  /** 公開デスクの詳細から、同じ属性のデスク一覧へ移るときだけ渡す */
  onPress?: (key: string) => void
}

export function DeskAttributeChips({ attributes, colors: C, isDark, otherPurposeIcon, lang = 'ja', onPress }: Props) {
  if (attributes.length === 0) return null
  return (
    <View style={styles.row}>
      {attributes.map((attr) => {
        const value = attributeValue(attr)
        // 用途色は 3:1 までしか上げられないので、器・枠・アイコンにだけ使う。
        // ラベルに載せるとライトで dev 2.49 / creative 2.85 と AA を割る
        const tint = attr.group === 'purpose' ? purposeIconColor(value as PlanPurpose, isDark) : null
        const tintBase = attr.group === 'purpose' ? purposeTintColor(value as PlanPurpose, isDark) : null
        const chipStyle = [styles.chip, tintBase
          ? { backgroundColor: tintBase + '20', borderColor: tintBase + '40' }
          : { backgroundColor: C.chip, borderColor: C.border }]
        const content = (
          <>
            <AppIcon name={iconOf(attr, otherPurposeIcon)} size={15} color={tint ?? C.textSub} />
            <Text style={[styles.label, { color: C.textSub }]} numberOfLines={1}>
              {attr.label}
            </Text>
          </>
        )
        if (onPress) {
          return (
            <TouchableOpacity
              key={attr.key}
              style={chipStyle}
              onPress={() => onPress(attr.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={lang === 'en' ? `Find desks with ${attr.label}` : `${attr.label}のデスクを探す`}
            >
              {content}
              <AppIcon name="magnify" size={12} color={tint ?? C.textMuted} />
            </TouchableOpacity>
          )
        }
        return (
          <View
            key={attr.key}
            style={chipStyle}
          >
            {content}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, overflow: 'visible' },
  chip: {
    maxWidth: 116,
    minHeight: 27,
    paddingHorizontal: 8,
    borderRadius: UI_METRICS.cardRadius,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: { maxWidth: 86, fontSize: 10, fontWeight: '700', flexShrink: 1 },
})
