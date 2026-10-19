import { ImageSourcePropType } from 'react-native'
import { PlanPurpose, UserGoal } from '../types'

// ─── 公式デモデスクへの入口 ──────────────────────────────────────
//
// デスクの中身そのものは公開デスク（Supabase）にあり、ここが持つのは
// 一覧カードを描くのに必要な情報だけ。タップすると公開ページを開く（見本を
// 眺めるだけで、自分のデスクにはならない）。
//
// カードの絵をアプリに同梱しているのは、初回起動でネットが無くても
// 「こういうデスクが見られる」ことだけは伝わるようにするため。
//
// deskId は scripts/publishDemoDesks.ts が公開したときの id。
// デモの中身を作り直して deskId が変わったら、ここも合わせて直す。
// 台数と金額は表示用の写しなので、中身を変えたら
// `npm run publish:demo -- --dry-run` の出力で更新する。

export interface DemoDeskLink {
  /** src/constants/demoDesks.ts の DemoDesk.id と対応 */
  id: string
  /** 公開デスクの id（PublicDesk 画面に渡す） */
  deskId: string
  nameJa: string
  nameEn: string
  summaryJa: string
  summaryEn: string
  purposes: PlanPurpose[]
  /** demoDesks.ts の同名フィールドの写し。最初に選んでもらった目的に近い順で並べるのに使う */
  goal: UserGoal
  gadgetCount: number
  totalPrice: number
  thumbnail: ImageSourcePropType
}

export const DEMO_DESK_LINKS: DemoDeskLink[] = [
  {
    id: 'demo-gaming',
    deskId: '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
    nameJa: 'ゲーミング',
    nameEn: 'Gaming',
    summaryJa: 'PC と Switch 2 が1枚のモニターを分け合う構成。映像の分かれ方を配線図で追える',
    summaryEn: 'A PC and a Switch 2 sharing one monitor. Follow how the video paths split.',
    purposes: ['gaming'],
    goal: 'desk_tour',
    gadgetCount: 11,
    totalPrice: 512579,
    thumbnail: require('../../assets/demo/gaming-generated.jpg'),
  },
  {
    id: 'demo-creator',
    deskId: '458fa607-269b-421d-a619-01375992fb97',
    nameJa: 'クリエイター',
    nameEn: 'Creator',
    summaryJa: 'Thunderbolt モニターをハブにして、ノートPCから出る線をケーブル1本にまとめた構成',
    summaryEn: 'A Thunderbolt monitor as the hub, so only one cable leaves the laptop.',
    purposes: ['creative', 'work'],
    goal: 'clean_wiring',
    gadgetCount: 9,
    totalPrice: 488710,
    thumbnail: require('../../assets/demo/creator-generated.jpg'),
  },
  {
    id: 'demo-dtm',
    deskId: 'c40c79b0-5aaa-47fb-a271-a5e45026c230',
    nameJa: '音楽・DTM',
    nameEn: 'Music & DTM',
    summaryJa: 'マイクとMIDIキーボードを小型オーディオIFにつなぐ、最小限の宅録構成',
    summaryEn: 'A minimal home-recording setup with a mic, MIDI keyboard, and compact audio interface.',
    purposes: ['music', 'creative'],
    goal: 'desk_tour',
    gadgetCount: 10,
    totalPrice: 253990,
    thumbnail: require('../../assets/demo/dtm-generated.jpg'),
  },
]
