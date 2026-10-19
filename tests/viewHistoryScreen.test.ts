import assert from 'node:assert/strict'
import test from 'node:test'
import { elements, savedListNative, savedListsHarness } from './helpers/savedListsHarness'

function historyScreen(pro = false) {
  const entries = Array.from({ length: 1000 }, (_, i) => ({ deskId: `desk-${i}`, viewedAt: '2026-10-19T00:00:00Z' }))
  const calls: string[][] = []
  let failNext = false
  let delayed: Promise<void> | undefined
  const state = { pro, active: true }
  const modes: string[] = []
  const navigation = { isFocused: () => true }
  const user = { id: 'me' }
  const h = savedListsHarness('src/screens/ViewHistoryListScreen.tsx', 'ViewHistoryListScreen', {
    'react-native': savedListNative,
    '@react-native-async-storage/async-storage': { default: { getItem: async () => null, setItem: async (_key: string, mode: string) => { modes.push(mode) } } },
    '/AppContext': { useApp: () => ({ colors: {}, lang: 'ja' }) }, '/AuthContext': { useAuth: () => ({ user }) },
    '/useEntitlement': { useEntitlement: () => ({ limits: { maxViewHistory: state.pro ? 1000 : 100 }, isPro: state.pro, isLoading: false }) },
    '/viewHistory': { loadViewHistory: async () => entries, VIEW_HISTORY_STORAGE_LIMIT: 1000 },
    '/desks': { listPublicDesksByIds: async (ids: string[]) => {
      calls.push(ids)
      await delayed
      if (failNext) { failNext = false; throw new Error('offline') }
      return ids.map((id) => ({ id, user_id: 'other', title: id, updated_at: '2026-10-19', desk_photos: [] }))
    }, getClappedDeskEntries: async () => entries.map((entry) => ({ deskId: entry.deskId, clappedAt: entry.viewedAt })) },
    '/moderationService': { getBlockedUserIds: async () => new Set() },
    '/useScrollToTopOf': { useScrollToTopOf: () => {} },
    '/useMyPageScrollIndicator': { useMyPageScrollIndicatorInsets: () => ({}) },
    '/useScrollSyncRetry': { useScrollSyncRetry: () => ({ handlers: {}, isActive: true }) },
    '/useCoachMarks': { useCoachTarget: () => null, CoachAnchor: 'CoachAnchor' },
    '/useDeskClaps': { useDeskClaps: () => ({ likedIds: new Set(), likeCounts: new Map(), toggleClap: async () => {} }), clapButtonLabel: () => '' },
    '/DeskGridTile': { DeskGridTile: 'DeskGridTile' }, '/HistoryDeskRow': { HistoryDeskRow: 'HistoryDeskRow' },
    '/EmptyState': { EmptyState: 'EmptyState' }, '/ListSkeleton': { ListSkeleton: 'ListSkeleton' },
    '/RetryState': { RetryState: 'RetryState' }, '/SegmentedControl': { SegmentedControl: 'SegmentedControl' },
    '/HistoryScopeSwitch': { HistoryScopeSwitch: 'HistoryScopeSwitch' },
    '/rootNavigation': { openPaywall: () => {} }, '/plans': { PLAN_LIMITS: { free: { maxViewHistory: 100 } } },
    '/dateFormat': { formatListTimestamp: () => '今日' }, '/historyPeriod': { groupHistoryByDay: (items: any[]) => items.length ? [{ label: '今日', items }] : [] },
    '/useToday': { useToday: () => '2026-10-19' }, '/localizedDemoDesk': { localizedDemoDeskName: (_id: string, title: string) => title },
    '/promptLogin': { promptLogin: () => {} }, '/icons': { ICONS: {} }, '/ui': { UI_METRICS: { screenGutter: 16 } },
  }, () => [{ navigation, active: state.active }])
  const list = () => elements(h.current).find((node) => node.type === 'FlatList')!
  const loaded = () => list().props.data.filter((row: any) => row.kind === 'tiles').flatMap((row: any) => row.items).length
  return { ...h, state, calls, modes, list, loaded, fail: () => { failNext = true }, delay: (promise?: Promise<void>) => { delayed = promise } }
}

test('無料は100件、Proは1,000件を40件ずつ取得し、表示形式を切り替えても重複取得しない', async () => {
  for (const pro of [false, true]) {
    const h = historyScreen(pro)
    h.render(); await h.flush()
    assert.equal(h.loaded(), 40)
    for (let i = 0; i < (pro ? 24 : 2); i++) { await h.list().props.onEndReached(); await h.flush() }
    assert.equal(h.loaded(), pro ? 1000 : 100)
    assert.ok(h.calls.every((ids) => ids.length <= 40))
    const count = h.calls.length
    const control = elements(h.list().props.ListHeaderComponent).find((node) => node.props?.accessibilityLabel === '履歴の表示形式')!
    control.props.onChange('list'); await h.flush()
    assert.ok(h.list().props.data.filter((row: any) => row.kind === 'tiles').every((row: any) => row.items.length === 1))
    assert.equal(h.calls.length, count)
    assert.deepEqual(h.modes, ['list'])
    h.unmount()
  }
})

test('続きの通信失敗で既存の履歴を消さず、再試行後に40件を追加する', async () => {
  const h = historyScreen(true)
  h.render(); await h.flush()
  h.fail(); await h.list().props.onEndReached(); await h.flush()
  assert.equal(h.loaded(), 40)
  const retry = elements(h.list().props.ListFooterComponent).find((node) => node.type === 'TouchableOpacity')!
  retry.props.onPress(); await h.flush()
  assert.equal(h.loaded(), 80)
  h.unmount()
})

test('Proから無料に変わった後にProの遅い応答が来ても、100件の表示範囲を越えない', async () => {
  const h = historyScreen(true)
  h.render(); await h.flush()
  let release!: () => void
  h.delay(new Promise<void>((resolve) => { release = resolve }))
  h.list().props.onEndReached()
  await Promise.resolve()
  h.state.pro = false
  h.render()
  h.delay()
  release()
  await h.flush()
  for (let i = 0; i < 3; i++) { await h.list().props.onEndReached(); await h.flush() }
  assert.equal(h.loaded(), 100)
  h.unmount()
})
