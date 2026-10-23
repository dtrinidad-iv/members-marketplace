-- =============================================================================
-- Members Marketplace — Supabase schema, RLS and Storage policies
-- Run in Supabase SQL editor (or `supabase db push` as a migration).
--
-- Security model (the browser only ever holds the public anon key):
--   * anon          → can call get_listing_previews() only (safe teaser columns)
--   * authenticated → can read/write their own profile name + their saved items
--   * active member → can read all published listings + images, post listings
--   * membership_status / role can NEVER be changed from the browser
--     (column-level grants), only by an admin / service role / webhook.
-- =============================================================================

create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text not null default '' check (char_length(display_name) <= 80),
  membership_status text not null default 'pending'
                    check (membership_status in ('pending', 'active', 'suspended')),
  role              text not null default 'member' check (role in ('member', 'admin')),
  created_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may only see their own profile row.
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- Users may update their own row …
create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- … but only the display_name column. membership_status/role are not writable
-- from the client even if someone crafts a request with the anon key + JWT.
revoke update on public.profiles from authenticated, anon;
grant  update (display_name) on public.profiles to authenticated;

-- Create a profile automatically on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 80), ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by every member-gated policy. SECURITY DEFINER so it can read
-- profiles without recursive RLS; STABLE so Postgres caches it per statement.
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and membership_status = 'active'
  );
$$;

revoke execute on function public.is_active_member() from anon, public;
grant  execute on function public.is_active_member() to authenticated;

-- -----------------------------------------------------------------------------
-- Listings
-- -----------------------------------------------------------------------------
create table if not exists public.listings (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  seller_display_name text not null default '',
  title               text not null check (char_length(title) between 3 and 120),
  description         text not null default '' check (char_length(description) <= 4000),
  category            text not null,
  city                text not null default '',
  price_cents         integer not null default 0 check (price_cents >= 0),
  contact_email       text not null default '',
  image_path          text,
  status              text not null default 'published'
                      check (status in ('draft', 'published', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  fts tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored
);

create index if not exists listings_status_created_idx on public.listings (status, created_at desc);
create index if not exists listings_category_idx       on public.listings (category);
create index if not exists listings_seller_idx         on public.listings (seller_id);
create index if not exists listings_fts_idx            on public.listings using gin (fts);

alter table public.listings enable row level security;

create policy "listings: active members read published, sellers read own"
  on public.listings for select
  to authenticated
  using (
    (status = 'published' and (select public.is_active_member()))
    or seller_id = (select auth.uid())
  );

create policy "listings: active members create as themselves"
  on public.listings for insert
  to authenticated
  with check (seller_id = (select auth.uid()) and (select public.is_active_member()));

create policy "listings: sellers update own"
  on public.listings for update
  to authenticated
  using (seller_id = (select auth.uid()))
  with check (seller_id = (select auth.uid()));

create policy "listings: sellers delete own"
  on public.listings for delete
  to authenticated
  using (seller_id = (select auth.uid()));

-- Server-controlled columns: the client can't spoof seller name or timestamps.
create or replace function public.listings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.seller_display_name := coalesce(
    (select display_name from public.profiles where id = new.seller_id), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists listings_before_write on public.listings;
create trigger listings_before_write
  before insert or update on public.listings
  for each row execute function public.listings_before_write();

-- Public teaser for visitors/pending members: only non-sensitive columns,
-- never description, price, contact details or the private image path.
create or replace function public.get_listing_previews(
  p_category text default null,
  p_limit    int  default 12
)
returns table (id uuid, title text, category text, city text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.title, l.category, l.city, l.created_at
  from public.listings l
  where l.status = 'published'
    and (p_category is null or l.category = p_category)
  order by l.created_at desc
  limit least(greatest(p_limit, 1), 24);
$$;

grant execute on function public.get_listing_previews(text, int) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Saved / bookmarked listings
-- -----------------------------------------------------------------------------
create table if not exists public.saved_listings (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

alter table public.saved_listings enable row level security;

create policy "saved: read own"   on public.saved_listings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "saved: insert own" on public.saved_listings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));
create policy "saved: delete own" on public.saved_listings for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Storage: private bucket, images readable by active members only.
-- Uploads must live under "<auth.uid()>/..." so users can't overwrite others.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "listing-images: active members read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'listing-images' and (select public.is_active_member()));

create policy "listing-images: members upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_member())
  );

create policy "listing-images: members delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
