function clip(text: string, max: number): string {
  const chars = Array.from(text.trim())
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

export function followerNotificationContent(
  desk: { id: string; title: string | null; owner_name: string | null },
  kind: 'new' | 'updated',
  lang: string,
) {
  const ja = lang !== 'en'
  const title = clip(desk.title || (ja ? 'デスク' : 'Desk'), 40)
  const owner = clip(desk.owner_name || '', 30) || (ja ? 'フォロー中の人' : 'Someone you follow')
  return {
    title: owner,
    body: kind === 'new'
      ? (ja ? `新しいデスク「${title}」を公開しました` : `Published a new desk: ${title}`)
      : (ja ? `「${title}」を更新しました` : `Updated ${title}`),
    data: { url: `mydesk://setup/${desk.id}?source=push` },
  }
}

export function clapNotificationContent(desk: { id: string; title: string | null }, fresh: number, lang: string) {
  const ja = lang !== 'en'
  const title = clip(desk.title || (ja ? 'デスク' : 'Desk'), 40)
  return {
    title: ja ? '拍手が届きました' : 'You got applause',
    body: ja
      ? `「${title}」に新しい拍手が${fresh}件届きました`
      : `${fresh} new applause on ${title}`,
    data: { url: `mydesk://setup/${desk.id}?source=push` },
  }
}
