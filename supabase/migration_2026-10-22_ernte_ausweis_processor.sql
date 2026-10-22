-- ============================================================================
-- Migration 2026-10-22: Processor liest Personen-Codes jetzt ueber
-- Personalnummer + ernte_ausweis.suffix auf, nicht mehr ueber ernte_tag
--
-- Baut auf migration_2026-10-22_ernte_ausweis.sql auf. ernte_tag bleibt als
-- Tabelle bestehen (weiterhin nutzbar, um einzelne KISTEN manuell zu
-- markieren, siehe Teil C im Plan), wird fuer Personen aber nicht mehr
-- gelesen - der Code "P-<personal_nr>-<suffix>" traegt die Zuordnung jetzt
-- in sich selbst.
--
-- Nur die Funktion wird per CREATE OR REPLACE aktualisiert - keine
-- Tabellenaenderung noetig. Aenderung gegenueber der zuletzt aktiven Fassung
-- (migration_2026-10-22_ernte_schichtwechsel_maschine.sql) ist AUSSCHLIESSLICH
-- der employee_id-Aufloesungsblock ganz oben im "person_login"-Zweig - der
-- Rest (Ein-Maschine-Regel, Schichtwechsel, Kisten-/Gewicht-Logik) bleibt
-- unveraendert.
--
-- In der Supabase SQL-Konsole ausfuehren (ein Zug). Idempotent.
-- ============================================================================

create or replace function ernte_scan_verarbeiten()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  zeile record;
  sperrzeit_s int;
  tara_standard numeric;
  letzte_gleiche_lesung timestamptz;
  v_maschine record;
  v_personal_nr text;
  v_suffix text;
  v_employee_id uuid;
  v_offene_schicht record;
  v_schicht_id bigint;
  v_schicht_employee_id uuid;
  v_feld_id bigint;
  v_bereits_offener_zyklus_id bigint;
  v_offener_zyklus record;
begin
  select coalesce(
    (select wert::int from ernte_konfig where schluessel = 'sperrzeit_tag_s'), 15
  ) into sperrzeit_s;
  select coalesce(
    (select wert::numeric from ernte_konfig where schluessel = 'tara_kg_standard'), 0
  ) into tara_standard;

  for zeile in
    select * from ernte_scan where verarbeitet_am is null order by zeitpunkt asc
  loop
    begin
      -- Sperrzeit-Pruefung (Dauerscan-Modus meldet denselben Code
      -- mehrmals/Sekunde) - nur fuer person_login/kiste relevant, nicht fuer
      -- gewicht/batterie.
      if zeile.ereignis in ('person_login', 'kiste') then
        select max(zeitpunkt) into letzte_gleiche_lesung
        from ernte_scan
        where tag_uid = zeile.tag_uid
          and ereignis = zeile.ereignis
          and verarbeitet_am is not null
          and id <> zeile.id
          and zeitpunkt between zeile.zeitpunkt - make_interval(secs => sperrzeit_s) and zeile.zeitpunkt;

        if letzte_gleiche_lesung is not null then
          update ernte_scan set verarbeitet_am = now() where id = zeile.id;
          continue;
        end if;
      end if;

      -- Maschine ermitteln (ueber die Box-Kennung im roh-Feld - maschine_id
      -- selbst wird vom Ingest noch nicht aufgeloest, siehe ernte-ingest).
      v_maschine := null;
      if zeile.quelle = 'maschine' then
        select * into v_maschine from ernte_maschine
        where box_seriennummer = (zeile.roh ->> 'box')
        limit 1;

        if v_maschine is null then
          update ernte_scan
          set verarbeitet_am = now(),
              verarbeitung_fehler = 'unbekannte maschine: ' || coalesce(zeile.roh ->> 'box', '?')
          where id = zeile.id;
          continue;
        end if;

        if not v_maschine.aktiv then
          update ernte_scan
          set verarbeitung_fehler = 'maschine inaktiv'
          where id = zeile.id;
          continue;
        end if;
      end if;

      if zeile.ereignis = 'person_login' then
        -- Code-Schema (Nutzer-Vorgabe 2026-10-22): "P-<personal_nr>-<suffix>",
        -- z.B. "P-2412-A1B2C3D4". Der Suffix ist IMMER das letzte
        -- Bindestrich-Segment (greedy ".*" sucht sich automatisch den
        -- LETZTEN Bindestrich - robust, falls eine Personalnummer selbst
        -- einen Bindestrich enthaelt).
        v_personal_nr := null;
        v_suffix := null;
        v_employee_id := null;
        if zeile.tag_uid ~ '^P-.+-[0-9A-Fa-f]{8}$' then
          v_personal_nr := substring(zeile.tag_uid from '^P-(.*)-[0-9A-Fa-f]{8}$');
          v_suffix := upper(substring(zeile.tag_uid from '[0-9A-Fa-f]{8}$'));

          select e.id into v_employee_id
          from employees e
          join ernte_ausweis a on a.employee_id = e.id
          where e.personal_nr = v_personal_nr
            and a.suffix = v_suffix
            and e.aktiv;
        end if;

        -- Ein-Maschine-Regel, hartes Invariant (Nutzer-Vorgabe 2026-10-22:
        -- "darf absolut nicht sein, dass dieselbe Person an zwei Maschinen
        -- gleichzeitig angemeldet ist"): offene Schicht an einer ANDEREN
        -- Maschine sofort schliessen - sowohl ueber den rohen Kartencode
        -- (greift auch bei nicht aufloesbaren Codes) als auch ueber die
        -- aufgeloeste Person (falls dieselbe Person je zwei Karten haben
        -- sollte). Kein manueller Logout noetig.
        update ernte_schicht
        set ende = zeile.zeitpunkt
        where ende is null
          and maschine_id <> v_maschine.id
          and (
            tag_uid = zeile.tag_uid
            or (v_employee_id is not null and employee_id = v_employee_id)
          );

        select * into v_offene_schicht from ernte_schicht
        where maschine_id = v_maschine.id and ende is null
        order by beginn desc limit 1;

        if v_offene_schicht is null then
          -- Niemand an dieser Maschine angemeldet -> neue Schicht.
          insert into ernte_schicht (maschine_id, employee_id, tag_uid, beginn, quelle)
          values (v_maschine.id, v_employee_id, zeile.tag_uid, zeile.zeitpunkt, 'scan');

        elsif v_offene_schicht.tag_uid = zeile.tag_uid then
          -- Dieselbe Karte scannt erneut, waehrend ihre eigene Schicht noch
          -- offen ist - keine neue Schicht, aber ggf. den Namen nachtraeglich
          -- aufloesen (z.B. Ausweis wurde erst NACH dem Einloggen gedruckt).
          if v_offene_schicht.employee_id is null and v_employee_id is not null then
            update ernte_schicht
            set employee_id = v_employee_id
            where id = v_offene_schicht.id;
          end if;

        else
          -- Nutzer-Entscheidung 2026-10-22: eine ANDERE Karte an DERSELBEN
          -- Maschine bedeutet einen impliziten Schichtwechsel - alte Schicht
          -- schliessen, neue oeffnen. Spiegelbildlich zur Ein-Maschine-Regel
          -- oben (dort: dieselbe Person, andere Maschine).
          update ernte_schicht
          set ende = zeile.zeitpunkt
          where id = v_offene_schicht.id;

          insert into ernte_schicht (maschine_id, employee_id, tag_uid, beginn, quelle)
          values (v_maschine.id, v_employee_id, zeile.tag_uid, zeile.zeitpunkt, 'scan');
        end if;

      elsif zeile.ereignis = 'kiste' then
        -- Nutzer-Vorgabe 2026-10-22: GENAU DIESE Kiste darf keinen neuen
        -- Zyklus starten, solange ihr letzter Zyklus noch offen (=
        -- ungewogen) ist - unabhaengig davon, an welcher Maschine. Vor
        -- jeder sonstigen Kisten-Logik pruefen, damit ein versehentlicher
        -- Doppel-Scan nicht klaglos einen zweiten Zyklus anlegt.
        v_bereits_offener_zyklus_id := null;
        select id into v_bereits_offener_zyklus_id
        from ernte_kiste_zyklus
        where tag_uid = zeile.tag_uid and status = 'offen'
        limit 1;

        if v_bereits_offener_zyklus_id is not null then
          update ernte_scan
          set verarbeitet_am = now(),
              verarbeitung_fehler = 'Kiste ' || zeile.tag_uid
                || ' hat bereits einen offenen, ungewogenen Zyklus (#'
                || v_bereits_offener_zyklus_id
                || ') - muss erst gewogen werden, bevor sie erneut befuellt werden kann'
          where id = zeile.id;
          continue;
        end if;

        -- Bewusst ueber zwei einzelne Skalar-Variablen statt Feldzugriff auf
        -- eine moeglicherweise leere record-Variable - eindeutig statt sich
        -- auf record-NULL-Semantik zu verlassen.
        v_schicht_id := null;
        v_schicht_employee_id := null;
        select id, employee_id into v_schicht_id, v_schicht_employee_id
        from ernte_schicht
        where maschine_id = v_maschine.id and ende is null
        order by beginn desc limit 1;

        -- Juengste bekannte Position dieser Maschine zum Scan-Zeitpunkt ->
        -- Feld. Ohne Poller/Position bleibt feld_id einfach NULL (kein
        -- Fehler, siehe Migrationskopf der Erst-Migration).
        v_feld_id := null;
        select feld_id into v_feld_id from ernte_position
        where maschine_id = v_maschine.id and zeitpunkt <= zeile.zeitpunkt
        order by zeitpunkt desc limit 1;

        update ernte_kiste_zyklus
        set voll_am = zeile.zeitpunkt, voll_lat = zeile.lat, voll_lng = zeile.lng
        where id = (
          select id from ernte_kiste_zyklus
          where maschine_id = v_maschine.id and status = 'offen'
          order by befuellt_am desc limit 1
        );

        insert into ernte_kiste_zyklus (
          tag_uid, maschine_id, schicht_id, employee_id,
          befuellt_am, befuellt_lat, befuellt_lng, feld_id, status
        ) values (
          zeile.tag_uid, v_maschine.id,
          v_schicht_id, v_schicht_employee_id,
          zeile.zeitpunkt, zeile.lat, zeile.lng, v_feld_id, 'offen'
        );

      elsif zeile.ereignis = 'gewicht' then
        select * into v_offener_zyklus from ernte_kiste_zyklus
        where tag_uid = zeile.tag_uid and status = 'offen'
        order by befuellt_am desc limit 1;

        if v_offener_zyklus is null then
          insert into ernte_kiste_zyklus (
            tag_uid, befuellt_am, gewogen_am, gewicht_brutto_kg, tara_kg, waage_id, status
          ) values (
            zeile.tag_uid, zeile.zeitpunkt, zeile.zeitpunkt,
            zeile.gewicht_kg, tara_standard, zeile.waage_id, 'ungeklaert'
          );
        else
          update ernte_kiste_zyklus
          set gewogen_am = zeile.zeitpunkt,
              gewicht_brutto_kg = zeile.gewicht_kg,
              tara_kg = coalesce(tara_kg, tara_standard),
              waage_id = zeile.waage_id,
              status = 'gewogen'
          where id = v_offener_zyklus.id;
        end if;

      elsif zeile.ereignis = 'batterie' then
        -- v1.1 (ernte_maschine_energie), noch nicht gebaut - Zeile einfach
        -- als verarbeitet markieren, nichts verloren (roh bleibt in
        -- ernte_scan erhalten).
        null;
      end if;

      update ernte_scan
      set verarbeitet_am = now(), verarbeitung_fehler = null
      where id = zeile.id;

    exception when others then
      update ernte_scan set verarbeitung_fehler = sqlerrm where id = zeile.id;
    end;
  end loop;
end;
$$;

grant execute on function ernte_scan_verarbeiten() to authenticated;
