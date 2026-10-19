import { showConfirmation } from './confirmation'
import type { PublishGadgetIssue } from './publishRequirements'

// 写真が無いまま公開しようとしたとき。知らせるだけだと、公開したい瞬間に
// 行き止まりになり、写真を足す場所を自分で探すことになる（promptLogin と同じ理由）。
// 行き先は画面ごとに違うので、送り先は呼び出し側が渡す。
export function promptPhotoRequired(
  lang: 'ja' | 'en',
  purpose: 'publish' | 'update',
  onAddPhotos: () => void,
): void {
  const ja = lang === 'ja'
  showConfirmation({
    title: ja ? '写真が必要です' : 'Photo required',
    message: purpose === 'publish'
      ? (ja ? '公開するには写真を1枚以上追加してください。' : 'Please add at least one photo before publishing.')
      : (ja ? '更新するには写真を1枚以上追加してください。' : 'Please add at least one photo before updating.'),
    cancelLabel: ja ? 'キャンセル' : 'Cancel',
    confirmLabel: ja ? '写真を追加' : 'Add Photos',
    onConfirm: onAddPhotos,
  })
}

// 機材がそろわないまま公開しようとしたとき（publishRequirements の注記）。
// 写真より先に聞く。作成の流れも機材 → 写真の順で、写真を足してから機材で止めると2度止まる。
// 枠が残っているときの送り先は「商品をまとめて登録」。持っていない物の枠もそこで外せる
export function promptGadgetRequired(
  lang: 'ja' | 'en',
  purpose: 'publish' | 'update',
  issue: PublishGadgetIssue,
  go: { fillProducts: () => void; addGadget: () => void },
): void {
  const ja = lang === 'ja'
  const verb = purpose === 'publish' ? (ja ? '公開' : 'publishing') : (ja ? '更新' : 'updating')
  if (issue.kind === 'unfilled') {
    showConfirmation({
      title: ja ? '商品名が入っていない機材があります' : 'Some gear has no product name',
      message: ja
        ? `${verb}するには、${issue.count}件の機材に商品名を入れてください。持っていない物は外せます。`
        : `Before ${verb}, add product names to ${issue.count} ${issue.count === 1 ? 'item' : 'items'}. You can remove gear you don't own.`,
      cancelLabel: ja ? 'キャンセル' : 'Cancel',
      confirmLabel: ja ? '商品名を入れる' : 'Add Names',
      onConfirm: go.fillProducts,
    })
    return
  }
  showConfirmation({
    title: ja ? '機材が必要です' : 'Gear required',
    message: ja ? `${verb}するには、機材を1台以上登録してください。` : `Please add at least one item before ${verb}.`,
    cancelLabel: ja ? 'キャンセル' : 'Cancel',
    confirmLabel: ja ? '機材を追加' : 'Add Gear',
    onConfirm: go.addGadget,
  })
}
