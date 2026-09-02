"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  useControllingCounts,
  type ControllingCounts,
} from "@/lib/useControllingCounts";

// Controlling-Unterseiten. Jede früher aufklappbare Liste ist jetzt eine
// eigene Seite (Nutzer-Vorgabe 2026-09-02: "jede ausklappbare Liste braucht
// einen eigenen Untermenüpunkt"). Zähler-Badge je Reiter = Handlungsbedarf
// im laufenden Jahr.
type ZaehlerKey = keyof Omit<ControllingCounts, "loading">;

interface ControllingTab {
  href: string;
  label: string;
  exakt?: boolean;
  zaehler?: ZaehlerKey;
}

const tabs: ControllingTab[] = [
  { href: "/management", label: "Übersicht", exakt: true },
  {
    href: "/management/anreiseliste",
    label: "Anreiseliste",
    zaehler: "anreiseliste",
  },
  {
    href: "/management/sozialversicherung",
    label: "Sozialversicherung",
    zaehler: "sv",
  },
  {
    href: "/management/stundenmonitoring",
    label: "Stundenmonitoring",
    zaehler: "stunden",
  },
  {
    href: "/management/arbeitstage",
    label: "Arbeitstage am Stück",
    zaehler: "serie",
  },
  {
    href: "/management/auszahlungs-abweichungen",
    label: "Auszahlungs-Abweichungen",
    zaehler: "abweichungen",
  },
  { href: "/management/urlaub", label: "Urlaub", zaehler: "urlaub" },
];

// bernstein statt rot für "Tage über 12 Std." - das ist ein Hinweis, kein
// harter Verstoß wie eine überschrittene SV-Grenze.
const BERNSTEIN_ZAEHLER = new Set(["stunden"]);

export default function ControllingTabs() {
  const pathname = usePathname();
  const counts = useControllingCounts();
  const ref = useRef<HTMLDivElement>(null);

  // Schreibt die tatsächliche Höhe dieser Reiter-Leiste in eine CSS-Variable,
  // damit darunterliegende sticky-Werkzeugleisten (Saison-Jahr) ihren
  // Versatz exakt danach ausrichten können.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const setzeHoehe = () => {
      document.documentElement.style.setProperty(
        "--subtabs-h",
        `${el.offsetHeight}px`
      );
    };
    setzeHoehe();
    const observer = new ResizeObserver(setzeHoehe);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="sticky top-14 z-40 -mt-6 flex gap-4 overflow-x-auto border-b border-linie bg-sand [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible print:hidden"
    >
      {tabs.map((tab) => {
        const aktiv = tab.exakt
          ? pathname === tab.href
          : pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
        const n = tab.zaehler ? counts[tab.zaehler] : null;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 text-sm ${
              aktiv
                ? "border-emerald-700 font-semibold text-emerald-800"
                : "border-transparent text-neutral-600 hover:text-emerald-800"
            }`}
          >
            {tab.label}
            {tab.zaehler && !counts.loading && typeof n === "number" && (
              <span
                className={`rounded-full px-1.5 text-xs font-medium ${
                  n === 0
                    ? "bg-neutral-100 text-neutral-500"
                    : BERNSTEIN_ZAEHLER.has(tab.zaehler)
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
