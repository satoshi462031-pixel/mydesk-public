import assert from 'node:assert/strict'
import test from 'node:test'
import { CABLE_TYPE_OPTIONS } from '../src/constants/gadgetFormOptions'
import { CABLE_SORT_ORDER, cableLabel } from '../src/constants/portTypes'
import type { CableType } from '../src/types'

// ケーブルの種類の選択肢は、ガジェットの追加画面と詳細画面が共有する。
// 2画面に同じ配列を手で書いていた頃に片方だけ6種類（DC電源・RCA 系・XLR/TRS コンボ・
// 6.3mm TS）が足され、共通化のときに短いほうを採ってその6種類が選べなくなった。
// 型は配列から要素を削っても通り、配線エンジンのテストも監査も「画面が何を選ばせるか」は
// 見ないので、減ったことに気付けるのはここだけ。
//
// 全 CableType を出すわけではない（USB_A など片側だけの型は選択肢に出さない）ので、
// 機械的な不変条件は作れない。件数の下限と、過去に消えた値を留め置く。
const MIN_OPTIONS = 34

test('ケーブルの種類の選択肢が減っていない', () => {
  assert.ok(
    CABLE_TYPE_OPTIONS.length >= MIN_OPTIONS,
    `選択肢が ${CABLE_TYPE_OPTIONS.length} 種類に減っている（下限 ${MIN_OPTIONS}）。`
    + '意図して外したなら MIN_OPTIONS も一緒に直すこと',
  )
})

// 一度消えた値。同じ取りこぼしをもう一度しないための見張り
test('片方の画面にしか無かった種類が残っている', () => {
  const required: CableType[] = ['DCPower', 'RCA', 'RCA_to_3_5mm', 'RCA_to_6_3mm', 'XLR_TRS_Combo', 'Audio6_3mm_TS']
  const missing = required.filter((type) => !CABLE_TYPE_OPTIONS.includes(type))
  assert.deepEqual(missing, [], `選択肢から落ちている: ${missing.join(', ')}`)
})

test('同じ種類を二重に並べていない', () => {
  const seen = new Set<CableType>()
  const duplicated = CABLE_TYPE_OPTIONS.filter((type) => (seen.has(type) ? true : (seen.add(type), false)))
  assert.deepEqual(duplicated, [])
})

// 表示名は cableLabel、並び順は CABLE_SORT_ORDER から引く。どちらかに無い値を選択肢へ足すと、
// 画面には型名がそのまま出て、ケーブル節では末尾に落ちる
test('すべての選択肢に表示名と並び順がある', () => {
  const noLabel = CABLE_TYPE_OPTIONS.filter((type) => {
    const ja = cableLabel(type, 'ja')
    const en = cableLabel(type, 'en')
    return !ja || !en || ja === type || en === type
  })
  assert.deepEqual(noLabel, [], `表示名が無い: ${noLabel.join(', ')}`)

  const noRank = CABLE_TYPE_OPTIONS.filter((type) => !CABLE_SORT_ORDER.includes(type))
  assert.deepEqual(noRank, [], `並び順の表（CABLE_SORT_ORDER）に無い: ${noRank.join(', ')}`)
})
