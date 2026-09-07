"use client";

// Reiter für den Einstellungen-Bereich (Nutzer-Vorgabe: aufteilen, "da hängt
// jetzt zuviel untereinander"). Allgemein = Firmen-Bankdaten +
// Verpflegung/Unterkunft/Mindestlohn/Arbeitskleidung; dazu je ein eigener
// Reiter für Arbeitsgruppen, Herkünfte und Nutzer & Rollen.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const tabs = [
  { href: "/einstellungen", label: "Allgemein" },
  { href: "/einstellungen/arbeitsgruppen", label: "Arbeitsgruppen" },
  { href: "/einstellungen/herkuenfte", label: "Herkünfte" },
  { href: "/einstellungen/nutzer", label: "Nutzer & Rollen" },
];

export default function EinstellungenTabs() {
  const pathname = usePathname();
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
      {tabs.map((tab) => (
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
