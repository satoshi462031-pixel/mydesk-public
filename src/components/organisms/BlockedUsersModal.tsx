import { Alert } from '../../utils/alert'
// ブロック中のユーザー一覧と解除。
// 公開デスク画面からブロックすると、そのデスクは一覧から消えて辿り着けなくなるため、
// 解除の導線はここに置く（App Store ガイドライン 1.2 の運用上必要）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { useApp } from '../../context/AppContext'
import { BlockedUser, getBlockedUsers, unblockUser } from '../../services/moderationService'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { RetryState } from '../molecules/RetryState'
import { RemovalMotion, useRemovalMotion } from '../molecules/RemovalMotion'
import { localizedErrorMessage } from '../../utils/localizedError'
import { QUICK_TIMEOUT_MS, withTimeout } from '../../utils/networkError'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'

export function BlockedUsersModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  const removal = useRemovalMotion()

  const [items, setItems] = useState<BlockedUser[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const unblockInFlightRef = useRef(false)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    if (!visible) return
    let active = true
    setItems(null)
    setLoadError(false)
    withTimeout(getBlockedUsers(), QUICK_TIMEOUT_MS)
      .then((next) => { if (active) setItems(next) })
      .catch(() => {
        if (!active) return
        setItems([])
        setLoadError(true)
      })
    return () => { active = false }
  }, [visible, loadAttempt])

  const handleUnblock = useCallback(async (blockedId: string) => {
    if (unblockInFlightRef.current) return
    unblockInFlightRef.current = true
    setBusyId(blockedId)
    try {
      await withTimeout(unblockUser(blockedId), QUICK_TIMEOUT_MS)
      await removal.run(blockedId, () => setItems((prev) => (prev ?? []).filter((b) => b.blocked_id !== blockedId)), 'fade')
    } catch (e: any) {
      // 待ち中にシートを閉じた後で、無関係な画面にエラーを重ねない
      if (visibleRef.current) {
        Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(e, lang, ja ? '解除できませんでした。' : 'Could not unblock.'))
      }
    } finally {
      unblockInFlightRef.current = false
      setBusyId(null)
    }
  }, [ja, lang, removal])

  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} sheetStyle={styles.sheet}>
          <View style={[styles.header, { borderBottomColor: C.separator }]}>
            <Text style={[styles.title, { color: C.text }]}>
              {ja ? 'ブロック中のユーザー' : 'Blocked users'}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={ja ? '閉じる' : 'Close'}
            >
              <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          {items === null ? (
            <View style={styles.center}><ActivityIndicator size="small" color={C.accentIcon} /></View>
          ) : loadError ? (
            <RetryState
              message={ja ? 'ブロック中のユーザーを読み込めませんでした。' : 'Could not load blocked users.'}
              onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
            />
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.empty, { color: C.textMuted }]}>
                {ja ? 'ブロックしているユーザーはいません' : 'You have not blocked anyone'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(b) => b.blocked_id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <RemovalMotion ref={(handle) => removal.setRef(item.blocked_id, handle)}>
                <View style={[styles.row, { borderBottomColor: C.separator }]}>
                  <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>
                    {item.blocked_name?.trim() || (ja ? '名前未設定のユーザー' : 'Unnamed user')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleUnblock(item.blocked_id)}
                    disabled={busyId !== null}
                    style={[styles.unblockBtn, { borderColor: C.accentIcon, opacity: busyId !== null ? 0.5 : 1 }]}
                  >
                    <Text style={[styles.unblockText, { color: C.accentText }]}>{ja ? 'ブロックを解除' : 'Unblock'}</Text>
                  </TouchableOpacity>
                </View>
                </RemovalMotion>
              )}
            />
          )}
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet:    { maxHeight: '70%', paddingHorizontal: 0 },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: UI_METRICS.sheetGutter, borderBottomWidth: StyleSheet.hairlineWidth },
  title:    { fontSize: 16, fontWeight: '800' },
  center:   { paddingVertical: 40, alignItems: 'center' },
  empty:    { fontSize: 13 },
  list:     { paddingHorizontal: UI_METRICS.sheetGutter },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  name:     { flex: 1, fontSize: 14, fontWeight: '600' },
  unblockBtn:  { borderWidth: 1, borderRadius: UI_METRICS.cardRadius, paddingHorizontal: 12, paddingVertical: 5 },
  unblockText: { fontSize: 12, fontWeight: '700' },
})
