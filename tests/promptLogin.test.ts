import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Button = { text: string; onPress?: () => void }

function load(_os: 'ios' | 'web') {
  const alerts: Button[][] = []
  const confirmations: Array<{ onConfirm: () => void }> = []
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/utils/promptLogin.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === './alert') return { Alert: { alert: (_t: string, _m: string, buttons: Button[]) => alerts.push(buttons) } }
      if (id === './confirmation') return { showConfirmation: (options: { onConfirm: () => void }) => confirmations.push(options) }
      throw new Error(`Unexpected import: ${id}`)
    },
  })
  return { promptLogin: module.exports.promptLogin, alerts, confirmations }
}

function press(buttons: Button[], text: string) {
  buttons.find((button) => button.text === text)!.onPress!()
}

test('既定ではログイン・新規登録をそれぞれの面でログイン画面に開く', () => {
  const { promptLogin, alerts } = load('ios')
  const routes: unknown[] = []
  promptLogin({ navigate: (...args: unknown[]) => routes.push(args) }, 'ja', '購入にはアカウントが必要です')
  press(alerts[0], 'ログイン')
  press(alerts[0], '新規登録')
  // vm の中で作ったオブジェクトは別の realm なので、構造だけを比べる
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [['Login', { mode: 'signin' }], ['Login', { mode: 'signup' }]])
})

test('モーダルの中から呼ぶときは、渡した開き方だけを使う（裏に積む navigate はしない）', () => {
  const { promptLogin, alerts } = load('ios')
  const opened: string[] = []
  const navigation = { navigate: () => { throw new Error('must not push behind the modal') } }
  promptLogin(navigation, 'en', 'An account is required', (mode: string) => opened.push(mode))
  press(alerts[0], 'Sign in')
  press(alerts[0], 'Sign up')
  assert.deepEqual(opened, ['signin', 'signup'])
})

test('Webでもログインと新規登録を選べ、渡した開き方を使う', () => {
  const { promptLogin, alerts } = load('web')
  const opened: string[] = []
  promptLogin({ navigate: () => { throw new Error('must not navigate') } }, 'ja', 'm', (mode: string) => opened.push(mode))
  press(alerts[0], 'ログイン')
  press(alerts[0], '新規登録')
  assert.deepEqual(opened, ['signin', 'signup'])
})
