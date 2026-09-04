// PostgREST/Supabase liefert je Anfrage höchstens ~1000 Zeilen. Listen, die
// eine ganze Tabelle ohne einschränkenden Filter laden, wurden dadurch still
// abgeschnitten - aufgefallen, als der Historie-Import tausende (inaktive)
// employees-Zeilen angelegt hat (Personalnummern ab ~7000 galten plötzlich als
// frei, Personen fehlten in der Gruppenaufteilung).
//
// Diese Hilfsfunktion ruft eine Abfrage so oft mit .range(von, bis) auf, bis
// eine Seite kürzer als die volle Seitengröße zurückkommt. Der Aufrufer baut
// die Query in `hole(von, bis)` frisch auf und setzt darin .range(von, bis)
// (und eine stabile .order(), damit die Seiten sich nicht überlappen).

type SeitenErgebnis = { data: unknown[] | null; error: unknown };

export async function ladeAlleSeiten<T>(
  hole: (von: number, bis: number) => PromiseLike<SeitenErgebnis>,
  seitengroesse = 1000
): Promise<T[]> {
  const alle: T[] = [];
  for (let seite = 0; seite < 200; seite++) {
    const von = seite * seitengroesse;
    const { data, error } = await hole(von, von + seitengroesse - 1);
    if (error || !data) break;
    alle.push(...(data as T[]));
    if (data.length < seitengroesse) break;
  }
  return alle;
}
