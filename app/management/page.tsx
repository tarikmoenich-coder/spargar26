"use client";

import Link from "next/link";
import { ArrowRight, CalendarRange, ClipboardList, Clock, Gauge, Palmtree, Receipt, ShieldAlert, type LucideIcon } from "lucide-react";
import { KarteRahmen, SYMBOL_FARBE } from "@/components/Uebersicht";
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
  icon: LucideIcon;
}[] = [
  {
    href: "/management/anreiseliste",
    icon: ClipboardList,
    titel: "Anreiseliste – offener Status",
    zaehler: "anreiseliste",
    beschreibung:
      "Personen, die bereits arbeiten, obwohl auf der Anreiseliste noch etwas offen ist.",
    einheit: "Personen",
    ton: "rot",
  },
  {
    href: "/management/sozialversicherung",
    icon: ShieldAlert,
    titel: "Sozialversicherung (105-Tage)",
    zaehler: "sv",
    beschreibung:
      "Kritische Fälle: 15-Wochen-/SV-Freiheits-Grenze bereits überschritten.",
    einheit: "kritische Fälle",
    ton: "rot",
  },
  {
    href: "/management/stundenmonitoring",
    icon: Clock,
    titel: "Stundenmonitoring",
    zaehler: "stunden",
    beschreibung: `Tage über ${MAX_STUNDEN_PRO_TAG} Stunden in der Stundenerfassung.`,
    einheit: "Tage",
    ton: "bernstein",
  },
  {
    href: "/management/arbeitstage",
    icon: CalendarRange,
    titel: "Arbeitstage am Stück",
    zaehler: "serie",
    beschreibung:
      "Serien ohne freien Tag (ab 7 gelb, ab 14 rot) inkl. Ersatzausgleich-Prüfung.",
    einheit: "Serien",
    ton: "rot",
  },
  {
    href: "/management/auszahlungs-abweichungen",
    icon: Receipt,
    titel: "Abweichungen bei Auszahlungen",
    zaehler: "abweichungen",
    beschreibung:
      "Abgerechnete Personen, bei denen sich seither ein Wert geändert hat.",
    einheit: "Personen",
    ton: "bernstein",
  },
  {
    href: "/management/urlaub",
    icon: Palmtree,
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
        beschreibung="Offene Punkte je Thema. Sozialversicherung, Stunden, Abweichungen und Urlaub beziehen sich auf das laufende Saisonjahr; Anreiseliste und Arbeitstage am Stück auf den aktuellen Stand. Jede Liste ist als eigener Reiter erreichbar."
      />

      {counts.fehler && (
        <p className="text-sm text-beere-600">
          ⚠ Einige Zähler konnten nicht geladen werden ({counts.fehler}).
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KACHELN.map((k) => {
          const n = counts[k.zaehler];
          const offen = !counts.loading && n > 0;
          const farbe = counts.loading
            ? "text-neutral-300"
            : n === 0
              ? "text-emerald-700"
              : k.ton === "bernstein"
                ? "text-amber-700"
                : "text-beere-700";
          const Icon = k.icon;
          return (
            <Link key={k.href} href={k.href} className="group block">
              <KarteRahmen className="flex h-full flex-col transition group-hover:border-emerald-300 group-hover:shadow-md">
                <div className="flex items-center gap-2">
                  <span className={`rounded-lg p-2 ${SYMBOL_FARBE[!offen ? "gruen" : k.ton === "bernstein" ? "gelb" : "rot"]}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <h2 className="font-semibold text-neutral-900">{k.titel}</h2>
                  <span className={`ml-auto text-2xl font-semibold tabular-nums ${farbe}`}>
                    {counts.loading ? "…" : n}
                  </span>
                </div>
                <p className="mt-2 text-sm text-neutral-500">{k.beschreibung}</p>
                <p className={`mt-1 text-sm font-medium ${offen ? farbe : "text-emerald-700"}`}>
                  {counts.loading ? "" : n === 0 ? "Nichts offen" : `${n} ${k.einheit}`}
                </p>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium text-emerald-700 group-hover:underline">
                  Liste öffnen <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </KarteRahmen>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
