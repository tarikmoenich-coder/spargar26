-- Vermerkt, ob/wann für einen Vorschuss- oder Auszahlungsbeleg schon eine
-- SEPA-Überweisungsdatei erzeugt wurde (Nutzer-Vorgabe: "SEPA"-Symbol + Datum
-- neben dem Beleg). Ein Datensatz je (art, beleg_id), wird bei jedem erneuten
-- Erzeugen überschrieben (letzter Export zählt - Neuerzeugen ist normal).

create table if not exists sepa_export (
  art text not null check (art in ('vorschuss', 'auszahlung')),
  beleg_id bigint not null,
  zuletzt_erzeugt_am timestamptz not null default now(),
  zuletzt_erzeugt_von uuid references profiles (id) default auth.uid(),
  anzahl int not null default 0,
  summe numeric(12, 2) not null default 0,
  primary key (art, beleg_id)
);

alter table sepa_export enable row level security;

drop policy if exists "sepa_export_select" on sepa_export;
create policy "sepa_export_select" on sepa_export for select
  using (
    current_role_name() in
      ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer', 'management')
  );

-- Schreiben: wer SEPA-Dateien erzeugen darf (= Vorschuss-/Auszahlungs-Rechte).
drop policy if exists "sepa_export_write" on sepa_export;
create policy "sepa_export_write" on sepa_export for all
  using (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'))
  with check (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));

grant select, insert, update on sepa_export to authenticated;
