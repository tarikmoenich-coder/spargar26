"use client";

// Spargelprämien Stufe 3 - Tage aus der Ernteerfassung prüfen und freigeben
// (docs/spargel-praemien-konzept.md, "Prüfen und Freigeben").
// Vorschau live aus spargel_tag_vorschau(datum); Freigabe schreibt Kategorie,
// Preis, Stunden und Prämie fest (spargel_tag_freigeben) und macht sie
// lohnwirksam. Stunden kommen vorerst aus dem Stundenzettel; korrigieren
// geht nur mit Begründung. Freigeben/Zurücknehmen nur mit Sonderrecht
// (Geschäftsführung), Zurücknehmen nur solange niemand abgerechnet ist.

import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE, formatEuro, formatMenge } from "@/lib/format";

interface VorschauZeile {
  employee_id: string;
  personal_nr: string;
  name: string;
  feld_id: number | null;
  feld_name: string | null;
  maschine_id: number | null;
  maschine: string | null;
  gruppe_personen: number;
  kg: number;
  kisten: number;
  stunden: number | null;
  stunden_quelle: string | null;
  kategorie: number | null;
  preis_kg: number | null;
  stundensatz: number | null;
  akkordwert: number | null;
  lohnanspruch: number | null;
  praemie: number | null;
  fehlbetrag: number | null;
  hinweise: string[];
}
interface Freigabe {
  datum: string;
  freigegeben_von: string | null;
  freigegeben_am: string;
  zeilen: number;
  praemie: number;
}
interface FestZeile {
  employee_id: string | null;
  personal_nr: string | null;
  feld_name: string | null;
  kg: number;
  stunden: number;
  kategorie_min: number | null;
  praemie: number;
  fehlbetrag: number;
  gruppenanteil: boolean;
}

const katText = (k: number | null) => (k === null ? "—" : formatMenge(Number(k), Number(k) % 1 ? 1 : 0));
const heute = () => new Date().toISOString().slice(0, 10);
const tagPlus = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const schluessel = (z: { employee_id: string; feld_id: number | null }) => `${z.employee_id}|${z.feld_id ?? ""}`;

export default function SpargelFreigabe({ darfFreigeben, namen }: { darfFreigeben: boolean; namen: Record<string, string> }) {
  const sb = getSupabaseClient();
  const [datum, setDatum] = useState(heute);
  const [vorschau, setVorschau] = useState<VorschauZeile[]>([]);
  const [freigaben, setFreigaben] = useState<Freigabe[]>([]);
  const [fest, setFest] = useState<FestZeile[]>([]);
  const [erntetage, setErntetage] = useState<string[]>([]);
  const [nachzuegler, setNachzuegler] = useState<Record<string, number>>({});
  const [nutzer, setNutzer] = useState<Record<string, string>>({});
  const [korrektur, setKorrektur] = useState<Record<string, { stunden: string; grund: string }>>({});
  const [laedt, setLaedt] = useState(false);
  const [arbeitet, setArbeitet] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [frageAufheben, setFrageAufheben] = useState(false);

  const freigabe = freigaben.find((f) => f.datum === datum) ?? null;

  const laden = useCallback(async () => {
    setLaedt(true);
    const [f, t, p, nz] = await Promise.all([
      sb.from("spargel_freigabe").select("*").order("datum", { ascending: false }),
      sb.from("spargel_erntetag").select("tag").order("tag", { ascending: false }).limit(30),
      sb.from("profile_namen").select("id, full_name"),
      sb.from("spargel_nachzuegler").select("datum, kisten"),
    ]);
    setNachzuegler(Object.fromEntries(((nz.data as { datum: string; kisten: number }[]) ?? []).map((x) => [x.datum, x.kisten])));
    const fr = (f.data as Freigabe[]) ?? [];
    setFreigaben(fr);
    setErntetage(((t.data as { tag: string }[]) ?? []).map((x) => x.tag.slice(0, 10)));
    setNutzer(Object.fromEntries(((p.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name])));
    if (fr.some((x) => x.datum === datum)) {
      const { data } = await sb.from("spargel_praemie_tag").select("*").eq("datum", datum).eq("quelle", "ernteerfassung");
      setFest((data as FestZeile[]) ?? []);
      setVorschau([]);
    } else {
      const { data, error } = await sb.rpc("spargel_tag_vorschau", { p_datum: datum });
      setVorschau((data as VorschauZeile[]) ?? []);
      setFest([]);
      if (error) setMeldung({ ok: false, text: error.message });
    }
    setKorrektur({});
    setFrageAufheben(false);
    setLaedt(false);
  }, [sb, datum]);
  useEffect(() => {
    laden();
  }, [laden]);

  // Vorschau mit Stundenkorrekturen neu rechnen (Gruppen werden neu verteilt)
  const gerechnet = useMemo(() => {
    const std = (z: VorschauZeile) => {
      const k = korrektur[schluessel(z)];
      const v = k && k.stunden.trim() !== "" ? Number(k.stunden.replace(",", ".")) : null;
      return v !== null && Number.isFinite(v) ? v : z.stunden;
    };
    const gruppen = new Map<string, { kg: number; lohn: number; n: number }>();
    for (const z of vorschau) {
      if (!z.maschine_id) continue;
      const k = `${z.maschine_id}|${z.feld_id}`;
      const g = gruppen.get(k) ?? { kg: 0, lohn: 0, n: 0 };
      g.kg += Number(z.kg);
      g.lohn += (std(z) ?? 0) * Number(z.stundensatz ?? 0);
      g.n += 1;
      gruppen.set(k, g);
    }
    return vorschau.map((z) => {
      const s = std(z);
      const preis = z.preis_kg === null ? null : Number(z.preis_kg);
      const satz = z.stundensatz === null ? null : Number(z.stundensatz);
      let praemie: number | null = null;
      let fehl: number | null = null;
      if (s !== null && preis !== null && satz !== null) {
        if (z.maschine_id) {
          const g = gruppen.get(`${z.maschine_id}|${z.feld_id}`)!;
          praemie = Math.max(g.kg * preis - g.lohn, 0) / g.n;
          fehl = Math.max(g.lohn - g.kg * preis, 0) / g.n;
        } else {
          praemie = Math.max(Number(z.kg) * preis - s * satz, 0);
          fehl = Math.max(s * satz - Number(z.kg) * preis, 0);
        }
      }
      const k = korrektur[schluessel(z)];
      const korrigiert = !!k && k.stunden.trim() !== "";
      const hinweise = z.hinweise.filter((h) => !(h === "Stunden fehlen" && korrigiert));
      if (korrigiert && !k.grund.trim()) hinweise.push("Begründung fehlt");
      return { z, s, praemie, fehl, hinweise, korrigiert };
    });
  }, [vorschau, korrektur]);

  const offen = gerechnet.filter((g) => g.hinweise.some((h) => h !== "ungeklärte Kisten an diesem Tag")).length;
  const summe = gerechnet.reduce((a, g) => a + (g.praemie ?? 0), 0);
  const ungeklaert = vorschau.some((z) => z.hinweise.includes("ungeklärte Kisten an diesem Tag"));

  async function freigeben() {
    setArbeitet(true);
    setMeldung(null);
    const korr = gerechnet
      .filter((g) => g.korrigiert)
      .map((g) => ({
        employee_id: g.z.employee_id,
        feld_id: g.z.feld_id,
        stunden: Number(korrektur[schluessel(g.z)].stunden.replace(",", ".")),
        grund: korrektur[schluessel(g.z)].grund.trim(),
      }));
    const { data, error } = await sb.rpc("spargel_tag_freigeben", { p_datum: datum, p_korrekturen: korr });
    setArbeitet(false);
    setMeldung(error ? { ok: false, text: error.message } : { ok: true, text: `${data} Zeilen freigegeben – sie fließen jetzt in den Lohn.` });
    if (!error) laden();
  }

  async function aufheben() {
    setArbeitet(true);
    const { error } = await sb.rpc("spargel_freigabe_aufheben", { p_datum: datum });
    setArbeitet(false);
    setMeldung(error ? { ok: false, text: error.message } : { ok: true, text: "Freigabe zurückgenommen." });
    laden();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-500">
        Je Tag aus den gewogenen Kisten der Ernteerfassung. Stunden kommen vorerst aus dem Stundenzettel (Prämienstunden aus den
        Maschinendaten folgen). Erst freigegebene Tage fließen in den Lohn.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" aria-label="Vortag" onClick={() => setDatum(tagPlus(datum, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input id="freigabe-datum" type="date" value={datum} onChange={(e) => e.target.value && setDatum(e.target.value)} />
        <button type="button" className="btn-secondary" aria-label="Folgetag" onClick={() => setDatum(tagPlus(datum, 1))}>
          <ChevronRight className="h-4 w-4" />
        </button>
        {freigabe ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> freigegeben
          </span>
        ) : vorschau.length > 0 ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-800">offen</span>
        ) : null}
      </div>

      {erntetage.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="py-1 text-neutral-500">Letzte Erntetage:</span>
          {erntetage.map((t) => {
            const fr = freigaben.some((f) => f.datum === t);
            const nach = nachzuegler[t] ?? 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setDatum(t)}
                className={`rounded-md border px-2 py-1 tabular-nums ${
                  t === datum ? "border-emerald-500 bg-emerald-50 font-semibold" : fr && !nach ? "border-emerald-200 text-emerald-800" : "border-amber-300 text-amber-800"
                }`}
                title={nach ? `${nach} Kiste(n) nach der Freigabe gewogen` : fr ? "freigegeben" : "noch offen"}
              >
                {formatDatumDE(t).slice(0, 6)}
              </button>
            );
          })}
        </div>
      )}

      {meldung && <p className={`text-sm ${meldung.ok ? "text-emerald-700" : "text-beere-700"}`}>{meldung.text}</p>}

      {laedt ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : freigabe ? (
        <>
          <p className="text-sm text-neutral-600">
            Freigegeben am {formatDatumDE(freigabe.freigegeben_am.slice(0, 10))} von {nutzer[freigabe.freigegeben_von ?? ""] ?? "—"} ·{" "}
            {freigabe.zeilen} Zeilen · Prämie {formatEuro(freigabe.praemie)}
          </p>
          {(nachzuegler[datum] ?? 0) > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {nachzuegler[datum] === 1 ? "1 Kiste wurde" : `${nachzuegler[datum]} Kisten wurden`} erst nach der Freigabe gewogen und
              fehlen in der Prämie. Freigabe zurücknehmen und den Tag neu freigeben.
            </p>
          )}
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Feld</th>
                  <th className="text-right">kg</th>
                  <th className="text-right">Std.</th>
                  <th className="text-right">Kat.</th>
                  <th className="text-right">Prämie</th>
                  <th className="text-right">Unter der Schwelle</th>
                </tr>
              </thead>
              <tbody>
                {fest.map((z, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">
                      {(z.employee_id && namen[z.employee_id]) || z.personal_nr}
                      {z.gruppenanteil && <span className="ml-1.5 text-xs text-neutral-400">Gruppe</span>}
                    </td>
                    <td>{z.feld_name}</td>
                    <td className="text-right tabular-nums">{formatMenge(z.kg, 1)}</td>
                    <td className="text-right tabular-nums">{formatMenge(z.stunden, 2)}</td>
                    <td className="text-right tabular-nums">{katText(z.kategorie_min)}</td>
                    <td className="text-right font-medium tabular-nums">{z.praemie ? formatEuro(z.praemie) : ""}</td>
                    <td className="text-right tabular-nums text-neutral-500">{z.fehlbetrag ? formatEuro(z.fehlbetrag) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {darfFreigeben &&
            (frageAufheben ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Freigabe wirklich zurücknehmen? Die Zeilen werden wieder zur Vorschau.
                <button type="button" className="btn-secondary text-beere-700" disabled={arbeitet} onClick={aufheben}>
                  Ja, zurücknehmen
                </button>
                <button type="button" className="btn-secondary" onClick={() => setFrageAufheben(false)}>
                  Nein
                </button>
              </div>
            ) : (
              <div>
                <button type="button" className="btn-secondary" onClick={() => setFrageAufheben(true)}>
                  <RotateCcw className="h-4 w-4" />
                  Freigabe zurücknehmen
                </button>
              </div>
            ))}
        </>
      ) : vorschau.length === 0 ? (
        <p className="text-sm text-neutral-500">Für den {formatDatumDE(datum)} gibt es keine gewogenen Spargelkisten.</p>
      ) : (
        <>
          {ungeklaert && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              An diesem Tag gibt es ungeklärte oder nicht gewogene Kisten (Erntewirtschaft → Ernte). Sie fehlen in dieser Liste, bis sie
              zugeordnet sind.
            </p>
          )}
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Feld</th>
                  <th className="text-right">kg</th>
                  <th className="text-right">Kisten</th>
                  <th className="text-right">Std.</th>
                  <th className="text-right">Kat.</th>
                  <th className="text-right">Akkordwert</th>
                  <th className="text-right">Prämie</th>
                  <th className="text-right">Unter der Schwelle</th>
                  <th>Hinweis</th>
                </tr>
              </thead>
              <tbody>
                {gerechnet.map(({ z, s, praemie, fehl, hinweise, korrigiert }) => {
                  const key = schluessel(z);
                  const k = korrektur[key] ?? { stunden: "", grund: "" };
                  return (
                    <tr key={key} className={hinweise.some((h) => h !== "ungeklärte Kisten an diesem Tag") ? "bg-amber-50/50" : ""}>
                      <td className="whitespace-nowrap">
                        {z.name}
                        {z.maschine_id && (
                          <span className="ml-1.5 text-xs text-neutral-400" title={`Gruppenmaschine ${z.maschine}, ${z.gruppe_personen} Personen`}>
                            Gruppe {z.maschine} ({z.gruppe_personen})
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{z.feld_name ?? "—"}</td>
                      <td className="text-right tabular-nums">{formatMenge(z.kg, 1)}</td>
                      <td className="text-right tabular-nums">{z.kisten}</td>
                      <td className="text-right">
                        {darfFreigeben ? (
                          <span className="inline-flex flex-col items-end gap-1">
                            <input
                              aria-label={`Stunden ${z.name}`}
                              className={`w-20 text-right ${korrigiert ? "border-amber-400" : ""}`}
                              placeholder={z.stunden === null ? "fehlt" : formatMenge(z.stunden, 2)}
                              value={k.stunden}
                              onChange={(e) => setKorrektur({ ...korrektur, [key]: { ...k, stunden: e.target.value } })}
                            />
                            {korrigiert && (
                              <input
                                aria-label={`Begründung ${z.name}`}
                                className="w-40 text-xs"
                                placeholder="Begründung"
                                value={k.grund}
                                onChange={(e) => setKorrektur({ ...korrektur, [key]: { ...k, grund: e.target.value } })}
                              />
                            )}
                          </span>
                        ) : (
                          <span className="tabular-nums">{s === null ? "—" : formatMenge(s, 2)}</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{katText(z.kategorie)}</td>
                      <td className="text-right tabular-nums">{z.preis_kg === null ? "—" : formatEuro(Number(z.kg) * Number(z.preis_kg))}</td>
                      <td className="text-right font-medium tabular-nums">{praemie ? formatEuro(praemie) : ""}</td>
                      <td className="text-right tabular-nums text-neutral-500">{fehl ? formatEuro(fehl) : ""}</td>
                      <td className="text-xs text-amber-800">{hinweise.filter((h) => h !== "ungeklärte Kisten an diesem Tag").join(", ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-neutral-600">
              {gerechnet.length} Zeilen · Prämie {formatEuro(summe)}
              {offen > 0 && <span className="ml-2 text-amber-800">· {offen} zu klären</span>}
            </span>
            {darfFreigeben && (
              <button type="button" className="btn" disabled={arbeitet || offen > 0} onClick={freigeben} title={offen > 0 ? "Erst die markierten Zeilen klären" : undefined}>
                <ShieldCheck className="h-4 w-4" />
                {arbeitet ? "Gibt frei…" : `${formatDatumDE(datum)} freigeben`}
              </button>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            Lohnwirksam wird die Prämie nur für Personen, die in der Saison Stunden im Stundenzettel haben (wie beim Zuckermais).
          </p>
        </>
      )}
    </div>
  );
}
