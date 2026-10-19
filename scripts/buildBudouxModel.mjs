// BudouX（Google・Apache-2.0）の日本語モデルを src/constants/budouxJaModel.generated.ts に書き出す。
// パッケージの入口（budoux）を読むと、Node 用の DOM（linkedom）と4言語ぶんのモデル（約210KB）まで
// アプリに入るので、日本語のモデル（約23KB）だけを写す。解析は src/utils/phraseBreak.ts が持つ。
// 実行: node scripts/buildBudouxModel.mjs（budoux を上げたら打ち直す）
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
// パッケージの exports は入口しか開けていないので、package.json の位置から実ファイルを引く
const pkgDir = path.resolve(path.dirname(require.resolve('budoux')), '..')
const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
const source = readFileSync(path.join(pkgDir, 'module/data/models/ja.js'), 'utf8')
const match = source.match(/export const model = (\{[\s\S]*?\});/)
if (!match) throw new Error('budoux の ja モデルの形が変わった')
const model = JSON.parse(match[1])

const out = `// 自動生成（scripts/buildBudouxModel.mjs）。手で直さない。
// BudouX ${version} の日本語モデル。Copyright 2021 Google LLC. Licensed under the Apache License, Version 2.0
// （https://www.apache.org/licenses/LICENSE-2.0）
export const BUDOUX_JA_MODEL: Record<string, Record<string, number>> = ${JSON.stringify(model)}
`
writeFileSync(path.resolve('src/constants/budouxJaModel.generated.ts'), out)
console.log(`budoux ${version} ja model: ${Object.keys(model).length} groups`)
