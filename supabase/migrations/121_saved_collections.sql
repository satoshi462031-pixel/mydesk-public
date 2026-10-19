-- 保存そのものは無制限。デスクと機材を共通の個人用フォルダへ整理する。
create table public.saved_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.saved_collection_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  collection_id uuid not null,
  bookmark_id uuid references public.bookmarks(id) on delete cascade,
  gadget_bookmark_id uuid references public.gadget_bookmarks(id) on delete cascade,
  foreign key (collection_id, user_id) references public.saved_collections(id, user_id) on delete cascade,
  check (num_nonnulls(bookmark_id, gadget_bookmark_id) = 1),
  unique (collection_id, bookmark_id),
  unique (collection_id, gadget_bookmark_id)
);
create index saved_collections_owner on public.saved_collections(user_id, created_at);
create index saved_collection_items_owner on public.saved_collection_items(user_id, collection_id);
create index saved_collection_items_bookmark on public.saved_collection_items(bookmark_id);
create index saved_collection_items_gadget on public.saved_collection_items(gadget_bookmark_id);

alter table public.saved_collections enable row level security;
alter table public.saved_collection_items enable row level security;
create policy collections_select on public.saved_collections for select to authenticated using (user_id = (select auth.uid()));
create policy collections_insert on public.saved_collections for insert to authenticated with check (user_id = (select auth.uid()));
create policy collections_update on public.saved_collections for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy collections_delete on public.saved_collections for delete to authenticated using (user_id = (select auth.uid()));
create policy collection_items_select on public.saved_collection_items for select to authenticated using (user_id = (select auth.uid()));
create policy collection_items_insert on public.saved_collection_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy collection_items_delete on public.saved_collection_items for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.saved_collections, public.saved_collection_items from anon, authenticated;
grant select, insert, delete on public.saved_collections, public.saved_collection_items to authenticated;
grant update (name) on public.saved_collections to authenticated;

create function public.guard_saved_collection_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from auth.uid() then
    raise exception 'COLLECTION_OWNER_MISMATCH' using errcode = '42501';
  end if;
  -- 複数端末から同時に4個目を作っても無料枠を超えない。
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 121));
  if not exists (select 1 from public.profiles where id = new.user_id and tier = 'pro')
     and (select count(*) from public.saved_collections where user_id = new.user_id) >= 3 then
    raise exception 'SAVED_COLLECTION_LIMIT';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;
create trigger saved_collection_limit before insert on public.saved_collections
for each row execute function public.guard_saved_collection_insert();

create function public.guard_saved_collection_item_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from auth.uid()
    or not exists (select 1 from public.saved_collections where id = new.collection_id and user_id = new.user_id)
    or (new.bookmark_id is not null and not exists (select 1 from public.bookmarks where id = new.bookmark_id and user_id = new.user_id))
    or (new.gadget_bookmark_id is not null and not exists (select 1 from public.gadget_bookmarks where id = new.gadget_bookmark_id and user_id = new.user_id)) then
    raise exception 'COLLECTION_OWNER_MISMATCH' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger saved_collection_item_owner before insert on public.saved_collection_items
for each row execute function public.guard_saved_collection_item_insert();
revoke all on function public.guard_saved_collection_insert(), public.guard_saved_collection_item_insert() from public, anon, authenticated;

-- 解約では既存フォルダ・項目を消さず、新しいフォルダの追加だけを制限する。
