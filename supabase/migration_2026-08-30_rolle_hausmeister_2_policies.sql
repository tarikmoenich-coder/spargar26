-- Teil 2 (NACH migration_2026-08-30_rolle_hausmeister_1_enum.sql, in einem
-- eigenen Lauf): 'hausmeister' darf die laufenden Unterkunfts-Vorgaenge
-- schreiben - Belegung, Vorgang (Uebergabe/Abnahme/Kontrolle), Positionen,
-- Maengel und Fotos. Lesen war schon vorher fuer alle eingeloggten Rollen
-- offen (unterkunft_*_select via auth.uid() is not null), daher bekommt auch
-- 'erntewirtschaft' seinen (nur lesenden) Zugriff ohne weitere Aenderung.
--
-- NICHT erweitert: unterkunft_gebaeude / _zimmer / _bett / _checkliste_vorlage
-- (Stammdaten bleiben admin + hr). Das Platzieren der Zimmer im Grundriss
-- (Spalten plan_x/plan_y/plan_w/plan_h auf unterkunft_zimmer) laeuft ueber die
-- unveraenderte unterkunft_zimmer_write-Policy und ist zusaetzlich in der UI
-- auf admin beschraenkt.

drop policy if exists "unterkunft_belegung_write" on unterkunft_belegung;
create policy "unterkunft_belegung_write" on unterkunft_belegung for all
  using (current_role_name() in ('admin', 'hr', 'hausmeister'))
  with check (current_role_name() in ('admin', 'hr', 'hausmeister'));

drop policy if exists "unterkunft_vorgang_write" on unterkunft_vorgang;
create policy "unterkunft_vorgang_write" on unterkunft_vorgang for all
  using (current_role_name() in ('admin', 'hr', 'hausmeister'))
  with check (current_role_name() in ('admin', 'hr', 'hausmeister'));

drop policy if exists "unterkunft_vorgang_position_write" on unterkunft_vorgang_position;
create policy "unterkunft_vorgang_position_write" on unterkunft_vorgang_position for all
  using (current_role_name() in ('admin', 'hr', 'hausmeister'))
  with check (current_role_name() in ('admin', 'hr', 'hausmeister'));

drop policy if exists "unterkunft_mangel_write" on unterkunft_mangel;
create policy "unterkunft_mangel_write" on unterkunft_mangel for all
  using (current_role_name() in ('admin', 'hr', 'hausmeister'))
  with check (current_role_name() in ('admin', 'hr', 'hausmeister'));

drop policy if exists "unterkunft_foto_write" on unterkunft_foto;
create policy "unterkunft_foto_write" on unterkunft_foto for all
  using (current_role_name() in ('admin', 'hr', 'hausmeister'))
  with check (current_role_name() in ('admin', 'hr', 'hausmeister'));

-- Storage: bisher gab es nur eine kombinierte for-all-Policy fuer admin/hr,
-- die auch das Lesen (signierte URLs) abdeckte. Jetzt getrennt: lesen alle
-- Angemeldeten (analog zu den Tabellen-select-Policies), schreiben admin/hr/
-- hausmeister.
drop policy if exists "unterkunft_fotos_storage_admin_hr" on storage.objects;

create policy "unterkunft_fotos_storage_select" on storage.objects for select
  using (bucket_id = 'unterkunft-fotos' and auth.uid() is not null);

create policy "unterkunft_fotos_storage_write" on storage.objects for all
  using (bucket_id = 'unterkunft-fotos' and current_role_name() in ('admin', 'hr', 'hausmeister'))
  with check (bucket_id = 'unterkunft-fotos' and current_role_name() in ('admin', 'hr', 'hausmeister'));
