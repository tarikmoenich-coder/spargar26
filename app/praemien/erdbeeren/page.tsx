"use client";

import PraemienTabs from "@/components/PraemienTabs";

// Platzhalter (Stand 2026-08-09) - Struktur steht (Menü/Reiter), Aufbau
// folgt nach gemeinsamem Deep-Dive in die bestehende Excel-Datei (mehrere
// Wiegungen je Mitarbeiter und Tag, andere Berechnungslogik als
// Spargel/Zuckermais).
export default function PraemienErdbeerenPage() {
  return (
    <div className="flex flex-col gap-4">
      <PraemienTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Prämien – Erdbeeren
        </h1>
        <p className="text-sm text-neutral-500">
          Noch in Vorbereitung. Läuft anders als Spargel/Zuckermais (mehrere
          Wiegungen je Mitarbeiter und Tag) - wird separat durchgesprochen.
        </p>
      </div>
    </div>
  );
}
