CREATE FUNCTION account_security.public_fields(p_object JSONB, p_keys TEXT[])
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM jsonb_each(p_object) WHERE key = ANY(p_keys);
$$;
REVOKE ALL ON FUNCTION account_security.public_fields(JSONB, TEXT[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_link_shared_desk(p_desk_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT account_security.public_fields(to_jsonb(d), ARRAY[
    'id','user_id','title','description','visibility','total_price','purposes','attributes',
    'owner_name','owner_tag','owner_avatar_url','owner_profile_public','share_snapshot',
    'like_count','clap_round_at','created_at','desk_created_at','updated_at','content_updated_at'
  ]) || jsonb_build_object(
    'desk_photos', COALESCE((SELECT jsonb_agg(account_security.public_fields(to_jsonb(p),
      ARRAY['id','desk_id','image_url','sort_order','created_at']) ORDER BY p.sort_order)
      FROM public.desk_photos p WHERE p.desk_id = d.id), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(account_security.public_fields(to_jsonb(v),
      ARRAY['id','desk_id','name','brand','brand_aliases','category','price','ports','product_id',
        'purchased_at','removed_at','created_at'])) FROM public.devices v WHERE v.desk_id = d.id), '[]'::jsonb),
    'connections', COALESCE((SELECT jsonb_agg(account_security.public_fields(to_jsonb(c),
      ARRAY['id','desk_id','from_device_id','to_device_id','cable_type','label','branch_group_id',
        'cable_choice','cable_name','cable_product_id','cable_count','created_at']))
      FROM public.connections c WHERE c.desk_id = d.id), '[]'::jsonb)
  ) FROM public.desks d WHERE d.id = public.resolve_link_shared_desk_id(p_desk_id);
$$;
REVOKE ALL ON FUNCTION public.get_link_shared_desk(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_link_shared_desk(UUID) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
