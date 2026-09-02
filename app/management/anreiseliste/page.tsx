"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import { offeneGruende } from "@/lib/controlling";
import type { AnreiselisteOffenArbeitend } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

export default function ControllingAnreiselistePage() {
  const [offenArbeitend, setOffenArbeitend] = useState<
    AnreiselisteOffenArbeitend[]
  >([]);
  const [loadingOffen, setLoadingOffen] = useState(true);

  useEffect(() => {
    async function ladeOffenArbeitend() {
      setLoadingOffen(true);
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("anreiseliste_offen_arbeitend")
        .select("*")
        .order("tage_seit_arbeitsbeginn", { ascending: false });
      // Nur Personen mit mindestens einem offenen Punkt - die Sicht liefert
      // bewusst alle Anreiselisten-Personen mit Stunden.
      setOffenArbeitend(
        ((data as AnreiselisteOffenArbeitend[]) ?? []).filter(
          (z) => offeneGruende(z).length > 0
        )
      );
      setLoadingOffen(false);
    }
    ladeOffenArbeitend();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={ClipboardList}
        titel="Anreiseliste – offener Status"
        beschreibung="Personen, die noch auf der Anreiseliste stehen (Arbeitsvertrag nicht gedruckt, SV-Fragebogen nicht bestanden, fehlende Unterlagen …), aber bereits Stunden in der Stundenerfassung haben. Saisonübergreifend, nicht nach Saison-Jahr gefiltert."
      />

      <p className="text-sm text-neutral-600">
        Personen, die arbeiten, obwohl noch etwas offen ist:{" "}
        <span className="font-medium text-amber-600">
          {loadingOffen ? "…" : offenArbeitend.length}
        </span>
      </p>

      {loadingOffen ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : offenArbeitend.length === 0 ? (
        <p className="text-neutral-500">
          Niemand arbeitet aktuell mit offenem Anreiselisten-Status.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Herkunft</th>
                <th>Grund für Status offen</th>
                <th title="Erster Arbeitstag dieser Personalnummer (nicht saisonübergreifend wie 'Aktiv seit' im Personalstamm) - hier geht es um die Dringlichkeit der fehlenden Anreiselisten-Punkte, nicht um die SV-Prüfung">
                  1. Arbeitstag
                </th>
                <th title="Tage seit dem ersten Arbeitstag - so lange arbeitet die Person schon, obwohl noch etwas offen ist">
                  Tage seit Status offen
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offenArbeitend.map((z) => {
                const gruende = offeneGruende(z);
                return (
                  <tr key={z.kandidat_id}>
                    <td>{z.personal_nr}</td>
                    <td>
                      {z.name}, {z.vorname}
                      {!z.aktiv && (
                        <span className="ml-1 text-xs text-neutral-500">
                          (inaktiv)
                        </span>
                      )}
                    </td>
                    <td>{z.herkunft ?? "—"}</td>
                    <td className="text-sm">{gruende.join(" + ")}</td>
                    <td>{formatDatumDE(z.erster_arbeitstag)}</td>
                    <td
                      className={
                        z.tage_seit_arbeitsbeginn >= 14
                          ? "font-medium text-red-600"
                          : "font-medium text-amber-600"
                      }
                    >
                      {z.tage_seit_arbeitsbeginn}
                    </td>
                    <td>
                      <Link
                        href="/personal-anreiseliste"
                        className="btn-secondary text-xs"
                      >
                        Zur Anreiseliste →
                      </Link>
                    </td>
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
