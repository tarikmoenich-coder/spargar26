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
// Tages-Kacheln (Nutzer-Vorgabe 2026-11-05, Teil F/E): "Kisten heute"/"kg
// heute" aus ernte_ertrag_tag, "Kisten ohne Zuordnung" (heute, live während
// noch gearbeitet wird) direkt aus ernte_kiste_zyklus, "Kisten fehlen" (je
// Mitarbeiter) aus ernte_kette_luecken + einer Zusatzabfrage zur Namens-
// Auflösung (migration_2026-11-05_erntewirtschaft_ertrag_luecken.sql).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sprout } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import ErnteMaschinenKarte, { type MaschineLive } from "@/components/ErnteMaschinenKarte";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { MENUE_RECHTE } from "@/lib/rollen";
import { formatMenge } from "@/lib/format";
import type { ErnteErtragTag, ErnteKetteLuecke, FeldGeojson } from "@/lib/types";

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

function heuteLokalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

interface Kacheln {
  kistenHeute: number;
  kgHeute: number;
  kistenOhneZuordnung: number;
  kistenFehlenGesamt: number;
  kistenFehlenJeMitarbeiter: { name: string; anzahl: number }[];
}

function FlottenUeberblick() {
  const [maschinen, setMaschinen] = useState<MaschineLive[]>([]);
  const [felder, setFelder] = useState<FeldGeojson[]>([]);
  const [kacheln, setKacheln] = useState<Kacheln | null>(null);
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

  // Tages-Kacheln, siehe Kommentar am Dateikopf - lokale (nicht UTC)
  // Tagesgrenzen, gleiches Muster wie der Kistenzähler im Waagen-Kiosk
  // (app/erntewirtschaft/waage/kiosk/page.tsx).
  const ladeKacheln = useCallback(async () => {
    const supabase = getSupabaseClient();
    const heute = heuteLokalIso();
    const heuteMitternacht = new Date();
    heuteMitternacht.setHours(0, 0, 0, 0);

    const [{ data: ertragRoh }, { count: ohneZuordnung }, { data: lueckenRoh }] =
      await Promise.all([
        supabase
          .from("ernte_ertrag_tag")
          .select("*")
          .order("tag", { ascending: false })
          .limit(500),
        supabase
          .from("ernte_kiste_zyklus")
          .select("*", { count: "exact", head: true })
          .is("employee_id", null)
          .gte("befuellt_am", heuteMitternacht.toISOString()),
        supabase
          .from("ernte_kette_luecken")
          .select("*")
          .eq("art", "befuellt_nie_gewogen")
          .eq("ist_faellig", true),
      ]);

    const ertragHeute = ((ertragRoh as ErnteErtragTag[]) ?? []).filter(
      (z) => z.tag.slice(0, 10) === heute
    );
    const kistenHeute = ertragHeute.reduce((s, z) => s + z.kisten, 0);
    const kgHeute = ertragHeute.reduce((s, z) => s + Number(z.netto_kg), 0);

    const luecken = (lueckenRoh as ErnteKetteLuecke[]) ?? [];
    const employeeIds = [...new Set(luecken.map((l) => l.employee_id).filter((id): id is string => !!id))];
    const { data: mitarbeiterRoh } = employeeIds.length
      ? await supabase.from("employees").select("id, name, vorname").in("id", employeeIds)
      : { data: [] as { id: string; name: string; vorname: string }[] };
    const nameById = new Map(
      (mitarbeiterRoh ?? []).map((m) => [m.id, `${m.name}, ${m.vorname}`])
    );
    const zaehlerJeMitarbeiter = new Map<string, number>();
    luecken.forEach((l) => {
      const name = l.employee_id ? nameById.get(l.employee_id) ?? "Unbekannt" : "Ohne Zuordnung";
      zaehlerJeMitarbeiter.set(name, (zaehlerJeMitarbeiter.get(name) ?? 0) + 1);
    });

    setKacheln({
      kistenHeute,
      kgHeute,
      kistenOhneZuordnung: ohneZuordnung ?? 0,
      kistenFehlenGesamt: luecken.length,
      kistenFehlenJeMitarbeiter: [...zaehlerJeMitarbeiter.entries()]
        .map(([name, anzahl]) => ({ name, anzahl }))
        .sort((a, b) => b.anzahl - a.anzahl),
    });
  }, []);

  useEffect(() => {
    laden();
    ladeKacheln();
    const intervall = setInterval(laden, AKTUALISIERUNG_MS);
    const kachelIntervall = setInterval(ladeKacheln, AKTUALISIERUNG_MS);
    return () => {
      clearInterval(intervall);
      clearInterval(kachelIntervall);
    };
  }, [laden, ladeKacheln]);

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
      {kacheln && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card p-3">
            <p className="text-xs text-neutral-500">Kisten heute</p>
            <p className="text-2xl font-semibold text-emerald-900">{kacheln.kistenHeute}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-neutral-500">kg heute</p>
            <p className="text-2xl font-semibold text-emerald-900">
              {formatMenge(kacheln.kgHeute)} kg
            </p>
          </div>
          <div className="card p-3" title="An der Maschine gescannt, ohne angemeldete Person">
            <p className="text-xs text-neutral-500">Kisten ohne Zuordnung (heute)</p>
            <p
              className={`text-2xl font-semibold ${
                kacheln.kistenOhneZuordnung > 0 ? "text-beere-600" : "text-emerald-900"
              }`}
            >
              {kacheln.kistenOhneZuordnung}
            </p>
          </div>
          <div
            className="card p-3"
            title={kacheln.kistenFehlenJeMitarbeiter
              .map((m) => `${m.name}: ${m.anzahl}`)
              .join("\n")}
          >
            <p className="text-xs text-neutral-500">Kisten fehlen (befüllt, nie gewogen)</p>
            <p
              className={`text-2xl font-semibold ${
                kacheln.kistenFehlenGesamt > 0 ? "text-beere-600" : "text-emerald-900"
              }`}
            >
              {kacheln.kistenFehlenGesamt}
            </p>
          </div>
        </div>
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
