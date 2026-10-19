import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { auditSpacingSource } from '../scripts/auditSpacing'

// 0件の報告は「問題なし」と「何も見ていない」を区別できない。
// わざと壊した入力を1件ずつ拾えることを確かめる（以前は条件つきで渡す形と components/ を素通りしていた）
const audit = (source: string) => auditSpacingSource('Sample.tsx', source)

describe('audit spacing', () => {
  it('catches a numeric gutter on a list container', () => {
    const problems = audit(`
const X = () => <ScrollView contentContainerStyle={styles.content} />
const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 8 },
})`)
    assert.equal(problems.length, 1)
  })

  it('catches a numeric gutter passed through a condition', () => {
    const problems = audit(`
const X = () => <FlatList
  contentContainerStyle={[
    items.length === 0 ? styles.emptyContent : styles.listContent,
    minHeight ? { minHeight } : undefined,
  ]}
/>
const styles = StyleSheet.create({
  listContent: { padding: 16, gap: 12 },
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter },
})`)
    assert.deepEqual(problems.length, 1)
    assert.match(problems[0], /listContent/)
  })

  it('catches a numeric gutter written inline', () => {
    assert.equal(audit('const X = () => <ScrollView contentContainerStyle={{ paddingHorizontal: 18 }} />').length, 1)
  })

  it('passes gutters taken from the tokens', () => {
    assert.deepEqual(audit(`
const X = () => <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + inset }]} />
const styles = StyleSheet.create({
  content: { padding: UI_METRICS.screenGutter, paddingBottom: 24 },
})`), [])
  })

  // 横スクロールのチップ列の内側の余白は、画面の左端の位置ではない
  it('skips horizontal scrollers', () => {
    assert.deepEqual(audit(`
const X = () => <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} />
const styles = StyleSheet.create({
  chips: { paddingHorizontal: 12, gap: 6 },
})`), [])
  })

  it('catches a hard-coded bleed that cancels the parent gutter', () => {
    const problems = audit(`
const styles = StyleSheet.create({
  headerBleed: { marginHorizontal: -16, marginTop: -16 },
  line: { marginHorizontal: -4 },
  bleed: { marginHorizontal: -UI_METRICS.screenGutter },
})`)
    assert.equal(problems.length, 2)
    assert.ok(problems.every((problem) => problem.includes('headerBleed')))
  })

  it('catches a sheet gutter that is not the sheet token', () => {
    const problems = audit(`
const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: UI_METRICS.sheetRadius, paddingHorizontal: 18 },
  okSheet: { borderTopLeftRadius: UI_METRICS.sheetRadius, paddingHorizontal: UI_METRICS.sheetGutter },
  // 四隅を丸めた中央のカードはシートではない
  card: { borderRadius: UI_METRICS.sheetRadius, padding: 22 },
  // 常に出ている下の操作バーは、画面の一覧と左端をそろえる
  footer: { borderTopLeftRadius: UI_METRICS.sheetRadius, paddingHorizontal: UI_METRICS.screenGutter },
})`)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /styles\.sheet（シート）/)
  })
})
