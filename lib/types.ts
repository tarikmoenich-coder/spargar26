// Zentrale Typdefinitionen für die Spargar-App.
// Spiegeln das Supabase-Schema aus supabase/schema.sql.

export type UserRole =
  | 'admin'
  | 'hr'
  | 'zeiterfassung'
  | 'kasse'
  | 'lohnabrechnung'
  | 'pruefer'
  | 'management';

export type Abrechnungsart =
  | 'pauschal'
  | 'lohnsteuerklasse_1'
  | 'sozialversicherungspflichtig';

export const ABRECHNUNGSART_LABELS: Record<Abrechnungsart, string> = {
  pauschal: 'Pauschal',
  lohnsteuerklasse_1: 'Lohnsteuerklasse 1',
  sozialversicherungspflichtig: 'Sozialversicherungspflichtig',
};

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  aktiv: boolean;
}

// Feste Kategorie-Liste für Mitarbeiter-Dokumente (Nutzer-Vorgabe) - muss
// synchron mit dem CHECK-Constraint in supabase/schema.sql gehalten werden.
export const DOKUMENT_KATEGORIEN = [
  'Hochzeitsurkunde',
  'Ausweiskopie',
  'Führerschein Kopie',
  'Arbeitsvertrag',
  'Werks- und Mietvertrag',
  'Formular "Doppelte Haushaltsführung"',
  'Formular zur Feststellung der Versicherungspflicht',
  'Sonstiges',
] as const;

export type DokumentKategorie = (typeof DOKUMENT_KATEGORIEN)[number];

// Führerschein-Klassen - nur relevant bei kategorie "Führerschein Kopie".
export const FUEHRERSCHEIN_KATEGORIEN = ['B', 'BE', 'C', 'CE'] as const;
export type FuehrerscheinKategorie = (typeof FUEHRERSCHEIN_KATEGORIEN)[number];

// Verweis auf eine im Storage-Bucket "mitarbeiter-dokumente" abgelegte
// Datei (z.B. Hochzeitsurkunde, Ausweiskopie) - Zugriff nur admin/hr.
export interface EmployeeDocument {
  id: number;
  employee_id: string;
  kategorie: string;
  dateiname: string;
  storage_path: string;
  hochgeladen_von: string | null;
  hochgeladen_am: string;
  fuehrerschein_kategorien: string[] | null;
}

// Schmale, breit zugängliche Sicht (employee_fuehrerschein_kategorien) -
// zeigt nur, DASS und WOFÜR jemand einen Führerschein hat, nicht das
// Dokument selbst (das bleibt admin/hr-only).
export interface FuehrerscheinEintrag {
  employee_id: string;
  fuehrerschein_kategorien: string[];
  hochgeladen_am: string;
}

export interface Employee {
  id: string;
  personal_nr: string;
  gruppe_nr: string | null;
  herkunft: string | null;
  nationalitaet: string | null;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  ort: string | null;
  land: string | null;
  sozialversicherungsnummer?: string | null;
  steuer_id?: string | null;
  iban?: string | null;
  bic?: string | null;
  zahlungsempfaenger?: string | null;
  stundenlohn: number | null;
  abrechnungsart: Abrechnungsart;
  saison_beginn: string | null;
  saison_ende: string | null;
  aktiv: boolean;
  version?: number;
}

// 90-Tage-/15-Wochen-Prüfung (SV-Freiheit landwirtschaftliche Saisonarbeit,
// OI-004). Reine Tage-/Wochen-Zählung - ersetzt nicht die rechtliche Prüfung
// selbst (eigenes Formular nötig).
export interface SvPruefung {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  abrechnungsart: Abrechnungsart;
  aktiv: boolean;
  saison_jahr: number;
  erster_arbeitstag: string;
  letzter_arbeitstag: string;
  arbeitstage_ueber0: number;
  rest_bis_90_tage: number;
  austrittsdatum_15_wochen: string;
  wochen_seit_start: number;
  ueberschritten_90_tage: boolean;
  ueberschritten_15_wochen: boolean;
  kritisch: boolean;
}

export interface WorkEntry {
  id: number;
  employee_id: string;
  datum: string;
  stunden: number | null;
  markierung: string | null;
  notiz: string | null;
  version: number;
}

export interface SeasonSummaryRow {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  gruppe_nr: string | null;
  abrechnungsart: Abrechnungsart;
  aktiv: boolean;
  abgerechnet_am: string | null;
  // Eingefrorener Stand von season_summary zum Zeitpunkt des Abrechnens
  // (dieselben Feldnamen wie diese Zeile selbst) - null, solange nicht
  // abgerechnet.
  snapshot: Record<string, number | string | null> | null;
  saison_jahr: number;
  gesamt_stunden: number;
  anwesenheitstage: number;
  praemien_summe: number;
  basis_brutto: number;
  bruttolohn: number;
  abzug_verpflegung: number;
  abzug_wohnen: number;
  vorschuss_summe: number;
  // Vorfinanzierte Heimreise (bus_hin + bus_rueck aus season_bonuses) -
  // wird wie ein Vorschuss abgezogen, aber separat ausgewiesen.
  bus_kosten: number;
  // Kautionen bei bevorstehender Abreise, ebenfalls wie ein Vorschuss
  // abgezogen, aber separat ausgewiesen. Rückzahlung nach Kontrolle läuft
  // außerhalb der App (bar).
  fahrer_kaution: number;
  zimmer_kaution: number;
  auszahlungsbeleg_id: number | null;
  lohnsteuer_pauschal: number;
  // Nur bei abrechnungsart 'lohnsteuerklasse_1'/'sozialversicherungspflichtig'
  // - von Hand eingetragener Netto-Betrag aus dem externen Lohnprogramm
  // (entspricht Sheet "Summen", Spalte BA "Netto-Summe (HSC)").
  netto_extern: number | null;
  // netto = Bruttolohn - Lohnsteuer (bei 'pauschal') bzw. = netto_extern.
  // auszahlungsbetrag = netto - Verpflegung - Unterkunft - Vorschüsse.
  // Beide NULL, solange netto_extern bei nicht-pauschalen Fällen fehlt.
  netto: number | null;
  auszahlungsbetrag: number | null;
}

export interface AuszahlungsbelegSummary {
  id: number;
  belegnummer: string;
  saison_jahr: number;
  zahlungsart: string;
  erstellt_am: string;
  erstellt_von: string | null;
  anzahl_personen: number;
  summe_auszahlungsbetrag: number | null;
  weicht_ab: boolean;
}

// Log-Eintrag für eine nachträgliche Korrektur eines bestätigten
// Vorschuss-Betrags (wer/wann/Differenz/Grund) - beeinflusst den
// Kassenbestand, da advances.betrag live in die Saldo-Berechnung einfließt.
export interface Kassenbewegung {
  id: number;
  zeitstempel: string;
  art: string;
  belegnummer: string;
  delta: number;
  zahlungsart: string | null;
  bearbeiter_id: string | null;
  hinweis: string | null;
}

// Ein Vorschuss-Eintrag für die "Suche"-Seite (schmale, breit zugängliche
// Sicht - kein Bearbeiter/keine Belegnummer wie in der vollen
// advances-Tabelle, Begründung aber bewusst mit dabei).
export interface VorschussHistorieEintrag {
  employee_id: string;
  datum: string;
  betrag: number;
  zahlungsart: string;
  begruendung: string | null;
  storniert: boolean;
}

export interface VerpflegungsSatz {
  saison_jahr: number;
  verpflegung: number;
  wohnen: number;
}

export interface Arbeitsgruppe {
  gruppe_nr: string;
  bezeichnung: string;
  reihenfolge: number;
}

export interface Herkunft {
  wert: string;
  reihenfolge: number;
}

export interface Advance {
  id: number;
  belegnummer: string;
  datum: string;
  datum_kassenbuch: string;
  betrag: number;
  empfaenger_text: string | null;
  begruendung: string | null;
  // Person (z.B. Gruppenleiter), der das Geld zur Verteilung übergeben
  // wird - erscheint auf dem separaten Übergabe-Beleg beim Drucken.
  uebergeben_an: string | null;
  zahlungsart: string;
  storniert: boolean;
  storno_grund: string | null;
}

// Ein Empfänger innerhalb eines Vorschusses, mit seinem individuellen Anteil
// (für die Auszahlungsliste zum Ausdrucken).
export interface AdvanceRecipientDetail {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  anteil: number;
}

export interface CashDeposit {
  id: number;
  belegnummer: string;
  datum: string;
  datum_kassenbuch: string;
  betrag: number;
  verwendungszweck: string | null;
  storniert: boolean;
}
