import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPublicContentAllowed, collectPublicTexts, findPublicContentIssue } from '../src/utils/publicContentModeration'

describe('public content moderation', () => {
  it('allows ordinary desk and product names', () => {
    assert.equal(findPublicContentIssue({
      title: '仕事用デスク 2026',
      ownerName: 'desk_user',
      gadgetNames: ['MacBook Pro', 'Dell U2723QE'],
    }), null)
  })

  it('rejects an email address in public identity fields', () => {
    assert.equal(findPublicContentIssue({ title: '連絡先 test@example.com' }), 'personal_information')
  })

  it('rejects link spam in public identity fields', () => {
    assert.equal(findPublicContentIssue({ title: 'https://a.example https://b.example' }), 'spam')
  })

  it('rejects clearly prohibited content', () => {
    assert.equal(findPublicContentIssue({ title: 'desk', gadgetNames: ['child pornography'] }), 'prohibited_content')
  })

  // 自由記入欄（メモ・ソフト設定・固定方法の補足・運用モード）も公開スナップショットに
  // 入る。名前に書けないものがメモになら書ける、という抜け道を塞げているかを見る
  it('rejects an email address written in a free-text field', () => {
    assert.equal(findPublicContentIssue({
      title: '仕事用デスク',
      freeTexts: ['譲ってもらった。連絡先 test@example.com'],
    }), 'personal_information')
  })

  it('rejects link spam written in a free-text field', () => {
    assert.equal(findPublicContentIssue({
      title: '仕事用デスク',
      freeTexts: ['https://a.example と https://b.example で購入'],
    }), 'spam')
  })

  it('rejects prohibited content written in a free-text field', () => {
    assert.equal(findPublicContentIssue({
      title: 'desk',
      freeTexts: ['child pornography'],
    }), 'prohibited_content')
  })

  it('allows an ordinary memo', () => {
    assert.equal(findPublicContentIssue({
      title: '仕事用デスク',
      gadgetNames: ['MacBook Pro'],
      freeTexts: ['Thunderbolt 対応モニターへ買い替え。ケーブル1本化のきっかけ', ''],
    }), null)
  })

  it('throws a user-safe error without echoing rejected text', () => {
    assert.throws(
      () => assertPublicContentAllowed({ title: 'test@example.com' }),
      /メールアドレス/,
    )
  })
})

// 公開する物そのものから文面を拾えているか。欄を列挙する書き方に戻ると、
// ここで挙げている欄（型番・CPU・ゲーム名・置き場所ラベル・履歴だけの機材名）が
// また素通りするので、publishService が送る形のまま渡して確かめる
describe('collectPublicTexts', () => {
  const snapshot = {
    version: 3,
    snapshotCapturedAt: '2026-09-09T00:00:00.000Z',
    plan: {
      id: 'plan-1',
      name: '仕事用デスク',
      otherPurposeLabel: '写真の現像',
      placements: [{ gadgetId: 'g1', zone: 'desk_left', label: '窓側の棚' }],
      selectedGadgetIds: ['g1'],
      images: undefined,
    },
    gadgets: [
      { id: 'g1', name: 'MacBook Pro', model: 'A2779', pcCpu: 'M2 Pro', games: ['Factorio'], price: 300000 },
      // デスクから外して利用履歴だけ残った機材。名前は公開ページの履歴に出る
      { id: 'g2', name: 'Dell U2723QE', mounting: { targetGadgetId: 'g1', note: 'アームに共締め' } },
    ],
  }

  it('picks up every string the snapshot carries, however deep', () => {
    const texts = collectPublicTexts(snapshot)
    for (const expected of [
      '仕事用デスク', '写真の現像', '窓側の棚',
      'A2779', 'M2 Pro', 'Factorio',
      'Dell U2723QE', 'アームに共締め',
    ]) {
      assert.ok(texts.includes(expected), `missing: ${expected}`)
    }
  })

  it('leaves numbers, undefined and an ordinary snapshot alone', () => {
    assert.equal(collectPublicTexts(snapshot).includes(''), false)
    assert.equal(findPublicContentIssue({ title: '仕事用デスク', freeTexts: collectPublicTexts(snapshot) }), null)
  })

  it('catches an address hidden in a field nobody thought to list', () => {
    const withEmail = { ...snapshot, gadgets: [{ ...snapshot.gadgets[0], pcCpu: 'M2 Pro / 相談は test@example.com' }] }
    assert.equal(
      findPublicContentIssue({ title: '仕事用デスク', freeTexts: collectPublicTexts(withEmail) }),
      'personal_information',
    )
  })

  it('stops descending instead of hanging on self-referential data', () => {
    const cyclic: Record<string, unknown> = { name: '深いところの文字' }
    cyclic.self = cyclic
    const texts = collectPublicTexts(cyclic)
    // 同じ文字列を深さのぶんだけ拾うが、検査は文面を繋げて見るだけなので重複は害にならない
    assert.ok(texts.length > 0 && texts.length <= 12)
    assert.ok(texts.every((text) => text === '深いところの文字'))
  })
})

