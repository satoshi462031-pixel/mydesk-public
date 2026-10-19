import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { localizedGadgetMemo, localizedGadgetName } from '../src/utils/localizedGadgetName'

// 公式デモは日本語で1回だけ公開し、英語で見る人には表示側で差し替えている。
// 差し替えの表は ID を手で並べたものなので、デモの構成（現役・履歴に出す機材）を
// 変えたときに漏れる。公開される機材だけを対象に、英語表示へ日本語が残らないことを確かめる
const JAPANESE = /[぀-ヿ一-鿿]/
// 言語に関係なく表示される仕様欄。ここに日本語を書くと英語画面にそのまま出る
const SPEC_FIELDS = ['model', 'pcCpu', 'pcGpu', 'pcRam', 'pcStorage'] as const

describe('公式デモの英語表示', () => {
  const built = buildAllDemoDesks('ja')

  it('165Hz モニターの名称・モデルと詳細仕様が一致する', () => {
    const monitors = built.flatMap((desk) => desk.gadgets).filter((gadget) => gadget.name.includes('165Hz'))
    assert.ok(monitors.length > 0)
    for (const monitor of monitors) {
      assert.equal(monitor.monitorRefreshRateHz, '165')
      assert.equal(monitor.model, 'FHD 165Hz')
    }
  })

  it('検査の対象が空になっていない', () => {
    assert.ok(built.length > 0)
    assert.ok(built.every((desk) => desk.gadgets.length > 0))
  })

  for (const desk of built) {
    it(`${desk.demo.id}: 公開される機材の名前・メモ・仕様に日本語が残らない`, () => {
      const leaks: string[] = []
      for (const gadget of desk.gadgets) {
        const name = localizedGadgetName(gadget, 'en')
        if (JAPANESE.test(name)) leaks.push(`${gadget.id} name: ${name}`)
        const memo = localizedGadgetMemo(gadget, 'en')
        if (memo && JAPANESE.test(memo)) leaks.push(`${gadget.id} memo: ${memo}`)
        for (const field of SPEC_FIELDS) {
          const value = gadget[field]
          if (typeof value === 'string' && JAPANESE.test(value)) leaks.push(`${gadget.id} ${field}: ${value}`)
        }
      }
      assert.deepEqual(leaks, [])
    })
  }
})
