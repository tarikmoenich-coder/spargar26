-- ============================================================================
-- Migration 2026-11-26d: Eröffnung und Schluss je Stand und Saison
-- (Vertriebsplanung, docs/vertriebsplanung-plan.md).
--
-- Nutzer 2026-11-26: Am Saisonanfang öffnen die Stände nach und nach, am Ende
-- schließen sie nach und nach - erst damit funktioniert der Wochenplan am
-- Anfang und Ende sinnvoll. Je Stand und Saison optional "geöffnet ab" /
-- "geöffnet bis"; keine Zeile bzw. leeres Feld = ganze Saison. Außerhalb
-- gilt der Stand in Woche und Tagesplan als geschlossen.
--
-- Rechte wie V1 (vt_darf: lesen Vertriebs-Rollen, pflegen admin/hr).
-- Jede Anweisung einzeln wiederholbar.
-- ============================================================================

create table if not exists public.vt_stand_saison (
  id bigint generated always as identity primary key,
  stand_id bigint not null references public.vt_stand (id) on delete cascade,
  saison_jahr int not null check (saison_jahr between 2000 and 2100),
  eroeffnung date,
  schluss date,
  geaendert_am timestamptz not null default now(),
  constraint vt_stand_saison_eindeutig unique (stand_id, saison_jahr),
  constraint vt_stand_saison_reihenfolge check (eroeffnung is null or schluss is null or schluss >= eroeffnung)
);

alter table public.vt_stand_saison enable row level security;
drop policy if exists "vt_lesen" on public.vt_stand_saison;
create policy "vt_lesen" on public.vt_stand_saison for select to authenticated
  using ((select public.vt_darf(false)));
drop policy if exists "vt_pflegen" on public.vt_stand_saison;
create policy "vt_pflegen" on public.vt_stand_saison for all to authenticated
  using ((select public.vt_darf(true)))
  with check ((select public.vt_darf(true)));
revoke all on public.vt_stand_saison from anon;
grant select, insert, update, delete on public.vt_stand_saison to authenticated;
drop trigger if exists trg_audit_vt_stand_saison on public.vt_stand_saison;
create trigger trg_audit_vt_stand_saison after insert or update or delete on public.vt_stand_saison
  for each row execute function public.write_audit_log();
