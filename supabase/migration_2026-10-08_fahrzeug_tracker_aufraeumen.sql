-- Der Poller hat fahrzeug_tracker bisher nur per upsert aktualisiert, nie
-- aufgeräumt. In Traccar geänderte (neue uniqueId) oder gelöschte Geräte
-- blieben dadurch als Karteileichen stehen. Jetzt:
--   - noch keinem Fahrzeug zugeordnete Karteileichen löscht der Poller,
--   - einem Fahrzeug zugeordnete, die in Traccar fehlen, werden markiert.

alter table fahrzeug_tracker
  add column if not exists traccar_fehlt boolean not null default false;
