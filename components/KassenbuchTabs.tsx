"use client";

// Nutzer-Vorgabe 2026-08-24 ("Eventuell verdient das Kassenbuch auch
// Untermenüpunkte" - beim Wunsch nach einem Journal mit laufendem Saldo,
// damit die Seite dadurch nicht überladen wird): gleiches Muster wie
// LohnTabs/PersonalTabs/StatistikTabs - zwei eigenständige Routen statt
// alles auf einer Seite.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const tabs = [
  { href: "/kasse", label: "Journal" },
  { href: "/kasse-pruefung", label: "Kassenprüfung" },
];

export default function KassenbuchTabs() {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // Schreibt die tatsächliche Höhe dieser Reiter-Leiste in eine CSS-Variable,
  // damit darunterliegende Werkzeugleisten (Filter) ihren sticky-Versatz
  // exakt danach ausrichten können - statt einen festen Pixelwert zu raten,
  // der bei jeder Design-Änderung wieder eine Lücke reißen würde.
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
