"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/mitarbeiter", label: "Personalstamm" },
  { href: "/personalnummern", label: "Personalnummern" },
  { href: "/personal-import", label: "Import" },
];

export default function PersonalTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-4 border-b border-neutral-200 print:hidden">
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
