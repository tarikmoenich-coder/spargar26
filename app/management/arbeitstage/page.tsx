"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import {
  arbeitsserieGesamtstatus,
  arbeitsserieRelevant,
  serieCutoffISO,
  type ArbeitstageGesamtstatus,
} from "@/lib/controlling";
import { addTageIso, montagDerWoche, sonntagDerWoche } from "@/lib/woche";
import type { ArbeitstageSerie } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";
import TageRaster from "@/components/TageRaster";

function serieKey(s: ArbeitstageSerie) {
  return `${s.employee_id}-${s.serie_bis}`;
}

export default function ControllingArbeitstagePage() {
  const { profile } = useProfile();
  // Muss zu work_entries_write/-update (RLS) passen - wie Stundenerfassung.
  const canEditStunden =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";

  const [arbeitsserie, setArbeitsserie] = useState<ArbeitstageSerie[]>([]);
  const [loadingArbeitsserie, setLoadingArbeitsserie] = useState(true);
  const [arbeitsserieFehler, setArbeitsserieFehler] = useState<string | null>(
    null
  );

  // Aufgeklapptes Wochenraster (immer nur eines gleichzeitig) - der Rest
  // (Sperre/Entwurf/Speichern) steckt in components/TageRaster.tsx.
  const [offen, setOffen] = useState<ArbeitstageSerie | null>(null);
  const [offenDirty, setOffenDirty] = useState(false);

  async function loadArbeitsserie() {
    setLoadingArbeitsserie(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("arbeitstage_serie_uebersicht")
      .select("*");
    if (error) {
      setArbeitsserieFehler(error.message);
    } else {
      setArbeitsserieFehler(null);
      setArbeitsserie((data as ArbeitstageSerie[]) ?? []);
    }
    setLoadingArbeitsserie(false);
  }

  useEffect(() => {
    loadArbeitsserie();
  }, []);

  const cutoff = serieCutoffISO();
  const relevante = arbeitsserie.filter((s) => arbeitsserieRelevant(s, cutoff));
  // Nutzer-Feedback 2026-09-14: "bleiben die Serien jedoch rot markiert
  // stehen, selbst wenn der Ersatzausgleich erfolgt ist" - die Kopfzahlen
  // zählen deshalb den Gesamtstatus (läuft/Ausgleich offen/Verstoß), nicht
  // mehr blind die Ampel-Farbe, sonst bleiben erledigte Serien ewig mitgezählt.
  const serieVerstoss = relevante.filter(
    (s) => arbeitsserieGesamtstatus(s) === "verstoss"
  ).length;
  const serieAusgleichOffen = relevante.filter(
    (s) => arbeitsserieGesamtstatus(s) === "ausgleich_offen"
  ).length;
  const serieLaeuft = relevante.filter(
    (s) => arbeitsserieGesamtstatus(s) === "laeuft"
  ).length;
  const serieErledigt = relevante.filter(
    (s) => arbeitsserieGesamtstatus(s) === "erledigt"
  ).length;

  // Nutzer-Vorgabe 2026-09-14: Serien pro Person gruppieren, Personen mit
  // dem dringendsten Status zuerst (Verstoß > Ausgleich offen > läuft noch
  // > erledigt), sonst alphabetisch. Innerhalb einer Person neueste Serie
  // zuerst.
  const RANG: Record<ArbeitstageGesamtstatus, number> = {
    verstoss: 0,
    ausgleich_offen: 1,
    laeuft: 2,
    erledigt: 3,
  };
  const gruppen = useMemo(() => {
    const byPerson = new Map<string, ArbeitstageSerie[]>();
    for (const s of relevante) {
      const arr = byPerson.get(s.employee_id) ?? [];
      arr.push(s);
      byPerson.set(s.employee_id, arr);
    }
    return [...byPerson.entries()]
      .map(([employeeId, serien]) => {
        const sortiert = [...serien].sort((a, b) =>
          b.serie_bis.localeCompare(a.serie_bis)
        );
        const rang = Math.min(
          ...sortiert.map((s) => RANG[arbeitsserieGesamtstatus(s)])
        );
        return { employeeId, serien: sortiert, rang };
      })
      .sort(
        (a, b) =>
          a.rang - b.rang ||
          a.serien[0].name.localeCompare(b.serien[0].name, "de") ||
          a.serien[0].vorname.localeCompare(b.serien[0].vorname, "de")
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevante]);

  // Rasterfenster: Montag der Serienstartwoche bis Sonntag der Woche NACH
  // dem Serienende (eine Woche Puffer - zeigt, ob danach Ruhetage kamen).
  function rasterFenster(s: ArbeitstageSerie) {
    return {
      von: montagDerWoche(s.serie_von),
      bis: addTageIso(sonntagDerWoche(s.serie_bis), 7),
    };
  }

  // Nur EIN Raster gleichzeitig offen - Wechsel auf eine andere Zeile bzw.
  // Schließen fragt nach, wenn ungespeicherte Änderungen anstehen (TageRaster
  // meldet das über onDirtyChange).
  function waehleSerie(s: ArbeitstageSerie) {
    const istDieselbe = !!offen && serieKey(offen) === serieKey(s);
    if (offen && offenDirty) {
      if (!window.confirm("Nicht gespeicherte Änderungen verwerfen?")) return;
    }
    setOffen(istDieselbe ? null : s);
    setOffenDirty(false);
  }

  // Serie durch die Bearbeitung verkürzt/aufgelöst -> Raster schließen (nach
  // "Alles speichern" ist der Entwurf nicht mehr dirty, also ohne Nachfrage).
  useEffect(() => {
    if (!offen || loadingArbeitsserie) return;
    const nochDa = arbeitsserie.some((x) => serieKey(x) === serieKey(offen));
    if (!nochDa) {
      setOffen(null);
      setOffenDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbeitsserie]);

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (offen && offenDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [offen, offenDirty]);

  // Soll: 7-13 Tage am Stück -> 1 freier Tag, 14-20 Tage -> 2 freie Tage.
  function ersatzausgleichSoll(s: ArbeitstageSerie): number {
    return s.serie_tage >= 14 ? 2 : 1;
  }

  function ersatzausgleichText(s: ArbeitstageSerie) {
    if (s.ersatzausgleich === null) return <>—</>;
    const soll = ersatzausgleichSoll(s);
    if (s.ersatzausgleich === "kein_ausgleich")
      return (
        <span className="font-medium text-red-600">
          kein legaler Ausgleich möglich
        </span>
      );
    if (s.ersatzausgleich === "erfuellt") return <>erfüllt</>;
    if (s.ersatzausgleich === "offen")
      return (
        <>
          {`offen (${s.ersatz_freie_tage ?? 0}/${soll} freie Tage${
            s.ersatz_fenster_bis
              ? `, bis ${formatDatumDE(s.ersatz_fenster_bis)}`
              : ""
          })`}
        </>
      );
    return (
      <span className="font-medium text-red-600">
        fehlt ({s.ersatz_freie_tage ?? 0}/{soll} freie Tage)
      </span>
    );
  }

  // Kombinierter Status je Serie (Nutzer-Vorgabe 2026-09-14): "beendet" +
  // "Ersatzausgleich erfüllt" wird als grünes "erledigt" abgehakt, statt
  // wie bisher dauerhaft rot/gelb (Ampel) stehen zu bleiben.
  function statusBadge(s: ArbeitstageSerie) {
    const status = arbeitsserieGesamtstatus(s);
    if (status === "laeuft")
      return (
        <span
          className={
            s.ampel === "rot"
              ? "font-medium text-red-600"
              : "font-medium text-amber-600"
          }
        >
          läuft noch
        </span>
      );
    if (status === "erledigt")
      return <span className="font-medium text-emerald-700">✓ erledigt</span>;
    if (status === "ausgleich_offen")
      return (
        <span className="font-medium text-amber-600">
          beendet, Ausgleich bis{" "}
          {s.ersatz_fenster_bis ? formatDatumDE(s.ersatz_fenster_bis) : "?"}
        </span>
      );
    return <span className="font-medium text-red-600">⚠ Verstoß</span>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={CalendarClock}
        titel="Arbeitstage am Stück"
        beschreibung="Aufeinanderfolgende Arbeitstage ohne freien Tag (Pause = 0 Std., „U“ oder kein Eintrag; „F“/Fahrer zählt als Arbeitstag). Ab 7 Tagen gelb, ab 14 Tagen rot. Nach 7 Tagen am Stück verlangt das Arbeitszeitgesetz 1, nach 14 Tagen 2 freie Tage in der Folgewoche (Ersatzausgleich) - ist der erfolgt, gilt die Serie als erledigt; ab 21 Tagen gibt es keinen legalen Ausgleich mehr. Aktueller Stand, unabhängig vom Jahr."
      />

      <p className="text-sm text-neutral-600">
        {loadingArbeitsserie ? (
          "…"
        ) : (
          <>
            <span className="font-medium text-red-600">{serieVerstoss}</span>{" "}
            Verstoß/Verstöße ·{" "}
            <span className="font-medium text-amber-600">
              {serieAusgleichOffen}
            </span>{" "}
            Ausgleich in der Frist ·{" "}
            <span className="font-medium text-amber-600">{serieLaeuft}</span>{" "}
            Serie(n) laufen noch
            {serieErledigt > 0 && (
              <>
                {" · "}
                <span className="font-medium text-emerald-700">
                  ✓ {serieErledigt} erledigt
                </span>
              </>
            )}
          </>
        )}
      </p>

      {loadingArbeitsserie ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : arbeitsserieFehler ? (
        <p className="text-sm text-red-600">
          Auswertung nicht verfügbar ({arbeitsserieFehler}). Vermutlich fehlt
          die Migration 2026-09-19 (arbeitstage_serie_uebersicht) in der
          Datenbank.
        </p>
      ) : relevante.length === 0 ? (
        <p className="text-neutral-500">
          Kein Handlungsbedarf - keine Serie von 7 oder mehr Arbeitstagen am
          Stück in den letzten Wochen.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Tage am Stück</th>
                <th>Zeitraum</th>
                <th>Status</th>
                <th>Ersatzausgleich</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gruppen.map((g) => (
                <Fragment key={g.employeeId}>
                  <tr className="bg-sand">
                    <td colSpan={7} className="pt-3 text-sm font-semibold text-neutral-700">
                      {g.serien[0].personal_nr} · {g.serien[0].name},{" "}
                      {g.serien[0].vorname}
                      {g.serien.length > 1 && (
                        <span className="ml-1 font-normal text-neutral-500">
                          ({g.serien.length} Serien)
                        </span>
                      )}
                    </td>
                  </tr>
                  {g.serien.map((s) => {
                    const key = serieKey(s);
                    const istOffen = !!offen && serieKey(offen) === key;
                    return (
                      <Fragment key={key}>
                        <tr>
                          <td>{s.personal_nr}</td>
                          <td>
                            {s.name}, {s.vorname}
                          </td>
                          <td
                            className={
                              s.ampel === "rot"
                                ? "font-medium text-red-600"
                                : "font-medium text-amber-600"
                            }
                          >
                            {s.serie_tage}
                          </td>
                          <td className="whitespace-nowrap">
                            {formatDatumDE(s.serie_von)} –{" "}
                            {formatDatumDE(s.serie_bis)}
                          </td>
                          <td className="text-sm">{statusBadge(s)}</td>
                          <td className="text-sm">{ersatzausgleichText(s)}</td>
                          <td className="whitespace-nowrap">
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              onClick={() => waehleSerie(s)}
                            >
                              {istOffen ? "Schließen" : "Bearbeiten"}
                            </button>{" "}
                            <Link
                              href={`/erfassung?datum=${s.serie_bis}&employee=${s.employee_id}`}
                              className="btn-secondary text-xs"
                            >
                              In Erfassung
                            </Link>
                          </td>
                    </tr>
                    {istOffen && (
                      <tr>
                        <td colSpan={7} className="bg-sand">
                          <TageRaster
                            employeeId={s.employee_id}
                            profileId={profile?.id ?? null}
                            von={rasterFenster(s).von}
                            bis={rasterFenster(s).bis}
                            saisonJahr={Number(s.serie_bis.slice(0, 4))}
                            canEdit={canEditStunden}
                            kritischerBereich={{ von: s.serie_von, bis: s.serie_bis }}
                            onDirtyChange={setOffenDirty}
                            onGespeichert={loadArbeitsserie}
                            zusatzAktionen={
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => waehleSerie(s)}
                              >
                                Schließen
                              </button>
                            }
                          />
                        </td>
                      </tr>
                    )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
