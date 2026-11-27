"use client";

// Reiter für den Einstellungen-Bereich (Nutzer-Vorgabe: aufteilen, "da hängt
// jetzt zuviel untereinander"). Allgemein = Firmen + Sätze (Landwirtschaft/
// Standard und Vertrieb); dazu je ein eigener Reiter für Arbeitsgruppen,
// Herkünfte, Einsatzbereiche und Nutzer & Rollen.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import { useEffect, useRef } from "react";

import { darf, istAdmin } from "@/lib/rollen";
import type { Profile } from "@/lib/types";

// Je Reiter das nötige Recht. "Nutzer & Rollen" nur für den echten
// Administrator (nicht Geschäftsführer, Nutzer-Vorgabe 2026-11-27).
const tabs: { href: string; label: string; sichtbar: (p: Profile | null) => boolean }[] = [
  { href: "/einstellungen", label: "Allgemein", sichtbar: (p) => darf(p, "einstellungen.grund:S") },
  { href: "/einstellungen/arbeitsgruppen", label: "Arbeitsgruppen", sichtbar: (p) => darf(p, "erfassung.gruppen:S") },
  { href: "/einstellungen/herkuenfte", label: "Herkünfte", sichtbar: (p) => darf(p, "einstellungen.grund:S") },
  { href: "/einstellungen/einsatzbereiche", label: "Einsatzbereiche", sichtbar: (p) => darf(p, "einstellungen.grund:S") },
  { href: "/einstellungen/nutzer", label: "Nutzer & Rollen", sichtbar: (p) => istAdmin(p) },
];

export default function EinstellungenTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useProfile();
  // Nur Reiter mit Recht zeigen; direkte Aufrufe eines anderen Reiters auf
  // den ersten erlaubten umleiten (z.B. Stundenerfassung: nur Arbeitsgruppen,
  // Nutzer-Vorgabe 2026-09-21).
  const sichtbar = profile ? tabs.filter((tab) => tab.sichtbar(profile)) : [];
  const ziel =
    profile && sichtbar.length > 0 && !sichtbar.some((t) => t.href === pathname) ? sichtbar[0].href : null;
  useEffect(() => {
    if (ziel) router.replace(ziel);
  }, [ziel, router]);
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
      {sichtbar.map((tab) => (
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
