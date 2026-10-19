import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { demoLayoutSignature, layoutFingerprintOf } from '../scripts/demoLayoutSignature'
import { buildDemoDesk, DEMO_DESKS } from '../src/constants/demoDesks'
import { ONBOARDING_WIRING_JSON } from '../src/constants/onboardingWiring.generated'
import { computeMapLayout, MapLayout } from '../src/utils/connectionMapLayout'
import { LAYOUT_VERSION } from '../src/utils/mapLayoutCache'

// 配線図の計算を変えたときの2つの手順（CLAUDE.md「配線を触るときの必須事項」）を機械で確かめる。
//   1. LAYOUT_VERSION を上げる。上げないと端末に保存された古い図が出続ける（直したのに直っていない）
//   2. npm run build:onboarding-wiring で焼き直す。焼かないと初回起動で見せる図だけが古いまま
// どちらも人の注意だけで守っていて、配線バグ調査で最初に疑う場所になっていた。
//
// 1 は焼き直しのスクリプトが止める（出力が変わったのに版が同じなら焼かない）。
// ここでは「焼き直したか」を見れば、1 も 2 も揃っていることになる。

const fixture = JSON.parse(readFileSync('tests/fixtures/layoutSignature.json', 'utf8')) as {
  layoutVersion: number
  signature: string
}
const baked = JSON.parse(ONBOARDING_WIRING_JSON) as {
  layoutVersion: number
  demoId: string
  width: number
  height: number
  nodes: MapLayout['nodes']
  edges: { conn: { id: string }; fromId: string; toId: string; points: { x: number; y: number }[] }[]
}

const REBAKE = 'npm run build:onboarding-wiring を実行する（出力が変わっていれば、先に src/utils/mapLayoutCache.ts の LAYOUT_VERSION を上げる）'

describe('LAYOUT_VERSION とオンボーディングの焼き込み', () => {
  it('記録した指紋が今の LAYOUT_VERSION のもの', () => {
    assert.equal(fixture.layoutVersion, LAYOUT_VERSION, `LAYOUT_VERSION を変えたあと焼き直していない。${REBAKE}`)
  })

  it('配線図の出力が、記録した指紋から変わっていない', async () => {
    assert.equal(await demoLayoutSignature(), fixture.signature, `配線図の出力が変わった。${REBAKE}`)
  })

  it('オンボーディングに焼いた図が、今の計算結果と同じ', async () => {
    assert.equal(baked.layoutVersion, LAYOUT_VERSION, `焼いた図の版が古い。${REBAKE}`)
    const demo = DEMO_DESKS.find((d) => d.id === baked.demoId)
    assert.ok(demo, `焼いた図の元のデモデスク ${baked.demoId} が無い`)
    // scripts/buildOnboardingWiring.ts と同じ入力
    const built = buildDemoDesk(demo, 'ja')
    const fresh = await computeMapLayout(
      built.activeGadgets.filter((g) => g.category !== 'Cable'),
      built.plan.connectionMap?.connections ?? [],
      built.plan.placements,
      {},
      {},
      !!built.plan.templateId,
    )
    const byId = new Map(baked.nodes.map((n) => [n.id, n]))
    const bakedLayout = {
      nodes: baked.nodes,
      edges: baked.edges.map((e) => ({ conn: e.conn, from: byId.get(e.fromId)!, to: byId.get(e.toId)!, points: e.points })),
      width: baked.width,
      height: baked.height,
    } as unknown as MapLayout
    assert.deepEqual(layoutFingerprintOf(bakedLayout), layoutFingerprintOf(fresh), `焼いた図が古い。${REBAKE}`)
  })
})
