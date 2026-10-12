// Lokale Warteschlange (SQLite-Datei) fuer ernte_scan-Zeilen, die wegen
// Netzausfall/Supabase-Fehler nicht sofort geschrieben werden konnten -
// siehe docs/erntewirtschaft-plan.md Teil D ("lokale SQLite-Queue + Retry").
import Database from "better-sqlite3";

export function oeffneQueue(pfad) {
  const db = new Database(pfad);
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table if not exists warteschlange (
      id integer primary key autoincrement,
      erstellt_am text not null default (datetime('now')),
      payload text not null,
      versuche integer not null default 0,
      letzter_fehler text
    )
  `);
  return db;
}

export function einreihen(db, payload) {
  db.prepare("insert into warteschlange (payload) values (?)").run(JSON.stringify(payload));
}

export function wartendeHolen(db, limit = 50) {
  return db.prepare("select * from warteschlange order by id limit ?").all(limit);
}

export function entfernen(db, id) {
  db.prepare("delete from warteschlange where id = ?").run(id);
}

export function fehlerVermerken(db, id, fehler) {
  db.prepare("update warteschlange set versuche = versuche + 1, letzter_fehler = ? where id = ?").run(
    String(fehler),
    id,
  );
}

export function anzahlWartend(db) {
  return db.prepare("select count(*) as n from warteschlange").get().n;
}
