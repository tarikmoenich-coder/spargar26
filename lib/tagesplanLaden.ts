// Lädt alles, was für Tagespläne in einem Datumsbereich gebraucht wird
// (Wochenansicht /vertrieb/woche und Ausdrucke /vertrieb/druck/*).
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FuehrerscheinEintrag,
  VtAbwesenheit,
  VtDruck,
  VtFeiertag,
  VtGrundplan,
  VtStand,
  VtStandZeit,
  VtTagAenderung,
  VtTour,
  VtTourStand,
  VtTourTag,
  VtVerfuegbarkeit,
  VtVerkaeuferSaison,
} from "@/lib/types";
import { ladeAlleMitFehler, ladeAlleSeiten } from "@/lib/ladeAlle";
import type { Fahrzeug } from "@/lib/tagesplan";

export type VtPerson = {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  fuehrerschein_b: boolean | null;
  geschlecht: "M" | "F" | null;
};

export interface TagesplanDaten {
  personen: VtPerson[];
  fsDoku: FuehrerscheinEintrag[];
  planung: VtVerkaeuferSaison[];
  verf: VtVerfuegbarkeit[];
  staende: VtStand[];
  zeiten: VtStandZeit[];
  touren: VtTour[];
  tourStaende: VtTourStand[];
  grundplan: VtGrundplan[];
  feiertage: VtFeiertag[];
  aenderungen: VtTagAenderung[];
  tourTage: VtTourTag[];
  abwesenheiten: VtAbwesenheit[];
  fahrzeuge: Fahrzeug[];
  drucke: VtDruck[];
  fehler: string | null;
}

// von/bis = "YYYY-MM-DD" (inklusive). Saison = Kalenderjahr der Daten.
export async function tagesplanDatenLaden(sb: SupabaseClient, von: string, bis: string): Promise<TagesplanDaten> {
  const jahre = [...new Set([Number(von.slice(0, 4)), Number(bis.slice(0, 4))])];
  const [p, fs, pl, v, s, z, t, ts, g, fe, ae, tt, ab, fz, dr] = await Promise.all([
    ladeAlleSeiten<VtPerson>((a, b) =>
      sb.from("employees").select("id, personal_nr, name, vorname, fuehrerschein_b, geschlecht").eq("bereich", "VT").order("id").range(a, b)
    ),
    ladeAlleSeiten<FuehrerscheinEintrag>((a, b) => sb.from("employee_fuehrerschein_kategorien").select("*").order("employee_id").range(a, b)),
    sb.from("vt_verkaeufer_saison").select("*").in("saison_jahr", jahre),
    ladeAlleMitFehler<VtVerfuegbarkeit>((a, b) => sb.from("vt_verfuegbarkeit").select("*").in("saison_jahr", jahre).order("id").range(a, b)),
    sb.from("vt_stand").select("*").order("nummer"),
    ladeAlleMitFehler<VtStandZeit>((a, b) => sb.from("vt_stand_zeit").select("*").order("id").range(a, b)),
    sb.from("vt_tour").select("*").order("nummer"),
    sb.from("vt_tour_stand").select("*"),
    ladeAlleMitFehler<VtGrundplan>((a, b) => sb.from("vt_grundplan").select("*").in("saison_jahr", jahre).order("id").range(a, b)),
    sb.from("vt_feiertag").select("*").gte("datum", `${jahre[0]}-01-01`).lte("datum", `${jahre[jahre.length - 1]}-12-31`).order("datum"),
    ladeAlleMitFehler<VtTagAenderung>((a, b) => sb.from("vt_tag_aenderung").select("*").gte("datum", von).lte("datum", bis).order("id").range(a, b)),
    sb.from("vt_tour_tag").select("*").gte("datum", von).lte("datum", bis),
    sb.from("vt_abwesenheit").select("*").lte("von", bis).gte("bis", von),
    // Fahrzeuge dürfen nur admin/hr/management lesen - für andere bleibt das Kennzeichen leer
    sb.from("fahrzeug").select("id, kennzeichen, bezeichnung").order("bezeichnung"),
    sb.from("vt_druck").select("*").gte("datum", von).lte("datum", bis).order("gedruckt_am", { ascending: false }),
  ]);
  const err = pl.error ?? v.error ?? s.error ?? z.error ?? t.error ?? ts.error ?? g.error ?? fe.error ?? ae.error ?? tt.error ?? ab.error ?? dr.error;
  return {
    personen: p,
    fsDoku: fs,
    planung: (pl.data as VtVerkaeuferSaison[]) ?? [],
    verf: (v.data as VtVerfuegbarkeit[]) ?? [],
    staende: (s.data as VtStand[]) ?? [],
    zeiten: (z.data as VtStandZeit[]) ?? [],
    touren: (t.data as VtTour[]) ?? [],
    tourStaende: (ts.data as VtTourStand[]) ?? [],
    grundplan: (g.data as VtGrundplan[]) ?? [],
    feiertage: (fe.data as VtFeiertag[]) ?? [],
    aenderungen: (ae.data as VtTagAenderung[]) ?? [],
    tourTage: (tt.data as VtTourTag[]) ?? [],
    abwesenheiten: (ab.data as VtAbwesenheit[]) ?? [],
    fahrzeuge: fz.error ? [] : ((fz.data as Fahrzeug[]) ?? []),
    drucke: (dr.data as VtDruck[]) ?? [],
    fehler: err ? err.message : null,
  };
}

// Grundplan/Verkäufer der Saison eines Datums
export function saisonVon(datum: string): number {
  return Number(datum.slice(0, 4));
}
