import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { ICONS } from '../../constants/icons'

interface Props {
  id: string
  title: string
  author?: string | null
  photoUri?: string
  meta: string
  liked: boolean
  onPress: (id: string) => void
  onToggleLike: (id: string, onClap: () => void) => Promise<void>
}

export function HistoryDeskRow({ id, title, author, photoUri, meta, liked, onPress, onToggleLike }: Props) {
  const { colors: C, lang } = useApp()
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} onPress={() => onPress(id)}
      style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}>
      {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} />
        : <View style={[styles.photo, styles.placeholder, { backgroundColor: C.chip }]}><AppIcon name="desk" size={24} color={C.textMuted} /></View>}
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, { color: C.text }]}>{title}</Text>
        {!!author && <Text numberOfLines={1} style={{ color: C.textSub, fontSize: 12 }}>{author}</Text>}
        <Text style={{ color: C.textMuted, fontSize: 11 }}>{meta}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={lang === 'ja' ? (liked ? '拍手を取り消す' : '拍手する') : (liked ? 'Undo applause' : 'Applaud')}
        accessibilityState={{ selected: liked }} style={styles.action}
        onPress={(event) => { event.stopPropagation(); void onToggleLike(id, () => {}) }}>
        <AppIcon name={ICONS.clap} size={20} color={liked ? C.accentIcon : C.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden', minHeight: 76 },
  photo: { width: 76, height: 76 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3, paddingVertical: 8 },
  title: { fontSize: 14, fontWeight: '600' },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
})
