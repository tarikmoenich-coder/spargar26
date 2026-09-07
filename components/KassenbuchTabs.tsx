"use client";

// Reiter für den Kassenbuch-Bereich. Seit den mehreren Kassenbüchern
// (Migration 2026-10-03) listet die Leiste zusätzlich jedes Buch: die
// "Mömmel Lohnkasse" führt auf das bestehende Journal (/kasse), die übrigen
// Bücher auf ihre eigene Unterseite (/kasse/<id>). Die ResizeObserver-Logik
// schreibt weiterhin die tatsächliche Höhe der Leiste in --subtabs-h, damit
// darunterliegende sticky-Werkzeugleisten ihren Versatz danach ausrichten.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Kassenbuch } from "@/lib/types";

export default function KassenbuchTabs({
  aktivBuchId,
}: {
  /** Vom jeweiligen Buch-Journal gesetzt, damit der richtige Reiter aktiv
   *  ist (der Query-Parameter ?id= steckt nicht im pathname). */
  aktivBuchId?: number;
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const [buecher, setBuecher] = useState<Kassenbuch[]>([]);

  useEffect(() => {
    getSupabaseClient()
      .from("kassenbuch")
      .select("*")
      .eq("aktiv", true)
      .order("reihenfolge")
      .then(({ data }) => setBuecher((data as Kassenbuch[]) ?? []));
  }, []);

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
  }, [buecher.length]);

  const buchHref = (b: Kassenbuch) =>
    b.typ === "lohnkasse" ? "/kasse" : `/kasse/buch?id=${b.id}`;

  const tabs: { href: string; label: string; aktiv: boolean }[] = [
    {
      href: "/kasse/uebersicht",
      label: "Übersicht",
      aktiv: pathname === "/kasse/uebersicht",
    },
    ...buecher.map((b) => ({
      href: buchHref(b),
      label: b.bezeichnung,
      aktiv:
        b.typ === "lohnkasse"
          ? pathname === "/kasse"
          : pathname === "/kasse/buch" && aktivBuchId === b.id,
    })),
    {
      href: "/kasse-pruefung",
      label: "Kassenprüfung",
      aktiv: pathname === "/kasse-pruefung",
    },
  ];

  return (
    <div
      ref={ref}
      className="sticky top-14 z-40 -mt-6 flex flex-wrap gap-4 border-b border-linie bg-sand print:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`-mb-px border-b-2 pb-2 text-sm ${
            tab.aktiv
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
