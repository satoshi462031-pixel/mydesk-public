import AsyncStorage from '@react-native-async-storage/async-storage'
import { repairStoredFolders, repairStoredGadgets } from '../utils/storedDataRepair'
import { isReceiverPort, isWiredPort, WIRED_USB_A_PORT_LABEL } from '../utils/portRoles'
import { Gadget, GadgetFolder, PortType } from '../types'
import { normalizeCableType, normalizePorts } from '../utils/portTypeMigration'

const KEY         = '@desk_gadgets'
const FOLDERS_KEY = '@gadget_folders'
const MIGRATION_KEY = '@desk_gadgets_migration'

// loadGadgets の正規化は「保存済みデータを現在の形式へ揃える」一度きりの変換。
// 結果を書き戻して印を付け、次回以降は JSON.parse だけで済ませる
// （印が無いと毎起動で全ガジェット×全ポートに正規表現がかかる）。
// 正規化ロジックを足したときはこの値を上げて、全端末で再実行させること。
const MIGRATION_VERSION = '7'

// AddGadget / GadgetDetail のレシーバー判定と同じ語彙。ここを変えるならあちらも合わせる
const MOUSE_PAD_NAME = /マウス\s*パッド|mouse\s*pad/i
const DESK_MAT_NAME = /デスク\s*マット|desk\s*mat/i

export const FOLDER_PALETTE = [
  '#FF6B6B', '#FF9F43', '#FECA57', '#1DD1A1',
  '#48DBFB', '#54A0FF', '#C44EF0', '#FF6EB4',
]

/**
 * 読み込めなかったときは例外を投げる。ここで [] を返すと「まだ1台も登録していない人」と
 * 区別がつかず、次の保存が空のメモリを正として書き、登録済みのガジェットを全部消す
 * （バックアップにも0件で上がる）。planStore の loadPlans と同じ約束。
 */
export async function loadGadgets(): Promise<Gadget[]> {
  const entries = await AsyncStorage.multiGet([KEY, MIGRATION_KEY])
  const raw = entries.find(([k]) => k === KEY)?.[1] ?? null
  const migratedVersion = entries.find(([k]) => k === MIGRATION_KEY)?.[1] ?? null
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('gadgets are not an array')
  // 移行済みでも、壊れた1件で全画面が落ちないよう形だけは確かめる（utils/storedDataRepair.ts）
  if (migratedVersion === MIGRATION_VERSION) return repairStoredGadgets(parsed)
  // 1台でも変換できないと map ごと落ちて全件を失うため、失敗した1台は変換せずに残す。
  // ポートの無い形だけは描画と配線が落ちるので空にする
  const migrated = repairStoredGadgets(parsed.flatMap((stored: unknown): Gadget[] => {
    if (typeof stored !== 'object' || stored === null) return []
    try {
      return [migrateGadget(stored as Gadget)]
    } catch {
      const gadget = stored as Gadget
      return [Array.isArray(gadget.ports) ? gadget : { ...gadget, ports: [] }]
    }
  }))
  // 書き戻しを待ってから返す。await せずに返すと、この書き込みより先に
  // useGadgets の楽観的更新が保存され、あとから古い内容で上書きしうる。
  // 書けなくても読めた中身は返す（印が付かないので次回もう一度変換するだけ）
  await AsyncStorage.multiSet([
    [KEY, JSON.stringify(migrated)],
    [MIGRATION_KEY, MIGRATION_VERSION],
  ]).catch(() => {})
  return migrated
}

function migrateGadget(stored: Gadget): Gadget {
  // ヘッドセットはヘッドホンへ統合した。マイクは USB や 3.5mm の同じ1本に
  // 相乗りするので配線図に線として出ず、分けても端子構成が違うだけだった。
  // 保存済みデータには 'Headset' が残るので、読み込み時に寄せる
  const gadget: Gadget = (stored.category as string) === 'Headset'
    ? { ...stored, category: 'Headphone' }
    : stored
  // 旧 Thunderbolt3 / Thunderbolt4 を Thunderbolt へ寄せる（両方持つガジェットは本数を合算）
  let ports: Gadget['ports'] = normalizePorts(gadget.ports).map((port) =>
    port.type === 'USB_C' &&
    port.direction === 'input' &&
    port.label === WIRED_USB_A_PORT_LABEL
      ? { ...port, type: 'USB_A' }
      : port,
  )
  if (gadget.category === 'Printer3D') {
    ports = ports.map((port) =>
      port.type === 'microSDCard' && port.direction === 'output'
        ? { ...port, direction: 'input' }
        : port,
    )
  }
  // キャプチャデバイスの「PC 接続」を output で保存していた。向きが逆だと
  // 配線エンジンが PC・ハブから線を引けず、PC へ映像を渡す線が図に出ない
  if (gadget.category === 'CaptureDevice') {
    ports = ports.map((port) =>
      (port.type === 'USB_C' || port.type === 'USB_A') && port.direction === 'output'
        ? { ...port, direction: 'input' }
        : port,
    )
  }
  // 2.4GHzレシーバーは PC に直挿しするのでケーブルが要らない。
  // directAttach を足す前に保存されたガジェットにも印を付ける（ラベルで判定）
  ports = ports.map((port) =>
    port.directAttach === undefined &&
    port.direction === 'input' &&
    isReceiverPort(port)
      ? { ...port, directAttach: true }
      : port,
  )
  const hasExplicitWiredConnection = ports.some(
    (port) => port.direction === 'input' && isWiredPort(port),
  )
  if (
    hasExplicitWiredConnection &&
    ['Keyboard', 'Speaker', 'Headphone', 'Earphone', 'Controller'].includes(gadget.category)
  ) {
    ports = ports.filter((port) =>
      port.type !== 'Bluetooth' &&
      !(port.type === 'USB_A' && port.direction === 'input' && !port.label),
    )
  }
  const exactName = `${gadget.name} ${gadget.model ?? ''}`
  if (gadget.category === 'Smartwatch' && /^Apple Watch (Series (10|9|8|7|6)|Ultra 2|SE)( |$)/i.test(exactName)) {
    ports = ports.filter((port) => port.type !== 'wirelessCharging')
    const usbType: PortType = /^Apple Watch SE( |$)/i.test(exactName) ? 'USB_A' : 'USB_C'
    if (!ports.some((port) => port.type === usbType && port.direction === 'input')) {
      ports.push({
        id: `${gadget.id}-magnetic-charge`,
        type: usbType,
        direction: 'input',
        count: 1,
        label: 'マグネット充電（専用ケーブル）',
      })
    }
  }
  if (
    gadget.category === 'Smartwatch' &&
    /GARMIN (Fenix 7X|Venu 3|Forerunner 965|Instinct 2X)/i.test(exactName) &&
    !ports.some((port) => (port.type === 'USB_A' || port.type === 'USB_C') && port.direction === 'input')
  ) {
    ports.push({
      id: `${gadget.id}-charging-cradle`,
      type: 'USB_A',
      direction: 'input',
      count: 1,
      label: '専用クレードル',
    })
  }
  const category = /Nintendo Switch 2 Dock/i.test(exactName)
    ? 'Dock'
    : /Elgato 4K60 Pro MK\.2|AVerMedia Live Gamer 4K/i.test(exactName)
      ? 'CaptureDevice'
      : /^(Meta Quest 3|PlayStation VR2)( |$)/i.test(exactName)
        ? 'VRGlass'
        : gadget.category === 'DeskPad' && MOUSE_PAD_NAME.test(exactName) && !DESK_MAT_NAME.test(exactName)
          ? 'MousePad'
          : gadget.category
  const consoleFormFactor = category === 'GameConsole'
    ? (gadget.consoleFormFactor ?? (ports.some((port) => port.type === 'Power' && (port.direction === 'input' || port.direction === 'bidirectional')) ? 'stationary' : 'handheld'))
    : undefined
  let cableType = gadget.cableType ? normalizeCableType(gadget.cableType) : undefined
  if (category === 'Cable' && !cableType && gadget.dimensions) {
    const legacyType = gadget.dimensions.split(',')[0]?.trim()
    const legacyTypes: Record<string, PortType> = {
      'USB-C': 'USB_C', 'USB-A': 'USB_A', 'USB-A to C': 'USB_A_to_C', 'USB-B': 'USB_B',
      'HDMI': 'HDMI', 'HDMI 2.1': 'HDMI', 'DP': 'DisplayPort', 'Ethernet': 'Ethernet',
      '電源': 'Power', 'Audio 3.5mm': 'Audio3_5mm', 'XLR': 'XLR',
    }
    cableType = legacyTypes[legacyType]
  }
  // 旧 notes をメモへ寄せる。型からは外したが、リポジトリ以前のデータには
  // 残っている可能性がある。表示は memo 一本にしたので、拾わないと消えて見える。
  // メモを既に書いている場合は本人が書いたほうを残す
  const { notes: legacyNotes, ...rest } = gadget as Gadget & { notes?: string }
  const memo = gadget.memo ?? (legacyNotes || undefined)
  return { ...rest, memo, category, consoleFormFactor, cableType, cableCount: category === 'Cable' ? (gadget.cableCount ?? 1) : gadget.cableCount, ports }
}

/**
 * 保存済みデータを外部から丸ごと差し替えたとき（バックアップ復元・ログアウト）に呼ぶ。
 * 書き戻された内容は旧形式かもしれないので、次回読み込みで正規化をやり直させる。
 */
export async function clearGadgetsMigrationFlag(): Promise<void> {
  await AsyncStorage.removeItem(MIGRATION_KEY).catch(() => {})
}

export async function saveGadgets(gadgets: Gadget[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(gadgets))
}

// 単発の add / update / delete はここに置かない。useGadgets のメモリキャッシュと
// ミューテーションキューを経由しない書き込みは、画面側の楽観的更新に後から
// 上書きされて黙って消える。追加・更新・削除は必ず useGadgets 経由で行うこと。

// ─── Folders ──────────────────────────────────────────────────────────────────

/** loadGadgets と同じく、読めなかったときは例外を投げる（空で返すと次の保存でフォルダが全部消える） */
export async function loadFolders(): Promise<GadgetFolder[]> {
  const raw = await AsyncStorage.getItem(FOLDERS_KEY)
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('gadget folders are not an array')
  return repairStoredFolders(parsed)
}

export async function saveFolders(folders: GadgetFolder[]): Promise<void> {
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
}
