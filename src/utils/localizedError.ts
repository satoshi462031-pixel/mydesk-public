export type ErrorLanguage = 'ja' | 'en'

type ErrorTranslation = readonly [ja: string, en: string]

const EXACT_MESSAGES: Readonly<Record<string, ErrorTranslation>> = {
  // 106。作り直しによる通知・容量の濫用を止める上限で、普通の使い方では当たらない
  'CREATION_RATE_LIMITED': ['短い時間に作成できる上限に達しました。時間をおいてからもう一度お試しください。', 'You have reached the creation limit. Wait before trying again.'],
  'PASSWORD_REAUTH_REQUIRED': ['もう一度ログインし直してから、パスワードを変更してください。', 'Sign in again before changing your password'],
  'PROFILE_SETTING_UNCONFIRMED': ['公開設定の変更を確認できませんでした。時間をおいてもう一度お試しください。', 'The visibility change could not be confirmed. Try again later.'],
  'ACCOUNT_DELETION_UNCONFIRMED': ['削除の完了を確認できませんでした。端末のデータは残しています。', 'Deletion could not be confirmed. Your local data has been kept.'],
  'REPORT_RATE_LIMITED': ['送信回数の上限に達しました。時間をおいてからもう一度お試しください。', 'You have reached the submission limit. Wait before trying again.'],
  'IMAGE_UPLOAD_RATE_LIMITED': ['画像の保存回数または容量の上限に達しました。時間をおいてから再試行してください。', 'You have reached the image upload or storage limit. Wait before trying again.'],
  'IMAGE_UPLOAD_UNCONFIRMED': ['画像の保存完了を確認できませんでした。再試行してください。', 'Image upload could not be confirmed. Please try again.'],
  'ログインが必要です': ['ログインが必要です。', 'Sign in is required.'],
  'AUTH_ACCOUNT_CHANGED': ['アカウントが切り替わりました。現在の画面を開き直してから、もう一度お試しください。', 'Your account changed. Reopen the current screen and try again.'],
  'AUTH_OPERATION_IN_PROGRESS': ['認証の終了処理が続いています。完了してから、もう一度お試しください。', 'A session operation is still in progress. Wait for it to finish and try again.'],
  'BILLING_OPERATION_IN_PROGRESS': ['購入・復元処理が続いています。完了してから、もう一度お試しください。', 'A purchase or restore is still in progress. Wait for it to finish and try again.'],
  'STORAGE_OPERATION_PENDING': ['端末の保存処理が応答していません。しばらく待ってから再試行してください。改善しない場合はアプリを開き直してください。', 'Device storage is not responding. Wait a moment and retry. If it persists, reopen the app.'],
  '報告するにはログインしてください。': ['報告するにはログインしてください。', 'Sign in to report this response.'],
  '報告対象の回答がありません。': ['報告対象の回答がありません。', 'There is no response to report.'],
  '自分自身はブロックできません': ['自分自身はブロックできません。', 'You cannot block yourself.'],
  'OAuth URL を取得できませんでした': ['ログイン画面を開けませんでした。', 'Could not open the sign-in page.'],
  'Apple の認証トークンを取得できませんでした': ['Appleの認証情報を取得できませんでした。', 'Could not get your Apple sign-in credentials.'],
  'Apple認証を確認できませんでした。もう一度お試しください': ['Apple認証を確認できませんでした。もう一度お試しください。', 'Could not verify Apple sign-in. Please try again.'],
  '認証が切れました。再ログインしてください。': ['認証が切れました。再ログインしてください。', 'Your session expired. Please sign in again.'],
  '公開済みデスクを削除するにはログインが必要です。': ['公開済みデスクを削除するにはログインが必要です。', 'Sign in to delete a published desk.'],
  '公開名やデスク名にメールアドレスを含めることはできません。': ['公開名やデスク名にメールアドレスを含めることはできません。', 'Public names and desk names cannot contain an email address.'],
  '公開名やデスク名に複数の外部リンクを含めることはできません。': ['公開名やデスク名に複数の外部リンクを含めることはできません。', 'Public names and desk names cannot contain multiple external links.'],
  '公開できない内容が含まれています。内容を修正してください。': ['公開できない内容が含まれています。内容を修正してください。', 'This content cannot be published. Please revise it.'],
  'AIから空のレスポンスが返されました': ['AIから回答を受信できませんでした。', 'The AI returned an empty response.'],
  '保存データが上限を超えているため、ログアウトできません。': ['保存データが上限を超えているため、ログアウトできません。', 'Could not sign out because the backup is too large.'],
  // useGadgets・publishService が投げる。読めていないガジェットを0件として保存・公開しないための停止
  'GADGETS_NOT_LOADED': ['ガジェットを読み込めませんでした。アプリを開き直してから、もう一度お試しください。', 'Could not load your gadgets. Reopen the app and try again.'],
  'NO_PUBLISHABLE_GADGETS': ['商品名が入っていない機材があるため公開できません。商品名を入れるか、持っていない物を外してから、もう一度お試しください。', 'Some gear has no product name. Add names or remove gear you don\'t own, then try again.'],
  'PUBLISH_IN_PROGRESS': ['別の公開処理が続いています。完了後にもう一度お試しください。', 'Another publish is still in progress. Try again after it finishes.'],
  'DESK_NOT_PUBLIC': ['このデスクは非公開です。公開するには見え方を選び直してください。', 'This desk is private. Choose its visibility before publishing again.'],
  'PHOTO_REVOCATION_INCOMPLETE': ['デスクの公開ページは停止しましたが、写真の公開停止が完了していません。通信環境を確認して再試行してください。', 'The public page is disabled, but revoking access to its photos is incomplete. Check your connection and retry.'],
  // 103。運営の措置で止まっているもの。理由の詳細はアプリに持たない（運営からの連絡で伝える）
  'DESK_MODERATION_HIDDEN': ['このデスクは運営により非公開になっているため、公開できません。', 'This desk was made private by the MyDesk team and cannot be published.'],
  'ACCOUNT_ACCESS_REVOKED': ['このアカウントまたはログイン状態は利用できません。ログインし直すか、サポートへお問い合わせください。', 'This account or session is unavailable. Sign in again or contact support.'],
  'PUBLISHING_SUSPENDED': ['このアカウントはデスクの公開が停止されています。', 'Publishing desks is suspended for this account.'],
  // アカウント削除の再認証（services/auth.ts・delete-account）
  'REAUTH_CANCELLED': ['本人確認が完了しなかったため、削除を中止しました。', 'Deletion was cancelled because sign-in was not confirmed.'],
  'REAUTH_ACCOUNT_MISMATCH': ['削除するアカウントとは別のアカウントで認証されました。削除するアカウントでログインし直してください。', 'You signed in with a different account. Sign in with the account you want to delete.'],
  'REAUTH_UNAVAILABLE': ['この端末では本人確認ができないため、削除できません。サポートへお問い合わせください。', 'Sign-in cannot be confirmed on this device. Please contact support.'],
  'REAUTH_REQUIRED': ['安全のため、ログインし直してから削除してください。', 'For your security, sign in again before deleting.'],
  '削除するアカウントのApple IDで認証してください': ['削除するアカウントのApple IDで認証してください。', 'Verify with the Apple ID of the account you are deleting.'],
  'LINK_REISSUED_PHOTOS_PENDING': ['新しいリンクを発行しましたが、写真の差し替えが完了していません。通信環境を確認して、もう一度再発行してください。', 'A new link was issued, but replacing the photos is incomplete. Check your connection and reissue again.'],
  'DESK_NOT_REPORTABLE': ['このデスクは公開されていないため、通報できません。', 'This desk is no longer published and cannot be reported.'],
}

const PATTERN_MESSAGES: ReadonlyArray<readonly [RegExp, ErrorTranslation]> = [
  [/invalid login credentials/i, ['メールアドレスまたはパスワードが違います。', 'Incorrect email address or password.']],
  [/email not confirmed/i, ['メールアドレスの確認が完了していません。', 'Please confirm your email address first.']],
  [/user already registered|already been registered/i, ['このメールアドレスは登録済みです。', 'This email address is already registered.']],
  [/password should be at least|password.*at least.*characters/i, ['パスワードが短すぎます。', 'The password is too short.']],
  [/unable to validate email address|invalid email/i, ['メールアドレスを確認してください。', 'Check your email address.']],
  [/rate limit|too many requests|for security purposes/i, ['しばらく待ってからもう一度お試しください。', 'Wait a moment and try again.']],
  [/network request failed|failed to fetch|networkerror|timed out|timeout/i, ['通信環境を確認して、もう一度お試しください。', 'Check your connection and try again.']],
  [/auth session missing|jwt expired|session.*expired/i, ['認証が切れました。再ログインしてください。', 'Your session expired. Please sign in again.']],
  // publishService が公開前に投げる。原因の写真が分からないと、
  // 何度公開し直しても同じところで失敗し続ける
  [/^PHOTO_FILE_MISSING:/, [
    '端末で見つからない写真があります。写真一覧でその写真を削除して、もう一度選び直してください。',
    'Some photos are missing from this device. Remove them in the photo list and pick them again.',
  ]],
]

const hasJapanese = (value: string): boolean => /[ぁ-んァ-ヶ一-龠]/u.test(value)

/** バックエンド由来のエラーを、現在の表示言語から漏れない文言へ変換する。 */
export function localizedErrorMessage(
  error: unknown,
  lang: ErrorLanguage,
  fallback?: string,
): string {
  const raw = error instanceof Error
    ? error.message.trim()
    : typeof error === 'string'
      ? error.trim()
      : ''

  const exact = EXACT_MESSAGES[raw]
  if (exact) return exact[lang === 'ja' ? 0 : 1]

  for (const [pattern, messages] of PATTERN_MESSAGES) {
    if (pattern.test(raw)) return messages[lang === 'ja' ? 0 : 1]
  }

  // 選択言語と一致する文言は、サービス固有の有用な詳細としてそのまま残す。
  if (raw && (lang === 'ja' ? hasJapanese(raw) : !hasJapanese(raw))) return raw

  return fallback ?? (lang === 'ja' ? 'エラーが発生しました。' : 'Something went wrong.')
}
