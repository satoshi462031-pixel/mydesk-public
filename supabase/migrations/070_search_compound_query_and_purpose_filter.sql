-- =============================================================
-- Migration 070: 複合語の検索語を辞書で解釈し、用途チップで絞れるようにする
--
-- 068 で用途のエイリアス（purpose_search_aliases）とスコア順が入ったが、
-- 絞り込み側の判定は strpos(対象, 検索語) の片方向のままだった。日本語は
-- 空白で区切られないので「ゲーミング環境」は1語で飛んでくる。辞書に
-- 「ゲーミング環境」という語が無い以上、用途 gaming のデスクには当たらない。
-- 068 の ORDER BY にだけ p.query LIKE alias || '%' の逆向きがあるが、
-- そこへ来る前に WHERE で落ちている。
--
-- 変えたのは3点。
--   1) 辞書（用途・機材カテゴリ）に限り、包含を両方向で見る。
--      「ゲーミング環境」⊃「ゲーミング」で用途 gaming に当たる。
--      自由文（タイトル・説明・投稿者名・機材名）は片方向のまま。辞書と違って
--      短い語が入りうるので、逆向きを許すと無関係なデスクが混ざる。
--   2) 機材カテゴリの辞書も、用途と同じ配列の関数に切り出す。
--      検索本体に CASE を直書きしていると、語を足すたびに関数ごと作り直す。
--   3) 用途チップ用の p_purpose を足す。チップは表記ゆれを解釈させず、
--      purposes の保存値そのもので絞る（辞書に載っていない言い回しでも当たる、
--      という検索の曖昧さを絞り込みに持ち込まない）。
--
-- スコア順（068）はそのまま。引数が増えるので DROP してから作り直す。
-- =============================================================

-- ─── 用途の辞書 ──────────────────────────────────────────────
-- 068 の語彙に、逆向きの包含で拾いたい言い回しを足す。
CREATE OR REPLACE FUNCTION public.purpose_search_aliases(p_purpose TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE p_purpose
    WHEN 'gaming' THEN ARRAY['gaming', 'game', 'ゲーム', 'ゲーミング', 'eスポーツ', 'esports', 'pcゲーム', 'コンソール']
    WHEN 'work' THEN ARRAY['work', '仕事', 'リモートワーク', 'remote work', '在宅勤務', '在宅', 'テレワーク', 'デスクワーク', 'オフィス', 'business']
    WHEN 'dev' THEN ARRAY['development', 'developer', 'dev', '開発', 'プログラミング', 'programming', 'coding', 'コーディング', 'エンジニア']
    WHEN 'creative' THEN ARRAY['creative', 'クリエイティブ', '制作', '動画編集', '写真編集', '編集', 'デザイン', 'イラスト', '3d制作', 'cg']
    WHEN 'streaming' THEN ARRAY['streaming', 'stream', '配信', 'ライブ配信', '録画', 'ライブ', '実況', 'youtube', 'vtuber']
    WHEN 'study' THEN ARRAY['study', '学習', '勉強', '自習', '読書', '資格', '受験']
    WHEN 'music' THEN ARRAY['music', '音楽', 'dtm', 'daw', 'dj', '作曲', '宅録', 'レコーディング', 'ミックス', 'マスタリング']
    WHEN 'trading' THEN ARRAY['trading', 'trade', 'トレード', 'トレーディング', 'デイトレ', '投資', '株式投資', '資産運用', '株', 'fx', '仮想通貨', '暗号資産', '相場']
    WHEN 'other' THEN ARRAY['other', 'その他', 'カスタム']
    ELSE ARRAY[p_purpose]
  END;
$$;

-- ─── 機材カテゴリの辞書 ──────────────────────────────────────
-- 065・068 が検索本体に直書きしていた CASE を、用途と同じ形の関数へ出す。
CREATE OR REPLACE FUNCTION public.device_category_search_aliases(p_category TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE p_category
    WHEN 'PC' THEN ARRAY['pc', 'パソコン', 'デスクトップ']
    WHEN 'Monitor' THEN ARRAY['monitor', 'display', 'モニター', 'ディスプレイ']
    WHEN 'TV' THEN ARRAY['tv', 'television', 'テレビ']
    WHEN 'Projector' THEN ARRAY['projector', 'プロジェクター']
    WHEN 'Dock' THEN ARRAY['dock', 'docking station', 'ドッキングステーション']
    WHEN 'Hub' THEN ARRAY['usb hub', 'hub', 'usbハブ', 'ハブ']
    WHEN 'Mouse' THEN ARRAY['mouse', 'マウス']
    WHEN 'Keyboard' THEN ARRAY['keyboard', 'キーボード']
    WHEN 'Speaker' THEN ARRAY['speaker', 'スピーカー']
    WHEN 'Headphone' THEN ARRAY['headphone', 'ヘッドホン', 'ヘッドセット']
    WHEN 'Earphone' THEN ARRAY['earphone', 'イヤホン']
    WHEN 'Light' THEN ARRAY['light', 'ライト', '照明']
    WHEN 'Webcam' THEN ARRAY['webcam', 'webカメラ']
    WHEN 'Camera' THEN ARRAY['camera', 'カメラ']
    WHEN 'Lens' THEN ARRAY['lens', 'レンズ']
    WHEN 'Tripod' THEN ARRAY['tripod', 'stand', '三脚', 'スタンド']
    WHEN 'Microphone' THEN ARRAY['microphone', 'mic', 'マイク']
    WHEN 'Storage' THEN ARRAY['storage', 'ssd', 'hdd', 'ストレージ']
    WHEN 'Router' THEN ARRAY['router', 'ルーター']
    WHEN 'NetworkSwitch' THEN ARRAY['network switch', 'スイッチングハブ']
    WHEN 'Modem' THEN ARRAY['modem', 'onu', 'モデム']
    WHEN 'GameConsole' THEN ARRAY['game console', 'ゲーム機', 'ゲーム']
    WHEN 'CaptureDevice' THEN ARRAY['capture device', 'キャプチャーデバイス', 'キャプチャ']
    WHEN 'StreamingDevice' THEN ARRAY['streaming device', 'ストリーミング端末']
    WHEN 'KVM' THEN ARRAY['kvm', 'kvm switch', 'kvmスイッチ']
    WHEN 'Printer3D' THEN ARRAY['3d printer', '3dプリンター']
    WHEN 'Printer' THEN ARRAY['printer', 'プリンター']
    WHEN 'PenTablet' THEN ARRAY['pen tablet', 'ペンタブレット', 'ペンタブ', '液タブ']
    WHEN 'Charger' THEN ARRAY['charger', '充電器']
    WHEN 'MobileBattery' THEN ARRAY['power bank', 'mobile battery', 'モバイルバッテリー']
    WHEN 'AudioInterface' THEN ARRAY['audio interface', 'オーディオインターフェース']
    WHEN 'HeadphoneAmp' THEN ARRAY['headphone amp', 'dac', 'ヘッドホンアンプ']
    WHEN 'Amplifier' THEN ARRAY['amplifier', 'amp', 'アンプ']
    WHEN 'Mixer' THEN ARRAY['mixer', 'ミキサー']
    WHEN 'SmartHome' THEN ARRAY['smart home', 'スマートホーム']
    WHEN 'Smartphone' THEN ARRAY['smartphone', 'スマートフォン', 'スマホ']
    WHEN 'Tablet' THEN ARRAY['tablet', 'タブレット']
    WHEN 'PowerStrip' THEN ARRAY['power strip', '電源タップ', 'タップ']
    WHEN 'UPS' THEN ARRAY['ups', 'uninterruptible power supply', '無停電電源装置']
    WHEN 'Desk' THEN ARRAY['desk', 'デスク', '机', '昇降デスク']
    WHEN 'Chair' THEN ARRAY['chair', 'チェア', '椅子']
    WHEN 'VRGlass' THEN ARRAY['vr', 'smart glasses', 'スマートグラス']
    WHEN 'Smartwatch' THEN ARRAY['smartwatch', 'スマートウォッチ']
    WHEN 'WallPanel' THEN ARRAY['wall panel', 'ウォールパネル', '有孔ボード']
    WHEN 'Accessory' THEN ARRAY['accessory', '小物', '家電']
    WHEN 'DeskPad' THEN ARRAY['desk mat', 'desk pad', 'デスクマット']
    WHEN 'MousePad' THEN ARRAY['mouse pad', 'マウスパッド']
    WHEN 'Furniture' THEN ARRAY['furniture', '家具']
    WHEN 'Plant' THEN ARRAY['plant', '観葉植物']
    WHEN 'SmallDevice' THEN ARRAY['small device', '小型機器']
    WHEN 'PCPart' THEN ARRAY['pc parts', 'pcパーツ']
    WHEN 'Controller' THEN ARRAY['controller', 'コントローラー']
    WHEN 'MonitorArm' THEN ARRAY['monitor arm', 'モニターアーム']
    WHEN 'MicArm' THEN ARRAY['microphone arm', 'mic arm', 'マイクアーム']
    WHEN 'Cable' THEN ARRAY['cable', 'ケーブル']
    WHEN 'Instrument' THEN ARRAY['instrument', '楽器']
    WHEN 'Other' THEN ARRAY['other', 'その他']
    ELSE ARRAY[p_category]
  END;
$$;

-- 辞書の語と検索語を突き合わせる。
--   ・strpos(語, 検索語)  … 「ゲー」で「ゲーム」に当てる従来の前方部分一致
--   ・strpos(検索語, 語)  … 「ゲーミング環境」から「ゲーミング」を拾う今回の追加
-- 逆向きは2文字以上の語だけに許す。1文字まで許すと、ほとんどの検索語が
-- どれかの辞書に当たって絞り込みにならない（'株' はその理由で逆向きに効かない）。
CREATE OR REPLACE FUNCTION public.search_alias_matches(p_aliases TEXT[], p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(coalesce(p_aliases, ARRAY[]::TEXT[])) AS alias(value)
    WHERE lower(alias.value) <> ''
      AND (
        strpos(lower(alias.value), p_token) > 0
        OR (char_length(alias.value) >= 2 AND strpos(p_token, lower(alias.value)) > 0)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.purpose_search_aliases(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.device_category_search_aliases(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_alias_matches(TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purpose_search_aliases(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.device_category_search_aliases(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_alias_matches(TEXT[], TEXT) TO anon, authenticated;

-- ─── 検索本体 ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ);

CREATE FUNCTION public.search_public_desks(
  p_query TEXT,
  p_limit INTEGER DEFAULT 20,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_purpose TEXT DEFAULT NULL
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
      -- 用途チップ。表記ゆれと無関係に当てたいので、辞書ではなく保存値そのもので絞る
      AND (p_purpose IS NULL OR d.purposes @> ARRAY[p_purpose])
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
        -- 「ゲーミング環境」のような複合語から、辞書の語を拾う
        OR EXISTS (
          SELECT 1
          FROM unnest(d.purposes) AS purpose(value)
          WHERE public.search_alias_matches(public.purpose_search_aliases(purpose.value), token.term)
        )
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
              OR public.search_alias_matches(
                public.device_category_search_aliases(device.category), token.term)
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

REVOKE ALL ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
