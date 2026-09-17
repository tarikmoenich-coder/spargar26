-- ---------------------------------------------------------------------------
-- Lohnsteuerabzug-Sammelantrag (Finanzamt Bensheim) - Nutzer-Vorgabe
-- 2026-09-17: die vom Finanzamt geschickte Excel-Vorlage ("Antrag auf
-- Erteilung einer (Sammel-)Bescheinigung für den Lohnsteuerabzug bei
-- beschränkt einkommensteuerpflichtigen Arbeitnehmern") wird aus spargar
-- erzeugt statt von Hand gepflegt. Baut auf der bestehenden
-- doppelte_haushaltsfuehrung/employee_documents-Vorarbeit auf (siehe
-- "Personal → Lohnsteuer") - dieser Antrag speichert nur die je Einreichung
-- variierenden Eingaben (Aufenthaltszeitraum, Fahrtkosten, Unterkunft, ...)
-- und die daraus berechneten Werte, eingefroren zum Zeitpunkt der
-- Einreichung, damit ein einmal verschickter Antrag nachvollziehbar bleibt.
-- ---------------------------------------------------------------------------

-- Firmen-Stammdaten für den Excel-Kopf und die "Aufenthalt in der
-- BRD"-Adresse (bei allen Positionen identisch - die Arbeitnehmer sind bei
-- Mömmel gemeldet, nicht die Heimatadresse). Gleiche Singleton-Tabelle wie
-- IBAN/BIC (firmen_bankdaten), einmalig unter Einstellungen nachpflegbar.
alter table firmen_bankdaten
  add column if not exists steuernummer text,
  add column if not exists strasse text,
  add column if not exists hausnummer text,
  add column if not exists plz text,
  add column if not exists ort text;

create table if not exists lohnsteuerantrag (
  id bigint generated always as identity primary key,
  jahr int not null,
  status text not null default 'entwurf'
    check (status in ('entwurf', 'bereit', 'verschickt')),
  erstellt_von uuid references profiles (id) default auth.uid(),
  erstellt_am timestamptz not null default now(),
  verschickt_von uuid references profiles (id),
  verschickt_am timestamptz,
  notiz text,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists idx_lohnsteuerantrag_jahr on lohnsteuerantrag (jahr);

create table if not exists lohnsteuerantrag_position (
  id bigint generated always as identity primary key,
  antrag_id bigint not null references lohnsteuerantrag (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete restrict,

  -- Aufenthaltszeitraum in Deutschland für DIESEN Antrag (Verpflegungs-
  -- mehraufwand/Tage-Berechnung) - vorbelegt aus employees.saison_beginn/
  -- -ende, hier aber bewusst eingefroren statt live verlinkt.
  aufenthalt_von date not null,
  aufenthalt_bis date not null,
  an_abreisetage int not null default 2,
  -- "eigener Hausstand ja/nein" laut Formular - wird beim Anlegen aus
  -- doppelte_haushaltsfuehrung vorbelegt (familienstand='verheiratet' oder
  -- wohnsituation='eigentuemer_mieter'), bleibt aber überschreibbar.
  eigener_hausstand boolean not null default true,
  gefahrene_km numeric(10, 2) not null default 0,
  unterkunftskosten numeric(10, 2) not null default 0,
  sonstige_werbungskosten numeric(10, 2) not null default 0,
  -- Freitext "vorherige Zeiträume in Deutschland" - vorbelegt aus
  -- employee_saison_praesenz (Liste der Saison-Jahre), frei änderbar.
  vorherige_zeitraeume text,

  -- Berechnete Werte (lib/lohnsteuerantrag.ts), eingefroren zum Zeitpunkt
  -- des Speicherns der Position.
  tage int not null,
  verpflegungsmehraufwand numeric(10, 2) not null,
  fahrtkosten_absetzbar numeric(10, 2) not null,
  werbungskosten_gesamt numeric(10, 2) not null,
  pauschbetrag_anteilig numeric(10, 2) not null,
  freibetrag_beantragt numeric(10, 2) not null,

  -- Rückmeldung vom Finanzamt.
  ergebnis text not null default 'offen'
    check (ergebnis in ('offen', 'genehmigt', 'abgelehnt')),
  bescheid_freibetrag numeric(10, 2),
  bescheid_gueltig_von date,
  bescheid_gueltig_bis date,
  bescheid_datum date,
  bescheid_notiz text,

  erstellt_am timestamptz not null default now(),

  unique (antrag_id, employee_id)
);

create index if not exists idx_lohnsteuerantrag_position_antrag
  on lohnsteuerantrag_position (antrag_id);
create index if not exists idx_lohnsteuerantrag_position_employee
  on lohnsteuerantrag_position (employee_id);

create trigger trg_lohnsteuerantrag_updated_at
  before update on lohnsteuerantrag
  for each row execute function set_updated_at_and_version();

alter table lohnsteuerantrag enable row level security;
alter table lohnsteuerantrag_position enable row level security;

-- Gleiche Sensibilität wie doppelte_haushaltsfuehrung/SV-Fragebogen: nur
-- admin/hr.
create policy "lohnsteuerantrag_admin_hr_all" on lohnsteuerantrag for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
create policy "lohnsteuerantrag_position_admin_hr_all"
  on lohnsteuerantrag_position for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));

-- Der Excel-/Anlagen-Export auf "Personal → Lohnsteuer" (admin/hr) braucht
-- die Firmen-Steuernummer/-Anschrift - bislang durfte dort nur admin/kasse
-- lesen (SEPA-Export bei Vorschüssen). hr ergänzt, schreiben bleibt admin.
drop policy if exists "firmen_bankdaten_select" on firmen_bankdaten;
create policy "firmen_bankdaten_select" on firmen_bankdaten for select
  using (current_role_name() in ('admin', 'kasse', 'hr'));
