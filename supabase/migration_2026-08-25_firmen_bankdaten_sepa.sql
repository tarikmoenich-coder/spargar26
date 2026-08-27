-- Firmen-Bankdaten (Nutzer-Vorgabe 2026-08-25): Auftraggeber-Konto für
-- den SEPA-Überweisungs-Export bei Vorschüssen (Zahlungsart
-- "Banküberweisung") - einmalig hinterlegt statt bei jeder SEPA-Datei
-- neu eingetippt, analog zu den Preisen/Sätzen in verpflegungssaetze.
-- Singleton-Tabelle (id fest auf 1) - es gibt nur ein Unternehmen.
create table firmen_bankdaten (
  id int primary key default 1 check (id = 1),
  name text not null default 'Mömmel Agrar GmbH & Co. KG',
  iban text,
  bic text,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

-- IBAN/BIC bewusst NICHT hier vorbelegt (Nutzer-Vorgabe 2026-08-25: "Dann
-- lass es mich lieber unter Einstellungen ändern") - echte Bankdaten
-- sollen nicht dauerhaft im Git-verwalteten Migrations-Code stehen,
-- sondern nur in der Datenbank. Admin trägt sie einmalig unter
-- Einstellungen → "Firmen-Bankdaten" ein.
insert into firmen_bankdaten (id) values (1) on conflict (id) do nothing;

-- Setzt updated_at/updated_by zuverlässig bei jeder Änderung, gleiches
-- Muster wie kleidung_lagerbestand_touch.
create or replace function firmen_bankdaten_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_firmen_bankdaten_touch
  before update on firmen_bankdaten
  for each row execute function firmen_bankdaten_touch();

alter table firmen_bankdaten enable row level security;

-- Firmen-Bankdaten (Nutzer-Vorgabe 2026-08-25): nur admin/kasse dürfen
-- lesen (kasse erstellt die Vorschüsse und generiert die SEPA-Datei
-- daraus), schreiben nur admin - eigenes Unternehmenskonto, keine
-- niedrigere Hürde als bei anderen Firmen-Einstellungen nötig.
create policy "firmen_bankdaten_select" on firmen_bankdaten for select
  using (current_role_name() in ('admin', 'kasse'));
create policy "firmen_bankdaten_write" on firmen_bankdaten for update
  using (is_admin()) with check (is_admin());
