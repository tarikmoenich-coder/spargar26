"use client";

import PageHeader from "@/components/PageHeader";
import { Award } from "lucide-react";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";

// Platzhalter (Stand 2026-08-09) - Struktur steht (Menü/Reiter), Aufbau
// folgt nach Klärung der Waage-Anbindung (Rohdaten kommen von einer
// externen Zwischenanwendung/Datenbank an der Waage) und der Feldstufen-
// Logik. Siehe Memory "praemien-spargel-erdbeeren-zuckermais".
export default function PraemienSpargelPage() {
  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={Award} titel="Prämien – Spargel" />
        <p className="text-sm text-neutral-500">
          Noch in Vorbereitung. Die Rohdaten kommen von der Waage
          (Zwischenanwendung mit eigener Datenbank) - die Anbindung wird als
          nächstes gemeinsam geklärt (Zugangsdaten, Feld-Zuordnung je
          Wiegung).
        </p>
      </div>
    </div>
  );
}
