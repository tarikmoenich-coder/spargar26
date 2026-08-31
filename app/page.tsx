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
    // ihr einziger Arbeitsbereich), hausmeister genauso (nur Unterkunft) -
    // alle anderen Rollen (inkl. erntewirtschaft, hat seit 2026-08-09 ein
    // eigenes Dashboard) landen auf ihrem rollenabhängigen Dashboard, siehe
    // app/dashboard/page.tsx.
    const start =
      profile?.role === "zeiterfassung"
        ? "/erfassung"
        : profile?.role === "hausmeister"
          ? "/unterkunft/reparaturen"
          : "/dashboard";
    router.replace(start);
  }, [loading, profile, userId, router]);

  return <p className="text-neutral-500">Lädt…</p>;
}
