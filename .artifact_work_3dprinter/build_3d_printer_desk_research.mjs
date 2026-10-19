import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "../outputs/3d-printer-desk-research-100";
const researchedAt = new Date(2026, 7, 30);

const cases = [
  [1,"Do you guys put your printer on your desk?","Reddit","FDM/FFF","投稿集","机/専用キャビネット","一部","棚・箱","趣味","机置きから専用台・テントへ移す複数例。安定した重量物収納台の案あり","A","https://www.reddit.com/r/3Dprinting/comments/1lvjlqy/do_you_guys_put_your_printer_on_your_desk/","デスク併設"],
  [2,"Anatomy Of A 3D Workspace","Reddit","FDM/FFF","1台","専用机","不明","不明","改造・試作","プリンターと作業机を往復しないため機材を一か所へ集約","A","https://www.reddit.com/r/3Dprinting/comments/1igkiv0","デスク併設"],
  [3,"Show off your 3DP battlestation","Reddit","混在/不明","投稿集","作業台","不明","不明","趣味・後処理","印刷後作業面まで含む配置例を募るスレッド","B","https://www.reddit.com/r/3Dprinting/comments/10uh7re","デスク併設"],
  [4,"Small upgrade to my 3D printing workspace","Reddit","混在/不明","1台","共有デスク","不明","整理用品","趣味・後処理","支持材除去や後処理を長時間行える座席環境を改善","B","https://www.reddit.com/r/3dprinter/comments/1vbnotz/small_upgrade_to_my_3d_printing_workspace/","デスク併設"],
  [5,"Show me your Workspace!","Reddit","FDM/FFF","投稿集","専用机/棚","不明","不明","親子・教育","ToyboxからBambu A1へ更新した子どもの作業環境を含む","B","https://www.reddit.com/r/3Dprinting/comments/1hhxh3v","デスク併設"],
  [6,"My Setup","Reddit","レジン/SLA","1台","室内机","懸念あり","不明","趣味","レジン作業を居室で行う場合の換気・滞在時間への注意が議論される","A","https://www.reddit.com/r/3Dprinting/comments/1awrmmm","レジン工程"],
  [7,"3D printed hobby desk storage wall","Reddit","FDM/FFF","1台/不明","趣味机＋収納壁","不明","壁面モジュール","趣味・工具収納","机上アーチと3D印刷収納で垂直面を活用","A","https://www.reddit.com/r/3Dprinting/comments/1isw8sn/3d_printed_hobby_desk_storage_wall/","デスク併設"],
  [8,"Pimp my setup：PCとレジンプリンターの共存","Reddit","レジン/SLA","1台","PCデスク横","懸念あり","不明","趣味・PC併用","小型机でPCとレジン設備を共存させる計画に分離運用の助言","A","https://www.reddit.com/r/setups/comments/17jm78l","レジン工程"],
  [9,"Are 3D Printer Battlestations a thing?","Reddit","FDM/FFF","複数台","プリンター棚＋PC机","不明","フィラメント棚","趣味・小規模販売","照明、材料収納、PC監視を近接させた完成度の高い例","A","https://www.reddit.com/r/3Dprinting/comments/16w8o9n/are_3d_printer_battlestations_a_thing_if_so_heres/","複数台/ファーム"],
  [10,"Good printing station furniture","Reddit","FDM/FFF","1台/不明","専用家具を検討","不明","不明","趣味","住み替えに合わせ机置きから独立ステーションへ移行する検討例","B","https://www.reddit.com/r/VORONDesign/comments/1uboewz/good_printing_station_solutions_furniture/","専用ラック/棚"],
  [11,"Furniture for a 3D printing business room","Reddit","FDM/FFF","複数台","寝室転用の専用室/クローゼット","確認","収納棚","小規模事業","クローゼットを騒音低減と排気のためのプリンター区画にする","A","https://www.reddit.com/r/3Dprinting/comments/1ucuhfe/how_do_you_have_your_room_setup_what_furniture/","複数台/ファーム"],
  [12,"3D Printing and Project Workspace","Reddit","FDM/FFF","1台/不明","PCデスク併設","不明","不明","設計・プロジェクト","Bambu Studio/Handyを使うMac併設の工作机","B","https://www.reddit.com/r/Workspaces/comments/1ep5bum","デスク併設"],
  [13,"Is This Ventilation Setup Enough for Resin Printing?","Reddit","レジン/SLA","1台","小部屋の机＋テント","確認","不明","レジン造形","負圧テントと窓外排気。開放前のパージ運用まで議論","A","https://www.reddit.com/r/resinprinting/comments/1ji3d58/is_this_ventilation_setup_enough_for_resin/","レジン工程"],
  [14,"What's your Bambu setup look like?","Reddit","FDM/FFF","投稿集","金属棚/IKEA机","一部","IKEA棚・引き出し","趣味","壁固定した机とBOAXEL/ALEXを組み合わせる複数例","A","https://www.reddit.com/r/BambuLab/comments/1pzk5an/whats_your_setup_look_like_so_far/","専用ラック/棚"],
  [15,"Bambu A1 work space","Reddit","FDM/FFF","1台","24×24/6ft机","不明","AMS Lite配置","趣味","壁アンカーで机振動と共振音を抑える例","A","https://www.reddit.com/r/BambuLabA1/comments/1q5mi5o/work_space/","デスク併設"],
  [16,"3D Printer Workbenches","Reddit","混在","複数台","ガレージ作業台","確認","専用区画","工作・試作","32.5kg機向け木製ベンチ、レジン洗浄/硬化区画を別端へ配置","A","https://www.reddit.com/r/Workbenches/comments/1ppi89u/3d_printer_workbenches/","複数台/ファーム"],
  [17,"Help with resin ventilation in my room","Reddit","レジン/SLA","1台","寝室","懸念あり","不明","導入前検討","寝室運用を避け、窓際・負圧テント・外部排気へ変更する議論","A","https://www.reddit.com/r/resinprinting/comments/1vxoajw/i_messed_up_and_now_i_need_help_with_ventilation/","レジン工程"],
  [18,"Desk recommendations for large Bambu printers","Reddit","FDM/FFF","複数台","厚い天板＋IKEA引き出し","一部","不明","趣味・制作","コンクリート板とフォームで振動を減衰する例","A","https://www.reddit.com/r/BambuLab/comments/1vdbsam/desk_recommendations/","デスク併設"],
  [19,"Ventilation solution for a small bungalow","Reddit","レジン/SLA","1台","限られた室内区画","確認","別後処理場所","レジン造形","小型案を撤回し、プリンターと硬化機をテントに入れ庭へ排気","A","https://www.reddit.com/r/resinprinting/comments/1smj2xx/ventilation_solution_for_a_small_bungalow/","レジン工程"],
  [20,"Resin Printer Ventilation/Air Purifier Setup","Reddit","レジン/SLA","1台","地下室テント","確認","不明","レジン造形","HEPAのみではなく窓外へ3インチ排気を追加","A","https://www.reddit.com/r/3Dprinting/comments/rbxjmq","レジン工程"],
  [21,"Resin printer venting setup?","Reddit","レジン/SLA","1台","寝室近接の作業台","懸念あり","不明","導入前検討","木製囲いと窓排気案。寝室・AC再流入の懸念を検討","A","https://www.reddit.com/r/3Dprinting/comments/gvq3k3","レジン工程"],
  [22,"My 3D Printer Workspace is Complete","Reddit","FDM/FFF","2台","IKEAキッチンアイランド","不明","AMS上置き","趣味・小規模生産","2台のX1C+AMSを奥行きのある独立台に並べる","A","https://www.reddit.com/r/BambuLab/comments/16qzrvu/my_3d_printer_workspace_is_complete/","複数台/ファーム"],
  [23,"First resin printer workspace checklist","Reddit","レジン/SLA","計画","ガレージ内小部屋","確認","薬品/用品区画","レジン造形","換気とPPE、洗浄・硬化を購入前に設計する例","A","https://www.reddit.com/r/resinprinting/comments/1bju584","レジン工程"],
  [24,"Resin ventilation in a small room","Reddit","レジン/SLA","1台","小部屋＋テント","確認","不明","レジン造形","印刷・洗浄・硬化をテント内に入れ窓外へ排気","A","https://www.reddit.com/r/resinprinting/comments/1ap1kwg","レジン工程"],
  [25,"Project Nova：PC・配信・3D印刷・homelab","Reddit","FDM/FFF","1台/不明","昇降PCデスク周辺","不明","小型ラック計画","配信・homelab","OctoPrint監視を含む複合デスク。配線整理が次の課題","A","https://www.reddit.com/r/setups/comments/1ubibpp/my_standing_desk_streaming_setup_slowly_turned/","デスク併設"],
  [26,"My 3D Printer Station setup","Reddit","FDM/FFF","1台/不明","専用ステーション","不明","不明","趣味","Bambu Lab機の専用台事例。本文情報は限定的","C","https://www.reddit.com/r/BambuLab/comments/1lxv0jw/my_3d_printer_station_setup/","専用ラック/棚"],
  [27,"Basement Home Lab maker bench","Reddit","FDM/FFF","1台/不明","地下室ベンチ","不明","フィラメント常設","CAD・電子工作","壁掛けモニターでCAD/回路図を見ながら造形する総合工作机","A","https://www.reddit.com/r/homelab/comments/1w06icf/basement_home_lab/","デスク併設"],
  [28,"Where do you all put your printers?","Reddit","混在/不明","投稿集","専用室/机/ガレージ","一部","工具棚","趣味","空調付きプロジェクトルームから省スペース机までの比較","A","https://www.reddit.com/r/3Dprinting/comments/1abdz0p/where_do_you_all_put_your_printers/","デスク併設"],
  [29,"Workbench Choices?","Reddit","FDM/FFF","1台/不明","48インチ作業台","不明","工具収納","3D印刷・電子工作","スチール製ベンチの振動と兼用性を検討","A","https://www.reddit.com/r/3Dprinting/comments/1fk32jn","デスク併設"],
  [30,"Overkill 3D Print Setup?","Reddit","FDM/FFF","1台","専用区画","一部","材料別収納","個人/業務","X1CでCF Nylon、PC、ASAを扱う高機能材料向け環境","A","https://www.reddit.com/r/3dprinter/comments/18xt0bo","エンクロージャー"],
  [31,"Scrap wood 3D printing station for a kid","Reddit","FDM/FFF","1台","自作木製台","不明","不明","親子・教育","端材で子ども用の独立した印刷台を制作","A","https://www.reddit.com/r/3Dprinting/comments/1igcybx","専用ラック/棚"],
  [32,"Stationary setup vs mobile cart?","Reddit","FDM/FFF","1台","軽量テーブル/移動台","一部","不明","趣味","大理石板＋フォームで軽い台の振動を抑える","A","https://www.reddit.com/r/ender3/comments/m89ivp","専用ラック/棚"],
  [33,"3D Printing Business Desk Setup at Home","YouTube","FDM/FFF","複数台","昇降机＋プリンター区画","確認","棚・乾燥機","小規模事業","設計・印刷・組立・梱包を分け、外置きP1S囲いと空気質計を使用","A","https://www.youtube.com/watch?v=C_ECSG7L74w","複数台/ファーム"],
  [34,"Small 3D Printer Desk Setup","Useful Home Tech","FDM/FFF","1台","小型机","確認","フィラメント保管","ホームオフィス","設置寸法・安定性・電源・排気を一体で検討するガイド","A","https://usefulhometech.com/guides/best-desk-setup-small-3d-printer/","デスク併設"],
  [35,"Home 3D printer productivity setup","UltiMaker","FDM/FFF","1台","ホームオフィス","一部","材料/工具整理","仕事・試作","専用室またはホームオフィスで作業導線を整える","A","https://ultimaker.com/learn/how-to-stay-productive-with-a-home-3d-printer-setup/","デスク併設"],
  [36,"Original Prusa Enclosure workstation","Prusa","FDM/FFF","1台","純正囲い","一部","囲い内スプール","高機能材料・趣味","温度安定、ろ過、逆Bowdenで机上設備をまとめる","A","https://help.prusa3d.com/article/original-prusa-enclosure_347479","エンクロージャー"],
  [37,"How to Set Up a 3D Printing Workshop","The Tech Influencer","混在","複数台","金属ベンチ/3ゾーン","確認","材料区画","工房・小規模事業","Clean、Print、Post-processの3区画へ分離","A","https://thetechinfluencer.com/3d-printing-workshop-setup-guide/","複数台/ファーム"],
  [38,"3D Printer Environment Guides","Print Climate","混在","ガイド","ガレージ/地下室/レジン区画","確認","乾燥・密閉収納","趣味・工房","湿度・外気・囲い・レジン工程を環境別に整理","A","https://printclimate.com/guides","エンクロージャー"],
  [39,"Desk Setups for 3D Printing Labs","AnthroDesk","混在","複数台","ラボ/昇降机","一部","棚・工具","教育・クリエイティブ","プリンターとPC作業面を分離しつつ近接させる","A","https://www.anthrodesk.ca/blogs/news/the-best-desk-setups-for-3d-printing-labs-and-creative-tech-rooms","複数台/ファーム"],
  [40,"Desktop Fabrication Station","MatterHackers","混在","複数事例","机/移動カート","一部","工具・材料","趣味・makerspace","小型機は机、大型機はカートという重量別の配置","A","https://www.matterhackers.com/articles/how-to-setup-a-desktop-fabrication-station-for-3d-printing","デスク併設"],
  [41,"Silver Knight home printing workstation","Silver Knight PCs","FDM/FFF","1台","PC机横のサイドテーブル","不明","壁掛けスプール","設計・販売","CADモニターとプリンターを隣接させ、材料を壁面化","B","https://www.silverknightpcs.com/shop/3D-Printing-c182166119","デスク併設"],
  [42,"ZeroFearArt workshop","ZeroFearArt","FDM/FFF","5台以上","赤い金属ラック","不明","下段スプール区画","販売・試作","不安定な折り畳み机から自作重量ラックへ移行","A","https://www.zerofearart.com/our-workshop/","複数台/ファーム"],
  [43,"Printporium workshop","Printporium","混在","複数台","金属棚＋作業面","一部","箱・工具壁","受託造形","囲い機、開放機、工具、完成品を縦方向に集約","B","https://printporium.ca/","複数台/ファーム"],
  [44,"Twin printer ventilation bench","3D Centroamérica","FDM/FFF","2台","木製ベンチ＋透明フード","確認","不明","教育・工房","各プリンターのフードから共通フィルターへダクト接続","B","https://3dcentroamerica.com/misc/air-filter-for-3d-printer.html","エンクロージャー"],
  [45,"Polycarbonate printing desk","FacFox Docs","FDM/FFF","1台","PCデスク左側","一部","上部スプール","設計・試作","窓際のPC机に囲い機を置き、監視画面と入力機器を共用","B","https://facfox.com/docs/kb/polycarbonate-pc-filament-best-brands-of-2021","デスク併設"],
  [46,"3D Printing Corner","L21 Degrees","FDM/FFF","2台","金属棚","一部","乾燥機・真空袋・密閉容器","趣味・改造","Ender系とP1S、AMS、乾燥機、電子部品を一つの棚へ集約","A","https://l21degrees.com/2025/01/02/3d-printing-corner/","専用ラック/棚"],
  [47,"Family 3D printing rack","alterity.design","FDM/FFF","複数台","クローゼット金属棚","一部","棚間スプール","家庭・教育","複数Prusaを狭いクローゼットへ縦積み","B","https://www.alterity.design/labs/how-to-introduce-your-family-and-students-to-3d-printing","複数台/ファーム"],
  [48,"Enclosed resin printer pair with filtration","Alveo3D","レジン/SLA","2台","アルミ囲い付き机","確認","不明","レジン造形","2台を透明囲いに収めフィルター/ダクトと窓換気を併用","A","https://www.alveo3d.com/en/vocs-emissions-3d-printing-all-need-to-know/","レジン工程"],
  [49,"3DPrintBeginner workshop","3DPrintBeginner","混在","5台以上","3段金属棚","不明","側面スプール・箱","レビュー・検証","異なる方式/機種を棚段ごとに配置する評価環境","B","https://3dprintbeginner.com/about/","複数台/ファーム"],
  [50,"Yellow 3D printer station","Pinterest","混在/不明","複数台","黄色ラック","一部","引き出し/囲い","趣味","各段に防振材を置き、囲いと材料収納を一体化","B","https://www.pinterest.com/pin/718042734374270020/","専用ラック/棚"],
  [51,"Home fabrication studio with printer rack","Pinterest","混在","4台","金属ラック＋昇降机","一部","棚","趣味・設計","プリンター棚と曲面モニター机を隣接配置","B","https://ca.pinterest.com/pin/pin-em--751186412879579822/","複数台/ファーム"],
  [52,"QIDI workstation with ring light","Bambu Lab Forum","FDM/FFF","1台","木製ベンチ","一部","下段スプール","趣味・設計","スライサー用PC、リングライト、材料を一台のベンチに統合","B","https://forum.bambulab.com/t/poll-what-was-your-primary-reason-for-getting-a-3d-printer/88734","デスク併設"],
  [53,"Budget desktop print farm","3D Print Kingdom","FDM/FFF","5台以上","金属ラック","不明","各段スプール","小規模生産","監視PCをラック横に置き、同型機を均等間隔で配置","B","https://3dprintkingdom.com/how-to-build-a-3d-print-farm-without-breaking-the-bank/","複数台/ファーム"],
  [54,"3DO-Tech training workspace","3DO-Tech","FDM/FFF","2台","長机＋PC机","不明","引き出し・棚","教育・試作","2台のPrusaとデュアルモニターCAD席を同じ作業列に配置","B","https://3do-tech.fr/cours","複数台/ファーム"],
  [55,"3D Printer Tables and Stands gallery","All3DP","混在","複数事例","ラック/独立台","一部","側面スプールラック","設備比較","机の安定性、奥行き、移動性を比較できる事例集","A","https://all3dp.com/2/3d-printer-table-most-reliable-affordable-workbenches/","専用ラック/棚"],
  [56,"FAST-RACK filament storage desk","MakerWorld","FDM/FFF","1台","PC机＋材料壁","不明","箱型モジュールラック","設計・材料管理","デスク背面をフィラメント箱の格子収納にする","B","https://makerworld.com/en/models/1169297-fast-rack-filament-spool-rack","デスク併設"],
  [57,"PUNCIA 3-tier printer workstation","Ubuy","混在","3台","防振3段ラック","一部","側面スプール収納","趣味・小規模生産","各段防振と側面材料ラックを持つ省床面積構成","B","https://www.ubuy.co.in/product/QE06EFRM2-puncia-3d-printer-stand-with-filaments-storage-3-tier-3d-printer-rack-with-filament-organizer-heavy-duty-3d-printer-workbench-for-3d-printing-workshop","専用ラック/棚"],
  [58,"3D Print Boutique mini farm","3D Print Boutique","FDM/FFF","5台以上","金属棚","不明","上段スプール","受託造形","同型P1Sを番号管理し、材料を上段に集約","B","https://3dprintboutique.uk/products/custom-3d-printing-service-bring-your-19489","複数台/ファーム"],
  [59,"Yellow-rack print farm","ZOL","FDM/FFF","5台以上","黄色ラック","不明","不明","量産","同型機で同一部品を並列生産する密度重視配置","B","https://news.zol.com.cn/929/9298028.html","複数台/ファーム"],
  [60,"Rolling printer stand with filament storage","Wayfair","FDM/FFF","1台","移動ラック","不明","棚・ワイヤーバスケット","趣味・小部屋","PC机横へ寄せられるキャスター付き材料収納台","B","https://www.wayfair.com/organization-storage/pdp/inbox-zero-3d-printer-stand-with-filament-storage-heavy-duty-3d-printer-table-with-charging-station-rolling-printer-cart-filament-storage-rack-brown-w117679820.html","専用ラック/棚"],
  [61,"RGB-lit multi-printer shelves","Prusa Forum","混在","5台以上","棚ユニット","一部","密閉袋・移動カート","趣味・比較","プリンターごとに照明を付け、材料を下段でラベル管理","B","https://forum.prusa3d.com/forum/english-forum-original-prusa-i3-mk4-general-discussion-announcements-and-releases/prusa-mk4-vs-bambu/paged/9/","複数台/ファーム"],
  [62,"IKEA Lack enclosure with removable cover","Thingiverse","FDM/FFF","1台","IKEA Lack囲い","一部","下段箱・スプール","趣味・ABS","透明パネル、照明、着脱天井で保守性を確保","A","https://www.thingiverse.com/thing:2968367","エンクロージャー"],
  [63,"High-stability IKEA Lack enclosure","Thingiverse","FDM/FFF","1台","IKEA Lack囲い","一部","上部/通過口","趣味","PSUを囲い外へ出し、個別に外せるパネルで整備性を上げる","A","https://www.thingiverse.com/thing:6555327","エンクロージャー"],
  [64,"IKEA Lack enclosure with bottom dry-box feed","Thingiverse","FDM/FFF","1台","2段Lack囲い","一部","下段ドライボックス","趣味","乾燥箱から下方給糸し、制御基板と電源を囲い外へ配置","A","https://www.thingiverse.com/thing:2149072","エンクロージャー"],
  [65,"Ender 3 IKEA Lack enclosure","Thingiverse","FDM/FFF","1台","Lack囲い","一部","上部スプール","趣味","透明パネルとLED、開放背面でPLA時の過熱を抑える","A","https://www.thingiverse.com/thing:3358985","エンクロージャー"],
  [66,"IKEA Lack enclosure with two printer bays","Pinterest","FDM/FFF","2台","積層Lack棚","一部","下段透明箱","趣味","囲い機と開放機を並べ、材料を各機の下へ収納","B","https://www.pinterest.com/pin/ikea-lack-3d-printer-enclosure-how-to-make-your-own--1137440449609048265/","エンクロージャー"],
  [67,"IKEA Lack bracket workstation","Cults","FDM/FFF","1台","積層Lack囲い","一部","上段スプール","趣味","3D印刷ブラケットで市販家具を多段化","B","https://cults3d.com/en/3d-model/tool/ikea-lack-table-bracket-corner-straight","エンクロージャー"],
  [68,"Ender 3 Pro Lack enclosure workshop","Artofit","FDM/FFF","1台","Lack囲い＋木工ベンチ","一部","上部スプール","ガレージ趣味","工作台上に透明囲いを置き、黄色ブラケットで視認性を上げる","B","https://www.artofit.org/image-gallery/656540451951200055/3d-printing-the-famous-ikea-lack-enclosure-for-ender-3-pro/","エンクロージャー"],
  [69,"Building a vented IKEA Lack enclosure","Joe's Projects","FDM/FFF","1台","2段Lack囲い","確認","上部スプール","ABS・趣味","100CFMファンで窓外排気、温度計、外置きPSU、連動電源を採用","A","https://www.tmproductions.com/projects-blog/2019/11/24/building-an-ikea-lack-enclosure-for-the-ender-3-pro","エンクロージャー"],
  [70,"Studio Apartment 3D Printer Setup","個人ブログ","FDM/FFF","1台","気密アルミ囲い","一部","外部給糸","集合住宅・趣味","静音改造、気密パネル、外置き電源でワンルーム対応","A","https://blog.leonti.dev/3d-printer-setup-for-studio-apartment/","エンクロージャー"],
  [71,"Resin print, wash, cure setup","Dallas Makerspace","レジン/SLA","1台","黒い作業台","確認","処理箱","レジン造形","プリンター、洗浄、硬化、手袋、紙類、排気フードを一式化","A","https://talk.dallasmakerspace.org/t/for-sale-resin-print-wash-cure-setup/124726","レジン工程"],
  [72,"Mono X resin workstation","3DPWC","レジン/SLA","1台","工具キャビネット天板","一部","引き出し","造形・塗装","洗浄硬化機とスプレーブースを同じ後処理ベンチへ配置","A","https://3dpwc.com/mono-x-guide","レジン工程"],
  [73,"Formlabs resin printer air-filter enclosure","3D UP Fitters","レジン/SLA","1台","透明アクリル囲い","一部","不明","歯科・業務","天蓋開閉と樹脂交換のクリアランスを確保した専用囲い","A","https://www.3dupfitters.com/products/resin-printer-formlabs3-enclosure","レジン工程"],
  [74,"Elegoo Mars 5 Ultra complete setup","The Gadgeteer","レジン/SLA","1台","工具キャビネット天板","不明","キャビネット","ミニチュア・レビュー","印刷、洗浄、硬化の3機を一直線に配置","A","https://the-gadgeteer.com/2024/07/09/elegoo-mars-5-ultra-3d-resin-printer-review/","レジン工程"],
  [75,"Clear PETG printer enclosure desk","Cut Plastic Sheeting","FDM/FFF","1台","透明キャビネット","一部","上段スプール","ホームオフィス","書類や通常プリンターと同居する縦長囲い","B","https://www.cutplasticsheeting.co.uk/product/clear-petg-plastic-sheet/","エンクロージャー"],
  [76,"Ventilated white printer enclosure","Ubuy","FDM/FFF","1台","独立囲い","確認","内蔵スプール","趣味・高機能材料","換気ファン、温湿度計、照明を囲いへ統合","B","https://www.ubuy.mq/en/product/NH9AWFGKU-3d-printer-enclosure-with-ventilation-built-in-2-filament-hangers-led-light-thermo-hygrometer-noise-reduction-print-optimization-dustproof","エンクロージャー"],
  [77,"Resin post-processing tabletop","3DWithUs","レジン/SLA","1台","木製テーブル","不明","樹脂ボトル・工具トレー","ミニチュア","プリンター、洗浄、硬化、UVライト、工具を作業順に並べる","A","https://3dwithus.com/wash-and-uv-cure-machines-for-resin-3d-printing","レジン工程"],
  [78,"Wash and Cure desktop station","Tom's Hardware","レジン/SLA","1台/不明","木製作業面","不明","洗浄容器","ミニチュア","独立洗浄容器とUV硬化機を隣接させる後処理例","A","https://www.tomshardware.com/3d-printing/elegoo-mars-5-ultra-review","レジン工程"],
  [79,"ELEGOO secondary curing setup","note","レジン/SLA","1台","卓上","不明","樹脂ボトル・メッシュ袋","ホビー","MarsとMercury Plusを並べ、洗浄・二次硬化を短距離化","A","https://note.com/nerimabase/n/n58fd892dd3bb","レジン工程"],
  [80,"Bambu Lab A1 Mini aluminum enclosure","個人ブログ","FDM/FFF","1台","アルミフレーム囲い","一部","ドライボックス/AMS上置き","趣味・開発","冬季保温、難燃パネル、乾燥箱直給糸、AMS小型化を実施","A","https://akibabara.com/blog/7493.html","エンクロージャー"],
  [81,"Tech-chan's 3D Printing Lab","note","FDM/FFF","1台","白いPCデスク横","不明","AMS Lite","Blender・制作","大型モニター、タブレット、ロボットアームとA1 miniを同居","B","https://note.com/techchan/n/nca01eb8038b6","デスク併設"],
  [82,"Dormitory workspace with 3D printer","Azbil","FDM/FFF","1台","寮室の木製机","不明","小型棚","個人制作","生活空間の一角にプリンターと一般機器をまとめる","B","https://www.azbil.com/jp/recruit/special/2025/feature/dormitory.html","デスク併設"],
  [83,"Kyoto rental with built-in 3D printer","物件ファン","FDM/FFF","1台","造作木製棚","不明","展示グリッド","暮らし・創作","住空間に制作棚と展示面を組み込む","B","https://bukkenfan.jp/e/8964448248836554455","専用ラック/棚"],
  [84,"DIY work desk with 3D printer","個人ブログ","FDM/FFF","1台","自作木製作業机","不明","引き出し計画","電子工作・試作","オシロ、シリコンマット、切削面とプリンターを同居","A","https://baum-kuchen.hatenablog.com/entry/2022/04/03/013327","デスク併設"],
  [85,"Modern atelier with 3D printers","Reserve Design","混在","複数台","黒い作業台","一部","工房収納","プロトタイピング","住宅1階をプリンター・切削機・CAD席のアトリエにする","B","https://reservedesign.co.jp/2022/10/18/779","複数台/ファーム"],
  [86,"Home toy-making printer desk","ソレドコ","FDM/FFF","1台","白いPC机角","不明","上部スプール","親子・玩具","自作Prusa型をキーボード脇に置く初期的な机上環境","A","https://soredoko.jp/entry/2017/06/29/110000","デスク併設"],
  [87,"Home engineering with Form 3","Formlabs","レジン/SLA","1台","窓際ホームオフィス","一部","棚・バスケット","在宅設計・試作","ノートPCとSLA機を同じ自然光のある作業面へ配置","A","https://formlabs.com/es/blog/ingenieria-desde-casa/","レジン工程"],
  [88,"Ventilated 3D printing setup illustration","Prism News","FDM/FFF","1台","透明囲い付きベンチ","確認","不明","安全解説","局所排気ダクトと保護具を示す概念例。画像は実例性が低い","C","https://www.prismnews.com/hobbies/3d-printing/how-to-reduce-3d-printer-emissions-with-ventilation-and","エンクロージャー"],
  [89,"TAKE LABO fab space","WORK MILL","FDM/FFF","3台","共有ラボ長机","一部","共同材料棚","教育・共同制作","プリンター列とスライサーPC席を同一室に分けて設置","A","https://workmill.jp/jp/webzine/takelabo-20220307/","複数台/ファーム"],
  [90,"Style NEO desktop workstation","TradeKorea","FDM/FFF","1台","iMac横の黒い机","一部","付属工具・スプール","設計・試作","密閉機とCAD画面を横並びにした商品展示型環境","B","https://www.tradekorea.com/product/detail/P794927/Style-NEO---A15CR--FFF-type-Desktop-3D-Printers-.html","デスク併設"],
  [91,"3D data and CAD studio","3D-flat","混在","複数台","金属棚＋CAD机","一部","棚・工具","受託設計・教育","複数プリンターとデュアルモニターCAD席を明確に分離","B","https://www.3d-flat.com/3ddata-work/","複数台/ファーム"],
  [92,"Mokumoku Harinezumi workshop","CAMPFIRE","FDM/FFF","1台/不明","木製作業台","確認","不明","共同工房","換気設備と可動間仕切りを整えるファブスペース","A","https://camp-fire.jp/projects/689891/view","デスク併設"],
  [93,"School CAD and printer station","Nota SPB","FDM/FFF","1台","PC机右側","不明","不明","学校・STEM","モニターとプリンターを同一机上に置く基本的な教育席","B","https://nota-spb.ru/projecttree","デスク併設"],
  [94,"What2Print home workshop","What2Print","混在","5台以上","白い棚ユニット","一部","壁掛けスプール・箱","レビュー・趣味","FDMとレジンを照明付き棚にまとめる個人工房","B","https://what2print.com/printers","複数台/ファーム"],
  [95,"Customer electronics and Bambu workspace","fnatr","FDM/FFF","1台","透明囲い＋電子工作机","一部","上部スプール","電子工作・試作","A1囲い、計測器、工具、モニターを同じL字作業域に配置","B","https://www.fnatr.com/pages/customer-setup-gallery","エンクロージャー"],
  [96,"iMac and open-frame printer desk","3D Centroamérica","FDM/FFF","1台","コーナーPCデスク","不明","側面スプール","CAD・試作","青色照明の小型機をiMac横に置くデスクトップ型","B","https://3dcentroamerica.com/misc/3d-printing-split-model.html","デスク併設"],
  [97,"K-12 desktop printing workstation","Ednex","FDM/FFF","1台","木製PC机","不明","机上スプール","教育・STEM","モデリング画面、材料、作例を同じ机で見せる教育展示","B","https://ednex.us/k-12/desktop-3d-printing/","デスク併設"],
  [98,"Eight-printer monitored lab","No to China","FDM/FFF","5台以上","左右対称の囲い棚","一部","各機スプール","量産・検証","中央監視画面から8台を管理するラボ配置","B","https://notochina.org/best-3d-printers-not-made-in-china/","複数台/ファーム"],
  [99,"Library 3D printer and scanning station","Nebraska Library Commission","FDM/FFF","1台","6×3ft共有テーブル","一部","不明","公共施設・教育","PCとMakerBotを12インチ以上離して同じ/隣接机に配置","A","https://nlc.nebraska.gov/grants/InnovationStudios/Components/3D_Printer.aspx","デスク併設"],
  [100,"3D Printer station in the Mini Shop","The IT Garage","FDM/FFF","2台","20Uハーフラック＋造作机","不明","ラック追加予定","電子工作・趣味","クローゼット内に2台ラックと壁付けMDF作業机を構築","A","https://theitgarage.wordpress.com/2024/05/05/3d-printer-station-in-the-mini-shop/","専用ラック/棚"],
];

if (cases.length !== 100) throw new Error(`Expected 100 cases, got ${cases.length}`);
const urls = cases.map(r => r[11]);
if (new Set(urls).size !== urls.length) throw new Error("Duplicate source URL detected");

const wb = Workbook.create();
const summary = wb.worksheets.add("サマリー");
const data = wb.worksheets.add("事例一覧");
const refs = wb.worksheets.add("安全参照基準");

data.showGridLines = false;
data.getRange("A1:N101").values = [
  ["No.","事例タイトル","媒体","方式","規模","設置位置/家具","対策確認","材料・工具収納","主用途","観察メモ","証拠レベル","出典URL","環境グループ","調査日"],
  ...cases.map(r => [...r, researchedAt]),
];
data.freezePanes.freezeRows(1);
data.freezePanes.freezeColumns(2);
const table = data.tables.add("A1:N101", true, "PrinterDeskCases");
table.style = "TableStyleMedium4";
table.showBandedRows = true;
table.showFilterButton = true;
data.getRange("A1:N1").format = {fill:"#263238",font:{bold:true,color:"#FFFFFF"},verticalAlignment:"center",wrapText:true,borders:{preset:"outside",style:"medium",color:"#263238"}};
data.getRange("A2:A101").format.horizontalAlignment = "center";
data.getRange("C2:G101").format.horizontalAlignment = "center";
data.getRange("K2:K101").format.horizontalAlignment = "center";
data.getRange("M2:N101").format.horizontalAlignment = "center";
data.getRange("A2:A101").format.verticalAlignment = "center";
data.getRange("C2:G101").format.verticalAlignment = "center";
data.getRange("K2:N101").format.verticalAlignment = "center";
data.getRange("B2:L101").format.wrapText = true;
data.getRange("B2:L101").format.verticalAlignment = "top";
data.getRange("N2:N101").format.numberFormat = "yyyy-mm-dd";
const widths = [6,34,18,14,12,24,12,24,20,42,10,54,20,13];
for (let i=0;i<widths.length;i++) data.getRangeByIndexes(0,i,101,1).format.columnWidth = widths[i];
data.getRange("1:1").format.rowHeight = 32;
data.getRange("2:101").format.rowHeight = 44;
data.getRange("G2:G101").conditionalFormats.add("cellIs",{operator:"equal",formula:'"確認"',format:{fill:"#D1FAE5",font:{bold:true,color:"#065F46"}}});
data.getRange("G2:G101").conditionalFormats.add("cellIs",{operator:"equal",formula:'"一部"',format:{fill:"#FEF3C7",font:{bold:true,color:"#92400E"}}});
data.getRange("G2:G101").conditionalFormats.add("cellIs",{operator:"equal",formula:'"懸念あり"',format:{fill:"#FEE2E2",font:{bold:true,color:"#991B1B"}}});
data.getRange("K2:K101").conditionalFormats.add("cellIs",{operator:"equal",formula:'"A"',format:{fill:"#D1FAE5",font:{bold:true,color:"#065F46"}}});
data.getRange("K2:K101").conditionalFormats.add("cellIs",{operator:"equal",formula:'"B"',format:{fill:"#DBEAFE",font:{bold:true,color:"#1E40AF"}}});
data.getRange("K2:K101").conditionalFormats.add("cellIs",{operator:"equal",formula:'"C"',format:{fill:"#FEE2E2",font:{bold:true,color:"#991B1B"}}});

summary.showGridLines = false;
summary.getRange("A1:J1").merge();
summary.getRange("A1").values = [["3Dプリンターを使うデスク環境 100事例調査"]];
summary.getRange("A1:J1").format = {fill:"#263238",font:{bold:true,color:"#FFFFFF",size:20},horizontalAlignment:"left",verticalAlignment:"center"};
summary.getRange("A1:J1").format.rowHeight = 40;
const cards = [["A3","B3","調査件数","=COUNTA('事例一覧'!A2:A101)"],["D3","E3","証拠レベルA","=COUNTIF('事例一覧'!K2:K101,\"A\")"],["G3","H3","FDM/FFF","=COUNTIF('事例一覧'!D2:D101,\"FDM/FFF\")"],["A5","B5","レジン/SLA","=COUNTIF('事例一覧'!D2:D101,\"レジン/SLA\")"],["D5","E5","対策確認","=COUNTIF('事例一覧'!G2:G101,\"確認\")"],["G5","H5","URL欠損","=COUNTIF('事例一覧'!L2:L101,\"\")"]];
for (const [labelCell,valueCell,label,formula] of cards) { summary.getRange(labelCell).values=[[label]]; summary.getRange(valueCell).formulas=[[formula]]; }
for (const range of ["A3:B3","D3:E3","G3:H3","A5:B5","D5:E5","G5:H5"]) summary.getRange(range).format={fill:"#ECEFF1",borders:{preset:"outside",style:"thin",color:"#B0BEC5"},verticalAlignment:"center"};
summary.getRange("A3:A5").format.font={bold:true,color:"#455A64"}; summary.getRange("D3:D5").format.font={bold:true,color:"#455A64"}; summary.getRange("G3:G5").format.font={bold:true,color:"#455A64"};
summary.getRange("B3:B5").format.font={bold:true,size:16,color:"#00897B"}; summary.getRange("E3:E5").format.font={bold:true,size:16,color:"#00897B"}; summary.getRange("H3:H5").format.font={bold:true,size:16,color:"#00897B"};
summary.getRange("A3:H5").format.rowHeight=30;

summary.getRange("A8:B8").values=[["環境グループ","件数"]];
summary.getRange("A9:A13").values=[["デスク併設"],["専用ラック/棚"],["エンクロージャー"],["レジン工程"],["複数台/ファーム"]];
summary.getRange("B9:B13").formulas=[["=COUNTIF('事例一覧'!M2:M101,\"デスク併設\")"],["=COUNTIF('事例一覧'!M2:M101,\"専用ラック/棚\")"],["=COUNTIF('事例一覧'!M2:M101,\"エンクロージャー\")"],["=COUNTIF('事例一覧'!M2:M101,\"レジン工程\")"],["=COUNTIF('事例一覧'!M2:M101,\"複数台/ファーム\")"]];
summary.getRange("A8:B8").format={fill:"#00897B",font:{bold:true,color:"#FFFFFF"}};
summary.getRange("A8:B13").format.borders={preset:"inside",style:"thin",color:"#CFD8DC"};
const chart = summary.charts.add("bar",summary.getRange("A8:B13"));
chart.title="設置構成の分布（100事例）"; chart.hasLegend=false; chart.xAxis={axisType:"textAxis",textStyle:{fontSize:10}}; chart.yAxis={numberFormatCode:"0",min:0}; chart.setPosition("D8","J15");

summary.getRange("A16:H16").merge(); summary.getRange("A16").values=[["調査基準"]]; summary.getRange("A16:H16").format={fill:"#455A64",font:{bold:true,color:"#FFFFFF"}};
summary.getRange("A17:H21").merge(true);
summary.getRange("A17:A21").values=[
  ["・対象：プリンターが机・棚・工房に実際に設置されている公開事例。製品単体写真だけのものは原則除外。"],
  ["・対策確認：外部排気、局所排気、隔離室などが本文または画像で確認できる場合。囲いだけは「一部」。"],
  ["・懸念あり：寝室など長時間滞在する空間で、対策不足が投稿内でも問題になっている例。"],
  ["・証拠レベル A：本文で構成確認、B：画像/検索要約で主要配置確認、C：情報が限定的または概念例。"],
  ["・安全判定ではなく公開情報の観察結果。実設計では材料SDS、機器メーカー、建物条件を別途確認する。"],
];
summary.getRange("A17:H21").format={fill:"#FAFAFA",font:{color:"#37474F",size:10},wrapText:true,verticalAlignment:"center",borders:{preset:"outside",style:"thin",color:"#CFD8DC"}}; summary.getRange("A17:H21").format.rowHeight=28;
summary.getRange("A23:H23").merge(); summary.getRange("A23").values=[["主要な示唆"]]; summary.getRange("A23:H23").format={fill:"#F57C00",font:{bold:true,color:"#FFFFFF"}};
summary.getRange("A24:H28").merge(true);
summary.getRange("A24:A28").values=[
  ["1. PCと同じ天板に置くより、独立ラックまたは重量のある作業台に分ける例が多い。"],
  ["2. 複数台環境では金属棚・縦積み・中央監視PCが定番。保守アクセスと各段の振動対策が重要。"],
  ["3. 材料は上段スプール、側面ラック、下段ドライボックスの三方式に集約される。"],
  ["4. レジンは印刷・洗浄・二次硬化・汚染物保管を一つの工程として分離する必要がある。"],
  ["5. 囲いは温度・騒音・粉じん管理に役立つが、外部排気や適切なろ過の代替とは限らない。"],
];
summary.getRange("A24:H28").format={fill:"#FFF3E0",font:{color:"#8D3A00",size:10},wrapText:true,verticalAlignment:"center",borders:{preset:"outside",style:"thin",color:"#FFB74D"}}; summary.getRange("A24:H28").format.rowHeight=28;
summary.getRange("A1:J28").format.font.name="Aptos";
for (const [col,w] of [["A",24],["B",12],["C",4],["D",24],["E",12],["F",4],["G",24],["H",12],["I",12],["J",12]]) summary.getRange(`${col}1:${col}28`).format.columnWidth=w;

refs.showGridLines=false;
refs.getRange("A1:F1").merge(); refs.getRange("A1").values=[["安全対策の参照基準（事例評価の読み方）"]]; refs.getRange("A1:F1").format={fill:"#37474F",font:{bold:true,color:"#FFFFFF",size:18},verticalAlignment:"center"}; refs.getRange("A1:F1").format.rowHeight=36;
refs.getRange("A3:F8").values=[
  ["機関","主題","調査表への適用","要点","出典URL","確認日"],
  ["NIOSH/CDC","3D印刷の排出と工学的対策","FDM・複数台","局所排気、囲い付き排気ラック、HEPA等を工学的対策として例示","https://www.cdc.gov/niosh/bulletin/2018/3d-printing.html",researchedAt],
  ["NIOSH/CDC","Makerspace等の安全ガイド","全方式・後処理","隔離/負圧区画、局所排気、化学作業の換気、手袋・眼保護等を整理","https://www.cdc.gov/niosh/docs/2024-103/pdfs/2024-103.pdf",researchedAt],
  ["NIOSH/CDC","Additive Manufacturing hazards","全方式","方式・材料・環境によりVOC、皮膚接触、火災、機械/人間工学的危険が異なる","https://www.cdc.gov/niosh/manufacturing/additive/index.html",researchedAt],
  ["US EPA","室内粒子状物質と3Dプリンター","主にFDM","低排出の機器/材料、換気、排気、空気清浄の検討を案内","https://www.epa.gov/indoor-air-quality-iaq/sources-indoor-particulate-matter-pm",researchedAt],
  ["University of Pennsylvania EHRS","3D Printing Fact Sheet","教育・研究施設","複数台、ABS、接着剤等では追加換気や施設安全部門への相談を推奨","https://ehrs.upenn.edu/sites/default/files/2020-12/3D%20Printng%20Fact%20Sheet%20js9-20.pdf",researchedAt],
];
refs.freezePanes.freezeRows(3);
refs.getRange("A3:F3").format={fill:"#00897B",font:{bold:true,color:"#FFFFFF"},wrapText:true};
refs.getRange("A4:F8").format={wrapText:true,verticalAlignment:"top",borders:{preset:"inside",style:"thin",color:"#CFD8DC"}};
refs.getRange("F4:F8").format.numberFormat="yyyy-mm-dd";
const refWidths=[24,28,22,58,64,14]; for(let i=0;i<refWidths.length;i++) refs.getRangeByIndexes(0,i,8,1).format.columnWidth=refWidths[i];
refs.getRange("3:3").format.rowHeight=30; refs.getRange("4:8").format.rowHeight=54;
refs.getRange("A10:F10").merge(); refs.getRange("A10").values=[["注意：このシートは一般的な参照基準の要約であり、個別環境の安全保証ではありません。レジン・溶剤・高機能フィラメントは製品SDSとメーカー指示を優先してください。"]];
refs.getRange("A10:F10").format={fill:"#FFF3E0",font:{bold:true,color:"#8D3A00"},wrapText:true,borders:{preset:"outside",style:"thin",color:"#FFB74D"}}; refs.getRange("A10:F10").format.rowHeight=42;

await fs.mkdir(outputDir,{recursive:true});
const p1=await wb.render({sheetName:"サマリー",range:"A1:J28",scale:1.2,format:"png"}); await fs.writeFile(`${outputDir}/summary-preview.png`,new Uint8Array(await p1.arrayBuffer()));
const p2=await wb.render({sheetName:"事例一覧",range:"A1:N101",scale:0.5,format:"png"}); await fs.writeFile(`${outputDir}/data-preview.png`,new Uint8Array(await p2.arrayBuffer()));
const p3=await wb.render({sheetName:"事例一覧",range:"A1:N18",scale:1.05,format:"png"}); await fs.writeFile(`${outputDir}/data-detail-preview.png`,new Uint8Array(await p3.arrayBuffer()));
const p4=await wb.render({sheetName:"安全参照基準",range:"A1:F10",scale:1.1,format:"png"}); await fs.writeFile(`${outputDir}/references-preview.png`,new Uint8Array(await p4.arrayBuffer()));
const xlsx=await SpreadsheetFile.exportXlsx(wb); await xlsx.save(`${outputDir}/3D_printer_desk_setups_100.xlsx`);

const s=await wb.inspect({kind:"table",range:"サマリー!A1:J28",include:"values,formulas",tableMaxRows:28,tableMaxCols:10,maxChars:7000});
const d=await wb.inspect({kind:"table",range:"事例一覧!A1:N8",include:"values,formulas",tableMaxRows:8,tableMaxCols:14,maxChars:7000});
const q=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"final formula error scan",maxChars:3000});
console.log(s.ndjson); console.log(d.ndjson); console.log(q.ndjson);
