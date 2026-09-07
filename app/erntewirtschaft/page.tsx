"use client";

// Sammel-Menüpunkt "Erntewirtschaft" (Prämien / Anbau / Statistik). Diese
// Route hat noch keine eigene Übersicht - sie leitet auf den ersten Bereich
// weiter, in den die Rolle darf. Die Bereichs-/Unterreiter stehen in
// components/ErntewirtschaftTabs.tsx. Wird das große Erntewirtschaft-Modul
// (Spargelspinnen) gebaut, bekommt es hier eine echte Startseite.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import { MENUE_RECHTE } from "@/lib/rollen";

const BEREICHE: [string, string][] = [
  ["/praemien/zuckermais", "/praemien/zuckermais"],
  ["/anbau/erdbeeren", "/anbau/erdbeeren"],
  ["/statistik/zuckermais", "/statistik/zuckermais"],
];

export default function ErntewirtschaftPage() {
  const router = useRouter();
  const { loading, profile } = useProfile();

  useEffect(() => {
    if (loading) return;
    const rolle = profile?.role;
    const ziel =
      BEREICHE.find(
        ([rechteKey]) => rolle && (MENUE_RECHTE[rechteKey] ?? []).includes(rolle)
      )?.[1] ?? "/dashboard";
    router.replace(ziel);
  }, [loading, profile, router]);

  return <p className="p-4 text-sm text-neutral-500">Lädt…</p>;
}
