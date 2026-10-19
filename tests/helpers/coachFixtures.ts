import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { CoachStep } from '../../src/hooks/useCoachMarks'
import { setupCoachStepsForRoute } from '../../src/constants/setupCoachSteps'

const FILES = [
  'src/constants/deskCoachSteps.ts', 'src/screens/PlanListScreen.tsx', 'src/screens/DeskFeedScreen.tsx',
  'src/screens/MyPageScreen.tsx', 'src/components/organisms/InventoryStatsPanel.tsx',
  'src/components/organisms/GadgetStatsPanel.tsx', 'src/components/organisms/DeskHistoryAnimationModal.tsx',
  'src/constants/gadgetCoachSteps.ts', 'src/constants/aiCoachSteps.ts',
]
function source(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function evaluate(code: string, bindings: Record<string, unknown> = {}): any {
  return runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, bindings)
}
const iconSource = source('src/constants/icons.ts')
const icons = iconSource.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find(node => node.name.getText(iconSource) === 'ICONS')!
const ICONS = evaluate(`(${icons.initializer!.getText(iconSource)})`)

export function coachDefinitions(): Record<string, CoachStep[] | Record<string, CoachStep[]>> {
  return Object.assign({}, ...FILES.map(file => {
    const ast = source(file)
    const names: string[] = []
    const statements = ast.statements.filter(node => {
      if (!ts.isVariableStatement(node)) return false
      const name = node.declarationList.declarations[0].name.getText(ast)
      if (name.endsWith('_COACH') || ['inContent', 'inList', 'inForm', 'inMessages', 'aboveSave', 'DESK_CONTENT', 'UNDER_CONTENT'].includes(name)) {
        if (name.endsWith('_COACH')) names.push(name)
        return true
      }
      return false
    })
    return JSON.parse(JSON.stringify(evaluate(`${statements.map(node => node.getText(ast).replace(/^export\s+/, '')).join(';\n')};\n({${names.join(',')}})`, { ICONS, DESK_CONTENT: 'desk-content' })))
  }))
}

export function openScreenCoach(file: string, bindings: Record<string, unknown>): CoachStep[] {
  const ast = source(file)
  let initializer: ts.Expression | undefined
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openHelp') initializer = node.initializer
    ts.forEachChild(node, walk)
  }
  walk(ast)
  if (!initializer) throw new Error(`openHelp is missing in ${file}`)
  let steps: CoachStep[] = []
  const open = evaluate(`(${initializer.getText(ast)})`, {
    ...coachDefinitions(), ...bindings, useCallback: (fn: unknown) => fn,
    openCoach: async (next: CoachStep[]) => { steps = next },
  })
  open()
  return JSON.parse(JSON.stringify(steps))
}

export function coachScenarios(): { name: string; steps: CoachStep[] }[] {
  const scenarios = [
    { name: 'マイデスク一覧', steps: openScreenCoach('src/screens/PlanListScreen.tsx', {}) },
    { name: 'みんなのデスク', steps: openScreenCoach('src/screens/DeskFeedScreen.tsx', {}) },
    { name: '持ち物の統計', steps: openScreenCoach('src/screens/GadgetStatsScreen.tsx', {}) },
    { name: '歴史の再生', steps: openScreenCoach('src/components/organisms/DeskHistoryAnimationModal.tsx', { playing: true, pb: { pause() {} }, resumeAfterHelp: { current: false } }) },
    { name: '機材詳細', steps: openScreenCoach('src/screens/GadgetDetailScreen.tsx', {}) },
    { name: '接続方法', steps: openScreenCoach('src/screens/ConnectionMethodScreen.tsx', {}) },
    { name: 'AIコーチの履歴', steps: openScreenCoach('src/screens/AICoachListScreen.tsx', {}) },
    { name: 'AIコーチ', steps: openScreenCoach('src/screens/AICoachChatScreen.tsx', {}) },
    { name: '機材追加', steps: openScreenCoach('src/screens/AddGadgetScreen.tsx', {}) },
    { name: '商品の入力', steps: openScreenCoach('src/screens/ProductFillScreen.tsx', {}) },
  ]
  for (const route of ['PurposeSelection', 'TemplateDetail', 'GadgetSelection', 'DeskPlacement', 'PhotoFill']) {
    scenarios.push({ name: `作成・${route}`, steps: setupCoachStepsForRoute(route) })
  }
  for (const tab of ['published', 'history', 'favorites', 'gadgets']) scenarios.push({
    name: `マイページ・${tab}`,
    steps: openScreenCoach('src/screens/MyPageScreen.tsx', { visibleTabRef: { current: tab } }),
  })
  for (const tab of ['gadgets', 'wiring', 'info']) {
    scenarios.push({ name: `自分のデスク・${tab}`, steps: openScreenCoach('src/screens/WiringResultScreen.tsx', { tabRef: { current: tab }, readOnlyRef: { current: false } }) })
    scenarios.push({ name: `閲覧専用デスク・${tab}`, steps: openScreenCoach('src/screens/WiringResultScreen.tsx', { tabRef: { current: tab }, readOnlyRef: { current: true } }) })
    scenarios.push({ name: `公開デスク・${tab}`, steps: openScreenCoach('src/screens/PublicDeskScreen.tsx', { tabRef: { current: tab } }) })
  }
  scenarios.push({ name: '購入総額の横の？', steps: coachDefinitions().INVENTORY_AMOUNT_COACH as CoachStep[] })
  return scenarios
}
