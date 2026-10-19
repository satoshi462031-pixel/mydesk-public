import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "../outputs/ipad-desk-research-100";
const researchedAt = new Date(2026, 7, 30);

const cases = [
  [1,"【デスクツアー】iPadマニアによる“iPad偏愛”デスクツアー","YouTube","主役","総合・仕事","不明","スタンド/マウント","不明","日本語・デスクツアー","iPadを中心に小物と配置を統一する事例","C","https://www.youtube.com/watch?v=3dd96A8LmtA"],
  [2,"【2024年版】iPadの魅力を活かしたデスクセットアップ","YouTube","主役","総合・仕事","不明","不明","不明","日本語・ミニマル","タブレットらしい可動性を残す構成","C","https://www.youtube.com/watch?v=hq7HGJBpmjw"],
  [3,"iPadで創作する超ミニマルなシンプルデスク環境","YouTube","主役","イラスト・創作","なし/不明","傾斜配置","Apple Pencil中心","超ミニマル","入力面を広く空ける創作机","C","https://www.youtube.com/watch?v=ujI_2lDjf7U"],
  [4,"iPad中心デスク環境についてめっちゃ喋る動画","YouTube","主役","総合・仕事","不明","不明","不明","省スペース・クローゼット","狭い場所でもiPadを主役にできる","C","https://www.youtube.com/watch?v=AHeRfJuUmBY"],
  [5,"iPadで学ぶUSCPA経理マンのデスク環境2025","YouTube","主役","学習","不明","不明","キーボード/ペン","学習特化","資格学習の閲覧・筆記を一台に集約","C","https://www.youtube.com/watch?v=ZAzC1cnxay8"],
  [6,"最小iPad miniデスク環境（2024）","YouTube","主役","軽作業・携帯","なし/不明","小型スタンド","小型キーボード想定","最小・EDC","iPad miniで設置面積を削る","C","https://www.youtube.com/watch?v=-NYLONh6JC0"],
  [7,"How To Build an iPad Desk Setup That Actually Works (2026)","YouTube","主役","総合・仕事","あり","磁気ケース/スタンド","Magic Keyboard/Mouse/Trackpad","外部モニター・充実装備","iPad・モニター・Dockを一体で設計","A","https://www.youtube.com/watch?v=QMROCQTb9sw"],
  [8,"The Guide to Building an iPad Desk Setup","YouTube","主役","総合・仕事","あり","磁気/汎用スタンド","MX Keys系/MX Master系","デスクトップ代替","USB-Cモニターと周辺機器を一本化","A","https://www.youtube.com/watch?v=1Nu3HZXp954"],
  [9,"Building 2026 Apple Fanboy Desk Setup with KUXIU","YouTube","主役","総合・仕事","不明","KUXIU系マウント","不明","Apple統一","充電機能付き磁気マウントを核にする","C","https://www.youtube.com/watch?v=93P6oC0NDZ8"],
  [10,"iPad Proをデスクトップパソコンとして使う検証","YouTube","主役","総合・仕事","あり","不明","キーボード/ポインター","PC代替検証","外部画面運用の限界も含めて判断","C","https://www.youtube.com/watch?v=QMk4fLQ-WA4"],
  [11,"iPadだけでデスク環境を構築","YouTube","主役","総合・仕事","あり/不明","不明","キーボード/ポインター","iPad only","PCを置かない構成の実用例","C","https://www.youtube.com/watch?v=6BJ4smLEykE"],
  [12,"AI時代にMacではなくiPadを選ぶデスク","YouTube","主役","総合・仕事","不明","不明","不明","iPad first","作業端末をiPadへ寄せる判断軸","C","https://www.youtube.com/watch?v=3pPYRFqlsjg"],
  [13,"M1 iPad Proと作る作業効率重視のデスク","YouTube","主役","総合・仕事","不明","不明","不明","日本語・効率重視","旧世代iPad Proでも成立する構成","C","https://www.youtube.com/watch?v=5_qOvHhjB94"],
  [14,"My Cozy iPad Artist Desk Setup for 2025","YouTube","主役","イラスト・創作","なし/不明","描画向け傾斜","Apple Pencil","コージー・作家机","制作道具と撮影機材を同居させる","C","https://www.youtube.com/watch?v=0xJwGXR8LBM"],
  [15,"Using an iPad in a Desk Setup - Guide 2022","YouTube","補助/併用","総合・仕事","不明","不明","不明","ガイド","iPadの役割を用途別に切り替える","C","https://www.youtube.com/watch?v=Ayxyd-Ukql4"],
  [16,"I Finally Built the Perfect iPad Pro Desk Setup","YouTube","主役","総合・仕事","あり/不明","不明","キーボード/ポインター","完成形紹介","周辺機器を後付けでなく一式設計","C","https://www.youtube.com/watch?v=KAwJvSpe9HQ"],
  [17,"My iPad desk setup","YouTube","主役","総合・仕事","あり","専用スタンド","キーボード/マウス","単独PC化","iPad単独でのデスクトップ運用を検証","A","https://www.youtube.com/watch?v=CMoPEW2tzio"],
  [18,"My Updated Desk Setup featuring my iPad Pro","YouTube","主役","総合・仕事","あり/不明","不明","キーボード/ポインター","更新版","運用後の改善点を反映する","B","https://www.youtube.com/watch?v=IQFXUq5H6Qo"],
  [19,"How to Connect Your iPad to an External Monitor (iPadOS 26)","YouTube","主役","総合・仕事","あり","USB-C Hub","Logitech MX Keys/MX Master","外部モニター実践","16:9とウルトラワイドを比較する","A","https://www.youtube.com/watch?v=eNxrl7DTwts"],
  [20,"How I Connect My iPad to the Monitor & Desk Accessories","YouTube","主役","総合・仕事","あり","スタンド/充電台","キーボード/マウス","アクセサリー統合","接続と充電をデスク側に常設する","A","https://www.youtube.com/watch?v=B9ikKspqH4k"],
  [21,"9 Essential Items for an iPad-only Desk Setup","YouTube","主役","総合・仕事","あり","KUXIU X36系","Keychron K2 Max/マウス","フル装備","机・椅子・Dockまで含めて構成する","A","https://www.youtube.com/watch?v=w41IxdsLQOA"],
  [22,"iPad desk setup（PC/Macなしのゲーム机）","Reddit","主役","ゲーム・メディア","あり","磁気VESAマウント","3ボタンマウス","ミニマル・ゲーム","HDMI切替器でXbox/Apple TVも共用","A","https://www.reddit.com/r/ipad/comments/1mce0b9/ipad_desk_setup/"],
  [23,"Desk Setup：M4 13-inch iPad Pro","Reddit","主役","イラスト・創作","なし/不明","卓上スタンド","外付けキーボード/マウス","シンプル","Magic KeyboardとPencilを机上で使い分ける","A","https://www.reddit.com/r/iPadPro/comments/1d8di23"],
  [24,"Setting up desk：パートナーとの共同デスク","Reddit","補助/併用","会議・情報表示","あり","KUXIU磁気充電アーム","共有キーボード想定","木質・デュアルモニター","iPadを低い第三画面として置く","A","https://www.reddit.com/r/desksetup/comments/1n6kb24"],
  [25,"iPad setup with external display","Reddit","主役","仕事・ゲーム","あり","USB-C Hub接続","キーボード/マウス想定","ミニマル","私物PCなしの代替機として外部画面化","A","https://www.reddit.com/r/ipad/comments/1lnzcwa/ipad_setup_with_external_display/"],
  [26,"Trying out a new iPad Desk Setup for my work office","Reddit","主役","仕事","あり","スタンド","Logitech POP Keys","オフィス・実験的","iPadOS外部画面運用の実課題が分かる","A","https://www.reddit.com/r/ipad/comments/wwj8si"],
  [27,"Full desk reset with the iPad Pro","Reddit","主役","総合・仕事","あり","Dock接続","Magic Keyboard系","iPad only","iPad Proを唯一のコンピューターにする","A","https://www.reddit.com/r/iPadPro/comments/1tl3j9x/full_desk_reset_with_the_ipad_pro/"],
  [28,"iPad Air M2 Casual Desk Setup","Reddit","主役","軽作業・メディア","あり","9-in-1 Hub Stand","Inateckキーボード/トラックパッド","予算重視","QHD 27インチで軽作業に絞る","A","https://www.reddit.com/r/desksetup/comments/1ryx0fa/ipad_air_m2_casual_desk_setup_need_your_opinions/"],
  [29,"Got my first ever iPad as an SDE","Reddit","補助/併用","学習・メディア","あり","Logitech Combo Touch","キーボードケース","開発者の補助画面","学習と余暇用の第二画面に限定する","A","https://www.reddit.com/r/ipad/comments/170aza6"],
  [30,"Share your non-standard iPad setups","Reddit","補助/併用","情報表示・携帯","あり","折り畳みスタンド","分離式Bluetoothキーボード","超軽量・着脱重視","固定ケースを避けて即持ち出せる","A","https://www.reddit.com/r/ipad/comments/1pe11vj/share_your_nonstandard_ipad_setups/"],
  [31,"MacBook Pro + iPad Pro Desk Setup / Sidecar","Reddit","補助/併用","制作・補助画面","あり","クリップ/横置き","Macの入力機器共有","ハイブリッド","有線Sidecarで遅延を抑える","A","https://www.reddit.com/r/ipad/comments/1566m9i"],
  [32,"Digging this：Apple中心のバトルステーション","Reddit","補助/併用","イラスト・SNS","あり","キーボード脇配置","共有入力想定","Apple統一","iPadを描画/SNS専用面にする","A","https://www.reddit.com/r/battlestations/comments/10xjl24"],
  [33,"Please share your iPad desk setups","Reddit","主役","Remote Desktop","あり","ポータブルモニター併用","キーボード/マウス","iPad only候補","リモート接続中心ならOS制約を回避できる","B","https://www.reddit.com/r/iPadPro/comments/16binl9"],
  [34,"Why an iPad Desk Setup?","Reddit","主役","個人作業","あり/不明","不明","キーボード/ポインター","仕事PCと分離","平日は会社PC、私用はiPadへ役割分離","A","https://www.reddit.com/r/iPadPro/comments/1mxxvo5"],
  [35,"What would you do to improve this setup?","Reddit","補助/併用","情報表示","あり","角度調整スタンド","共有入力想定","マルチ画面","iPadの角度と隣接画面の位置を揃える","B","https://www.reddit.com/r/setups/comments/1j71v7j"],
  [36,"How I turned my iPad into my primary gaming device","Reddit","主役","ゲーム","あり/不明","卓上配置","ゲームパッド","ゲーミング","Moonlight等のストリーミング端末化","A","https://www.reddit.com/r/IndianGaming/comments/1lnkqrc"],
  [37,"Everything I Need, Right at Standing Desk","Reddit","補助/併用","仕事・ゲーム","あり","スタンド","フルキーボード","幅広・昇降デスク","横幅を確保しiPadを追加画面にする","B","https://www.reddit.com/r/9amStandingDesks/comments/1v19k3x/everything_i_need_right_at_standing_desk/"],
  [38,"A busy 45 days","Reddit","補助/併用","総合・仕事","あり","iPadスタンド","共有入力想定","照明・ウォールアート","iPadスタンドをデスク意匠に馴染ませる","B","https://www.reddit.com/r/macsetups/comments/1vxfxau/a_busy_45_days/"],
  [39,"iPad Desk Setup/Arrangement","MacRumors Forum","主役","総合・仕事","あり/不明","複数事例","複数事例","ユーザー投稿集","iPad-only構成の実例を横断比較できる","A","https://forums.macrumors.com/threads/ipad-desk-setup-arrangment.2372391/"],
  [40,"Your iPad Workstation Desk Setup","MacRumors Forum","主役","総合・仕事","あり","複数事例","キーボード/マウス","ユーザー投稿集","長期スレッドで機器選択の変遷が見える","A","https://forums.macrumors.com/threads/your-ipad-workstation-desk-setup.2160703/"],
  [41,"iPad Productivity Setup: Distraction-Free Work Mode","Paperlike","主役","集中作業・筆記","なし/不明","卓上スタンド","キーボード/Apple Pencil","集中・ミニマル","娯楽アプリと作業画面をFocusで分離","A","https://paperlike.com/blogs/paperlikers-insights/how-to-set-up-your-ipad-as-a-focused-workstation"],
  [42,"Everything you need to create the ultimate iPad Pro desk setup","9to5Mac","主役","総合・仕事","あり","BENKS/Compass系","Magic Keyboard/Trackpad","外部モニター・Apple統一","スタンド→入力→Hub→画面の順で設計","A","https://9to5mac.com/2024/05/09/ultimate-ipad-pro-desk-setup/"],
  [43,"iPad Stands, Cases, and Desk Setup Guide","iPadHelper","主役","総合・仕事","あり/不明","VESA/各種スタンド","各種キーボードケース","比較ガイド","着脱頻度でスタンド方式を選ぶ","A","https://ipadhelper.com/blog/stands-cases-desk-setups/"],
  [44,"How to Turn Your iPad Into a Full Work Station","AppMaus","主役","総合・仕事","あり","スタンド/Dock","キーボード/トラックパッド","デスクトップ代替","Pencil利用と外部画面を両立する","A","https://appmaus.com/post/how-to-turn-your-ipad-into-a-full-work-station"],
  [45,"How to Build an iPad Desk Setup That Actually Works in 2026","Geeky Gadgets","主役","総合・仕事","あり","Dock/スタンド","Magic Keyboard/Trackpad","実用性重視","Thunderbolt Dockで配線を集約","A","https://www.geeky-gadgets.com/?p=490546"],
  [46,"How I built my desk setup entirely around iPad","9to5Mac","主役","総合・仕事","あり","MagFlott/磁気スタンド","キーボード/ポインター","昇降・木質・ミニマル","iPadOS 16.2以降の拡張画面を中核にする","A","https://9to5mac.com/2023/01/21/how-i-built-my-desk-setup-entirely-around-using-ipad-as-a-computer/"],
  [47,"Desk tours: Wesley Hilliard's iPad-centric workflows","AppleInsider","主役","編集・仕事","あり","複数iPad配置","キーボード/ポインター","プロ編集環境","iPad Proとminiに役割を分担する","A","https://appleinsider.com/articles/26/01/01/desk-tours-wesley-hilliards-ipad-centric-workflows-fully-replace-the-mac-mini"],
  [48,"iPad Workstation Turns the Tablet Into the Center of the Desk","AppleMagazine","主役","総合・仕事","あり","卓上スタンド","外付けキーボード/トラックパッド","ワークステーション","Stage Manager前提で机上操作をPC化","A","https://applemagazine.com/02j-ipad-workstation/amp/"],
  [49,"5 Ways I Use My iPad at My Desk","Tech With Dom","補助/併用","調査・視聴・筆記","あり","モニタースタンド内蔵置き場","Apple Pencil","多用途サブ端末","資料・動画・調査をメイン画面から分離","A","https://techwithdom.com/blog/5-ways-i-use-my-ipad-at-my-desk/"],
  [50,"6 Minimal iPad Desk Setup Ideas","Gridfiti","主役","総合・仕事","なし/不明","複数スタイル","複数スタイル","ミニマル事例集","色・素材・余白の参考に向く","A","https://gridfiti.com/ipad-desk-setup-ideas/"],
  [51,"This dock turns an iPad into the desktop I've always wanted","Tom's Guide","主役","総合・仕事","あり","Kensington StudioDock","外付け入力","Apple統一・充電集約","iPhone/AirPods/Watch充電も一台に集約","A","https://www.tomsguide.com/computing/tablets/this-dock-turns-an-ipad-into-the-desktop-ive-always-wanted-and-its-the-best-for-an-apple-ecosystem-setup"],
  [52,"Grovemade Standing Desk with iPad Pro Dock","TechRadar","補助/併用","総合・仕事","あり","Kensington Dock","Keychron/Trackpad","木質・デュアルモニター","Dockをデスク素材と揃える","A","https://www.techradar.com/pro/grovemade-standing-desk-review"],
  [53,"Mac and iPad as teammates instead of rivals","TechRadar","補助/併用","制作・仕事","あり","横並び","Universal Control","ハイブリッド","SidecarとUniversal Controlを用途で使い分ける","A","https://www.techradar.com/tablets/got-a-mac-and-an-ipad-heres-how-i-get-them-to-work-together-as-teammates-instead-of-rivals"],
  [54,"Modern iPad Pro Home Office Setup","Pinterest","主役","総合・仕事","あり","キーボードスタンド","キーボード/マウス","ダーク・暖色照明","大画面下にiPadを置き視線を集約","B","https://www.pinterest.com/pin/ipad-pro-home-office-desk-setup--108649409751660303/"],
  [55,"文字創作新工具：iPad Pro + Pencil + Magic Keyboard","Medium","主役","文章・創作","あり/不明","Magic Keyboard","Magic Keyboard/マウス/Pencil","木質・キャンドル","文章と手書きを同じ位置で切り替える","B","https://medium.com/@ynk.huei/%E6%96%87%E5%AD%97%E5%89%B5%E4%BD%9C%E6%96%B0%E5%B7%A5%E5%85%B7-ipad-pro-apple-pencil-%E5%B7%A7%E6%8E%A7%E9%8D%B5%E7%9B%A4-854b1570db6a"],
  [56,"2024年漫画家のシンプルデスク環境","note","主役","漫画・イラスト","あり","描画台/スタンド","Apple Pencil/メカニカルKB","木質・制作特化","iPad Proと液晶ペンタブを使い分ける","A","https://note.com/furuichikei/n/nd2e8a65269f7"],
  [57,"Apple iPad Pro 2024 Desk Setup","Skroutz","主役","総合・仕事","あり","卓上スタンド","ワイヤレスキーボード","曲面モニター・ピンク照明","iPadを大画面直下の操作面に置く","B","https://www.skroutz.mt/s/53265256/Apple-iPad-Pro-2024-13Inches-8GB-512GB-Space-Black.html"],
  [58,"Remote Game Artist Workstation","Game Art Resource","主役","ゲームアート","なし/不明","キーボードケース","キーボード/Pencil想定","ピンク/ブルー照明","創作机にアナログノートも残す","B","https://gameartresource.com/blog/remote-game-artist-the-ingredients-to-deliver-grow-and-have-a-healthy-work-life-balance"],
  [59,"iPad Pro setup by @mrvahn","Pinterest","主役","軽作業・創作","なし","アルミスタンド","小型キーボード/Pencil","明色・ミニマル","単葉植物と素材感で無機質さを和らげる","B","https://www.pinterest.com/pin/377739487494723890/"],
  [60,"iPad Pro 12.9 Workspace Setup","Medium","主役","総合・創作","なし","Folioスタンド","キーボード/マウス/Pencil","木質・植物","アナログノートを隣接させる","B","https://medium.com/@casenixx_81838/how-much-does-an-ipad-pro-12-9-cost-in-2024-b8cf8ac32f09"],
  [61,"M4 iPad Pro on a Creative Desk","Talking Tech and Audio","補助/併用","写真・音声・制作","あり","Magic Keyboard","Pencil/マウス","クリエイター机","外部画面とオーディオ機器をiPadへ接続","A","https://talkingtechandaudio.com/blog/m4-ipad-pro-in-2025-worth-it/"],
  [62,"Apple iPad Pro on Desk","Pinterest","主役","総合・メディア","なし/不明","キーボードケース","マウス/Pencil","ダーク・シンプル","タブレット単体で完結する配置","B","https://in.pinterest.com/pin/apple-ipad-pro-on-desk--2040762326780030/"],
  [63,"iPad para diseño, dibujo o ilustración","iProX","主役","イラスト・デザイン","なし","描画スタンド","Apple Pencil/小型KB","自然光・画材混在","スケッチブックとiPadを同じ作業域に置く","B","https://www.iprox.mx/post/ipad-para-dise%C3%B1o-dibujo-o-ilustracion-mantenimiento-clave-para-un-rendimiento-profesional"],
  [64,"iPad mini・Mac miniのミニデスク環境","note","主役/表示端末","軽作業・携帯","なし","UGREEN/Majextand M","NuPhy Air60/M575S","小型・木質","iPad miniをMac miniの主表示にする","A","https://note.com/kakinoke/n/n1ec5e88ec493"],
  [65,"軽量なiPad miniの作業環境","個人ブログ","主役","文章・携帯","なし","Majextand M","Mobo Keyboard 2/Pencil","超軽量","総重量731gで持ち出し前提にする","A","https://www.free-denshi.life/entry/2024/11/05/205605"],
  [66,"今日のデスク：iPad mini常設","note","補助/併用","情報表示・仕事","あり","縦置きスタンド","分割キーボード/Trackpad","ダーク・紫照明","iPad miniを縦の常時表示面にする","B","https://note.com/emulog/n/n804bdec84e2f"],
  [67,"Perfect iPad mini laptop for planes","Laptop Mag","主役","文章・旅行","なし","航空機用マウント","Keys-To-Go/マウス/Pencil","超小型・旅行","画面とキーボードを分離して狭所対応","A","https://www.laptopmag.com/tablets/i-built-my-perfect-ipad-mini-laptop-for-planes-its-a-game-changer-for-travel"],
  [68,"アームで浮かせればタブレットはデスクのレギュラーになる","note","補助/併用","描画・動画・タスク","あり","クランプアーム","Trackball/Pencil","浮遊・省スペース","接地面をなくし手元スペースを守る","A","https://note.com/sasimitu/n/nc035f2435314"],
  [69,"情報発信歴15年のiPad mini活用術","Substack","主役","文章・情報発信","なし/不明","Folio/折り畳みスタンド","外付けキーボード/Trackpad","コンパクト","持ち運びアクセサリーを最小化","B","https://ipadworkers.substack.com/p/iwpodcast-99"],
  [70,"Dual-Monitor Desk Setup with iPad Pro","Tistory","主役","総合・仕事","あり","自作磁気モニターアーム","キーボード/マウス","DIY・浮遊","既存モニターアームを磁気台座へ転用","A","https://chunchu.tistory.com/1968"],
  [71,"iPad miniをデスクで使う：MagSafe化","note","補助/併用","情報表示・メディア","あり","MagSafeマウント","Universal Control","木質シェルフ・浮遊","Sidecar用小画面をシェルフに固定","A","https://note.com/machi11/n/nb0a536f060ab"],
  [72,"iPad mini as a productivity device","Cocoadelica","主役","仕事","あり","卓上スタンド","Magic Keyboard/Mouse","白・ミニマル","小型本体でも外部画面で仕事面積を確保","A","https://www.cocoadelica.co.uk/blog/m9f37xq57u4jyo5wwf08l4gsywm7pw"],
  [73,"こだわらないデスクツアー vol.13","note","補助/併用","動画・情報表示","あり","BoYataスタンド","メカニカルKB","白・植物","iPad miniを動画専用面にする","B","https://note.com/piyopiyo1019/n/n0313b2a6744d"],
  [74,"iPad Pro for Everything","MacStories","主役","編集・配信・仕事","あり","モニター直下","CalDigit Dock/ゲームパッド","プロ制作・配信","Dockに音声I/Oとカメラまで集約する","A","https://www.macstories.net/stories/ipad-pro-for-everything/"],
  [75,"A Complete iPad Pro Productivity Solution","Medium","主役","文章・ベクター・動画","あり","調整式スタンド","キーボード/Trackpad","自然光・機能重視","長時間作業は目線高さを優先する","A","https://medium.com/macoclock/my-2-100-ipad-pro-content-creation-package-9cb8546e7f41"],
  [76,"Beyond the Tablet: Seven Years of iPad as Main Computer","MacStories","主役","文章・制作","あり","Magic Keyboard","Magic Keyboard/Pencil","長期運用","外部画面の制約を理解してアプリを選ぶ","A","https://www.macstories.net/stories/beyond-the-tablet/12/"],
  [77,"iPadOS 16 Dual-Monitor iPad Pro Workspace","Tistory","主役","Photoshop・仕事","あり","アルミスタンド/アーム","Apple Keyboard/Mouse/Trackpad","白・デュアル画面","Stage Managerでミラーから拡張へ切替","A","https://chunchu.tistory.com/1763"],
  [78,"EXTERNAL DISPLAY is back!","個人ブログ","主役","文章・調査","あり","卓上スタンド","メカニカルKB/Magic Mouse","生活感・温かい","旧型Samsung画面を再利用する","A","https://www.cultivatingmentalsilence.com/blog/0w7fsldtd3dk8irorgksq25yffyuhx"],
  [79,"Affinity Publisher for iPad home office","個人ブログ","主役","DTP・編集","あり","Magic Keyboard","キーボード/Trackpad","植物・木質","外部画面に誌面、iPadに操作を分担","A","https://beardyguycreative.com/blog/2023/03/26/affinity-publisher-mini-review-follow-up/"],
  [80,"iPad as a laptop replacement：desktop setup","MacRumors Forum","主役","総合・仕事","あり","卓上スタンド","Magic Keyboard/Trackpad","生活感・木質","外部画面と入力機器でPC形態へ寄せる","B","https://forums.macrumors.com/threads/ipad-as-a-laptop-replacement.1937134/page-226"],
  [81,"Six weeks doing all my work on iPads","MobileSyrup","主役","執筆・仕事","あり","Folio/スタンド","Magic Keyboard","木質・実用","6週間の実運用で可否を評価","A","https://mobilesyrup.com/2024/07/28/i-spent-six-weeks-doing-all-my-work-on-ipads-heres-how-it-went/"],
  [82,"iPadをパソコン並みに活用するための手段","Mac Fan Portal","主役","総合・仕事","あり","卓上配置","小型キーボード","白・ミニマル","USB-C Hubで5K画面へ接続する","A","https://macfan.book.mynavi.jp/article/m102417/"],
  [83,"iPadだけでブログ運営：3年間の作業環境","個人ブログ","主役","ブログ・画像編集","あり","卓上スタンド","HHKB/Trackpad/Pencil","実務・長期運用","文章から画像作成までiPadで完結","A","https://www.motorcamera.jp/entry/ipad-air-blog-setup"],
  [84,"Technological Journey: iPad Pro external display","個人ブログ","主役","文章・仕事","あり","Magic Keyboard/卓上","マウス","再利用・実験","古いHDMIモニターでも実用化できる","A","https://www.cultivatingmentalsilence.com/blog/3aoasjow7wkubmzlltj13sclurmy21"],
  [85,"Can iPad Pro replace a computer?","Arnondora","主役","ブログ・サーバー管理","あり/不明","Magic Keyboard","Magic Keyboard/Pencil","携帯ワークステーション","HubでHDMI/Ethernetを追加する","A","https://arnondora.in.th/can-ipad-pro-replace-computer/"],
  [86,"Minimalist Tablet Stand Setup","Naver Blog","主役","軽作業・メディア","なし","アルミ調整スタンド","不明","白・植物・キャンドル","スタンドの素材と机色を統一する","B","https://blog.naver.com/bk32167/223632861743"],
  [87,"This is my iPad desk setup：college","Medium","主役","学習・文章","あり","Magic Keyboard","Magic Keyboard/Pencil","学生・低予算","周辺機器を50ドル未満中心で構成","A","https://medium.com/@adikakarla/this-is-my-ipad-desk-setup-457ad920c4ba"],
  [88,"iPadOS 26 Desk Setup for Students & Creators","iPhone Wired","主役","学習・創作","あり","Smart Folio","Smart Folio Keyboard/Pencil","学生・クリエイター","新しいウィンドウ管理を中心にする","A","https://iphonewired.com/firmware-update/1115749/"],
  [89,"iPad Study Desk Setup for College","Lemon8","主役","学習","なし/不明","キーボードケース","Trackpad/Pencil","明色・学習机","Goodnotes/Notion等の学習導線を固定","A","https://www.lemon8-app.com/discover/ipad%20study%20desk%20setup?region=us"],
  [90,"2022 Focused iPad Desk with iPadOS 16","Curtis McHale","主役","仕事・サムネ制作","あり","専用モニターアーム","キーボード/マウス/Pencil","DIY・固定席","iPad用画面を常設し机面を動かさない","A","https://curtismchale.ca/2022/09/21/2022-focused-ipad-desk-with-ipados-16/"],
  [91,"My iPad Only Desk Setup - Was It Worth It?","iPhone Wired","主役","総合・仕事","あり","不明","キーボード/ポインター","Studio Display","5K画面とM1 iPad Airの費用対効果を検証","A","https://iphonewired.com/common-problems/674896/"],
  [92,"iPad Buyer’s Guide: hybrid work desk","SlatePad","補助/併用","総合・仕事","あり","不明","共有入力想定","Mac/iPad兼用","仕事Macと個人iPadで一つの画面を共用","A","https://slatepad.org/2025/11/26/ipad-buyers-guide/"],
  [93,"iPad Desk Setup for Trading","Rutube","主役","トレーディング","あり/不明","不明","Keychron K2/MX Master","金融・マルチタスク","Universal Controlを取引机に組み込む","A","https://rutube.ru/video/62c2df27b7b8e7a34de4059bdd589c44/"],
  [94,"My Mac Mini and iPad Desk Setup","Curtis McHale","補助/併用","文章・仕事","あり","不明","共有入力想定","Mac/iPad併用","主端末とタブレットの役割分担を見る","A","https://curtismchale.ca/2019/04/29/my-mac-mini-and-ipad-desk-setup/"],
  [95,"Use Your iPad as a Display for Pretty Much Anything","iFixit","補助/併用","音楽制作","あり","マウント","小型キーボード/タッチ","音楽スタジオ・再利用","古いiPadをAbleton用タッチ画面に転用","A","https://www.ifixit.com/News/94000/how-to-use-your-ipad-as-a-display-for-pretty-much-anything"],
  [96,"I developed on an iPad for two weeks","DEV Community","主役","開発・コーディング","あり","卓上スタンド","分割キーボード/縦型マウス","開発者・実験","code-serverでVS Code環境を外部化","A","https://dev.to/coder/i-developed-on-an-ipad-for-two-weeks-here-s-what-i-learned-2dda"],
  [97,"Logic Pro for iPad：compact studio","Mac Life","主役","音楽制作","あり/不明","Magic Keyboard","MIDIキーボード/ヘッドホン","音楽スタジオ","Hub経由でMIDIとAudio I/Oを接続","A","https://www.maclife.de/test/logic-pro-ipad-test-kompakteste-tonstudio-welt-100122378.html"],
  [98,"Share your iPad desktop setups","Mac Power Users","主役","開発・仕事","あり","回転スタンド","メカニカルKB/Mouse/Trackpad","投稿集・木質","縦横回転と複数ポインターを使い分ける","A","https://talk.macpowerusers.com/t/share-your-ipad-desktop-setups-monitor-keyboard-mouse/16678"],
  [99,"Getting started with iPad music production","Bax Music Blog","主役","音楽制作","なし/不明","卓上スタンド","キーボード/ヘッドホン","小型スタジオ","DAW・鍵盤・モニター環境を最小構成にする","A","https://www.bax-shop.co.uk/blog/studio-recording/getting-started-with-ipad-music-production/"],
  [100,"Streaming PS4 and PC on iPad is AMAZING","ResetEra","主役","ゲーム","あり","卓上スタンド","RGBキーボード/マウス/ゲームパッド","ゲーミング","Remote PlayとMoonlightで複数機を集約","A","https://www.resetera.com/threads/streaming-ps4-and-pc-on-ipad-is-amazing.112798/"],
];

if (cases.length !== 100) throw new Error(`Expected 100 cases, got ${cases.length}`);
const urls = cases.map(r => r[11]);
if (new Set(urls).size !== urls.length) throw new Error("Duplicate source URL detected");

function useGroup(use) {
  if (/開発|コーディング|音楽/.test(use)) return "開発・音楽";
  if (/ゲーム|メディア|動画/.test(use)) return "ゲーム・メディア";
  if (/学習|文章|ブログ|情報発信/.test(use)) return "学習・文章";
  if (/創作|イラスト|漫画|デザイン|写真|制作|DTP|ゲームアート/.test(use)) return "創作・イラスト";
  return "総合・仕事";
}

const wb = Workbook.create();
const summary = wb.worksheets.add("サマリー");
const data = wb.worksheets.add("事例一覧");

data.showGridLines = false;
data.getRange("A1:N101").values = [
  ["No.","事例タイトル","媒体","iPadの役割","主用途","外部モニター","設置方式","入力機器","スタイル/制約","採用できるアイデア","証拠レベル","出典URL","調査日","用途グループ"],
  ...cases.map(r => [...r, researchedAt, useGroup(r[4])]),
];
data.freezePanes.freezeRows(1);
data.freezePanes.freezeColumns(2);
const dataTable = data.tables.add("A1:N101", true, "IPadDeskCases");
dataTable.style = "TableStyleMedium2";
dataTable.showBandedRows = true;
dataTable.showFilterButton = true;
data.getRange("A1:N1").format = {
  fill: "#16324F",
  font: { bold: true, color: "#FFFFFF" },
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "outside", style: "medium", color: "#16324F" },
};
data.getRange("A2:A101").format.numberFormat = "0";
data.getRange("M2:M101").format.numberFormat = "yyyy-mm-dd";
data.getRange("A2:A101").format.horizontalAlignment = "center";
data.getRange("C2:F101").format.horizontalAlignment = "center";
data.getRange("K2:K101").format.horizontalAlignment = "center";
data.getRange("M2:M101").format.horizontalAlignment = "center";
data.getRange("N2:N101").format.horizontalAlignment = "center";
data.getRange("A2:A101").format.verticalAlignment = "center";
data.getRange("C2:F101").format.verticalAlignment = "center";
data.getRange("K2:N101").format.verticalAlignment = "center";
data.getRange("B2:L101").format.verticalAlignment = "top";
data.getRange("B2:L101").format.wrapText = true;
data.getRange("A1:A101").format.columnWidth = 6;
data.getRange("B1:B101").format.columnWidth = 34;
data.getRange("C1:C101").format.columnWidth = 18;
data.getRange("D1:D101").format.columnWidth = 12;
data.getRange("E1:E101").format.columnWidth = 18;
data.getRange("F1:F101").format.columnWidth = 13;
data.getRange("G1:G101").format.columnWidth = 20;
data.getRange("H1:H101").format.columnWidth = 24;
data.getRange("I1:I101").format.columnWidth = 22;
data.getRange("J1:J101").format.columnWidth = 38;
data.getRange("K1:K101").format.columnWidth = 10;
data.getRange("L1:L101").format.columnWidth = 54;
data.getRange("M1:M101").format.columnWidth = 13;
data.getRange("N1:N101").format.columnWidth = 18;
data.getRange("1:1").format.rowHeight = 32;
data.getRange("2:101").format.rowHeight = 42;
data.getRange("K2:K101").conditionalFormats.add("cellIs", {operator:"equal",formula:'"A"',format:{fill:"#D1FAE5",font:{color:"#065F46",bold:true}}});
data.getRange("K2:K101").conditionalFormats.add("cellIs", {operator:"equal",formula:'"B"',format:{fill:"#FEF3C7",font:{color:"#92400E",bold:true}}});
data.getRange("K2:K101").conditionalFormats.add("cellIs", {operator:"equal",formula:'"C"',format:{fill:"#FEE2E2",font:{color:"#991B1B",bold:true}}});

summary.showGridLines = false;
summary.getRange("A1:J1").merge();
summary.getRange("A1").values = [["iPad中心のデスク環境 100事例調査"]];
summary.getRange("A1:J1").format = {fill:"#16324F",font:{bold:true,color:"#FFFFFF",size:20},horizontalAlignment:"left",verticalAlignment:"center"};
summary.getRange("A1:J1").format.rowHeight = 38;
summary.getRange("A3").values = [["調査件数"]];
summary.getRange("B3").formulas = [["=COUNTA('事例一覧'!A2:A101)"]];
summary.getRange("D3").values = [["証拠レベルA"]];
summary.getRange("E3").formulas = [["=COUNTIF('事例一覧'!K2:K101,\"A\")"]];
summary.getRange("G3").values = [["iPadが主役"]];
summary.getRange("H3").formulas = [["=COUNTIF('事例一覧'!D2:D101,\"主役\")"]];
summary.getRange("A5").values = [["外部モニターあり"]];
summary.getRange("B5").formulas = [["=COUNTIF('事例一覧'!F2:F101,\"あり\")"]];
summary.getRange("D5").values = [["外部画面あり/不明"]];
summary.getRange("E5").formulas = [["=COUNTIF('事例一覧'!F2:F101,\"あり/不明\")"]];
summary.getRange("G5").values = [["URL欠損"]];
summary.getRange("H5").formulas = [["=COUNTIF('事例一覧'!L2:L101,\"\")"]];
for (const range of ["A3:B3","D3:E3","G3:H3","A5:B5","D5:E5","G5:H5"]) {
  summary.getRange(range).format = {fill:"#EAF2F8",borders:{preset:"outside",style:"thin",color:"#B8CBD9"},verticalAlignment:"center"};
}
summary.getRange("A3:A5").format.font = {bold:true,color:"#335C67"};
summary.getRange("D3:D5").format.font = {bold:true,color:"#335C67"};
summary.getRange("G3:G5").format.font = {bold:true,color:"#335C67"};
summary.getRange("B3:B5").format.font = {bold:true,size:16,color:"#0F766E"};
summary.getRange("E3:E5").format.font = {bold:true,size:16,color:"#0F766E"};
summary.getRange("H3:H5").format.font = {bold:true,size:16,color:"#0F766E"};
summary.getRange("A3:H5").format.rowHeight = 30;

summary.getRange("A8:B8").values = [["主用途（集約）","件数"]];
summary.getRange("A9:A13").values = [["総合・仕事"],["創作・イラスト"],["学習・文章"],["ゲーム・メディア"],["開発・音楽"]];
summary.getRange("B9:B13").formulas = [
  ["=COUNTIF('事例一覧'!N2:N101,\"総合・仕事\")"],
  ["=COUNTIF('事例一覧'!N2:N101,\"創作・イラスト\")"],
  ["=COUNTIF('事例一覧'!N2:N101,\"学習・文章\")"],
  ["=COUNTIF('事例一覧'!N2:N101,\"ゲーム・メディア\")"],
  ["=COUNTIF('事例一覧'!N2:N101,\"開発・音楽\")"],
];
summary.getRange("A8:B8").format = {fill:"#0F766E",font:{bold:true,color:"#FFFFFF"}};
summary.getRange("A8:B13").format.borders = {preset:"inside",style:"thin",color:"#D7E3EA"};
summary.getRange("B9:B13").format.numberFormat = "0";

summary.getRange("A16:H16").merge();
summary.getRange("A16").values = [["読み方と調査基準"]];
summary.getRange("A16:H16").format = {fill:"#335C67",font:{bold:true,color:"#FFFFFF"}};
summary.getRange("A17:H21").merge(true);
summary.getRange("A17:A21").values = [
  ["・対象：iPadが主端末、または常設の創作/補助画面として重要な役割を持つ公開事例。"],
  ["・証拠レベル A：本文・説明から構成を確認、B：画像/検索要約で主要配置を確認、C：主にタイトルから候補化。"],
  ["・Pinterestや製品ページは見た目の参考として扱い、実用性の根拠とは分けている。"],
  ["・外部モニターの「あり/不明」は、画面利用が示唆されるが接続状態を断定できない事例。"],
  ["・用途グループは排他的な5分類で、用途別件数の合計は100。"],
];
summary.getRange("A17:H21").format = {fill:"#F7FAFC",font:{color:"#334155",size:10},wrapText:true,verticalAlignment:"center",borders:{preset:"outside",style:"thin",color:"#CBD5E1"}};
summary.getRange("A17:H21").format.rowHeight = 28;

summary.getRange("A23:H23").merge();
summary.getRange("A23").values = [["主要な示唆"]];
summary.getRange("A23:H23").format = {fill:"#D97706",font:{bold:true,color:"#FFFFFF"}};
summary.getRange("A24:H28").merge(true);
summary.getRange("A24:A28").values = [
  ["1. 外部モニター利用では、iPadを画面直下に置くか、磁気/VESAアームで浮かせる形が多い。"],
  ["2. 持ち出し頻度が高い人ほど、ケース一体型より磁気着脱・折り畳みスタンドを選ぶ。"],
  ["3. クリエイターはApple Pencilのために、視線高さと描画角度を切り替えられる設置を優先する。"],
  ["4. iPad-only構成はUSB-C/Thunderbolt Dockと外部入力機器の相性が成否を左右する。"],
  ["5. Mac/PC併用では、Sidecar・Universal Control・専用情報表示に役割を絞ると定着しやすい。"],
];
summary.getRange("A24:H28").format = {fill:"#FFF7ED",font:{color:"#7C2D12",size:10},wrapText:true,verticalAlignment:"center",borders:{preset:"outside",style:"thin",color:"#FDBA74"}};
summary.getRange("A24:H28").format.rowHeight = 28;

summary.getRange("A1:J28").format.font.name = "Aptos";
summary.getRange("A1:A28").format.columnWidth = 24;
summary.getRange("B1:B28").format.columnWidth = 12;
summary.getRange("C1:C28").format.columnWidth = 4;
summary.getRange("D1:D28").format.columnWidth = 24;
summary.getRange("E1:E28").format.columnWidth = 12;
summary.getRange("F1:F28").format.columnWidth = 4;
summary.getRange("G1:G28").format.columnWidth = 24;
summary.getRange("H1:H28").format.columnWidth = 12;
summary.getRange("I1:J28").format.columnWidth = 12;

const chart = summary.charts.add("bar", summary.getRange("A8:B13"));
chart.title = "用途別構成（100事例）";
chart.hasLegend = false;
chart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 10 } };
chart.yAxis = { numberFormatCode: "0", min: 0 };
chart.setPosition("D8", "J15");

await fs.mkdir(outputDir, { recursive: true });
const summaryPreview = await wb.render({sheetName:"サマリー",range:"A1:J28",scale:1.25,format:"png"});
await fs.writeFile(`${outputDir}/summary-preview.png`, new Uint8Array(await summaryPreview.arrayBuffer()));
const dataPreview = await wb.render({sheetName:"事例一覧",range:"A1:N101",scale:0.55,format:"png"});
await fs.writeFile(`${outputDir}/data-preview.png`, new Uint8Array(await dataPreview.arrayBuffer()));
const dataDetailPreview = await wb.render({sheetName:"事例一覧",range:"A1:N18",scale:1.1,format:"png"});
await fs.writeFile(`${outputDir}/data-detail-preview.png`, new Uint8Array(await dataDetailPreview.arrayBuffer()));
const file = await SpreadsheetFile.exportXlsx(wb);
await file.save(`${outputDir}/iPad_centered_desk_setups_100.xlsx`);

const inspectSummary = await wb.inspect({kind:"table",range:"サマリー!A1:J28",include:"values,formulas",tableMaxRows:28,tableMaxCols:10,maxChars:7000});
const inspectData = await wb.inspect({kind:"table",range:"事例一覧!A1:N8",include:"values,formulas",tableMaxRows:8,tableMaxCols:14,maxChars:7000});
const errors = await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"final formula error scan",maxChars:3000});
console.log(inspectSummary.ndjson);
console.log(inspectData.ndjson);
console.log(errors.ndjson);
