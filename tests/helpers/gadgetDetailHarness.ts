import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as gadgetPorts from '../../src/utils/gadgetPorts'
import * as portConfig from '../../src/constants/portFormConfig'
import * as portRoles from '../../src/utils/portRoles'
import * as dates from '../../src/utils/dateFormat'
import * as text from '../../src/utils/truncateText'
import * as limits from '../../src/constants/textLimits'
import * as usage from '../../src/utils/deskGadgetUsage'
import * as numeric from '../../src/utils/numericInput'
import { normalizeHttpUrl } from '../../src/utils/url'
import { customCategoryOf } from '../../src/utils/customCategory'
import { localDateKey } from '../../src/utils/deskTimeline'
import { localizedGadgetName } from '../../src/utils/localizedGadgetName'
import { gadgetFromProduct } from '../../src/utils/gadgetFromProduct'
import type { Gadget, GadgetCategory } from '../../src/types'

const file = 'src/screens/GadgetDetailScreen.tsx'
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const screen = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'GadgetDetailScreen')!
const statements = screen.body!.statements
const stop = statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'catColor'))
const stateNames = statements.flatMap(node => ts.isVariableStatement(node) ? node.declarationList.declarations.flatMap(item =>
  ts.isArrayBindingPattern(item.name) && item.initializer && ts.isCallExpression(item.initializer) && item.initializer.expression.getText(source) === 'useState'
    ? [item.name.elements.map(part => part.getText(source))] : []) : [])
const detectors = source.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item =>
  ['detectPowerInput', 'detectMouseConnType', 'detectPeriConnType'].includes(item.name.getText(source))))
function functions(path: string, names: string[]) {
  const parsed = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
    .map(node => node.getText(parsed).replace(/^export /, '')).join('\n')
}
const code = ts.transpileModule([
  detectors.map(node => node.getText(source)).join('\n'),
  functions('src/components/molecules/DeskUsageHistoryEditor.tsx', ['usagePeriodDrafts', 'parseUsagePeriodDrafts']),
  functions('src/components/molecules/GadgetMetadataEditor.tsx', ['parseOperationModes']),
  functions('src/components/molecules/PortConfigurationEditor.tsx', ['isConfigured', 'hasConfiguredVisiblePorts']),
  `function render({ route, navigation }) {${statements.slice(0, stop).map(node => node.getText(source)).join('\n')}
    return { values: {${stateNames.map(([value]) => value).join(',')}}, setters: {${stateNames.map(([, setter]) => setter).join(',')}},
      handleSave, runDelete, confirmDelete, requestCategoryChange, handleCategoryChange, handleSuggestionSelect, buildUpdatedGadget };
  }`,
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText

export function gadgetDetailHarness(category: GadgetCategory, draft = false) {
  let cursor = 0
  let dirty = false
  let focused = true
  const slots: any[] = []
  const effects = new Map<number, () => void>()
  const deps: unknown[][] = []
  const pending: { kind: string; gadget?: Gadget; done: () => void; fail: () => void }[] = []
  const messages: unknown[][] = []
  const confirmations: any[] = []
  const stored: Gadget[] = []
  let backs = 0
  let confirmDiscard = () => false
  const gadget = gadgetFromProduct({ id: 'subject', name: 'Test gadget', category, now: '2026-10-18' })
  const hosts: Gadget[] = ['PC', 'Charger', 'Tablet', 'GameConsole', 'Smartphone'].map((cat, index) =>
    gadgetFromProduct({ id: `host-${index}`, name: cat, category: cat as GadgetCategory, now: '' }))
  const gadgets = [gadget, ...hosts]
  const plans = [{ id: 'desk', name: 'Desk', selectedGadgetIds: gadgets.map(item => item.id), placements: [], createdAt: '', updatedAt: '' }]
  const queue = (kind: string, value?: Gadget) => new Promise<void>((resolve, reject) => {
    pending.push({ kind, gadget: value, done: () => { if (value) stored.push(value); resolve() }, fail: () => reject(new Error('storage failed')) })
  })
  const react = {
    useRef: (current: unknown) => slots[cursor++] ??= { current },
    useState: (initial: any) => {
      const slot = cursor++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], (next: any) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; dirty = true }]
    },
    useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void, next: unknown[]) => {
      const slot = cursor++
      if (!deps[slot] || next.some((value, i) => value !== deps[slot][i])) { deps[slot] = next; effects.set(slot, fn) }
    },
  }
  const navigation = { isFocused: () => focused, goBack: () => { backs++ }, setOptions: () => {} }
  const route = { params: { gadgetId: gadget.id, ...(draft ? { draftGadget: gadget } : {}) } }
  const runtime: Record<string, any> = {
    ...gadgetPorts, ...portConfig, ...portRoles, ...dates, ...text, ...limits, ...usage, ...numeric, ...react,
    useLayoutEffect: react.useEffect, useSafeAreaInsets: () => ({ bottom: 0 }), useHeaderHeight: () => 0,
    useGadgets: () => ({ gadgets, update: (value: Gadget) => queue('update', value), add: (value: Gadget) => queue('add', value) }),
    usePlans: () => ({ plans, getById: () => null, updateWith: async () => {} }),
    useGadgetDeletion: () => ({ deleteGadget: () => queue('delete') }),
    useCustomCategories: () => ({ categories: [] }), usePlanOpenedAt: () => ({}), sortPlansLikeMyDesk: (items: unknown[]) => items,
    useApp: () => ({ colors: {}, t: String, lang: 'ja', isDark: false, unitLabel: 'cm',
      parsePriceToJpy: (value: string) => value.trim() ? Number(value) : undefined, fmtPriceInput: (value: unknown) => value == null ? '' : String(value) }),
    useToday: () => new Date('2026-10-18T00:00:00Z'), useKeyboardReveal: () => {}, useProductSuggestions: () => [],
    useConfirmDiscard: (_navigation: unknown, predicate: () => boolean) => { confirmDiscard = predicate },
    customCategoryOf, normalizeHttpUrl, localDateKey, localizedGadgetName,
    analytics: { track: () => {} }, EVENTS: {}, beginPlanReflection: () => {}, endPlanReflection: () => {},
    hapticSuccess: () => {}, hapticError: () => {},
    showConfirmation: (options: unknown) => { confirmations.push(options) }, showMessage: (...args: unknown[]) => { messages.push(args) },
    useCoachMarks: () => ({ target: () => undefined, open: async () => {}, overlay: null }),
    COACH_SCREEN: '__screen', CoachAnchor: 'CoachAnchor', CoachScope: 'CoachScope', HeaderIconButton: 'HeaderIconButton',
    setTimeout: () => 0, clearTimeout: () => {}, Platform: { OS: 'ios' }, styles: {},
    exports: {}, require: () => ({ jsx: () => ({}), jsxs: () => ({}) }),
  }
  runInNewContext(code, runtime)
  let frame: any
  const paint = () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      dirty = false; cursor = 0
      frame = runtime.render({ route, navigation })
      const next = [...effects.values()]; effects.clear(); next.forEach(fn => fn())
      if (!dirty) return frame
    }
    throw new Error('GadgetDetail render did not settle')
  }
  paint()
  return {
    paint, frame: () => frame, pending, messages, confirmations, stored, gadget,
    backs: () => backs, leave: () => { focused = false }, focus: () => { focused = true }, shouldConfirmDiscard: () => confirmDiscard(),
    settle: async (fail = false) => { const next = pending.shift(); if (fail) next?.fail(); else next?.done(); await new Promise<void>(done => setImmediate(done)) },
    button: (attribute: string, setter: string, locals: Record<string, unknown> = {}) => {
      let found: ts.Expression | undefined
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText(source) === attribute && node.initializer && ts.isJsxExpression(node.initializer)
          && node.initializer.expression?.getText(source).includes(`${setter}(`)) found = node.initializer.expression
        ts.forEachChild(node, visit)
      }
      visit(screen)
      if (!found) throw new Error(`Missing ${setter} button`)
      return runInNewContext(ts.transpileModule(`(${found.getText(source)})`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText, { ...runtime, ...frame.values, ...frame.setters, ...locals, selectDefaultPcTarget: () => frame.setters.setConnectedToId('host-0') }) as (...args: any[]) => any
    },
  }
}
