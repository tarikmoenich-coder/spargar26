"use client";

// Gemeinsame Reiter für den Menüpunkt "Erntewirtschaft" (Nutzer-Vorgabe:
// Prämien, Anbau und Statistik unter einem Menüpunkt). Zwei Ebenen:
//   Zeile 1 = Bereich (Prämien / Anbau / Statistik) - je nach Rolle gefiltert
//   Zeile 2 = Unterreiter des aktiven Bereichs (Kulturen bzw. Bestellung/Felder)
// Ersetzt die früheren PraemienTabs / AnbauTabs / StatistikTabs.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useProfile } from "@/lib/useProfile";
import { MENUE_RECHTE } from "@/lib/rollen";
import type { UserRole } from "@/lib/types";

type BereichKey = "praemien" | "anbau" | "statistik";

const BEREICHE: {
  key: BereichKey;
  label: string;
  href: string; // Standard-Unterseite
  prefix: string;
  rechteKey: string; // Schlüssel in MENUE_RECHTE
  unter: { href: string; label: string }[];
}[] = [
  {
    key: "praemien",
    label: "Prämien",
    href: "/praemien/zuckermais",
    prefix: "/praemien",
    rechteKey: "/praemien/zuckermais",
    unter: [
      { href: "/praemien/zuckermais", label: "Zuckermais" },
      { href: "/praemien/spargel", label: "Spargel" },
      { href: "/praemien/erdbeeren", label: "Erdbeeren" },
      { href: "/praemien/gruppenaufteilung", label: "Gruppenaufteilung" },
    ],
  },
  {
    key: "anbau",
    label: "Anbau",
    href: "/anbau/erdbeeren",
    prefix: "/anbau",
    rechteKey: "/anbau/erdbeeren",
    unter: [
      { href: "/anbau/erdbeeren", label: "Erdbeeren" },
      { href: "/anbau/bestellung", label: "Bestellung" },
      { href: "/anbau/felder", label: "Felder" },
    ],
  },
  {
    key: "statistik",
    label: "Statistik",
    href: "/statistik/zuckermais",
    prefix: "/statistik",
    rechteKey: "/statistik/zuckermais",
    unter: [
      { href: "/statistik/zuckermais", label: "Zuckermais" },
      { href: "/statistik/spargel", label: "Spargel" },
      { href: "/statistik/erdbeeren", label: "Erdbeeren" },
    ],
  },
];

export default function ErntewirtschaftTabs() {
  const pathname = usePathname();
  const { profile } = useProfile();
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

  const rolle = profile?.role as UserRole | undefined;
  const sichtbar = BEREICHE.filter(
    (b) => !!rolle && (MENUE_RECHTE[b.rechteKey] ?? []).includes(rolle)
  );
  const aktiv = sichtbar.find((b) => pathname?.startsWith(b.prefix));

  const linkCls = (an: boolean) =>
    `-mb-px border-b-2 pb-2 text-sm ${
      an
        ? "border-emerald-700 font-semibold text-emerald-800"
        : "border-transparent text-neutral-600 hover:text-emerald-800"
    }`;

  return (
    <div
      ref={ref}
      className="sticky top-14 z-40 -mt-6 flex flex-col bg-sand print:hidden"
    >
      <div className="flex gap-4 border-b border-linie">
        {sichtbar.map((b) => (
          <Link key={b.key} href={b.href} className={linkCls(aktiv?.key === b.key)}>
            {b.label}
          </Link>
        ))}
      </div>
      {aktiv && aktiv.unter.length > 0 && (
        <div className="flex gap-3 border-b border-linie py-1 pl-1">
          {aktiv.unter.map((u) => (
            <Link
              key={u.href}
              href={u.href}
              className={`text-xs ${
                pathname === u.href
                  ? "font-semibold text-emerald-800"
                  : "text-neutral-500 hover:text-emerald-800"
              }`}
            >
              {u.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
