// Rechte in der App (Rechte-Umbau 2026-11-27/28, docs/rechte-plan.md).
//
// Rechte hängen nicht mehr fest an Rollen, sondern an Funktionen aus dem
// Rechte-Katalog (Tabelle recht_katalog, Quelle supabase/rechte/katalog.py):
// je Funktion "lesen" ('kasse.buecher:L') oder "lesen & schreiben"
// ('kasse.buecher:S'). Eine Rolle ist eine Sammlung solcher Rechte; ein
// Nutzer kann mehrere Rollen haben (Rechte addieren sich). Die Datenbank
// rechnet je Nutzer die fertige Liste vor (profil_rechte) - useProfile()
// lädt sie mit dem Profil.
//
// Prüfen IMMER über darf(profile, 'funktion:S') - nie über Rollennamen.
// Die Server-Rechte stehen als Row Level Security in der Datenbank
// (darf_any(...)); die Prüfungen hier blenden nur Knöpfe/Menüs passend aus
// und müssen zur Datenbank passen.

import type { Profile, UserRole } from "@/lib/types";

type ProfilLike =
  | Pick<Profile, "role" | "rollen" | "aktiv" | "profil_rechte">
  | null
  | undefined;

export interface RolleInfo {
  wert: UserRole;
  label: string;
  kurz: string;
}

// Rollen-Bezeichnungen (Anzeige + Auswahl in der Nutzerverwaltung). Die
// Rechte der Rollen stehen in der Datenbank (Tabelle rolle).
export const ROLLEN: RolleInfo[] = [
  { wert: "admin", label: "Administrator", kurz: "Voller Zugriff, Nutzer und Rollen verwalten, Vorschläge." },
  {
    wert: "geschaeftsfuehrer",
    label: "Geschäftsführer",
    kurz: "Alles wie Administrator, außer Nutzer anlegen, Rollen ändern/vergeben und Änderungsvorschläge ansehen.",
  },
  {
    wert: "hr",
    label: "Personal (HR)",
    kurz: "Personalstamm + Dokumente, SV/Lohnsteuer, Personalplanung, Importe/Zusammenführen, Unterkunft, Fahrzeuge, Stunden erfassen, Controlling, Monatsabschluss. Lohnübersicht lesen + Firma je Saison zuordnen. Mit Bereich Vertrieb: Stände, Touren, Verfügbarkeit und Grundplan pflegen.",
  },
  {
    wert: "zeiterfassung",
    label: "Stundenerfassung",
    kurz: "Stunden, Prämien, Arbeitskleidung und Qualitätskontrollen (Halle) erfassen, Arbeitsgruppen pflegen.",
  },
  {
    wert: "kasse",
    label: "Kasse",
    kurz: "Vorschüsse erfassen/stornieren/korrigieren, Kassenbücher führen, Kassenprüfung durchführen.",
  },
  {
    wert: "lohnabrechnung",
    label: "Lohnabrechnung",
    kurz: "Lohnübersicht bearbeiten (Netto, Buskosten, Kautionen, 'Jetzt Abrechnen'), Vorschüsse erstellen/korrigieren, Prämien und Statistik ansehen. Mit Bereich Vertrieb: Vertriebsplanung lesen.",
  },
  {
    wert: "pruefer",
    label: "Prüfer",
    kurz: "Nur lesen; Kassenprüfungen freigeben; Einsicht ins Änderungsprotokoll. Mit Bereich Vertrieb: Vertriebsplanung lesen.",
  },
  {
    wert: "management",
    label: "Management",
    kurz: "Lesende Sicht (Lohn, Kasse, Prämien, Statistik, Controlling, Fahrzeuge). Mit Bereich Vertrieb: Vertriebsplanung lesen.",
  },
  {
    wert: "erntewirtschaft",
    label: "Erntewirtschaft",
    kurz: "Prämien + Statistik + Anbauplanung + Qualitätskontrolle (Halle), Unterkunft lesend, eigenes Tages-Dashboard. Kein Personal/Lohn/Kasse/Controlling.",
  },
  {
    wert: "hausmeister",
    label: "Hausmeister",
    kurz: "Ausschließlich Unterkunft: Immobilien/Belegungsplan, Ein-/Auszüge (Übergabe), Mängel melden, Reparaturen; Herkunfts-Planung nur lesend.",
  },
  { wert: "waage", label: "Waage", kurz: "Ausschließlich der Kiosk-Bildschirm an der Hofwaage, sonst nichts." },
];

export const ROLLEN_LABELS: Record<string, string> = Object.fromEntries(ROLLEN.map((r) => [r.wert, r.label]));

// Rollen eines Profils (Anzeige); deaktivierte Profile haben keine.
export function rollenVon(profile: ProfilLike): UserRole[] {
  if (!profile || profile.aktiv === false) return [];
  return profile.rollen && profile.rollen.length > 0 ? profile.rollen : [profile.role];
}

export function rolleLabel(r: UserRole | null | undefined): string {
  return r ? ROLLEN_LABELS[r] ?? r : "—";
}

// Vorberechnete Rechte des Nutzers ('funktion:L' / 'funktion:S').
export function rechteVon(profile: ProfilLike): string[] {
  if (!profile || profile.aktiv === false) return [];
  return profile.profil_rechte?.rechte ?? [];
}

// Hat der Nutzer mindestens eines der Rechte? z.B. darf(profile, "kasse.buecher:S")
export function darf(profile: ProfilLike, ...rechte: string[]): boolean {
  const eigene = rechteVon(profile);
  return rechte.some((r) => eigene.includes(r));
}

// Administrator (Nutzer/Rollen verwalten, Vorschläge) - der Geschäftsführer
// ist es ausdrücklich NICHT (Nutzer-Vorgabe 2026-11-27).
export function istAdmin(profile: ProfilLike): boolean {
  return !!profile && profile.aktiv !== false && !!profile.profil_rechte?.admin;
}

// Büro-Nutzer: hat irgendein Recht außer dem Waagen-Bildschirm.
export function istBuero(profile: ProfilLike): boolean {
  return !!profile && profile.aktiv !== false && !!profile.profil_rechte?.buero;
}

// Geschäftsbereiche (LW/VT), die der Nutzer sehen darf - wie
// current_bereiche() in der Datenbank (ohne die gewählte Ansicht).
export function bereicheVon(profile: ProfilLike): string[] {
  if (!profile || profile.aktiv === false) return [];
  return profile.profil_rechte?.bereiche ?? [];
}

// Bereiche, in denen der Nutzer eines der Rechte hat (Stufe 2: Bereiche je
// Rolle) - wie bereiche_fuer() in der Datenbank, ohne gewählte Ansicht.
export function bereicheFuer(profile: ProfilLike, ...rechte: string[]): string[] {
  if (!profile || profile.aktiv === false) return [];
  const rb = profile.profil_rechte?.rechte_bereich;
  if (!rb) return bereicheVon(profile);
  return Array.from(new Set(rechte.flatMap((r) => rb[r] ?? []))).sort();
}

// Schlanke Hausmeister-Ansicht der Unterkunft (Zimmer-Liste statt Grundriss-
// Werkzeuge, nur Immobilien/Belegungsplan/Auszüge/Reparaturen/Planung):
// wer in der Unterkunft arbeitet, aber keine Kontrollen machen darf.
export function nurHausmeisterSicht(profile: ProfilLike): boolean {
  return (
    darf(profile, "unterkunft.belegung:L", "unterkunft.maengel:L") &&
    !darf(profile, "unterkunft.kontrollen:L")
  );
}

// Alle Funktionen eines Moduls lesen (für Menüpunkte).
function modul(...praefixe: string[]): string[] {
  return praefixe.map((p) => `${p}:L`);
}

// Menüpunkt (href) -> sichtbar, wenn der Nutzer eines dieser Rechte hat.
// Unterseiten mit eigenem Recht stehen einzeln (Reiter blenden danach aus).
export const MENUE_RECHTE: Record<string, string[]> = {
  "/mitarbeiter": modul(
    "personal.planung",
    "personal.stamm",
    "personal.persoenlich",
    "personal.sv",
    "personal.lohnsteuer",
    "personal.dokumente",
    "personal.verwaltung",
    "personal.handys"
  ),
  "/unterkunft": modul(
    "unterkunft.immobilien",
    "unterkunft.zuweisen",
    "unterkunft.belegung",
    "unterkunft.kontrollen",
    "unterkunft.maengel",
    "unterkunft.planung"
  ),
  "/fahrzeuge": modul("fahrzeuge.uebersicht", "fahrzeuge.stammdaten"),
  "/erfassung": modul("erfassung.stunden", "erfassung.kleidung", "erfassung.lager"),
  "/uebersicht": modul("lohn.uebersicht", "lohn.vorschuesse", "lohn.auszahlungen"),
  "/erntewirtschaft": modul(
    "ernte.praemien",
    "ernte.statistik",
    "ernte.qualitaet",
    "ernte.anbau",
    "ernte.bestellung",
    "ernte.ernte",
    "ernte.waage",
    "ernte.maschinen",
    "ernte.waagen",
    "ernte.ausweise"
  ),
  // Unterbereiche der Erntewirtschaft (ErntewirtschaftTabs)
  "/erntewirtschaft/ueberblick": modul("ernte.ernte"),
  "/praemien/zuckermais": modul("ernte.praemien"),
  "/anbau/erdbeeren": modul("ernte.anbau", "ernte.bestellung"),
  "/statistik/zuckermais": modul("ernte.statistik"),
  "/qualitaet": modul("ernte.qualitaet"),
  "/erntewirtschaft/waage": modul("ernte.waage"),
  "/erntewirtschaft/ernte": modul("ernte.ernte"),
  "/erntewirtschaft/ausweise": modul("ernte.ausweise"),
  "/erntewirtschaft/stammdaten": modul("ernte.maschinen", "ernte.waagen"),
  "/vertrieb": modul("vertrieb.planung"),
  "/kasse": modul("kasse.buecher", "kasse.pruefung"),
  "/management": modul("controlling"),
  "/aenderungsprotokoll": modul("sonder.protokoll"),
  // Startseite: wer Büro-Übersichten hat (nicht reine Erfassungs-,
  // Hausmeister- oder Waagen-Rollen - die landen direkt auf ihrer Seite).
  "/dashboard": modul(
    "personal.planung",
    "personal.stamm",
    "lohn.uebersicht",
    "kasse.buecher",
    "kasse.pruefung",
    "controlling",
    "ernte.statistik",
    "vertrieb.planung",
    "sonder.protokoll"
  ),
  "/suche": modul(
    "personal.stamm",
    "lohn.uebersicht",
    "lohn.vorschuesse",
    "erfassung.stunden",
    "ernte.praemien",
    "ernte.statistik",
    "controlling",
    "kasse.buecher"
  ),
};

// Darf das Profil einen Menüpunkt sehen?
export function darfMenue(profile: ProfilLike, href: string): boolean {
  switch (href) {
    case "/vorschlaege":
      return istAdmin(profile);
    case "/vertrieb":
      // Vertriebsplanung gibt es nur im Bereich Vertrieb
      return bereicheFuer(profile, "vertrieb.planung:L").includes("VT");
    case "/einstellungen":
      return istAdmin(profile) || darf(profile, "einstellungen.grund:S", "erfassung.gruppen:S");
  }
  return darf(profile, ...(MENUE_RECHTE[href] ?? []));
}

// Erste Seite, die der Nutzer öffnen darf (Startseite ohne Übersicht, z.B.
// Hausmeister oder Waage).
export function ersteSeite(profile: ProfilLike): { href: string; text: string } | null {
  if (nurHausmeisterSicht(profile)) return { href: "/unterkunft/reparaturen", text: "Zu den Reparaturen" };
  if (darf(profile, "erfassung.stunden:L")) return { href: "/erfassung", text: "Zur Stundenerfassung" };
  if (darf(profile, "sonder.waage_kiosk:S")) return { href: "/erntewirtschaft/waage/kiosk", text: "Zum Waagen-Kiosk" };
  return null;
}
