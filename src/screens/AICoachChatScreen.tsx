import { Alert } from '../utils/alert'
import { useFocusEffect } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
import * as Crypto from 'expo-crypto'
import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Clipboard,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Reanimated, { FadeIn as LayoutFadeIn, FadeOut as LayoutFadeOut, LinearTransition } from 'react-native-reanimated'
import { AppIcon } from '../components/atoms/AppIcon'
import { ContrastToggle } from '../components/atoms/ContrastToggle'
import { BottomSheetModal } from '../components/molecules/BottomSheetModal'
import { IconCircleButton } from '../components/atoms/IconCircleButton'
import { HeaderButtonGroup, HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { ICONS } from '../constants/icons'
import { AI_COACH_CHAT_COACH } from '../constants/aiCoachSteps'
import { COACH_SCREEN, CoachAnchor, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { showPhotoPermissionAlert } from '../utils/confirmation'
import { launchImageLibraryFromUserAction } from '../utils/imagePicker'
import { useApp } from '../context/AppContext'
import { useSubscription } from '../context/SubscriptionContext'
import { useAIUsageLimit, formatResetDate } from '../hooks/useAIUsageLimit'
import { AIUsageLimitError, sendChatMessage } from '../services/ai/openai'
import { buildConversationMessages } from '../services/ai/conversationContext'
import { grantAIDataConsent, hasAIDataConsent } from '../services/aiConsent'
import { AIReportReason, submitAIReport } from '../services/aiReportService'
import { localizedErrorMessage } from '../utils/localizedError'
import { multilineInputText } from '../utils/multilineInputText'
import { analytics, errorProperties, EVENTS, linkProperties, trackLimitHit } from '../services/analytics'
import { resolvePurchaseLinks, resolvePurchaseLinksSync } from '../repositories/productRepository'
import type { PurchaseLink } from '../types/product'
import { affiliateDisclosure, purchaseLinkLabel } from '../utils/url'
import {
  buildPlanAnalysisMessage,
  DEFAULT_AI_CONTEXT_SELECTION,
  foreignDeskContextSelection,
  type AIContextSelection,
} from '../services/ai/promptBuilder'
import { extractSuggestedProductName } from '../services/ai/responseParser'
import { isAIHistoryEnabled } from '../services/ai/historySettings'
import { loadAIConversationImage, persistAIConversationImage, prepareAIImage } from '../services/ai/imageService'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { usePlanOpenedAt } from '../hooks/usePlanOpenedAt'
import { sortPlansLikeMyDesk } from '../store/displaySettings'
import { useDeskDetail } from '../hooks/useDesk'
import { toPublicDeskModel } from '../utils/publicDeskAdapter'
import { localizedDemoDeskName } from '../utils/localizedDemoDesk'
import { formatPublicAuthor } from '../utils/publicAuthor'
import { refreshPlanWiring } from '../utils/planWiring'
import { countsAsDevice } from '../utils/gadgetStats'
import { trimInvisible } from '../utils/truncateText'
import { nextRevealLength } from '../utils/streamReveal'
import { aiResponseStatsLabel, type AIResponseStats } from '../utils/aiResponseStats'
import {
  ChatMessage,
  StoredConversation,
  deriveTitle,
  getConversation,
  newConversationId,
  newMessageId,
  saveConversation,
} from '../store/conversationStore'
import type { AICoachChatParams, DeskPlan, Gadget } from '../types'
import { PRIVACY_URL } from '../constants/plans'
import { AICoachNavigation } from '../navigation/screenProps'
import { IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER, PRESS_INTERACTION, UI_METRICS, UI_STATUS_COLORS, UI_STATUS_ON_WARNING } from '../constants/ui'
import { hapticLight, hapticMedium } from '../utils/haptics'
import { hasAIAccess, shouldShowAIPaywall } from '../utils/aiAccess'


type Props = { navigation: AICoachNavigation; route?: { params?: AICoachChatParams } }

// APIへ送る履歴の上限。サーバー側は 50件 / 150,000文字（supabase/functions/ai-coach）
// で、超えると 413 を返す。会話は毎回まるごと送るので、放っておくと長い会話が
// 必ず上限に当たり、再送しても同じ履歴を送るため永久に失敗する。
// 画面の表示は全件そのままで、送る分だけ新しい方から詰める。
// 届いた差分をまとめて画面に出す間隔。短くすると滑らかになる代わりに、
// Markdown の組み直しが増えて長い回答で操作が重くなる
const STREAM_FLUSH_MS = 60
// 回答を画面に流す間隔。組み直すのは流している吹き出し1つだけなので、受信の反映より細かくできる
const REVEAL_TICK_MS = 40
// 作られてからこれより新しい発言だけ、登場の動きを付ける。履歴から開いた会話や、
// 一覧を戻して描き直した発言まで動くと、読み返すたびに画面が揺れる
const ENTRANCE_FRESH_MS = 1500
// 入力欄の中の操作（デスク・写真・送信）の器。大きさを揃え、送信は有名なAIアプリと同じ 36pt にする。
// 押せる範囲は hitSlop で 44pt を確保する
const COMPOSER_TOOL_SIZE = 36
const COMPOSER_TOOL_SLOP = (UI_METRICS.touchMinSize - COMPOSER_TOOL_SIZE) / 2

// 送信は履歴設定の読み出しや写真の保存を待ってから受け付けるので、その間に打ち足した分は残す。
// 丸ごと空にすると、送信を押した直後に打った文字が消える
function inputAfterSend(current: string, sent: string): string {
  return current.startsWith(sent) ? current.slice(sent.length).trimStart() : current
}


// ─── インラインMarkdown（**bold** 対応）────────────────────────────────────────
function InlineText({ text, style }: { text: string; style?: object }) {
  // *** や **** で囲って返ってくることがあり、そのままだと余った * が本文に残る
  const parts = text.replace(/\*{3,}/g, '**').split(/(\*\*[^*]+\*\*)/)
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>
          : p
      )}
    </Text>
  )
}

// ─── Markdown レンダラー ──────────────────────────────────────────────────────
// AI の回答で実際に来る書式を受ける。扱えない書式は記号がそのまま本文に出る（表の |、
// 区切りの ---、#### の見出し、字下げした箇条書き）ので、行単位の判定はここに集める
const MD_HEADING = /^(#{1,6})\s+(.*)$/
const MD_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const MD_LIST_ITEM = /^(\s*)(?:[-*•]|(\d+)[.)])\s+(.*)$/
const MD_TABLE_ROW = /^\s*\|.*\|\s*$/

type MdBlock =
  | { kind: 'table'; header: string[] | null; rows: string[][] }
  | { kind: 'line'; line: string }

function mdTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

/** 連続する表の行を1つの表にまとめ、それ以外は1行ずつの塊にする */
function mdBlocks(text: string): MdBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: MdBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!MD_TABLE_ROW.test(lines[i])) {
      blocks.push({ kind: 'line', line: lines[i] })
      continue
    }
    const rows: string[][] = []
    let header: string[] | null = null
    for (; i < lines.length && MD_TABLE_ROW.test(lines[i]); i++) {
      const cells = mdTableCells(lines[i])
      // 見出しの下の区切り行（|---|:--:|）は描かず、直前の行を見出しとして扱う
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
        if (!header && rows.length === 1) header = rows.pop() ?? null
        continue
      }
      rows.push(cells)
    }
    i--
    blocks.push({ kind: 'table', header, rows })
  }
  return blocks
}

function MdText({ text, colors }: { text: string; colors: ReturnType<typeof useApp>['colors'] }) {
  return (
    <View style={{ gap: 4 }}>
      {mdBlocks(text).map((block, i) => {
        if (block.kind === 'table') {
          return (
            <View key={i} style={[md.table, { borderColor: colors.border }]}>
              {[...(block.header ? [block.header] : []), ...block.rows].map((cells, r) => {
                const isHeader = !!block.header && r === 0
                return (
                  <View
                    key={r}
                    style={[md.tableRow, { borderTopColor: colors.border }, r === 0 && md.tableRowFirst, isHeader && { backgroundColor: colors.chip }]}
                  >
                    {cells.map((cell, c) => (
                      <InlineText
                        key={c}
                        text={cell}
                        style={[md.tableCell, isHeader && md.tableHeaderCell, { color: colors.text }]}
                      />
                    ))}
                  </View>
                )
              })}
            </View>
          )
        }
        const { line } = block
        if (MD_RULE.test(line))
          return <View key={i} style={[md.rule, { backgroundColor: colors.border }]} />
        // 見出しにも **強調** が混ざって返ってくるため、本文と同じインライン処理を通す
        const heading = MD_HEADING.exec(line)
        if (heading) {
          const level = heading[1].length
          const style = level === 1 ? md.h1 : level === 2 ? md.h2 : md.h3
          return <InlineText key={i} text={heading[2]} style={[style, { color: colors.text }]} />
        }
        const item = MD_LIST_ITEM.exec(line)
        if (item) {
          // 字下げは2字で1段。深くしすぎると狭い画面で本文の幅が無くなるので3段で止める
          const depth = Math.min(3, Math.floor(item[1].replace(/\t/g, '  ').length / 2))
          return (
            <View key={i} style={[md.bulletRow, { paddingLeft: 2 + depth * 14 }]}>
              <Text style={[md.bullet, { color: colors.textSub }]}>{item[2] ? `${item[2]}.` : '•'}</Text>
              <InlineText text={item[3]} style={[md.bulletText, { color: colors.text }]} />
            </View>
          )
        }
        if (line.trim() === '')
          return <View key={i} style={{ height: 6 }} />
        return <InlineText key={i} text={line} style={[md.body, { color: colors.text }]} />
      })}
    </View>
  )
}
const md = StyleSheet.create({
  h1:        { fontSize: 18, fontWeight: '700', marginTop: 10, marginBottom: 4, letterSpacing: -0.3 },
  h2:        { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 2, letterSpacing: -0.2 },
  h3:        { fontSize: 14, fontWeight: '600', marginTop: 4 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bullet:    { fontSize: 14, lineHeight: 21, minWidth: 12 },
  bulletText:{ flex: 1, fontSize: 14, lineHeight: 21 },
  body:      { fontSize: 14, lineHeight: 21 },
  rule:      { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  table:     { borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.controlRadius, overflow: 'hidden', marginVertical: 4 },
  tableRow:  { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tableRowFirst: { borderTopWidth: 0 },
  tableCell: { flex: 1, fontSize: 13, lineHeight: 19, paddingHorizontal: 8, paddingVertical: 6 },
  tableHeaderCell: { fontWeight: '700' },
})

// ─── 動き ────────────────────────────────────────────────────────────────────
// 動きの間は Animated.delay を使わず isInteraction: false にする。InteractionManager を待たせると、
// runAfterInteractions に送った処理がその間ずっと走らなくなる

/** 下から浮き上がって現れる。animate が false なら最初から置いておく */
function useEntrance(animate: boolean, offset: number) {
  const { reduceMotion } = useApp()
  const run = animate && !reduceMotion
  const progress = useRef(new Animated.Value(run ? 0 : 1)).current
  useEffect(() => {
    if (!run) return
    Animated.timing(progress, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false,
    }).start()
  // マウントしたときの1回だけ動かす
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }],
  }
}

function FadeIn({ animate, children }: { animate: boolean; children: ReactNode }) {
  const style = useEntrance(animate, 4)
  return <Animated.View style={style}>{children}</Animated.View>
}

/** 送信と停止の入れ替え。key を替えて作り直すと、縮んだところから膨らんで現れる */
function PopIn({ animate, children }: { animate: boolean; children: ReactNode }) {
  const { reduceMotion } = useApp()
  const run = animate && !reduceMotion
  const scale = useRef(new Animated.Value(run ? 0.6 : 1)).current
  useEffect(() => {
    if (!run) return
    Animated.spring(scale, { toValue: 1, tension: 320, friction: 18, useNativeDriver: true, isInteraction: false }).start()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
}

/**
 * 流れてくる回答を一定の速さで見せる。受信を終えたあとも、追いつくまでは流し続ける。
 * 一度も流していない発言（履歴・挨拶）は最初から全文を出す
 */
function useStreamReveal(text: string, streaming: boolean): { shown: string; revealing: boolean } {
  const { reduceMotion } = useApp()
  const animatedRef = useRef(streaming)
  if (streaming) animatedRef.current = true
  const [length, setLength] = useState(() => (streaming ? 0 : text.length))
  const active = animatedRef.current && !reduceMotion
  useEffect(() => {
    if (reduceMotion) { setLength(text.length); return }
    if (!active || length >= text.length) return
    const timer = setTimeout(() => setLength((l) => nextRevealLength(l, text, !streaming)), REVEAL_TICK_MS)
    return () => clearTimeout(timer)
  }, [active, length, text, streaming, reduceMotion])
  if (!active) return { shown: text, revealing: false }
  const end = Math.min(length, text.length)
  return { shown: text.slice(0, end), revealing: end < text.length }
}

// ─── バブル ──────────────────────────────────────────────────────────────────
// AI発言はアバターなしの全幅表示（左列の空間を無駄にしない）。長押しでコピー。
// デスク添付はカード表示（タップで送信内容の全文を展開）。エラーは専用表示＋再送信。
function Bubble({ msg, colors, lang, onAddGadget, actionLabel, buyLinks, onOpenLink, onRetry, onReport, onRegenerate, showActions = false, streaming = false }: {
  msg: ChatMessage
  colors: ReturnType<typeof useApp>['colors']
  lang: 'ja' | 'en'
  onAddGadget?: () => void
  actionLabel?: string
  buyLinks?: PurchaseLink[]
  onOpenLink?: (link: PurchaseLink) => void
  onRetry?: () => void
  onReport?: () => void
  /** 最後の回答だけに付く。同じ質問でもう一度答えさせる */
  onRegenerate?: () => void
  /** 回答の下の操作列（コピー・もう一度・報告）。挨拶と表示途中の回答には出さない */
  showActions?: boolean
  /** この発言へ今まさに回答を書き足しているか */
  streaming?: boolean
}) {
  const isUser = msg.role === 'user'
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
  }, [])
  const [fresh] = useState(() => Date.now() - Date.parse(msg.createdAt) < ENTRANCE_FRESH_MS)
  // 自分の発言は入力欄から送り出したように大きめに浮かせ、回答はその場でにじませる
  const entrance = useEntrance(fresh, isUser ? 16 : 6)
  const { shown, revealing } = useStreamReveal(msg.content, streaming)
  // 回答の下の操作は書き終えてから出す。最初から出ている発言（履歴）は動かさない
  const [actionsHiddenAtMount] = useState(() => !showActions || streaming)
  const showFooter = !revealing
  const responseStatsLabel = aiResponseStatsLabel(msg.content, msg.responseStats, lang, streaming)

  const copy = () => {
    Clipboard.setString(msg.content)
    setCopied(true)
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null
      setCopied(false)
    }, 1200)
  }

  // エラー：会話とは区別された表示。再送信ボタン付き
  if (msg.isError) {
    return (
      <Animated.View style={[styles.errorBox, { backgroundColor: colors.danger + '1A', borderColor: colors.danger + '59' }, entrance]}>
        <AppIcon name="alert-circle-outline" size={16} color={colors.danger} />
        <Text style={[styles.errorText, { color: colors.danger }]} numberOfLines={4}>{msg.content}</Text>
        {/* colors.danger は面に載せる文字用。白い字の地にするとダークで 3:1 に届かない */}
        {onRetry && (
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: UI_STATUS_COLORS.danger }]} onPress={onRetry} activeOpacity={0.8} accessibilityRole="button">
            <AppIcon name={ICONS.retry} size={13} color="#fff" />
            <Text style={styles.retryText}>{lang === 'en' ? 'Retry' : '再試行'}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    )
  }

  if (isUser) {
    return (
      <Animated.View style={[styles.bubbleRow, styles.userRow, entrance]}>
        <View style={styles.userMsgWrap}>
          {msg.imageUri && (
            <Image source={{ uri: msg.imageUri }} style={styles.msgImage} resizeMode="cover" />
          )}
          {msg.planCard ? (
            <View style={{ gap: 6 }}>
              <TouchableOpacity
                style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setExpanded(v => !v)}
                activeOpacity={0.8}
              >
                <AppIcon name="desk" size={16} color={colors.accentIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planCardName, { color: colors.text }]} numberOfLines={1}>{msg.planCard.name}</Text>
                  {/* 投稿者は他人のデスクのときだけ入る。会話を後から読み返したときに、
                      自分のデスクの診断と取り違えないための印 */}
                  <Text style={[styles.planCardMeta, { color: colors.textMuted }]}>
                    {lang === 'en'
                      ? `Desk analysis · ${msg.planCard.count} ${msg.planCard.count === 1 ? 'item' : 'items'}${msg.planCard.author ? ` · by ${msg.planCard.author}` : ''}`
                      : `デスク分析 · ${msg.planCard.count}台${msg.planCard.author ? ` · ${msg.planCard.author}` : ''}`}
                  </Text>
                </View>
                <AppIcon name={expanded ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={colors.textMuted} />
              </TouchableOpacity>
              {expanded && (
                <View style={[styles.planCardDetail, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <MdText text={msg.content} colors={colors} />
                </View>
              )}
              {!!msg.planCard.comment && (
                <View style={[styles.userBubble, { backgroundColor: colors.card }]}>
                  <Text style={[styles.userText, { color: colors.text }]}>{msg.planCard.comment}</Text>
                </View>
              )}
            </View>
          ) : (msg.content || !msg.imageUri) ? (
            <View style={[styles.userBubble, { backgroundColor: colors.card }]}>
              <Text style={[styles.userText, { color: colors.text }]}>{msg.content}</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    )
  }

  // AI発言：全幅表示
  return (
    <Animated.View style={entrance}>
      <CoachAnchor id="ai-answer"><Pressable
        onLongPress={() => {
          hapticMedium()
          copy()
        }}
        delayLongPress={PRESS_INTERACTION.longPressDelay}
        style={styles.aiMsgWrap}
      >
        <MdText text={shown} colors={colors} />
        {responseStatsLabel && (
          <Text style={[styles.aiResponseStats, { color: colors.textMuted }]}>
            {responseStatsLabel}
          </Text>
        )}
        {/* 商品の提案と操作は、本文を流し終えてからまとめてにじませる。
            本文より先に出ると、まだ読めていない商品の購入ボタンが現れることになる */}
        {showFooter && (
          <FadeIn animate={actionsHiddenAtMount}>
            {/* 提案→行動。勧められた商品はまだ持っていないのが普通なので、
                「探す」を先に置き、デスクへ入れて配線を見る導線をその後に置く */}
            {buyLinks && buyLinks.length > 0 && onOpenLink && (
              <View style={styles.suggestActionRow}>
                {buyLinks.map((link) => (
                  <TouchableOpacity
                    key={link.url}
                    style={[styles.addGadgetChip, { borderColor: colors.accentIcon }]}
                    onPress={() => onOpenLink(link)}
                    activeOpacity={0.7}
                  >
                    <AppIcon name={ICONS.openExternal} size={15} color={colors.accentText} />
                    <Text style={[styles.addGadgetChipText, { color: colors.accentText }]}>{purchaseLinkLabel(link, lang)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {onAddGadget && (
              <TouchableOpacity
                style={[styles.addGadgetChip, { borderColor: colors.border }]}
                onPress={onAddGadget}
                activeOpacity={0.7}
              >
                <AppIcon name="plus-circle-outline" size={15} color={colors.textSub} />
                <Text style={[styles.addGadgetChipText, { color: colors.textSub }]}>{actionLabel}</Text>
              </TouchableOpacity>
            )}
            {/* 広告である旨はリンクを見る場所に出す（規約ページに書くだけでは足りない） */}
            {buyLinks && !!affiliateDisclosure(buyLinks, lang) && (
              <Text
                style={[styles.affiliateDisclosure, { color: colors.textSub }]}
                maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              >
                {affiliateDisclosure(buyLinks, lang)}
              </Text>
            )}
            {/* 回答の下の操作。長押しのコピーは見つけにくいので、よく使う操作は常に見せる
                （有名なAIアプリと同じ置き方）。報告もここへ寄せ、回答ごとの操作を1列にまとめる */}
            {showActions && (
              <CoachAnchor id="ai-answer-actions"><View style={styles.aiActions}>
                <TouchableOpacity
                  style={styles.aiActionBtn}
                  onPress={copy}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={copied ? (lang === 'en' ? 'Copied' : 'コピーしました') : (lang === 'en' ? 'Copy response' : '回答をコピー')}
                >
                  <AppIcon name={copied ? ICONS.check : ICONS.copy} size={16} color={copied ? colors.accentText : colors.textMuted} />
                </TouchableOpacity>
                {onRegenerate && (
                  <TouchableOpacity
                    style={styles.aiActionBtn}
                    onPress={onRegenerate}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={lang === 'en' ? 'Regenerate response' : 'もう一度回答させる'}
                    accessibilityHint={lang === 'en' ? 'Uses your shared weekly AI allowance' : '今週のAI利用枠を使います'}
                  >
                    <AppIcon name={ICONS.retry} size={17} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
                {onReport && (
                  <TouchableOpacity
                    style={styles.aiActionBtn}
                    onPress={onReport}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={lang === 'en' ? 'Report this AI response' : 'このAI回答を報告'}
                  >
                    {/* 赤丸の「！」はアプリ全体で失敗の印。回答の下に置くと回答が壊れたように見える */}
                    <AppIcon name={ICONS.report} size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View></CoachAnchor>
            )}
          </FadeIn>
        )}
      </Pressable></CoachAnchor>
    </Animated.View>
  )
}

function AIConsentModal({ visible, lang, colors, foreignDesk, onAccept, onDecline }: {
  visible: boolean
  lang: string
  colors: ReturnType<typeof useApp>['colors']
  /** 他人の公開デスクを添付しているか。何を送るかの説明が変わる */
  foreignDesk: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.consentBackdrop}>
        <View style={[styles.consentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <AppIcon name="shield-check-outline" size={30} color={colors.accentIcon} />
          <Text style={[styles.consentTitle, { color: colors.text }]}>
            {lang === 'en' ? 'Before using the AI coach' : 'AIコーチを利用する前に'}
          </Text>
          <Text style={[styles.consentBody, { color: colors.textSub }]}>
            {foreignDesk
              // 他人のデスクを添付しているときは「何を送らないか」を先に言う。
              // 自分のデスク向けの文をそのまま出すと、直前に第三者の情報を送らないよう
              // 求めておきながら第三者のデスクを送ることになり、案内が食い違う
              ? lang === 'en'
                ? "We send this public desk's name, purpose, gear, wiring and your text to Anthropic. Prices, dates and owner details are excluded. Do not enter passwords, identity documents, payment details or anyone else's personal data."
                : '公開中のデスク名・用途・機材・配線と入力文をAnthropicへ送ります。価格・購入日・投稿者情報は送りません。パスワード・本人確認書類・決済情報・他人の個人情報は入力しないでください。'
              : lang === 'en'
                ? "We send your text, photos and selected desk data to Anthropic. Do not send passwords, identity documents, payment details or anyone else's personal data."
                : '入力文・写真と、選んだデスク情報をAnthropicへ送ります。パスワード・本人確認書類・決済情報・他人の個人情報は送らないでください。'}
          </Text>
          <TouchableOpacity onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
            <Text style={[styles.consentPrivacyLink, { color: colors.accentText }]}>
              {lang === 'en' ? 'View Privacy Policy' : 'プライバシーポリシーを確認'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.consentAccept, { backgroundColor: colors.accent }]} onPress={onAccept}>
            <Text style={[styles.consentAcceptText, { color: colors.onAccent }]}>{lang === 'en' ? 'Agree and continue' : '同意して利用する'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.consentDecline} onPress={onDecline}>
            <Text style={[styles.consentDeclineText, { color: colors.textSub }]}>{lang === 'en' ? 'Don\'t use' : '利用しない'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function AIContextSelectionModal({ visible, lang, colors, value, foreignDesk, gadgetCount, mode, onChange, onClose, onConfirm }: {
  visible: boolean
  lang: 'ja' | 'en'
  colors: ReturnType<typeof useApp>['colors']
  value: AIContextSelection
  /** 他人の公開デスクを添付しているか。価格と日付は選ばせずに送らない */
  foreignDesk: boolean
  gadgetCount: number
  mode: 'edit' | 'send'
  onChange: (value: AIContextSelection) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const allRows: Array<{ key: keyof AIContextSelection; ja: string; en: string; jaSub: string; enSub: string }> = [
    { key: 'includeGear', ja: '機材と仕様', en: 'Gear and specifications', jaSub: `機材名・数量・所有／候補・仕様・ポート確認状況（最大${Math.min(gadgetCount, 50)}件）`, enSub: `Names, quantities, owned/candidate status, specs, and port verification (up to ${Math.min(gadgetCount, 50)} entries)` },
    { key: 'includeWiring', ja: '配線情報', en: 'Wiring information', jaSub: '接続・本数・分岐・使用ケーブル・長さ・経路・警告・コンセント数', enSub: 'Connections, counts, branches, cable choice, length, route, warnings, and outlets' },
    { key: 'includeFinancial', ja: '価格情報', en: 'Financial information', jaSub: '記録価格×数量・小計・所有／候補ごとの合計', enSub: 'Recorded unit prices, quantities, subtotals, and owned/candidate totals' },
    { key: 'includeDates', ja: '導入日・デスク履歴', en: 'Introduction dates and desk history', jaSub: '導入日・利用期間と手入力／自動記録の区別', enSub: 'Introduction dates and usage periods, distinguished as manual or automatic' },
  ]
  // 他人のデスクでは価格と日付のトグルごと出さない。オフのまま見せると「入れれば送れる」に
  // 読めるが、送信側（sendWithContext）で落としているので、出す方が嘘になる
  const rows = foreignDesk
    ? allRows.filter((row) => row.key !== 'includeFinancial' && row.key !== 'includeDates')
    : allRows
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.consentBackdrop}>
        <View style={[styles.contextCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.consentTitle, { color: colors.text }]}>
            {lang === 'en' ? 'Data sent to the AI' : 'AIへ送信する情報'}
          </Text>
          <Text style={[styles.contextIntro, { color: colors.textSub }]}>
            {foreignDesk
              ? lang === 'en'
                ? 'The desk name and purpose are always included. Prices and purchase dates are never sent for another user’s desk.'
                : 'デスク名とデスクの用途は常に含みます。他の人のデスクでは、価格と購入日は送信しません。'
              : lang === 'en'
                ? 'Name and purpose are always sent. Prices and dates are off by default.'
                : 'デスク名と用途は常に送信します。価格と日付は初期状態でオフです。'}
          </Text>
          <View style={styles.contextRows}>
            {rows.map((row) => (
              <View key={row.key} style={[styles.contextRow, { borderBottomColor: colors.divider }]}>
                <View style={styles.contextRowText}>
                  <Text style={[styles.contextLabel, { color: colors.text }]}>{lang === 'en' ? row.en : row.ja}</Text>
                  <Text style={[styles.contextSub, { color: colors.textSub }]}>{lang === 'en' ? row.enSub : row.jaSub}</Text>
                </View>
                <ContrastToggle
                  value={value[row.key]}
                  onValueChange={(enabled) => onChange({ ...value, [row.key]: enabled })}
                  colors={colors}
                  accessibilityLabel={lang === 'en' ? row.en : row.ja}
                />
              </View>
            ))}
          </View>
          <TouchableOpacity style={[styles.consentAccept, { backgroundColor: colors.accent }]} onPress={onConfirm}>
            <Text style={[styles.consentAcceptText, { color: colors.onAccent }]}>
              {mode === 'send'
                ? (lang === 'en' ? 'Continue to send' : 'この内容で送信へ進む')
                : (lang === 'en' ? 'Save selection' : '選択を保存')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.consentDecline} onPress={onClose}>
            <Text style={[styles.consentDeclineText, { color: colors.textSub }]}>{lang === 'en' ? 'Cancel' : 'キャンセル'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ─── 考え中の印（脈打つ1つの点）──────────────────────────────────────────────
// 有名なAIアプリと同じく、回答が書き出される位置に点を1つ置いて呼吸させる。
// 3点が跳ねる形はメッセージアプリの「相手が入力中」の印で、AIの回答待ちとは読まれ方が違う
function ThinkingDot({ colors }: { colors: ReturnType<typeof useApp>['colors'] }) {
  const { reduceMotion, lang } = useApp()
  const startedAt = useRef(Date.now()).current
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const pulse = useRef(new Animated.Value(0)).current
  const appear = useEntrance(true, 0)

  useEffect(() => {
    // バックグラウンドや処理負荷で更新が遅れても、実際の待ち時間を表示する。
    const timer = setInterval(() => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  useEffect(() => {
    if (reduceMotion) return
    const ease = Easing.inOut(Easing.sin)
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, easing: ease, useNativeDriver: true, isInteraction: false }),
        Animated.timing(pulse, { toValue: 0, duration: 650, easing: ease, useNativeDriver: true, isInteraction: false }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [pulse, reduceMotion])

  return (
    <Animated.View style={[styles.thinkingWrap, appear]}>
      <Animated.View
        style={[
          styles.thinkingDot,
          {
            backgroundColor: colors.text,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) }],
          },
        ]}
      />
      <Text style={[styles.thinkingText, { color: colors.textMuted }]}>
        {lang === 'ja' ? `考え中 · ${elapsedSeconds}秒` : `Thinking · ${elapsedSeconds}s`}
      </Text>
    </Animated.View>
  )
}

// ─── プラン選択モーダル ────────────────────────────────────────────────────────
function PlanSelector({
  visible, plans, gadgets, onSelect, onClose, colors, lang,
}: {
  visible: boolean; plans: DeskPlan[]
  /** 台数からケーブルを除くために引く（マイデスクの一覧と同じ数え方） */
  gadgets: Gadget[]
  onSelect: (p: DeskPlan) => void; onClose: () => void
  colors: ReturnType<typeof useApp>['colors']
  lang: string
}) {
  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} sheetStyle={styles.sheet}>
        <Text style={[styles.sheetTitle, { color: colors.text }]}>{lang === 'en' ? 'Select a Desk to Analyze' : '分析するデスクを選択'}</Text>
        {plans.length === 0
          ? <Text style={[styles.sheetEmpty, { color: colors.textSub }]}>{lang === 'en' ? 'No desks yet' : 'デスクがまだありません'}</Text>
          : plans.map(plan => (
            <TouchableOpacity
              key={plan.id}
              style={[styles.planRow, { borderBottomColor: colors.divider ?? '#E5E5EA' }]}
              onPress={() => { onSelect(plan); onClose() }}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.planName, { color: colors.text }]}>{plan.name}</Text>
                <Text style={[styles.planMeta, { color: colors.textSub }]}>
                  {(() => {
                    const count = gadgets.filter((g) => plan.selectedGadgetIds.includes(g.id) && countsAsDevice(g)).length
                    return lang === 'en' ? `${count} ${count === 1 ? 'item' : 'items'}` : `${count}台`
                  })()}
                </Text>
              </View>
              <AppIcon name={ICONS.chevronRight} size={18} color={colors.chevron ?? '#C7C7CC'} />
            </TouchableOpacity>
          ))
        }
        <TouchableOpacity
          style={[styles.cancelBtn, { borderTopColor: colors.divider ?? '#E5E5EA' }]}
          onPress={onClose}
        >
          <Text style={{ color: colors.text, fontSize: 16 }}>{lang === 'en' ? 'Cancel' : 'キャンセル'}</Text>
        </TouchableOpacity>
    </BottomSheetModal>
  )
}

// 添付の無い会話の挨拶文。初回ロードと「新しい会話」の両方から使う
function defaultGreetingText(lang: 'ja' | 'en'): string {
  return lang === 'en'
    ? 'Ask about your desk setup. Select one with **Analyze Desk**, then send your question.'
    : 'デスク環境について相談できます。「**デスクを分析**」で対象を選び、質問を送ってください。'
}

// ─── メイン ────────────────────────────────────────────────────────────────────
export function AICoachChatScreen({ navigation, route }: Props) {
  // キーボードを避ける量はウィンドウの上端から測られるので、ヘッダーの実寸を渡す。
  // 90 で決め打ちしていた頃は、ヘッダーの高さが違う端末（iPad で動かす iPhone 版など）で
  // 入力欄が隠れるか、キーボードとの間に隙間が空いていた
  const headerHeight = useHeaderHeight()
  const { colors, lang, fmtPrice, reduceMotion } = useApp()
  // 入力欄まわりは、出し入れ（候補・添付・注意書き）で高さが変わる。その場で消すと入力欄が
  // 瞬間移動するので、出入りはにじませ、残る部品は新しい位置まで滑らせる
  const enter = reduceMotion ? undefined : LayoutFadeIn.duration(180)
  const exit = reduceMotion ? undefined : LayoutFadeOut.duration(140)
  const relayout = reduceMotion ? undefined : LinearTransition.duration(220)
  const { canUse, tokenCount, tokenLimit, usedRatio, nearLimit, resetDate, consume, applyUsage, refresh, loaded, isPro } = useAIUsageLimit()
  // 課金直後は RevenueCat が pro でも profiles.tier がまだ free のことがある。
  // その間は「Pro限定」ではなく「反映待ち」として扱わないと、課金済みの人に
  // アップグレードを促すことになる（判定の正本はサーバー側の isPro のまま）
  const { isPro: billingPro, syncServerTier } = useSubscription()
  const resetLabel = formatResetDate(resetDate, lang)
  const showUsageLimit = useCallback(() => {
    Alert.alert(
      lang === 'en' ? 'Weekly Limit Reached' : 'AI利用上限に到達',
      lang === 'en'
        ? `You've reached this week's AI usage limit. Resets ${resetLabel}.`
        : `今週のAI利用量の上限に達しました。${resetLabel}にリセットされます。`,
      [{ text: 'OK' }],
    )
  }, [lang, resetLabel])
  // 現在のFree枠は0。将来サーバーがFreeへ利用枠を返した場合は canUse が true になり、
  // アプリ更新なしでその枠だけ使える。判定が終わる前は操作を許可しない。
  const aiAccessAllowed = hasAIAccess({ loaded, isPro, canUse })
  const proLocked = shouldShowAIPaywall({ loaded, isPro, canUse })
  // 購入は通っているのに Webhook が profiles.tier に届いていない状態
  const tierSyncing = proLocked && billingPro
  // 待つだけでは直らないことがある（Webhook の不達・イベントの出ない復元・更新の取りこぼし）。
  // サーバーに RevenueCat を引き直させる。時間が掛かるので、反映待ちに入ったときとバナーを押したときだけ
  const recheckServerTier = useCallback(() => {
    void syncServerTier().then(() => refresh())
  }, [refresh, syncServerTier])
  const tierSyncStartedRef = useRef(false)
  useEffect(() => {
    if (!tierSyncing) { tierSyncStartedRef.current = false; return }
    if (tierSyncStartedRef.current) return
    tierSyncStartedRef.current = true
    recheckServerTier()
  }, [recheckServerTier, tierSyncing])

  const conversationId = route?.params?.conversationId
  const initialPlanId  = route?.params?.planId
  const publicDeskId   = route?.params?.publicDeskId ?? null
  // 公開デスクから開いたぶんはルートのスタックに積まれていて、相談履歴もガジェット登録も
  // 同じスタックに無い。型は3つのスタックで共通なので、ここで導線ごと出し分ける
  const rootMounted    = publicDeskId != null
  const convIdRef      = useRef(conversationId ?? newConversationId())
  const newChatConfirmationRef = useRef<object | null>(null)

  const [messages,      setMessages]      = useState<ChatMessage[]>([])
  const [input,         setInput]         = useState('')
  const [isLoading,     setIsLoading]     = useState(false)
  // デスクとガジェットはストア（メモリ）から読む。ディスクを1回読むだけにしていた頃は、
  // 提案から「追加」でガジェットを足して戻っても、足す前の構成で診断していた
  // （保存はメモリが先でディスクは後なので、開いた直後の読み込みも古いことがある）
  const { plans, loading: plansLoading } = usePlans()
  // 「分析するデスクを選択」はマイデスクと同じ並びにする（作った順のままだと位置が違う）
  const planOpenedAt = usePlanOpenedAt()
  const pickerPlans = useMemo(() => sortPlansLikeMyDesk(plans, planOpenedAt), [plans, planOpenedAt])
  const { gadgets } = useGadgets()
  const [planSelector,  setPlanSelector]  = useState(false)
  // 添付は id で持つ。コピーを持つと、添付したあとの編集が送る内容に入らない
  const [attachedPlanId, setAttachedPlanId] = useState<string | null>(null)
  // 他人のデスクは手元のストアに無いので、id ではなく取得したモデルを添付の実体にする。
  // 自分のデスクとは別の state に持つ：公開するとデスクの id がそのまま desks.id になるため、
  // 同じ欄に入れると自分のデスクを引く find が先に当たることがある
  const [attachedPublicDesk, setAttachedPublicDesk] = useState(false)
  const { desk: publicDesk, loading: publicDeskLoading } = useDeskDetail(publicDeskId)
  // 公開デスクの plan / gadgets への変換は重い（配線の再構築を含む）。
  // desk が同じうちは作り直さない
  const publicModel = useMemo(
    () => (publicDesk ? toPublicDeskModel(publicDesk) : null),
    [publicDesk],
  )
  const publicDeskLabel = useMemo(() => {
    if (!publicDesk) return null
    return {
      // 公式デモは一覧と同じ表示名にする。desk.title は日本語のまま入っている
      name:   localizedDemoDeskName(publicDesk.id, publicDesk.title, lang),
      author: formatPublicAuthor(publicDesk.owner_name, publicDesk.owner_tag),
    }
  }, [publicDesk, lang])

  const attachedPublicModel = attachedPublicDesk ? publicModel : null
  /** 他人のデスクを添付しているか。送る項目・提案の操作・配線の作り直しがこれで変わる */
  const attachedIsForeign = attachedPublicModel != null
  const attachedPlan = useMemo(
    () => attachedPublicModel?.plan
      ?? (attachedPlanId ? plans.find((p) => p.id === attachedPlanId) ?? null : null),
    [attachedPlanId, plans, attachedPublicModel],
  )
  /**
   * 添付したデスクの機材。自分のデスクは手元のライブラリから引くが、他人のデスクの機材は
   * ライブラリに無いので公開スナップショット側を使う。ここを gadgets のままにすると
   * plan.selectedGadgetIds が1台も引けず、機材ゼロのデスクとして送ることになる
   */
  const attachedGadgets: Gadget[] = attachedPublicModel?.selectedGadgets ?? gadgets
  const clearAttachedDesk = useCallback(() => {
    setAttachedPlanId(null)
    setAttachedPublicDesk(false)
  }, [])

  const [attachedImage, setAttachedImage] = useState<{ uri: string; base64: string; type: string } | null>(null)
  const [pickingImage, setPickingImage] = useState(false)
  const [aiConsentGranted, setAIConsentGranted] = useState(false)
  const [showAIConsent, setShowAIConsent] = useState(false)
  const [contextSelection, setContextSelection] = useState<AIContextSelection>(DEFAULT_AI_CONTEXT_SELECTION)
  const [showContextSelection, setShowContextSelection] = useState(false)
  const [contextSelectionMode, setContextSelectionMode] = useState<'edit' | 'send'>('edit')
  const pendingContextTextRef = useRef<string | undefined>(undefined)
  const requestInFlightRef = useRef(false)
  const historyReadInFlightRef = useRef(false)
  const imagePickerInFlightRef = useRef(false)
  const pendingConsentSendRef = useRef<{
    text: string
    image?: { uri: string; base64: string; type: string }
    planCard?: ChatMessage['planCard']
    /** 入力欄から送った文。候補のチップなど入力欄以外から送ったときは null */
    sentInput: string | null
  } | null>(null)

  // stale closure 対策: messagesRef で常に最新の messages を参照
  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    void hasAIDataConsent().then(setAIConsentGranted)
  }, [])

  const flatListRef = useRef<FlatList>(null)
  // 送信と停止の入れ替えだけ動かす。画面を開いた瞬間に送信ボタンが膨らむと、押せる状態か迷わせる
  const sendButtonMountedRef = useRef(false)
  useEffect(() => { sendButtonMountedRef.current = true }, [])

  // 最後のアシスタント発言が商品を勧めているときだけ購入導線を出す。
  // renderItem の中で毎回引き直すと、リンク解決の副作用を掛ける先が無い
  const suggestedProduct = useMemo(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || last.isError || messages.length < 2) return null
    return extractSuggestedProductName(last.content)
  }, [messages])
  const [suggestedLinks, setSuggestedLinks] = useState<PurchaseLink[]>([])
  useEffect(() => {
    if (!suggestedProduct) {
      setSuggestedLinks([])
      return
    }
    const country = lang === 'en' ? 'US' : 'JP'
    // 商品マスタへの問い合わせは数百msかかる。待つとチップが後から生えて吹き出しが伸びるので、
    // 問い合わせ無しで決まるぶん（キャッシュ・検索リンク）を先に出して後から上書きする
    setSuggestedLinks(resolvePurchaseLinksSync({ name: suggestedProduct }, { country }))
    let alive = true
    void resolvePurchaseLinks({ name: suggestedProduct }, { country })
      .then((links) => { if (alive) setSuggestedLinks(links) })
      .catch(() => {})
    return () => { alive = false }
  }, [suggestedProduct, lang])

  const openSuggestedLink = useCallback((link: PurchaseLink) => {
    const props = { placement: 'ai_coach', shop: link.shop, ...linkProperties(link.url) }
    analytics.track(EVENTS.AFFILIATE_LINK_OPENED, props)
    // WebBrowser ではなく Linking にする。Amazon のモバイル・アプリケーション・ポリシーは
    // アプリ内で Amazon のページを描画することを禁じており、Amazon アプリ側で開く方が確実
    Linking.openURL(link.url).catch((error) => {
      analytics.track(EVENTS.AFFILIATE_LINK_OPEN_FAILED, { ...props, ...errorProperties(error) })
      Alert.alert(lang === 'en' ? 'Could not open the link' : 'リンクを開けませんでした')
    })
  }, [lang])

  // 初期ロード。挨拶文に添付したデスクの名前を出すので、デスクの読み込みを待ってから1回だけ走らせる。
  // 読めなかった場合も loading は外れる（AIコーチは添付できるデスクが無いだけで成立する）
  const initializedRef = useRef(false)
  useEffect(() => {
    if (plansLoading || initializedRef.current) return
    // 公開デスクから開いたときは、その取得も待つ。先に挨拶文を書いてしまうと
    // デスク名の入らない汎用の挨拶が残り、あとから添付だけが現れることになる
    if (publicDeskId && publicDeskLoading) return
    initializedRef.current = true
    void (async () => {
      // デスク画面から開かれた場合はそのデスクを添付済みにしておく。
      // 送信は user が押す（開いただけでAI利用枠を消費させない）
      const presetPlan = initialPlanId ? plans.find(p => p.id === initialPlanId) ?? null : null
      if (presetPlan) setAttachedPlanId(presetPlan.id)
      if (publicDeskId && publicDeskLabel) setAttachedPublicDesk(true)

      if (conversationId) {
        // 既存会話を復元
        const conv = await getConversation(conversationId)
        if (conv) {
          setMessages(conv.messages)
          messagesRef.current = conv.messages
        }
      } else {
        // 新規: 挨拶メッセージ
        const greeting: ChatMessage = {
          id:        newMessageId(),
          role:      'assistant',
          content:   publicDeskLabel
            ? (lang === 'en'
                ? `**${publicDeskLabel.name}** by ${publicDeskLabel.author} is attached. Send it as is for a full review, or ask what you want to know — for example which parts would suit your own desk.`
                : `${publicDeskLabel.author} さんの **${publicDeskLabel.name}** を添付しました。そのまま送れば構成全体を診断します。「自分のデスクに取り入れるなら？」のように聞くこともできます。`)
            : publicDeskId
            ? (lang === 'en'
                ? 'This desk could not be loaded. It may have been made private or deleted.'
                : 'このデスクを読み込めませんでした。非公開になったか、削除された可能性があります。')
            : presetPlan
            ? (lang === 'en'
                ? `**${presetPlan.name}** is attached. Send it as is for a full review, or add what you want to know first.`
                : `**${presetPlan.name}** を添付しました。そのまま送れば構成全体を診断します。聞きたいことがあれば書き添えてください。`)
            : defaultGreetingText(lang),
          createdAt: new Date().toISOString(),
        }
        setMessages([greeting])
        messagesRef.current = [greeting]
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansLoading, publicDeskLoading])

  // Paywall で購入してから戻ってきたときに、サーバーの利用枠と Pro 判定を取り直す。
  // このフックは画面ごとに別の state を持つので、戻ってきただけでは古い値のままになる
  useFocusEffect(
    useCallback(() => {
      void refresh()
      return () => { newChatConfirmationRef.current = null }
    }, [refresh]),
  )

  // ── 自動スクロール：最下部にいるときだけ追従。読み返し中は「新着」ピルを出す ──
  const atBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
   
  const onListScroll = (e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const dist = contentSize.height - layoutMeasurement.height - contentOffset.y
    atBottomRef.current = dist < 80
    if (atBottomRef.current) setShowJump(false)
  }
  // キーボードが開いて一覧が縮んでも、スクロール位置はそのままなので最後の回答の下が裏に入る。
  // 一番下を読んでいたときだけ下端へ合わせ直す
  const listHeightRef = useRef(0)
  const onListLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height
    const shrank = listHeightRef.current > 0 && height < listHeightRef.current
    listHeightRef.current = height
    if (shrank && atBottomRef.current) flatListRef.current?.scrollToEnd({ animated: false })
  }

  // ── 流れてくる回答の表示 ──
  // 回答を書いている途中か。送信ボタンを停止ボタンに替えるのに使う
  const [streaming, setStreaming] = useState(false)
  // 今つくっている回答の id。届いた文字はこの発言に足していく
  const streamMsgIdRef = useRef<string | null>(null)
  // 届いた差分は溜めて、まとめて反映する。1文字ごとに setMessages すると
  // そのたびに Markdown を組み直すことになり、長い回答で指の操作が止まる
  const pendingTextRef = useRef('')
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushStreamText = useCallback(() => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
    const text = pendingTextRef.current
    const id = streamMsgIdRef.current
    if (!text || !id) return
    pendingTextRef.current = ''
    const updated = messagesRef.current.map(m => (m.id === id ? { ...m, content: m.content + text } : m))
    messagesRef.current = updated
    setMessages(updated)
  }, [])

  /** 表示中の回答を今の内容で確定させる。停止・完了・失敗のいずれでも通る */
  const endStream = useCallback(() => {
    flushStreamText()
    pendingTextRef.current = ''
    streamMsgIdRef.current = null
    setStreaming(false)
  }, [flushStreamText])

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
  }, [])

  // ── API呼び出しの共通処理（送信・再送信で共用）──
  const lastImageRef = useRef<{ uri: string; base64: string; type: string } | null>(null)
  const lastHistoryEnabledRef = useRef(true)
  // 捨てた依頼の返事を無視するための番号。新しい会話を始めるたびに進め、返事が届いた時点で
  // 番号が変わっていれば表示も保存もしない
  const requestTokenRef = useRef(0)
  // 走っている依頼を切るためのもの。停止ボタンと「新しい会話」から使う
  const streamAbortRef = useRef<AbortController | null>(null)

  // 会話の保存（エラーは保存しない。タイトルは添付コメント優先）。
  // 返事を受け取ったときと、表示の途中で停止して回答を切ったときの両方から呼ぶ
  const persistConversation = useCallback(async (finalMessages: ChatMessage[], saveHistory: boolean) => {
    if (!saveHistory) return
    const firstUser = finalMessages.find(m => m.role === 'user')
    const title = firstUser?.planCard
      ? (firstUser.planCard.comment
          ? deriveTitle(firstUser.planCard.comment, lang)
          : lang === 'en' ? `${firstUser.planCard.name} analysis` : `${firstUser.planCard.name}の分析`)
      : deriveTitle(firstUser?.content || '', lang)
    const conv: StoredConversation = {
      id:        convIdRef.current,
      title,
      messages:  finalMessages.filter(m => !m.isError),
      createdAt: finalMessages[0]?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await saveConversation(conv)
  }, [lang])

  const runRequest = useCallback(async (
    nextMessages: ChatMessage[],
    image?: { uri: string; base64: string; type: string },
    skipConsume = false,
    saveHistory = true,
  ) => {
    if (!aiAccessAllowed) {
      if (!loaded || tierSyncing) void refresh()
      else navigation.navigate('Paywall', { reason: 'aiFeatures' })
      return
    }
    if (requestInFlightRef.current) return
    requestInFlightRef.current = true
    const token = ++requestTokenRef.current
    setIsLoading(true)
    const startedAt = Date.now()
    let firstResponseMs: number | undefined
    // 停止ボタンと「新しい会話」から切れるように、依頼の外側で持つ
    const controller = new AbortController()
    streamAbortRef.current = controller
    try {
      const lastUser = [...nextMessages].reverse().find(m => m.role === 'user')
      // 履歴から開き直すとメモリ上の写真は無い。文だけで再送せず、保存済みの写真を復元する。
      if (!image && lastUser?.imageUri) image = await loadAIConversationImage(lastUser.imageUri)
      if (token !== requestTokenRef.current || controller.signal.aborted) return
      lastImageRef.current = image ?? null
      if (!skipConsume) {
        const allowed = await consume()
        if (!allowed) {
          trackLimitHit('aiChatPerPeriod', { current: tokenCount, max: tokenLimit, placement: 'ai_chat_request' })
          // 送信を待つ間に会話から離れていたら、離れた先の画面に課金画面を出さない
          if (isPro) showUsageLimit()
          else if (navigation.isFocused()) navigation.navigate('Paywall', { reason: 'aiFeatures' })
          return
        }
      }
      if (token !== requestTokenRef.current || controller.signal.aborted) return
      // エラーメッセージはAPIへ送る文脈から除外する
      const apiMessages = buildConversationMessages(nextMessages, lang, image)
      // 最初の差分が届いた時点で「考え中」を消し、空の回答を置いてそこへ足していく。
      // 先に置いてしまうと、返事を待っている間ずっと空の吹き出しが残る
      const beginStream = () => {
        if (streamMsgIdRef.current) return
        firstResponseMs = Math.max(0, Date.now() - startedAt)
        const id = newMessageId()
        streamMsgIdRef.current = id
        const started: ChatMessage[] = [
          ...messagesRef.current,
          { id, role: 'assistant', content: '', createdAt: new Date().toISOString(), responseStats: { firstResponseMs } },
        ]
        messagesRef.current = started
        setMessages(started)
        setIsLoading(false)
        setStreaming(true)
      }
      const response = await sendChatMessage(
        apiMessages,
        lang,
        lastUser?.requestId ?? Crypto.randomUUID(),
        {
          onDelta: (text) => {
            if (token !== requestTokenRef.current) return
            beginStream()
            pendingTextRef.current += text
            if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flushStreamText, STREAM_FLUSH_MS)
          },
          onReplace: (text) => {
            if (token !== requestTokenRef.current) return
            beginStream()
            // 差し替えは安全性の検査に掛かったとき。溜めてある続きは出さずに捨てる
            pendingTextRef.current = ''
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null }
            const id = streamMsgIdRef.current
            const updated = messagesRef.current.map(m => (m.id === id ? { ...m, content: text } : m))
            messagesRef.current = updated
            setMessages(updated)
          },
        },
        controller.signal,
      )
      const totalMs = Math.max(0, Date.now() - startedAt)
      const responseStats: AIResponseStats = { firstResponseMs: firstResponseMs ?? totalMs, totalMs }
      applyUsage(response.usage)
      if (token !== requestTokenRef.current) return
      analytics.track(EVENTS.AI_FEATURE_USED, {
        feature:       image ? 'chat_photo' : 'chat',
        is_pro:        isPro,
        // 公開デスクからの入口が使われているか。行き止まり（Paywall）か入口かの判断に要る
        from_public_desk: rootMounted,
        is_retry:      skipConsume,
        turn_count:    apiMessages.length,
        msg_used:      response.usage?.msgCount,
        photo_used:    response.usage?.photoCount,
        duration_ms:   Date.now() - startedAt,
      })

      // 表示は届いた差分の積み上げ、保存はサーバーが返した全文。取りこぼしがあってもここで揃う
      const streamId = streamMsgIdRef.current
      endStream()
      const finalMessages: ChatMessage[] = streamId
        ? messagesRef.current.map(m => (m.id === streamId ? { ...m, content: response.content, responseStats } : m))
        : [...messagesRef.current, {
            id:        newMessageId(),
            role:      'assistant',
            content:   response.content,
            createdAt: new Date().toISOString(),
            responseStats,
          }]
      messagesRef.current = finalMessages
      setMessages(finalMessages)
      await persistConversation(finalMessages, saveHistory)
    } catch (e) {
      if (token !== requestTokenRef.current) return
      // 停止したかどうかは投げられた中身ではなく、自分が切ったかどうかで判断する
      // （中断のエラーの形は端末側の実装で変わる）
      if (controller.signal.aborted) {
        // 停止しても送信した1回はサーバーで消費されるが、done が届かないので枠の表示は
        // 送る前のまま残る。取り直さないと「残り1回」と出たまま送ると弾かれる
        void refresh()
        // 停止ボタン。ここまで出ている回答をそのまま残して保存する
        const stoppedId = streamMsgIdRef.current
        endStream()
        if (stoppedId) {
          const responseStats: AIResponseStats = { firstResponseMs, totalMs: Math.max(0, Date.now() - startedAt), stopped: true }
          const stopped = messagesRef.current.map(m => m.id === stoppedId ? { ...m, responseStats } : m)
          messagesRef.current = stopped
          setMessages(stopped)
          await persistConversation(stopped, saveHistory)
        }
        return
      }
      // 途中まで出ていた回答は消す。サーバー側は失敗として利用枠を戻しているので、
      // 切れた回答とエラーが並ぶより、まるごと再試行できる形にする
      const partialId = streamMsgIdRef.current
      endStream()
      if (partialId) {
        const withoutPartial = messagesRef.current.filter(m => m.id !== partialId)
        messagesRef.current = withoutPartial
        setMessages(withoutPartial)
      }
      // サーバーが週間枠で拒否したら利用量を同期し、Pro にはリセット日時を案内する。
      if (e instanceof AIUsageLimitError) {
        applyUsage(e.usage)
        trackLimitHit('aiChatPerPeriod', { current: e.usage?.tokenCount ?? undefined, max: e.usage?.tokenLimit ?? undefined, placement: 'ai_chat_server_reject' })
        // Pro の週の枠切れで Paywall を出すと、課金済みの人に同じプランの購入を促すことになる。
        // 上限バナーと同じく、リセット日時を知らせるだけにする。枠はトークン1本（120）なので回数は出さない
        if (e.usage?.isPro ?? isPro) {
          showUsageLimit()
          return
        }
        // 送信を待つ間に会話から離れていたら、離れた先の画面に課金画面を出さない
        if (navigation.isFocused()) navigation.navigate('Paywall', { reason: 'aiFeatures' })
        return
      }
      // 端末側だけ時間切れになり、サーバーでは回答と利用量の精算が済んでいることがある
      void refresh()
      analytics.error('ai_chat_request', e, { duration_ms: Date.now() - startedAt })
      const errMsg: ChatMessage = {
        id:        newMessageId(),
        role:      'assistant',
        isError:   true,
        content:   localizedErrorMessage(
          e,
          lang,
          lang === 'en' ? 'Could not get a response. Please try again.' : '回答を取得できませんでした。もう一度お試しください。',
        ),
        createdAt: new Date().toISOString(),
      }
      setMessages(prev => {
        const updated = [...prev, errMsg]
        messagesRef.current = updated
        return updated
      })
    } finally {
      // 新しい会話を始めたあとに届いた返事では触らない。その時点で解除済みで、
      // 次の依頼がもう走っていることもある
      if (token === requestTokenRef.current) {
        requestInFlightRef.current = false
        streamAbortRef.current = null
        setIsLoading(false)
        endStream()
      }
    }
  }, [aiAccessAllowed, applyUsage, consume, endStream, flushStreamText, isPro, lang, loaded, navigation, persistConversation, refresh, rootMounted, showUsageLimit, tierSyncing, tokenCount, tokenLimit])

  // 送信の共通処理
  const doSend = useCallback(async (
    text: string,
    image?: { uri: string; base64: string; type: string },
    planCard?: ChatMessage['planCard'],
    onAccepted?: () => void,
  ) => {
    // 見えない文字だけの文は空として扱う。trim() だけで見ると送信が通り、空の質問に
    // AI利用枠を消費させることになる
    if (!trimInvisible(text) && !image) return
    if (requestInFlightRef.current || historyReadInFlightRef.current) return

    if (!loaded) {
      void refresh()
      return
    }

    if (proLocked) {
      if (tierSyncing) {
        void refresh()
        Alert.alert(
          lang === 'en' ? 'Activating Pro' : 'Proを反映しています',
          lang === 'en'
            ? 'Your purchase is being applied. Please try again in a few seconds.'
            : '購入の反映を待っています。数秒後にもう一度お試しください。',
        )
        return
      }
      trackLimitHit('aiChatPerPeriod', { max: tokenLimit, placement: 'ai_chat_pro_gate' })
      navigation.navigate('Paywall', { reason: 'aiFeatures' })
      return
    }

    if (!canUse && loaded) {
      trackLimitHit('aiChatPerPeriod', { current: tokenCount, max: tokenLimit, placement: 'ai_chat_send' })
      showUsageLimit()
      return
    }

    endStream()
    historyReadInFlightRef.current = true
    try {
      // 一覧画面で設定を変更して戻る場合があるため、画面マウント時の値を保持せず
      // 送信を受け付けた時点の設定をこのメッセージの保存方針として固定する。
      const saveHistory = await isAIHistoryEnabled()
      lastHistoryEnabledRef.current = saveHistory
      const messageId = newMessageId()
      let storedImageUri = image?.uri
      if (image && saveHistory) {
        storedImageUri = await persistAIConversationImage(image.uri, messageId).catch(() => image.uri)
      }
      const userMsg: ChatMessage = {
        id:        messageId,
        role:      'user',
        content:   trimInvisible(text),
        imageUri:  storedImageUri,
        requestId: Crypto.randomUUID(),
        planCard,
        createdAt: new Date().toISOString(),
      }
      const nextMessages = [...messagesRef.current, userMsg]
      setMessages(nextMessages)
      messagesRef.current = nextMessages
      lastImageRef.current = image ?? null
      onAccepted?.()
      await runRequest(nextMessages, image, false, saveHistory)
    } finally {
      historyReadInFlightRef.current = false
    }
  }, [canUse, loaded, endStream, lang, navigation, proLocked, refresh, runRequest, showUsageLimit, tierSyncing, tokenCount, tokenLimit])

  // 再送信：エラーメッセージを取り除き、同じ内容・同じ request_id でもう一度リクエストする。
  // サーバーは失敗時に枠を戻しているので、再送では改めて利用量を精算する。端末側だけ失敗して
  // サーバーでは完了していた依頼は焼き直しになり枠を使わないので、端末の事前判定は飛ばす
  const handleRetry = useCallback(() => {
    if (!aiAccessAllowed) {
      if (!loaded || tierSyncing) void refresh()
      else navigation.navigate('Paywall', { reason: 'aiFeatures' })
      return
    }
    if (requestInFlightRef.current) return
    endStream()
    const stripped = messagesRef.current.filter(m => !m.isError)
    setMessages(stripped)
    messagesRef.current = stripped
    void runRequest(stripped, lastImageRef.current ?? undefined, true, lastHistoryEnabledRef.current)
  }, [aiAccessAllowed, endStream, loaded, navigation, refresh, runRequest, tierSyncing])

  // 停止。返事を待っている間は依頼ごと捨て、表示の途中なら見えているところで回答を切る。
  // 待っている間に止めた分も、サーバーでは処理されるので利用回数は戻らない
  const stopGenerating = useCallback(() => {
    // 依頼ごと切る。サーバーは受け取ったところまでで精算するので、
    // 止めても利用回数は戻らない。ここまで出ている回答は runRequest 側で残して保存する
    streamAbortRef.current?.abort()
  }, [])

  // もう一度。最後の回答を外し、同じ質問を新しい依頼として送り直す（利用回数を1回使う）。
  // request_id を振り直さないと、サーバーは同じ依頼の再試行として扱う
  const handleRegenerate = useCallback(() => {
    if (!aiAccessAllowed) {
      if (!loaded || tierSyncing) void refresh()
      else navigation.navigate('Paywall', { reason: 'aiFeatures' })
      return
    }
    if (requestInFlightRef.current) return
    const current = messagesRef.current.filter(m => !m.isError)
    if (current[current.length - 1]?.role !== 'assistant') return
    const head = current.slice(0, -1)
    let userIndex = -1
    for (let i = head.length - 1; i >= 0; i--) {
      if (head[i].role === 'user') { userIndex = i; break }
    }
    if (userIndex < 0) return
    const lastUser = head[userIndex]
    const next = head.map((m, i) => (i === userIndex ? { ...m, requestId: Crypto.randomUUID() } : m))
    setMessages(next)
    messagesRef.current = next
    // 画面を開き直した場合の写真は runRequest で保存先から復元する。
    const image = lastUser.imageUri && lastImageRef.current ? lastImageRef.current : undefined
    void runRequest(next, image, false, lastHistoryEnabledRef.current)
  }, [aiAccessAllowed, loaded, navigation, refresh, runRequest, tierSyncing])

  // 新しい会話。画面を積み直さずその場で作り直す（履歴の画面を経由しなくても始められる）
  const resetConversation = useCallback(() => {
    newChatConfirmationRef.current = null
    // 待っている返事も、書いている途中の回答も捨てる。番号を進めてから切ることで、
    // 切る前に届いていたぶんも表示・保存の対象から外れる
    requestTokenRef.current++
    // 捨てた依頼もサーバーでは利用量を精算する。番号を進めたので runRequest 側では取り直さない
    if (streamAbortRef.current) void refresh()
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    requestInFlightRef.current = false
    setIsLoading(false)
    endStream()
    // 会話の id を替えないと、次の送信が前の会話に上書き保存される
    convIdRef.current = newConversationId()
    const greeting: ChatMessage = {
      id:        newMessageId(),
      role:      'assistant',
      content:   defaultGreetingText(lang),
      createdAt: new Date().toISOString(),
    }
    setMessages([greeting])
    messagesRef.current = [greeting]
    setInput('')
    clearAttachedDesk()
    setAttachedImage(null)
    lastImageRef.current = null
    atBottomRef.current = true
    setShowJump(false)
  }, [clearAttachedDesk, endStream, lang, refresh])

  const handleNewChat = useCallback(() => {
    if (!navigation.isFocused() || newChatConfirmationRef.current) return
    // 挨拶だけで添付も入力も無いなら、押しても変わるものが無い
    if (messagesRef.current.length <= 1 && !input && !attachedPlan && !attachedImage && !isLoading) return
    const ticket = {}
    newChatConfirmationRef.current = ticket
    const conversation = convIdRef.current
    const request = requestTokenRef.current
    const cancel = () => { if (newChatConfirmationRef.current === ticket) newChatConfirmationRef.current = null }
    const current = () => newChatConfirmationRef.current === ticket && navigation.isFocused()
      && convIdRef.current === conversation && requestTokenRef.current === request
    const start = () => {
      if (!current()) { cancel(); return }
      cancel()
      resetConversation()
    }
    void (async () => {
      // 履歴を残さない設定のときだけ確認する。残す設定なら会話は保存済みで、履歴から開き直せる
      const needsConfirmation = messagesRef.current.length > 1 && !(await isAIHistoryEnabled())
      if (!current()) { cancel(); return }
      if (needsConfirmation) {
        Alert.alert(
          lang === 'en' ? 'Start a new chat?' : '新しい会話を始めますか？',
          lang === 'en'
            ? 'Chat history is turned off, so this conversation will be lost.'
            : '相談履歴を残さない設定のため、この会話は保存されずに消えます。',
          [
            { text: lang === 'en' ? 'Cancel' : 'キャンセル', style: 'cancel', onPress: cancel },
            { text: lang === 'en' ? 'Start new' : '新しく始める', style: 'destructive', onPress: start },
          ], { onDismiss: cancel },
        )
        return
      }
      start()
    })().catch(() => {
      const active = current()
      cancel()
      if (active) Alert.alert(lang === 'en' ? 'Could not start a new chat' : '新しい会話を始められませんでした')
    })
  }, [attachedImage, attachedPlan, input, isLoading, lang, navigation, resetConversation])

  // 相談履歴への入口と新しい会話。AIコーチは専用タブを持たないので、この画面のヘッダーが唯一の導線。
  // useEffect だと描画のあとに走るため、ボタンの無いヘッダーが一度描かれてから
  // customView が挿し込まれ、iOS がバーのレイアウトを取り直すぶんボタンが動いて見える
  const coach = useCoachMarks()
  const { target: coachTarget, open: openCoach } = coach
  const openHelp = useCallback(() => { void openCoach(AI_COACH_CHAT_COACH) }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({
      // 公開デスクから開いたぶんは相談履歴と同じスタックに居ないので出さない
      // （押しても行き先が無い。会話自体は保存され、履歴からは開ける）。
      // 添付したデスクを見に来た会話なので、そこから話題を捨てる「新しい会話」も出さない
      headerRight: () => (
        <HeaderButtonGroup>
          {!rootMounted && <HeaderIconButton
            buttonRef={coachTarget('ai-history')}
            name="message-text-clock-outline"
            color={colors.text}
            onPress={() => { if (navigation.isFocused()) navigation.navigate('AICoachList') }}
            accessibilityLabel={lang === 'en' ? 'Chat History' : '相談履歴'}
          />}
          {!rootMounted && <HeaderIconButton
            buttonRef={coachTarget('ai-new-conversation')}
            name={ICONS.newChat}
            color={colors.text}
            onPress={handleNewChat}
            accessibilityLabel={lang === 'en' ? 'New chat' : '新しい会話'}
          />}
          <HeaderIconButton
            name="help-circle-outline"
            color={colors.text}
            onPress={openHelp}
            accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'}
          />
        </HeaderButtonGroup>
      ),
    })
  }, [navigation, lang, colors.text, rootMounted, handleNewChat, coachTarget, openHelp])

  const aiReportInFlightRef = useRef(false)
  const handleReportAIResponse = useCallback((message: ChatMessage, index: number) => {
    const conversationId = convIdRef.current
    const prompt = [...messagesRef.current.slice(0, index)].reverse().find((item) => item.role === 'user')?.content
    const sendReport = (reason: AIReportReason) => {
      if (aiReportInFlightRef.current) return
      aiReportInFlightRef.current = true
      void submitAIReport({
        reason,
        response: message.content,
        prompt,
        conversationId,
        messageId: message.id,
      }).then(() => {
        Alert.alert(
          lang === 'en' ? 'Report sent' : '報告しました',
          lang === 'en' ? 'Thank you. We will review this response.' : '内容を確認し、AIの安全性改善に利用します。',
        )
      }).catch((error) => {
        const duplicate = error && typeof error === 'object' && 'code' in error && error.code === '23505'
        Alert.alert(
          lang === 'en' ? 'Could not send report' : '報告できませんでした',
          duplicate
            ? (lang === 'en' ? 'You have already reported this response.' : 'この回答は報告済みです。')
            : localizedErrorMessage(error, lang, lang === 'en' ? 'Please try again later.' : '時間をおいてもう一度お試しください。'),
        )
      }).finally(() => { aiReportInFlightRef.current = false })
    }

    Alert.alert(
      lang === 'en' ? 'Report AI response' : 'AI回答を報告',
      lang === 'en'
        ? 'The response and the preceding prompt will be sent for review. Why are you reporting it?'
        : '確認のため、この回答と直前の入力内容を送信します。報告理由を選んでください。',
      [
        { text: lang === 'en' ? 'Cancel' : 'キャンセル', style: 'cancel' },
        { text: lang === 'en' ? 'Unsafe or inappropriate' : '危険・不適切', onPress: () => sendReport('unsafe') },
        { text: lang === 'en' ? 'Inaccurate' : '誤情報', onPress: () => sendReport('inaccurate') },
      ],
    )
  }, [lang])

  // 画像ピッカー
  const handlePickImage = useCallback(async (reuseUri?: string) => {
    if (imagePickerInFlightRef.current) return
    if (!loaded) {
      void refresh()
      return
    }
    if (proLocked && tierSyncing) { void refresh(); return }
    // Free でも写真を選んで添付するところまではできる（端末の中で縮めるだけで、何も送らない）。
    // 課金の案内は送信を押したときに出す。Pro の利用枠の使い切りは Free には当てない
    if (!proLocked && !canUse && loaded) {
      showUsageLimit()
      return
    }
    imagePickerInFlightRef.current = true
    setPickingImage(true)
    const conversationAtStart = convIdRef.current
    try {
      if (reuseUri) {
        const processed = await loadAIConversationImage(reuseUri)
        if (convIdRef.current === conversationAtStart) setAttachedImage(processed)
        return
      }
      const launch = await launchImageLibraryFromUserAction({
        mediaTypes: ['images'],
        quality:    0.7,
        base64:     false,
      })
      if (launch.permissionDenied) {
        showPhotoPermissionAlert(lang)
        return
      }
      const result = launch.result
      if (result.canceled || !result.assets[0]) return

      const asset = result.assets[0]
      const processed = await prepareAIImage(asset.uri, asset.width, asset.height)
      if (convIdRef.current === conversationAtStart) setAttachedImage(processed)
    } catch (e) {
      analytics.error('ai_chat_image_prepare', e)
      Alert.alert(
        lang === 'en' ? 'Could Not Attach Photo' : '写真を添付できませんでした',
        e instanceof Error && e.message === 'AI_IMAGE_TOO_LARGE'
          ? (lang === 'en' ? 'The photo is still too large after compression. Choose a smaller photo.' : '圧縮後も写真のサイズが上限を超えました。より小さい写真を選んでください。')
          : (lang === 'en' ? 'Please choose another photo and try again.' : '別の写真を選んでもう一度お試しください。'),
      )
    } finally {
      imagePickerInFlightRef.current = false
      setPickingImage(false)
    }
  }, [canUse, lang, loaded, proLocked, refresh, showUsageLimit, tierSyncing])

  const sendWithContext = useCallback((overrideText: string | undefined, selection: AIContextSelection) => {
    let text = (overrideText ?? input).trim()
    let planCard: ChatMessage['planCard'] | undefined
    if (attachedPlan) {
      const freshPlan = attachedIsForeign
        // 他人のデスクの配線は公開した人が確定させたものを読んでいる（publicDeskAdapter）。
        // 手元の配線エンジンで引き直すと、その人が手で直した線を勝手に上書きした図を送ることになる
        ? attachedPlan
        // 配線の作り直しはデスク画面を開いたときにしか走らない。マイページ側から開いたときなど、
        // デスク画面の外で変えた構成が配線に入っていないことがあるので、送る直前に作り直す。
        // 保存はしない（診断を送っただけでデスクの更新日を動かさない）
        : refreshPlanWiring(attachedPlan, gadgets, lang).plan
      const effectiveSelection = attachedIsForeign ? foreignDeskContextSelection(selection) : selection
      const planMsg = buildPlanAnalysisMessage(freshPlan, attachedGadgets, lang, effectiveSelection, fmtPrice, attachedIsForeign ? 'reference' : 'own')
      planCard = {
        name:    attachedPlan.name,
        count:   attachedGadgets.filter((g) => attachedPlan.selectedGadgetIds.includes(g.id) && countsAsDevice(g)).length,
        comment: text || undefined,
        author:  attachedIsForeign ? publicDeskLabel?.author : undefined,
      }
      text = text ? `**${lang === 'en' ? 'Question' : '相談内容'}:** ${text}\n\n${planMsg}` : planMsg
    }
    const image = attachedImage
    const sentInput = overrideText == null ? input : null
    const send = () => void doSend(text, image ?? undefined, planCard, () => {
      clearAttachedDesk()
      setAttachedImage(null)
      if (sentInput != null) setInput((current) => inputAfterSend(current, sentInput))
    })
    if (aiConsentGranted || proLocked) {
      send()
      return
    }
    pendingConsentSendRef.current = { text, image: image ?? undefined, planCard, sentInput }
    setShowAIConsent(true)
  }, [attachedPlan, attachedGadgets, attachedIsForeign, publicDeskLabel, clearAttachedDesk, attachedImage, input, gadgets, lang, fmtPrice, doSend, aiConsentGranted, proLocked])

  // デスク添付時は送信項目を必ず確認できるようにする。通常チャットは追加確認なしで送る。
  const handleSend = useCallback((overrideText?: string) => {
    hapticLight()
    // Free は文字・写真・デスクを入れて送信を押すところまでできる。課金の案内はこの瞬間に出す。
    // 下書きは画面に残るので、購入して戻ればそのまま送れる
    if (!aiAccessAllowed) {
      if (!loaded || tierSyncing) void refresh()
      else {
        trackLimitHit('aiFeatures', { placement: 'ai_chat_send_gate' })
        navigation.navigate('Paywall', { reason: 'aiFeatures' })
      }
      return
    }
    if (attachedPlan) {
      pendingContextTextRef.current = overrideText
      setContextSelectionMode('send')
      setShowContextSelection(true)
      return
    }
    sendWithContext(overrideText, contextSelection)
  }, [aiAccessAllowed, attachedPlan, contextSelection, loaded, navigation, refresh, sendWithContext, tierSyncing])

  const confirmContextSelection = useCallback(() => {
    setShowContextSelection(false)
    if (contextSelectionMode !== 'send') return
    const overrideText = pendingContextTextRef.current
    pendingContextTextRef.current = undefined
    sendWithContext(overrideText, contextSelection)
  }, [contextSelection, contextSelectionMode, sendWithContext])

  const acceptAIConsent = useCallback(() => {
    void grantAIDataConsent().catch(() => {})
    setAIConsentGranted(true)
    setShowAIConsent(false)
    const pending = pendingConsentSendRef.current
    pendingConsentSendRef.current = null
    if (!pending) return
    void doSend(pending.text, pending.image, pending.planCard, () => {
      clearAttachedDesk()
      setAttachedImage(null)
      const { sentInput } = pending
      if (sentInput != null) setInput((current) => inputAfterSend(current, sentInput))
    })
  }, [clearAttachedDesk, doSend])

  const declineAIConsent = useCallback(() => {
    pendingConsentSendRef.current = null
    setShowAIConsent(false)
  }, [])

  // メッセージ追加時：最下部にいるときだけ追従、それ以外は「新着」ピルを表示
  useEffect(() => {
    if (atBottomRef.current) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80)
    } else if (messages.length > 1) {
      setShowJump(true)
    }
  }, [messages.length, isLoading])

  const c = colors
  // Free（proLocked）は入力・添付・送信を押すところまでできる。送信で課金の案内を出す（handleSend）。
  // Pro で今週の枠を使い切ったときだけ、入力も送信も止める
  const canCompose = (aiAccessAllowed && canUse) || proLocked
  const canSend = (trimInvisible(input).length > 0 || attachedPlan != null || attachedImage != null)
    && !isLoading && canCompose

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.safe, { backgroundColor: c.bg }]}>
      <CoachScope coach={coach}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
      >
        {/* 使用制限バナー。Free の案内は誤りでも失敗でもないので、赤（danger）を敷かず面の色で出す。
            赤だと開いた瞬間に「何か壊れた」と読まれる */}
        {loaded && !canUse && (
          <Reanimated.View entering={enter} exiting={exit}>
          <TouchableOpacity
            style={[
              styles.limitBanner,
              proLocked && !tierSyncing
                ? { backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }
                : { backgroundColor: tierSyncing ? UI_STATUS_COLORS.info : UI_STATUS_COLORS.warning },
            ]}
            // Pro の週の枠を使い切っただけのときは押しても何も起きない。押せるように見せない
            disabled={isPro && !tierSyncing}
            accessibilityRole={isPro && !tierSyncing ? undefined : 'button'}
            onPress={() => {
              if (tierSyncing) { recheckServerTier(); return }
              if (!isPro) navigation.navigate('Paywall', { reason: 'aiFeatures' })
            }}
            activeOpacity={0.8}
          >
            <AppIcon name={ICONS.lock} size={16} color={proLocked && !tierSyncing ? c.accentIcon : tierSyncing ? '#fff' : UI_STATUS_ON_WARNING} />
            <Text style={[styles.limitBannerText, !tierSyncing && { color: proLocked ? c.text : UI_STATUS_ON_WARNING }]}>
              {tierSyncing
                ? (lang === 'en'
                    ? 'Applying your purchase — tap to check again'
                    : '購入を反映しています。タップで再確認')
                : proLocked
                ? (lang === 'en'
                    ? 'The AI coach is available on Pro.\nUpgrade to Pro →'
                    : 'AIコーチはProプランで利用できます。\nProにアップグレード →')
                : (lang === 'en'
                    ? `Weekly AI limit reached — resets ${resetLabel}.`
                    : `今週のAI利用枠を使い切りました（${resetLabel}にリセット）`)}
            </Text>
          </TouchableOpacity>
          </Reanimated.View>
        )}
        {/* メッセージ一覧 */}
        <View ref={coachTarget('ai-messages')} style={{ flex: 1 }}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={styles.listContent}
            style={{ backgroundColor: c.bg }}
            onScroll={onListScroll}
            onLayout={onListLayout}
            // 回答は吹き出しの中で少しずつ伸びるので、受信の時点ではなく伸びた時点で下端へ合わせる
            onContentSizeChange={() => {
              if (atBottomRef.current) flatListRef.current?.scrollToEnd({ animated: false })
            }}
            scrollEventThrottle={100}
            // 入力中でも、メッセージ内の操作（コピー・添付の拡大）が1回目で反応する
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => {
              const isLastAssistant =
                item.role === 'assistant' && !item.isError && index === messages.length - 1 && messages.length > 1
              const suggestion = isLastAssistant ? suggestedProduct : null
              // 質問に対する回答か（最初の挨拶は除く）。回答の下の操作はこれにだけ付ける
              const isAnswer = item.role === 'assistant' && !item.isError
                && messages.slice(0, index).some((message) => message.role === 'user')
              return (
                <Bubble
                  msg={item}
                  colors={c}
                  lang={lang}
                  buyLinks={suggestion ? suggestedLinks : undefined}
                  onOpenLink={openSuggestedLink}
                  // 公開デスクから開いたぶんは AddGadget が同じスタックに無いので出さない。
                  // 他人のデスクに機材を足す操作でもあり、ここでの行き先は購入リンクの方でよい
                  onAddGadget={suggestion && !rootMounted
                    // 添付しているデスクへそのまま入れる。planId を落とすと
                    // マイガジェットに積まれるだけで、相談していたデスクの配線図が変わらない
                    // 「追加して配線を見る」と書いたボタンなので、完了で配線図まで連れて行く
                    ? () => navigation.navigate('AddGadget', {
                        presetName: suggestion,
                        planId: attachedIsForeign ? undefined : attachedPlan?.id,
                        showWiringOnDone: !!attachedPlan && !attachedIsForeign,
                      })
                    : undefined}
                  actionLabel={attachedPlan && !attachedIsForeign
                    ? (lang === 'en' ? 'Add to this desk' : 'このデスクに追加して配線を見る')
                    : (lang === 'en' ? 'Add to my gadgets' : 'マイガジェットに登録')}
                  onRetry={item.isError ? handleRetry : undefined}
                  onReport={isAnswer ? () => handleReportAIResponse(item, index) : undefined}
                  // もう一度は最後の回答だけ。途中の回答を作り直すと、その後の会話と噛み合わなくなる
                  onRegenerate={isAnswer && index === messages.length - 1 && !isLoading && !streaming ? handleRegenerate : undefined}
                  // 表示している途中の回答には出さない（コピーすると途中までの文になる）
                  showActions={isAnswer && !(streaming && index === messages.length - 1)}
                  streaming={streaming && index === messages.length - 1 && item.role === 'assistant'}
                />
              )
            }}
            ListFooterComponent={isLoading ? <ThinkingDot key={requestTokenRef.current} colors={c} /> : null}
            extraData={c}
          />

          {/* 読み返し中に新着が来たとき：タップで最下部へ */}
          {showJump && (
            <Reanimated.View entering={enter} exiting={exit} style={styles.jumpPillSlot} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.jumpPill, { backgroundColor: c.accent }]}
              onPress={() => { setShowJump(false); flatListRef.current?.scrollToEnd({ animated: true }) }}
              activeOpacity={0.85}
            >
              <AppIcon name={ICONS.chevronDown} size={15} color={c.onAccent} />
              <Text style={[styles.jumpPillText, { color: c.onAccent }]}>{lang === 'en' ? 'New message' : '新しいメッセージ'}</Text>
            </TouchableOpacity>
            </Reanimated.View>
          )}
        </View>

        {/* 入力エリア */}
        <Reanimated.View layout={relayout} style={[styles.inputArea, { backgroundColor: c.bg, borderTopColor: c.divider }]}>

          {/* サジェストチップ（会話が始まる前だけ表示） */}
          {messages.length <= 1 && !isLoading && (
            <Reanimated.View entering={enter} exiting={exit}>
            {/* 「？」で行全体を指すため、測れる素の View に並びを持たせる */}
            <View ref={coachTarget('ai-suggestions')} style={styles.suggestRow}>
              {(lang === 'en'
                ? [
                    { label: 'Tidy up my cables', text: 'I want to tidy up my desk cables. Any advice?' },
                    { label: 'Improve with $200', text: 'How would you improve my desk with a $200 budget?' },
                    { label: 'What to buy next?', text: 'What gadget should I add next to my current setup?' },
                    { label: 'Analyze my desk', plan: true as const },
                  ]
                : [
                    { label: '配線をきれいにしたい', text: '配線をきれいにしたいです。アドバイスをください。' },
                    { label: '予算3万円で改善するなら？', text: '予算3万円でデスクを改善するなら何をすべきですか？' },
                    { label: '次に買うべきものは？', text: '今の構成で次に買うべきガジェットを教えてください。' },
                    { label: 'デスクを分析', plan: true as const },
                  ]
              ).map((s) => (
                <TouchableOpacity
                  key={s.label}
                  style={[styles.suggestChip, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() => {
                    const text = 'text' in s ? s.text ?? '' : ''
                    if (attachedPlan) { handleSend(text); return }
                    if (plans.length > 0 || !text) {
                      setInput(text)
                      setPlanSelector(true)
                    } else handleSend(text)
                  }}
                  disabled={!canCompose}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.suggestChipText, { color: c.text }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            </Reanimated.View>
          )}

          {!attachedImage && messages.some((m) => m.role === 'user' && m.imageUri) && (
            <Reanimated.View entering={enter} exiting={exit} style={{ alignSelf: 'flex-start' }}>
            <TouchableOpacity
              style={[styles.suggestChip, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => {
                const previous = [...messages].reverse().find((m) => m.role === 'user' && m.imageUri)
                if (previous?.imageUri) void handlePickImage(previous.imageUri)
              }}
              disabled={pickingImage || !canCompose || isLoading || streaming}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Text style={[styles.suggestChipText, { color: c.textSub }]}>
                {lang === 'en' ? 'Refer to previous photo · uses your AI allowance' : '前の写真を参照・送信時にAI利用枠を使用'}
              </Text>
            </TouchableOpacity>
            </Reanimated.View>
          )}

          {/* 添付プレビュー行 */}
          {(attachedImage || attachedPlan) && (
            <Reanimated.View entering={enter} exiting={exit} layout={relayout} style={styles.attachRow}>
              {attachedImage && (
                <Reanimated.View entering={enter} exiting={exit} layout={relayout} style={styles.attachImageWrap}>
                  <Image source={{ uri: attachedImage.uri }} style={styles.attachImageThumb} resizeMode="cover" />
                  <TouchableOpacity style={styles.attachRemove} onPress={() => setAttachedImage(null)} hitSlop={6} accessibilityRole="button" accessibilityLabel={lang === 'ja' ? '添付した写真を外す' : 'Remove attached photo'}>
                    <AppIcon name={ICONS.clear} size={18} color="#fff" />
                  </TouchableOpacity>
                </Reanimated.View>
              )}
              {attachedPlan && (
                <Reanimated.View entering={enter} exiting={exit} layout={relayout} style={[styles.attachChip, { backgroundColor: c.card, borderColor: c.border }]}>
                  <AppIcon name="desk" size={13} color={c.accentText} />
                  {/* 地は card（中立面）なので accent ではなく accentText。
                      accent のままだとライトのグリーン/オレンジで 2.0:1 まで落ちる */}
                  {/* 他人のデスクは投稿者を添えないと、自分のどれかと見分けがつかない */}
                  <Text style={[styles.attachChipText, { color: c.accentText }]} numberOfLines={1}>
                    {attachedIsForeign && publicDeskLabel?.author
                      ? `${attachedPlan.name}（${publicDeskLabel.author}）`
                      : attachedPlan.name}
                  </Text>
                  <TouchableOpacity
                    ref={coachTarget('ai-desk-context')}
                    onPress={() => { setContextSelectionMode('edit'); setShowContextSelection(true) }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={lang === 'ja' ? 'AIへ送る情報を選択' : 'Choose data sent to AI'}
                  >
                    <AppIcon name="tune-variant" size={15} color={c.accentIcon} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={clearAttachedDesk} hitSlop={8} accessibilityRole="button" accessibilityLabel={lang === 'ja' ? '添付したデスクを外す' : 'Remove attached desk'}>
                    <AppIcon name={ICONS.clear} size={15} color={c.textMuted} />
                  </TouchableOpacity>
                </Reanimated.View>
              )}
            </Reanimated.View>
          )}

          {/* 入力ボックス */}
          <View style={[styles.inputBox, { backgroundColor: c.card, borderColor: c.inputBorder }]}>
            <TextInput
              style={[styles.input, { color: c.text }]}
              placeholder={proLocked
                ? tierSyncing
                  ? (lang === 'en' ? 'Applying your purchase…' : '購入を反映しています…')
                  : attachedPlan || attachedImage
                    ? (lang === 'en' ? 'e.g. Tidy up the wiring (sending needs Pro)' : '例：配線をすっきりさせたい（送信はPro）')
                    : (lang === 'en' ? 'e.g. More room on my desk? (sending needs Pro)' : '例：机の上をすっきりさせるには？（送信はPro）')
                : attachedPlan || attachedImage
                  ? (lang === 'en' ? 'e.g. How can I tidy up the wiring?' : '例：配線をすっきりさせたい')
                  : (lang === 'en' ? 'e.g. How can I make more room on my desk?' : '例：机の上をすっきりさせるには？')}
              accessibilityLabel={lang === 'en' ? 'Message to AI' : 'AIへの相談'}
              placeholderTextColor={c.textMuted}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              editable={canCompose}
            />
            {/* 右端ツール */}
            <View style={styles.rightTools}>
              <IconCircleButton
                buttonRef={coachTarget('ai-attach-desk')}
                name="desk"
                diameter={COMPOSER_TOOL_SIZE}
                size={20}
                color={attachedPlan ? c.accentIcon : c.textSub}
                onPress={() => setPlanSelector(true)}
                disabled={!canCompose}
                hitSlop={COMPOSER_TOOL_SLOP}
                accessibilityLabel={lang === 'ja' ? 'デスクを添付' : 'Attach desk'}
              />
              {/* 読み込み中も同じ器に置き、ぐるぐるに替わった瞬間に送信ボタンが横へずれないようにする */}
              {pickingImage ? (
                <View style={styles.composerToolSlot}>
                  <ActivityIndicator size="small" color={c.textMuted} />
                </View>
              ) : (
                <IconCircleButton
                  buttonRef={coachTarget('ai-attach-photo')}
                  name={ICONS.image}
                  diameter={COMPOSER_TOOL_SIZE}
                  size={20}
                  color={canCompose ? c.textSub : c.textMuted}
                  onPress={() => void handlePickImage()}
                  disabled={!canCompose}
                  hitSlop={COMPOSER_TOOL_SLOP}
                  accessibilityLabel={lang === 'ja' ? '写真を添付' : 'Attach photo'}
                />
              )}
              {/* 返事を待っている間・表示している間は停止ボタンに替える（有名なAIアプリと同じ） */}
              <PopIn key={isLoading || streaming ? 'stop' : 'send'} animate={sendButtonMountedRef.current}>
                {isLoading || streaming ? (
                  <IconCircleButton
                    buttonRef={coachTarget('ai-send')}
                    name={ICONS.stopGenerating}
                    diameter={COMPOSER_TOOL_SIZE}
                    size={14}
                    color={c.card}
                    background={c.text}
                    onPress={stopGenerating}
                    hitSlop={COMPOSER_TOOL_SLOP}
                    accessibilityLabel={lang === 'ja' ? '回答を止める' : 'Stop generating'}
                  />
                ) : (
                  // Free は送信が課金の入口になる。押せることは残しつつ、Pro の送信と同じ濃い塗りにはせず
                  // 薄い地で出す（空のままでも押せば Paywall を出す。案内は handleSend が持つ）
                  <IconCircleButton
                    buttonRef={coachTarget('ai-send')}
                    name="arrow-up"
                    diameter={COMPOSER_TOOL_SIZE}
                    size={18}
                    color={proLocked ? c.accentIcon : canSend ? c.onAccent : c.textMuted}
                    background={proLocked ? c.accent + '18' : canSend ? c.accent : c.chip}
                    onPress={() => handleSend()}
                    disabled={!canSend && !proLocked}
                    hitSlop={COMPOSER_TOOL_SLOP}
                    accessibilityLabel={proLocked
                      ? (lang === 'ja' ? '送信（Proプラン）' : 'Send (Pro)')
                      : (lang === 'ja' ? '送信' : 'Send')}
                  />
                )}
              </PopIn>
            </View>
          </View>

          {loaded && !proLocked && (
            <>
              <Text style={[styles.usageSub, { color: nearLimit ? c.text : c.textMuted }]}>
                {lang === 'en'
                  ? `AI usage this week: ${Math.floor(usedRatio * 100)}% used${nearLimit ? ' · Almost at limit' : ''} · Resets ${resetLabel}`
                  : `今週のAI利用量：${Math.floor(usedRatio * 100)}%使用${nearLimit ? '・残りわずか' : ''}（${resetLabel}にリセット）`}
              </Text>
              {messages.length <= 1 && (
                <Reanimated.Text
                  entering={enter}
                  exiting={exit}
                  style={[styles.aiNotice, { color: c.textSub }]}
                  maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                >
                  {lang === 'en' ? 'AI can make mistakes. Verify important specifications and safety advice.' : 'AIは誤ることがあります。重要な仕様や安全情報は確認してください。'}
                </Reanimated.Text>
              )}
            </>
          )}
        </Reanimated.View>
      </KeyboardAvoidingView>

      <PlanSelector
        visible={planSelector}
        plans={pickerPlans}
        gadgets={gadgets}
        // 自分のデスクを選び直したら他人のデスクの添付は外す（同時に2つは添付できない）
        onSelect={plan => { setAttachedPublicDesk(false); setAttachedPlanId(plan.id); setPlanSelector(false) }}
        onClose={() => setPlanSelector(false)}
        colors={c}
        lang={lang}
      />
      <AIConsentModal
        visible={showAIConsent}
        lang={lang}
        colors={c}
        foreignDesk={attachedIsForeign}
        onAccept={acceptAIConsent}
        onDecline={declineAIConsent}
      />
      <AIContextSelectionModal
        visible={showContextSelection}
        lang={lang}
        colors={c}
        value={contextSelection}
        foreignDesk={attachedIsForeign}
        // 送る機材一覧と同じ数え方（ケーブルは「所有ケーブル」として別に送る）
        gadgetCount={attachedPlan
          ? attachedGadgets.filter((g) => attachedPlan.selectedGadgetIds.includes(g.id) && countsAsDevice(g)).length
          : 0}
        mode={contextSelectionMode}
        onChange={setContextSelection}
        onClose={() => { pendingContextTextRef.current = undefined; setShowContextSelection(false) }}
        onConfirm={confirmContextSelection}
      />
      </CoachScope>
      {coach.overlay}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:            { flex: 1 },
  flex:            { flex: 1 },

  // ヘッダーの履歴ボタン。
  // iOS 26 はバーボタンの frame に合わせて丸い背景を自前で描く。マージンで
  // 中身をずらすと円だけ元の位置に残るので、位置合わせは箱のサイズだけで行う。
  // アイコンの実体は <Text> なので、行ボックスに任せると字形しだいで中心が
  // ずれる。lineHeight を size と揃え、余白を殺して中心を確定させる

  // メッセージリスト
  listContent:     { paddingHorizontal: UI_METRICS.screenGutter, paddingVertical: 16, gap: 16, paddingBottom: 8 },

  // バナー
  limitBanner:     { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, paddingHorizontal: 16 },
  limitBannerText: { color: '#fff', fontSize: 13, flex: 1 },

  // メッセージ行
  bubbleRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  userRow:         { justifyContent: 'flex-end' },

  // ユーザーメッセージ
  userMsgWrap:     { maxWidth: '80%', gap: 4 },
  userBubble:      { borderRadius: 18, borderBottomRightRadius: 4, paddingVertical: 10, paddingHorizontal: 14 },
  userText:        { fontSize: 15, lineHeight: 22 },

  // AIメッセージ（アバターなし・全幅）
  aiMsgWrap:       { paddingTop: 2 },
  addGadgetChip:   { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, borderWidth: 1, borderRadius: UI_METRICS.pillRadius, paddingHorizontal: 12, paddingVertical: 7, marginTop: 10 },
  addGadgetChipText: { fontSize: 13, fontWeight: '600' },
  suggestActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  affiliateDisclosure: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  // 回答の下の操作列。アイコンだけにして回答より目立たせない（押せる大きさは 36 + hitSlop）
  aiActions:       { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: -8 },
  aiActionBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  // AIデータ送信への初回同意
  consentBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  consentCard:     { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: UI_METRICS.sheetRadius, padding: 22, alignItems: 'center' },
  consentTitle:    { fontSize: 19, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  consentBody:     { fontSize: 14, lineHeight: 21, marginTop: 12 },
  consentPrivacyLink: { fontSize: 13, fontWeight: '600', marginTop: 14, textDecorationLine: 'underline' },
  consentAccept:   { width: '100%', borderRadius: UI_METRICS.panelRadius, paddingVertical: 13, alignItems: 'center', marginTop: 20 },
  consentAcceptText: { fontSize: 15, fontWeight: '700' },
  consentDecline:  { paddingVertical: 12, paddingHorizontal: 20 },
  consentDeclineText: { fontSize: 14, fontWeight: '600' },
  contextCard:      { width: '100%', maxWidth: 460, maxHeight: '90%', borderWidth: 1, borderRadius: UI_METRICS.sheetRadius, padding: 20 },
  contextIntro:     { fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' },
  contextRows:      { marginTop: 16 },
  contextRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  contextRowText:   { flex: 1 },
  contextLabel:     { fontSize: 14, fontWeight: '600' },
  contextSub:       { fontSize: 12, lineHeight: 17, marginTop: 2 },

  // デスク添付カード
  planCard:        { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: UI_METRICS.cardRadius, paddingVertical: 10, paddingHorizontal: 12 },
  planCardName:    { fontSize: 14, fontWeight: '700' },
  planCardMeta:    { fontSize: 11, marginTop: 1 },
  planCardDetail:  { borderWidth: 1, borderRadius: UI_METRICS.cardRadius, padding: 12 },

  // エラー表示
  errorBox:        { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: UI_METRICS.panelRadius, paddingVertical: 10, paddingHorizontal: 12 },
  errorText:       { flex: 1, fontSize: 12 },
  retryBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: UI_METRICS.panelRadius, paddingHorizontal: 10, paddingVertical: 6 },
  retryText:       { color: '#fff', fontSize: 12, fontWeight: '700' },

  // 新着ピル
  jumpPillSlot:    { position: 'absolute', bottom: 10, alignSelf: 'center' },
  jumpPill:        { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: UI_METRICS.pillRadius, paddingHorizontal: 12, paddingVertical: 7 },
  jumpPillText:    { fontSize: 12, fontWeight: '700' },

  // サジェストチップ
  suggestRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 },
  suggestChip:     { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  suggestChipText: { fontSize: 13, fontWeight: '600' },

  // 考え中の点。本文の1行目と同じ高さに置き、書き出しと位置がずれないようにする
  thinkingWrap:    { minHeight: 21, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  thinkingDot:     { width: 12, height: 12, borderRadius: 6 },
  thinkingText:    { fontSize: 13, fontVariant: ['tabular-nums'] },
  aiResponseStats: { fontSize: 11, lineHeight: 16, marginTop: 8, fontVariant: ['tabular-nums'] },

  // 画像
  msgImage:        { width: 200, height: 150, borderRadius: UI_METRICS.panelRadius, alignSelf: 'flex-end' },

  // 入力エリア
  inputArea:       { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 6 },
  attachRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingHorizontal: 4 },
  attachImageWrap: { position: 'relative' },
  attachImageThumb:{ width: 64, height: 64, borderRadius: UI_METRICS.controlRadius },
  attachRemove:    { position: 'absolute', top: -6, right: -6 },
  attachChip:      { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: UI_METRICS.chipRadius, paddingVertical: 5, paddingHorizontal: 10, maxWidth: 200 },
  attachChipText:  { flex: 1, fontSize: 13, fontWeight: '500' },

  // 入力ボックス
  // 操作は下端に揃える。中央寄せだと、複数行に伸びたとき送信ボタンが行の途中へ浮く（有名なAIアプリは右下に留まる）。
  // 右の余白は角丸と送信の円が同心に見える量。1行の文の高さを器と同じ 36 にして、1行のときは中央に揃って見せる
  inputBox:        { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: 24, paddingLeft: 14, paddingRight: 5, paddingVertical: 5, gap: 4 },
  input:           { flex: 1, maxHeight: 120, ...multilineInputText({ fontSize: 15, lineHeight: 22, paddingTop: 7, paddingBottom: 7 }, Platform.OS) },
  rightTools:      { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  composerToolSlot: { width: COMPOSER_TOOL_SIZE, height: COMPOSER_TOOL_SIZE, alignItems: 'center', justifyContent: 'center' },
  usageSub:        { fontSize: 11, textAlign: 'center' },
  aiNotice:        { fontSize: 12, lineHeight: 17, textAlign: 'center' },

  // モーダル
  sheet:           { paddingHorizontal: 0 },
  sheetTitle:      { fontSize: 16, fontWeight: '700', paddingHorizontal: 20, marginBottom: 8 },
  sheetEmpty:      { padding: 20, textAlign: 'center' },
  planRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  planName:        { fontSize: 15, fontWeight: '600' },
  planMeta:        { fontSize: 13, marginTop: 2 },
  cancelBtn:       { borderTopWidth: StyleSheet.hairlineWidth, padding: 16, alignItems: 'center', marginTop: 8 },
})
