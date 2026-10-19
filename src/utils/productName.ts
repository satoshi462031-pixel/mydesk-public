import { brandAliases, brandEntry, brandKey, compactBrand } from './brandIdentity'

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  // 商標記号は後段で落とす。表に無いと「Ryzen&trade;」が実体参照のまま残る
  trade: '™',
  reg: '®',
  copy: '©',
  hellip: '…',
  times: '×',
  mdash: '—',
  ndash: '–',
}

const PROMO_WORDS =
  /送料無料|ポイント(?:\s*UP|\s*アップ|\s*\d+\s*倍)?|\d+\s*倍ポイント|[PpＰ]\s*\d+\s*倍|クーポン(?:配布)?|楽天(?:市場|ランキング|スーパー\s*SALE|最安値挑戦|\s*\d+\s*位)|スーパー\s*SALE|\d+\s*連冠|累販[\d,]+個突破|あす楽|即納|翌日配送|在庫あり|期間限定|限定|セール|SALE|最大\s*\d+\s*[%％]?\s*(?:オフ|OFF)?|\d+個目半額|配布|無料ラッピング対応可|国内正規品?|メーカー保証|新品(?:未開封)?|\d*\s*年保証|大特価|激安|人気|おすすめ|お中元|夏ギフト|ギフト|ランキング(?:上位入賞|入賞|上位|\s*\d+\s*位(?:獲得)?)?|\d*\s*冠達成|受賞|VGP\s*\d{4}\S*(?:\s*\S*賞\S*)?|キャンペーン|最安(?:値(?:に)?挑戦(?:中)?|一点?\d+円|\d+円)?|お買い得|特価|全品\s*\d+\s*[%％]|\d+\s*[%％]\s*(?:オフ|OFF)|[\d,]+円お得|翌日配達|翌日発送|当日発送|父の日|母の日|敬老の日|お歳暮|クリスマス|ハロウィン|バレンタイン|ホワイトデー|福袋|値引(?:き)?中?|獲得|エントリー(?:で\S*)?|新作\S*登場|予約販売|新パッケージ|夏休(?:み)?\S*|第?\d+\s*位|抽選(?:チャンス|で)?|プレゼント|おまけ/i

const alternation = (patterns: RegExp[]): string => patterns.map((pattern) => pattern.source).join('|')

/**
 * 出品ページの運用で名前に書き足された語。PROMO_WORDS で消したあとに破片で残っていたもの
 * （「万P」「円CP＋ ！！7 25」「20日は24時間」）と、在庫・配送・保証・店舗の管理コード。
 * 商品マスタ2万件の監査で実際に出た表記だけを入れている。
 *
 * 中古・レンタル・アウトレットの語はここに入れない。消すと実体を偽る（下のテスト参照）。
 */
const SALES_NOTICE = new RegExp(alternation([
  // ポイント・クーポンの破片
  /\d*万P(?:抽選チャンス)?/, /円CP[＋+]?/, /ポイントバック/, /(?<!\S)(?:倍|数量|枚数)(?!\S)/, /[!！]{2}\d{1,2}\s\d{1,2}/,
  // 値引き・価格。「4,782円」は区切りの , が抜けて「4 782円」で保存されている行がある
  /(?:で|1点当たり)?\d{1,3}(?:[,\s]\d{3})+\s?円(?:相当|OFF(?:\s*中[!！]*)?|引き?|でお得|お得|ポッキリ|以上購入で\S*)?[～〜~!！&]*/,
  /(?:で|1点当たり)?\d+\s?円(?![形卓盤柱筒周])(?:相当|OFF(?:\s*中[!！]*)?|引き?|でお得|お得|ポッキリ|以上購入で\S*|の)?[～〜~!！&]*/,
  /(?<!\S)OFF(?:\s*中[!！]*)?(?!\S)/, /(?<!\S)中[!！]+/, /円OFF(?:\s*中[!！]*)?/, /\d+\s?[%％]\s?(?:OFF|オフ|引き?|バック&?)/,
  // 「Amazfit 10％ Bip Max」のようにブランド直後に置かれた還元率。キーボードの配列サイズ（75%）とは区別する
  /(?:(?<=^\S+\s)|^)\d{1,2}[%％](?=\s(?!.*(?:配列|キー|軸|レイアウト|メカニカル)))/,
  /\d+(?:点目|本目|個目)(?:半額|タダ)/, /半額/, /セット割/, /特別価格[!！]?/, /値下げ中?[!！]?/, /価格×/, /手頃価格で放出/,
  /⇒\s*[\d,\s]*円?/, /先着\S*/, /超?目玉品?/, /(?:絶対)?お得(?:な|[!！])?/, /(?:複数)?割引(?:対象品|お買い特品)?/,
  /在庫一掃[!！]?/, /赤字大サービス/, /(?:驚きの)?コスパ(?:優勝|最強)?[!！]?/, /驚きの/,
  // 日時・期間限定
  /\d{1,2}\s\d{1,2}\s?\d{1,2}時[~〜～]?(?:\d+時間)?(?:から販売開始)?/, /\d{1,2}日\d{1,2}時[~〜～]/, /\d+日は\d+時間/,
  /\d{1,2}\s?\d{1,2}AM\d{1,2}[:：]\d{2}\s?[~〜～]?/, /(?:\d{1,2}\s){0,2}\d{1,2}[:：]\d{2}\s?[~〜～]/,
  /本日(?:\d{1,2}[:：]\d{2}まで)?/, /\d+日と[\d.]+のつく日\s?(?:\d+日は)?/, /\d+の(?:つく)?日/, /(?<!\S)月末(?!\S)/,
  /\d+月前のフライング/, /決算特別/, /今だけ/, /(?<!\S)先行(?!\S)/, /[～〜~]?\d{1,2}日迄/, /(?<!\S)\d{1,2}\s\d{1,2}(?:迄|限り|終了)/,
  /(?:メーカー)?在庫限り(?:で終了)?/, /\d{1,2}月\d{1,2}日(?:時点|入荷予定?)/, /(?<!\S)\d{1,2}\s\d{1,2}\s?[!！](?=\s|$)/,
  /Brand Week/, /実施中/, /\d+日まで[!！]?/, /全店/, /発行中[!！]?/, /^\d{1,2}\s\d{1,2}(?=\s)/, /キャンセル不可商品/,
  /(?<!\S)\d{1,2}\s\d{1,2}[~〜～]\d{1,2}\s\d{1,2}(?!\S)/, /(?<!\S)[~〜～]\d+日(?!\S)/, /(?<!\S)\d{1,2}\s\d{1,2}\s?まで[!！]?/,
  /(?:\d{1,2}-)?\d{1,2}時まで&?/, /\d{1,2}[:：]\d{2}まで/, /開催(?:予定)?[!！]?/, /(?<!\S)まで[!！]?/, /週末応援特売[!！]?/, /真夏の大感謝祭/,
  /店内全品/, /(?<!\S)全品(?!\S)/, /いいものをより安く[!！]?/, /エクプラ特割/, /(?<!\S)割[!！]/, /(?<!\S)期間(?!\S)/, /只今[!！]?増量中/, /P[＋+]\d+倍/,
  /(?<!\S)\d{1,2}\s\d{1,2}(?:は|から[!！]?)(?!\S)/, /(?:お買い物)?マラソン/, /(?<!\S)(?:住設用品|OA用品)(?!\S)/, /(?<!\S)最短(?!\S)/, /法人宛て?/, /意匠登録済[!！]?/, /(?<!\S)864(?!\S)/,
  /メール便対応可能?/, /(?<!\S)万\s?当たる/, /(?<!\S)万(?!\S)/, /当たる/, /リアルタイム\s?デイリー\s?週間\s?で?堂々の/, /(?<!\S)あり[!！]+/, /(?<!\S)Pバック/,
  // レビュー・エントリー特典
  /(?:豪華)?レビュー(?:投稿)?(?:で|特典)\S*/, /(?:圧倒的)?レビュー(?:数|件数)?[\d,\s]*件(?:突破|over)?[!！]*/,
  /[\d,\s]+件レビュー突破[!！]*/, /評価\d+件over/, /(?<!\S)レビュー(?:投稿)?(?!\S)/, /要エントリー?/, /LINE登録で?/,
  /(?:選べる)?豪華特典/, /条件特典/, /[＋+]?特典(?:付き|有|あり|中)?[!！]*/, /\S*レビュー数No\.?1/, /高評価(?:レビュー)?\s?[\d.]*/,
  // 実績・煽り
  /業界トップの信頼性/, /東証上場の安心企業/, /木村拓哉(?:CM|さんが登場)/, /\S*の定番モデル[!！]?/, /見逃し(?:厳禁|損)[!！]?/,
  /SNSで話題/, /新生活(?:応援|に最適な)/, /テレワーク応援/, /まとめ買いで/,
  /(?<!\S)楽天(?!\S)/, /楽天(?:\d+冠|常勝No\.?1|圧倒的\S*)/, /世界シェアNo\.?1/, /\d+年連続販売台数No\.?1/, /(?<!\S)No\.?1(?!\S)/,
  /(?<!\S)上位(?!\S)/, /\d{4}新タイプ登場[!！]?/, /店長厳選/, /(?:日本独占)?販売店/, /ブランド直営店/, /(?<!\S)(?:HD|JP)店(?!\S)/,
  /早い者勝ち/, /残り\d+点/, /(?<!\S)常連/, /注目商品\s?[!！]?/, /売れ筋/, /当店(?:オススメ|一押し)?/, /\S*にもオススメ[!！]?/, /オススメ[!！]?/,
  /(?:楽天\s?)?(?:\S*ジャンル)?入賞/, /グッドデザイン\d{4}/, /(?<!\S)(?:安い|格安)(?!\S)/, /バレない/, /便利すぎる/,
  /[!！]?今のうちにカゴへ/, /最強配送(?:対応で最短翌日到着[!！]*)?/, /(?<!\S)最強(?:ペア)?(?!\S)/, /[〜~]?迷ったらこれ[!！]?[〜~]?/,
  /顧客満足度[\d.]+[%％]/, /(?:シリーズ)?累計(?:販売台数)?[\d,\s万]+(?:台|個|脚)?(?:突破|出荷)[!！]*/, /新価格/, /選ばれています/, /超ベスト/,
  // 保証・公式・正規品の宣伝
  /[\d一]+年間の製品保証[!！]*/, /\d+年データ復旧・無償交換保証/,
  /(?:[\d一二三]+(?:年間?|[ヶか]月間?|日間?)の?)?(?:国内|長期|完全|無償|安心|延長|永久|製品)?保証(?:付き?|書付|\d年付?)?[!！]*/,
  /公式[～〜]進化の(?:始まり|続き)/, /(?:メーカー)?公式(?:直営店|ストア|ショップ|店|通販|サイト|品)?(?:・直販)?(?!ライセンス)/, /(?<!\S)通販(?!\S)/, /直販/,
  /国内サポート正規品/, /\d{4}新版正規品/, /(?:日本|国内|EU)?正規(?:取扱い?店|代理店品?|品)?/, /(?:総|販売)?代理店/, /安心の(?:日本正規品[!！]?)?/,
  // 在庫・配送・販売条件
  /目安在庫\s?[=＝]\s?[○◯△×]/, /在庫目安[:：]\S+/, /メーカー在庫(?:品|有り?|僅少のため)?/, /在庫(?:品|有り?|残少)[!！]?/,
  /(?:在庫品?|欠品|次回)?納期(?:約?[\d〜~-]+(?:週間?|営業日?|日)[〜~]?(?:かかります)?|ご確認ください[!！]?|は確認後ご連絡|にお時間がかかる場合があります|\d+月(?:上旬|中旬|下旬|以降)|未定|\d*)/,
  /(?<!\S)在庫(?!\S)/, /(?:一部)?在庫(?:処分品?|限)/, /一部在庫/, /かかります/,
  /\S*(?:国内|土日祝|即|当時|倉庫より\d*日?|倉庫)発送(?:可能)?/, /(?<!\S)発送(?!\S)/, /最短翌日(?:お届け|届)/, /ラッピング(?:無料|可)/,
  /\S*同梱不可/, /(?:配送\S*\s?)?[＆&]?\s?不要ピアノ引取処分無料/, /キャンセル不可・?/, /\S*離島配送不可?/, /No\.?1?レビュー[\d,\s]*件超?の?/, /配送組立設置料無料/, /(?<!\S)配送(?!\S)/, /\d+個まで\s?\d?配送/,
  /包装無料/, /メッセージカード無料/, /配送補償/, /先行予約/, /別途\s?(?:送料)?\s?あり/,
  /クリックポスト/, /DM便/, /農園直売/, /個装箱(?:無し|なし)/, /簡易包装/, /最短当日シリアル納品/, /受注発注品?/,
  /\d枚サービス/, /取説サービス/, /専用ケース無料/, /安心初期保障/, /\d年安心/, /(?<!\S)\d年間(?!\S)/, /(?<!\S)無料(?!\S)/,
  /(?<!\S)特[別别](?!\S)/, /電話で無料相談可能/,
  // 検索向けのハッシュタグ（#リズム時計 #デジタル）の # だけを外す。語まで消すと、名前がタグだけの
  // 商品は空になる。型番の #ABJ・弦の #11027 は英数字なので残る
  /(?<!\S)#(?=[^\s\dA-Za-z#])/,
  /(?:\S*の場合)?\d+[~〜～-]\d+営業日(?:で出荷可能)?/, /[-－]?お?取り?寄せ?(?:品|商品)?/,
  /即日(?:出荷|発送)可?[!！]?/, /\d*週間以内(?:に)?発送/, /365日毎日出荷/, /短納期/, /最短翌日(?:到着|配送)[!！]*/, /(?<!\S)即配(?!\S)/,
  /土日\s?祝日発送/, /店舗受取可/, /(?:メーカー)?直送品?/, /代引き?(?:決済)?不可/, /・?他メーカー同梱不可/, /代引・時間指定不可/,
  /個人宅様?送り不可/, /軒先渡し/, /車上渡し/, /(?:組立)?設置無料/, /全国配送可/, /法人のみ無料配送/, /Y?通常配送商品/,
  /配送種別[:：]\S+/, /往復送料込[!！]?/, /送料(?:込み?|別)?[!！]?/, /メール便(?:のみ|不可)?/, /ゆうパケット/, /定形外(?:郵便)?(?:発送|可)?(?:\d+円)?/,
  /販売単位[:：]\S+/, /個数[:：]\S+/, /(?:別売)?ラッピング(?:袋あり|不可|対応可)/, /無金利ローン/, /ふるさと納税/, /法人専用(?:価格あり)?/,
  /返品OK[!！]?条件付/, /品のため\s?返品及び製品保証の対象外となります。?/, /お一人様\d+点まで/, /ご注文後[\d~〜-]+日でお届けします/,
  /ご?予約受付中?[!！]?/, /(?<!\S)予約(?!\S)/, /\d{1,2}\s?\d{1,2}入荷予定・?/, /最新ロット(?:大量)?入荷[!！]?/, /貴重デザイン入荷[!！]?/,
  /受注生産/, /玄関先迄納品/, /\d本同時購入をお願いします/, /\d+[ヵヶか]月以内に順\S*/,
  // 店舗の管理コード・ASIN・JAN
  /▼\d{3}-\d{4}/, /rb_(?:audio_|keyboard_)?cpn/, /(?<!\S)rb_(?!\S)/, /keyboard_cpn/, /dssp_\w+/, /(?<!\S)s_(?!\S)/, /KK9N0D18P/,
  /(?<!\S)JAN(?:\s?\d{8,13})?(?!\S)/, /(?<![\w-])4[59]\d{11}(?![\w-])/, /(?<![\w-])B0(?=[0-9A-Z]*[A-Z])[0-9A-Z]{8}(?![\w-])/,
  /(?<!\S)品番(?!\S)/, /品番[:：]?(?=[A-Z0-9])/, /\d{4}-4[59]\d{11}-ds/, /SK本舗/, /(?<=サンコー)レアモノショップ/, /ムラウチドットコム/,
  // 文章・注意書き
  /(?:強化(?:ガラス)?\s*)?と\s*同等の/, /(?<!\S)機種で使える/, /プリンター接続などに/, /としても(?:使用可能)?[!！]?/,
  /単体では(?:音は出ません|使えません)。?/, /注[:：]/, /\S*に適しています/, /若干色の異なる場合あります。?/, /\S*は付属無し/,
  /リニューアル。新セット登場。/, /(?<=名入れ)\s?(?:でき(?:ます|る)|無料)/, /も選べます/, /(?<=カラー)選べます/, /\S*にも使えます/,
]), 'gi')

/**
 * ［...］【...】〔...〕≪...≫＜...＞で囲われた塊。中身が販促文言なら丸ごと落とす。
 * 記号だけを消すと「［楽天ランキング1位獲得］」が「楽天 獲得」のような破片で残り、
 * 逆に一律で中身ごと落とすと「［55V型 /Bluetooth対応］」のような仕様表記まで消える。
 * ≪≫＜＞は販促でなければ囲みだけ外す（「≪サンワサプライ≫」「COMFY＜カンフィー＞」）。
 */
const BRACKETED = /［([^］]*)］|【([^】]*)】|〔([^〕]*)〕|≪([^≫]*)≫|＜([^＞]*)＞/g
const PROMO_IN_BRACKET = new RegExp(`${PROMO_WORDS.source}|${SALES_NOTICE.source}|楽天|獲得|話題|注目|^\\s*\\d+年\\s*$|可能|便利|突破|発行中`, 'i')

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hex, named) => {
    const codePoint = decimal ? Number(decimal) : hex ? Number.parseInt(hex, 16) : null
    if (codePoint != null) {
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity
    }
    return HTML_ENTITIES[String(named).toLowerCase()] ?? entity
  })
}

/**
 * 見た目が同じで別の文字になっているものを揃える。
 * 型番の「MM−HSU07BK」（U+2212）は「MM-HSU07BK」で検索しても当たらず、
 * 「ワイヤ—ド」（ダッシュ）は長音の代わりに打たれている。
 */
function normalizeLookalikes(value: string): string {
  return value
    .replace(/(?<=[A-Za-z0-9])[‐‑−－ー](?=[A-Za-z0-9])/g, '-')
    .replace(/(?<=[ァ-ヶ])[‐−－—―](?![A-Za-z0-9])/g, 'ー')
    .replace(/[−－]/g, '-')
    .replace(/(?<=[A-Za-z0-9])．(?=[A-Za-z0-9])/g, '.')
    .replace(/(?<=\d)゛/g, '"')
    .replace(/(?<=[A-Za-z])[‘’](?=[a-z])/g, "'")
    // 取り込み時に化けた「?」。容量の区切り（16GB?32GB）と、商標記号の跡（FLEX? 120）
    .replace(/(?<=[A-Za-z0-9])\?(?=[A-Za-z0-9])/g, '/')
    .replace(/(?<=[A-Za-z])\?(?=\s|$)/g, '')
    .replace(/(?<!\S)\?(?!\S)/g, ' ')
    .replace(/(?<=\d),(?=\d{3}(?!\d))/g, '')
    .replace(/·/g, '・')
}

/** 区切りとして浮いている記号を外す。店舗の管理コード（rb_ keyboard_cpn）を消した後に当てる */
function removeLooseSeparators(value: string): string {
  return value
    // 「キーボード_マルチペアリング_75%_」のように日本語の区切りに使われた _。型番の「_JP」「WD_BLACK」は残す
    .replace(/(?<=[^\x00-\x7F])_|_(?=[^\x00-\x7F])|_(?=\s|$)/g, ' ')
    // 語に付いて浮いた *（「WXGA*」「道具セット*」「*bonsai」）。「USB-C*2」「2000*1200」の掛け算は残す
    .replace(/(?<![\p{L}\p{N}])\*|\*(?![\p{L}\p{N}])/gu, ' ')
    // 売り文句の語尾の「！」（肩こり・猫背を解消！）。英字の製品名（be quiet! / Live!）と
    // 語の途中（ふたりで!にゃんこ大戦争）は残す
    .replace(/(?<=[^\x00-\x7F])[!！]+(?=\s|$)/g, '')
}

/**
 * 区切りの「/」が要約時に空白へ置き換わって意味を失った表記を戻す
 * （「R:540MB s」「10 100 1000Mbps」「11n g」）。保存済みの名前を表示するときにも効かせる。
 */
function repairSplitUnits(value: string): string {
  return value
    .replace(/(?<=\d(?:[KMG]B|[KMG]b))\s(?=s(?!\S))/g, '/')
    .replace(/(?<!\d)10 100 1000(?=\s?Mbp)/g, '10/100/1000')
    .replace(/(?<!\S)(\d{1,3}) (\d{3})(?=万|件|個|回)/g, '$1$2')
    .replace(/(?<!\S)高 さ(?!\S)/g, '高さ')
    // 数値が抜けて残った「幅」「約」（「幅 高さ72〜118cm」「約 幅 60 75 cm」）
    .replace(/(?<!\S)(?:約|幅)(?=\s+(?!\d)|$)/g, ' ')
    .replace(/\b11(?:ax|ac|[abgn])(?:\s(?:ax|ac|[abgn]))+(?!\S)/g, (all) => all.replace(/\s/g, '/'))
    .replace(/(?<=\d)\s(?=g(?!\S))/g, '')
    .replace(/(?:約\s*)?(?<!\S)W\s+D\s+H(?!\S)/g, ' ')
}

// どこにあっても名前の一部になりえない1文字・1語
const STRAY_ANYWHERE = /^(?:[#*＊!！:：・~〜～‐―…=＝√\\│]|と|を|の|で|に|付|有|品|ス|s|g)$/
// 名前の途中なら接続の意味を持つ（「Stick & Mallet」「H1essential + ミニ3脚」「NAGAOKA × 島村楽器」）が、
// 端に残ったら削除の破片
const STRAY_AT_EDGE = /^(?:[&＆+＋×-]|お|から|への|約|中|付|有|品|あり|のみ|は|に|や|高|用|対応|対応可能|メーカー|通常)$/
// 切り詰めで後ろが落ちた前置詞（「Razer BlackShark V3 Pro for」「AMD Ryzen 5 8600G BOX with」）
// 大文字の X は製品名（Xbox Series X / THETA X）なので小文字だけを見る
const DANGLING_AT_END = /^(?:for|For|to|with|With|and|x)$/

function dropStrayTokens(value: string): string {
  const tokens = value
    .replace(/(?<=\S)・(?=\s|$)/g, '')
    .replace(/(?:^|(?<=\s))・(?=\S)/g, '')
    .split(/\s+/)
    .filter((token) => token && !STRAY_ANYWHERE.test(token))
  while (tokens.length > 1 && STRAY_AT_EDGE.test(tokens[0])) tokens.shift()
  while (tokens.length > 1 && (STRAY_AT_EDGE.test(tokens[tokens.length - 1]) || DANGLING_AT_END.test(tokens[tokens.length - 1]))) tokens.pop()
  return tokens.join(' ')
}

function removeUnmatchedBrackets(value: string): string {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '（': '）', '［': '］', '〔': '〕', '＜': '＞', '≪': '≫' }
  const closers = new Set(Object.values(pairs))
  const stack: Array<{ char: string; index: number }> = []
  const chars = [...value]

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    if (pairs[char]) {
      stack.push({ char, index })
      continue
    }
    if (!closers.has(char)) continue
    const expectedOpen = Object.keys(pairs).find((open) => pairs[open] === char)
    if (stack.at(-1)?.char === expectedOpen) stack.pop()
    else chars[index] = ' '
  }

  // 閉じ忘れの括弧は、切り詰めで閉じ側が落ちた仕様表記（「スイッチングハブ［8ポート・Gig」）なので以降を捨てる。
  // ただし名前の前半で開いているなら中身が製品名そのもの（「＜ めでる シリーズ：苔テラリウム…」）なので記号だけ外す
  if (stack.length > 0) {
    if (stack[0].index < chars.length / 2) chars[stack[0].index] = ' '
    else chars.splice(stack[0].index)
  }
  return chars.join('')
}

/**
 * 語の途中で切ると「互換バッテリーパッ」「R-PNC00M-FC0B-JG」のように別の語・別の型番に見える。
 * 空白に加えて「・」「+」「/」「、」でも切り、どれも手前すぎるときだけ文字数で切る。
 */
function truncateAtBoundary(value: string, maxLength: number): string {
  const chars = [...value]
  if (chars.length <= maxLength) return value
  const head = chars.slice(0, maxLength).join('')
  if (/\s/.test(chars[maxLength])) return head
  // 記号は末尾の1文字を除いて探す。「RØDE PSA1+」の + で切ると製品名から + が落ちる
  const inner = head.slice(0, -1)
  const boundary = Math.max(
    head.lastIndexOf(' '),
    head.lastIndexOf('　'),
    ...['・', '+', '＋', '/', '／', '、'].map((separator) => inner.lastIndexOf(separator)),
  )
  return boundary >= Math.floor(maxLength * 0.4) ? head.slice(0, boundary) : head
}

const SPEC_TOKEN = /^(?:\d+(?:\.\d+)?(?:hz|khz|mhz|ghz|w|v|a|g|kg|mah|wh|kb|mb|gb|tb|nit|nits|lm|ms|fps|inch|p|h)|(?:usb|hdmi|displayport|dp|hdr|wi-?fi|bluetooth|type-c|thunderbolt|pcie|atx|class|ssd|hdd|ram|rom|ddr|lpddr|windows|android|office|ip)\d[\w.+/-]*)$/i

function isSpecificationToken(token: string): boolean {
  if (SPEC_TOKEN.test(token)) return true
  if (/^(?:fhd|qhd|wqhd|wqxga|wuxga|uhd|hd)\d+$/i.test(token)) return true
  if (/^\d{3,4}(?:fhd|qhd|wqhd|wqxga|wuxga|uhd|hd|p)$/i.test(token)) return true
  if (/^\d{3,4}x\d{3,4}(?:fhd|qhd|wqhd|wqxga|wuxga|uhd|hd)?$/i.test(token)) return true
  if (/^(?:ps\d|xbox|switch|pc|mac)(?:[/_-].*)?$/i.test(token)) return true
  if (/^i[3579]-?\d{4,}[a-z]*$/i.test(token)) return true
  if (/^\d+(?:mb|gb)\/s$/i.test(token)) return true
  return false
}

function modelScore(token: string): number {
  const digits = (token.match(/\d/g) ?? []).length
  const separators = (token.match(/[-_/]/g) ?? []).length
  return Math.min(digits, 5) + Math.min(token.length, 16) / 16 + separators * 3
}

function modelToken(value: string): string | undefined {
  const tokens = value.match(/[a-z0-9]+(?:[-_/][a-z0-9.]+)*/gi) ?? []
  return tokens
    .filter((token) => {
      if (token.length < 4 || isSpecificationToken(token)) return false
      if (!/[a-z]/i.test(token) || !/\d/.test(token)) return false
      const digitCount = (token.match(/\d/g) ?? []).length
      const letterCount = (token.match(/[a-z]/gi) ?? []).length
      return (digitCount >= 2 && letterCount >= 2) || (/[-_/]/.test(token) && letterCount >= 2)
    })
    .sort((a, b) => modelScore(b) - modelScore(a))[0]
}

/** 商品名に含まれる、仕様値ではない品番らしい英数字コードを返す。 */
export function extractProductModel(name: string): string | undefined {
  return name
    .split(/\s+/)
    .map(modelToken)
    .filter((model): model is string => model !== undefined)
    .sort((a, b) => modelScore(b) - modelScore(a))[0]
}

/** ブランドと型番を、長い商品説明より前に固定する。 */
export function prioritizeProductIdentity(name: string, brand?: string): string {
  const normalizedName = name.replace(/\s+/g, ' ').trim()
  const normalizedBrand = brand?.replace(/\s+/g, ' ').trim()
  if (!normalizedName || !normalizedBrand) return normalizedName

  const escapedBrand = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const brandPattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapedBrand}(?![\\p{L}\\p{N}])`, 'iu')
  if (!brandPattern.test(normalizedName)) return normalizedName
  const withoutBrand = normalizedName
    .replace(brandPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = withoutBrand.split(' ').filter(Boolean)
  const model = extractProductModel(withoutBrand)
  if (!model) return normalizedName
  const modelIndex = words.findIndex((word) => word.includes(model))
  if (modelIndex < 0) return normalizedName
  words[modelIndex] = words[modelIndex].replace(model, '')
  if (!words[modelIndex]) words.splice(modelIndex, 1)
  return [normalizedBrand, model, ...words].join(' ')
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f\u00a0\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu

/** 楽天由来の商品名を予測候補として表示・保存できる形へ整える。 */
export function sanitizeProductName(raw: string, maxLength?: number): string {
  const cleaned = normalizeLookalikes(decodeHtmlEntities(raw.replace(/<\/?[a-z][^>]*>/gi, ' ')))
    .replace(/[<>]/g, ' ')
    .replace(CONTROL_CHARS, ' ')
    .replace(BRACKETED, (all: string, ...groups: Array<string | undefined>) => {
      const inner = groups.slice(0, 5).find((group) => group !== undefined) ?? ''
      if (!inner.trim() || PROMO_IN_BRACKET.test(inner)) return ' '
      return /^[≪＜]/.test(all) ? ` ${inner} ` : all
    })
    .replace(new RegExp(PROMO_WORDS.source, 'gi'), ' ')
    .replace(SALES_NOTICE, ' ')
    .replace(/[【】〈〉《》★☆■◆◇●▲※→←♪＼▼◎✨⭐○◯△√│⇒⇔™®©]/gu, ' ')
    // 囲みの記号だけ外す（｢FITTIO｣ “DUX”）。数字の後ろの " はインチなので残す
    .replace(/[「」『』｢｣“”。]/g, ' ')
    .replace(/(?<!\d)"/g, ' ')
    .replace(/\s+/g, ' ')
    // 販促語が重なった表記（無料長期保証 / 配送設置無料 / 売れ筋上位 / ⭐常連）は、1回目で片方を消すと
    // 残りが単独の語になる。記号を外した後にもう一度当てる
    .replace(SALES_NOTICE, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const repaired = dropStrayTokens(repairSplitUnits(removeLooseSeparators(cleaned)).replace(/\s+/g, ' ').trim())
  const normalized = maxLength === undefined ? repaired : truncateAtBoundary(repaired, maxLength)

  return dropStrayTokens(removeUnmatchedBrackets(normalized)
    // 販促文言を抜いたあとに「！ UGREEN…」のような句読点が先頭へ残る
    .replace(/^[\s&+\-,:：;；/／|｜・！!？?、。，．\]）】〉》]+/u, '')
    // 末尾の + は区切りではなく製品名の一部（MV88+ / HDR10+ / Studio Buds+）。孤立した + は dropStrayTokens が落とす
    .replace(/[\s&＆\-–—,:：;；/／|｜・~〜～…]+$/u, '')
    .replace(/(?<=\d)\.$/u, '')
    .replace(/\s+/g, ' ')
    .trim())
}

// ─── 「ブランド + 製品名」への要約 ────────────────────────────────
// 楽天の商品名は「カテゴリ語 + 製品名 + 型番 + 仕様と用途の羅列」で、そのままでは
// 予測変換の候補として読めない。配線図に要るのは「どの機器か」だけなので、
// ブランドと製品名（型番を含む）以外を落とす。
//
// 完全な解析は無理なので、落として安全なものだけを落とす方針にしている。
// 判断が付かないトークンは残す（消し過ぎて別商品と区別できなくなる方が困る）。

/** 仕様・用途・売り文句。単独のトークンとして現れたら落とす */
const DESCRIPTIVE_TOKEN =
  /^(?:.*(?:対応|搭載|付き|付属|同梱|専用|向け|仕様|機能|設計|素材|構造|認証)|.*用|セット|正規品|純正|互換|新品|バルク|パッケージ品|本体|単品|選べる|各種)$/

/**
 * 色。製品の識別に要らない。
 * 英字の色名は入れない。GoPro の `HERO12 Black` のようにエディション名になっている
 */
const COLOR_TOKEN =
  /^(?:ブラック|ホワイト|グレー|グレイ|シルバー|ゴールド|ブルー|レッド|グリーン|ピンク|ベージュ|ネイビー|パープル|イエロー|オレンジ|ブラウン|クリア|透明|黒|白|銀|金|[ァ-ヶー]*(?:ブラック|ホワイト|グレー|シルバー|ブルー|グリーン)|全\d+色|\d+色展開|選べるカラー|くすみカラー)$/

/** 雰囲気・贈答・住まいの語。検索に当てるために並べてあるだけで、どの機器かは分からない */
const MOOD_TOKEN =
  /^(?:おしゃれ|オシャレ|おしゃ|かわいい|可愛い|カワイイ|北欧|インテリア|新生活(?:応援)?|一人暮らし|在宅(?:ワーク|勤務)?|テレワーク|子供部屋|癒し(?:グッズ)?|風水|縁起物?|開運|誕生日|\S*祝い|結婚式|記念日?|自分ご褒美|推し活|韓国|モダン|シンプル|高級|男前|(?:アジアン|ハワイアン)?雑貨|女性|男性|男女|大人)$/

/** 雰囲気語と色を落とす。全部がそれなら落とさない（「観葉植物」が無く「おしゃれ 北欧」だけの名前） */
function dropDescriptiveTokens(tokens: string[]): string[] {
  const descriptive = (token: string) => MOOD_TOKEN.test(token) || COLOR_TOKEN.test(token)
  return tokens.some((token) => !descriptive(token)) ? tokens.filter((token) => !descriptive(token)) : tokens
}

// 要約で空白に置き換える区切りのうち、値の一部になっている「/」を一時的に逃がす文字
const KEPT_SLASH = '∕'

/**
 * 数値＋単位。容量・寸法・出力など、製品名ではなく仕様。
 * 1文字の単位（A・m・g）は型番と見分けが付かないので入れない
 * （MSI の `MAG FORGE 130A AIRFLOW` の `130A` をアンペアとして落としていた）
 */
const UNIT_TOKEN =
  /^\d+(?:\.\d+)?(?:mah|wh|khz|mhz|ghz|hz|mm|cm|kg|lm|ms|fps|dpi|bit|型|インチ|鍵盤|時間|分|口|枚|個|本|台|ch|畳|人用)$/i

/** カテゴリを説明しているだけの語 */
const CATEGORY_TOKEN =
  /^(?:[ァ-ヶー]*(?:スピーカー|ヘッドセット|ヘッドホン|ヘッドフォン|イヤホン|キーボード|マウス|モニター|ディスプレイ|プロジェクター|プリンター|スキャナー|ハブ|ドック|ケーブル|アダプター|チャージャー|バッテリー|カメラ|マイク|アンプ|ミキサー|タブレット|スマートフォン|ルーター|コントローラー|ケース|カバー|フィルム|スタンド|アーム|ライト|ファン)|USBメモリ|電源タップ|充電器|変換器|液晶テレビ)$/

const KATAKANA_ONLY = /^[ァ-ヶー・]+$/

/**
 * 商品名をブランドと製品名だけに詰める。
 *
 * @param brand `products.brand`。無い場合は先頭語をブランドとみなす
 * @param maxLength 収まらないときの上限。語の切れ目で切る
 */
export function summarizeProductName(raw: string, brand?: string, maxLength = 60): string {
  const base = sanitizeProductName(raw)
    // ここまで残っている括弧の中身は仕様・用途の説明で、製品名は入っていない
    .replace(/[［【〔(（[][^］】〕)）\]]*[］】〕)）\]]/g, ' ')
    // 「/」が値の一部になっている表記は区切りとして扱わない。空白にすると
    // 「R:540MB s」「10 100 1000Mbps」「50PUH7169 11」のように意味が崩れる
    .replace(/(?<=\d)\/(?=\d)|(?<=\d[KMG][Bb])\/(?=s\b)/g, KEPT_SLASH)
    .replace(/\b11(?:ax|ac|[abgn])(?:\/(?:ax|ac|[abgn]))+\b/g, (all) => all.replace(/\//g, KEPT_SLASH))
    // 「SONY｜ソニー」のような英日併記の区切り
    .replace(/[｜|/／、,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 雰囲気語と色は位置に関係なく落とす。ノーブランド品は先頭に置くので、
  // 下の「先頭語をブランドとみなす」より前に除く
  const tokens = dropDescriptiveTokens(base.split(' ').filter(Boolean))
  if (tokens.length === 0) return sanitizeProductName(raw)

  const normalizedBrand = brand?.trim()
  const brandIndex = normalizedBrand
    ? tokens.findIndex((token) => token.toLowerCase() === normalizedBrand.toLowerCase())
    : -1
  // ブランドは名前の先頭とは限らない。楽天には「スマートスピーカー ニトリ」のように
  // 末尾へ回す書き方が多く、ブランドより前を枕詞として切ると商品名ごと消える。
  // 位置では切らず、先頭へ移すだけにする。枕詞（USBメモリ・64GB など）は
  // この後の語種の判定で落ちる
  const head = brandIndex >= 0
    ? [tokens[brandIndex], ...tokens.filter((_, index) => index !== brandIndex)]
    : tokens
  const brandToken = head[0]

  // カテゴリ語はいったん全部よけておく。「SONY ブルートゥーススピーカー ULT FIELD1」の
  // 真ん中は要らないが、型番も英字の製品名も無い商品では唯一の手がかりになるため、
  // 最初の1語だけ後で戻せるように覚えておく
  let categoryToken: string | null = null
  const kept = head.slice(1).filter((token) => {
    if (DESCRIPTIVE_TOKEN.test(token)) return false
    if (COLOR_TOKEN.test(token)) return false
    if (UNIT_TOKEN.test(token)) return false
    if (CATEGORY_TOKEN.test(token)) {
      categoryToken ??= token
      return false
    }
    // ブランドの片仮名読み（SONY ソニー / MSI エムエスアイ）。製品名がすべて片仮名の
    // 商品もあるので、英数字の語が他に残っている場合だけ落とす
    if (KATAKANA_ONLY.test(token) && head.some((other) => /[a-z0-9]/i.test(other) && other !== brandToken)) return false
    return true
  })

  // 同じ語の繰り返し（「Meta メタ … Meta Quest 3」「SmallRig … SmallRig SR5887」）
  const seen = new Set<string>([brandToken.toLowerCase()])
  const unique = kept.filter((token) => {
    const key = token.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 型番（英字と数字が混じる語）は製品を特定する唯一の手がかりになる
  const isModelLike = (token: string) => /[a-z]/i.test(token) && /\d/.test(token) && token.length >= 3

  // 型番も英字の製品名も残らなかった商品（「Cisco ウェブカメラ …」）は、よけておいた
  // カテゴリ語を戻す。これが無いと「Cisco マイク内蔵 広角81°」になって機器が分からない
  const identified = unique.some((token) => isModelLike(token) || /[a-z]{3,}/i.test(token))
  const named = !identified && categoryToken ? [categoryToken, ...unique] : unique

  // 全部落ちてブランド名だけになる商品（「静電気防止バンド TK-SE11 サンワサプライ」等）は、
  // 語種の判定が商品名そのものを巻き込んでいる。何も残らないなら落とさない
  const survived = named.length > 0
    ? named
    : head.slice(1).filter((token) => token.toLowerCase() !== brandToken.toLowerCase())

  // 製品名はブランド＋2〜6語で足りる。Fire TV Stick 4K Plus のように、5語目以降も
  // 世代・派生モデルを区別する名前があるため、4語で切ると別製品と同名になる。
  // 尻尾に残る売り文句や用途の説明はここで落ちる。
  // ブランドを名前の中に見つけられていないときは、先頭がブランドである保証が無い。
  // その状態で語数を切ると、日本語だけの商品名を途中で落とすだけになる
  let budget = 6
  const trimmed = brandIndex < 0 ? survived : survived.filter((token) => {
    // 型番と、上で残した1語のカテゴリ語は製品の識別そのものなので語数に数えない
    if (isModelLike(token) || token === categoryToken) return true
    if (budget <= 0) return false
    budget -= 1
    return true
  })

  const summarized = [brandToken, ...trimmed].join(' ').replaceAll(KEPT_SLASH, '/').trim()
  if (!summarized) return sanitizeProductName(raw)
  return sanitizeProductName(summarized, maxLength)
}

export type ProductIdentity = {
  brand?: string
  productName: string
  displayName: string
}

const compactIdentity = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function stripCompactPrefix(value: string, prefix: string): string {
  const wanted = [...compactIdentity(prefix)]
  if (wanted.length === 0 || !compactIdentity(value).startsWith(wanted.join(''))) return value
  let matched = 0
  const chars = [...value]
  let end = 0
  for (; end < chars.length && matched < wanted.length; end += 1) {
    const normalized = compactIdentity(chars[end])
    if (!normalized) continue
    if (normalized !== wanted[matched]) return value
    matched += 1
  }
  return chars.slice(end).join('').replace(/^[\s&+\-–—,:：;；/／|｜・.．]+/u, '').trim()
}

function containsBrandToken(value: string, brand: string): boolean {
  const normalizedValue = value.normalize('NFKC')
  const normalizedBrand = brand.normalize('NFKC')
  const escapedBrand = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapedBrand}(?![\\p{L}\\p{N}])`, 'iu').test(normalizedValue)
}

/**
 * ブランドの表記ゆれ。辞書の aliases は製品シリーズ名（Galaxy / ThinkPad / Wii）も兼ねていて、
 * それを製品名から落とすと「Samsung S26+」になる。英字の別名は、ブランド名と綴りの頭が
 * 同じもの（Logicool / SANWA / IODATA）だけを表記ゆれとして使う。
 */
function brandSpellings(brand: string): string[] {
  const key = brandKey(brand)
  const entry = key ? brandEntry(key) : undefined
  const en = entry ? compactBrand(entry.en) : compactBrand(brand)
  const aliases = key ? brandAliases(key) : []
  const sameStem = (alias: string) => {
    const compact = compactBrand(alias)
    return compact.startsWith(en.slice(0, 4)) || en.startsWith(compact.slice(0, 4))
  }
  return [...new Set([brand, ...aliases.filter((alias) => !/[A-Za-z]/.test(alias) || sameStem(alias))])]
    .map(compactBrand)
    .filter(Boolean)
}

/**
 * 製品名に残ったブランドの2度目の表記を落とす（「エレコム 有線 ELECOM」「Brother ブラザー工業 TN-291BK」
 * 「AMD エーエムディーRyzen 7」）。ブランドは表示名の頭で1度出すので、2度目は読む邪魔になる。
 */
function stripBrandMentions(productName: string, brand: string): string {
  const spellings = brandSpellings(brand)
  const kanaSpellings = spellings.filter((spelling) => !/[a-z0-9]/.test(spelling))
  const isSpelling = (token: string) =>
    spellings.includes(compactBrand(token.replace(/(?:工業|電機|株式会社)$/u, '')))
  const words = productName.split(/\s+/).filter(Boolean)
  const tokens: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    // 2語のブランド名（SANWA SUPPLY）
    if (index + 1 < words.length && spellings.includes(compactBrand(`${words[index]}${words[index + 1]}`))) {
      index += 1
      continue
    }
    const token = words[index]
    if (isSpelling(token)) continue
    // 読み仮名が次の語に貼り付いている（エムエスアイMAG / バッファロー有線テンキーボード）。
    // 辞書にある読みだけを外す。片仮名一般で外すと「ファイティングコマンダーOCTA」まで削れる
    const head = kanaSpellings.find((kana) => token.startsWith(kana) && [...token.slice(kana.length)].length >= 2)
    const tail = kanaSpellings.find((kana) => token.endsWith(kana) && [...token.slice(0, -kana.length)].length >= 2)
    tokens.push(head ? token.slice(head.length) : tail ? token.slice(0, -tail.length) : token)
  }
  return tokens.length > 0 ? tokens.join(' ') : productName
}

/**
 * 保存済みの製品名から落ちた末尾の + を、元タイトルを見て戻す。
 * 以前の整形は + を区切りとして末尾から削っていて、product_name に「MV88」「HDR10」のまま残っている。
 */
function restoreTrailingPlus(productName: string, rawName: string): string {
  return productName.replace(/(?<![\w+])([A-Za-z0-9]+)(?=\s|$)/g, (token: string) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\w+])${escaped}\\+(?![\\w+])`).test(rawName) && !new RegExp(`(?<![\\w+])${escaped}(?![\\w+])`).test(rawName)
      ? `${token}+`
      : token
  })
}

/**
 * 保存済みの製品名から、当時の brand として剥がされた頭の語を戻す。
 * brand 列が「USB-A」「Type-C」だった行は「USB-A to USB-C 充電ケーブル」が「to USB-C …」の形で
 * 保存され、その後 brand だけが空へ直されている。元タイトルの2語目から始まっていれば、1語目を戻す。
 */
function restoreStrippedHead(productName: string, rawName: string): string {
  const raw = sanitizeProductName(rawName).split(' ')
  const stored = productName.split(' ')
  if (raw.length < 2 || stored.length === 0) return productName
  if (stored[0] !== raw[1] || stored.includes(raw[0])) return productName
  return [raw[0], ...stored].join(' ')
}

/** 元の出品タイトルから、画面に出す「ブランド」と「製品名」だけを返す。 */
export function productIdentity(
  rawName: string,
  brand?: string | null,
  storedProductName?: string | null,
  trustBrand = false,
): ProductIdentity {
  const cleanBrand = brand ? sanitizeProductName(brand).trim() : ''
  // 外部データの brand が商品名に存在しない場合は誤検出として表示しない。
  // 手書きプリセットはブランドを検証済みなので、製品ファミリ名だけの名前でも表示する。
  const visibleBrand = cleanBrand && (trustBrand || containsBrandToken(`${rawName} ${storedProductName ?? ''}`, cleanBrand))
    ? cleanBrand
    : ''
  const sanitizedStored = storedProductName?.trim() ? sanitizeProductName(storedProductName, 60) : ''
  // 頭の語を戻してから雰囲気語を落とす。逆だと戻した語が「おしゃれ」でも残る
  const withHead = sanitizedStored && !visibleBrand ? restoreStrippedHead(sanitizedStored, rawName) : sanitizedStored
  const summarized = withHead
    ? restoreTrailingPlus(dropDescriptiveTokens(withHead.split(' ')).join(' '), rawName)
    : summarizeProductName(rawName, visibleBrand || undefined, 60)
  const withoutBrand = visibleBrand
    ? stripBrandMentions(stripCompactPrefix(summarized, visibleBrand), visibleBrand)
    : summarized
  const productName = withoutBrand || sanitizeProductName(rawName, 60)
  const productAlreadyShowsBrand = visibleBrand
    && compactIdentity(productName).includes(compactIdentity(visibleBrand))
  return {
    brand: visibleBrand || undefined,
    productName,
    displayName: productAlreadyShowsBrand
      ? productName
      : [visibleBrand, productName].filter(Boolean).join(' '),
  }
}
