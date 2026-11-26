-- ============================================================================
-- Migration 2026-11-26c: Vertriebsplanung V4 - Wochen-/Tagesplan und Ausdrucke
-- (docs/vertriebsplanung-plan.md).
--
-- Der konkrete Tag entsteht aus dem Grundplan der Saison plus Änderungen nur
-- für diesen Tag:
--   vt_feiertag       Feiertage - gelten komplett wie ein Sonntag
--                     (Öffnungszeiten, Sonntagstouren, Sonntags-Besetzung;
--                     Nutzer 2026-11-26)
--   vt_tag_aenderung  Abweichung je Datum x Stand x Halbtag:
--                     employee_id gesetzt = andere Person,
--                     employee_id leer    = heute unbesetzt (Vertretung fehlt),
--                     geschlossen         = Stand heute zu
--   vt_tour_tag       anderes Auto / andere Abfahrt nur an diesem Tag
--   vt_druck          Stand des Tagesplans beim Drucken (A3). Damit zeigt der
--                     A4-Änderungszettel genau, was sich seit dem Ausdruck
--                     geändert hat (Fahrer wussten bisher nichts davon).
--
-- Rechte wie V1-V3 (vt_darf: lesen Vertriebs-Rollen, pflegen admin/hr).
-- Jede Anweisung einzeln wiederholbar.
-- ============================================================================

-- --- Feiertage ---------------------------------------------------------------
create table if not exists public.vt_feiertag (
  id bigint generated always as identity primary key,
  datum date not null,
  name text not null,
  erstellt_am timestamptz not null default now(),
  constraint vt_feiertag_datum unique (datum)
);

alter table public.vt_feiertag enable row level security;
drop policy if exists "vt_lesen" on public.vt_feiertag;
create policy "vt_lesen" on public.vt_feiertag for select to authenticated
  using ((select public.vt_darf(false)));
drop policy if exists "vt_pflegen" on public.vt_feiertag;
create policy "vt_pflegen" on public.vt_feiertag for all to authenticated
  using ((select public.vt_darf(true)))
  with check ((select public.vt_darf(true)));
revoke all on public.vt_feiertag from anon;
grant select, insert, update, delete on public.vt_feiertag to authenticated;
drop trigger if exists trg_audit_vt_feiertag on public.vt_feiertag;
create trigger trg_audit_vt_feiertag after insert or update or delete on public.vt_feiertag
  for each row execute function public.write_audit_log();

-- --- Änderungen für einen Tag ------------------------------------------------
create table if not exists public.vt_tag_aenderung (
  id bigint generated always as identity primary key,
  datum date not null,
  stand_id bigint not null references public.vt_stand (id) on delete cascade,
  halbtag text not null check (halbtag in ('VM', 'NM')),
  employee_id uuid references public.employees (id) on delete set null,
  geschlossen boolean not null default false,
  notiz text,
  geaendert_am timestamptz not null default now(),
  geaendert_von uuid default auth.uid(),
  constraint vt_tag_aenderung_feld unique (datum, stand_id, halbtag),
  constraint vt_tag_aenderung_sinn check (not (geschlossen and employee_id is not null))
);
create index if not exists idx_vt_tag_aenderung_datum on public.vt_tag_aenderung (datum);
-- Eine Person nicht zweimal zur selben Zeit (innerhalb der Tagesänderungen;
-- gegen den Grundplan prüft die App)
create unique index if not exists vt_tag_aenderung_person_einmal
  on public.vt_tag_aenderung (datum, employee_id, halbtag) where employee_id is not null;

alter table public.vt_tag_aenderung enable row level security;
drop policy if exists "vt_lesen" on public.vt_tag_aenderung;
create policy "vt_lesen" on public.vt_tag_aenderung for select to authenticated
  using ((select public.vt_darf(false)));
drop policy if exists "vt_pflegen" on public.vt_tag_aenderung;
create policy "vt_pflegen" on public.vt_tag_aenderung for all to authenticated
  using ((select public.vt_darf(true)))
  with check ((select public.vt_darf(true)));
revoke all on public.vt_tag_aenderung from anon;
grant select, insert, update, delete on public.vt_tag_aenderung to authenticated;

-- Nur Verkäufer (Trigger aus V2) - leer = unbesetzt ist erlaubt
drop trigger if exists trg_vt_nur_vertrieb on public.vt_tag_aenderung;
create trigger trg_vt_nur_vertrieb before insert or update of employee_id on public.vt_tag_aenderung
  for each row when (new.employee_id is not null) execute function public.vt_nur_vertrieb_pruefen();
drop trigger if exists trg_audit_vt_tag_aenderung on public.vt_tag_aenderung;
create trigger trg_audit_vt_tag_aenderung after insert or update or delete on public.vt_tag_aenderung
  for each row execute function public.write_audit_log();

-- --- Tour an einem Tag: anderes Auto / andere Abfahrt -----------------------------
create table if not exists public.vt_tour_tag (
  id bigint generated always as identity primary key,
  datum date not null,
  tour_id bigint not null references public.vt_tour (id) on delete cascade,
  fahrzeug_id bigint references public.fahrzeug (id) on delete set null,
  abfahrt time,
  notiz text,
  geaendert_am timestamptz not null default now(),
  constraint vt_tour_tag_eindeutig unique (datum, tour_id)
);

alter table public.vt_tour_tag enable row level security;
drop policy if exists "vt_lesen" on public.vt_tour_tag;
create policy "vt_lesen" on public.vt_tour_tag for select to authenticated
  using ((select public.vt_darf(false)));
drop policy if exists "vt_pflegen" on public.vt_tour_tag;
create policy "vt_pflegen" on public.vt_tour_tag for all to authenticated
  using ((select public.vt_darf(true)))
  with check ((select public.vt_darf(true)));
revoke all on public.vt_tour_tag from anon;
grant select, insert, update, delete on public.vt_tour_tag to authenticated;
drop trigger if exists trg_audit_vt_tour_tag on public.vt_tour_tag;
create trigger trg_audit_vt_tour_tag after insert or update or delete on public.vt_tour_tag
  for each row execute function public.write_audit_log();

-- --- Druck-Stände --------------------------------------------------------------
create table if not exists public.vt_druck (
  id bigint generated always as identity primary key,
  datum date not null,
  gedruckt_am timestamptz not null default now(),
  gedruckt_von uuid default auth.uid(),
  -- {"besetzung": {"<stand>|<VM/NM>": "<employee_id>"|null}, "touren": {"<tour>": {"fahrzeug_id":..,"abfahrt":..}}}
  stand jsonb not null
);
create index if not exists idx_vt_druck_datum on public.vt_druck (datum, gedruckt_am desc);

alter table public.vt_druck enable row level security;
drop policy if exists "vt_lesen" on public.vt_druck;
create policy "vt_lesen" on public.vt_druck for select to authenticated
  using ((select public.vt_darf(false)));
drop policy if exists "vt_pflegen" on public.vt_druck;
create policy "vt_pflegen" on public.vt_druck for all to authenticated
  using ((select public.vt_darf(true)))
  with check ((select public.vt_darf(true)));
revoke all on public.vt_druck from anon;
grant select, insert, update, delete on public.vt_druck to authenticated;
