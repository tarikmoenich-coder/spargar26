-- SV-Fragebogen ("Fragebogen zur Feststellung der Versicherungspflicht/
-- Versicherungsfreiheit rumänischer Saisonarbeitnehmer") - manuelles
-- Eingabeformular je Person UND Saison-Jahr, damit im Folgejahr geprüft
-- werden kann, ob sich die Angaben verändert haben. Siehe Kommentare in
-- schema.sql für Details/Begründung.

create table sv_fragebogen (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,

  -- 1. Beschäftigung im Heimatland
  beschaeftigt_heimatland boolean,
  beschaeftigt_firma text,
  beschaeftigt_taetigkeit text,
  bezahlter_urlaub boolean,
  bezahlter_urlaub_von date,
  bezahlter_urlaub_bis date,
  unbezahlter_urlaub boolean,
  unbezahlter_urlaub_von date,
  unbezahlter_urlaub_bis date,
  freistellung boolean,
  freistellung_von date,
  freistellung_bis date,
  freistellung_grund text,

  -- 2. Selbstständigkeit im Heimatland
  selbststaendig boolean,
  selbststaendig_seit date,
  selbststaendig_taetigkeit text,

  -- 3. Arbeitslosigkeit im Heimatland
  arbeitslos boolean,
  arbeitslos_seit date,
  arbeitsamt_name text,
  arbeitsamt_aktenzeichen text,

  -- 4. Schulbesuch/Studium im Heimatland
  schule_studium boolean,
  schule_seit date,
  schule_name text,
  schule_ende date,
  schulferien_waehrend_beschaeftigung boolean,
  schulferien_von date,
  schulferien_bis date,

  -- 5. Rentenbezug im Heimatland
  rente boolean,
  rente_seit date,
  rente_art text,
  rente_traeger text,

  -- 6. Hausfrau/Hausmann im Heimatland
  hausmann boolean,
  hausmann_seit date,

  -- 7. Sonstiges - nur relevant, wenn 1/2/3/4/5/6 alle "nein" sind
  lebensunterhalt_sonstiges text,

  -- Kern der 90-Tage-Regel: entscheidend ist die Gesamtzahl der
  -- Arbeitstage in DEUTSCHLAND im Kalenderjahr über ALLE Arbeitgeber,
  -- nicht nur bei uns - NICHT die Beschäftigung im Ausland (die zählt für
  -- die Berufsmäßigkeits-Frage oben, Blöcke 1-7, aber nicht für die
  -- Tage-Grenze). Oft meldet das Lohnprogramm, dass eine Person schon
  -- einmal in Deutschland beschäftigt war - dann wird gezielt nachgefragt
  -- und hier dokumentiert, worauf wir uns bei der wahrheitsgemäßen
  -- (rechtlich bindenden) Angabe der Person verlassen. Fließt direkt in
  -- die kombinierte 90-Tage-Kontrolle ein (siehe employee_sv_pruefung).
  vorbeschaeftigung_deutschland_tage int,
  vorbeschaeftigung_deutschland_arbeitgeber text,
  ausgeloest_durch_lohnprogramm_hinweis boolean not null default false,

  -- Erklärung/Unterschrift auf dem Papierformular
  ausgefuellt_am date,

  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),

  unique (employee_id, saison_jahr)
);

-- 8. Bisherige Beschäftigungen im laufenden Kalenderjahr (vor dieser
--    Beschäftigung, im In- oder Ausland) - mehrere Zeilen möglich, wie auf
--    dem Papierformular. Rein informativ/dokumentierend (Kontext für die
--    Berufsmäßigkeits-Einschätzung oben) - zählt NICHT in die 90-Tage-
--    Kontrolle hinein, das macht sv_fragebogen.vorbeschaeftigung_
--    deutschland_tage (nur Deutschland zählt für die Tage-Grenze).
create table sv_fragebogen_vorbeschaeftigung (
  id bigint generated always as identity primary key,
  fragebogen_id bigint not null references sv_fragebogen (id) on delete cascade,
  von date not null,
  bis date not null,
  wochenstunden numeric(5, 2),
  taetigkeit text,
  arbeitgeber text
);

create index idx_sv_fragebogen_vorbeschaeftigung_fragebogen
  on sv_fragebogen_vorbeschaeftigung (fragebogen_id);

create or replace view sv_fragebogen_auswertung as
select
  f.*,
  (
    coalesce(f.beschaeftigt_heimatland, false)
    or coalesce(f.selbststaendig, false)
    or coalesce(f.schule_studium, false)
    or coalesce(f.rente, false)
    or coalesce(f.hausmann, false)
  )
  and not coalesce(f.arbeitslos, false) as bestanden
from sv_fragebogen f;

alter view sv_fragebogen_auswertung set (security_invoker = true);
grant select on sv_fragebogen_auswertung to authenticated;

-- employee_sv_pruefung: neue Spalten vorbeschaeftigung_deutschland_tage/
-- kombinierte_tage/rest_bis_90_tage_kombiniert, kritisch berücksichtigt
-- jetzt auch die kombinierten Tage. Bestehende Spalten unverändert.
create or replace view employee_sv_pruefung as
select
  e.id as employee_id,
  e.personal_nr,
  e.name,
  e.vorname,
  e.abrechnungsart,
  e.aktiv,
  w.saison_jahr,
  w.erster_arbeitstag,
  w.letzter_arbeitstag,
  w.arbeitstage_ueber0,
  greatest(0, 90 - w.arbeitstage_ueber0) as rest_bis_90_tage,
  (w.erster_arbeitstag + 104) as austrittsdatum_15_wochen,
  floor((w.letzter_arbeitstag - w.erster_arbeitstag) / 7.0)::int as wochen_seit_start,
  (w.arbeitstage_ueber0 > 90) as ueberschritten_90_tage,
  (w.letzter_arbeitstag > (w.erster_arbeitstag + 104)) as ueberschritten_15_wochen,
  (
    w.arbeitstage_ueber0 > 90
    or w.letzter_arbeitstag > (w.erster_arbeitstag + 104)
    or (w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)) > 90
  ) as kritisch,
  -- Neue Spalten ans Ende angehängt (nicht dazwischen!) - "create or
  -- replace view" erlaubt nur das Anhängen neuer Spalten am Ende, sonst
  -- Fehler 42P16 "cannot change name of view column".
  coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as vorbeschaeftigung_deutschland_tage,
  w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0)
    as kombinierte_tage,
  greatest(
    0,
    90 - (w.arbeitstage_ueber0 + coalesce(fb.vorbeschaeftigung_deutschland_tage, 0))
  ) as rest_bis_90_tage_kombiniert
from employees e
join lateral (
  select
    extract(year from we.datum)::int as saison_jahr,
    min(we.datum) filter (where we.stunden > 0) as erster_arbeitstag,
    max(we.datum) filter (where we.stunden > 0) as letzter_arbeitstag,
    count(distinct we.datum) filter (where we.stunden > 0) as arbeitstage_ueber0
  from work_entries we
  where we.employee_id = e.id
  group by extract(year from we.datum)
) w on true
left join lateral (
  select f.vorbeschaeftigung_deutschland_tage
  from sv_fragebogen f
  where f.employee_id = e.id and f.saison_jahr = w.saison_jahr
) fb on true
where w.erster_arbeitstag is not null
  and e.abrechnungsart <> 'sozialversicherungspflichtig';

grant select on employee_sv_pruefung to authenticated;

alter table sv_fragebogen enable row level security;
alter table sv_fragebogen_vorbeschaeftigung enable row level security;

create policy "sv_fragebogen_admin_hr_all" on sv_fragebogen for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
create policy "sv_fragebogen_vorbeschaeftigung_admin_hr_all"
  on sv_fragebogen_vorbeschaeftigung for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
