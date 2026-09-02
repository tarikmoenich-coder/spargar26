"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useProfile } from "@/lib/useProfile";
import type { UserRole } from "@/lib/types";

interface Tab {
  href: string;
  label: string;
  // Fehlt roles, sehen alle Rollen mit Zugriff auf diesen Reiter-Bereich
  // den Tab (bisheriges Verhalten). "Lager" ist bewusst enger (Nutzer-
  // Vorgabe 2026-08-25: "Den Lagerbestand soll nur 'admin und hr' sehen
  // und bearbeiten können. 'Stundenerfassung' macht nur die Ausgabe") -
  // zeiterfassung soll den Tab gar nicht erst sehen, nicht nur eine
  // "keine Berechtigung"-Seite dahinter finden.
  roles?: UserRole[];
}

const tabs: Tab[] = [
  { href: "/erfassung", label: "Erfassung" },
  { href: "/erfassung-import", label: "Import" },
  { href: "/arbeitskleidung", label: "Arbeitskleidung" },
  { href: "/lager", label: "Lager", roles: ["admin", "hr"] },
];

// Analog zu components/PersonalTabs.tsx - siehe dort für die Erklärung der
// ResizeObserver-Logik (schreibt die tatsächliche Höhe dieser Reiter-Leiste
// in eine CSS-Variable, damit darunterliegende Werkzeugleisten ihren
// sticky-Versatz exakt danach ausrichten können).
export default function ErfassungTabs() {
  const pathname = usePathname();
  const { profile } = useProfile();
  const sichtbareTabs = tabs.filter(
    (tab) => !tab.roles || (profile && tab.roles.includes(profile.role))
  );
  const ref = useRef<HTMLDivElement>(null);

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
      {sichtbareTabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`-mb-px whitespace-nowrap border-b-2 pb-2 text-sm ${
            pathname === tab.href
              ? "border-emerald-700 font-semibold text-emerald-800"
              : "border-transparent text-neutral-600 hover:text-emerald-800"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
