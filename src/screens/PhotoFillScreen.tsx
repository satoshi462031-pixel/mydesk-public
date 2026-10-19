import { Alert } from '../utils/alert'
// 写真をまとめて登録する画面。
//
// テンプレートから作ると、用途 → テンプレート → 配線図と進んで写真を入れる場所が
// どこにも無い。写真が要ることに気づくのは公開ボタンを押した瞬間（「写真が必要です」）で、
// いちばん遅いタイミングになっていた。ここで先に気づかせる。
//
// 出す場所は配線図を見せた**あと**（デスク画面の機材タブのバナー）。作成の流れの
// 途中に挟むと、まだ何も受け取っていない人に作業を課すことになるし、テンプレートから
// 入る人は「これから組む人」の割合が高く、そもそも撮る物が無い。
//
// 上限（無料4枚 / Pro10枚）に当たったときは画面を奪わない。枠を1つ Pro の案内に
// 差し替えて、押した人だけ Paywall へ送る。
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useHeaderHeight } from '@react-navigation/elements'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { IconCircleButton } from '../components/atoms/IconCircleButton'
import { LocalThumb } from '../components/atoms/LocalThumb'
import { TextField } from '../components/atoms/TextField'
import { SetupActionFooter } from '../components/molecules/SetupActionFooter'
import { SetupProgress } from '../components/molecules/SetupProgress'
import { ICONS } from '../constants/icons'
import { PLAN_LIMITS } from '../constants/plans'
import { useApp } from '../context/AppContext'
import { useSpotlightTarget } from '../context/SpotlightContext'
import { SetupScreenHelp } from '../components/molecules/SetupScreenHelp'
import { CoachAnchor } from '../hooks/useCoachMarks'
import { RemovalMotion, useRemovalMotion } from '../components/molecules/RemovalMotion'
import { AdditionMotion } from '../components/molecules/AdditionMotion'
import { useSubscription } from '../context/SubscriptionContext'
import { useGadgets } from '../hooks/useGadgets'
import { useKeyboardReveal } from '../hooks/useKeyboardReveal'
import { usePlans } from '../hooks/usePlans'
import { backToSetupStep, openGearStep } from '../navigation/setupStepNavigation'
import { trackLimitHit } from '../services/analytics'
import { DeskPlan, PlanStackParamList } from '../types'
import { deletePlanPhoto, pickPlanPhotos, planPhotoSkipMessage } from '../utils/planImages'
import { showPhotoPermissionAlert } from '../utils/confirmation'
import { openPaywall } from '../navigation/rootNavigation'
import { UI_METRICS } from '../constants/ui'
import { saveFirstSetupDraft } from '../store/firstSetupStore'
import { inputMaxLength, tidyMultilineText, trimAndTruncate, truncateChars } from '../utils/truncateText'
import { DESK_NAME_MAX, isUnwrittenDeskName } from '../utils/deskAutoName'
import { autoDeskName } from './PurposeSelectionScreen'
import { DESK_DESCRIPTION_MAX_LENGTH } from '../constants/textLimits'
import { DESK_DESCRIPTION_INPUT_PADDING, DESK_DESCRIPTION_TEXT } from '../components/molecules/DeskDescription'
import { multilineInputText } from '../utils/multilineInputText'

type Props = NativeStackScreenProps<PlanStackParamList, 'PhotoFill'>

// 自動で付いた名前は入力欄に文字として入れず、薄い見本として出す（isUnwrittenDeskName の注記）
function editableDeskName(plan: DeskPlan, lang: 'ja' | 'en'): string {
  return isUnwrittenDeskName(plan.name, autoDeskName(plan, lang)) ? '' : plan.name
}

export function PhotoFillScreen({ route, navigation }: Props) {
  const photoAreaRef = useSpotlightTarget('photo-area')
  const headerHeight = useHeaderHeight()
  const { planId, fromSetup } = route.params
  const { colors: C, lang } = useApp()
  const photoRemoval = useRemovalMotion()
  const addedPhotoUris = useRef(new Set<string>())
  const { getById, updateWith } = usePlans()
  const { gadgets } = useGadgets()
  const { isPro, isLoading: billingLoading } = useSubscription()
  const ja = lang === 'ja'

  // 課金状態の解決前は Pro の枠で扱う（Pro の人が起動直後に上限へ当たらないように）
  const limits = PLAN_LIMITS[isPro || billingLoading ? 'pro' : 'free']
  const maxPhotos = limits.maxPhotosPerDesk
  const maxFileSizeMB = limits.maxFileSizeMB
  const isUpsell = !isPro && !billingLoading

  const plan = getById(planId)
  const images = plan?.images ?? []
  const atLimit = images.length >= maxPhotos

  const autoName = plan ? autoDeskName(plan, lang) : ''
  const [deskName, setDeskName] = useState(plan ? editableDeskName(plan, lang) : '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [finishing, setFinishing] = useState(false)
  const finishInFlightRef = useRef(false)
  const [picking, setPicking] = useState(false)
  // 下の帯は写真が0枚の間だけ注記の分背が高い。固定の下余白では最後の行が帯に接していた
  const [footerH, setFooterH] = useState(0)
  const pickInFlightRef = useRef(false)
  // 説明欄は複数行で背が伸びる。小さい端末で押したとき、キーボードと下の帯の裏に入らないよう送る
  const scrollRef = useRef<ScrollView>(null)
  useKeyboardReveal(scrollRef, footerH)
  const detailsInitializedPlanIdRef = useRef<string | null>(plan ? planId : null)

  useEffect(() => {
    if (!plan || detailsInitializedPlanIdRef.current === planId) return
    detailsInitializedPlanIdRef.current = planId
    setDeskName(editableDeskName(plan, lang))
    setDescription(plan.description ?? '')
  }, [plan, planId, lang])

  useEffect(() => {
    if (!fromSetup) return
    void saveFirstSetupDraft({ screen: 'PhotoFill', planId }).catch(() => {})
  }, [fromSetup, planId])

  const addPhotos = async () => {
    if (pickInFlightRef.current) return
    pickInFlightRef.current = true
    setPicking(true)
    try {
      const result = await pickPlanPhotos({
        planId,
        existing: images,
        limit: maxPhotos - images.length,
        maxFileSizeMB,
      })
      if (result.permissionDenied) {
        showPhotoPermissionAlert(lang)
        return
      }
      if (result.added.length > 0) {
        result.added.forEach((uri) => addedPhotoUris.current.add(uri))
        // 画面を開いている間も配線図の自動再計算が保存を続けるので、控えではなく
        // 保存直前のプランに写真だけを足す
        await updateWith(planId, (p) => ({
          ...p,
          images: [...(p.images ?? []), ...result.added],
          updatedAt: new Date().toISOString(),
        }))
      }
      const skipped = planPhotoSkipMessage(result, maxFileSizeMB, lang)
      if (skipped) {
        Alert.alert(ja ? '一部の写真を追加できませんでした' : 'Some photos were skipped', skipped)
      }
    } finally {
      pickInFlightRef.current = false
      setPicking(false)
    }
  }

  const removePhoto = (uri: string) => {
    Alert.alert(
      ja ? '写真を完全に削除しますか？' : 'Delete photo permanently?',
      ja ? 'この写真は端末から削除され、元に戻せません。' : 'This photo will be deleted from this device and cannot be restored.',
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: ja ? '削除' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            await photoRemoval.run(uri, async () => {
              await deletePlanPhoto(uri)
              await updateWith(planId, (p) => ({
                ...p,
                images: (p.images ?? []).filter((u) => u !== uri),
                updatedAt: new Date().toISOString(),
              }))
            }, 'fade').catch(() => Alert.alert(ja ? '写真を削除できませんでした' : 'Could not delete photo'))
          },
        },
      ],
    )
  }

  // 保存済みのデスク（メモリ上の最新）と比べて、変わったときだけ書く。離れる瞬間にも呼ぶので、
  // 描画時の plan ではなくその時点の値を引く
  const persistDeskDetails = async (rawName: string, rawDescription: string) => {
    const current = getById(planId)
    if (!current) return
    const name = trimAndTruncate(rawName, DESK_NAME_MAX) || autoDeskName(current, lang)
    const nextDescription = truncateChars(tidyMultilineText(rawDescription), DESK_DESCRIPTION_MAX_LENGTH)
    if (name === current.name && nextDescription === (current.description ?? '')) return
    await updateWith(planId, (p) => ({
      ...p,
      name,
      description: nextDescription || undefined,
      updatedAt: new Date().toISOString(),
    }))
  }
  // 戻る・タブ・進捗バーで離れても、入れた名前と説明は残す。写真はその場で保存される画面なので、
  // 名前と説明だけ「完了」を押さないと黙って消えていた
  const leaveSaveRef = useRef(() => {})
  leaveSaveRef.current = () => { void persistDeskDetails(deskName, description) }
  useEffect(() => navigation.addListener('beforeRemove', () => leaveSaveRef.current()), [navigation])

  const saveDeskDetails = async (): Promise<boolean> => {
    const written = trimAndTruncate(deskName, DESK_NAME_MAX)
    const nextDescription = truncateChars(tidyMultilineText(description), DESK_DESCRIPTION_MAX_LENGTH)
    setDeskName(written)
    setDescription(nextDescription)
    await persistDeskDetails(written, nextDescription)
    return true
  }

  const finish = async () => {
    if (finishInFlightRef.current || !navigation.isFocused()) return
    finishInFlightRef.current = true
    setFinishing(true)
    try {
      if (!await saveDeskDetails()) return
      // 保存を待つ間に戻る操作で閉じていたら、ここで replace / goBack すると
      // 一番上にある別の画面を置き換える・閉じる（呼んだ画面ではなく、その時点の一番上に効く）
      if (!navigation.isFocused()) return
      // 作成フローの最後なので、戻るのではなく出来たデスクへ進む。
      // goBack だとマイデスク一覧に落ちて、作ったデスクを一度も見ずに終わる
      if (fromSetup) navigation.replace('WiringResult', { planId })
      else navigation.goBack()
    } catch {
      if (navigation.isFocused()) {
        Alert.alert(ja ? '保存できませんでした' : 'Could not save', ja ? 'もう一度お試しください。' : 'Please try again.')
      }
    } finally {
      finishInFlightRef.current = false
      setFinishing(false)
    }
  }

  if (!plan) {
    return (
      <SafeAreaView style={[styles.container, styles.centered, { backgroundColor: C.bgList }]}>
        <Text style={[styles.hint, { color: C.textMuted }]}>
          {ja ? 'デスクが見つかりません' : 'Desk not found'}
        </Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
      <SetupScreenHelp>
      {fromSetup && <SetupProgress current={3}
        onStepPress={(step) => {
          if (step === 0) backToSetupStep(navigation, 'PurposeSelection', {
            initialPurposes: plan.purposes ?? [],
            initialOtherPurposeLabel: plan.otherPurposeLabel,
            initialOtherPurposeIcon: plan.otherPurposeIcon,
            initialOtherPurposeColor: plan.otherPurposeColor,
            returnPlanId: planId,
            resume: { step: 3, name: 'PhotoFill', params: { planId, fromSetup: true } } as const,
          })
          if (step === 1) openGearStep(navigation, plan, gadgets, 'back')
          if (step === 2) backToSetupStep(navigation, 'DeskPlacement', { planId })
        }}
      />}
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
      >
      <View ref={photoAreaRef} collapsable={false} style={styles.keyboardArea}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, footerH > 0 && { paddingBottom: footerH + 16 }]}
        // 下部バーは一覧に重ねてあるので、右端のスクロールバーもその上で止める（無いと末尾で裏に潜る）
        scrollIndicatorInsets={{ bottom: footerH }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={[styles.leadTitle, { color: C.text }]}>
          {ja ? 'デスク名と写真' : 'Desk name and photos'}
        </Text>

        <Text style={[styles.fieldLabel, { color: C.textSub }]}>
          {ja ? 'デスク名（任意）' : 'Desk name (optional)'}
        </Text>
        {/* 見本に自動の名前を出す。空のまま進めたらこの名前になる、を欄そのもので伝える */}
        <TextField
          value={deskName}
          onChangeText={setDeskName}
          placeholder={autoName}
          maxLength={DESK_NAME_MAX}
          returnKeyType="done"
          onSubmitEditing={() => { void saveDeskDetails() }}
          accessibilityLabel={ja ? 'デスク名（任意）' : 'Desk name (optional)'}
          accessibilityHint={ja ? `空のままなら「${autoName}」になります` : `Leave blank to use "${autoName}"`}
        />

        <View style={styles.descriptionLabelRow}>
          <Text style={[styles.fieldLabel, styles.descriptionLabel, { color: C.textSub }]}>
            {ja ? 'デスクの説明（任意）' : 'Desk description (optional)'}
          </Text>
          <Text style={[styles.characterCount, { color: C.textMuted }]}>
            {description.length}/{DESK_DESCRIPTION_MAX_LENGTH}
          </Text>
        </View>
        <TextInput
          style={[styles.descriptionInput, { color: C.text, borderColor: C.inputBorder, backgroundColor: C.input }]}
          value={description}
          onChangeText={(text) => setDescription(truncateChars(text, DESK_DESCRIPTION_MAX_LENGTH))}
          onBlur={() => { void saveDeskDetails() }}
          placeholder={ja ? '例：木目と白で揃えた、仕事とゲーム兼用のデスクです。' : 'e.g. A work and gaming desk with white gear and a wood top.'}
          placeholderTextColor={C.textMuted}
          maxLength={inputMaxLength(description, DESK_DESCRIPTION_MAX_LENGTH)}
          multiline
          textAlignVertical="top"
          accessibilityLabel={ja ? 'デスクの説明（任意）' : 'Desk description (optional)'}
        />

        <Text style={[styles.photoLabel, { color: C.textSub }]}>
          {ja ? '写真' : 'Photos'}
        </Text>
        <Text style={[styles.hint, { color: C.textMuted }]}>
          {ja
            ? '公開には写真が必要です。最初の1枚が一覧の表紙になります。'
            : 'A photo is required to publish. The first becomes the cover.'}
        </Text>

        <CoachAnchor id="setup-photos"><View style={styles.grid}>
          {images.map((uri, index) => (
            <AdditionMotion key={uri} added={addedPhotoUris.current.has(uri)} onEntered={() => { addedPhotoUris.current.delete(uri) }} contentStyle={styles.photo} style={[styles.cell, { borderColor: C.border, backgroundColor: C.card }]}>
            <RemovalMotion ref={(handle) => photoRemoval.setRef(uri, handle)} collapse={false} style={StyleSheet.absoluteFillObject} contentStyle={styles.photo}>
              <LocalThumb uri={uri} style={styles.photo} />
              {index === 0 && (
                <View style={[styles.coverTag, { backgroundColor: C.accent }]}>
                  <Text style={[styles.coverTagText, { color: C.onAccent }]}>{ja ? '表紙' : 'Cover'}</Text>
                </View>
              )}
              <IconCircleButton
                name={ICONS.close}
                diameter={26}
                size={14}
                color={C.text}
                background={C.card}
                borderColor={C.border}
                borderWidth={1}
                style={styles.removeBtn}
                onPress={() => removePhoto(uri)}
                hitSlop={8}
                accessibilityLabel={ja ? `${index + 1}枚目の写真を削除` : `Delete photo ${index + 1}`}
              />
            </RemovalMotion>
            </AdditionMotion>
          ))}

          {!atLimit ? (
            <TouchableOpacity
              style={[styles.cell, styles.addCell, { borderColor: C.border, backgroundColor: C.chip, opacity: picking ? 0.55 : 1 }]}
              onPress={() => { void addPhotos() }}
              disabled={picking}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={ja ? '写真を選ぶ' : 'Choose photos'}
              accessibilityHint={ja ? '端末から写真を1枚または複数枚選べます' : 'Selects one or more photos from your device'}
            >
              {picking
                ? <ActivityIndicator size="small" color={C.textMuted} />
                : <AppIcon name={ICONS.photo} size={24} color={C.textMuted} />}
              {/* 2列の枠に1行で入れると幅ぎりぎりで、「）」の行頭禁則により「あと10／枚）」と
                  割れる。残り枚数は補足として2行目に分けて書く */}
              <Text style={[styles.addLabel, { color: C.textSub }]}>
                {ja ? '写真を選ぶ' : 'Choose photos'}
                {'\n'}
                <Text style={styles.addLabelSub}>
                  {ja ? `あと${maxPhotos - images.length}枚` : `${maxPhotos - images.length} left`}
                </Text>
              </Text>
            </TouchableOpacity>
          ) : isUpsell ? (
            // 上限に当たっても画面は奪わない。押した人だけ Paywall へ送る
            <TouchableOpacity
              style={[styles.cell, styles.addCell, { borderColor: C.accentIcon, backgroundColor: C.accent + '18' }]}
              onPress={() => {
                trackLimitHit('maxPhotosPerDesk', { current: images.length, max: maxPhotos, placement: 'photo_fill' })
                openPaywall(navigation, 'maxPhotosPerDesk')
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={ja ? 'さらに写真を追加' : 'Add more photos'}
              accessibilityHint={ja ? '写真をさらに登録できるプランを確認します' : 'Shows options that allow more photos'}
            >
              <AppIcon name="crown-outline" size={24} color={C.pro} />
              <Text style={[styles.addLabel, { color: C.accentText }]}>
                {ja
                  ? `Proなら${PLAN_LIMITS.pro.maxPhotosPerDesk}枚まで`
                  : `Up to ${PLAN_LIMITS.pro.maxPhotosPerDesk} with Pro`}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.cell, styles.addCell, { borderColor: C.border, backgroundColor: C.chip }]}>
              <AppIcon name={ICONS.photos} size={24} color={C.textMuted} />
              <Text style={[styles.addLabel, { color: C.textSub }]}>
                {ja ? `写真は${maxPhotos}枚までです` : `Up to ${maxPhotos} photos`}
              </Text>
            </View>
          )}
        </View></CoachAnchor>

        <Text style={[styles.note, { color: C.textMuted }]}>
          {ja
            ? `1枚あたり${maxFileSizeMB}MBまで。写真は端末に保存され、公開するまで誰にも見えません。`
            : `Up to ${maxFileSizeMB}MB each. Photos stay on your device and are not visible to anyone until you publish.`}
        </Text>

        {/* 上限に当たったときだけ Pro を知らせると、4枚を埋めるまで枚数を増やせること自体に
            気づけない。枠が余っているうちからここに出す（押した人だけ案内へ送る点は同じ） */}
        {isUpsell && (
          <TouchableOpacity
            style={styles.proNoteRow}
            onPress={() => openPaywall(navigation, 'maxPhotosPerDesk')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={ja
              ? `Proなら1つのデスクに${PLAN_LIMITS.pro.maxPhotosPerDesk}枚まで登録できます`
              : `Pro allows up to ${PLAN_LIMITS.pro.maxPhotosPerDesk} photos per desk`}
            accessibilityHint={ja ? '写真をさらに登録できるプランを確認します' : 'Shows options that allow more photos'}
          >
            <AppIcon name="crown-outline" size={14} color={C.pro} />
            <Text style={[styles.proNote, { color: C.accentText }]}>
              {ja
                ? `Proなら${PLAN_LIMITS.pro.maxPhotosPerDesk}枚まで登録できます`
                : `Pro allows up to ${PLAN_LIMITS.pro.maxPhotosPerDesk} photos`}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      </View>

      {/* 写真が無いまま閉じる道を必ず残す。テンプレートから入る人は、まだ組んでいない
          デスクの写真を撮れない。行き止まりに見えると、そこでアプリごと閉じられる。
          デスク画面のバナーは写真が0枚の間ずっと残るので、あとからでも必ず戻ってこられる */}
      <SetupActionFooter
        showGuide
        absolute
        title={images.length > 0 ? (ja ? '完了' : 'Done') : (ja ? 'あとで設定する' : 'Set up later')}
        variant={images.length > 0 ? 'primary' : 'secondary'}
        onPress={() => { void finish() }}
        loading={finishing}
        note={images.length === 0
          ? (ja
              ? 'あとでデスクの画面からいつでも登録できます'
              : 'You can add photos any time from the desk screen.')
          : undefined}
        onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
      />
      </KeyboardAvoidingView>
      </SetupScreenHelp>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardArea: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: UI_METRICS.screenGutter, paddingBottom: 110 },
  leadTitle: { fontSize: 20, fontWeight: '800', lineHeight: 27, marginBottom: 3 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  descriptionLabelRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 16, marginBottom: 6 },
  descriptionLabel: { marginTop: 0, marginBottom: 0 },
  characterCount: { marginLeft: 'auto', fontSize: 11 },
  // 字の大きさと左右の余白はデスク詳細のひとこと（DeskDescription）と揃える。詳細の自動折り返しは文節に合わせる
  descriptionInput: {
    minHeight: 88,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: DESK_DESCRIPTION_INPUT_PADDING,
    ...multilineInputText({ ...DESK_DESCRIPTION_TEXT, paddingTop: 11, paddingBottom: 11 }, Platform.OS),
  },
  photoLabel: { fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 4 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  // alignItems を止めないと、折り返す行の高さ（＝中身の高さ）へセルが
  // 引き伸ばされ、cell の aspectRatio が無視されて平たい枠になる
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 },
  // 2列。写真は 4:3 で撮られるものが多いので、セルもその比率に寄せる
  cell: { width: '48%', aspectRatio: 4 / 3, borderRadius: UI_METRICS.panelRadius, borderWidth: 1, overflow: 'hidden' },
  addCell: { alignItems: 'center', justifyContent: 'center', gap: 6, borderStyle: 'dashed', paddingHorizontal: 8 },
  addLabel: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  addLabelSub: { fontSize: 11, fontWeight: '500' },
  photo: { width: '100%', height: '100%' },
  coverTag: { position: 'absolute', left: 8, top: 8, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  coverTagText: { fontSize: 10, fontWeight: '800' },
  // 大きさと形は IconCircleButton が持つ。ここは置き場所だけ
  removeBtn: { position: 'absolute', right: 6, top: 6 },
  note: { fontSize: 12, lineHeight: 17, marginTop: 16 },
  proNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  proNote: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
})
