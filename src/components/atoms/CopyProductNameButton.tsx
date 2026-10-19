import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import type { AppColors } from '../../context/AppContext'
import { showMessage } from '../../utils/confirmation'
import { hapticLight } from '../../utils/haptics'
import { AppIcon } from './AppIcon'

interface Props {
  name: string
  colors: AppColors
  lang: 'ja' | 'en'
}

export function CopyProductNameButton({ name, colors: C, lang }: Props) {
  const [copiedName, setCopiedName] = useState<{ name: string } | null>(null)
  const productName = name.trim()
  const copied = copiedName?.name === productName
  const ja = lang === 'ja'

  useEffect(() => {
    if (copiedName === null) return
    const timer = setTimeout(() => setCopiedName(null), 2000)
    return () => clearTimeout(timer)
  }, [copiedName])

  if (!productName) return null

  const copy = async () => {
    try {
      if (!await Clipboard.setStringAsync(productName)) throw new Error('Clipboard write failed')
      hapticLight()
      setCopiedName({ name: productName })
    } catch {
      showMessage(ja ? '商品名をコピーできませんでした' : 'Could not copy the product name')
    }
  }

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={() => { void copy() }}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={ja ? '商品名をコピー' : 'Copy product name'}
    >
      <AppIcon name={copied ? ICONS.check : ICONS.copy} size={16} color={C.accentIcon} />
      <Text style={[styles.label, { color: C.accentText }]} accessibilityLiveRegion="polite">
        {copied ? (ja ? 'コピー済み' : 'Copied') : (ja ? '商品名をコピー' : 'Copy product name')}
      </Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    minHeight: UI_METRICS.touchMinSize,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
})
