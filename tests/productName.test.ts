import assert from 'node:assert/strict'
import test from 'node:test'
import { productIdentity, sanitizeProductName, summarizeProductName } from '../src/utils/productName'
import { localizedGadgetName, localizeProductCategoryTerms } from '../src/utils/localizedGadgetName'
import { Gadget } from '../src/types'

test('HTMLエンティティを解いてから記号として落とす', () => {
  assert.equal(
    sanitizeProductName('BUFFALO バッファロー BSL10 &lt;ワイヤー巻き取り式ダイヤルロック&gt;'),
    'BUFFALO バッファロー BSL10 ワイヤー巻き取り式ダイヤルロック',
  )
})

test('販促の売り文句を落とす', () => {
  const cases: Array<[string, string]> = [
    ['［楽天ランキング1位獲得］ YAMAHA MS101-4 パワードモニタースピーカー', 'YAMAHA MS101-4 パワードモニタースピーカー'],
    ['VGP2025 企画賞-映像音響部会 Dangbei MP1 Max プロジェクター', 'Dangbei MP1 Max プロジェクター'],
    ['VGP2026 SUMMER受賞 フィリップス サウンドバー', 'フィリップス サウンドバー'],
    ['最安値に挑戦中！ UGREEN SDカードリーダー', 'UGREEN SDカードリーダー'],
    ['SALE 翌日発送 Razer Hammerhead Pro V2', 'Razer Hammerhead Pro V2'],
    ['敬老の日 盆栽 もみじ 鉢植え', '盆栽 もみじ 鉢植え'],
  ]
  for (const [raw, expected] of cases) assert.equal(sanitizeProductName(raw), expected, raw)
})

// 仕様表記まで巻き込むと、型番やサイズが名前から消えて別商品と区別できなくなる
// 以下の例は商品マスタ2万件の監査で実際に表示名に残っていた表記
test('販促文言を消したあとの破片を残さない', () => {
  const cases: Array<[string, string]> = [
    ['ESR 万P iPad mini 7', 'ESR iPad mini 7'],
    ['ヤマハ 円CP＋ ！！7 25 SR-X40', 'ヤマハ SR-X40'],
    ['Omikamo ✨ で4 782円！ Bluetooth＆ワイヤレス', 'Omikamo Bluetooth＆ワイヤレス'],
    ['JBL 9 1AM10：00〜 TUNE BEAM', 'JBL TUNE BEAM'],
    ['Huawei 木村拓哉CM WATCH FIT 5', 'Huawei WATCH FIT 5'],
    ['Lenovo 短納期 公式・直販 レノボ公式 GX30K79401', 'Lenovo レノボ GX30K79401'],
    ['Amazfit 10％ Bip Max', 'Amazfit Bip Max'],
  ]
  for (const [raw, expected] of cases) assert.equal(sanitizeProductName(raw), expected, raw)
})

test('在庫・配送の表記と店舗の管理コードを落とす', () => {
  const cases: Array<[string, string]> = [
    ['Brother TN-291BK 目安在庫=○', 'Brother TN-291BK'],
    ['SANWA PRS-S100HD ▼246-3723 個人宅様送り不可', 'SANWA PRS-S100HD'],
    ['ELECOM TK-FCP097WH rb_ keyboard_cpn', 'ELECOM TK-FCP097WH'],
    ['Yamaha MG06 の場合1~3営業日で出荷可能', 'Yamaha MG06'],
    ['ADR-CFN2X5 個数：1個 直送 代引不可・他メーカー同梱不可', 'ADR-CFN2X5'],
    ['Amazon Echo Dot 第5世代 B09B8P3RK1', 'Amazon Echo Dot 第5世代'],
    ['JBL Grip JAN 4968929225422', 'JBL Grip'],
    ['WINTEN HDMI 単体では使えません。映像 送信機', 'WINTEN HDMI 映像 送信機'],
  ]
  for (const [raw, expected] of cases) assert.equal(sanitizeProductName(raw), expected, raw)
})

test('見た目が同じ別の文字と化けた文字を揃える', () => {
  const cases: Array<[string, string]> = [
    // U+2212 のままだと「MM-HSU07BK」で検索しても当たらない
    ['サンワサプライ USBヘッドセット MM−HSU07BK', 'サンワサプライ USBヘッドセット MM-HSU07BK'],
    ['オーディオテクニカ ATH-GDL3 ワイヤ—ドゲーミングヘッドセット', 'オーディオテクニカ ATH-GDL3 ワイヤードゲーミングヘッドセット'],
    ['AMD Ryzen&trade; 9 5900XT', 'AMD Ryzen 9 5900XT'],
    ['KAZE FLEX? 120 PWM', 'KAZE FLEX 120 PWM'],
    ['エレコム USB3．0 UC-TV6BK', 'エレコム USB3.0 UC-TV6BK'],
  ]
  for (const [raw, expected] of cases) assert.equal(sanitizeProductName(raw), expected, raw)
})

test('楽天の実績・販売店・期限・配送方法・ハッシュタグを落とす', () => {
  const cases: Array<[string, string]> = [
    ['楽天10冠 座椅子 肘掛け 回転', '座椅子 肘掛け 回転'],
    ['HP ENVY 世界シェアNo.1 スマホ印刷', 'HP ENVY スマホ印刷'],
    ['BoYata 日本独占販売店 N-21 PCスタンド', 'BoYata N-21 PCスタンド'],
    ['HP 万 当たる 8 23まで 7CZ37A#ABJ', 'HP 7CZ37A#ABJ'],
    ['東芝 7 30~8 1 PA5177U-1ACA', '東芝 PA5177U-1ACA'],
    ['個装箱なし #リズム時計 #デジタル #電波', 'リズム時計 デジタル 電波'],
    ['Keychron B1 Pro ワイヤレスキーボード_マルチペアリング_75%_', 'Keychron B1 Pro ワイヤレスキーボード マルチペアリング 75%'],
    ['HD023 4Kメディアプレーヤー 2024年版 *2160p', 'HD023 4Kメディアプレーヤー 2024年版 2160p'],
    ['肩こり・猫背を解消！ ノートパソコンスタンド', '肩こり・猫背を解消 ノートパソコンスタンド'],
  ]
  for (const [raw, expected] of cases) assert.equal(sanitizeProductName(raw), expected, raw)
  // 型番・弦の番号・英字の製品名・ゲームの題名に含まれる記号は残す
  for (const name of ['XP-PEN Artist Ultra 16 AUT160UH_JP', 'Western Digital WD_BLACK', 'Elixir Nanoweb #11027', 'Ugreen USB-C*2', 'Creative Live! Audio A3', 'Nintendo Switch ふたりで!にゃんこ大戦争']) {
    assert.equal(sanitizeProductName(name), name, name)
  }
})

test('重なった販促語・枕詞・切り詰めで浮いた前置詞を落とす', () => {
  const cases: Array<[string, string]> = [
    ['ソニー 無料長期保証 KJ-50X83L', 'ソニー KJ-50X83L'],
    ['KAWAI 配送設置無料 ＆ 不要ピアノ引取処分無料 CA701', 'KAWAI CA701'],
    ['Ennice bluetooth 2026年新型モデル 売れ筋上位', 'Ennice bluetooth 2026年新型モデル'],
    ['⭐ で最安10480円！⭐常連 ファン付 LED', 'ファン付 LED'],
    ['対応・ TRUSCO ジョイント金具24型', 'TRUSCO ジョイント金具24型'],
    ['Razer BlackShark V3 Pro for', 'Razer BlackShark V3 Pro'],
    ['AMD Ryzen 5 8600G BOX with', 'AMD Ryzen 5 8600G BOX'],
    ['Ugreen 8 4から！マラソン Revodok 1071', 'Ugreen Revodok 1071'],
  ]
  for (const [raw, expected] of cases) assert.equal(sanitizeProductName(raw), expected, raw)
  // 大文字の X は製品名
  for (const name of ['Microsoft Xbox Series S X', 'RICOH THETA X']) assert.equal(sanitizeProductName(name), name, name)
})

// brand 列が「USB-A」だった頃に頭の語を brand として剥がした製品名が残っている
test('保存済みの製品名から剥がされた頭の語を元タイトルから戻す', () => {
  assert.equal(productIdentity('USB-A to USB-C 充電ケーブル 3A急速充電', null, 'to USB-C 充電ケーブル 3A急速充電').displayName, 'USB-A to USB-C 充電ケーブル 3A急速充電')
  assert.equal(productIdentity('Surface Laptop 5 4 3', null, 'Laptop 5 4 3').displayName, 'Surface Laptop 5 4 3')
  // 頭の語が雰囲気語なら戻した上で落とす
  assert.equal(productIdentity('おしゃれ 観葉植物 7号鉢', null, '観葉植物 7号鉢').displayName, '観葉植物 7号鉢')
})

test('保存済みの製品名から落ちた末尾の + を元タイトルから戻す', () => {
  assert.equal(productIdentity('RØDE PSA1+', 'RØDE', 'PSA1').displayName, 'RØDE PSA1+')
  assert.equal(productIdentity('SHURE MV88+ : MOTIVシリーズ', 'Shure', 'MV88 MOTIVシリーズ').displayName, 'Shure MV88+ MOTIVシリーズ')
  // 元タイトルに + の無い版もあるなら戻さない
  assert.equal(productIdentity('Dangbei Atom HDR10 HDR10+', 'Dangbei', 'Atom HDR10').displayName, 'Dangbei Atom HDR10')
})

// + や ! は製品名の一部。末尾の + を区切りとして消すと MV88+ が別製品の MV88 になる
test('製品名の一部になっている記号は残す', () => {
  for (const name of ['Shure MOTIV MV88+', 'RØDE PSA1+', 'Samsung Galaxy S26+', 'be quiet! Pure Base 500', "D'Addario EJ16", 'Astell&Kern AK70 MKII', 'Sony α7C II']) {
    assert.equal(sanitizeProductName(name), name, name)
  }
})

test('削除で崩れた区切りと囲みを直す', () => {
  const cases: Array<[string, string]> = [
    ['Lenovo IdeaPad Duet Chromebook と', 'Lenovo IdeaPad Duet Chromebook'],
    ['NEC ≪ ≫ WIFI 無線lanルーター', 'NEC WIFI 無線lanルーター'],
    ['Crucial SSD R:540MB s W:500MB BX500', 'Crucial SSD R:540MB/s W:500MB BX500'],
    ['TP-Link 5ポート 10 100 1000Mbps', 'TP-Link 5ポート 10/100/1000Mbps'],
    ['Bluetoothテンキー ≪サンワサプライ≫ NT-BT23BK', 'Bluetoothテンキー サンワサプライ NT-BT23BK'],
    ['エレコム 疲労軽減パームレスト｢FITTIO｣ PC', 'エレコム 疲労軽減パームレスト FITTIO PC'],
  ]
  for (const [raw, expected] of cases) assert.equal(sanitizeProductName(raw), expected, raw)
})

// 語の途中で切ると「バックパッククリッ」のように別の語に見える
test('文字数で切るときは語の切れ目で切る', () => {
  assert.equal(
    sanitizeProductName('AKASO Brave 7 LE アクションカメラ+128GBメモリーカード+バックパッククリップ', 40),
    'AKASO Brave 7 LE アクションカメラ+128GBメモリーカード',
  )
})

test('括弧の中身が仕様なら残す', () => {
  assert.equal(
    sanitizeProductName('REGZA 液晶テレビ55V型 REGZA 55M550M ［55V型 /Bluetooth対応］'),
    'REGZA 液晶テレビ55V型 REGZA 55M550M ［55V型 /Bluetooth対応］',
  )
  assert.equal(
    sanitizeProductName('DENON プリメインアンプ［PMA900HNE］ デノン'),
    'DENON プリメインアンプ［PMA900HNE］ デノン',
  )
})

// ♭ は絵文字ではなく音楽記号。楽器の商品名から落とすと別の型番に見える
test('音楽記号や型番の記号は落とさない', () => {
  assert.equal(
    sanitizeProductName('Vandoren B♭クラリネットリード Traditional'),
    'Vandoren B♭クラリネットリード Traditional',
  )
  assert.equal(
    sanitizeProductName('UGREEN SDカードリーダー Type-C OTG対応 SD & TF'),
    'UGREEN SDカードリーダー Type-C OTG対応 SD & TF',
  )
})

// 実体を偽るので、中古・レンタル・アウトレットは名前から消さない（監査で可視化する側の話）
test('商品の状態を表す語は消さない', () => {
  assert.equal(
    sanitizeProductName('レンタル 1泊2日〜EPSON 液晶プロジェクター EB-990U'),
    'レンタル 1泊2日〜EPSON 液晶プロジェクター EB-990U',
  )
  assert.match(sanitizeProductName('Insta360 アウトレット GO Ultra用 ピボットスタンド'), /アウトレット/)
})

test('ブランドと製品名だけに詰める', () => {
  const cases: Array<[string, string, string]> = [
    [
      'SONY｜ソニー ブルートゥーススピーカー ULT FIELD1 フォレストグレー SRS-ULT10HC [防水 /Bluetooth対応]',
      'SONY',
      'SONY ULT FIELD1 SRS-ULT10HC',
    ],
    [
      'M-AUDIO Keystation Mini32 MK3 32鍵盤 MIDIキーボード エムオーディオ',
      'M-AUDIO',
      'M-AUDIO Keystation Mini32 MK3 MIDIキーボード',
    ],
    [
      'USBメモリ 64GB SanDisk サンディスク Cruzer Glide USB3.0対応 超高速 SDCZ600-064G-G35 パッケージ品',
      'SanDisk',
      'SanDisk 64GB Cruzer Glide 超高速 SDCZ600-064G-G35',
    ],
  ]
  for (const [raw, brand, expected] of cases) {
    assert.equal(summarizeProductName(raw, brand, 60), expected, raw)
  }
})

test('派生モデルを区別する末尾の語を落とさない', () => {
  assert.equal(
    summarizeProductName('Amazon Fire TV Stick 4K Plus ブラック', 'Amazon'),
    'Amazon Fire TV Stick 4K Plus',
  )
  assert.equal(
    productIdentity('Amazon Fire TV Stick 4K Plus ブラック', 'Amazon').displayName,
    'Amazon Fire TV Stick 4K Plus',
  )
})

test('容量違いの商品を同じ表示名へ潰さない', () => {
  assert.equal(
    summarizeProductName('WINTEN ノートPC用 メモリ DDR4 2400 PC4-19200 8GB 260Pin CL17 WT-SD2400-8GB', 'WINTEN'),
    'WINTEN DDR4 2400 PC4-19200 8GB 260Pin CL17 WT-SD2400-8GB',
  )
  assert.equal(
    summarizeProductName('Transcend スティックSSD 128GB ESD310 ポータブルSSD TS128GESD310C', 'Transcend'),
    'Transcend スティックSSD 128GB ESD310 ポータブルSSD TS128GESD310C',
  )
})

test('既存の表示名を40文字で再切断しない', () => {
  const stored = 'ABP-R03-MS Abaniact Bluetooth天井埋込スピーカーセット'
  assert.equal(productIdentity(stored, null, stored).displayName, stored)
})

// 型番は製品を特定する唯一の手がかりなので、単位と間違えて落とさない
test('型番を単位と取り違えない', () => {
  assert.match(
    summarizeProductName('MSI｜エムエスアイ PCケース [ATX /Micro ATX /Mini-ITX] MAG FORGE 130A AIRFLOW', 'MSI', 60),
    /130A/,
  )
})

// ブランドが名前に出てこない・日本語だけの商品でも壊れない
test('要約できない商品はそのまま返す', () => {
  assert.equal(summarizeProductName('苔 ハイゴケ パック 這苔 はいごけ 苔玉', undefined, 60), '苔 ハイゴケ パック 這苔 はいごけ 苔玉')
})

test('元タイトルをブランドと製品名だけの表示へ変換する', () => {
  assert.deepEqual(
    productIdentity(
      'Logicool MX Master 3S ワイヤレスマウス 8000dpi ブラック',
      'Logicool',
    ),
    {
      brand: 'Logicool',
      productName: 'MX Master 3S',
      displayName: 'Logicool MX Master 3S',
    },
  )
})

test('保存済み製品名にブランドが重複していても一度だけ表示する', () => {
  assert.deepEqual(
    productIdentity('検索用の元タイトル', 'Sony', 'Sony WH-1000XM6'),
    {
      brand: 'Sony',
      productName: 'WH-1000XM6',
      displayName: 'Sony WH-1000XM6',
    },
  )
})

test('製品名に残ったブランドの別表記を落とす', () => {
  assert.equal(productIdentity('エレコム 10個セット TK-TCM011BK RS ELECOM 有線', 'エレコム', 'TK-TCM011BK RS ELECOM 有線').displayName, 'エレコム TK-TCM011BK RS 有線')
  assert.equal(productIdentity('AMD エーエムディーRyzen 7 9800X3D', 'AMD', 'エーエムディーRyzen 7 9800X3D').displayName, 'AMD Ryzen 7 9800X3D')
  assert.equal(productIdentity('Brother ブラザー工業 TN-291BK', 'Brother', 'ブラザー工業 TN-291BK').displayName, 'Brother TN-291BK')
  // aliases のうち製品シリーズ名（Galaxy）はブランドの表記ゆれではない
  assert.equal(productIdentity('Samsung Galaxy S26+', 'Samsung', 'Galaxy S26+').displayName, 'Samsung Galaxy S26+')
})

test('雰囲気語と日本語の色名は落とし、英字のエディション名は残す', () => {
  assert.equal(productIdentity('観葉植物 おしゃれ 北欧 7号鉢', null, '観葉植物 おしゃれ 北欧 7号鉢').displayName, '観葉植物 7号鉢')
  assert.equal(productIdentity('GoPro HERO12 Black', 'GoPro', 'HERO12 Black').displayName, 'GoPro HERO12 Black')
})

test('別ブランド名を含む製品名をブランドとして誤分割しない', () => {
  assert.deepEqual(
    productIdentity('Metapen A8 iPad用ペン', 'Meta'),
    {
      brand: undefined,
      productName: 'Metapen A8 iPad用ペン',
      displayName: 'Metapen A8 iPad用ペン',
    },
  )
})

test('検証済みプリセットは製品名にないメーカーも先頭へ表示する', () => {
  assert.deepEqual(
    productIdentity('MacBook Pro 14 M4', 'Apple', 'MacBook Pro 14 M4', true),
    {
      brand: 'Apple',
      productName: 'MacBook Pro 14 M4',
      displayName: 'Apple MacBook Pro 14 M4',
    },
  )
})

test('末尾が句点のブランドを分離しても句点を製品名へ残さない', () => {
  assert.equal(productIdentity('MacLab. USB Type-C DVI-D BC-UCD2W', 'MacLab').displayName, 'MacLab USB Type-C DVI-D BC-UCD2W')
})

test('英語表示では商品名の判定可能なカテゴリ語だけを英語へ変換する', () => {
  const cases: Array<[string, string, string]> = [
    ['Lazos 有線ゲーミングマウス 6ボタン', 'Mouse', 'Lazos 有線 Gaming Mouse 6ボタン'],
    ['FlexiSpot MA3 デュアルモニターアーム', 'MonitorArm', 'FlexiSpot MA3 Dual Monitor Arm'],
    ['M-AUDIO Keystation Mini32 MK3 MIDIキーボード', 'Keyboard', 'M-AUDIO Keystation Mini32 MK3 MIDI Keyboard'],
    ['REGZA 液晶テレビ55V型', 'TV', 'REGZA LCD TV 55V型'],
    ['YAMAHA MS101-4 パワードモニタースピーカー', 'Speaker', 'YAMAHA MS101-4 Powered Monitor Speaker'],
  ]
  for (const [name, category, expected] of cases) {
    assert.equal(localizeProductCategoryTerms(name, category, 'en'), expected, name)
  }
})

test('日本語表示と別カテゴリの固有名詞は変更しない', () => {
  assert.equal(localizeProductCategoryTerms('Logicool ゲーミングマウス', 'Mouse', 'ja'), 'Logicool ゲーミングマウス')
  assert.equal(localizeProductCategoryTerms('Microsoft Surface', 'Microphone', 'en'), 'Microsoft Surface')
})

test('英語表示では公式サンプルの商品名全体を英語化する', () => {
  const gadget = (id: string, name: string, category: Gadget['category']): Gadget => ({
    id,
    name,
    category,
    ports: [],
    createdAt: '',
  })
  assert.equal(localizedGadgetName(gadget('demo-dtm-mic', '入門コンデンサーマイク', 'Microphone'), 'en'), 'Entry-level Condenser Microphone')
  assert.equal(localizedGadgetName(gadget('demo-creator-keyboard', '薄型Bluetoothキーボード', 'Keyboard'), 'en'), 'Low-profile Bluetooth Keyboard')
  assert.equal(localizedGadgetName(gadget('demo-mobile-pc', '13インチ 軽量ノートPC', 'PC'), 'en'), '13-inch Lightweight Laptop')
  assert.equal(localizedGadgetName(gadget('demo-gaming-strip', '電源タップ 6口', 'PowerStrip'), 'en'), '6-Outlet Power Strip')
})

test('公式サンプルと同名の利用者の商品は完全英訳しない', () => {
  const gadget: Gadget = {
    id: 'user-gadget',
    name: '入門コンデンサーマイク',
    category: 'Microphone',
    ports: [],
    createdAt: '',
  }
  assert.equal(localizedGadgetName(gadget, 'en'), '入門 Condenser Microphone')
})
