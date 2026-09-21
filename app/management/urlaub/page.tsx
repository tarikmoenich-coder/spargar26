"use client";

// Controlling → Urlaub (Nutzer-Vorgabe 2026-09-16: "einen ähnlichen Aufbau
// wie beim Arbeitstage am Stück Monitoring"). Wie dort: EIN kombinierter
// Gesamtstatus (urlaubGesamtstatus, lib/controlling.ts) statt der früheren
// drei nebeneinander stehenden Tabellen (überzogen / Resturlaub inaktiv /
// Resturlaub aktiv) - EINE Tabelle mit ALLEN Personen des Saisonjahrs
// (employee_urlaubstage enthält ohnehin jede Person, nicht nur Problemfälle),
// nach Dringlichkeit sortiert. Kopfzeile zählt nur echten Handlungsbedarf
// (überzogen/Abgeltung fällig), "läuft" (aktiv, kann noch genommen werden)
// separat, "ok" nur als Referenz mitgezählt.
//
// "Bearbeiten" (Nutzer-Klarstellung 2026-09-17: "Mir ging es dabei eher um
// das gleichzeitige editieren aller Tage ... das war der Kern des Ganzen"):
// dasselbe Wochenraster wie bei Arbeitstage (components/TageRaster.tsx,
// dort extrahiert) - Fenster von der Woche des ersten bis zur Woche des
// letzten Eintrags im Saisonjahr, damit „U“ für mehrere Tage auf einmal
// gesetzt/entfernt werden kann statt einzeln in /erfassung.

import { Fragment, useEffect, useMemo, useState } from "react";
import { Palmtree } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import { urlaubGesamtstatus, type UrlaubGesamtstatus } from "@/lib/controlling";
import { montagDerWoche, sonntagDerWoche } from "@/lib/woche";
import type { EmployeeUrlaubstage } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";
import TageRaster from "@/components/TageRaster";

const CURRENT_YEAR = new Date().getFullYear();

// Sortier-Rang je Gesamtstatus - dringendster Fall zuerst, wie bei
// arbeitsserieGesamtstatus/RANG in app/management/arbeitstage/page.tsx.
const RANG: Record<UrlaubGesamtstatus, number> = {
  ueberzogen: 0,
  abgeltung_faellig: 0,
  laeuft: 1,
  ok: 2,
};

function statusBadge(status: UrlaubGesamtstatus) {
  switch (status) {
    case "ueberzogen":
      return <span className="badge badge-danger">⚠ überzogen</span>;
    case "abgeltung_faellig":
      return <span className="badge badge-danger">⚠ Abgeltung fällig</span>;
    case "laeuft":
      return <span className="badge badge-warn">Resturlaub offen</span>;
    case "ok":
      return <span className="badge badge-ok">✓ ok</span>;
  }
}

export default function ControllingUrlaubPage() {
  const { profile } = useProfile();
  // Muss zu work_entries_write/-update (RLS) passen - wie Stundenerfassung/
  // Arbeitstage.
  const canEditStunden =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [zeilen, setZeilen] = useState<EmployeeUrlaubstage[]>([]);
  const [loading, setLoading] = useState(true);

  // Aufgeklapptes Wochenraster (immer nur eines gleichzeitig) - der Rest
  // (Sperre/Entwurf/Speichern) steckt in components/TageRaster.tsx.
  const [offen, setOffen] = useState<EmployeeUrlaubstage | null>(null);
  const [offenDirty, setOffenDirty] = useState(false);

  async function laden() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("employee_urlaubstage")
      .select("*")
      .eq("saison_jahr", jahr)
      .order("name");
    if (!error) setZeilen((data as EmployeeUrlaubstage[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    laden();
    setOffen(null);
    setOffenDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  // Fenster fürs Wochenraster: Woche des ersten bis Woche des letzten
  // Eintrags im Saisonjahr - deckt den ganzen Beschäftigungszeitraum ab,
  // statt das ganze Kalenderjahr voller leerer Wochen zu zeigen.
  function rasterFenster(u: EmployeeUrlaubstage) {
    return {
      von: montagDerWoche(u.erster_eintrag),
      bis: sonntagDerWoche(u.letzter_eintrag),
    };
  }

  function waehleZeile(u: EmployeeUrlaubstage) {
    const istDieselbe = !!offen && offen.employee_id === u.employee_id;
    if (offen && offenDirty) {
      if (!window.confirm("Nicht gespeicherte Änderungen verwerfen?")) return;
    }
    setOffen(istDieselbe ? null : u);
    setOffenDirty(false);
  }

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

  const sortiert = useMemo(() => {
    return [...zeilen].sort((a, b) => {
      const rangA = RANG[urlaubGesamtstatus(a)];
      const rangB = RANG[urlaubGesamtstatus(b)];
      if (rangA !== rangB) return rangA - rangB;
      return `${a.name}, ${a.vorname}`.localeCompare(
        `${b.name}, ${b.vorname}`,
        "de"
      );
    });
  }, [zeilen]);

  const counts = useMemo(() => {
    let ueberzogen = 0;
    let abgeltungFaellig = 0;
    let laeuft = 0;
    let ok = 0;
    for (const z of zeilen) {
      switch (urlaubGesamtstatus(z)) {
        case "ueberzogen":
          ueberzogen += 1;
          break;
        case "abgeltung_faellig":
          abgeltungFaellig += 1;
          break;
        case "laeuft":
          laeuft += 1;
          break;
        case "ok":
          ok += 1;
          break;
      }
    }
    return { ueberzogen, abgeltungFaellig, laeuft, ok };
  }, [zeilen]);

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={Palmtree}
        titel="Urlaub"
        beschreibung="Anspruch: 2 Urlaubstage je vollem Kalendermonat der Beschäftigung (1. bis letzter Tag mit Stunden oder Markierung). Alle Personen des Saisonjahrs mit kombiniertem Status - überzogene „U“-Tage und offener Resturlaub (bei Inaktiven eine Abgeltungspflicht)."
      />

      <p className="text-sm text-neutral-600">
        {loading ? (
          "…"
        ) : (
          <>
            <span className="font-medium text-beere-600">
              {counts.ueberzogen + counts.abgeltungFaellig}
            </span>{" "}
            Handlungsbedarf ({counts.ueberzogen} überzogen ·{" "}
            {counts.abgeltungFaellig} Abgeltung fällig) ·{" "}
            <span className="font-medium text-amber-600">{counts.laeuft}</span>{" "}
            Resturlaub offen (läuft noch) ·{" "}
            <span className="font-medium text-emerald-700">{counts.ok}</span>{" "}
            ✓ ok
          </>
        )}
      </p>

      <label className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 block bg-sand py-2 text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : sortiert.length === 0 ? (
        <p className="text-neutral-500">Keine Daten für {jahr}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>1. Eintrag</th>
                <th>Letzter Eintrag</th>
                <th>Volle Kalendermonate</th>
                <th>Anspruch (Tage)</th>
                <th>Genommen („U“, Tage)</th>
                <th>Resturlaub/Überzogen</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortiert.map((u) => {
                const status = urlaubGesamtstatus(u);
                const istOffen = !!offen && offen.employee_id === u.employee_id;
                return (
                  <Fragment key={u.employee_id}>
                    <tr className={status === "ok" ? "opacity-70" : ""}>
                      <td>{u.personal_nr}</td>
                      <td>
                        {u.name}, {u.vorname}
                        {!u.aktiv && (
                          <span className="ml-1 text-xs text-neutral-500">
                            (inaktiv)
                          </span>
                        )}
                      </td>
                      <td>{formatDatumDE(u.erster_eintrag)}</td>
                      <td>{formatDatumDE(u.letzter_eintrag)}</td>
                      <td>{u.volle_kalendermonate}</td>
                      <td>{u.urlaubsanspruch_tage}</td>
                      <td>{u.u_tage}</td>
                      <td
                        className={
                          status === "ueberzogen" || status === "abgeltung_faellig"
                            ? "font-medium text-beere-600"
                            : status === "laeuft"
                              ? "text-amber-600"
                              : "text-neutral-500"
                        }
                      >
                        {u.ueberzogen
                          ? `⚠ ${u.u_tage - u.urlaubsanspruch_tage} Tag(e) zu viel`
                          : u.resturlaub_tage > 0
                            ? `${u.resturlaub_tage} Tag(e) offen`
                            : "—"}
                      </td>
                      <td>{statusBadge(status)}</td>
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => waehleZeile(u)}
                        >
                          {istOffen ? "Schließen" : "Bearbeiten"}
                        </button>
                      </td>
                    </tr>
                    {istOffen && (
                      <tr>
                        <td colSpan={9} className="bg-sand">
                          <TageRaster
                            employeeId={u.employee_id}
                            profileId={profile?.id ?? null}
                            von={rasterFenster(u).von}
                            bis={rasterFenster(u).bis}
                            saisonJahr={jahr}
                            canEdit={canEditStunden}
                            onDirtyChange={setOffenDirty}
                            onGespeichert={laden}
                            zusatzAktionen={
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => waehleZeile(u)}
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
