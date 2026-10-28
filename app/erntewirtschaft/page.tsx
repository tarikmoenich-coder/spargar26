"use client";

// Sammel-Menüpunkt "Erntewirtschaft". Echte Flotten-Überblicksseite
// (Kartenansicht der Spargelspinnen, Nutzer-Vorgabe 2026-10-27: "besonders
// wichtig") für die Rollen, die auch ernte_kiste_zyklus lesen dürfen -
// admin/hr/management/erntewirtschaft/zeiterfassung, identisch zur
// ernte_kiste_zyklus_select-Policy (siehe docs/erntewirtschaft-plan.md
// Teil F). `lohnabrechnung` (einzige in MENUE_RECHTE["/erntewirtschaft"]
// fehlende Rolle aus diesem Set) hat kein operatives Interesse an der
// Maschinen-Flotte und behält den bisherigen Redirect zum ersten erlaubten
// Prämien-/Anbau-/Statistik-Bereich (Unterreiter aus
// components/ErntewirtschaftTabs.tsx).
//
// Erste, bewusst schlanke Scheibe: nur die Karte selbst. Tages-Kacheln
// (Kisten/kg heute, Lücken) folgen als eigener nächster Schritt, sobald
// ernte_kette_luecken/ernte_ertrag_tag gebaut sind.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sprout } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import ErnteMaschinenKarte, { type MaschineLive } from "@/components/ErnteMaschinenKarte";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { MENUE_RECHTE } from "@/lib/rollen";
import type { FeldGeojson } from "@/lib/types";

const BEREICHE: [string, string][] = [
  ["/praemien/zuckermais", "/praemien/zuckermais"],
  ["/anbau/erdbeeren", "/anbau/erdbeeren"],
  ["/statistik/zuckermais", "/statistik/zuckermais"],
  ["/erntewirtschaft/waage", "/erntewirtschaft/waage"],
];

const AKTUALISIERUNG_MS = 15_000;

function UeberblickRedirect() {
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

function FlottenUeberblick() {
  const [maschinen, setMaschinen] = useState<MaschineLive[]>([]);
  const [felder, setFelder] = useState<FeldGeojson[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    const { data, error } = await getSupabaseClient()
      .from("ernte_maschine_live")
      .select("*");
    setFehler(error?.message ?? null);
    setMaschinen((data as MaschineLive[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
    const intervall = setInterval(laden, AKTUALISIERUNG_MS);
    return () => clearInterval(intervall);
  }, [laden]);

  // Feld-Geometrien aus /anbau/felder (Nutzer-Vorgabe 2026-10-28) - nur zur
  // Orientierung auf der Karte, ändern sich kaum, darum einmalig geladen statt
  // im 15s-Takt wie die Maschinen-Positionen. Nur Spargel/Grünspargel (die
  // einzigen für die Spargelspinnen-Flotte relevanten Kulturen) - Erdbeeren-
  // Felder würden hier nur unnötig Linien beitragen.
  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient()
        .from("feld_geojson")
        .select("*")
        .eq("aktiv", true)
        .in("kultur", ["spargel", "gruenspargel"]);
      setFelder((data as FeldGeojson[]) ?? []);
    })();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <PageHeader
        icon={Sprout}
        titel="Erntewirtschaft"
        beschreibung="Live-Überblick der Spargelspinnen."
      />
      {fehler && (
        <p className="text-sm text-beere-700">
          Konnte nicht laden: {fehler}. Ist die Migration
          migration_2026-10-27_ernte_maschine_live.sql schon eingespielt?
        </p>
      )}
      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <ErnteMaschinenKarte maschinen={maschinen} felder={felder} />
      )}
    </div>
  );
}

export default function ErntewirtschaftPage() {
  const { loading, profile } = useProfile();

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt…</p>;
  const sichtRollen = MENUE_RECHTE["/erntewirtschaft/ueberblick"] ?? [];
  if (profile?.role && sichtRollen.includes(profile.role)) {
    return <FlottenUeberblick />;
  }
  return <UeberblickRedirect />;
}
