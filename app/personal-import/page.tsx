"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  baueZeile,
  erkenneSpalten,
  IMPORT_FELDER,
  zellwertZuText,
  type ImportFeld,
  type ImportZeile,
} from "@/lib/personalImport";
import PersonalTabs from "@/components/PersonalTabs";

const TEMPLATE_SPALTEN: Record<ImportFeld, string> = {
  personal_nr: "Personalnummer",
  gruppe_nr: "Gruppe",
  herkunft: "Herkunft",
  nationalitaet: "Nationalitaet",
  name: "Name",
  vorname: "Vorname",
  geburtsdatum: "Geburtsdatum",
  ort: "Ort",
  land: "Land",
  stundenlohn: "Stundenlohn",
  abrechnungsart: "Abrechnungsart",
  sozialversicherungsnummer: "Sozialversicherungsnummer",
  steuer_id: "Steuer-ID",
  iban: "IBAN",
  bic: "BIC",
  zahlungsempfaenger: "Zahlungsempfaenger",
};

function ladeVorlage() {
  const headers = IMPORT_FELDER.map((f) => TEMPLATE_SPALTEN[f]);
  const beispiel = [
    "342",
    "1",
    "Kroatien",
    "Kroatisch",
    "Muster",
    "Maria",
    "23.04.1990",
    "Zagreb",
    "Kroatien",
    "13,50",
    "SV-Pfl.",
    "",
    "",
    "",
    "",
    "",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headers, beispiel]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Personal");
  XLSX.writeFile(workbook, "personal-import-vorlage.xlsx");
}

export default function PersonalImportPage() {
  const [dateiname, setDateiname] = useState<string | null>(null);
  const [erkannteSpalten, setErkannteSpalten] = useState<string[]>([]);
  const [unbekannteSpalten, setUnbekannteSpalten] = useState<string[]>([]);
  const [zeilen, setZeilen] = useState<ImportZeile[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ergebnis, setErgebnis] = useState<{
    erfolgreich: number;
    fehlgeschlagen: { zeile: number; grund: string }[];
  } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setErgebnis(null);
    setDateiname(file.name);

    const supabase = getSupabaseClient();
    const [{ data: bestehende }, { data: gruppenData }, { data: herkunftData }] =
      await Promise.all([
        supabase.from("employees").select("personal_nr, name, vorname"),
        supabase.from("arbeitsgruppen").select("gruppe_nr"),
        supabase.from("herkuenfte").select("wert"),
      ]);
    const bestehendeNummern = new Map<string, string>();
    (bestehende ?? []).forEach((r: { personal_nr: string; name: string; vorname: string }) => {
      bestehendeNummern.set(r.personal_nr.trim().toLowerCase(), `${r.name}, ${r.vorname}`);
    });
    const bekannteGruppen = new Set(
      (gruppenData ?? []).map((g: { gruppe_nr: string }) => g.gruppe_nr)
    );
    const bekannteHerkuenfte = new Set(
      (herkunftData ?? []).map((h: { wert: string }) => h.wert)
    );

    const buffer = await file.arrayBuffer();
    // cellDates: echte Excel-Datumszellen als Date-Objekt liefern statt als
    // Text - sonst formatiert die Bibliothek sie nach einem US-Standard
    // (M/T/JJ) unabhängig von der Anzeige in Excel.
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rohZeilenGemischt = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      sheet,
      { raw: true, defval: "" }
    );
    const rohZeilen = rohZeilenGemischt.map((roh) => {
      const zeile: Record<string, string> = {};
      for (const [spalte, wert] of Object.entries(roh)) {
        zeile[spalte] = zellwertZuText(wert);
      }
      return zeile;
    });

    const headers = rohZeilen.length > 0 ? Object.keys(rohZeilen[0]) : [];
    const spaltenMap = erkenneSpalten(headers);
    setErkannteSpalten(
      headers.filter((h) => spaltenMap[h] !== null)
    );
    setUnbekannteSpalten(headers.filter((h) => spaltenMap[h] === null));

    const gebaut = rohZeilen.map((roh, i) => {
      const werte: Partial<Record<ImportFeld, string>> = {};
      for (const [header, wert] of Object.entries(roh)) {
        const feld = spaltenMap[header];
        if (feld) werte[feld] = wert;
      }
      return baueZeile(i + 2, werte, bekannteGruppen, bekannteHerkuenfte);
    });

    // Dubletten innerhalb der Datei + gegen bestehenden Personalstamm prüfen.
    const zaehler = new Map<string, number>();
    gebaut.forEach((z) => {
      if (!z.personal_nr) return;
      const key = z.personal_nr.toLowerCase();
      zaehler.set(key, (zaehler.get(key) ?? 0) + 1);
    });

    const geprueft = gebaut.map((z) => {
      if (!z.personal_nr) return z;
      const key = z.personal_nr.toLowerCase();
      const fehler = [...z.fehler];
      const warnungen = [...z.warnungen];
      if ((zaehler.get(key) ?? 0) > 1) {
        fehler.push("Personalnummer kommt mehrfach in dieser Datei vor");
      }
      const bestehenderName = bestehendeNummern.get(key);
      if (bestehenderName) {
        fehler.push(`Personalnummer bereits vergeben an ${bestehenderName}`);
      }
      // Statuswechsel-Verknüpfung ("342a" -> Vorgänger "342") - nur ein
      // Hinweis, kein Fehler: fehlt der Vorgänger, wird die Zeile trotzdem
      // ganz normal importiert, nur ohne Verknüpfung.
      if (z.vorgaenger_personal_nr) {
        const vKey = z.vorgaenger_personal_nr.toLowerCase();
        if (bestehendeNummern.has(vKey) || zaehler.has(vKey)) {
          warnungen.push(
            `wird mit Vorgänger-Person "${z.vorgaenger_personal_nr}" verknüpft`
          );
        } else {
          warnungen.push(
            `Vorgänger-Person "${z.vorgaenger_personal_nr}" nicht gefunden - wird ohne Verknüpfung importiert`
          );
        }
      }
      return { ...z, fehler, warnungen };
    });

    setZeilen(geprueft);
    setParsing(false);
  }

  function insertPayload(
    z: ImportZeile,
    vorgaenger_employee_id: string | null
  ) {
    return {
      personal_nr: z.personal_nr,
      gruppe_nr: z.gruppe_nr,
      name: z.name,
      vorname: z.vorname,
      herkunft: z.herkunft,
      nationalitaet: z.nationalitaet,
      geburtsdatum: z.geburtsdatum,
      ort: z.ort,
      land: z.land,
      stundenlohn: z.stundenlohn,
      abrechnungsart: z.abrechnungsart,
      sozialversicherungsnummer: z.sozialversicherungsnummer,
      steuer_id: z.steuer_id,
      iban: z.iban,
      bic: z.bic,
      zahlungsempfaenger: z.zahlungsempfaenger,
      vorgaenger_employee_id,
    };
  }

  async function handleImport() {
    setImporting(true);
    const supabase = getSupabaseClient();
    const importierbar = zeilen.filter((z) => z.fehler.length === 0);
    const fehlgeschlagen: { zeile: number; grund: string }[] = [];
    let erfolgreich = 0;

    // Zwei Phasen wegen der Statuswechsel-Verknüpfung ("342a" -> Vorgänger
    // "342"): eine Vorgänger-Person kann in DIESER SELBEN Datei mit
    // importiert werden, ihre employee_id existiert also erst NACH Phase 1.
    const basisZeilen = importierbar.filter((z) => !z.vorgaenger_personal_nr);
    const aZeilen = importierbar.filter((z) => z.vorgaenger_personal_nr);

    const basisErgebnisse = await Promise.allSettled(
      basisZeilen.map((z) =>
        supabase
          .from("employees")
          .insert(insertPayload(z, null))
          .select("id, personal_nr")
          .single()
      )
    );

    // Personalnummer (klein geschrieben) -> employee_id, für die Auflösung
    // der Vorgänger-Verknüpfung in Phase 2 - bereits bestehende Personen
    // (aus einem früheren Import/manuell angelegt) plus die gerade in
    // Phase 1 neu angelegten.
    const idNachPersonalNr = new Map<string, string>();
    const { data: bestehendeIds } = await supabase
      .from("employees")
      .select("id, personal_nr");
    (
      (bestehendeIds as { id: string; personal_nr: string }[] | null) ?? []
    ).forEach((r) => {
      idNachPersonalNr.set(r.personal_nr.trim().toLowerCase(), r.id);
    });

    basisErgebnisse.forEach((r, i) => {
      const zeile = basisZeilen[i].zeile;
      if (r.status === "fulfilled" && !r.value.error && r.value.data) {
        erfolgreich++;
        idNachPersonalNr.set(
          r.value.data.personal_nr.trim().toLowerCase(),
          r.value.data.id
        );
      } else {
        const grund =
          r.status === "fulfilled"
            ? r.value.error?.message ?? "unbekannter Fehler"
            : String(r.reason);
        fehlgeschlagen.push({ zeile, grund });
      }
    });

    const aErgebnisse = await Promise.allSettled(
      aZeilen.map((z) => {
        const vorgaengerId = z.vorgaenger_personal_nr
          ? idNachPersonalNr.get(z.vorgaenger_personal_nr.toLowerCase()) ??
            null
          : null;
        return supabase.from("employees").insert(insertPayload(z, vorgaengerId));
      })
    );
    aErgebnisse.forEach((r, i) => {
      const zeile = aZeilen[i].zeile;
      if (r.status === "fulfilled" && !r.value.error) {
        erfolgreich++;
      } else {
        const grund =
          r.status === "fulfilled"
            ? r.value.error?.message ?? "unbekannter Fehler"
            : String(r.reason);
        fehlgeschlagen.push({ zeile, grund });
      }
    });

    setErgebnis({ erfolgreich, fehlgeschlagen });
    setImporting(false);
  }

  const importierbareAnzahl = zeilen.filter((z) => z.fehler.length === 0).length;

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Personal importieren
        </h1>
        <p className="text-sm text-neutral-500">
          Excel- oder CSV-Datei mit einer Zeile pro Mitarbeiter hochladen.
          Personalnummer, Name und Vorname sind Pflicht; alle anderen Spalten
          sind optional. Zeilen mit bereits vergebener Personalnummer werden
          nicht importiert und einzeln als Fehler angezeigt.
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
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
        />
        {dateiname && (
          <p className="mt-1 text-sm text-neutral-500">
            Datei: {dateiname}
          </p>
        )}
      </div>

      {parsing && <p className="text-neutral-500">Datei wird gelesen…</p>}

      {!parsing && zeilen.length > 0 && (
        <>
          <div className="text-sm text-neutral-500">
            <p>
              Erkannte Spalten: {erkannteSpalten.join(", ") || "keine"}
            </p>
            {unbekannteSpalten.length > 0 && (
              <p>
                Nicht erkannte Spalten (werden ignoriert):{" "}
                {unbekannteSpalten.join(", ")}
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Zeile</th>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.zeile}>
                    <td>{z.zeile}</td>
                    <td>{z.personal_nr || "—"}</td>
                    <td>
                      {z.name}, {z.vorname}
                    </td>
                    <td>
                      {z.fehler.length > 0 ? (
                        <span className="text-red-600">
                          Fehler: {z.fehler.join("; ")}
                        </span>
                      ) : z.warnungen.length > 0 ? (
                        <span className="text-amber-600">
                          OK (mit Hinweis: {z.warnungen.join("; ")})
                        </span>
                      ) : (
                        <span className="text-emerald-700">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn"
              disabled={importing || importierbareAnzahl === 0}
              onClick={handleImport}
            >
              {importierbareAnzahl} Zeile(n) importieren
            </button>
            {ergebnis && (
              <span className="text-sm">
                {ergebnis.erfolgreich} erfolgreich importiert
                {ergebnis.fehlgeschlagen.length > 0 &&
                  `, ${ergebnis.fehlgeschlagen.length} fehlgeschlagen`}
              </span>
            )}
          </div>

          {ergebnis && ergebnis.fehlgeschlagen.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Zeile</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>
                {ergebnis.fehlgeschlagen.map((f) => (
                  <tr key={f.zeile}>
                    <td>{f.zeile}</td>
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
