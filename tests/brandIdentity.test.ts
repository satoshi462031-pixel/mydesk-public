import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BRAND_ENTRIES,
  brandDisplay,
  brandEntry,
  brandKey,
  brandFromGadgetName,
  isAftermarketListing,
  brandFromName,
  compactBrand,
  gadgetBrandForPublish,
  isNonBrand,
} from '../src/utils/brandIdentity'

describe('brandKey', () => {
  it('大文字小文字と記号の違いを潰す', () => {
    assert.equal(brandKey('UGREEN'), brandKey('Ugreen'))
    assert.equal(brandKey('TP-Link'), brandKey('TP Link'))
    assert.equal(brandKey('FLEXISPOT'), brandKey('FlexiSpot'))
  })

  it('全角と半角を揃える', () => {
    assert.equal(brandKey('ＳＯＮＹ'), brandKey('Sony'))
    assert.equal(brandKey('ｿﾆｰ'), brandKey('ソニー'))
  })

  it('日本語表記と英字表記を同じキーにする', () => {
    assert.equal(brandKey('ロジクール'), brandKey('Logicool'))
    assert.equal(brandKey('Logitech'), brandKey('ロジクール'))
    assert.equal(brandKey('バッファロー'), brandKey('BUFFALO'))
    assert.equal(brandKey('アイ・オー・データ'), brandKey('IODATA'))
    assert.equal(brandKey('キャノン'), brandKey('Canon'))
    assert.equal(brandKey('SANWA'), brandKey('サンワサプライ'))
    assert.equal(brandKey('Western'), brandKey('WD'))
    assert.equal(brandKey('Luminkey65'), brandKey('Luminkey'))
    assert.equal(brandDisplay('Luminkey80', 'en'), 'Luminkey')
    // 製品シリーズ名はメーカーへ寄せる。Lenovo が ThinkPad と IdeaCentre に割れないため
    assert.equal(brandKey('ThinkPad'), brandKey('Lenovo'))
    assert.equal(brandDisplay('IdeaCentre', 'en'), 'Lenovo')
    assert.equal(brandDisplay('Galaxy', 'en'), 'Samsung')
  })

  it('表に無いブランドは表記そのものをキーにする', () => {
    assert.equal(brandKey('Beelink'), 'beelink')
    assert.equal(brandKey('DrunkDeer'), brandKey('drunkdeer'))
  })

  it('空の brand は undefined', () => {
    assert.equal(brandKey(null), undefined)
    assert.equal(brandKey(''), undefined)
    assert.equal(brandKey('  '), undefined)
    // 記号だけの brand は誤抽出。キーが空になるので束ねない
    assert.equal(brandKey('---'), undefined)
  })

  it('別会社を巻き込まない', () => {
    assert.notEqual(brandKey('サンワサプライ'), brandKey('サンワダイレクト'))
    assert.notEqual(brandKey('Sony'), brandKey('PlayStation'))
  })
})

describe('brandDisplay', () => {
  it('言語ごとの表記を返す', () => {
    assert.equal(brandDisplay('ロジクール', 'en'), 'Logitech')
    assert.equal(brandDisplay('Logicool', 'ja'), 'ロジクール')
    assert.equal(brandDisplay('buffalo', 'ja'), 'バッファロー')
  })

  it('日本語表記を持たないブランドは英字のまま', () => {
    assert.equal(brandDisplay('RØDE', 'ja'), 'RODE')
  })

  it('表に無いブランドは受け取った表記を返す', () => {
    assert.equal(brandDisplay('Beelink', 'ja'), 'Beelink')
    assert.equal(brandDisplay('  Pixio ', 'en'), 'Pixio')
  })

  it('空なら undefined', () => {
    assert.equal(brandDisplay(undefined, 'ja'), undefined)
    assert.equal(brandDisplay('   ', 'ja'), undefined)
  })
})

describe('ブランド表', () => {
  it('別のブランドが同じ表記を持たない', () => {
    const owner = new Map<string, string>()
    for (const entry of BRAND_ENTRIES) {
      for (const alias of [entry.en, entry.ja, ...(entry.aliases ?? [])]) {
        if (!alias) continue
        const key = compactBrand(alias)
        const previous = owner.get(key)
        assert.equal(previous ?? entry.id, entry.id, `${alias} が ${previous} と ${entry.id} で重複`)
        owner.set(key, entry.id)
      }
    }
  })

  it('id が一意で、キーから引ける', () => {
    const ids = BRAND_ENTRIES.map((entry) => entry.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const entry of BRAND_ENTRIES) assert.equal(brandEntry(entry.id)?.en, entry.en)
  })

  it('未知のキーは引けない', () => {
    assert.equal(brandEntry('beelink'), undefined)
  })
})

describe('isNonBrand', () => {
  it('規格名と対応機種名はブランドとして扱わない', () => {
    for (const raw of ['USB-C', 'Type-C', 'USB3.0', 'M.2', 'PS5', 'Xbox', 'X-box', 'Switch2', 'Surface', 'MacBook']) {
      assert.equal(isNonBrand(raw), true, raw)
      assert.equal(brandKey(raw), undefined, raw)
      assert.equal(brandDisplay(raw, 'ja'), undefined, raw)
    }
  })

  // 商品マスタの brand 列に実際に入っていた値
  it('番号付きの規格名・製品名・型番はブランドとして扱わない', () => {
    for (const raw of ['Bluetooth5.4', 'HDMI2.1', 'SDXC', 'SALE', 'VGP2026', 'Joy-Con', 'iPhone17e', "Marvel's", 'X870E', 'VW-VBT380-K', 'RBC123J-S', 'ST4000DM004', 'EP-804A', 'APCRBC123J', 'CMK32GX4M2E3200C16']) {
      assert.equal(isNonBrand(raw), true, raw)
      assert.equal(brandKey(raw), undefined, raw)
    }
  })

  it('販促語・規格名・汎用の構成名をブランドにしない', () => {
    for (const raw of ['OFF', 'mSATA', 'Custom']) {
      assert.equal(isNonBrand(raw), true, raw)
      assert.equal(brandKey(raw), undefined, raw)
    }
  })

  it('数字を含むブランド名は型番と取り違えない', () => {
    for (const raw of ['Insta360', '8BitDo', 'Club3D', 'j5create', 'Digio2', 'TP-Link', 'M-AUDIO', 'Line 6']) {
      assert.equal(isNonBrand(raw), false, raw)
    }
  })

  it('製品ファミリ名は brand 列から落とすが、手元の判定は壊さない', () => {
    // 商品マスタには「AirPods 第二世代 別売り 片耳」のようなアクセサリが
    // brand='AirPods' で入っている。束ねる側で落とす
    for (const raw of ['AirPods', 'MagSafe', 'magsafe']) {
      assert.equal(isNonBrand(raw), true, raw)
      assert.equal(brandKey(raw), undefined, raw)
    }
    // 手元のガジェットは families が先に当たるので Apple のまま
    assert.equal(brandFromGadgetName('AirPods Pro 2'), 'Apple')
  })

  it('似た形の実在ブランドは巻き込まない', () => {
    // WD / KZ は2文字、Kobo は楽天、Fractal はPCケース
    for (const raw of ['WD', 'KZ', 'Kobo', 'Meta', 'Fractal', 'AOC', 'Insta360', '8BitDo']) {
      assert.equal(isNonBrand(raw), false, raw)
      assert.notEqual(brandKey(raw), undefined, raw)
    }
  })
})

describe('brandFromName', () => {
  it('登録名の先頭にあるブランドを拾う', () => {
    assert.equal(brandFromName('Anker 737 Power Bank (PowerCore 24K)'), 'Anker')
    assert.equal(brandFromName('Dell U2723QE'), 'Dell')
    assert.equal(brandFromName('ロジクール MX Master 3S'), 'ロジクール')
    assert.equal(brandFromName('ＳＯＮＹ WH-1000XM5'), 'Sony')
  })

  it('表にないメーカーは先頭語をそのまま返す', () => {
    assert.equal(brandFromName('Beelink SER8 ミニPC'), 'Beelink')
    assert.equal(brandFromName('JAPANNEXT JN-IPS27FLFHD'), 'JAPANNEXT')
  })

  it('複合ブランドを先頭1語で切らない', () => {
    for (const [name, brand] of [
      ['ATTACK SHARK X11', 'ATTACK SHARK'],
      ['Cooler Master Elite Gold 1000', 'Cooler Master'],
      ['Fractal Design Pop Air', 'Fractal Design'],
      ['IK Multimedia iRig 2', 'IK Multimedia'],
      ['j5 create USBハブ JCD403', 'j5create'],
      ['Blackmagic Design HyperDeck Studio HD', 'Blackmagic Design'],
      ['ADAM Audio A4V', 'ADAM Audio'],
    ] as const) {
      const detected = brandFromName(name)
      assert.equal(brandKey(detected), brandKey(brand), name)
      assert.equal(brandDisplay(detected, 'en'), brand, name)
    }
  })

  it('先頭メーカーをGoogle TVなどの文中ブランドより優先する', () => {
    assert.equal(brandFromName('TCL C1 Google TV'), 'TCL')
    assert.equal(brandFromName('FPD 40V型 Google TV'), 'FPD')
    assert.equal(brandFromName('ETOE 最新 Google TV プロジェクター'), 'ETOE')
    assert.equal(brandFromName('テレビ 4K Google TV対応'), undefined)
  })

  it('対応機種・規格・一般語で始まる名前はブランドなし', () => {
    for (const name of [
      'USB-C ハブ 7in1',
      'Type-C to Type-C ケーブル 1m',
      'PS5 横置きスタンド',
      'MacBook Pro 14インチ用 スリーブ',
      'Surface Pro 充電器 65W',
      'Bluetooth ワイヤレスイヤホン',
      'Custom PC',
      'mSATA SSD変換ケース',
      'OFF bluetooth スピーカー',
      'モニターアーム シングル',
    ]) {
      assert.equal(brandFromName(name), undefined, name)
    }
  })

  it('先頭から離れた位置の対応機種は拾わない', () => {
    // ノーブランド品は対応機種を後ろに列挙する。見るのは先頭25文字だけ。
    // 裏を返すと、短い日本語で始まる名前では対応機種がこの窓に入ることがある
    assert.equal(
      brandFromName('ワイヤレスマウス 静音 充電式 高精度 コンパクト Mac Windows surface Microsoft Pro 光学式'),
      undefined,
    )
  })

  it('束ねるところまで通す', () => {
    const a = brandFromName('Logicool MX Keys')
    const b = brandFromName('ロジクール ERGO M575S')
    assert.notEqual(a, b)
    assert.equal(brandKey(a), brandKey(b))
    assert.equal(brandDisplay(a, 'ja'), 'ロジクール')
  })
})

describe('brandFromGadgetName', () => {
  it('製品ファミリ名からメーカーへ寄せる', () => {
    // 名前にメーカー名が入らない機材。ここを寄せないと本体が全部「その他」に落ちる
    for (const [name, brand] of [
      ['MacBook Pro 16" M4 Max', 'Apple'],
      ['Mac mini M4 Pro', 'Apple'],
      ['iMac 24" M4', 'Apple'],
      ['iPad mini (7th Gen)', 'Apple'],
      ['iPhone 16 Pro', 'Apple'],
      ['AirPods Pro 2', 'Apple'],
      ['Magic Trackpad', 'Apple'],
      ['Studio Display', 'Apple'],
      ['Surface Pro 11', 'Microsoft'],
      ['Xbox Series X', 'Microsoft'],
    ] as const) {
      assert.equal(brandFromGadgetName(name), brand, name)
      assert.equal(brandDisplay(brandFromGadgetName(name), 'ja'), brand === 'Apple' ? 'アップル' : 'マイクロソフト')
    }
  })

  it('実在しないブランドを立てない', () => {
    // 寄せる前は 'Magic' 'AirPods' 'Studio' が一覧にブランドとして並んでいた
    for (const name of ['Magic Keyboard Touch ID', 'AirPods 4', 'Studio Display']) {
      assert.notEqual(brandKey(brandFromGadgetName(name)), compactBrand('Magic'))
      assert.equal(brandKey(brandFromGadgetName(name)), 'apple')
    }
  })

  it('メーカー名を名乗らない国内の本体も寄せる', () => {
    // プリセットの実データ。区切りが無いので KNOWN_BRANDS では当たらない
    assert.equal(brandFromGadgetName('ニンテンドークラシックミニ ファミリーコンピュータ'), 'Nintendo')
    assert.equal(brandFromGadgetName('スーパーファミコン コントローラー (Nintendo Switch Online)'), 'Nintendo')
    assert.equal(brandDisplay(brandFromGadgetName('キオクシア EXCERIA PLUS microSDXC 128GB'), 'en'), 'KIOXIA')
  })

  it('製品ファミリだけの名前を正準メーカーへ寄せる', () => {
    assert.equal(brandFromGadgetName('Echo Show 5'), 'Amazon')
    assert.equal(brandFromGadgetName('Xperia 1 VI'), 'Sony')
    assert.equal(brandFromGadgetName('DualSense ワイヤレスコントローラー'), 'PlayStation')
    assert.equal(brandDisplay(brandFromGadgetName('TVS REGZA 55Z870N'), 'ja'), 'レグザ')
  })

  it('先頭のメーカー名が製品ファミリより優先される', () => {
    // 「Xbox 対応」を名乗る他社製品。ファミリを先に見ると全部 Microsoft になる
    assert.equal(brandFromGadgetName('8BitDo Arcade Stick (Xbox/PC)'), '8BitDo')
    assert.equal(brandFromGadgetName('HORI Real Arcade Pro V Hayabusa (Xbox)'), 'HORI')
  })

  it('辞書に無いメーカーが先頭にあれば、そちらを優先する', () => {
    // アクセサリは対応機種を名前の途中に並べる。ファミリ名を名前の途中で
    // 拾うと、実在のメーカー（辞書に無いだけ）を追い越す
    assert.equal(brandFromGadgetName('NIMASO iPad Air11 13 M4 2026 A16 Mini7'), 'NIMASO')
    assert.equal(brandFromGadgetName('BENFEI Mac mini M4 ドック & スタンド'), 'BENFEI')
    assert.equal(brandFromGadgetName('MOFT iPhone17 MagSafe 磁力'), 'MOFT')
  })

  it('ファミリ名に文字や数字が続く語は別物として扱う', () => {
    // 語境界を見ずに前方一致にすると、アクセサリ業者が名乗る型番
    // （iPhone17e）まで Apple になる
    assert.notEqual(brandFromGadgetName('iPhone17e 有線 c iPhone17 有線イヤホン'), 'Apple')
    assert.notEqual(brandFromGadgetName('Xboxコントローラー対応 グリップ'), 'Microsoft')
  })

  it('取り込み側（brandFromName）には効かせない', () => {
    // 対応機種を先頭に置いたノーブランドのアクセサリを Apple 製品として
    // 商品マスタに載せないための線引き
    for (const name of ['MacBook Pro 14インチ用 スリーブ', 'Surface Pro 充電器 65W']) {
      assert.equal(brandFromName(name), undefined, name)
    }
    assert.notEqual(brandFromGadgetName('MacBook Pro 14インチ用 スリーブ'), undefined)
  })
})

describe('gadgetBrandForPublish', () => {
  it('英字表記と別名をまとめて返す', () => {
    const logi = gadgetBrandForPublish('ロジクール MX Master 3S')
    assert.equal(logi.brand, 'Logitech')
    // 「ロジクール」で検索した人にも当てるための材料
    assert.ok(logi.brand_aliases.includes('ロジクール'))
    assert.ok(logi.brand_aliases.includes('Logicool'))
  })

  it('辞書に無いブランドは表記そのものを別名にする', () => {
    const beelink = gadgetBrandForPublish('Beelink SER8 ミニPC')
    assert.equal(beelink.brand, 'Beelink')
    assert.deepEqual(beelink.brand_aliases, ['Beelink'])
  })

  it('ブランドを名乗らない機材は空', () => {
    assert.deepEqual(gadgetBrandForPublish('モニターアーム シングル'), { brand: null, brand_aliases: [] })
  })
})

describe('isAftermarketListing', () => {
  it('純正でないと名乗っている行を落とす', () => {
    // 本番の実データ。brand 列は Apple だが作っているのは別の会社
    assert.equal(isAftermarketListing('Apple WorldPlus MacBook Pro A1175 A1211', 'apple'), true)
    assert.equal(isAftermarketListing('Apple WorldPlus 互換バッテリー MacBook Retina', 'apple'), true)
    assert.equal(isAftermarketListing('Apple MacBook Air A1405 交換バッテリー', 'apple'), true)
  })

  it('先頭が別のメーカーなら落とす', () => {
    assert.equal(isAftermarketListing('QISI 追跡タグ GPS Apple認証品 保護ケース付', 'apple'), true)
    assert.equal(isAftermarketListing('Cooler Master i50 for LGA 1700', 'lg'), true)
  })

  it('本体メーカーの棚から他社アクセサリを外す', () => {
    assert.equal(isAftermarketListing('Nintendo Switch 2 保護カバー 画面フィルム', 'nintendo'), true)
    assert.equal(isAftermarketListing('Apple AirTag 表面・背面フィルムセット OverLay FLEX', 'apple'), true)
    assert.equal(isAftermarketListing('BUITFOU For AirPods Pro 3', 'apple'), true)
  })

  it('アクセサリを本業にするメーカーの棚は削らない', () => {
    // エレコムやアンカーにとって保護フィルムやスタンドは正規の商品
    assert.equal(isAftermarketListing('エレコム iPad 液晶保護フィルム 反射防止', 'elecom'), false)
    assert.equal(isAftermarketListing('Anker MagGo 充電スタンド', 'anker'), false)
  })

  it('自分で純正と名乗る一次アクセサリは残す', () => {
    assert.equal(isAftermarketListing('ソニー純正 デュアルセンス 充電スタンド', 'sony'), false)
  })

  it('宣伝文句の for を対応品と読まない', () => {
    // ソニーのコピー。for の直後にそのブランド名が来るときだけ対応品として扱う
    assert.equal(
      isAftermarketListing('ソニー ゲーミングヘッドセット INZONE H9 ブームマイク付き Perfect for Play', 'sony'),
      false,
    )
  })

  it('そのメーカーの製品は残す', () => {
    assert.equal(isAftermarketListing('Apple 30W USB-C Power Adapter', 'apple'), false)
    assert.equal(isAftermarketListing('APPLE iPad Air 第5世代 Wi-Fi MM9L3J', 'apple'), false)
    assert.equal(isAftermarketListing('LG UltraGear 27GN850', 'lg'), false)
    // 「MFi認証」は Apple 対応の宣言であって、作っているのは Anker 自身
    assert.equal(isAftermarketListing('Anker MFi認証 Lightning ケーブル', 'anker'), false)
  })
})
