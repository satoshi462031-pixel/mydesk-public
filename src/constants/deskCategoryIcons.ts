export interface DeskCategoryIconChoice {
  name: string
  titleJa: string
  titleEn: string
  path: string
}

// フォントにない設置用品も、保存・共有できる短い名前で扱う。
export const DESK_CATEGORY_ICONS: readonly DeskCategoryIconChoice[] = [
  { name: 'desk-monitor-shelf', titleJa: 'モニター台・デスクシェルフ', titleEn: 'Monitor shelf', path: 'M2 10h20v3H2zM5 13v7M19 13v7M8 3h8v5H8zM12 8v2' },
  { name: 'desk-laptop-stand', titleJa: 'ノートPCスタンド', titleEn: 'Laptop stand', path: 'M5 3h13v9H5zM3 15l16-3 2 3-16 3zM7 18v3M18 16v5M4 21h17' },
  { name: 'desk-device-stand', titleJa: 'スマホ・タブレットスタンド', titleEn: 'Device stand', path: 'M8 2h9v14H8zM11 13h3M12 16v5M6 21h13M5 7v11h3' },
  { name: 'desk-headphone-stand', titleJa: 'ヘッドホンスタンド', titleEn: 'Headphone stand', path: 'M4 12V9a8 8 0 0 1 16 0v3M4 10H2v7h4v-7zM20 10h2v7h-4v-7zM12 5v16M8 5h8M7 22h10' },
  { name: 'desk-cable-tray', titleJa: 'ケーブルトレー・配線収納', titleEn: 'Cable tray', path: 'M2 3h20M5 3v5M19 3v5M3 9v10h18V9M6 12h12M8 12v4M12 12v4M16 12v4M8 9V7a2 2 0 0 1 4 0v2M15 9V6' },
  { name: 'desk-drawer', titleJa: '引き出し・デスク収納', titleEn: 'Desk drawer', path: 'M2 4h20v3H2zM4 7v14h16V7M4 14h16M10 10h4M10 17h4' },
  { name: 'desk-monitor-light', titleJa: 'モニターライト', titleEn: 'Monitor light', path: 'M3 3h18v3H3zM6 10H3v10h18V10h-3M12 6v4M8 7l-2 3M16 7l2 3M8 23h8M12 20v3' },
  { name: 'desk-wrist-rest', titleJa: 'リストレスト', titleEn: 'Wrist rest', path: 'M3 3h18v8H3zM6 6h2M11 6h2M16 6h2M6 9h12M5 16h14a3 3 0 0 1 3 3v2H2v-2a3 3 0 0 1 3-3z' },
  { name: 'desk-foot-rest', titleJa: 'フットレスト', titleEn: 'Footrest', path: 'M3 15l16-6 3 4-16 6zM6 19v3M19 14v8M3 22h19M8 13l2 3M12 12l2 3M16 10l2 3' },
  { name: 'desk-wagon', titleJa: 'ワゴン・ラック', titleEn: 'Desk wagon', path: 'M5 2h14v17H5zM5 8h14M5 14h14M10 5h4M10 11h4M10 17h4M7 19v1M17 19v1M5 21a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 21a2 2 0 1 0 4 0 2 2 0 1 0-4 0' },
  { name: 'desk-pegboard', titleJa: 'ペグボード・壁面収納', titleEn: 'Pegboard', path: 'M2 2h20v20H2zM6 6h.1M12 6h.1M18 6h.1M6 12h.1M18 12h.1M6 18h.1M18 18h.1M12 10v7h3' },
  { name: 'desk-keyboard-tray', titleJa: 'キーボードトレー', titleEn: 'Keyboard tray', path: 'M2 3h20v3H2zM4 6v15M20 6v15M6 11h12v6H6zM3 18h18M8 14h1M12 14h1M16 14h1' },
  { name: 'desk-speaker-stand', titleJa: 'スピーカースタンド', titleEn: 'Speaker stand', path: 'M7 2h10v13H7zM12 4v.1M9 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5 16h14M12 16v5M6 22h12' },
  { name: 'desk-cup-holder', titleJa: 'ドリンクホルダー', titleEn: 'Cup holder', path: 'M3 4h12v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM15 6h3a3 3 0 0 1 0 6h-3M2 20h15M18 17h4v5h-3M9 1v3' },
]

export function deskCategoryIcon(name: string): DeskCategoryIconChoice | undefined {
  return DESK_CATEGORY_ICONS.find((icon) => icon.name === name)
}
