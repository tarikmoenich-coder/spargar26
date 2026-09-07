// Zentrale Rollen-Definition (Single Source of Truth für die Anzeige).
//
// - ROLLEN / ROLLEN_LABELS: für die Nutzerverwaltung und überall, wo eine
//   Rolle angezeigt wird.
// - MENUE_RECHTE: welche Rolle welchen Menüpunkt sieht (components/Nav.tsx
//   zieht daraus).
//
// WICHTIG: Die tatsächlichen Server-Rechte stehen als Row Level Security in
// supabase/schema.sql (~156 current_role_name()-Prüfungen). MENUE_RECHTE
// steuert NUR die Menü-Sichtbarkeit - bei Rechte-Änderungen immer beide
// Stellen anfassen. Die Rollentabelle in der README wird aus diesem File
// gepflegt.

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
    kurz: "Stunden, Prämien und Arbeitskleidung erfassen. Personal nur mit eingeschränkten Feldern.",
  },
  {
    wert: "kasse",
    label: "Kasse",
    kurz: "Vorschüsse erfassen/stornieren/korrigieren, Kassenbücher führen, Kassenprüfung durchführen.",
  },
  {
    wert: "lohnabrechnung",
    label: "Lohnabrechnung",
    kurz: "Lohnübersicht bearbeiten (Buskosten, Kautionen, 'Jetzt Abrechnen'), Vorschüsse einsehen, Prämien ansehen.",
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
    kurz: "Prämien + Statistik + Anbauplanung, Unterkunft lesend, eigenes Tages-Dashboard. Kein Personal/Lohn/Kasse/Controlling.",
  },
  {
    wert: "hausmeister",
    label: "Hausmeister",
    kurz: "Ausschließlich Unterkunft (Reparaturen).",
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
  "/kasse": ["admin", "kasse", "pruefer", "management"],
  "/management": ["admin", "hr", "management"],
  "/aenderungsprotokoll": ["admin"],
  "/einstellungen": ["admin"],
};
