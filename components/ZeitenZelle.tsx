"use client";

import { useState } from "react";
import type { WorkEntry } from "@/lib/types";
import {
  formatZeit,
  parseZeit,
  stundenAusZeiten,
  zeitAnzeige,
  type Rundung,
  type ZettelZeiten,
} from "@/lib/zettelZeiten";
import { formatMenge } from "@/lib/format";

// Arbeitszeiten einer Person für den gewählten Tag: Vormittag von-bis und
// Nachmittag von-bis, daneben die errechnete Summe und die Pause. Wird beim
// Verlassen der Zelle gespeichert (nur bei echter Änderung). Der Elternteil
// setzt `key` mit der Eintragsversion, damit die Felder nach dem Speichern
// bzw. einem Neuladen den gespeicherten Stand zeigen.
export interface ZeitenSpeichern {
  vm_von: string | null;
  vm_bis: string | null;
  nm_von: string | null;
  nm_bis: string | null;
  // undefined = Stunden unverändert lassen (alle Zeiten gelöscht)
  stunden?: number;
}

function alsZeiten(entry: WorkEntry | undefined): ZettelZeiten {
  return {
    vmVon: zeitAnzeige(entry?.vm_von),
    vmBis: zeitAnzeige(entry?.vm_bis),
    nmVon: zeitAnzeige(entry?.nm_von),
    nmBis: zeitAnzeige(entry?.nm_bis),
  };
}

// Normalisiert die Eingabe ("630" -> "06:30"); leer bleibt leer.
function normiert(s: string): string {
  const m = parseZeit(s);
  return m === null ? s.trim() : formatZeit(m);
}

export default function ZeitenZelle({
  entry,
  rundung,
  disabled,
  onSpeichern,
}: {
  entry: WorkEntry | undefined;
  rundung: Rundung;
  disabled: boolean;
  onSpeichern: (werte: ZeitenSpeichern) => void;
}) {
  const gespeichert = alsZeiten(entry);
  const [z, setZ] = useState<ZettelZeiten>(gespeichert);
  const ergebnis = stundenAusZeiten(z, rundung);

  // Gespeicherte Zeiten vs. gespeicherte Stunden: weichen sie ab (z.B. weil
  // die Stunden von Hand überschrieben wurden), wird das angezeigt - die
  // Stunden bleiben der Lohn-Wert.
  const gespErgebnis = stundenAusZeiten(gespeichert, rundung);
  const weichtAb =
    !gespErgebnis.leer &&
    !gespErgebnis.fehler &&
    entry?.stunden != null &&
    Math.abs(Number(entry.stunden) - gespErgebnis.stunden) > 0.001;

  function feld(name: keyof ZettelZeiten, titel: string) {
    return (
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="w-14 px-1 text-center"
        placeholder="hh:mm"
        title={titel}
        value={z[name]}
        disabled={disabled}
        onChange={(e) => setZ((prev) => ({ ...prev, [name]: e.target.value }))}
        onBlur={(e) => setZ((prev) => ({ ...prev, [name]: normiert(e.target.value) }))}
      />
    );
  }

  function beiVerlassen(e: React.FocusEvent<HTMLDivElement>) {
    // Nur speichern, wenn der Fokus die ganze Zelle verlässt.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    const n: ZettelZeiten = {
      vmVon: normiert(z.vmVon),
      vmBis: normiert(z.vmBis),
      nmVon: normiert(z.nmVon),
      nmBis: normiert(z.nmBis),
    };
    if (JSON.stringify(n) === JSON.stringify(gespeichert)) return;
    const r = stundenAusZeiten(n, rundung);
    if (r.fehler) return; // wird in der Zelle angezeigt, nicht gespeichert
    const oderNull = (s: string) => (s === "" ? null : s);
    onSpeichern({
      vm_von: oderNull(n.vmVon),
      vm_bis: oderNull(n.vmBis),
      nm_von: oderNull(n.nmVon),
      nm_bis: oderNull(n.nmBis),
      // Alle Zeiten gelöscht: die Stunden bleiben unverändert stehen.
      stunden: r.leer ? undefined : r.stunden,
    });
  }

  return (
    <div onBlur={beiVerlassen} className="flex items-center gap-1">
      {feld("vmVon", "Vormittag von")}
      <span className="text-neutral-400">–</span>
      {feld("vmBis", "Vormittag bis")}
      <span className="mx-1 text-neutral-300">|</span>
      {feld("nmVon", "Nachmittag von")}
      <span className="text-neutral-400">–</span>
      {feld("nmBis", "Nachmittag bis")}
      <span className="ml-1 text-xs">
        {ergebnis.fehler ? (
          <span className="text-red-600">{ergebnis.fehler}</span>
        ) : ergebnis.leer ? null : (
          <>
            <span className="font-medium">{formatMenge(ergebnis.stunden, 2)} Std.</span>
            {ergebnis.pauseMinuten ? (
              <span className="text-neutral-500"> · Pause {ergebnis.pauseMinuten} Min.</span>
            ) : null}
          </>
        )}
        {weichtAb && !ergebnis.fehler && (
          <span
            className="ml-1 text-amber-700"
            title={`Die Zeiten ergeben ${formatMenge(gespErgebnis.stunden, 2)} Std., eingetragen sind ${formatMenge(Number(entry?.stunden), 2)} Std.`}
          >
            ⚠ weicht ab
          </span>
        )}
      </span>
    </div>
  );
}
