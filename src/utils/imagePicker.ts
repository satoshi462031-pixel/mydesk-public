import * as ImagePicker from 'expo-image-picker'
import { Platform } from 'react-native'

const WEB_PICKER_RETURN_GRACE_MS = 5000

export type ImageLibraryLaunchResult =
  | { permissionDenied: true; result: null }
  | { permissionDenied: false; result: ImagePicker.ImagePickerResult }

/**
 * Web では呼び出しから最初の await までにファイル選択を開く必要がある。
 * 権限確認とキャンセル後の復旧もここへ集約し、画面ごとの実装差を作らない。
 */
export async function launchImageLibraryFromUserAction(
  options: ImagePicker.ImagePickerOptions,
): Promise<ImageLibraryLaunchResult> {
  // Androidのシステムピッカーは選んだ写真だけへのアクセスを許可する。
  if (Platform.OS === 'ios') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return { permissionDenied: true, result: null }
  }

  // Web の分岐では、この呼び出しより前に await を置かない。
  const picker = ImagePicker.launchImageLibraryAsync(options)
  const result = Platform.OS === 'web' ? await recoverWebPickerCancellation(picker) : await picker
  return { permissionDenied: false, result }
}

function recoverWebPickerCancellation(
  picker: Promise<ImagePicker.ImagePickerResult>,
): Promise<ImagePicker.ImagePickerResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return picker

  return new Promise((resolve, reject) => {
    let settled = false
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (recoveryTimer) clearTimeout(recoveryTimer)
      window.removeEventListener('focus', scheduleRecovery)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    const complete = (result: ImagePicker.ImagePickerResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const scheduleRecovery = () => {
      if (settled) return
      if (recoveryTimer) clearTimeout(recoveryTimer)
      // Expo の Web 実装はブラウザによって cancel を返さない。写真の読み込み完了を
      // 先に待ち、それでも返らない場合だけキャンセルとして画面を操作可能に戻す。
      recoveryTimer = setTimeout(() => complete({ canceled: true, assets: null }), WEB_PICKER_RETURN_GRACE_MS)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRecovery()
    }

    window.addEventListener('focus', scheduleRecovery)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    picker.then(complete, fail)
  })
}
