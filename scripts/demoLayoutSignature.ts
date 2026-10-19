import { createHash } from 'node:crypto'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { computeMapLayout, MapLayout } from '../src/utils/connectionMapLayout'

// デモデスク（日英）の配線図の出力を1つのハッシュにまとめる。
//
// 端末は配線図を LAYOUT_VERSION ごとに保存していて（mapLayoutCache）、計算を変えたのに
// 版を上げないと、利用者の端末では古い図が出続ける。この指紋を版と組にして記録し
// （tests/fixtures/layoutSignature.json）、「出力が変わったのに版が同じ」を機械的に止める。
// 書き込むのは npm run build:onboarding-wiring、照合するのは tests/layoutVersionGuard.test.ts。
//
// デモデスクのデータだけを変えた場合も指紋は変わる。そのときも版を上げてよい
// （端末のキャッシュが一度作り直されるだけで、害はない）。

export const layoutFingerprintOf = (layout: MapLayout) => ({
  nodes: layout.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h, n.tier]),
  edges: layout.edges.map((e) => [e.conn.id, e.from.id, e.to.id, e.points]),
  size: [layout.width, layout.height],
})

export async function demoLayoutSignature(): Promise<string> {
  const hash = createHash('sha1')
  for (const lang of ['ja', 'en'] as const) {
    for (const built of buildAllDemoDesks(lang)) {
      // 画面（WiringResultScreen / ConnectionMap）と同じ入力。ケーブルは配線図に渡さない
      const layout = await computeMapLayout(
        built.activeGadgets.filter((g) => g.category !== 'Cable'),
        built.plan.connectionMap?.connections ?? [],
        built.plan.placements,
        {},
        {},
        !!built.plan.templateId,
      )
      hash.update(`${built.plan.id}:${lang}:`).update(JSON.stringify(layoutFingerprintOf(layout)))
    }
  }
  return hash.digest('hex')
}
