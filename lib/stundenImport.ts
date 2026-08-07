// Zuordnung/Validierung für den Stunden-Import aus Excel/CSV.
// Anderes Format als der Personal-Import (lib/personalImport.ts): dort eine
// Zeile pro Datensatz mit benannten Spalten, hier eine "breite" Matrix -
// Spalte 1 = Personalnummer, ab Spalte 2 je eine Spalte pro Datum. Reine
// Hilfsfunktionen (parseDatum/parseZahl) werden von dort wiederverwendet,
// um nicht zweimal dieselbe Logik zu pflegen.

import { parseDatum, parseZahl } from "./personalImport";

export type StundenZellStatus =
  | "importierbar"
  | "bereits_vorhanden"
  | "monat_gesperrt";

export interface StundenZelle {
  zeile: number; // Zeilennummer in der Datei (für Fehleranzeige)
  personal_nr: string;
  employee_id: string;
  name: string;
  datum: string; // ISO YYYY-MM-DD
  datumAnzeige: string; // wie in der Kopfzeile geschrieben
  stunden: number;
  status: StundenZellStatus;
}

export interface StundenImportFehler {
  zeile: number;
  grund: string;
}

export interface StundenImportErgebnis {
  spalten: { text: string; datum: string | null }[];
  zellen: StundenZelle[];
  zeilenFehler: StundenImportFehler[];
}

// Spalte 0 ist immer Personalnummer, ab Spalte 1 je ein Datum. Getrennt von
// baueStundenImport() nutzbar, um vorab die betroffenen Daten zu kennen
// (z.B. um gezielt nur die relevanten work_entries/periods zu laden), ohne
// dafür schon Mitarbeiter-/Bestehende-Einträge-Daten zu brauchen.
export function parseSpalten(
  kopfzeile: string[]
): { text: string; datum: string | null }[] {
  return kopfzeile.slice(1).map((text) => ({
    text: (text ?? "").trim(),
    datum: parseDatum((text ?? "").trim()),
  }));
}

// roheZeilen: Array-of-Arrays wie von XLSX.utils.sheet_to_json(sheet,
// { header: 1 }) geliefert - roheZeilen[0] ist die Kopfzeile.
export function baueStundenImport(
  roheZeilen: string[][],
  employeesNachPersonalNr: Map<string, { id: string; name: string }>,
  bestehendeEintraege: Set<string>, // "employee_id|datum"
  gesperrteMonate: Set<string> // "jahr-monat", z.B. "2026-4"
): StundenImportErgebnis {
  const spalten = parseSpalten(roheZeilen[0] ?? []);

  const zellen: StundenZelle[] = [];
  const zeilenFehler: StundenImportFehler[] = [];

  for (let i = 1; i < roheZeilen.length; i++) {
    const zeileNr = i + 1; // 1-basiert wie in Excel, inkl. Kopfzeile
    const roh = roheZeilen[i] ?? [];
    const personal_nr = (roh[0] ?? "").trim();
    if (!personal_nr) continue; // leere Zeile überspringen

    const key = personal_nr.toLowerCase();
    const employee = employeesNachPersonalNr.get(key);
    if (!employee) {
      zeilenFehler.push({
        zeile: zeileNr,
        grund: `Personalnummer "${personal_nr}" nicht gefunden`,
      });
      continue;
    }

    spalten.forEach((spalte, spaltenIndex) => {
      if (!spalte.datum) return; // Spaltenüberschrift kein erkennbares Datum
      const rohWert = (roh[spaltenIndex + 1] ?? "").trim();
      if (!rohWert) return; // keine Stunden für diese Person/dieses Datum eingetragen

      const stunden = parseZahl(rohWert);
      if (stunden === null) {
        zeilenFehler.push({
          zeile: zeileNr,
          grund: `${spalte.text}: Wert "${rohWert}" nicht als Zahl erkannt`,
        });
        return;
      }

      const [jahrStr, monatStr] = spalte.datum.split("-");
      const monatKey = `${jahrStr}-${Number(monatStr)}`;
      const eintragKey = `${employee.id}|${spalte.datum}`;

      let status: StundenZellStatus = "importierbar";
      if (gesperrteMonate.has(monatKey)) status = "monat_gesperrt";
      else if (bestehendeEintraege.has(eintragKey)) status = "bereits_vorhanden";

      zellen.push({
        zeile: zeileNr,
        personal_nr,
        employee_id: employee.id,
        name: employee.name,
        datum: spalte.datum,
        datumAnzeige: spalte.text,
        stunden,
        status,
      });
    });
  }

  return { spalten, zellen, zeilenFehler };
}
