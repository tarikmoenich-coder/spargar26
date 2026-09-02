"use client";

import Link from "next/link";
import { Gauge } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";
import { useControllingCounts } from "@/lib/useControllingCounts";
import { MAX_STUNDEN_PRO_TAG } from "@/lib/controlling";

// Controlling-Übersicht (Nutzer-Vorgabe 2026-09-02): die früher eine lange
// Seite mit 6 aufklappbaren Blöcken ist jetzt eine Übersicht mit je einer
// Kachel pro Thema (To-Do-Zähler + Link) - die Listen selbst liegen auf
// eigenen Unterseiten, siehe components/ControllingTabs.tsx.
const KACHELN: {
  href: string;
  titel: string;
  zaehler: "anreiseliste" | "sv" | "stunden" | "serie" | "abweichungen" | "urlaub";
  beschreibung: string;
  einheit: string;
  ton: "rot" | "bernstein";
}[] = [
  {
    href: "/management/anreiseliste",
    titel: "Anreiseliste – offener Status",
    zaehler: "anreiseliste",
    beschreibung:
      "Personen, die bereits arbeiten, obwohl auf der Anreiseliste noch etwas offen ist.",
    einheit: "Personen",
    ton: "rot",
  },
  {
    href: "/management/sozialversicherung",
    titel: "Sozialversicherung (105-Tage)",
    zaehler: "sv",
    beschreibung:
      "Kritische Fälle: 15-Wochen-/SV-Freiheits-Grenze bereits überschritten.",
    einheit: "kritische Fälle",
    ton: "rot",
  },
  {
    href: "/management/stundenmonitoring",
    titel: "Stundenmonitoring",
    zaehler: "stunden",
    beschreibung: `Tage über ${MAX_STUNDEN_PRO_TAG} Stunden in der Stundenerfassung.`,
    einheit: "Tage",
    ton: "bernstein",
  },
  {
    href: "/management/arbeitstage",
    titel: "Arbeitstage am Stück",
    zaehler: "serie",
    beschreibung:
      "Serien ohne freien Tag (ab 7 gelb, ab 14 rot) inkl. Ersatzausgleich-Prüfung.",
    einheit: "Serien",
    ton: "rot",
  },
  {
    href: "/management/auszahlungs-abweichungen",
    titel: "Abweichungen bei Auszahlungen",
    zaehler: "abweichungen",
    beschreibung:
      "Abgerechnete Personen, bei denen sich seither ein Wert geändert hat.",
    einheit: "Personen",
    ton: "bernstein",
  },
  {
    href: "/management/urlaub",
    titel: "Urlaub",
    zaehler: "urlaub",
    beschreibung:
      "Überzogene Urlaubstage und offener Resturlaub (Abgeltung bei Inaktiven).",
    einheit: "Personen",
    ton: "rot",
  },
];

export default function ControllingUebersichtPage() {
  const counts = useControllingCounts();

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={Gauge}
        titel="Controlling"
        beschreibung="Offene Punkte je Thema – die Zähler zeigen den Handlungsbedarf für das laufende Jahr. Jede Liste ist als eigener Reiter erreichbar."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KACHELN.map((k) => {
          const n = counts[k.zaehler];
          const farbe = counts.loading
            ? "text-neutral-400"
            : n === 0
              ? "text-emerald-700"
              : k.ton === "bernstein"
                ? "text-amber-600"
                : "text-red-600";
          return (
            <Link
              key={k.href}
              href={k.href}
              className="card flex flex-col gap-1 transition hover:border-emerald-300 hover:shadow-md"
            >
              <span className="text-sm font-semibold text-emerald-900">
                {k.titel}
              </span>
              <span className={`text-2xl font-semibold ${farbe}`}>
                {counts.loading ? "…" : `${n} ${k.einheit}`}
              </span>
              <span className="text-sm text-neutral-500">{k.beschreibung}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
