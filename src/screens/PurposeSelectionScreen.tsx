import { Alert } from '../utils/alert'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Dimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { TextField } from '../components/atoms/TextField'
import { CustomPurposeColorEditor } from '../components/molecules/CustomPurposeColorEditor'
import { SetupActionFooter } from '../components/molecules/SetupActionFooter'
import { SetupProgress } from '../components/molecules/SetupProgress'
import { SetupScreenHelp } from '../components/molecules/SetupScreenHelp'
import { PURPOSE_COLORS, purposeIconColor, purposeTintColor } from '../constants/purposeColors'
import { contrastRatio } from '../constants/colors'
export { PURPOSE_COLORS, purposeColor, purposeIconColor, purposeTintColor } from '../constants/purposeColors'
import { CUSTOM_PURPOSE_COLOR_ENABLED } from '../constants/features'
import { normalizeCustomCategoryColor } from '../utils/customCategory'
import { ICONS, MCIconName } from '../constants/icons'
import { PURPOSE_NAME_MAX_LENGTH } from '../constants/textLimits'
import { isIconName } from '../constants/customCategoryIcons'
import { IconPickerModal } from '../components/organisms/IconPickerModal'
import { hapticSelection } from '../utils/haptics'
import { useApp } from '../context/AppContext'
import { trimAndTruncate, truncateChars } from '../utils/truncateText'
import { composeDeskName } from '../utils/deskAutoName'
import {
  SPOTLIGHT_DONE_KEY,
  SPOTLIGHT_PROGRESS_KEY,
  SPOTLIGHT_STEP_KEY,
  TUTORIAL_SEEN_KEY,
  useSpotlight,
  useSpotlightTarget,
} from '../context/SpotlightContext'
import { PlanPurpose, PlanStackParamList } from '../types'
import { saveFirstSetupDraft } from '../store/firstSetupStore'
import { clearTemplateDetailDraft, readTemplateDetailDraft } from '../store/templateDetailDraft'
import { openGearStep, resumeSetupStep } from '../navigation/setupStepNavigation'
import { baseCompositionPicks, compositionTemplateId } from '../utils/deskComposition'
import { useGadgets } from '../hooks/useGadgets'
import { deskCopyTemplateId } from '../utils/deskCopy'
import { FROM_SCRATCH_TEMPLATE_ID } from '../constants/deskTemplates'
import { UI_METRICS } from '../constants/ui'
import { usePlans } from '../hooks/usePlans'

type Props = NativeStackScreenProps<PlanStackParamList, 'PurposeSelection'>

const SCREEN_W = Dimensions.get('window').width
const TILE_W = (SCREEN_W - 16 * 2 - 12) / 2

interface PurposeDef {
  key: PlanPurpose
  label: string
  desc: string
  icon: MCIconName
  color: string
}

export const PURPOSE_DEFS: PurposeDef[] = [
  { key: 'gaming',    label: 'ゲーム',          desc: 'Nintendo Switch 2・PS5・ゲーミングPC',       icon: 'controller-classic',             color: PURPOSE_COLORS.gaming },
  { key: 'work',      label: '仕事',            desc: 'Web会議・ヘッドセット・集中作業',              icon: 'briefcase-outline',              color: PURPOSE_COLORS.work },
  { key: 'creative',  label: 'クリエイティブ',  desc: '動画編集・デザイン・液タブ・外付けストレージ',  icon: 'palette',                        color: PURPOSE_COLORS.creative },
  { key: 'streaming', label: '配信・録画',      desc: 'カメラ・マイク・ライトで配信・録画',           icon: 'broadcast',                      color: PURPOSE_COLORS.streaming },
  { key: 'study',     label: '学習・勉強',      desc: 'デスクライト・ヘッドホンで集中学習',           icon: 'book-open-outline',              color: PURPOSE_COLORS.study },
  { key: 'music',     label: '音楽・DTM',       desc: 'DTM・オーディオIF・マイクで宅録',              icon: 'music-note',                     color: PURPOSE_COLORS.music },
  { key: 'other',     label: 'その他',          desc: '名前を付けて自由にカスタマイズ',               icon: 'dots-horizontal-circle-outline', color: PURPOSE_COLORS.other },
]

export const PURPOSE_LABELS: Record<PlanPurpose, string> = {
  gaming:    'ゲーム',
  work:      '仕事',
  dev:       '開発',
  creative:  'クリエイティブ',
  streaming: '配信・録画',
  study:     '学習',
  music:     '音楽・DTM',
  other:     'その他',
}

export const PURPOSE_LABELS_EN: Record<PlanPurpose, string> = {
  gaming:    'Gaming',
  work:      'Remote Work',
  dev:       'Development',
  creative:  'Creative',
  streaming: 'Streaming',
  study:     'Study',
  music:     'Music / DAW',
  other:     'Other',
}

/**
 * 「その他」ですぐ押せるアイコン。デスクの用途になりそうなものだけを並べる。
 * これで足りない人は「もっと見る」から全件（IconPickerModal）で選ぶ。全件だけにすると
 * 大半の人が探す手間を負うので、よく使う絵はここに残す。
 * 星は保存のボタンと同じ絵になるので並べない（全件からは選べる）。
 */
export const OTHER_PURPOSE_ICONS: MCIconName[] = [
  'dots-horizontal-circle-outline',
  'hammer-wrench',
  'palette-swatch-outline',
  'pencil-ruler',
  'movie-open-outline',
  'book-open-page-variant-outline',
  'camera-outline',
  'chip',
  'flask-outline',
  'coffee-outline',
  'dumbbell',
  'cat',
  'flower-outline',
  'rocket-launch-outline',
]

/** 用途のアイコン。「その他」だけはユーザーが選んだものを優先する */
export function purposeIcon(purpose: PlanPurpose, otherIcon?: string): MCIconName {
  // 公開デスクの値は他人の端末が書いたもの。知らない名前だとフォントの「?」が出る
  if (purpose === 'other' && isIconName(otherIcon)) return otherIcon
  const def = PURPOSE_DEFS.find((item) => item.key === purpose)
  return (def?.icon ?? 'dots-horizontal-circle-outline') as MCIconName
}

/**
 * 用途の表示名。「その他」だけはユーザーが自分で名前を付けられるので、
 * 付いていればそれを使う。各画面が PURPOSE_LABELS を直接引くと自作の名前が消える。
 */
export function purposeLabel(purpose: PlanPurpose, lang: 'ja' | 'en', otherLabel?: string): string {
  const custom = otherLabel?.trim()
  if (purpose === 'other' && custom) return custom
  return (lang === 'ja' ? PURPOSE_LABELS : PURPOSE_LABELS_EN)[purpose]
}

/** デスク名を書かなかったときの名前（「ゲーム・仕事のデスク」）。deskAutoName の注記参照 */
export function autoDeskName(
  plan: { purposes?: PlanPurpose[]; otherPurposeLabel?: string },
  lang: 'ja' | 'en',
): string {
  return composeDeskName((plan.purposes ?? []).map((p) => purposeLabel(p, lang, plan.otherPurposeLabel)), lang)
}

// 「その他」だけは名前を付けて使うフル幅のタイルなので、2列のグリッドから外す
const MAIN_PURPOSES = PURPOSE_DEFS.filter((def) => def.key !== 'other')
const OTHER_DEF = PURPOSE_DEFS.find((def) => def.key === 'other')!

export function PurposeSelectionScreen({ route, navigation }: Props) {
  const { colors, t, lang, isDark } = useApp()
  const returnPlanId = route.params?.returnPlanId
  const resume = route.params?.resume
  const copySource = route.params?.copySource
  const intent = route.params?.intent
  const tutorial = route.params?.tutorial === true
  const { plans, updateWith: updatePlanWith } = usePlans()
  const { gadgets } = useGadgets()
  // 最初から作り始めたときは、前回途中でやめたテンプレート詳細の控えを持ち越さない
  useEffect(() => {
    if (!route.params?.resume) clearTemplateDetailDraft()
    // 開いた時点の状態で1回だけ判断する（後から resume が付くのは詳細から戻ったとき）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [selected, setSelected] = useState<Set<PlanPurpose>>(
    () => new Set(route.params?.initialPurposes ?? []),
  )
  const [otherLabel, setOtherLabel] = useState(() => truncateChars(route.params?.initialOtherPurposeLabel ?? '', PURPOSE_NAME_MAX_LENGTH))
  const [otherIcon, setOtherIcon] = useState<MCIconName>(() => {
    const initial = route.params?.initialOtherPurposeIcon
    return isIconName(initial) ? initial : OTHER_PURPOSE_ICONS[0]
  })
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [otherColorInput, setOtherColorInput] = useState(() =>
    normalizeCustomCategoryColor(route.params?.initialOtherPurposeColor) ?? PURPOSE_COLORS.other)
  const otherColor = CUSTOM_PURPOSE_COLOR_ENABLED
    ? normalizeCustomCategoryColor(otherColorInput)
    : normalizeCustomCategoryColor(route.params?.initialOtherPurposeColor)
  const invalidColor = CUSTOM_PURPOSE_COLOR_ENABLED && selected.has('other') && !otherColor
  const nextInFlightRef = useRef(false)
  const autoTourCheckedRef = useRef(false)
  const forcedTourStartedRef = useRef(false)
  const { running: tourRunning, startTour } = useSpotlight()
  const purposeOptionsRef = useSpotlightTarget('purpose-options')

  // オンボーディングから来た初回は、ストレージ確認を待たずに1歩目を表示する。
  // 非同期の自動開始だけだと、読み込み中に「次へ」を押せて2歩目から始まることがある。
  useLayoutEffect(() => {
    if (!tutorial || forcedTourStartedRef.current) return
    forcedTourStartedRef.current = true
    if (!tourRunning) startTour('pick-purpose', [])
  }, [tutorial, tourRunning, startTour])

  // 初めてデスクを作る人だけ自動開始する。設定から手動開始した場合は、遷移前に
  // running=true になっているため二重開始しない。途中進捗は起動側の再開処理に任せる。
  useEffect(() => {
    if (autoTourCheckedRef.current) return
    autoTourCheckedRef.current = true
    if (tutorial || tourRunning) return
    let active = true
    void Promise.all([
      AsyncStorage.getItem(SPOTLIGHT_DONE_KEY),
      AsyncStorage.getItem(TUTORIAL_SEEN_KEY),
      AsyncStorage.getItem(SPOTLIGHT_PROGRESS_KEY),
      AsyncStorage.getItem(SPOTLIGHT_STEP_KEY),
    ]).then(([done, oldSeen, progress, legacyStep]) => {
      if (active && !done && !oldSeen && !progress && legacyStep === null) startTour()
    }).catch(() => {})
    return () => { active = false }
  }, [tutorial, tourRunning, startTour])

  useEffect(() => {
    if (returnPlanId) return
    const choice = {
      intent,
      purposes: Array.from(selected),
      otherPurposeLabel: selected.has('other') ? otherLabel : undefined,
      otherPurposeIcon: selected.has('other') ? otherIcon : undefined,
      otherPurposeColor: selected.has('other') ? otherColor : undefined,
    }
    if (resume?.name === 'TemplateDetail') {
      const previous = resume.params
      const inputs = readTemplateDetailDraft(previous.templateId, previous.returnPlanId) ?? previous.initialDraft
      void saveFirstSetupDraft({
        screen: 'TemplateDetail', templateId: previous.templateId, composition: previous.composition,
        copySource: previous.copySource, ...choice, ...(inputs ? { inputs } : {}),
      }).catch(() => {})
    } else {
      void saveFirstSetupDraft({ screen: 'PurposeSelection', ...choice }).catch(() => {})
    }
  }, [intent, otherColor, otherIcon, otherLabel, resume, returnPlanId, selected])

  const toggle = (key: PlanPurpose) => {
    // 更新関数の外で鳴らす。中に置くと、開発ビルドの StrictMode が2回呼んで二重に鳴る。
    hapticSelection()
    setSelected((prev) => {
      // 0件は許可する（「次へ」が押せなくなるだけで、選び直しはできる）
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 後ろの段から戻ってきたときは「次へ」でその段へ直接戻す。進捗バーで「機材」を押したときは
  // 機材の段へ進む（作成前なら控えていた機材の段、作成済みなら今のデスクの機材）
  const handleNext = async (target: 'resume' | 'gear' = 'resume') => {
    if (nextInFlightRef.current || invalidColor) return
    nextInFlightRef.current = true
    try {
      const purposes = Array.from(selected)
      const custom = selected.has('other') ? trimAndTruncate(otherLabel, PURPOSE_NAME_MAX_LENGTH) : undefined
      const choice = {
        purposes,
        intent,
        otherPurposeLabel: custom || undefined,
        otherPurposeIcon: selected.has('other') ? otherIcon : undefined,
        otherPurposeColor: selected.has('other') ? otherColor : undefined,
      }
      if (returnPlanId) {
        if (!plans.some((plan) => plan.id === returnPlanId)) throw new Error('Plan unavailable')
        await updatePlanWith(returnPlanId, (previous) => ({
          ...previous,
          purposes,
          otherPurposeLabel: custom || undefined,
          otherPurposeIcon: selected.has('other') ? otherIcon : undefined,
          otherPurposeColor: selected.has('other') ? otherColor : undefined,
          updatedAt: new Date().toISOString(),
        }))
      }
      // 用途の保存を待つ間に戻る操作で離れていたら、次の段を積まない（離れた先の上に作成の画面が出る）
      if (!navigation.isFocused()) return
      // 機材の段へ戻るときも resume で戻す。用途を変えても、用途のぶんの枠は機材の段が今の用途から
      // 作り直すので、入れていた商品名は残ったまま枠だけ替わる
      if (!navigation.isFocused()) return
      if (resume && (target === 'resume' || resume.name === 'TemplateDetail')) resumeSetupStep(navigation, resume, choice)
      // 他人のデスクを参考に作るときは、コピー元の構成へ進む
      else if (copySource) {
        navigation.navigate('TemplateDetail', { templateId: deskCopyTemplateId(copySource.deskId), ...choice, copySource })
      }
      // 「今のデスクを登録する」から来た人は既に機器を持っている。持っていないものが
      // 入った下書きを渡すと引き算から始まるので、枠なしの土台で機材の画面へ直行する
      else if (intent === 'organize' && !returnPlanId) {
        navigation.navigate('TemplateDetail', { templateId: FROM_SCRATCH_TEMPLATE_ID, ...choice })
      } else if (returnPlanId) {
        const plan = plans.find((item) => item.id === returnPlanId)
        if (plan) openGearStep(navigation, { ...plan, ...choice }, gadgets, 'forward')
      } else {
        const composition = baseCompositionPicks()
        navigation.navigate('TemplateDetail', { templateId: compositionTemplateId(composition), composition, ...choice })
      }
    } catch {
      Alert.alert(lang === 'ja' ? '用途を保存できませんでした' : 'Could not save desk purposes')
    } finally {
      nextInFlightRef.current = false
    }
  }

  const rows: PurposeDef[][] = []
  for (let i = 0; i < MAIN_PURPOSES.length; i += 2) {
    rows.push(MAIN_PURPOSES.slice(i, i + 2) as PurposeDef[])
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgList }]}>
      <SetupScreenHelp>
      <SetupProgress current={0}
        onStepPress={(step) => {
          if (step === 1) void handleNext('gear')
          else if (step === resume?.step) void handleNext('resume')
        }}
        canNavigate={(step) => step === 0 || (selected.size > 0 && !invalidColor && (step === 1 || step === resume?.step))}
      />
      <View style={styles.lead}>
        <Text style={[styles.leadTitle, { color: colors.text }]}>
          {lang === 'en' ? 'What is this desk for?' : 'どんな用途のデスクですか？'}
        </Text>
        <Text style={[styles.leadText, { color: colors.textMuted }]}>
          {lang === 'en' ? 'Pick the closest ones. We will tailor the suggested setup.' : '近いものを選ぶと、構成候補を用途に合わせます。'}
        </Text>
      </View>
      <View style={styles.hintRow}>
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {lang === 'en' ? 'Select all that apply' : '当てはまるものをすべて選べます'}
        </Text>
      </View>
      <View ref={purposeOptionsRef} collapsable={false} style={styles.tiles}>
      {/* 「その他」の名前を打ったあと、別の用途をタップしたときに1回目が
          キーボードを閉じるだけで消えないようにする */}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((p) => {
              const isOn = selected.has(p.key)
              const pc = purposeIconColor(p.key, isDark)
              const tint = purposeTintColor(p.key, isDark)
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.tile,
                    { backgroundColor: colors.card, width: TILE_W, borderWidth: 2, borderColor: isOn ? pc : colors.border },
                  ]}
                  onPress={() => toggle(p.key)}
                  activeOpacity={0.82}
                  accessibilityRole="checkbox"
                  accessibilityLabel={t(`purpose.${p.key}`)}
                  accessibilityHint={t(`purpose.${p.key}.desc`)}
                  accessibilityState={{ checked: isOn }}
                >
                  {isOn && (
                    <View style={[styles.checkBadge, { backgroundColor: pc }]}>
                      <AppIcon name={ICONS.check} size={12} color={contrastRatio('#FFFFFF', pc) >= 4.5 ? '#FFFFFF' : '#000000'} centered />
                    </View>
                  )}
                  <View style={styles.tileHead}>
                    <View style={[styles.iconWrap, { backgroundColor: tint + '22' }]}>
                      <AppIcon name={p.icon} size={22} color={pc} centered />
                    </View>
                    {/* 日本語は語中で折り返すため「クリエイティ／ブ」と割れる。ja は1行に収めて縮める */}
                    <Text
                      style={[styles.label, styles.labelHead, { color: colors.text }]}
                      numberOfLines={lang === 'ja' ? 1 : 2}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >{t(`purpose.${p.key}`)}</Text>
                  </View>
                  <Text style={[styles.desc, { color: colors.textMuted }]} numberOfLines={3}>{t(`purpose.${p.key}.desc`)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        ))}

        {/* その他 — フル幅 */}
        {(() => {
          const p = OTHER_DEF
          const isOn = selected.has(p.key)
          const pc = purposeIconColor(p.key, isDark, otherColor)
          const tint = purposeTintColor(p.key, isDark, otherColor)
          return (
            <TouchableOpacity
              style={[
                styles.tileWide,
                { backgroundColor: colors.card, borderWidth: 2, borderColor: isOn ? pc : colors.border },
              ]}
              onPress={() => toggle(p.key)}
              activeOpacity={0.82}
              accessibilityRole="checkbox"
              accessibilityLabel={t(`purpose.${p.key}`)}
              accessibilityHint={t(`purpose.${p.key}.desc`)}
              accessibilityState={{ checked: isOn }}
            >
              {isOn && (
                <View style={[styles.checkBadgeWide, { backgroundColor: pc }]}>
                  <AppIcon name={ICONS.check} size={12} color={contrastRatio('#FFFFFF', pc) >= 4.5 ? '#FFFFFF' : '#000000'} centered />
                </View>
              )}
              <View style={[styles.iconWrap, { backgroundColor: tint + '22' }]}>
                <AppIcon name={isOn ? otherIcon : (p.icon as MCIconName)} size={22} color={pc} centered />
              </View>
              <View style={styles.wideText}>
                <Text style={[styles.label, styles.labelWide, { color: colors.text }]}>{t(`purpose.${p.key}`)}</Text>
                <Text style={[styles.desc, { color: colors.textMuted }]}>{t(`purpose.${p.key}.desc`)}</Text>
                {/* 選んだときだけ出す。畳んでおかないと、使わない人にも入力欄が居座る */}
                {isOn && (
                  <TextField
                    appearance="underline"
                    accentColor={pc}
                    containerStyle={styles.otherInput}
                    value={otherLabel}
                    onChangeText={(value) => setOtherLabel(truncateChars(value, PURPOSE_NAME_MAX_LENGTH))}
                    maxLength={PURPOSE_NAME_MAX_LENGTH}
                    returnKeyType="done"
                    placeholder={lang === 'en' ? 'Name this purpose (e.g. Crafting)' : '用途に名前を付ける（例：工作）'}
                    accessibilityLabel={lang === 'en' ? 'Name for this purpose' : 'この用途の名前'}
                  />
                )}
                {isOn && (
                  <View style={styles.iconPicker}>
                    {/* 全件から選んだ絵は候補の先頭に出す。並びに無いと、何を選んだか画面から分からない */}
                    {(OTHER_PURPOSE_ICONS.includes(otherIcon) ? OTHER_PURPOSE_ICONS : [otherIcon, ...OTHER_PURPOSE_ICONS]).map((name) => {
                      const on = name === otherIcon
                      return (
                        <TouchableOpacity
                          key={name}
                          style={[
                            styles.iconChoice,
                            { borderColor: on ? pc : colors.border, backgroundColor: on ? tint + '22' : 'transparent' },
                          ]}
                          onPress={() => setOtherIcon(name)}
                          activeOpacity={0.7}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={lang === 'en' ? `Icon ${name}` : `アイコン ${name}`}
                        >
                          <AppIcon name={name} size={19} color={on ? pc : colors.textMuted} centered />
                        </TouchableOpacity>
                      )
                    })}
                    <TouchableOpacity
                      style={[styles.iconMore, { borderColor: colors.border }]}
                      onPress={() => setIconPickerOpen(true)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={lang === 'en' ? 'More icons' : 'ほかのアイコンから選ぶ'}
                    >
                      <AppIcon name="view-grid-plus-outline" size={17} color={colors.accentText} />
                      <Text style={[styles.iconMoreText, { color: colors.accentText }]}>
                        {lang === 'en' ? 'More' : 'もっと見る'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                {isOn && CUSTOM_PURPOSE_COLOR_ENABLED && (
                  <CustomPurposeColorEditor value={otherColorInput} onChange={setOtherColorInput} />
                )}
              </View>
            </TouchableOpacity>
          )
        })()}
      </ScrollView>

      <IconPickerModal
        visible={iconPickerOpen}
        title={lang === 'en' ? 'Choose an icon' : 'アイコンを選ぶ'}
        selected={otherIcon}
        tint={purposeIconColor('other', isDark, otherColor)}
        onClose={() => setIconPickerOpen(false)}
        onSelect={(icon) => { if (isIconName(icon)) setOtherIcon(icon) }}
      />

      <SetupActionFooter
        showGuide
        title={selected.size > 0 ? t('purpose.nextBtn', { n: selected.size }) : t('purpose.selectHint')}
        onPress={() => { void handleNext() }}
        disabled={selected.size === 0 || invalidColor}
        accessibilityLabel={selected.size > 0 ? t('purpose.nextBtn', { n: selected.size }) : t('purpose.selectHint')}
      />
      </View>
      </SetupScreenHelp>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  lead: { paddingHorizontal: 16, paddingTop: 14 },
  leadTitle: { fontSize: 20, fontWeight: '800', lineHeight: 27 },
  leadText: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  hintRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  hint: {
    flex: 1,
    fontSize: 13,
    textAlign: 'center',
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
  tiles: { flex: 1 },
  scroll: {
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingBottom: 24,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  tile: {
    borderRadius: UI_METRICS.cardRadius,
    padding: 12,
  },
  tileWide: {
    borderRadius: UI_METRICS.cardRadius,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  checkBadgeWide: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 右上のチェックバッジに文字が潜り込まないよう paddingRight で場所を空けている
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 18,
    marginBottom: 8,
  },
  wideText: { flex: 1 },
  label: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  labelHead: { flex: 1 },
  labelWide: { marginBottom: 2 },
  desc: { fontSize: 12, lineHeight: 17 },
  otherInput: { marginTop: 8 },
  iconPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  iconChoice: {
    width: 38, height: 38, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  iconMore: {
    height: 38, borderRadius: UI_METRICS.controlRadius, borderWidth: 1.5, borderStyle: 'dashed',
    paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  iconMoreText: { fontSize: 12, fontWeight: '700' },

})
