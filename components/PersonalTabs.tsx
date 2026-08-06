"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const tabs = [
  { href: "/personalplanung", label: "Planung" },
  { href: "/personal-anreiseliste", label: "Anreiseliste" },
  { href: "/mitarbeiter", label: "Personalstamm" },
  { href: "/personal-dokumente", label: "Dokumente" },
  { href: "/personalnummern", label: "Personalnummern" },
  { href: "/personal-import", label: "Import" },
];

export default function PersonalTabs() {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // Schreibt die tatsächliche Höhe dieser Reiter-Leiste in eine CSS-Variable,
  // damit darunterliegende Werkzeugleisten (Suche, Filter) ihren sticky-
  // Versatz exakt danach ausrichten können - statt einen festen Pixelwert
  // zu raten, der bei jeder Design-Änderung wieder eine Lücke reißen würde.
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
      className="sticky top-14 z-40 -mt-6 flex gap-4 border-b border-neutral-200 bg-neutral-50 print:hidden"
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
