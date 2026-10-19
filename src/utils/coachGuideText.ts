// 説明ラベルの寸法。ScreenAnnotationGuide の styles（label / labelHeading / number / labelTitle / body）と揃える
const LABEL_PADDING = 10
const LABEL_GAP = 6
const LABEL_BORDER = 1
const NUMBER_SIZE = 20
const NARROW_LABEL = 160
const FONT_SIZE = 13
const TITLE_LINE = 17
const BODY_LINE = 19

// 13pt の字幅。和文は全角で1字ずつ折り返し、欧文は語で折り返す。太字（見出し・強調語）でも
// はみ出さないよう、欧文は平均より広めに見る
const glyphWidth = (char: string) => /[⺀-鿿豈-﫿＀-￯・]/.test(char) ? FONT_SIZE
  : char === ' ' ? FONT_SIZE * 0.3 : FONT_SIZE * 0.58

function lineCount(text: string, width: number): number {
  return text.split('\n').reduce((lines, paragraph) => {
    const tokens = paragraph.match(/[⺀-鿿豈-﫿＀-￯・]|[^\s⺀-鿿豈-﫿＀-￯・]+|\s/g) ?? []
    let count = 1
    let used = 0
    for (const token of tokens) {
      const size = [...token].reduce((sum, char) => sum + glyphWidth(char), 0)
      if (used + size > width && used > 0) {
        count++
        used = token === ' ' ? 0 : size
        // 欄より長い1語は、字の途中で折り返される
        if (size > width) { count += Math.ceil(size / width) - 1; used = size % width }
      } else used += size
    }
    return lines + count
  }, 0)
}

/** 説明ラベルを幅 width で描いたときに、見出しと本文を切らずに見せるのに要る高さ */
export function guideLabelHeight(step: { title?: string; text: string }, width: number): number {
  const inner = width - LABEL_PADDING * 2 - LABEL_BORDER * 2
  const lead = NUMBER_SIZE + LABEL_GAP
  // 狭いラベルでは見出しを番号の下の行へ送る（labelHeading の flexWrap）
  const heading = !step.title ? NUMBER_SIZE
    : width < NARROW_LABEL ? NUMBER_SIZE + LABEL_GAP + lineCount(step.title, inner) * TITLE_LINE
      : Math.max(NUMBER_SIZE, lineCount(step.title, inner - lead) * TITLE_LINE)
  return LABEL_PADDING * 2 + LABEL_BORDER * 2 + heading + LABEL_GAP + lineCount(step.text, inner) * BODY_LINE
}

export function coachGuideText(text: string, phrases: string[] = []): { text: string; emphasized: boolean }[] {
  const words = phrases.filter(Boolean)
  const parts: { text: string; emphasized: boolean }[] = []
  let offset = 0
  while (offset < text.length) {
    const match = words.map(word => ({ word, index: text.indexOf(word, offset) }))
      .filter(item => item.index >= 0).sort((a, b) => a.index - b.index || b.word.length - a.word.length)[0]
    if (!match) { parts.push({ text: text.slice(offset), emphasized: false }); break }
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), emphasized: false })
    parts.push({ text: match.word, emphasized: true })
    offset = match.index + match.word.length
  }
  return parts
}
