-- ============================================================================
-- Migration 2026-11-25e: Vertriebsplanung V3 - Grundplan je Saison
-- (docs/vertriebsplanung-plan.md).
--
-- Nutzer-Vorgabe 2026-11-25: ein fester Grundplan für die ganze Saison -
-- je Stand x Wochentag x Halbtag (Vormittag/Nachmittag) eine Person. Der
-- Fahrer einer Tour ergibt sich aus dem letzten mitfahrenden Stand und wird
-- nicht gespeichert.
--
-- Eine Person kann nicht zur selben Zeit an zwei Ständen stehen (eindeutig).
-- Nur Verkäufer (Bereich Vertrieb, Trigger aus V2). Rechte wie V1.
-- Jede Anweisung einzeln wiederholbar.
-- ============================================================================

create table if not exists public.vt_grundplan (
  id bigint generated always as identity primary key,
  saison_jahr int not null check (saison_jahr between 2000 and 2100),
  stand_id bigint not null references public.vt_stand (id) on delete cascade,
  wochentag smallint not null check (wochentag between 1 and 7),
  halbtag text not null check (halbtag in ('VM', 'NM')),
  employee_id uuid not null references public.employees (id) on delete cascade,
  geaendert_am timestamptz not null default now(),
  constraint vt_grundplan_feld unique (saison_jahr, stand_id, wochentag, halbtag),
  constraint vt_grundplan_person_einmal unique (saison_jahr, employee_id, wochentag, halbtag)
);
create index if not exists idx_vt_grundplan_person on public.vt_grundplan (employee_id, saison_jahr);

alter table public.vt_grundplan enable row level security;
drop policy if exists "vt_lesen" on public.vt_grundplan;
create policy "vt_lesen" on public.vt_grundplan for select to authenticated
  using ((select public.vt_darf(false)));
drop policy if exists "vt_pflegen" on public.vt_grundplan;
create policy "vt_pflegen" on public.vt_grundplan for all to authenticated
  using ((select public.vt_darf(true)))
  with check ((select public.vt_darf(true)));
revoke all on public.vt_grundplan from anon;
grant select, insert, update, delete on public.vt_grundplan to authenticated;

drop trigger if exists trg_vt_nur_vertrieb on public.vt_grundplan;
create trigger trg_vt_nur_vertrieb before insert or update of employee_id on public.vt_grundplan
  for each row execute function public.vt_nur_vertrieb_pruefen();
drop trigger if exists trg_audit_vt_grundplan on public.vt_grundplan;
create trigger trg_audit_vt_grundplan after insert or update or delete on public.vt_grundplan
  for each row execute function public.write_audit_log();
