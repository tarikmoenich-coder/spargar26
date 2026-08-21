// Zentrale Typdefinitionen für die Spargar-App.
// Spiegeln das Supabase-Schema aus supabase/schema.sql.

export type UserRole =
  | 'admin'
  | 'hr'
  | 'zeiterfassung'
  | 'kasse'
  | 'lohnabrechnung'
  | 'pruefer'
  | 'management'
  // Nur Zugriff auf Prämien (Erfassung) und Statistik, sonst nichts
  // (Nutzer-Vorgabe 2026-08-09).
  | 'erntewirtschaft';

export type Abrechnungsart =
  | 'pauschal'
  | 'lohnsteuerklasse_1'
  | 'sozialversicherungspflichtig';

// Kurzform wie im Altsystem (Nutzer-Vorgabe 2026-08-06) - wirkt sich
// automatisch überall aus, wo diese Labels genutzt werden (Auswahl-Listen,
// Tabellen). Der interne Wert (Abrechnungsart) bleibt unverändert, nur die
// Anzeige wird kürzer.
export const ABRECHNUNGSART_LABELS: Record<Abrechnungsart, string> = {
  pauschal: 'PA',
  lohnsteuerklasse_1: 'StKl 1',
  sozialversicherungspflichtig: 'SV-Pfl.',
};

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  aktiv: boolean;
  // UI-Sprache je Nutzer (nicht je Rolle) - siehe lib/i18n.ts. Betrifft
  // nur die Bedienoberfläche, keine Dokumente/Formulare.
  sprache: "de" | "hr";
}

// Feste Kategorie-Liste für Mitarbeiter-Dokumente (Nutzer-Vorgabe) - muss
// synchron mit dem CHECK-Constraint in supabase/schema.sql gehalten werden.
export const DOKUMENT_KATEGORIEN = [
  'Hochzeitsurkunde',
  'Ausweiskopie',
  'Führerschein Kopie',
  'Arbeitsvertrag',
  'Werks- und Mietvertrag',
  'Sonstiges',
] as const;
// Entfernt 2026-08-11 (Nutzer-Vorgabe): Formular "Doppelte
// Haushaltsführung" und Formular zur Feststellung der Versicherungspflicht
// werden NICHT mehr als Datei hochgeladen. Beide werden ausschließlich über
// die jeweilige Eingabemaske erfasst (Personal → Lohnsteuer bzw.
// Sozialversicherung) - die erfassten Angaben sind der Nachweis, nicht der
// Scan. Die Anreiseliste-Checkliste prüft entsprechend die Angaben statt
// eines Dokuments.

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
  // Zugehörigkeit zu den Prämien-Erfassungen (Nutzer-Vorgabe 2026-08-09) -
  // unabhängig von gruppe_nr, gepflegt über "Prämien → Gruppenaufteilung".
  praemien_zuckermais: boolean;
  praemien_erdbeeren: boolean;
  praemien_spargel: boolean;
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

// Eintrag der Abschnitts-Historie (saison_abrechnungen) - jeder Eintrag
// setzt die 105-Tage-Uhr der SV-Prüfung zurück. auszahlungsbeleg_id
// gesetzt = echte "Jetzt Abrechnen"-Aktion in der App, NULL = manuell
// nachgetragener historischer Abschnitt (Nutzer-Vorgabe 2026-08-13, siehe
// saison_abrechnung_nachtragen in schema.sql).
export interface SaisonAbrechnung {
  id: number;
  employee_id: string;
  saison_jahr: number;
  abgerechnet_am: string;
  abgerechnet_von: string | null;
  auszahlungsbeleg_id: number | null;
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
  // Summe der Kalendertage ALLER Beschäftigungsabschnitte dieses
  // Kalenderjahres - nicht die Spanne vom ersten bis zum letzten Tag
  // (Nutzer-Recherche 2026-08-11: die 15 Wochen müssen nicht am Stück
  // laufen, alle kurzfristigen Beschäftigungen eines Kalenderjahres werden
  // zusammengerechnet). Ein Abschnitt endet mit einer Abrechnung, siehe
  // employee_sv_pruefung in schema.sql.
  beschaeftigungstage: number;
  // Anzahl der getrennten Beschäftigungsabschnitte (1 = durchgehend).
  anzahl_abschnitte: number;
  // Bisherige Beschäftigungstage in Deutschland laut SV-Fragebogen (bei
  // anderen Arbeitgebern, dieses Kalenderjahr) - rechtlich zählt das
  // Kalenderjahr über ALLE deutschen Arbeitgeber zusammen.
  vorbeschaeftigung_deutschland_tage: number;
  kombinierte_tage: number;
  rest_bis_105_tage: number;
  ueberschritten_105_tage: boolean;
  // Letzter Tag, an dem die Person nach der 15-Wochen-Regel (105
  // Kalendertage) noch SV-frei beschäftigt sein darf.
  austrittsdatum_105_tage: string;
  // Das frühere von austrittsdatum_105_tage und dem Ende des SV-freien
  // Zeitraums laut Angaben.
  austrittsdatum_empfohlen: string | null;
  kritisch: boolean;
  // Sozialversicherungsfreier Zeitraum laut SV-Fragebogen-Angaben
  // (Nutzer-Vorgabe 2026-08-10) - siehe ausführlichen Kommentar in
  // schema.sql bei den sv_freier_zeitraum_*-Funktionen. sv_frei_bis ist
  // null bei offenen Zeiträumen (Rente/Hausmann/Selbstständigkeit).
  sv_frei_von: string | null;
  sv_frei_bis: string | null;
  sv_frei_luecke: boolean;
  sv_frei_luecke_von: string | null;
  sv_frei_luecke_bis: string | null;
  // "Offener Zustand" (Hausfrau/Hausmann, Rente, Selbstständigkeit): dann
  // ist sv_frei_von oben bereits der tatsächliche Arbeitsbeginn statt des
  // reinen Nachweis-Datums aus dem Formular (Nutzer-Korrektur 2026-08-11).
  sv_frei_offen: boolean;
  ueberschritten_sv_frei_beginn: boolean;
  ueberschritten_sv_frei_ende: boolean;
  // Beginn des gerade laufenden (letzten) Abschnitts - anders als
  // erster_arbeitstag (allererster Tag der ganzen Saison, über alle
  // Abschnitte) maßgeblich für die 105-Tage-Berechnung des AKTUELLEN
  // Abschnitts (Nutzer-Vorgabe 2026-08-14: "Die verschiedenen Abschnitte
  // müssen transparent benannt und gerechnet werden").
  aktueller_abschnitt_seit: string;
  // Bugfix 2026-08-15: ob TATSÄCHLICH ein Beschäftigungsabschnitt die
  // deklarierte Lücke (sv_frei_luecke_von/bis) überschneidet - anders als
  // sv_frei_luecke, das nur aussagt, DASS die Angaben eine Lücke enthalten
  // (unabhängig davon, ob je gearbeitet wurde). Ersetzt die frühere,
  // fehleranfällige Prüfung gegen erster_arbeitstag/letzter_arbeitstag
  // (die Spanne über ALLE Abschnitte hinweg, fälschlich "kritisch" bei
  // einer Lücke ZWISCHEN zwei echten Abschnitten ohne tatsächliche
  // Überschneidung).
  ueberschritten_sv_frei_luecke: boolean;
}

// Aus der Sicht employee_sv_abschnitte - ein Beschäftigungsabschnitt
// (getrennt durch je eine Abrechnung, echt oder nachgetragen) je
// Mitarbeiter/Saisonjahr. Bisher nur intern in employee_sv_pruefung
// berechnet, jetzt eigenständig abfragbar für die Tage-Aufschlüsselung
// (Nutzer-Vorgabe 2026-08-15: "Wie sähe das aus?").
export interface SvAbschnitt {
  employee_id: string;
  saison_jahr: number;
  abschnitt_nr: number;
  von: string;
  bis: string;
  tage: number;
}

// Aus der Sicht audit_log_ansicht (Änderungsprotokoll) - siehe schema.sql.
// before_data/after_data enthalten den kompletten Datensatz vorher/nachher;
// die geänderten Felder werden erst in der Anzeige daraus ermittelt.
export interface AuditLogEintrag {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  entity: string;
  entity_id: string;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  betroffene_employee_id: string | null;
}

// Aus der Sicht employee_letzte_aenderung: wann hat welcher Nutzer diesen
// Mitarbeiter-Stammdatensatz zuletzt bearbeitet (Spalte auf der
// Personal-Seite, nur für admin).
export interface EmployeeLetzteAenderung {
  employee_id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
}

// Aus der Sicht anreiseliste_offen_arbeitend: Personen, die bereits
// arbeiten, obwohl ihr Anreiselisten-Status noch offen ist
// (Nutzer-Vorgabe 2026-08-11). Siehe schema.sql.
export interface AnreiselisteOffenArbeitend {
  kandidat_id: string;
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  herkunft: string | null;
  aktiv: boolean;
  erster_arbeitstag: string;
  letzter_arbeitstag: string;
  tage_seit_arbeitsbeginn: number;
  arbeitsvertrag_fehlt: boolean;
  sv_fragebogen_offen: boolean;
  buskosten_fehlen: boolean;
  ausweiskopie_fehlt: boolean;
  fuehrerschein_fehlt: boolean;
  hochzeitsurkunde_fehlt: boolean;
  dhh_angaben_fehlen: boolean;
}

// Aus der Sicht employee_urlaubstage - Urlaubstage-Anspruch (2 je vollem
// Kalendermonat der Beschäftigung) vs. tatsächlich genommene "U"-Tage,
// siehe ausführlichen Kommentar in schema.sql.
export interface EmployeeUrlaubstage {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  aktiv: boolean;
  saison_jahr: number;
  erster_eintrag: string;
  letzter_eintrag: string;
  u_tage: number;
  volle_kalendermonate: number;
  urlaubsanspruch_tage: number;
  ueberzogen: boolean;
  // Umgekehrte Richtung (2026-08-20) - offener Resturlaub, bei einer
  // bereits inaktiven Person praktisch eine Abgeltungspflicht.
  resturlaub_tage: number;
  zu_wenig_genommen: boolean;
}

// Ein Frageblock 8 - Zeile ("Bisherige Beschäftigungen im laufenden
// Kalenderjahr") - rein dokumentierend, siehe schema.sql.
export interface SvFragebogenVorbeschaeftigung {
  id?: number;
  von: string;
  bis: string;
  wochenstunden: number | null;
  taetigkeit: string;
  arbeitgeber: string;
}

// Ein SV-Fragebogen-Datensatz - ein Datensatz je Person UND Saison-Jahr
// (siehe schema.sql, Nutzer-Vorgabe 2026-08-08: Vorjahresvergleich nötig).
export interface SvFragebogen {
  id: number;
  employee_id: string;
  saison_jahr: number;

  beschaeftigt_heimatland: boolean | null;
  beschaeftigt_firma: string | null;
  beschaeftigt_taetigkeit: string | null;
  bezahlter_urlaub: boolean | null;
  bezahlter_urlaub_von: string | null;
  bezahlter_urlaub_bis: string | null;
  unbezahlter_urlaub: boolean | null;
  unbezahlter_urlaub_von: string | null;
  unbezahlter_urlaub_bis: string | null;
  freistellung: boolean | null;
  freistellung_von: string | null;
  freistellung_bis: string | null;
  freistellung_grund: string | null;

  selbststaendig: boolean | null;
  selbststaendig_seit: string | null;
  selbststaendig_taetigkeit: string | null;

  arbeitslos: boolean | null;
  arbeitslos_seit: string | null;
  arbeitsamt_name: string | null;
  arbeitsamt_aktenzeichen: string | null;

  schule_studium: boolean | null;
  schule_seit: string | null;
  schule_name: string | null;
  schule_ende: string | null;
  schulferien_waehrend_beschaeftigung: boolean | null;
  schulferien_von: string | null;
  schulferien_bis: string | null;

  rente: boolean | null;
  rente_seit: string | null;
  rente_art: string | null;
  rente_traeger: string | null;

  hausmann: boolean | null;
  hausmann_seit: string | null;

  lebensunterhalt_sonstiges: string | null;

  // Wahlweise als Tage-Zahl ODER als Zeitraum erfassbar (Nutzer-Vorgabe
  // 2026-08-11) - bei vollständigem Zeitraum hat dieser Vorrang, die Tage
  // werden daraus berechnet (siehe vorbeschaeftigung_deutschland_tage_
  // effektiv in SvFragebogenAuswertung).
  vorbeschaeftigung_deutschland_tage: number | null;
  vorbeschaeftigung_deutschland_von: string | null;
  vorbeschaeftigung_deutschland_bis: string | null;
  vorbeschaeftigung_deutschland_arbeitgeber: string | null;
  ausgeloest_durch_lohnprogramm_hinweis: boolean;

  // Bogen wurde bereits geprüft, ist aber nicht verwertbar (fehlende
  // Angaben, unleserlich, fehlende Bestätigung) - zählt automatisch als
  // "nicht bestanden", siehe sv_fragebogen_auswertung.
  unvollstaendig_fehlerhaft: boolean;
  unvollstaendig_fehlerhaft_grund: string | null;

  ausgefuellt_am: string | null;
  erfasst_von: string | null;
  erfasst_am: string;
  updated_by: string | null;
  updated_at: string;
}

// Aus der Sicht sv_fragebogen_auswertung (fügt "bestanden" und den
// abgeleiteten SV-freien Zeitraum hinzu, siehe schema.sql).
export interface SvFragebogenAuswertung extends SvFragebogen {
  bestanden: boolean;
  sv_frei_von: string | null;
  sv_frei_bis: string | null;
  sv_frei_luecke: boolean;
  sv_frei_luecke_von: string | null;
  sv_frei_luecke_bis: string | null;
  // "Offener Zustand" (Hausfrau/Hausmann, Rente, Selbstständigkeit): dann
  // ist sv_frei_von hier nur das Nachweis-Datum aus dem Formular, NICHT der
  // Beginn des SV-freien Zeitraums - der ist der tatsächliche
  // Arbeitsbeginn (siehe SvPruefung.sv_frei_von, dort korrekt eingesetzt).
  sv_frei_offen: boolean;
  // Effektive Tage-Zahl der Vorbeschäftigung: bevorzugt aus dem Zeitraum
  // von/bis berechnet, sonst die direkt eingetragene Zahl (0, wenn beides
  // leer ist). Das ist der Wert, der in die 15-Wochen-Grenze einfließt.
  vorbeschaeftigung_deutschland_tage_effektiv: number;
}

// "Bestätigung für den Nachweis der doppelten Haushaltsführung" - analog
// zum SV-Fragebogen ein Datensatz je Person UND Saison-Jahr. Name/
// Geburtsdatum/Adresse stehen schon auf Employee, bewusst nicht dupliziert.
export type Familienstand =
  | 'verheiratet'
  | 'ledig'
  | 'verwitwet'
  | 'geschieden_getrennt';

export const FAMILIENSTAND_LABELS: Record<Familienstand, string> = {
  verheiratet: 'Verheiratet',
  ledig: 'Ledig',
  verwitwet: 'Verwitwet',
  geschieden_getrennt: 'Geschieden/getrennt lebend',
};

// Nur relevant, wenn Familienstand ungleich "verheiratet" ist (siehe
// Formular).
export type Wohnsituation =
  | 'eigentuemer_mieter'
  | 'lebenspartner'
  | 'andere_verwandte'
  | 'keine_angabe';

export const WOHNSITUATION_LABELS: Record<Wohnsituation, string> = {
  eigentuemer_mieter: 'Eigentümer/Mieter der Wohnung',
  lebenspartner: 'Wohnt bei Lebenspartner(in)',
  andere_verwandte: 'Wohnt bei anderen Verwandten',
  keine_angabe: 'Keine Angabe möglich',
};

// Verfahrensstand des Lohnsteuerabzug-Antrags beim Finanzamt
// (Nutzer-Vorgabe 2026-08-11, ersetzt das frühere Ja/Nein "antrag_gestellt").
// WICHTIG: das Ausfüllen des Formulars "Doppelte Haushaltsführung" ist noch
// KEIN gestellter Antrag - dieser Status wird immer manuell gesetzt.
export type LohnsteuerStatus =
  | 'kein_antrag'
  | 'antrag_gestellt'
  | 'freibetrag_erteilt'
  | 'kein_freibetrag';

export const LOHNSTEUER_STATUS_LABELS: Record<LohnsteuerStatus, string> = {
  kein_antrag: 'Kein Antrag',
  antrag_gestellt: 'Antrag gestellt',
  freibetrag_erteilt: 'Freibetrag erteilt',
  kein_freibetrag: 'Kein Freibetrag',
};

export interface DoppelteHaushaltsfuehrung {
  id: number;
  employee_id: string;
  saison_jahr: number;
  familienstand: Familienstand | null;
  wohnsituation: Wohnsituation | null;
  lohnsteuer_status: LohnsteuerStatus;
  antrag_gestellt_am: string | null;
  ausgefuellt_am: string | null;
  erfasst_von: string | null;
  erfasst_am: string;
  updated_by: string | null;
  updated_at: string;
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
  // Arbeitskleidung (Hose/Jacke/Stiefel, Anzahl × Satz aus
  // verpflegungssaetze) - wie Buskosten/Kautionen abgezogen, aber separat
  // ausgewiesen.
  kleidung_betrag: number;
  // Anzahl Tage ohne Verpflegungsabzug innerhalb der Saison (2026-08-19,
  // z.B. Kantine noch nicht geöffnet) - reduziert nur abzug_verpflegung,
  // nicht anwesenheitstage/abzug_wohnen.
  verpflegungsfreie_tage: number;
  // Kumulierte Summe aller "in Auszahlung umgewandelten" Stundenkonto-
  // Buchungen (2026-08-20) - bereits in bruttolohn enthalten, hier nur zur
  // separaten Anzeige.
  stundenkonto_auszahlung_betrag: number;
}

// Stundenkonto (2026-08-20): laufendes Konto je Mitarbeiter/Saison-Jahr für
// Überstunden & Co., unabhängig vom gewählten Datum auf der
// Stundenerfassung pflegbar. Bewegungs-Log statt Einzelfeld, siehe
// schema.sql.
export interface StundenkontoBewegung {
  id: number;
  employee_id: string;
  saison_jahr: number;
  datum: string;
  stunden: number;
  art: "Gutschrift" | "Korrektur" | "Freizeitausgleich" | "Auszahlung";
  notiz: string | null;
  erstellt_von: string | null;
  erstellt_am: string;
}

// Aus der Sicht employee_stundenkonto_saldo - aktueller Kontostand.
export interface EmployeeStundenkontoSaldo {
  employee_id: string;
  saison_jahr: number;
  saldo: number;
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
  // Ersetzt das frühere "weicht_ab" (2026-08-21): ein historischer Beleg
  // ist jetzt unveränderlich (siehe auszahlungsbeleg_zeilen in
  // schema.sql), ein "weicht von der Live-Berechnung ab"-Vergleich ergibt
  // dafür keinen Sinn mehr. Zeigt stattdessen, ob mindestens eine Zeile
  // dieses Belegs ein Differenzbeleg ist (Person war für diese Saison
  // schon einmal abgerechnet).
  enthaelt_differenz: boolean;
}

// Eine Zeile aus auszahlungsbeleg_zeilen (Auszahlungen-Seite) - inhaltlich
// wie SeasonSummaryRow (zeile hat dieselben Feldnamen und wird 1:1 als
// "snapshot" durchgereicht, damit anzeige() unverändert funktioniert),
// zusätzlich ist_differenz: true, wenn diese Zeile nicht den vollen
// Saison-Betrag zeigt, sondern nur die Differenz seit einer früheren
// Abrechnung derselben Person/Saison (siehe schema.sql).
export interface AuszahlungsbelegZeile extends SeasonSummaryRow {
  ist_differenz: boolean;
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
  // Vorschussart (2026-08-18) - 'Vorschuss' oder 'Strafe/Rechnung'.
  art: string;
  // Nur für Rollen mit Vorschuss-Rechten befüllt, siehe
  // employee_vorschuss_historie in schema.sql.
  beleg_storage_path: string | null;
  beleg_dateiname: string | null;
}

// Bus/Kaution(en)/Arbeitskleidung je Mitarbeiter+Saison-Jahr - für die
// "Suche"-Seite, dort als "Auslage"-Positionen unter Vorschüsse aufgeführt
// (2026-08-18). Aus der schmalen Sicht employee_auslagen_historie
// (season_bonuses/verpflegungssaetze selbst sind per RLS eingeschränkt).
export interface EmployeeAuslagenHistorie {
  employee_id: string;
  saison_jahr: number;
  bus_kosten: number;
  fahrer_kaution: number;
  zimmer_kaution: number;
  kleidung_hose_betrag: number;
  kleidung_jacke_betrag: number;
  kleidung_stiefel_betrag: number;
}

export interface VerpflegungsSatz {
  saison_jahr: number;
  verpflegung: number;
  wohnen: number;
  mindestlohn: number | null;
  // Arbeitskleidung-Preise je Stück - nur Hose/Jacke/Stiefel werden
  // berechnet, siehe schema.sql.
  kleidung_hose: number | null;
  kleidung_jacke: number | null;
  kleidung_stiefel: number | null;
}

export const KULTUREN = ["zuckermais", "erdbeeren", "spargel"] as const;
export type Kultur = (typeof KULTUREN)[number];
export const KULTUR_LABELS: Record<Kultur, string> = {
  zuckermais: "Zuckermais",
  erdbeeren: "Erdbeeren",
  spargel: "Spargel",
};

export interface Arbeitsgruppe {
  gruppe_nr: string;
  bezeichnung: string;
  reihenfolge: number;
  kultur: Kultur | null;
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
  bearbeiter_id: string | null;
  begruendung: string | null;
  // Person (z.B. Gruppenleiter), der das Geld zur Verteilung übergeben
  // wird - erscheint auf dem separaten Übergabe-Beleg beim Drucken.
  uebergeben_an: string | null;
  zahlungsart: string;
  storniert: boolean;
  storno_grund: string | null;
  // Vorschussart (2026-08-18) - 'Vorschuss' oder 'Strafe/Rechnung'. Bei
  // Strafe/Rechnung ist zahlungsart immer 'N/A' (kein Geld fließt, siehe
  // schema.sql) und beleg_* enthält das hochgeladene Nachweis-Dokument.
  art: string;
  beleg_dateiname: string | null;
  beleg_storage_path: string | null;
}

// Ein Empfänger innerhalb eines Vorschusses, mit seinem individuellen Anteil
// (für die Auszahlungsliste zum Ausdrucken).
export interface AdvanceRecipientDetail {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  anteil: number;
  // Nur bei Zahlungsart "BÜ" (Überweisung) befüllt - Schnappschuss der
  // Kontodaten zum Zeitpunkt der Erfassung (Nutzer-Vorgabe 2026-08-14).
  zahlungsempfaenger?: string | null;
  iban?: string | null;
  bic?: string | null;
}

// Bereits ausgegebene Arbeitskleidung je Person/Saison-Jahr - aus der
// schmalen Sicht employee_kleidung_ausgabe (season_bonuses selbst bleibt
// für zeiterfassung nicht lesbar).
export interface EmployeeKleidungAusgabe {
  employee_id: string;
  saison_jahr: number;
  kleidung_hose_anzahl: number;
  kleidung_jacke_anzahl: number;
  kleidung_stiefel_anzahl: number;
}

// Prämien (Nutzer-Vorgabe 2026-08-09) - Menüpunkt mit Untermenüs Spargel/
// Erdbeeren/Zuckermais, ersetzt schrittweise die bisherigen Excel-Dateien.
// Norm/Preis ändern sich im Saisonverlauf, daher mit "gültig ab"
// versioniert statt eines festen Werts pro Jahr.
export interface ZuckermaisSatz {
  id: number;
  gueltig_ab: string;
  norm_kolben_pro_stunde: number;
  kolben_pro_kiste: number;
  satz_pro_kolben: number;
  erstellt_von: string | null;
  erstellt_am: string;
}

export interface ZuckermaisRohdatenEintrag {
  id: number;
  employee_id: string;
  datum: string;
  kisten: number;
  stunden: number;
  erfasst_von: string | null;
  erfasst_am: string;
  updated_by: string | null;
  updated_at: string;
  version: number;
}

// Aus der Sicht zuckermais_praemie_tag - Rohdaten-Zeile plus dem am
// jeweiligen Tag gültigen Satz und der berechneten Tagesprämie.
export interface ZuckermaisPraemieTag {
  id: number;
  employee_id: string;
  datum: string;
  kisten: number;
  stunden: number;
  norm_kolben_pro_stunde: number | null;
  kolben_pro_kiste: number | null;
  satz_pro_kolben: number | null;
  kolben: number;
  praemie: number;
}

// Aus der Sicht zuckermais_statistik_tag - Tagesstatistik über alle
// Mitarbeiter (Menüpunkt "Statistik", Nutzer-Vorgabe 2026-08-09).
export interface ZuckermaisStatistikTag {
  datum: string;
  summe_kisten: number;
  summe_kolben: number;
  summe_stunden: number;
  summe_praemie: number;
  kolben_pro_stunde: number | null;
  kosten_pro_kolben: number | null;
  // Stunden aus der allgemeinen Stundenerfassung der Zuckermais-Gruppen
  // (Einstellungen → Arbeitsgruppen), Nutzer-Vorgabe 2026-08-12.
  gruppen_stunden: number | null;
  kosten_pro_kolben_gruppen: number | null;
  mindestlohn: number | null;
}

// Prämien Erdbeeren (Nutzer-Vorgabe 2026-08-09) - Norm/Bonus je Parzelle
// UND Tag statt global (anders als Zuckermais), da auf mehreren Parzellen
// mit sehr unterschiedlichen Gegebenheiten gleichzeitig gepflückt wird.
export interface ErdbeerenParzelle {
  id: number;
  name: string;
  groesse_ha: number | null;
  // Kurzangaben aus der Zeit vor der Anbauplanung (Stand 2026-08-11).
  // Gepflegt wird das jetzt unter "Anbau" je Tunnel und Sorte - diese
  // beiden Felder bleiben nur, um bestehende Einträge nicht zu verlieren.
  sorte: string | null;
  anzahl_pflanzen: number | null;
  aktiv: boolean;
  erstellt_von: string | null;
  erstellt_am: string;
  updated_by: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Erdbeeren-Anbauplanung (Nutzer-Vorgabe 2026-08-11, Menüpunkt "Anbau" -
// nur admin/erntewirtschaft). Ersetzt die Excel "Erdbeerpflanzplanung".
// Struktur: Feld > Anbau-Jahrgang > Tunnel > Bepflanzung, siehe schema.sql.
// ---------------------------------------------------------------------------
export const PFLANZTYPEN = [
  'frigo',
  'gruenpflanze',
  'topfgruen',
  'warteboden',
  'sonstiges',
] as const;
export type Pflanztyp = (typeof PFLANZTYPEN)[number];

export const PFLANZTYP_LABELS: Record<Pflanztyp, string> = {
  frigo: 'Frigo',
  gruenpflanze: 'Grünpflanze',
  topfgruen: 'Topfgrün',
  warteboden: 'Warteboden',
  sonstiges: 'Sonstiges',
};

export interface ErdbeerenAnbau {
  id: number;
  parzelle_id: number;
  saison_jahr: number;
  erntefenster_von: string | null;
  erntefenster_bis: string | null;
  ertrag_erwartet_steigen: number | null;
  rodung_geplant: string | null;
  notiz: string | null;
}

export interface ErdbeerenTunnel {
  id: number;
  anbau_id: number;
  nummer: string;
  laenge_m: number | null;
  reihen_anzahl: number | null;
  // Pflanzen je laufendem Meter - daraus rechnet sich die Pflanzenzahl
  // (in der Excel Spalte I: 4,37 im Feld, 8 im Glashaus).
  pflanzen_pro_lfm: number | null;
  // Rollennummer der Folie; eigenes Folien-Register kommt später.
  cotura_nr: string | null;
  notiz: string | null;
  // Reihenfolge in der Liste = räumliche Anordnung auf dem Feld
  // (Nutzer-Vorgabe 2026-08-11) - frei sortierbar, bewusst unabhängig von
  // der Tunnelnummer.
  position: number | null;
}

export interface ErdbeerenBepflanzung {
  id: number;
  tunnel_id: number;
  sorte: string;
  // Leer = alle Reihen des Tunnels (der häufige Fall mit einer Sorte).
  reihen_anzahl: number | null;
  pflanzdatum: string | null;
  standjahr: number | null;
  pflanztyp: Pflanztyp | null;
  notiz: string | null;
}

// Aus der Sicht erdbeeren_bepflanzung_berechnet - laufende Meter und
// Pflanzenzahl gerechnet statt getippt.
export interface ErdbeerenBepflanzungBerechnet extends ErdbeerenBepflanzung {
  anbau_id: number;
  parzelle_id: number;
  saison_jahr: number;
  parzelle_name: string;
  tunnel_nummer: string;
  laenge_m: number | null;
  cotura_nr: string | null;
  laufende_meter: number;
  anzahl_pflanzen: number;
}

// Aus der Sicht erdbeeren_anbau_uebersicht - Kennzahlen je Feld und Saison.
export interface ErdbeerenAnbauUebersicht {
  anbau_id: number;
  parzelle_id: number;
  parzelle_name: string;
  groesse_ha: number | null;
  saison_jahr: number;
  erntefenster_von: string | null;
  erntefenster_bis: string | null;
  ertrag_erwartet_steigen: number | null;
  rodung_geplant: string | null;
  notiz: string | null;
  anzahl_tunnel: number;
  laufende_meter: number;
  anzahl_pflanzen: number;
  sorten: string | null;
}

export interface ErdbeerenBestellung {
  id: number;
  saison_jahr: number;
  sorte: string;
  bestellt_anzahl: number | null;
  eigene_anzahl: number | null;
  reserve_prozent: number;
  lieferant: string | null;
  notiz: string | null;
}

// Aus der Sicht erdbeeren_bestellung_uebersicht - Bedarf aus der Planung
// gegen die eingetragenen Bestellmengen (ersetzt Excel-Zeilen 29-36).
export interface ErdbeerenBestellungUebersicht {
  saison_jahr: number;
  sorte: string;
  bedarf_pflanzen: number;
  reserve_prozent: number;
  bedarf_mit_reserve: number;
  bestellt_anzahl: number | null;
  eigene_anzahl: number | null;
  lieferant: string | null;
  // Positiv = fehlt noch, negativ = zu viel bestellt.
  differenz: number;
}

export interface ErdbeerenParzellenSatz {
  id: number;
  parzelle_id: number;
  gueltig_ab: string;
  norm_steigen_pro_stunde: number;
  bonus_pro_steige: number;
  erstellt_von: string | null;
  erstellt_am: string;
}

export interface ErdbeerenRohdatenEintrag {
  id: number;
  employee_id: string;
  parzelle_id: number;
  datum: string;
  steigen: number;
  stunden: number;
  // Abfall/nicht vermarktungsfähige Ware - informativ, zählt nicht zur
  // Prämie.
  sut: number;
  erfasst_von: string | null;
  erfasst_am: string;
  updated_by: string | null;
  updated_at: string;
  version: number;
}

// Aus der Sicht erdbeeren_praemie_tag - Rohdaten-Zeile plus dem am
// jeweiligen Tag/dieser Parzelle gültigen Satz und der berechneten
// Tagesprämie.
export interface ErdbeerenPraemieTag {
  id: number;
  employee_id: string;
  parzelle_id: number;
  parzelle_name: string;
  datum: string;
  steigen: number;
  stunden: number;
  sut: number;
  norm_steigen_pro_stunde: number | null;
  bonus_pro_steige: number | null;
  praemie: number;
}

// Aus der Sicht erdbeeren_statistik_tag - Tagesstatistik je Parzelle
// (Menüpunkt "Statistik").
export interface ErdbeerenStatistikTag {
  datum: string;
  parzelle_id: number;
  parzelle_name: string;
  summe_steigen: number;
  summe_sut: number;
  summe_stunden: number;
  summe_praemie: number;
  steigen_pro_stunde: number | null;
  kosten_pro_steige: number | null;
  mindestlohn: number | null;
}

// Aus der Sicht erdbeeren_gruppenkosten_tag - Stunden der Erdbeeren-
// Gruppen aus der allgemeinen Stundenerfassung × Mindestlohn, umgelegt auf
// die Gesamt-Erntemenge des Tages (alle Parzellen) - Nutzer-Vorgabe
// 2026-08-12, ergänzend zu ErdbeerenStatistikTag (das ist je Parzelle und
// nutzt die enger gefassten Prämien-Stunden).
export interface ErdbeerenGruppenkostenTag {
  datum: string;
  summe_steigen: number;
  summe_praemie: number;
  mindestlohn: number | null;
  gruppen_stunden: number | null;
  kosten_pro_steige_gruppen: number | null;
}

// Kautionsübergabe an den Hausmeister (Nutzer-Vorgabe 2026-08-09) - ein
// Übergabebeleg je Auszahlungsbeleg, mit den enthaltenen Personen/
// Kautionsbeträgen. Erst mit dieser Übergabe wird die Kaution auch als
// Kassenausgabe fällig, siehe app/kasse/page.tsx.
export interface Kautionsuebergabe {
  id: number;
  belegnummer: string;
  auszahlungsbeleg_id: number;
  uebergeben_an: string;
  betrag_summe: number;
  erstellt_von: string | null;
  erstellt_am: string;
  storniert: boolean;
  storniert_am: string | null;
  storniert_von: string | null;
  storno_grund: string | null;
}

export interface KautionsuebergabePerson {
  kautionsuebergabe_id: number;
  employee_id: string;
  betrag: number;
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
  // SV-Fragebogen: löst fragebogen_erfasst (oben) als
  // Vollständigkeits-Kriterium ab, siehe schema.sql.
  sv_fragebogen_erfasst: boolean;
  sv_fragebogen_bestanden: boolean;
  sv_fragebogen_unvollstaendig_fehlerhaft: boolean;
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
