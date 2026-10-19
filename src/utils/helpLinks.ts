export interface StoreReviewUrls {
  native: string
  web: string
}

export function isStoreReviewEnabled(
  platform: string,
  appStoreEnabled: boolean,
  playStoreEnabled: boolean,
): boolean {
  if (platform === 'ios') return appStoreEnabled
  if (platform === 'android') return playStoreEnabled
  return false
}

export function buildStoreReviewUrls(
  platform: string,
  androidPackage: string,
  iosNativeUrl: string,
  iosWebUrl: string,
): StoreReviewUrls {
  if (platform === 'android') {
    const packageId = encodeURIComponent(androidPackage)
    return {
      native: `market://details?id=${packageId}`,
      web: `https://play.google.com/store/apps/details?id=${packageId}`,
    }
  }

  return { native: iosNativeUrl, web: iosWebUrl }
}

export function buildSupportEmailUrl(email: string, language: 'ja' | 'en'): string {
  const subject = language === 'ja' ? 'MyDesk お問い合わせ' : 'MyDesk Support'
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`
}
