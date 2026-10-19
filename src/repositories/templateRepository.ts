import { DESK_TEMPLATES } from '../constants/deskTemplates'
import { normalizeTemplate } from '../services/templateService'
import { DeskTemplate } from '../types/template'

const ACTIVE_TEMPLATE_IDS = new Set([
  'single-monitor',
  'laptop-setup',
  'dual-monitor',
  'minimal',
  'cable-focused',
])

// 一覧には並べず、決まった入口からだけ開く土台。
// 「手持ちから組む」は枠が空なので、一覧に混ぜると中身の無いカードとして並ぶ
const DIRECT_ONLY_TEMPLATE_IDS = new Set(['from-scratch'])

// ─── TemplateRepository ──────────────────────────────────────────
//
// テンプレートの取得元を差し替え可能にする Repository。
// 現在はローカル定数（公式テンプレート）のみ。将来は
// Supabase 配信・AI生成・ユーザー作成テンプレートを実装追加して
// getTemplateRepository() の返す実装を切り替える。

export interface TemplateRepository {
  /** 表示可能なテンプレート一覧（季節限定の期間フィルタ済み・表示順ソート済み） */
  list(): Promise<DeskTemplate[]>
  getById(id: string): Promise<DeskTemplate | null>
}

// 一覧・詳細のプレビューと適用結果がズレないよう、返す時点で共通ルール
// （充電器を常備・コンセント3口以上なら電源タップを常備）を適用する
class LocalTemplateRepository implements TemplateRepository {
  async list(): Promise<DeskTemplate[]> {
    const now = new Date().toISOString()
    return DESK_TEMPLATES
      .filter((t) => ACTIVE_TEMPLATE_IDS.has(t.id))
      .filter((t) => (t.availableFrom == null || t.availableFrom <= now) && (t.availableTo == null || now <= t.availableTo))
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
      .map((template) => normalizeTemplate(template))
  }

  async getById(id: string): Promise<DeskTemplate | null> {
    if (!ACTIVE_TEMPLATE_IDS.has(id) && !DIRECT_ONLY_TEMPLATE_IDS.has(id)) return null
    const t = DESK_TEMPLATES.find((x) => x.id === id)
    return t ? normalizeTemplate(t) : null
  }
}

let instance: TemplateRepository | null = null

export function getTemplateRepository(): TemplateRepository {
  if (!instance) instance = new LocalTemplateRepository()
  return instance
}
