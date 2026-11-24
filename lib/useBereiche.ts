"use client";

// Geschäftsbereiche (Stufe 2, 2026-11-24): Landwirtschaft / Vertrieb als
// Rechte-Grenze. Die Datenbank filtert selbst (current_bereiche()) - dieser
// Hook liefert nur, was die Oberfläche braucht: welche Bereiche der Nutzer
// sehen darf, welche Ansicht gewählt ist und mit welchem Bereich neue
// Personen/Kandidaten/Gruppen angelegt werden.
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { hatRolle } from "@/lib/rollen";
import type { Geschaeftsbereich, Profile } from "@/lib/types";

export function useBereiche(profile: Profile | null) {
  const [alle, setAlle] = useState<Geschaeftsbereich[]>([]);

  useEffect(() => {
    if (!profile) return;
    getSupabaseClient()
      .from("geschaeftsbereich")
      .select("*")
      .order("reihenfolge")
      .then(({ data }) => setAlle((data as Geschaeftsbereich[]) ?? []));
  }, [profile]);

  // admin/management/pruefer sehen alles (wie current_bereiche()).
  const erlaubt: string[] = !profile
    ? []
    : hatRolle(profile, "admin", "management", "pruefer")
      ? alle.map((b) => b.kuerzel)
      : (profile.bereiche ?? ["LW"]);
  const ansicht =
    profile?.bereich_ansicht && erlaubt.includes(profile.bereich_ansicht)
      ? profile.bereich_ansicht
      : null;
  // Bereich für Neuanlagen: gewählte Ansicht, sonst der einzige erlaubte,
  // sonst Landwirtschaft.
  const standard = ansicht ?? (erlaubt.length === 1 ? erlaubt[0] : "LW");

  return {
    alle,
    erlaubt,
    ansicht,
    standard,
    mehrere: erlaubt.length > 1,
    label: (kuerzel: string | null | undefined) =>
      alle.find((b) => b.kuerzel === kuerzel)?.bezeichnung ?? kuerzel ?? "—",
    praefix: (kuerzel: string | null | undefined) =>
      alle.find((b) => b.kuerzel === kuerzel)?.personalnummer_praefix ?? "",
  };
}

// Personalnummer an den Bereich anpassen: Vertrieb bekommt das Präfix
// ("V-"), Landwirtschaft keins - passend zur DB-Regel
// employees_bereich_personalnummer_check.
export function personalNrFuerBereich(nr: string, praefix: string): string {
  const roh = nr.trim();
  if (!praefix) return roh;
  return roh.startsWith(praefix) ? roh : praefix + roh;
}
