"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
    roles: [
      "admin",
      "hr",
      "kasse",
      "lohnabrechnung",
      "pruefer",
      "management",
      "erntewirtschaft",
    ],
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
    href: "/unterkunft",
    label: "Unterkunft",
    // hausmeister sieht ausschliesslich dieses Modul (nur Reparaturen, Vorgabe
    // 2026-09-15). erntewirtschaft nur lesend (Durchsetzung via RLS).
    roles: ["admin", "hr", "erntewirtschaft", "hausmeister"],
  },
  {
    href: "/erfassung",
    label: "Stundenerfassung",
    roles: ["admin", "hr", "zeiterfassung"],
    auchAktivBei: ["/erfassung-import", "/arbeitskleidung", "/lager"],
  },
  {
    href: "/suche",
    label: "Suche",
    // Alle ausser hausmeister (der sieht nur Reparaturen, Vorgabe 2026-09-15).
    roles: [
      "admin",
      "hr",
      "zeiterfassung",
      "kasse",
      "lohnabrechnung",
      "pruefer",
      "management",
      "erntewirtschaft",
    ],
  },
  {
    href: "/uebersicht",
    label: "Lohn",
    roles: ["admin", "hr", "kasse", "lohnabrechnung", "pruefer", "management"],
    auchAktivBei: ["/vorschuesse", "/auszahlungen"],
  },
  {
    href: "/praemien/zuckermais",
    label: "Prämien",
    roles: [
      "admin",
      "hr",
      "zeiterfassung",
      "lohnabrechnung",
      "management",
      "erntewirtschaft",
    ],
    auchAktivBei: ["/praemien"],
  },
  {
    href: "/anbau/erdbeeren",
    label: "Anbau",
    // Nutzer-Vorgabe 2026-08-11: nur admin und erntewirtschaft - die
    // Anbauplanung ist deren Arbeitsbereich.
    roles: ["admin", "erntewirtschaft"],
    auchAktivBei: ["/anbau"],
  },
  {
    href: "/statistik/zuckermais",
    label: "Statistik",
    roles: ["admin", "hr", "lohnabrechnung", "management", "erntewirtschaft"],
    auchAktivBei: ["/statistik"],
  },
  {
    href: "/kasse",
    label: "Kassenbuch",
    roles: ["admin", "kasse", "pruefer", "management"],
    auchAktivBei: ["/kasse-pruefung"],
  },
  {
    href: "/management",
    label: "Controlling",
    roles: ["admin", "hr", "management"],
  },
  {
    href: "/aenderungsprotokoll",
    label: "Protokoll",
    roles: ["admin"],
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
  // Unter `lg` (Telefon/kleines Tablet) sind die Bereichs-Links + Name/Rolle
  // + Sprache + Abmelden in eine Schublade ausgelagert - vorher lagen alle
  // ~13 Links plus der Rolle-Block in einer festen 56px-Zeile und
  // überlappten am Telefon (Nutzer-Vorgabe 2026-09-01).
  const [menuOffen, setMenuOffen] = useState(false);

  // Beim Seitenwechsel die Schublade schließen.
  useEffect(() => {
    setMenuOffen(false);
  }, [pathname]);

  // Body-Scroll sperren, solange die Schublade offen ist.
  useEffect(() => {
    if (!menuOffen) return;
    const vorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = vorher;
    };
  }, [menuOffen]);

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

  const sichtbareItems = items.filter(
    (item) =>
      item.roles === "all" ||
      (profile && item.roles.includes(profile.role))
  );
  const istAktiv = (item: NavItem) =>
    !!(
      pathname?.startsWith(item.href) ||
      item.auchAktivBei?.some((p) => pathname?.startsWith(p))
    );
  const aktuellerBereich = sichtbareItems.find(istAktiv);

  const sprachWahl = profile && (
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
  );

  return (
    <>
      <nav className="sticky top-0 z-50 h-14 border-b border-neutral-200 bg-white print:hidden">
        <div className="mx-auto flex h-full max-w-[1800px] items-center gap-4 px-4">
          <span className="shrink-0 font-semibold text-emerald-800">Spargar</span>

          {/* Ab lg: alle Links inline */}
          <div className="hidden flex-1 items-center gap-4 overflow-x-auto lg:flex [scrollbar-width:thin]">
            {sichtbareItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap text-sm ${
                  istAktiv(item)
                    ? "font-semibold text-emerald-800"
                    : "text-neutral-600 hover:text-emerald-800"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="hidden shrink-0 items-center gap-3 text-sm text-neutral-600 lg:flex">
            {profile && (
              <>
                <span>
                  {profile.full_name} ·{" "}
                  <span className="italic">{profile.role}</span>
                </span>
                {sprachWahl}
              </>
            )}
            <button className="btn-secondary" onClick={logout}>
              Abmelden
            </button>
          </div>

          {/* Unter lg: aktueller Bereich + Menü-Knopf */}
          <div className="flex flex-1 items-center justify-end gap-3 lg:hidden">
            {aktuellerBereich && (
              <span className="truncate text-sm font-semibold text-emerald-800">
                {aktuellerBereich.label}
              </span>
            )}
            <button
              type="button"
              aria-label="Menü"
              aria-expanded={menuOffen}
              className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-lg leading-none text-neutral-700"
              onClick={() => setMenuOffen((v) => !v)}
            >
              ☰
            </button>
          </div>
        </div>
      </nav>

      {menuOffen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMenuOffen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold text-emerald-800">Menü</span>
              <button
                type="button"
                aria-label="Menü schließen"
                className="text-neutral-500"
                onClick={() => setMenuOffen(false)}
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {sichtbareItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded px-2 py-2 text-sm ${
                    istAktiv(item)
                      ? "bg-emerald-50 font-semibold text-emerald-800"
                      : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            {profile && (
              <div className="mt-4 border-t border-neutral-200 pt-4 text-sm text-neutral-600">
                <div className="mb-3">
                  {profile.full_name} ·{" "}
                  <span className="italic">{profile.role}</span>
                </div>
                <label className="mb-3 flex items-center gap-2">
                  Sprache
                  {sprachWahl}
                </label>
                <button
                  className="btn-secondary w-full"
                  onClick={logout}
                >
                  Abmelden
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
