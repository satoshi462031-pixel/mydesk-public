import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as layout from '../src/utils/coachMarkLayout'
import { buildColors } from '../src/constants/colors'
import { aiResponseStatsLabel } from '../src/utils/aiResponseStats'
import { synchronizedTabOffset } from '../src/utils/collapsibleTabScroll'
import { formatPublicAuthor } from '../src/utils/publicAuthor'
import { normalizePublicTag } from '../src/utils/publicTag'
import { tidyMultilineText, trimAndTruncate, truncateChars } from '../src/utils/truncateText'
import { DESK_DESCRIPTION_MAX_LENGTH, PURPOSE_NAME_MAX_LENGTH } from '../src/constants/textLimits'
import { fullSwipeThreshold, nextFullSwipeArmed } from '../src/utils/fullSwipe'
import { CONTROL_TEST_SEEDS, seededRandom } from './helpers/seededRandom'

function component(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration)
  const code = ts.transpileModule(`(${declaration.getText(source).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(code, { exports: {}, require: () => ({ jsx, jsxs: jsx }), ...bindings }) as (props?: any) => any
}

function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value?.props) return []
  return [value, ...nodes(value.props.children)]
}

test('デスク用途の編集で独自の名前とアイコンを選べ、閉じても下書きを保持する', () => {
  const state = hooks()
  let visible = true
  let selected = new Set(['work'])
  let otherLabel = ''
  let otherIcon = 'dots-horizontal-circle-outline'
  let feedback = 0
  let dismissed = 0
  const render = component('src/components/organisms/DeskPurposeEditSheet.tsx', 'DeskPurposeEditSheet', {
    ...state.bindings, styles: {}, useApp: () => ({ colors: {}, lang: 'ja', isDark: false, t: (key: string) => key }),
    useKeyboardReveal: () => () => {}, Keyboard: { dismiss: () => { dismissed++ } },
    BottomSheetModal: 'BottomSheetModal', ScrollView: 'ScrollView', View: 'View', Text: 'Text',
    TextField: 'TextField', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon',
    HeaderIconButton: 'HeaderIconButton', IconPickerModal: 'IconPickerModal', ICONS: {},
    PURPOSE_DEFS: ['gaming', 'work', 'creative', 'streaming', 'study', 'music', 'other'].map(key => ({ key, icon: key })),
    OTHER_PURPOSE_ICONS: ['dots-horizontal-circle-outline', 'hammer-wrench'], PURPOSE_NAME_MAX_LENGTH,
    purposeIconColor: () => '#123456', purposeTintColor: () => '#123456', contrastRatio: () => 7,
    isIconName: (icon: string) => icon !== 'invalid', truncateChars, hapticSelection: () => { feedback++ },
  })
  const paint = () => state.paint(() => render({
    visible, selected, otherLabel, otherIcon,
    onChange: (next: Set<string>) => { selected = next },
    onChangeOtherLabel: (value: string) => { otherLabel = value },
    onChangeOtherIcon: (value: string) => { otherIcon = value }, onClose: () => { visible = false },
  }))
  let tree = paint()
  assert.equal(nodes(tree).filter(node => node.type === 'TextField').length, 0)
  const checkbox = (label: string) => nodes(tree).find(node => node.props.accessibilityLabel === `purpose.${label}`)!
  checkbox('other').props.onPress()
  tree = paint()
  assert.equal(selected.has('other'), true)
  nodes(tree).find(node => node.type === 'TextField')!.props.onChangeText('🛠工作と模型を作る場所です')
  assert.equal(Array.from(otherLabel).length, PURPOSE_NAME_MAX_LENGTH)
  assert.equal(otherLabel.startsWith('🛠'), true)
  nodes(tree).find(node => node.props.accessibilityLabel === 'アイコン hammer-wrench')!.props.onPress()
  assert.equal(otherIcon, 'hammer-wrench')
  nodes(tree).find(node => node.props.accessibilityLabel === 'ほかのアイコンから選ぶ')!.props.onPress()
  tree = paint()
  const picker = nodes(tree).find(node => node.type === 'IconPickerModal')!
  assert.equal(picker.props.visible, true)
  picker.props.onSelect('flask-outline')
  picker.props.onSelect('invalid')
  picker.props.onClose()
  tree = paint()
  assert.equal(otherIcon, 'flask-outline')
  assert.ok(nodes(tree).some(node => node.props.accessibilityLabel === 'アイコン flask-outline'))
  // 用途は7つすべて選べる
  for (const key of ['gaming', 'music', 'creative', 'streaming', 'study']) {
    assert.equal(checkbox(key).props.disabled, false)
    checkbox(key).props.onPress()
    tree = paint()
  }
  assert.equal(selected.size, 7)
  // 外していって、最後の1つだけは外せない
  for (const key of ['work', 'gaming', 'music', 'creative', 'streaming', 'study']) {
    checkbox(key).props.onPress()
    tree = paint()
  }
  assert.deepEqual([...selected], ['other'])
  assert.equal(checkbox('other').props.disabled, true)
  assert.equal(nodes(tree).find(node => node.type === 'TextField')!.props.value, otherLabel)
  tree.props.onDismiss()
  assert.equal(visible, false)
  assert.ok(dismissed > 0)
  visible = true
  tree = paint()
  assert.equal(nodes(tree).find(node => node.type === 'TextField')!.props.value, otherLabel)
  assert.equal(nodes(tree).find(node => node.type === 'IconPickerModal')!.props.visible, false)
  assert.equal(feedback, 14)
})

test('デスク編集で独自用途の名前とアイコンを保存し、用途を外すと独自設定も消す', async () => {
  const source = ts.createSourceFile('desk.tsx', readFileSync('src/screens/WiringResultScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'saveProfileEdits') initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(initializer)
  const code = ts.transpileModule(`(${initializer.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [keepsOther, hadOther] of [[true, false], [true, true], [false, true]]) {
    let saved: any
    let editing = true
    const lock = { current: false }
    const latest = { name: '元のデスク', purposes: hadOther ? ['work', 'other'] : ['work'], otherPurposeLabel: hadOther ? '以前の用途' : undefined,
      otherPurposeIcon: hadOther ? 'coffee-outline' : undefined, otherPurposeColor: hadOther ? '#123456' : undefined, images: ['new-photo'] }
    const save = runInNewContext(code, {
      plan: { ...latest, images: ['old-photo'] }, planId: 'desk', nameText: 'デスク', descriptionText: ' メモ ',
      editPurposes: new Set(keepsOther ? ['work', 'other'] : ['work']),
      editOtherPurposeLabel: '  模型づくり  ', editOtherPurposeIcon: 'hammer-wrench',
      trimAndTruncate, tidyMultilineText, truncateChars, DESK_DESCRIPTION_MAX_LENGTH, PURPOSE_NAME_MAX_LENGTH,
      profileSaveInFlightRef: lock, profileEditModeRef: { current: true }, setIsProfileSaving: () => {},
      setProfileEditMode: (value: boolean) => { editing = value },
      updateWith: async (_id: string, update: (plan: unknown) => unknown) => { saved = update(latest) },
    })
    await save()
    assert.equal(saved.otherPurposeLabel, keepsOther ? '模型づくり' : undefined)
    assert.equal(saved.otherPurposeIcon, keepsOther ? 'hammer-wrench' : undefined)
    assert.equal(saved.otherPurposeColor, keepsOther && hadOther ? '#123456' : undefined)
    assert.deepEqual(saved.images, ['new-photo'])
    assert.equal(saved.description, 'メモ')
    assert.equal(editing, false)
    assert.equal(lock.current, false)
  }
})

for (const [file, name, options, value, target] of [
  ['src/components/atoms/SegmentedControl.tsx', 'SegmentedControl', [{ key: 'first', label: 'First' }, { key: 'next', label: 'Next' }], 'first', 'Next'],
  ['src/components/molecules/SearchScopeTabs.tsx', 'SearchScopeTabs', undefined, 'all', 'ユーザー'],
  ['src/screens/SettingsScreen.tsx', 'SettingsChoiceList', [{ value: 'first', label: 'First' }, { value: 'next', label: 'Next' }], 'first', 'Next'],
] as const) {
  test(`${name}: 選択が変わるタップだけ弱く振動し、同じ選択肢では振動しない`, () => {
    let feedback = 0
    const changes: string[] = []
    const render = component(file, name, {
      styles: {}, StyleSheet: { hairlineWidth: 1 }, useApp: () => ({ colors: {} }), useState: () => [0, () => {}],
      useRef: (current: unknown) => ({ current }),
      View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', ICONS: {},
      SegmentHighlight: 'SegmentHighlight', TabUnderline: 'TabUnderline', SCOPES: ['all', 'desks', 'people'], UNDERLINE_RATIO: 0.56,
      hapticSelection: () => { feedback++ },
    })
    const tree = render({ options, value, onChange: (next: string) => changes.push(next), colors: {}, lang: 'ja' })
    const buttons = nodes(tree).filter(node => node.type === 'TouchableOpacity')
    buttons[0].props.onPress()
    assert.equal(feedback, 0)
    buttons.find(node => nodes(node).some(child => child.props.children === target))!.props.onPress()
    assert.equal(feedback, 1)
    assert.equal(changes.length, 2)
  })
}

test('商品名コピーは書き込み成功後だけ振動する', async () => {
  for (const outcome of [true, false, 'error'] as const) {
    let feedback = 0
    let writes = 0
    let notices = 0
    let resolve!: (value: boolean) => void
    let reject!: (error: Error) => void
    const work = new Promise<boolean>((done, fail) => { resolve = done; reject = fail })
    const render = component('src/components/atoms/CopyProductNameButton.tsx', 'CopyProductNameButton', {
      ...hooks().bindings, styles: {}, Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', ICONS: {},
      Clipboard: { setStringAsync: () => { writes++; return work } },
      hapticLight: () => { feedback++ }, showMessage: () => { notices++ },
    })
    const tree = render({ name: ' Keyboard ', colors: {}, lang: 'ja' })
    tree.props.onPress()
    assert.equal(writes, 1)
    assert.equal(feedback, 0)
    if (outcome === 'error') reject(new Error('unavailable'))
    else resolve(outcome)
    await new Promise<void>(done => setImmediate(done))
    assert.equal(feedback, outcome === true ? 1 : 0)
    assert.equal(notices, outcome === true ? 0 : 1)
  }
})

function displayClock() {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { callback: () => void; at: number }>()
  return {
    bindings: {
      setTimeout: (callback: () => void, delay: number) => {
        const id = ++nextId
        timers.set(id, { callback, at: now + delay })
        return id
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
    advance: (ms: number) => {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback() }
      }
    },
    count: () => timers.size,
  }
}

test('同じ商品名を再コピーすると、最後の成功から2秒間コピー済みを表示する', async () => {
  const state = hooks()
  const clock = displayClock()
  const render = component('src/components/atoms/CopyProductNameButton.tsx', 'CopyProductNameButton', {
    ...state.bindings, ...clock.bindings, styles: {}, Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', ICONS: {},
    Clipboard: { setStringAsync: async () => true }, hapticLight: () => {}, showMessage: () => {},
  })
  const paint = () => {
    const tree = state.paint(() => render({ name: 'Keyboard', colors: {}, lang: 'ja' }))
    state.effects()
    return tree
  }
  const copy = async () => { paint().props.onPress(); await new Promise<void>(resolve => setImmediate(resolve)); paint() }
  const copied = () => nodes(paint()).some(node => node.props.children === 'コピー済み')
  await copy()
  clock.advance(1500)
  await copy()
  clock.advance(1999)
  assert.equal(copied(), true)
  clock.advance(1)
  assert.equal(copied(), false)
  await copy()
  state.unmount()
  assert.equal(clock.count(), 0)
})

test('AI回答のコピー済み表示は、繰り返すたびに1.2秒を確保して画面終了時に解除する', () => {
  const state = hooks()
  const clock = displayClock()
  const render = component('src/screens/AICoachChatScreen.tsx', 'Bubble', {
    ...state.bindings, ...clock.bindings, styles: {}, Text: 'Text', View: 'View', Pressable: 'Pressable', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', ICONS: {},
    Animated: { View: 'AnimatedView' }, MdText: 'MdText', FadeIn: 'FadeIn', CoachAnchor: 'CoachAnchor',
    ENTRANCE_FRESH_MS: 1500, PRESS_INTERACTION: { longPressDelay: 500 },
    useEntrance: () => ({}), useStreamReveal: (text: string) => ({ shown: text, revealing: false }),
    aiResponseStatsLabel, Clipboard: { setString: () => {} },
  })
  const props = { msg: { role: 'assistant', content: '回答', createdAt: '' }, colors: {}, lang: 'ja', showActions: true }
  const paint = () => {
    const tree = state.paint(() => render(props))
    state.effects()
    return tree
  }
  const copy = () => nodes(paint()).find(node => ['回答をコピー', 'コピーしました'].includes(node.props.accessibilityLabel))!.props.onPress()
  const copied = () => nodes(paint()).some(node => node.props.accessibilityLabel === 'コピーしました')
  copy()
  clock.advance(1000)
  copy()
  clock.advance(1199)
  assert.equal(copied(), true)
  clock.advance(1)
  assert.equal(copied(), false)
  copy()
  state.unmount()
  assert.equal(clock.count(), 0)
})

for (const [file, name, valueName, setterName, timerName] of [
  ['src/screens/WiringResultScreen.tsx', 'WiringResultScreen', 'savedToast', 'setSavedToast', 'savedToastTimer'],
  ['src/components/organisms/ProfileEditSheet.tsx', 'ProfileEditSheet', 'toast', 'setToast', 'toastTimer'],
]) {
  test(`${name}: 保存通知は同じ文言も最後の表示から2.4秒で消え、別の通知に古い期限を引き継がない`, () => {
    const state = hooks()
    const clock = displayClock()
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)!
    const statements = declaration.body!.statements.filter(statement => {
      if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(node =>
        [timerName, setterName].includes(node.name.getText(source)) || node.name.getText(source).startsWith(`[${valueName},`))
      return ts.isExpressionStatement(statement) && statement.getText(source).startsWith('useEffect(') && statement.getText(source).includes(timerName)
    })
    const code = ts.transpileModule(`(function Notice() { ${statements.map(node => node.getText(source)).join('\n')}; return { value: ${valueName}, show: ${setterName} } })`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
    const render = runInNewContext(code, { ...state.bindings, ...clock.bindings })
    const paint = () => { const result = state.paint(render); state.effects(); return result }
    paint().show('保存しました')
    clock.advance(2000)
    paint().show('保存しました')
    clock.advance(2399)
    assert.equal(paint().value, '保存しました')
    clock.advance(1)
    assert.equal(paint().value, null)
    paint().show('表紙を変更しました')
    clock.advance(2300)
    paint().show('並び順を保存できませんでした')
    clock.advance(2399)
    assert.equal(paint().value, '並び順を保存できませんでした')
    clock.advance(1)
    assert.equal(paint().value, null)
    paint().show('保存しました')
    state.unmount()
    assert.equal(clock.count(), 0)
  })
}

test('用途名の3秒表示は、透明な計測待ち時間を含めない', () => {
  const state = hooks()
  const clock = displayClock()
  const render = component('src/components/molecules/DeskPurposeIcons.tsx', 'DeskPurposeIcons', {
    ...base, ...state.bindings, ...clock.bindings, styles: { tip: 'tip' }, Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon',
    useSafeAreaInsets: () => ({ left: 0, right: 0 }), purposeIconColor: () => '#777777', purposeIcon: String, purposeLabel: String,
  })
  const paint = () => {
    const tree = state.paint(() => render({ plan: { purposes: ['work'] }, colors: {}, lang: 'ja', isDark: false }))
    state.effects()
    return tree
  }
  const tree = paint()
  nodes(tree).find(node => typeof node.props.ref === 'function')!.props.ref({ measureInWindow: (callback: (x: number) => void) => callback(10) })
  nodes(tree).find(node => node.type === 'TouchableOpacity')!.props.onPress({ stopPropagation() {} })
  const tip = () => nodes(paint()).find(node => node.props.style?.[0] === 'tip')
  assert.equal(tip()!.props.style[1].opacity, 0)
  assert.equal(clock.count(), 0)
  clock.advance(5000)
  tip()!.props.onLayout({ nativeEvent: { layout: { width: 60 } } })
  assert.equal(tip()!.props.style[1].opacity, 1)
  clock.advance(2999)
  assert.ok(tip())
  clock.advance(1)
  assert.equal(tip(), undefined)
  state.unmount()
})

test('初回案内の配線演出は描画サイズを待って開始し、サイズの再計測では時計を再開しない', () => {
  const preview = motionComponent('src/components/molecules/OnboardingWiringPreview.tsx', 'OnboardingWiringPreview', {
    DURATION_MS: 4200, SETTLE: (x: number) => x, STEADY: (x: number) => x, ZOOM_FROM: 1.05, NO_EXITS: new Set(),
    HistoryWiringCanvas: 'HistoryWiringCanvas', getOnboardingWiringLayout: () => ({}),
  })
  preview.update({})
  preview.tasks[0].run()
  let tree = preview.update({})
  assert.equal(preview.started.length, 0)
  assert.equal(nodes(tree).some(node => node.type === 'HistoryWiringCanvas'), false)
  tree.props.onLayout({ nativeEvent: { layout: { width: 390, height: 600 } } })
  tree = preview.update({})
  assert.equal(preview.started.length, 1)
  assert.equal(preview.timings[0].config!.duration, 4200)
  assert.ok(nodes(tree).some(node => node.type === 'HistoryWiringCanvas'))
  tree.props.onLayout({ nativeEvent: { layout: { width: 390, height: 620 } } })
  preview.update({})
  assert.equal(preview.started.length, 1)
})

test('再生速度は変更の確定時だけ振動し、上限・同じ速度・ドラッグの中断では振動しない', () => {
  const state = hooks()
  let feedback = 0
  const changes: number[] = []
  const source = ts.createSourceFile('speed.tsx', readFileSync('src/components/molecules/PlaybackSpeedControl.tsx', 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isVariableStatement(node) && node.getText(source).startsWith('const clampSpeed'))!
  const limits = { MIN_PLAYBACK_SPEED: 0.25, MAX_PLAYBACK_SPEED: 4, PLAYBACK_SPEED_STEP: 0.25 }
  const clampSpeed = runInNewContext(ts.transpileModule(`${declaration.getText(source)}; clampSpeed`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, limits)
  const render = component('src/components/molecules/PlaybackSpeedControl.tsx', 'PlaybackSpeedControl', {
    ...state.bindings, ...limits, clampSpeed, THUMB_SIZE: 20, PLAYBACK_SPEEDS: [0.5, 1, 2],
    styles: {}, useApp: () => ({ colors: {}, lang: 'ja' }),
    PanResponder: { create: (panHandlers: unknown) => ({ panHandlers }) },
    View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', ICONS: {},
    hapticSelection: () => { feedback++ },
  })
  let value = 1
  const paint = () => state.paint(() => render({ value, onChange: (next: number) => changes.push(next) }))
  let tree = paint()
  const same = nodes(tree).find(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityState.selected)!
  same.props.onPress()
  assert.equal(feedback, 0)
  const slider = () => nodes(tree).find(node => node.props.accessibilityRole === 'adjustable')!.props
  slider().onLayout({ nativeEvent: { layout: { width: 100 } } })
  tree = paint()
  slider().onPanResponderGrant({ nativeEvent: { locationX: 65 } })
  slider().onPanResponderMove({}, { dx: 3 })
  assert.equal(feedback, 0)
  slider().onPanResponderRelease({}, { dx: 3 })
  assert.equal(feedback, 1)
  slider().onPanResponderGrant({ nativeEvent: { locationX: 20 } })
  slider().onPanResponderTerminate()
  assert.equal(feedback, 1)
  value = limits.MAX_PLAYBACK_SPEED
  tree = paint()
  nodes(tree).find(node => node.props.accessibilityLabel === '再生速度を上げる')!.props.onPress()
  assert.equal(feedback, 1)
  assert.equal(changes.length, 2)
})

// 描画後の effect をまだ動かさず、layout effect による更新だけを反映した画面を検証する。
function hooks() {
  const slots: any[] = []
  const passive = new Map<number, () => void>()
  let cursor = 0
  let dirty = false
  let beforePaint: Array<() => void> = []
  const effect = (callback: () => any, deps: any[], immediate: boolean) => {
    const index = cursor++
    const previous = slots[index]
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    const next = { deps, cleanup: undefined as any }
    slots[index] = next
    const execute = () => { previous?.cleanup?.(); next.cleanup = callback() }
    if (immediate) beforePaint.push(execute)
    else passive.set(index, execute)
  }
  return {
    bindings: {
      useState: (initial: any) => {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
        return [slots[index], (update: any) => {
          const next = typeof update === 'function' ? update(slots[index]) : update
          if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true }
        }]
      },
      useRef: (current: unknown) => {
        const index = cursor++
        if (!(index in slots)) slots[index] = { current }
        return slots[index]
      },
      useCallback: (fn: unknown, deps: any[]) => {
        const index = cursor++
        const previous = slots[index]
        if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return previous.fn
        slots[index] = { deps, fn }
        return fn
      },
      useMemo: (create: () => unknown, deps: any[]) => {
        const index = cursor++
        const previous = slots[index]
        if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return previous.value
        const value = create()
        slots[index] = { deps, value }
        return value
      },
      useEffect: (fn: () => any, deps: any[]) => effect(fn, deps, false),
      useLayoutEffect: (fn: () => any, deps: any[]) => effect(fn, deps, true),
    },
    paint: (render: () => any) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        cursor = 0; dirty = false; beforePaint = []
        const tree = render()
        for (const fn of beforePaint) fn()
        if (!dirty) return tree
      }
      assert.fail('描画が収束しない')
    },
    effects: () => {
      const pending = [...passive.values()]
      passive.clear()
      for (const fn of pending) fn()
    },
    unmount: () => {
      passive.clear()
      for (const slot of slots) slot?.cleanup?.()
    },
  }
}

test('機材の星は通常のスワイプでボタンを開いたままにし、ボタンか大きなスワイプでだけ切り替える', () => {
  const state = hooks()
  const actionState = hooks()
  let favorite = false
  let toggles = 0
  let haptics = 0
  let thresholdHaptics = 0
  let closes = 0
  const openedDirections: string[] = []
  let starts = 0
  const row = { close: () => { closes++ } }
  const listeners = new Map<string, (value: { value: number }) => void>()
  const dragX = {
    addListener: (callback: (value: { value: number }) => void) => { listeners.set('drag', callback); return 'drag' },
    removeListener: (id: string) => listeners.delete(id),
  }
  const move = (value: number) => { for (const fn of listeners.values()) fn({ value }) }
  const common = {
    onSwipeableOpenStartDrag: () => { starts++ },
    onSwipeableOpen: (direction: string, opened: unknown) => {
      assert.equal(opened, row); openedDirections.push(direction)
    },
  }
  const render = component('src/components/molecules/FavoriteSwipeRow.tsx', 'FavoriteSwipeRow', {
    SwipeCommitRow: 'SwipeCommitRow', FavoriteSwipeAction: 'FavoriteSwipeAction',
  })
  const renderCore = component('src/components/molecules/SwipeCommitRow.tsx', 'SwipeCommitRow', {
    ...state.bindings, SwipeableRow: 'Swipeable', SwipeDistanceObserver: 'SwipeDistanceObserver',
    SWIPEABLE_ROW_PROPS: common,
    hapticSelection: () => { haptics++ },
    hapticLight: () => { thresholdHaptics++ },
  })
  const renderObserver = component('src/components/molecules/SwipeCommitRow.tsx', 'SwipeDistanceObserver', {
    ...actionState.bindings,
  })
  const renderAction = component('src/components/molecules/FavoriteSwipeRow.tsx', 'FavoriteSwipeAction', {
    ...actionState.bindings, useApp: () => ({ colors: {}, lang: 'ja' }), styles: {}, ICONS: {},
    TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', Text: 'Text',
  })
  const paint = (editable = true) => {
    const element = render({
      favorite, label: '機材', onRowRef: () => {}, children: 'card',
      onToggleFavorite: editable ? () => { favorite = !favorite; toggles++ } : undefined,
      renderRightActions: () => 'remove',
    })
    const tree = state.paint(() => renderCore(element.props))
    tree.props.ref(row)
    if (tree.props.renderLeftActions) {
      actionState.paint(() => renderObserver(tree.props.renderLeftActions(null, dragX).props))
      actionState.effects()
    }
    return tree.props
  }
  let props = paint()
  assert.equal(props.leftThreshold, 44)
  assert.equal(props.overshootLeft, true)
  assert.equal(props.overshootFriction, 1)
  const gesture = (distance: number, direction = 'left') => {
    props.onSwipeableOpenStartDrag(direction)
    move(distance)
    // Swipeable は開閉アニメーションの前に指の移動量をゼロに戻す。
    move(0)
    props.onSwipeableOpen(direction, row)
  }
  gesture(20)
  gesture(71)
  gesture(88)
  gesture(143)
  assert.equal(toggles, 0)
  assert.equal(closes, 0)
  assert.deepEqual(openedDirections, ['left', 'left', 'left', 'left'])
  assert.equal(thresholdHaptics, 0)
  props = paint()
  props.renderLeftActions(null, dragX).props.children.props.onPress()
  assert.equal(favorite, true)
  assert.equal(closes, 1)
  props.onSwipeableOpen('left', row)
  props.renderLeftActions(null, dragX).props.children.props.onPress()
  assert.equal(toggles, 1)
  props = paint()
  const action = renderAction(props.renderLeftActions(null, dragX).props.children.props)
  assert.equal(action.props.accessibilityLabel, '機材のお気に入りを外す')
  gesture(144)
  assert.equal(favorite, false)
  assert.equal(toggles, 2)
  assert.equal(haptics, 2)
  assert.equal(thresholdHaptics, 1)
  props = paint()
  gesture(-100, 'right')
  assert.equal(toggles, 2)
  assert.equal(openedDirections.at(-1), 'right')
  assert.equal(props.renderRightActions(), 'remove')
  props.onSwipeableOpenStartDrag('left')
  move(160)
  props.onSwipeableOpenStartDrag('left')
  gesture(30)
  assert.equal(toggles, 2)
  assert.equal(closes, 2)
  assert.ok(starts > 0)
  assert.equal(paint(false).renderLeftActions, undefined)
  actionState.unmount()
  assert.equal(listeners.size, 0)
})

test('共通スワイプ行は左右どちらの操作も、確定距離に届かなければ開いたままにする', () => {
  for (const direction of ['left', 'right'] as const) {
    const state = hooks()
    let opened = 0
    let closed = 0
    let committed = 0
    const row = { close: () => { closed++ } }
    const render = component('src/components/molecules/SwipeCommitRow.tsx', 'SwipeCommitRow', {
      ...state.bindings, SwipeableRow: 'Swipeable', SwipeDistanceObserver: 'SwipeDistanceObserver',
      SWIPEABLE_ROW_PROPS: {
        onSwipeableOpenStartDrag: () => {},
        onSwipeableOpen: (side: string, instance: unknown) => {
          assert.equal(side, direction)
          assert.equal(instance, row)
          opened++
        },
      },
      hapticLight: () => {}, hapticSelection: () => {},
    })
    const tree = state.paint(() => render({
      commitDirection: direction, onCommit: () => { committed++ }, renderCommitActions: () => null,
    }))
    tree.props.ref(row)
    tree.props.onSwipeableOpenStartDrag()
    const renderActions = direction === 'left' ? tree.props.renderLeftActions : tree.props.renderRightActions
    renderActions(null, {}).props.onDistance(direction === 'left' ? 30 : -30)
    tree.props.onSwipeableOpen(direction, row)
    assert.equal(opened, 1)
    assert.equal(closed, 0)
    assert.equal(committed, 0)
  }
})

test('デスクのピンは短いスワイプで操作を開き、大きく引くと1回だけ切り替えて振動する', () => {
  const state = hooks()
  let toggles = 0
  let duplicate = 0
  let opened = 0
  let closed = 0
  let readyHaptics = 0
  let commitHaptics = 0
  const render = component('src/components/molecules/SwipeCommitRow.tsx', 'SwipeCommitRow', {
    ...state.bindings, SwipeableRow: 'Swipeable', SwipeDistanceObserver: 'SwipeDistanceObserver',
    SWIPEABLE_ROW_PROPS: { onSwipeableOpenStartDrag: () => {}, onSwipeableOpen: () => { opened++ } },
    hapticLight: () => { readyHaptics++ }, hapticSelection: () => { commitHaptics++ },
  })
  const row = { close: () => { closed++ } }
  const paint = (enabled = true) => {
    const tree = state.paint(() => render({
      enabled, commitDistance: 144, leftThreshold: 40, closeOnShortSwipe: false,
      onCommit: () => { toggles++ },
      renderCommitActions: (_progress: unknown, commit: () => void) => ({ pin: commit, duplicate: () => { duplicate++ } }),
      renderRightActions: () => 'delete',
    }))
    tree.props.ref(row)
    return tree.props
  }
  let props = paint()
  const action = () => props.renderLeftActions(null, {}).props
  props.onSwipeableOpenStartDrag()
  action().onDistance(60)
  props.onSwipeableOpen('left', row)
  assert.equal(opened, 1)
  assert.equal(toggles, 0)
  assert.equal(closed, 0)
  assert.equal(readyHaptics, 0)
  action().children.duplicate()
  assert.equal(duplicate, 1)
  props.onSwipeableCloseStartDrag()
  action().onDistance(150)
  action().onDistance(180)
  assert.equal(readyHaptics, 0)
  assert.equal(toggles, 0)
  props.onSwipeableOpen('left', row)
  assert.equal(toggles, 0)
  props.onSwipeableOpenStartDrag()
  action().onDistance(160)
  assert.equal(readyHaptics, 1)
  props.onSwipeableOpen('left', row)
  props.onSwipeableOpen('left', row)
  action().children.pin()
  assert.equal(toggles, 1)
  assert.equal(closed, 1)
  assert.equal(commitHaptics, 1)
  props.onSwipeableOpenStartDrag()
  action().children.pin()
  assert.equal(toggles, 2)
  assert.equal(commitHaptics, 2)
  assert.equal(props.renderRightActions(), 'delete')
  props = paint(false)
  props.onSwipeableOpenStartDrag()
  action().onDistance(200)
  props.onSwipeableOpen('left', row)
  action().children.pin()
  assert.equal(toggles, 2)
  assert.equal(readyHaptics, 1)
  assert.equal(commitHaptics, 2)
})

test('保存解除は一覧型・枠型とも閉じる途中では確定せず、閉じた状態から引ききったときだけ実行する', () => {
  for (const card of [false, true]) {
    const state = hooks()
    let committed = 0
    let haptics = 0
    let fades = 0
    const render = component('src/components/molecules/FullSwipeRow.tsx', 'FullSwipeRow', {
      ...state.bindings, useApp: () => ({ reduceMotion: true }), styles: {},
      SwipeableRow: 'Swipeable', SwipeDistanceObserver: 'SwipeDistanceObserver',
      View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon',
      Animated: {
        View: 'AnimatedView', Value: class { setValue() {} },
        add: () => ({ interpolate: () => 0 }), multiply: () => 0,
        spring: () => ({ start: () => {} }),
        timing: () => ({ start: (done: () => void) => { fades++; done() } }),
      },
      SWIPEABLE_ROW_PROPS: { onSwipeableOpenStartDrag: () => {} },
      swipeRevealStyle: () => ({}), fullSwipeThreshold, nextFullSwipeArmed,
      hapticLight: () => { haptics++ }, FADE_OUT_MS: 180, DEFAULT_ACTION_WIDTH: 88,
    })
    const paint = () => state.paint(() => render({ card, actionLabel: '保存を解除', onCommit: () => { committed++ } }))
    let tree = paint()
    tree.props.onLayout({ nativeEvent: { layout: { width: 360 } } })
    tree = paint()
    const row = tree.props.children.props
    const drag = row.renderRightActions({}, {}).props.onDistance
    row.onSwipeableCloseStartDrag('right')
    drag(-300)
    row.onSwipeableWillOpen('right')
    assert.equal(committed, 0)
    assert.equal(haptics, 0)
    assert.equal(fades, 0)
    row.onSwipeableOpenStartDrag('right')
    drag(-300)
    row.onSwipeableWillOpen('right')
    row.onSwipeableWillOpen('right')
    assert.equal(committed, 1)
    assert.equal(haptics, 1)
    assert.equal(fades, 1)
  }
})

test('非同期のスワイプ操作は成功時だけ振動し、失敗・受け付けない操作では確定の振動を出さない', async () => {
  for (const outcome of ['success', 'failure', 'ignored']) {
    const state = hooks()
    let haptics = 0
    let finish!: () => void
    const work = new Promise<boolean>((resolve, reject) => {
      finish = () => outcome === 'failure' ? reject(new Error('offline')) : resolve(outcome === 'success')
    })
    const render = component('src/components/molecules/SwipeCommitRow.tsx', 'SwipeCommitRow', {
      ...state.bindings, SwipeableRow: 'Swipeable', SwipeDistanceObserver: 'SwipeDistanceObserver',
      SWIPEABLE_ROW_PROPS: { onSwipeableOpenStartDrag: () => {}, onSwipeableOpen: () => {} },
      hapticLight: () => {}, hapticSelection: () => { haptics++ },
    })
    const tree = state.paint(() => render({ onCommit: () => work, renderCommitActions: () => null }))
    const row = { close: () => {} }
    tree.props.ref(row)
    tree.props.onSwipeableOpenStartDrag()
    tree.props.renderLeftActions(null, {}).props.onDistance(80)
    tree.props.onSwipeableOpen('left', row)
    assert.equal(haptics, 0)
    finish()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(haptics, outcome === 'success' ? 1 : 0)
  }
})

test('持ち物の星は公開スナップショットに含めず、デスクの星と分けて扱う', () => {
  const share = component('src/services/publishService.ts', 'sharedGadgetsOf', {})
  const gadgets = [{ id: 'gear', name: '機材', favorite: true, imageUri: 'local', folderIds: ['folder'], url: 'private', ports: [] }]
  const shared = share(gadgets)
  assert.equal(shared[0].favorite, undefined)
  assert.equal(shared[0].name, '機材')
  assert.equal(gadgets[0].favorite, true)
})

test('プロフィール編集は読み込み後に入力でき、名前からIDへ進んで保存中の連打を防ぐ', async () => {
  for (const signedIn of [true, false]) {
    const state = hooks()
    let finishLoad!: (name: string) => void
    let finishSave!: (name: string) => void
    let writes = 0
    let closed = 0
    let feedback = 0
    let focused = 0
    const saved: string[] = []
    const render = component('src/components/organisms/ProfileEditSheet.tsx', 'ProfileEditSheet', {
      ...state.bindings, styles: {}, Platform: { OS: 'android' },
      Modal: 'Modal', SafeAreaView: 'SafeAreaView', KeyboardAvoidingView: 'KeyboardAvoidingView',
      ScrollView: 'ScrollView', View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
      ActivityIndicator: 'ActivityIndicator', AuthorAvatar: 'AuthorAvatar', Button: 'Button',
      TextField: 'TextField', PublicTagField: 'PublicTagField', Toast: 'Toast',
      PhotoViewerModal: 'PhotoViewerModal', AvatarCropModal: 'AvatarCropModal',
      useApp: () => ({ colors: {}, lang: 'ja' }),
      useAuth: () => ({
        user: signedIn ? { id: 'me' } : null,
        profile: signedIn ? { public_tag: 'myname', public_avatar_url: null } : null,
        refreshProfile: async () => {},
      }),
      getPublicNickname: () => new Promise<string>(resolve => { finishLoad = resolve }),
      setPublicNickname: () => { writes++; return new Promise<string>(resolve => { finishSave = resolve }) },
      syncPublicOwnerName: async () => {}, normalizePublicTag, trimAndTruncate,
      hapticSuccess: () => { feedback++ }, hapticError: () => {}, hapticWarning: () => {},
      assertPublicContentAllowed: () => {}, NAME_MAX_LENGTH: 20,
      PUBLIC_TAG_MIN_LENGTH: 3, PUBLIC_TAG_MAX_LENGTH: 20,
      STORAGE_TIMEOUT_MS: 100, QUICK_TIMEOUT_MS: 100,
      withTimeout: (work: Promise<unknown>) => work,
    })
    const paint = () => state.paint(() => render({
      visible: true, onClose: () => { closed++ }, onSaved: (name: string) => saved.push(name),
      onOpenPublicProfile: () => {},
    }))
    let tree = paint()
    state.effects()
    tree = paint()
    const nameField = () => nodes(tree).find(node => node.type === 'TextField')!.props
    const saveButton = () => nodes(tree).find(node => node.props.accessibilityLabel === 'プロフィールを保存')!.props
    assert.equal(nameField().editable, false)
    assert.equal(saveButton().disabled, true)
    finishLoad('もとの名前')
    await new Promise<void>(resolve => setImmediate(resolve))
    tree = paint()
    assert.equal(nameField().editable, true)
    nameField().onChangeText('新しい名前😀')
    tree = paint()
    assert.equal(nodes(tree).find(node => node.type === 'AuthorAvatar')!.props.name, '新しい名前😀')
    if (signedIn) {
      const tagField = nodes(tree).find(node => node.type === 'PublicTagField')!.props
      tagField.inputRef.current = { focus: () => { focused++ } }
      assert.equal(nameField().returnKeyType, 'next')
      nameField().onSubmitEditing()
      assert.equal(focused, 1)
      assert.equal(writes, 0)
      tagField.onChangeText('new_id')
      tree = paint()
      assert.equal(nodes(tree).find(node => node.type === 'AuthorAvatar')!.props.tag, 'new_id')
      nodes(tree).find(node => node.type === 'PublicTagField')!.props.onChangeText('myname')
      tree = paint()
      saveButton().onPress()
    } else {
      assert.equal(nameField().returnKeyType, 'done')
      assert.equal(nodes(tree).some(node => node.type === 'PublicTagField'), false)
      nameField().onSubmitEditing()
    }
    tree = paint()
    assert.equal(nameField().editable, false)
    assert.equal(nodes(tree).find(node => node.props.accessibilityLabel === '保存中')!.props.accessibilityState.busy, true)
    nameField().onSubmitEditing()
    assert.equal(writes, 1)
    assert.equal(feedback, 0)
    finishSave('新しい名前😀')
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(saved, ['新しい名前😀'])
    assert.equal(closed, 1)
    assert.equal(feedback, 1)
    state.unmount()
  }
})

test('4タブの本文を方向に沿って切り替え、初回・仮表示・連打でも下線とスクロールを保つ', () => {
  const state = hooks()
  const underlineState = hooks()
  const interactions: Array<() => void> = []
  const frames = new Map<number, () => void>()
  const animations: Array<{ value: Value; from: number; to: number; isInteraction?: boolean; stopped: boolean }> = []
  let reduceMotion = false
  let frameId = 0
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value }
    interpolate() { return this }
    addListener() { return 'listener' }
    removeListener() {}
  }
  const Animated = {
    Value, View: 'AnimatedView',
    timing: (value: Value, config: { toValue: number; isInteraction?: boolean }) => {
      const animation = { value, from: value.value, to: config.toValue, isInteraction: config.isInteraction, stopped: false }
      return { start: () => animations.push(animation), stop: () => { animation.stopped = true } }
    },
  }
  const coach = { target: (id: string) => id, open: () => {} }
  const navigation = { setOptions: () => {}, getParent: () => null }
  const tabs = ['published', 'history', 'favorites', 'gadgets'].map((key) => ({ key, ja: key, en: key }))
  const render = component('src/screens/MyPageScreen.tsx', 'MyPageScreen', {
    ...state.bindings, Animated, TABS: tabs, UNDERLINE_W: 42, __DEV__: false,
    Easing: { out: (value: unknown) => value, cubic: 'cubic' },
    styles: {}, StyleSheet: { hairlineWidth: 1 }, COACH_SCREEN: 'screen',
    View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', SafeAreaView: 'SafeAreaView',
    ScrollView: 'ScrollView', Modal: 'Modal', AppIcon: 'AppIcon', CoachAnchor: 'CoachAnchor', CoachScope: 'CoachScope',
    AuthorAvatar: 'AuthorAvatar', TabUnderline: 'TabUnderline', ListSkeleton: 'ListSkeleton',
    HistoryScopeSwitch: 'HistoryScopeSwitch', ReactionScopeSwitch: 'ReactionScopeSwitch',
    GadgetLibraryHeaderPlaceholder: 'GadgetLibraryHeaderPlaceholder',
    PublishedDeskListScreen: 'PublishedDeskListScreen', BookmarkListScreen: 'BookmarkListScreen',
    GadgetLibraryScreen: 'GadgetLibraryScreen', ViewHistoryListScreen: 'ViewHistoryListScreen',
    ProfileEditSheet: 'ProfileEditSheet', OnboardingIntro: 'OnboardingIntro',
    MyPageScrollIndicatorContext: { Provider: 'Provider' }, ICONS: {},
    useApp: () => ({ colors: {}, lang: 'ja', reduceMotion }), useAuth: () => ({}),
    usePlans: () => ({ plans: [] }), useGadgets: () => ({ gadgets: [] }),
    useEntitlement: () => ({ isPro: false }), useCoachMarks: () => coach,
    useFocusEffect: () => {}, useStickyBarBottom: () => 0, hapticSelection: () => {},
    isOwnedGadget: () => true, synchronizedTabOffset,
    hiddenPaneProps: (hidden: boolean) => hidden ? { pointerEvents: 'none' } : {},
    InteractionManager: { runAfterInteractions: (run: () => void) => { interactions.push(run) } },
    requestAnimationFrame: (run: () => void) => { frames.set(++frameId, run); return frameId },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  const renderUnderline = component('src/components/atoms/TabUnderline.tsx', 'TabUnderline', {
    ...underlineState.bindings, Animated, styles: {}, DURATION: 200,
    Easing: { out: (value: unknown) => value, cubic: 'cubic' },
    useApp: () => ({ colors: {}, reduceMotion: false }),
  })
  const visibleNodes = (value: any, path = 'root'): Array<{ node: any; path: string }> => {
    if (Array.isArray(value)) return value.flatMap((child, index) => visibleNodes(child, `${path}.${index}`))
    if (!value?.props || value.props.pointerEvents === 'none') return []
    return [{ node: value, path }, ...visibleNodes(value.props.children, `${path}.children`)]
  }
  let tree = state.paint(() => render({ navigation }))
  const header = nodes(tree).find((node) => node.type === 'PublishedDeskListScreen')!.props.headerSlot
  nodes(header).find((node) => node.props.onLayout)!.props.onLayout({ nativeEvent: { layout: { height: 180 } } })
  let underlinePath: string | undefined
  const paint = () => {
    tree = state.paint(() => render({ navigation }))
    state.effects()
    const bars = visibleNodes(tree).filter(({ node }) => node.type === 'TabUnderline')
    const scopes = nodes(tree).filter(node => node.type === 'CoachScope' && node.props.enabled !== undefined)
    assert.ok(scopes.filter(node => node.props.enabled).length <= 1)
    assert.ok(scopes.filter(node => node.props.enabled).every(node => node.props.children.props.pointerEvents !== 'none'))
    assert.equal(bars.length, 1)
    if (underlinePath) assert.equal(bars[0].path, underlinePath)
    underlinePath = bars[0].path
    underlineState.paint(() => renderUnderline({ ...bars[0].node.props, barWidth: 400 }))
    underlineState.effects()
    return bars[0].node.props.index
  }
  const press = (key: string) => {
    visibleNodes(tree).find(({ node }) => node.props.accessibilityRole === 'tab'
      && node.props.accessibilityLabel === key)!.node.props.onPress()
    return paint()
  }
  assert.equal(paint(), 0)
  assert.equal(animations.length, 1, '初期表示では下線だけを初期化し、本文を演出しない')
  assert.equal(press('history'), 1)
  assert.ok(nodes(tree).some((node) => node.type === 'ListSkeleton'))
  // 仮表示にも一覧の上の切り替えを出す（本物に替わった瞬間にタイルがずれない）
  assert.ok(nodes(tree).some((node) => node.type === 'HistoryScopeSwitch'))
  const animation = animations.at(-1)!
  const contentAnimation = animations.find((item) => item.value !== animation.value)!
  assert.equal(contentAnimation.from, 1)
  assert.equal(contentAnimation.to, 0)
  assert.equal(contentAnimation.isInteraction, false)
  assert.equal(animation.isInteraction, false, '下線の移動は遅延マウントをブロックしない')
  assert.equal(animation.from, 0)
  assert.equal(animation.to, 1)
  animation.value.setValue(0.5)
  interactions.shift()!()
  assert.equal(paint(), 1)
  assert.equal(animations.at(-1), animation)
  assert.equal(animation.value.value, 0.5)
  assert.equal(animations.filter((item) => item.value === contentAnimation.value).length, 1, '骨組みから一覧への置き換えで再演出しない')
  assert.ok(nodes(tree).some((node) => node.type === 'ViewHistoryListScreen'))
  assert.equal(nodes(tree).some((node) => node.type === 'ListSkeleton'), false)
  assert.equal(press('favorites'), 2)
  assert.equal(contentAnimation.stopped, true)
  assert.ok(nodes(tree).some((node) => node.type === 'ReactionScopeSwitch'))
  assert.equal(animations.at(-1)!.from, 0.5)
  assert.equal(press('gadgets'), 3)
  assert.ok(nodes(tree).some((node) => node.type === 'GadgetLibraryHeaderPlaceholder'))
  while (interactions.length) interactions.shift()!()
  paint()
  assert.equal(press('published'), 0)
  for (const run of frames.values()) run()
  frames.clear()
  assert.equal(paint(), 0)
  assert.equal(animations.filter((item) => item.value === animation.value).at(-1)!.value, animation.value)
  const back = animations.filter((item) => item.value === contentAnimation.value).at(-1)!
  assert.equal(back.from, -1)
  assert.equal(back.to, 0)
  const animationCount = animations.length
  press('published')
  assert.equal(animations.length, animationCount, '同じタブでは再演出しない')
  reduceMotion = true
  paint()
  assert.equal(back.stopped, true)
  assert.equal(contentAnimation.value.value, 0)
  press('gadgets')
  for (const run of frames.values()) run()
  frames.clear()
  paint()
  assert.equal(animations.filter((item) => item.value === contentAnimation.value).length, 4, '動きを抑える設定では本文を即時に切り替える')
  assert.equal(contentAnimation.value.value, 0)
  reduceMotion = false
  paint()
  assert.equal(contentAnimation.value.value, 0, '設定を戻すだけでは以前の切り替えを再演出しない')
  press('history')
  visibleNodes(tree).find(({ node }) => node.props.accessibilityRole === 'tab'
    && node.props.accessibilityLabel === 'gadgets')!.node.props.onPress()
  for (const run of frames.values()) run()
  frames.clear()
  assert.equal(paint(), 3)
  const shown = nodes(tree).find(node => node.type === 'CoachScope' && node.props.enabled === true)!
  assert.ok(nodes(shown).some(node => node.type === 'GadgetLibraryScreen'), '最後のタップより古いフレームで履歴を表示しない')
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    let expected = 3
    const trace: string[] = []
    const flushFrames = () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((run) => run())
    }
    for (let i = 0; i < 200; i++) {
      const presses = random(5) + 2
      for (let j = 0; j < presses; j++) {
        expected = random(tabs.length)
        trace.push(tabs[expected].key)
        visibleNodes(tree).find(({ node }) => node.props.accessibilityRole === 'tab'
          && node.props.accessibilityLabel === tabs[expected].key)!.node.props.onPress()
        if (random(3) === 0) { trace.push('frame'); flushFrames() }
        if (random(3) === 0) { trace.push('paint'); paint() }
      }
      for (let settle = 0; settle < 3; settle++) {
        while (interactions.length) interactions.shift()!()
        flushFrames()
        assert.equal(paint(), expected, `seed=${seed}, batch=${i}`)
      }
      const scope = nodes(tree).find(node => node.type === 'CoachScope' && node.props.enabled === true)!
      const screen = ['PublishedDeskListScreen', 'ViewHistoryListScreen', 'BookmarkListScreen', 'GadgetLibraryScreen'][expected]
      assert.ok(nodes(scope).some(node => node.type === screen), `seed=${seed}, batch=${i}, expected=${screen}, shown=${nodes(scope).map(node => node.type).join(',')}, trace=${trace.slice(-30).join('>')}`)
    }
  }
  state.unmount()
  underlineState.unmount()
})

test('他人のプロフィールの右上メニューで確認してブロック・解除でき、自分には表示しない', async () => {
  const state = hooks()
  let user: { id: string } | null = { id: 'viewer' }
  let options: any = {}
  let loginPrompts = 0
  const blockedIds = new Set<string>()
  const blockCalls: Array<[string, string]> = []
  const alerts: Array<{ title: string; buttons: any[] }> = []
  const desk = { id: 'desk', user_id: 'owner', owner_name: 'Alice', owner_tag: 'AliceDesk' }
  const navigation = { setOptions: (next: unknown) => { options = next } }
  const render = component('src/screens/PublicProfileScreen.tsx', 'PublicProfileScreen', {
    ...state.bindings, useToday: () => {}, normalizePublicTag, formatPublicAuthor,
    useApp: () => ({ colors: {}, lang: 'ja', t: String, fmtPrice: String }), useAuth: () => ({ user }),
    useUserFollow: () => ({}), PUSH_NOTIFICATIONS_ENABLED: false,
    listPublicDesksByTag: async () => [desk], getBlockedUserIds: async () => blockedIds,
    blockUser: async (id: string, name: string) => { blockCalls.push([id, name]); blockedIds.add(id) },
    unblockUser: async (id: string) => { blockedIds.delete(id) },
    promptLogin: () => { loginPrompts++ }, localizedErrorMessage: (_error: unknown, _lang: string, fallback: string) => fallback,
    Alert: { alert: (title: string, _message: string, buttons: any[]) => alerts.push({ title, buttons }) },
    View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList', RefreshControl: 'RefreshControl', AuthorAvatar: 'AuthorAvatar', FollowButton: 'FollowButton',
    HeaderIconButton: 'HeaderIconButton', IconCircleButton: 'IconCircleButton', PhotoViewerModal: 'PhotoViewerModal',
    EmptyState: 'EmptyState', RetryState: 'RetryState', styles: {}, ICONS: {},
  })
  const props = { navigation, route: { params: { tag: 'AliceDesk' } } }
  const paint = () => {
    const tree = state.paint(() => render(props))
    state.effects()
    return tree
  }
  const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
    return paint()
  }
  paint()
  assert.equal(options.headerRight, undefined)
  let tree = await settle()
  const button = options.headerRight()
  assert.equal(button.props.accessibilityLabel, 'このユーザーについて')
  button.props.onPress()
  assert.equal(alerts.at(-1)!.title, 'このユーザーについて')
  alerts.at(-1)!.buttons[0].onPress()
  assert.equal(alerts.at(-1)!.title, 'このユーザーをブロック')
  assert.equal(blockCalls.length, 0)
  await alerts.at(-1)!.buttons.find(button => button.style === 'destructive').onPress()
  tree = paint()
  assert.deepEqual(blockCalls, [['owner', 'Alice @AliceDesk']])
  const list = nodes(tree).find(node => node.type === 'FlatList')!
  assert.equal(list.props.data.length, 0)
  assert.equal(list.props.ListHeaderComponent, null)
  options.headerRight().props.onPress()
  assert.equal(alerts.at(-1)!.buttons[0].text, 'ブロックを解除')
  alerts.at(-1)!.buttons[0].onPress()
  tree = await settle()
  tree = await settle()
  assert.equal(nodes(tree).find(node => node.type === 'FlatList')!.props.data.length, 1)
  user = null
  paint()
  options.headerRight().props.onPress()
  alerts.at(-1)!.buttons[0].onPress()
  assert.equal(loginPrompts, 1)
  assert.equal(blockCalls.length, 1)
  user = { id: 'owner' }
  paint()
  assert.equal(options.headerRight, undefined)
  state.unmount()
})

test('AIの考え中は経過秒を表示し、更新の遅れを補正し、閉じるとタイマーを解放する', () => {
  let now = 10000
  let lang = 'ja'
  const timers = new Set<() => void>()
  const mount = () => {
    const state = hooks()
    const render = component('src/screens/AICoachChatScreen.tsx', 'ThinkingDot', {
      ...state.bindings, styles: {}, Text: 'Text', Date: { now: () => now },
      useApp: () => ({ reduceMotion: true, lang }), useEntrance: () => ({}),
      Animated: { View: 'AnimatedView', Value: class { interpolate() { return 1 } } },
      setInterval: (callback: () => void, delay: number) => {
        assert.equal(delay, 1000)
        timers.add(callback)
        return callback
      },
      clearInterval: (callback: () => void) => timers.delete(callback),
    })
    const text = () => {
      const tree = state.paint(() => render({ colors: {} }))
      state.effects()
      return nodes(tree).find((node) => node.type === 'Text')?.props.children
    }
    return { text, unmount: state.unmount }
  }
  const first = mount()
  assert.equal(first.text(), '考え中 · 0秒')
  now += 1000
  for (const tick of timers) tick()
  assert.equal(first.text(), '考え中 · 1秒')
  now += 11500
  for (const tick of timers) tick()
  assert.equal(first.text(), '考え中 · 12秒')
  assert.equal(timers.size, 1)
  lang = 'en'
  assert.equal(first.text(), 'Thinking · 12s')
  first.unmount()
  assert.equal(timers.size, 0)
  const retry = mount()
  assert.equal(retry.text(), 'Thinking · 0s')
  retry.unmount()
  assert.equal(timers.size, 0)
})

test('回答中と履歴のAI回答に計測情報を表示し、挨拶には表示しない', () => {
  const state = hooks()
  const render = component('src/screens/AICoachChatScreen.tsx', 'Bubble', {
    ...state.bindings, styles: {}, Text: 'Text', View: 'View', Pressable: 'Pressable',
    Animated: { View: 'AnimatedView' }, MdText: 'MdText', FadeIn: 'FadeIn', CoachAnchor: 'CoachAnchor',
    ENTRANCE_FRESH_MS: 1500, PRESS_INTERACTION: { longPressDelay: 500 },
    useEntrance: () => ({}), useStreamReveal: (text: string) => ({ shown: text, revealing: false }),
    aiResponseStatsLabel,
  })
  const msg = { id: 'answer', role: 'assistant', content: '回答', createdAt: '',
    responseStats: { firstResponseMs: 1200, totalMs: 3400 } }
  const text = (message: unknown, streaming = false) => nodes(state.paint(() => render({ msg: message, colors: {}, lang: 'ja', streaming })))
    .filter((node) => node.type === 'Text').map((node) => node.props.children)
  assert.deepEqual(text(msg), ['待機 1.2秒 · 全体 3.4秒 · 2文字'])
  assert.deepEqual(text({ ...msg, responseStats: { firstResponseMs: 1200 } }, true), ['回答中 · 待機 1.2秒 · 2文字'])
  assert.deepEqual(text({ ...msg, responseStats: undefined }), [])
})

const base = {
  ...layout, styles: {}, View: 'View', Svg: 'Svg', Defs: 'Defs', Mask: 'Mask', Rect: 'Rect',
  TutorialBubble: 'TutorialBubble', StyleSheet: { absoluteFill: {} },
  useApp: () => ({ lang: 'ja', colors: { accentIcon: '#159D67' }, isDark: false }),
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  useSafeAreaInsets: () => ({ top: 44, bottom: 34 }), measureCoachTarget: async () => null,
}

test('すべての用途名で吹き出しを画面内に収め、矢印を選択したアイコンに揃える', () => {
  const purposes = ['gaming', 'work', 'dev', 'creative', 'streaming', 'study', 'music', 'other']
  for (const width of [320, 390, 768]) {
    const state = hooks()
    const styles = { tipHost: 'tipHost', tip: 'tip', arrow: 'arrow' }
    const render = component('src/components/molecules/DeskPurposeIcons.tsx', 'DeskPurposeIcons', {
      ...base, ...state.bindings, styles, TouchableOpacity: 'TouchableOpacity', Text: 'Text', AppIcon: 'AppIcon',
      useWindowDimensions: () => ({ width }),
      useSafeAreaInsets: () => ({ left: 0, right: 0 }),
      purposeIconColor: () => '#777777', purposeIcon: String, purposeLabel: String,
      setTimeout: () => 1, clearTimeout: () => {},
    })
    const props = { plan: { purposes }, colors: { text: '#111111', card: '#ffffff' }, lang: 'ja', isDark: false }
    const paint = () => state.paint(() => render(props))
    paint(); state.effects()
    for (const [index, purpose] of purposes.entries()) {
      const x = [8, width / 2 - 24, width - 52][index % 3]
      const tree = paint()
      const wraps = nodes(tree).filter((node) => typeof node.props.ref === 'function')
      wraps[index].props.ref({ measureInWindow: (callback: (x: number) => void) => callback(x) })
      const button = nodes(tree).find((node) => node.type === 'TouchableOpacity' && node.props.accessibilityLabel === purpose)
      button.props.onPress({ stopPropagation() {} })
      const tip = nodes(paint()).find((node) => node.props.style?.[0] === 'tip')
      const tipWidth = 40 + index * 14
      tip.props.onLayout({ nativeEvent: { layout: { width: tipWidth } } })
      const expanded = nodes(paint())
      const hostStyle = expanded.find((node) => node.props.style?.[0] === 'tipHost').props.style[1]
      const tipStyle = expanded.find((node) => node.props.style?.[0] === 'tip').props.style[1]
      const arrowStyle = expanded.find((node) => node.props.style?.[0] === 'arrow').props.style[1]
      const screenLeft = x + hostStyle.left + tipStyle.transform[0].translateX
      assert.equal(tipStyle.opacity, 1)
      assert.ok(screenLeft >= 8)
      assert.ok(screenLeft + tipWidth <= width - 8)
      assert.equal(screenLeft + arrowStyle.left + 5, x + 24)
      if (index % 3 === 1) assert.equal(screenLeft + tipWidth / 2, x + 24)
    }
    state.unmount()
  }
})

function clapBurst() {
  const state = hooks()
  let animations = 0
  let reduceMotion = false
  const timers = new Set<() => void>()
  const render = component('src/components/atoms/ClapBurst.tsx', 'ClapBurst', {
    ...base, ...state.bindings, GROUPS: 7, BUBBLE_RATIO: 1.8, DURATION_MS: 800,
    useApp: () => ({ colors: {}, reduceMotion }),
    Easing: { linear: (value: number) => value },
    Animated: {
      View: 'AnimatedView',
      Value: class { setValue() {} interpolate() { return 1 } },
      multiply: () => 1,
      timing: () => ({}),
      parallel: () => {
        let completion: ((result: { finished: boolean }) => void) | undefined
        return {
          start: (callback: typeof completion) => { animations++; completion = callback },
          stop: () => completion?.({ finished: false }),
        }
      },
    },
    hapticLight: () => {},
    setTimeout: (callback: () => void) => { timers.add(callback); return callback },
    clearTimeout: (callback: () => void) => { timers.delete(callback) },
  })
  return {
    update: (clapped: boolean, burstKey: number) => {
      state.paint(() => render({ clapped, burstKey, size: 34, children: null }))
      state.effects()
    },
    animations: () => animations,
    timers: () => timers.size,
    reduceMotion: (value: boolean) => { reduceMotion = value },
  }
}

test('一覧で拍手済みのデスクを開き、状態を読み込んでも拍手演出・振動を始めない', () => {
  const burst = clapBurst()
  burst.update(false, 0)
  burst.update(true, 0)
  burst.update(false, 0)
  burst.update(true, 0)
  assert.equal(burst.animations(), 0)
  assert.equal(burst.timers(), 0)
})

test('拍手を追加した操作だけ1回演出し、同じ操作の状態再取得や再マウントでは繰り返さない', () => {
  const burst = clapBurst()
  burst.update(false, 0)
  burst.update(true, 1)
  assert.equal(burst.animations(), 1)
  assert.equal(burst.timers(), 0)
  burst.update(false, 1)
  assert.equal(burst.timers(), 0)
  burst.update(true, 1)
  assert.equal(burst.animations(), 1)
  burst.update(false, 1)
  burst.update(true, 2)
  assert.equal(burst.animations(), 2)

  const reopened = clapBurst()
  reopened.update(true, 2)
  assert.equal(reopened.animations(), 0)
})

test('動きを減らす設定を解除しても過去の拍手は演出せず、次の拍手だけ演出する', () => {
  const burst = clapBurst()
  burst.update(false, 0)
  burst.reduceMotion(true)
  burst.update(true, 1)
  burst.reduceMotion(false)
  burst.update(true, 1)
  assert.equal(burst.animations(), 0)
  assert.equal(burst.timers(), 0)
  burst.update(false, 1)
  burst.update(true, 2)
  assert.equal(burst.animations(), 1)
})

test('保存・お気に入りの弾みは付ける操作の番号が進んだときだけ動き、動きを減らす設定では動かない', () => {
  const state = hooks()
  let animations = 0
  let reduceMotion = false
  const render = component('src/components/atoms/TogglePop.tsx', 'TogglePop', {
    ...base, ...state.bindings, DURATION_MS: 360,
    useApp: () => ({ reduceMotion }),
    Easing: { linear: (value: number) => value },
    Animated: {
      View: 'AnimatedView',
      Value: class { setValue() {} interpolate() { return 1 } },
      timing: () => ({ start: () => { animations++ }, stop: () => {} }),
    },
  })
  const update = (popKey: number) => {
    state.paint(() => render({ popKey, children: null }))
    state.effects()
  }
  update(0)
  update(0)
  assert.equal(animations, 0)
  update(1)
  assert.equal(animations, 1)
  update(1)
  assert.equal(animations, 1)
  reduceMotion = true
  update(2)
  assert.equal(animations, 1)
  reduceMotion = false
  update(2)
  assert.equal(animations, 1)
  update(3)
  assert.equal(animations, 2)
})

function motionComponent(file: string, name: string, bindings: Record<string, unknown> = {}) {
  const state = hooks()
  let reduceMotion = false
  const started: Array<{ stop: () => void; finish: () => void; complete?: (result: { finished: boolean }) => void }> = []
  const tasks: Array<{ run: () => void; cancelled: boolean }> = []
  const timings: Array<{ value?: Value; config?: { toValue: number; duration?: number } }> = []
  class Value {
    constructor(public value: number) {}
    private listeners = new Map<string, (event: { value: number }) => void>()
    setValue(value: number) { this.value = value; this.listeners.forEach((fn) => fn({ value })) }
    interpolate() { return this }
    addListener(fn: (event: { value: number }) => void) { const id = String(this.listeners.size); this.listeners.set(id, fn); return id }
    removeListener(id: string) { this.listeners.delete(id) }
    removeAllListeners() { this.listeners.clear() }
  }
  const animation = (value?: Value, config?: { toValue: number }) => {
    if (value) timings.push({ value, config })
    let stopped = false
    const entry = {
      complete: undefined as ((result: { finished: boolean }) => void) | undefined,
      start: (callback?: (result: { finished: boolean }) => void) => { entry.complete = callback; started.push(entry) },
      stop: () => { stopped = true; entry.complete?.({ finished: false }) },
      finish: () => { if (!stopped) { if (value && config) value.setValue(config.toValue); entry.complete?.({ finished: true }) } },
    }
    return entry
  }
  const render = component(file, name, {
    ...base, ...state.bindings, Text: 'Text', TouchableOpacity: 'TouchableOpacity', Circle: 'Circle', Path: 'Path', AnimatedPath: 'AnimatedPath',
    React: { Fragment: 'Fragment' },
    useApp: () => ({ colors: {}, reduceMotion }),
    Easing: { cubic: (value: number) => value, quad: (value: number) => value, out: (fn: unknown) => fn },
    Animated: { Value, View: 'AnimatedView', timing: animation, spring: animation, stagger: () => animation(), parallel: () => animation() },
    InteractionManager: { runAfterInteractions: (run: () => void) => {
      const task = { run, cancelled: false }; tasks.push(task)
      return { cancel: () => { task.cancelled = true } }
    } },
    ...bindings,
  })
  return {
    update: (props: any) => {
      state.paint(() => render(props)); state.effects()
      const tree = state.paint(() => render(props)); state.effects()
      return tree
    },
    started, tasks, timings,
    reduceMotion: (value: boolean) => { reduceMotion = value },
  }
}

test('シートのドラッグは背景を薄くし、離した位置と速度から1回の退場で閉じる', () => {
  let dismissed = 0
  const sheet = motionComponent('src/components/molecules/BottomSheetModal.tsx', 'BottomSheetModal', {
    Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', SwipeDismissSheet: 'SwipeDismissSheet',
    Platform: { OS: 'ios' }, Dimensions: { get: () => ({ height: 844 }) }, ENTER_MS: 240, EXIT_MS: 180,
  })
  const props = { visible: true, onDismiss: () => { dismissed++ } }
  sheet.update(props).props.onShow()
  let tree = sheet.update(props)
  const drag = nodes(tree).find(node => node.type === 'SwipeDismissSheet')!.props
  drag.translateY.setValue(200)
  drag.onDrag(200, 400)
  const backdrop = nodes(tree).find(node => node.type === 'AnimatedView' && node.props.pointerEvents === 'none')!
  assert.equal(backdrop.props.style.at(-1).opacity.value, 0.5)
  drag.onRelease(3, 400)
  drag.onDismiss()
  assert.equal(dismissed, 1)
  tree = sheet.update({ ...props, visible: false })
  assert.equal(tree.props.visible, true)
  const exit = sheet.timings.at(-1)!
  assert.equal(exit.value!.value, 200, '退場前に位置をリセットしない')
  assert.equal(exit.config!.toValue, 448)
  assert.ok(Math.abs(exit.config!.duration! - 248 / 3) < 0.001)
  assert.equal(sheet.started.length, 2, '登場と退場をそれぞれ1回だけ実行する')
  sheet.started.at(-1)!.finish()
  assert.equal(sheet.update({ ...props, visible: false }).props.visible, false)
})

test('次の確認は下端シートの退場後に通知し、iOSではネイティブModalの終了まで待つ', () => {
  for (const os of ['ios', 'android', 'web']) {
    let dismissed = 0
    const sheet = motionComponent('src/components/molecules/BottomSheetModal.tsx', 'BottomSheetModal', {
      Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', SwipeDismissSheet: 'SwipeDismissSheet',
      Platform: { OS: os }, Dimensions: { get: () => ({ height: 844 }) }, ENTER_MS: 240, EXIT_MS: 180,
    })
    const props = { visible: false, onDismiss: () => {}, onDismissed: () => { dismissed++ } }
    sheet.update(props)
    assert.equal(dismissed, 0, '初期状態では次へ進まない')
    sheet.update({ ...props, visible: true }).props.onShow()
    sheet.update({ ...props, visible: true })
    sheet.started.at(-1)!.finish()
    const closing = sheet.update(props)
    assert.equal(closing.props.visible, true)
    assert.equal(dismissed, 0, '自前の退場アニメーション中は次を開かない')
    sheet.started.at(-1)!.finish()
    const closed = sheet.update(props)
    assert.equal(closed.props.visible, false)
    if (os === 'ios') {
      assert.equal(dismissed, 0, 'visible=falseだけではネイティブModalは閉じ終えていない')
      closed.props.onDismiss()
    }
    assert.equal(dismissed, 1)
    sheet.update(props)
    assert.equal(dismissed, 1, '再描画では通知を繰り返さない')
  }
})

test('実物に合わせる画面の退場完了を通知し、iOSではネイティブの終了を待つ', () => {
  for (const os of ['ios', 'android', 'web']) {
    const state = hooks()
    let dismissed = 0
    const render = component('src/components/organisms/TemplateSpecSheet.tsx', 'TemplateSpecSheet', {
      ...base, ...state.bindings, Modal: 'Modal', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView',
      Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', Button: 'Button', Platform: { OS: os }, ICONS: {},
      useApp: () => ({ colors: {}, lang: 'ja', t: (key: string) => key, reduceMotion: false }),
    })
    const props = { visible: false, items: [], onClose: () => {}, onConfirm: () => {}, onDismissed: () => { dismissed++ } }
    const paint = (visible: boolean) => {
      const tree = state.paint(() => render({ ...props, visible }))
      state.effects()
      return tree
    }
    paint(false)
    assert.equal(dismissed, 0)
    paint(true)
    const closed = paint(false)
    if (os === 'ios') {
      assert.equal(dismissed, 0)
      closed.props.onDismiss()
    }
    assert.equal(dismissed, 1)
    paint(false)
    assert.equal(dismissed, 1)
  }
})

test('退場途中にシートを開き直しても、開始位置や背景を巻き戻さない', () => {
  const sheet = motionComponent('src/components/molecules/BottomSheetModal.tsx', 'BottomSheetModal', {
    Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', SwipeDismissSheet: 'SwipeDismissSheet',
    Platform: { OS: 'ios' }, Dimensions: { get: () => ({ height: 844 }) }, ENTER_MS: 240, EXIT_MS: 180,
  })
  const props = { visible: true, onDismiss: () => {} }
  sheet.update(props).props.onShow()
  let tree = sheet.update(props)
  const drag = nodes(tree).find(node => node.type === 'SwipeDismissSheet')!.props
  drag.translateY.setValue(160)
  drag.onDrag(160, 400)
  sheet.update({ ...props, visible: false })
  tree = sheet.update(props)
  assert.equal(nodes(tree).find(node => node.type === 'SwipeDismissSheet')!.props.translateY.value, 160)
  assert.equal(nodes(tree).find(node => node.type === 'AnimatedView' && node.props.pointerEvents === 'none')!.props.style.at(-1).opacity.value, 0.6)
})

test('ドラッグの確定は退場アニメーションを待たず親へ通知し、取り消しは現在位置から戻す', () => {
  const state = hooks()
  let dismissed = 0
  let springs = 0
  const releases: number[] = []
  const translateY = { value: 0, setValue(value: number) { this.value = value }, stopAnimation(callback: (value: number) => void) { callback(this.value) } }
  const render = component('src/components/molecules/SwipeDismissSheet.tsx', 'SwipeDismissSheet', {
    ...base, ...state.bindings, Animated: { View: 'AnimatedView', spring: () => ({ start: () => { springs++ } }) },
    PanResponder: { create: (panHandlers: unknown) => ({ panHandlers }) },
    MIN_DISMISS_DISTANCE: 84, DISMISS_VELOCITY: 0.9,
  })
  const props = { visible: true, translateY, onDismiss: () => { dismissed++ }, onDrag: () => {}, onRelease: (speed: number) => releases.push(speed) }
  const tree = state.paint(() => render(props)); state.effects()
  tree.props.onLayout({ nativeEvent: { layout: { height: 400 } } })
  const pan = tree.props.children[0].props
  pan.onPanResponderGrant()
  pan.onPanResponderMove(null, { dy: 100 })
  assert.equal(translateY.value, 100)
  pan.onPanResponderRelease(null, { dy: 100, vy: 1.2 })
  assert.equal(dismissed, 1)
  assert.deepEqual(releases, [1.2])
  assert.equal(springs, 0)
  translateY.value = 0
  pan.onPanResponderGrant()
  pan.onPanResponderMove(null, { dy: 20 })
  pan.onPanResponderRelease(null, { dy: 20, vy: 0.1 })
  assert.equal(dismissed, 1)
  assert.equal(springs, 1)
  state.paint(() => render({ ...props, visible: false })); state.effects()
  const closingPosition = translateY.value
  pan.onPanResponderMove(null, { dy: 300 })
  pan.onPanResponderTerminate()
  assert.equal(translateY.value, closingPosition)
  assert.equal(springs, 1, '閉じ始めた後の中断通知で退場を取り消さない')
  state.paint(() => render({ ...props, reduceMotion: true })); state.effects()
  pan.onPanResponderGrant()
  pan.onPanResponderMove(null, { dy: 20 })
  pan.onPanResponderRelease(null, { dy: 20, vy: 0 })
  assert.equal(translateY.value, 0)
  assert.equal(springs, 1)
})

test('並べ替えは周囲だけをスプリングで動かし、確定で座標が変わっても位置を保って着地する', () => {
  const state = hooks()
  const frames = new Map<number, (timestamp: number) => void>()
  let nextFrame = 0
  let ids = ['a', 'b', 'c']
  const springs: number[] = []
  const scrolls: number[] = []
  let reduceMotion = false
  const render = component('src/components/organisms/ReorderableGadgetList.tsx', 'ReorderableGadgetList', {
    ...base, ...state.bindings, ReorderRow: 'ReorderRow', useApp: () => ({ colors: {}, reduceMotion }),
    makeMutable: (value: unknown) => ({ value }), runOnUI: (fn: (...args: any[]) => void) => fn,
    withSpring: (target: number) => { springs.push(target); return target }, SETTLE: {}, cancelAnimation: () => {},
    requestAnimationFrame: (callback: (timestamp: number) => void) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    hapticLight: () => {}, hapticMedium: () => {}, hapticSelection: () => {},
    moveGadgetId: (items: string[], from: number, to: number) => { const next = [...items]; next.splice(to, 0, next.splice(from, 1)[0]); return next },
  })
  const props = () => ({ gadgets: ids.map(id => ({ id })), enabled: true, onReorder: (next: string[]) => { ids = next },
    onDraggingChange: () => {}, renderRow: () => null, measureViewport: (callback: (top: number, bottom: number) => void) => callback(0, 500),
    scrollBy: (delta: number) => { scrolls.push(delta); return delta } })
  const paint = () => { const tree = state.paint(() => render(props())); state.effects(); return tree }
  let tree = paint()
  const rows = () => nodes(tree).filter(node => node.type === 'ReorderRow')
  rows().forEach((row, index) => row.props.onLayout({ nativeEvent: { layout: { y: index * 100, height: 100 } } }))
  const dragged = rows()[0].props
  dragged.onStart('a', 0, 50)
  dragged.translation.value = 120
  dragged.onMove('a', 120, 170)
  const count = springs.length
  dragged.onMove('a', 125, 175)
  assert.equal(springs.length, count, '同じ移動先へ毎フレーム spring を張り直さない')
  assert.equal(rows()[1].props.translation.value, -100)
  dragged.onFinish('a', true)
  assert.deepEqual(ids, ['b', 'a', 'c'])
  assert.equal(dragged.translation.value, 120, '並び順確定前に原点へ戻さない')
  assert.equal(frames.size, 0)
  tree = paint()
  rows().forEach((row, index) => row.props.onLayout({ nativeEvent: { layout: { y: index * 100, height: 100 } } }))
  assert.ok(rows().every(row => row.props.translation.value === 0))
  const next = rows()[0].props
  next.onStart('b', 0, 470)
  const tick = (timestamp: number) => {
    const pending = [...frames.values()]; frames.clear()
    pending.forEach(callback => callback(timestamp))
  }
  tick(16); tick(32)
  const gentle = scrolls.at(-1)!
  next.onMove('b', 0, 500)
  tick(48)
  assert.ok(gentle > 0 && gentle < scrolls.at(-1)!, '端に近いほど自動スクロールが速くなる')
  tick(1048)
  assert.ok(scrolls.at(-1)! <= 16, 'JS復帰時に遅れた距離を一度に進めない')
  next.onFinish('b', false)
  assert.equal(frames.size, 0)
  reduceMotion = true
  tree = paint()
  const reduced = rows()[0].props
  reduced.onStart('b', 0, 50)
  const before = springs.length
  reduced.onMove('b', 120, 170)
  reduced.onFinish('b', false)
  assert.equal(springs.length, before, '動きを減らす設定では自動の移動演出を使わない')
})

test('歴史プレイヤーは表示と計測を待って再生し、白黒切替では再生をやり直さない', async () => {
  const today = new Date(2026, 9, 7)
  let isDark = false
  let colors = buildColors(isDark)
  const event = { date: '2026-10-07', isTodayPage: true, inGadgets: [], outGadgets: [], gadgets: [], renderGadgets: [], connections: [], renderConnections: [], modeChanges: [] }
  const prepared = { events: [event], layouts: [{ nodes: [], edges: [] }], truncated: false }
  const coach = { active: false, open: () => {}, close: () => {}, target: () => undefined, overlay: null }
  const playback = { index: 0, event, playing: true, speed: 1, finished: false, count: 1, nonce: 7, offset: 0 }
  let playbackEnabled = false
  const player = motionComponent('src/components/organisms/DeskHistoryAnimationModal.tsx', 'DeskHistoryAnimationModal', {
    useApp: () => ({ colors, isDark, fmtPrice: String, reduceMotion: false, historyGrain: 'month', historySpeed: 1, historyShowInOut: true, withOpacity: (color: string) => color }),
    useCoachMarks: () => coach, useHistoryPlayback: (_events: unknown, enabled: boolean) => {
      playbackEnabled = enabled
      return { ...playback, playing: enabled }
    },
    useToday: () => today,
    cachedDeskHistory: () => prepared, holdBackgroundLayout: () => () => {},
    AsyncStorage: { getItem: async () => '1' }, statusTextColor: () => colors.text,
    isQuietEvent: () => false, historyChangePageCount: () => 1, pagesOf: () => [[]],
    EVENT_MS: 5333, EVENT_ANIM_MS: 5180, PAGE_MS: 1440, PAGE_SIZE: 4, TOP_BAR_H: 48,
    scrubClock: () => 0, eventStayMs: () => 5333,
    HUD_SIDE_MARGIN: 16, HUD_TOP_MARGIN: 10, DATE_SLOT_H: 26, GRAINS: [], ONBOARDING_KEY: 'seen', MAX_SEGMENTED_EVENTS: 24,
    Easing: { linear: (value: number) => value },
    sumGadgetPrices: () => 0, historyDurationLabel: () => '1日', formatEventDateParts: () => ({ year: '2026', dayMonth: '10/7' }),
    buildHistoryReplacementPairs: () => new Map(), addedCableTypesOf: () => new Set(),
    localDateKey: () => '2026-10-07', notifyTutorialInteraction: () => {},
    StatusBar: 'StatusBar', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
    AppIcon: 'AppIcon', IconCircleButton: 'IconCircleButton', ProgressBar: 'ProgressBar',
    HistoryWiringCanvas: 'HistoryWiringCanvas', BottomSheetModal: 'BottomSheetModal',
    SlotText: 'SlotText', PageFade: 'PageFade', RiseIn: 'RiseIn',
    SegmentedControl: 'SegmentedControl', PlaybackSpeedControl: 'PlaybackSpeedControl', ContrastToggle: 'ContrastToggle',
    SLOT_DELAY_RATIO: 0.28, SLOT_DURATION_RATIO: 0.22, ICONS: {},
    LinearTransition: { duration: () => ({ easing: () => ({}) }) },
    LayoutEasing: { out: (value: unknown) => value, cubic: 'cubic' },
    Reanimated: { View: 'ReanimatedView' },
  })
  const props = { visible: true, plan: { name: 'デスク' }, gadgets: [], lang: 'ja', onClose: () => {} }
  let tree = player.update(props)
  await Promise.resolve()
  tree = player.update(props)
  assert.equal(playbackEnabled, false)
  tree.props.onShow()
  tree = player.update(props)
  assert.equal(playbackEnabled, false)
  nodes(tree).find(node => node.props.onLayout)?.props.onLayout({ nativeEvent: { layout: { width: 390, height: 500 } } })
  tree = player.update(props)
  assert.equal(playbackEnabled, true)
  const animationCount = player.started.length
  const canvasKey = nodes(tree).find(node => node.type === 'HistoryWiringCanvas')?.props.animKey
  assert.equal(canvasKey, '0-7')
  for (const dark of [true, false, true]) {
    isDark = dark; colors = buildColors(dark)
    tree = player.update(props)
    const rendered = nodes(tree)
    assert.equal(tree.props.presentationStyle, 'overFullScreen')
    assert.equal(rendered.find(node => node.type === 'StatusBar')?.props.barStyle, dark ? 'light-content' : 'dark-content')
    assert.equal(rendered.find(node => node.type === 'StatusBar')?.props.backgroundColor, colors.bgList)
    assert.equal(tree.props.children[1].props.style[1].backgroundColor, colors.bgList)
    const canvas = rendered.find(node => node.type === 'HistoryWiringCanvas')
    assert.equal(canvas?.props.colors, colors)
    assert.equal(canvas?.props.animKey, canvasKey)
    const playButton = rendered.find(node => node.type === 'IconCircleButton')
    assert.equal(playButton?.props.color, colors.onAccent)
    const progressBar = rendered.find(node => node.type === 'ProgressBar')
    assert.equal(progressBar?.props.trackColor, colors.border)
    assert.equal(progressBar?.props.bubbleBg, colors.card)
    assert.equal(progressBar?.props.bubbleText, colors.text)
    assert.equal(player.started.length, animationCount)
  }
  player.update({ ...props, visible: false })
  tree = player.update(props)
  await Promise.resolve()
  tree = player.update(props)
  assert.equal(playbackEnabled, false)
  tree.props.onShow()
  player.update(props)
  assert.equal(playbackEnabled, true)
})

test('履歴の金額は動きの設定や遅延を切り替えてもゼロから数え直さない', () => {
  const counter = motionComponent('src/components/organisms/DeskHistoryAnimationModal.tsx', 'CountUpValue')
  const props = { value: 240, format: String, delayMs: 260, reduceMotion: false }
  counter.update(props)
  counter.started[0].finish()
  counter.update({ ...props, reduceMotion: true, delayMs: 0 })
  const tree = counter.update(props)
  assert.equal(counter.started.length, 1)
  assert.equal(tree.props.children, '240')
  counter.update({ ...props, value: 480 })
  assert.equal(counter.started.length, 2)
})

test('履歴のページは動きの設定を戻しただけではフェードし直さない', () => {
  const page = motionComponent('src/components/organisms/DeskHistoryAnimationModal.tsx', 'PageFade')
  const props = { swapKey: 'page-1', reduceMotion: false, children: null }
  page.update(props)
  page.started[0].finish()
  page.update({ ...props, reduceMotion: true })
  page.update(props)
  assert.equal(page.started.length, 1)
  page.update({ ...props, swapKey: 'page-2' })
  assert.equal(page.started.length, 2)
})

test('歴史の金額・記録・ページの初回演出はプレイヤーの表示準備まで進めない', () => {
  for (const name of ['CountUpValue', 'RiseIn', 'PageFade']) {
    const motion = motionComponent('src/components/organisms/DeskHistoryAnimationModal.tsx', name)
    const props = { value: 240, format: String, swapKey: 'first', delayMs: 120, reduceMotion: false, children: null, ready: false }
    motion.update(props)
    assert.equal(motion.started.length, 0, name)
    motion.update({ ...props, ready: true })
    assert.equal(motion.started.length, 1, name)
    motion.started[0].finish()
    motion.update({ ...props, ready: true })
    assert.equal(motion.started.length, 1, name)
  }
})

test('統計グラフは幅の再計測や動きの設定で描き直さず、表示を切り替えたときだけ演出する', () => {
  const chart = motionComponent('src/components/organisms/GadgetStatsPanel.tsx', 'TrendChart', {
    CHART_H: 150, CHART_PAD: { top: 14, right: 12, bottom: 22, left: 46 },
    niceTicks: () => ({ ticks: [0, 100], top: 100 }), polylineLen: () => 30, fmtAxis: String,
  })
  const props = { points: [{ key: 'now', total: 100, month: 10 }], width: 0, colors: {}, fmtPrice: String, displayAmount: (n: number) => n, lang: 'ja', triggerKey: 0 }
  chart.update(props)
  assert.equal(chart.started.length, 0)
  chart.update({ ...props, width: 350 })
  assert.equal(chart.started.length, 1)
  chart.reduceMotion(true)
  chart.update({ ...props, width: 350 })
  chart.reduceMotion(false)
  chart.update({ ...props, width: 350 })
  chart.update({ ...props, width: 351 })
  assert.equal(chart.started.length, 1)
  chart.update({ ...props, width: 351, triggerKey: 1 })
  assert.equal(chart.started.length, 2)
})

test('統計グラフは初回アニメーション中に幅を再計測しても最後まで描画を続ける', () => {
  const chart = motionComponent('src/components/organisms/GadgetStatsPanel.tsx', 'TrendChart', {
    CHART_PAD: { left: 10, right: 10, top: 10, bottom: 10 }, CHART_H: 160,
    niceTicks: () => ({ ticks: [0, 100], top: 100 }), polylineLen: () => 100, fmtAxis: String,
  })
  const props = { points: [{ total: 10 }, { total: 100 }], width: 350, colors: {}, fmtPrice: String, displayAmount: (value: number) => value, lang: 'ja', triggerKey: 0 }
  let tree = chart.update(props)
  const progress = nodes(tree).find(node => node.type === 'AnimatedPath')!.props.strokeDashoffset
  progress.setValue(0.25)
  tree = chart.update({ ...props, width: 351 })
  assert.equal(nodes(tree).find(node => node.type === 'AnimatedPath')!.props.strokeDashoffset.value, 0.25)
  assert.equal(chart.started.length, 1)
  chart.started[0].finish()
  assert.equal(progress.value, 1)
})

test('タブの下線と選択背景は初回計測まで移動を待ち、計測し直しても途中の位置を保つ', () => {
  for (const name of ['TabUnderline', 'SegmentHighlight']) {
    const control = motionComponent(`src/components/atoms/${name}.tsx`, name, {
      DURATION: 200, UI_METRICS: { chipRadius: 12 },
    })
    const props = { count: 3, index: 0, barWidth: 0, color: '#159D67', inset: 4 }
    control.update(props)
    control.update({ ...props, index: 1 })
    assert.equal(control.started.length, 0, name)
    let tree = control.update({ ...props, index: 1, barWidth: 300 })
    assert.equal(control.started.length, 1, name)
    const progress = tree.props.style[1].transform[0].translateX
    progress.setValue(0.5)
    tree = control.update({ ...props, index: 1, barWidth: 301 })
    assert.equal(tree.props.style[1].transform[0].translateX.value, 0.5, name)
    control.started[0].finish()
    assert.equal(progress.value, 1, name)
  }
})

test('下端シートは初回のネイティブ表示後に中身と登場アニメーションを開始し、開き直しても演出する', () => {
  const sheet = motionComponent('src/components/molecules/BottomSheetModal.tsx', 'BottomSheetModal', {
    Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', SwipeDismissSheet: 'SwipeDismissSheet',
    Platform: { OS: 'ios' }, Dimensions: { get: () => ({ height: 844 }) }, ENTER_MS: 240, EXIT_MS: 180,
    Easing: { out: (fn: unknown) => fn, in: (fn: unknown) => fn },
  })
  const props = { visible: true, onDismiss: () => {}, children: 'content' }
  let tree = sheet.update(props)
  assert.equal(sheet.started.length, 0)
  assert.equal(nodes(tree).find(node => node.type === 'SwipeDismissSheet')!.props.children, null)
  tree.props.onShow()
  tree = sheet.update(props)
  assert.equal(sheet.started.length, 1)
  assert.equal(nodes(tree).find(node => node.type === 'SwipeDismissSheet')!.props.children, 'content')
  tree = sheet.update({ ...props, visible: false })
  assert.equal(tree.props.visible, true)
  assert.equal(sheet.started.length, 2)
  sheet.started[1].finish()
  tree = sheet.update({ ...props, visible: false })
  assert.equal(tree.props.visible, false)
  tree = sheet.update(props)
  assert.equal(sheet.started.length, 2)
  tree.props.onShow()
  sheet.update(props)
  assert.equal(sheet.started.length, 3)
})

test('表示される前に閉じた下端シートはアニメーションを開始しない', () => {
  const sheet = motionComponent('src/components/molecules/BottomSheetModal.tsx', 'BottomSheetModal', {
    Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', SwipeDismissSheet: 'SwipeDismissSheet',
    Platform: { OS: 'ios' }, Dimensions: { get: () => ({ height: 844 }) }, ENTER_MS: 240, EXIT_MS: 180,
    Easing: { out: (fn: unknown) => fn, in: (fn: unknown) => fn },
  })
  sheet.update({ visible: true, onDismiss: () => {} })
  const tree = sheet.update({ visible: false, onDismiss: () => {} })
  assert.equal(tree.props.visible, false)
  assert.equal(sheet.started.length, 0)
})

test('円グラフは動きを減らして表示した後に設定を戻しても再演出しない', () => {
  const chart = motionComponent('src/components/organisms/CategoryChartModal.tsx', 'CategoryChartModal', {
    PIE_SIZE: 260, MAX_PIE_SEGS: 15, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
    AppIcon: 'AppIcon', ICONS: {}, validGadgetPrice: (g: any) => g.price, categoryIconColor: () => '#777777',
  })
  const props = { visible: true, selectedGadgets: [{ category: 'PC', price: 100 }], colors: {}, t: String, fmtPrice: String, animKey: 'desk-1' }
  chart.reduceMotion(true)
  chart.update(props)
  chart.reduceMotion(false)
  chart.update(props)
  chart.update({ ...props, visible: false })
  chart.update(props)
  assert.equal(chart.tasks.length, 0)
  assert.equal(chart.started.length, 0)
})

test('円グラフは描画開始前から価格・割合の全行を読め、遅い完了通知で凡例を演出しない', () => {
  const chart = motionComponent('src/components/organisms/CategoryChartModal.tsx', 'CategoryChartModal', {
    PIE_SIZE: 260, MAX_PIE_SEGS: 15, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
    AppIcon: 'AppIcon', ICONS: {}, validGadgetPrice: (g: any) => g.price, categoryIconColor: () => '#777777',
    partialPiePath: () => null,
  })
  const props = { visible: true, selectedGadgets: [{ category: 'PC', price: 100 }, { category: 'Monitor', price: 300 }], colors: {}, t: String, fmtPrice: String, animKey: 'desk-1' }
  chart.update({ ...props, selectedGadgets: [] })
  const tree = chart.update(props)
  const text = nodes(tree).filter(node => node.type === 'Text').map(node => node.props.children).flat(Infinity)
  assert.ok(text.includes('100'))
  assert.ok(text.includes('300'))
  assert.ok(text.includes('25%'))
  assert.ok(text.includes('75%'))
  assert.equal(nodes(tree).filter(node => node.type === 'AnimatedView').length, 0, '凡例の表示を演出の後へ遅らせない')
  assert.equal(chart.tasks.length, 1)
  chart.tasks[0].run()
  assert.equal(chart.started.length, 1)
  chart.update({ ...props, visible: false })
  chart.started[0].complete?.({ finished: true })
  assert.equal(chart.started.length, 1)
})

test('作成ステップは遷移・線の演出の前から現在地を示し、動きを減らすと補間を省く', () => {
  const state = hooks()
  let reduceMotion = false
  let transition: (event: any) => void = () => {}
  let starts = 0
  const timers = new Map<number, () => void>()
  const render = component('src/components/molecules/SetupProgress.tsx', 'SetupProgress', {
    ...state.bindings, ...base,
    React: { Fragment: 'Fragment' }, Pressable: 'Pressable', Text: 'Text', AppIcon: 'AppIcon', ICONS: {},
    STEPS: [{ ja: '用途', en: 'Purposes' }, { ja: '機材', en: 'Gear' }, { ja: '配置', en: 'Layout' }, { ja: '写真', en: 'Photos' }],
    useApp: () => ({ colors: {}, lang: 'ja', reduceMotion }),
    useSpotlightTarget: () => ({}), useRoute: () => ({ params: {} }),
    useNavigation: () => ({ addListener: (_name: string, callback: typeof transition) => { transition = callback; return () => {} } }),
    Platform: { OS: 'ios' }, TRANSITION_FALLBACK_MS: 600,
    Reanimated: { View: 'AnimatedView' },
    useSharedValue: (value: number) => state.bindings.useRef({ value }).current,
    useAnimatedStyle: (callback: () => any) => callback(),
    Easing: { cubic: (value: number) => value, inOut: (callback: any) => callback },
    withTiming: (value: number) => { starts++; return value }, cancelAnimation: () => {},
    setTimeout: (callback: () => void) => { timers.set(1, callback); return 1 }, clearTimeout: (id: number) => timers.delete(id),
  })
  const paint = () => state.paint(() => render({ current: 2 }))
  let tree = paint()
  const selected = () => nodes(tree).filter(node => node.type === 'Pressable').map(node => node.props.accessibilityState.selected)
  assert.deepEqual(selected(), [false, false, true, false])
  assert.equal(starts, 0)
  state.effects()
  transition({ data: { closing: false } })
  assert.equal(starts, 1)
  reduceMotion = true
  tree = paint(); state.effects()
  assert.deepEqual(selected(), [false, false, true, false])
  assert.equal(starts, 1)
  assert.equal(timers.size, 0)
  reduceMotion = false
  tree = paint(); state.effects()
  assert.deepEqual(selected(), [false, false, true, false])
  assert.equal(starts, 1, '設定を戻しただけで過去の到着演出を繰り返さない')
  assert.equal(timers.size, 0)
  state.unmount()
})

test('AI回答は動きを減らして全文表示した後に設定を戻しても途中へ戻らない', () => {
  const state = hooks()
  let reduceMotion = false
  const timers = new Set<() => void>()
  const render = component('src/screens/AICoachChatScreen.tsx', 'useStreamReveal', {
    ...state.bindings, useApp: () => ({ reduceMotion }), REVEAL_TICK_MS: 16,
    nextRevealLength: (length: number, text: string) => Math.min(text.length, length + 1),
    setTimeout: (callback: () => void) => { timers.add(callback); return callback },
    clearTimeout: (callback: () => void) => { timers.delete(callback) },
  }) as unknown as (text: string, streaming: boolean) => { shown: string }
  const update = (text: string) => {
    state.paint(() => render(text, true)); state.effects()
    const result = state.paint(() => render(text, true)); state.effects()
    return result
  }
  assert.equal(update('回答の本文').shown, '')
  reduceMotion = true
  assert.equal(update('回答の本文').shown, '回答の本文')
  assert.equal(update('回答の本文の続き').shown, '回答の本文の続き')
  reduceMotion = false
  assert.equal(update('回答の本文の続き').shown, '回答の本文の続き')
  assert.equal(timers.size, 0)
})

test('ガイドを開き直した最初の表示に、前回の案内の段を残さない', () => {
  const state = hooks()
  const render = component('src/components/organisms/CoachMarkOverlay.tsx', 'CoachMarkOverlay', {
    ...base, ...state.bindings, MARGIN: 24, GAP: 12, UI_METRICS: { cardRadius: 14 },
  })
  const step = (ja: string) => ({ key: ja, ja, en: ja, rect: null, pad: 4 })
  let steps: any = [step('前の案内1'), step('前の案内2')]
  const paint = () => state.paint(() => render({ steps, onClose: () => {} }))
  const bubble = (tree: any) => nodes(tree).find((node) => node.type === 'TutorialBubble')
  bubble(paint()).props.onConfirm()
  assert.equal(bubble(paint()).props.body, '前の案内2')
  steps = null
  assert.equal(paint(), null)
  steps = [step('新しい案内1'), step('新しい案内2')]
  assert.equal(bubble(paint()).props.body, '新しい案内1')
})

test('ガイドの次へは再描画前でも進み、最後の連打では一度だけ閉じる', () => {
  const state = hooks()
  let closed = 0
  const render = component('src/components/organisms/CoachMarkOverlay.tsx', 'CoachMarkOverlay', {
    ...base, ...state.bindings, MARGIN: 24, GAP: 12, UI_METRICS: { cardRadius: 14 },
  })
  const steps = ['1', '2', '3', '4'].map(ja => ({ key: ja, ja, en: ja, rect: null, pad: 4 }))
  const paint = () => state.paint(() => render({ steps, onClose: () => { closed++ } }))
  const bubble = (tree: any) => nodes(tree).find(node => node.type === 'TutorialBubble')
  const next = bubble(paint()).props.onConfirm
  next(); next()
  assert.equal(bubble(paint()).props.body, '3')
  next()
  assert.equal(bubble(paint()).props.body, '4')
  next(); next(); next()
  assert.equal(closed, 1)
})

test('非公開の商品検索は、開く指定が来ても画面も検索問い合わせも有効にしない', () => {
  const state = hooks()
  const queries: boolean[] = []
  const render = component('src/components/organisms/ProductPickerModal.tsx', 'ProductPickerModal', {
    ...base, ...state.bindings, PRODUCT_BROWSE_ENABLED: false, LIST_LIMIT: 200,
    useProductSuggestionsState: (_category: unknown, _query: unknown, _lang: unknown, enabled: boolean) => {
      queries.push(enabled)
      return { suggestions: [], loading: false, error: false }
    },
  })
  for (const visible of [false, true, false]) {
    assert.equal(state.paint(() => render({ visible, category: 'Other' })), null)
    state.effects()
  }
  assert.deepEqual(queries, [false, false, false])
})

test('閉じた下端シートは、初期表示と再描画で勝手に開いたりアニメーションを始めたりしない', () => {
  const state = hooks()
  let animations = 0
  let dismissals = 0
  const render = component('src/components/molecules/BottomSheetModal.tsx', 'BottomSheetModal', {
    ...base, ...state.bindings, Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView',
    Pressable: 'Pressable', SwipeDismissSheet: 'SwipeDismissSheet', Platform: { OS: 'ios' },
    Dimensions: { get: () => ({ height: 844 }) },
    Animated: { View: 'AnimatedView', Value: class {}, parallel: () => { animations++; return {} } },
  })
  for (let i = 0; i < 3; i++) {
    const tree = state.paint(() => render({ visible: false, onDismiss: () => { dismissals++ } }))
    assert.equal(tree.type, 'Modal')
    assert.equal(tree.props.visible, false)
    state.effects()
  }
  assert.equal(animations, 0)
  assert.equal(dismissals, 0)
})

test('作成ガイドの対象が変わった瞬間は、前の対象の暗幕・吹き出しを出さない', async () => {
  const state = hooks()
  let stepIndex = 0
  const interactionTasks: Array<{ run: () => void; cancelled: boolean }> = []
  const timers: Array<{ fn: () => void; delay: number }> = []
  const measureTarget = async () => ({ x: 20, y: 120, width: 44, height: 44 })
  const setShown = () => {}
  const navigation = { getCurrentRoute: () => ({ name: 'TemplateDetail', key: 'route' }), addListener: () => () => {} }
  const steps = ['first', 'second', undefined].map((targetId, i) => ({
    targetId, title: { ja: `案内${i}`, en: `Guide ${i}` }, advance: { type: 'button' },
  }))
  const render = component('src/components/organisms/SpotlightOverlay.tsx', 'SpotlightOverlay', {
    ...base, ...state.bindings, CARD_GAP: 14, CARD_MARGIN: 24, NavigationContainerRefContext: {},
    useContext: () => navigation,
    useSpotlight: () => ({ running: true, stepIndex, acknowledged: [], acknowledge: () => {}, next: () => {}, goTo: () => {}, finish: () => {} }),
    useSpotlightRegistry: () => ({ measureTarget, setShown }), SPOTLIGHT_STEPS: steps,
    spotlightBodyForRoute: () => ({ ja: '案内', en: 'Guide' }), isStepOnRoute: () => true,
    recoverSpotlightStepForRoute: () => -1, canAdvanceOnArrival: () => false,
    AppState: { addEventListener: () => ({ remove: () => {} }) },
    InteractionManager: { runAfterInteractions: (fn: () => void) => {
      const task = { run: fn, cancelled: false }
      interactionTasks.push(task)
      return { cancel: () => { task.cancelled = true } }
    } },
    setTimeout: (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length }, clearTimeout: () => {},
  })
  const paint = () => state.paint(() => render())
  paint(); state.effects(); paint(); state.effects(); paint()
  interactionTasks.find((task) => !task.cancelled)!.run()
  timers.find((timer) => timer.delay === 120)!.fn()
  for (let i = 0; i < 8; i++) await Promise.resolve()
  assert.equal(nodes(paint()).some((node) => node.type === 'TutorialBubble'), true)
  stepIndex = 1
  assert.equal(nodes(paint()).some((node) => node.type === 'TutorialBubble' || node.type === 'Svg'), false)
  stepIndex = 2
  assert.equal(nodes(paint()).some((node) => node.type === 'TutorialBubble' || node.type === 'Svg'), false)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  const final = nodes(paint()).find((node) => node.type === 'TutorialBubble')
  assert.equal(final?.props.title, '案内2')
  assert.equal(final?.props.arrow, undefined)
})
