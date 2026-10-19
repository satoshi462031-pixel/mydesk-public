/**
 * SECURITY DEFINER 関数の実行権限を、マイグレーションを順に読んで突き合わせる。
 *
 * Supabase は public スキーマに関数を作るたびに、ALTER DEFAULT PRIVILEGES で
 * anon / authenticated へ EXECUTE を個別に付ける。REVOKE ... FROM PUBLIC ではこれが剥がれず、
 * 定義者の権限で走る関数を誰でも呼べる状態が残る（015・019・091 で3度起きた）。
 *
 * 本体が auth.uid() を見ているかでは判定できない。091 の bump_desk_traffic は
 * 「持ち主の閲覧を数えない」ために auth.uid() を読んでいたが、呼び出し元の確認ではなかった。
 * なので「anon と authenticated のそれぞれについて、作った後に GRANT か REVOKE で
 * 明示したか」だけを見る。既定の権限に任せたままの関数を止める。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** anon / 利用者の JWT で Supabase を呼ぶコードの置き場所。手元スクリプト（service_role）は含めない */
const CLIENT_CODE_DIRS = ['src', 'landing/app', 'landing/components', 'landing/lib', 'landing/worker', 'worker/src', 'supabase/functions']

export function readClientCode(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(readFileSync(path, 'utf8'))
    }
  }
  for (const dir of CLIENT_CODE_DIRS) if (existsSync(join(root, dir))) walk(join(root, dir))
  return out
}

/**
 * 取得されていない submodule（landing / worker）。CI は submodule を取らないので、そこでしか
 * 呼ばない関数（get_public_desk_page・get_link_shared_desk_meta など）が未使用に見える。
 * 欠けているときは未使用の判定を下さない。
 */
export function missingSubmodules(root: string): string[] {
  return ['landing', 'worker'].filter((dir) => !existsSync(join(root, dir, 'package.json')))
}

export interface SqlFile {
  name: string
  text: string
}

export interface FunctionGrantProblem {
  fn: string
  file: string
  reason: string
}

type RoleState = 'default' | 'granted' | 'revoked'

interface FunctionState {
  file: string
  definer: boolean
  trigger: boolean
  searchPath: boolean
  anon: RoleState
  authenticated: RoleState
}

const CREATE_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi
const DROP_RE = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi
const GRANT_RE = /\b(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([^)]*\)\s+(?:TO|FROM)\s+([^;]+);/gi
const GRANT_ALL_RE = /\b(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+public\s+(?:TO|FROM)\s+([^;]+);/gi

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, (line) => ' '.repeat(line.length))
}

/** CREATE の位置から、本体の前後（LANGUAGE・SECURITY・SET が書かれうる所）を取り出す */
function functionHeader(sql: string, start: number): string {
  const rest = sql.slice(start)
  const tag = /AS\s+(\$\w*\$)/i.exec(rest)
  if (!tag) return rest.slice(0, rest.indexOf(';') + 1)
  const bodyStart = tag.index + tag[0].length
  const bodyEnd = rest.indexOf(tag[1], bodyStart)
  const trailerEnd = rest.indexOf(';', bodyEnd)
  return rest.slice(0, tag.index) + rest.slice(bodyEnd + tag[1].length, trailerEnd + 1)
}

function applyRoles(state: FunctionState, verb: string, roles: string): void {
  const next: RoleState = verb.toUpperCase() === 'GRANT' ? 'granted' : 'revoked'
  for (const role of roles.split(',').map((r) => r.trim().toLowerCase())) {
    if (role === 'anon') state.anon = next
    if (role === 'authenticated') state.authenticated = next
  }
}

function collectFunctions(files: SqlFile[]): Map<string, FunctionState> {
  const functions = new Map<string, FunctionState>()

  for (const file of files) {
    const sql = stripComments(file.text)
    const events: Array<{ at: number; run: () => void }> = []

    for (const m of sql.matchAll(CREATE_RE)) {
      events.push({
        at: m.index,
        run: () => {
          const name = m[1].toLowerCase()
          const header = functionHeader(sql, m.index)
          const previous = functions.get(name)
          functions.set(name, {
            file: file.name,
            definer: /SECURITY\s+DEFINER/i.test(header),
            trigger: /RETURNS\s+TRIGGER/i.test(header),
            searchPath: /SET\s+search_path/i.test(header),
            // CREATE OR REPLACE は既存の権限を引き継ぐ。新しく作ったときだけ既定に戻る
            anon: previous?.anon ?? 'default',
            authenticated: previous?.authenticated ?? 'default',
          })
        },
      })
    }
    for (const m of sql.matchAll(DROP_RE)) {
      events.push({ at: m.index, run: () => { functions.delete(m[1].toLowerCase()) } })
    }
    for (const m of sql.matchAll(GRANT_RE)) {
      events.push({
        at: m.index,
        run: () => {
          const state = functions.get(m[2].toLowerCase())
          if (state) applyRoles(state, m[1], m[3])
        },
      })
    }
    for (const m of sql.matchAll(GRANT_ALL_RE)) {
      events.push({
        at: m.index,
        run: () => { for (const state of functions.values()) applyRoles(state, m[1], m[2]) },
      })
    }

    events.sort((a, b) => a.at - b.at).forEach((event) => event.run())
  }
  return functions
}

export function auditFunctionGrants(files: SqlFile[]): FunctionGrantProblem[] {
  const functions = collectFunctions(files)
  const problems: FunctionGrantProblem[] = []
  for (const [fn, state] of [...functions].sort(([a], [b]) => a.localeCompare(b))) {
    if (!state.definer) continue
    if (!state.searchPath) {
      problems.push({ fn, file: state.file, reason: 'SET search_path が無い（呼び出し側のスキーマの同名オブジェクトを掴む）' })
    }
    // トリガ関数は RPC から直接呼べない（呼ぶと実行時エラーになる）
    if (state.trigger) continue
    const undecided = (['anon', 'authenticated'] as const).filter((role) => state[role] === 'default')
    if (undecided.length > 0) {
      problems.push({
        fn,
        file: state.file,
        reason: `${undecided.join(' / ')} への実行権限を明示していない（REVOKE ... FROM PUBLIC だけでは Supabase の既定の付与が残る）`,
      })
    }
  }
  return problems
}

/**
 * anon / authenticated に実行を渡しているのに、クライアントのコードからも SQL（ポリシー・
 * 他の関数）からも呼ばれていない SECURITY DEFINER 関数を探す。
 *
 * 上の検査は「権限を明示したか」しか見ないので、明示して付与したまま使われなくなった関数は
 * 通ってしまう。009 / 040 の公開処理は publish_desk_snapshot に置き換わった後も、028 の統計は
 * 使う画面が無いまま、ログインした人なら誰でも直接叩ける状態で残っていた（109 で外した）。
 * アプリの URL と anon キーは取り出せるので、使っていない入口もそのまま攻撃面になる。
 *
 * `clientCode` には anon / 利用者の JWT で呼ぶコード（アプリ・Web・worker・Edge Functions）だけを渡す。
 * service_role で呼ぶ手元スクリプトでしか使わないなら、クライアントへの付与は要らない。
 */
export function auditUnusedClientFunctions(files: SqlFile[], clientCode: string[]): FunctionGrantProblem[] {
  const functions = collectFunctions(files)
  const code = clientCode.join('\n')
  const sql = files.map((file) => stripComments(file.text)).join('\n')
  const problems: FunctionGrantProblem[] = []
  for (const [fn, state] of [...functions].sort(([a], [b]) => a.localeCompare(b))) {
    if (!state.definer || state.trigger) continue
    if (state.anon !== 'granted' && state.authenticated !== 'granted') continue
    // supabase.rpc('名前') と、fetch で叩く rpc/名前（Web は先頭の / 無しで組み立てる）の両方を拾う
    if (new RegExp(`(['"\`]|\\brpc/)${fn}\\b`).test(code)) continue
    // 定義・GRANT・REVOKE・COMMENT・DROP は「FUNCTION 名前(」の形なので、それ以外の呼び出しだけを数える
    const calledInSql = [...sql.matchAll(new RegExp(`\\b${fn}\\s*\\(`, 'gi'))]
      .some((m) => !/FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?$/i.test(sql.slice(Math.max(0, m.index - 40), m.index)))
    if (calledInSql) continue
    const roles = (['anon', 'authenticated'] as const).filter((role) => state[role] === 'granted')
    problems.push({
      fn,
      file: state.file,
      reason: `${roles.join(' / ')} に実行を渡しているが、クライアントのコードからも SQL からも呼ばれていない（不要なら REVOKE する）`,
    })
  }
  return problems
}
