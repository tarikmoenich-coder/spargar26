"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  baueZeile,
  erkenneSpalten,
  zellwertZuText,
  type ImportFeld,
} from "@/lib/personalImport";
import {
  erkenneSaisonSpalte,
  markiereVerdachtsdubletten,
  parseSaisonJahr,
  verdichtePersonen,
  type BestehenderMitarbeiter,
  type HistoriePerson,
} from "@/lib/personalImportHistorie";
import PersonalTabs from "@/components/PersonalTabs";

const BLOCK = 200;

function bloecke<T>(arr: T[], groesse = BLOCK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += groesse) out.push(arr.slice(i, i + groesse));
  return out;
}

function jahreLabel(jahre: number[]): string {
  if (jahre.length === 0) return "—";
  if (jahre.length === 1) return String(jahre[0]);
  return `${jahre[0]}–${jahre[jahre.length - 1]} (${jahre.length})`;
}

function ladeVerdachtCsv(personen: HistoriePerson[]) {
  const zeilen = personen.filter((p) => p.verdacht);
  const kopf = [
    "Personalnummer",
    "Name",
    "Vorname",
    "Geburtsdatum",
    "Jahre",
    "Verdacht",
  ];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = [
    kopf.join(";"),
    ...zeilen.map((p) =>
      [
        p.personal_nr,
        p.name,
        p.vorname,
        p.geburtsdatum ?? "",
        p.jahre.join(" "),
        p.verdacht ?? "",
      ]
        .map((x) => esc(String(x)))
        .join(";")
    ),
  ].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "verdachtsdubletten.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function PersonalImportHistoriePage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [dateiname, setDateiname] = useState<string | null>(null);
  const [erkannteSpalten, setErkannteSpalten] = useState<string[]>([]);
  const [unbekannteSpalten, setUnbekannteSpalten] = useState<string[]>([]);
  const [saisonSpalte, setSaisonSpalte] = useState<string | null>(null);
  const [personen, setPersonen] = useState<HistoriePerson[]>([]);
  // Personalnummer (klein) -> employee_id für schon vorhandene Personen
  const [bestehendId, setBestehendId] = useState<Map<string, string>>(new Map());
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [alsAktiv, setAlsAktiv] = useState(false);
  const [ergebnis, setErgebnis] = useState<{
    neu: number;
    imStamm: number;
    jahre: number;
    uebersprungen: number;
    fehler: { personal_nr: string; grund: string }[];
  } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setErgebnis(null);
    setPersonen([]);
    setDateiname(file.name);

    const supabase = getSupabaseClient();
    const [
      { data: bestehende },
      { data: gruppenData },
      { data: herkunftData },
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, geburtsdatum"),
      supabase.from("arbeitsgruppen").select("gruppe_nr"),
      supabase.from("herkuenfte").select("wert"),
    ]);

    const bestMap = new Map<string, string>();
    const bestListe: BestehenderMitarbeiter[] = [];
    (
      (bestehende as
        | {
            id: string;
            personal_nr: string;
            name: string;
            vorname: string;
            geburtsdatum: string | null;
          }[]
        | null) ?? []
    ).forEach((r) => {
      bestMap.set(r.personal_nr.trim().toLowerCase(), r.id);
      bestListe.push({
        personal_nr: r.personal_nr,
        name: r.name,
        vorname: r.vorname,
        geburtsdatum: r.geburtsdatum,
      });
    });
    setBestehendId(bestMap);

    const bekannteGruppen = new Set(
      (gruppenData ?? []).map((g: { gruppe_nr: string }) => g.gruppe_nr)
    );
    const bekannteHerkuenfte = new Set(
      (herkunftData ?? []).map((h: { wert: string }) => h.wert)
    );

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rohGemischt = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: true,
      defval: "",
    });
    const rohZeilen = rohGemischt.map((roh) => {
      const zeile: Record<string, string> = {};
      for (const [spalte, wert] of Object.entries(roh)) {
        zeile[spalte] = zellwertZuText(wert);
      }
      return zeile;
    });

    const headers = rohZeilen.length > 0 ? Object.keys(rohZeilen[0]) : [];
    const spaltenMap = erkenneSpalten(headers);
    const saisonHeader = erkenneSaisonSpalte(headers);
    setSaisonSpalte(saisonHeader);
    setErkannteSpalten(headers.filter((h) => spaltenMap[h] !== null));
    setUnbekannteSpalten(
      headers.filter((h) => spaltenMap[h] === null && h !== saisonHeader)
    );

    const eintraege = rohZeilen.map((roh, i) => {
      const werte: Partial<Record<ImportFeld, string>> = {};
      for (const [header, wert] of Object.entries(roh)) {
        const feld = spaltenMap[header];
        if (feld) werte[feld] = wert;
      }
      return {
        zeile: baueZeile(i + 2, werte, bekannteGruppen, bekannteHerkuenfte),
        saison_jahr: saisonHeader
          ? parseSaisonJahr(roh[saisonHeader] ?? "")
          : null,
      };
    });

    const verdichtet = verdichtePersonen(eintraege);
    markiereVerdachtsdubletten(verdichtet, bestListe);
    // stabile Anzeige: Fehler zuerst, dann Verdachtsfälle, dann Rest
    verdichtet.sort((a, b) => {
      const rang = (p: HistoriePerson) =>
        p.fehler.length > 0 ? 0 : p.verdacht ? 1 : 2;
      return rang(a) - rang(b) || a.personal_nr.localeCompare(b.personal_nr);
    });
    setPersonen(verdichtet);
    setParsing(false);
  }

  const stats = useMemo(() => {
    let neu = 0;
    let imStamm = 0;
    let fehler = 0;
    let verdacht = 0;
    for (const p of personen) {
      if (p.fehler.length > 0) {
        fehler++;
        continue;
      }
      if (p.verdacht) verdacht++;
      if (bestehendId.has(p.personal_nr.trim().toLowerCase())) imStamm++;
      else neu++;
    }
    return { neu, imStamm, fehler, verdacht, gesamt: personen.length };
  }, [personen, bestehendId]);

  async function handleImport() {
    setImporting(true);
    const supabase = getSupabaseClient();
    const importierbar = personen.filter((p) => p.fehler.length === 0);
    const fehler: { personal_nr: string; grund: string }[] = [];

    const neuePersonen = importierbar.filter(
      (p) => !bestehendId.has(p.personal_nr.trim().toLowerCase())
    );
    const vorhandene = importierbar.filter((p) =>
      bestehendId.has(p.personal_nr.trim().toLowerCase())
    );

    // Personalnummer (klein) -> employee_id, für die Präsenz-Zeilen
    const idNachNr = new Map<string, string>(bestehendId);

    for (const block of bloecke(neuePersonen)) {
      const payload = block.map((p) => ({
        personal_nr: p.personal_nr,
        gruppe_nr: p.gruppe_nr,
        name: p.name,
        vorname: p.vorname,
        herkunft: p.herkunft,
        nationalitaet: p.nationalitaet,
        geburtsdatum: p.geburtsdatum,
        ort: p.ort,
        land: p.land,
        stundenlohn: p.stundenlohn,
        abrechnungsart: p.abrechnungsart,
        sozialversicherungsnummer: p.sozialversicherungsnummer,
        steuer_id: p.steuer_id,
        iban: p.iban,
        bic: p.bic,
        zahlungsempfaenger: p.zahlungsempfaenger,
        aktiv: alsAktiv,
      }));
      const { data, error } = await supabase
        .from("employees")
        .insert(payload)
        .select("id, personal_nr");
      if (error) {
        // Blockweiser Fehler: jede Zeile des Blocks als fehlgeschlagen melden
        for (const p of block) {
          fehler.push({ personal_nr: p.personal_nr, grund: error.message });
        }
        continue;
      }
      (data as { id: string; personal_nr: string }[] | null)?.forEach((r) => {
        idNachNr.set(r.personal_nr.trim().toLowerCase(), r.id);
      });
    }

    // Absicherung: für neu angelegte Personen ohne zurückgelieferte id (z.B.
    // wenn PostgREST die Rückgabe begrenzt) die id noch einmal gezielt holen,
    // damit keine Präsenz-Jahre verloren gehen.
    const fehlendeNrn = neuePersonen
      .map((p) => p.personal_nr)
      .filter((nr) => !idNachNr.has(nr.trim().toLowerCase()));
    for (const block of bloecke(fehlendeNrn)) {
      const { data } = await supabase
        .from("employees")
        .select("id, personal_nr")
        .in("personal_nr", block);
      (data as { id: string; personal_nr: string }[] | null)?.forEach((r) => {
        idNachNr.set(r.personal_nr.trim().toLowerCase(), r.id);
      });
    }

    // Präsenz-Zeilen für alle erfolgreich vorhandenen/angelegten Personen
    const praesenz: {
      employee_id: string;
      saison_jahr: number;
      quelle: string;
    }[] = [];
    for (const p of [...neuePersonen, ...vorhandene]) {
      const id = idNachNr.get(p.personal_nr.trim().toLowerCase());
      if (!id) continue; // Anlegen ist fehlgeschlagen
      for (const jahr of p.jahre) {
        praesenz.push({ employee_id: id, saison_jahr: jahr, quelle: "import" });
      }
    }

    let jahreGesetzt = 0;
    for (const block of bloecke(praesenz)) {
      const { error } = await supabase
        .from("employee_saison_praesenz")
        .upsert(block, {
          onConflict: "employee_id,saison_jahr",
          ignoreDuplicates: true,
        });
      if (error) {
        fehler.push({
          personal_nr: `(Präsenz-Block ${block[0]?.saison_jahr ?? ""})`,
          grund: error.message,
        });
        continue;
      }
      jahreGesetzt += block.length;
    }

    // tatsächlich angelegt = neue Person, die jetzt eine id hat
    const neuMitId = neuePersonen.filter((p) =>
      idNachNr.has(p.personal_nr.trim().toLowerCase())
    ).length;

    setErgebnis({
      neu: neuMitId,
      imStamm: vorhandene.length,
      jahre: jahreGesetzt,
      uebersprungen: personen.length - importierbar.length,
      fehler,
    });
    setImporting(false);
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-6">
        <PersonalTabs />
        <p className="text-sm text-neutral-500">
          Der Historie-Import ist nur für Admin/HR.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Personal-Historie importieren
        </h1>
        <p className="text-sm text-neutral-500">
          Einmaliger Import der kompletten Vorjahres-Personaldatei (eine Zeile je
          Person <strong>und</strong> Saison-Jahr). Zeilen mit derselben
          Personalnummer werden zu <strong>einer</strong> Person zusammengefasst –
          das jüngste Jahr liefert die Stammdaten, die Jahre werden als „war da"
          gespeichert. Neu angelegte Personen kommen <strong>inaktiv</strong> in
          den Personalstamm und reservieren nur ihre Nummer. Für den normalen
          Saison-Import neuer Mitarbeiter den Reiter{" "}
          <span className="font-medium">Import</span> nutzen.
        </p>
      </div>

      <div>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        {dateiname && (
          <p className="mt-1 text-sm text-neutral-500">Datei: {dateiname}</p>
        )}
      </div>

      {parsing && <p className="text-neutral-500">Datei wird gelesen…</p>}

      {!parsing && personen.length > 0 && (
        <>
          <div className="text-sm text-neutral-500">
            <p>Erkannte Spalten: {erkannteSpalten.join(", ") || "keine"}</p>
            <p>
              Saison/Jahr-Spalte:{" "}
              {saisonSpalte ? (
                <span className="text-emerald-700">{saisonSpalte}</span>
              ) : (
                <span className="text-amber-600">
                  keine erkannt – Personen werden ohne Jahre angelegt
                </span>
              )}
            </p>
            {unbekannteSpalten.length > 0 && (
              <p>
                Nicht erkannt (werden ignoriert): {unbekannteSpalten.join(", ")}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              {stats.gesamt} Personen aus der Datei
            </span>
            <span className="text-emerald-700">{stats.neu} neu</span>
            <span className="text-neutral-600">
              {stats.imStamm} schon im Stamm (nur Jahre ergänzen)
            </span>
            {stats.verdacht > 0 && (
              <span className="text-amber-600">
                {stats.verdacht} Verdachtsfälle
              </span>
            )}
            {stats.fehler > 0 && (
              <span className="text-red-600">{stats.fehler} mit Fehler</span>
            )}
          </div>

          {stats.verdacht > 0 && (
            <button
              type="button"
              className="btn-secondary self-start text-xs"
              onClick={() => ladeVerdachtCsv(personen)}
            >
              Verdachtsfälle als CSV ({stats.verdacht})
            </button>
          )}

          <div className="max-h-[28rem] overflow-auto rounded border border-linie">
            <table>
              <thead className="sticky top-0 bg-sand">
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Jahre</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {personen.slice(0, 400).map((p) => {
                  const imStamm = bestehendId.has(
                    p.personal_nr.trim().toLowerCase()
                  );
                  return (
                    <tr key={p.personal_nr}>
                      <td>{p.personal_nr}</td>
                      <td>
                        {p.name}, {p.vorname}
                      </td>
                      <td className="whitespace-nowrap">
                        {jahreLabel(p.jahre)}
                      </td>
                      <td>
                        {p.fehler.length > 0 ? (
                          <span className="text-red-600">
                            Fehler: {p.fehler.join("; ")}
                          </span>
                        ) : p.verdacht ? (
                          <span className="text-amber-600">
                            ⚠ {p.verdacht}
                            {imStamm
                              ? " · im Stamm, Jahre werden ergänzt"
                              : " · wird trotzdem angelegt"}
                          </span>
                        ) : imStamm ? (
                          <span className="text-neutral-600">
                            im Stamm – Jahre werden ergänzt
                          </span>
                        ) : (
                          <span className="text-emerald-700">
                            neu{p.warnungen.length > 0 && ` (${p.warnungen.join("; ")})`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {personen.length > 400 && (
              <p className="p-2 text-xs text-neutral-500">
                … {personen.length - 400} weitere Zeilen (werden mitimportiert)
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={alsAktiv}
              onChange={(e) => setAlsAktiv(e.target.checked)}
            />
            <span>
              Neu angelegte Personen sofort <span className="font-semibold">aktiv</span>{" "}
              setzen – normalerweise <span className="font-semibold">nicht</span>,
              das ist ein Historie-Import.
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn"
              disabled={importing || stats.neu + stats.imStamm === 0}
              onClick={handleImport}
            >
              {importing
                ? "Import läuft…"
                : `${stats.neu} anlegen + ${stats.imStamm} ergänzen`}
            </button>
            {ergebnis && (
              <span className="text-sm">
                {ergebnis.neu} neu angelegt, {ergebnis.imStamm} im Stamm ergänzt,{" "}
                {ergebnis.jahre} Präsenz-Jahre gesetzt
                {ergebnis.uebersprungen > 0 &&
                  `, ${ergebnis.uebersprungen} wegen Fehler übersprungen`}
                {ergebnis.fehler.length > 0 &&
                  `, ${ergebnis.fehler.length} fehlgeschlagen`}
              </span>
            )}
          </div>

          {ergebnis && ergebnis.fehler.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Personalnummer</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>
                {ergebnis.fehler.map((f, i) => (
                  <tr key={`${f.personal_nr}-${i}`}>
                    <td>{f.personal_nr}</td>
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
