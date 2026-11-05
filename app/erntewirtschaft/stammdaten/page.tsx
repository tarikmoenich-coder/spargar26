"use client";

// Erntewirtschaft -> Stammdaten (docs/erntewirtschaft-plan.md Teil F):
// Maschinen-CRUD + Bulk-Import für die 140 Spargelspinnen, Waagen-CRUD,
// Konfig-Werte. Bisher stand nur die eine Pilotmaschine manuell in der DB -
// diese Seite macht den Rollout der restlichen ~139 Maschinen möglich.
//
// canEdit ist bewusst je Abschnitt unterschiedlich, passend zur jeweils
// tatsächlichen RLS-Policy (nicht einheitlich admin/hr):
//   ernte_maschine_write: admin, hr, erntewirtschaft, zeiterfassung
//   ernte_waage_write:    admin, hr
//   ernte_konfig_write:   admin
// Eine Bearbeiten-Steuerung anzuzeigen, die die RLS dann doch ablehnt, wäre
// irreführend - deshalb drei getrennte canEdit*-Werte statt einem.
//
// Struktur/Muster bewusst an app/fahrzeuge/stammdaten/page.tsx angelehnt
// (Formular-State + leereForm()/ausXxx()-Konverter, ein "bearbeiten"-State,
// gruppierte Tabelle, Checkbox-Mehrfachauswahl + Bulk-Aktionsleiste) - hier
// deutlich schlanker, da Maschinen/Waagen weniger Felder haben.

import { Fragment, useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Settings } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import type { ErnteKonfig, ErnteMaschine, ErnteWaage } from "@/lib/types";
import {
  baueZeile,
  ERNTE_MASCHINE_IMPORT_FELDER,
  erkenneSpalten,
  zellwertZuText,
  type ErnteMaschineImportFeld,
  type ErnteMaschineImportZeile,
} from "@/lib/ernteMaschineImport";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import PageHeader from "@/components/PageHeader";

const BLOCK = 200;

function bloecke<T>(arr: T[], groesse = BLOCK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += groesse) out.push(arr.slice(i, i + groesse));
  return out;
}

// ---------------------------------------------------------------------------
// Maschinen
// ---------------------------------------------------------------------------

interface MaschineForm {
  nummer: string;
  bezeichnung: string;
  box_seriennummer: string;
  traccar_unique_id: string;
  max_personen: string;
  notiz: string;
}

function leereMaschineForm(): MaschineForm {
  return {
    nummer: "",
    bezeichnung: "",
    box_seriennummer: "",
    traccar_unique_id: "",
    max_personen: "1",
    notiz: "",
  };
}

function ausMaschine(m: ErnteMaschine): MaschineForm {
  return {
    nummer: m.nummer,
    bezeichnung: m.bezeichnung ?? "",
    box_seriennummer: m.box_seriennummer ?? "",
    traccar_unique_id: m.traccar_unique_id ?? "",
    max_personen: String(m.max_personen),
    notiz: m.notiz ?? "",
  };
}

const TEMPLATE_SPALTEN: Record<ErnteMaschineImportFeld, string> = {
  nummer: "Nummer",
  bezeichnung: "Bezeichnung",
  box_seriennummer: "Box-Seriennummer",
  // Bewusst nur "IMEI" statt "Traccar-Unique-ID (IMEI)" - Klammerzusätze in
  // der Kopfzeile verschmelzen in normalisiereHeader() mit dem Haupttext
  // und wären sonst nicht mehr zuverlässig wiedererkennbar (siehe Alias-
  // Liste in lib/ernteMaschineImport.ts).
  traccar_unique_id: "IMEI",
};

function ladeVorlage() {
  const headers = ERNTE_MASCHINE_IMPORT_FELDER.map((f) => TEMPLATE_SPALTEN[f]);
  const beispiel = ["101", "Spinne 101", "SN-00101", "864xxxxxxxxxxxx"];
  const sheet = XLSX.utils.aoa_to_sheet([headers, beispiel]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Maschinen");
  XLSX.writeFile(workbook, "erntemaschinen-import-vorlage.xlsx");
}

export default function ErntewirtschaftStammdatenPage() {
  const { profile } = useProfile();
  const role = profile?.role;
  const canEditMaschinen =
    role === "admin" || role === "hr" || role === "erntewirtschaft" || role === "zeiterfassung";
  const canEditWaagen = role === "admin" || role === "hr";
  const canEditKonfig = role === "admin";

  const [maschinen, setMaschinen] = useState<ErnteMaschine[]>([]);
  const [waagen, setWaagen] = useState<ErnteWaage[]>([]);
  const [konfig, setKonfig] = useState<ErnteKonfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    const supabase = getSupabaseClient();
    const [m, w, k] = await Promise.all([
      supabase.from("ernte_maschine").select("*").order("nummer"),
      supabase.from("ernte_waage").select("*").order("name"),
      supabase.from("ernte_konfig").select("*").order("schluessel"),
    ]);
    setMaschinen((m.data as ErnteMaschine[]) ?? []);
    setWaagen((w.data as ErnteWaage[]) ?? []);
    setKonfig((k.data as ErnteKonfig[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  // ---- Maschinen: Formular ----
  const [maschineBearbeiten, setMaschineBearbeiten] = useState<ErnteMaschine | "neu" | null>(
    null
  );
  const [maschineForm, setMaschineForm] = useState<MaschineForm>(leereMaschineForm());
  const [maschineSpeichert, setMaschineSpeichert] = useState(false);

  function starteMaschineBearbeiten(m: ErnteMaschine | "neu") {
    setMaschineBearbeiten(m);
    setMaschineForm(m === "neu" ? leereMaschineForm() : ausMaschine(m));
    setFehler(null);
  }

  async function maschineSpeichern() {
    if (!maschineForm.nummer.trim()) {
      setFehler("Nummer ist ein Pflichtfeld.");
      return;
    }
    setMaschineSpeichert(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const daten = {
      nummer: maschineForm.nummer.trim(),
      bezeichnung: maschineForm.bezeichnung.trim() || null,
      box_seriennummer: maschineForm.box_seriennummer.trim() || null,
      traccar_unique_id: maschineForm.traccar_unique_id.trim() || null,
      max_personen: Number(maschineForm.max_personen) || 1,
      notiz: maschineForm.notiz.trim() || null,
    };
    const { error } =
      maschineBearbeiten === "neu"
        ? await supabase.from("ernte_maschine").insert(daten)
        : await supabase
            .from("ernte_maschine")
            .update(daten)
            .eq("id", (maschineBearbeiten as ErnteMaschine).id);
    setMaschineSpeichert(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setMaschineBearbeiten(null);
    laden();
  }

  // ---- Maschinen: Mehrfachauswahl + Bulk aktiv/inaktiv ----
  const [maschineSuche, setMaschineSuche] = useState("");
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<number>>(new Set());
  const [bulkLaeuft, setBulkLaeuft] = useState(false);

  const sucheNorm = maschineSuche.trim().toLowerCase();
  const maschinenGefiltert = maschinen.filter(
    (m) =>
      !sucheNorm ||
      m.nummer.toLowerCase().includes(sucheNorm) ||
      (m.bezeichnung ?? "").toLowerCase().includes(sucheNorm) ||
      (m.box_seriennummer ?? "").toLowerCase().includes(sucheNorm)
  );
  const maschinenGruppen = [
    { label: "Aktiv", liste: maschinenGefiltert.filter((m) => m.aktiv) },
    { label: "Inaktiv", liste: maschinenGefiltert.filter((m) => !m.aktiv) },
  ].filter((g) => g.liste.length > 0);

  function auswahlUmschalten(id: number) {
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkAktivSetzen(aktiv: boolean) {
    const ids = [...ausgewaehlt];
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} Maschine(n) ${aktiv ? "aktivieren" : "deaktivieren"}?`))
      return;
    setBulkLaeuft(true);
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("ernte_maschine")
      .update({ aktiv })
      .in("id", ids);
    setBulkLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setAusgewaehlt(new Set());
    laden();
  }

  async function maschineAktivUmschalten(m: ErnteMaschine) {
    const { error } = await getSupabaseClient()
      .from("ernte_maschine")
      .update({ aktiv: !m.aktiv })
      .eq("id", m.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    laden();
  }

  // Löschen ist hier (anders als bei Mitarbeitern/Fahrzeugen) unbedenklich:
  // ernte_position/ernte_kiste_zyklus/ernte_schicht.maschine_id steht auf
  // "on delete set null", gelöschte Testmaschinen reißen also keine
  // Bezugsdaten mit (Nutzer-Bedarf 2026-11-05: versehentlich doppelt
  // importierte Maschinen mit alter Nummerierung wieder entfernen, nachdem
  // ein zweiter Import mit neuem Nummernschema (SPINNE-001 etc.) lief).
  async function maschineLoeschen(m: ErnteMaschine) {
    if (
      !window.confirm(
        `Maschine "${m.nummer}"${m.bezeichnung ? ` (${m.bezeichnung})` : ""} endgültig löschen?`
      )
    )
      return;
    const { error } = await getSupabaseClient().from("ernte_maschine").delete().eq("id", m.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    laden();
  }

  async function bulkLoeschen() {
    const ids = [...ausgewaehlt];
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} Maschine(n) endgültig löschen?`)) return;
    setBulkLaeuft(true);
    setFehler(null);
    const { error } = await getSupabaseClient().from("ernte_maschine").delete().in("id", ids);
    setBulkLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setAusgewaehlt(new Set());
    laden();
  }

  // ---- Maschinen: CSV-/Excel-Import ----
  const [importDateiname, setImportDateiname] = useState<string | null>(null);
  const [importZeilen, setImportZeilen] = useState<ErnteMaschineImportZeile[]>([]);
  const [importUnbekannteSpalten, setImportUnbekannteSpalten] = useState<string[]>([]);
  const [importAktiv, setImportAktiv] = useState(false);
  const [importParsing, setImportParsing] = useState(false);
  const [importLaeuft, setImportLaeuft] = useState(false);
  const [importErgebnis, setImportErgebnis] = useState<{
    erfolgreich: number;
    fehlgeschlagen: { nummer: string; grund: string }[];
  } | null>(null);

  async function handleImportDatei(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportParsing(true);
    setImportErgebnis(null);
    setImportDateiname(file.name);

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rohZeilenGemischt = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: true,
      defval: "",
    });
    const rohZeilen = rohZeilenGemischt.map((roh) => {
      const zeile: Record<string, string> = {};
      for (const [spalte, wert] of Object.entries(roh)) {
        zeile[spalte] = zellwertZuText(wert);
      }
      return zeile;
    });

    const headers = rohZeilen.length > 0 ? Object.keys(rohZeilen[0]) : [];
    const spaltenMap = erkenneSpalten(headers);
    setImportUnbekannteSpalten(headers.filter((h) => spaltenMap[h] === null));

    const gebaut = rohZeilen.map((roh, i) => {
      const werte: Partial<Record<ErnteMaschineImportFeld, string>> = {};
      for (const [header, wert] of Object.entries(roh)) {
        const feld = spaltenMap[header];
        if (feld) werte[feld] = wert;
      }
      return baueZeile(i + 2, werte);
    });

    // Dubletten innerhalb der Datei als Fehler markieren - gegen bestehende
    // Nummern ist dank Upsert kein Fehler nötig (überschreibt bewusst).
    const zaehler = new Map<string, number>();
    gebaut.forEach((z) => {
      if (!z.nummer) return;
      const key = z.nummer.toLowerCase();
      zaehler.set(key, (zaehler.get(key) ?? 0) + 1);
    });
    const bestehendeNummern = new Set(maschinen.map((m) => m.nummer.toLowerCase()));
    const geprueft = gebaut.map((z) => {
      if (!z.nummer) return z;
      const key = z.nummer.toLowerCase();
      const fehler = [...z.fehler];
      const warnungen = [...z.warnungen];
      if ((zaehler.get(key) ?? 0) > 1) {
        fehler.push("Nummer kommt mehrfach in dieser Datei vor");
      } else if (bestehendeNummern.has(key)) {
        warnungen.push("Nummer existiert bereits - wird aktualisiert (Upsert)");
      }
      return { ...z, fehler, warnungen };
    });

    setImportZeilen(geprueft);
    setImportParsing(false);
  }

  async function handleImport() {
    const importierbar = importZeilen.filter((z) => z.fehler.length === 0);
    if (importierbar.length === 0) return;
    setImportLaeuft(true);
    const supabase = getSupabaseClient();
    const fehlgeschlagen: { nummer: string; grund: string }[] = [];
    let erfolgreich = 0;

    for (const block of bloecke(importierbar)) {
      const payload = block.map((z) => ({
        nummer: z.nummer,
        bezeichnung: z.bezeichnung,
        box_seriennummer: z.box_seriennummer,
        traccar_unique_id: z.traccar_unique_id,
        aktiv: importAktiv,
      }));
      const { error } = await supabase
        .from("ernte_maschine")
        .upsert(payload, { onConflict: "nummer" });
      if (error) {
        block.forEach((z) => fehlgeschlagen.push({ nummer: z.nummer, grund: error.message }));
      } else {
        erfolgreich += block.length;
      }
    }

    setImportLaeuft(false);
    setImportErgebnis({ erfolgreich, fehlgeschlagen });
    setImportZeilen([]);
    setImportDateiname(null);
    laden();
  }

  // ---- Waagen ----
  const [waageBearbeiten, setWaageBearbeiten] = useState<ErnteWaage | "neu" | null>(null);
  const [waageForm, setWaageForm] = useState({
    name: "",
    standort: "",
    ip: "",
    port: "",
    aktiv: true,
  });
  const [waageSpeichert, setWaageSpeichert] = useState(false);

  function starteWaageBearbeiten(w: ErnteWaage | "neu") {
    setWaageBearbeiten(w);
    setWaageForm(
      w === "neu"
        ? { name: "", standort: "", ip: "", port: "", aktiv: true }
        : {
            name: w.name,
            standort: w.standort ?? "",
            ip: w.ip ?? "",
            port: w.port != null ? String(w.port) : "",
            aktiv: w.aktiv,
          }
    );
    setFehler(null);
  }

  async function waageSpeichern() {
    if (!waageForm.name.trim()) {
      setFehler("Name ist ein Pflichtfeld.");
      return;
    }
    setWaageSpeichert(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const daten = {
      name: waageForm.name.trim(),
      standort: waageForm.standort.trim() || null,
      ip: waageForm.ip.trim() || null,
      port: waageForm.port === "" ? null : Number(waageForm.port),
      aktiv: waageForm.aktiv,
    };
    const { error } =
      waageBearbeiten === "neu"
        ? await supabase.from("ernte_waage").insert(daten)
        : await supabase
            .from("ernte_waage")
            .update(daten)
            .eq("id", (waageBearbeiten as ErnteWaage).id);
    setWaageSpeichert(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setWaageBearbeiten(null);
    laden();
  }

  // ---- Konfig ----
  const [konfigWerte, setKonfigWerte] = useState<Record<string, string>>({});
  const [konfigSpeichernLaeuft, setKonfigSpeichernLaeuft] = useState<string | null>(null);

  useEffect(() => {
    const werte: Record<string, string> = {};
    konfig.forEach((k) => {
      werte[k.schluessel] = k.wert;
    });
    setKonfigWerte(werte);
  }, [konfig]);

  async function konfigSpeichern(schluessel: string) {
    setKonfigSpeichernLaeuft(schluessel);
    const { error } = await getSupabaseClient()
      .from("ernte_konfig")
      .update({ wert: konfigWerte[schluessel] })
      .eq("schluessel", schluessel);
    setKonfigSpeichernLaeuft(null);
    if (error) setFehler(error.message);
    else laden();
  }

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <PageHeader
        icon={Settings}
        titel="Erntewirtschaft – Stammdaten"
        beschreibung="Maschinen, Waagen und Konfig-Werte pflegen; Maschinen auch per Excel/CSV-Sammelimport."
      />

      {fehler && <p className="text-sm font-medium text-beere-600">⚠ {fehler}</p>}

      {loading ? (
        <p className="p-4 text-sm text-neutral-500">Lädt …</p>
      ) : (
        <>
          {/* ================= Maschinen ================= */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-emerald-800">
              Maschinen ({maschinenGefiltert.length} von {maschinen.length})
            </h2>
            {canEditMaschinen && maschineBearbeiten === null && (
              <button type="button" className="btn" onClick={() => starteMaschineBearbeiten("neu")}>
                + Neue Maschine
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Suche: Nummer, Bezeichnung, Seriennummer …"
              className="w-64 text-sm"
              value={maschineSuche}
              onChange={(e) => setMaschineSuche(e.target.value)}
            />
            {canEditMaschinen && ausgewaehlt.size > 0 && (
              <div className="flex items-center gap-2 rounded border border-linie bg-sand px-2 py-1">
                <span className="text-sm text-neutral-600">{ausgewaehlt.size} ausgewählt</span>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={bulkLaeuft}
                  onClick={() => bulkAktivSetzen(true)}
                >
                  Aktivieren
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={bulkLaeuft}
                  onClick={() => bulkAktivSetzen(false)}
                >
                  Deaktivieren
                </button>
                <button
                  type="button"
                  className="text-xs text-beere-600 underline"
                  disabled={bulkLaeuft}
                  onClick={bulkLoeschen}
                >
                  Löschen
                </button>
                <button
                  type="button"
                  className="text-xs text-neutral-500 underline"
                  onClick={() => setAusgewaehlt(new Set())}
                >
                  Auswahl aufheben
                </button>
              </div>
            )}
          </div>

          {canEditMaschinen && maschineBearbeiten !== null && (
            <div className="card flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Nummer*
                  <input
                    className="mt-1 w-full"
                    value={maschineForm.nummer}
                    onChange={(e) => setMaschineForm({ ...maschineForm, nummer: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Bezeichnung
                  <input
                    className="mt-1 w-full"
                    value={maschineForm.bezeichnung}
                    onChange={(e) =>
                      setMaschineForm({ ...maschineForm, bezeichnung: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Box-Seriennummer
                  <input
                    className="mt-1 w-full"
                    value={maschineForm.box_seriennummer}
                    onChange={(e) =>
                      setMaschineForm({ ...maschineForm, box_seriennummer: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Traccar-Unique-ID (IMEI)
                  <input
                    className="mt-1 w-full"
                    value={maschineForm.traccar_unique_id}
                    onChange={(e) =>
                      setMaschineForm({ ...maschineForm, traccar_unique_id: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Max. Personen gleichzeitig
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="mt-1 w-full"
                    value={maschineForm.max_personen}
                    onChange={(e) =>
                      setMaschineForm({ ...maschineForm, max_personen: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  Notiz
                  <textarea
                    className="mt-1 w-full"
                    rows={2}
                    value={maschineForm.notiz}
                    onChange={(e) => setMaschineForm({ ...maschineForm, notiz: e.target.value })}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={maschineSpeichert}
                  onClick={maschineSpeichern}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setMaschineBearbeiten(null)}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  {canEditMaschinen && <th></th>}
                  <th>Nummer</th>
                  <th>Bezeichnung</th>
                  <th>Box-Seriennummer</th>
                  <th>Traccar-ID</th>
                  <th>Max. Personen</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {maschinenGruppen.map((gruppe) => (
                  <Fragment key={gruppe.label}>
                    <tr className="bg-sand">
                      <td
                        colSpan={canEditMaschinen ? 8 : 7}
                        className="font-semibold text-emerald-800"
                      >
                        {gruppe.label} ({gruppe.liste.length})
                      </td>
                    </tr>
                    {gruppe.liste.map((m) => (
                      <tr key={m.id} className={m.aktiv ? "" : "opacity-50"}>
                        {canEditMaschinen && (
                          <td>
                            <input
                              type="checkbox"
                              checked={ausgewaehlt.has(m.id)}
                              onChange={() => auswahlUmschalten(m.id)}
                              aria-label={`Maschine ${m.nummer} auswählen`}
                            />
                          </td>
                        )}
                        <td>{m.nummer}</td>
                        <td>{m.bezeichnung ?? "—"}</td>
                        <td>{m.box_seriennummer ?? "—"}</td>
                        <td>{m.traccar_unique_id ?? "—"}</td>
                        <td>{m.max_personen}</td>
                        <td>
                          {canEditMaschinen ? (
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => maschineAktivUmschalten(m)}
                            >
                              {m.aktiv ? "aktiv" : "inaktiv"}
                            </button>
                          ) : m.aktiv ? (
                            "aktiv"
                          ) : (
                            "inaktiv"
                          )}
                        </td>
                        <td>
                          {canEditMaschinen && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => starteMaschineBearbeiten(m)}
                              >
                                Bearbeiten
                              </button>
                              <button
                                type="button"
                                className="text-xs text-beere-600 underline"
                                onClick={() => maschineLoeschen(m)}
                              >
                                Löschen
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {maschinenGefiltert.length === 0 && (
                  <tr>
                    <td colSpan={canEditMaschinen ? 8 : 7} className="text-neutral-500">
                      {maschinen.length === 0
                        ? "Noch keine Maschinen."
                        : "Keine Maschine entspricht der Suche."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ---- Maschinen: Excel-/CSV-Import ---- */}
          {canEditMaschinen && (
            <div className="card flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-emerald-800">
                Sammelimport (Excel/CSV)
              </h3>
              <p className="text-xs text-neutral-500">
                Spalten: Nummer (Pflicht), Bezeichnung, Box-Seriennummer,
                Traccar-Unique-ID (IMEI). Bestehende Nummern werden
                aktualisiert (Upsert), nicht dupliziert.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={ladeVorlage}>
                  Vorlage herunterladen (.xlsx)
                </button>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportDatei}
                  className="text-sm"
                />
              </div>
              {importParsing && <p className="text-sm text-neutral-500">Lese Datei …</p>}
              {importDateiname && importZeilen.length > 0 && (
                <>
                  {importUnbekannteSpalten.length > 0 && (
                    <p className="text-xs text-amber-700">
                      Nicht erkannte Spalten (werden ignoriert):{" "}
                      {importUnbekannteSpalten.join(", ")}
                    </p>
                  )}
                  <div className="max-h-80 overflow-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>Zeile</th>
                          <th>Nummer</th>
                          <th>Bezeichnung</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importZeilen.map((z) => (
                          <tr
                            key={z.zeile}
                            className={
                              z.fehler.length > 0
                                ? "bg-beere-50"
                                : z.warnungen.length > 0
                                  ? "bg-amber-50"
                                  : "bg-emerald-50/50"
                            }
                          >
                            <td>{z.zeile}</td>
                            <td>{z.nummer || "—"}</td>
                            <td>{z.bezeichnung ?? "—"}</td>
                            <td className="text-xs">
                              {z.fehler.length > 0
                                ? z.fehler.join("; ")
                                : z.warnungen.length > 0
                                  ? z.warnungen.join("; ")
                                  : "OK"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={importAktiv}
                      onChange={(e) => setImportAktiv(e.target.checked)}
                    />
                    Importierte Maschinen sofort aktiv schalten (Standard: inaktiv)
                  </label>
                  <button
                    type="button"
                    className="btn self-start"
                    disabled={
                      importLaeuft || importZeilen.every((z) => z.fehler.length > 0)
                    }
                    onClick={handleImport}
                  >
                    {importZeilen.filter((z) => z.fehler.length === 0).length} Zeile(n)
                    importieren
                  </button>
                </>
              )}
              {importErgebnis && (
                <p className="text-sm">
                  {importErgebnis.erfolgreich} Maschine(n) importiert.
                  {importErgebnis.fehlgeschlagen.length > 0 && (
                    <span className="text-beere-600">
                      {" "}
                      {importErgebnis.fehlgeschlagen.length} fehlgeschlagen:{" "}
                      {importErgebnis.fehlgeschlagen
                        .map((f) => `${f.nummer} (${f.grund})`)
                        .join("; ")}
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {/* ================= Waagen ================= */}
          <h2 className="mt-4 text-base font-semibold text-emerald-800">Waagen</h2>
          {canEditWaagen && waageBearbeiten === null && (
            <button
              type="button"
              className="btn self-start"
              onClick={() => starteWaageBearbeiten("neu")}
            >
              + Neue Waage
            </button>
          )}
          {canEditWaagen && waageBearbeiten !== null && (
            <div className="card flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Name*
                  <input
                    className="mt-1 w-full"
                    value={waageForm.name}
                    onChange={(e) => setWaageForm({ ...waageForm, name: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Standort
                  <input
                    className="mt-1 w-full"
                    value={waageForm.standort}
                    onChange={(e) => setWaageForm({ ...waageForm, standort: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  IP-Adresse
                  <input
                    className="mt-1 w-full"
                    value={waageForm.ip}
                    onChange={(e) => setWaageForm({ ...waageForm, ip: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Port
                  <input
                    type="number"
                    className="mt-1 w-full"
                    value={waageForm.port}
                    onChange={(e) => setWaageForm({ ...waageForm, port: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={waageForm.aktiv}
                    onChange={(e) => setWaageForm({ ...waageForm, aktiv: e.target.checked })}
                  />
                  Aktiv
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn" disabled={waageSpeichert} onClick={waageSpeichern}>
                  Speichern
                </button>
                <button type="button" className="btn-secondary" onClick={() => setWaageBearbeiten(null)}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Standort</th>
                  <th>IP:Port</th>
                  <th>Live-Gewicht</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {waagen.map((w) => (
                  <tr key={w.id} className={w.aktiv ? "" : "opacity-50"}>
                    <td>{w.name}</td>
                    <td>{w.standort ?? "—"}</td>
                    <td>
                      {w.ip ?? "—"}
                      {w.port != null ? `:${w.port}` : ""}
                    </td>
                    <td>
                      {w.live_gewicht_kg != null
                        ? `${w.live_gewicht_kg} kg (${
                            w.live_aktualisiert_am ? formatDatumDE(w.live_aktualisiert_am) : "—"
                          })`
                        : "—"}
                    </td>
                    <td>{w.aktiv ? "aktiv" : "inaktiv"}</td>
                    <td>
                      {canEditWaagen && (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => starteWaageBearbeiten(w)}
                        >
                          Bearbeiten
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {waagen.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-neutral-500">
                      Noch keine Waage angelegt.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ================= Konfig ================= */}
          <h2 className="mt-4 text-base font-semibold text-emerald-800">Konfig-Werte</h2>
          {!canEditKonfig && (
            <p className="text-xs text-amber-700">Konfig-Werte dürfen nur von admin geändert werden.</p>
          )}
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Schlüssel</th>
                  <th>Wert</th>
                  <th>Beschreibung</th>
                  {canEditKonfig && <th></th>}
                </tr>
              </thead>
              <tbody>
                {konfig.map((k) => (
                  <tr key={k.schluessel}>
                    <td className="font-mono text-xs">{k.schluessel}</td>
                    <td>
                      {canEditKonfig ? (
                        <input
                          className="w-32"
                          value={konfigWerte[k.schluessel] ?? ""}
                          onChange={(e) =>
                            setKonfigWerte({ ...konfigWerte, [k.schluessel]: e.target.value })
                          }
                        />
                      ) : (
                        k.wert
                      )}
                    </td>
                    <td className="text-xs text-neutral-500">{k.beschreibung ?? "—"}</td>
                    {canEditKonfig && (
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={konfigSpeichernLaeuft === k.schluessel}
                          onClick={() => konfigSpeichern(k.schluessel)}
                        >
                          Speichern
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
