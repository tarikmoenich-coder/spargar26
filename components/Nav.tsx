"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
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
    href: "/mitarbeiter",
    label: "Personal",
    roles: ["admin", "hr"],
    auchAktivBei: ["/personalnummern", "/personal-import", "/personal-dokumente"],
  },
  {
    href: "/erfassung",
    label: "Stundenerfassung",
    roles: ["admin", "hr", "zeiterfassung"],
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

  if (pathname === "/login") return null;

  async function logout() {
    await getSupabaseClient().auth.signOut();
    router.push("/login");
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
            <span>
              {profile.full_name} · <span className="italic">{profile.role}</span>
            </span>
          )}
          <button className="btn-secondary" onClick={logout}>
            Abmelden
          </button>
        </div>
      </div>
    </nav>
  );
}
