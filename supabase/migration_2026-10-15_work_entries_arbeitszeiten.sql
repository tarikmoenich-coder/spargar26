-- Arbeitszeiten (von-bis, Vormittag/Nachmittag) je Person und Tag.
-- Optional neben work_entries.stunden: wer Zeiten erfasst, dessen Stunden
-- werden daraus errechnet (Viertelstunden-Rundung als Standard in der App);
-- die Pause ergibt sich aus der Lücke zwischen Vormittag-Ende und
-- Nachmittag-Beginn. Reine Stundeneingabe bleibt weiterhin möglich.
alter table work_entries
  add column if not exists vm_von time,
  add column if not exists vm_bis time,
  add column if not exists nm_von time,
  add column if not exists nm_bis time;

alter table work_entries
  add constraint work_entries_zeiten_reihenfolge check (
    (vm_von is null or vm_bis is null or vm_bis > vm_von)
    and (nm_von is null or nm_bis is null or nm_bis > nm_von)
    and (vm_bis is null or nm_von is null or nm_von >= vm_bis)
  );
