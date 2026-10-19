import { Alert } from '../../utils/alert'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { useDeskShareUrl } from '../../hooks/useDeskShareUrl'
import { UNLISTED_PUBLISH_ENABLED } from '../../constants/features'
import { ICONS } from '../../constants/icons'
import { AppColors } from '../../context/AppContext'
import { PublishVisibility } from '../../services/publishService'
import { registerPushToken } from '../../services/pushNotifications'
import { UI_METRICS } from '../../constants/ui'

export type PublishState = 'idle' | 'loading' | 'done' | 'error'

/** 公開ページを開ける見え方。非公開は「公開を取り消す」の側で扱う */
export type OpenVisibility = 'public' | 'unlisted'

interface Props {
  visible: boolean
  onClose: () => void
  state: PublishState
  error: string
  deskId: string | null
  visibility: PublishVisibility | null
  deskName: string
  /** 自分の @ID。共有URLに載せる（末尾を削るとプロフィールに着く） */
  ownerTag?: string | null
  gadgetCount: number
  totalPrice: number
  colors: AppColors
  lang: 'ja' | 'en'
  fmtPrice: (n: number | null | undefined) => string
  /** 選んだ見え方で公開する */
  onPublish: (visibility: OpenVisibility) => void
  onUnpublish: () => void
  /** 公開中のデスクを「公開」と「URL限定」の間で切り替える */
  onChangeVisibility?: (visibility: OpenVisibility) => void
  changingVisibility?: boolean
  /** 公開中で、いまの内容を公開ページへ上書きできるか */
  canUpdate?: boolean
  updating?: boolean
  onUpdate?: () => void
  /** 公開後に中身が変わっていて、公開ページが古いままか */
  outdated?: boolean
  /** 「SNSで共有」で一緒に貼るデスクの写真（端末内のファイル） */
  photoUris?: string[]
}

/**
 * デスクの公開シート。公開の確認 → 実行中 → 完了（リンク表示・SNSシェア・公開取消）を扱う。
 * 「公開を取り消す」は公開中（URL限定を含む）のときだけ出す（非公開のデスクに対しては意味がないため）。
 */
export function PublishModal({
  visible, onClose, state, error, deskId, visibility, deskName, ownerTag, gadgetCount, totalPrice,
  colors: C, lang, fmtPrice, onPublish, onUnpublish, onChangeVisibility, changingVisibility = false,
  canUpdate = false, updating = false, onUpdate, outdated = false, photoUris,
}: Props) {
  const ja = lang === 'ja'
  const isOpen = deskId != null && (visibility === 'public' || visibility === 'unlisted')
  const url = useDeskShareUrl(deskId, visibility, ownerTag, visible)
  const [sharing, setSharing] = useState(false)
  const shareInFlightRef = useRef(false)
  // 「リンクを作成しました！」は公開した直後だけにする。すでに公開中のデスクを
  // 開いただけでこの文言が出ると、開くたびに新しいリンクが作られたように見える
  const [justPublished, setJustPublished] = useState(false)
  // 公開する前に選ぶ見え方。前に URL限定で公開していたデスクは URL限定から始める
  // （取り消したデスクを再公開するとき、黙ってみんなのデスクに載せない）
  const [choice, setChoice] = useState<OpenVisibility>('public')
  useEffect(() => {
    if (!visible) { setJustPublished(false); return }
    if (state === 'loading') setJustPublished(true)
  }, [visible, state])
  useEffect(() => {
    // 入口を閉じている間は、選べない選択肢のまま URL限定で公開しない
    if (visible && state === 'idle') setChoice(UNLISTED_PUBLISH_ENABLED && visibility === 'unlisted' ? 'unlisted' : 'public')
    // 開いたときに一度だけ合わせる。選んでいる途中で親の値に戻さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
  const closeIfIdle = () => { if (state !== 'loading') onClose() }

  // 公開した直後に通知の許可を聞く（096）。拍手が届いたと知らせられるのは公開したデスクだけなので、
  // 何の通知かが伝わるのはこの瞬間。まだ聞いていない人にだけダイアログが出る（聞き済みなら宛先の登録だけ）。
  // URL限定はみんなのデスクに載らず拍手も受け付けないので聞かない
  useEffect(() => {
    if (visible && state === 'done' && justPublished && visibility === 'public') {
      void registerPushToken(lang, { prompt: true })
    }
  }, [visible, state, justPublished, visibility, lang])

  /**
   * 処理中は誤操作で閉じないようにしているが、通信が返ってこないと閉じる手段が
   * まったく無くなり、アプリを終了するしかなくなる（Wi-Fi につながっているのに
   * 外へ出られない状態で起きる）。しばらく終わらないときだけ逃げ道を出す。
   */
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (!visible || state !== 'loading') { setStuck(false); return }
    const timer = setTimeout(() => setStuck(true), 8000)
    return () => clearTimeout(timer)
  }, [visible, state])

  // コピーは shareService 経由に通す（直に Clipboard を呼ぶと計測から漏れる）
  const copyUrl = async () => {
    if (!deskId) return
    try {
      const { copyPublicUrl } = await import('../../services/shareService')
      const copiedUrl = await copyPublicUrl(deskId, ownerTag)
      Alert.alert(ja ? 'コピーしました' : 'Copied', copiedUrl)
    } catch {
      Alert.alert(ja ? 'コピーできませんでした' : 'Could not copy the URL')
    }
  }

  const shareToSns = async () => {
    if (!deskId || shareInFlightRef.current) return
    shareInFlightRef.current = true
    setSharing(true)
    try {
      const { shareDesk } = await import('../../services/shareService')
      await shareDesk({ deskId, deskName, ownerTag, totalPrice, deviceCount: gadgetCount, photoUris }, lang)
    } catch {
      // ユーザーがシェアシートをキャンセルした場合も含まれるため、エラー表示はしない
    } finally {
      shareInFlightRef.current = false
      setSharing(false)
    }
  }

  // 見え方の選択。公開前（確認画面）と公開後（完了画面）で同じ形を使う。
  // 中身の違いは「どこに載るか」なので、説明にはそれだけを書く
  const renderVisibilityChoice = (value: OpenVisibility, onSelect: (next: OpenVisibility) => void, disabled: boolean) => (
    <View style={styles.choiceList} accessibilityRole="radiogroup">
      {(['public', 'unlisted'] as const).map((option) => {
        const selected = value === option
        return (
          <TouchableOpacity
            key={option}
            style={[styles.choice, {
              borderColor: selected ? C.accentIcon : C.border,
              backgroundColor: selected ? C.accent + '18' : C.card,
              opacity: disabled && !selected ? 0.55 : 1,
            }]}
            onPress={() => onSelect(option)}
            disabled={disabled}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
          >
            <AppIcon
              name={option === 'public' ? ICONS.publish : ICONS.link}
              size={18}
              color={selected ? C.accentText : C.textMuted}
            />
            <View style={styles.choiceBody}>
              <Text style={[styles.choiceTitle, { color: C.text }]}>
                {option === 'public' ? (ja ? '公開' : 'Public') : (ja ? 'URL限定' : 'Unlisted')}
              </Text>
              <Text style={[styles.choiceDesc, { color: C.textMuted }]}>
                {option === 'public'
                  ? (ja ? 'みんなのデスク・検索・プロフィールに載ります' : 'Listed in Explore, search, and your profile')
                  : (ja ? 'リンクを知っている人だけが見られます' : 'Only people with the link can see it')}
              </Text>
            </View>
            {selected && <AppIcon name={ICONS.check} size={16} color={C.accentText} />}
          </TouchableOpacity>
        )
      })}
    </View>
  )

  const currentOpen: OpenVisibility = visibility === 'unlisted' ? 'unlisted' : 'public'

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={closeIfIdle}
      // OS の共有シートが返さなくても、モーダル自体は閉じられる
      dismissDisabled={state === 'loading' || updating || changingVisibility}
    >

          {state === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator color={C.accentIcon} size="large" />
              <Text style={[styles.loadingText, { color: C.text }]}>{ja ? '公開中…' : 'Publishing...'}</Text>
              {stuck && (
                <>
                  <Text style={[styles.stuckNote, { color: C.textMuted }]}>
                    {ja
                      ? '時間がかかっています。通信環境が悪いのかもしれません。'
                      : 'This is taking a while. Your connection may be poor.'}
                  </Text>
                  <TouchableOpacity onPress={onClose} style={styles.unpublishBtn} accessibilityRole="button">
                    <Text style={[styles.unpublishText, { color: C.accentText }]}>
                      {ja ? '閉じる（処理は続きます）' : 'Close (this keeps running)'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : state === 'done' ? (
            <View style={styles.doneWrap}>
              <AppIcon name="check-circle-outline" size={40} color={justPublished ? C.success : outdated ? C.update : C.textSub} />
              <Text style={[styles.doneTitle, { color: C.text }]}>
                {justPublished
                  ? (ja ? 'リンクを作成しました' : 'Link created!')
                  : outdated
                    ? (ja ? '公開ページが古い内容です' : 'The public page is out of date')
                    : currentOpen === 'unlisted'
                      ? (ja ? 'URL限定で公開中のデスク' : 'This desk is unlisted')
                      : (ja ? '公開中のデスク' : 'This desk is public')}
              </Text>
              {!justPublished && outdated && (
                <Text style={[styles.outdatedNote, { color: C.textSub }]}>
                  {ja
                    ? '公開したあとに内容を変えています。下のボタンで公開ページに反映してください。'
                    : 'You changed this desk after publishing. Use the button below to apply your changes.'}
                </Text>
              )}
              <TouchableOpacity style={[styles.urlRow, { backgroundColor: C.bgList }]} onPress={copyUrl} activeOpacity={0.7}>
                <AppIcon name={ICONS.link} size={14} color={C.textMuted} />
                <Text style={[styles.urlText, { color: C.textSub }]} numberOfLines={1} ellipsizeMode="middle">{url}</Text>
                <AppIcon name={ICONS.copy} size={14} color={C.textMuted} />
              </TouchableOpacity>
              {/* 公開したあとも切り替えられる。URL は変わらないので、共有したリンクはどちらでも開ける */}
              {UNLISTED_PUBLISH_ENABLED && onChangeVisibility && renderVisibilityChoice(currentOpen, (next) => {
                if (next !== currentOpen) onChangeVisibility(next)
              }, changingVisibility || updating)}
              {/* 公開ページの上書き。デスク画面のフッターではなくここに置く
                  （公開中のデスクにしか意味がなく、リンクと並べたほうが用途が伝わるため） */}
              {canUpdate && onUpdate && (
                // 更新が要るときだけ塗りにして、押すべきボタンを1つに絞る。
                // 内容が一致しているときに同じ強さで出すと、毎回押す操作に見える
                <TouchableOpacity
                  style={[
                    styles.updateBtn,
                    { backgroundColor: outdated ? C.update : C.chip, opacity: updating ? 0.55 : 1 },
                  ]}
                  onPress={onUpdate}
                  disabled={updating}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? '公開ページを更新' : 'Update public page'}
                  accessibilityHint={ja ? '変更内容をほかの人が見るページへ反映します' : 'Applies your latest changes to the page others can see'}
                >
                  {updating
                    ? <ActivityIndicator size="small" color={outdated ? C.onUpdate : C.update} />
                    : <AppIcon name="cloud-upload-outline" size={16} color={outdated ? C.onUpdate : C.update} />}
                  <Text style={[styles.updateBtnText, { color: outdated ? C.onUpdate : C.update }]}>
                    {updating
                      ? (ja ? '更新中…' : 'Updating…')
                      : outdated
                        ? (ja ? '変更を公開ページに反映' : 'Apply changes to the page')
                        : (ja ? '公開ページを更新' : 'Update public page')}
                  </Text>
                </TouchableOpacity>
              )}
              <View style={styles.actions}>
                <Button
                  title={ja ? 'SNSで共有' : 'Share'}
                  leading={<AppIcon name={ICONS.share} size={16} color={C.onAccent} />}
                  loading={sharing}
                  size="compact"
                  shape="control"
                  style={styles.actionBtn}
                  onPress={shareToSns}
                />
                <Button title={ja ? '閉じる' : 'Close'} variant="neutral" size="compact" shape="control" style={styles.actionBtn} onPress={onClose} />
              </View>
              <TouchableOpacity onPress={onUnpublish} style={styles.unpublishBtn} accessibilityRole="button">
                <Text style={[styles.unpublishText, { color: C.danger }]}>{ja ? '公開を取り消す' : 'Unpublish'}</Text>
              </TouchableOpacity>
            </View>
          ) : state === 'error' ? (
            <View style={styles.center}>
              <AppIcon name="alert-circle-outline" size={36} color={C.danger} />
              <Text style={[styles.loadingText, { color: C.text }]}>{error}</Text>
              <Button title={ja ? '再試行' : 'Retry'} size="compact" shape="control" style={[styles.actionBtn, { marginTop: 12 }]} onPress={() => onPublish(choice)} />
            </View>
          ) : (
            // idle: 確認画面
            <View style={styles.confirmWrap}>
              <Text style={[styles.confirmTitle, { color: C.text }]}>
                {deskId && visibility === 'private'
                  ? (ja ? 'デスクを再公開' : 'Re-publish Desk')
                  : (ja ? 'このデスクを公開しますか？' : 'Publish this desk?')}
              </Text>
              {/* 公開の同意はここだけで取るので、見えるようになるものは漏らさず書く。
                  メモ・URL は自分用のつもりで書いている人がいる */}
              <Text style={[styles.confirmDesc, { color: C.textSub }]}>
                {ja
                  ? 'リンクを知る人は、写真・商品情報（メモ・URLを含む）・金額・配線・履歴を閲覧できます。公開はいつでも取り消せます。'
                  : 'Anyone with the link can see photos, product details (including notes and URLs), prices, wiring and history. Unpublish anytime.'}
              </Text>
              <View style={styles.confirmStats}>
                <Text style={[styles.confirmStat, { color: C.text }]}>
                  {ja ? `${gadgetCount}台のガジェット` : `${gadgetCount} ${gadgetCount === 1 ? 'gadget' : 'gadgets'}`}
                </Text>
                <Text style={[styles.confirmStat, { color: C.textMuted }]}>・</Text>
                <Text style={[styles.confirmStat, { color: C.text }]}>{fmtPrice(totalPrice)}</Text>
              </View>
              {UNLISTED_PUBLISH_ENABLED && renderVisibilityChoice(choice, setChoice, false)}
              <View style={styles.actions}>
                <Button
                  title={choice === 'unlisted' ? (ja ? 'URL限定で公開' : 'Publish unlisted') : (ja ? '公開する' : 'Publish')}
                  leading={<AppIcon name={choice === 'unlisted' ? ICONS.link : ICONS.publish} size={16} color={C.onAccent} />}
                  size="compact"
                  shape="control"
                  style={styles.actionBtn}
                  onPress={() => onPublish(choice)}
                />
                <Button title={ja ? 'キャンセル' : 'Cancel'} variant="neutral" size="compact" shape="control" style={styles.actionBtn} onPress={onClose} />
              </View>
              {isOpen && (
                <TouchableOpacity onPress={onUnpublish} style={styles.unpublishBtn} accessibilityRole="button">
                  <Text style={[styles.unpublishText, { color: C.danger }]}>{ja ? '公開を取り消す' : 'Unpublish'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 28, gap: 12 },
  loadingText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },

  doneWrap: { alignItems: 'center', gap: 12, paddingBottom: 4 },
  doneTitle: { fontSize: 17, fontWeight: '800' },
  outdatedNote: { fontSize: 12, lineHeight: 18, textAlign: 'center', alignSelf: 'stretch' },
  stuckNote: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch', borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 12, paddingVertical: 11 },
  urlText: { flex: 1, fontSize: 12 },
  updateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'stretch', borderRadius: UI_METRICS.controlRadius, paddingVertical: 12 },
  updateBtnText: { fontSize: 14, fontWeight: '700' },

  choiceList: { gap: 8, alignSelf: 'stretch' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  choiceBody: { flex: 1 },
  choiceTitle: { fontSize: 14, fontWeight: '700' },
  choiceDesc: { fontSize: 12, lineHeight: 17, marginTop: 1 },

  confirmWrap: { gap: 10 },
  confirmTitle: { fontSize: 17, fontWeight: '800' },
  confirmDesc: { fontSize: 13, lineHeight: 19 },
  confirmStats: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  confirmStat: { fontSize: 13, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 4 },
  actionBtn: { flex: 1 },

  unpublishBtn: { alignSelf: 'center', paddingVertical: 10, marginTop: 4 },
  unpublishText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
})
