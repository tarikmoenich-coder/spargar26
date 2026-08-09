"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { SPRACHEN, type Sprache } from "@/lib/i18n";
import type { UserRole } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  roles: UserRole[] | "all";
  // Weitere Pfade, die diesen Menüpunkt ebenfalls als aktiv markieren sollen
  // (z.B. Unterseiten wie Personalnummern/Import unter "Personal").
  auchAktivBei?: string[];
}

const items: NavItem[] = [
  {
    href: "/dashboard",
    label: "Start",
    roles: ["admin", "hr", "kasse", "lohnabrechnung", "pruefer", "management"],
  },
  {
    href: "/mitarbeiter",
    label: "Personal",
    roles: ["admin", "hr"],
    auchAktivBei: [
      "/personalnummern",
      "/personal-import",
      "/personal-dokumente",
      "/personalplanung",
      "/personal-anreiseliste",
      "/personal-sozialversicherung",
    ],
  },
  {
    href: "/erfassung",
    label: "Stundenerfassung",
    roles: ["admin", "hr", "zeiterfassung"],
    auchAktivBei: ["/erfassung-import"],
  },
  {
    href: "/suche",
    label: "Suche",
    roles: "all",
  },
  {
    href: "/uebersicht",
    label: "Lohn",
    roles: ["admin", "hr", "kasse", "lohnabrechnung", "pruefer", "management"],
    auchAktivBei: ["/vorschuesse", "/auszahlungen"],
  },
  {
    href: "/kasse",
    label: "Kassenbuch",
    roles: ["admin", "kasse", "pruefer", "management"],
  },
  {
    href: "/management",
    label: "Management",
    roles: ["admin", "hr", "management"],
  },
  {
    href: "/einstellungen",
    label: "Einstellungen",
    roles: ["admin"],
  },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useProfile();

  // Verhindert, dass das Mausrad den Wert eines fokussierten Zahlenfelds
  // ändert (Browser-Standardverhalten bei input[type=number]) - führt sonst
  // dazu, dass z.B. beim Scrollen über die Stundenerfassung unbemerkt
  // Werte verändert werden. App-weit statt nur auf einer Seite, da dasselbe
  // Risiko auch bei anderen Zahlenfeldern (Beträge, Sätze) besteht. Der
  // Listener defokussiert nur - die normale Seiten-Scrollbewegung bleibt
  // unangetastet.
  useEffect(() => {
    function onWheel() {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number") {
        el.blur();
      }
    }
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  if (pathname === "/login") return null;

  async function logout() {
    await getSupabaseClient().auth.signOut();
    router.push("/login");
  }

  // Je Nutzer (nicht je Rolle) gespeichert, siehe profiles.sprache -
  // betrifft nur die Bedienoberfläche, keine Dokumente/Formulare
  // (Nutzer-Vorgabe 2026-08-08). Voller Reload nach dem Ändern, da
  // useProfile() auf jeder Seite unabhängig lädt (kein geteilter Kontext)
  // - so sehen Navigation UND aktuelle Seite garantiert konsistent die
  // neue Sprache.
  async function spracheAendern(neueSprache: Sprache) {
    if (!profile) return;
    await getSupabaseClient()
      .from("profiles")
      .update({ sprache: neueSprache })
      .eq("id", profile.id);
    window.location.reload();
  }

  return (
    <nav className="sticky top-0 z-50 h-14 border-b border-neutral-200 bg-white print:hidden">
      <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-emerald-800">Spargar</span>
          {items
            .filter(
              (item) =>
                item.roles === "all" ||
                (profile && item.roles.includes(profile.role))
            )
            .map((item) => {
              const aktiv =
                pathname?.startsWith(item.href) ||
                item.auchAktivBei?.some((p) => pathname?.startsWith(p));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm ${
                    aktiv
                      ? "font-semibold text-emerald-800"
                      : "text-neutral-600 hover:text-emerald-800"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          {profile && (
            <>
              <span>
                {profile.full_name} · <span className="italic">{profile.role}</span>
              </span>
              <select
                value={profile.sprache}
                onChange={(e) => spracheAendern(e.target.value as Sprache)}
                title="Sprache der Bedienoberfläche (nur für dich, betrifft keine Dokumente)"
                className="text-xs"
              >
                {SPRACHEN.map((s) => (
                  <option key={s.wert} value={s.wert}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <button className="btn-secondary" onClick={logout}>
            Abmelden
          </button>
        </div>
      </div>
    </nav>
  );
}
