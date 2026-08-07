"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { getSupabaseClient } from "@/lib/supabase/client";
import { zellwertZuText } from "@/lib/personalImport";
import {
  baueStundenImport,
  parseSpalten,
  type StundenImportErgebnis,
  type StundenZelle,
} from "@/lib/stundenImport";
import { formatDatumDE } from "@/lib/format";
import ErfassungTabs from "@/components/ErfassungTabs";

function heuteIso(offsetTage: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetTage);
  return `${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1
  ).padStart(2, "0")}.${d.getFullYear()}`;
}

function ladeVorlage() {
  const headers = ["Personalnummer", heuteIso(-2), heuteIso(-1), heuteIso(0)];
  const beispiel = ["342", "8", "7,5", ""];
  const sheet = XLSX.utils.aoa_to_sheet([headers, beispiel]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Stunden");
  XLSX.writeFile(workbook, "stunden-import-vorlage.xlsx");
}

export default function ErfassungImportPage() {
  const [dateiname, setDateiname] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ergebnis, setErgebnis] = useState<StundenImportErgebnis | null>(null);
  const [importErgebnis, setImportErgebnis] = useState<{
    erfolgreich: number;
    fehlgeschlagen: { zelle: StundenZelle; grund: string }[];
  } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setImportErgebnis(null);
    setDateiname(file.name);

    const supabase = getSupabaseClient();
    const { data: employeesData } = await supabase
      .from("employees")
      .select("id, personal_nr, name, vorname");
    const employeesNachPersonalNr = new Map<
      string,
      { id: string; name: string }
    >();
    (employeesData ?? []).forEach(
      (e: { id: string; personal_nr: string; name: string; vorname: string }) => {
        employeesNachPersonalNr.set(e.personal_nr.trim().toLowerCase(), {
          id: e.id,
          name: `${e.name}, ${e.vorname}`,
        });
      }
    );

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // header: 1 statt benannter Spalten - hier zählt die POSITION (Spalte 1
    // = Personalnummer, ab Spalte 2 je ein Datum), nicht der Spaltenname.
    const rohMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
    });
    const textMatrix = rohMatrix.map((zeile) =>
      zeile.map((zelle) => zellwertZuText(zelle))
    );

    // Für "bestehende Einträge haben Vorrang": alle im Datum-Bereich der
    // Datei bereits vorhandenen work_entries + gesperrte Monate laden.
    const spalten = parseSpalten(textMatrix[0] ?? []);
    const alleDaten = Array.from(
      new Set(spalten.map((s) => s.datum).filter((d): d is string => d !== null))
    );

    const [{ data: bestehendeData }, { data: periodsData }] =
      await Promise.all([
        alleDaten.length > 0
          ? supabase
              .from("work_entries")
              .select("employee_id, datum")
              .in("datum", alleDaten)
          : Promise.resolve({ data: [] }),
        supabase.from("periods").select("*").eq("gesperrt", true),
      ]);
    const bestehendeEintraege = new Set(
      (bestehendeData ?? []).map(
        (r: { employee_id: string; datum: string }) =>
          `${r.employee_id}|${r.datum}`
      )
    );
    const gesperrteMonate = new Set(
      (periodsData ?? []).map(
        (p: { saison_jahr: number; monat: number }) =>
          `${p.saison_jahr}-${p.monat}`
      )
    );

    const endgueltig = baueStundenImport(
      textMatrix,
      employeesNachPersonalNr,
      bestehendeEintraege,
      gesperrteMonate
    );
    setErgebnis(endgueltig);
    setParsing(false);
  }

  async function handleImport() {
    if (!ergebnis) return;
    setImporting(true);
    const supabase = getSupabaseClient();
    const importierbar = ergebnis.zellen.filter(
      (z) => z.status === "importierbar"
    );

    const ergebnisse = await Promise.allSettled(
      importierbar.map((z) =>
        supabase.from("work_entries").insert({
          employee_id: z.employee_id,
          datum: z.datum,
          stunden: z.stunden,
        })
      )
    );

    const fehlgeschlagen: { zelle: StundenZelle; grund: string }[] = [];
    let erfolgreich = 0;
    ergebnisse.forEach((r, i) => {
      if (r.status === "fulfilled" && !r.value.error) {
        erfolgreich++;
      } else {
        const grund =
          r.status === "fulfilled"
            ? r.value.error?.message ?? "unbekannter Fehler"
            : String(r.reason);
        fehlgeschlagen.push({ zelle: importierbar[i], grund });
      }
    });

    setImportErgebnis({ erfolgreich, fehlgeschlagen });
    setImporting(false);
  }

  const importierbareZellen =
    ergebnis?.zellen.filter((z) => z.status === "importierbar") ?? [];
  const bereitsVorhandeneZellen =
    ergebnis?.zellen.filter((z) => z.status === "bereits_vorhanden") ?? [];
  const gesperrteZellen =
    ergebnis?.zellen.filter((z) => z.status === "monat_gesperrt") ?? [];
  const nichtErkannteSpalten =
    ergebnis?.spalten.filter((s) => s.datum === null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <ErfassungTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Stunden importieren
        </h1>
        <p className="text-sm text-neutral-500">
          Excel- oder CSV-Datei hochladen: Spalte 1 = Personalnummer, ab
          Spalte 2 je eine Spalte pro Datum (Kopfzeile = Datum, z.B.
          "23.04.2026"). Existieren für eine Person und ein Datum bereits
          Stunden, hat der bestehende Eintrag Vorrang - diese Zellen werden
          übersprungen, nicht überschrieben.
        </p>
        <button
          type="button"
          className="btn-secondary mt-2 text-xs"
          onClick={ladeVorlage}
        >
          Vorlage herunterladen (.xlsx)
        </button>
      </div>

      <div>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        {dateiname && (
          <p className="mt-1 text-sm text-neutral-500">Datei: {dateiname}</p>
        )}
      </div>

      {parsing && <p className="text-neutral-500">Datei wird gelesen…</p>}

      {!parsing && ergebnis && (
        <>
          {nichtErkannteSpalten.length > 0 && (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Nicht als Datum erkannte Spaltenüberschriften (werden
              ignoriert): {nichtErkannteSpalten.map((s) => s.text).join(", ")}
            </p>
          )}

          {ergebnis.zeilenFehler.length > 0 && (
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-red-700">
                Fehler ({ergebnis.zeilenFehler.length})
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>Zeile</th>
                    <th>Grund</th>
                  </tr>
                </thead>
                <tbody>
                  {ergebnis.zeilenFehler.map((f, i) => (
                    <tr key={i}>
                      <td>{f.zeile}</td>
                      <td className="text-red-600">{f.grund}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-sm text-neutral-700">
            <p>
              <strong>{importierbareZellen.length}</strong> Werte werden
              importiert, <strong>{bereitsVorhandeneZellen.length}</strong>{" "}
              bereits vorhanden (übersprungen)
              {gesperrteZellen.length > 0 && (
                <>
                  , <strong>{gesperrteZellen.length}</strong> in gesperrtem
                  Monat (übersprungen)
                </>
              )}
              .
            </p>
          </div>

          {ergebnis.zellen.length > 0 && (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Zeile</th>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Datum</th>
                    <th>Stunden</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ergebnis.zellen.map((z, i) => (
                    <tr key={i}>
                      <td>{z.zeile}</td>
                      <td>{z.personal_nr}</td>
                      <td>{z.name}</td>
                      <td>{formatDatumDE(z.datum)}</td>
                      <td>{z.stunden}</td>
                      <td>
                        {z.status === "importierbar" ? (
                          <span className="text-emerald-700">
                            Wird importiert
                          </span>
                        ) : z.status === "bereits_vorhanden" ? (
                          <span className="text-neutral-500">
                            Bereits vorhanden - übersprungen
                          </span>
                        ) : (
                          <span className="text-amber-700">
                            Monat gesperrt - übersprungen
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn"
              disabled={importing || importierbareZellen.length === 0}
              onClick={handleImport}
            >
              {importierbareZellen.length} Wert(e) importieren
            </button>
            {importErgebnis && (
              <span className="text-sm">
                {importErgebnis.erfolgreich} erfolgreich importiert
                {importErgebnis.fehlgeschlagen.length > 0 &&
                  `, ${importErgebnis.fehlgeschlagen.length} fehlgeschlagen`}
              </span>
            )}
          </div>

          {importErgebnis && importErgebnis.fehlgeschlagen.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Datum</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>
                {importErgebnis.fehlgeschlagen.map((f, i) => (
                  <tr key={i}>
                    <td>{f.zelle.personal_nr}</td>
                    <td>{formatDatumDE(f.zelle.datum)}</td>
                    <td className="text-red-600">{f.grund}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
