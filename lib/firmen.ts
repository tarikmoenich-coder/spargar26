// Firmen (Stufe 3a, 2026-11-24) - Hilfen für die Oberfläche. Die gültige
// Firma einer Person je Saison: Eintrag in employee_saison, sonst die
// Standard-Firma ihres Bereichs (wie firma_fuer() in der Datenbank).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Firma } from "@/lib/types";

export function standardFirma(firmen: Firma[], bereich: string | null | undefined): Firma | null {
  return firmen.find((f) => f.bereich === (bereich ?? "LW") && f.ist_standard) ?? null;
}

// saisonFirma: Map employee_id -> Firmen-Kürzel aus employee_saison (für
// EIN Saisonjahr geladen).
export function firmaFuer(
  firmen: Firma[],
  person: { id: string; bereich?: string | null },
  saisonFirma: Map<string, string>
): Firma | null {
  const k = saisonFirma.get(person.id);
  return (k ? firmen.find((f) => f.kuerzel === k) : null) ?? standardFirma(firmen, person.bereich);
}

export function firmaName(firmen: Firma[], kuerzel: string | null | undefined): string {
  return firmen.find((f) => f.kuerzel === kuerzel)?.name ?? kuerzel ?? "—";
}

// Kurzname für enge Spalten/Filter: "Mömmel Agrar GmbH & Co. KG" -> "Mömmel Agrar"
export function firmaKurz(firmen: Firma[], kuerzel: string | null | undefined): string {
  return firmaName(firmen, kuerzel).replace(/\s+GmbH.*$/i, "");
}

// Zeilen (z.B. SEPA-Empfänger eines Belegs) nach der Firma ihrer Person im
// Saisonjahr gruppieren - Nutzer-Vorgabe 2026-11-24: gemischte Belege
// ergeben eine SEPA-Datei je Firma.
export async function nachFirmaGruppieren<T extends { employee_id: string }>(
  supabase: SupabaseClient,
  zeilen: T[],
  saisonJahr: number
): Promise<{ firma: Firma | null; zeilen: T[] }[]> {
  const ids = Array.from(new Set(zeilen.map((z) => z.employee_id)));
  const [{ data: firmenDaten }, { data: saison }, { data: personen }] = await Promise.all([
    supabase.from("firma").select("*").order("reihenfolge"),
    ids.length
      ? supabase
          .from("employee_saison")
          .select("employee_id, firma")
          .eq("saison_jahr", saisonJahr)
          .in("employee_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("employees").select("id, bereich").in("id", ids)
      : Promise.resolve({ data: [] }),
  ]);
  const firmen = (firmenDaten as Firma[]) ?? [];
  const saisonFirma = new Map(
    ((saison as { employee_id: string; firma: string }[]) ?? []).map((s) => [s.employee_id, s.firma])
  );
  const bereichNachId = new Map(
    ((personen as { id: string; bereich: string }[]) ?? []).map((p) => [p.id, p.bereich])
  );
  const gruppen = new Map<string, { firma: Firma | null; zeilen: T[] }>();
  for (const z of zeilen) {
    const f = firmaFuer(firmen, { id: z.employee_id, bereich: bereichNachId.get(z.employee_id) }, saisonFirma);
    const key = f?.kuerzel ?? "?";
    if (!gruppen.has(key)) gruppen.set(key, { firma: f, zeilen: [] });
    gruppen.get(key)!.zeilen.push(z);
  }
  return Array.from(gruppen.values()).sort(
    (a, b) => (a.firma?.reihenfolge ?? 999) - (b.firma?.reihenfolge ?? 999)
  );
}
