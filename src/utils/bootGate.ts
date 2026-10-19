export const MIN_BRAND_SPLASH_MS = 700
export const BOOT_DATA_TIMEOUT_MS = 2500

interface BootGateState {
  themeReady: boolean
  authLoading: boolean
  onboarded: boolean | null
  authSkipped: boolean | null
  initialDataReady: boolean
}

export function isBootReady({ themeReady, authLoading, onboarded, authSkipped, initialDataReady }: BootGateState): boolean {
  const initialGateReady = onboarded === false || initialDataReady
  return themeReady && !authLoading && onboarded !== null && authSkipped !== null && initialGateReady
}
