-- Arbeitskleidung: Lagerbestand + Ausgabe-Log (Nutzer-Vorgabe 2026-08-24:
-- "Ich möchte einen Datumsstempel bekommen... die Größen, die ausgegeben
-- wurden... einen Lagerbestand an Arbeitskleidung, der 'lebt'"). Ersetzt
-- das bisherige Modell (eine überschreibbare Gesamtzahl je Person/Saison,
-- ehemals arbeitskleidung_setzen) durch ein Ausgabe-Log - jede Ausgabe ein
-- eigener, zeitgestempelter Eintrag mit Größe, wie bei Vorschüssen per
-- Storno statt Überschreiben korrigierbar - plus einen Anfangsbestand je
-- Typ+Größe. Der aktuelle Lagerbestand wird IMMER live berechnet
-- (Anfangsbestand − Summe aller nicht stornierten Ausgaben), nie als
-- Zwischenstand gespeichert - gleiches Prinzip wie kassenbestand_bis() im
-- Kassenbuch. Weiterhin nur Hose/Jacke/Stiefel (Spargelmesser/Feile/
-- Handschuhe bleiben Verbrauchsgegenstände, siehe season_bonuses oben).

-- Alte Funktion/Sicht ersetzen.
drop function if exists arbeitskleidung_setzen(uuid, int, int, int, int);
drop view if exists employee_kleidung_ausgabe;

-- Anfangsbestand je Saison/Typ/Größe - von admin/hr zu Saisonbeginn
-- eingetragen (siehe RLS unten - zeiterfassung darf nur lesen). Größen-
-- Listen bewusst fest im Code statt hier konfigurierbar (Nutzer-Vorgabe
-- 2026-08-24) - siehe app/arbeitskleidung/page.tsx.
create table kleidung_lagerbestand (
  saison_jahr int not null,
  typ text not null check (typ in ('Hose', 'Jacke', 'Stiefel')),
  groesse text not null,
  anfangsbestand int not null default 0 check (anfangsbestand >= 0),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  primary key (saison_jahr, typ, groesse)
);

-- Ausgabe-Log - eine Zeile je tatsächlicher Ausgabe (nicht mehr eine
-- überschreibbare Gesamtzahl je Person). storniert statt Löschen, analog
-- zu advances/cash_deposits/kautionsuebergaben.
create table kleidung_ausgaben (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employees (id) on delete restrict,
  saison_jahr int not null,
  typ text not null check (typ in ('Hose', 'Jacke', 'Stiefel')),
  groesse text not null,
  anzahl int not null check (anzahl > 0),
  datum timestamptz not null default now(),
  bearbeiter_id uuid references profiles (id) default auth.uid(),
  storniert boolean not null default false,
  storno_grund text
);

-- Schreibt die aktuelle Summe (ohne stornierte Ausgaben) je Typ zurück in
-- season_bonuses.kleidung_*_anzahl - dieser Cache bleibt bewusst bestehen
-- und treibt weiterhin unverändert kleidung_betrag in season_summary
-- (siehe dort) sowie employee_auslagen_historie (Suche-Seite), damit an
-- diesen beiden Stellen nichts geändert werden muss. Größen selbst
-- fließen NICHT in die Lohnberechnung ein, nur die Stückzahl. security
-- definer aus demselben Grund wie schon vorher bei arbeitskleidung_setzen:
-- season_bonuses ist für zeiterfassung sonst nicht schreibbar
-- (season_bonuses_rw ist admin/lohnabrechnung-only).
create or replace function arbeitskleidung_bestand_synchronisieren(
  p_employee_id uuid,
  p_saison_jahr int
)
returns void language plpgsql security definer as $$
declare
  v_hose int;
  v_jacke int;
  v_stiefel int;
begin
  select
    coalesce(sum(anzahl) filter (where typ = 'Hose'), 0),
    coalesce(sum(anzahl) filter (where typ = 'Jacke'), 0),
    coalesce(sum(anzahl) filter (where typ = 'Stiefel'), 0)
  into v_hose, v_jacke, v_stiefel
  from kleidung_ausgaben
  where employee_id = p_employee_id
    and saison_jahr = p_saison_jahr
    and not storniert;

  insert into season_bonuses (
    employee_id, saison_jahr,
    kleidung_hose_anzahl, kleidung_jacke_anzahl, kleidung_stiefel_anzahl
  )
  values (p_employee_id, p_saison_jahr, v_hose, v_jacke, v_stiefel)
  on conflict (employee_id, saison_jahr) do update set
    kleidung_hose_anzahl = excluded.kleidung_hose_anzahl,
    kleidung_jacke_anzahl = excluded.kleidung_jacke_anzahl,
    kleidung_stiefel_anzahl = excluded.kleidung_stiefel_anzahl,
    updated_by = auth.uid(),
    updated_at = now();
end;
$$;

-- Bucht eine Ausgabe (Log-Eintrag) und synchronisiert danach den
-- season_bonuses-Cache. Gleiches Rollen-Muster wie vorher bei
-- arbeitskleidung_setzen.
create or replace function arbeitskleidung_ausgabe_buchen(
  p_employee_id uuid,
  p_saison_jahr int,
  p_typ text,
  p_groesse text,
  p_anzahl int
)
returns void language plpgsql security definer as $$
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung') then
    raise exception 'Keine Berechtigung für die Arbeitskleidung-Ausgabe';
  end if;
  if p_anzahl <= 0 then
    raise exception 'Anzahl muss größer als 0 sein';
  end if;
  if p_typ not in ('Hose', 'Jacke', 'Stiefel') then
    raise exception 'Ungültiger Kleidungstyp';
  end if;
  if p_groesse is null or trim(p_groesse) = '' then
    raise exception 'Größe erforderlich';
  end if;

  insert into kleidung_ausgaben (
    employee_id, saison_jahr, typ, groesse, anzahl, bearbeiter_id
  )
  values (
    p_employee_id, p_saison_jahr, p_typ, p_groesse, p_anzahl, auth.uid()
  );

  perform arbeitskleidung_bestand_synchronisieren(p_employee_id, p_saison_jahr);
end;
$$;

grant execute on function arbeitskleidung_ausgabe_buchen(uuid, int, text, text, int) to authenticated;

-- Storniert eine fehlerhaft erfasste Ausgabe (z.B. falsche Größe) -
-- Pflichtgrund wie bei Vorschuss-Storno, synchronisiert danach den Cache
-- neu.
create or replace function arbeitskleidung_ausgabe_stornieren(
  p_ausgabe_id bigint,
  p_grund text
)
returns void language plpgsql security definer as $$
declare
  v_employee_id uuid;
  v_saison_jahr int;
begin
  if current_role_name() not in ('admin', 'hr', 'zeiterfassung') then
    raise exception 'Keine Berechtigung für die Arbeitskleidung-Ausgabe';
  end if;
  if p_grund is null or trim(p_grund) = '' then
    raise exception 'Storno-Grund erforderlich';
  end if;

  select employee_id, saison_jahr into v_employee_id, v_saison_jahr
  from kleidung_ausgaben where id = p_ausgabe_id;

  if not found then
    raise exception 'Ausgabe nicht gefunden';
  end if;

  update kleidung_ausgaben
  set storniert = true, storno_grund = p_grund
  where id = p_ausgabe_id;

  perform arbeitskleidung_bestand_synchronisieren(v_employee_id, v_saison_jahr);
end;
$$;

grant execute on function arbeitskleidung_ausgabe_stornieren(bigint, text) to authenticated;

-- RLS
alter table kleidung_lagerbestand enable row level security;
alter table kleidung_ausgaben enable row level security;

-- Arbeitskleidung (Nutzer-Vorgabe 2026-08-24): Lagerbestand (Anfangsbestand)
-- nur admin/hr, Ausgabe-Log wie gehabt admin/hr/zeiterfassung (die Kleidung
-- ausgibt) - lesend breiter (auch lohnabrechnung/management, analog zu
-- kautionsuebergaben/advances), damit der Lagerbestand auch im
-- Controlling/Lohn-Umfeld sichtbar ist.
create policy "kleidung_lagerbestand_select" on kleidung_lagerbestand for select
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'lohnabrechnung', 'management'));
create policy "kleidung_lagerbestand_write" on kleidung_lagerbestand for all
  using (current_role_name() in ('admin', 'hr'))
  with check (current_role_name() in ('admin', 'hr'));
-- kleidung_ausgaben: nur lesend per Policy - Schreiben (Buchen/Stornieren)
-- ausschließlich über die security-definer Funktionen
-- arbeitskleidung_ausgabe_buchen/arbeitskleidung_ausgabe_stornieren, damit
-- season_bonuses zuverlässig mitsynchronisiert wird.
create policy "kleidung_ausgaben_select" on kleidung_ausgaben for select
  using (current_role_name() in ('admin', 'hr', 'zeiterfassung', 'lohnabrechnung', 'management'));

-- Audit-Log: Arbeitskleidung-Ausgabe (Nutzer-Vorgabe 2026-08-24): treibt
-- einen Lohnabzug (kleidung_betrag), deshalb wie advances/cash_deposits
-- protokolliert. kleidung_lagerbestand (nur eine Planungszahl) bewusst
-- nicht protokolliert.
create trigger trg_audit_kleidung_ausgaben
  after insert or update on kleidung_ausgaben
  for each row execute function write_audit_log();
