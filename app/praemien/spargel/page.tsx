"use client";

import PageHeader from "@/components/PageHeader";
import { Award } from "lucide-react";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";

// Platzhalter - die Wiegungen kommen inzwischen direkt von der Hofwaage
// (Erntewirtschaft → Ernte/Waage). Offen ist die Prämienberechnung selbst
// (Feldstufen/Boni, Teil F2 in docs/erntewirtschaft-plan.md).
export default function PraemienSpargelPage() {
  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={Award} titel="Prämien – Spargel" />
        <p className="text-sm text-neutral-500">
          Noch in Vorbereitung. Die Wiegungen kommen bereits direkt von der
          Hofwaage (Erntewirtschaft → Ernte/Waage); die Spargel-Prämie
          (Feldstufen/Boni, Teil F2 der Planung) ist noch nicht gebaut.
        </p>
      </div>
    </div>
  );
}
