"use client";

// Feld-Detail (Phase 3, Migration 2026-10-19): Geometrie zeichnen/anpassen.
// Erstbefüllung läuft normalerweise über den Import aus Pachtwesen2026
// (siehe /anbau/felder); diese Seite ist für Felder ohne Pachtwesen-Bezug
// (von Hand gezeichnet) oder zum Nachziehen/Verfeinern einer importierten
// Geometrie.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { MapPin } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import FeldKarte from "@/components/FeldKarte";
import { FELD_KULTUR_LABELS, type FeldGeojson } from "@/lib/types";
import { formatMenge } from "@/lib/format";

export default function FeldDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const feldId = Number(params.id);
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "erntewirtschaft";

  const [feld, setFeld] = useState<FeldGeojson | null>(null);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("feld_geojson")
      .select("*")
      .eq("id", feldId)
      .maybeSingle();
    if (error) setFehler(error.message);
    setFeld((data as FeldGeojson) ?? null);
    setLoading(false);
  }

  useEffect(() => {
    if (Number.isFinite(feldId)) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feldId]);

  async function geometrieSpeichern(geojson: string) {
    setFehler(null);
    setMeldung(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("feld_geometrie_setzen", {
      p_feld_id: feldId,
      p_geojson: geojson,
    });
    if (error) {
      setFehler(error.message);
      return;
    }
    setMeldung("Geometrie gespeichert.");
    load();
  }

  async function quelleUebernehmen() {
    if (!feld?.pachtwesen_geometrie_geojson_neu || !feld.pachtwesen_geometrie_hash_neu) return;
    setFehler(null);
    const supabase = getSupabaseClient();
    await supabase.rpc("feld_geometrie_setzen", {
      p_feld_id: feldId,
      p_geojson: feld.pachtwesen_geometrie_geojson_neu,
    });
    await supabase
      .from("feld")
      .update({
        pachtwesen_geometrie_hash: feld.pachtwesen_geometrie_hash_neu,
        pachtwesen_geometrie_hash_neu: null,
        pachtwesen_geometrie_geojson_neu: null,
      })
      .eq("id", feldId);
    load();
  }

  if (!Number.isFinite(feldId)) return null;

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div className="flex items-center justify-between">
        <PageHeader
          icon={MapPin}
          titel={feld ? `Feld: ${feld.bezeichnung}` : "Feld"}
        />
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => router.push("/anbau/felder")}
        >
          Zurück zu Felder
        </button>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : !feld ? (
        <p className="text-neutral-500">Feld nicht gefunden.</p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            Kultur: {feld.kultur ? FELD_KULTUR_LABELS[feld.kultur] : "—"} ·{" "}
            {feld.aktiv ? "aktiv" : "inaktiv"} · Brutto{" "}
            {feld.flaeche_brutto_ha != null ? `${formatMenge(feld.flaeche_brutto_ha, 4)} ha` : "— (keine Geometrie)"}
            {feld.pachtwesen_schlag_id && " · Geometrie-Ursprung: Pachtwesen2026"}
          </p>

          {feld.pachtwesen_geometrie_hash_neu && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
              ⚠ Der Schlag in Pachtwesen2026 hat sich geändert.{" "}
              {canEdit && (
                <button
                  type="button"
                  className="btn-secondary ml-1 text-xs"
                  onClick={quelleUebernehmen}
                >
                  Neue Geometrie übernehmen
                </button>
              )}
            </p>
          )}

          {fehler && (
            <p className="rounded border border-beere-300 bg-beere-50 p-2 text-sm text-beere-700">
              {fehler}
            </p>
          )}
          {meldung && <p className="text-sm text-emerald-700">{meldung}</p>}

          {!canEdit && (
            <p className="text-xs text-amber-700">
              Deine Rolle darf die Geometrie nur ansehen, nicht bearbeiten.
            </p>
          )}
          <FeldKarte
            geometrieGeojson={feld.geometrie_geojson}
            onGezeichnet={geometrieSpeichern}
            readOnly={!canEdit}
          />
        </>
      )}
    </div>
  );
}
