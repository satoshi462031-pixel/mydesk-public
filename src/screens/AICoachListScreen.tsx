import { Alert } from '../utils/alert'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { UI_STATUS_COLORS } from '../constants/ui'
import { AppIcon } from '../components/atoms/AppIcon'
import { ContrastToggle } from '../components/atoms/ContrastToggle'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { AI_COACH_LIST_COACH } from '../constants/aiCoachSteps'
import { COACH_SCREEN, CoachAnchor, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { UndoSnackbar } from '../components/molecules/UndoSnackbar'
import { animateListChange, FullSwipeRow } from '../components/molecules/FullSwipeRow'
import { useApp } from '../context/AppContext'
import { useAIUsageLimit, formatResetDate } from '../hooks/useAIUsageLimit'
import { useUndoSnackbar } from '../hooks/useUndoSnackbar'
import { useIntentSync } from '../hooks/useIntentSync'
import { isAIHistoryEnabled, setAIHistoryEnabled } from '../services/ai/historySettings'
import { deleteAIConversationImages } from '../services/ai/imageService'
import { formatRelativeDay } from '../utils/dateFormat'
import {
  deleteConversation,
  derivePreview,
  loadConversations,
  saveConversation,
  StoredConversation,
} from '../store/conversationStore'
import { AICoachNavigation } from '../navigation/screenProps'
import { ICONS } from '../constants/icons'
import { hapticWarning } from '../utils/haptics'

 
type Props = { navigation: AICoachNavigation }

// ─── 左へ引ききると消える行 ──────────────────────────────────────────────────
function ConversationRow({
  item,
  colors,
  lang,
  onPress,
  onDelete,
}: {
  item:     StoredConversation
  colors:   ReturnType<typeof useApp>['colors']
  lang:     string
  onPress:  () => void
  onDelete: (conversation: StoredConversation) => Promise<void>
}) {
  const preview = derivePreview(item.messages)

  // 削除に失敗したら行を戻す（FullSwipeRow は false を受けると元の位置へ戻す）
  const handleDelete = async (): Promise<boolean> => {
    try {
      await onDelete(item)
      return true
    } catch {
      Alert.alert(
        lang === 'en' ? 'Could not delete' : '削除できませんでした',
        lang === 'en' ? 'Please try again.' : 'もう一度お試しください。',
      )
      return false
    }
  }

  const c = colors
  const deleteLabel = lang === 'en' ? `Delete ${item.title}` : `「${item.title}」を削除`
  return (
    <FullSwipeRow
      actionLabel={lang === 'en' ? 'Delete' : '削除'}
      actionAccessibilityLabel={deleteLabel}
      actionIcon={ICONS.trash}
      actionColor={UI_STATUS_COLORS.danger}
      actionContentColor="#fff"
      actionWidth={84}
      onCommit={handleDelete}
    >
        <CoachAnchor id="ai-conversation"><Pressable
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: pressed ? (c.chip ?? '#F2F2F7') : c.card },
          ]}
          onPress={onPress}
          // 読み上げではスワイプが見つからないので、同じ削除を操作の一覧に載せる
          accessibilityActions={[{ name: 'delete', label: deleteLabel }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'delete') void handleDelete()
          }}
        >
          {/* 器はヘッダーの丸ボタンと同じ chip。以前の '#232F3E' はダークの card(#2C2C2E)
              との差が 1.03:1 しかなく、器そのものが消えていた */}
          <View style={[styles.rowIcon, { backgroundColor: c.chip }]}>
            <AppIcon name={ICONS.robot} size={20} color={c.accentText} />
          </View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            {!!preview && (
              <Text style={[styles.rowPreview, { color: c.textMuted }]} numberOfLines={1}>
                {preview}
              </Text>
            )}
          </View>
          <View style={styles.rowMeta}>
            <Text style={[styles.rowDate, { color: c.textMuted ?? c.textSub }]}>
              {formatRelativeDay(item.updatedAt, lang === 'en' ? 'en' : 'ja')}
            </Text>
            <AppIcon name={ICONS.chevronRight} size={16} color={c.chevron ?? '#C7C7CC'} />
          </View>
        </Pressable></CoachAnchor>
    </FullSwipeRow>
  )
}

// ─── メイン画面 ────────────────────────────────────────────────────────────────
export function AICoachListScreen({ navigation }: Props) {
  const { colors, lang, reduceMotion } = useApp()
  const accent = colors.accent
  const { canUse, usedRatio, nearLimit, resetDate, loaded, isPro, refresh } = useAIUsageLimit()
  const [conversations, setConversations] = useState<StoredConversation[]>([])
  const [convsLoaded, setConvsLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [historyEnabled, setHistoryEnabledState] = useState(true)
  const historyEnabledRef = useRef(historyEnabled)
  const historyChangeRef = useRef(0)
  const historySync = useIntentSync<string>({
    send: (_key, enabled) => setAIHistoryEnabled(enabled),
    onFailed: (_key, enabled) => {
      historyEnabledRef.current = enabled
      setHistoryEnabledState(enabled)
      Alert.alert(lang === 'en' ? 'Could not save history settings' : '相談履歴の設定を保存できませんでした')
    },
  })
  const undoSnackbar = useUndoSnackbar()

  // 利用量はサーバー側の値なので、画面を出入りせずに取り直せるようにする
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [data] = await Promise.all([loadConversations(), refresh()])
      setConversations(data)
    } catch {
      // 現在の一覧を残す。RefreshControlから未処理のPromise rejectionを出さない。
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      const historyVersion = historyChangeRef.current
      void Promise.all([loadConversations(), isAIHistoryEnabled()]).then(([data, enabled]) => {
        if (cancelled) return
        setConversations(data)
        if (historyVersion === historyChangeRef.current && !historySync.isBusy('history')) {
          historyEnabledRef.current = enabled
          setHistoryEnabledState(enabled)
        }
        setConvsLoaded(true)
      })
      // チャット画面での消費はこの画面の state に伝わらないので取り直す
      void refresh()
      return () => { cancelled = true }
    }, [refresh, historySync]),
  )

  const coach = useCoachMarks()
  const { target: coachTarget, open: openCoach } = coach
  const openHelp = useCallback(() => { void openCoach(AI_COACH_LIST_COACH) }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderIconButton name="help-circle-outline" color={colors.text} onPress={openHelp}
        accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
    ) })
  }, [navigation, colors.text, lang, openHelp])

  const handleDelete = useCallback(async (conversation: StoredConversation) => {
    await deleteConversation(conversation.id)
    animateListChange(reduceMotion)
    setConversations(prev => prev.filter(c => c.id !== conversation.id))
    hapticWarning()
    undoSnackbar.showUndo({
      message: lang === 'en' ? `Deleted "${conversation.title}"` : `「${conversation.title}」を削除しました`,
      onUndo: async () => {
        await saveConversation(conversation)
        animateListChange(reduceMotion)
        setConversations(prev => [...prev.filter(c => c.id !== conversation.id), conversation]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      },
      onExpire: () => deleteAIConversationImages(conversation.messages),
    })
  }, [lang, reduceMotion, undoSnackbar])

  const handleHistoryToggle = useCallback((enabled: boolean) => {
    const previous = historyEnabledRef.current
    historyEnabledRef.current = enabled
    historyChangeRef.current += 1
    setHistoryEnabledState(enabled)
    historySync.request('history', previous, enabled)
  }, [historySync])

  const openNewChat = useCallback(() => {
    if (!navigation.isFocused()) return
    navigation.push('AICoachChat')
  }, [navigation])

  const c = colors

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.safe, { backgroundColor: c.bg }]}>
      <CoachScope coach={coach}>
      {/* 使用制限バー */}
      {loaded && (
        <View ref={coachTarget('ai-usage')} style={[styles.usageBadge, { backgroundColor: c.card }]}>
          <AppIcon name={isPro ? ICONS.robot : ICONS.lock} size={17} color={isPro ? c.accentIcon : c.textMuted} />
          <Text style={[styles.usageText, { color: c.textSub }]}>
            {/* Free は枠を使い切ったのではなく最初から使えない。リセット日を出すと
                「待てば使える」と読めてしまうので、Pro 限定であることだけを書く */}
            {!isPro
              ? (lang === 'en'
                  ? 'The AI coach is available on Pro'
                  : 'AIコーチはProプランで利用できます')
              : canUse
                ? (lang === 'en'
                    ? `AI usage this week: ${Math.floor(usedRatio * 100)}% used${nearLimit ? ' · Almost at limit' : ''} · Resets ${formatResetDate(resetDate, lang)}`
                    : `今週のAI利用量：${Math.floor(usedRatio * 100)}%使用${nearLimit ? '・残りわずか' : ''}（${formatResetDate(resetDate, lang)}にリセット）`)
                : (lang === 'en'
                    ? `Weekly AI limit reached — resets ${formatResetDate(resetDate, lang)}.`
                    : `今週のAI利用枠を使い切りました（${formatResetDate(resetDate, lang)}にリセット）`)}
          </Text>
          {!isPro && (
            <TouchableOpacity
              onPress={() => navigation.navigate('Paywall', { reason: 'aiFeatures' })}
              hitSlop={12}
              accessibilityRole="button"
            >
              <Text style={[styles.upgradeText, { color: c.accentText }]}>{lang === 'en' ? 'Upgrade' : 'アップグレード'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={conversations}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.textMuted} colors={[colors.textMuted]} progressBackgroundColor={colors.card} />
        }
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: c.divider ?? '#E5E5EA' }]} />
        )}
        ListHeaderComponent={
          <View>
            <TouchableOpacity
              ref={coachTarget('ai-new-chat')}
              style={[styles.newRow, { backgroundColor: c.card }]}
              onPress={openNewChat}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <View style={[styles.iconWrap, { backgroundColor: accent }]}> 
                <AppIcon name={ICONS.add} size={20} color={colors.onAccent} />
              </View>
              {/* Free もチャットを開いて質問を書くところまではできる（課金の案内は送信時）。
                  Pro 限定であることは上の帯とチャット画面の帯・送信ボタンの印で示す */}
              <Text style={[styles.newRowText, { color: c.accentText }]}>
                {lang === 'en' ? 'New Chat' : '新しいチャット'}
              </Text>
            </TouchableOpacity>
            <View ref={coachTarget('ai-history-setting')} style={[styles.historySetting, { backgroundColor: c.card, borderTopColor: c.divider }]}> 
              <View style={styles.historySettingText}>
                <Text style={[styles.historySettingLabel, { color: c.text }]}>{lang === 'en' ? 'Save AI chat history' : 'AI会話履歴を端末に保存'}</Text>
                <Text style={[styles.historySettingSub, { color: c.textSub }]}>{lang === 'en' ? 'Turning this off affects future messages only.' : 'オフにすると、以後の会話を端末へ保存しません。'}</Text>
              </View>
              <ContrastToggle
                value={historyEnabled}
                onValueChange={handleHistoryToggle}
                colors={colors}
                accessibilityLabel={lang === 'en' ? 'Save AI chat history on this device' : 'AI会話履歴を端末に保存'}
              />
            </View>
          </View>
        }
        ListEmptyComponent={convsLoaded ? (
          <View style={styles.emptyContainer}>
            <AppIcon name={ICONS.robot} size={56} color={colors.accentIcon} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>{lang === 'en' ? 'AI Desk Coach' : 'AIデスクコーチ'}</Text>
            <Text style={[styles.emptyDesc, { color: c.textMuted }]}>
              {lang === 'en'
                ? 'Ask anything about your desk setup. You can also select a desk to analyze it.'
                : 'デスク環境について気軽に相談しましょう。デスクを選んで分析することもできます。'}
            </Text>
          </View>
        ) : (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.accentIcon} />
          </View>
        )}
        renderItem={({ item }) => (
          <ConversationRow
            item={item}
            colors={c}
            lang={lang}
            // replace だとこの一覧がスタックから消え、戻ったときに直前のチャットが
            // 出てきて履歴に帰れない。push して「戻る＝履歴一覧」にする
            onPress={() => navigation.isFocused() && navigation.push('AICoachChat', { conversationId: item.id })}
            onDelete={handleDelete}
          />
        )}
      />
      <UndoSnackbar
        visible={undoSnackbar.visible}
        message={undoSnackbar.message}
        lang={lang}
        backgroundColor={c.text}
        textColor={c.card}
        accentColor={c.accent}
        onUndo={undoSnackbar.undo}
        undoing={undoSnackbar.undoing}
        bottomOffset={16}
      />
      </CoachScope>
      {coach.overlay}
    </SafeAreaView>
  )
}


const styles = StyleSheet.create({
  safe:           { flex: 1 },
  listContent:    { paddingBottom: 40 },
  loadingWrap:    { paddingTop: 80, alignItems: 'center' },
  usageBadge:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  usageText:      { flex: 1, fontSize: 13 },
  upgradeText:    { fontSize: 13, fontWeight: '600' },
  separator:      { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  newRow:         { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  iconWrap:       { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  newRowText:     { fontSize: 15, fontWeight: '600' },
  historySetting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  historySettingText: { flex: 1 },
  historySettingLabel: { fontSize: 14, fontWeight: '600' },
  historySettingSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  emptyContainer: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle:     { fontSize: 20, fontWeight: '700' },
  emptyDesc:      { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  row:            { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowIcon:        { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowBody:        { flex: 1, gap: 2 },
  rowTitle:       { fontSize: 15, fontWeight: '600' },
  rowPreview:     { fontSize: 13 },
  rowMeta:        { alignItems: 'center', flexDirection: 'row', gap: 2 },
  rowDate:        { fontSize: 12 },
})
