import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import type { MCIconName } from './icons'
import { DESK_CATEGORY_ICONS } from './deskCategoryIcons'

// ─── 自分で名前を付けるもの（自作ジャンル・用途の「その他」）に選べるアイコン ─────
//
// どちらも「アプリが用意していない物」を足すための入口なので、絵を絞ると入口の意味が無くなる。
// 同梱の MaterialCommunityIcons 全件（約7,400）から選べるようにし、
// 探す手間は「分類済みの候補を先に見せる」と「日本語でも引ける検索」で減らす。
// 用途の画面では OTHER_PURPOSE_ICONS（14個）をすぐ押せる候補として残し、その先にこれを置く。

const GLYPH_MAP = MaterialCommunityIcons.glyphMap as Record<string, number>

/** 同梱フォントにある全アイコン名。検索の母集団 */
export const ALL_ICON_NAMES: readonly string[] = Object.keys(GLYPH_MAP)

/**
 * アイコン名として描ける値か。公開デスクの customCategory は他人の端末が書いた JSON で、
 * 知らない名前を渡すとフォントの「?」が出る（開発ビルドでは警告が出続ける）
 */
export function isIconName(name: unknown): name is MCIconName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(GLYPH_MAP, name)
}

export interface IconGroup {
  titleJa: string
  titleEn: string
  icons: readonly string[]
}

/**
 * 検索欄が空のときに並べる候補。デスクに置かれそうな物・デスクでする事から順に並べる。
 * 既存カテゴリと同じ絵（CATEGORY_ICONS）は避けていない。自作ジャンルは
 * 「既存の名前では呼びたくない物」でもあるので、近い絵を選ぶ自由を残す。
 */
export const ICON_CHOICE_GROUPS: readonly IconGroup[] = [
  {
    titleJa: 'デジタル・家電', titleEn: 'Devices',
    icons: [
      'cube-outline', 'chip', 'memory', 'server', 'nas', 'harddisk', 'sd', 'usb-flash-drive-outline',
      'cellphone', 'tablet', 'laptop', 'monitor', 'television-classic', 'remote', 'radio',
      'fax', 'printer-outline', 'scanner', 'calculator-variant-outline', 'watch-variant',
      'fan', 'air-conditioner', 'air-purifier', 'air-humidifier', 'heating-coil', 'robot-vacuum',
      'fridge-outline', 'kettle-outline', 'coffee-maker-outline', 'microwave', 'toaster-oven',
      'lamp-outline', 'lightbulb-outline', 'led-strip-variant', 'ceiling-light-outline', 'string-lights',
      'battery-outline', 'solar-panel', 'wifi', 'antenna', 'access-point', 'bluetooth',
      'drone', 'robot-outline', 'robot-industrial-outline', 'rocket-outline', 'satellite-variant',
      'nfc-variant', 'barcode-scan', 'qrcode', 'fingerprint', 'cctv', 'doorbell-video',
    ],
  },
  {
    titleJa: '音・映像', titleEn: 'Audio & video',
    icons: [
      'music-note', 'music', 'headphones', 'headset', 'speaker-wireless', 'volume-high', 'radio-tower',
      'record-player', 'album', 'cassette', 'disc-player', 'guitar-electric', 'guitar-acoustic',
      'piano', 'saxophone', 'trumpet', 'violin', 'bugle', 'metronome', 'midi', 'midi-port',
      'knob', 'tune', 'equalizer-outline', 'waveform', 'microphone-outline', 'podcast',
      'filmstrip', 'movie-open-outline', 'video-outline', 'video-vintage', 'camcorder', 'camera-outline',
      'camera-iris', 'camera-timer', 'flash-outline', 'spotlight-beam', 'projector-screen-outline', 'theater',
    ],
  },
  {
    titleJa: 'ゲーム・ホビー', titleEn: 'Games & hobbies',
    icons: [
      'gamepad-variant-outline', 'controller-classic-outline', 'nintendo-game-boy',
      'cards-playing-outline', 'cards-outline', 'dice-multiple-outline', 'chess-knight', 'puzzle-outline',
      'toy-brick-outline', 'robot-happy-outline', 'teddy-bear', 'kite-outline',
      'palette-outline', 'brush', 'draw', 'pencil-ruler', 'fountain-pen-tip', 'spray',
      'needle', 'scissors-cutting', 'content-cut',
      'hammer-screwdriver', 'screwdriver', 'wrench-outline', 'saw-blade', 'soldering-iron', 'tape-measure',
      'printer-3d-nozzle-outline', 'magnet', 'flask-outline', 'microscope', 'telescope', 'test-tube',
      'book-open-page-variant-outline', 'notebook-outline', 'newspaper-variant-outline',
      'star-shooting-outline', 'trophy-outline', 'medal-outline', 'crown-outline', 'sword', 'shield-outline',
    ],
  },
  {
    titleJa: '文具・仕事', titleEn: 'Stationery & work',
    icons: [
      'pencil-outline', 'pen', 'marker', 'lead-pencil', 'eraser', 'ruler', 'paperclip', 'pin-outline',
      'note-outline', 'sticker-outline', 'clipboard-outline',
      'folder-outline', 'file-document-outline', 'archive-outline', 'tray-full', 'inbox-outline',
      'briefcase-outline', 'badge-account-outline', 'card-account-details-outline', 'stamper',
      'calendar-month-outline', 'clock-outline', 'alarm', 'timer-outline', 'timer-sand',
      'presentation', 'chart-line', 'post-outline', 'email-outline', 'phone-classic',
    ],
  },
  {
    titleJa: '家具・インテリア', titleEn: 'Furniture & decor',
    icons: [
      'table-furniture', 'desk', 'chair-rolling', 'seat-outline', 'sofa-single-outline', 'bed-outline',
      'wardrobe-outline', 'dresser-outline', 'bookshelf', 'cupboard-outline', 'table-chair',
      'mirror', 'window-closed-variant', 'curtains', 'blinds', 'door', 'rug', 'floor-lamp-outline',
      'wall-sconce-outline', 'coat-rack', 'hanger', 'clock-time-four-outline', 'image-frame',
      'candle', 'flower-outline', 'flower-tulip-outline', 'sprout-outline', 'cactus', 'leaf',
      'tree-outline', 'pine-tree', 'mushroom-outline', 'basket-outline', 'package-variant', 'trash-can-outline',
    ],
  },
  {
    titleJa: '飲食', titleEn: 'Food & drink',
    icons: [
      'coffee-outline', 'cup-outline', 'tea-outline', 'glass-mug-variant', 'bottle-soda-outline',
      'bottle-wine-outline', 'glass-cocktail', 'beer-outline', 'water-outline', 'blender-outline',
      'food-apple-outline', 'fruit-cherries', 'fruit-grapes-outline', 'carrot', 'bread-slice-outline',
      'cookie-outline', 'candy-outline', 'cupcake', 'ice-cream', 'pizza', 'hamburger', 'noodles',
      'rice', 'food-drumstick-outline', 'egg-outline', 'silverware-fork-knife', 'pot-steam-outline',
    ],
  },
  {
    titleJa: '生活・身の回り', titleEn: 'Everyday',
    icons: [
      'bag-personal-outline', 'wallet-outline', 'key-outline', 'umbrella-outline', 'glasses',
      'sunglasses', 'hat-fedora', 'tshirt-crew-outline', 'shoe-sneaker', 'watch', 'ring', 'diamond-stone',
      'lipstick', 'spray-bottle', 'lotion-outline', 'toothbrush', 'hair-dryer-outline', 'razor-double-edge',
      'pill', 'medical-bag', 'thermometer', 'heart-pulse', 'weight-kilogram', 'scale-bathroom',
      'shower-head', 'washing-machine', 'iron-outline', 'broom', 'vacuum-outline',
      'paper-roll-outline', 'face-mask-outline', 'baby-bottle-outline', 'smoking-off',
    ],
  },
  {
    titleJa: 'スポーツ・アウトドア', titleEn: 'Sports & outdoors',
    icons: [
      'dumbbell', 'weight-lifter', 'run', 'bike', 'yoga', 'meditation', 'jump-rope', 'boxing-glove',
      'basketball', 'soccer', 'baseball', 'tennis', 'golf', 'volleyball', 'football', 'skateboard',
      'ski', 'surfing', 'swim', 'campfire', 'tent', 'hiking', 'compass-outline',
      'binoculars', 'map-outline', 'flashlight', 'image-filter-hdr', 'weather-sunny',
      'weather-night', 'umbrella-beach-outline', 'snowflake', 'fire', 'water', 'lightning-bolt-outline',
    ],
  },
  {
    titleJa: '乗り物', titleEn: 'Vehicles',
    icons: [
      'car-outline', 'car-sports', 'motorbike', 'scooter', 'bicycle', 'bus', 'train', 'tram',
      'airplane', 'helicopter', 'ferry', 'sail-boat', 'rocket-launch-outline', 'truck-outline',
      'steering', 'car-battery', 'ev-station', 'gas-station-outline', 'parking', 'traffic-light-outline',
    ],
  },
  {
    titleJa: '生き物', titleEn: 'Animals',
    icons: [
      'cat', 'dog', 'rabbit', 'paw', 'fish', 'bird', 'duck', 'owl', 'penguin', 'turtle', 'snake',
      'spider', 'bee', 'butterfly-outline', 'ladybug', 'jellyfish-outline', 'dolphin', 'elephant',
      'horse-variant', 'cow', 'pig-variant-outline', 'sheep', 'panda', 'koala', 'unicorn-variant',
      'bone', 'fishbowl-outline', 'dog-side',
    ],
  },
  {
    titleJa: '記号・形', titleEn: 'Symbols & shapes',
    icons: [
      'shape-outline', 'circle-outline', 'square-outline', 'triangle-outline', 'hexagon-outline',
      'octagon-outline', 'star-outline', 'star-four-points-outline', 'heart-outline', 'rhombus-outline',
      'pentagon-outline', 'cards-heart-outline', 'cards-spade-outline', 'cards-club-outline',
      'cards-diamond-outline', 'infinity', 'atom', 'earth', 'moon-waning-crescent', 'white-balance-sunny',
      'cloud-outline', 'lightning-bolt', 'fire-circle', 'flag-outline', 'tag-outline', 'bookmark-outline',
      'bell-outline', 'gift-outline', 'party-popper', 'balloon', 'emoticon-happy-outline', 'emoticon-cool-outline',
      'ghost-outline', 'alien-outline', 'skull-outline', 'pirate', 'crown', 'diamond-outline',
      'numeric-1-box-outline', 'alpha-a-box-outline', 'help-circle-outline', 'dots-horizontal-circle-outline',
    ],
  },
]

/**
 * 日本語の検索語 → 英語のアイコン名に含まれる語。
 * アイコン名は英語なので、日本語で打つ人（大半の利用者）にはこれが無いと検索が0件になる。
 * 全語彙を訳すのは無理なので、ジャンル名になりそうな語だけを持つ。
 */
export const ICON_SEARCH_ALIASES_JA: Readonly<Record<string, readonly string[]>> = {
  'ギター': ['guitar'], 'ピアノ': ['piano'], '楽器': ['guitar', 'piano', 'violin', 'saxophone', 'trumpet', 'harp'],
  'バイオリン': ['violin'], 'サックス': ['saxophone'], '音楽': ['music'], '音符': ['music-note'],
  'レコード': ['record', 'album'], 'カセット': ['cassette'], 'ラジオ': ['radio'], 'スピーカー': ['speaker'],
  'ヘッドホン': ['headphones', 'headset'], 'マイク': ['microphone'], 'カメラ': ['camera'], 'ビデオ': ['video', 'camcorder'],
  '映画': ['movie', 'filmstrip'], 'ゲーム': ['gamepad', 'controller', 'game'], 'カード': ['cards'],
  'サイコロ': ['dice'], 'チェス': ['chess'], 'パズル': ['puzzle'], 'おもちゃ': ['toy', 'teddy'], 'ぬいぐるみ': ['teddy'],
  'フィギュア': ['robot-happy', 'account', 'human'], 'プラモ': ['toy-brick', 'robot'], 'ロボット': ['robot'],
  '絵': ['palette', 'brush', 'draw'], '画材': ['palette', 'brush'], 'ペン': ['pen', 'pencil', 'marker'], '鉛筆': ['pencil'],
  '文房具': ['pencil', 'pen', 'ruler', 'paperclip', 'eraser'], '文具': ['pencil', 'pen', 'ruler', 'paperclip'],
  'ノート': ['notebook', 'note'], '本': ['book'], '漫画': ['book', 'bookshelf'], '雑誌': ['newspaper', 'book'],
  '工具': ['hammer', 'wrench', 'screwdriver', 'saw', 'tools'], 'ドライバー': ['screwdriver'], 'はんだ': ['soldering'],
  '裁縫': ['needle', 'scissors'], 'はさみ': ['scissors', 'content-cut'],
  '実験': ['flask', 'test-tube', 'microscope'], '顕微鏡': ['microscope'], '望遠鏡': ['telescope'],
  '時計': ['clock', 'watch', 'alarm'], 'カレンダー': ['calendar'], 'タイマー': ['timer'],
  '家具': ['sofa', 'chair', 'table', 'wardrobe', 'dresser', 'shelf'], '棚': ['shelf', 'bookshelf', 'cupboard'],
  '椅子': ['chair', 'seat'], '机': ['desk', 'table'], 'ベッド': ['bed'], 'ソファ': ['sofa'], '鏡': ['mirror'],
  'カーテン': ['curtains'], '照明': ['lamp', 'lightbulb', 'ceiling-light', 'led'], 'ライト': ['lamp', 'lightbulb', 'flashlight', 'led'],
  '花': ['flower'], '植物': ['sprout', 'leaf', 'cactus', 'flower', 'tree'], 'サボテン': ['cactus'], '観葉植物': ['sprout', 'leaf'],
  '木': ['tree', 'pine-tree'], 'かご': ['basket'], '箱': ['box', 'package'], '収納': ['archive', 'box', 'cupboard', 'basket'],
  'ゴミ箱': ['trash'], 'コーヒー': ['coffee'], 'お茶': ['tea'], 'カップ': ['cup', 'mug'], 'マグ': ['mug'], '飲み物': ['cup', 'bottle', 'glass'],
  'お酒': ['beer', 'wine', 'cocktail'], 'ビール': ['beer'], 'ワイン': ['wine'], '水': ['water'], 'お菓子': ['cookie', 'candy', 'cupcake'],
  '食べ物': ['food', 'pizza', 'hamburger', 'noodles', 'rice'], '果物': ['fruit', 'food-apple'], '冷蔵庫': ['fridge'],
  '電子レンジ': ['microwave'], 'ケトル': ['kettle'], '扇風機': ['fan'], 'エアコン': ['air-conditioner'], '加湿器': ['air-humidifier'],
  '空気清浄機': ['air-purifier'], 'ヒーター': ['heating-coil'], '掃除機': ['vacuum', 'robot-vacuum'], '洗濯': ['washing-machine'],
  '家電': ['fridge', 'microwave', 'fan', 'washing-machine', 'kettle', 'air-conditioner'], 'リモコン': ['remote'],
  '電卓': ['calculator'], 'プリンター': ['printer'], 'スキャナー': ['scanner'], 'スマホ': ['cellphone'], '携帯': ['cellphone'],
  'タブレット': ['tablet'], 'パソコン': ['laptop', 'desktop'], 'サーバー': ['server', 'nas'], 'ストレージ': ['harddisk', 'sd', 'nas'],
  '電池': ['battery'], 'バッテリー': ['battery'], 'ソーラー': ['solar'], 'ドローン': ['drone'],
  'ネットワーク': ['wifi', 'access-point', 'lan', 'network'], '無線': ['wifi', 'antenna', 'bluetooth'], '防犯': ['cctv', 'shield', 'lock'],
  'セキュリティ': ['shield', 'lock', 'fingerprint', 'cctv'], '鍵': ['key', 'lock'], '財布': ['wallet'], 'かばん': ['bag', 'briefcase'],
  'バッグ': ['bag', 'briefcase'], '眼鏡': ['glasses'], 'メガネ': ['glasses'], 'サングラス': ['sunglasses'], '帽子': ['hat'],
  '服': ['tshirt', 'hanger'], '靴': ['shoe'], 'アクセサリー': ['ring', 'diamond', 'necklace'], '化粧': ['lipstick', 'lotion'],
  '薬': ['pill', 'medical'], '健康': ['heart-pulse', 'weight', 'pill'], '体重計': ['scale-bathroom'], 'ドライヤー': ['hair-dryer'],
  '運動': ['dumbbell', 'run', 'bike', 'yoga'], '筋トレ': ['dumbbell', 'weight-lifter'], 'ダンベル': ['dumbbell'], 'ヨガ': ['yoga', 'meditation'],
  'スポーツ': ['basketball', 'soccer', 'baseball', 'tennis', 'golf'], 'ボール': ['basketball', 'soccer', 'baseball', 'volleyball'],
  'キャンプ': ['tent', 'campfire'], 'アウトドア': ['tent', 'hiking', 'compass'], '釣り': ['fish'], '自転車': ['bike', 'bicycle'],
  '車': ['car'], 'バイク': ['motorbike'], '電車': ['train', 'tram'], '飛行機': ['airplane'], '船': ['ferry', 'sail-boat'],
  '猫': ['cat'], 'ねこ': ['cat'], '犬': ['dog'], 'いぬ': ['dog'], 'ペット': ['paw', 'cat', 'dog', 'fishbowl'], '魚': ['fish'],
  '鳥': ['bird', 'owl', 'duck'], '動物': ['paw', 'cat', 'dog', 'rabbit', 'elephant', 'panda'], 'うさぎ': ['rabbit'],
  '星': ['star'], 'ハート': ['heart'], '丸': ['circle'], '四角': ['square'], '三角': ['triangle'], '旗': ['flag'], 'タグ': ['tag'],
  'プレゼント': ['gift'], 'パーティー': ['party-popper', 'balloon'], '天気': ['weather'], '太陽': ['weather-sunny', 'white-balance-sunny'],
  '月': ['moon'], '雲': ['cloud'], '雪': ['snowflake'], '火': ['fire'], '雷': ['lightning'], '地球': ['earth'], 'その他': ['dots-horizontal'],
}

/**
 * 検索。空白で区切った語をすべて含むものを返す（AND）。
 * 日本語の語は ICON_SEARCH_ALIASES_JA で英語に広げ、広げた語のどれかを含めばその語は当たりとする。
 * 辞書に無い日本語は部分一致で辞書の見出しを探す（「ギ」→ ギター）。打っている途中で0件にしないため。
 */
export function searchIconNames(query: string, includeDeskIcons = false): string[] {
  // 全角英数（ＨＥＡＲＴ）や半角カナも当てる
  const terms = query.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const expanded = terms.map((term) => {
    const direct = ICON_SEARCH_ALIASES_JA[term]
    if (direct) return direct
    if (/^[\x20-\x7e]+$/.test(term)) return [term]
    const partial = Object.entries(ICON_SEARCH_ALIASES_JA)
      .filter(([word]) => word.includes(term))
      .flatMap(([, names]) => names)
    return partial
  })
  const fontHits = expanded.some((words) => words.length === 0) ? []
    : ALL_ICON_NAMES.filter((name) => expanded.every((words) => words.some((word) => name.includes(word))))
  if (!includeDeskIcons) return fontHits
  const deskHits = DESK_CATEGORY_ICONS.filter((icon) => {
    const searchable = `${icon.name} ${icon.titleJa} ${icon.titleEn}`.normalize('NFKC').toLowerCase()
    return terms.every((term, index) => searchable.includes(term) || expanded[index].some((word) => searchable.includes(word)))
  }).map((icon) => icon.name)
  return [...deskHits, ...fontHits]
}
