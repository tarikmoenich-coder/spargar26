"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Prämien (Nutzer-Vorgabe 2026-08-09): Spargel/Erdbeeren/Zuckermais,
// ersetzt schrittweise die drei bisherigen Excel-Dateien. Start mit
// Zuckermais - Spargel/Erdbeeren zunächst als "in Vorbereitung"-
// Platzhalter. Gleiches Muster wie LohnTabs/ErfassungTabs - siehe dort für
// die Erklärung der ResizeObserver-Logik.
const tabs = [
  { href: "/praemien/zuckermais", label: "Zuckermais" },
  { href: "/praemien/spargel", label: "Spargel" },
  { href: "/praemien/erdbeeren", label: "Erdbeeren" },
];

export default function PraemienTabs() {
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
