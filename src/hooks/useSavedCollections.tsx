import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useEntitlement } from './useEntitlement'
import { MyPageNavigation } from '../navigation/screenProps'
import { openPaywall } from '../navigation/rootNavigation'
import { BottomSheetModal } from '../components/molecules/BottomSheetModal'
import { TextField } from '../components/atoms/TextField'
import { AppIcon } from '../components/atoms/AppIcon'
import { Alert } from '../utils/alert'
import {
  CollectionItemKind, SavedCollection, createSavedCollection, deleteSavedCollection,
  listItemCollections, listSavedCollections, renameSavedCollection, setItemCollection,
} from '../services/savedCollections'

type Target = { kind: CollectionItemKind; id: string; title: string }

export function useSavedCollections(navigation: MyPageNavigation, active: boolean) {
  const { user } = useAuth()
  const { colors: C, lang } = useApp()
  const { limits, isPro, isLoading: billingLoading } = useEntitlement()
  const ja = lang === 'ja'
  const userId = user?.id
  const ownerRef = useRef(userId)
  ownerRef.current = userId
  const [collections, setCollections] = useState<SavedCollection[]>([])
  const [collectionId, setCollectionId] = useState<string | undefined>()
  const [revision, setRevision] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<Target | null>(null)
  const [memberships, setMemberships] = useState<string[]>([])
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [membershipError, setMembershipError] = useState(false)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const loadSeq = useRef(0)
  const targetSeq = useRef(0)
  const pendingPaywall = useRef(false)

  const reload = useCallback(async () => {
    if (!userId) return
    const seq = ++loadSeq.current
    try {
      const rows = await listSavedCollections(userId)
      if (seq !== loadSeq.current || ownerRef.current !== userId) return
      setCollections(rows)
      setCollectionId((current) => current && rows.some((row) => row.id === current) ? current : undefined)
      setLoadError(false)
      setLoaded(true)
    } catch {
      if (seq === loadSeq.current && ownerRef.current === userId) setLoadError(true)
    }
  }, [userId])

  useEffect(() => {
    ++loadSeq.current
    ++targetSeq.current
    setCollections([])
    setCollectionId(undefined)
    setLoaded(false)
    setLoadError(false)
    setOpen(false)
    pendingPaywall.current = false
  }, [userId])
  useEffect(() => {
    if (active && userId) void reload()
    if (!active) { setOpen(false); ++targetSeq.current }
  }, [active, userId, reload])

  const close = () => { if (!busyRef.current) { setOpen(false); ++targetSeq.current } }
  const openManager = () => {
    if (!navigation.isFocused()) return
    ++targetSeq.current
    setMembershipLoading(false)
    setMembershipError(false)
    setTarget(null)
    setName('')
    setEditingId(null)
    setOpen(true)
  }
  const loadMemberships = async (next: Target) => {
    if (!userId) return
    const seq = ++targetSeq.current
    setMembershipLoading(true)
    setMembershipError(false)
    try {
      const ids = await listItemCollections(userId, next.kind, next.id)
      if (seq === targetSeq.current && ownerRef.current === userId) setMemberships(ids)
    } catch {
      if (seq === targetSeq.current && ownerRef.current === userId) setMembershipError(true)
    } finally {
      if (seq === targetSeq.current) setMembershipLoading(false)
    }
  }
  const showTarget = (next: Target) => {
    if (!userId || !navigation.isFocused()) return
    setTarget(next)
    setName('')
    setEditingId(null)
    setMemberships([])
    setOpen(true)
    void loadMemberships(next)
  }
  const offerPro = () => {
    pendingPaywall.current = true
    setOpen(false)
  }
  const mutate = async (operation: () => Promise<void>) => {
    if (!userId || busyRef.current || !navigation.isFocused()) return
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      if (ownerRef.current !== userId || !navigation.isFocused()) return
      if (typeof error === 'object' && error && 'message' in error && String(error.message).includes('SAVED_COLLECTION_LIMIT') && !isPro && !billingLoading) offerPro()
      else Alert.alert(ja ? 'コレクションを更新できませんでした' : 'Could not update collection', ja ? '通信状態を確認して、もう一度お試しください。' : 'Check your connection and try again.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const saveName = () => {
    if (!userId || !name.trim() || !loaded || loadError || billingLoading) return
    if (!editingId && limits.maxSavedCollections !== -1 && collections.length >= limits.maxSavedCollections) { offerPro(); return }
    void mutate(async () => {
      if (editingId) await renameSavedCollection(userId, editingId, name)
      else await createSavedCollection(userId, name)
      if (ownerRef.current !== userId) return
      setName('')
      setEditingId(null)
      await reload()
    })
  }
  const remove = (collection: SavedCollection) => {
    if (!userId || busyRef.current) return
    Alert.alert(ja ? `「${collection.name}」を削除しますか？` : `Delete "${collection.name}"?`,
      ja ? 'フォルダだけを削除します。保存したデスクや機材は残ります。' : 'Only the folder is deleted. Your saved desks and gear remain.', [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: ja ? '削除' : 'Delete', style: 'destructive', onPress: () => { void mutate(async () => {
          await deleteSavedCollection(userId, collection.id)
          if (ownerRef.current !== userId) return
          setCollectionId((current) => current === collection.id ? undefined : current)
          if (editingId === collection.id) { setEditingId(null); setName('') }
          await reload()
        }) } },
      ])
  }
  const toggleMembership = (id: string) => {
    if (!userId || !target || membershipLoading || membershipError) return
    const included = !memberships.includes(id)
    void mutate(async () => {
      await setItemCollection(userId, id, target.kind, target.id, included)
      if (ownerRef.current !== userId) return
      setMemberships((current) => included ? [...current, id] : current.filter((value) => value !== id))
      setRevision((value) => value + 1)
    })
  }
  const actionText = { color: C.accentText, fontSize: 13, fontWeight: '600' as const }
  const toolbar = userId ? (
    <View style={styles.toolbar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {[{ id: undefined, name: ja ? 'すべて' : 'All' }, ...collections].map((row) => (
          <TouchableOpacity key={row.id ?? 'all'} accessibilityRole="button" accessibilityState={{ selected: collectionId === row.id }}
            style={[styles.chip, { backgroundColor: collectionId === row.id ? C.accent : C.chip }]}
            onPress={() => setCollectionId(row.id)}>
            <Text style={{ color: collectionId === row.id ? C.onAccent : C.text }}>{row.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={openManager}>
        <Text style={actionText}>{ja ? 'フォルダ管理' : 'Folders'}</Text>
      </TouchableOpacity>
      {loadError && <TouchableOpacity accessibilityRole="button" onPress={() => void reload()}><Text style={{ color: C.textMuted }}>{ja ? 'フォルダを再読み込み' : 'Retry folders'}</Text></TouchableOpacity>}
    </View>
  ) : null
  const assignmentButton = (kind: CollectionItemKind, id: string, title: string) => userId ? (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={ja ? `${title}の保存先フォルダ` : `Folders for ${title}`}
      style={styles.assign} onPress={(event) => { event.stopPropagation(); showTarget({ kind, id, title }) }}>
      <AppIcon name="folder-outline" size={18} color={C.accentIcon} />
      <Text style={actionText}>{ja ? '整理' : 'Organize'}</Text>
    </TouchableOpacity>
  ) : null
  const modal = (
    <BottomSheetModal visible={open} onDismiss={close} dismissDisabled={busy} avoidKeyboard sheetStyle={styles.sheet}
      onDismissed={() => {
        if (pendingPaywall.current) {
          pendingPaywall.current = false
          if (navigation.isFocused() && ownerRef.current === userId) openPaywall(navigation, 'maxSavedCollections')
        }
      }}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: C.text }]}>{ja ? '保存コレクション' : 'Saved collections'}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={styles.button} onPress={close}><Text style={actionText}>{ja ? '完了' : 'Done'}</Text></TouchableOpacity>
      </View>
      <Text style={{ color: C.textSub }}>{target ? target.title : (ja ? 'デスクと機材を共通のフォルダに整理できます。保存数は無制限です。' : 'Organize saved desks and gear in shared folders. Saving items is unlimited.')}</Text>
      {(!loaded || membershipLoading) && !loadError && <ActivityIndicator color={C.accentIcon} />}
      {loadError && <TouchableOpacity accessibilityRole="button" onPress={() => void reload()}><Text style={actionText}>{ja ? 'フォルダを再読み込み' : 'Retry folders'}</Text></TouchableOpacity>}
      {membershipError && target && <TouchableOpacity accessibilityRole="button" onPress={() => void loadMemberships(target)}><Text style={actionText}>{ja ? '保存先を再読み込み' : 'Retry membership'}</Text></TouchableOpacity>}
      <ScrollView style={styles.folders} keyboardShouldPersistTaps="handled">
        {collections.map((row) => <View key={row.id} style={[styles.folderRow, { borderBottomColor: C.border }]}>
          {target ? <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: memberships.includes(row.id), disabled: busy || membershipLoading || membershipError }}
            disabled={busy || membershipLoading || membershipError} style={styles.membership} onPress={() => toggleMembership(row.id)}>
            <AppIcon name={memberships.includes(row.id) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={C.accentIcon} />
            <Text style={[styles.folderName, { color: C.text }]}>{row.name}</Text>
          </TouchableOpacity> : <>
            <Text style={[styles.folderName, { color: C.text }]}>{row.name}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={ja ? `${row.name}を改名` : `Rename ${row.name}`} disabled={busy} style={styles.button} onPress={() => { setEditingId(row.id); setName(row.name) }}><Text style={actionText}>{ja ? '改名' : 'Rename'}</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={ja ? `${row.name}を削除` : `Delete ${row.name}`} disabled={busy} style={styles.button} onPress={() => remove(row)}><AppIcon name="trash-can-outline" size={20} color={C.textMuted} /></TouchableOpacity>
          </>}
        </View>)}
        {loaded && !loadError && collections.length === 0 && <Text style={{ color: C.textMuted, paddingVertical: 16 }}>{ja ? 'フォルダはまだありません。' : 'No folders yet.'}</Text>}
      </ScrollView>
      <TextField value={name} onChangeText={setName} maxLength={60} editable={!busy}
        placeholder={ja ? (editingId ? '新しいフォルダ名' : 'フォルダ名') : 'Folder name'} accessibilityLabel={ja ? 'フォルダ名' : 'Folder name'} onSubmitEditing={saveName} />
      <View style={styles.heading}>
        <Text style={{ color: C.textMuted, flex: 1 }}>{ja ? `無料は3フォルダ、Proは無制限（現在${collections.length}個）` : `Free: 3 folders. Pro: unlimited (${collections.length} now)`}</Text>
        {editingId && <TouchableOpacity accessibilityRole="button" style={styles.button} disabled={busy} onPress={() => { setEditingId(null); setName('') }}><Text style={actionText}>{ja ? 'キャンセル' : 'Cancel'}</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy || billingLoading || !loaded || loadError || !name.trim() }}
          disabled={busy || billingLoading || !loaded || loadError || !name.trim()} style={styles.button} onPress={saveName}>
          <Text style={actionText}>{busy ? (ja ? '保存中' : 'Saving') : editingId ? (ja ? '変更' : 'Rename') : (ja ? '作成' : 'Create')}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheetModal>
  )
  return { collectionId, revision, toolbar, modal, assignmentButton }
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: 16, paddingTop: 10, gap: 4 },
  filters: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  button: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  assign: { minHeight: 44, flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 8 },
  sheet: { padding: 20, gap: 12, maxHeight: '85%' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: '700' },
  folders: { flexShrink: 1, maxHeight: 320 },
  folderRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  folderName: { flex: 1, fontSize: 14 },
  membership: { flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1, paddingVertical: 12 },
})
