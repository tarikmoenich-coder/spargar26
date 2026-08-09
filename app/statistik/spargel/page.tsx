"use client";

import StatistikTabs from "@/components/StatistikTabs";

// Platzhalter (Stand 2026-08-09) - folgt, sobald Prämien -> Spargel steht.
export default function StatistikSpargelPage() {
  return (
    <div className="flex flex-col gap-4">
      <StatistikTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Statistik – Spargel
        </h1>
        <p className="text-sm text-neutral-500">
          Noch in Vorbereitung - folgt, sobald Prämien → Spargel steht.
        </p>
      </div>
    </div>
  );
}
