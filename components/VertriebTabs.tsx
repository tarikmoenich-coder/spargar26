"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Vertriebsplanung (docs/vertriebsplanung-plan.md). Gleiches Reiter-Muster
// wie FahrzeugeTabs.
const tabs = [
  { href: "/vertrieb", label: "Stände", exakt: true },
  { href: "/vertrieb/karte", label: "Karte" },
  { href: "/vertrieb/touren", label: "Touren" },
  { href: "/vertrieb/verfuegbarkeit", label: "Verfügbarkeit" },
  { href: "/vertrieb/grundplan", label: "Grundplan" },
];

export default function VertriebTabs() {
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
      className="sticky top-14 z-40 -mt-6 flex gap-4 overflow-x-auto border-b border-linie bg-sand [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible print:hidden"
    >
      {tabs.map((tab) => {
        const aktiv = tab.exakt
          ? pathname === tab.href || (tab.href === "/vertrieb" && pathname === "/vertrieb/import")
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
