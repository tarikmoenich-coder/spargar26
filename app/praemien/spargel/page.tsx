"use client";

import PraemienTabs from "@/components/PraemienTabs";

// Platzhalter (Stand 2026-08-09) - Struktur steht (Menü/Reiter), Aufbau
// folgt nach Klärung der Waage-Anbindung (Rohdaten kommen von einer
// externen Zwischenanwendung/Datenbank an der Waage) und der Feldstufen-
// Logik. Siehe Memory "praemien-spargel-erdbeeren-zuckermais".
export default function PraemienSpargelPage() {
  return (
    <div className="flex flex-col gap-4">
      <PraemienTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Prämien – Spargel
        </h1>
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
