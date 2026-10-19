import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ACCENT_PRESETS } from '../src/constants/accentColors'
import { buildColors, contrastRatio } from '../src/constants/colors'
import { statusTextColor } from '../src/constants/ui'

function source(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function evaluate(expression: string, bindings: Record<string, unknown>) {
  const code = ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(code, { exports: {}, require: () => ({ jsx, jsxs: jsx }), ...bindings })
}

function textElement(file: ts.SourceFile, label: string): string {
  let found: ts.JsxElement | undefined
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'Text' && node.getText(file).includes(label)) found = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found, label)
  return found.getText(file)
}

test('色監査は文字に塗り色やアイコン色を使った直接指定・別名・条件分岐を検出する', () => {
  const file = source('scripts/auditColors.ts')
  const declaration = file.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'accentSurfaces')
  assert.ok(declaration)
  let fixture = `
    const { accentIcon: actionColor } = colors
    const labelColor = selected ? actionColor : colors.textMuted
    const view = <>
    <Text style={{ color: C.accent }} />
    <Text style={{ color: labelColor }} />
    <Animated.Text style={{ color: colors.accentIcon }} />
    </>
  `
  const audit = evaluate(declaration.getText(file), {
    ts, join, __dirname: 'fixture/scripts', TINT_MAX: 0x18, FILL_MIN: 0x38,
    readdirSync: () => [{ name: 'Example.tsx', isDirectory: () => false }],
    readFileSync: () => fixture,
  })
  assert.equal(audit().unreadableText.length, 3)
  fixture = `
    const view = <>
    <Text style={{ color: C.accentText }} />
    <Text style={{ color: colors.onAccent }} />
    <AppIcon color={C.accentIcon} />
    <View style={{ backgroundColor: C.accent }} />
    </>
  `
  assert.equal(audit().unreadableText.length, 0)
  assert.equal(audit().rawIcons.length, 0)
})

test('IDの成功表示とログインのお知らせはテーマ色に依存せず、エラーの色と区別できる', () => {
  const availableText = textElement(source('src/components/molecules/PublicTagField.tsx'), '{message}')
  const noticeText = textElement(source('src/screens/LoginScreen.tsx'), '{notice.text}')
  for (const isDark of [false, true]) {
    const successColors = new Set<string>()
    const infoColors = new Set<string>()
    for (const preset of ACCENT_PRESETS) {
      const C = { ...buildColors(isDark), accentText: isDark ? preset.textDark : preset.textLight }
      const bindings = { C, isDark, statusTextColor, styles: {}, Text: 'Text', message: 'このIDは使えます', available: true }
      const success = evaluate(availableText, { ...bindings, failed: false }).props.style.at(-1).color
      const failure = evaluate(availableText, { ...bindings, failed: true }).props.style.at(-1).color
      const info = evaluate(noticeText, { ...bindings, notice: { text: 'メールを送信しました', kind: 'info' } }).props.style.at(-1).color
      const error = evaluate(noticeText, { ...bindings, notice: { text: '送信に失敗しました', kind: 'error' } }).props.style.at(-1).color
      successColors.add(success)
      infoColors.add(info)
      assert.equal(failure, C.danger)
      assert.equal(error, C.danger)
      assert.notEqual(success, failure)
      assert.notEqual(info, error)
      for (const background of [C.bg, C.card, C.chip]) {
        assert.ok(contrastRatio(success, background) >= 4.5)
        assert.ok(contrastRatio(info, background) >= 4.5)
      }
    }
    assert.equal(successColors.size, 1)
    assert.equal(infoColors.size, 1)
  }
})
