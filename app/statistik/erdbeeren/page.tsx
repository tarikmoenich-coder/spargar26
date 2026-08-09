"use client";

import StatistikTabs from "@/components/StatistikTabs";

// Platzhalter (Stand 2026-08-09) - folgt, sobald Prämien -> Erdbeeren steht.
export default function StatistikErdbeerenPage() {
  return (
    <div className="flex flex-col gap-4">
      <StatistikTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Statistik – Erdbeeren
        </h1>
        <p className="text-sm text-neutral-500">
          Noch in Vorbereitung - folgt, sobald Prämien → Erdbeeren steht.
        </p>
      </div>
    </div>
  );
}
