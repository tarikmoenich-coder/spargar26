-- ============================================================================
-- Migration 2026-11-25d: Vertriebsplanung V2 - Verfügbarkeiten der Verkäufer
-- (docs/vertriebsplanung-plan.md).
--
-- Nutzer-Vorgabe 2026-11-25: Verkäufer melden, an welchen Wochentagen und
-- Halbtagen (Vormittag/Nachmittag) sie können oder nicht können; daraus wird
-- im Grundplan (V3) der "Flickenteppich" der Standbesetzung gebaut. Ein
-- Grundplan je Saison -> Verfügbarkeit je Saison.
--
--   vt_verkaeufer_saison  Person plant in Saison X mit (+ max. Halbtage je
--                         Woche, Notiz) - Grundliste der Planung
--   vt_verfuegbarkeit     Wochenraster: je Wochentag x Halbtag "kann" (true)
--                         oder "kann nicht" (false); keine Zeile = unbekannt
--   vt_abwesenheit        Ausnahmen mit Datum (Urlaub, Termin, krank)
--
-- Nur Personen aus dem Bereich Vertrieb (Trigger). Rechte wie V1 (vt_darf()).
-- Jede Anweisung einzeln wiederholbar.
-- ============================================================================

create table if not exists public.vt_verkaeufer_saison (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  saison_jahr int not null check (saison_jahr between 2000 and 2100),
  max_halbtage_woche int check (max_halbtage_woche between 0 and 14),
  notiz text,
  erstellt_am timestamptz not null default now(),
  constraint vt_verkaeufer_saison_eindeutig unique (employee_id, saison_jahr)
);

create table if not exists public.vt_verfuegbarkeit (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  saison_jahr int not null check (saison_jahr between 2000 and 2100),
  wochentag smallint not null check (wochentag between 1 and 7),
  halbtag text not null check (halbtag in ('VM', 'NM')),
  kann boolean not null,
  constraint vt_verfuegbarkeit_eindeutig unique (employee_id, saison_jahr, wochentag, halbtag)
);

create table if not exists public.vt_abwesenheit (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  von date not null,
  bis date not null,
  halbtag text check (halbtag in ('VM', 'NM')),  -- null = ganzer Tag
  grund text,
  erstellt_am timestamptz not null default now(),
  constraint vt_abwesenheit_zeitraum check (bis >= von)
);
create index if not exists idx_vt_abwesenheit_person on public.vt_abwesenheit (employee_id, von);

-- Nur Verkäufer (Bereich Vertrieb) - security definer, weil der Bereich
-- einer Person über RLS nicht für jede lesende Rolle sichtbar sein muss.
create or replace function public.vt_nur_vertrieb_pruefen()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (select 1 from employees where id = new.employee_id and bereich = 'VT') then
    raise exception 'Nur Personen aus dem Bereich Vertrieb können verplant werden.';
  end if;
  return new;
end;
$$;
revoke all on function public.vt_nur_vertrieb_pruefen() from public, anon;

do $$
declare
  t text;
begin
  foreach t in array array['vt_verkaeufer_saison', 'vt_verfuegbarkeit', 'vt_abwesenheit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "vt_lesen" on public.%I', t);
    execute format('create policy "vt_lesen" on public.%I for select to authenticated
                      using ((select public.vt_darf(false)))', t);
    execute format('drop policy if exists "vt_pflegen" on public.%I', t);
    execute format('create policy "vt_pflegen" on public.%I for all to authenticated
                      using ((select public.vt_darf(true)))
                      with check ((select public.vt_darf(true)))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists trg_vt_nur_vertrieb on public.%I', t);
    execute format('create trigger trg_vt_nur_vertrieb before insert or update of employee_id on public.%I
                      for each row execute function public.vt_nur_vertrieb_pruefen()', t);
    execute format('drop trigger if exists trg_audit_%s on public.%I', t, t);
    execute format('create trigger trg_audit_%s after insert or update or delete on public.%I
                      for each row execute function public.write_audit_log()', t, t);
  end loop;
end $$;
