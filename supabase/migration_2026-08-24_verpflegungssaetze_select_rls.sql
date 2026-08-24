-- Bugfix 2026-08-24 (Nutzer-Meldung: "steht da, dass die Preise für 2026
-- noch nicht in den Einstellungen hinterlegt sind. Das stimmt aber nicht"):
-- die einzige bisherige Policy war "for all using (is_admin())" - damit
-- konnte KEINE andere Rolle (hr/zeiterfassung/kasse/lohnabrechnung/
-- pruefer/management/erntewirtschaft) verpflegungssaetze überhaupt lesen,
-- obwohl mehrere Seiten (Arbeitskleidung-Preise, Mindestlohn-Vorbelegung
-- auf Personal/Personalplanung/Anreiseliste) genau das für nicht-admin-
-- Rollen brauchen - fiel dort nur nicht als Fehler auf, weil die Abfrage
-- einfach leer zurückkam. Aufgeteilt wie bei zuckermais_saetze/
-- erdbeeren_parzellen_saetze: lesen breit, schreiben weiterhin nur admin.
drop policy if exists "verpflegungssaetze_rw" on verpflegungssaetze;

create policy "verpflegungssaetze_select" on verpflegungssaetze for select
  using (auth.uid() is not null);
create policy "verpflegungssaetze_write" on verpflegungssaetze for all
  using (is_admin()) with check (is_admin());
