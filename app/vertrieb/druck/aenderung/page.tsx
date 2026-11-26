"use client";

// Vertrieb → Änderungszettel DIN A4, je geänderter Tour eine Seite
// (Vertriebsplanung V4). Nutzer 2026-11-26: Fahrer wissen oft nichts von
// einem Planwechsel und fahren ohne Vertretung los - deshalb nur bei
// Änderungen ein eigener Zettel je betroffener Tour, groß "HEUTE ANDERS".
// Vergleich mit dem letzten Ausdruck dieses Tages (vt_druck); noch nie
// gedruckt = Vergleich mit dem Grundplan. Drucken speichert einen neuen
// Stand, damit spätere Zettel nur noch Neues zeigen.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import TourKarte from "@/components/TourKarte";
import { heuteLokalIso } from "@/lib/datum";
import { datumLang, tagesplanBerechnen, tagesplanStand, tourAenderungen } from "@/lib/tagesplan";
import { saisonVon, tagesplanDatenLaden, type TagesplanDaten } from "@/lib/tagesplanLaden";

function Aenderungszettel() {
  const params = useSearchParams();
  const datum = params.get("datum") || heuteLokalIso();
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "hr");
  const [d, setD] = useState<TagesplanDaten | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Bezug festhalten, damit der Zettel nach dem Speichern des neuen Stands nicht leer wird
  const [bezugId, setBezugId] = useState<number | null | undefined>(undefined);

  const load = useCallback(async () => {
    const daten = await tagesplanDatenLaden(getSupabaseClient(), datum, datum);
    setD(daten);
    setFehler(daten.fehler);
    setBezugId((alt) => (alt === undefined ? daten.drucke[0]?.id ?? null : alt));
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
  const bezug = bezugId ? d?.drucke.find((x) => x.id === bezugId) ?? null : null;
  const aenderungen = useMemo(() => (tp && bezugId !== undefined ? tourAenderungen(tp, bezug?.stand ?? null) : []), [tp, bezug, bezugId]);
  const personById = useMemo(() => new Map((d?.personen ?? []).map((p) => [p.id, p])), [d]);
  const name = (id: string) => {
    const p = personById.get(id);
    return p ? `${p.vorname} ${p.name}` : "?";
  };

  async function drucken() {
    if (!tp) return;
    if (darfPflegen) {
      const { error } = await getSupabaseClient().from("vt_druck").insert({ datum, stand: tagesplanStand(tp, "A4") });
      if (error) return setFehler(`Druck-Stand nicht gespeichert: ${error.message}`);
    }
    window.print();
  }

  return (
    <div className="flex flex-col gap-3">
      <style>{"@page { size: A4 portrait; margin: 10mm; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; } }"}</style>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/vertrieb/druck/tag?datum=${datum}`} className="btn-secondary">
          ← Tagesplan
        </Link>
        <button className="btn" onClick={drucken} disabled={!aenderungen.length}>
          <Printer className="mr-1 inline h-4 w-4" /> {aenderungen.length} Zettel drucken (DIN A4)
        </button>
        <span className="text-sm text-neutral-600">
          {bezug
            ? `Vergleich mit dem Ausdruck vom ${new Date(bezug.gedruckt_am).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`
            : "Noch nichts gedruckt - Vergleich mit dem Grundplan"}
        </span>
        {fehler && <span className="text-sm text-beere-600">{fehler}</span>}
      </div>
      {tp && aenderungen.length === 0 && <p className="text-sm text-neutral-600 print:hidden">Keine Änderungen - kein Zettel nötig.</p>}
      {tp &&
        aenderungen.map((a, i) => (
          <div key={a.tour.tour.id} className={`flex flex-col gap-3 ${i < aenderungen.length - 1 ? "break-after-page" : ""}`}>
            <div className="rounded-lg bg-orange-500 px-3 py-2 text-center text-white">
              <div className="text-5xl font-black tracking-wide">ACHTUNG!</div>
              <div className="text-3xl font-black">HEUTE ANDERS</div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black uppercase">{datumLang(datum)}</span>
              <span className="text-4xl font-black">TOUR {a.tour.tour.nummer}</span>
            </div>
            <TourKarte t={a.tour} name={name} aenderung={a} fahrzeuge={d!.fahrzeuge} gross />
            <p className="text-sm">
              Orange = <b>NEU</b>. Durchgestrichen = vorher. Bitte dem Fahrer und allen in der Tour zeigen.
            </p>
          </div>
        ))}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Lädt …</p>}>
      <Aenderungszettel />
    </Suspense>
  );
}
