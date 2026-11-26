// Eine Tour für einen Tag - für den A3-Tagesplan und den A4-Änderungszettel
// (Vertriebsplanung V4). Für einfache, oft nicht muttersprachliche
// Verkäufer: große Namen, wenig Text, Symbole, Reihenfolge der Halte als
// große Zahl (Nutzer 2026-11-26: schnell finden, wo verkaufe ich, wer fährt,
// welches Auto, wer sitzt mit drin, wann steigt wer wo aus).

import { Car, Clock, Package } from "lucide-react";
import type { TagesFeld, TagesTour, TourAenderung, Fahrzeug } from "@/lib/tagesplan";
import { zeitKurz } from "@/lib/vertrieb";

export default function TourKarte({
  t,
  name,
  aenderung,
  fahrzeuge,
  gross = false,
  zusatz,
}: {
  t: TagesTour;
  name: (id: string) => string;
  aenderung?: TourAenderung | null;
  fahrzeuge: Fahrzeug[];
  gross?: boolean;
  zusatz?: React.ReactNode;
}) {
  const fzText = (f: Fahrzeug | null | undefined) => (f ? f.kennzeichen || f.bezeichnung : "—");
  const fzVorher = aenderung?.fahrzeugVorher !== undefined ? fahrzeuge.find((f) => f.id === aenderung.fahrzeugVorher) ?? null : undefined;
  const txt = gross ? "text-lg" : "text-[13px]";
  const nameTxt = gross ? "text-xl" : "text-[15px]";

  const personZeile = (f: TagesFeld, vorher: string | null | undefined, ab: boolean) => {
    const neu = vorher !== undefined;
    const p = f.zu ? null : f.emp;
    return (
      <div className={`flex flex-wrap items-baseline gap-x-1.5 ${neu ? "rounded bg-orange-100 px-1" : ""}`}>
        {ab && <span className="text-neutral-500">ab {zeitKurz(f.von)}:</span>}
        {f.zu ? (
          <span className="font-bold">heute ZU</span>
        ) : p ? (
          <span className={`font-bold ${nameTxt}`}>{name(p)}</span>
        ) : (
          <span className="font-bold text-beere-700">??? (niemand)</span>
        )}
        {neu && <span className="rounded bg-orange-500 px-1 text-[10px] font-bold uppercase text-white">neu</span>}
        {neu && vorher && vorher !== "zu" && <span className="text-neutral-500 line-through">{name(vorher)}</span>}
      </div>
    );
  };

  return (
    <div className="break-inside-avoid overflow-hidden rounded-lg border-2 border-emerald-900">
      <div className="flex items-baseline justify-between gap-2 bg-emerald-900 px-2 py-1 text-white">
        <span className={`font-black tracking-wide ${gross ? "text-3xl" : "text-2xl"}`}>TOUR {t.tour.nummer}</span>
        {t.tour.name && <span className="truncate text-sm opacity-90">{t.tour.name}</span>}
      </div>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-emerald-900/30 bg-emerald-50 px-2 py-1 ${txt}`}>
        <span className={`flex items-center gap-1 font-black ${gross ? "text-2xl" : "text-xl"} ${aenderung?.fahrzeugVorher !== undefined ? "rounded bg-orange-100 px-1" : ""}`}>
          <Car className={gross ? "h-7 w-7" : "h-5 w-5"} />
          {fzText(t.fahrzeug)}
          {fzVorher !== undefined && <span className="text-sm font-normal text-neutral-500 line-through">{fzText(fzVorher)}</span>}
        </span>
        {t.abfahrt && (
          <span className={`flex items-center gap-1 font-bold ${aenderung?.abfahrtVorher !== undefined ? "rounded bg-orange-100 px-1" : ""}`}>
            <Clock className="h-4 w-4" /> {zeitKurz(t.abfahrt)}
            {aenderung?.abfahrtVorher !== undefined && aenderung.abfahrtVorher && (
              <span className="font-normal text-neutral-500 line-through">{zeitKurz(aenderung.abfahrtVorher)}</span>
            )}
          </span>
        )}
      </div>
      <div className={`flex items-center gap-2 border-b border-emerald-900/30 px-2 py-1 ${txt}`}>
        <span className="rounded bg-violet-700 px-1.5 py-0.5 text-xs font-bold uppercase text-white">Fahrer</span>
        <span className={`font-black ${gross ? "text-2xl" : "text-lg"}`}>{t.fahrer ? name(t.fahrer) : <span className="text-beere-700">??? (fehlt)</span>}</span>
      </div>
      <ol className="divide-y divide-emerald-900/15">
        {t.halte.map((h) => {
          const ae = aenderung?.halte.get(h.stand.id);
          const verschieden = (h.vm.emp ?? null) !== (h.nm.emp ?? null) || h.vm.zu !== h.nm.zu;
          return (
            <li key={h.stand.id} className={`flex gap-2 px-2 py-1 ${h.fahrerStand ? "bg-violet-50" : ""} ${txt}`}>
              <span
                className={`flex shrink-0 items-center justify-center rounded-full border-2 border-emerald-900 font-black ${
                  gross ? "h-9 w-9 text-xl" : "h-7 w-7 text-base"
                } ${h.fahrerStand ? "bg-violet-700 text-white" : ""}`}
              >
                {h.platz}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded bg-black px-1.5 py-px font-bold uppercase text-white">{h.stand.name}</span>
                  {h.vm.von && (
                    <span className="text-neutral-600">
                      {zeitKurz(h.vm.von)}–{zeitKurz(h.nm.bis ?? h.vm.bis)}
                    </span>
                  )}
                  {h.fahrerStand && (
                    <span className="flex items-center gap-0.5 text-xs font-bold text-violet-800">
                      <Car className="h-3.5 w-3.5" /> Auto bleibt hier
                    </span>
                  )}
                  {h.nur_ware && (
                    <span className="flex items-center gap-0.5 text-xs font-bold">
                      <Package className="h-3.5 w-3.5" /> nur Ware – Verkäufer kommt selbst
                    </span>
                  )}
                </div>
                {personZeile(h.vm.offen || h.vm.emp ? h.vm : h.nm, ae ? (h.vm.offen || h.vm.emp ? ae.vm : ae.nm) : undefined, !(h.vm.offen || h.vm.emp))}
                {verschieden && (h.vm.offen || h.vm.emp) && (h.nm.offen || h.nm.emp) && personZeile(h.nm, ae?.nm, true)}
              </div>
            </li>
          );
        })}
      </ol>
      {aenderung && aenderung.raus.length > 0 && (
        <div className={`border-t-2 border-orange-500 bg-orange-50 px-2 py-1 ${txt}`}>
          <span className="font-bold">Heute NICHT dabei: </span>
          {aenderung.raus.map((p) => (
            <span key={p} className="mr-2 font-bold line-through">
              {name(p)}
            </span>
          ))}
        </div>
      )}
      {zusatz}
    </div>
  );
}
