"use client";

// Reiter für den Einstellungen-Bereich (Nutzer-Vorgabe: aufteilen, "da hängt
// jetzt zuviel untereinander"). Allgemein = Firmen-Bankdaten +
// Verpflegung/Unterkunft/Mindestlohn/Arbeitskleidung; dazu je ein eigener
// Reiter für Arbeitsgruppen, Herkünfte und Nutzer & Rollen.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import { useEffect, useRef } from "react";

const tabs = [
  { href: "/einstellungen", label: "Allgemein" },
  { href: "/einstellungen/arbeitsgruppen", label: "Arbeitsgruppen" },
  { href: "/einstellungen/herkuenfte", label: "Herkünfte" },
  { href: "/einstellungen/nutzer", label: "Nutzer & Rollen" },
];

export default function EinstellungenTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useProfile();
  // Rolle "zeiterfassung" darf in den Einstellungen NUR die Arbeitsgruppen
  // pflegen (Nutzer-Vorgabe 2026-09-21): andere Reiter ausblenden und
  // direkte Aufrufe auf die Arbeitsgruppen umleiten.
  const nurGruppen = profile?.role === "zeiterfassung";
  useEffect(() => {
    if (nurGruppen && pathname !== "/einstellungen/arbeitsgruppen") {
      router.replace("/einstellungen/arbeitsgruppen");
    }
  }, [nurGruppen, pathname, router]);
  const sichtbar = nurGruppen
    ? tabs.filter((tab) => tab.href === "/einstellungen/arbeitsgruppen")
    : tabs;
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
      className="sticky top-14 z-40 -mt-6 flex gap-4 border-b border-linie bg-sand print:hidden"
    >
      {sichtbar.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`-mb-px border-b-2 pb-2 text-sm ${
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
