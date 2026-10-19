import type { Theme } from '@react-navigation/native'
import { UI_STATUS_COLORS } from '../constants/ui'
import type { AppColors } from '../constants/colors'

// NavigationContainer に渡すテーマ。渡さないと React Navigation は既定のライトテーマ
// （地 #F2F2F2・面 #FFFFFF）で塗る。native-stack は各画面の入れ物をこの地で塗るので、
// 画面が自前で地を塗っていない所（ヘッダーの裏・読み込み中の画面・遷移の途中）だけ、
// ダークモードでも白く見えていた。画面ごとに地を塗り足すのではなく、ここで配色の正本
// （AppColors）から作って、ナビゲーションが描く既定色をすべてアプリの配色に揃える。
export function buildNavigationTheme(colors: AppColors, isDark: boolean): Theme {
  return {
    dark: isDark,
    colors: {
      // iOS のヘッダーの既定の文字色。中立の地の上の文字なので accentText
      primary: colors.accentText,
      background: colors.bg,
      card: colors.header,
      text: colors.text,
      border: colors.border,
      notification: UI_STATUS_COLORS.danger,
    },
  }
}
