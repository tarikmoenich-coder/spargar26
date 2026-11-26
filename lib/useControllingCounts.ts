// To-Do-Zähler für die Controlling-Reiter-Leiste (components/ControllingTabs)
// und die Übersichts-Kacheln (app/management/page.tsx). SV, Stunden,
// Abweichungen und Urlaub für das laufende Kalenderjahr; Anreiseliste und
// Arbeitstage am Stück jahresunabhängig (aktueller Stand) - die Unterseiten
// haben einen eigenen Saison-Jahr-Wähler für die genaue Auswertung.
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import {
  MAX_STUNDEN_PRO_TAG,
  arbeitsserieGesamtstatus,
  findeAbweichungen,
  offeneGruende,
} from "@/lib/controlling";
import type {
  AnreiselisteOffenArbeitend,
  ArbeitstageSerie,
  SeasonSummaryRow,
} from "@/lib/types";

export interface ControllingCounts {
  anreiseliste: number;
  sv: number;
  stunden: number;
  serie: number;
  abweichungen: number;
  urlaub: number;
  loading: boolean;
  // Fehlermeldung, falls eine der Zähl-Abfragen gescheitert ist (sonst
  // stünde dort eine irreführende grüne 0).
  fehler: string | null;
}

const LEER: ControllingCounts = {
  anreiseliste: 0,
  sv: 0,
  stunden: 0,
  serie: 0,
  abweichungen: 0,
  urlaub: 0,
  loading: true,
  fehler: null,
};

// Übersichtsseite und Reiterleiste rufen den Hook gleichzeitig auf - eine
// laufende/gerade fertige Abfrage wird für ein paar Sekunden geteilt statt
// alle Abfragen doppelt zu schicken.
const TEILEN_MS = 5000;
let geteilt: { zeit: number; promise: Promise<ControllingCounts> } | null = null;

async function zaehlerLaden(): Promise<ControllingCounts> {
  const supabase = getSupabaseClient();
  const jahr = new Date().getFullYear();
  const fehler: string[] = [];
  const merke = (e: { message: string } | null) => {
    if (e) fehler.push(e.message);
  };

  const [anreiseRes, svRes, stundenRes, serie, abwRows, urlaubRes] =
    await Promise.all([
      supabase.from("anreiseliste_offen_arbeitend").select("*"),
      supabase
        .from("employee_sv_pruefung")
        .select("employee_id", { count: "exact", head: true })
        .eq("saison_jahr", jahr)
        .eq("kritisch", true),
      supabase
        .from("work_entries")
        .select("id", { count: "exact", head: true })
        .gt("stunden", MAX_STUNDEN_PRO_TAG)
        .gte("datum", `${jahr}-01-01`)
        .lte("datum", `${jahr}-12-31`),
      // Seitenweise (1000-Zeilen-Grenze), Fehler mitschneiden.
      ladeAlleSeiten<ArbeitstageSerie>((von, bis) =>
        supabase
          .from("arbeitstage_serie_uebersicht")
          .select("*")
          .order("employee_id")
          .order("serie_von")
          .range(von, bis)
          .then((r) => {
            merke(r.error);
            return r;
          })
      ),
      ladeAlleSeiten<SeasonSummaryRow>((von, bis) =>
        supabase
          .from("season_summary")
          .select("*")
          .eq("saison_jahr", jahr)
          .not("snapshot", "is", null)
          .order("employee_id")
          .range(von, bis)
          .then((r) => {
            merke(r.error);
            return r;
          })
      ),
      // Wie die Kopfzeile der Urlaubs-Seite: Handlungsbedarf = überzogen
      // ODER Abgeltung fällig (inaktiv mit Resturlaub). Aktive mit offenem
      // Resturlaub ("läuft") zählen nicht.
      supabase
        .from("employee_urlaubstage")
        .select("employee_id", { count: "exact", head: true })
        .eq("saison_jahr", jahr)
        .or("ueberzogen.eq.true,and(zu_wenig_genommen.eq.true,aktiv.eq.false)"),
    ]);
  merke(anreiseRes.error);
  merke(svRes.error);
  merke(stundenRes.error);
  merke(urlaubRes.error);

  const anreiseliste = (
    (anreiseRes.data as AnreiselisteOffenArbeitend[]) ?? []
  ).filter((z) => offeneGruende(z).length > 0).length;

  // Nur was wirklich noch Handlungsbedarf hat (Nutzer-Feedback
  // 2026-09-14: erledigte, per Ersatzausgleich erfüllte Serien sollen
  // nicht dauerhaft mitgezählt werden).
  const serieOffen = serie.filter(
    (s) => arbeitsserieGesamtstatus(s) !== "erledigt"
  ).length;

  const abweichungen = abwRows.filter(
    (r) => findeAbweichungen(r).length > 0
  ).length;

  return {
    anreiseliste,
    sv: svRes.count ?? 0,
    stunden: stundenRes.count ?? 0,
    serie: serieOffen,
    abweichungen,
    urlaub: urlaubRes.count ?? 0,
    loading: false,
    fehler: fehler.length > 0 ? fehler.join(" · ") : null,
  };
}

// aktiv=false: nichts laden (Startseite für Rollen ohne Controlling).
export function useControllingCounts(aktiv = true): ControllingCounts {
  const [counts, setCounts] = useState<ControllingCounts>(LEER);

  useEffect(() => {
    if (!aktiv) {
      setCounts({ ...LEER, loading: false });
      return;
    }
    setCounts((c) => (c.loading ? c : LEER));
    let abgebrochen = false;
    if (!geteilt || Date.now() - geteilt.zeit > TEILEN_MS) {
      geteilt = { zeit: Date.now(), promise: zaehlerLaden() };
    }
    geteilt.promise.then((c) => {
      if (!abgebrochen) setCounts(c);
    });
    return () => {
      abgebrochen = true;
    };
  }, [aktiv]);

  return counts;
}
