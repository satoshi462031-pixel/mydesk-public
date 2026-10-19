import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'

type Product = {
  id: string
  name: string
  category: string | null
  subcategory?: string | null
  is_suggestable?: boolean
  source: string | null
}

type Classification = {
  category: string | null
  subcategory: string | null
  isSuggestable: boolean
}

/**
 * MIDIキーボード・MIDIコントローラーの名前。楽天ではオーディオインターフェースや
 * ミキサーのジャンルに入っていることが多く、そのままだと楽器カテゴリから探せない。
 */
const MIDI_KEYBOARD_NAME = /MIDIキーボード|MIDI\s*コントローラ|\d{2}\s*鍵|Komplete\s*Kontrol|Launchkey|Launchpad|MPK\s*(?:mini|Road)|KeyStep|Keylab|Oxygen\s*(?:Pro)?|Keystation|microKEY|nanoKEY|iRig\s*Keys/i

/** 中古・レンタルなど、製品マスタではなく個別の販売条件を表す行。 */
const NON_CANONICAL_OFFER = /レンタル|中古|新古品|整備済み品|アウトレット|訳あり|わけあり|外装(?:わけあり|訳あり)|パッケージ傷み/i

const apply = process.argv.includes('--apply')

function pcPartSubcategory(name: string, current: string): string | undefined {
  if (/(?:^|\s)CPU(?:\s|$)|プロセッサ/i.test(name)) return 'cpu'
  if (/グラフィックス?\s*(?:ボード|カード)|ビデオカード|\bGPU\b|\b(?:GeForce|Radeon)\b/i.test(name)) return 'gpu'
  if (/増設メモリ|デスクトップ用メモリ|ノートPC用メモリ|\b(?:DDR[345]|SODIMM)\b/i.test(name)) return 'memory'
  if (/内蔵(?:SSD|HDD|ドライブ)|\b(?:NVMe|M\.2 SSD)\b/i.test(name)) return 'storage'
  if (/マザーボード|motherboard/i.test(name)) return 'motherboard'
  if (/PCケース|コンピュータケース|ミドルタワー|フルタワー/i.test(name)) return 'case'
  if (/CPUクーラー|ケースファン|PCファン|水冷クーラー|ヒートシンク/i.test(name)) return 'cooling'
  if (/電源ユニット|PC電源|ATX電源/i.test(name)) return 'power_supply'
  if (current === 'PCPartCPU') return 'cpu'
  if (current === 'PCPartGPU') return 'gpu'
  if (current === 'PCPartMemory') return 'memory'
  if (current === 'PCPartStorage') return 'storage'
  return undefined
}

export function classifyProduct(product: Product): Classification {
  const name = product.name
  // ヘッドセットはヘッドホンへ統合済み。DB には旧カテゴリの行が残っているので、
  // ここで寄せてから以降の判定に回す（イヤホン型かどうかの振り分けも通す）
  const current = product.category === 'Headset' ? 'Headphone' : (product.category ?? null)
  let category = current
  let subcategory = product.subcategory ?? null
  let isSuggestable = product.is_suggestable ?? true

  // 状態を名前から消すと新品に見えてしまう。楽天の個別出品だけ候補から外す。
  if (product.source !== 'preset' && NON_CANONICAL_OFFER.test(name)) isSuggestable = false

  const pcPart = pcPartSubcategory(name, current ?? '')
  if (pcPart && (current === 'SmallDevice' || current?.startsWith('PCPart'))) {
    category = 'PCPart'
    subcategory = pcPart
    if (/保管|収納ケース|シェルケース|交換用|ダミー|フォルダー|ホルダー/i.test(name)) isSuggestable = false
  } else if (current === 'SmallDevice' && /プロジェクター|projector/i.test(name)) {
    category = 'Projector'
    subcategory = /ポータブル|モバイル/i.test(name) ? 'portable' : 'home'
  } else if (current === 'SmallDevice' && /Fire TV|Chromecast|Apple TV|ストリーミング端末|メディアプレーヤー|ワイヤレスディスプレイ|Miracast/i.test(name)) {
    category = 'StreamingDevice'
    subcategory = /ワイヤレスディスプレイ|Miracast/i.test(name) ? 'wireless_display' : 'streaming'
  }

  if (current === 'Monitor' && /テレビ|チューナーレス|液晶\s*TV|有機EL\s*TV/i.test(name)) {
    category = 'TV'
    subcategory = /チューナーレス/i.test(name) ? 'tunerless' : 'television'
  }

  if (current === 'Headphone' || current === 'Microphone') {
    if (current === 'Microphone' && /オーディオインターフェ[イー]ス/i.test(name)) {
      category = 'AudioInterface'
      subcategory = null
    } else if (/ヘッドセット|マイク付き|ゲーミングヘッドホン|gaming headset|OpenComm/i.test(name)) {
      // ヘッドセットはヘッドホンに統合済み。ゲーミングかどうかは subcategory に残す
      category = 'Headphone'
      subcategory = /ゲーミング|gaming/i.test(name) ? 'gaming' : null
    } else if (/イヤホン|イヤフォン|イヤーフォン|earbuds?|in-ear|カナル|完全ワイヤレス/i.test(name)) {
      category = 'Earphone'
      subcategory = /完全ワイヤレス|左右分離|\bTWS\b/i.test(name) ? 'true_wireless' : null
    }
    if (/用アクセサリ|イヤーフック|イヤーチップ|交換パッド|交換ケーブル|収納ケース/i.test(name)) isSuggestable = false
  }

  if (current === 'Keyboard') {
    subcategory = /テンキー(?!レス)|numeric keypad|number pad/i.test(name)
      ? 'numpad'
      : /ゲーミング|gaming|ラピッドトリガー/i.test(name)
        ? 'gaming'
        : 'keyboard'
  }

  if (current === 'Speaker') {
    subcategory = /サウンドバー|soundbar/i.test(name)
      ? 'soundbar'
      : /モニタースピーカー|スタジオモニター/i.test(name)
        ? 'studio_monitor'
        : /Bluetooth|ポータブル|ワイヤレススピーカー/i.test(name)
          ? 'bluetooth'
          : /パッシブ|ブックシェルフ/i.test(name)
            ? 'passive'
            : 'speaker'
  }

  if (current === 'Accessory') {
    subcategory = /保護フィルム|覗き見|プライバシーフィルター/i.test(name)
      ? 'filter'
      : /スタンド|ホルダー/i.test(name)
        ? 'stand'
        : /ポップガード|ウインドスクリーン|ショックマウント/i.test(name)
          ? 'microphone'
          : /USB|冷却パッド|ノートPCクーラー/i.test(name)
            ? 'usb'
            : 'interior'
  }

  if (current === 'Furniture') {
    subcategory = /収納|キャビネット|ワゴン|書庫|ロッカー|棚/i.test(name)
      ? 'storage'
      : /パーテーション|間仕切り/i.test(name)
        ? 'partition'
        : /応接|役員|社長/i.test(name)
          ? 'executive'
          : 'other'
    if (/スモーキング|灰皿|吸殻|ashtray|連結金具|交換用キャスター|自在キャスター/i.test(name)) isSuggestable = false
  }

  if (current === 'Router') {
    subcategory = /中継[機器]|エクステンダー|repeater/i.test(name)
      ? 'extender'
      : /LANアダプタ|ネットワークアダプタ/i.test(name)
        ? 'adapter'
        : 'router'
  }

  if (current === 'GameConsole') {
    if (/コントローラ|ゲームパッド|ジョイスティック|ホリパッド/i.test(name)) category = 'Controller'
    if (/ゲームソフト|\bCERO\b|HAC-P-|ELJM-|PLJM-|Nintendo Switch(?:\s*2)? Edition|Pokemon LEGENDS/i.test(name)) isSuggestable = false
    if (/ケース|カバー|保護フィルム|収納バッグ|交換パーツ|修理パーツ|交換用.*(?:スティック|ボタン)/i.test(name)) isSuggestable = false
  }

  if (current === 'AudioInterface') {
    if (/\bDAC\b|D\/Aコンバーター/i.test(name)) category = 'HeadphoneAmp'
    if (/\bDAW\b|Cubase|Ableton|音源ソフト|プラグインソフト/i.test(name)) isSuggestable = false
    // 楽天の「オーディオインターフェース」ジャンルにはMIDIキーボードが大量に混ざっている。
    // 楽器側に移さないと、ユーザーが「楽器」カテゴリから探しても候補に出てこない。
    if (MIDI_KEYBOARD_NAME.test(name)) {
      category = 'Instrument'
      subcategory = 'midi_keyboard'
    }
  }

  if (current === 'MobileBattery') {
    if (/ノートPC用バッテリー|交換用バッテリー|互換バッテリー/i.test(name)) isSuggestable = false
    else if (/充電器|ACアダプタ|USB AC|GaN/i.test(name) && !/モバイルバッテリー|power bank/i.test(name)) category = 'Charger'
  }

  // ここから下は 2026-08-20 追加分。楽天のジャンル一括取り込みで紛れ込んだ
  // 「機材でないもの」と「カテゴリ違い」を仕分ける。予測変換に出る候補の質に直結する。

  // ゲーム機カテゴリは本体より周辺品・ソフト・修理部品のほうが多い
  if (current === 'GameConsole') {
    if (/ネジ|ドライバー(?:セット)?|工具|リボンケーブル|導電性(?:フィルム|ケーブル)|回路基板|修理(?:キット)?|交換部品|交換用|部品|スティック(?:カバー|修理)|アタッチメント/i.test(name)) isSuggestable = false
    if (/ガラスフィルム|保護フィルム|ブルーライトカット|キャリングケース|ハードケース|収納ケース|ポーチ|シリコンカバー|ステッカー|シール|名入れ/i.test(name)) isSuggestable = false
    // 「〇〇 - PS5」「Nintendo Switch版」のようなソフトの表記
    if (/Nintendo Switch\s*(?:2\s*)?版|Value Selection|Game of the Year|ダウンロード版|プロダクトコード|- (?:PS[45]|Xbox|Switch)\b/i.test(name)) isSuggestable = false
  }

  // ルーターのジャンルにはスイッチングハブ・中継器・LAN子機が同居している
  if (current === 'Router') {
    if (/スイッチングハブ|スイッチング\s*HUB|ギガ(?:ビット)?スイッチ|LANハブ|PoEスイッチ|アンマネージスイッチ|スイッチングハブ/i.test(name)) {
      category = 'NetworkSwitch'
      subcategory = /PoE/i.test(name) ? 'poe' : 'switch'
    } else if (/無線LAN子機|WiFi子機|USB無線LAN|LANアダプタ|ネットワークアダプタ|WiFiアダプター?/i.test(name)) {
      // 子機はPCの部品で、単体では配線図に出ない
      isSuggestable = false
    }
  }

  // 製品名に「ヘッドセット」と書かない定番機。カテゴリはヘッドホンのままでよいので、
  // ゲーミング機であることだけ subcategory に残す
  if (current === 'Headphone' && /Evolve\d?|Arctis|BlackShark|Cloud\s*(?:II|III|Alpha|Stinger)|Quantum\s*\d|H\d{3}\s*ヘッドセット|マイク付き?/i.test(name)) {
    subcategory = /ゲーミング|gaming|Arctis|BlackShark|Quantum/i.test(name) ? 'gaming' : null
  }

  // ICレコーダー・ハンディレコーダーはマイクではない
  if (current === 'Microphone' && /(?:IC)?レコーダー|recorder|PCM録音|ハンディレコーダー/i.test(name) && !/マイク付|マイク内蔵カメラ/i.test(name)) {
    category = 'SmallDevice'
    subcategory = 'recorder'
  }

  // ヘッドホンアンプのジャンルに据置アンプが混ざる。パッシブスピーカーを鳴らせるのは Amplifier だけ
  if (current === 'HeadphoneAmp' && /AVアンプ|AVレシーバー|プリメインアンプ|パワーアンプ|インテグレーテッドアンプ/i.test(name)) {
    category = 'Amplifier'
    subcategory = /AV(?:アンプ|レシーバー)/i.test(name) ? 'av_receiver' : 'integrated'
  }
  if (current === 'AudioInterface' && /PAアンプ|パワーアンプ|プリメインアンプ/i.test(name)) {
    category = 'Amplifier'
    subcategory = 'pa'
  }

  // ミキサーのジャンルにマイクや打楽器部品が入っている
  if (current === 'Mixer') {
    // DJミキサーと紛れないよう、DJ機材の語が無いものだけ楽器へ移す
    if (MIDI_KEYBOARD_NAME.test(name) && !/DJ|ミキサー|mixer/i.test(name)) {
      category = 'Instrument'
      subcategory = 'midi_keyboard'
    } else if (/(?:ゲーミング)?マイク\b|コンデンサーマイク|USBマイク/i.test(name) && !/ミキサー|mixer/i.test(name)) {
      category = 'Microphone'
      subcategory = /USB/i.test(name) ? 'usb' : null
    } else if (/ハイハット|シンバル|スネア|ドラムスティック|マイクスタンド|譜面台/i.test(name)) {
      isSuggestable = false
    }
  }

  // 楽器のジャンルはソフト音源・教則・小物が半分近くを占める。
  // ただし電子ピアノは「スタンド・椅子・譜面台つき」のセット売りが普通なので、
  // 本体を示す語があるものは小物語が入っていても残す
  if (current === 'Instrument') {
    const isBody = /電子ピアノ|電子ドラム|エレドラ|シンセサイザー|MIDIキーボード|\d{2}鍵盤|エレキギター|アコースティックギター|エレキベース|グランドピアノ(?!.*(?:カバー|椅子))/i.test(name)
    const isAccessory = /ソフト音源|音源ソフト|プラグイン|ソフトウェア|教則|譜面台カバー|クリーニングクロス|抗菌クロス|ストラップ|スティックバッグ|交換弦|ケースのみ/i.test(name)
    if (isAccessory && !isBody) isSuggestable = false
  }

  // メモリカード単体・内蔵ドライブは単体では配線図に出ない
  if (current === 'Storage') {
    if (/内蔵(?:HDD|SSD|ハードディスク)|[23]\.5インチ内蔵|内蔵型|M\.2\s*SSD(?!.*(?:ケース|外付))/i.test(name)) {
      category = 'PCPart'
      subcategory = 'storage'
    } else if (/microSD|SDXC|SDHC|CFexpress\s*カード|SDカード(?!リーダー)/i.test(name)) {
      // カードは機器の中に入るもので配線図に出ない。USBメモリは直挿しの機材なので残す
      isSuggestable = false
    }
  }

  // ノートPC用の互換・純正ACアダプタは型番の羅列で、候補として役に立たない
  if (current === 'Charger' && /純正|互換|PC-VP-|ADP-|PA-1\d{3}|EliteBook|ThinkPad|dynabook|LAVIE|Inspiron|Latitude|Pavilion/i.test(name)
      && !/USB(?:-|\s)?C\s*(?:充電器|チャージャー)|GaN/i.test(name)) {
    isSuggestable = false
  }

  if (current === 'Printer3D' && /フィラメント|レジン|交換ノズル|ビルドプレート/i.test(name)) isSuggestable = false

  // 本体カテゴリへ混ざった周辺品・消耗品・デジタル商品。物理アクセサリとして
  // 登録できるものは Accessory へ移し、サービスや交換部品は候補から外す。
  if (current === 'Mouse' && /マウスソール|グリップテープ|Hotline Games|対応:\s*(?:Logitech|Logicool)/i.test(name)) {
    category = 'Accessory'
    subcategory = null
  }

  if (current === 'Earphone' && /Bluetoothトランスミッター|送信機/i.test(name)) {
    category = 'SmallDevice'
    subcategory = 'bluetooth_transmitter'
  } else if (current === 'Earphone' && /オーディオインターフェ[イー]ス/i.test(name)) {
    category = 'AudioInterface'
    subcategory = null
  } else if (current === 'Earphone' && /ヘッドセット|OpenComm/i.test(name)) {
    category = 'Headphone'
    subcategory = /ゲーミング|gaming/i.test(name) ? 'gaming' : null
  }
  if (current === 'Controller') {
    if (/マウスパッド/i.test(name)) {
      category = 'MousePad'
      subcategory = null
    } else if (/USBハブ/i.test(name)) {
      category = 'Hub'
      subcategory = null
    } else if (/背面ボタン|交換.*(?:ボタン|スプリング)|スプリングL2|Faceplate|フェイスプレート|修理部品/i.test(name)) {
      isSuggestable = false
    }
  }
  if (current === 'PenTablet' && /ペンタブレット手袋|収納ケース|替え芯|リアカバー/i.test(name)) {
    category = 'Accessory'
    subcategory = null
  }
  if (current === 'Printer' && /互換インク|インクカートリッジ|トナー|プリントヘッド|廃インク|吸収材|リセットキー/i.test(name)) {
    category = 'Accessory'
    subcategory = null
  }
  if (current === 'Projector' && /天吊金具|交換ランプ|ランプユニット|純正バルブ/i.test(name)) {
    category = 'Accessory'
    subcategory = null
  }
  if (current === 'Monitor' && /互換品.*液晶|液晶パネル|保護フィルム/i.test(name)) {
    category = 'Accessory'
    subcategory = /保護フィルム/i.test(name) ? 'filter' : null
  }
  if (current === 'Modem' && /バッテリーコネクタ|吊りボルト|セキュリティ.*SL-|ターミナルプラグ|ブレーカ|フィードインキャップ|DH2721/i.test(name)) {
    isSuggestable = false
  }
  if (current === 'AudioInterface') {
    if (/Voicebank|ソフト音源|拡張音源|プラグイン|ソフトウェア/i.test(name)) {
      isSuggestable = false
    } else if (/保護カバー|ラック\b|フットペダル|専用アダプタ|変換アダプタ|ノイズ除去フィルター/i.test(name)) {
      category = 'Accessory'
      subcategory = null
    }
  }
  if (current === 'Mixer') {
    if (/オフィシャル商品/i.test(name)) {
      isSuggestable = false
    } else if (/レコード針|交換針|スタイラス|stylus|カートリッジ|クリーナー|保護カバー|レコード.*外袋|スリップマット|slipmats?|Control Vinyl|コントロールバイナル/i.test(name)) {
      category = 'Accessory'
      subcategory = null
    }
  }
  if (current === 'Microphone') {
    if (/年間(?:プロ)?プラン|利用券/i.test(name)) isSuggestable = false
    if (/DC電源ケーブル|分岐ケーブル/i.test(name)) {
      category = 'Cable'
      subcategory = null
    }
  }
  if (current === 'SmartHome') {
    if (/PC用スピーカー/i.test(name)) {
      category = 'Speaker'
      subcategory = 'speaker'
    } else if (/保護(?:フィルム|カバー)|OverLay/i.test(name)) {
      category = 'Accessory'
      subcategory = /フィルム|OverLay/i.test(name) ? 'filter' : null
    }
  }
  if (current === 'Headphone') {
    if (/電源タップ|\d+個口/i.test(name)) {
      category = 'PowerStrip'
      subcategory = null
    } else if (/CABLE VELCRO|ケーブルクリップ|収納ケース/i.test(name)) {
      category = 'Accessory'
      subcategory = null
    }
  }
  if (current === 'VRGlass' && /度付きアタッチメント|保護(?:ケース|カバー|フィルム)|ヘッドストラップ/i.test(name)) {
    category = 'Accessory'
    subcategory = /フィルム/i.test(name) ? 'filter' : null
  }
  if (current === 'Webcam') {
    if (/反射防止|保護フィルム/i.test(name)) {
      category = 'Accessory'
      subcategory = 'filter'
    } else if (/\b(?:VivoBook|ENVY|IdeaPad|ThinkPad|LAVIE)\b/i.test(name) && !/WEBカメラ|ウェブカメラ|webcam/i.test(name)) {
      category = 'PC'
      subcategory = null
    }
  }
  if (current === 'Storage' && /カードリーダー|カードリーダライタ/i.test(name)) {
    category = 'SmallDevice'
    subcategory = 'card_reader'
  }
  if (current === 'SmallDevice' && /ケーブル.*(?:整理|チューブ)|配線.*チューブ|BST-15CR/i.test(name)) {
    category = 'Accessory'
    subcategory = 'interior'
  }
  if (current === 'SmallDevice' && /対応\s*\d+GBメモリ|PC[2345]-\d{4,}/i.test(name)) {
    category = 'PCPart'
    subcategory = 'memory'
  }

  return { category, subcategory, isSuggestable }
}

function changed(product: Product, next: Classification): boolean {
  return product.category !== next.category
    || (product.subcategory ?? null) !== next.subcategory
    || (product.is_suggestable ?? true) !== next.isSuggestable
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size))
  return result
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const products: Product[] = []
  const columns = 'id,name,category,subcategory,is_suggestable,source'
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('products').select(columns).range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    products.push(...((data ?? []) as unknown as Product[]))
    if (!data || data.length < 1000) break
  }

  const changes = products
    .map((product) => ({ product, next: classifyProduct(product) }))
    .filter(({ product, next }) => changed(product, next))
  const summary = [...changes.reduce((map, { product, next }) => {
    const key = `${product.category ?? 'null'} -> ${next.category ?? 'null'} / ${next.subcategory ?? '-'} / ${next.isSuggestable ? '表示' : '非表示'}`
    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1])

  console.log(JSON.stringify({ total: products.length, changes: changes.length, summary }, null, 2))
  const categoryMoveGroups = changes
    .filter(({ product, next }) => product.category !== next.category)
    .reduce((map, change) => {
      const key = `${change.product.category ?? 'null'} -> ${change.next.category ?? 'null'}`
      const group = map.get(key) ?? []
      group.push(change.product.name)
      map.set(key, group)
      return map
    }, new Map<string, string[]>())
  console.log(JSON.stringify({
    categoryMoves: [...categoryMoveGroups].map(([move, names]) => ({
      move,
      count: names.length,
      samples: names.slice(0, 3),
    })).sort((a, b) => b.count - a.count),
  }, null, 2))
  for (const { product, next } of changes.slice(0, 40)) {
    console.log(`${product.category} -> ${next.category}/${next.subcategory ?? '-'} [${next.isSuggestable ? '表示' : '非表示'}] ${product.name}`)
  }
  if (!apply || changes.length === 0) return
  if (changes.length > 10_000) throw new Error(`変更件数が安全上限を超えました: ${changes.length}`)

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `product-categories-before-reclassification-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(changes.map(({ product }) => product), null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  const groups = new Map<string, { next: Classification; ids: string[] }>()
  for (const { product, next } of changes) {
    const key = JSON.stringify(next)
    const group = groups.get(key) ?? { next, ids: [] }
    group.ids.push(product.id)
    groups.set(key, group)
  }
  for (const { next, ids } of groups.values()) {
    for (const part of chunks(ids, 200)) {
      const { error } = await db.from('products').update({
        category: next.category,
        subcategory: next.subcategory,
        is_suggestable: next.isSuggestable,
      }).in('id', part)
      if (error) throw new Error(`products の更新に失敗: ${error.message}`)
    }
  }
  console.log(`${changes.length}件を再分類しました`)
}

// classifyProduct を他スクリプトから import しても走らないようにする
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/reclassifyProductCategories.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
