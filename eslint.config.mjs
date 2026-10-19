// アプリ本体（src / scripts / tests）の lint。`npm run lint`
//
// **狙いは「tsc が拾えない種類のバグ」だけ。** 型と未使用ローカルは
// `npx tsc --noEmit`（strict + noUnusedLocals）が既に見ているので重ねない。
// ここで止めたいのは主にフックの依存配列の漏れで、これは型では出ないのに
// 「更新したのに画面が変わらない」「古い値を掴んだまま」という形で表に出る。
//
// 既存コードの書き味（colors: any、navigation: any など）まで一気に直させると
// 差分が本題を埋めるので、そこは意図的に止めていない。
import globals from 'globals'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'landing/**',   // 独自の eslint 設定を持つ（Next.js）
      'worker/**',
      'dist/**',
      '.expo/**',
      'ios/**',
      'android/**',
      // 事前計算した配線図。npm run build:onboarding-wiring の生成物
      'src/constants/onboardingWiring.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['App.tsx', 'src/**/*.{ts,tsx}', 'scripts/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // tsc の noUnusedLocals と重複する
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // 型は TypeScript が見る。ここで any を追い回すと本題が埋まる
      '@typescript-eslint/no-explicit-any': 'off',
      // TS が解決するので、グローバル未定義の判定は任せる
      'no-undef': 'off',
      // `cond ? a() : b()` を文として使う書き方はコードベース全体で意図して使われている。
      // 宙に浮いた式（呼び忘れの `foo.bar`）は引き続き止める
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
      // 握りつぶす catch には理由がコメントで書かれている。空であること自体は責めない
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 全角スペースは日本語コメント・表示文字列・商品名を正規化する正規表現の中に出る。
      // どれも意図して置いたもので、責めたいのはコードの区切りに紛れ込んだ分だけ
      'no-irregular-whitespace': ['error', {
        skipComments: true, skipStrings: true, skipTemplates: true,
        skipRegExps: true, skipJSXText: true,
      }],
      // React Native はアセットと app.json の読み込みに require() を使う
      '@typescript-eslint/no-require-imports': 'off',
      // 制御文字を「取り除くため」の正規表現が2箇所ある（nodeTextFit / productName）
      'no-control-regex': 'off',
    },
  },
  {
    // ─── 型情報が要る検査（App.tsx / src）─────────────────────────────
    // 拒否を誰も受けていない Promise を止める。実際に
    // resolvePurchaseLinks(...).then(...) が拒否を受けておらず、通信が切れると
    // 購入リンクが黙って出なくなる状態だった。**利用者側は何も知らされない**種類の
    // 不具合で、このアプリには画面のテストが無いので、静的に止められる価値が大きい。
    //
    // projectService は型情報を読むぶん遅く、全体の実行が 7秒 → 20秒台になる。
    // --cache は使わない：型情報つきの規則は「別のファイルの変更で結果が変わる」ため、
    // 変更のあったファイルだけ調べ直すと見落としが出る。
    //
    // scripts / tests は別の tsconfig なので対象に入れない。
    files: ['App.tsx', 'src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    // 手元で Node から走らせるスクリプト。アプリには入らない
    files: ['scripts/**/*.{ts,mjs,js}'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // フックの検査は React が居るファイルだけに当てる。
    // rules-of-hooks は関数ごとに制御フローグラフを組むため、React と無関係でも
    // 大きいファイル（src/utils/wiringEngine.ts・2600行）で終わらなくなる。
    // 実測で、この1ファイルだけで45秒を超えても返ってこない。
    // 純粋なユーティリティにフックは無いので、対象から外すのは回避ではなく正しい範囲指定。
    files: ['App.tsx', 'src/**/*.tsx', 'src/hooks/**/*.ts', 'src/context/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // 依存配列の漏れ。tsc では出ないのに挙動として表に出る、この lint の主目的
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
