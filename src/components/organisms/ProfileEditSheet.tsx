import { Alert } from '../../utils/alert'
// プロフィール編集シート（名前・アイコンの写真・@ID）。
//
// マイページのプロフィールと、設定の「プロフィール編集」の両方から開く。以前は設定画面の
// 中にしかなく、マイページで名前を押すと設定のアカウント一覧へ移り、そこでもう一度押して
// ようやく開いた（名前を変えたいだけで、パスワードやメールの並ぶ画面を1枚経由していた）。
//
// 開いた瞬間にキーボードを出さない。アイコンを押して入ってきた人にも名前の入力から
// 始めさせることになり、写真と @ID の欄がキーボードの下に隠れる。
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { AuthorAvatar } from '../atoms/AuthorAvatar'
import { Button } from '../atoms/Button'
import { TextField } from '../atoms/TextField'
import { PublicTagField } from '../molecules/PublicTagField'
import { Toast } from '../molecules/Toast'
import { PhotoViewerModal } from './PhotoViewerModal'
import { AvatarCropModal, AvatarCropRect } from './AvatarCropModal'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { setPublicAvatarUrl, setPublicTag } from '../../services/profiles'
import { syncPublicOwnerName } from '../../services/publishService'
import { copyPublicProfileUrl } from '../../services/shareService'
import { deleteAvatarImage, uploadAvatarImage } from '../../services/storage'
import { localizedErrorMessage } from '../../utils/localizedError'
import { launchImageLibraryFromUserAction } from '../../utils/imagePicker'
import { QUICK_TIMEOUT_MS, STORAGE_TIMEOUT_MS, withTimeout } from '../../utils/networkError'
import { assertPublicContentAllowed } from '../../utils/publicContentModeration'
import { getPublicNickname, setPublicNickname } from '../../utils/publicNickname'
import {
  findPublicTagIssue,
  normalizePublicTag,
  PublicTagIssue,
  publicTagIssueFromError,
  publicTagIssueMessage,
  PUBLIC_TAG_MAX_LENGTH,
  PUBLIC_TAG_MIN_LENGTH,
} from '../../utils/publicTag'
import { trimAndTruncate } from '../../utils/truncateText'
import { hapticError, hapticSuccess, hapticWarning } from '../../utils/haptics'

const NAME_MAX_LENGTH = 20
const WEB_PICKER_RECOVERY_MS = 1500

interface Props {
  visible: boolean
  onClose: () => void
  /** 名前を保存した。呼び出し側の表示（マイページの名前）を追随させる */
  onSaved?: (name: string) => void
  /** 「見え方を確認」。シートを閉じてから呼ぶ */
  onOpenPublicProfile: (tag: string) => void
}

export function ProfileEditSheet({ visible, onClose, onSaved, onOpenPublicProfile }: Props) {
  const { colors: C, lang, reduceMotion } = useApp()
  const { user, profile, refreshProfile } = useAuth()
  const ja = lang === 'ja'

  const [name, setName] = useState('')
  // 端末の名前を読み終えるまでは保存させない。空欄のまま保存されると
  // syncPublicOwnerName('') が走り、公開中のデスクから投稿者名が消える
  const [nameLoaded, setNameLoaded] = useState(false)
  const tagInputRef = useRef<TextInput>(null)
  const [tag, setTag] = useState('')
  const [tagIssue, setTagIssue] = useState<PublicTagIssue | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saveInFlightRef = useRef(false)
  const avatarWriteInFlightRef = useRef(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarCropAsset, setAvatarCropAsset] = useState<ImagePicker.ImagePickerAsset | null>(null)
  // 写真1枚しか無いので、デスクの写真と同じカルーセルは要らない
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [toast, setToastState] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setToast = useCallback((message: string) => {
    setToastState(message)
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null
      setToastState(null)
    }, 2400)
  }, [])
  const visibleRef = useRef(visible)
  const visibleGenerationRef = useRef(0)
  const avatarPickerInFlightRef = useRef(false)
  const avatarPickerAttemptRef = useRef(0)
  visibleRef.current = visible

  useEffect(() => {
    if (!visible) return
    visibleGenerationRef.current += 1
    let active = true
    setNameLoaded(false)
    setName('')
    setTag(profile?.public_tag ?? '')
    setTagIssue(null)
    setTagError(null)
    getPublicNickname()
      .then((stored) => {
        if (!active) return
        setName(stored)
        setNameLoaded(true)
      })
      .catch(() => {
        if (!active) return
        onClose()
        Alert.alert(
          ja ? 'プロフィールを読み込めませんでした' : 'Could not load your profile',
          ja
            ? '端末に保存したニックネームを読み出せませんでした。アプリを開き直してからお試しください。このまま編集すると、公開中のデスクから投稿者名が消えることがあります。'
            : 'Your saved nickname could not be read. Reopen the app and try again — editing now could remove the author name from your public desks.',
        )
      })
    return () => { active = false }
    // 開いたときに一度だけ下書きを入れる。profile の取り直しで入力中の値を戻さない
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
  }, [])

  useEffect(() => {
    if (visible) return
    avatarPickerAttemptRef.current += 1
    avatarPickerInFlightRef.current = false
    setAvatarCropAsset(null)
    setAvatarPreview(null)
  }, [visible])

  const save = async () => {
    if (saveInFlightRef.current || avatarWriteInFlightRef.current || !nameLoaded) return
    const nextName = trimAndTruncate(name, NAME_MAX_LENGTH)
    try {
      assertPublicContentAllowed({ title: '', ownerName: nextName })
    } catch (error) {
      Alert.alert(
        ja ? 'ニックネームを保存できません' : 'Could not save nickname',
        localizedErrorMessage(error, lang, ja ? 'ニックネームを確認してください。' : 'Check your nickname.'),
      )
      return
    }
    // @ID を先に保存する。こちらだけサーバー判定（重複・予約語）で落ちうるので、
    // 落ちたらシートを開いたまま理由と代案を出す
    const nextTag = normalizePublicTag(tag)
    const tagChanged = !!(user && profile && nextTag !== profile.public_tag)
    if (tagChanged) {
      const issue = findPublicTagIssue(nextTag)
      if (issue) {
        setTagIssue(issue)
        return
      }
      try {
        assertPublicContentAllowed({ title: '', ownerName: nextTag })
      } catch (error) {
        setTagError(localizedErrorMessage(error, lang, publicTagIssueMessage('invalid', lang)))
        return
      }
    }

    saveInFlightRef.current = true
    setSaving(true)
    const visibleGeneration = visibleGenerationRef.current
    let saved: string | null = null
    let pendingWrite: Promise<unknown> | null = null
    const waitForSave = <T,>(work: Promise<T>, ms: number): Promise<T> => {
      pendingWrite = work
      const settled = () => { if (pendingWrite === work) pendingWrite = null }
      void work.then(settled, settled)
      return withTimeout(work, ms)
    }
    try {
      if (tagChanged) {
        try {
          await waitForSave(setPublicTag(nextTag), QUICK_TIMEOUT_MS)
          await waitForSave(refreshProfile(), QUICK_TIMEOUT_MS)
        } catch (error) {
          const serverIssue = publicTagIssueFromError(error)
          if (serverIssue) setTagIssue(serverIssue)
          else {
            hapticError()
            setTagError(localizedErrorMessage(error, lang, ja
              ? '通信環境を確認して、もう一度お試しください。'
              : 'Check your connection and try again.'))
          }
          return
        }
      }

      try {
        saved = await waitForSave(setPublicNickname(nextName), STORAGE_TIMEOUT_MS)
      } catch (error) {
        if (visibleRef.current && visibleGenerationRef.current === visibleGeneration) {
          hapticError()
          Alert.alert(
            ja ? 'ニックネームを保存できませんでした' : 'Could not save nickname',
            localizedErrorMessage(pendingWrite ? new Error('STORAGE_OPERATION_PENDING') : error, lang, ja ? 'もう一度お試しください。' : 'Please try again.'),
          )
        }
        return
      }
      if (saved == null) return
      hapticSuccess()
      onSaved?.(saved)
      // 保存中に閉じて再度開いた場合、古い保存完了で新しいシートを閉じない
      if (visibleRef.current && visibleGenerationRef.current === visibleGeneration) onClose()
      // 公開済みデスクの投稿者名は publish 時のコピーなので、ここで追随させないと
      // 名前を変えても・消しても、みんなのデスクには古い名前が残り続ける
      if (user) {
        try {
          await waitForSave(syncPublicOwnerName(saved), QUICK_TIMEOUT_MS)
        } catch {
          hapticError()
          Alert.alert(
            ja ? '公開中のデスクに反映できませんでした' : 'Could not update your public desks',
            ja
              ? 'ニックネームは保存しました。公開中のデスクの投稿者名は、通信できるときにもう一度保存すると反映されます。'
              : 'Your nickname is saved. Save it again when you are online to update the author name on your public desks.',
          )
        }
      }
    } finally {
      if (pendingWrite) {
        // 待機の期限が切れても、遅い保存を次の編集と重ねない。
        const release = () => { saveInFlightRef.current = false }
        void (pendingWrite as Promise<unknown>).then(release, release)
      } else {
        saveInFlightRef.current = false
      }
      setSaving(false)
    }
  }

  // ── アイコンの写真 ──
  // 保存は 059 の RPC を通す。profiles と公開済みデスクの非正規化コピーを
  // 一度に更新する必要があり、クライアントから desks を直接叩かせない。
  const applyAvatar = async (url: string | null, previous: string | null) => {
    await setPublicAvatarUrl(url)
    await refreshProfile()
    // 消すのは差し替えが済んでから。先に消すと、保存に失敗したときに
    // 前のアイコンの実体まで失われて元へ戻せない
    if (previous && previous !== url) await deleteAvatarImage(previous)
  }

  const pickAvatar = async () => {
    if (saveInFlightRef.current || avatarWriteInFlightRef.current || avatarPickerInFlightRef.current) return
    if (!user) {
      Alert.alert(
        ja ? 'ログインが必要です' : 'Sign in required',
        ja ? 'プロフィール写真を設定するにはログインしてください。' : 'Sign in to set a profile photo.',
      )
      return
    }
    const pickerAttempt = ++avatarPickerAttemptRef.current
    avatarPickerInFlightRef.current = true
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    if (Platform.OS === 'web') {
      // ブラウザにファイル選択を遮断されると expo-image-picker の Promise が
      // 完了しない。編集画面を開き直さなくても再試行できるようロックだけ解除する。
      recoveryTimer = setTimeout(() => {
        if (avatarPickerAttemptRef.current === pickerAttempt) {
          avatarPickerInFlightRef.current = false
        }
      }, WEB_PICKER_RECOVERY_MS)
    }
    try {
      // Web のファイル選択はクリック直後のユーザー操作中に開く必要がある。
      // 先に権限 API を await すると、その操作権限が切れてブラウザが黙って遮断する。
      const launch = await launchImageLibraryFromUserAction({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      })
      if (avatarPickerAttemptRef.current !== pickerAttempt || !visibleRef.current) return
      if (launch.permissionDenied) {
        Alert.alert(
          ja ? '写真へのアクセスを許可してください' : 'Allow photo access',
          ja ? '端末の設定で写真へのアクセスを許可してから、もう一度お試しください。' : 'Allow photo access in your device settings, then try again.',
        )
        return
      }
      const picked = launch.result
      if (picked.canceled || picked.assets.length === 0) return
      setAvatarCropAsset(picked.assets[0])
    } catch (error) {
      if (avatarPickerAttemptRef.current !== pickerAttempt || !visibleRef.current) return
      Alert.alert(
        ja ? '写真を選べませんでした' : 'Could not choose a photo',
        localizedErrorMessage(error, lang, ja ? 'もう一度お試しください。' : 'Please try again.'),
      )
    } finally {
      if (recoveryTimer) clearTimeout(recoveryTimer)
      if (avatarPickerAttemptRef.current === pickerAttempt) {
        avatarPickerInFlightRef.current = false
      }
    }
  }

  const saveCroppedAvatar = async (crop: AvatarCropRect) => {
    if (!user || !avatarCropAsset || avatarWriteInFlightRef.current) return
    avatarWriteInFlightRef.current = true
    setAvatarBusy(true)
    try {
      const cropped = await manipulateAsync(
        avatarCropAsset.uri,
        [{ crop }],
        { compress: 1, format: SaveFormat.JPEG },
      )
      const url = await uploadAvatarImage(user.id, cropped.uri)
      await applyAvatar(url, profile?.public_avatar_url ?? null)
      hapticSuccess()
      setAvatarCropAsset(null)
      setToast(ja ? 'アイコンを変更しました' : 'Icon updated')
    } catch {
      hapticError()
      Alert.alert(
        ja ? 'アイコンを変更できませんでした' : 'Could not update your icon',
        ja ? '通信環境を確認して、もう一度お試しください。' : 'Check your connection and try again.',
      )
    } finally {
      avatarWriteInFlightRef.current = false
      setAvatarBusy(false)
    }
  }

  const removeAvatarConfirmed = async () => {
    if (avatarWriteInFlightRef.current) return
    avatarWriteInFlightRef.current = true
    setAvatarBusy(true)
    try {
      await applyAvatar(null, profile?.public_avatar_url ?? null)
      hapticWarning()
    } catch {
      hapticError()
      Alert.alert(
        ja ? 'アイコンを戻せませんでした' : 'Could not reset your icon',
        ja ? '通信環境を確認して、もう一度お試しください。' : 'Check your connection and try again.',
      )
    } finally {
      avatarWriteInFlightRef.current = false
      setAvatarBusy(false)
    }
  }

  // デスクの写真の削除と同じ流儀で確認を取る。Storage の実体も消えるので戻せない
  const removeAvatar = () => {
    if (avatarWriteInFlightRef.current) return
    Alert.alert(
      ja ? 'アイコンの写真を削除しますか？' : 'Delete your icon photo?',
      ja
        ? '写真は完全に削除され、元に戻せません。アイコンは名前の文字に戻ります。'
        : 'The photo is deleted permanently and cannot be restored. Your icon goes back to the letter avatar.',
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: ja ? '削除' : 'Delete', style: 'destructive', onPress: () => { void removeAvatarConfirmed() } },
      ],
    )
  }

  const copyOwnProfileUrl = async () => {
    const own = profile?.public_tag
    if (!own) return
    await copyPublicProfileUrl(own)
    setToast(ja ? 'リンクをコピーしました' : 'Link copied')
  }

  const openOwnPublicProfile = () => {
    const own = profile?.public_tag
    if (!own) return
    onClose()
    onOpenPublicProfile(own)
  }

  const canSave = nameLoaded && !saving && !avatarBusy
  const hasPublicTag = !!profile?.public_tag
  const previewName = name.trim() || (ja ? '名前未設定' : 'No name set')
  const tagChanged = hasPublicTag && normalizePublicTag(tag) !== profile?.public_tag

  return (
    <>
      <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
        <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
          <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
            <TouchableOpacity style={styles.headerButton} onPress={onClose} accessibilityRole="button" hitSlop={4}>
              <Text style={[styles.headerAction, { color: C.textMuted }]}>{ja ? 'キャンセル' : 'Cancel'}</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: C.text }]}>{ja ? 'プロフィール編集' : 'Edit profile'}</Text>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => { void save() }}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel={saving ? (ja ? '保存中' : 'Saving') : (ja ? 'プロフィールを保存' : 'Save profile')}
              accessibilityState={{ disabled: !canSave, busy: saving }}
              hitSlop={4}
            >
              {saving ? <ActivityIndicator size="small" color={C.accentIcon} /> : (
                <Text style={[styles.headerAction, styles.headerSave, { color: C.accentText, opacity: canSave ? 1 : 0.4 }]}>
                  {ja ? '保存' : 'Save'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'android' ? 'height' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets
          >
            <View style={[styles.preview, { backgroundColor: C.card, borderColor: C.border }]}>
            {/* 写真があるならタップは全画面表示。選び直しと外すは下の行に置く
                （デスクのサムネ列と同じ分担。写真が無いときだけ入口を兼ねる） */}
            <TouchableOpacity
              onPress={() => {
                if (profile?.public_avatar_url) setAvatarPreview(profile.public_avatar_url)
                else void pickAvatar()
              }}
              disabled={avatarBusy || saving}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={profile?.public_avatar_url
                ? (ja ? 'アイコンの写真を大きく表示' : 'View icon photo full screen')
                : (ja ? 'アイコンの写真を選ぶ' : 'Choose an icon photo')}
            >
              <AuthorAvatar name={name} tag={tag} imageUrl={profile?.public_avatar_url} size={84} />
              {avatarBusy && (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
            {nameLoaded ? (
              <Text style={[styles.previewName, { color: C.text }]} numberOfLines={2}>{previewName}</Text>
            ) : <ActivityIndicator style={styles.previewName} size="small" color={C.textMuted} />}
            {hasPublicTag && (
              <Text style={[styles.previewTag, { color: C.textMuted }]} numberOfLines={1}>@{normalizePublicTag(tag)}</Text>
            )}
            <View style={styles.avatarActions}>
              <Button
                title={profile?.public_avatar_url ? (ja ? '写真を変える' : 'Change photo') : (ja ? '写真を選ぶ' : 'Choose a photo')}
                variant="neutral"
                size="compact"
                onPress={() => { void pickAvatar() }}
                disabled={avatarBusy || saving}
              />
              {!!profile?.public_avatar_url && (
                <TouchableOpacity style={styles.textButton} onPress={removeAvatar} disabled={avatarBusy || saving} accessibilityRole="button">
                  <Text style={[styles.linkAction, { color: C.danger }]}>{ja ? '写真を削除' : 'Delete photo'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.description, { color: C.textMuted }]}>
              {ja ? '写真は変更した時点で保存されます' : 'Photo changes are saved immediately'}
            </Text>
            </View>

            <View style={[styles.field, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={styles.fieldHeader}>
                <Text style={[styles.label, { color: C.text }]}>{ja ? '表示名' : 'Display name'}</Text>
                <Text style={[styles.counter, { color: C.textMuted }]}>{[...name].length}/{NAME_MAX_LENGTH}</Text>
              </View>
              <TextField
                size="prominent"
                value={name}
                onChangeText={setName}
                onSubmitEditing={() => { if (hasPublicTag) tagInputRef.current?.focus(); else void save() }}
                returnKeyType={hasPublicTag ? 'next' : 'done'}
                submitBehavior={hasPublicTag ? 'submit' : 'blurAndSubmit'}
                maxLength={NAME_MAX_LENGTH}
                placeholder={nameLoaded ? (ja ? '例：ゆう' : 'e.g. Alex') : ''}
                editable={nameLoaded && !saving}
                accessibilityLabel={ja ? '表示名' : 'Display name'}
              />
              <Text style={[styles.description, { color: C.textMuted }]}>
                {ja ? 'みんなのデスクで投稿者名として表示されます' : 'Shown as your author name on public desks'}
              </Text>
            </View>

            {hasPublicTag && (
              <View style={[styles.field, { backgroundColor: C.card, borderColor: C.border }]}>
                <View style={styles.fieldHeader}>
                  <Text style={[styles.label, { color: C.text }]}>{ja ? 'ユーザーID' : 'User ID'}</Text>
                </View>
                <PublicTagField
                  inputRef={tagInputRef}
                  value={tag}
                  onChangeText={(next) => { setTag(next); setTagIssue(null); setTagError(null) }}
                  colors={C}
                  lang={lang}
                  issue={tagIssue}
                  errorMessage={tagError}
                  currentTag={profile?.public_tag}
                  name={name}
                  busy={saving}
                  placeholder={profile?.public_tag}
                  onSubmitEditing={() => { void save() }}
                  hint={ja
                    ? `半角英数字と _ で${PUBLIC_TAG_MIN_LENGTH}〜${PUBLIC_TAG_MAX_LENGTH}文字`
                    : `${PUBLIC_TAG_MIN_LENGTH}–${PUBLIC_TAG_MAX_LENGTH} characters: letters, numbers, and _`}
                />
                {/* 変えると /u/<旧ID> の共有リンクは切れる（転送は持っていない） */}
                {tagChanged && <Text style={[styles.description, { color: C.textSub }]}>
                  {ja
                    ? 'IDを変えると古い共有リンクは開けなくなります'
                    : 'Changing your ID breaks old shared links'}
                </Text>}
              </View>
            )}
            {hasPublicTag && (
              <View style={styles.sharing}>
                <Text style={[styles.description, { color: C.textMuted }]}>
                  {ja ? '保存済みのプロフィール' : 'Your saved profile'}
                </Text>
                <View style={styles.tagActions}>
                  <Button title={ja ? 'リンクをコピー' : 'Copy link'} variant="neutral" size="compact"
                    onPress={() => { void copyOwnProfileUrl() }} disabled={saving} />
                  <Button title={ja ? '見え方を確認' : 'View as visitor'} variant="neutral" size="compact"
                    onPress={openOwnPublicProfile} disabled={saving} />
                </View>
              </View>
            )}
          </ScrollView>
          </KeyboardAvoidingView>
          <Toast visible={toast !== null} message={toast ?? ''} backgroundColor={C.text} textColor={C.card} bottomOffset={40} />
        </SafeAreaView>
      </Modal>

      {/* プロフィールのモーダルより後ろに置く。RN のモーダルは後から出したものが上に載る */}
      <PhotoViewerModal
        uri={avatarPreview}
        lang={lang}
        onClose={() => setAvatarPreview(null)}
        label={ja ? 'アイコンの写真' : 'Icon photo'}
      />
      <AvatarCropModal
        visible={avatarCropAsset !== null}
        uri={avatarCropAsset?.uri ?? null}
        imageWidth={avatarCropAsset?.width ?? 0}
        imageHeight={avatarCropAsset?.height ?? 0}
        processing={avatarBusy}
        onCancel={() => setAvatarCropAsset(null)}
        onConfirm={(crop) => { void saveCroppedAvatar(crop) }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: UI_METRICS.formGutter,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, flexShrink: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  headerButton: { minWidth: 64, minHeight: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center' },
  headerAction: { minWidth: 64, fontSize: 14, fontWeight: '600' },
  headerSave: { textAlign: 'right' },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: UI_METRICS.formGutter, paddingBottom: 48 },
  preview: { alignItems: 'center', padding: 20, borderRadius: UI_METRICS.cardRadius, borderWidth: StyleSheet.hairlineWidth },
  previewName: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  previewTag: { fontSize: 13, marginTop: 4 },
  // 円の上に重ねる。アップロード中は元のアイコンを暗く沈めて操作を受けない
  avatarBusy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', borderRadius: 42, backgroundColor: '#00000066' },
  avatarActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 },
  textButton: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', paddingHorizontal: 8 },
  field: { marginTop: 16, padding: 16, borderRadius: UI_METRICS.cardRadius, borderWidth: StyleSheet.hairlineWidth },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  label: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  counter: { fontSize: 12, fontVariant: ['tabular-nums'] },
  description: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  sharing: { marginTop: 16 },
  tagActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  linkAction: { fontSize: 14, fontWeight: '600' },
})
