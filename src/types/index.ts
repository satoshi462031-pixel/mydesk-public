import type { DeskCopySource } from '../utils/deskCopy'
import type { CompositionPick } from '../utils/deskComposition'
import type { TemplateDetailDraft } from '../store/templateDetailDraft'
import type { NavigatorScreenParams } from '@react-navigation/native'
export type PortType =
  | 'USB_C'
  | 'USB_A'
  | 'USB_B'
  | 'USB_A_to_C'
  | 'Lightning'
  | 'microUSB'
  | 'Thunderbolt'
  | 'HDMI'
  | 'DisplayPort'
  | 'MiniDisplayPort'
  | 'VGA'
  | 'DVI'
  | 'Power'
  | 'Ethernet'
  | 'EthernetPoE'
  | 'Audio3_5mm'
  | 'Audio6_3mm'
  | 'Audio6_3mm_TS'
  // 4.4mm 5極バランス。据置 DAC / ヘッドホンアンプの標準的な出口で、
  // 6.3mm のヘッドホンは物理的に挿さらない（同じ「フォーン」で括ってはいけない）
  | 'Audio4_4mm'
  | 'XLR_TRS_Combo'
  // XLR 4pin のバランスヘッドホン出力。3pin の XLR（マイク・スピーカー）とは別物で、
  // ここを XLR で代用するとヘッドホン出力からモニタースピーカーへ線が引ける
  | 'XLR4pin'
  | 'RCA'
  // 同軸デジタル（S/PDIF）。見た目は RCA だが通るのはデジタル信号で、
  // アナログの RCA ライン出力とは繋がらない
  | 'CoaxialAudio'
  | 'Audio3_5_to_6_3'
  | 'OpticalAudio'
  // パッシブスピーカーの端子（バナナプラグ・裸線）。アンプ側からスピーカーケーブルで結ぶ
  | 'SpeakerTerminal'
  | 'SDCard'
  | 'microSDCard'
  | 'CFexpress'
  | 'XboxExpansion'
  | 'XLR'
  | 'MIDI'
  // 3.5mm TRS MIDI（Type A）。ミニジャックだがオーディオではないので、
  // Audio3_5mm で代用するとイヤホンが MIDI 端子に挿さる
  | 'MIDI_TRS'
  | 'MonitorArm'
  | 'MicArm'
  | 'Bluetooth'
  | 'XboxWireless'
  | 'WiFi'
  | 'Stylus'
  | 'wirelessCharging'
  | 'Battery'
  | 'DCPower'

/**
 * 接続線の種類。PortType はガジェット側の端子、CableType はケーブル両端の組み合わせを表す。
 * PortType を含めるのは既存保存データと同端子接続の互換性を保つため。
 */
export type CableType = PortType
  | 'USB_A_to_B'
  | 'USB_C_to_B'
  | 'USB_A_to_Lightning'
  | 'USB_C_to_Lightning'
  | 'USB_A_to_microUSB'
  | 'USB_C_to_microUSB'
  | 'MiniDisplayPort_to_DisplayPort'
  | 'USB_C_to_DisplayPort'
  | 'USB_C_to_HDMI'
  | 'DisplayPort_to_HDMI'
  | 'HDMI_to_DisplayPort'
  | 'HDMI_to_DVI'
  | 'RCA_to_3_5mm'
  | 'RCA_to_6_3mm'

export type GadgetCategory =
  | 'PC'
  | 'Monitor'
  | 'TV'
  | 'Projector'
  | 'Dock'
  | 'Hub'
  | 'Mouse'
  | 'Keyboard'
  | 'Speaker'
  | 'Headphone'
  | 'Earphone'
  | 'Light'
  | 'Webcam'
  | 'Camera'
  | 'Lens'
  | 'Tripod'
  | 'Microphone'
  | 'Storage'
  | 'Router'
  // スイッチングハブ。ルーターのLANを分岐する。ルーター（WAN+LAN）ともUSBハブとも口の形が違う
  | 'NetworkSwitch'
  | 'Modem'
  | 'GameConsole'
  | 'CaptureDevice'
  | 'StreamingDevice'
  | 'KVM'
  | 'Printer3D'
  | 'Printer'
  | 'PenTablet'
  | 'Charger'
  | 'MobileBattery'
  | 'AudioInterface'
  | 'HeadphoneAmp'
  // プリメイン／パワーアンプ。パッシブスピーカーを鳴らすのはこのカテゴリだけ
  | 'Amplifier'
  | 'Mixer'
  | 'SmartHome'
  | 'Smartphone'
  | 'Tablet'
  | 'PowerStrip'
  | 'UPS'
  | 'Desk'
  | 'Chair'
  | 'Furniture'
  | 'VRGlass'
  | 'Smartwatch'
  | 'WallPanel'
  | 'Accessory'
  | 'DeskPad'
  | 'MousePad'
  | 'Plant'
  | 'SmallDevice'
  | 'PCPart'
  | 'Controller'
  | 'MonitorArm'
  | 'MicArm'
  | 'Cable'
  | 'Instrument'
  | 'Other'

export type PortDirection = 'input' | 'output' | 'bidirectional'

export interface Port {
  id: string
  type: PortType
  direction: PortDirection
  count: number
  supportsVideo?: boolean
  /** USB-C / Thunderbolt が同じ物理ケーブルで給電も行える */
  supportsPowerDelivery?: boolean
  /** EthernetポートがPoE給電またはPoE受電に対応する */
  supportsPoE?: boolean
  /** DP/HDMI間など、同一規格ではない映像変換を自動提案してよい */
  supportsDisplayConversion?: boolean
  /** ガジェットに適合する専用ACアダプターが付属または指定済み */
  powerAdapterIncluded?: boolean
  label?: string
  /**
   * この口はガジェットを直接挿すのでケーブルが要らない（2.4GHzレシーバー、USBメモリ、
   * HDMIスティックなど）。種別としてはケーブルもあり得る口を、個別に除外するための印。
   *
   * 種別が常にケーブル不要なもの（Bluetooth・SDカード等）は
   * NO_CABLE_PORT_TYPES 側で判定するので、ここには立てない。
   */
  directAttach?: boolean
}

export interface GadgetFolder {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
}

/**
 * ユーザーが自分で作ったジャンル。配線の上では 'Other' として扱い、名前・絵・色を持つ。
 * GadgetCategory を広げないのは、配線エンジン・並び順・色・統計が固定の値を前提にしているため
 */
export interface CustomCategory {
  id: string
  name: string
  /** 同梱フォントかデスク用品SVGの名前。公開データは描く前に存在を確かめる */
  icon: string
  /** 未設定の既存ジャンルは「その他」の色を使う。 */
  color?: string
}

/** デスクの天板の色（utils/deskTopColor の選択肢） */
export type DeskTopColor = 'white' | 'black' | 'gray' | 'natural_wood' | 'dark_wood' | 'other'

export interface Gadget {
  id: string
  name: string
  model?: string
  category: GadgetCategory
  /**
   * 自作ジャンル。category が 'Other' のときだけ意味を持つ。
   * id で一覧と結び、名前と絵は写しを持つ（公開デスクは一覧を持たずにこの写しで描く）
   */
  customCategory?: CustomCategory
  /** 同一製品を複数台まとめて管理する場合の台数。未設定は1台 */
  quantity?: number
  /**
   * 1台ごとの呼び名（「サブモニター」など）。商品名とは別で、同じジャンルが複数あるときの区別に付ける。
   * 配線図ではジャンル名の位置に出る。**公開スナップショットに入る**
   */
  nickname?: string
  ports: Port[]
  folderIds?: string[]
  /** 自分の機材のお気に入り。すべての自分のデスクと持ち物一覧で共通 */
  favorite?: boolean
  imageUri?: string
  /** 自由記入欄。**公開スナップショットに入り、公開デスクのガジェット詳細に出る** */
  memo?: string
  /** 他のガジェットへの固定・収納関係。配線とは独立して扱う */
  mounting?: {
    targetGadgetId: string
    type: 'mounted_on' | 'attached_to' | 'stored_in' | 'inside'
    note?: string
  }
  /** KVM切替・配信・Sidecarなど、この機器で使う運用モード */
  operationModes?: string[]
  activeOperationMode?: string
  /** アプリ、プロファイル、画質・音質設定など配線図だけでは表せない情報 */
  softwareSettings?: string
  /** ユーザーが自分で入力した URL。購入導線ではこちらを優先する */
  url?: string
  /**
   * 商品マスタ（products.id）への参照。予測変換で商品を選ぶと入る。
   * 購入リンクを url にコピーせず参照にしておくことで、
   * 後から shop_links に Amazon を足しただけで既存ガジェットにも反映される。
   */
  productId?: string
  /** 商品を特定できず、端子情報を次に確認する必要がある */
  portsNeedConfirmation?: boolean
  dimensions?: string
  isHeightAdjustable?: boolean
  deskLiftType?: 'manual' | 'electric'
  deskTopColor?: DeskTopColor
  deskHeight?: string
  deskHeightMin?: string
  deskHeightMax?: string
  pcFormFactor?: 'desktop' | 'laptop' | 'mini'
  pcOs?: 'Windows' | 'macOS' | 'Linux' | 'ChromeOS'
  pcCpu?: string
  pcCpuProductId?: string
  pcGpu?: string
  pcGpuProductId?: string
  pcRam?: string
  pcRamProductId?: string
  pcStorage?: string
  pcStorageProductId?: string
  pcThunderbolt?: boolean
  consoleFormFactor?: 'stationary' | 'handheld'
  monitorSizeInches?: string
  monitorResolution?: string
  monitorRefreshRateHz?: string
  storageCapacity?: string
  smartDeviceScreenSize?: string
  smartDeviceStorage?: string
  batteryCapacityMah?: string
  batteryCapacityWh?: string
  /** 本体を充電しながら他機器へ給電できるモバイルバッテリーか。未設定は非対応として扱う。 */
  supportsPassThroughCharging?: boolean
  cableType?: CableType
  cableCount?: number
  stereoPair?: boolean
  speakerInputSide?: 'L' | 'R'
  /** スピーカーセットに独立したウーファーが含まれるか。未設定は false */
  hasSubwoofer?: boolean
  splitKeyboard?: boolean
  /** 飾り（通電・配線なし）。配線図にはノードだけ出て、線は引かれない */
  displayOnly?: boolean
  /** デスク履歴の計算用。保存元は DeskPlan.gadgetUsage で、デスクへ適用した一時データだけに付く */
  deskUsagePeriods?: DeskGadgetUsagePeriod[]
  /** テンプレート適用で生成された未選択ガジェット。実商品への置き換え候補 */
  isPlaceholder?: boolean
  /** 構成検討用。所有機材として確定するまでは持ち物の統計に含めない */
  isCandidate?: boolean
  /** 新規登録時に導入日が未入力。登録日を導入日に代用しない */
  introducedAtUnknown?: boolean
  wirelessTargetGadgetIds?: string[]
  /**
   * ガジェットフォームの「接続先」で指定した相手のID。名前に反して Bluetooth 専用ではなく、
   * 配線エンジンは有線のホスト選択でもこれを最優先の候補にする
   * （`NEEDS_HOST_CATEGORIES` のカテゴリだけ指定できる）。
   * 保存済みデータがあるため名前は変えていない。
   */
  bluetoothTargetGadgetIds?: string[]
  /** スマートホームガジェットは通信経路を配線図へ出さず、電源・給電だけを表示する */
  smartHomePowerSource?: 'standard' | 'solar' | 'battery'
  /** 常時接続・必要時だけ充電・交換式電池の区別。未設定の既存データは常時給電として扱う */
  powerUsage?: 'continuous' | 'rechargeable' | 'replaceable'
  /** 給電元に指定した充電器・モバイルバッテリーのID。未設定なら配線エンジンが自動で選ぶ */
  powerSourceGadgetId?: string
  /** 給電元のどの口に挿すか（`ポートID#何口目`）。未設定なら空いている口から自動で選ぶ */
  powerSourcePortId?: string
  price?: number
  purchasedAt?: string  // YYYY-MM-DD 導入日
  removedAt?: string    // YYYY-MM-DD 撤去日（任意。歴史アニメーションの OUT イベント）
  /** 処分した時刻。機材とデスクの使用履歴は残す */
  disposedAt?: string
  /** 持ち物のゴミ箱へ移した時刻。設定中は通常画面・公開・配線から除外する */
  deletedAt?: string
  games?: string[]
  createdAt: string
}

export type UserGoal =
  | 'first_setup'
  | 'clean_wiring'
  | 'improve_desk'
  | 'improve_cost'
  | 'desk_tour'

export type DeskZone =
  | 'back_left'
  | 'back_center'
  | 'back_right'
  | 'front_left'
  | 'front_center'
  | 'front_right'
  | 'desk_left'
  | 'desk_right'
  | 'under_desk'
  | 'desk_back'
  | 'wall_left'
  | 'wall_center'
  | 'wall_right'
  | 'shelf'
  | 'floor_left'
  | 'floor_center'
  | 'floor_right'
  | 'room_left'
  | 'room_center'
  | 'room_right'
  | 'sofa_area'
  | 'storage_area'

export interface GadgetPlacement {
  gadgetId: string
  /** 配線図のノード配置に使う。部屋のどのあたりに置いてあるか */
  zone: DeskZone
  label?: string
}

export interface Connection {
  id: string
  fromGadgetId: string
  fromPortType: PortType
  toGadgetId: string
  toPortType: PortType
  cableType: CableType
  /** 内蔵バッテリーの充電時だけ接続する経路 */
  chargingOnly?: boolean
  /**
   * 給電元の物理ポート識別子（`ポートID#何口目`）。充電ポートは複数ガジェットで共有しうるため、
   * どの口を何台で使い回しているかを残数計算のために持つ。
   * 口を共有していても配線図では別々の線として描く（1本にまとめるのは分岐ケーブルを
   * 宣言した MapConnection.branchGroupId のときだけ）。
   */
  sourcePortId?: string
  /** 同じ接続元から必要な物理ケーブル／電源口の本数。未設定は1本 */
  count?: number
  /** アプリが構成から自動的に増やした本数の理由 */
  countSource?: 'subwoofer'
}

// ─── 配線図（Connection Map）─────────────────────────────────────
// origin: 自動下書き(auto) か 手動追加(manual) か
// confirmed: ユーザーが一度でも触ったか。図では区別しない（破線は無線・給電専用・
//   補助線で使い切っている）。reconcileMap が再生成をまたいで引き継ぎ、
//   一度確定した線は破棄済みでも復活させる判定に使う
/**
 * つなぎ方に使っている1本。
 * included = 機器に付属していたケーブル、product = 商品を選んだケーブル。
 * name は表示用のスナップショット（商品DBを引き直さずに一覧と公開ページへ出す）。
 */
export type CableChoice =
  | { kind: 'included' }
  | { kind: 'product'; name: string; productId?: string }

export interface MapConnection {
  id: string
  fromGadgetId: string
  toGadgetId: string
  cableType: CableType
  origin: 'auto' | 'manual'
  confirmed: boolean
  wireless?: boolean   // 無線（Bluetooth/ワイヤレス給電）→ 点線表示
  chargingOnly?: boolean
  /** 給電元の物理ポート識別子。口の残数計算に使う（線は共有していても別々に描く） */
  sourcePortId?: string
  /**
   * 2in1・3in1 ケーブルの枝であることを示す識別子。同じ値を持つ配線は
   * 1本の物理ケーブルなので、給電元の同じ接続点から出して枝分かれに見せ、
   * 必要本数の集計でも1本として数える。ユーザーが線編集シートで宣言したときだけ付く。
   */
  branchGroupId?: string
  /**
   * 同じ2台を同じ種別で繋いでいる本数。未設定は1本。
   *
   * ステレオの L/R（オーディオIF → スピーカーに TRS 2本）とデュアル電源の PC は
   * 実際にこの形になる。線を2本持つ形にはしない — `pairKey(from, to, cableType)` を
   * 前提にした引き継ぎ（reconcileMap・dismissedPairs・2in1 の宣言）が同じキーの線を
   * 区別できず、以前はプランを読むたびに片方が黙って消えていた。
   */
  count?: number
  /** アプリが構成から自動的に増やした本数の理由 */
  countSource?: 'subwoofer'
  /**
   * この線に使っている実物のケーブル（UI 表記「つなぎ方」）。
   *
   * **未設定を「本体付属」とみなさない。** 既定で付属と書くと、家にあった別の1本を
   * 使っている人のデスクにも「付属」と書いて公開することになる。申告があった線にだけ付く。
   *
   * cables.md が削除した cableStatus（付属／手持ち／必要）と違い、これは公開デスクに出る。
   * 出さないなら在庫メモにしかならないので、表示先を消すときはこの列ごと消す。
   */
  cableChoice?: CableChoice
  /** 実際のケーブル取り回し。未設定の既存データは直結として表示する */
  route?: {
    lengthCm?: number
    visibility?: 'visible' | 'partial' | 'hidden'
    path?: 'direct' | 'under_desk' | 'cable_tray' | 'along_wall' | 'through_wall' | 'floor'
    note?: string
  }
}

/**
 * 配線図のカードを手で動かした量。
 *
 * dx/dy だけでは「自動配置が決めた基準位置からのずらし量」になり、ガジェットを足す・外すで
 * 基準位置が動くと、置いた場所から勝手にずれる（外して戻したカードも昔のずらし量で出る）。
 * bx/by に動かした時点の基準位置を持たせ、置いた場所（bx+dx, by+dy）に固定する。
 * bx/by の無い旧データは従来どおり今の基準位置に dx/dy を足す（次に動かした時点で固定される）。
 */
export interface NodeOffset {
  dx: number
  dy: number
  bx?: number
  by?: number
}

export interface ConnectionMap {
  connections: MapConnection[]
  dismissedPairs?: string[]   // 「すべて破棄」された自動下書きのペアキー（再生成を抑止）
  nodeOffsets?: Record<string, NodeOffset>   // 配線図ノードの手動微調整量
  nodeSizes?: Record<string, { w: number; h: number }>       // 配線図ノードの手動リサイズ（角の長押しドラッグ）
  /** 通常の配線図で保存した、その日の最後の配置。歴史専用の手動上書きとは分けて保持する。 */
  layoutSnapshots?: Record<string, {
    nodeOffsets: Record<string, NodeOffset>
    nodeSizes: Record<string, { w: number; h: number }>
  }>
  /**
   * 歴史アニメーション用：日付(YYYY-MM-DD)ごとの配置上書き。
   * nodeOffsets は自動配置後に足す相対デルタなので、ガジェット数の違う過去のイベントでは
   * 意図しない位置に作用しうる。その日だけ手で直した結果をここに保存する。
   * 未指定の日は、その日以前の layoutSnapshots または自動配置を使う。
   */
  historyLayout?: Record<string, {
    nodeOffsets?: Record<string, NodeOffset>
    nodeSizes?:   Record<string, { w: number; h: number }>
  }>
}

export interface RequiredCable {
  cableType: CableType
  count: number
  /**
   * 充電のときだけ挿すぶん。配線図はこの線を描かない（ConnectionMap が chargingOnly を落とす）ので、
   * 常時つなぐケーブルと同じ列に混ぜると「図に無い線のケーブル」が並ぶ。画面では節を分ける。
   * 印の無い既存データは常時つなぐぶんとして扱う。
   */
  chargingOnly?: boolean
}

/**
 * 足りない口を埋めるために追加するとよい機器。
 *
 * 同じことは warnings の文言でも言っているが、あちらは表示用の文字列で、
 * どの機器を勧めているのかを機械的に取り出せない（文字列で判定するのは
 * 表記を変えた瞬間に壊れる）。買い足しの提案はこちらを見る。
 */
export interface WiringSuggestion {
  /** 追加を勧める機器の種類 */
  category: GadgetCategory
  /** 何が足りなくてこの提案になったか */
  reason: 'outlet' | 'charger' | 'usbPort'
  /** きっかけになったガジェット。壁コンセント全体の不足のように特定できない場合は空 */
  gadgetIds: string[]
}

export interface WiringResult {
  connections: Connection[]
  requiredCables: RequiredCable[]
  warnings: string[]
  /** 印の無い既存データは提案なしとして扱う */
  suggestions?: WiringSuggestion[]
}

/**
 * 用途。選択肢は PURPOSE_DEFS の並びで、'dev'（開発）は選べる場所から外してある。
 * 型に残しているのは、外す前に保存されたデスクの用途を読めなくしないため。
 * 'trading'（トレード・投資）は型ごと廃止した。保存済み・公開済みのデスクに残る値は
 * normalizePlan が読み込みのたびに落とすので、ここへ書き戻さないこと。
 */
export type PlanPurpose =
  | 'gaming' | 'work' | 'dev' | 'creative' | 'streaming' | 'study' | 'music' | 'other'

export type DeskGadgetUsageMode = 'active' | 'decor'

/**
 * 日付の出所。デスクへの追加・除去で自動的に入った日付は操作日であって、
 * 実際に導入・撤去した日とは限らない。継続期間の分析でこの差が
 * 系統誤差になるため、手入力と区別できるようにしておく。未設定は 'auto'。
 * 'registered' は導入日が無いので登録日で代用した開始日。歴史アニメーションは使うが、
 * 「どれだけ一緒にいたか」を見せる年表には載せない
 */
export type DeskGadgetUsageDateSource = 'auto' | 'manual' | 'registered'

export interface DeskGadgetUsagePeriod {
  mode: DeskGadgetUsageMode
  startedAt: string
  /** この日からデスク外、または次の状態へ移る。未設定なら現在も継続中 */
  endedAt?: string
  startedAtSource?: DeskGadgetUsageDateSource
  endedAtSource?: DeskGadgetUsageDateSource
}

export interface DeskGadgetUsage {
  /** 旧形式との後方互換用。新規保存では periods から自動同期する */
  introducedAt?: string
  /** 旧形式との後方互換用。新規保存では periods から自動同期する */
  removedAt?: string
  periods?: DeskGadgetUsagePeriod[]
}

export interface DeskGadgetRelationOverride {
  mounting?: Gadget['mounting'] | null
  bluetoothTargetGadgetIds?: string[]
  wirelessTargetGadgetIds?: string[]
  powerSourceGadgetId?: string | null
  powerSourcePortId?: string | null
}

export interface DeskPlan {
  id: string
  name: string
  goal: UserGoal
  purposes?: PlanPurpose[]
  /** 用途に「その他」を選んだときにユーザーが付けた呼び名。未設定なら「その他」と表示する */
  otherPurposeLabel?: string
  /** 同じく「その他」に選んだアイコン（MaterialCommunityIcons 名）。未設定は既定のアイコン */
  otherPurposeIcon?: string
  otherPurposeColor?: string
  /**
   * デスクのひとこと（こだわり・見どころ）。ガジェットのメモは1台ごとの事実なので、
   * 写真を見る前に読ませるデスク全体の前置きはここに書く。公開すると desks.description にも入る
   */
  description?: string
  templateId?: string
  selectedGadgetIds: string[]
  gadgetOrder?: string[]
  gadgetUsage?: Record<string, DeskGadgetUsage>
  placements: GadgetPlacement[]
  wiringResult?: WiringResult
  /** 公開デスク由来の読み取り専用プラン（publicDeskAdapter が組み立てる。保存はしない） */
  isShared?: boolean
  images?: string[]
  wiredOverrides?: string[]   // BT対応ガジェットで有線を強制するガジェットID
  /** このデスクで使う支持先。null はスタンド、未指定は自動判定。 */
  monitorArmAssignments?: Record<string, string | null>
  /** このデスクで使うマイクアーム。null はスタンド、未指定は自動判定。 */
  micArmAssignments?: Record<string, string | null>
  /** 固定先・接続先・給電元のデスク固有設定。機材本体の設定を他デスク向けに書き換えない。 */
  gadgetRelationOverrides?: Record<string, DeskGadgetRelationOverride>
  /** 利用できる壁コンセントの口数。0 = なし */
  outletCount?: number
  /** outletCountを実口数として保存する形式。未設定の旧データは読込時に移行する */
  outletCountVersion?: 2
  favorite?: boolean
  /** このデスクのおすすめ（公開対象）。外した機材の印も残す */
  favoriteGadgetIds?: string[]
  connectionMap?: ConnectionMap
  createdAt: string
  updatedAt: string
}

// ─── 課金 ────────────────────────────────────────────────────────
export type PaywallReason =
  | 'maxViewHistory'
  | 'maxSavedCollections'
  | 'maxPhotosPerDesk'
  | 'maxWiringPlans'
  | 'maxGrowthRecords'
  | 'aiFeatures'
  | 'accentColor'
  | 'autoBackup'
  | 'historyAnimation'
  | 'manual'

/**
 * 公開デスクをどの入口から開いたか。閲覧のあとに作成へ進んだ人がどれだけいるかを
 * 入口別に見るための印で、表示には使わない。deep_link は共有URL・通知からの起動。
 */
// 'gadget_desks' はガジェット詳細の「このガジェットを使っているデスク」から。
// 買い替えの需要がどこで生まれているかは、この入口の閲覧数を他と分けないと読めない
// 'similar_desks' は公開デスクの機材タブ末尾の「このデスクに近いデスク」から。
export type PublicDeskSource = 'demo_card' | 'desk_feed' | 'desk_updates' | 'bookmark' | 'like' | 'gadget_bookmark' | 'link_paste' | 'deep_link' | 'my_page' | 'public_profile' | 'gadget_desks' | 'similar_desks' | 'push' | 'view_history'

/**
 * AIコーチのチャット。3つのスタック（デスク・マイページ・ルート）に積むので、
 * 形はここで1つだけ持つ。
 *
 * planId は自分のデスク、publicDeskId は他人の公開デスク。どちらか一方だけを渡す。
 * 他人のデスクは手元のストアに無く id から引けないので、添付の出どころを
 * パラメータ名で分けている（同じ id 欄に混ぜると、公開時にデスクの id が
 * そのまま desks.id になる関係で自分のデスクと見分けがつかなくなる）
 */
export type AICoachChatParams =
  | { conversationId?: string; planId?: string; publicDeskId?: string }
  | undefined

// Navigation param types
/**
 * 他人のデスクと公開プロフィール。**Root ではなく3つのタブのスタックすべてに積む。**
 * Root は MainTabs の上に重なるので、そこに置くと閲覧中ずっと下のタブバーが消え、
 * 「みんなのデスク → デスク → 戻る → 次のデスク」の回遊中に他のタブへ移れなくなる。
 * 自分のデスク詳細（WiringResult）はタブ内にあってタブバーが残るので、挙動も揃わなかった。
 * 開いたタブの中に積めば、どのタブから開いても戻り先がそのタブの一覧になる。
 */
export type PublicStackParamList = {
  // tab: 共有ページの「アプリで配線図を見る」などが ?tab=wiring で開くタブを指す
  PublicDesk:          { deskId: string; source?: PublicDeskSource; gadgetId?: string; tab?: 'gadgets' | 'wiring' | 'info' }
  // 公開プロフィール。tag は #/@ を外した6桁（profiles.public_tag と同じ形）
  PublicProfile:       { tag: string }
  // 公開デスク・機材・保存一覧から開くブランドの商品一覧。閲覧導線なのでタブ内に積む
  BrandProducts:       { brandKey: string; brandLabel: string }
}

export type RootStackParamList = {
  Onboarding:          undefined
  // entry: 初回案内から開いたとき。戻ると初回案内へ、ログイン後は本編へ進む
  // mode: 開く面（ログイン／新規登録）。「ログイン」「登録」のリンクで行き先を分ける
  /** resumePaywall: ログインできたあとに開き直す Paywall の引数（RootNavigator が拾う） */
  Login:               { entry?: 'onboarding'; mode?: 'signin' | 'signup'; resumePaywall?: { reason?: PaywallReason; planId?: string } } | undefined
  MainTabs:            NavigatorScreenParams<MainTabsParamList> | undefined
  Paywall:             { reason?: PaywallReason; planId?: string } | undefined
  ResetPassword:       undefined
}

// ガジェット系画面が期待するパラメータの形。タブを廃してマイデスクの右上から
// 開くようにしたため、これらは PlanStack に登録されている（専用のナビゲーターは無い）
export type GadgetStackParamList = {
  GadgetLibrary: undefined
  // planId 指定時：保存後にそのデスク（プラン）へ自動で追加し、プラン選択シートを出さない
  // category 指定時：カテゴリを選択済みの状態でフォームを開く（テンプレートの枠から登録する導線）
  AddGadget: { presetId?: string; presetName?: string; planId?: string; category?: GadgetCategory; showCategoryPicker?: boolean; libraryOnly?: boolean; returnAfterAdd?: boolean; showWiringOnDone?: boolean }
  GadgetDetail: { gadgetId: string; planId?: string; draftGadget?: Gadget; focusUsage?: boolean }
}

/** マイページ（設定）のジャンル。1ページ目はハブに徹し、各ジャンルは別画面に分ける */
export type SettingsSection =
  | 'account'
  | 'notifications'
  | 'appearance'
  | 'history'
  | 'privacy'
  | 'data'
  | 'help'
  | 'about'

export type MyPageStackParamList = {
  // プロフィールと「公開デスク / いいね / 保存 / ガジェット」のタブ。
  // いいね・保存・ガジェットは画面ではなくこのタブの中身になったので、
  // スタックには積まない
  MyPage: undefined
  Settings: undefined
  SettingsSection: { section: SettingsSection }
  // 全デスク横断のガジェット統計。デスク単位の統計はデスク詳細の「情報」タブが持つ。
  // 入口はガジェットタブ先頭の固定行
  GadgetStats: undefined
  // フォロー中の人の一覧（084）。入口はプロフィールの「フォロー中」
  FollowingList: undefined
  // ガジェットの登録・編集はデスク側とマイページ側の両方に積む（戻り先を分けるため）
  AddGadget: { presetId?: string; presetName?: string; planId?: string; category?: GadgetCategory; showCategoryPicker?: boolean; libraryOnly?: boolean; returnAfterAdd?: boolean; showWiringOnDone?: boolean }
  GadgetDetail: { gadgetId: string; planId?: string; draftGadget?: Gadget; focusUsage?: boolean }
  // AIコーチもデスク側と両方に積む。設定から開いた相談履歴が、戻るで
  // マイデスク一覧へ着地してしまう（別タブへ飛ばしていた）のを避けるため
  AICoachChat: AICoachChatParams
  AICoachList: undefined
  // 他人のデスク・プロフィール（PublicStackParamList の注記）
  PublicDesk: PublicStackParamList['PublicDesk']
  PublicProfile: PublicStackParamList['PublicProfile']
  BrandProducts: PublicStackParamList['BrandProducts']
  // マイページのデスクタブから開く自分のデスクと、そこから進む先。マイデスクのタブへ飛ばしていた頃は、
  // 閉じるとマイデスクの一覧に着地してマイページへ戻れなかった。作成途中の再開先も同じスタックに置く
  PurposeSelection: PlanStackParamList['PurposeSelection']
  TemplateDetail: PlanStackParamList['TemplateDetail']
  GadgetSelection: PlanStackParamList['GadgetSelection']
  DeskPlacement: PlanStackParamList['DeskPlacement']
  WiringResult: PlanStackParamList['WiringResult']
  PhotoFill: PlanStackParamList['PhotoFill']
  ProductFill: PlanStackParamList['ProductFill']
  ConnectionMethod: PlanStackParamList['ConnectionMethod']
}

/**
 * 下のタブバー。3つとも中身はスタックなので、ここでの params は
 * 「タブを切り替えるだけ」の undefined でよい（タブ内の画面指定は
 * utils/tabNavigation の navigateInTab が別のアクションとして送る）。
 *
 * 型を付けていなかった間は、いいね・保存の空状態から navigate('FeedTab') と
 * 書いている箇所が検査されず、タブ名を打ち間違えても気づけなかった。
 */
export type MainTabsParamList = {
  PlanTab: NavigatorScreenParams<PlanStackParamList> | undefined
  FeedTab: NavigatorScreenParams<FeedStackParamList> | undefined
  // マイページのタブ。名前だけ旧称（設定タブだった頃の名残）が残っている。
  // 変えると保存済みのナビゲーション状態と食い違うので、名前はこのままにする
  SettingsTab: NavigatorScreenParams<MyPageStackParamList> | undefined
}

// みんなのデスク（公開デスクの一覧）。作成の流れとは独立した「見る」導線なので、
// デスク作成のスタックには載せずタブとして独立させている
export type FeedStackParamList = {
  // attribute: 058 の属性キー（'purpose:gaming' / 'os:macOS' など）。公開プロフィールの
  // 属性行から渡ってきて、その軸で絞った一覧を出す。適用した画面側が消す
  DeskFeed: { attribute?: string } | undefined
  // 更新一覧（ベル）。みんなのデスクの上に積む。4つ目のタブにはしない
  // （通知が毎日来る前提の作りで、デスクは年に数回しか動かない）
  DeskUpdates: undefined
  // 他人のデスク・プロフィール（PublicStackParamList の注記）
  PublicDesk: PublicStackParamList['PublicDesk']
  PublicProfile: PublicStackParamList['PublicProfile']
  BrandProducts: PublicStackParamList['BrandProducts']
  // 公開デスクから開くAIコーチ。デスクと同じスタックに積んで「戻る＝そのデスク」にする。
  // 相談履歴とガジェット登録はこのスタックに無いので、画面側が導線を出さない
  // （AICoachChatScreen の rootMounted）
  AICoachChat: AICoachChatParams
}

/**
 * 進捗バーで前の段へ戻る前にいた段。用途を選び直したあとの「次へ」で
 * ここへ直接戻す（段を1つずつ進め直させない）。step は SetupProgress の段番号
 */
export type SetupResume =
  | { step: 1; name: 'TemplateDetail'; params: PlanStackParamList['TemplateDetail'] }
  | { step: 1; name: 'GadgetSelection'; params: { planId: string; wizard: true } }
  | { step: 2; name: 'DeskPlacement'; params: { planId: string } }
  | { step: 3; name: 'PhotoFill'; params: { planId: string; fromSetup: true } }

export type PlanStackParamList = {
  /** createRequest：マイページの「新しいデスク」から、一覧の作成の流れを始める（押した時刻） */
  PlanList: { createRequest?: number } | undefined
  // setupBack: 進捗バーで後ろの段から戻ってきた印。置き換えの動きを「戻る」にする
  // （navigation/setupStepNavigation.ts）。PurposeSelection〜DeskPlacement で共通
  // resume: 戻る前にいた段（SetupResume）。用途だけが持つ
  // copySource: 他人のデスクを参考に作るときのコピー元（utils/deskCopy.ts）。「次へ」で一覧を飛ばして詳細へ進む
  // intent: 初回画面でどちらのボタンから来たか。'organize'（今の配線を整理する）は
  // 手持ちが既にある人なので、テンプレート一覧を挟まず空の枠から組ませる。
  // 指定なし＝従来どおりテンプレート一覧へ進む
  PurposeSelection: { initialPurposes?: PlanPurpose[]; initialOtherPurposeLabel?: string; initialOtherPurposeIcon?: string; initialOtherPurposeColor?: string; returnPlanId?: string; setupBack?: true; resume?: SetupResume; copySource?: DeskCopySource; intent?: 'organize' | 'plan'; tutorial?: true } | undefined
  // wizard: デスク作成の流れの途中で開いたか。既存デスクのガジェットを選び直すだけのときに
  // 「利用目的 → テンプレート → 確認」の進捗バーを出さないための印
  GadgetSelection: { planId: string; wizard?: boolean; setupBack?: true }
  // 新規作成の最後に、配線を生成する前のガジェット配置を決める画面。
  DeskPlacement: { planId: string; setupBack?: true }
  // initialTab: 開くタブの指定。指定なし＝機材で、作成直後も一覧から開き直すときも
  // そこへ着地する。別のタブを指したい呼び出し側が出たときのための口
  WiringResult: { planId: string; initialTab?: 'gadgets' | 'wiring' | 'info' }
  // デスクの配線図から開くガジェット編集。ガジェットタブへ飛ばすと
  // 「編集 → 戻る → もう一度編集」でタブ間の遷移が噛み合わずマイガジェット一覧に
  // 落ちるため、AIコーチと同じくデスクのスタック内で開く（戻る＝そのデスクに戻る）
  GadgetDetail: { gadgetId: string; planId?: string; draftGadget?: Gadget; focusUsage?: boolean }
  // ガジェット登録も同じ理由でデスクのスタック内に持つ。保存後の goBack が
  // 作りかけのデスク（ガジェット選択・配線図）に戻るようにするため
  AddGadget: { presetId?: string; presetName?: string; planId?: string; category?: GadgetCategory; showCategoryPicker?: boolean; libraryOnly?: boolean; returnAfterAdd?: boolean; showWiringOnDone?: boolean }
  // テンプレートから作ると写真を入れる場所が無いので、配線図を見せたあとに開く
  PhotoFill: { planId: string; fromSetup?: boolean }
  // テンプレートの枠（isPlaceholder）へまとめて商品を割り当てる画面
  ProductFill: { planId: string }
  // 接続1本ずつに実物のケーブルを割り当てる画面（UI 表記「つなぎ方」）。
  // 配線図の線を1本ずつタップする経路と同じ編集を、一覧で通してやるためのもの
  ConnectionMethod: { planId: string }
  // composition: 機材の段の土台になるジャンルの並び（utils/deskComposition.ts）。
  // 渡されたときは取得せず、その場で1台1枠のテンプレートに見立てて使う（copySource と同じ扱い）
  TemplateDetail: { templateId: string; purposes: PlanPurpose[]; otherPurposeLabel?: string; otherPurposeIcon?: string; otherPurposeColor?: string; returnPlanId?: string; copySource?: DeskCopySource; composition?: CompositionPick[]; setupBack?: true; tutorial?: true; intent?: 'organize' | 'plan'; initialDraft?: TemplateDetailDraft }
  // AIコーチはデスクを起点にする機能なので、独立タブではなくデスクのスタックに置く。
  // planId 付きで開くとそのデスクを添付済みの状態でチャットが始まる
  AICoachChat: AICoachChatParams
  AICoachList: undefined
  // 他人のデスク・プロフィール（PublicStackParamList の注記）。
  // マイデスクの機材から「このガジェットを使っている人のデスク」へ飛べる
  PublicDesk: PublicStackParamList['PublicDesk']
  PublicProfile: PublicStackParamList['PublicProfile']
  BrandProducts: PublicStackParamList['BrandProducts']
}
