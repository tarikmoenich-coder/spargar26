// Liest die selbst bewirtschafteten Schläge (Name/Geometrie/Hektar) aus
// Pachtwesen2026 - einem anderen, eigenständigen Supabase-Projekt. NUR
// diese Route kennt dessen Zugangsdaten (Server-Umgebungsvariablen, nie
// NEXT_PUBLIC_), analog zu app/api/firmenhandy-sync. Die eigentliche
// Übernahme in die hiesige Tabelle "feld" (inkl. Review bei geänderten
// Geometrien) macht die aufrufende Seite (app/anbau/felder) client-seitig
// selbst, mit dem normalen, RLS-geprüften Browser-Client - diese Route
// liefert nur die Rohdaten aus dem anderen Projekt.
//
// Pachtwesen2026 gibt diese Daten über eine eng begrenzte, für `anon`
// freigegebene Funktion heraus (schlaege_bewirtschaftet_fuer_jahr, Migration
// 0060 im Rechnungssystem2026-Repo) - nur Schlag-Name/-Geometrie/-Hektar,
// keine Verpächter-/Bank-/Vertragsdaten.

import { createClient } from "@supabase/supabase-js";

const PACHTWESEN_URL = process.env.PACHTWESEN_SUPABASE_URL;
const PACHTWESEN_ANON_KEY = process.env.PACHTWESEN_SUPABASE_ANON_KEY;

export async function GET(request: Request) {
  if (!PACHTWESEN_URL || !PACHTWESEN_ANON_KEY) {
    return Response.json(
      {
        error:
          "PACHTWESEN_SUPABASE_URL / PACHTWESEN_SUPABASE_ANON_KEY fehlen (Server-Umgebungsvariablen).",
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const jahr = Number(searchParams.get("jahr"));
  if (!Number.isFinite(jahr) || jahr < 2000) {
    return Response.json({ error: "Ungültiges oder fehlendes Jahr." }, { status: 400 });
  }

  const pachtwesen = createClient(PACHTWESEN_URL, PACHTWESEN_ANON_KEY);
  const { data, error } = await pachtwesen.rpc("schlaege_bewirtschaftet_fuer_jahr", {
    p_jahr: jahr,
  });

  if (error) {
    return Response.json(
      { error: `Pachtwesen2026 nicht erreichbar oder Funktion fehlt: ${error.message}` },
      { status: 502 }
    );
  }

  return Response.json({ schlaege: data ?? [] });
}
