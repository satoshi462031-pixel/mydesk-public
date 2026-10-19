import { DeskTemplate } from '../types/template'

// ─── 公式デスクテンプレート ──────────────────────────────────────
//
// 【現状】作成は用途から作った枠（utils/deskComposition の baseCompositionPicks と用途の枠）で始まり、
// ここの一覧はユーザーには出ていない。今も開くのは from-scratch（「今の配線を整理する」）
// だけで、残りは配線レイアウトの監査（scripts/auditMapLayout.ts）が実データとして使っている。
//
// 商品情報は持たない（カテゴリ・レイアウト・推奨構成のみ）。
// テンプレートを増やすときはこの配列に追加するだけ。
// 季節限定は availableFrom / availableTo を設定する。

/** 枠なしの土台。初回の「今の配線を整理する」だけがここへ直接進む */
export const FROM_SCRATCH_TEMPLATE_ID = 'from-scratch'

export const DESK_TEMPLATES: DeskTemplate[] = [
  {
    // 初回画面の「今の配線を整理する」から直接開く枠なしの土台。
    // 既に機器を持っている人に、持っていないものが入った下書きを渡して引き算させない。
    // 枠は用途から足され、足りないぶんは詳細画面の「ジャンルを追加」で増やす。
    // テンプレート一覧には出さない（templateRepository の DIRECT_ONLY_TEMPLATE_IDS）
    id: 'from-scratch',
    nameJa: '手持ちから組む',
    nameEn: 'Start from what you own',
    descJa: 'いま使っている機材を、用途に合わせて自分で並べる',
    descEn: 'Lay out the gear you already use, guided by your purposes.',
    icon: 'toolbox-outline',
    color: '#7C3AED',
    source: 'official',
    sortOrder: 0,
    // 枠が無い状態から始まるので、充電器だけが先に置かれていると何の構成か読めない
    autoCharger: false,
    slots: [],
  },
  {
    id: 'laptop-setup',
    nameJa: 'ノートPC',
    nameEn: 'Laptop Setup',
    descJa: 'ノートPC1台を中心にしたシンプルなデスク構成。必要に応じてハブで拡張',
    descEn: 'A simple desk setup built around one laptop, with room to expand through a hub.',
    icon: 'laptop',
    color: '#2563EB',
    source: 'official',
    sortOrder: 2,
    slots: [
      // ノートPC本体が主役のテンプレートなので、配線図の中央に横長で置く
      // キーボードは内蔵済みのため外付けキーボードの枠は持たない
      { category: 'PC', zone: 'back_center', labelJa: 'ノートPC', labelEn: 'Laptop', pcFormFactor: 'laptop' },
      { category: 'Mouse', zone: 'front_right' },
      { category: 'Desk' },
      { category: 'Chair' },
      { category: 'PowerStrip', zone: 'under_desk' },
    ],
  },
  {
    id: 'single-monitor',
    nameJa: 'シングルモニター',
    nameEn: 'Single Monitor',
    descJa: 'モニター1枚の定番構成。初めてのデスクづくりにおすすめ',
    descEn: 'The classic one-monitor layout. Great for your first desk.',
    icon: 'monitor',
    color: '#16A34A',
    source: 'official',
    sortOrder: 1,
    slots: [
      { category: 'Monitor', zone: 'back_center' },
      { category: 'PC', zone: 'under_desk' },
      { category: 'Keyboard', zone: 'front_center' },
      { category: 'Mouse', zone: 'front_right' },
      { category: 'Speaker', zone: 'back_left' },
      { category: 'Light', zone: 'desk_back' },
      { category: 'Desk' },
      { category: 'Chair' },
      { category: 'PowerStrip', zone: 'under_desk' },
    ],
    wiringHints: [
      { fromSlot: 1, toSlot: 0, cableType: 'HDMI' },
      { fromSlot: 1, toSlot: 4, cableType: 'Audio3_5mm' },
    ],
  },
  {
    id: 'dual-monitor',
    nameJa: '複数モニター',
    nameEn: 'Multiple Monitors',
    descJa: 'モニター2枚以上で作業領域を拡大。仕事にも趣味にも万能な人気構成',
    descEn: 'Two or more monitors for more workspace. A popular all-round layout.',
    icon: 'monitor-multiple',
    color: '#EA580C',
    source: 'official',
    popularity: 100,
    sortOrder: 3,
    slots: [
      { category: 'Monitor', count: 2, zone: 'back_center' },
      { category: 'Keyboard', zone: 'front_center' },
      { category: 'Mouse', zone: 'front_right' },
      { category: 'Speaker', zone: 'back_left' },
      { category: 'PC', zone: 'under_desk' },
      { category: 'Light', zone: 'desk_back' },
      { category: 'Desk' },
      { category: 'Chair' },
      { category: 'PowerStrip', zone: 'under_desk' },
    ],
    wiringHints: [
      { fromSlot: 4, toSlot: 0, cableType: 'HDMI' },
      { fromSlot: 4, toSlot: 3, cableType: 'Audio3_5mm' },
    ],
  },
  {
    id: 'minimal',
    nameJa: 'ミニマル',
    nameEn: 'Minimal Desk',
    descJa: '必要最小限だけを置くシンプル構成。机の上を広く使いたい人へ',
    descEn: 'Only the essentials. For those who want a clear desk surface.',
    icon: 'leaf',
    color: '#0D9488',
    source: 'official',
    sortOrder: 5,
    autoCharger: false,
    slots: [
      // キーボードは内蔵済みのため外付けキーボードの枠は持たない
      { category: 'PC', zone: 'desk_left', labelJa: 'ノートPC', labelEn: 'Laptop', pcFormFactor: 'laptop' },
      { category: 'Mouse', zone: 'front_right' },
      { category: 'Desk' },
      { category: 'Chair' },
    ],
  },
  {
    id: 'cable-focused',
    nameJa: '配線すっきり',
    nameEn: 'Cable Management',
    descJa: '電源タップも充電器もデスク下へ。配線経路を最初から設計して、見えるケーブルを減らす構成',
    descEn: 'Power strip and chargers go under the desk. Plan the routes first and keep cables out of sight.',
    icon: 'cable-data',
    color: '#FFD21A',
    source: 'official',
    sortOrder: 6,
    slots: [
      { category: 'Monitor', zone: 'back_center' },
      { category: 'PC', zone: 'under_desk' },
      { category: 'PowerStrip', zone: 'under_desk' },
      { category: 'Charger', zone: 'under_desk', labelJa: '充電ステーション', labelEn: 'Charging Station' },
      { category: 'Keyboard', zone: 'front_center' },
      { category: 'Mouse', zone: 'front_right' },
      { category: 'Desk' },
      { category: 'Chair' },
    ],
    wiringHints: [
      { fromSlot: 2, toSlot: 1, cableType: 'Power' },
      { fromSlot: 2, toSlot: 3, cableType: 'Power' },
    ],
  },
]
