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

import { useEffect, useMemo, useState } from "react";
import { Palmtree } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import { urlaubGesamtstatus, type UrlaubGesamtstatus } from "@/lib/controlling";
import type { EmployeeUrlaubstage } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

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
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [zeilen, setZeilen] = useState<EmployeeUrlaubstage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    laden();
  }, [jahr]);

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
            <span className="font-medium text-red-600">
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
              </tr>
            </thead>
            <tbody>
              {sortiert.map((u) => {
                const status = urlaubGesamtstatus(u);
                return (
                  <tr
                    key={u.employee_id}
                    className={status === "ok" ? "opacity-70" : ""}
                  >
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
                          ? "font-medium text-red-600"
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
