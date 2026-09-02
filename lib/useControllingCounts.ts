// To-Do-Zähler für die Controlling-Reiter-Leiste (components/ControllingTabs)
// und die Übersichts-Kacheln (app/management/page.tsx). Alle Zahlen für das
// laufende Kalenderjahr - die Unterseiten selbst haben einen eigenen
// Saison-Jahr-Wähler für die genaue Auswertung.
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  MAX_STUNDEN_PRO_TAG,
  arbeitsserieRelevant,
  findeAbweichungen,
  offeneGruende,
  serieCutoffISO,
} from "@/lib/controlling";
import type {
  AnreiselisteOffenArbeitend,
  ArbeitstageSerie,
  SeasonSummaryRow,
  SvPruefung,
} from "@/lib/types";

export interface ControllingCounts {
  anreiseliste: number;
  sv: number;
  stunden: number;
  serie: number;
  abweichungen: number;
  urlaub: number;
  loading: boolean;
}

const LEER: ControllingCounts = {
  anreiseliste: 0,
  sv: 0,
  stunden: 0,
  serie: 0,
  abweichungen: 0,
  urlaub: 0,
  loading: true,
};

export function useControllingCounts(): ControllingCounts {
  const [counts, setCounts] = useState<ControllingCounts>(LEER);

  useEffect(() => {
    let abgebrochen = false;
    async function laden() {
      const supabase = getSupabaseClient();
      const jahr = new Date().getFullYear();
      const [
        anreiseRes,
        svRes,
        stundenRes,
        serieRes,
        abwRes,
        urlaubRes,
      ] = await Promise.all([
        supabase.from("anreiseliste_offen_arbeitend").select("*"),
        supabase
          .from("employee_sv_pruefung")
          .select("kritisch")
          .eq("saison_jahr", jahr),
        supabase
          .from("work_entries")
          .select("id", { count: "exact", head: true })
          .gt("stunden", MAX_STUNDEN_PRO_TAG)
          .gte("datum", `${jahr}-01-01`)
          .lte("datum", `${jahr}-12-31`),
        supabase.from("arbeitstage_serie_uebersicht").select("*"),
        supabase
          .from("season_summary")
          .select("*")
          .eq("saison_jahr", jahr)
          .not("snapshot", "is", null),
        supabase
          .from("employee_urlaubstage")
          .select("employee_id", { count: "exact", head: true })
          .eq("saison_jahr", jahr)
          .or("ueberzogen.eq.true,zu_wenig_genommen.eq.true"),
      ]);

      if (abgebrochen) return;

      const anreiseliste = (
        (anreiseRes.data as AnreiselisteOffenArbeitend[]) ?? []
      ).filter((z) => offeneGruende(z).length > 0).length;

      const sv = ((svRes.data as Pick<SvPruefung, "kritisch">[]) ?? []).filter(
        (f) => f.kritisch
      ).length;

      const cutoff = serieCutoffISO();
      const serie = ((serieRes.data as ArbeitstageSerie[]) ?? []).filter((s) =>
        arbeitsserieRelevant(s, cutoff)
      ).length;

      const abweichungen = ((abwRes.data as SeasonSummaryRow[]) ?? []).filter(
        (r) => findeAbweichungen(r).length > 0
      ).length;

      setCounts({
        anreiseliste,
        sv,
        stunden: stundenRes.count ?? 0,
        serie,
        abweichungen,
        urlaub: urlaubRes.count ?? 0,
        loading: false,
      });
    }
    laden();
    return () => {
      abgebrochen = true;
    };
  }, []);

  return counts;
}
