// Login-Prüfung für die eigenen API-Routen (app/api/*).
//
// Rundum-Check 2026-11-25: die Routen waren ohne Login aufrufbar - wer die
// Adresse kannte, konnte z.B. Kontakte ins Firmenhandy-Adressbuch schreiben.
// Der Browser schickt jetzt das Supabase-Zugangstoken mit (lib/apiFetch.ts),
// hier wird es bei Supabase geprüft und die Rolle über das eigene Profil
// gelesen (RLS: jeder sieht nur sich selbst).

import { createClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/types";

export async function apiNutzerPruefen(
  request: Request,
  erlaubteRollen: UserRole[]
): Promise<Response | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!url || !anonKey) {
    return Response.json({ error: "Supabase-Konfiguration fehlt." }, { status: 500 });
  }
  if (!token) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: nutzer, error } = await supabase.auth.getUser(token);
  if (error || !nutzer.user) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const { data: profil } = await supabase
    .from("profiles")
    .select("aktiv, rollen")
    .eq("id", nutzer.user.id)
    .maybeSingle();
  const rollen: string[] = profil?.rollen ?? [];
  if (!profil?.aktiv || !rollen.some((r) => (erlaubteRollen as string[]).includes(r))) {
    return Response.json({ error: "Keine Berechtigung." }, { status: 403 });
  }
  return null;
}
