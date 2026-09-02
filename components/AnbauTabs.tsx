"use client";

// Reiter innerhalb des Menüpunkts "Anbau" (Nutzer-Vorgabe 2026-08-11) -
// gleiches Muster wie PersonalTabs/PraemienTabs.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const tabs = [
  { href: "/anbau/erdbeeren", label: "Erdbeeren" },
  { href: "/anbau/bestellung", label: "Bestellung" },
  { href: "/anbau/felder", label: "Felder" },
];

export default function AnbauTabs() {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // Höhe dieser Leiste in eine CSS-Variable schreiben, damit darunter
  // liegende sticky-Werkzeugleisten ihren Versatz exakt danach ausrichten
  // (gleiches Vorgehen wie bei den anderen Reiterleisten).
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
