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
}

const items: NavItem[] = [
  { href: "/mitarbeiter", label: "Personal", roles: ["admin", "hr"] },
  {
    href: "/personalnummern",
    label: "Personalnummern",
    roles: ["admin", "hr"],
  },
  {
    href: "/erfassung",
    label: "Stundenerfassung",
    roles: ["admin", "hr", "zeiterfassung"],
  },
  {
    href: "/uebersicht",
    label: "Lohnübersicht",
    roles: ["admin", "hr", "lohnabrechnung", "pruefer", "management"],
  },
  {
    href: "/vorschuesse",
    label: "Vorschüsse",
    roles: ["admin", "kasse", "lohnabrechnung", "pruefer", "management"],
  },
  {
    href: "/kasse",
    label: "Kassenbuch",
    roles: ["admin", "kasse", "pruefer", "management"],
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
    <nav className="border-b border-neutral-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-emerald-800">Spargar</span>
          {items
            .filter(
              (item) =>
                item.roles === "all" ||
                (profile && item.roles.includes(profile.role))
            )
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm ${
                  pathname?.startsWith(item.href)
                    ? "font-semibold text-emerald-800"
                    : "text-neutral-600 hover:text-emerald-800"
                }`}
              >
                {item.label}
              </Link>
            ))}
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
