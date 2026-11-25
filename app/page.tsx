"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";

export default function Home() {
  const router = useRouter();
  const { loading, profile, userId } = useProfile();

  // Angemeldet, aber ohne (ladbares) Profil oder deaktiviert: Hinweis statt
  // Weiterleitung auf eine Seite, die dann endlos "Lädt…" zeigt.
  const ohneProfil = !loading && !!userId && !profile;
  const deaktiviert = !!profile && profile.aktiv === false;

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    if (!profile || profile.aktiv === false) return;
    // zeiterfassung hat kein eigenes Dashboard (Stundenerfassung ist schon
    // ihr einziger Arbeitsbereich), hausmeister genauso (nur Unterkunft),
    // waage genauso (nur der Kiosk-Bildschirm, Nutzer-Vorgabe 2026-10-27) -
    // alle anderen Rollen (inkl. erntewirtschaft, hat seit 2026-08-09 ein
    // eigenes Dashboard) landen auf ihrem rollenabhängigen Dashboard, siehe
    // app/dashboard/page.tsx.
    const start =
      // Startseite nach der HAUPTROLLE (profiles.role) - bei mehreren
      // Rollen wählt der Admin sie in der Nutzerverwaltung (Stufe 1).
      profile?.role === "zeiterfassung"
        ? "/erfassung"
        : profile?.role === "hausmeister"
          ? "/unterkunft/reparaturen"
          : profile?.role === "waage"
            ? "/erntewirtschaft/waage/kiosk"
            : "/dashboard";
    router.replace(start);
  }, [loading, profile, userId, router]);

  if (ohneProfil) {
    return (
      <p className="text-neutral-500">
        Für dein Konto ist noch kein Profil angelegt. Bitte wende dich an den
        Administrator.
      </p>
    );
  }
  if (deaktiviert) {
    return (
      <p className="text-neutral-500">
        Dein Konto ist deaktiviert. Bitte wende dich an den Administrator.
      </p>
    );
  }
  return <p className="text-neutral-500">Lädt…</p>;
}
