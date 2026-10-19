import { CableType } from '../types'

// ─── 商品名からケーブルの種別を読む ──────────────────────────────
//
// ケーブルの商品名には、ほぼ必ず端子が書いてある（「HDMI 2.1 ケーブル 2m」
// 「USB-C & USB-A ケーブル 0.9m」）。商品を選んだのに種別が空のままだと、
// デスクのケーブル一覧で「種類未設定」に落ち、色も並び順も付かない。
// 商品DB・プリセットのどちらも種別を持っていないので、名前から読む。
//
// あくまで「未設定のときの初期値」。ユーザーが選んだ種別は上書きしない。
// 確信が持てない名前では undefined を返す（間違った種別を入れるより、
// 未設定のままのほうが害が小さい）。

/** 表記ゆれを畳む：小文字化・全角→半角・記号と空白の除去 */
function normalize(name: string): string {
  return name
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s　_'"·・]/g, '')
    // 「USB-C ↔ USB-A」「USB-C to C」「USB-C & USB-A」を同じ形に寄せる。
    // 全角ハイフン（－）とマイナス（−）も落とす。ただし長音符（ー）は残す：
    // 消すと「ケーブル」が「ケブル」になり、日本語の語での判定が全部外れる
    .replace(/[-–—~〜－−‐]/g, '')
    .replace(/[＆&＋+]/g, 'to')
    .replace(/[↔→]/g, 'to')
}

/**
 * 上から順に当てる。**変換ケーブル（A ↔ B）を単独端子より先に置くこと。**
 * 「usbctohdmi」を先に見ないと、hdmi の規則が先に当たって USB-C 側が消える。
 */
const RULES: [RegExp, CableType][] = [
  // ── 変換（映像）──
  [/usbc(to)?hdmi|hdmi(to)?usbc/, 'USB_C_to_HDMI'],
  [/usbc(to)?(dp|displayport)|(dp|displayport)(to)?usbc/, 'USB_C_to_DisplayPort'],
  [/minidp(to)?dp|minidisplayport(to)?displayport|mdp(to)?dp/, 'MiniDisplayPort_to_DisplayPort'],
  [/(dp|displayport)(to)?hdmi/, 'DisplayPort_to_HDMI'],
  [/hdmi(to)?(dp|displayport)/, 'HDMI_to_DisplayPort'],
  [/hdmi(to)?dvi|dvi(to)?hdmi/, 'HDMI_to_DVI'],

  // ── 変換（USB）──
  [/usba(to)?usbc|usbc(to)?usba|usba(to)?c\b|typeatoc/, 'USB_A_to_C'],
  [/usbc(to)?lightning|lightning(to)?usbc/, 'USB_C_to_Lightning'],
  [/usba(to)?lightning|lightning(to)?usba/, 'USB_A_to_Lightning'],
  [/usbc(to)?micro(usb)?|micro(usb)?(to)?usbc/, 'USB_C_to_microUSB'],
  [/usba(to)?micro(usb)?|micro(usb)?(to)?usba/, 'USB_A_to_microUSB'],
  [/usbc(to)?usbb|usbc(to)?b\b/, 'USB_C_to_B'],
  [/usba(to)?usbb|usba(to)?b\b|プリンター/, 'USB_A_to_B'],

  // ── 変換（音声）──
  [/rca(to)?(35|3.5)mm|(35|3.5)mm(to)?rca/, 'RCA_to_3_5mm'],
  [/rca(to)?(63|6.3)mm|(63|6.3)mm(to)?rca/, 'RCA_to_6_3mm'],
  [/(35|3.5)mm(to)?(63|6.3)mm|(63|6.3)mm(to)?(35|3.5)mm|標準プラグ変換/, 'Audio3_5_to_6_3'],

  // ── 単独端子 ──
  [/thunderbolt|tb[34]\b/, 'Thunderbolt'],
  [/usbc|typec|magsafe3/, 'USB_C'],
  [/usba|typea/, 'USB_A'],
  [/lightning/, 'Lightning'],
  [/microusb/, 'microUSB'],
  [/usbb/, 'USB_B'],
  [/hdmi/, 'HDMI'],
  [/minidisplayport|mdp\b|minidp/, 'MiniDisplayPort'],
  [/displayport|\bdp1|\bdpケーブル|\bdp\b/, 'DisplayPort'],
  [/dvi/, 'DVI'],
  [/vga|dsub/, 'VGA'],
  [/lan(ケーブル)?|ethernet|cat[5678]|カテゴリ[5678]/, 'Ethernet'],
  [/xlr4pin|4pinxlr/, 'XLR4pin'],
  [/xlr(to)?trs|trs(to)?xlr|コンボ/, 'XLR_TRS_Combo'],
  [/xlr|マイクケーブル|キャノン/, 'XLR'],
  [/midi(35|3.5)mmtrs|midtrs/, 'MIDI_TRS'],
  [/midi/, 'MIDI'],
  [/光デジタル|オプティカル|optical|toslink/, 'OpticalAudio'],
  [/同軸|coaxial|spdif/, 'CoaxialAudio'],
  [/スピーカーケーブル|speakercable|バナナプラグ/, 'SpeakerTerminal'],
  [/(44|4.4)mm/, 'Audio4_4mm'],
  [/(63|6.3)mmts\b/, 'Audio6_3mm_TS'],
  [/(63|6.3)mm|標準プラグ|フォーン/, 'Audio6_3mm'],
  [/(35|3.5)mm|ステレオミニ|ミニプラグ|auxケーブル/, 'Audio3_5mm'],
  [/rca|ピンプラグ/, 'RCA'],
  [/dcケーブル|dcプラグ|acアダプター/, 'DCPower'],
  [/電源ケーブル|メガネケーブル|acケーブル|powercable|powercord/, 'Power'],
  [/cfexpress/, 'CFexpress'],
  [/microsd/, 'microSDCard'],
  [/sdカード|sdcard/, 'SDCard'],
]

/**
 * 商品名からケーブル種別を推定する。読み取れなければ undefined。
 * ケーブル以外のカテゴリでは呼ばない前提（「HDMIポート搭載」のモニターに
 * ケーブル種別を付けても意味がない）。
 */
export function cableTypeFromName(name: string): CableType | undefined {
  const text = normalize(name)
  if (!text) return undefined
  for (const [pattern, type] of RULES) {
    if (pattern.test(text)) return type
  }
  return undefined
}
