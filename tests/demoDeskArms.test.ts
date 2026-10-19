import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { armMountCategory } from '../src/utils/gadgetPorts'

// アームの絵はモニター・マイク自身の「アームを使用」だけで出る。デモは現役の構成を
// activeGadgetIds で絞っているので、アーム本体を外したのに印だけが残ると、機材一覧に
// 無いアームがモニターに付いて見える（3つのデモすべてで起きていた）
describe('公式デモのアーム', () => {
  const built = buildAllDemoDesks('ja')

  it('アームを使用しているモニター・マイクは、現役のアームに支えられている', () => {
    for (const desk of built) {
      const connections = desk.plan.connectionMap?.connections ?? []
      for (const gadget of desk.activeGadgets) {
        const armType = armMountCategory(gadget)
        if (!armType) continue
        const supported = connections.some((c) =>
          c.cableType === armType && (c.fromGadgetId === gadget.id || c.toGadgetId === gadget.id))
        assert.ok(supported, `${desk.demo.id}: ${gadget.id} に ${armType} の印があるが、支えるアームが構成に無い`)
      }
    }
  })
})
