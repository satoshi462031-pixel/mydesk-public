// 登録直後に名前と @ID を決めてもらう（061）。
//
// これが無い間、名前も @ID も設定の奥（プロフィール編集）でしか触れなかった。
// メール登録の人は display_name が NULL のまま入ってくるので、そのまま進むと
// 投稿者名が無いデスクが公開される。名乗りは登録の続きとして先に決めてもらう。
//
// **飛ばせない。** 「あとで」を置くと、名前が無いまま公開まで到達できてしまう。
// ただし通信の失敗で足止めはしない — 名前は端末に保存できるので先に保存し、
// サーバーへ届かなかったときは閉じて次の起動でもう一度聞く
// （profiles.public_tag_chosen は立たないまま）。
//
// 出す場所を画面（Root.Screen）ではなくモーダルにしているのは、この質問が
// メール登録・Google・Apple のどれを通っても同じ場所（profiles が出来た直後）で
// 起きるため。認証の分岐ごとに遷移を足すと、どれか一つを足し忘れる。
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { TextField } from '../atoms/TextField'
import { Button } from '../atoms/Button'
import { PublicTagField } from '../molecules/PublicTagField'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { analytics, EVENTS } from '../../services/analytics'
import { setPublicTag } from '../../services/profiles'
import { syncPublicOwnerName } from '../../services/publishService'
import { localizedErrorMessage } from '../../utils/localizedError'
import { assertPublicContentAllowed } from '../../utils/publicContentModeration'
import { trimAndTruncate } from '../../utils/truncateText'
import { getPublicNickname, setPublicNickname } from '../../utils/publicNickname'
import { UI_METRICS } from '../../constants/ui'
import { QUICK_TIMEOUT_MS, withTimeout } from '../../utils/networkError'
import {
  findPublicTagIssue,
  normalizePublicTag,
  PublicTagIssue,
  publicTagIssueFromError,
  publicTagIssueMessage,
  PUBLIC_TAG_MAX_LENGTH,
  PUBLIC_TAG_MIN_LENGTH,
} from '../../utils/publicTag'

const NAME_MAX_LENGTH = 20

/**
 * 名前から @ID の下書きを作る。日本語の名前からは何も残らないので、
 * 3文字に満たなければ抽選値をそのまま下書きにする（空欄から考えさせない）。
 */
function draftTag(name: string, fallback: string): string {
  const draft = name.replace(/[^A-Za-z0-9_]/g, '').slice(0, PUBLIC_TAG_MAX_LENGTH)
  return draft.length >= PUBLIC_TAG_MIN_LENGTH ? draft : fallback
}

export function PublicTagSetupModal() {
  const { colors: C, lang, reduceMotion } = useApp()
  const { profile, refreshProfile } = useAuth()
  const ja = lang === 'ja'

  const needsChoice = !!profile && profile.public_tag_chosen === false
  const [visible, setVisible] = useState(false)
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  // 形式・予約語・重複の理由。重なったときの代案は PublicTagField がこれを見て出す
  const [tagIssue, setTagIssue] = useState<PublicTagIssue | null>(null)
  // 理由で表せない失敗（不適切な語）
  const [tagError, setTagError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const openedAt = useRef(0)
  const tagRef = useRef<TextInput>(null)

  // 下書きを入れるのは開くときだけ。profile が取り直されるたびに入力中の値を
  // 上書きすると、打っている途中で勝手に戻る
  // 下書きのまま通したかを計測で見分けるための控え
  const draftedTag = useRef('')
  const profileId = profile?.id
  useEffect(() => {
    if (!needsChoice) { setVisible(false); return }
    let active = true
    // 別のアカウントで開き直したときに前の人の値を残さない（下書きは非同期で入る）
    setName('')
    setTag('')
    // Google / Apple の表示名は既に profiles に入っている。端末側（機種変更で
    // 引き継いだニックネーム）のほうが本人の直近の指定なので先に見る
    void getPublicNickname()
      .catch(() => '')
      .then((stored) => {
        if (!active) return
        const initial = trimAndTruncate(stored || profile?.display_name || '', NAME_MAX_LENGTH)
        // 読み込みは画面が出たあとに終わる。打ち始めていたら下書きで上書きしない
        setName((prev) => prev || initial)
        draftedTag.current = draftTag(initial, profile?.public_tag ?? '')
        setTag((prev) => prev || draftedTag.current)
      })
    setNameError(null)
    setTagIssue(null)
    setTagError(null)
    setVisible(true)
    openedAt.current = Date.now()
    analytics.track(EVENTS.PROFILE_SETUP_SHOWN)
    return () => { active = false }
  }, [needsChoice, profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (busy) return
    const nextName = trimAndTruncate(name, NAME_MAX_LENGTH)
    const nextTag = normalizePublicTag(tag)

    if (!nextName) {
      setNameError(ja ? '名前を入力してください' : 'Please enter a name')
      return
    }
    try {
      assertPublicContentAllowed({ title: '', ownerName: nextName })
    } catch (e) {
      setNameError(localizedErrorMessage(e, lang, ja ? '名前を確認してください。' : 'Check your name.'))
      return
    }
    const issue = findPublicTagIssue(nextTag)
    if (issue) {
      setTagIssue(issue)
      analytics.track(EVENTS.PROFILE_SETUP_FAILED, { failure_reason: issue })
      return
    }
    try {
      assertPublicContentAllowed({ title: '', ownerName: nextTag })
    } catch (e) {
      setTagError(localizedErrorMessage(e, lang, publicTagIssueMessage('invalid', lang)))
      return
    }

    setBusy(true)
    try {
      await withTimeout((async () => {
        // 名前は端末が正本（publishService が公開時にここから読む）。通信の前に確定させる
        await setPublicNickname(nextName).catch(() => {})
        await syncPublicOwnerName(nextName)
        await setPublicTag(nextTag)
        await refreshProfile()
      })(), QUICK_TIMEOUT_MS)
      analytics.track(EVENTS.PROFILE_SETUP_COMPLETED, {
        duration_ms: Date.now() - openedAt.current,
        // 下書きのまま通したか、自分で打ち直したか
        tag_edited: nextTag !== draftedTag.current,
      })
      setVisible(false)
    } catch (e) {
      const serverIssue = publicTagIssueFromError(e)
      analytics.track(EVENTS.PROFILE_SETUP_FAILED, { failure_reason: serverIssue ?? 'network' })
      if (serverIssue) {
        // 照会では空いていたのに保存の間に取られた場合もここに来る。代案は欄が出す
        setTagIssue(serverIssue)
        return
      }
      // 重複でも予約語でもない＝通信・サーバー側の問題。ここで閉じ込めると
      // 圏外で登録した人がアプリに入れなくなる。印は立てずに通し、次の起動で聞く
      setVisible(false)
    } finally {
      setBusy(false)
    }
  }, [busy, name, tag, lang, ja, refreshProfile])

  return (
    // Android の戻るでは閉じない（onRequestClose は必須なので空で受ける）
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={() => {}}>
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={[styles.title, { color: C.text }]}>
              {ja ? 'プロフィールを決める' : 'Set up your profile'}
            </Text>
            <Text style={[styles.lead, { color: C.textMuted }]}>
              {ja
                ? '公開時の名前とIDです。名前は重複できますが、IDはあなただけのものです。'
                : 'Your public name and ID. Names can repeat; your ID is unique.'}
            </Text>

            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textMuted }]}>{ja ? '名前' : 'Name'}</Text>
              <TextField
                size="prominent"
                invalid={!!nameError}
                value={name}
                // ID の下書きは開いたときの一度きり。名前を打つたびに追従させると、
                // 先に ID を決めた人の値が名前の打ち直しで消える
                onChangeText={(next) => { setName(next); setNameError(null) }}
                autoFocus
                returnKeyType="next"
                // blurOnSubmit を切らないと、ID 欄へ移す前にキーボードが一度閉じて開き直す
                blurOnSubmit={false}
                onSubmitEditing={() => tagRef.current?.focus()}
                maxLength={NAME_MAX_LENGTH}
                placeholder={ja ? '例：ゆう' : 'e.g. Alex'}
                accessibilityLabel={ja ? '表示名' : 'Display name'}
                editable={!busy}
              />
              {!!nameError && <Text style={[styles.hint, { color: C.danger }]}>{nameError}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textMuted }]}>{ja ? 'ID' : 'ID'}</Text>
              <PublicTagField
                value={tag}
                onChangeText={(next) => { setTag(next); setTagIssue(null); setTagError(null) }}
                colors={C}
                lang={lang}
                issue={tagIssue}
                errorMessage={tagError}
                name={name}
                busy={busy}
                placeholder={profile?.public_tag}
                inputRef={tagRef}
                onSubmitEditing={() => { void save() }}
                hint={ja
                  ? `半角英数字と _ で${PUBLIC_TAG_MIN_LENGTH}〜${PUBLIC_TAG_MAX_LENGTH}文字。あとからマイページのプロフィールで変えられます`
                  : `${PUBLIC_TAG_MIN_LENGTH}–${PUBLIC_TAG_MAX_LENGTH} characters: letters, numbers, and _. You can change it later from your profile on My Page.`}
              />
            </View>

          </ScrollView>
          <View style={[styles.footer, { backgroundColor: C.card, borderTopColor: C.border }]}>
            <Button
              title={ja ? 'はじめる' : 'Get started'}
              onPress={() => { void save() }}
              disabled={busy}
              style={styles.submit}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: UI_METRICS.modalGutter, paddingTop: 48 },
  title: { fontSize: 24, fontWeight: '700' },
  lead: { fontSize: 14, lineHeight: 21, marginTop: 12 },
  field: { marginTop: 24 },
  label: { fontSize: 12, fontWeight: '600', lineHeight: 16, marginBottom: 6 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: UI_METRICS.modalGutter, paddingTop: 10, paddingBottom: 10 },
  submit: { marginTop: 0 },
})
