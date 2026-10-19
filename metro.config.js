const { getSentryExpoConfig } = require('@sentry/react-native/metro')
const path = require('path')

const config = getSentryExpoConfig(__dirname)

// react-native-purchases が未インストールの場合（Expo Go 開発時）はスタブに差し替える。
// Dev Build 時は npx expo install react-native-purchases してから
// このエイリアスを削除（またはコメントアウト）する。
let purchasesResolved = true
try {
  require.resolve('react-native-purchases')
} catch {
  purchasesResolved = false
}

if (!purchasesResolved) {
  config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    'react-native-purchases': path.resolve(__dirname, 'src/mocks/react-native-purchases.ts'),
  }
}

// react-native の Text を、文字の拡大に上限をかけた版（src/shims/cappedText.tsx）へ差し替える。
// 解決した先で見るので、import { Text } from 'react-native' も Animated.Text も、
// ナビゲーション等のライブラリが使う Text もまとめて対象になる。差し替え先だけは本体を読む
const RN_TEXT = path.join('node_modules', 'react-native', 'Libraries', 'Text', 'Text.js')
const CAPPED_TEXT = path.resolve(__dirname, 'src/shims/cappedText.tsx')
const upstreamResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolved = upstreamResolveRequest
    ? upstreamResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform)
  if (
    resolved.type === 'sourceFile' &&
    resolved.filePath.endsWith(RN_TEXT) &&
    path.resolve(context.originModulePath) !== CAPPED_TEXT
  ) {
    return { type: 'sourceFile', filePath: CAPPED_TEXT }
  }
  return resolved
}

module.exports = config
