"use client";

import PageHeader from "@/components/PageHeader";
import { BarChart3 } from "lucide-react";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";

// Platzhalter (Stand 2026-08-09) - folgt, sobald Prämien -> Spargel steht.
export default function StatistikSpargelPage() {
  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={BarChart3} titel="Statistik – Spargel" />
        <p className="text-sm text-neutral-500">
          Noch in Vorbereitung - folgt, sobald Prämien → Spargel steht.
        </p>
      </div>
    </div>
  );
}
