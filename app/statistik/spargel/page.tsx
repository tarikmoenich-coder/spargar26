"use client";

import PageHeader from "@/components/PageHeader";
import { BarChart3 } from "lucide-react";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";

// Platzhalter (Stand 2026-11-25) - Wiegedaten laufen schon ein
// (ernte_kiste_zyklus), die Auswertung je Feld/Tag folgt mit dem
// Feldstufen-/Prämiensystem (docs/erntewirtschaft-plan.md Teil F2).
export default function StatistikSpargelPage() {
  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={BarChart3} titel="Statistik – Spargel" />
        <p className="text-sm text-neutral-500">
          Noch in Vorbereitung. Die Wiegedaten je Kiste laufen bereits ein
          (Erntewirtschaft → Ernte). Eine Auswertung je Feld und Tag folgt mit
          dem Feldstufen-/Prämiensystem.
        </p>
      </div>
    </div>
  );
}
