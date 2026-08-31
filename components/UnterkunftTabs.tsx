"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useProfile } from "@/lib/useProfile";

// Unterkunft-Modul (Migration 2026-08-29): Zimmerplanung + Übergabe/Abnahme
// + Zwischenkontrollen + Mängel. Gleiches Tab-Muster wie PraemienTabs
// (siehe dort für die ResizeObserver-/--subtabs-h-Logik).
// nurHausmeister: der Hausmeister arbeitet über die Immobilien-Ansicht
// (Einzug/Auszug/Umzug/Belegen direkt am Zimmer) + Reparaturen; keine
// Zwischenkontrollen/Stammdaten (Vorgabe 2026-09-15).
const tabs = [
  { href: "/unterkunft/kontrollplan", label: "Kontrollplan" },
  { href: "/unterkunft", label: "Immobilien", exakt: true, nurHausmeister: true },
  {
    href: "/unterkunft/belegungsplan",
    label: "Belegungsplan",
    nurHausmeister: true,
  },
  { href: "/unterkunft/belegung", label: "Belegung" },
  { href: "/unterkunft/uebergabe", label: "Übergabe / Abnahme" },
  { href: "/unterkunft/kontrolle", label: "Zwischenkontrolle" },
  { href: "/unterkunft/maengel", label: "Mängel" },
  { href: "/unterkunft/reparaturen", label: "Reparaturen", nurHausmeister: true },
  { href: "/unterkunft/stammdaten", label: "Stammdaten" },
];

export default function UnterkunftTabs() {
  const pathname = usePathname();
  const { profile } = useProfile();
  const ref = useRef<HTMLDivElement>(null);

  const sichtbar =
    profile?.role === "hausmeister"
      ? tabs.filter((t) => t.nurHausmeister)
      : tabs;

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
      className="sticky top-14 z-40 -mt-6 flex gap-4 overflow-x-auto border-b border-neutral-200 bg-neutral-50 [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible print:hidden"
    >
      {sichtbar.map((tab) => {
        const aktiv = tab.exakt
          ? pathname === tab.href
          : pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2 text-sm ${
              aktiv
                ? "border-emerald-700 font-semibold text-emerald-800"
                : "border-transparent text-neutral-600 hover:text-emerald-800"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
