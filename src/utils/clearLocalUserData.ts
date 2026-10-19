import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearPlansCache } from '../hooks/usePlans'
import { clearGadgetsCache } from '../hooks/useGadgets'
import { clearCustomCategoriesCache } from '../hooks/useCustomCategories'
import { deleteAllPlanImages } from './planImages'
import { clearSeenCache } from './bookmarkSeen'
import { clearMapLayoutCache } from './mapLayoutCache'
import { clearPrefetchedDesks } from './deskDetailPrefetch'
import { deleteAllAIConversationImages } from '../services/ai/imageService'
import { localUserDataKeys } from './localUserDataKeys'
import { clearTemplateDetailDraft } from '../store/templateDetailDraft'
import { clearFirstSetupDraftCache } from '../store/firstSetupStore'
import { invalidateLocalDataOperations, serializeLocalDataOperation } from './localDataOperation'
import { cancelPendingViewHistoryUpdates } from './viewHistory'

/**
 * ログアウト時に呼ぶ。共有端末で別アカウントにログインしたとき、
 * 前のアカウントのプラン・ガジェット・AI履歴等が残らないようにする。
 * 明示的なデータ削除では bestEffort: false を渡し、削除失敗を成功扱いにしない。
 */
export async function clearLocalUserData(options: { bestEffort?: boolean } = {}): Promise<void> {
  invalidateLocalDataOperations()
  await serializeLocalDataOperation(async () => {
    await Promise.all([clearPlansCache(), clearGadgetsCache(), clearMapLayoutCache(), clearSeenCache(), cancelPendingViewHistoryUpdates()])
    clearPrefetchedDesks()
    await clearCustomCategoriesCache()
    // 作成の機材の段の入力はメモリにしか無い。消さないと、再起動せずに次の人がログインして
    // 同じ用途で作り始めたとき、前の人の商品名・金額・持ち物の割り当てが戻る
    clearTemplateDetailDraft()
    // 実行中の書き込みが終わるまで待ち、ディスク削除の後に下書きが復活するのを防ぐ。
    await clearFirstSetupDraftCache()
    try {
      const allKeys = await AsyncStorage.getAllKeys()
      const targets = localUserDataKeys(allKeys)
      if (targets.length) await AsyncStorage.multiRemove(targets)
      await clearFirstSetupDraftCache()
    } catch (error) {
      // ベストエフォート：失敗してもログアウト自体は継続する
      if (options.bestEffort === false) throw error
    }
    // デスクの写真は AsyncStorage ではなくファイルシステム上にあるので別途消す
    await Promise.all([deleteAllPlanImages(), deleteAllAIConversationImages()])
  })
}
