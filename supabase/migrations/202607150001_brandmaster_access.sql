-- Brandmaster Corporate GitHub access control.
-- Run this migration in the Supabase SQL editor before enabling the hosted login gate.

create table if not exists public.brandmaster_allowed_users (
  github_login text primary key check (github_login = lower(github_login)),
  role text not null default 'reviewer' check (role in ('admin', 'reviewer', 'viewer')),
  active boolean not null default true,
  added_at timestamptz not null default now(),
  added_by text
);

create table if not exists public.brandmaster_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_login text not null unique,
  display_name text,
  avatar_url text,
  role text not null default 'viewer' check (role in ('admin', 'reviewer', 'viewer')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

insert into public.brandmaster_allowed_users (github_login, role, active, added_by)
values ('bmeshesha', 'admin', true, 'initial migration')
on conflict (github_login) do update set role = excluded.role, active = true;

create or replace function public.brandmaster_github_login(metadata jsonb, email_address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(trim(leading '@' from coalesce(
    nullif(metadata ->> 'user_name', ''),
    nullif(metadata ->> 'preferred_username', ''),
    nullif(metadata ->> 'login', ''),
    nullif(metadata ->> 'nickname', ''),
    nullif(split_part(email_address, '@', 1), ''),
    'unknown'
  )));
$$;

create or replace function public.handle_brandmaster_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  login_name text;
  approved_role text;
  approved_active boolean;
  github_provider boolean;
begin
  login_name := public.brandmaster_github_login(new.raw_user_meta_data, new.email);
  github_provider := lower(coalesce(new.raw_app_meta_data ->> 'provider', '')) like '%github%'
    or lower(coalesce(new.raw_app_meta_data ->> 'providers', '')) like '%github%';

  select role, active into approved_role, approved_active
  from public.brandmaster_allowed_users
  where github_login = login_name;

  insert into public.brandmaster_profiles (id, github_login, display_name, avatar_url, role, active, last_seen_at)
  values (
    new.id,
    login_name,
    coalesce(new.raw_user_meta_data ->> 'name', login_name),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(approved_role, 'viewer'),
    coalesce(approved_active, false) and github_provider,
    now()
  )
  on conflict (id) do update set
    github_login = excluded.github_login,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    role = excluded.role,
    active = excluded.active,
    last_seen_at = excluded.last_seen_at;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_brandmaster on auth.users;
create trigger on_auth_user_created_brandmaster
after insert or update of raw_user_meta_data, raw_app_meta_data on auth.users
for each row execute procedure public.handle_brandmaster_user();

create or replace function public.sync_brandmaster_allowed_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.brandmaster_profiles
  set role = new.role, active = new.active
  where github_login = new.github_login;
  return new;
end;
$$;

drop trigger if exists on_brandmaster_allowed_user_changed on public.brandmaster_allowed_users;
create trigger on_brandmaster_allowed_user_changed
after insert or update on public.brandmaster_allowed_users
for each row execute procedure public.sync_brandmaster_allowed_user();

-- Backfill users who authenticated before this migration was installed.
insert into public.brandmaster_profiles (id, github_login, display_name, avatar_url, role, active)
select
  users.id,
  public.brandmaster_github_login(users.raw_user_meta_data, users.email),
  coalesce(users.raw_user_meta_data ->> 'name', public.brandmaster_github_login(users.raw_user_meta_data, users.email)),
  users.raw_user_meta_data ->> 'avatar_url',
  coalesce(allowed.role, 'viewer'),
  coalesce(allowed.active, false) and (
    lower(coalesce(users.raw_app_meta_data ->> 'provider', '')) like '%github%'
    or lower(coalesce(users.raw_app_meta_data ->> 'providers', '')) like '%github%'
  )
from auth.users users
left join public.brandmaster_allowed_users allowed
  on allowed.github_login = public.brandmaster_github_login(users.raw_user_meta_data, users.email)
on conflict (id) do update set
  github_login = excluded.github_login,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  role = excluded.role,
  active = excluded.active;

create or replace function public.is_brandmaster_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.brandmaster_profiles
    where id = auth.uid() and active and role = 'admin'
  );
$$;

alter table public.brandmaster_allowed_users enable row level security;
alter table public.brandmaster_profiles enable row level security;

drop policy if exists "Users can read their Brandmaster profile" on public.brandmaster_profiles;
create policy "Users can read their Brandmaster profile"
on public.brandmaster_profiles for select
to authenticated
using (id = auth.uid() or public.is_brandmaster_admin());

drop policy if exists "Users can update their last-seen profile" on public.brandmaster_profiles;
create policy "Users can update their last-seen profile"
on public.brandmaster_profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Admins can view approved Brandmaster users" on public.brandmaster_allowed_users;
create policy "Admins can view approved Brandmaster users"
on public.brandmaster_allowed_users for select
to authenticated
using (public.is_brandmaster_admin());

drop policy if exists "Admins can manage approved Brandmaster users" on public.brandmaster_allowed_users;
create policy "Admins can manage approved Brandmaster users"
on public.brandmaster_allowed_users for all
to authenticated
using (public.is_brandmaster_admin())
with check (public.is_brandmaster_admin());

revoke all on public.brandmaster_allowed_users from anon;
revoke all on public.brandmaster_profiles from anon;
revoke all on public.brandmaster_allowed_users from authenticated;
revoke all on public.brandmaster_profiles from authenticated;
grant select, insert, update, delete on public.brandmaster_allowed_users to authenticated;
grant select on public.brandmaster_profiles to authenticated;
grant update (last_seen_at) on public.brandmaster_profiles to authenticated;
