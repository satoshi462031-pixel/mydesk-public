import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

export function savedListsHarness(file: string, exportName: string, modules: Record<string, any>, args: () => any[]) {
  const values: any[] = []
  const deps: any[][] = []
  const cleanup: Array<(() => void) | undefined> = []
  let cursor = 0
  let dirty = true
  let result: any
  const layouts: (() => void)[] = []
  const effects: (() => void)[] = []
  const changed = (index: number, next: any[]) => !deps[index] || next.some((value, i) => value !== deps[index][i])
  const effect = (queue: (() => void)[]) => (run: () => any, next: any[]) => {
    const index = cursor++
    if (!changed(index, next)) return
    deps[index] = next
    queue.push(() => { cleanup[index]?.(); cleanup[index] = run() })
  }
  const react = {
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
      return [values[index], (next: any) => {
        const value = typeof next === 'function' ? next(values[index]) : next
        if (value !== values[index]) { values[index] = value; dirty = true }
      }]
    },
    useRef: (current: any) => { const index = cursor++; return values[index] ??= { current } },
    useMemo: (create: () => any, next: any[]) => {
      const index = cursor++
      if (changed(index, next)) { values[index] = create(); deps[index] = next }
      return values[index]
    },
    useCallback: (run: any, next: any[]) => react.useMemo(() => run, next),
    useEffect: effect(effects), useLayoutEffect: effect(layouts),
  }
  const jsx = (type: any, props: any, key: string) => ({ type, props, key })
  const exported: Record<string, any> = {}
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: exported,
    require: (name: string) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === '@react-navigation/native') return { useFocusEffect: (run: () => any) => react.useEffect(run, [run]) }
      const found = Object.keys(modules).find((key) => name === key || name.endsWith(key))
      if (!found) throw new Error(`Unmocked module: ${name}`)
      return modules[found]
    },
  })
  const render = () => {
    dirty = false
    cursor = 0
    result = exported[exportName](...args())
    layouts.splice(0).forEach((run) => run())
    effects.splice(0).forEach((run) => run())
    return result
  }
  return {
    render,
    get current() { return result },
    async flush() {
      for (let i = 0; i < 12; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        if (dirty) render()
      }
      return result
    },
    unmount() { cleanup.forEach((run) => run?.()) },
  }
}

export function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(elements)
  return [node, ...elements(node.props?.children)]
}

export const savedListNative = {
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
  Animated: { FlatList: 'FlatList' }, StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
}
