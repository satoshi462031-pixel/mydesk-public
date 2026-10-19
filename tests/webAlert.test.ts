import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserDialogs, webAlert } from '../src/utils/webAlert'

function dialogs(answers: { confirm?: boolean; prompt?: string | null } = {}) {
  const shown: string[] = []
  const browser: BrowserDialogs = {
    alert: (text) => { shown.push(`alert:${text}`) },
    confirm: (text) => { shown.push(`confirm:${text}`); return answers.confirm ?? true },
    prompt: (text) => { shown.push(`prompt:${text}`); return answers.prompt === undefined ? '1' : answers.prompt },
  }
  return { browser, shown }
}

test('ボタンの無いお知らせは alert で見せる', () => {
  const { browser, shown } = dialogs()
  webAlert(browser, '保存しました', '公開しました')
  assert.deepEqual(shown, ['alert:保存しました\n\n公開しました'])
})

test('キャンセルと実行の2択は confirm にし、OK で実行側だけを呼ぶ', () => {
  const pressed: string[] = []
  const buttons = [
    { text: 'キャンセル', style: 'cancel' as const, onPress: () => pressed.push('cancel') },
    { text: '削除する', style: 'destructive' as const, onPress: () => pressed.push('delete') },
  ]
  const ok = dialogs({ confirm: true })
  webAlert(ok.browser, 'デスクを削除', '元に戻せません', buttons)
  assert.deepEqual(pressed, ['delete'])
  assert.match(ok.shown[0], /→ 削除する$/)

  pressed.length = 0
  webAlert(dialogs({ confirm: false }).browser, 'デスクを削除', undefined, buttons)
  assert.deepEqual(pressed, ['cancel'])
})

test('ボタンが1つだけなら見せたあとにその処理を進める', () => {
  const pressed: string[] = []
  webAlert(dialogs().browser, '送信しました', undefined, [{ text: 'OK', onPress: () => pressed.push('ok') }])
  assert.deepEqual(pressed, ['ok'])
})

test('3択以上は番号で選ばせ、取り消したらキャンセル側を呼ぶ', () => {
  const pressed: string[] = []
  const buttons = [
    { text: 'キャンセル', style: 'cancel' as const, onPress: () => pressed.push('cancel') },
    { text: 'ログイン', onPress: () => pressed.push('signin') },
    { text: '新規登録', onPress: () => pressed.push('signup') },
  ]
  const picked = dialogs({ prompt: '2' })
  webAlert(picked.browser, 'ログインが必要です', undefined, buttons)
  assert.deepEqual(pressed, ['signup'])
  assert.match(picked.shown[0], /1\. ログイン\n2\. 新規登録$/)

  pressed.length = 0
  webAlert(dialogs({ prompt: null }).browser, 'ログインが必要です', undefined, buttons)
  webAlert(dialogs({ prompt: '9' }).browser, 'ログインが必要です', undefined, buttons)
  assert.deepEqual(pressed, ['cancel', 'cancel'])
})
