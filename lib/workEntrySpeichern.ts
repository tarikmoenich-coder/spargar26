// Gemeinsame Speicherlogik für ein einzelnes work_entries-Feld (Stunden/
// Markierung/Notiz) - extrahiert 2026-08-21 aus app/erfassung/page.tsx,
// damit die Stundenerfassung UND das Controlling-Stundenmonitoring
// dieselbe, geprüfte Logik nutzen (nicht zweimal pflegen, siehe
// Nutzer-Vorgabe "muss sauber eingebaut werden").
//
// Bei bestehendem Eintrag per optimistischer Sperre (version, ADR-010)
// aktualisieren, sonst neu anlegen. Weder ein RLS-Fehler (z.B. fehlende
// Berechtigung, gesperrter Monat) noch ein Versionskonflikt (0 betroffene
// Zeilen, wenn zwischenzeitlich jemand anders gespeichert hat) dürfen
// lautlos verschluckt werden - siehe Bugreport 2026-08-08 ("eingetippte
// Stunden nach Neuladen wieder weg").
import { getSupabaseClient } from "@/lib/supabase/client";
import type { WorkEntry } from "@/lib/types";

export type WorkEntryPatch = Partial<
  Pick<WorkEntry, "stunden" | "markierung" | "notiz">
>;

export type WorkEntrySpeicherErgebnis =
  | { ok: true }
  | { ok: false; konflikt: boolean; fehler?: string };

export async function speichereWorkEntryFeld(
  employeeId: string,
  datum: string,
  existing: WorkEntry | null | undefined,
  patch: WorkEntryPatch
): Promise<WorkEntrySpeicherErgebnis> {
  const supabase = getSupabaseClient();

  if (existing) {
    const { data, error } = await supabase
      .from("work_entries")
      .update(patch)
      .eq("id", existing.id)
      .eq("version", existing.version) // optimistische Sperre (ADR-010)
      .select("id");
    if (error) return { ok: false, konflikt: false, fehler: error.message };
    if (!data || data.length === 0) return { ok: false, konflikt: true };
    return { ok: true };
  }

  const { error } = await supabase
    .from("work_entries")
    .insert({ employee_id: employeeId, datum, ...patch });
  if (error) {
    // Eindeutigkeitsverletzung (employee_id, datum) = jemand anders war
    // zwischenzeitlich schneller - auch das ist ein Konflikt, kein
    // "echter" Fehler.
    if (error.code === "23505") return { ok: false, konflikt: true };
    return { ok: false, konflikt: false, fehler: error.message };
  }
  return { ok: true };
}
