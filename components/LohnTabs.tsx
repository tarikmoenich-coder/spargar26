"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/uebersicht", label: "Lohnübersicht" },
  { href: "/vorschuesse", label: "Vorschüsse" },
  { href: "/auszahlungen", label: "Auszahlungen" },
];

export default function LohnTabs() {
  const pathname = usePathname();

  return (
    <div className="sticky top-14 z-40 -mt-6 flex gap-4 border-b border-neutral-200 bg-neutral-50 print:hidden">
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
