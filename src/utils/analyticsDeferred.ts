export type DeferredAnalyticsAction = 'ignore' | 'defer' | 'send'

export function deferredAnalyticsAction(
  consentEnabled: boolean,
  alreadySent: boolean,
): DeferredAnalyticsAction {
  if (alreadySent) return 'ignore'
  return consentEnabled ? 'send' : 'defer'
}
