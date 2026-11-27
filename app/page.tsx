"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import { darfMenue, ersteSeite } from "@/lib/rollen";

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
    // Startseite nach Rechten: wer Büro-Übersichten hat, landet auf der
    // Startseite; reine Erfassungs-, Hausmeister- oder Waagen-Rollen direkt
    // auf ihrer Arbeitsseite (lib/rollen.ts ersteSeite).
    const start = darfMenue(profile, "/dashboard") ? "/dashboard" : ersteSeite(profile)?.href ?? "/dashboard";
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
