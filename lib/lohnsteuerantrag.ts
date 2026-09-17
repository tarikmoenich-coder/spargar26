// Berechnungslogik für den Lohnsteuerabzug-Sammelantrag (Finanzamt Bensheim) -
// 1:1 aus den Formeln der vom Finanzamt gelieferten Excel-Vorlage
// nachgebildet (Blätter "Eingabe"/"Freibetrag"). Eine einzige Implementierung,
// die sowohl beim Speichern einer Position (app/personal-lohnsteuer/antrag)
// als auch beim Excel-Export (lib/lohnsteuerantragExcel.ts) verwendet wird.
//
// Verpflegungsmehraufwand: An-/Abreisetag(e) à 14 €, jeder Tag dazwischen à
// 28 €, gedeckelt auf insgesamt 90 Tage (danach entfällt der Anspruch). Die
// Original-Formel rechnet den Deckel als festen Wert "88 Zwischentage" (also
// 90 - 2 An-/Abreisetage) - hier stattdessen als 90 - anAbreisetage
// verallgemeinert, damit es auch bei einer abweichenden Anzahl An-/
// Abreisetage korrekt bleibt (bei den üblichen 2 Tagen identisches Ergebnis).
const VERPFLEGUNG_AN_ABREISETAG = 14;
const VERPFLEGUNG_ZWISCHENTAG = 28;
const VERPFLEGUNG_MAX_TAGE = 90;
const FAHRTKOSTEN_PRO_KM = 0.3;
// Werbungskosten-Pauschbetrag pro Jahr, anteilig auf die Aufenthaltstage
// heruntergerechnet (360-Tage-Jahr laut Vorlage).
const PAUSCHBETRAG_JAHR = 1000;
const PAUSCHBETRAG_TAGE_JAHR = 360;

export function tageZwischen(von: string, bis: string): number {
  const msVon = new Date(von).getTime();
  const msBis = new Date(bis).getTime();
  if (!Number.isFinite(msVon) || !Number.isFinite(msBis) || msBis < msVon) {
    return 0;
  }
  return Math.round((msBis - msVon) / (24 * 60 * 60 * 1000)) + 1;
}

export function berechneVerpflegungsmehraufwand(
  tage: number,
  anAbreisetage: number
): number {
  const zwischentage = Math.max(0, tage - anAbreisetage);
  const gedeckelt =
    tage > VERPFLEGUNG_MAX_TAGE
      ? Math.max(0, VERPFLEGUNG_MAX_TAGE - anAbreisetage)
      : zwischentage;
  return (
    anAbreisetage * VERPFLEGUNG_AN_ABREISETAG +
    gedeckelt * VERPFLEGUNG_ZWISCHENTAG
  );
}

export interface LohnsteuerantragEingaben {
  aufenthaltVon: string;
  aufenthaltBis: string;
  anAbreisetage: number;
  gefahreneKm: number;
  unterkunftskosten: number;
  sonstigeWerbungskosten: number;
}

export interface LohnsteuerantragBerechnet {
  tage: number;
  verpflegungsmehraufwand: number;
  fahrtkostenAbsetzbar: number;
  werbungskostenGesamt: number;
  pauschbetragAnteilig: number;
  freibetragBeantragt: number;
}

export function berechneFreibetrag(
  eingaben: LohnsteuerantragEingaben
): LohnsteuerantragBerechnet {
  const tage = tageZwischen(eingaben.aufenthaltVon, eingaben.aufenthaltBis);
  const verpflegungsmehraufwand = berechneVerpflegungsmehraufwand(
    tage,
    eingaben.anAbreisetage
  );
  const fahrtkostenAbsetzbar = eingaben.gefahreneKm * FAHRTKOSTEN_PRO_KM;
  const werbungskostenGesamt =
    verpflegungsmehraufwand +
    fahrtkostenAbsetzbar +
    eingaben.unterkunftskosten +
    eingaben.sonstigeWerbungskosten;
  const pauschbetragAnteilig = Math.floor(
    (PAUSCHBETRAG_JAHR / PAUSCHBETRAG_TAGE_JAHR) * tage
  );
  const differenz = werbungskostenGesamt - pauschbetragAnteilig;
  const freibetragBeantragt = differenz > 0 ? Math.ceil(differenz) : 0;
  return {
    tage,
    verpflegungsmehraufwand,
    fahrtkostenAbsetzbar,
    werbungskostenGesamt,
    pauschbetragAnteilig,
    freibetragBeantragt,
  };
}

// Umrechnung des (Jahres-/Zeitraum-)Freibetrags auf monatlich/wöchentlich/
// täglich für das Blatt "Freibetrag" - je nachdem, mit welchem
// Lohnzahlungszeitraum die Bescheinigung beim Finanzamt eingereicht wird.
export function freibetragMonatlich(freibetrag: number, tage: number): number {
  if (tage <= 0) return 0;
  return Math.ceil((freibetrag * 30) / tage - 1e-9);
}

export function freibetragWoechentlich(
  freibetrag: number,
  tage: number
): number {
  if (tage <= 0) return 0;
  const woechentlich = (((freibetrag * 30) / tage) / 30) * 7;
  // ROUNDUP auf eine Nachkommastelle (Fließkomma-Ungenauigkeit vor dem
  // Aufrunden minimal ausgleichen, z.B. 4.499999999 statt 4.5).
  return Math.ceil(woechentlich * 10 - 1e-9) / 10;
}

export function freibetragTaeglich(freibetrag: number, tage: number): number {
  if (tage <= 0) return 0;
  return Math.ceil(freibetrag / tage / 0.05 - 1e-9) * 0.05;
}
