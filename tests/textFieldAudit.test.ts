import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { auditTextFieldSource, auditTextFieldTree } from '../scripts/auditTextFields'

const audit = (source: string) => auditTextFieldSource('src/Sample.tsx', source)

describe('text field audit', () => {
  it('リポジトリの1行入力欄は共通部品だけを使う', () => {
    const root = join(__dirname, '..')
    assert.deepEqual(auditTextFieldTree(join(root, 'src'), root), [])
  })

  it('1行の TextInput を検出する', () => {
    assert.equal(audit('const X = () => <TextInput value={value} />').length, 1)
    assert.equal(audit('const X = () => <TextInput multiline={false} />').length, 1)
    assert.equal(audit('const X = () => <TextInput multiline={expanded} />').length, 1)
  })

  it('複数行の TextInput は許可する', () => {
    assert.deepEqual(audit('const X = () => <TextInput multiline />'), [])
  })

  it('containerStyle から高さや枠を上書きさせない', () => {
    const problems = audit(`
const X = () => <TextField containerStyle={styles.field} />
const styles = StyleSheet.create({ field: { flex: 1, minHeight: 46, borderWidth: 2 } })
`)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /borderWidth, minHeight/)
  })

  it('TextInput に直接付けた lineHeight を検出する', () => {
    const problems = audit(`
const X = () => <TextInput multiline style={[styles.input, { color }]} />
const styles = StyleSheet.create({ input: { fontSize: 15, lineHeight: 22 } })
`)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /lineHeight/)
    assert.equal(audit('const X = () => <TextInput multiline style={{ fontSize: 13, lineHeight: 18 }} />').length, 1)
  })

  it('中身を追えない展開は TextInput の style に使わせない', () => {
    const problems = audit(`
const X = () => <TextInput multiline style={styles.input} />
const styles = StyleSheet.create({ input: { padding: 10, ...DESK_DESCRIPTION_TEXT } })
`)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /\.\.\.DESK_DESCRIPTION_TEXT/)
  })

  it('複数行の欄は multilineInputText を通せば許可する', () => {
    assert.deepEqual(audit(`
const X = () => <TextInput multiline style={styles.input} />
const styles = StyleSheet.create({ input: { ...multilineInputText({ fontSize: 15, lineHeight: 22, paddingTop: 7, paddingBottom: 7 }, Platform.OS) } })
`), [])
  })

  it('1行の欄には multilineInputText も許可しない', () => {
    const problems = auditTextFieldSource('src/components/atoms/TextField.tsx', `
const X = () => <TextInput style={styles.input} />
const styles = StyleSheet.create({ input: { ...multilineInputText({ fontSize: 15, lineHeight: 22, paddingTop: 0, paddingBottom: 0 }, Platform.OS) } })
`)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /1行/)
  })

  it('配置だけの containerStyle は許可する', () => {
    assert.deepEqual(audit(`
const X = () => <SearchField containerStyle={[styles.field, { marginTop: 8 }]} />
const styles = StyleSheet.create({ field: { flex: 1, minWidth: 0, marginBottom: 12 } })
`), [])
  })
})
