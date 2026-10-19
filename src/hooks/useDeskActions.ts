import { Alert } from '../utils/alert'
// デスク1件に対する持ち主の操作（複製・削除・ピン留め・名前の変更）。
//
// マイデスクの一覧とマイページのデスクタブの2か所から呼ぶ。削除は公開の解除・Undo・
// 期限後の写真と公開データの後始末までが1つの手順で、画面ごとに書くと片方だけ
// 後始末が抜けて、端末に写真が残る・公開ページだけ残る、が起きる。
import { useCallback, useEffect, useRef } from 'react'

import 'react-native-get-random-values'
import { v4 as uuidv4 } from 'uuid'
import { useApp } from '../context/AppContext'
import { openPaywall } from '../navigation/rootNavigation'
import { analytics, EVENTS, trackLimitHit } from '../services/analytics'
import { cancelDeskCleanup, queueDeskCleanup, resumePendingDeskCleanups, runDeskCleanup } from '../services/deskDeletionCleanup'
import { sweepUnreferencedPlanImages } from '../services/planImageSweep'
import { republishPlan, unpublishPlan } from '../services/publishService'
import { clearFirstSetupDraft, FirstSetupDraft, loadFirstSetupDraft, saveFirstSetupDraft } from '../store/firstSetupStore'
import { clearTemplateDetailDraft, peekTemplateDetailDraft, saveTemplateDetailDraft } from '../store/templateDetailDraft'
import { getPlanById } from '../store/planStore'
import { DeskPlan, Gadget } from '../types'
import { DESK_NAME_MAX } from '../utils/deskAutoName'
import { hapticWarning } from '../utils/haptics'
import { orphanPlaceholders } from '../utils/placeholderCleanup'
import { duplicatePlanSlots } from '../utils/planDuplicate'
import { duplicatePlanImages } from '../utils/planImages'
import { trimAndTruncate } from '../utils/truncateText'
import { useEntitlement } from './useEntitlement'
import { useGadgets } from './useGadgets'
import { flushPlanPersistence, usePlans } from './usePlans'
import { useUndoSnackbar } from './useUndoSnackbar'
import { useDeskSetupGuard } from './useDeskSetupGuard'

// 写真の掃除は端末の保存値を全部読むので、起動ごとに1回だけ
let planImagesSwept = false

class DeskRecoveryError extends Error {
  constructor(readonly retry: () => Promise<void>) {
    super('DESK_DELETE_RECOVERY_FAILED')
  }
}

export function useDeskActions({
  navigation, limitPlacement, onBeforeAction, onDeleted, onSetupDraftCleared, removeWithMotion,
}: {
  navigation: Parameters<typeof openPaywall>[0] & { isFocused: () => boolean }
  /** 上限に当たったときの計測に載せる、どの画面から複製しようとしたか */
  limitPlacement: string
  /** 操作の直前に呼ぶ（スワイプで開いた行を閉じる等） */
  onBeforeAction?: (planId: string) => void
  /** 一覧から消えたあとに呼ぶ（行ごとに持っている参照の片付け） */
  onDeleted?: (planId: string) => void
  /** 作成途中のデスクを削除して、再開位置も片付けたとき */
  onSetupDraftCleared?: () => void
  removeWithMotion?: (id: string, operation: () => Promise<void>) => Promise<unknown>
}) {
  const { t, lang } = useApp()
  const { plans, add, restore, remove, togglePinned, updateWith } = usePlans()
  const { gadgets, addMany: addGadgets, restoreMany: restoreGadgets, removeMany: removeGadgets } = useGadgets()
  const { checkLimit, getLimit } = useEntitlement()
  const undoSnackbar = useUndoSnackbar()
  const ensureNoUnfinishedSetup = useDeskSetupGuard(navigation)
  const duplicatingPlanIdsRef = useRef(new Set<string>())
  const deletingPlanIdsRef = useRef(new Set<string>())

  useEffect(() => {
    void resumePendingDeskCleanups().catch(() => {}).then(() => {
      if (planImagesSwept) return
      planImagesSwept = true
      return sweepUnreferencedPlanImages()
    }).catch(() => {})
  }, [])

  // 上限は「自分で作ったデスク」だけで数える。共有デスクを取り込んだぶんで作れなくならないように
  const ownPlanCount = plans.filter((p) => !p.isShared).length

  const duplicate = useCallback(async (plan: DeskPlan) => {
    if (duplicatingPlanIdsRef.current.has(plan.id)) return
    onBeforeAction?.(plan.id)
    duplicatingPlanIdsRef.current.add(plan.id)
    try {
      if (!await ensureNoUnfinishedSetup()) return
      // 確認を待つ間に別の画面へ移っていたら、離れた先に課金画面を出さない
      if (!navigation.isFocused()) return
      // 複製もデスクが1つ増えるので、新規作成と同じ上限チェックを通す
      if (!checkLimit('maxWiringPlans', ownPlanCount)) {
        trackLimitHit('maxWiringPlans', { current: ownPlanCount, max: getLimit('maxWiringPlans'), placement: limitPlacement })
        openPaywall(navigation, 'maxWiringPlans')
        return
      }
      const newId = uuidv4()
      // 枠だけは複製先の専用に作り直す（utils/planDuplicate.ts）。共有したままだと、
      // 複製先で商品を埋めたときに複製元の枠まで同じ商品になる
      const { plan: source, slots } = duplicatePlanSlots(plan, gadgets, uuidv4)
      const newPlan: DeskPlan = {
        ...source,
        id: newId,
        name: trimAndTruncate(lang === 'ja' ? `${plan.name}のコピー` : `${plan.name} (copy)`, 30),
        // 写真は実ファイルごと複製する。URI をそのままコピーすると、複製側で写真を
        // 削除したときに実体が消え、元のプランの写真まで壊れてしまう
        images: [],
        isShared: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await add(newPlan, async () => {
        newPlan.images = await duplicatePlanImages(plan.images ?? [], newId)
        if (slots.length > 0) await addGadgets(slots)
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'DESK_SETUP_IN_PROGRESS') {
        Alert.alert(lang === 'ja' ? '作成途中のデスクがあります' : 'You have an unfinished desk',
          lang === 'ja' ? 'マイデスクから作成を続けるか、途中のデスクを破棄してください。' : 'Continue or discard the unfinished desk in My Desks.')
      } else if (error instanceof Error && error.message === 'DESK_ENTITLEMENT_PENDING') {
        Alert.alert(lang === 'ja' ? 'プランを確認中です' : 'Checking your plan',
          lang === 'ja' ? '確認が終わってから、もう一度お試しください。' : 'Please try again after the check finishes.')
      } else if (error instanceof Error && error.message === 'DESK_LIMIT_REACHED') {
        trackLimitHit('maxWiringPlans', { current: ownPlanCount, max: getLimit('maxWiringPlans'), placement: limitPlacement })
        if (navigation.isFocused()) openPaywall(navigation, 'maxWiringPlans')
      } else {
        analytics.error('duplicate_desk', error)
        Alert.alert(lang === 'ja' ? 'デスクを複製できませんでした' : 'Could not duplicate desk')
      }
    } finally {
      duplicatingPlanIdsRef.current.delete(plan.id)
    }
  }, [add, addGadgets, checkLimit, ensureNoUnfinishedSetup, gadgets, getLimit, lang, limitPlacement, navigation, onBeforeAction, ownPlanCount])

  const togglePin = useCallback((plan: DeskPlan) => {
    onBeforeAction?.(plan.id)
    return togglePinned(plan.id).then(() => true, () => {
      Alert.alert(lang === 'ja' ? 'ピン留めを変更できませんでした' : 'Could not update pin')
      return false
    })
  }, [lang, onBeforeAction, togglePinned])

  // 名前は任意。空で確定したら自動の名前（autoName）に戻す
  const rename = useCallback((plan: DeskPlan, newName: string, autoName: string) => {
    const name = trimAndTruncate(newName, DESK_NAME_MAX) || autoName
    if (name === plan.name) return
    // update() で丸ごと上書きすると、裏で走っている保存を後勝ちで消す（usePlans の注記参照）
    void updateWith(plan.id, (prev) => ({ ...prev, name, updatedAt: new Date().toISOString() }))
  }, [updateWith])

  // ─── 削除（確認 + Undo）──────────────────────────────────────────
  // プランは配線・配置・写真を抱えるため、ガジェット以上に誤削除の損害が大きい。
  // 確認ダイアログを必ず挟み、削除後も5秒間は元に戻せるようにする。
  const doDelete = useCallback(async (plan: DeskPlan, gadgetsToDelete: Gadget[] = []) => {
    // 一覧は端末内データなので先に消す。公開解除の通信を待ってから消すと、
    // タップ後も数秒残り、操作が効かなかったように見える。
    if (removeWithMotion) await removeWithMotion(plan.id, () => remove(plan.id))
    else await remove(plan.id)
    let removedGadgets = false
    let wasPublic = false
    let previousVisibility: 'public' | 'unlisted' | 'private' = 'public'
    let restoredPlan = plan
    try {
      if (gadgetsToDelete.length > 0) {
        // まだ5秒間は取り消せるので、削除イベントはここでは送らない（下の onExpire で送る）
        await removeGadgets(gadgetsToDelete.map((g) => g.id), { track: false })
        removedGadgets = true
      }
      // 公開解除に失敗した場合は下で端末内データを自動復元し、
      // 公開ページだけ残したまま削除済みになる状態を作らない。
      wasPublic = await unpublishPlan(plan.id, (visibility, photoUrls) => {
        previousVisibility = visibility
        restoredPlan = { ...plan, images: plan.images?.map((uri) => photoUrls.get(uri) ?? uri) }
      })
    } catch (error) {
      let recovering = false
      const recover = async () => {
        if (recovering) return
        recovering = true
        // 一方の保存失敗で、もう一方の復旧まで飛ばさない。
        try {
          const results = await Promise.allSettled([
            removedGadgets ? restoreGadgets(gadgetsToDelete) : Promise.resolve(),
            restore(plan),
          ])
          const failure = results.find((result) => result.status === 'rejected')
          if (failure?.status === 'rejected') {
            analytics.error('restore_after_delete_failed', failure.reason)
            throw new DeskRecoveryError(recover)
          }
        } finally {
          recovering = false
        }
      }
      await recover()
      throw error
    }
    onDeleted?.(plan.id)
    // 期限前にアプリを終了されても、次に開いたときに後始末をやり直せるように控える
    await queueDeskCleanup(plan.id, plan.images ?? []).catch(() => {})
    const n = gadgetsToDelete.length
    hapticWarning()
    undoSnackbar.showUndo({
      message: lang === 'ja'
        ? (n > 0 ? `「${plan.name}」とガジェット${n}個を削除しました` : `「${plan.name}」を削除しました`)
        : (n > 0 ? `Deleted "${plan.name}" and ${n} gadget${n === 1 ? '' : 's'}` : `Deleted "${plan.name}"`),
      onUndo: async () => {
        await restoreGadgets(gadgetsToDelete)
        await restore(restoredPlan)
        await cancelDeskCleanup(plan.id).catch(() => {})
        if (wasPublic) {
          try {
            await republishPlan(plan.id, previousVisibility === 'unlisted' ? 'unlisted' : 'public')
          } catch (error) {
            analytics.error('republish_after_delete_undo', error)
            Alert.alert(
              lang === 'ja' ? 'デスクを非公開で復元しました' : 'Desk restored privately',
              lang === 'ja'
                ? 'デスクは元に戻りましたが、再公開に失敗しました。通信環境を確認して公開し直してください。'
                : 'The desk was restored, but could not be republished. Check your connection and publish it again.',
            )
          }
        }
      },
      // 写真の実ファイルは Undo 期限が切れてから消す。ここで即座に消すと
      // Undo で復元したプランのサムネイル・写真が全滅する。
      // 逆に消さないと、参照されない写真が端末に残り続ける。
      // 永続化に失敗して usePlans がロールバックした場合はプランが復活しているので、
      // 保存済みデータを確認してから消す（写真だけ消えたプランを作らない）
      onExpire: async () => {
        // 保存はメモリが先・ディスクが後。書き終わる前に読むと、消したはずのデスクがまだ残って見え、
        // 公開ページ・写真の後始末ごと飛ばす。受け付け済みの保存（失敗時の巻き戻しを含む）を待ってから読む
        await flushPlanPersistence()
        // 読めなかっただけの場合は「残っている」側に倒す。写真を消してしまうと戻せない
        if (await getPlanById(plan.id).catch(() => plan)) return
        // 取り消されずに確定した。削除の計測はここで初めて送る
        analytics.track(EVENTS.DESK_DELETED)
        if (gadgetsToDelete.length > 0) {
          analytics.track(EVENTS.GADGET_DELETED, { deleted_count: gadgetsToDelete.length, bulk: true })
        }
        try {
          await Promise.all([
            // 失敗したら控えが残り、次に一覧を開いたときにやり直す
            runDeskCleanup(plan.id, plan.images ?? []),
            // 作成途中のデスクを削除した場合だけ再開位置も片付ける。
            // Undo 中は残しておき、元に戻せば同じ段階から続けられるようにする。
            loadFirstSetupDraft().then((draft) => {
              if (!draft || !('planId' in draft) || draft.planId !== plan.id) return
              onSetupDraftCleared?.()
              return clearFirstSetupDraft()
            }),
          ])
        } catch (error) {
          analytics.error('delete_published_desk', error)
          Alert.alert(
            lang === 'ja' ? '公開データを削除できませんでした' : 'Could not delete published data',
            lang === 'ja'
              ? 'デスクは非公開になっています。通信環境を確認し、問題が続く場合はマイページの「設定」→「ヘルプ・使い方」からお問い合わせください。'
              : 'The desk is private. Check your connection. If the problem continues, contact us from Settings > Help & Guides on My Page.',
          )
        }
      },
    })
  }, [lang, onDeleted, onSetupDraftCleared, remove, removeGadgets, restore, restoreGadgets, undoSnackbar, removeWithMotion])

  // タップ直後に一覧から消す。サーバー通信は doDelete 内で後から行い、失敗時だけ復元する。
  const startDelete = useCallback((plan: DeskPlan, gadgetsToDelete: Gadget[]) => {
    if (deletingPlanIdsRef.current.has(plan.id)) return
    deletingPlanIdsRef.current.add(plan.id)
    const handleFailure = (error: unknown) => {
      const recoveryFailed = error instanceof DeskRecoveryError
      analytics.error('unpublish_before_delete', error)
      Alert.alert(
        recoveryFailed
          ? (lang === 'ja' ? '元に戻せませんでした' : 'Could not restore desk')
          : (lang === 'ja' ? '削除できませんでした' : 'Could not delete desk'),
        recoveryFailed
          ? (lang === 'ja'
              ? '削除に失敗した後の復旧を完了できませんでした。通信環境や端末の空き容量を確認して、もう一度お試しください。'
              : 'Recovery after the failed deletion could not finish. Check your connection and available storage, then try again.')
          : (lang === 'ja'
              ? '削除を完了できませんでした。デスクの状態と通信環境を確認して、もう一度お試しください。'
              : 'Deletion could not finish. Check the desk and your connection, then try again.'),
        recoveryFailed ? [
          { text: lang === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
          { text: lang === 'ja' ? 'もう一度試す' : 'Try again', onPress: () => { void error.retry().catch(handleFailure) } },
        ] : undefined,
      )
    }
    void doDelete(plan, gadgetsToDelete)
      .catch(handleFailure)
      .finally(() => {
        deletingPlanIdsRef.current.delete(plan.id)
      })
  }, [doDelete, lang])

  // このデスクでしか使っていない「未記入の枠」。テンプレートを当てたときに作られ、
  // 商品名が入らないまま残っているもので、デスクが消えれば行き場が無い
  const orphanPlaceholdersOf = useCallback((plan: DeskPlan) => orphanPlaceholders(plan, gadgets, plans), [gadgets, plans])

  const confirmDelete = useCallback((plan: DeskPlan) => {
    onBeforeAction?.(plan.id)
    Alert.alert(
      t('common.delete'),
      lang === 'ja'
        ? `「${plan.name}」を削除すると、公開中の場合は公開も解除されます。ガジェットは機材一覧に残りますが、このデスクでの在籍履歴はデスクごと消えます。5秒以内ならデスク・履歴・公開状態を元に戻せます。5秒後に公開データと写真も完全に削除されます。`
        : `Deleting "${plan.name}" also unpublishes it if it is public. Your gadgets stay in your library, but their history on this desk goes with it. The desk, history, and public status can be restored within 5 seconds. After that, its published data and photos are permanently deleted.`,
      [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        // ガジェットの去就は聞かない。デスクを1つ畳むことと、その機材を
        // 持っていないことは別で、たいていまだ手元にある。消したいなら
        // ガジェット詳細の一番下から個別に消せる。
        // ただしテンプレートが作った未記入の枠だけは、このデスクのためだけに
        // 存在していたものなので一緒に片付ける（残すとライブラリが枠で埋まる）
        onPress: () => startDelete(plan, orphanPlaceholdersOf(plan)),
      },
      ],
    )
  }, [lang, onBeforeAction, orphanPlaceholdersOf, startDelete, t])

  const confirmDiscardSetup = useCallback((draft: FirstSetupDraft, onChange: (draft: FirstSetupDraft | null) => void) => {
    Alert.alert(
      lang === 'ja' ? '作成途中の内容を破棄しますか？' : 'Discard unfinished setup?',
      lang === 'ja'
        ? '選んだ用途と、まだ作成していない機材の設定が消えます。5秒以内なら元に戻せます。'
        : 'Your selected purpose and unsaved gear settings will be removed. You can undo this within 5 seconds.',
      [
        { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: lang === 'ja' ? '破棄する' : 'Discard',
          style: 'destructive',
          onPress: () => {
            const discard = () => {
              const templateDraft = peekTemplateDetailDraft()
              clearTemplateDetailDraft()
              onChange(null)
              void clearFirstSetupDraft().catch(() => {})
              hapticWarning()
              undoSnackbar.showUndo({
                message: lang === 'ja' ? '作成途中のデスクを破棄しました' : 'Discarded the unfinished desk',
                onUndo: async () => {
                  if (templateDraft) saveTemplateDetailDraft(templateDraft)
                  await saveFirstSetupDraft(draft)
                  onChange(draft)
                },
              })
            }
            if (removeWithMotion) void removeWithMotion('first-setup-draft', async () => discard())
              .catch(() => Alert.alert(lang === 'ja' ? '破棄できませんでした' : 'Could not discard'))
            else discard()
          },
        },
      ],
    )
  }, [lang, undoSnackbar, removeWithMotion])

  return { duplicate, togglePin, rename, confirmDelete, confirmDiscardSetup, undoSnackbar }
}
