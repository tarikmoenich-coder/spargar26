"use client";

// Rollen als Datensätze (Tabelle rolle, Rechte-Umbau 2026-11-28) - für
// Bezeichnungen in Nav/Nutzerverwaltung und den Rollen-Editor. Einmal je
// Seitenaufruf geladen und zwischen Komponenten geteilt.
import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Rolle } from "@/lib/types";
import { ROLLEN_LABELS } from "@/lib/rollen";

let cache: Promise<Rolle[]> | null = null;

function laden(neu = false): Promise<Rolle[]> {
  if (!cache || neu) {
    cache = Promise.resolve(
      getSupabaseClient()
        .from("rolle")
        .select("*")
        .order("sortierung")
        .order("bezeichnung")
        .then(({ data }) => (data as Rolle[]) ?? [])
    );
  }
  return cache;
}

export function useRollen(aktiv = true) {
  const [rollen, setRollen] = useState<Rolle[]>([]);
  useEffect(() => {
    if (!aktiv) return;
    let ab = false;
    laden().then((r) => !ab && setRollen(r));
    return () => {
      ab = true;
    };
  }, [aktiv]);
  const neuLaden = useCallback(async () => {
    const r = await laden(true);
    setRollen(r);
    return r;
  }, []);
  const label = useCallback(
    (id: string | null | undefined) =>
      id ? rollen.find((r) => r.id === id)?.bezeichnung ?? ROLLEN_LABELS[id] ?? id : "—",
    [rollen]
  );
  return { rollen, label, neuLaden };
}
