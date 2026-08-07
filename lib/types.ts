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
  // Schwarze Liste: dauerhaftes "nicht mehr erwünscht"-Flag, unabhängig vom
  // aktiv-Status. Nur admin/hr sehen diese Felder (siehe grant select in
  // schema.sql).
  schwarze_liste?: boolean;
  schwarze_liste_grund?: string | null;
  schwarze_liste_von?: string | null;
  schwarze_liste_am?: string | null;
  // Bei einem Statuswechsel (z.B. sozialversicherungsfrei ->
  // sozialversicherungspflichtig): Verweis auf die "Vorgänger"-Person
  // (alte Personalnummer), aus der diese Zeile entstanden ist.
  vorgaenger_employee_id?: string | null;
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

// Monats-Ansicht für den Monatsfilter auf der Lohnübersicht (Monats-
// abschluss-Kontrolle) - bewusst getrennt von SeasonSummaryRow: enthält
// KEINE Saison-Prämien (Akkord/Fahrer-Zulage/Erdbeer-/Spargel-Prämie), da
// diese nur einmal pro Saison erfasst werden, nicht pro Monat.
// basis_brutto = nur Stunden × Stundenlohn für den jeweiligen Monat.
export interface SeasonSummaryMonatRow {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  gruppe_nr: string | null;
  aktiv: boolean;
  saison_jahr: number;
  monat: number;
  gesamt_stunden: number;
  anwesenheitstage: number;
  // Letzter Tag im Monat mit Eintrag (Stunden oder Markierung) - für die
  // "möglicherweise unvollständig"-Warnung.
  letzter_eintrag: string;
  basis_brutto: number;
  abzug_verpflegung: number;
  abzug_wohnen: number;
}

// Monatsabschluss (periods-Tabelle): sperrt/entsperrt die Stundenerfassung
// für einen Saison-Monat. Wiederöffnen braucht einen Pflichtgrund (wie
// Storno/Vorschuss-Korrektur).
export interface Period {
  saison_jahr: number;
  monat: number;
  gesperrt: boolean;
  gesperrt_von: string | null;
  gesperrt_am: string | null;
  entsperrt_von: string | null;
  entsperrt_am: string | null;
  entsperrt_grund: string | null;
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

// Aus der schmalen, breit zugänglichen Sicht "profile_namen" - zeigt nur
// den Namen, nicht role/aktiv (profiles selbst lässt jeden nur die eigene
// Zeile lesen).
export interface ProfilName {
  id: string;
  full_name: string;
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
  mindestlohn: number | null;
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

// Personalplanung: eine Person VOR der Aktivierung (Anreise). Getrennt von
// Employee, damit Zu-/Absagen in der Planungsphase nicht ständig echte
// Mitarbeiter-Datensätze/Personalnummern verbrauchen - siehe Kommentar bei
// personal_kandidaten in schema.sql.
// 'anreiseliste' deckt sowohl "Offen" als auch "Vollständig" ab - das wird
// NICHT gespeichert, sondern live aus PersonalKandidatChecklisteRow
// berechnet (siehe dort), damit es nie veraltet/falsch stehen bleiben kann.
export type KandidatStatus = 'geplant' | 'anreiseliste' | 'storniert';

export interface PersonalKandidat {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  geburtsdatum: string | null;
  nationalitaet: string | null;
  herkunft: string | null;
  // Falls diese Person schon einmal hier war (eigene, ggf. inaktive
  // Employee-Zeile) - macht die Schwarze-Liste-Prüfung möglich.
  verknuepfter_employee_id: string | null;
  arbeitsbeginn_datum: string | null;
  arbeitsende_datum: string | null;
  stundenlohn: number | null;
  geplante_ankunft: string | null;
  // Selbstauskunft beim Anlegen - unabhängig von der hochgeladenen,
  // geprüften Kopie in employee_documents (siehe employee_fuehrerschein_
  // kategorien/FuehrerscheinEintrag).
  fuehrerschein_kategorien: string[] | null;
  status: KandidatStatus;
  storniert_grund: string | null;
  notiz: string | null;
  aktivierter_employee_id: string | null;
  // Ab hier: Felder für die Anreiseliste (erst relevant bei status =
  // 'anreiseliste').
  gedruckt: boolean;
  gedruckt_am: string | null;
  fragebogen_erfasst: boolean;
  verheiratet_laut_fragebogen: boolean | null;
  lohnsteuerabzug_antrag_gewuenscht: boolean;
  buskosten_erfasst: boolean;
  erstellt_von: string | null;
  erstellt_am: string;
  version: number;
}

// Aus der View personal_kandidaten_checkliste - live berechnete
// Vollständigkeits-Prüfung für die Anreiseliste (gemeinsam mit den
// gedruckt/fragebogen_erfasst/buskosten_erfasst-Feldern oben ergibt das die
// "Offen"/"Vollständig"-Anzeige, siehe VOLLSTAENDIG_HELFER in
// app/personal-anreiseliste/page.tsx).
export interface PersonalKandidatChecklisteRow {
  kandidat_id: string;
  employee_id: string | null;
  gedruckt: boolean;
  fragebogen_erfasst: boolean;
  buskosten_erfasst: boolean;
  ausweiskopie_vorhanden: boolean;
  fuehrerschein_erfuellt: boolean;
  hochzeitsurkunde_erfuellt: boolean;
  lohnsteuerabzug_erfuellt: boolean;
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
