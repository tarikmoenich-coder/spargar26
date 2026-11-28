"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useProfile } from "@/lib/useProfile";
import { darf } from "@/lib/rollen";
import { uebersetzung, type TKey } from "@/lib/i18n";

interface Tab {
  href: string;
  label: TKey;
  // Recht (lesen), das den Reiter einblendet. "Lager" ist bewusst eigenes
  // Recht (Nutzer-Vorgabe 2026-08-25: "Den Lagerbestand soll nur 'admin und
  // hr' sehen und bearbeiten können. 'Stundenerfassung' macht nur die
  // Ausgabe").
  recht: string;
}

const tabs: Tab[] = [
  { href: "/erfassung", label: "tabs.erfassung", recht: "erfassung.stunden:L" },
  { href: "/erfassung-import", label: "tabs.import", recht: "erfassung.stunden:S" },
  { href: "/arbeitskleidung", label: "tabs.arbeitskleidung", recht: "erfassung.kleidung:L" },
  { href: "/lager", label: "tabs.lager", recht: "erfassung.lager:L" },
];

// Analog zu components/PersonalTabs.tsx - siehe dort für die Erklärung der
// ResizeObserver-Logik (schreibt die tatsächliche Höhe dieser Reiter-Leiste
// in eine CSS-Variable, damit darunterliegende Werkzeugleisten ihren
// sticky-Versatz exakt danach ausrichten können).
export default function ErfassungTabs() {
  const pathname = usePathname();
  const { profile } = useProfile();
  const t = uebersetzung(profile?.sprache);
  const sichtbareTabs = tabs.filter((tab) => darf(profile, tab.recht));
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
          {t(tab.label)}
        </Link>
      ))}
    </div>
  );
}
