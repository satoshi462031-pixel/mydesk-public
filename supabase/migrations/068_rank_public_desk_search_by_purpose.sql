-- 用途名・表記揺れ・関連語を検索対象にし、用途一致を一般の本文一致より上へ出す。

CREATE OR REPLACE FUNCTION public.purpose_search_aliases(p_purpose TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE p_purpose
    WHEN 'gaming' THEN ARRAY['gaming', 'game', 'ゲーム', 'ゲーミング', 'eスポーツ', 'esports', 'pcゲーム', 'コンソール']
    WHEN 'work' THEN ARRAY['work', '仕事', 'リモートワーク', 'remote work', '在宅勤務', 'テレワーク', 'オフィス', 'business']
    WHEN 'dev' THEN ARRAY['development', 'developer', '開発', 'プログラミング', 'programming', 'coding', 'エンジニア']
    WHEN 'creative' THEN ARRAY['creative', 'クリエイティブ', '制作', '動画編集', '写真編集', 'デザイン', 'イラスト', '3d制作', 'cg']
    WHEN 'streaming' THEN ARRAY['streaming', 'stream', '配信', '録画', 'ライブ', '実況', 'youtube', 'vtuber']
    WHEN 'study' THEN ARRAY['study', '学習', '勉強', '読書', '資格', '受験']
    WHEN 'music' THEN ARRAY['music', '音楽', 'dtm', 'daw', '作曲', '宅録', 'ミックス', 'マスタリング']
    WHEN 'trading' THEN ARRAY['trading', 'trade', 'トレード', '投資', '株式投資', '資産運用', '株', 'fx', '仮想通貨', '暗号資産', '相場']
    WHEN 'other' THEN ARRAY['other', 'その他', 'カスタム']
    ELSE ARRAY[p_purpose]
  END;
$$;

DROP FUNCTION IF EXISTS public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ);

CREATE FUNCTION public.search_public_desks(
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
  ), candidates AS (
    SELECT
      d.*,
      lower(coalesce((
        SELECT string_agg(array_to_string(public.purpose_search_aliases(purpose.value), ' '), ' ')
        FROM unnest(d.purposes) AS purpose(value)
      ), '')) AS purpose_text,
      lower(coalesce(d.share_snapshot->'plan'->>'otherPurposeLabel', '')) AS other_purpose
    FROM public.desks AS d
    WHERE d.visibility = 'public'
      AND (p_before IS NULL OR d.updated_at < p_before)
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
        jsonb_build_object('id', dp.id, 'image_url', dp.image_url, 'sort_order', dp.sort_order)
        ORDER BY dp.sort_order, dp.id
      )
      FROM public.desk_photos AS dp
      WHERE dp.desk_id = d.id
    ), '[]'::jsonb) AS desk_photos
  FROM candidates AS d
  CROSS JOIN params AS p
  WHERE p.query = ''
    OR NOT EXISTS (
      SELECT 1
      FROM tokens AS token
      WHERE NOT (
        strpos(lower(d.title), token.term) > 0
        OR strpos(lower(coalesce(d.description, '')), token.term) > 0
        OR strpos(lower(coalesce(d.owner_name, '')), token.term) > 0
        OR strpos(lower(coalesce(d.owner_tag, '')), token.term) > 0
        OR strpos(d.purpose_text, token.term) > 0
        OR strpos(d.other_purpose, token.term) > 0
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
          WHEN replace(coalesce(d.owner_tag, ''), '#', '') = '000000' THEN 'MyDesk Official MyDesk 公式 #000000'
          ELSE ''
        END), token.term) > 0
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
  ORDER BY
    CASE
      WHEN d.other_purpose = p.query THEN 5
      WHEN EXISTS (
        SELECT 1 FROM unnest(d.purposes) AS purpose(value)
        CROSS JOIN LATERAL unnest(public.purpose_search_aliases(purpose.value)) AS alias(value)
        WHERE lower(alias.value) = p.query
      ) THEN 4
      WHEN d.other_purpose LIKE p.query || '%' THEN 3
      WHEN EXISTS (
        SELECT 1 FROM unnest(d.purposes) AS purpose(value)
        CROSS JOIN LATERAL unnest(public.purpose_search_aliases(purpose.value)) AS alias(value)
        WHERE lower(alias.value) LIKE p.query || '%' OR p.query LIKE lower(alias.value) || '%'
      ) THEN 3
      WHEN NOT EXISTS (
        SELECT 1 FROM tokens AS token
        WHERE strpos(d.purpose_text || ' ' || d.other_purpose, token.term) = 0
      ) THEN 2
      WHEN EXISTS (
        SELECT 1 FROM tokens AS token
        WHERE strpos(d.purpose_text || ' ' || d.other_purpose, token.term) > 0
      ) THEN 1
      ELSE 0
    END DESC,
    d.updated_at DESC,
    d.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
$$;

REVOKE ALL ON FUNCTION public.purpose_search_aliases(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purpose_search_aliases(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
