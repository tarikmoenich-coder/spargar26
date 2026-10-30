"use client";

// "Anbau → Übersicht" (Nutzer-Vorgabe 2026-10-31): jahresübergreifende Sicht
// auf die Spargel/Grünspargel-Anbaufläche - Standjahre, Sorten, Junganlagen,
// Weiß/Grün und die Erntefenster-Abdeckung (Verfrühung/Verspätung) auf
// einen Blick. Reine Lese-Seite, keine Eingaben.
//
// Datenquelle ist bewusst dieselbe aktuelle Saison wie /anbau/spargel (keine
// neue Tabelle für "Planung über mehrere Jahre im Voraus") - das reicht,
// weil Pflanzjahr ein fester Kalenderjahrgang ist: aus den heutigen
// Abschnitten lässt sich für jedes zukünftige Jahr das Standjahr rein
// rechnerisch ableiten (berechneStandjahr), ohne dass dafür erst
// feld_anbau-Zeilen für künftige Jahre angelegt werden müssten. Die
// "Prognose nächste Jahre" ist deshalb eine Hochrechnung "wenn sich nichts
// ändert", kein fester Plan.

import PageHeader from "@/components/PageHeader";
import { LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import type { FeldAnbauAbschnitt, FeldKultur } from "@/lib/types";
import { VERFRUEHUNG_LABELS } from "@/lib/types";
import {
  abschnittLaufendeMeter,
  abschnittNettoHa,
  berechneStandjahr,
  standjahrKategorie,
  STANDJAHR_KATEGORIE_LABELS,
  JUNGANLAGE_MAX_STANDJAHR,
  LETZTES_ERNTEJAHR_STANDJAHR,
  type StandjahrKategorie,
} from "@/lib/anbau";
import { formatMenge, formatZahlDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();
const PROGNOSE_JAHRE = [0, 1, 2, 3];
const KATEGORIEN: StandjahrKategorie[] = ["junganlage", "ertragsanlage", "letztes_erntejahr", "ueberstaendig"];

interface AbschnittMitKontext extends FeldAnbauAbschnitt {
  feld_bezeichnung: string;
  kultur: FeldKultur | null;
}

export default function AnbauUebersichtPage() {
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [abschnitte, setAbschnitte] = useState<AbschnittMitKontext[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setFehler(null);
      const supabase = getSupabaseClient();
      const { data: uData, error: uError } = await supabase
        .from("feld_anbau_uebersicht")
        .select("anbau_id, feld_id, feld_bezeichnung, kultur, saison_jahr")
        .eq("saison_jahr", jahr)
        .in("kultur", ["spargel", "gruenspargel"]);
      if (uError) {
        setFehler(uError.message);
        setLoading(false);
        return;
      }
      const uebersicht =
        (uData as { anbau_id: number; feld_bezeichnung: string; kultur: FeldKultur | null }[]) ?? [];
      const anbauIds = uebersicht.map((u) => u.anbau_id);
      let roh: FeldAnbauAbschnitt[] = [];
      if (anbauIds.length > 0) {
        const { data: aData, error: aError } = await supabase
          .from("feld_anbau_abschnitt")
          .select("*")
          .in("feld_anbau_id", anbauIds);
        if (aError) {
          setFehler(aError.message);
          setLoading(false);
          return;
        }
        roh = (aData as FeldAnbauAbschnitt[]) ?? [];
      }
      const kontext = new Map(uebersicht.map((u) => [u.anbau_id, u]));
      setAbschnitte(
        roh.map((a) => ({
          ...a,
          feld_bezeichnung: kontext.get(a.feld_anbau_id)?.feld_bezeichnung ?? "?",
          kultur: kontext.get(a.feld_anbau_id)?.kultur ?? null,
        }))
      );
      setLoading(false);
    })();
  }, [jahr]);

  const gesamtNettoHa = abschnitte.reduce((s, a) => s + abschnittNettoHa(a), 0);
  const gesamtLaufmeter = abschnitte.reduce((s, a) => s + abschnittLaufendeMeter(a), 0);
  const gesamtPflanzen = abschnitte.reduce(
    (s, a) => s + abschnittLaufendeMeter(a) * (a.pflanzen_pro_lfm ?? 0),
    0
  );
  const weissHa = abschnitte.filter((a) => a.kultur === "spargel").reduce((s, a) => s + abschnittNettoHa(a), 0);
  const gruenHa = abschnitte.filter((a) => a.kultur === "gruenspargel").reduce((s, a) => s + abschnittNettoHa(a), 0);

  const mitPflanzjahr = abschnitte.filter((a): a is AbschnittMitKontext & { pflanzjahr: number } => a.pflanzjahr != null);
  const ohnePflanzjahr = abschnitte.length - mitPflanzjahr.length;

  const junganlageHa = mitPflanzjahr
    .filter((a) => berechneStandjahr(a.pflanzjahr, jahr) <= JUNGANLAGE_MAX_STANDJAHR)
    .reduce((s, a) => s + abschnittNettoHa(a), 0);
  const rodungHa = mitPflanzjahr
    .filter((a) => berechneStandjahr(a.pflanzjahr, jahr) >= LETZTES_ERNTEJAHR_STANDJAHR)
    .reduce((s, a) => s + abschnittNettoHa(a), 0);

  // Tabelle je Standjahr (1..9, Rest als "10+") für die aktuelle Saison.
  const standjahrBuckets = new Map<
    number,
    { abschnitte: AbschnittMitKontext[]; nettoHa: number; sorten: Set<string>; kulturen: Set<string> }
  >();
  mitPflanzjahr.forEach((a) => {
    const stj = berechneStandjahr(a.pflanzjahr, jahr);
    if (stj < 1) return;
    const bucket = stj >= 10 ? 10 : stj;
    if (!standjahrBuckets.has(bucket)) {
      standjahrBuckets.set(bucket, { abschnitte: [], nettoHa: 0, sorten: new Set(), kulturen: new Set() });
    }
    const b = standjahrBuckets.get(bucket)!;
    b.abschnitte.push(a);
    b.nettoHa += abschnittNettoHa(a);
    if (a.sorte) b.sorten.add(a.sorte);
    if (a.kultur === "spargel") b.kulturen.add("Weiß");
    if (a.kultur === "gruenspargel") b.kulturen.add("Grün");
  });

  // Prognose nächste Jahre: Kategorie × Jahr -> Summe netto-ha.
  const prognose: Record<StandjahrKategorie, number[]> = {
    junganlage: [],
    ertragsanlage: [],
    letztes_erntejahr: [],
    ueberstaendig: [],
  };
  PROGNOSE_JAHRE.forEach((offset) => {
    const summen: Record<StandjahrKategorie, number> = {
      junganlage: 0,
      ertragsanlage: 0,
      letztes_erntejahr: 0,
      ueberstaendig: 0,
    };
    mitPflanzjahr.forEach((a) => {
      const kat = standjahrKategorie(berechneStandjahr(a.pflanzjahr, jahr + offset));
      summen[kat] += abschnittNettoHa(a);
    });
    KATEGORIEN.forEach((k) => prognose[k].push(summen[k]));
  });

  const letztesJahrPlus1 = prognose.letztes_erntejahr[1] ?? 0;
  const letztesJahrPlus2 = prognose.letztes_erntejahr[2] ?? 0;

  // Erntefenster-Abdeckung (Verfrühung/Verspätung) - unabhängig vom Standjahr.
  const verfruehungGruppen: { key: string; label: string; nettoHa: number; laufmeter: number; anzahl: number }[] = [
    { key: "frueh", label: VERFRUEHUNG_LABELS.frueh, nettoHa: 0, laufmeter: 0, anzahl: 0 },
    { key: "mittel", label: VERFRUEHUNG_LABELS.mittel, nettoHa: 0, laufmeter: 0, anzahl: 0 },
    { key: "spaet", label: VERFRUEHUNG_LABELS.spaet, nettoHa: 0, laufmeter: 0, anzahl: 0 },
    { key: "keine", label: "Ohne Angabe", nettoHa: 0, laufmeter: 0, anzahl: 0 },
  ];
  abschnitte.forEach((a) => {
    const g = verfruehungGruppen.find((v) => v.key === (a.verfruehung ?? "keine"))!;
    g.nettoHa += abschnittNettoHa(a);
    g.laufmeter += abschnittLaufendeMeter(a);
    g.anzahl += 1;
  });

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={LayoutGrid} titel="Anbauübersicht" />
        <p className="text-sm text-neutral-500">
          Spargel/Grünspargel über alle Felder der gewählten Saison: Fläche,
          Standjahre, Sorten, Junganlagen und die Abdeckung des
          Erntefensters durch Verfrühung/Verspätung.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>
          Saison{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
      </div>

      {fehler && (
        <p className="rounded border border-beere-300 bg-beere-50 p-2 text-sm text-beere-700">{fehler}</p>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Lädt…</p>
      ) : abschnitte.length === 0 ? (
        <p className="text-sm text-neutral-500">Keine Spargel/Grünspargel-Abschnitte für {jahr} gefunden.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="card">
              <div className="text-xs text-neutral-500">Netto-Fläche</div>
              <div className="text-lg font-semibold text-emerald-900">{formatMenge(gesamtNettoHa, 2)} ha</div>
            </div>
            <div className="card">
              <div className="text-xs text-neutral-500">davon Weiß / Grün</div>
              <div className="text-lg font-semibold text-emerald-900">
                {formatMenge(weissHa, 2)} / {formatMenge(gruenHa, 2)} ha
              </div>
            </div>
            <div className="card">
              <div className="text-xs text-neutral-500">Laufmeter Reihe</div>
              <div className="text-lg font-semibold text-emerald-900">{formatZahlDE(gesamtLaufmeter)} m</div>
            </div>
            <div className="card">
              <div className="text-xs text-neutral-500">Pflanzen</div>
              <div className="text-lg font-semibold text-emerald-900">{formatZahlDE(gesamtPflanzen)}</div>
            </div>
            <div className="card">
              <div className="text-xs text-neutral-500">
                Junganlagen (1.-{JUNGANLAGE_MAX_STANDJAHR}. Stj.) / Rodungskandidaten (≥{LETZTES_ERNTEJAHR_STANDJAHR}. Stj.)
              </div>
              <div className="text-lg font-semibold text-emerald-900">
                {formatMenge(junganlageHa, 2)} / {formatMenge(rodungHa, 2)} ha
              </div>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="mb-2 text-sm font-semibold text-emerald-800">Fläche je Standjahr ({jahr})</h2>
            <table>
              <thead>
                <tr>
                  <th>Standjahr</th>
                  <th>Abschnitte</th>
                  <th>Netto ha</th>
                  <th>Kultur</th>
                  <th>Sorten</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(standjahrBuckets.keys())
                  .sort((a, b) => a - b)
                  .map((stj) => {
                    const b = standjahrBuckets.get(stj)!;
                    return (
                      <tr key={stj}>
                        <td>
                          {stj === 10 ? "10+" : `${stj}.`}{" "}
                          {stj <= JUNGANLAGE_MAX_STANDJAHR && <span className="badge badge-neutral">Junganlage</span>}
                          {stj === LETZTES_ERNTEJAHR_STANDJAHR && (
                            <span className="badge badge-warn">Letztes Erntejahr</span>
                          )}
                          {stj > LETZTES_ERNTEJAHR_STANDJAHR && (
                            <span className="badge badge-danger">Überständig</span>
                          )}
                        </td>
                        <td>{b.abschnitte.length}</td>
                        <td>{formatMenge(b.nettoHa, 2)}</td>
                        <td>{Array.from(b.kulturen).join(", ") || "—"}</td>
                        <td>{Array.from(b.sorten).sort().join(", ") || "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {ohnePflanzjahr > 0 && (
              <p className="mt-2 text-xs text-neutral-400">
                {ohnePflanzjahr} Abschnitt(e) ohne Pflanzjahr nicht berücksichtigt.
              </p>
            )}
          </div>

          <div className="card overflow-x-auto">
            <h2 className="mb-2 text-sm font-semibold text-emerald-800">Prognose nächste Jahre</h2>
            <p className="mb-2 text-xs text-neutral-500">
              Hochrechnung "wenn sich nichts ändert" - keine Rodungstermine, keine neuen Pflanzungen.
            </p>
            <table>
              <thead>
                <tr>
                  <th></th>
                  {PROGNOSE_JAHRE.map((offset) => (
                    <th key={offset}>{jahr + offset}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KATEGORIEN.map((k) => (
                  <tr key={k}>
                    <td>{STANDJAHR_KATEGORIE_LABELS[k]}</td>
                    {prognose[k].map((ha, i) => (
                      <td key={i}>{formatMenge(ha, 2)} ha</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {letztesJahrPlus1 > 0 && (
              <p className="mt-2 text-sm text-amber-700">
                In {jahr + 1} erreichen {formatMenge(letztesJahrPlus1, 2)} ha ihr letztes reguläres Erntejahr - ab{" "}
                {jahr + 2} fallen sie voraussichtlich weg, falls nicht neu bepflanzt wird.
              </p>
            )}
            {letztesJahrPlus2 > 0 && (
              <p className="text-sm text-amber-700">
                In {jahr + 2} kommen {formatMenge(letztesJahrPlus2, 2)} ha weitere dazu.
              </p>
            )}
          </div>

          <div className="card overflow-x-auto">
            <h2 className="mb-2 text-sm font-semibold text-emerald-800">Erntefenster-Abdeckung (Verfrühung/Verspätung)</h2>
            <table>
              <thead>
                <tr>
                  <th>Kategorie</th>
                  <th>Abschnitte</th>
                  <th>Netto ha</th>
                  <th>Laufmeter</th>
                  <th>Anteil</th>
                </tr>
              </thead>
              <tbody>
                {verfruehungGruppen.map((g) => (
                  <tr key={g.key}>
                    <td>{g.label}</td>
                    <td>{g.anzahl}</td>
                    <td>{formatMenge(g.nettoHa, 2)}</td>
                    <td>{formatZahlDE(g.laufmeter)} m</td>
                    <td>{gesamtNettoHa > 0 ? formatMenge((g.nettoHa / gesamtNettoHa) * 100, 0) : "0"} %</td>
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
