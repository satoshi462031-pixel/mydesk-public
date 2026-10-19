import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function initializer(path: string, name: string) {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  let expression = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) {
      expression = node.initializer.getText(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(expression, `${name} must exist`)
  return expression
}

const screen = 'src/screens/WiringResultScreen.tsx'
const action = initializer(screen, 'handleShareIcon')

for (const visibility of ['public', 'unlisted', 'private', null]) {
  for (const outdated of [false, true]) {
    test(`${visibility}: ${outdated ? '更新あり' : '最新'}の共有導線`, () => {
      const open = visibility === 'public' || visibility === 'unlisted'
      const calls: string[] = []
      const context = {
        canUpdatePublicPage: open,
        publishedDeskId: visibility === null ? null : 'desk',
        planPublishState: !open ? visibility ?? 'none' : outdated
          ? visibility === 'unlisted' ? 'unlisted_outdated' : 'outdated'
          : visibility,
        isOutdatedPublishState: (state: string) => state === 'outdated' || state === 'unlisted_outdated',
        sharePublicLink: () => calls.push('share'),
        handleShare: async () => { calls.push('publish-sheet') },
      }
      runInNewContext(`(${action})()`, context)
      assert.deepEqual(calls, [open && !outdated ? 'share' : 'publish-sheet'])
    })
  }
}

test('公開中の更新案内は公開データを変更せず既存シートを開く', async () => {
  const calls: string[] = []
  await runInNewContext(`(${initializer(screen, 'handleShare')})()`, {
    user: { id: 'owner' },
    publishedDeskId: 'desk',
    publishedVisibility: 'public',
    setPublishState: (state: string) => calls.push(state),
    setPublishModalVisible: (visible: boolean) => calls.push(String(visible)),
  })
  assert.deepEqual(calls, ['done', 'true'])
})
