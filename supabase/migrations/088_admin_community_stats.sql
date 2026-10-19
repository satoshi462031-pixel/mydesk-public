-- =============================================================
-- Migration 088: /admin/community（投稿・運営）用の集計
--
-- /admin は PostHog（アプリ内の行動）、/admin/gadgets は公開デスクの機材の在籍期間を
-- 見ている。どちらにも無い「DB にしか無い事実」をここで集計する。
--   ・公開デスク・いいね・フォロー・登録の推移
--   ・ストアの課金実績（RevenueCat webhook が書いた subscription_events）
--   ・通報・フィードバック・AI回答の通報（対応が要るもの）
--   ・商品マスタに無い手入力の機材名と、自作ジャンルの名前（商品マスタ・既定ジャンルを足す材料）
--
-- 個人を特定できる値は返さない。ユーザーID・通報者・メール・表示名は出さず、
-- 返すのは件数と、もともと公開されているもの（公開デスクの題名・機材名）と、
-- 本人が運営宛てに書いたフィードバック本文だけ。フィードバックの user_id も返さない。
--
-- 公式デモの所有アカウント（087 と同じデスクID）は、登録・課金・公開の数から除く。
-- 数十人規模のうちは4件でも比率が大きく動くため。いいねは閲覧者の行動なので除かない。
--
-- 043 と同じく service_role にだけ実行権限を渡し、Worker が secret の鍵で叩く。
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_community_overview(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH
  params AS (
    -- 画面の期間切り替えと同じ3択だけ受ける。任意の値で重い集計を回させない
    SELECT CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END AS days
  ),
  -- 日の区切りは日本時間。DB の current_date は UTC なので、朝9時までの行が前日に数えられる
  today AS (
    SELECT (now() AT TIME ZONE 'Asia/Tokyo')::DATE AS day
  ),
  win AS (
    SELECT (((SELECT day FROM today) - (SELECT days FROM params) + 1)::TIMESTAMP AT TIME ZONE 'Asia/Tokyo') AS since
  ),
  demo_owners AS (
    SELECT DISTINCT user_id FROM desks
    WHERE id = ANY(ARRAY[
      '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
      '458fa607-269b-421d-a619-01375992fb97',
      'c40c79b0-5aaa-47fb-a271-a5e45026c230',
      'ebab39f1-c298-411a-9b79-40c89837e313'
    ]::UUID[])
  ),
  community_desks AS (
    SELECT d.* FROM desks d
    WHERE NOT EXISTS (SELECT 1 FROM demo_owners o WHERE o.user_id = d.user_id)
  ),
  shared_desks AS (
    SELECT * FROM community_desks WHERE visibility IN ('public', 'unlisted')
  ),
  day_series AS (
    SELECT generate_series(
      (SELECT day FROM today) - (SELECT days FROM params) + 1, (SELECT day FROM today), INTERVAL '1 day'
    )::DATE AS day
  ),
  -- 公開中デスクの機材（share_snapshot）。枠のまま（isPlaceholder）とケーブルは除く
  snapshot_gadgets AS (
    SELECT d.user_id, g.item
    FROM shared_desks d
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(d.share_snapshot->'gadgets') = 'array' THEN d.share_snapshot->'gadgets' ELSE '[]'::JSONB END
    ) AS g(item)
    WHERE COALESCE(g.item->>'isPlaceholder', 'false') <> 'true'
      AND COALESCE(g.item->>'category', '') <> 'Cable'
      AND g.item->>'deletedAt' IS NULL
  )
  SELECT jsonb_build_object(
    'days', (SELECT days FROM params),
    'since', (SELECT since FROM win),

    'desks', (
      SELECT jsonb_build_object(
        'public',        count(*) FILTER (WHERE visibility = 'public'),
        'unlisted',      count(*) FILTER (WHERE visibility = 'unlisted'),
        'unpublished',   count(*) FILTER (WHERE visibility = 'private'),
        'owners',        count(DISTINCT user_id) FILTER (WHERE visibility IN ('public', 'unlisted')),
        'new_in_range',  count(*) FILTER (WHERE visibility IN ('public', 'unlisted') AND created_at >= (SELECT since FROM win)),
        -- 中身（機材・写真）を変えて公開し直したデスク。060 の content_updated_at
        'updated_in_range', count(*) FILTER (WHERE visibility IN ('public', 'unlisted') AND content_updated_at >= (SELECT since FROM win))
      )
      FROM community_desks
    ),

    'people', (
      SELECT jsonb_build_object(
        'accounts',        count(*),
        'new_in_range',    count(*) FILTER (WHERE p.created_at >= (SELECT since FROM win)),
        'with_public_desk', (SELECT count(DISTINCT user_id) FROM shared_desks)
      )
      FROM profiles p
      WHERE NOT EXISTS (SELECT 1 FROM demo_owners o WHERE o.user_id = p.id)
    ),

    'engagement', jsonb_build_object(
      'likes_total',     (SELECT count(*) FROM likes),
      'likes_in_range',  (SELECT count(*) FROM likes WHERE created_at >= (SELECT since FROM win)),
      'likers_in_range', (SELECT count(DISTINCT user_id) FROM likes WHERE created_at >= (SELECT since FROM win)),
      'follows_total',   (SELECT count(*) FROM user_follows),
      'follows_in_range', (SELECT count(*) FROM user_follows WHERE created_at >= (SELECT since FROM win)),
      'bookmarks_total', (SELECT count(*) FROM bookmarks)
    ),

    -- 累計の折れ線の起点（期間の初日より前の件数）。日別の件数を足し上げて累計にする。
    -- 公開デスクは「いま公開中のデスクを公開日順に数えた累計」で、取り下げたものは含まない
    'base', jsonb_build_object(
      'signups', (SELECT count(*) FROM profiles p WHERE p.created_at < (SELECT since FROM win)
                    AND NOT EXISTS (SELECT 1 FROM demo_owners o WHERE o.user_id = p.id)),
      'desks',   (SELECT count(*) FROM shared_desks WHERE created_at < (SELECT since FROM win)),
      'likes',   (SELECT count(*) FROM likes WHERE created_at < (SELECT since FROM win)),
      'follows', (SELECT count(*) FROM user_follows WHERE created_at < (SELECT since FROM win))
    ),

    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', s.day,
        'signups', (SELECT count(*) FROM profiles p WHERE (p.created_at AT TIME ZONE 'Asia/Tokyo')::DATE = s.day
                      AND NOT EXISTS (SELECT 1 FROM demo_owners o WHERE o.user_id = p.id)),
        'desks',   (SELECT count(*) FROM shared_desks d WHERE (d.created_at AT TIME ZONE 'Asia/Tokyo')::DATE = s.day),
        'likes',   (SELECT count(*) FROM likes l WHERE (l.created_at AT TIME ZONE 'Asia/Tokyo')::DATE = s.day),
        'follows', (SELECT count(*) FROM user_follows f WHERE (f.created_at AT TIME ZONE 'Asia/Tokyo')::DATE = s.day)
      ) ORDER BY s.day), '[]'::JSONB)
      FROM day_series s
    ),

    -- 期間内にいいねを集めた公開デスク。URL限定は一覧に出さない（リンクを知る人だけの物）
    'top_desks', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.likes_in_range DESC, t.like_count DESC), '[]'::JSONB)
      FROM (
        SELECT d.id, d.title, d.like_count, count(l.id) AS likes_in_range
        FROM desks d
        JOIN likes l ON l.desk_id = d.id AND l.created_at >= (SELECT since FROM win)
        WHERE d.visibility = 'public'
        GROUP BY d.id, d.title, d.like_count
        ORDER BY likes_in_range DESC, d.like_count DESC
        LIMIT 10
      ) t
    ),

    'billing', jsonb_build_object(
      'pro_active', (
        SELECT count(*) FROM subscriptions s
        WHERE s.tier = 'pro' AND s.status IN ('active', 'grace_period')
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND NOT EXISTS (SELECT 1 FROM demo_owners o WHERE o.user_id = s.user_id)
      ),
      -- サンドボックス（審査・自分の購入テスト）は実績に混ぜない
      'events', (
        SELECT COALESCE(jsonb_object_agg(event_type, n), '{}'::JSONB)
        FROM (
          SELECT event_type, count(*) AS n
          FROM subscription_events
          WHERE event_at >= (SELECT since FROM win)
            AND COALESCE(environment, '') <> 'SANDBOX'
            AND apply_result IN ('applied', 'stale')
          GROUP BY event_type
        ) e
      )
    ),

    'moderation', jsonb_build_object(
      'reports_in_range', (SELECT count(*) FROM desk_reports WHERE created_at >= (SELECT since FROM win)),
      'reports_by_reason', (
        SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::JSONB)
        FROM (SELECT reason, count(*) AS n FROM desk_reports
              WHERE created_at >= (SELECT since FROM win) GROUP BY reason) r
      ),
      -- 通報されたデスク。通報者は出さない。非公開へ戻したデスクも対応済みの確認のため残す
      'reported_desks', (
        SELECT COALESCE(jsonb_agg(r ORDER BY r.last_reported_at DESC), '[]'::JSONB)
        FROM (
          SELECT d.id, d.title, d.visibility, count(*) AS reports, max(x.created_at) AS last_reported_at
          FROM desk_reports x JOIN desks d ON d.id = x.desk_id
          GROUP BY d.id, d.title, d.visibility
          ORDER BY max(x.created_at) DESC
          LIMIT 15
        ) r
      ),
      'ai_reports_open', (SELECT count(*) FROM ai_response_reports WHERE status IN ('open', 'reviewing')),
      'ai_reports_in_range', (SELECT count(*) FROM ai_response_reports WHERE created_at >= (SELECT since FROM win))
    ),

    'feedback', jsonb_build_object(
      'by_category', (
        SELECT COALESCE(jsonb_object_agg(category, n), '{}'::JSONB)
        FROM (SELECT category, count(*) AS n FROM feedback
              WHERE created_at >= (SELECT since FROM win) GROUP BY category) f
      ),
      'recent', (
        SELECT COALESCE(jsonb_agg(f ORDER BY f.created_at DESC), '[]'::JSONB)
        FROM (
          SELECT category, body, app_version, platform, created_at
          FROM feedback
          ORDER BY created_at DESC
          LIMIT 20
        ) f
      )
    ),

    -- 商品マスタに無い（productId の無い）機材名。持っている人の多い順。
    -- 表記ゆれは大文字小文字と前後の空白だけ寄せる（それ以上は別物を混ぜる）
    'manual_gadgets', (
      SELECT COALESCE(jsonb_agg(m ORDER BY m.owners DESC, m.gadgets DESC), '[]'::JSONB)
      FROM (
        SELECT min(item->>'name') AS name,
               mode() WITHIN GROUP (ORDER BY item->>'category') AS category,
               count(DISTINCT user_id) AS owners,
               count(*) AS gadgets
        FROM snapshot_gadgets
        WHERE COALESCE(item->>'productId', '') = ''
          AND COALESCE(trim(item->>'name'), '') <> ''
        GROUP BY lower(trim(item->>'name'))
        ORDER BY count(DISTINCT user_id) DESC, count(*) DESC
        LIMIT 30
      ) m
    ),
    -- 公開中デスクの機材をジャンル別に。自作ジャンルは 'Other' に入る
    'categories', (
      SELECT COALESCE(jsonb_agg(c ORDER BY c.gadgets DESC), '[]'::JSONB)
      FROM (
        SELECT COALESCE(item->>'category', 'Other') AS category,
               count(*) AS gadgets,
               count(DISTINCT user_id) AS owners,
               count(*) FILTER (WHERE COALESCE(item->>'productId', '') = '') AS without_product
        FROM snapshot_gadgets
        GROUP BY 1
        ORDER BY count(*) DESC
        LIMIT 20
      ) c
    ),
    'manual_ratio', (
      SELECT jsonb_build_object(
        'gadgets', count(*),
        'without_product', count(*) FILTER (WHERE COALESCE(item->>'productId', '') = '')
      )
      FROM snapshot_gadgets
    ),

    -- 自作ジャンル。多くの人が作っている名前は、既定のジャンルに足す候補
    'custom_categories', (
      SELECT COALESCE(jsonb_agg(c ORDER BY c.owners DESC, c.gadgets DESC), '[]'::JSONB)
      FROM (
        SELECT min(item->'customCategory'->>'name') AS name,
               mode() WITHIN GROUP (ORDER BY item->'customCategory'->>'icon') AS icon,
               count(DISTINCT user_id) AS owners,
               count(*) AS gadgets
        FROM snapshot_gadgets
        WHERE item->>'category' = 'Other'
          AND COALESCE(trim(item->'customCategory'->>'name'), '') <> ''
        GROUP BY lower(trim(item->'customCategory'->>'name'))
        ORDER BY count(DISTINCT user_id) DESC, count(*) DESC
        LIMIT 30
      ) c
    )
  )
$fn$;

REVOKE ALL ON FUNCTION public.admin_community_overview(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_community_overview(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
