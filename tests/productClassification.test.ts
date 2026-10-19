import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyProduct } from '../scripts/reclassifyProductCategories'

const classify = (name: string, category: string) => classifyProduct({
  id: 'test',
  name,
  category,
  source: 'rakuten',
  is_suggestable: true,
})

test('販売条件だけが違う楽天商品は候補から外す', () => {
  assert.equal(classify('Insta360 360度カメラレンタル ONE X2 3日間', 'SmallDevice').isSuggestable, false)
  assert.equal(classify('エレコム パッケージ傷み Oculus Meta Quest', 'VRGlass').isSuggestable, false)
})

test('本体カテゴリに混ざった周辺品を適切なカテゴリへ移す', () => {
  assert.equal(classify('EPSON EP-979A3 廃インクエラーリセットキー', 'Printer').category, 'Accessory')
  assert.equal(classify('サンワサプライ 静電気除去マウスパッド MPD-SE1BK', 'Controller').category, 'MousePad')
  assert.equal(classify('ASUS VivoBook Flip 14 TM420IA', 'Webcam').category, 'PC')
  assert.equal(classify('エレコム T-TS02-2330WH 3個口 3m', 'Headphone').category, 'PowerStrip')
})

test('ソフトウェア・交換部品は候補から外す', () => {
  assert.equal(classify('INTERNET VOCALOID6 Voicebank AI 結月ゆかり', 'AudioInterface').isSuggestable, false)
  assert.equal(classify('PS5 交換 10セット L2R2タイプ スプリングL2 R2', 'Controller').isSuggestable, false)
})

test('テンキーレスキーボードをテンキーに分類しない', () => {
  assert.equal(classify('エレコム ゲーミングキーボード テンキーレス TK-GK20TBK', 'Keyboard').subcategory, 'gaming')
})

test('追加監査で見つかった本体以外の商品を仕分ける', () => {
  assert.equal(classify('Pokemon LEGENDS Z-A Nintendo Switch 2 Edition', 'GameConsole').isSuggestable, false)
  assert.equal(classify('Technics Slipmats スリップマット', 'Mixer').category, 'Accessory')
  assert.equal(classify('ELECOM BST-15CR ケーブルを整理するチューブ', 'SmallDevice').category, 'Accessory')
  assert.equal(classify('Panasonic フィードインキャップ DH2721', 'Modem').isSuggestable, false)
  assert.equal(classify('Serato Control Vinyl コントロールバイナル', 'Mixer').category, 'Accessory')
  assert.equal(classify('東芝DynaBook PAME1003対応1GBメモリ PC2-4200', 'SmallDevice').category, 'PCPart')
})

test('商品名にイヤホンが含まれる別機器をイヤホンへ誤分類しない', () => {
  assert.equal(classify('Twelve South AirFly Bluetoothトランスミッター イヤホン対応', 'Earphone').category, 'SmallDevice')
  assert.equal(classify('Shokz OpenComm2 骨伝導ヘッドセット イヤホン', 'Earphone').category, 'Headphone')
  assert.equal(classify('Maono オーディオインターフェイス マイク イヤホンセット', 'Microphone').category, 'AudioInterface')
})
