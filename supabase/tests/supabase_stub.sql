-- Minimal-Nachbau der Supabase-Umgebung für lokale Rechte-Tests.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
create schema if not exists cron;
create or replace function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
create schema if not exists extensions; grant usage on schema extensions to anon, authenticated; create extension if not exists pgcrypto schema extensions; create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists btree_gist;
do $$ begin create publication supabase_realtime; exception when others then null; end $$;
grant usage on schema public to anon, authenticated;
-- Eigentümer-Rolle wie bei Supabase: postgres umgeht RLS (BYPASSRLS), ist
-- aber kein Superuser. Die Live-Struktur wird als postgres angelegt, damit
-- Views ohne security_invoker sich exakt wie live verhalten.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres bypassrls; end if;
end $$;
grant usage, create on schema public to postgres;
grant usage on schema auth, extensions, storage, cron to postgres;
grant all on auth.users to postgres;
grant all on storage.objects, storage.buckets to postgres;
alter table storage.objects owner to postgres;
grant anon, authenticated, service_role to postgres;
