export type AISafetyIssue = 'credential_request' | 'electrical_bypass' | 'self_harm_instruction' | 'sexual_exploitation'

// 一致した時点で回答全体が差し替わる（index.ts）。デスク環境の相談で普通に出る文まで拾うと、
// 役に立つ回答ごと消える。止めるのは「AI が認証情報を自分に渡させる」「安全装置を外させる」
// 文だけで、自分の機器への設定手順や、外さないよう促す注意書きは通す
type Rule = {
  issue: AISafetyIssue
  pattern: RegExp
  // 直前の否定（not / never / don't …）で打ち消される英語の規則。日本語の規則は命令形
  // （外してください）で書いてあるので、否定形（外さないで・バイパスせず）はもともと一致しない
  negatable?: boolean
}

const RULES: Rule[] = [
  // 自分の機器に入力する手順（ルーターの管理画面でパスワードを入力）は止めない。
  // 止めるのは、送らせる・教えさせる・このチャットに入力させる形だけ
  {
    issue: 'credential_request',
    pattern: /(?:パスワード|APIキー|認証コード).{0,24}(?:送ってください|教えてください|共有してください)|(?:ここ|このチャット|この画面).{0,12}(?:パスワード|APIキー|認証コード).{0,12}入力してください/,
  },
  {
    issue: 'credential_request',
    pattern: /\b(?:send|share|tell|give)\s+(?:me|us)\b.{0,24}?\b(?:password|api key|authentication code)\b|\b(?:enter|type|paste)\b.{0,24}?\b(?:password|api key|authentication code)\b.{0,12}?\b(?:here|in(?:to)? (?:this|the) chat)\b/i,
  },
  {
    issue: 'electrical_bypass',
    pattern: /(?:ヒューズ|アース|漏電遮断器|安全装置).{0,24}(?:外してください|無効化してください|バイパスしてください)/,
  },
  // 「ground loop」は音響のハムノイズ対策の用語で、アースを外す話ではない
  {
    issue: 'electrical_bypass',
    pattern: /\b(?:bypass|disable|remove)\b.{0,24}?\b(?:fuse|ground(?!\s*loop)|grounding|circuit breaker|safety device)/i,
    negatable: true,
  },
  { issue: 'self_harm_instruction', pattern: /(?:自殺|自傷).{0,16}(?:具体的な方法|手順|やり方)|(?:step-by-step|instructions).{0,24}(?:suicide|self-harm)/i },
  { issue: 'sexual_exploitation', pattern: /(?:児童|未成年).{0,16}(?:性的搾取|性的画像を作成)|(?:child sexual exploitation|sexual images of minors)/i },
]

// 一致の直前がこれで終わっていれば、禁止ではなく「しないで」という注意書き。
// 否定から一致までは語2つ程度しか渡さず、読点や文の区切りも越えない。越えさせると
// 「Do not remove the fuse, remove the ground pin」の後半まで打ち消してしまう
const EN_NEGATION_BEFORE = /\b(?:not|never|avoid|without|cannot|dont|\w*n['’]t)\b[\s\w'’-]{0,16}$/i

function matchesRule(rule: Rule, content: string): boolean {
  if (!rule.negatable) return rule.pattern.test(content)
  const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`
  for (const match of content.matchAll(new RegExp(rule.pattern.source, flags))) {
    const start = match.index ?? 0
    if (!EN_NEGATION_BEFORE.test(content.slice(Math.max(0, start - 48), start))) return true
  }
  return false
}

export function findAISafetyIssue(content: string): AISafetyIssue | null {
  return RULES.find((rule) => matchesRule(rule, content))?.issue ?? null
}

export function safeAIReplacement(lang: unknown): string {
  return lang === 'en'
    ? 'I could not safely display that response. Verify power, wiring, load, and product compatibility against manufacturer documentation, and consult a qualified professional when safety is involved.'
    : '安全上の理由により、この回答は表示できませんでした。電源・配線・耐荷重・互換性はメーカーの一次情報で確認し、安全に関わる場合は有資格者へ相談してください。'
}
