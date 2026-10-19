const OFFICIAL_DEMO_DESK_NAMES: Readonly<Record<string, Readonly<{ ja: string; en: string }>>> = {
  '1053c603-25cc-46cb-aa06-284ac9d2fbaf': { ja: 'ゲーミング', en: 'Gaming' },
  '458fa607-269b-421d-a619-01375992fb97': { ja: 'クリエイター', en: 'Creator' },
  'c40c79b0-5aaa-47fb-a271-a5e45026c230': { ja: '音楽・DTM', en: 'Music & DTM' },
  'ebab39f1-c298-411a-9b79-40c89837e313': { ja: '外出ワーク', en: 'Mobile Work' },
}

/** 公式デモかどうか。初回に見せる「未読」マークの対象を決めるのに使う */
export function isOfficialDemoDesk(deskId: string): boolean {
  return deskId in OFFICIAL_DEMO_DESK_NAMES
}

/** 公式デモだけをIDで識別し、ユーザーが付けた同名タイトルは変更しない。 */
export function localizedDemoDeskName(
  deskId: string,
  fallbackName: string,
  lang: 'ja' | 'en',
): string {
  const names = OFFICIAL_DEMO_DESK_NAMES[deskId]
  return names ? names[lang] : fallbackName
}
