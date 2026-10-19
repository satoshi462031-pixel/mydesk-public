import assert from 'node:assert/strict'
import { extractProductModel, prioritizeProductIdentity, sanitizeProductName } from '../src/utils/productName'

const longName = 'Anker Prime Charger 海外旅行対応 USB-C 4ポート GaN採用 折りたたみ式プラグ PSE技術基準適合 ブラック'

assert.equal(sanitizeProductName(longName), longName)
assert.ok([...sanitizeProductName(longName, 48)].length <= 48)
assert.equal(sanitizeProductName('【送料無料】Anker &amp; USB-C 充電器'), 'Anker & USB-C 充電器')
assert.equal(
  prioritizeProductIdentity(
    'チューナーレステレビ Philips 50型 4K HDMI2.1 60Hz Google TV 50PUH7169/11 Dolby Atmos',
    'Philips',
  ),
  'Philips 50PUH7169/11 チューナーレステレビ 50型 4K HDMI2.1 60Hz Google TV Dolby Atmos',
)
assert.equal(
  prioritizeProductIdentity('Philips 43PUH7169 43型 4K 60Hz HDMI2.1', 'Philips'),
  'Philips 43PUH7169 43型 4K 60Hz HDMI2.1',
)
assert.equal(
  prioritizeProductIdentity('Meta メタ Quest 3 512GB 899-0', 'Meta'),
  'Meta メタ Quest 3 512GB 899-0',
)
assert.equal(
  prioritizeProductIdentity('CANON LP-E17対応縦充電式USB充電器', 'Canon'),
  'Canon LP-E17 対応縦充電式USB充電器',
)
assert.equal(extractProductModel('Philips 50PUH7169/11 チューナーレステレビ'), '50PUH7169/11')
assert.equal(extractProductModel('Meta Quest 3 512GB 120Hz'), undefined)
assert.equal(extractProductModel('WINTEN 1080P モニター 15.6インチ WT-156H2-BS'), 'WT-156H2-BS')
assert.equal(extractProductModel('kksmart 730g 2K 2560x1600 PS5/XBOX/Switch/PC/Mac NK-16G'), 'NK-16G')
assert.equal(extractProductModel('VisionOwl FHD1920 400nit モニター MD-14T'), 'MD-14T')
assert.equal(extractProductModel('Lenovo SSD512GB RAM16GB Windows11'), undefined)
assert.equal(extractProductModel('Dell Core i5-1334U Office2024'), undefined)
assert.equal(extractProductModel('ASUTAS 10000LM 1080P Android16'), undefined)

console.log('商品名の省略・整形チェックに成功しました')
