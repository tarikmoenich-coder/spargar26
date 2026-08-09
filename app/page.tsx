"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";

export default function Home() {
  const router = useRouter();
  const { loading, profile, userId } = useProfile();

  useEffect(() => {
    if (loading) return;
    if (!userId) {
      router.replace("/login");
      return;
    }
    // zeiterfassung hat kein eigenes Dashboard (Stundenerfassung ist schon
    // ihr einziger Arbeitsbereich), erntewirtschaft genauso (nur Prämien/
    // Statistik, Nutzer-Vorgabe 2026-08-09) - alle anderen Rollen landen
    // auf ihrem rollenabhängigen Dashboard, siehe app/dashboard/page.tsx.
    if (profile?.role === "zeiterfassung") {
      router.replace("/erfassung");
    } else if (profile?.role === "erntewirtschaft") {
      router.replace("/praemien/zuckermais");
    } else {
      router.replace("/dashboard");
    }
  }, [loading, profile, userId, router]);

  return <p className="text-neutral-500">Lädt…</p>;
}
