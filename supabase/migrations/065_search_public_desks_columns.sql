-- =============================================================
-- Migration 065: 検索結果にも投稿者アイコン・属性・機材更新日を返す
--
-- 055 の search_public_desks は戻り列を固定しており、そのあとに足した
-- 058（attributes）・059（owner_avatar_url）・061（content_updated_at）が
-- 入っていない。一覧（desks を直接 select）では出るのに、検索したとたん
-- 同じデスクの投稿者アイコンが写真から文字に変わる。
--
-- 戻り値の型が変わるので CREATE OR REPLACE では置き換えられない。DROP してから
-- 作り直す。中身は 055 のまま、列を3つ足しただけ。
-- =============================================================

DROP FUNCTION IF EXISTS public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.search_public_desks(
  p_query TEXT,
  p_limit INTEGER DEFAULT 20,
  p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  title TEXT,
  owner_name TEXT,
  owner_tag TEXT,
  owner_avatar_url TEXT,
  purposes TEXT[],
  total_price INTEGER,
  updated_at TIMESTAMPTZ,
  content_updated_at TIMESTAMPTZ,
  attributes TEXT[],
  desk_photos JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT lower(left(trim(regexp_replace(coalesce(p_query, ''), '[[:space:]]+', ' ', 'g')), 80)) AS query
  ), tokens AS (
    SELECT value AS term
    FROM params
    CROSS JOIN LATERAL regexp_split_to_table(params.query, ' ') AS value
    WHERE value <> ''
  )
  SELECT
    d.id,
    d.user_id,
    d.title,
    d.owner_name,
    d.owner_tag,
    d.owner_avatar_url,
    d.purposes,
    d.total_price,
    d.updated_at,
    d.content_updated_at,
    d.attributes,
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', dp.id,
          'image_url', dp.image_url,
          'sort_order', dp.sort_order
        )
        ORDER BY dp.sort_order, dp.id
      )
      FROM public.desk_photos AS dp
      WHERE dp.desk_id = d.id
    ), '[]'::jsonb) AS desk_photos
  FROM public.desks AS d
  CROSS JOIN params AS p
  WHERE d.visibility = 'public'
    AND (p_before IS NULL OR d.updated_at < p_before)
    AND (
      p.query = ''
      OR NOT EXISTS (
        SELECT 1
        FROM tokens AS token
        WHERE NOT (
          strpos(lower(d.title), token.term) > 0
          OR strpos(lower(coalesce(d.description, '')), token.term) > 0
          OR strpos(lower(coalesce(d.owner_name, '')), token.term) > 0
          OR strpos(lower(coalesce(d.owner_tag, '')), token.term) > 0
          OR strpos(lower(array_to_string(d.purposes, ' ')), token.term) > 0
          OR strpos(lower(coalesce(d.share_snapshot->'plan'->>'otherPurposeLabel', '')), token.term) > 0
          -- 画面上で英語化している公式デスクも、表示された語のまま検索できるようにする。
          OR strpos(lower(CASE d.id
            WHEN '1053c603-25cc-46cb-aa06-284ac9d2fbaf'::UUID THEN
              'Gaming PC Switch 2 Entry-level Gaming PC 24-inch 165Hz Monitor Wireless Gaming Mouse Compact Mechanical Keyboard Wired Gaming Headset 6-Outlet Power Strip'
            WHEN '458fa607-269b-421d-a619-01375992fb97'::UUID THEN
              'Creator One Cable 14-inch Creator Laptop 27-inch USB-C Monitor Low-profile Bluetooth Keyboard Silent Bluetooth Mouse Portable SSD 1TB 6-Outlet Power Strip'
            WHEN 'c40c79b0-5aaa-47fb-a271-a5e45026c230'::UUID THEN
              'Music DTM Starter Setup Compact Production PC 24-inch IPS Monitor 2-Input Audio Interface Entry-level Condenser Microphone 25-key MIDI Keyboard Closed-back Monitor Headphones 6-Outlet Power Strip'
            WHEN 'ebab39f1-c298-411a-9b79-40c89837e313'::UUID THEN
              'Mobile Work Cafe Travel 13-inch Lightweight Laptop 65W USB-C Charger 10000mAh Power Bank Low-profile Bluetooth Mouse Mid-range Smartphone'
            ELSE ''
          END), token.term) > 0
          OR strpos(lower(CASE
            WHEN replace(coalesce(d.owner_tag, ''), '#', '') = '000000'
              THEN 'MyDesk Official MyDesk 公式 #000000'
            ELSE ''
          END), token.term) > 0
          OR EXISTS (
            SELECT 1
            FROM unnest(d.purposes) AS purpose(value)
            WHERE strpos(lower(CASE purpose.value
          WHEN 'gaming' THEN 'gaming ゲーム'
          WHEN 'work' THEN 'remote work 仕事 リモートワーク'
          WHEN 'dev' THEN 'development programming 開発 プログラミング'
          WHEN 'creative' THEN 'creative design クリエイティブ 制作'
          WHEN 'streaming' THEN 'streaming 配信'
          WHEN 'study' THEN 'study 勉強 学習'
          WHEN 'music' THEN 'music dtm 音楽'
          WHEN 'trading' THEN 'trading 投資 トレード'
          WHEN 'other' THEN 'other その他'
          ELSE purpose.value
            END), token.term) > 0
          )
          OR EXISTS (
            SELECT 1
            FROM public.devices AS device
            WHERE device.desk_id = d.id
              AND (
                strpos(lower(device.name), token.term) > 0
                OR strpos(lower(device.category), token.term) > 0
                OR strpos(lower(coalesce(device.brand, '')), token.term) > 0
                OR strpos(lower(CASE device.category
              WHEN 'PC' THEN 'pc パソコン'
              WHEN 'Monitor' THEN 'monitor モニター'
              WHEN 'TV' THEN 'tv television テレビ'
              WHEN 'Projector' THEN 'projector プロジェクター'
              WHEN 'Dock' THEN 'dock docking station ドッキングステーション'
              WHEN 'Hub' THEN 'usb hub usbハブ'
              WHEN 'Mouse' THEN 'mouse マウス'
              WHEN 'Keyboard' THEN 'keyboard キーボード'
              WHEN 'Speaker' THEN 'speaker スピーカー'
              WHEN 'Headphone' THEN 'headphone ヘッドホン'
              WHEN 'Earphone' THEN 'earphone イヤホン'
              WHEN 'Light' THEN 'light ライト'
              WHEN 'Webcam' THEN 'webcam webカメラ'
              WHEN 'Camera' THEN 'camera カメラ'
              WHEN 'Lens' THEN 'lens レンズ'
              WHEN 'Tripod' THEN 'tripod stand 三脚 スタンド'
              WHEN 'Microphone' THEN 'microphone mic マイク'
              WHEN 'Storage' THEN 'storage ストレージ'
              WHEN 'Router' THEN 'router ルーター'
              WHEN 'NetworkSwitch' THEN 'network switch スイッチングハブ'
              WHEN 'Modem' THEN 'modem onu モデム'
              WHEN 'GameConsole' THEN 'game console ゲーム機'
              WHEN 'CaptureDevice' THEN 'capture device キャプチャーデバイス'
              WHEN 'StreamingDevice' THEN 'streaming device ストリーミング端末'
              WHEN 'KVM' THEN 'kvm switch kvmスイッチ'
              WHEN 'Printer3D' THEN '3d printer 3dプリンター'
              WHEN 'Printer' THEN 'printer プリンター'
              WHEN 'PenTablet' THEN 'pen tablet ペンタブレット'
              WHEN 'Charger' THEN 'charger 充電器'
              WHEN 'MobileBattery' THEN 'power bank mobile battery モバイルバッテリー'
              WHEN 'AudioInterface' THEN 'audio interface オーディオインターフェース'
              WHEN 'HeadphoneAmp' THEN 'headphone amp dac ヘッドホンアンプ'
              WHEN 'Amplifier' THEN 'amplifier amp アンプ'
              WHEN 'Mixer' THEN 'mixer ミキサー'
              WHEN 'SmartHome' THEN 'smart home スマートホーム'
              WHEN 'Smartphone' THEN 'smartphone スマートフォン'
              WHEN 'Tablet' THEN 'tablet タブレット'
              WHEN 'PowerStrip' THEN 'power strip 電源タップ'
              WHEN 'UPS' THEN 'ups uninterruptible power supply 無停電電源装置'
              WHEN 'Desk' THEN 'desk デスク'
              WHEN 'Chair' THEN 'chair チェア 椅子'
              WHEN 'VRGlass' THEN 'vr smart glasses スマートグラス'
              WHEN 'Smartwatch' THEN 'smartwatch スマートウォッチ'
              WHEN 'WallPanel' THEN 'wall panel ウォールパネル'
              WHEN 'Accessory' THEN 'accessory 小物 家電'
              WHEN 'DeskPad' THEN 'desk mat desk pad デスクマット'
              WHEN 'MousePad' THEN 'mouse pad マウスパッド'
              WHEN 'Furniture' THEN 'furniture 家具'
              WHEN 'Plant' THEN 'plant 観葉植物'
              WHEN 'SmallDevice' THEN 'small device 小型機器'
              WHEN 'PCPart' THEN 'pc parts pcパーツ'
              WHEN 'Controller' THEN 'controller コントローラー'
              WHEN 'MonitorArm' THEN 'monitor arm モニターアーム'
              WHEN 'MicArm' THEN 'microphone arm mic arm マイクアーム'
              WHEN 'Cable' THEN 'cable ケーブル'
              WHEN 'Instrument' THEN 'instrument 楽器'
              WHEN 'Other' THEN 'other その他'
              ELSE device.category
                END), token.term) > 0
              )
          )
        )
      )
    )
  ORDER BY d.updated_at DESC, d.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
$$;

REVOKE ALL ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
