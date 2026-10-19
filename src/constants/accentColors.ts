export type AccentKey = 'orange' | 'blue' | 'purple' | 'green' | 'red' | 'pink' | 'teal'

// 一時開放を終えるときは false に戻し、保存済みの色は残す。
export const ACCENT_COLORS_TEMPORARILY_UNLOCKED = true

export const ACCENT_PRESETS: {
  key: AccentKey
  /** 色見本には文字が出ないので、label は読み上げ専用 */
  label: string
  labelEn: string
  color: string
  /**
   * 中立背景の上に置く文字色。card だけでなく bg(#F2F2F7)・chip(#F2F2F2)、
   * さらに `accent + '18'` を敷いた面（選択中チップの定番）でも 4.5:1 を満たす値。
   * 白背景だけで合わせると、一段暗い面に載せた瞬間 AA を割る。
   * ライトのオレンジは明度を落とすと茶色に見えるので、色相を少し赤へ寄せて彩度を残す
   * （以前の #A55321 は同じ 4.5:1 でも彩度が低く、塗りと並べると暗く濁って見えた）。
   */
  textDark: string
  textLight: string
  /**
   * color を塗りにしたボタン・チップの上に載せる文字色。
   * 白だと既定のオレンジで 2.1:1 しか出ず WCAG AA(4.5:1) を割るため、
   * 7プリセットすべてで 5.1:1 以上を確保できる濃色に固定する。
   */
  onAccent: string
}[] = [
  { key: 'red',    label: 'レッド',   labelEn: 'Red',    color: '#F1594B', textDark: '#F58F88', textLight: '#C02D22', onAccent: '#0F1111' },
  { key: 'pink',   label: 'ピンク',   labelEn: 'Pink',   color: '#F14F67', textDark: '#F78CA1', textLight: '#C02D4B', onAccent: '#0F1111' },
  { key: 'orange', label: 'オレンジ', labelEn: 'Orange', color: '#F59F40', textDark: '#F7B65D', textLight: '#B54900', onAccent: '#0F1111' },
  { key: 'green',  label: 'グリーン', labelEn: 'Green',  color: '#53CD69', textDark: '#73DC87', textLight: '#2E783A', onAccent: '#0F1111' },
  { key: 'teal',   label: 'ティール', labelEn: 'Teal',   color: '#4EACDC', textDark: '#6FC7F5', textLight: '#256F98', onAccent: '#0F1111' },
  { key: 'blue',   label: 'ブルー',   labelEn: 'Blue',   color: '#3187EE', textDark: '#6EC7F5', textLight: '#2062BD', onAccent: '#0F1111' },
  { key: 'purple', label: 'パープル', labelEn: 'Purple', color: '#B866E4', textDark: '#CD98EE', textLight: '#9440BD', onAccent: '#0F1111' },
]
