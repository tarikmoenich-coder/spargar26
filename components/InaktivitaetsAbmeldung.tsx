"use client";

// Automatische Abmeldung nach Inaktivität (Nutzer-Vorgabe 2026-08-28,
// Sicherheitsmaßnahme für die sensiblen Personal-/Lohndaten dieser App):
// wer 60 Minuten lang keine Maus-/Tastatur-/Touch-Aktivität zeigt, wird
// automatisch abgemeldet. Rein clientseitig, pro Browser-Tab (Supabase
// kennt kein serverseitiges Session-Timeout) - der Timer läuft nur,
// solange tatsächlich eine Sitzung besteht (useProfile().userId), und wird
// bei jeder Aktivität zurückgesetzt statt bei jedem Seitenwechsel neu zu
// laufen (globaler Layout-Baustein, siehe app/layout.tsx).
//
// scope: "local" beim Abmelden - Supabase meldet mit signOut() standardmäßig
// ALLE Sitzungen der Person ab ("global"), das würde einen zweiten, gerade
// aktiv genutzten Tab derselben Person fälschlich mit ausloggen. "local"
// beendet nur die Sitzung dieses einen Tabs.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";

const INAKTIVITAETS_LIMIT_MS = 60 * 60 * 1000; // 60 Minuten

const AKTIVITAETS_EREIGNISSE = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
] as const;

export default function InaktivitaetsAbmeldung() {
  const { userId } = useProfile();
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    async function abmelden() {
      await getSupabaseClient().auth.signOut({ scope: "local" });
      router.push("/login?grund=inaktivitaet");
    }

    function zuruecksetzen() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(abmelden, INAKTIVITAETS_LIMIT_MS);
    }

    zuruecksetzen();
    AKTIVITAETS_EREIGNISSE.forEach((ev) =>
      window.addEventListener(ev, zuruecksetzen, { passive: true })
    );

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      AKTIVITAETS_EREIGNISSE.forEach((ev) =>
        window.removeEventListener(ev, zuruecksetzen)
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return null;
}
