-- Nutzer-Vorgabe: die Rolle lohnabrechnung darf Vorschüsse nicht nur
-- einsehen, sondern auch erstellen (inkl. Empfänger, Korrektur, Strafe/
-- Rechnung-Belege). Bisher nur admin/kasse.

drop policy if exists "advances_write" on advances;
create policy "advances_write" on advances for insert
  with check (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));

drop policy if exists "advances_update" on advances;
create policy "advances_update" on advances for update
  using (
    current_role_name() in ('admin', 'kasse', 'lohnabrechnung')
    and not ist_kassenpruefung_gesperrt(datum)
  );

drop policy if exists "advance_recipients_rw" on advance_recipients;
create policy "advance_recipients_rw" on advance_recipients for all
  using (current_role_name() in ('admin', 'hr', 'kasse', 'lohnabrechnung', 'pruefer'))
  with check (current_role_name() in ('admin', 'kasse', 'lohnabrechnung'));

drop policy if exists "vorschuss_belege_storage_insert" on storage.objects;
create policy "vorschuss_belege_storage_insert" on storage.objects for insert
  with check (
    bucket_id = 'vorschuss-belege'
    and current_role_name() in ('admin', 'kasse', 'lohnabrechnung')
  );

drop policy if exists "vorschuss_belege_storage_delete" on storage.objects;
create policy "vorschuss_belege_storage_delete" on storage.objects for delete
  using (
    bucket_id = 'vorschuss-belege'
    and current_role_name() in ('admin', 'kasse', 'lohnabrechnung')
  );

create or replace function vorschuss_korrigieren(
  p_advance_id bigint,
  p_employee_id uuid,
  p_neuer_betrag numeric,
  p_hinweis text
)
returns void language plpgsql security definer as $$
declare
  alter_betrag numeric;
  v_belegnummer text;
  v_zahlungsart text;
  v_datum timestamptz;
  v_delta numeric;
begin
  if current_role_name() not in ('admin', 'kasse', 'lohnabrechnung') then
    raise exception 'Keine Berechtigung für Beleg-Korrektur';
  end if;

  if p_neuer_betrag <= 0 then
    raise exception 'Betrag muss größer als 0 sein';
  end if;

  select ar.anteil into alter_betrag
  from advance_recipients ar
  where ar.advance_id = p_advance_id and ar.employee_id = p_employee_id;

  if not found then
    raise exception 'Empfänger nicht in diesem Beleg gefunden';
  end if;

  select belegnummer, zahlungsart, datum into v_belegnummer, v_zahlungsart, v_datum
  from advances where id = p_advance_id;

  if ist_kassenpruefung_gesperrt(v_datum) then
    raise exception 'Dieser Beleg gehört zu einer bereits freigegebenen Kassenprüfung und kann nicht mehr geändert werden. Bitte zunächst die Kassenprüfung im Kassenbuch wiedereröffnen.';
  end if;

  v_delta := p_neuer_betrag - coalesce(alter_betrag, 0);

  update advance_recipients
  set anteil = p_neuer_betrag
  where advance_id = p_advance_id and employee_id = p_employee_id;

  update advances
  set betrag = (
    select coalesce(sum(anteil), 0)
    from advance_recipients
    where advance_id = p_advance_id
  )
  where id = p_advance_id;

  insert into kassenbewegungen (art, belegnummer, delta, zahlungsart, bearbeiter_id, hinweis)
  values ('Vorschuss-Korrektur', v_belegnummer, v_delta, v_zahlungsart, auth.uid(), p_hinweis);
end;
$$;
