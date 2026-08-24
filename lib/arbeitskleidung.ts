// Größen-Listen bewusst fest im Code (Nutzer-Vorgabe 2026-08-24) - geteilt
// zwischen app/arbeitskleidung/page.tsx (Ausgabe) und app/lager/page.tsx
// (Lagerbestand + Inventur), damit sie nie auseinanderlaufen können.
import type { KleidungTyp } from "@/lib/types";

export const HOSE_JACKE_GROESSEN = ["S", "M", "L", "XL", "XXL", "3XL"];
export const STIEFEL_GROESSEN = Array.from({ length: 13 }, (_, i) =>
  String(36 + i)
); // 36–48
export const TYPEN: KleidungTyp[] = ["Hose", "Jacke", "Stiefel"];

export function groessenFuer(typ: KleidungTyp): string[] {
  return typ === "Stiefel" ? STIEFEL_GROESSEN : HOSE_JACKE_GROESSEN;
}

// Farb-Badge je Typ (rein optisch, Nutzer-Vorgabe 2026-08-25: "optisch
// aufhübschen") - macht die Typ-Spalte auf einen Blick unterscheidbar.
export const TYP_BADGE_CLASS: Record<KleidungTyp, string> = {
  Hose: "bg-blue-100 text-blue-800",
  Jacke: "bg-emerald-100 text-emerald-800",
  Stiefel: "bg-amber-100 text-amber-800",
};
