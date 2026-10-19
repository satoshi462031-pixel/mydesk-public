// ブランド表記の正準化。
//
// products.brand は楽天取り込みが商品名の先頭から抜いた文字列で
// （scripts/importRakutenGenres.ts の detectBrand）、同じメーカーが
// `Logicool` と `ロジクール`、`BUFFALO` と `Buffalo` のように複数の表記で入る。
// ブランドで束ねると同じメーカーが何行にも割れるので、束ねる側でここを通す。
//
// 大文字小文字・記号・全角半角の違いは compactBrand() が潰す。表に書くのは
// 「潰しても一致しない」組（日本語表記と英字表記、Logitech と Logicool のような
// 法人名違い）だけにする。網羅は狙わない — 未知のブランドは表記そのままで束ねる。

export type BrandEntry = {
  /** 束ねるためのキー。en を潰したもの */
  id: string
  en: string
  ja?: string
  /** en / ja 以外の表記ゆれ */
  aliases?: string[]
  /**
   * このメーカーの製品ファミリ名（`MacBook` `Surface`）。
   *
   * 原則として aliases と違って BY_ALIAS には入れない。products.brand には、対応機種を
   * 商品名の先頭に置いたノーブランドのアクセサリが同じ文字列で入っていて
   * （「MacBook Pro ケース」「Surface 充電器」）、別名として束ねると
   * それがメーカー純正品として並ぶ。通常は手元のガジェット名にだけ効かせる
   * （brandFromGadgetName）。既存データの正準化にも必要な一部だけ aliases にも置く。
   */
  families?: string[]
}

/** 表記ゆれを潰した比較用の形。NFKC で全角半角とカナを揃え、記号を落とす */
export function compactBrand(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

// ja に一般語（「プラス」「メタ」など）は入れない。brand 列以外から拾うことはないが、
// 表記が一般語だと別メーカーの商品を巻き込む
const ENTRIES: Omit<BrandEntry, 'id'>[] = [
  // PC・周辺機器
  { en: 'Logitech', ja: 'ロジクール', aliases: ['Logicool'] },
  { en: 'ELECOM', ja: 'エレコム' },
  // サンワダイレクトは同じ会社の直販ブランドだが、商品が別なので束ねない
  { en: 'SANWA SUPPLY', ja: 'サンワサプライ', aliases: ['SANWA'] },
  { en: 'BUFFALO', ja: 'バッファロー' },
  { en: 'I-O DATA', ja: 'アイ・オー・データ', aliases: ['IODATA', 'アイオーデータ'] },
  { en: 'Kensington', ja: 'ケンジントン' },
  { en: 'Ergotron', ja: 'エルゴトロン' },
  { en: 'Bauhutte', ja: 'バウヒュッテ' },
  { en: 'Wacom', ja: 'ワコム' },
  { en: 'Belkin', ja: 'ベルキン' },
  { en: 'Satechi', ja: 'サテチ' },
  { en: 'UGREEN', ja: 'ユーグリーン' },
  { en: 'Anker', ja: 'アンカー' },
  { en: 'cheero', ja: 'チーロ' },
  { en: 'Spigen', ja: 'シュピゲン' },
  { en: 'TP-Link', ja: 'ティーピーリンク' },
  { en: 'Plugable', ja: 'プラガブル' },
  { en: 'j5create', aliases: ['j5 create', 'j5', 'J5'] },
  { en: 'Cooler Master', aliases: ['Cooler'] },
  { en: 'Fractal Design', aliases: ['Fractal'] },
  { en: 'Endgame Gear', aliases: ['Endgame'] },
  { en: 'ATTACK SHARK', aliases: ['ATTACK'] },
  { en: 'Bambu Lab', aliases: ['Bambu'] },
  { en: 'Blackmagic Design', aliases: ['Blackmagic'] },
  { en: 'Schneider Electric', aliases: ['Schneider'] },

  // PC本体・ディスプレイ
  // Apple / Microsoft は本体の名前にメーカー名が入らない（「MacBook Pro 14"」）。
  // 他社は ThinkPad / EliteBook / Galaxy のように aliases で束ねているが、
  // この2社は同じ文字列がアクセサリの対応機種表記と衝突するので families で持つ。
  {
    en: 'Apple',
    ja: 'アップル',
    families: [
      'MacBook', 'iMac', 'Mac mini', 'Mac Studio', 'Mac Pro',
      'iPad', 'iPhone', 'AirPods', 'AirTag', 'HomePod', 'Vision Pro',
      // 単語1つ（Magic / Studio）では一般語なので、製品名の形でだけ当てる
      'Magic Keyboard', 'Magic Mouse', 'Magic Trackpad',
      'Studio Display', 'Pro Display XDR',
    ],
  },
  { en: 'Dell', ja: 'デル', families: ['XPS', 'OptiPlex', 'Latitude', 'Precision', 'Inspiron', 'Alienware'] },
  {
    en: 'HP',
    ja: 'ヒューレット・パッカード',
    aliases: ['Hewlett-Packard', 'ProDesk', 'EliteBook'],
    families: ['OMEN', 'Spectre', 'ENVY', 'ProBook', 'EliteDesk', 'Pavilion'],
  },
  {
    en: 'Lenovo',
    ja: 'レノボ',
    aliases: ['ThinkPad', 'ThinkCentre', 'IdeaCentre', 'IdeaPad'],
    families: ['Yoga'],
  },
  { en: 'ASUS', ja: 'エイスース', families: ['ROG', 'ZenBook', 'Vivobook', 'ProArt', 'TUF'] },
  { en: 'Acer', ja: 'エイサー', families: ['Aspire', 'Swift'] },
  { en: 'iiyama', ja: 'イイヤマ' },
  { en: 'BenQ', ja: 'ベンキュー' },
  { en: 'JAPANNEXT', ja: 'ジャパンネクスト' },
  { en: 'Microsoft', ja: 'マイクロソフト', families: ['Surface', 'Xbox'] },
  { en: 'Samsung', ja: 'サムスン', aliases: ['Galaxy'] },
  { en: 'Xiaomi', ja: 'シャオミ' },
  { en: 'Huawei', ja: 'ファーウェイ', aliases: ['MateBook'] },
  { en: 'OnePlus', ja: 'ワンプラス' },
  { en: 'Google', ja: 'グーグル', families: ['Pixel', 'Nest Hub', 'Nest Audio', 'Chromecast', 'Google TV Streamer'] },
  { en: 'Intel', ja: 'インテル', families: ['NUC'] },
  // 楽天では「AMD エーエムディーRyzen」のように読み仮名を型番へ貼り付けて出品される
  { en: 'AMD', ja: 'エーエムディー' },
  { en: 'MSI', ja: 'エムエスアイ' },
  { en: 'CORSAIR', ja: 'コルセア' },
  { en: 'Amazon', ja: 'アマゾン', aliases: ['Echo'], families: ['Echo', 'Kindle'] },

  // 国内メーカー
  { en: 'Sony', ja: 'ソニー', aliases: ['Xperia'], families: ['Xperia', 'WALKMAN'] },
  { en: 'Panasonic', ja: 'パナソニック' },
  { en: 'SHARP', ja: 'シャープ' },
  { en: 'TOSHIBA', ja: '東芝' },
  { en: 'HITACHI', ja: '日立' },
  { en: 'MITSUBISHI', ja: '三菱', aliases: ['三菱電機'] },
  { en: 'EPSON', ja: 'エプソン' },
  { en: 'Canon', ja: 'キヤノン', aliases: ['キャノン'] },
  { en: 'Brother', ja: 'ブラザー' },
  { en: 'NEC', ja: '日本電気' },
  { en: 'FUJITSU', ja: '富士通', aliases: ['LIFEBOOK'] },

  // 家具・照明
  { en: 'NITORI', ja: 'ニトリ' },
  { en: 'IKEA', ja: 'イケア' },
  { en: 'LOWYA', ja: 'ロウヤ' },
  { en: 'KOKUYO', ja: 'コクヨ' },
  { en: 'OKAMURA', ja: 'オカムラ' },
  { en: 'ITOKI', ja: 'イトーキ' },
  { en: 'YAMAZEN', ja: '山善' },
  { en: 'IRIS OHYAMA', ja: 'アイリスオーヤマ', aliases: ['アイリス'] },
  { en: 'KOIZUMI', ja: 'コイズミ' },
  { en: 'OHM', ja: 'オーム電機' },
  { en: 'YAZAWA', ja: 'ヤザワ' },
  { en: 'HotaluX', ja: 'ホタルクス' },
  { en: 'FLEXISPOT', ja: 'フレックススポット' },
  { en: 'Secretlab', ja: 'シークレットラボ' },
  { en: 'AKRacing', ja: 'エーケーレーシング' },

  // 音響・楽器
  { en: 'Audio-Technica', ja: 'オーディオテクニカ' },
  { en: 'Sennheiser', ja: 'ゼンハイザー' },
  { en: 'Bose', ja: 'ボーズ' },
  { en: 'Marshall', ja: 'マーシャル' },
  { en: 'Sonos', ja: 'ソノス' },
  { en: 'Jabra', ja: 'ジャブラ' },
  { en: 'Shure', ja: 'シュア' },
  { en: 'RODE', aliases: ['RØDE'] },
  { en: 'ADAM Audio', aliases: ['ADAM'] },
  { en: 'Fosi Audio', aliases: ['Fosi'] },
  { en: 'IK Multimedia', aliases: ['IK'] },
  { en: 'Vic Firth', aliases: ['VIC'] },
  { en: 'Ernie Ball', aliases: ['ERNIE'] },
  { en: 'XLN Audio', aliases: ['XLN'] },
  { en: 'Bang & Olufsen', aliases: ['Bang'] },
  { en: 'FiiO', ja: 'フィーオ' },
  { en: 'SOUNDPEATS', ja: 'サウンドピーツ' },
  { en: 'Yamaha', ja: 'ヤマハ' },
  { en: 'Roland', ja: 'ローランド' },
  { en: 'KORG', ja: 'コルグ' },
  { en: 'Casio', ja: 'カシオ' },
  { en: 'Kawai', ja: 'カワイ', aliases: ['河合楽器'] },
  { en: 'Akai', ja: 'アカイ' },
  { en: 'Alesis', ja: 'アレシス' },
  { en: 'Arturia', ja: 'アートリア' },
  { en: 'Moog', ja: 'モーグ' },
  { en: 'Fender', ja: 'フェンダー' },
  { en: 'Gibson', ja: 'ギブソン' },
  { en: 'Ibanez', ja: 'アイバニーズ' },
  { en: 'Epiphone', ja: 'エピフォン' },
  { en: 'Squier', ja: 'スクワイヤー' },
  { en: 'Universal Audio', ja: 'ユニバーサルオーディオ' },
  { en: 'Focusrite', ja: 'フォーカスライト' },

  // ゲーム・配信
  // 本体の名前が「ニンテンドークラシックミニ ファミリーコンピュータ」のように
  // メーカー名を名乗らない。単語区切りが無いので KNOWN_BRANDS に 'ニンテンドー' を
  // 足しても当たらない（後ろが文字だと語境界で弾かれる）ため families で持つ
  {
    en: 'Nintendo',
    ja: '任天堂',
    aliases: ['Wii', 'ニンテンドー'],
    families: ['ニンテンドークラシックミニ', 'ファミリーコンピュータ', 'スーパーファミコン'],
  },
  {
    en: 'PlayStation',
    ja: 'プレイステーション',
    aliases: ['プレステ', 'DualSense', 'DualShock'],
    families: ['DualSense', 'DualShock'],
  },
  // Steam Deck は名前にメーカーが出ない。ja は「バルブ」が一般語なので置かない
  { en: 'Valve', families: ['Steam Deck'] },
  { en: 'Razer', ja: 'レイザー' },
  { en: 'SteelSeries', ja: 'スティールシリーズ' },
  { en: 'Elgato', ja: 'エルガト' },
  { en: 'HyperX', ja: 'ハイパーエックス' },
  { en: 'Insta360', ja: 'インスタ360', aliases: ['Arashi Vision', 'Arashi'] },
  { en: 'HORI', ja: 'ホリ', aliases: ['ホリパッド'] },
  { en: 'Meta', families: ['Meta Quest', 'Quest 2', 'Quest 3', 'Quest Pro'] },

  // キーボード・ストレージ・スマートホーム
  { en: 'Keychron', ja: 'キークロン' },
  { en: 'Luminkey', aliases: ['Luminkey65', 'Luminkey80'] },
  { en: 'Rabbit0 Build', aliases: ['RABBIT0BUILD'] },
  { en: 'REALFORCE', ja: 'リアルフォース' },
  { en: 'FILCO', ja: 'フィルコ' },
  { en: 'SanDisk', ja: 'サンディスク' },
  { en: 'KIOXIA', ja: 'キオクシア' },
  { en: 'Crucial', ja: 'クルーシャル' },
  { en: 'Seagate', ja: 'シーゲイト' },
  { en: 'Transcend', ja: 'トランセンド' },
  { en: 'Synology', ja: 'シノロジー' },
  { en: 'Western Digital', ja: 'ウエスタンデジタル', aliases: ['WD', 'Western'] },
  { en: 'SwitchBot', ja: 'スイッチボット' },
  { en: 'Nanoleaf', ja: 'ナノリーフ' },
  { en: 'Philips', ja: 'フィリップス' },
  { en: 'Philips Hue' },
  { en: 'REGZA', ja: 'レグザ', aliases: ['TVS', 'TVS REGZA'] },
  { en: 'GARMIN', ja: 'ガーミン' },
  { en: 'Suunto', ja: 'スント' },
]

/**
 * ブランド欄に入っているがブランドではない表記。規格名（USB-C / M.2）と対応機種名
 * （PS5 / Surface / MacBook）で、ノーブランドのアクセサリが商品名の先頭に置くもの。
 *
 * 取り込み側（scripts/importRakutenGenres.ts の detectBrand）でも弾いているが、
 * 既存の行は再取り込みまで残るので、束ねる側でも落とす。
 * 新しい表記は `npm run audit:brands` の「辞書に無く件数の多いブランド」に出る。
 */
const NON_BRAND_KEYS = new Set([
  // 規格・端子
  'usba', 'usbb', 'usbc', 'typea', 'typec', 'usb20', 'usb30', 'usb31', 'usb32', 'usb40',
  'hdmi', 'displayport', 'm2', 'msata', 'sata', 'pcie', 'nvme',
  // 対応機種・OS
  'ps3', 'ps4', 'ps5', 'psvita', 'xbox', 'switch2', 'quest2', 'quest3',
  'surface', 'macbook', 'imac', 'ipadpro', 'fire', 'firetv',
  'android16', 'android15', 'android14',
  // 製品ファミリ名・規格名。アクセサリが商品名の先頭に置くので brand 列に入り込む。
  // 手元のガジェット名では families が先に当たるので、Apple に寄る側は壊れない
  'airpods', 'magsafe',
  // 販促語・汎用の構成名。既存データでは brand 列に残っていた
  'off', 'custom',
])

/**
 * 番号の付く規格名・対応機種名・製品名。NON_BRAND_KEYS と同じ性格だが、世代や版の数字が
 * 付いて表記が増えるので形で持つ（Bluetooth5.4 / HDMI2.1 / iPhone17e / X870E）。
 * 商品マスタ2万件の brand 列に実際に入っていたものだけを入れている。
 */
const NON_BRAND_PATTERN = new RegExp(`^(?:${[
  // 規格・仕様
  'bluetooth\\d*', 'wifi\\d*', 'hdmi\\d*', 'usb\\d*', 'usbrs232c', 'displayport\\d*', 'sd\\d*', 'sdhc', 'sdxc', 'cfexpress',
  'ddr\\d', 'rj45', 'pd\\d+w', 'm2ssd', 'windows\\d+', 'android\\d+', 'mp3', 'i2s', 'p2p', 'in1', 'am4', 'cr2016', 'hd', 'mic',
  // 販促
  'sale', 'vgp\\d{0,4}',
  // 対応機種・製品名（他社のアクセサリが頭に置く）
  'joycon\\d?', 'quest\\d?', 'iphone\\w*', 'pro11', 'mini9', 'playstation[45]', 'playstaton5', 'playstationvr2', 'dualshock\\d',
  'new3ds', 'ps\\d', 'ps4pro', 'nsw2', 'marvels', 'gemini(?:ai)?', 'inspiron', 'pavilion', 'spectre', 'tuf', 'mpg', 'zpad3', 'loop8',
  // チップセット（B850 / X870E / Z890M）
  '[abhxz]\\d{3}[a-z]?(?:x)?', 'h610me', 'x[45]',
].join('|')})$`)

/**
 * 型番が brand 列に入っている（VW-VBT380-K / RBC123J-S / ST4000DM004 / EP-804A）。
 * 英字4文字以下＋数字2桁以上か、数字を含むハイフン区切り。
 * `Insta360` `Club3D` `8BitDo` のような数字入りのブランドはこの形に当たらない。
 */
function looksLikeModelNumber(raw: string): boolean {
  const value = raw.normalize('NFKC').trim()
  if (/^(?=.*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)+$/.test(value)) return true
  // APCRBC123J / CMK32GX4M2E3200C16 のような区切りなしの大文字型番。
  // 8BitDo / j5create など大小文字を含むブランドはここへ入れない。
  if (/^(?=.*\d)[A-Z0-9]{5,}$/.test(value)) return true
  return /^[A-Za-z]{1,4}\d{2,}[A-Za-z0-9]*$/.test(value)
}

/** ブランド欄に入っていてもブランドとして扱わない表記か */
export function isNonBrand(raw?: string | null): boolean {
  const key = raw ? compactBrand(raw) : ''
  if (!key) return false
  if (NON_BRAND_KEYS.has(key) || NON_BRAND_PATTERN.test(key)) return true
  return looksLikeModelNumber(raw ?? '') && !BY_ALIAS.has(key) && !KNOWN_BRAND_KEYS.has(key)
}

export const BRAND_ENTRIES: BrandEntry[] = ENTRIES.map((e) => ({ ...e, id: compactBrand(e.en) }))

const BY_ALIAS = new Map<string, BrandEntry>()
for (const entry of BRAND_ENTRIES) {
  for (const alias of [entry.en, entry.ja, ...(entry.aliases ?? [])]) {
    const key = alias ? compactBrand(alias) : ''
    if (key) BY_ALIAS.set(key, entry)
  }
}

/**
 * ブランドを束ねるためのキー。表に無いブランドは表記を潰したものがそのままキーになる
 * （`UGREEN` と `Ugreen` は表に無くてもここで一致する）。
 */
export function brandKey(raw?: string | null): string | undefined {
  const key = raw ? compactBrand(raw) : ''
  if (!key || isNonBrand(raw)) return undefined
  return BY_ALIAS.get(key)?.id ?? key
}

/** 画面に出すブランド名。表に無ければ受け取った表記をそのまま返す */
export function brandDisplay(raw: string | null | undefined, lang: 'ja' | 'en'): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed || isNonBrand(trimmed)) return undefined
  const entry = BY_ALIAS.get(compactBrand(trimmed))
  if (!entry) return trimmed
  return (lang === 'ja' ? entry.ja : entry.en) ?? entry.en
}

/** キーから引く。未知のキーは表記を持たないので undefined */
export function brandEntry(key: string): BrandEntry | undefined {
  return BRAND_ENTRIES.find((entry) => entry.id === key)
}

/**
 * そのブランドが products.brand に入りうる表記をすべて返す。
 *
 * brand 列は商品名から機械的に抜いた文字列で、辞書の別名のどれで入っているか
 * 分からない。ブランドで商品を引くときは、この全部で当てにいく必要がある。
 * 未知のキーは手掛かりが無いので空を返す（呼び側がキー自身で当てる）。
 */
export function brandAliases(key: string): string[] {
  const entry = brandEntry(key)
  if (!entry) return []
  const all = [entry.en, entry.ja, ...(entry.aliases ?? [])].filter((v): v is string => !!v)
  return [...new Set(all)]
}

// 全角英数が混じった名前でも同じように照合できるよう半角へ寄せる
function normalizeForMatch(value: string): string {
  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .trim()
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * ブランド一覧。gadgetPresets.ts の商品名の先頭語から抽出し、
 * 楽天で多い日本語表記を足したもの。
 *
 * 楽天のノーブランド品は商品名がSEOキーワードの羅列で
 * （例:「マウス ワイヤレスマウス 無線 充電式 Bluetooth 5.1 LED 光学式 超薄型…」）、
 * 予測変換の候補として使えない。ブランドを名乗る商品だけ取り込む。
 *
 * 'mouse'（マウスコンピューター）'Blue'（マイクのBlue）のような一般語と衝突する
 * ブランドは、商品説明に紛れて誤爆するので意図的に入れていない。
 */
const KNOWN_BRANDS = [
  // 日本語表記（楽天で多い）
  'ロジクール', 'エレコム', 'サンワサプライ', 'サンワダイレクト', 'バッファロー',
  'アイ・オー・データ', 'アイオーデータ', 'ソニー', 'パナソニック', 'シャープ',
  'オーディオテクニカ', 'ヤマハ', 'ローランド', 'ゼンハイザー', 'ボーズ',
  'アンカー', 'アイリスオーヤマ', 'ニトリ', 'コクヨ', 'オカムラ', 'イトーキ',
  'エレコム', '山善', 'バウヒュッテ', 'エルゴトロン', 'ケンジントン', 'サンコー',
  // 家具・照明。デスク/チェア/ライトのジャンルは日本語ブランドが中心で、
  // 英字ブランド前提のままだと300件中13件しか通らなかった
  'ニトリ', 'タンスのゲン', 'アイリスオーヤマ', 'ドウシシャ', '不二貿易',
  '白井産業', '佐藤産業', 'コイズミ', 'オーム電機', 'ヤザワ', 'ホタルクス',
  '東芝', '日立', '三菱', 'カインズ', 'アイリス', 'ぼん家具', 'エア・リゾーム',
  'ロウヤ', 'モダンデコ', 'タマリビング', 'アール・エフ・ヤマカワ', 'プラス', 'ホリパッド',
  'イケア',
  // 英語表記（プリセット由来）
  'Audio-Technica', 'AVerMedia', 'Minisforum', 'ThinkCentre', 'Universal Audio',
  'Sennheiser', 'SteelSeries', 'Kensington', 'FLEXISPOT', 'FlexiSpot', 'Logicool',
  'Nanoleaf', 'SwitchBot', 'Bauhutte', 'Ergotron', 'Secretlab', 'AKRacing',
  'DXRacer', 'Beelink', 'Focusrite', 'Satechi', 'CalDigit', 'REALFORCE',
  'DrunkDeer', 'Monsgeek', 'Keychron', 'Synology', 'Crucial', 'BUFFALO',
  'Western Digital', 'Native Instruments', 'Native Union',
  'I-O DATA', 'IO-DATA', 'Buffalo', 'Samsung', 'Marshall', 'Anycubic', 'Creality',
  'Microsoft', 'PlayStation', 'Nintendo', 'Elgato', 'HyperX', 'ELECOM',
  'Belkin', 'Baseus', 'Philips', 'TP-Link', 'Ugreen', 'UGREEN', 'AUKEY',
  'Xiaomi', 'GARMIN', 'Suunto', 'COROS', 'Pixio', 'iiyama', 'Lenovo',
  'Wacom', 'EPSON', 'Canon', 'Brother', 'Amazon', 'Apple', 'Google',
  'Razer', 'Sony', 'Bose', 'ASUS', 'Yamaha', 'YAMAHA', 'Govee', 'Roland',
  'Anker', 'Dell', 'BenQ', 'Pulsar', 'Fender', 'Gibson', 'Ibanez',
  'Epiphone', 'Squier', 'Martin', 'Taylor', 'Kawai', 'KORG', 'Korg',
  'Casio', 'Moog', 'Alesis', 'Arturia', 'Akai', 'MOTU', 'RODE', 'RØDE',
  'Shure', 'Maono', 'OBSBOT', 'Insta360', 'SanDisk', 'LaCie', 'Seagate',
  'KIOXIA', 'キオクシア',
  // Xperia は Sony の製品ファミリ（上の families）。ここにも置くとブランド名として先に当たり、
  // プリセットの Xperia が Sony ではなく「Xperia」という別ブランドで入っていた
  'Transcend', 'Audient', 'FiiO', 'SMSL', 'Mackie', 'OneOdio',
  'OnePlus', 'CHOETECH', 'Lepow', 'cheero', 'Zendure', 'mophie', 'RAVPower',
  'TORRAS', 'Spigen', 'Jabra', 'Sonos', 'Creative', 'HUANUO', 'Twinkly',
  'QUNTIS', '8BitDo', 'QANBA', 'Prusa', 'XREAL', 'Plugable', 'Club3D',
  'Nothing', 'Bambu', 'Huawei', 'MSI', 'AOC', 'HHKB', 'FILCO', 'NuPhy',
  'IKEA', 'LOWYA', 'JBL', 'KEF', 'CIO', 'HORI', 'Meta', 'HTC', 'NEC',
  // 2語で1つのブランド名。先頭語だけ採ると 'Herman' 'Harman' 'Mad' で別々に束なる
  'Herman Miller', 'Harman Kardon', 'Mad Catz', 'North Bayou', 'Music Man', 'Line 6',
  'ATTACK SHARK', 'Cooler Master', 'Fractal Design', 'Endgame Gear', 'Pioneer DJ',
  'IK Multimedia', 'j5create', 'j5 create', 'Blackmagic Design', 'ADAM Audio',
  'Vic Firth', 'Fosi Audio', 'Ernie Ball', 'XLN Audio', 'Bambu Lab',
  'Bang & Olufsen', 'Schneider Electric', 'Philips Hue', 'TVS REGZA', 'REGZA', 'Arashi Vision',
  // brand 列に頭の1語（OM / BIGBIG / GREEN / SK / Club / Cable）だけが入っていた
  'OM SYSTEM', 'BIGBIG WON', 'GREEN HOUSE', 'SK hynix', 'Club 3D', 'Cable Matters', 'H2 INTERACTIVE', 'IO Data',
  'HP', 'LG', 'Acer', 'Valve',
  // iPad / MacBook / Surface などの製品シリーズ名は入れない。
  // ノーブランドのアクセサリが対応機種として商品名に並べるため
  // （「縦横両対応 ipad キーボード 軽量 air…」）、ブランド判定が素通りになる。
  // 本体は「Apple ○○」と表記されるので 'Apple' で拾える。
]
// 長いブランド名を先に判定する（'Logicool' より先に 'Logi' が当たらないように）
const BRANDS_SORTED = [...new Set(KNOWN_BRANDS)].sort((a, b) => b.length - a.length)
const KNOWN_BRAND_KEYS = new Set(KNOWN_BRANDS.map(compactBrand))

// 名前1件ごとに180個の正規表現を組み直すと一覧の再計算が目に見えて遅くなるので、
// 読み込み時に1度だけ作る
const BRAND_MATCHERS = BRANDS_SORTED.map((brand) => ({
  brand,
  startPattern: new RegExp(
    `^${escapeForRegExp(normalizeForMatch(brand))}(?![\\p{L}\\p{N}])`,
    'iu',
  ),
  pattern: new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeForRegExp(normalizeForMatch(brand))}(?![\\p{L}\\p{N}])`,
    'iu',
  ),
}))

/** 名前の先頭にある完全な既知ブランドを返す。複合ブランドを先頭1語より優先する。 */
export function knownBrandAtStart(name: string): string | undefined {
  const head = normalizeForMatch(name).slice(0, 60)
  return BRAND_MATCHERS.find(({ startPattern }) => startPattern.test(head))?.brand
}

/**
 * 先頭が英字でもブランドではない語。
 * 「Bluetooth ワイヤレスイヤホン …」のようなノーブランド品を弾く。
 */
const GENERIC_HEAD_WORDS = new Set([
  'bluetooth', 'usb', 'pc', 'tv', 'hdmi', 'type', 'wireless', 'gaming', 'led',
  '4k', '8k', 'anc', 'hifi', 'dac', 'ssd', 'hdd', 'sd', 'microsd', 'ac', 'otg',
  'vga', 'dp', 'kvm', 'nas', 'wifi', 'wi', 'lan', 'poe', 'ups', 'rgb', 'oem',
  'new', 'set', 'free', 'best', 'ai', 'iot', 'pd', 'qi', 'gan', 'ipx', 'dpi',
  // 「OFF 中 08 01 00:00〜 …」のような値引き表記で始まる出品タイトル対策
  'off', 'sale', 'point', 'coupon', 'custom', 'msata',
  'ghz', 'mah', 'w', 'k', 'the', 'and', 'for', 'with', 'mini', 'pro', 'max',
  'plus', 'air', 'one', 'mac', 'ipad', 'iphone', 'android', 'windows', 'switch',
])

/**
 * 名前の先頭付近にあるブランド名を返す入口。返すのは KNOWN_BRANDS の表記
 * そのままなので、束ねるときは brandKey() / brandDisplay() に通す。
 *
 * **入口は2つに分かれている。** 楽天取り込み（scripts/importRakutenGenres.ts /
 * backfillProductBrands.ts）は brandFromName、自分のガジェットを束ねる画面と
 * 公開時のブランド焼き込みは brandFromGadgetName。要求が逆向きで、
 * 1本にすると取り込み側の抑制が表示側を壊す（Apple 製品が全部「その他」に落ちた）。
 *
 * 位置を先頭に限定するのは、ノーブランド品が末尾に対応機種を列挙するため
 * （「…高精度 コンパクト Mac Windows surface Microsoft Pro 光学式」）。
 * ここで Microsoft を拾うとフィルタが素通りになる。
 *
 * 既知リストに無くても先頭語が英字ならブランドとみなす。JAPANNEXT や
 * SOUNDPEATS のようにリストで網羅しきれないメーカーが多く、
 * 逆にノーブランド品の商品名は「マウス ワイヤレスマウス…」と日本語で始まる。
 */
// 対応先・OS・一般語として商品名へ現れやすく、名前の途中ではメーカーと断定できないもの。
const EMBEDDED_AMBIGUOUS_BRAND_IDS = new Set([
  'apple', 'google', 'microsoft', 'sony', 'samsung', 'nintendo', 'playstation',
  'amazon', 'meta', 'lg', 'hp', 'プラス',
])

/** 名前の先頭付近に既知ブランドがあればそれを返す。推定（先頭語）は含まない */
export function knownBrandInName(name: string): string | undefined {
  const head = normalizeForMatch(name).slice(0, 25)
  for (const { brand, pattern } of BRAND_MATCHERS) {
    const match = pattern.exec(head)
    if (!match) continue
    const id = brandKey(brand) ?? compactBrand(brand)
    if (match.index === 0 || !EMBEDDED_AMBIGUOUS_BRAND_IDS.has(id)) return brand
  }
  return undefined
}

// 製品ファミリ名 → メーカー名。長いものを先に見る（'Mac Pro' より 'Mac Studio'）。
//
// 既知ブランドと違って**名前の先頭ちょうど**でしか当てない。ファミリ名は
// アクセサリが対応機種として名前の途中に置く語で、辞書に無いメーカーが
// 頭にあると（`NIMASO iPad Air11` `BENFEI Mac mini M4 ドック`）そちらを
// 追い越してしまう。先頭に限れば、実在するメーカー名が先頭語として残る。
// 商品マスタで実測すると、先頭以外で当たっていた181件は全部そのアクセサリだった。
const FAMILY_MATCHERS = BRAND_ENTRIES.flatMap((entry) =>
  (entry.families ?? []).map((family) => ({
    en: entry.en,
    length: family.length,
    pattern: new RegExp(`^${escapeForRegExp(normalizeForMatch(family))}(?![\\p{L}\\p{N}])`, 'iu'),
  })),
).sort((a, b) => b.length - a.length)

/** 名前の先頭にある製品ファミリ名からメーカーを引く（`MacBook Pro 14"` → `Apple`） */
export function makerOfProductFamily(name: string): string | undefined {
  const head = normalizeForMatch(name)
  return FAMILY_MATCHERS.find(({ pattern }) => pattern.test(head))?.en
}

export function brandFromName(name: string): string | undefined {
  return knownBrandAtStart(name) ?? brandFromHeadWord(name) ?? knownBrandInName(name)
}

/**
 * 自分が登録したガジェット名からブランドを引く。**楽天取り込みには使わない。**
 *
 * brandFromName との差は製品ファミリ名（MacBook / Surface / AirPods）を
 * メーカーに寄せる1点だけ。手元のガジェットは「持ち物の一覧」なので、
 * 本体が「その他」に落ちるほうが、アクセサリが Apple に混じるより悪い。
 * 取り込み側は逆で、対応機種を名乗るノーブランド品を Apple 製品として
 * 商品マスタに載せるほうが悪い（実測で125件）。
 *
 * 「MacBook Pro 用スリーブ」のような手元のアクセサリは Apple に入る。
 * 一覧で隣に本体が並ぶ以上、その並びは読めるので許容する。
 */
export function brandFromGadgetName(name: string): string | undefined {
  const exact = knownBrandAtStart(name)
  if (exact) return exact
  const family = makerOfProductFamily(name)
  if (family) return family
  // makerOfProductFamily は名前の先頭だけを見るため、NIMASO iPad のような
  // 他社アクセサリではここまでに family が返らず、先頭メーカーを保てる。
  return brandFromHeadWord(name) ?? knownBrandInName(name)
}

/**
 * 公開時に devices へ焼くブランド（075）。
 *
 * 検索は devices の行しか見られないので、ここで持たせないと
 * 「ロジクール」でも「Logitech」でも公開デスクに当たらない。
 * aliases は焼いた時点の辞書。辞書を足しても過去の行は次に公開し直すまで
 * 古いまま（073 の product_id と同じ割り切り）。
 */
export function gadgetBrandForPublish(name: string): { brand: string | null; brand_aliases: string[] } {
  const raw = brandFromGadgetName(name)
  if (!raw) return { brand: null, brand_aliases: [] }
  const key = brandKey(raw)
  const brand = brandDisplay(raw, 'en') ?? raw
  const aliases = key ? brandAliases(key) : []
  return { brand, brand_aliases: aliases.length > 0 ? aliases : [brand] }
}

// 作り手が誰であっても「純正ではない」と言っている語
const AFTERMARKET_WORDS = /(互換|非純正|代用|交換用|交換部品|交換バッテリー|修理用|worldplus)/i
// 「そのブランドに対応している」だけの主張。作り手が名前から分かる行には使わない
// （「Anker MFi認証 ケーブル」は Anker の棚に置いてよい Anker 製品）
const COMPAT_CLAIM_WORDS = /(公式ライセンス|ライセンス品|認証品|認証取得|認証|mfi|対応用|対応品)/i

/**
 * 「for <そのブランド>」と名乗っているか（`BUITFOU For AirPods Pro 3`）。
 *
 * `for` だけを見ると、ソニーのコピー「Perfect for Play」のような宣伝文句まで
 * 対応品と読んでしまう。直後にそのブランドの名前か製品ファミリが来るときだけ数える。
 */
function claimsCompatibilityFor(name: string, key: string): boolean {
  const entry = brandEntry(key)
  const targets = new Set(
    [key, ...brandAliases(key), ...(entry?.families ?? [])].map((v) => compactBrand(v)),
  )
  for (const match of normalizeForMatch(name).matchAll(/(?:^|[^a-z])for\s+([a-z0-9]+)/gi)) {
    if (targets.has(compactBrand(match[1]))) return true
  }
  return false
}
// 本体メーカーが出していない種類の商品。エレコムのようなアクセサリ本業の
// メーカーには効かせない（そちらの棚では正規の商品なので）
// 「バンド」は入れない。ヘッドバンドを名前に書くヘッドセット（INZONE H9）が巻き込まれる
const DEVICE_ACCESSORY_WORDS =
  /(フィルム|保護ガラス|強化ガラス|高硬度|覗き見防止|ブルーライトカット|ケース|カバー|スタンド|ホルダー|ペン先|ストラップ|電源ユニット|紛失防止|スキンシール)/i
// 自分で純正だと名乗っている行はアクセサリでも棚に残す。
// 「ソニー純正 デュアルセンス 充電スタンド」のような一次アクセサリを落とさないため
// （「非純正」は上の AFTERMARKET_WORDS が先に拾う）
const GENUINE_CLAIM = /純正/

/**
 * その商品を「そのブランドの棚」（074 のフォロー一覧）に並べてよいか。
 *
 * products.brand は商品名の先頭付近から機械的に抜いた文字列なので、他社の
 * アクセサリが「Apple認証品」と名乗るだけでそのブランドに入る。実測では
 * PlayStation 42% / Nintendo 39% / Apple 32% が純正でないと読める行だった。
 *
 * **brand 列は書き換えない。** 「名前にその語がある」という判定自体は正しく、
 * 棚に並べてよいかは別の問題なので、読むときに落とす。辞書を直せば過去の行にも
 * 即座に効くという 074 の方針もそのまま保てる。
 */
export function isAftermarketListing(name: string, key: string): boolean {
  if (AFTERMARKET_WORDS.test(name)) return true
  // 先頭語が別のメーカー。「QISI 追跡タグ GPS Apple認証品」のように、
  // 実際の作り手を頭に置いて対応機種のブランドを本文に入れる商品が多い
  const head = brandFromHeadWord(name)
  const headKey = head ? brandKey(head) : undefined
  if (headKey && headKey !== key) return true
  // 作り手が分からないまま「対応」だけを名乗る行
  if (!headKey && COMPAT_CLAIM_WORDS.test(name)) return true
  if (claimsCompatibilityFor(name, key)) return true
  // 本体メーカーの棚に並ぶ保護フィルム・スタンド・交換ペン先の類。
  // 名前の頭がそのメーカーでも（「Apple AirTag 表面・背面フィルムセット OverLay」）
  // 作っているのは別の会社で、本体メーカー自身はこの手の商品をほとんど出していない。
  //
  // 「ほとんど」なので取りこぼす側もある。ソニーのカメラ用ケース、任天堂の
  // 純正キャリングケースのような一次アクセサリは、純正と名乗っていなければ棚から消える。
  // 他社品を100件単位で落とすのと引き換えに数件を諦めている。
  return isDeviceMaker(key) && !GENUINE_CLAIM.test(name) && DEVICE_ACCESSORY_WORDS.test(name)
}

/**
 * 本体を作っているメーカーか。families（製品ファミリ名）を持つかどうかで判定する。
 *
 * 「本体の名前にメーカー名が出ない」から families が要るわけで、それはそのまま
 * 「本体を作っている会社」の印になっている。エレコムやアンカーのような
 * アクセサリを本業にするメーカーは families を持たない。
 * **families を足すときは、この判定にも効くことに注意する**
 * （保護フィルムがそのメーカーの棚から消える）。
 */
function isDeviceMaker(key: string): boolean {
  return (brandEntry(key)?.families?.length ?? 0) > 0
}

function brandFromHeadWord(name: string): string | undefined {
  const first = name.trim().split(/\s+/)[0] ?? ''
  if (!/^[A-Za-z][A-Za-z0-9&.'-]{1,20}$/.test(first)) return undefined
  if (/^(?:windows|android|type-|office)\d/i.test(first)) return undefined
  // 規格名・対応機種名（USB-C / M.2 / PS5 / Surface）。ノーブランド品が頭に置く
  if (isNonBrand(first)) return undefined
  return isGenericHead(first) ? undefined : first
}

/**
 * 一般語そのものだけでなく、一般語に規格や世代を足しただけの先頭語も弾く。
 * `USB-C` `USB3.0` `Switch2` `Android16` は `usb` `switch` `android` と同じくブランドではないが、
 * 語全体の一致で見ていると素通りする。
 *
 * 削るのは「区切り+英字1文字」か末尾の数字だけにする。`ONE-NETBOOK` の `NETBOOK` まで
 * 削ると実在のメーカーを落とすし、`KZ` や `WD` のような2文字ブランドも巻き込む。
 */
function isGenericHead(first: string): boolean {
  const lower = first.toLowerCase()
  for (const value of [lower, lower.replace(/[^a-z0-9]/g, '')]) {
    if (GENERIC_HEAD_WORDS.has(value)) return true
    const base = /^([a-z]+)(?:-[a-z]|\d[\d.]*)$/.exec(value)?.[1]
    if (base && GENERIC_HEAD_WORDS.has(base)) return true
  }
  return false
}
