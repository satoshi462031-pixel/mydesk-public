import { memo, useMemo, useState } from 'react'
import { GestureResponderEvent, LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { ClapBurst } from '../atoms/ClapBurst'
import { ClapMark } from '../atoms/ClapMark'
import { RollingCount } from '../atoms/RollingCount'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { AuthorAvatar } from '../atoms/AuthorAvatar'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { RemoteThumb } from '../atoms/RemoteThumb'
import { PublishBadge } from './PublishBadge'
import { categoryIconColor, ICONS, MCIconName } from '../../constants/icons'
import { PRESS_INTERACTION, UI_METRICS } from '../../constants/ui'
import { AppColors, useApp } from '../../context/AppContext'
import { PURPOSE_DEFS, purposeIconColor, purposeLabel, purposeTintColor } from '../../screens/PurposeSelectionScreen'
import { PlanPurpose } from '../../types'
import { DeskChange, DeskChangeKind } from '../../utils/deskChangeSummary'
import { PlanPublishState } from '../../services/publishService'
import { publicAuthorParts } from '../../utils/publicAuthor'
import { useLongPressGuard } from '../../hooks/useLongPressGuard'
import { useCoachTarget } from '../../hooks/useCoachMarks'
import { formatDate } from '../../utils/dateFormat'

// ─── デスク1件のカード ──────────────────────────────────────────────
// マイページの3タブ・みんなのデスク・いずれ作る公開プロフィールで同じ部品を並べる。
//
// マイデスク・投稿・更新一覧は1列で詳細まで見せる。みんなのデスクといいね・保存は
// compact を使い、WEAR型の2列グリッドとして写真・タイトル・更新日だけを見せる
// （探す一覧は読む場所ではなく、写真で選ぶ場所）。
//
// 投稿者と用途は写真の下辺に重ねる。本文側に置くと、写真・名前・タイトル・更新日・
// 変更点で5段になってタイル1件が画面の高さを越える。用途はアイコンだけで出す
// （文字にすると ja/en で幅が変わって高さがずれる）。

/** 折りたたむ前に見せる件数。3件目からは畳む */
const CHANGE_PREVIEW_COUNT = 2
const PHOTO_ACTION_BG = 'rgba(0,0,0,0.72)'
const PHOTO_ACTION_BORDER = 'rgba(255,255,255,0.48)'
// 暗い丸の上でも 3:1 を保つ明るい青（テーマの saved はライトだと濃く、暗い丸に沈む）
const PHOTO_SAVED_ICON = '#1D9BF0'

// 本文の余白（styles.body / compactBody / wideBody の padding）と同じ幅
const LEAD_SLOP = { top: 12, bottom: 12, left: 14, right: 14 }
const LEAD_SLOP_COMPACT = { top: 9, bottom: 9, left: 9, right: 9 }
const LEAD_SLOP_WIDE = { top: 10, bottom: 10, left: 12 }
// 変更点の欄は本文の最後の段なので、左右と下の余白まで広げる（下に「続き」があればそちらが先に受ける）
const CHANGE_SLOP = { bottom: 12, left: 14, right: 14 }
const CHANGE_SLOP_WIDE = { bottom: 10, left: 12, right: 12 }

const CHANGE_MARK: Record<DeskChangeKind, MCIconName> = {
  swap: 'swap-horizontal',
  added: 'plus',
  removed: 'minus',
}

// **props はすべてプリミティブか、呼び出し側で useCallback した関数にする。**
// memo で包んでいても、`action={{...}}` のようなオブジェクトリテラルや
// `onPress={() => open(item.id)}` のインライン関数を渡すと毎回参照が変わり、
// リストの1件が動いただけで全件が描き直される。ハンドラが id を受け取る形に
// してあるのはそのため（呼び出し側が行ごとにクロージャを作らなくて済む）。
interface Props {
  /** ハンドラへ渡す識別子。デスクなら deskId / planId */
  id: string
  title: string
  photoUri?: string | null
  purposes?: PlanPurpose[]
  /** 更新日など、タイトルの下に出す1行 */
  meta?: string | null
  /** カード右下に出すデスクの更新日時 */
  updatedAt?: string
  /**
   * 公開の状態。自分のデスクを並べる一覧だけで渡す。デスク一覧・デスク画面と
   * 同じ PublishBadge を出す。meta の文字に混ぜると更新日と同じ淡色の1行へ埋もれ、
   * スクロール中に公開中のデスクを拾えない。写真の左上は更新マークが座っているので横。
   */
  publishState?: PlanPublishState
  /** 写真の下辺に重ねる投稿者。自分のデスクしか並ばない一覧では省く */
  authorName?: string | null
  authorTag?: string | null
  authorAvatarUrl?: string | null
  /**
   * 写真の左上に出す更新マーク（例「機材更新 3日前」）。出さないときは null。
   * 右上は操作ボタンが座ることがあるので左上に置く。
   * 色だけで伝えないようアイコンと文字を両方入れる（VoiceOver もこの文字を読む）
   */
  updatedLabel?: string | null
  /** 更新マークの絵。既定は更新（autorenew）。新着は別の絵にする */
  updatedIcon?: MCIconName
  /**
   * 更新マークを絵だけにする（文字は読み上げにだけ使う）。ピン留めのように、
   * 絵だけで意味が通り、並び順でも伝わっているものに限る
   */
  updatedIconOnly?: boolean
  /**
   * 最後に何が変わったか。値段の高い順に上位2件だけ開いた状態で出し、残りは畳む。
   * 商品写真が引けるようになったら、行頭のカテゴリアイコンだけ差し替える
   */
  change?: DeskChange[]
  lang: 'ja' | 'en'
  fmtPrice: (n: number | null | undefined) => string
  colors: AppColors
  isDark: boolean
  onPress: (id: string) => void
  onLongPress?: (id: string) => void
  /** タイル右上の丸ボタン（いいね解除・保存解除・操作） */
  actionIcon?: MCIconName
  actionLabel?: string
  actionDisabled?: boolean
  /** saved は保存のブックマーク。白ではなく青で描き、保存中であることを色でも見せる */
  actionTone?: 'default' | 'saved'
  onAction?: (id: string) => void
  /**
   * タイル右上の「…」。スワイプと長押しにしか無かった操作（名前を変更・ピン留め・
   * 複製・削除）を、押して見つけられる場所にも置くためのもの。
   * 見る側の一覧では使わないので任意。
   */
  menuLabel?: string
  onMenu?: (id: string) => void
  /** 写真の下辺右端の拍手（みんなのデスク用。内部名は旧称の like のまま） */
  liked?: boolean
  /** 拍手の横に出す件数（累計）。未取得（undefined）と 0 のときは出さない */
  likeCount?: number
  likeLabel?: string
  onToggleLike?: (id: string, onClap: () => void) => void
  /** いいね・保存の2列グリッド用。写真と要点だけに絞る */
  compact?: boolean
  /**
   * 発見用一覧の情報順。投稿者を写真から外し、デスク名・用途の後へ置く。
   * compact を使う保存一覧などの見た目は変えず、みんなのデスクだけで使う。
   */
  discoveryOrder?: boolean
  /**
   * 写真を 16:9 にする（マイデスク用）。自分のデスクは写真を見比べるより選んで開く一覧なので、
   * タイルを低くして一度に見えるデスクを増やす。開いた先の写真（DeskPhotoCarousel）とも同じ比率になる
   */
  widePhoto?: boolean
  /** 作成途中のデスクで写真の左上に出す再開ボタン */
  footerLabel?: string
  footerCreatedAt?: string
  onFooter?: (id: string) => void
  /** 「？」の吹き出しで指す部品の名前の頭。一覧の先頭のタイルにだけ渡す */
  coachKey?: string
}

function DeskGridTileBase({
  id, title, photoUri, purposes, meta: metaProp, updatedAt, publishState, authorName, authorTag, authorAvatarUrl, updatedLabel, updatedIcon = 'autorenew', updatedIconOnly = false, change,
  lang, fmtPrice, colors: C, isDark, onPress, onLongPress,
  actionIcon, actionLabel, actionDisabled, actionTone = 'default', onAction,
  menuLabel, onMenu,
  liked, likeCount, likeLabel, onToggleLike, compact = false, discoveryOrder = false, widePhoto = false,
  footerLabel, footerCreatedAt, onFooter, coachKey,
}: Props) {
  const { reduceMotion } = useApp()
  const actionTarget = useCoachTarget(coachKey && `${coachKey}-action`)
  const publishTarget = useCoachTarget(coachKey && `${coachKey}-publish`)
  const clapTarget = useCoachTarget(coachKey && `${coachKey}-clap`)
  const purposeTarget = useCoachTarget(coachKey && `${coachKey}-purposes`)
  const updateTarget = useCoachTarget(coachKey && `${coachKey}-update`)
  const ja = lang === 'ja'
  const informationBadge = updatedIcon === 'autorenew' || updatedIcon === 'star-four-points'
  // 発見順の一覧では、新着・更新を写真の上ではなく投稿者名と時刻の行に文字で出す。
  // 写真の右上の赤い点だった頃は、公開直後の一覧でほぼ全部のタイルに点が付いて模様になり、
  // 新着と更新の区別も付かなかった。赤は「見に行く先がある」タブとベルの点にだけ残す。
  // （写真の左上の文字の札は柄に紛れて見落とされたので、写真の外の文字の行へ出す）
  const discoveryShowsUpdate = discoveryOrder && informationBadge && !!updatedLabel
  const createdDate = footerCreatedAt ? new Date(footerCreatedAt) : null
  const footerCreatedDate = createdDate && !Number.isNaN(createdDate.getTime()) ? formatDate(createdDate, lang) : ''
  // 作成途中のカードは、他のカードが更新日を出している右下に作成日を出す（ボタンの中に入れると他と位置が揃わない）
  const meta = footerCreatedDate ? `${ja ? '作成日' : 'Created'} ${footerCreatedDate}` : metaProp
  const [expanded, setExpanded] = useState(false)
  const showLikeCount = likeCount !== undefined && likeCount > 0
  const guardedPress = useLongPressGuard<GestureResponderEvent>(
    () => onPress(id),
    onLongPress ? () => onLongPress(id) : undefined,
  )
  // discoveryOrder（みんなのデスク）では写真の右下に、暗い地の丸として重ねる。件数は丸の中に入れず
  // 用途アイコンの段の右端に出す（横長に伸びると写真の角を食い、丸の大きさもカードごとに揃わない）。
  // 写真の上では白を使い、拍手済みは手だけ黄色にする。
  const onPhoto = discoveryOrder
  const likeTint = onPhoto ? '#FFFFFF' : C.textMuted
  const [clapBurstKey, setClapBurstKey] = useState(0)
  const clapIconSize = compact ? 17 : 20
  const clapMarkSize = compact ? 24 : 28
  const likeButton = onToggleLike ? (
    <TouchableOpacity
      style={[styles.likeBtn, onPhoto && styles.discoveryLikeBtn]}
      onPress={() => {
        onToggleLike(id, () => setClapBurstKey((key) => key + 1))
      }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!liked }}
      accessibilityLabel={likeLabel}
    >
      {onPhoto ? (
        <ClapBurst clapped={!!liked} burstKey={clapBurstKey} size={clapIconSize}>
          <AppIcon name={ICONS.clap} size={clapIconSize} color={liked ? C.onClap : likeTint} />
        </ClapBurst>
      ) : (
        <ClapBurst clapped={!!liked} burstKey={clapBurstKey} size={clapMarkSize}>
          <ClapMark clapped={!!liked} diameter={clapMarkSize} color={C.textMuted} />
        </ClapBurst>
      )}
      {showLikeCount && !onPhoto && (
        <RollingCount value={likeCount ?? 0} style={[styles.likeCount, { color: likeTint }]} />
      )}
    </TouchableOpacity>
  ) : null

  // 強い順（入れ替え→追加→撤去）ではなく値段順。畳んだ2件に何が残るかを決めるのは
  // 出来事の強さではなく、そのデスクで何にお金がかかったか
  const changes = useMemo(
    () => [...(change ?? [])].sort((a, b) => (b.price ?? 0) - (a.price ?? 0)),
    [change],
  )
  const shownChanges = expanded ? changes : changes.slice(0, CHANGE_PREVIEW_COUNT)
  const hiddenCount = changes.length - shownChanges.length
  const collapsible = changes.length > CHANGE_PREVIEW_COUNT

  // 写真が無いと 4:3 がまるごと空く。空箱を積むと「公開していない」ではなく
  // 「壊れている」ように見えるので高さを詰める。
  // 自分のデスク一覧（widePhoto）は詰めない。写真の有無でタイルの高さが揃わず、
  // 一覧の並びががたつく
  const flat = !compact && !widePhoto && !photoUri

  // @ID はプロフィールを特定するための情報で、投稿カードには重ねない。
  // WEAR と同じく、一覧では表示名だけを出して写真と投稿内容を主役にする。
  const authorParts = publicAuthorParts(authorName, authorTag)
  // 名前が未設定の人だけ @ID に落ちる。両方空にすると、誰の投稿かを示すものが
  // アバターの色しか残らない
  const authorLabel = authorParts.name || authorParts.tag
  // 用途は全部選べるが、タイルの幅に並ぶのは compact で3つ・通常で4つまで。
  // 超えた分を黙って切ると、選んだ用途が消えたように見えるので最後の枠を「+N」にする
  const knownPurposes = (purposes ?? []).filter((p) => PURPOSE_DEFS.some((d) => d.key === p))
  const purposeSlots = compact ? 3 : 4
  const shownPurposes = knownPurposes.length > purposeSlots ? knownPurposes.slice(0, purposeSlots - 1) : knownPurposes
  const hiddenPurposes = knownPurposes.slice(shownPurposes.length)

  return (
    <View style={[styles.tile, compact && styles.compactTile, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* 読み込み前の下地。写真が幅いっぱい・4:3 になったぶん、素の背景が
          そのまま見えると white / true black が一瞬抜けて目立つ */}
      <View
        style={[
          styles.photoWrap,
          compact ? styles.compactPhotoWrap : flat ? styles.flatPhotoWrap : widePhoto ? styles.photoWrap169 : styles.photoWrap43,
          { backgroundColor: C.chip },
        ]}
      >
        <TouchableOpacity
          style={styles.photoPress}
          onPressIn={guardedPress.beginPress}
          onPress={guardedPress.onPress}
          onLongPress={guardedPress.onLongPress}
          delayLongPress={PRESS_INTERACTION.longPressDelay}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={title}
        >
          {photoUri ? (
            // 1列のタイルは画面幅いっぱいなので、サムネイル（長辺400）では引き伸ばされて粗い
            <RemoteThumb
              uri={photoUri}
              style={styles.photo}
              variant={compact ? 'thumb' : 'medium'}
              fallbackLabel={ja ? '写真を読み込めません' : 'Photo unavailable'}
            />
          ) : (
            <View style={[styles.photo, styles.photoEmpty, { backgroundColor: C.chip }]}>
              {/* 写真の代わりに置く絵なので、枠に対して小さいと何を表しているのか
                  読めない。1列のときの枠は高さ 96（flatPhotoWrap）以上ある */}
              <AppIcon name="desk" size={compact ? 32 : 40} color={C.textMuted} />
            </View>
          )}
        </TouchableOpacity>
        {!compact && !!footerLabel && !!onFooter && (
          <TouchableOpacity
            style={[styles.continueBtn, { backgroundColor: C.accent }]}
            onPress={() => onFooter(id)}
            activeOpacity={0.75}
            hitSlop={7}
            accessibilityRole="button"
            accessibilityLabel={footerLabel}
          >
            <Text style={[styles.continueBtnText, { color: C.onAccent }]} numberOfLines={1}>{footerLabel}</Text>
          </TouchableOpacity>
        )}
        {!!onMenu && !widePhoto && (
          <IconCircleButton
            name="dots-horizontal"
            diameter={28}
            size={16}
            color="#FFFFFF"
            background={PHOTO_ACTION_BG}
            borderColor={PHOTO_ACTION_BORDER}
            // 操作ボタンがある場合はその左隣に置く（28 + 6 の間隔）
            style={[styles.actionBtn, { right: onAction && actionIcon ? 40 : 6 }]}
            onPress={() => onMenu(id)}
            hitSlop={8}
            accessibilityLabel={menuLabel}
          />
        )}
        {!!onAction && !!actionIcon && !widePhoto && (
          <IconCircleButton
            name={actionIcon}
            diameter={28}
            size={16}
            color={actionTone === 'saved' ? PHOTO_SAVED_ICON : '#FFFFFF'}
            background={PHOTO_ACTION_BG}
            borderColor={PHOTO_ACTION_BORDER}
            style={styles.actionBtn}
            onPress={() => onAction(id)}
            disabled={actionDisabled}
            hitSlop={8}
            accessibilityLabel={actionLabel}
            buttonRef={actionTarget}
          />
        )}
        {!!updatedLabel && (
          updatedIconOnly ? (
            // 更新マークは写真の上の飾り。指を受けると下の写真のボタンへ届かず、そこだけ押しても開かなかった
            // 地はテーマのカード色（ライトは白・ダークは濃い灰）にし、絵をテーマカラーで描く。
            // テーマカラーの地に onAccent（黒）で描いていた頃は、ライトでも黒い印に見えた。
            // 白い絵をテーマカラーの地に置くと既定のオレンジで 2.1:1 しか出ないので、地のほうを変える
            <View
              style={[styles.updatedBadge, styles.iconOnlyBadge, !!footerLabel && !!onFooter && styles.updatedBadgeWithContinue, { backgroundColor: C.card, borderColor: C.border }]}
              pointerEvents="none"
              accessible
              accessibilityLabel={updatedLabel}
            >
              <AppIcon name={updatedIcon} size={14} color={informationBadge ? C.update : C.accentIcon} centered />
            </View>
          ) : discoveryShowsUpdate ? null : (
            <View style={[styles.updatedBadge, compact && styles.compactUpdatedBadge, !!footerLabel && !!onFooter && styles.updatedBadgeWithContinue, { backgroundColor: informationBadge ? C.update : C.accent }]} pointerEvents="none">
              <AppIcon name={updatedIcon} size={compact ? 10 : 12} color={informationBadge ? C.onUpdate : C.onAccent} />
              <Text
                style={[styles.updatedBadgeText, compact && styles.compactUpdatedBadgeText, { color: informationBadge ? C.onUpdate : C.onAccent }]}
                numberOfLines={1}
              >
                {updatedLabel}
              </Text>
            </View>
          )
        )}

        {/* 2列でも帯は出す。ここを省くと、同じデスク1件がタブによって
            別のものに見える。狭いぶん載る数と大きさだけ落とす */}
        {(!!authorLabel || !!onToggleLike) && !discoveryOrder && (
          <View
            pointerEvents="box-none"
            style={[styles.overlayBar, compact && styles.compactOverlayBar, { backgroundColor: C.card + 'E6' }]}
          >
            {/* 投稿者と空きは飾りなので指を写真へ通す。受けると写真のボタンへ届かず、
                帯の上は拍手以外どこを押しても開かなかった */}
            <View pointerEvents="none" style={[styles.overlayLead, compact && styles.compactOverlayLead]}>
              {!!authorLabel && (
                <>
                  <AuthorAvatar name={authorName} tag={authorTag} imageUrl={authorAvatarUrl} size={compact ? 18 : 24} />
                  <Text style={[styles.authorName, compact && styles.compactAuthorName, { color: C.text }]} numberOfLines={1}>{authorLabel}</Text>
                </>
              )}
            </View>
            {likeButton}
          </View>
        )}
        {discoveryOrder && !!onToggleLike && (
          <View
            ref={clapTarget}
            pointerEvents="box-none"
            style={[styles.discoveryOverlayBar, {
              backgroundColor: PHOTO_ACTION_BG,
              borderColor: PHOTO_ACTION_BORDER,
            }]}
          >
            {likeButton}
          </View>
        )}
      </View>

      <View style={[styles.body, compact && styles.compactBody, discoveryOrder && styles.discoveryBody, widePhoto && styles.wideBody]}>
        {/* 写真の上に丸ボタンを重ねると、16:9 では絵の一番おいしい所に載る。
            マイデスクでは YouTube の一覧と同じく、題の右にボタンを並べる */}
        <View style={[widePhoto && styles.wideLead, discoveryOrder && styles.leadFill]}>
        <TouchableOpacity
          style={[styles.bodyLead, widePhoto && styles.wideBodyLead, discoveryOrder && styles.leadFill]}
          // 本文の余白（写真とデスク名の間・左右・下）は押せる範囲の外にあり、そこを押しても開かなかった。
          // 押せる範囲を余白の端まで広げる。右に操作ボタンが並ぶ 16:9 だけは右へ広げない
          hitSlop={compact ? LEAD_SLOP_COMPACT : widePhoto ? LEAD_SLOP_WIDE : LEAD_SLOP}
          onPressIn={guardedPress.beginPress}
          onPress={guardedPress.onPress}
          onLongPress={guardedPress.onLongPress}
          delayLongPress={PRESS_INTERACTION.longPressDelay}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={title}
        >
          <View style={[styles.titleRow, widePhoto && styles.wideTitleRow]}>
            <Text
              style={[styles.title, compact && styles.compactTitle, widePhoto && styles.wideTitle, { color: C.text }]}
              numberOfLines={widePhoto ? 2 : 1}
            >
              {title}
            </Text>
            {!!publishState && (publishTarget
              ? <View ref={publishTarget} collapsable={false}><PublishBadge state={publishState} colors={C} lang={lang} showNone /></View>
              : <PublishBadge state={publishState} colors={C} lang={lang} showNone />
            )}
          </View>
          {/* 用途は「何用のデスクか」を最初に伝えるものなので、タイトルのすぐ下・左端に置く。
              写真に重ねていた頃は絵柄で埋もれ、更新日の行の右端に置いた頃は
              視線の終点で最後に読まれていた。文字は付けない（ja/en で幅が変わって
              高さがずれる）ぶん、丸とアイコンを1段大きくして絵で見分けさせる */}
          {(!!purposes?.length || (widePhoto && !discoveryOrder && !!meta) || (discoveryOrder && showLikeCount)) && (
            <View style={widePhoto ? styles.widePurposeMetaRow : discoveryOrder ? styles.discoveryPurposeMetaRow : undefined}>
              {!!purposes?.length && (
                <View ref={purposeTarget} style={[styles.purposeRow, discoveryOrder && styles.discoveryPurposeRow, widePhoto && styles.widePurposeRow]}>
                  {shownPurposes.map((p) => {
                    const def = PURPOSE_DEFS.find((d) => d.key === p)
                    if (!def) return null
                    const color = purposeIconColor(p, isDark)
                    return (
                      <View
                        key={p}
                        style={[
                          styles.purposeIcon,
                          compact && styles.compactPurposeIcon,
                          discoveryOrder && styles.discoveryPurposeIcon,
                          { backgroundColor: purposeTintColor(p, isDark) + '2E' },
                        ]}
                        accessible
                        accessibilityLabel={purposeLabel(p, lang)}
                      >
                        <AppIcon name={def.icon as MCIconName} size={discoveryOrder ? 16 : compact ? 13 : 16} color={color} />
                      </View>
                    )
                  })}
                  {hiddenPurposes.length > 0 && (
                    <View
                      style={[
                        styles.purposeIcon,
                        compact && styles.compactPurposeIcon,
                        discoveryOrder && styles.discoveryPurposeIcon,
                        { backgroundColor: C.chip },
                      ]}
                      accessible
                      accessibilityLabel={hiddenPurposes.map((p) => purposeLabel(p, lang)).join(ja ? '、' : ', ')}
                    >
                      <Text style={[styles.purposeMore, compact && !discoveryOrder && styles.compactPurposeMore, { color: C.textSub }]} numberOfLines={1}>
                        +{hiddenPurposes.length}
                      </Text>
                    </View>
                  )}
                </View>
              )}
              {/* discoveryOrder では日付は投稿者と同じ段に出る。ここにも出すと
                  同じ更新日が縦に2つ並ぶ（1列で探す面を出したときに実際に起きた） */}
              {widePhoto && !discoveryOrder && !!meta && (
                <Text style={[styles.wideMetaInline, { color: C.textMuted }]} numberOfLines={1}>
                  {meta}
                </Text>
              )}
              {/* 件数の読み上げは拍手ボタンの名前（likeLabel）に入っているので、ここは絵と数字だけ */}
              {discoveryOrder && showLikeCount && (
                <View style={styles.discoveryClapCount}>
                  <AppIcon name={ICONS.clap} size={13} color={C.textMuted} />
                  <RollingCount value={likeCount ?? 0} style={[styles.discoveryClapCountText, { color: C.textSub }]} />
                </View>
              )}
            </View>
          )}
          {discoveryOrder && (!!authorLabel || !!meta || discoveryShowsUpdate) && (
            <View style={styles.discoveryAuthorRow}>
              {!!authorLabel && (
                <>
                  <AuthorAvatar name={authorName} tag={authorTag} imageUrl={authorAvatarUrl} size={16} />
                  <Text style={[styles.discoveryAuthorName, { color: C.textSub }]} numberOfLines={1}>
                    {authorLabel}
                  </Text>
                </>
              )}
              {discoveryShowsUpdate && (
                <Text ref={updateTarget} style={[styles.discoveryUpdate, { color: C.accentText }]} numberOfLines={1}>
                  {updatedLabel}
                </Text>
              )}
              {!!meta && (
                // 時刻に「更新」の語は付けない。隣の「更新」の印（前に開いたあとの変更）と同じ語が並んで紛らわしい。
                // 何の時刻かは「？」の吹き出し（DeskFeedScreen の FEED_COACH）で説明する
                <Text style={[styles.discoveryMeta, { color: C.textMuted }]} numberOfLines={1}>
                  {meta}
                </Text>
              )}
            </View>
          )}
          {!!meta && !discoveryOrder && !widePhoto && (
            <Text
              style={[styles.meta, compact && styles.compactMeta, { color: C.textMuted }]}
              numberOfLines={1}
            >
              {meta}
            </Text>
          )}
        </TouchableOpacity>
        {widePhoto && (!!onAction || !!onMenu || !!updatedAt) && (
          <View style={styles.wideSide}>
          {(!!onAction || !!onMenu) && (
          <View style={styles.wideActions}>
            {!!onAction && !!actionIcon && (
              <TouchableOpacity
                ref={actionTarget}
                style={styles.wideActionBtn}
                onPress={() => onAction(id)}
                disabled={actionDisabled}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
              >
                <AppIcon name={actionIcon} size={19} color={C.textMuted} />
              </TouchableOpacity>
            )}
            {!!onMenu && (
              <TouchableOpacity
                style={styles.wideActionBtn}
                onPress={() => onMenu(id)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={menuLabel}
              >
                <AppIcon name="dots-vertical" size={19} color={C.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          )}
          {/* 日付は用途アイコンの段の右端に置く。何の日付かは位置で分かるので「更新日」は読み上げにだけ残す */}
          {!!updatedAt && (
            <View style={styles.wideDateBox}>
              <Text
                style={[styles.wideDate, { color: C.textMuted }]}
                numberOfLines={1}
                accessibilityLabel={`${ja ? '更新日' : 'Updated'} ${formatDate(new Date(updatedAt), lang)}`}
              >
                {formatDate(new Date(updatedAt), lang)}
              </Text>
            </View>
          )}
          </View>
        )}
        </View>

        {!compact && changes.length > 0 && (
          // 変更点の行は押せる物ではないが、タイルの下半分を占めるので押したら開くようにする
          // （ここを押しても何も起きなかった）。見出し・「他N件」は内側のボタンが先に受ける。
          // 読み上げは題のボタンと重なるので、この面は要素にせず中のボタンと文字をそのまま読ませる
          <TouchableOpacity
            style={[styles.changeBlock, { borderTopColor: C.separator }]}
            hitSlop={widePhoto ? CHANGE_SLOP_WIDE : CHANGE_SLOP}
            onPressIn={guardedPress.beginPress}
            onPress={guardedPress.onPress}
            onLongPress={guardedPress.onLongPress}
            delayLongPress={PRESS_INTERACTION.longPressDelay}
            activeOpacity={0.75}
            accessible={false}
          >
            {/* 畳めないときも見出しは出す。何件動いたかは一覧のまま知りたい */}
            <TouchableOpacity
              style={styles.changeHeader}
              onPress={() => {
                if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
                setExpanded((v) => !v)
              }}
              disabled={!collapsible}
              accessibilityRole={collapsible ? 'button' : 'header'}
              accessibilityState={collapsible ? { expanded } : undefined}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <AppIcon
                name={collapsible ? (expanded ? ICONS.chevronDown : ICONS.chevronRight) : 'circle-small'}
                size={16}
                color={C.textMuted}
              />
              <Text style={[styles.changeHeaderText, { color: C.textSub }]} numberOfLines={1}>
                {ja
                  ? `ガジェットを${changes.length}件更新`
                  : `Updated ${changes.length} gadget${changes.length === 1 ? '' : 's'}`}
              </Text>
            </TouchableOpacity>

            {shownChanges.map((c) => (
              <View key={c.gadgetId} style={styles.changeRow}>
                <View style={[styles.changeIcon, { borderColor: C.border }]}>
                  <CategoryIcon category={c.category} pcFormFactor={c.pcFormFactor} customIcon={c.customCategory?.icon} size={14} color={categoryIconColor(c.category, isDark, undefined, c.customCategory?.color)} />
                </View>
                <AppIcon name={CHANGE_MARK[c.kind]} size={12} color={C.textMuted} />
                <Text style={[styles.changeName, { color: C.text }]} numberOfLines={1}>
                  {c.kind === 'swap' && c.fromName ? `${c.fromName} → ${c.name}` : c.name}
                </Text>
                {c.price != null && c.price > 0 && (
                  <Text style={[styles.changePrice, { color: C.textMuted }]} numberOfLines={1}>
                    {fmtPrice(c.price)}
                  </Text>
                )}
              </View>
            ))}

            {hiddenCount > 0 && (
              <TouchableOpacity
                style={styles.changeMore}
                onPress={() => {
                  if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
                  setExpanded(true)
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
              >
                <Text style={[styles.changeMoreText, { color: C.accentText }]}>
                  {ja ? `他${hiddenCount}件を表示` : `Show ${hiddenCount} more`}
                </Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        {!!updatedAt && !widePhoto && (
          <Text style={[styles.updatedDate, { color: C.textMuted }]} numberOfLines={1}>
            {`${ja ? '更新日' : 'Updated'} ${formatDate(new Date(updatedAt), lang)}`}
          </Text>
        )}
      </View>
    </View>
  )
}

export const DeskGridTile = memo(DeskGridTileBase)

const styles = StyleSheet.create({
  tile: { borderRadius: UI_METRICS.cardRadius, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  compactTile: { flex: 1, borderRadius: UI_METRICS.controlRadius },

  // 高さの決め方は3通りあるので、比率は base に持たせず必ずどれか1つを重ねる
  // （aspectRatio: undefined での打ち消しは style 配列の平坦化の実装に依存する）
  photoWrap: { position: 'relative', width: '100%' },
  // 4:3。デスクの写真は横位置で撮られるので、正方形だと上下が切れる
  photoWrap43: { aspectRatio: 4 / 3 },
  // 16:9（widePhoto の注記）
  photoWrap169: { aspectRatio: 16 / 9 },
  // 2列でも比率は変えない。正方形にすると 4:3 で撮られた写真の左右が25%落ちる
  compactPhotoWrap: { aspectRatio: 4 / 3 },
  // 投稿者の帯（約38px）＋アイコンが収まる最小限
  flatPhotoWrap: { height: 96 },
  photoPress: { width: '100%', height: '100%' },
  photo: { width: '100%', height: '100%' },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },

  purposeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  widePurposeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  widePurposeRow: { flexShrink: 0, marginTop: 0 },
  wideMetaInline: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 11, fontWeight: '500' },
  continueBtn: {
    position: 'absolute', top: 6, left: 6, maxWidth: '70%',
    minHeight: 30, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  continueBtnText: { fontSize: 12, fontWeight: '600' },

  // 大きさと形は IconCircleButton が持つ。ここは置き場所だけ
  actionBtn: { position: 'absolute', top: 6, right: 6 },
  // 写真の上に載るので、塗りは accent。境界線ではなく面で浮かせないと写真に負ける
  updatedBadge: {
    position: 'absolute', top: 6, left: 6, maxWidth: '75%',
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: UI_METRICS.chipRadius,
  },
  updatedBadgeWithContinue: { left: undefined, right: 6 },
  // 縮めないと、長い文言（英語の "Updated 3 days ago"）が「…」にならずバッジの外へはみ出す
  updatedBadgeText: { flexShrink: 1, fontSize: 11, fontWeight: '700' },
  compactUpdatedBadge: { top: 4, left: 4, paddingHorizontal: 5, paddingVertical: 2, gap: 2 },
  // 白い縁で写真の柄から切り離す（影は使わない約束なので縁で浮かせる）
  iconOnlyBadge: { width: 24, height: 24, paddingHorizontal: 0, paddingVertical: 0, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  compactUpdatedBadgeText: { fontSize: 10 },

  overlayBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  compactOverlayBar: { gap: 4, paddingHorizontal: 6, paddingVertical: 5 },
  // 帯の左側（投稿者）と、拍手までの空き。間隔は overlayBar の gap と揃える
  overlayLead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactOverlayLead: { gap: 4 },
  discoveryOverlayBar: {
    position: 'absolute', right: 6, bottom: 6,
    minWidth: 30, height: 30, borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  compactAuthorName: { fontSize: 10 },
  compactPurposeIcon: { width: 21, height: 21, borderRadius: 6 },
  discoveryPurposeRow: { gap: 4, marginTop: 0 },
  // 用途アイコン（26）と拍手の件数を1段に並べる。用途が無いデスクでも件数の高さを揃える
  discoveryPurposeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26, marginTop: 4 },
  discoveryClapCount: { flexShrink: 0, marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 2 },
  discoveryClapCountText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  discoveryPurposeIcon: { width: 26, height: 26, borderRadius: 7 },
  // 投稿者名は伸ばしすぎない。右端の用途アイコンとハートの居場所を先に確保する
  authorName: { flexShrink: 1, fontSize: 12, fontWeight: '700' },
  // 8種類を絵だけで見分けてもらう。小さいと形の違いが潰れるので器ごと大きくする。
  // 角丸四角なのは押せないから。同じタイルの共有・いいねボタンは丸で出している
  purposeIcon: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  purposeMore: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  compactPurposeMore: { fontSize: 9 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  discoveryLikeBtn: { minWidth: 30, height: '100%' },
  likeCount: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

  body: { paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  compactBody: { paddingHorizontal: 9, paddingVertical: 9 },
  discoveryBody: { minHeight: 76 },
  // minHeight で本文が中身より高くなったぶんも押せる範囲に入れる
  leadFill: { flexGrow: 1 },
  discoveryAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  discoveryAuthorName: { flex: 1, minWidth: 0, fontSize: 10, fontWeight: '600' },
  discoveryMeta: { flexShrink: 0, maxWidth: '45%', fontSize: 9 },
  discoveryUpdate: { flexShrink: 0, fontSize: 10, fontWeight: '700' },
  bodyLead: { gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '700' },
  compactTitle: { fontSize: 13 },
  meta: { fontSize: 12 },
  compactMeta: { fontSize: 10 },
  updatedDate: { alignSelf: 'flex-end', textAlign: 'right', fontSize: 11, fontWeight: '500', marginTop: 4 },

  // マイデスク（16:9）の文字と配置。YouTube の一覧と同じく、題は2行まで大きめ、
  // その下に1行のメタ、右にボタン。デスク名は長いものが多く、1行だと「…」ばかりになる
  wideBody: { paddingHorizontal: 12, paddingVertical: 10 },
  // 右の列を本文と同じ高さに伸ばし、上端に共有ボタン（題の1行目）、下端に日付（用途アイコンの段）を置く
  wideLead: { flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  wideBodyLead: { flex: 1 },
  // 公開バッジは題が2行になっても1行目の高さに置く
  wideTitleRow: { alignItems: 'flex-start' },
  wideTitle: { fontSize: 16, lineHeight: 21 },
  wideSide: { alignItems: 'flex-end' },
  // 28 のボタンの中心を、題の1行目（lineHeight 21）の中心に合わせる
  wideActions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: -4 },
  // 用途アイコン（purposeIcon の 26）と同じ高さの箱で、アイコンの中心に文字をそろえる
  wideDateBox: { height: 26, marginTop: 'auto', justifyContent: 'center' },
  wideDate: { fontSize: 11, fontWeight: '500' },
  wideActionBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  changeBlock: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  changeHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  changeHeaderText: { fontSize: 12, fontWeight: '700' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 2 },
  changeIcon: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  changeName: { flex: 1, fontSize: 12 },
  changePrice: { fontSize: 12, fontVariant: ['tabular-nums'] },
  changeMore: { paddingLeft: 2, paddingTop: 2 },
  changeMoreText: { fontSize: 12, fontWeight: '700' },
})
