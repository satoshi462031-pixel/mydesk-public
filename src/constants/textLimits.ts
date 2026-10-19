// 自由記入欄の上限。
//
// ここに並ぶ欄は、どれもデスクを公開するとそのまま公開ページに出る
// （ガジェットのメモ・運用モード・ソフト設定・配線のルートのメモ）。
// 上限が無いと、
//   - 入力欄が伸び続けて保存ボタンを画面の外へ押し出す
//   - 公開スナップショット（share_snapshot の JSON）が青天井に太る
//   - 他人の詳細シートが1件のメモで埋まる
// の3つが同時に起きる。名前（20）・デスク名（30）・問い合わせ（2000）には
// もともと上限があり、公開先が同じこの4欄だけが素通りしていた。
//
// 切るときは必ず utils/truncateText の truncateChars を通す（絵文字を割らない）。

/** ガジェットのメモ。公開ページでは1つの節として全文が出る */
export const GADGET_MEMO_MAX_LENGTH = 1000

/** ソフト・設定。複数行で書く前提の欄 */
export const GADGET_SOFTWARE_SETTINGS_MAX_LENGTH = 500

/**
 * 運用モードの入力欄全体（改行・読点で区切って複数モードになる）。
 * 下の「12個 × 24字」に区切りの1字ずつを足した長さ。欄の上限がこれより短いと、
 * 個数・長さの上限に届く前に欄の側で止まり、定数の意図どおりに入れられない
 */
export const GADGET_OPERATION_MODES_MAX_LENGTH = 300

/** 運用モードの個数。チップとして横に並ぶので、行が積み上がらない数で止める */
export const OPERATION_MODE_MAX_COUNT = 12

/** 運用モード1つぶんの長さ。チップの幅（180）に収まる範囲 */
export const OPERATION_MODE_MAX_LENGTH = 24

/** 固定方法の補足・置き場所のラベルなど、1行で書く短い補足 */
export const GADGET_SHORT_NOTE_MAX_LENGTH = 100

/**
 * デスクのひとこと。公開ページでは用途・更新日の下に2行だけ出して残りは畳む。
 * desks.description にも入り、共有リンクのプレビュー（worker が先頭160字）と検索に使われる
 */
export const DESK_DESCRIPTION_MAX_LENGTH = 300

/** 「その他」に付ける用途名。アイコンの吹き出しで1行表示する */
export const PURPOSE_NAME_MAX_LENGTH = 10

/** 配線のルートのメモ。線1本ごとに付く補足 */
export const ROUTE_NOTE_MAX_LENGTH = 200

/**
 * ガジェット（商品）の名前。1行の欄だが貼り付けにはいくらでも入り、
 * 配線図のノード・一覧のタイル・公開ページに同じ値がそのまま出る。
 * 型番と仕様を並べた実在の商品名（40字前後）が収まる幅で止める
 */
export const GADGET_NAME_MAX_LENGTH = 100

/**
 * ガジェットの呼び名（「サブモニター」など）。配線図のノードではジャンル名の位置に
 * 2行・最小9pt で収めるので、ジャンル名（長いもので10字前後）と同じくらいで止める
 */
export const GADGET_NICKNAME_MAX_LENGTH = 16

/**
 * つなぎ方で選んだケーブルの商品名。DB の CHECK（076 の cable_name 1〜120）と揃える。
 * 公開は機材・配線・写真を1トランザクションで置き換えるので、1本でも超えると公開全体が失敗する
 */
export const CABLE_NAME_MAX_LENGTH = 120
