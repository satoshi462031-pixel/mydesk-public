import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(os: string, failure?: 'sync' | 'async', version = 34) {
  const calls: string[] = []
  let now = 1000
  const record = (kind: string) => {
    calls.push(kind)
    if (failure === 'sync') throw new Error('unsupported')
    return failure === 'async' ? Promise.reject(new Error('unavailable')) : Promise.resolve()
  }
  const haptics = {
    AndroidHaptics: { Context_Click: 'click', Segment_Tick: 'tick', Clock_Tick: 'clock', Long_Press: 'long', Confirm: 'confirm', Reject: 'reject' },
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    performAndroidHapticsAsync: (value: string) => record(`android:${value}`),
    impactAsync: (value: string) => record(`impact:${value}`),
    notificationAsync: (value: string) => record(`notification:${value}`),
    selectionAsync: () => record('selection'),
  }
  const exports: Record<string, () => void> = {}
  const code = ts.transpileModule(readFileSync('src/utils/haptics.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, {
    exports, Date: { now: () => now },
    require: (name: string) => name === 'react-native' ? { Platform: { OS: os, Version: version } } : haptics,
  })
  return { calls, api: exports, advance: (ms: number) => { now += ms } }
}

for (const os of ['ios', 'android']) {
  test(`${os}: 選択・長押し・完了・失敗を区別し、取り消せる削除は短い振動にする`, () => {
    const { api, calls } = load(os)
    for (const name of ['hapticSelection', 'hapticLight', 'hapticMedium', 'hapticSuccess', 'hapticWarning', 'hapticError']) api[name]()
    assert.deepEqual(calls, os === 'ios'
      ? ['selection', 'impact:light', 'impact:medium', 'notification:success', 'impact:medium', 'notification:error']
      : ['android:tick', 'android:click', 'android:long', 'android:confirm', 'android:long', 'android:reject'])
  })

  test(`${os}: 素早い連続選択を間引いても直後の確定や失敗は失われない`, () => {
    const { api, calls, advance } = load(os)
    api.hapticSelection()
    advance(49)
    api.hapticSelection()
    api.hapticLight()
    api.hapticSuccess()
    api.hapticError()
    assert.equal(calls.length, 4)
    advance(1)
    api.hapticSelection()
    assert.equal(calls.length, 5)
    api.hapticSuccess()
    assert.equal(calls.length, 5)
    advance(299)
    api.hapticSuccess()
    assert.equal(calls.length, 6)
  })

  for (const failure of ['sync', 'async'] as const) {
    test(`${os}: 触覚が${failure}で失敗しても操作側へ例外を漏らさない`, async () => {
      const { api } = load(os, failure)
      for (const action of Object.values(api)) assert.doesNotThrow(action)
      await new Promise<void>(resolve => setImmediate(resolve))
    })
  }
}

test('Webでは触覚APIを呼ばない', () => {
  const { api, calls } = load('web', 'sync')
  for (const action of Object.values(api)) action()
  assert.deepEqual(calls, [])
})

for (const version of [29, 33]) {
  test(`Android API ${version}: 対応しない振動はOS標準の利用可能な振動へ切り替える`, () => {
    const { api, calls } = load('android', undefined, version)
    api.hapticSelection()
    api.hapticSuccess()
    api.hapticError()
    assert.deepEqual(calls, version < 30
      ? ['android:clock', 'android:click', 'android:long']
      : ['android:clock', 'android:confirm', 'android:reject'])
  })
}
