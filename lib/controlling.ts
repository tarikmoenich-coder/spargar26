// Geteilte Helfer/Konstanten für den Controlling-Bereich - extrahiert
// 2026-09-02 aus der früheren Sammelseite app/management/page.tsx, damit die
// aufgeteilten Unterseiten (app/management/*) UND die Zähler-Leiste
// (components/ControllingTabs.tsx via lib/useControllingCounts.ts) dieselbe
// Logik nutzen.
import type {
  AnreiselisteOffenArbeitend,
  ArbeitstageSerie,
  EmployeeUrlaubstage,
  SeasonSummaryRow,
} from "@/lib/types";
import { formatEuro } from "@/lib/format";

// Maximale Arbeitsstunden pro Tag, ab deren Überschreitung eine Person im
// Stundenmonitoring auftaucht.
export const MAX_STUNDEN_PRO_TAG = 12;

// Felder, die nach dem Abrechnen ("Jetzt Abrechnen") noch von einem
// Schnappschuss abweichen können - mit Anzeige-Label und Formatierung, damit
// die Abweichung konkret benannt werden kann statt nur mit "⚠".
export const ABWEICHUNGS_FELDER: {
  key: keyof SeasonSummaryRow;
  label: string;
  eur: boolean;
}[] = [
  { key: "gesamt_stunden", label: "Stunden", eur: false },
  { key: "anwesenheitstage", label: "Anwesenheitstage", eur: false },
  { key: "praemien_summe", label: "Prämien", eur: true },
  {
    key: "stundenkonto_auszahlung_betrag",
    label: "Stundenkonto-Auszahlung",
    eur: true,
  },
  { key: "bruttolohn", label: "Bruttolohn", eur: true },
  { key: "abzug_verpflegung", label: "Verpflegung", eur: true },
  { key: "abzug_wohnen", label: "Unterkunft", eur: true },
  { key: "vorschuss_summe", label: "Vorschüsse", eur: true },
  { key: "bus_kosten", label: "Buskosten", eur: true },
  { key: "fahrer_kaution", label: "Fahrerkaution", eur: true },
  { key: "zimmer_kaution", label: "Zimmerkaution", eur: true },
  { key: "lohnsteuer_pauschal", label: "Lohnsteuer (pauschal)", eur: true },
  { key: "netto_extern", label: "Netto (extern)", eur: true },
  { key: "netto", label: "Netto", eur: true },
  { key: "auszahlungsbetrag", label: "Auszahlungsbetrag", eur: true },
];

export interface Abweichung {
  feld: string;
  alt: string;
  neu: string;
}

export function formatWert(v: unknown, eur: boolean): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return eur ? `${formatEuro(n)} €` : String(n);
}

// Vergleicht den eingefrorenen Schnappschuss mit dem aktuellen Live-Stand
// und liefert nur die tatsächlich geänderten Felder (Rundungsdifferenzen
// < 0,005 zählen nicht als Änderung).
export function findeAbweichungen(r: SeasonSummaryRow): Abweichung[] {
  if (!r.snapshot) return [];
  const treffer: Abweichung[] = [];
  for (const f of ABWEICHUNGS_FELDER) {
    if (!(f.key in r.snapshot)) continue;
    const altWert = r.snapshot[f.key];
    const neuWert = r[f.key] as number | string | null;
    const altNum = altWert === null ? NaN : Number(altWert);
    const neuNum = neuWert === null ? NaN : Number(neuWert);
    const beideZahlen = !Number.isNaN(altNum) && !Number.isNaN(neuNum);
    const geaendert = beideZahlen
      ? Math.abs(altNum - neuNum) > 0.005
      : altWert !== neuWert;
    if (geaendert) {
      treffer.push({
        feld: f.label,
        alt: formatWert(altWert, f.eur),
        neu: formatWert(neuWert, f.eur),
      });
    }
  }
  return treffer;
}

// Klartext-Gründe, warum der Anreiselisten-Status dieser Person noch offen
// ist. Reihenfolge nach Dringlichkeit: fehlender Arbeitsvertrag und ein
// nicht bestandener SV-Fragebogen wiegen am schwersten.
export function offeneGruende(z: AnreiselisteOffenArbeitend): string[] {
  return [
    z.arbeitsvertrag_fehlt ? "Arbeitsvertrag nicht gedruckt" : null,
    z.sv_fragebogen_offen ? "SV-Fragebogen nicht bestanden" : null,
    z.ausweiskopie_fehlt ? "Ausweiskopie fehlt" : null,
    z.fuehrerschein_fehlt ? "Führerschein-Kopie fehlt" : null,
    z.hochzeitsurkunde_fehlt ? "Hochzeitsurkunde fehlt" : null,
    z.dhh_angaben_fehlen ? "Angaben Doppelte Haushaltsführung fehlen" : null,
    z.buskosten_fehlen ? "Buskosten nicht erfasst" : null,
  ].filter((g): g is string => g !== null);
}

// Nutzer-Vorgabe 2026-08-21: im Stundenmonitoring direkt bearbeitbar statt
// nur ein Link zur Stundenerfassung - braucht deshalb id/version für die
// optimistische Sperre, nicht nur datum/stunden.
export interface UeberstundenTag {
  id: number;
  datum: string;
  stunden: number;
  version: number;
  markierung: string | null;
  notiz: string | null;
}

export interface UeberstundenEintrag {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  tage: UeberstundenTag[];
}

// "Arbeitstage am Stück": ab wann ein Serieneintrag im Block angezeigt wird -
// läuft noch, Ersatzausgleich-Frist offen/verstrichen/nicht heilbar, oder
// kürzlich (Fenster unten) beendet. Ältere abgeschlossene 7-13-Tage-Serien
// überschwemmten sonst den Block.
export function serieCutoffISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 120);
  return d.toISOString().slice(0, 10);
}

export function arbeitsserieRelevant(
  s: ArbeitstageSerie,
  cutoffISO: string
): boolean {
  return (
    s.laeuft_noch ||
    s.ersatzausgleich === "offen" ||
    s.ersatzausgleich === "fehlt" ||
    s.ersatzausgleich === "kein_ausgleich" ||
    s.serie_bis >= cutoffISO
  );
}

// Gesamtstatus einer Serie fürs Controlling (Nutzer-Feedback 2026-09-14:
// "bleiben die Serien jedoch rot markiert stehen, selbst wenn der
// Ersatzausgleich erfolgt ist" - "ampel" allein sagt nur, wie LANG die
// Serie war, nicht ob noch Handlungsbedarf besteht):
// - "laeuft"          Serie ist noch nicht beendet - Ampel-Farbe zeigt Schwere.
// - "erledigt"        beendet UND Ersatzausgleich erfüllt -> kein Handlungsbedarf.
// - "ausgleich_offen" beendet, Ausgleichsfrist läuft noch - noch kein Verstoß.
// - "verstoss"        beendet, Ausgleich fehlt oder nicht mehr möglich.
export type ArbeitstageGesamtstatus =
  | "laeuft"
  | "erledigt"
  | "ausgleich_offen"
  | "verstoss";

export function arbeitsserieGesamtstatus(
  s: ArbeitstageSerie
): ArbeitstageGesamtstatus {
  if (s.laeuft_noch) return "laeuft";
  if (s.ersatzausgleich === "fehlt" || s.ersatzausgleich === "kein_ausgleich")
    return "verstoss";
  if (s.ersatzausgleich === "offen") return "ausgleich_offen";
  // "erfuellt" oder (sollte bei serie_tage>=7 nicht mehr vorkommen) null.
  return "erledigt";
}

// Gesamtstatus je Person/Saisonjahr fürs Urlaubs-Controlling (Nutzer-Vorgabe
// 2026-09-16: "einen ähnlichen Aufbau wie beim Arbeitstage am Stück
// Monitoring") - derselbe Gedanke wie arbeitsserieGesamtstatus oben: EIN
// kombinierter Status statt mehrerer Einzel-Flags/Tabellen.
// - "ok"                genommen entspricht dem Anspruch.
// - "laeuft"             aktiv, Resturlaub offen - kann noch genommen
//                        werden, (noch) kein Verstoß.
// - "abgeltung_faellig"  inaktiv, Resturlaub offen - muss ausgezahlt werden.
// - "ueberzogen"         mehr „U"-Tage erfasst als der Anspruch hergibt.
export type UrlaubGesamtstatus =
  | "ok"
  | "laeuft"
  | "abgeltung_faellig"
  | "ueberzogen";

export function urlaubGesamtstatus(u: EmployeeUrlaubstage): UrlaubGesamtstatus {
  if (u.ueberzogen) return "ueberzogen";
  if (u.zu_wenig_genommen) return u.aktiv ? "laeuft" : "abgeltung_faellig";
  return "ok";
}
