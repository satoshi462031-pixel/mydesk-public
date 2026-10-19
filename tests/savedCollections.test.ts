import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { elements, savedListNative, savedListsHarness } from './helpers/savedListsHarness'

function service() {
  const calls: any[][] = []
  let response: any = { data: [], error: null }
  const query: any = { then: (done: any) => Promise.resolve(response).then(done) }
  for (const name of ['from', 'select', 'eq', 'order', 'range', 'insert', 'update', 'delete', 'single']) {
    query[name] = (...args: any[]) => { calls.push([name, ...args]); return query }
  }
  const exported: any = {}
  runInNewContext(ts.transpileModule(readFileSync('src/services/savedCollections.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: exported, require: (name: string) => name.endsWith('/client') ? { supabase: query } : { UNIQUE_VIOLATION: '23505' } })
  return { api: exported, calls, respond: (next: any) => { response = next } }
}

test('フォルダ作成・改名は空白名を拒否し、所有者と対象IDを限定して更新する', async () => {
  const h = service()
  for (const name of ['', '  ', '長'.repeat(61)]) await assert.rejects(h.api.createSavedCollection('me', name))
  assert.equal(h.calls.length, 0)
  h.respond({ data: { id: 'folder' }, error: null })
  await h.api.renameSavedCollection('me', 'folder', ' 新しい名前 ')
  assert.ok(h.calls.some((call) => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'me'))
  assert.ok(h.calls.some((call) => call[0] === 'eq' && call[1] === 'id' && call[2] === 'folder'))
  assert.equal(h.calls.find((call) => call[0] === 'update')![1].name, '新しい名前')
})

test('フォルダの振り分けはデスクと機材を区別し、重複追加だけを成功として扱う', async () => {
  const h = service()
  h.respond({ error: { code: '23505' } })
  await h.api.setItemCollection('me', 'folder', 'desk', 'saved-desk', true)
  assert.equal(h.calls.find((call) => call[0] === 'insert')![1].bookmark_id, 'saved-desk')
  h.calls.length = 0
  h.respond({ error: null })
  await h.api.setItemCollection('me', 'folder', 'gadget', 'saved-gear', false)
  assert.ok(h.calls.some((call) => call[0] === 'eq' && call[1] === 'gadget_bookmark_id' && call[2] === 'saved-gear'))
  h.respond({ error: { code: '42501' } })
  await assert.rejects(h.api.setItemCollection('me', 'folder', 'desk', 'foreign', true))
})

function collections(pro = false, count = 3) {
  const state = { user: { id: 'me' }, pro, active: true, focused: true, failMembership: false }
  let rows = Array.from({ length: count }, (_, i) => ({ id: `folder-${i}`, name: `フォルダ${i}`, created_at: '2026-10-19' }))
  const created: string[] = []
  const writes: any[][] = []
  const paywalls: string[] = []
  const h = savedListsHarness('src/hooks/useSavedCollections.tsx', 'useSavedCollections', {
    'react-native': savedListNative,
    '/AppContext': { useApp: () => ({ colors: {}, lang: 'ja' }) }, '/AuthContext': { useAuth: () => ({ user: state.user }) },
    '/useEntitlement': { useEntitlement: () => ({ limits: { maxSavedCollections: state.pro ? -1 : 3 }, isLoading: false }) },
    '/rootNavigation': { openPaywall: (_nav: any, reason: string) => paywalls.push(reason) },
    '/BottomSheetModal': { BottomSheetModal: 'BottomSheetModal' }, '/TextField': { TextField: 'TextField' }, '/AppIcon': { AppIcon: 'AppIcon' },
    '/alert': { Alert: { alert: () => {} } },
    '/savedCollections': {
      listSavedCollections: async () => [...rows],
      createSavedCollection: async (_owner: string, name: string) => { created.push(name); rows = [...rows, { id: `folder-${rows.length}`, name, created_at: '2026-10-19' }] },
      listItemCollections: async () => { if (state.failMembership) throw new Error('offline'); return ['folder-3'] },
      setItemCollection: async (...args: any[]) => { writes.push(args) },
    },
  }, () => [{ isFocused: () => state.focused }, state.active])
  const button = (text: string) => elements(h.current.modal).find((node) => node.type === 'TouchableOpacity'
    && elements(node.props.children).some((child) => child.type === 'Text' && child.props.children === text))!
  const create = async () => {
    const input = elements(h.current.modal).find((node) => node.type === 'TextField')!
    input.props.onChangeText('新しいフォルダ'); await h.flush()
    button('作成').props.onPress(); await h.flush()
  }
  return { h, state, created, writes, paywalls, create }
}

test('無料の4フォルダ目では作成せず、シートが閉じた後にProを案内する', async () => {
  const c = collections()
  c.h.render(); await c.h.flush(); await c.create()
  assert.equal(c.created.length, 0)
  assert.equal(c.paywalls.length, 0)
  c.h.current.modal.props.onDismissed()
  assert.deepEqual(c.paywalls, ['maxSavedCollections'])
  c.h.unmount()
})

test('Proは4個目を作れ、無料へ戻っても超過フォルダへの振り分けを解除できる', async () => {
  const c = collections(true)
  c.h.render(); await c.h.flush(); await c.create()
  assert.equal(c.created.length, 1)
  c.state.pro = false
  c.h.render(); await c.h.flush()
  c.h.current.assignmentButton('gadget', 'gear', '欲しい機材').props.onPress({ stopPropagation() {} })
  await c.h.flush()
  const checkbox = elements(c.h.current.modal).filter((node) => node.props?.accessibilityRole === 'checkbox')[3]
  assert.equal(checkbox.props.accessibilityState.checked, true)
  checkbox.props.onPress(); await c.h.flush()
  assert.deepEqual(c.writes[0], ['me', 'folder-3', 'gadget', 'gear', false])
  c.h.unmount()
})

test('保存先を読み取れない間は既存の振り分けを変更させない', async () => {
  const c = collections()
  c.h.render(); await c.h.flush()
  c.state.failMembership = true
  c.h.current.assignmentButton('desk', 'desk', '参考デスク').props.onPress({ stopPropagation() {} })
  await c.h.flush()
  const checkboxes = elements(c.h.current.modal).filter((node) => node.props?.accessibilityRole === 'checkbox')
  assert.ok(checkboxes.every((node) => node.props.disabled))
  checkboxes[0].props.onPress(); await c.h.flush()
  assert.equal(c.writes.length, 0)
  c.h.unmount()
})
