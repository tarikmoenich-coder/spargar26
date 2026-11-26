"use client";

// Vertrieb → Tagesplan aller Touren als DIN-A3-Aushang (Vertriebsplanung V4).
// Nutzer 2026-11-26: Gesamt-Tagesplan liegt morgens aus. Für einfache, oft
// nicht muttersprachliche Verkäufer: große Schrift, Symbole, je Tour Auto
// (Kennzeichen), Fahrer, Reihenfolge der Halte, wer wo aussteigt; dazu ein
// Namensverzeichnis "Wer steht wo?". Beim Drucken wird der Stand gespeichert
// (vt_druck), damit der A4-Änderungszettel zeigt, was sich danach geändert hat.

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Car, ChevronLeft, ChevronRight, Package, Printer } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import TourKarte from "@/components/TourKarte";
import VertriebTabs from "@/components/VertriebTabs";
import { datumPlusTageIso, heuteLokalIso } from "@/lib/datum";
import { zeitInput, zeitKurz } from "@/lib/vertrieb";
import { datumLang, tagesplanBerechnen, tagesplanStand, tourAenderungen } from "@/lib/tagesplan";
import { saisonVon, tagesplanDatenLaden, type TagesplanDaten } from "@/lib/tagesplanLaden";

function TagesplanDruck() {
  const params = useSearchParams();
  const router = useRouter();
  const datum = params.get("datum") || heuteLokalIso();
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "hr");
  const [d, setD] = useState<TagesplanDaten | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const load = useCallback(async () => {
    const daten = await tagesplanDatenLaden(getSupabaseClient(), datum, datum);
    setD(daten);
    setFehler(daten.fehler);
  }, [datum]);
  useEffect(() => {
    load();
  }, [load]);

  const tp = useMemo(
    () =>
      d
        ? tagesplanBerechnen({
            datum,
            feiertage: d.feiertage,
            grundplan: d.grundplan.filter((g) => g.saison_jahr === saisonVon(datum)),
            zeiten: d.zeiten,
            aenderungen: d.aenderungen,
            abwesenheiten: d.abwesenheiten,
            staende: d.staende,
            touren: d.touren,
            tourStaende: d.tourStaende,
            tourTage: d.tourTage,
            fahrzeuge: d.fahrzeuge,
          })
        : null,
    [d, datum]
  );
  const personById = useMemo(() => new Map((d?.personen ?? []).map((p) => [p.id, p])), [d]);
  const name = (id: string) => {
    const p = personById.get(id);
    return p ? `${p.vorname} ${p.name}` : "?";
  };
  const letzterDruck = d?.drucke[0] ?? null;
  // "NEU" im A3 = heute anders als im Grundplan
  const gegenGrundplan = useMemo(() => new Map((tp ? tourAenderungen(tp, null) : []).map((a) => [a.tour.tour.id, a])), [tp]);
  const geaendert = tp && letzterDruck ? tourAenderungen(tp, letzterDruck.stand).length : 0;

  // Wer steht wo? (alphabetisch nach Nachname)
  const verzeichnis = useMemo(() => {
    if (!tp) return [];
    const m = new Map<string, { tour: number | null; platz: number | null; stand: string; fahrer: boolean; ab: string | null }>();
    for (const t of tp.touren)
      for (const h of t.halte)
        for (const f of [h.vm, h.nm])
          if (f.emp && !f.zu && !m.has(f.emp))
            m.set(f.emp, { tour: t.tour.nummer, platz: h.platz, stand: h.stand.name, fahrer: t.fahrer === f.emp, ab: f.halbtag === "NM" && h.vm.emp !== f.emp ? f.von : null });
    for (const o of tp.ohneTour)
      for (const f of [o.vm, o.nm])
        if (f.emp && !f.zu && !m.has(f.emp)) m.set(f.emp, { tour: null, platz: null, stand: o.stand.name, fahrer: false, ab: f.halbtag === "NM" && o.vm.emp !== f.emp ? f.von : null });
    return [...m.entries()]
      .map(([id, w]) => ({ id, p: personById.get(id), ...w }))
      .sort((a, b) => (a.p?.name ?? "").localeCompare(b.p?.name ?? "", "de") || (a.p?.vorname ?? "").localeCompare(b.p?.vorname ?? "", "de"));
  }, [tp, personById]);

  async function drucken() {
    if (!tp) return;
    if (darfPflegen) {
      const { error } = await getSupabaseClient().from("vt_druck").insert({ datum, stand: tagesplanStand(tp, "A3") });
      if (error) return setFehler(`Druck-Stand nicht gespeichert: ${error.message}`);
      load();
    }
    window.print();
  }

  async function tourTagSetzen(tourId: number, feld: { fahrzeug_id?: number | null; abfahrt?: string | null }) {
    const alt = d?.tourTage.find((x) => x.tour_id === tourId && x.datum === datum);
    const neu = { fahrzeug_id: alt?.fahrzeug_id ?? null, abfahrt: alt?.abfahrt ?? null, ...feld };
    const sb = getSupabaseClient();
    const { error } =
      neu.fahrzeug_id === null && neu.abfahrt === null
        ? alt
          ? await sb.from("vt_tour_tag").delete().eq("id", alt.id)
          : { error: null }
        : await sb.from("vt_tour_tag").upsert({ datum, tour_id: tourId, ...neu, geaendert_am: new Date().toISOString() }, { onConflict: "datum,tour_id" });
    if (error) setFehler(error.message);
    load();
  }

  return (
    <div className="flex flex-col gap-3">
      <VertriebTabs />
      <style>{"@page { size: A3 landscape; margin: 7mm; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; } }"}</style>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/vertrieb/woche" className="btn-secondary">
          ← Woche
        </Link>
        <button className="btn-secondary px-2" onClick={() => router.replace(`/vertrieb/druck/tag?datum=${datumPlusTageIso(datum, -1)}`)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input type="date" value={datum} onChange={(e) => e.target.value && router.replace(`/vertrieb/druck/tag?datum=${e.target.value}`)} />
        <button className="btn-secondary px-2" onClick={() => router.replace(`/vertrieb/druck/tag?datum=${datumPlusTageIso(datum, 1)}`)}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <button className="btn" onClick={drucken} disabled={!tp}>
          <Printer className="mr-1 inline h-4 w-4" /> Drucken (DIN A3 quer)
        </button>
        {letzterDruck && (
          <span className="text-sm text-neutral-600">
            zuletzt gedruckt {new Date(letzterDruck.gedruckt_am).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
          </span>
        )}
        {geaendert > 0 && (
          <Link href={`/vertrieb/druck/aenderung?datum=${datum}`} className="rounded border border-orange-400 bg-orange-50 px-2 py-1 text-sm font-semibold text-orange-800">
            seit dem Druck {geaendert} Tour{geaendert === 1 ? "" : "en"} geändert → Änderungszettel A4
          </Link>
        )}
        {fehler && <span className="text-sm text-beere-600">{fehler}</span>}
      </div>
      {darfPflegen && <p className="text-xs text-neutral-500 print:hidden">Auto und Abfahrt lassen sich unter jeder Tour nur für diesen Tag ändern. Im Druck erscheinen die Auswahlfelder nicht.</p>}

      {!tp ? (
        <p className="text-sm text-neutral-500">Lädt …</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between border-b-4 border-emerald-900 pb-1">
            <h1 className="text-3xl font-black uppercase tracking-wide text-emerald-950">{datumLang(datum)}</h1>
            {tp.feiertag && <span className="rounded bg-amber-300 px-2 text-xl font-black">FEIERTAG: {tp.feiertag.name}</span>}
            <span className="text-lg font-bold text-emerald-900">Verkauf · Touren</span>
          </div>

          {tp.touren.length === 0 && <p className="text-lg">Heute keine Touren.</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 print:grid-cols-4">
            {tp.touren.map((t) => {
              const tt = d!.tourTage.find((x) => x.tour_id === t.tour.id && x.datum === datum);
              return (
                <TourKarte
                  key={t.tour.id}
                  t={t}
                  name={name}
                  aenderung={gegenGrundplan.get(t.tour.id) ?? null}
                  fahrzeuge={d!.fahrzeuge}
                  zusatz={
                    darfPflegen ? (
                      <div className="flex flex-wrap items-center gap-1 border-t border-dashed border-linie bg-sand px-2 py-1 text-xs print:hidden">
                        <span>heute:</span>
                        <select
                          value={tt?.fahrzeug_id ?? ""}
                          onChange={(e) => tourTagSetzen(t.tour.id, { fahrzeug_id: e.target.value ? Number(e.target.value) : null })}
                          className="max-w-40 py-0 text-xs"
                        >
                          <option value="">Auto wie immer</option>
                          {d!.fahrzeuge.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.kennzeichen || "ohne Kz."} · {f.bezeichnung}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={zeitInput(tt?.abfahrt)}
                          onChange={(e) => tourTagSetzen(t.tour.id, { abfahrt: e.target.value || null })}
                          className="py-0 text-xs"
                          title="Abfahrt nur heute"
                        />
                      </div>
                    ) : undefined
                  }
                />
              );
            })}
          </div>

          {tp.ohneTour.length > 0 && (
            <div className="break-inside-avoid rounded-lg border-2 border-neutral-400">
              <div className="bg-neutral-200 px-2 py-1 text-lg font-black uppercase">Ohne Auto – kommen selbst zum Stand</div>
              <div className="grid grid-cols-2 gap-x-6 px-2 py-1 text-[13px] md:grid-cols-3 xl:grid-cols-4 print:grid-cols-4">
                {tp.ohneTour.map((o) => (
                  <div key={o.stand.id} className="flex flex-wrap items-baseline gap-x-1.5 border-b border-neutral-200 py-0.5">
                    <span className="font-bold uppercase">{o.stand.name}</span>
                    {o.vm.zu && o.nm.zu ? (
                      <span className="font-bold">heute ZU</span>
                    ) : (
                      <>
                        <span className="font-bold">{o.vm.emp ? name(o.vm.emp) : o.vm.offen ? <span className="text-beere-700">???</span> : ""}</span>
                        {o.nm.emp !== o.vm.emp && (o.nm.offen || o.nm.emp) && (
                          <span>
                            · ab {zeitKurz(o.nm.von)}: <b>{o.nm.emp ? name(o.nm.emp) : <span className="text-beere-700">???</span>}</b>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="break-inside-avoid rounded-lg border-2 border-emerald-900">
            <div className="bg-emerald-900 px-2 py-1 text-lg font-black uppercase text-white">Wer steht wo? (nach Nachname)</div>
            <div className="columns-2 gap-6 px-2 py-1 text-[13px] md:columns-3 xl:columns-5 print:columns-5">
              {verzeichnis.map((v) => (
                <div key={v.id} className="flex break-inside-avoid items-baseline gap-1 border-b border-neutral-200 py-0.5">
                  <span className="font-bold uppercase">{v.p?.name}</span>
                  <span>{v.p?.vorname}</span>
                  <span className="ml-auto whitespace-nowrap">
                    {v.tour !== null ? (
                      <>
                        <b>T{v.tour}</b> · {v.platz}. {v.stand}
                      </>
                    ) : (
                      v.stand
                    )}
                    {v.ab && <> · ab {zeitKurz(v.ab)}</>}
                    {v.fahrer && <Car className="ml-0.5 inline h-3.5 w-3.5 text-violet-700" />}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-neutral-600">
            <Car className="inline h-3 w-3" /> Fahrer = fährt das Auto, setzt alle ab (Reihenfolge 1, 2, 3 …) und holt sie nach dem Verkauf wieder
            ab. <Package className="inline h-3 w-3" /> nur Ware = Verkäufer kommt selbst. Orange „NEU“ = heute anders als sonst.
          </p>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Lädt …</p>}>
      <TagesplanDruck />
    </Suspense>
  );
}
