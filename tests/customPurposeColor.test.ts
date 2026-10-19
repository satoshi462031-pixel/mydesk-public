import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { compositeColor, contrastRatio, CUSTOM_CATEGORY_COLOR_PRESETS, YELLOW_REFERENCE } from '../src/constants/colors'
import { PURPOSE_COLORS, purposeColor, purposeIconColor, purposeTintColor } from '../src/constants/purposeColors'
import { CUSTOM_PURPOSE_COLOR_ENABLED } from '../src/constants/features'
import { normalizeCustomCategoryColor } from '../src/utils/customCategory'
import { trimAndTruncate, truncateChars } from '../src/utils/truncateText'

function load(file: string, names: string[], bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = source.statements.filter((node) => {
    if (ts.isFunctionDeclaration(node)) return !!node.name && names.includes(node.name.text)
    return ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.includes(item.name.getText(source)))
  })
  assert.equal(declarations.length, names.length)
  const code = ts.transpileModule(`${declarations.map((node) => node.getText(source).replace(/^export\s+/, '')).join('\n')};({${names.join(',')}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(code, { exports: {}, require: () => ({ jsx, jsxs: jsx }), ...bindings }) as Record<string, any>
}

function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children)] : []
}

function state() {
  const slots: any[] = []
  let cursor = 0
  return {
    reset: () => { cursor = 0 },
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
  }
}

const paletteBindings = {
  styles: {}, View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', TextField: 'TextField',
  CUSTOM_CATEGORY_COLOR_PRESETS, normalizeCustomCategoryColor,
  useApp: () => ({ colors: {}, lang: 'ja', isDark: false, t: (key: string) => key }),
}

const purpose = {
  PURPOSE_COLORS, purposeColor, purposeIconColor, purposeTintColor, contrastRatio,
  ...load('src/screens/PurposeSelectionScreen.tsx', [
    'PURPOSE_DEFS', 'OTHER_PURPOSE_ICONS', 'MAIN_PURPOSES', 'OTHER_DEF',
  ], { PURPOSE_COLORS }),
}

test('用途の色設定は非公開のままで、開く指定があっても描画しない', () => {
  assert.equal(CUSTOM_PURPOSE_COLOR_ENABLED, false)
  const hooks = state()
  const { CustomPurposeColorEditor } = load('src/components/molecules/CustomPurposeColorEditor.tsx', ['CustomPurposeColorEditor'], {
    ...paletteBindings, ...hooks, CUSTOM_PURPOSE_COLOR_ENABLED,
  })
  assert.equal(CustomPurposeColorEditor({ value: '#E53935', onChange: () => assert.fail('未公開の操作') }), null)
})

test('有効化後は8色を選択でき、自由色はHEX入力から変更できる', () => {
  const hooks = state()
  let value = '#E53935'
  const { CustomPurposeColorEditor } = load('src/components/molecules/CustomPurposeColorEditor.tsx', ['CustomPurposeColorEditor'], {
    ...paletteBindings, ...hooks, CUSTOM_PURPOSE_COLOR_ENABLED: true,
  })
  const render = () => { hooks.reset(); return nodes(CustomPurposeColorEditor({ value, onChange: (next: string) => { value = next } })) }
  const options = render().filter((node) => node.props.accessibilityRole === 'radio')
  assert.equal(options.length, 8)
  options[5].props.onPress()
  assert.equal(value, CUSTOM_CATEGORY_COLOR_PRESETS[5].color)
  assert.equal(render().filter((node) => node.props.accessibilityState?.selected).length, 1)
  render().find((node) => node.props.accessibilityRole === 'button').props.onPress()
  render().find((node) => node.type === 'TextField').props.onChangeText('aabbcc')
  assert.equal(value, '#aabbcc')
})

test('自由色は「その他」だけに適用し、白黒モードの面と薄い器の上でも見分けられる', () => {
  for (const color of [...CUSTOM_CATEGORY_COLOR_PRESETS.map((preset) => preset.color), '#000000', '#FFFFFF', '#FDFDFD']) {
    for (const isDark of [false, true]) {
      const icon = purpose.purposeIconColor('other', isDark, color)
      const base = purpose.purposeTintColor('other', isDark, color)
      const bg = isDark ? '#3A3A3C' : '#F2F2F2'
      const ratio = (surface: string) => contrastRatio(icon, surface)
      // 黄は明るい面で 3:1 に届かないのを承知で #FFD400 にしている（auditColors の免除）
      const exempt = icon === YELLOW_REFERENCE && !isDark
      assert.ok(exempt || ratio(bg) >= 3, `${color} / ${isDark}`)
      assert.ok(exempt || ratio(compositeColor(base + '22', bg)) >= 3, `${color} / ${isDark} / tint`)
      assert.equal(purpose.purposeIconColor('gaming', isDark, color), purpose.purposeIconColor('gaming', isDark))
    }
  }
  for (const color of ['red', '#fff', '#12345678']) assert.equal(purpose.purposeColor('other', color), purpose.PURPOSE_COLORS.other)
})

test('用途選択の画面でも入口を隠し、保存済みの色は選び直しても保持する', async () => {
  const hooks = state()
  let saved: any
  const plan = { id: 'desk', otherPurposeColor: '#2196F3' }
  const components = ['SafeAreaView', 'SetupProgress', 'SetupScreenHelp', 'SetupActionFooter', 'ScrollView', 'AppIcon', 'IconPickerModal', 'CustomPurposeColorEditor']
  const { PurposeSelectionScreen } = load('src/screens/PurposeSelectionScreen.tsx', ['PurposeSelectionScreen'], {
    ...paletteBindings, ...purpose, ...hooks, ...Object.fromEntries(components.map((name) => [name, name])),
    CUSTOM_PURPOSE_COLOR_ENABLED: false, PURPOSE_NAME_MAX_LENGTH: 10, TILE_W: 180, trimAndTruncate, truncateChars,
    useEffect: () => {}, useLayoutEffect: () => {}, useRef: (current: unknown) => ({ current }),
    usePlans: () => ({ plans: [plan], updateWith: async (_id: string, update: any) => { saved = update(plan) } }),
    useGadgets: () => ({ gadgets: [] }), useSpotlight: () => ({ running: false, startTour: () => {} }),
    useSpotlightTarget: (id: string) => id, isIconName: () => false, ICONS: {}, Dimensions: { get: () => ({ width: 390 }) },
    openGearStep: () => {}, Alert: { alert: () => assert.fail('用途保存の失敗') },
  })
  const tree = nodes(PurposeSelectionScreen({
    route: { params: { initialPurposes: ['other'], initialOtherPurposeColor: '#2196F3', returnPlanId: 'desk' } }, navigation: { isFocused: () => true },
  }))
  assert.equal(tree.some((node) => node.type === 'CustomPurposeColorEditor'), false)
  const purposeArea = tree.find((node) => node.props.ref === 'purpose-options')
  assert.ok(purposeArea)
  assert.equal(nodes(purposeArea).filter((node) => node.props.accessibilityRole === 'checkbox').length, 7,
    '先頭行だけでなく、「その他」を含む選択肢全体を囲む')
  const footer = tree.find((node) => node.type === 'SetupActionFooter')
  assert.equal(footer.props.disabled, false)
  footer.props.onPress()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(saved.otherPurposeColor, '#2196F3')
})
