-- Qualitätskontrolle Halle (Nutzer-Vorgabe 2026-09-09): neuer Menüpunkt
-- "Erntewirtschaft → Qualität". Der Prüfer steht mit dem Handy in der Halle,
-- nimmt eine fertige Kiste, kontrolliert 20 Kolben und hält Datum, Uhrzeit,
-- Ergebnis (i.O. von N Kolben) und ein Foto direkt in der App fest. Eine
-- oder mehrere Kontrollen pro Tag. Das Ergebnis erscheint auch in
-- /statistik/zuckermais.
--
-- Bewusst kulturneutral (qs_kontrolle.kultur), auch wenn erstmal nur die
-- Zuckermais-Halle damit arbeitet - Erdbeeren/Spargel können später
-- denselben Menüpunkt (Unterreiter) nutzen.
--
-- Re-runnable: create table if not exists / create or replace view /
-- drop policy/trigger if exists.

create table if not exists qs_kontrolle (
  id bigint generated always as identity primary key,
  kultur text not null default 'zuckermais'
    check (kultur in ('zuckermais', 'erdbeeren', 'spargel')),
  datum date not null default current_date,
  zeitpunkt timestamptz not null default now(),
  -- optional: Vor-/Nachmittag, hilft beim Gruppieren in der Statistik.
  schicht text check (schicht in ('vormittag', 'nachmittag')),
  kolben_gesamt int not null default 20 check (kolben_gesamt between 1 and 200),
  kolben_io int not null check (kolben_io >= 0),
  fehler_notiz text,
  -- JPEG-data-URL, client-seitig verkleinert (~800 px). Wie fahrzeug.bild -
  -- kein Storage-Bucket nötig, erbt die Tabellen-RLS.
  foto text,
  erfasst_von uuid references profiles (id) default auth.uid(),
  erfasst_am timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qs_kontrolle_io_le_gesamt check (kolben_io <= kolben_gesamt)
);

create index if not exists idx_qs_kontrolle_kultur_datum
  on qs_kontrolle (kultur, datum desc, zeitpunkt desc);

-- Tagesaggregat je Kultur - für die Statistik (Anzahl Kontrollen, Tagesquote
-- in %, schlechteste Einzelkontrolle des Tages).
create or replace view qs_kontrolle_tag as
select
  kultur,
  datum,
  count(*)::int as kontrollen,
  sum(kolben_io)::int as kolben_io,
  sum(kolben_gesamt)::int as kolben_gesamt,
  round(sum(kolben_io)::numeric / nullif(sum(kolben_gesamt), 0) * 100, 1)
    as quote_prozent,
  min(round(kolben_io::numeric / nullif(kolben_gesamt, 0) * 100, 1))
    as quote_min_prozent
from qs_kontrolle
group by kultur, datum;

alter view qs_kontrolle_tag set (security_invoker = true);
grant select on qs_kontrolle_tag to authenticated;

-- updated_at pflegen (generische Funktion, existiert bereits).
drop trigger if exists trg_qs_kontrolle_updated_at on qs_kontrolle;
create trigger trg_qs_kontrolle_updated_at before update on qs_kontrolle
  for each row execute function set_updated_at();

-- Änderungsprotokoll (admin/pruefer lesen audit_log).
drop trigger if exists trg_audit_qs_kontrolle on qs_kontrolle;
create trigger trg_audit_qs_kontrolle
  after insert or update or delete on qs_kontrolle
  for each row execute function write_audit_log();

-- RLS: lesen dürfen alle Angemeldeten (Statistik). Erfassen/Ändern wie die
-- Prämien-Rohdaten (admin/hr/zeiterfassung/erntewirtschaft); Löschen nur
-- admin/hr/erntewirtschaft.
alter table qs_kontrolle enable row level security;

drop policy if exists "qs_kontrolle_select" on qs_kontrolle;
create policy "qs_kontrolle_select" on qs_kontrolle for select
  using (auth.uid() is not null);

drop policy if exists "qs_kontrolle_insert" on qs_kontrolle;
create policy "qs_kontrolle_insert" on qs_kontrolle for insert
  with check (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
  );

drop policy if exists "qs_kontrolle_update" on qs_kontrolle;
create policy "qs_kontrolle_update" on qs_kontrolle for update
  using (
    current_role_name() in ('admin', 'hr', 'zeiterfassung', 'erntewirtschaft')
  );

drop policy if exists "qs_kontrolle_delete" on qs_kontrolle;
create policy "qs_kontrolle_delete" on qs_kontrolle for delete
  using (current_role_name() in ('admin', 'hr', 'erntewirtschaft'));
