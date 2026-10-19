import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { COACH_SCREEN, CoachScope, useCoachMarks, useCoachTarget } from '../hooks/useCoachMarks'
import { CONNECTION_METHOD_COACH } from '../constants/gadgetCoachSteps'
import { ICONS } from '../constants/icons'
import { cableLabel, portIconColor } from '../constants/portTypes'
import { UI_METRICS } from '../constants/ui'
import { AppColors, useApp } from '../context/AppContext'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { cabledConnectionGroups } from '../utils/wiringEngine'
import { CableChoice, Gadget, MapConnection, PlanStackParamList } from '../types'
import { baseMapNodeId, BATTERY_ID, DECOR_ID, SOLAR_ID, WALL_ID } from '../utils/connectionMapLayout'
import { localizedGadgetName } from '../utils/localizedGadgetName'
import { Alert } from '../utils/alert'

type Props = NativeStackScreenProps<PlanStackParamList, 'ConnectionMethod'>

// ─── つなぎ方 ────────────────────────────────────────────────────
//
// 接続1本ずつに、実際に使っているケーブルを割り当てる画面。
// 同じ編集は配線図の線をタップしてもできるが、線は細くて数が多いと探せない。
// ここでは上から順に片付けられるようにする。
//
// **未設定を「本体付属」とみなさない。** 既定で付属と書くと、家にあった別の1本を
// 使っている人のデスクにも「付属」と出て公開されるため、押した線にだけ付く（types/index.ts）。

/** 電源系の仮想ノードは gadgets に実体が無いので、配線図と同じ名前で出す */
function useNodeName(gadgets: Gadget[]): (id: string) => string {
  const { lang } = useApp()
  const byId = useMemo(() => new Map(gadgets.map((g) => [g.id, g])), [gadgets])
  const T = (ja: string, en: string) => (lang === 'en' ? en : ja)
  return (id: string) => {
    // L・R・ウーファーは1台のスピーカーから分かれた仮想ノード。自前で L/R だけ剥がしていた
    // ため、ウーファー（__SUB）は剥がれずガジェットを引けず、名前が「—」になっていた。
    // 剥がし方は配線図と同じ baseMapNodeId に寄せる（種類が増えてもここは直さなくてよい）
    const base = baseMapNodeId(id)
    const gadget = byId.get(base)
    const name = base === WALL_ID ? T('コンセント', 'Outlet')
      : base === SOLAR_ID ? T('ソーラーパネル', 'Solar panel')
      : base === BATTERY_ID ? T('電池・バッテリー', 'Battery')
      : base === DECOR_ID ? T('飾り', 'Decor')
      : gadget ? localizedGadgetName(gadget, lang)
      : '—'
    if (id.endsWith('__SUB')) return `${name} (${T('ウーファー', 'Subwoofer')})`
    if (id.endsWith('__L')) return `${name} (L)`
    if (id.endsWith('__R')) return `${name} (R)`
    return name
  }
}

function ChoiceRow({
  connection, fromName, toNames, colors: C, lang, isDark, onPickIncluded, onClear,
}: {
  connection: MapConnection
  fromName: string
  /** 2in1 の枝は挿し先が複数ある。1行につなげると半幅に収まらず2台目以降が「…」で消える */
  toNames: string[]
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
  onPickIncluded: () => void
  onClear: () => void
}) {
  const T = (ja: string, en: string) => (lang === 'en' ? en : ja)
  const choice = connection.cableChoice
  const typeColor = portIconColor(connection.cableType, isDark)
  const rowTarget = useCoachTarget('connection-row')
  const includedTarget = useCoachTarget('connection-included')
  const clearTarget = useCoachTarget('connection-clear')

  return (
    <View ref={rowTarget} collapsable={false} style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={styles.rowHead}>
        <Text style={[styles.endpoint, styles.endpointText, { color: C.text }]} numberOfLines={1}>{fromName}</Text>
        <AppIcon name={ICONS.chevronRight} size={14} color={C.textMuted} />
        <View style={styles.endpoint}>
          {toNames.map((name, i) => (
            <Text key={i} style={[styles.endpointText, { color: C.text }]} numberOfLines={1}>{name}</Text>
          ))}
        </View>
      </View>

      <View style={styles.rowBody}>
        <View style={styles.typeChip}>
          <View style={[styles.typeLine, { backgroundColor: typeColor }]} />
          <Text style={[styles.typeName, { color: C.textMuted }]} numberOfLines={1}>
            {cableLabel(connection.cableType, lang)}
          </Text>
          {/* ステレオの L/R・デュアル電源。1行で「×2」と出す（申告は2本まとめて1つ） */}
          {(connection.count ?? 1) > 1 && (
            <Text style={[styles.typeCount, { color: C.textSub }]}>{`×${connection.count}`}</Text>
          )}
        </View>

        {choice?.kind === 'product' ? (
          <TouchableOpacity
            ref={clearTarget}
            style={[styles.picked, { borderColor: C.border, backgroundColor: C.input }]}
            onPress={onClear}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${choice.name} ${T('を外す', 'remove')}`}
          >
            <Text style={[styles.pickedName, { color: C.text }]} numberOfLines={1}>{choice.name}</Text>
            <AppIcon name={ICONS.close} size={14} color={C.textMuted} />
          </TouchableOpacity>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              ref={includedTarget}
              style={[
                styles.action,
                { borderColor: choice?.kind === 'included' ? C.accentIcon : C.border },
                choice?.kind === 'included' && { backgroundColor: C.accent },
              ]}
              onPress={onPickIncluded}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: choice?.kind === 'included' }}
              accessibilityLabel={T('本体付属', 'Included')}
            >
              <Text
                style={[styles.actionLabel, { color: choice?.kind === 'included' ? C.onAccent : C.textSub }]}
                numberOfLines={1}
              >
                {T('本体付属', 'Included')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  )
}

export function ConnectionMethodScreen({ route, navigation }: Props) {
  const { planId } = route.params
  const { colors: C, lang, isDark, t } = useApp()
  const coach = useCoachMarks()
  const { target: coachTarget, open: openCoach } = coach
  const openHelp = useCallback(() => { void openCoach(CONNECTION_METHOD_COACH) }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderIconButton name="help-circle-outline" color={C.text} onPress={openHelp}
        accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
    ) })
  }, [navigation, C.text, lang, openHelp])
  const { getById, updateWith } = usePlans()
  const { gadgets } = useGadgets()
  const nameOf = useNodeName(gadgets)
  const T = (ja: string, en: string) => (lang === 'en' ? en : ja)

  const plan = getById(planId)
  // 1行 ＝ 物理ケーブル1本。ケーブルが要らない線を外すのも 2in1 を1本に束ねるのも
  // 必要本数の集計と同じ実装（wiringEngine）に任せる。ここで書き直さない
  const rows = useMemo(
    () => (plan ? cabledConnectionGroups(gadgets, plan) : []),
    [gadgets, plan],
  )
  const decided = rows.filter((group) => !!group[0].cableChoice).length
  const saveErrorVisibleRef = useRef(false)

  // 束ねた枝は1本のケーブルなので、申告は同じ行のすべての線に書く
  const setChoice = (group: MapConnection[], choice: CableChoice | undefined) => {
    if (!navigation.isFocused()) return
    const ids = new Set(group.map((c) => c.id))
    void updateWith(planId, (p) => {
      const connections = p.connectionMap?.connections ?? []
      const current = connections.find((connection) => ids.has(connection.id))?.cableChoice
      const next = choice?.kind === 'included' && current?.kind === 'included' ? undefined : choice
      return {
        ...p,
        connectionMap: {
          ...(p.connectionMap ?? { connections: [] }),
          connections: connections.map((c) => ids.has(c.id) ? { ...c, cableChoice: next } : c),
        },
        updatedAt: new Date().toISOString(),
      }
    }).catch(() => {
      if (!navigation.isFocused() || saveErrorVisibleRef.current) return
      saveErrorVisibleRef.current = true
      const close = () => { saveErrorVisibleRef.current = false }
      Alert.alert(lang === 'ja' ? '保存できませんでした' : 'Could not save',
        lang === 'ja' ? 'もう一度お試しください。' : 'Please try again.',
        [{ text: 'OK', onPress: close }], { onDismiss: close })
    })
  }

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: C.bg }]}>
      <CoachScope coach={coach}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text ref={coachTarget('connection-summary')} style={[styles.lead, { color: C.textSub }]}>
          {T(
            '線ごとに、本体付属のケーブルを使っているかを記録できます。記録は公開デスクにも表示されます。',
            'Mark each link that uses the cable included with the device. This appears on the public desk.',
          )}
        </Text>

        {rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.emptyText, { color: C.textMuted }]}>
              {T('ケーブルでつなぐ線がまだありません。', 'No cabled links yet.')}
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.count, { color: C.textMuted }]}>
              {lang === 'en' ? `${decided} of ${rows.length} set` : `${rows.length}本中 ${decided}本を指定済み`}
            </Text>
            {rows.map((group, index) => (
              <Fragment key={group[0].id}>
                {/* 必要なケーブルの一覧と同じく、充電のときだけ挿す線は後ろにまとめて見出しを付ける。
                    並びは cabledConnectionGroups が揃えている */}
                {group[0].chargingOnly === true && rows[index - 1]?.[0].chargingOnly !== true && (
                  <Text style={[styles.groupNote, { color: C.textMuted }]}>{t('wiringResult.chargingCables')}</Text>
                )}
                <ChoiceRow
                  connection={group[0]}
                  fromName={nameOf(group[0].fromGadgetId)}
                  toNames={group.map((c) => nameOf(c.toGadgetId))}
                  colors={C}
                  lang={lang}
                  isDark={isDark}
                  onPickIncluded={() => setChoice(group, { kind: 'included' })}
                  onClear={() => setChoice(group, undefined)}
                />
              </Fragment>
            ))}
          </>
        )}
      </ScrollView>
      </CoachScope>
      {coach.overlay}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: UI_METRICS.screenGutter, paddingBottom: 32, gap: 10 },
  lead: { fontSize: 13, lineHeight: 19 },
  count: { fontSize: 12 },
  groupNote: { fontSize: 12, marginTop: 6 },
  row: { borderWidth: 1, borderRadius: UI_METRICS.cardRadius, padding: 12, gap: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  endpoint: { flex: 1 },
  endpointText: { fontSize: 14, fontWeight: '600' },
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeLine: { width: 14, height: 3, borderRadius: 2 },
  typeName: { fontSize: 12 },
  typeCount: { fontSize: 12, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  action: { borderWidth: 1, borderRadius: UI_METRICS.chipRadius, paddingHorizontal: 12, paddingVertical: 7 },
  actionLabel: { fontSize: 12, fontWeight: '600' },
  picked: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto',
    borderWidth: 1, borderRadius: UI_METRICS.chipRadius, paddingHorizontal: 12, paddingVertical: 7,
    maxWidth: '70%',
  },
  pickedName: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  empty: { borderWidth: 1, borderRadius: UI_METRICS.cardRadius, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 13 },
})
