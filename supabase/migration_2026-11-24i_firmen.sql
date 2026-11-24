-- ============================================================================
-- Migration 2026-11-24i: Stufe 3a - drei Firmen, Firma je Person und Saison.
--
-- Nutzer-Vorgabe 2026-11-24 (docs/zwei-personalstaemme-plan.md):
--   * Firmen: Mömmel Agrar GmbH & Co. KG (Landwirtschaft, Standard),
--     Mönich Landwirtschaft GmbH & Co. KG (Landwirtschaft),
--     Mönich Direkt GmbH & Co. KG (Vertrieb).
--   * Mönich/Mömmel: keine Rechte-Trennung, aber Kassenbuch, Lohn-
--     Monatsfilter, SEPA, Lohnsteuer-Antrag je Firma.
--   * Keine feste Regel Mönich/Mömmel -> Standard Mömmel ("der Großteil");
--     Vertrieb immer Mönich Direkt.
--
--  1. Tabelle firma (Name, Anschrift, Steuernummer, IBAN/BIC, Bereich,
--     Standard je Bereich, Lohn-Kassenbuch). Die bisherigen Firmen-
--     Bankdaten (firmen_bankdaten, Einzeile) werden zu Mömmel übernommen;
--     firmen_bankdaten bleibt vorerst stehen (alter App-Stand).
--  2. kassenbuch.firma (MLK + MÖ = Mömmel, ML = Mönich Landwirtschaft,
--     MD = Mönich Direkt).
--  3. employee_saison (Person + Saisonjahr -> Firma). Kein Eintrag = Standard-
--     Firma des Bereichs. firma_fuer(person, jahr) liefert die gültige Firma.
--  4. personal_kandidaten.firma (Planung; wird bei "Anreise vorbereiten"
--     übernommen) und lohnsteuerantrag.firma.
--
-- Ändert KEINEN Geldfluss und keine Berechnung (Kassenbuch je Buchung =
-- Stufe 3b, Lohnberechnung = Stufe 3c).
--
-- In der Supabase SQL-Konsole in einem Zug ausführen. Idempotent.
-- ============================================================================

begin;

-- 1) Firmen ----------------------------------------------------------------------
create table if not exists public.firma (
  kuerzel text primary key,
  name text not null,
  bereich text not null references public.geschaeftsbereich (kuerzel) on update cascade,
  ist_standard boolean not null default false,
  iban text,
  bic text,
  steuernummer text,
  strasse text,
  hausnummer text,
  plz text,
  ort text,
  lohn_kassenbuch_id bigint references public.kassenbuch (id),
  reihenfolge int not null default 0,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
-- je Bereich höchstens eine Standard-Firma
create unique index if not exists firma_ein_standard_je_bereich
  on public.firma (bereich) where ist_standard;

insert into public.firma (kuerzel, name, bereich, ist_standard, reihenfolge) values
  ('MA', 'Mömmel Agrar GmbH & Co. KG', 'LW', true, 10),
  ('ML', 'Mönich Landwirtschaft GmbH & Co. KG', 'LW', false, 20),
  ('MD', 'Mönich Direkt GmbH & Co. KG', 'VT', true, 30)
on conflict (kuerzel) do nothing;

-- Bisherige Bankdaten/Anschrift (firmen_bankdaten = Mömmel) übernehmen,
-- nur wo bei Mömmel noch nichts steht.
update public.firma f set
  iban = coalesce(f.iban, b.iban),
  bic = coalesce(f.bic, b.bic),
  steuernummer = coalesce(f.steuernummer, b.steuernummer),
  strasse = coalesce(f.strasse, b.strasse),
  hausnummer = coalesce(f.hausnummer, b.hausnummer),
  plz = coalesce(f.plz, b.plz),
  ort = coalesce(f.ort, b.ort)
from public.firmen_bankdaten b
where f.kuerzel = 'MA' and b.id = 1;

alter table public.firma enable row level security;
drop policy if exists "firma_select" on public.firma;
create policy "firma_select" on public.firma for select
  using ((select hat_aktive_rolle()));
drop policy if exists "firma_admin" on public.firma;
create policy "firma_admin" on public.firma for all
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists "bereich_grenze" on public.firma;
create policy "bereich_grenze" on public.firma as restrictive for all to authenticated
  using (bereich = any ((select current_bereiche())::text[]))
  with check (bereich = any ((select current_bereiche())::text[]));
revoke all on public.firma from anon;
grant select, insert, update, delete on public.firma to authenticated;

drop trigger if exists trg_audit_firma on public.firma;
create trigger trg_audit_firma after insert or update or delete on public.firma
  for each row execute function public.write_audit_log();

-- 2) Kassenbücher -> Firma ---------------------------------------------------------
alter table public.kassenbuch
  add column if not exists firma text references public.firma (kuerzel) on update cascade;
update public.kassenbuch set firma = 'MA' where kuerzel in ('MLK', 'MÖ') and firma is null;
update public.kassenbuch set firma = 'ML' where kuerzel = 'ML' and firma is null;
update public.kassenbuch set firma = 'MD' where kuerzel = 'MD' and firma is null;

update public.firma f set lohn_kassenbuch_id = kb.id
from public.kassenbuch kb
where f.lohn_kassenbuch_id is null
  and ((f.kuerzel = 'MA' and kb.kuerzel = 'MLK')
    or (f.kuerzel = 'ML' and kb.kuerzel = 'ML')
    or (f.kuerzel = 'MD' and kb.kuerzel = 'MD'));

-- 3) Firma je Person und Saison ------------------------------------------------------
create table if not exists public.employee_saison (
  employee_id uuid not null references public.employees (id) on delete cascade,
  saison_jahr int not null check (saison_jahr between 1990 and 2100),
  firma text not null references public.firma (kuerzel) on update cascade,
  geaendert_von uuid references public.profiles (id) default auth.uid(),
  geaendert_am timestamptz not null default now(),
  primary key (employee_id, saison_jahr)
);
create index if not exists idx_employee_saison_firma on public.employee_saison (saison_jahr, firma);

-- Firma muss zum Bereich der Person passen (Vertrieb -> Mönich Direkt).
create or replace function public.employee_saison_pruefen()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from employees e join firma f on f.bereich = e.bereich
    where e.id = new.employee_id and f.kuerzel = new.firma
  ) then
    raise exception 'Firma % passt nicht zum Bereich der Person', new.firma;
  end if;
  new.geaendert_am := now();
  new.geaendert_von := auth.uid();
  return new;
end;
$$;
drop trigger if exists trg_employee_saison_pruefen on public.employee_saison;
create trigger trg_employee_saison_pruefen before insert or update on public.employee_saison
  for each row execute function public.employee_saison_pruefen();

alter table public.employee_saison enable row level security;
drop policy if exists "employee_saison_select" on public.employee_saison;
create policy "employee_saison_select" on public.employee_saison for select
  using ((select hat_aktive_rolle()));
drop policy if exists "employee_saison_write" on public.employee_saison;
create policy "employee_saison_write" on public.employee_saison for all
  using ((select hat_rolle(array['admin', 'hr', 'lohnabrechnung']::user_role[])))
  with check ((select hat_rolle(array['admin', 'hr', 'lohnabrechnung']::user_role[])));
drop policy if exists "bereich_grenze" on public.employee_saison;
create policy "bereich_grenze" on public.employee_saison as restrictive for all to authenticated
  using (not (select bereich_filter_aktiv()) or employee_id in (
    select e.id from public.employees e where e.bereich = any ((select current_bereiche())::text[])))
  with check (not (select bereich_filter_aktiv()) or employee_id in (
    select e.id from public.employees e where e.bereich = any ((select current_bereiche())::text[])));
revoke all on public.employee_saison from anon;
grant select, insert, update, delete on public.employee_saison to authenticated;

drop trigger if exists trg_audit_employee_saison on public.employee_saison;
create trigger trg_audit_employee_saison after insert or update or delete on public.employee_saison
  for each row execute function public.write_audit_log();

-- Gültige Firma: Eintrag der Saison, sonst Standard-Firma des Bereichs.
create or replace function public.firma_fuer(p_employee_id uuid, p_saison_jahr int)
returns text language sql stable
set search_path = public
as $$
  select coalesce(
    (select s.firma from employee_saison s
      where s.employee_id = p_employee_id and s.saison_jahr = p_saison_jahr),
    (select f.kuerzel from employees e join firma f on f.bereich = e.bereich and f.ist_standard
      where e.id = p_employee_id)
  );
$$;
revoke all on function public.firma_fuer(uuid, int) from public, anon;
grant execute on function public.firma_fuer(uuid, int) to authenticated, service_role;

-- 4) Planung und Lohnsteuer-Antrag ------------------------------------------------------
alter table public.personal_kandidaten
  add column if not exists firma text references public.firma (kuerzel) on update cascade;
alter table public.lohnsteuerantrag
  add column if not exists firma text references public.firma (kuerzel) on update cascade;
update public.lohnsteuerantrag set firma = 'MA' where firma is null;
-- Antrag nur sichtbar, wenn die Firma im eigenen Bereich liegt (firma-RLS).
drop policy if exists "bereich_grenze" on public.lohnsteuerantrag;
create policy "bereich_grenze" on public.lohnsteuerantrag as restrictive for all to authenticated
  using (firma is null or firma in (select f.kuerzel from public.firma f))
  with check (firma is null or firma in (select f.kuerzel from public.firma f));

-- Audit-Trigger: employee_saison hat keine Spalte id -> Schlüssel bilden
create or replace function public.write_audit_log()
returns trigger language plpgsql security definer
as $$
declare
  v_neu jsonb := case when TG_OP <> 'DELETE' then to_jsonb(new) end;
  v_alt jsonb := case when TG_OP <> 'INSERT' then to_jsonb(old) end;
  v_zeile jsonb := coalesce(v_neu, v_alt);
begin
  insert into audit_log (actor_id, entity, entity_id, action, before_data, after_data)
  values (
    auth.uid(),
    TG_TABLE_NAME,
    coalesce(
      v_zeile ->> 'id',
      v_zeile ->> 'kuerzel',
      -- employee_saison: Person + Jahr; periods: Jahr-Monat
      case when v_zeile ? 'employee_id' then (v_zeile ->> 'employee_id') || '/' || (v_zeile ->> 'saison_jahr') end,
      (v_zeile ->> 'saison_jahr') || '-' || lpad(v_zeile ->> 'monat', 2, '0'),
      '?'
    ),
    lower(TG_OP),
    v_alt,
    v_neu
  );
  return coalesce(new, old);
end;
$$;

commit;
