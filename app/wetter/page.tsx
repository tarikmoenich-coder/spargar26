"use client";

// Wetter & Frost (docs/wetter-konzept.md, Nutzer-Vorgabe 2026-11-28):
// 48 h im Stundenraster je Vorhersagepunkt, feldgenaue Frostwarnung für
// Erdbeeren in Blüte und Grünspargel in der Ernte, 10-Tage-Übersicht mit
// Umschwüngen. Daten: DWD MOSMIX über tools/wetter-poller.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CloudSun, Snowflake } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { darf } from "@/lib/rollen";
import { formatDatumDE } from "@/lib/format";
import { heuteLokalIso } from "@/lib/datum";
import {
  KULTUR_TEXT,
  fmtGrad,
  fmtMm,
  ortsDatum,
  ortsStunde,
  tageswerte,
  umschwuenge,
  veraltet,
  wetterLaden,
  type FeldWetter,
  type FrostNacht,
  type WetterStation,
  type WetterStunde,
} from "@/lib/wetter";

type Regel = { kultur: "erdbeeren" | "gruenspargel"; vorwarnung: number; kritisch: number; gruenspargel_ernte_von: string; gruenspargel_ernte_bis: string };
type Bluete = { feld_id: number; saison_jahr: number; von: string; bis: string | null };

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const tagKurz = (d: string) => `${WT[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${formatDatumDE(d).slice(0, 6)}`;
const zahl = (v: number | null | undefined, stellen = 1) =>
  v === null || v === undefined ? "–" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: stellen });

export default function WetterPage() {
  const { profile } = useProfile();
  const darfLesen = darf(profile, "wetter:L");
  const darfPflegen = darf(profile, "wetter:S");
  const jahr = Number(heuteLokalIso().slice(0, 4));

  const [stationId, setStationId] = useState<string | null>(null);
  const [stationen, setStationen] = useState<WetterStation[]>([]);
  const [felder, setFelder] = useState<FeldWetter[]>([]);
  const [frost, setFrost] = useState<FrostNacht[]>([]);
  const [stunden, setStunden] = useState<WetterStunde[]>([]);
  const [regeln, setRegeln] = useState<Regel[]>([]);
  const [bluete, setBluete] = useState<Bluete[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [meldung, setMeldung] = useState<string | null>(null);

  const laden = useCallback(
    async (sid?: string | null) => {
      setLaedt(true);
      const sb = getSupabaseClient();
      const [w, r, b] = await Promise.all([
        wetterLaden(sid),
        sb.from("wetter_frost_regel").select("*").order("kultur"),
        sb.from("feld_bluete").select("feld_id, saison_jahr, von, bis").eq("saison_jahr", jahr),
      ]);
      setStationen(w.stationen);
      setFelder(w.felder);
      setFrost(w.frost);
      setStunden(w.stunden);
      setStationId(w.stationId);
      setRegeln((r.data as Regel[]) ?? []);
      setBluete((b.data as Bluete[]) ?? []);
      setFehler(w.fehler ?? r.error?.message ?? b.error?.message ?? null);
      setLaedt(false);
    },
    [jahr]
  );

  useEffect(() => {
    if (darfLesen) laden();
  }, [darfLesen, laden]);

  const station = stationen.find((s) => s.id === stationId);
  const raster = stunden.slice(0, 48);
  const tage = useMemo(() => tageswerte(stunden), [stunden]);
  const hinweise = useMemo(() => umschwuenge(tage), [tage]);
  const felderJeStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of felder) if (f.station_id) m.set(f.station_id, (m.get(f.station_id) ?? 0) + 1);
    return m;
  }, [felder]);
  const erdbeerFelder = felder.filter((f) => f.kultur === "erdbeeren");
  const gruenFelder = felder.filter((f) => f.kultur === "gruenspargel");
  const blueteJetzt = erdbeerFelder.filter((f) => {
    const b = bluete.find((x) => x.feld_id === f.feld_id);
    const h = heuteLokalIso();
    return b && b.von <= h && (!b.bis || b.bis >= h);
  });

  async function regelSpeichern(kultur: string, teil: Partial<Regel>) {
    const { error } = await getSupabaseClient().from("wetter_frost_regel").update(teil).eq("kultur", kultur);
    if (error) return setFehler(error.message);
    setMeldung("Gespeichert.");
    laden(stationId);
  }
  async function blueteSetzen(feld_id: number, von: string | null, bis: string | null) {
    const sb = getSupabaseClient();
    const { error } = von
      ? await sb.from("feld_bluete").upsert({ feld_id, saison_jahr: jahr, von, bis })
      : await sb.from("feld_bluete").delete().eq("feld_id", feld_id).eq("saison_jahr", jahr);
    if (error) return setFehler(error.message);
    setMeldung("Gespeichert.");
    laden(stationId);
  }

  if (profile && !darfLesen) return <p className="text-sm text-neutral-600">Keine Berechtigung für das Wetter.</p>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={CloudSun}
        titel="Wetter & Frost"
        beschreibung="Vorhersage je Feld für 48 Stunden im Stundenraster und 10 Tage im Überblick. Frostwarnung nur für Erdbeeren in Blüte und Grünspargel in der Ernte."
      />
      {fehler && <p className="text-sm text-beere-700">{fehler}</p>}
      {meldung && <p className="text-sm text-emerald-700">{meldung}</p>}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Ort
          <select value={stationId ?? ""} onChange={(e) => laden(e.target.value)} disabled={stationen.length === 0}>
            {stationen.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({felderJeStation.get(s.id) ?? 0} Felder)
              </option>
            ))}
          </select>
        </label>
        {station && (
          <span className={veraltet(station) ? "font-medium text-beere-700" : "text-neutral-500"}>
            DWD-Vorhersage vom {new Date(station.ausgabe ?? "").toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
            {veraltet(station) && " – veraltet, läuft der Wetter-Abruf?"}
          </span>
        )}
      </div>

      {!laedt && stationen.length === 0 && (
        <p className="card p-4 text-sm text-neutral-600">
          Noch keine Wetterdaten. Der Wetter-Abruf auf dem Server (tools/wetter-poller) muss einmal eingerichtet werden.
        </p>
      )}

      {/* ---- Frost ---------------------------------------------------------- */}
      <section className="card flex flex-col gap-2 p-4">
        <h2 className="flex items-center gap-2 font-semibold text-emerald-900">
          <Snowflake className="h-4 w-4" /> Frost in den nächsten 48 Stunden
        </h2>
        <p className="text-xs text-neutral-500">
          Überwacht: {blueteJetzt.length} von {erdbeerFelder.length} Erdbeerfeldern in Blüte · {gruenFelder.length} Grünspargelfelder (während der Ernte).
          Temperatur 5 cm über dem Boden am nächsten DWD-Vorhersagepunkt – in Senken kann es kälter sein.
        </p>
        {laedt ? (
          <p className="text-sm text-neutral-500">Lädt…</p>
        ) : frost.length === 0 ? (
          <p className="text-sm text-emerald-700">Keine Frostgefahr für die überwachten Felder.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th>Feld</th>
                  <th>Kultur</th>
                  <th>Zeitraum</th>
                  <th className="text-right">Tiefstwert 5 cm</th>
                  <th>Stufe</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>
                {frost.map((n) => (
                  <tr key={`${n.feld_id}-${n.von}`} className={n.stufe === "kritisch" ? "bg-beere-50" : "bg-amber-50/60"}>
                    <td className="font-medium">{n.bezeichnung}</td>
                    <td>{KULTUR_TEXT[n.kultur]}</td>
                    <td className="whitespace-nowrap">
                      {tagKurz(ortsDatum(n.von))} {ortsStunde(n.von)} – {ortsDatum(n.bis) !== ortsDatum(n.von) ? `${tagKurz(ortsDatum(n.bis))} ` : ""}
                      {ortsStunde(n.bis)}
                    </td>
                    <td className="text-right font-semibold tabular-nums">{fmtGrad(n.tiefst)}</td>
                    <td>
                      <span className={n.stufe === "kritisch" ? "badge-danger" : "badge-warn"}>{n.stufe === "kritisch" ? "kritisch" : "Vorwarnung"}</span>
                    </td>
                    <td className="text-xs text-neutral-600">{n.gruende.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- 48 h Stundenraster -------------------------------------------- */}
      {raster.length > 0 && (
        <section className="card flex flex-col gap-2 p-4">
          <h2 className="font-semibold text-emerald-900">Nächste 48 Stunden – {station?.name}</h2>
          <div className="overflow-x-auto">
            <table className="text-xs tabular-nums [&_td]:px-1.5 [&_td]:py-1 [&_td]:text-center [&_th]:px-1.5 [&_th]:py-1">
              <tbody>
                <tr>
                  <th className="sticky left-0 z-10 bg-white text-left">Tag</th>
                  {raster.map((s, i) => {
                    const d = ortsDatum(new Date(new Date(s.zeit).getTime() - 60e3).toISOString());
                    const neuerTag = i === 0 || d !== ortsDatum(new Date(new Date(raster[i - 1].zeit).getTime() - 60e3).toISOString());
                    return (
                      <th key={s.zeit} className={`whitespace-nowrap font-semibold ${neuerTag ? "border-l-2 border-emerald-300" : ""}`}>
                        {neuerTag ? tagKurz(d) : ""}
                      </th>
                    );
                  })}
                </tr>
                <Zeile titel="Uhrzeit" raster={raster} wert={(s) => ortsStunde(new Date(new Date(s.zeit).getTime() - 3600e3).toISOString()).slice(0, 2)} />
                <Zeile titel="Temperatur 2 m °C" raster={raster} wert={(s) => zahl(s.t2m)} farbe={(s) => tempFarbe(s.t2m)} />
                <Zeile titel="Bodennähe 5 cm °C" raster={raster} wert={(s) => zahl(s.t5cm)} farbe={(s) => tempFarbe(s.t5cm, true)} fett />
                <Zeile titel="Taupunkt °C" raster={raster} wert={(s) => zahl(s.td)} farbe={(s) => (s.td !== null && s.td <= 0 ? "text-sky-700" : "")} />
                <Zeile titel="Regen l/m²" raster={raster} wert={(s) => (s.regen_mm ? zahl(s.regen_mm) : "·")} farbe={(s) => regenFarbe(s.regen_mm)} />
                <Zeile titel="Regen-Wahrsch. %" raster={raster} wert={(s) => zahl(s.regen_wahrsch, 0)} farbe={(s) => ((s.regen_wahrsch ?? 0) >= 50 ? "text-sky-700" : "text-neutral-400")} />
                <Zeile titel="Sonne min" raster={raster} wert={(s) => (s.sonne_min ? zahl(s.sonne_min, 0) : "·")} farbe={(s) => ((s.sonne_min ?? 0) >= 30 ? "bg-yellow-100" : (s.sonne_min ?? 0) > 0 ? "bg-yellow-50" : "")} />
                <Zeile titel="Bewölkung %" raster={raster} wert={(s) => zahl(s.wolken_proz, 0)} farbe={() => "text-neutral-500"} />
                <Zeile titel="Wind m/s" raster={raster} wert={(s) => zahl(s.wind_ms)} farbe={() => "text-neutral-500"} />
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-500">
            Uhrzeit = Beginn der Stunde. Regen und Sonne jeweils in dieser Stunde. Bodennähe: rot = unter 0 °C, gelb = bis +1 °C.
          </p>
        </section>
      )}

      {/* ---- 10 Tage ----------------------------------------------------- */}
      {tage.length > 0 && (
        <section className="card flex flex-col gap-2 p-4">
          <h2 className="font-semibold text-emerald-900">10 Tage – Überblick und Umschwünge</h2>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th className="text-right">Min / Max</th>
                  <th className="text-right">Boden min</th>
                  <th className="text-right">Regen</th>
                  <th className="text-right">Sonne</th>
                  <th>Hinweise</th>
                </tr>
              </thead>
              <tbody>
                {tage.map((t) => {
                  const h = hinweise.filter((x) => x.datum === t.datum);
                  return (
                    <tr key={t.datum} className={t.stunden < 20 ? "text-neutral-400" : ""}>
                      <td className="whitespace-nowrap font-medium">
                        {tagKurz(t.datum)}
                        {t.stunden < 20 && <span className="ml-1 text-xs">(Rest)</span>}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {zahl(t.tmin)} / {zahl(t.tmax)} °C
                      </td>
                      <td className={`text-right tabular-nums ${t.t5min !== null && t.t5min <= 0 ? "font-semibold text-beere-700" : ""}`}>{fmtGrad(t.t5min)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{t.regen > 0.05 ? fmtMm(t.regen) : "–"}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{zahl(t.sonne_h)} h</td>
                      <td className="text-xs">
                        {h.map((x) => (
                          <span key={x.art} className={`mr-1 inline-block rounded px-1.5 py-0.5 ${x.art === "frost" || x.art === "sturz" ? "bg-beere-50 text-beere-800" : x.art === "hitze" || x.art === "waerme" ? "bg-orange-50 text-orange-800" : "bg-sky-50 text-sky-800"}`}>
                            {x.text}
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---- Einstellungen -------------------------------------------------- */}
      <section className="card flex flex-col gap-3 p-4">
        <h2 className="font-semibold text-emerald-900">Frost-Einstellungen</h2>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th>Kultur</th>
                <th>Vorwarnung ab (5 cm)</th>
                <th>Kritisch ab (5 cm)</th>
                <th>Wann überwacht</th>
              </tr>
            </thead>
            <tbody>
              {regeln.map((r) => (
                <tr key={r.kultur}>
                  <td className="font-medium">{KULTUR_TEXT[r.kultur]}</td>
                  {(["vorwarnung", "kritisch"] as const).map((feld) => (
                    <td key={feld}>
                      {darfPflegen ? (
                        <input
                          type="number"
                          step="0.5"
                          className="w-20"
                          defaultValue={r[feld]}
                          onBlur={(e) => Number(e.target.value) !== Number(r[feld]) && regelSpeichern(r.kultur, { [feld]: Number(e.target.value) })}
                        />
                      ) : (
                        fmtGrad(r[feld])
                      )}{" "}
                      {darfPflegen && "°C"}
                    </td>
                  ))}
                  <td className="text-xs text-neutral-600">
                    {r.kultur === "erdbeeren" ? (
                      "Felder mit Blüte (unten)"
                    ) : darfPflegen ? (
                      <span className="flex flex-wrap items-center gap-1">
                        Erntefenster aus dem Anbau, sonst
                        <input className="w-16" defaultValue={r.gruenspargel_ernte_von} onBlur={(e) => e.target.value !== r.gruenspargel_ernte_von && regelSpeichern(r.kultur, { gruenspargel_ernte_von: e.target.value })} />
                        bis
                        <input className="w-16" defaultValue={r.gruenspargel_ernte_bis} onBlur={(e) => e.target.value !== r.gruenspargel_ernte_bis && regelSpeichern(r.kultur, { gruenspargel_ernte_bis: e.target.value })} />
                        (MM-TT)
                      </span>
                    ) : (
                      `Erntefenster aus dem Anbau, sonst ${r.gruenspargel_ernte_von} bis ${r.gruenspargel_ernte_bis}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-500">
          Zusätzlich Vorwarnung bei Strahlungsfrost-Wetter: Taupunkt ≤ 0 °C, Himmel weitgehend klar und Bodentemperatur höchstens 2 °C über der
          Vorwarnschwelle.
        </p>

        <h3 className="mt-2 font-medium text-emerald-900">Erdbeerblüte {jahr}</h3>
        {erdbeerFelder.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine Erdbeerfelder mit Umriss gefunden (Anbau → Felder, Kultur „Erdbeeren“).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th>Feld</th>
                  <th>Blüte von</th>
                  <th>bis</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {erdbeerFelder.map((f) => {
                  const b = bluete.find((x) => x.feld_id === f.feld_id);
                  const heute = heuteLokalIso();
                  const aktiv = b && b.von <= heute && (!b.bis || b.bis >= heute);
                  return (
                    <tr key={f.feld_id} className={aktiv ? "bg-pink-50/60" : ""}>
                      <td className="font-medium">
                        {f.bezeichnung}
                        {aktiv && <span className="badge-warn ml-2 text-[10px]">blüht – Frost wird überwacht</span>}
                      </td>
                      {darfPflegen ? (
                        <Fragment>
                          <td>
                            <input type="date" defaultValue={b?.von ?? ""} key={`v${b?.von}`} onBlur={(e) => (e.target.value || null) !== (b?.von ?? null) && blueteSetzen(f.feld_id, e.target.value || null, b?.bis ?? null)} />
                          </td>
                          <td>
                            <input type="date" defaultValue={b?.bis ?? ""} key={`b${b?.bis}`} disabled={!b} onBlur={(e) => b && (e.target.value || null) !== b.bis && blueteSetzen(f.feld_id, b.von, e.target.value || null)} />
                          </td>
                          <td className="whitespace-nowrap">
                            {!aktiv && (
                              <button type="button" className="btn-secondary px-2 text-xs" onClick={() => blueteSetzen(f.feld_id, heute, null)}>
                                Blüte beginnt heute
                              </button>
                            )}
                            {aktiv && (
                              <button type="button" className="btn-secondary px-2 text-xs" onClick={() => blueteSetzen(f.feld_id, b!.von, heute)}>
                                Blüte heute beendet
                              </button>
                            )}
                          </td>
                        </Fragment>
                      ) : (
                        <>
                          <td>{b ? formatDatumDE(b.von) : "–"}</td>
                          <td>{b?.bis ? formatDatumDE(b.bis) : b ? "läuft" : "–"}</td>
                          <td></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-neutral-500">
        Quelle: Deutscher Wetterdienst (DWD), MOSMIX-Vorhersage, Open Data. Jedes Feld nutzt den nächstgelegenen DWD-Vorhersagepunkt
        {felder.length > 0 && ` (Entfernung bis ${zahl(Math.max(...felder.map((f) => Number(f.entfernung_km ?? 0))))} km)`}.
      </p>
    </div>
  );
}

function tempFarbe(v: number | null, boden = false): string {
  if (v === null) return "";
  if (v <= 0) return "bg-beere-100 text-beere-800 font-semibold";
  if (boden && v <= 1) return "bg-amber-100 text-amber-800";
  if (v >= 30) return "bg-orange-100 text-orange-800";
  return "";
}
function regenFarbe(v: number | null): string {
  const r = Number(v ?? 0);
  if (r >= 2) return "bg-sky-200 text-sky-900 font-semibold";
  if (r >= 0.5) return "bg-sky-100 text-sky-800";
  if (r > 0) return "bg-sky-50 text-sky-700";
  return "text-neutral-300";
}

function Zeile({
  titel,
  raster,
  wert,
  farbe,
  fett,
}: {
  titel: string;
  raster: WetterStunde[];
  wert: (s: WetterStunde) => string;
  farbe?: (s: WetterStunde) => string;
  fett?: boolean;
}) {
  return (
    <tr>
      <th className={`sticky left-0 z-10 whitespace-nowrap bg-white text-left ${fett ? "font-semibold" : "font-normal text-neutral-600"}`}>{titel}</th>
      {raster.map((s, i) => {
        const neuerTag =
          i > 0 &&
          ortsDatum(new Date(new Date(s.zeit).getTime() - 60e3).toISOString()) !==
            ortsDatum(new Date(new Date(raster[i - 1].zeit).getTime() - 60e3).toISOString());
        return (
          <td key={s.zeit} className={`${farbe?.(s) ?? ""} ${neuerTag ? "border-l-2 border-emerald-300" : ""}`}>
            {wert(s)}
          </td>
        );
      })}
    </tr>
  );
}
