// Zentrale Rollen-Definition (Single Source of Truth für die Anzeige).
//
// - ROLLEN / ROLLEN_LABELS: für die Nutzerverwaltung und überall, wo eine
//   Rolle angezeigt wird.
// - MENUE_RECHTE: welche Rolle welchen Menüpunkt sieht (components/Nav.tsx
//   zieht daraus).
//
// WICHTIG: Die tatsächlichen Server-Rechte stehen als Row Level Security in
// supabase/schema.sql (~156 current_role_name()-Prüfungen). MENUE_RECHTE
// steuert NUR die Menü-Sichtbarkeit. Bei JEDER Rechte-Änderung (RLS-Policy,
// security-definer-Funktion, Client-canWrite) immer mit anpassen:
//   1. MENUE_RECHTE (falls sich die Menü-Sichtbarkeit ändert),
//   2. die `kurz`-Beschreibung der betroffenen Rolle in ROLLEN unten
//      (Nutzer-Vorgabe - sie erscheint 1:1 als "Was die Rollen dürfen" in
//      /einstellungen/nutzer),
//   3. die Rollentabelle in der README.

import type { UserRole } from "@/lib/types";

export interface RolleInfo {
  wert: UserRole;
  label: string;
  kurz: string;
}

// Reihenfolge = Anzeige in der Nutzerverwaltung / in Auswahllisten.
export const ROLLEN: RolleInfo[] = [
  {
    wert: "admin",
    label: "Administrator",
    kurz: "Voller Zugriff, Konfiguration, Freigaben, Nutzerverwaltung.",
  },
  {
    wert: "hr",
    label: "Personal (HR)",
    kurz: "Personalstamm + Dokumente, SV/Lohnsteuer, Personalplanung, Stunden erfassen, Monatsabschluss. Lohnübersicht nur lesen.",
  },
  {
    wert: "zeiterfassung",
    label: "Stundenerfassung",
    kurz: "Stunden, Prämien, Arbeitskleidung und Qualitätskontrollen (Halle) erfassen, Arbeitsgruppen pflegen. Personal nur mit eingeschränkten Feldern.",
  },
  {
    wert: "kasse",
    label: "Kasse",
    kurz: "Vorschüsse erfassen/stornieren/korrigieren, Kassenbücher führen, Kassenprüfung durchführen.",
  },
  {
    wert: "lohnabrechnung",
    label: "Lohnabrechnung",
    kurz: "Lohnübersicht bearbeiten (Netto, Buskosten, Kautionen, 'Jetzt Abrechnen'), Vorschüsse erstellen/korrigieren, Prämien und Statistik ansehen.",
  },
  {
    wert: "pruefer",
    label: "Prüfer",
    kurz: "Nur lesen; Kassenprüfungen freigeben; einzige Nicht-Admin-Rolle mit Einsicht ins Änderungsprotokoll.",
  },
  {
    wert: "management",
    label: "Management",
    kurz: "Überwiegend lesende/aggregierte Sicht (Lohn, Kasse, Prämien, Statistik, Controlling, Fahrzeuge); darf zusätzlich Stundenkonto-Auszahlungen anstoßen.",
  },
  {
    wert: "erntewirtschaft",
    label: "Erntewirtschaft",
    kurz: "Prämien + Statistik + Anbauplanung + Qualitätskontrolle (Halle), Unterkunft lesend, eigenes Tages-Dashboard. Kein Personal/Lohn/Kasse/Controlling.",
  },
  {
    wert: "hausmeister",
    label: "Hausmeister",
    kurz: "Ausschließlich Unterkunft (Reparaturen).",
  },
  {
    wert: "waage",
    label: "Waage",
    kurz: "Ausschließlich der Kiosk-Bildschirm an der Hofwaage, sonst nichts.",
  },
];

export const ROLLEN_LABELS: Record<UserRole, string> = Object.fromEntries(
  ROLLEN.map((r) => [r.wert, r.label])
) as Record<UserRole, string>;

export function rolleLabel(r: UserRole | null | undefined): string {
  return r ? ROLLEN_LABELS[r] ?? r : "—";
}

// Menüpunkt (href) -> Rollen, die ihn sehen.
export const MENUE_RECHTE: Record<string, UserRole[]> = {
  "/dashboard": [
    "admin",
    "hr",
    "kasse",
    "lohnabrechnung",
    "pruefer",
    "management",
    "erntewirtschaft",
  ],
  "/mitarbeiter": ["admin", "hr"],
  "/unterkunft": ["admin", "hr", "erntewirtschaft", "hausmeister"],
  "/fahrzeuge": ["admin", "hr", "management"],
  "/erfassung": ["admin", "hr", "zeiterfassung"],
  "/suche": [
    "admin",
    "hr",
    "zeiterfassung",
    "kasse",
    "lohnabrechnung",
    "pruefer",
    "management",
    "erntewirtschaft",
  ],
  "/uebersicht": [
    "admin",
    "hr",
    "kasse",
    "lohnabrechnung",
    "pruefer",
    "management",
  ],
  "/erntewirtschaft": [
    "admin",
    "hr",
    "zeiterfassung",
    "lohnabrechnung",
    "management",
    "erntewirtschaft",
  ],
  // Wer die Flotten-Überblicksseite (Karte) unter /erntewirtschaft selbst
  // sieht statt dorthin weitergeleitet zu werden - 1:1 wie
  // ernte_kiste_zyklus_select (lohnabrechnung bleibt beim bisherigen
  // Redirect zu praemien/zuckermais, siehe app/erntewirtschaft/page.tsx).
  "/erntewirtschaft/ueberblick": [
    "admin",
    "hr",
    "zeiterfassung",
    "management",
    "erntewirtschaft",
  ],
  "/praemien/zuckermais": [
    "admin",
    "hr",
    "zeiterfassung",
    "lohnabrechnung",
    "management",
    "erntewirtschaft",
  ],
  "/anbau/erdbeeren": ["admin", "erntewirtschaft"],
  "/statistik/zuckermais": [
    "admin",
    "hr",
    "lohnabrechnung",
    "management",
    "erntewirtschaft",
  ],
  "/qualitaet": [
    "admin",
    "hr",
    "zeiterfassung",
    "lohnabrechnung",
    "management",
    "erntewirtschaft",
  ],
  // Rollen hier 1:1 wie die RLS-Select-Policy auf ernte_scan/ernte_waage
  // (migration_2026-10-12_erntewirtschaft_waage_grundlage.sql) - sonst
  // sieht eine Rolle den Menüpunkt, aber nie Daten.
  "/erntewirtschaft/waage": [
    "admin",
    "hr",
    "zeiterfassung",
    "management",
    "erntewirtschaft",
  ],
  // Rollen hier 1:1 wie die RLS-Select-Policy auf ernte_kiste_zyklus
  // (migration_2026-10-20_erntewirtschaft_kisten_zyklus.sql).
  "/erntewirtschaft/ernte": [
    "admin",
    "hr",
    "zeiterfassung",
    "management",
    "erntewirtschaft",
  ],
  // Nur admin/hr - 1:1 wie ernte_ausweis_admin_hr_all
  // (migration_2026-10-22_ernte_ausweis.sql), der Suffix ist sicherheits-
  // relevant und darf keiner weiteren Rolle sichtbar sein.
  "/erntewirtschaft/ausweise": ["admin", "hr"],
  "/kasse": ["admin", "kasse", "pruefer", "management"],
  "/management": ["admin", "hr", "management"],
  "/aenderungsprotokoll": ["admin"],
  // zeiterfassung: nur Unterseite Arbeitsgruppen (EinstellungenTabs leitet um)
  "/einstellungen": ["admin", "zeiterfassung"],
};
