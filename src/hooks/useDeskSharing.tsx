import { Alert } from '../utils/alert'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { PublicNameGateModal } from '../components/organisms/PublicNameGateModal'
import { PublishModal, PublishState } from '../components/organisms/PublishModal'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { usePublicNameGate } from './usePublicNameGate'
import { useGadgets } from './useGadgets'
import { usePlans } from './usePlans'
import { getPublishedDeskId, getPublishedVisibility, isOutdatedPublishState, isPhotoRevocationIncomplete, recoverPendingPublications, PlanPublishState, publishPlan, publishStateOf, PublishVisibility, setPlanVisibility, unpublishPlan } from '../services/publishService'
import { shareDesk } from '../services/shareService'
import { DeskPlan, PlanStackParamList } from '../types'
import { getPublicNickname } from '../utils/publicNickname'
import { ownShareTag } from '../utils/publicAuthor'
import { hapticError, hapticSuccess } from '../utils/haptics'
import { promptLogin } from '../utils/promptLogin'
import { promptGadgetRequired, promptPhotoRequired } from '../utils/promptPhotoRequired'
import { publishGadgetIssue, PublishGadgetIssue } from '../utils/publishRequirements'
import { PUBLISH_TIMEOUT_MS, QUICK_TIMEOUT_MS, userErrorMessage, withTimeout } from '../utils/networkError'
import { sumDeviceQuantities, sumGadgetPrices } from '../utils/gadgetStats'
import { saveFreshWiring } from '../utils/planWiring'

type ShareNavigation = Pick<NativeStackNavigationProp<Pick<PlanStackParamList, 'ProductFill' | 'AddGadget' | 'PhotoFill'>>, 'navigate' | 'isFocused'>

export function useDeskSharing({ navigation, publishStates, setPublishStates }: {
  navigation: ShareNavigation
  publishStates: Record<string, PlanPublishState>
  setPublishStates: Dispatch<SetStateAction<Record<string, PlanPublishState>>>
}) {
  const { colors, lang, fmtPrice } = useApp()
  const { user, profile } = useAuth()
  const { plans, updateWith } = usePlans()
  const { gadgets } = useGadgets()
  const sharingInFlightRef = useRef(false)
  const [sharePlan, setSharePlan] = useState<DeskPlan | null>(null)
  // 公開・再公開・公開ページの更新は、名前が決まっていない人にだけ関門を挟む。
  // 判定と入力欄は usePublicNameGate 側にあり、ここは包むだけ
  const nameGate = usePublicNameGate()
  const [publishModalVisible, setPublishModalVisible] = useState(false)
  const [publishState, setPublishState] = useState<PublishState>('idle')
  const [publishedDeskId, setPublishedDeskId] = useState<string | null>(null)
  const [publishedVisibility, setPublishedVisibility] = useState<PublishVisibility | null>(null)
  const [publishError, setPublishError] = useState('')

  // 公開の入口ごとに同じ確認をする。送り先へ移る前に公開シートを閉じる
  const promptGadgetIssue = useCallback((planId: string, issue: PublishGadgetIssue) => {
    const go = (screen: 'ProductFill' | 'AddGadget') => {
      setPublishModalVisible(false)
      navigation.navigate(screen, { planId })
    }
    promptGadgetRequired(lang, 'publish', issue, {
      fillProducts: () => go('ProductFill'),
      addGadget: () => go('AddGadget'),
    })
  }, [lang, navigation])

  const publishSharedPlan = useCallback(async (plan: DeskPlan, visibility: 'public' | 'unlisted') => {
    if (sharingInFlightRef.current) return
    if (!user) {
      promptLogin(navigation, lang, lang === 'ja' ? '公開するにはログインしてください' : 'Please log in to publish.')
      return
    }
    const gadgetIssue = publishGadgetIssue(plan, gadgets)
    if (gadgetIssue) {
      promptGadgetIssue(plan.id, gadgetIssue)
      return
    }
    if ((plan.images?.length ?? 0) < 1) {
      promptPhotoRequired(lang, 'publish', () => {
        setPublishModalVisible(false)
        navigation.navigate('PhotoFill', { planId: plan.id })
      })
      return
    }

    sharingInFlightRef.current = true
    setPublishError('')
    setPublishState('loading')
    setPublishModalVisible(true)
    try {
      // 公開の直前に読む。フォーカス時に控えておくと、読み込みが終わる前に
      // 公開した場合に空文字が渡り、名前を設定しているのに投稿者名なしで公開される
      const ownerName = await getPublicNickname()
      // 配線の作り直しはデスク画面を開いたときにしか走らない。一覧から公開するときは、
      // マイガジェット側で足したガジェット等が配線に入っていないことがあるので、ここで作り直す
      const target = (await saveFreshWiring(updateWith, plan.id, gadgets, lang)) ?? plan
      const deskId = await withTimeout(
        publishPlan(target, gadgets, user.id, target.images ?? [], { ownerName, visibility }),
        PUBLISH_TIMEOUT_MS,
      )
      setPublishedDeskId(deskId)
      setPublishedVisibility(visibility)
      // 公開しても plan.updatedAt は動かないので、状態を読み直す効果は走らない。
      // ここで書かないとカードのバッジが「未公開」のまま残る
      setPublishStates((prev) => ({ ...prev, [plan.id]: publishStateOf(visibility) }))
      hapticSuccess()
      setPublishState('done')
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(plan.id).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibility(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPublishStates((prev) => ({ ...prev, [plan.id]: publishStateOf(recovery.visibility, recovery.status !== 'recovered') }))
      }
      if (recovery?.status === 'recovered' && recovery.visibility === visibility) {
        hapticSuccess()
        setPublishState('done')
        return
      }

      setPublishError(userErrorMessage(e, lang, lang === 'ja' ? '公開できませんでした' : 'Could not publish'))
      hapticError()
      setPublishState('error')
    } finally {
      sharingInFlightRef.current = false
    }
  }, [user, gadgets, lang, navigation, updateWith, promptGadgetIssue, setPublishStates])

  const handleShare = async (plan: DeskPlan) => {
    if (sharingInFlightRef.current) return
    if (!user) {
      promptLogin(navigation, lang, lang === 'ja' ? '公開・共有するにはログインしてください' : 'Please log in to publish or share.')
      return
    }
    sharingInFlightRef.current = true
    try {
      const [deskId, visibility] = await Promise.all([
        getPublishedDeskId(plan.id).catch(() => null),
        getPublishedVisibility(plan.id).catch(() => null),
      ])
      // 公開状態を調べる間に別の画面へ移っていたら、移った先に共有シート・確認・公開シートを出さない
      if (!navigation.isFocused()) return
      setSharePlan(plan)
      setPublishedDeskId(deskId)
      setPublishedVisibility(visibility)

      // 公開ページがあれば、ほかの画面の共有アイコンと同じくそのまま公開URLを送る。
      // 見え方の切り替え・取り消しはデスク画面のフッターと「公開中のデスク」一覧で行う
      if (deskId && (visibility === 'public' || visibility === 'unlisted')) {
        const deskGadgets = gadgets.filter((g) => plan.selectedGadgetIds.includes(g.id))
        await shareDesk({
          deskId,
          deskName: plan.name,
          ownerTag: ownShareTag(profile),
          totalPrice: sumGadgetPrices(deskGadgets),
          deviceCount: sumDeviceQuantities(deskGadgets),
          photoUris: plan.images,
        }, lang).catch(() => {})
        return
      }
      const gadgetIssue = publishGadgetIssue(plan, gadgets)
      if (gadgetIssue) {
        promptGadgetIssue(plan.id, gadgetIssue)
        return
      }
      if ((plan.images?.length ?? 0) < 1) {
        promptPhotoRequired(lang, 'publish', () => navigation.navigate('PhotoFill', { planId: plan.id }))
        return
      }
      // 確認は公開シートで取る。Alert で聞いていた頃は、完成時の案内から開くシートと
      // 確認が2通りになり、何が見えるようになるかの説明も食い違っていた
      setPublishError('')
      setPublishState('idle')
      setPublishModalVisible(true)
    } finally {
      sharingInFlightRef.current = false
    }
  }

  /**
   * 公開ページをいまの内容で上書きする。
   * publishPlan は見え方を渡さなければいまの見え方（公開・URL限定）を保つが、
   * 未公開・非公開のデスクは公開してしまうので、公開中のときしか呼んではいけない。
   * 新規公開と違って publishState は動かさない。動かすと完了画面が
   * 「リンクを作成しました」に戻り、更新しただけなのに作り直したように見える。
   */
  const [updatingPublicPage, setUpdatingPublicPage] = useState(false)
  const canUpdatePublicPage = !!publishedDeskId && (publishedVisibility === 'public' || publishedVisibility === 'unlisted')
  const handleUpdatePublicPage = useCallback(async () => {
    if (!sharePlan || !user || !canUpdatePublicPage || updatingPublicPage) return
    setUpdatingPublicPage(true)
    try {
      const ownerName = await getPublicNickname()
      // 開いた時点で控えた sharePlan ではなく、配線を作り直して保存した最新の plan を公開する。
      // 配線の作り直しはデスク画面を開いたときにしか走らないので、一覧から更新するときは
      // デスク画面の外で変えた構成が配線に入っていないことがある
      const target = (await saveFreshWiring(updateWith, sharePlan.id, gadgets, lang))
        ?? plans.find((p) => p.id === sharePlan.id)
        ?? sharePlan
      await withTimeout(
        publishPlan(target, gadgets, user.id, target.images ?? [], { ownerName }),
        PUBLISH_TIMEOUT_MS,
      )
      setPublishStates((prev) => ({ ...prev, [target.id]: publishStateOf(publishedVisibility) }))
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(sharePlan.id).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibility(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPublishStates((prev) => ({ ...prev, [sharePlan.id]: publishStateOf(recovery.visibility, recovery.status !== 'recovered') }))
      }
      if (recovery?.status === 'recovered') return

      Alert.alert(
        lang === 'ja' ? 'エラー' : 'Error',
        userErrorMessage(e, lang, lang === 'ja' ? '公開ページを更新できませんでした' : 'Could not update the public page'),
      )
    } finally {
      setUpdatingPublicPage(false)
    }
  }, [sharePlan, plans, user, canUpdatePublicPage, updatingPublicPage, gadgets, lang, updateWith, publishedVisibility, setPublishStates])

  // 公開中のデスクを「公開」と「URL限定」の間で切り替える。中身は送り直さない
  const [changingVisibility, setChangingVisibility] = useState(false)
  const handleChangeVisibility = useCallback(async (next: 'public' | 'unlisted') => {
    if (!sharePlan || changingVisibility || publishedVisibility === next) return
    setChangingVisibility(true)
    try {
      await withTimeout(setPlanVisibility(sharePlan.id, next), QUICK_TIMEOUT_MS)
      setPublishedVisibility(next)
      setPublishStates((prev) => ({
        ...prev,
        [sharePlan.id]: publishStateOf(next, isOutdatedPublishState(prev[sharePlan.id] ?? 'none')),
      }))
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(sharePlan.id).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibility(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPublishStates((prev) => ({ ...prev, [sharePlan.id]: publishStateOf(recovery.visibility, recovery.status !== 'recovered') }))
      }
      if (recovery?.status === 'recovered' && recovery.visibility === next) return

      Alert.alert(
        lang === 'ja' ? '見え方を変えられませんでした' : 'Could not change visibility',
        userErrorMessage(e, lang, lang === 'ja'
          ? '通信環境を確認して、もう一度お試しください。'
          : 'Check your connection and try again.'),
      )
    } finally {
      setChangingVisibility(false)
    }
  }, [sharePlan, changingVisibility, publishedVisibility, lang, setPublishStates])

  const handleUnpublish = useCallback(async () => {
    if (!sharePlan || sharingInFlightRef.current) return
    sharingInFlightRef.current = true
    try {
      await withTimeout(unpublishPlan(sharePlan.id), QUICK_TIMEOUT_MS)
      setPublishedVisibility('private')
      setPublishStates((prev) => ({ ...prev, [sharePlan.id]: 'private' }))
      setPublishState('idle')
      setPublishModalVisible(false)
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(sharePlan.id).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibility(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPublishStates((prev) => ({ ...prev, [sharePlan.id]: publishStateOf(recovery.visibility, recovery.status !== 'recovered') }))
      }
      if (recovery?.status === 'recovered' && recovery.visibility === 'private') {
        setPublishState('idle')
        setPublishModalVisible(false)
        return
      }

      if (isPhotoRevocationIncomplete(e)) {
        setPublishedVisibility('private')
        setPublishStates((prev) => ({ ...prev, [sharePlan.id]: 'private' }))
        Alert.alert(
          lang === 'ja' ? '写真の公開停止が未完了です' : 'Photo access is not fully revoked',
          userErrorMessage(e, lang, ''),
          [
            { text: lang === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
            { text: lang === 'ja' ? '再試行' : 'Retry', onPress: () => { void handleUnpublish() } },
          ],
        )
        return
      }
      // 失敗を飲み込んで閉じると、公開されたままなのに本人は非公開にしたつもりになる。
      // 公開の取り消しは「できたつもり」がいちばん害が大きいので、成功を装わない
      Alert.alert(
        lang === 'ja' ? '公開を取り消せませんでした' : 'Could not unpublish',
        userErrorMessage(e, lang, lang === 'ja'
          ? '公開状態を確認できませんでした。通信環境を確認して、再試行してください。'
          : 'Could not confirm visibility. Check your connection and retry.'),
        [
          { text: lang === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
          { text: lang === 'ja' ? '再試行' : 'Retry', onPress: () => { void handleUnpublish() } },
        ],
      )
    } finally {
      sharingInFlightRef.current = false
    }
  }, [sharePlan, lang, setPublishStates])

  // 公開モーダルに出す台数・金額は、デスク画面（WiringResultScreen）と同じ基準で数える。
  // selectedGadgetIds をそのまま数えると削除済みガジェットのIDまで含まれ、
  // 同じデスクでも共有する画面によって台数と合計金額が食い違う
  const sharePlanGadgets = sharePlan
    ? gadgets.filter((g) => sharePlan.selectedGadgetIds.includes(g.id))
    : []

  const modals = (<>
      <PublishModal
        ownerTag={ownShareTag(profile)}
        visible={publishModalVisible}
        onClose={() => setPublishModalVisible(false)}
        state={publishState}
        error={publishError}
        deskId={publishedDeskId}
        visibility={publishedVisibility}
        deskName={sharePlan?.name ?? ''}
        gadgetCount={sumDeviceQuantities(sharePlanGadgets)}
        totalPrice={sumGadgetPrices(sharePlanGadgets)}
        photoUris={sharePlan?.images}
        colors={colors}
        lang={lang}
        fmtPrice={fmtPrice}
        onPublish={(visibility) => {
          // 開いた時点の控えではなく、押した時点の最新のデスクを公開する
          if (sharePlan) {
            const target = plans.find((p) => p.id === sharePlan.id) ?? sharePlan
            nameGate.run(() => { void publishSharedPlan(target, visibility) })
          }
        }}
        onUnpublish={handleUnpublish}
        onChangeVisibility={(next) => { void handleChangeVisibility(next) }}
        changingVisibility={changingVisibility}
        canUpdate={canUpdatePublicPage}
        updating={updatingPublicPage}
        onUpdate={() => { nameGate.run(() => { void handleUpdatePublicPage() }) }}
        outdated={!!sharePlan && isOutdatedPublishState(publishStates[sharePlan.id] ?? 'none')}
      />

      <PublicNameGateModal {...nameGate.gateProps} colors={colors} lang={lang} />

  </>)

  return { handleShare, modals, sharePlan, publishedDeskId, publishedVisibility }
}
