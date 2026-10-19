// ルートから読むと未使用の18ファミリー（約2.7MB）のフォントまでアセットに含まれるため、
// 使うファミリーだけをサブパスで直接読む
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import React from 'react'
import { GadgetCategory } from '../types'

// @expo/vector-icons に含まれる MaterialCommunityIcons の型
export type MCIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name']

// ─── タブバー ───────────────────────────────────────────────────
// 3つが同時に目に入るので、シルエットは家・道具・人で完全に分ける。
//
// 机・モニター・デスクライトは **使えない**。どれも CATEGORY_ICONS が
// ガジェット1点の絵として使っており、タブに持ってくると「机1台」「モニター1台」と
// 同じ絵が並ぶ。タブ側は抽象な絵にするしかない。
export const TAB_ICONS = {
  gadgets:  'package-variant-closed'  as MCIconName,
  // 起動して最初に着くタブ＝起点。clipboard-list は「やることリスト」の絵で、
  // デスクの一覧という中身と合っていなかった（3つの中で線もいちばん詰まっていた）
  plan:     'home-outline'            as MCIconName,
  // account-group は隣の account-circle（マイページ）と人系で2連になり、
  // 26pt では人が3人ぶん詰まってこちらだけ黒く見えていた。
  // コンパスは iOS では Safari の絵なので「Web」と読まれる。画面内の検索欄と
  // 同じ絵になるが、それは Instagram の Explore と同じ形で実害が無い
  feed:     'magnify'                 as MCIconName,
  mypage:   'account-circle-outline'  as MCIconName,
} satisfies Record<string, MCIconName>

// 選択中のタブの絵。選ばれていないタブも白黒で濃く描くので、色だけに頼らず塗りでも分ける。
// 虫眼鏡には塗りの絵が無いので同じ絵のまま（色とラベルの太さで分かる）
export const TAB_ICONS_SELECTED = {
  plan:     'home'                    as MCIconName,
  feed:     'magnify'                 as MCIconName,
  mypage:   'account-circle'          as MCIconName,
} satisfies Record<'plan' | 'feed' | 'mypage', MCIconName>

// ─── カテゴリカラー ─────────────────────────────────

// 正本は constants/colors.ts。ここから読んでいた既存の import を壊さないよう再輸出する
export { CATEGORY_COLORS, categoryBaseColor, categoryIconColor, DECOR_COLOR, themeIconColor, themeTintBase } from './colors'

// ─── カテゴリアイコン (絵文字 CATEGORY_ICONS の代替) ─────────────
export const CATEGORY_ICONS: Record<string, MCIconName> = {
  PC:             'desktop-tower',
  Monitor:        'monitor',
  TV:             'television',
  Projector:      'projector',
  Dock:           'usb',
  Hub:            'usb-port',
  Mouse:          'mouse',
  MousePad:       'square-rounded-outline',
  Keyboard:       'keyboard',
  Speaker:        'speaker',
  Headphone:      'headphones',
  Earphone:       'earbuds-outline',
  Light:          'desk-lamp',
  Webcam:         'webcam',
  Camera:         'camera-outline',
  Lens:           'camera-iris',
  // CategoryIcon のカスタムSVGで描く。ここは監査用の登録値。
  Tripod:         'camera-enhance-outline',
  Printer:        'printer',
  Microphone:     'microphone-variant',
  Storage:        'harddisk',
  Router:         'router-wireless',
  NetworkSwitch:  'ethernet',
  Modem:          'router-network',
  // **この値は描かれない。** CategoryIcon が GameConsole だけ自前の SVG
  // （GameConsoleIcon・商標を避けた携帯機の形）に差し替えるため、ここは
  // audit:icons の重複検査に対する登録でしかない。絵を変えたいときは
  // GameConsoleIcon のほうを直す。
  // 重複が出たときに動かすのはこちら側（描かれない側）で、Controller を
  // 動かすと実際に出ている絵が変わる（09-11 にそれをやって、コントローラーが
  // 十字キーだけの gamepad になった）
  GameConsole:    'gamepad-variant',
  CaptureDevice:  'video-input-hdmi',
  StreamingDevice:'cast-connected',
  PCPart:         'expansion-card-variant',
  KVM:            'swap-horizontal',
  Printer3D:      'printer-3d',
  PenTablet:      'draw',
  Charger:        'lightning-bolt',
  MobileBattery:  'battery-charging-high',
  AudioInterface: 'audio-input-xlr',
  // CategoryIcon のカスタムSVGで描く。ここは監査用の登録値。
  HeadphoneAmp:   'headphones-box',
  Amplifier:      'amplifier',
  Mixer:          'tune-vertical',
  SmartHome:      'home-automation',
  Smartphone:     'cellphone',
  Tablet:         'tablet',
  PowerStrip:     'power-plug-outline',
  UPS:            'power-plug-battery-outline',
  Desk:           'desk',
  Chair:          'chair-rolling',
  Furniture:      'sofa-outline',
  VRGlass:        'virtual-reality',
  Smartwatch:     'watch',
  WallPanel:      'hexagon-multiple-outline',
  Accessory:      'cube-outline',
  DeskPad:        'rectangle-outline',
  Plant:          'sprout-outline',
  SmallDevice:    'devices',
  // controller は左右にグリップのあるゲームパッドの形で、実物のシルエットに
  // 一番近い。gamepad は十字キー（D-pad）だけの絵でコントローラーには見えず、
  // gamepad-variant は GameConsole の登録値と重なる
  Controller:     'controller',
  // この2件も CategoryIcon のカスタムSVGで描く。ここは監査用の登録値。
  MonitorArm:     'monitor-dashboard',
  MicArm:         'microphone-outline',
  Cable:          'cable-data',
  Instrument:     'guitar-acoustic',
  // 持ち物タブ（package-variant-closed）と分けるため、用途選択の「その他」と同じ絵にする
  Other:          'dots-horizontal-circle-outline',
} satisfies Record<GadgetCategory, MCIconName>

// ─── 配線ステップアイコン ─────────────────────────────────────────
// ─── 汎用 UI アイコン ─────────────────────────────────────────────
export const ICONS = {
  // アクション
  add:          'plus'                    as MCIconName,
  // 数を1つ減らす。削除（trash）とは別物で、1本→0本にはしない操作に使う
  subtract:     'minus'                   as MCIconName,
  edit:         'pencil-outline'          as MCIconName,
  trash:        'trash-can-outline'       as MCIconName,
  recentlyDeleted: 'delete-clock-outline' as MCIconName,
  deleteForever: 'delete-forever-outline' as MCIconName,
  restore:      'restore'                 as MCIconName,
  // 撤去（デスクから下ろす）。削除＝完全に消すとは別物なので絵も分ける
  retire:       'archive-arrow-down-outline' as MCIconName,
  copy:         'content-copy'            as MCIconName,
  // もう一度やり直す。失敗した通信の再試行と、AIにもう一度答えさせる操作は同じ絵で通す
  retry:        'refresh'                 as MCIconName,
  // AIコーチの操作。有名なAIアプリと同じ絵にして、説明なしで伝わるようにする
  report:       'flag-outline'            as MCIconName,
  newChat:      'square-edit-outline'     as MCIconName,
  stopGenerating: 'stop'                  as MCIconName,
  // 検索。TAB_ICONS.feed と同じ絵だが、タブと検索欄で役割が違う
  search:       'magnify'                 as MCIconName,
  close:        'close'                   as MCIconName,
  // 入力欄・日付・添付を消す丸バツ。close（画面を閉じる）とは別物なので分ける
  clear:        'close-circle'            as MCIconName,
  // 日付欄。押すとダイヤルが開く目印
  calendar:     'calendar-outline'        as MCIconName,
  check:       'check'                   as MCIconName,
  // 共有は iOS 標準の「四角＋上矢印」に合わせる。share-variant（3点グラフ）は
  // Android 流儀で、iOS 準拠で揃えた他のアイコンの中で1つだけ浮く。
  share:        'export-variant'          as MCIconName,

  // ナビゲーション
  chevronLeft:  'chevron-left'            as MCIconName,
  chevronRight: 'chevron-right'           as MCIconName,
  chevronDown:  'chevron-down'            as MCIconName,
  chevronUp:    'chevron-up'             as MCIconName,

  // コンテンツ
  star:         'star-outline'            as MCIconName,
  starFilled:   'star'                    as MCIconName,
  // 拍手（旧いいね）。塗りと輪郭の2種類が無いので、状態は色で示す（docs/like-feature-spec.md 5.4）
  clap:         'hand-clap'               as MCIconName,
  photo:        'image-plus'              as MCIconName,
  photos:       'image-multiple-outline'  as MCIconName,
  // 画像そのもの。photo（image-plus）は「写真を追加」の意味なので分ける
  image:        'image-outline'           as MCIconName,

  // 機能
  stats:        'chart-box-outline'       as MCIconName,
  // 履歴は chart-timeline-variant ではなく history。前者はどこでも使っていなかった
  history:      'history'                 as MCIconName,
  robot:        'robot-outline'           as MCIconName,
  // ブランド・フォルダなど「分類の札」
  tag:          'tag-outline'             as MCIconName,
  link:         'link-variant'            as MCIconName,
  // 外部ブラウザで開く。link は「URL そのもの」を指すので別にする
  openExternal: 'open-in-new'             as MCIconName,

  // 設定・アカウント
  settings:     'cog-outline'             as MCIconName,
  bell:         'bell-outline'            as MCIconName,
  // 通知を切っている状態（フォロー中の人ごとの通知・端末の許可が無いとき）
  bellOff:      'bell-off-outline'        as MCIconName,
  account:      'account-circle-outline'  as MCIconName,
  // 投稿者のフォロー（フォロー中の一覧の空状態）。ボタン自体は X と同じく文字だけ
  follow:       'account-plus-outline'    as MCIconName,
  email:        'email-outline'           as MCIconName,
  lock:         'lock-outline'            as MCIconName,
  logout:       'logout'                  as MCIconName,
  palette:      'palette-outline'         as MCIconName,
  // 地球は公開専用。言語まで地球にすると、設定の言語行が「公開」と読まれる
  publish:      'earth'                   as MCIconName,
  language:     'translate'               as MCIconName,
  info:         'information-outline'     as MCIconName,

  // その他
  package:      'package-variant-closed'  as MCIconName,
  // 飾り（配線しない物）。入力フォームと配線図で同じ絵にして、ON にした物が図のどれかを読めるようにする
  decor:        'widgets-outline'         as MCIconName,
  // 「実物に合わせる」の分かれ方の行。口の行はポートの絵、アームと PC の形はカテゴリの絵を使い、
  // 対応する絵が無いこの3つだけをここに置く
  speakerPair:  'speaker-multiple'        as MCIconName,
  subwoofer:    'sine-wave'               as MCIconName,
  splitKeyboard: 'arrow-split-vertical'   as MCIconName,
} satisfies Record<string, MCIconName>
