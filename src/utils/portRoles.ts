// ─── ポートの役割判定 ────────────────────────────────────────────────
//
// ポートの label は「保存された日本語の文字列」で、配線エンジン・フォーム・
// 詳細シートがそれぞれ独自の正規表現で意味を読み取っていた。同じ判定が
// 3ファイルに同じ式で重複していたり（レシーバー判定）、「給電」だけを見る場所と
// 「給電|充電」を見る場所が混在していたりして、片方だけ直すと配線と表示がずれる。
//
// **表示のための翻訳とは別物。** 表示は constants/portTypes.ts の
// localizedPortLabel が担当する。こちらは判定で、label は保存時の日本語のまま
// 来る前提。英語で保存されるようになったら、ここに英語の語を足すだけで済む。
//
// **式は移設元から一字も変えていない。** 意味が近くても別の式は別の定数にしてある
// （POWER_FEED_LABEL と POWER_SUPPLY_LABEL など）。ここを変えると配線結果が変わるので、
// 変えるときは tests/ の配線テストと scripts/audit* を通し、
// mapLayoutCache の LAYOUT_VERSION を上げること。

/** レシーバー・ドングル（USB-A に挿しっぱなしにする無線の受け側） */
export const RECEIVER_LABEL = /レシーバー|ドングル|receiver|dongle|Unifying|LIGHTSPEED|Logi Bolt/i

/** 「給電」とだけ書かれた口。フォームの給電方法ピッカーが作る */
export const POWER_FEED_LABEL = /給電/

/**
 * 先頭が「給電」の口。フォームの給電方法ピッカーが作るものだけを厳密に拾う。
 * POWER_FEED_LABEL（どこかに給電を含む）より狭い。「USB-C (映像 / 給電)」のような
 * 通信も兼ねる口をここで拾うと、給電専用として扱われて配線が消える
 */
export const POWER_FEED_PREFIX = /^給電/

/** ワイヤレス給電の口。gadgetPorts が作る固定ラベル */
export const WIRELESS_POWER_PORT_LABEL = 'ワイヤレス給電'

/** 給電または充電。電気が入る口の広いほうの判定 */
export const POWER_SUPPLY_LABEL = /給電|充電/

/** 充電（給電のうち、電池を持つ機器へ入る側） */
export const CHARGE_LABEL = /充電/

/** 有線接続（フォームの「接続方式＝有線」が作る口） */
export const WIRED_LABEL = /有線接続/

/** データ・映像を通す口。給電の語と併記されていても、これがあれば通信できる */
export const DATA_BEARING_LABEL = /データ|映像|接続|有線|ドングル|レシーバー|dongle|receiver|ドック|Dock|Host|Link|PC/i

/** ワイヤレス給電（旧形式の Power 型ポートに Qi / ワイヤレスと書いてあるもの） */
export const WIRELESS_POWER_LABEL = /Qi|ワイヤレス|wireless/i

/** アース付き（3極）のコンセント口 */
export const GROUNDED_LABEL = /アース/

/** ヘッドホン出力 */
export const HEADPHONE_OUTPUT_LABEL = /ヘッドホン|headphone|phones/i

/** USB PD 対応。supportsPowerDelivery が無い古いデータのために label も見る */
export const PD_LABEL = /PD/i

/** 接続方式フォームが作る有線の口（USB-A）。gadgetStore が完全一致で拾う */
export const WIRED_USB_A_PORT_LABEL = '有線接続 (USB-A)'

type Labeled = { label?: string }
const text = (port: Labeled): string => port.label ?? ''

export const isReceiverPort = (port: Labeled): boolean => RECEIVER_LABEL.test(text(port))
export const isPowerFeedPort = (port: Labeled): boolean => POWER_FEED_LABEL.test(text(port))
export const isPowerFeedPrefixPort = (port: Labeled): boolean => POWER_FEED_PREFIX.test(text(port))
export const isPowerSupplyPort = (port: Labeled): boolean => POWER_SUPPLY_LABEL.test(text(port))
export const isChargeLabelPort = (port: Labeled): boolean => CHARGE_LABEL.test(text(port))
export const isWiredPort = (port: Labeled): boolean => WIRED_LABEL.test(text(port))
export const isDataBearingPort = (port: Labeled): boolean => DATA_BEARING_LABEL.test(text(port))
export const isGroundedPort = (port: Labeled): boolean => GROUNDED_LABEL.test(text(port))
export const isHeadphoneOutputPort = (port: Labeled): boolean => HEADPHONE_OUTPUT_LABEL.test(text(port))
export const hasPowerDeliveryLabel = (port: Labeled): boolean => PD_LABEL.test(text(port))
