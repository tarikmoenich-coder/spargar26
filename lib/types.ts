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
  abrechnungsart: Abrechnungsart;
  saison_jahr: number;
  gesamt_stunden: number;
  anwesenheitstage: number;
  praemien_summe: number;
  basis_brutto: number;
  bruttolohn: number;
  abzug_verpflegung: number;
  abzug_wohnen: number;
  vorschuss_summe: number;
  lohnsteuer_pauschal: number;
  nettolohn: number;
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

export interface Advance {
  id: number;
  belegnummer: string;
  datum: string;
  datum_kassenbuch: string;
  betrag: number;
  empfaenger_text: string | null;
  begruendung: string | null;
  zahlungsart: string;
  storniert: boolean;
  storno_grund: string | null;
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
