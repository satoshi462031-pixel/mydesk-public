import { StyleSheet, Text, View } from 'react-native'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../../constants/categoryLabels'
import { categoryIconColor, DECOR_COLOR, ICONS, themeIconColor, categoryBaseColor } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { Gadget } from '../../types'
import { gadgetCategoryLabel } from '../../utils/customCategory'
import { gadgetNickname, localizedGadgetName } from '../../utils/localizedGadgetName'
import { fitNodeFontSize, fitNodeFontSizePreferOneLine } from '../../utils/nodeTextFit'
import { AppIcon } from './AppIcon'
import { CategoryIcon } from './CategoryIcon'

/** ソーラー・電池の擬似ノード（コンセントと同じく実ガジェットを持たない電源ソース） */
export type MapPowerSource = 'solar' | 'battery'

export const POWER_SOURCE_COLORS: Record<MapPowerSource, string> = {
  solar: '#FFD21A',
  battery: '#4C9A6B',
}

function powerSourceLabel(source: MapPowerSource, lang: 'ja' | 'en'): string {
  if (source === 'solar') return lang === 'ja' ? 'ソーラーパネル' : 'Solar panel'
  return lang === 'ja' ? '電池・バッテリー' : 'Battery'
}

interface Props {
  gadget: Gadget
  width: number
  height: number
  isWall: boolean
  powerSource?: MapPowerSource
  isDecor?: boolean
  isSubwoofer?: boolean
  textColor: string
  subTextColor: string
  surfaceColor: string
}

function NodeIcon({ category, pcFormFactor, customIcon, isWall, powerSource, isDecor, size, boxWidth, boxHeight, color }: {
  category: Gadget['category']
  pcFormFactor?: Gadget['pcFormFactor']
  customIcon?: string
  isWall: boolean
  powerSource?: MapPowerSource
  isDecor?: boolean
  size: number
  boxWidth: number
  boxHeight: number
  color: string
}) {
  return (
    <View style={[styles.iconViewport, { width: boxWidth, height: boxHeight }]}>
      {isWall
        ? <AppIcon name="power-socket-jp" size={size} color={color} />
        : powerSource
          ? <AppIcon name={powerSource === 'solar' ? 'solar-power' : 'battery'} size={size} color={color} />
        : isDecor
          ? <AppIcon name={ICONS.decor} size={size} color={color} />
          : <CategoryIcon category={category} pcFormFactor={pcFormFactor} customIcon={customIcon} size={size} color={color} />}
    </View>
  )
}

export function MapNodeLabel({ gadget, width, height, isWall, powerSource, isDecor, isSubwoofer, textColor, subTextColor, surfaceColor }: Props) {
  const { lang, t, isDark } = useApp()

  // 6桁で持つ。themeIconColor のダークモード補正は #RRGGBB しか受け付けず、
  // さらに下の iconBackground で透明度2桁を足すため、3桁だと 5桁の無効な色になる
  const categoryColor = isWall
    ? '#555555'
    : powerSource
      ? POWER_SOURCE_COLORS[powerSource]
      : isDecor ? DECOR_COLOR : (categoryBaseColor(gadget.category, gadget.customCategory?.color, '#888888'))
  const iconColor = isWall || powerSource || isDecor
    ? themeIconColor(categoryColor, isDark)
    : categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)
  const iconBackground = categoryColor + '20'
  const pseudoName = isWall
    ? (lang === 'ja' ? 'コンセント' : 'Outlet')
    : powerSource
      ? powerSourceLabel(powerSource, lang)
      : isDecor
        ? (lang === 'ja' ? '飾り' : 'Decor')
        : isSubwoofer ? (lang === 'ja' ? 'ウーファー' : 'Subwoofer') : null
  const name = pseudoName ?? localizedGadgetName(gadget, lang)
  // 呼び名はジャンル名の位置に出す。同じジャンルが並んだとき、図の上で見分ける手がかりはここしかない
  const genreName = pseudoName
    ?? gadgetNickname(gadget)
    ?? (gadget.category === 'Monitor'
      ? (lang === 'ja' ? CATEGORY_LABELS.Monitor : CATEGORY_LABELS_EN.Monitor)
      : gadgetCategoryLabel(gadget, t))
  const innerWidth = Math.max(20, width - 6)
  const innerHeight = Math.max(20, height - 6)
  const horizontal = innerWidth >= innerHeight * 1.2
  const iconBoxWidth = horizontal ? Math.floor(innerWidth * 0.42) : innerWidth
  const iconBoxHeight = horizontal ? innerHeight : Math.floor(innerHeight * 0.64)
  const textWidth = horizontal ? innerWidth - iconBoxWidth : innerWidth
  const textHeight = horizontal ? innerHeight : innerHeight - iconBoxHeight
  const iconSize = Math.max(20, Math.floor(Math.min(iconBoxWidth - 10, iconBoxHeight - 10) * 0.9))
  const normalizedGenre = genreName.replace(/[\s・/]/g, '').toLowerCase()
  const normalizedName = name.replace(/[\s・/]/g, '').toLowerCase()
  const hasDistinctProduct = pseudoName === null && !gadget.isPlaceholder && normalizedName !== normalizedGenre
  // 配線図は「何がどこに繋がっているか」を役割で読む図なので、両方載らない狭い枠では
  // 商品名ではなくジャンル名を残す（商品名はノードをタップすれば詳細に出る）
  const showProduct = hasDistinctProduct && textHeight >= 30
  const genreHeight = showProduct ? Math.floor((textHeight - 8) * 0.56) : textHeight - 8
  const productHeight = showProduct ? Math.max(10, textHeight - genreHeight - 8) : 0
  // 擬似ノード（コンセント・電源ソース・飾り）は製品名を持たない固定ラベルなので、
  // 既定サイズで「コンセ／ント」のように割れないよう1行を優先する。
  // 実ガジェットのカテゴリ名は行数より文字の大きさを優先する（従来どおり）。
  const fitGenre = pseudoName !== null ? fitNodeFontSizePreferOneLine : fitNodeFontSize
  const genreFontSize = fitGenre(genreName, Math.max(1, textWidth - 10), Math.max(1, genreHeight), 2, 9, textWidth >= 80 ? 18 : 15)
  const productFontSize = showProduct
    ? fitNodeFontSize(name, Math.max(1, textWidth - 10), productHeight, 1, 8, 12)
    : 0
  return (
    <View
      style={[styles.hybridWrap, { backgroundColor: surfaceColor, flexDirection: horizontal ? 'row' : 'column' }]}
      pointerEvents="none"
    >
      <View style={[styles.iconPane, { width: iconBoxWidth, height: iconBoxHeight, backgroundColor: iconBackground }]}>
        <NodeIcon category={gadget.category} pcFormFactor={gadget.pcFormFactor} customIcon={gadget.customCategory?.icon} isWall={isWall} powerSource={powerSource} isDecor={isDecor} size={iconSize} boxWidth={iconBoxWidth} boxHeight={iconBoxHeight} color={iconColor} />
      </View>
      <View style={[styles.textPane, { width: textWidth, height: textHeight, backgroundColor: surfaceColor }]}>
        <Text
          style={[styles.hybridGenre, { color: textColor, fontSize: genreFontSize, lineHeight: genreFontSize + 1 }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {genreName}
        </Text>
        {showProduct && (
          <Text
            style={[styles.hybridProduct, { color: subTextColor, fontSize: productFontSize, lineHeight: productFontSize + 1 }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {name}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  hybridWrap: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconViewport: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconPane: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  textPane: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, paddingVertical: 4, overflow: 'hidden' },
  hybridGenre: { width: '100%', flexShrink: 1, fontWeight: '800', textAlign: 'center' },
  hybridProduct: { width: '100%', flexShrink: 1, fontWeight: '600', textAlign: 'center', marginTop: 2 },
})
