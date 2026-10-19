import { DeskZone, GadgetCategory, PlanPurpose } from '../types'

export interface PurposeGadgetDefinition {
  category: GadgetCategory
  nameJa: string
  nameEn: string
  zone?: DeskZone
}

export const PURPOSE_GADGETS: Record<PlanPurpose, PurposeGadgetDefinition[]> = {
  gaming: [
    { category: 'Monitor', nameJa: 'ゲーミングモニター', nameEn: 'Gaming Monitor', zone: 'back_center' },
    { category: 'GameConsole', nameJa: 'ゲーム機', nameEn: 'Game Console', zone: 'back_left' },
    { category: 'Controller', nameJa: 'コントローラー', nameEn: 'Controller', zone: 'front_left' },
    { category: 'Earphone', nameJa: 'イヤホン', nameEn: 'Earphones', zone: 'desk_right' },
  ],
  work: [
    { category: 'Webcam', nameJa: 'Webカメラ', nameEn: 'Webcam', zone: 'back_center' },
    { category: 'Earphone', nameJa: 'イヤホン', nameEn: 'Earphones', zone: 'desk_right' },
  ],
  dev: [
    { category: 'Monitor', nameJa: 'サブディスプレイ', nameEn: 'Secondary Display', zone: 'back_right' },
    { category: 'Dock', nameJa: 'ドッキングステーション', nameEn: 'Docking Station', zone: 'desk_right' },
  ],
  creative: [
    { category: 'Storage', nameJa: '外付けストレージ', nameEn: 'External Storage', zone: 'desk_left' },
    { category: 'PenTablet', nameJa: 'ペンタブレット', nameEn: 'Pen Tablet', zone: 'front_left' },
    { category: 'Speaker', nameJa: 'モニタースピーカー', nameEn: 'Monitor Speaker', zone: 'back_left' },
  ],
  streaming: [
    { category: 'Webcam', nameJa: '配信用カメラ', nameEn: 'Streaming Camera', zone: 'back_center' },
    { category: 'Microphone', nameJa: '配信用マイク', nameEn: 'Streaming Microphone', zone: 'desk_right' },
    { category: 'Light', nameJa: '撮影用ライト', nameEn: 'Video Light', zone: 'desk_back' },
  ],
  study: [
    { category: 'Light', nameJa: 'デスクライト', nameEn: 'Desk Light', zone: 'desk_back' },
    { category: 'Earphone', nameJa: 'イヤホン', nameEn: 'Earphones', zone: 'desk_right' },
  ],
  music: [
    { category: 'AudioInterface', nameJa: 'オーディオインターフェース', nameEn: 'Audio Interface', zone: 'desk_left' },
    { category: 'Microphone', nameJa: '録音用マイク', nameEn: 'Recording Microphone', zone: 'desk_right' },
    { category: 'Speaker', nameJa: 'モニタースピーカー', nameEn: 'Monitor Speaker', zone: 'back_left' },
  ],
  other: [],
}
