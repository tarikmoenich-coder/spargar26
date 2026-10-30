"use client";

// "Anbau → Ernteplanung" (Nutzer-Vorgabe 2026-10-31): wie viele
// Erntemaschinen (Spargelspinnen) werden für welche Fläche gebraucht, und
// sind aktuell zu viele/zu wenige eingeplant.
//
// AUSDRÜCKLICH keine Zuordnung einzelner Maschinen zu einem Feld - die
// Maschinen erkennen ihr Feld später selbst per GPS (siehe
// docs/erntewirtschaft-plan.md). Hier wird nur eine Stückzahl geplant
// (feld_anbau.geplante_maschinen) und gegen einen rechnerischen Bedarf
// (Laufmeter ÷ Kapazität je Maschine) sowie die Gesamtgröße der Flotte
// gegengeprüft.
//
// Junganlagen (1./2. Standjahr) werden ausgeblendet, da dort noch keine
// wirkliche Ernte möglich ist (gleiche Schwelle wie /anbau/uebersicht).

import PageHeader from "@/components/PageHeader";
import { Tractor } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import type { FeldAnbauUebersicht, Verfruehung } from "@/lib/types";
import { VERFRUEHUNG_LABELS } from "@/lib/types";
import { berechneStandjahr, JUNGANLAGE_MAX_STANDJAHR } from "@/lib/anbau";
import { formatMenge, formatZahlDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();
const KAPAZITAET_SCHLUESSEL = "kapazitaet_lfm_je_maschine";

interface FeldZeile extends FeldAnbauUebersicht {
  standjahrMin: number | null;
  standjahrMax: number | null;
  verfruehungen: Set<Verfruehung>;
  geplanteMaschinen: number | null;
}

export default function AnbauErnteplanungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "erntewirtschaft";
  const canEditKapazitaet = profile?.role === "admin";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zeilen, setZeilen] = useState<FeldZeile[]>([]);
  const [junganlagenAnzahl, setJunganlagenAnzahl] = useState(0);
  const [kapazitaet, setKapazitaet] = useState<number>(2000);
  const [flottengroesse, setFlottengroesse] = useState(0);

  async function load() {
    setLoading(true);
    setFehler(null);
    const supabase = getSupabaseClient();

    const [{ data: uData, error: uError }, { data: kData }, { count: mCount }] = await Promise.all([
      supabase
        .from("feld_anbau_uebersicht")
        .select("*")
        .eq("saison_jahr", jahr)
        .in("kultur", ["spargel", "gruenspargel"]),
      supabase.from("ernte_konfig").select("wert").eq("schluessel", KAPAZITAET_SCHLUESSEL).maybeSingle(),
      supabase.from("ernte_maschine").select("id", { count: "exact", head: true }).eq("aktiv", true),
    ]);
    if (uError) {
      setFehler(uError.message);
      setLoading(false);
      return;
    }
    const uebersicht = (uData as FeldAnbauUebersicht[]) ?? [];
    setKapazitaet(kData?.wert ? Number(kData.wert) : 2000);
    setFlottengroesse(mCount ?? 0);

    const anbauIds = uebersicht.map((u) => u.anbau_id);
    if (anbauIds.length === 0) {
      setZeilen([]);
      setJunganlagenAnzahl(0);
      setLoading(false);
      return;
    }

    const [{ data: aData, error: aError }, { data: faData, error: faError }] = await Promise.all([
      supabase
        .from("feld_anbau_abschnitt")
        .select("feld_anbau_id, pflanzjahr, verfruehung")
        .in("feld_anbau_id", anbauIds),
      supabase.from("feld_anbau").select("id, geplante_maschinen").in("id", anbauIds),
    ]);
    if (aError || faError) {
      setFehler(aError?.message ?? faError?.message ?? "Fehler beim Laden");
      setLoading(false);
      return;
    }
    const abschnitte =
      (aData as { feld_anbau_id: number; pflanzjahr: number | null; verfruehung: Verfruehung | null }[]) ?? [];
    const geplantMap = new Map(
      ((faData as { id: number; geplante_maschinen: number | null }[]) ?? []).map((f) => [f.id, f.geplante_maschinen])
    );

    let junganlagen = 0;
    const alle: FeldZeile[] = uebersicht.map((u) => {
      const eigene = abschnitte.filter((a) => a.feld_anbau_id === u.anbau_id);
      const standjahre = eigene
        .filter((a): a is typeof a & { pflanzjahr: number } => a.pflanzjahr != null)
        .map((a) => berechneStandjahr(a.pflanzjahr, jahr));
      const verfruehungen = new Set(eigene.map((a) => a.verfruehung).filter((v): v is Verfruehung => v != null));
      return {
        ...u,
        standjahrMin: standjahre.length > 0 ? Math.min(...standjahre) : null,
        standjahrMax: standjahre.length > 0 ? Math.max(...standjahre) : null,
        verfruehungen,
        geplanteMaschinen: geplantMap.get(u.anbau_id) ?? null,
      };
    });

    const sichtbar = alle.filter((z) => {
      // Junganlage = ALLE Standjahre bekannt und <= Schwelle -> ausblenden.
      if (z.standjahrMax != null && z.standjahrMax <= JUNGANLAGE_MAX_STANDJAHR) {
        junganlagen += 1;
        return false;
      }
      return true;
    });

    setZeilen(sichtbar);
    setJunganlagenAnzahl(junganlagen);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  async function geplanteMaschinenAendern(anbauId: number, wert: string) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("feld_anbau")
      .update({ geplante_maschinen: wert ? Number(wert) : null })
      .eq("id", anbauId);
    if (error) setFehler(error.message);
    load();
  }

  async function kapazitaetAendern(wert: string) {
    const zahl = Number(wert);
    if (!zahl || zahl <= 0) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("ernte_konfig")
      .update({ wert: String(zahl) })
      .eq("schluessel", KAPAZITAET_SCHLUESSEL);
    if (error) setFehler(error.message);
    load();
  }

  function bedarf(laufendeMeter: number): number {
    return kapazitaet > 0 ? Math.ceil(laufendeMeter / kapazitaet) : 0;
  }

  const gesamtBedarf = zeilen.reduce((s, z) => s + bedarf(z.laufende_meter), 0);
  const gesamtGeplant = zeilen.reduce((s, z) => s + (z.geplanteMaschinen ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={Tractor} titel="Ernteplanung" />
        <p className="text-sm text-neutral-500">
          Rechnerischer Maschinenbedarf (Laufmeter Reihe ÷ Kapazität je
          Maschine) je Feld, dagegen die tatsächlich eingeplante Stückzahl -
          keine Zuordnung einzelner Maschinen, die finden ihr Feld später
          selbst per GPS.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>
          Saison{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        <label className="flex items-center gap-1">
          Kapazität je Maschine
          <input
            type="number"
            step="50"
            defaultValue={kapazitaet}
            disabled={!canEditKapazitaet}
            className="w-24"
            onBlur={(e) => kapazitaetAendern(e.target.value)}
          />
          lfm/Saison
        </label>
        {junganlagenAnzahl > 0 && (
          <span className="text-neutral-500">
            + {junganlagenAnzahl} Junganlage(n) ohne Ernteeinsatz ausgeblendet
          </span>
        )}
      </div>

      {fehler && (
        <p className="rounded border border-beere-300 bg-beere-50 p-2 text-sm text-beere-700">{fehler}</p>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Lädt…</p>
      ) : zeilen.length === 0 ? (
        <p className="text-sm text-neutral-500">Keine erntereifen Flächen für {jahr} gefunden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Feld</th>
                <th>Kultur</th>
                <th>Standjahr</th>
                <th>Verfrühung</th>
                <th>Netto ha</th>
                <th title="Reihenlänge gesamt">Laufmeter</th>
                <th title="Laufmeter ÷ Kapazität je Maschine, aufgerundet">Bedarf</th>
                <th>Geplant</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => {
                const b = bedarf(z.laufende_meter);
                const geplant = z.geplanteMaschinen;
                const status =
                  geplant == null
                    ? { label: "nicht geplant", klasse: "badge-neutral" }
                    : geplant < b
                      ? { label: "zu wenig", klasse: "badge-danger" }
                      : geplant > b
                        ? { label: "zu viele", klasse: "badge-warn" }
                        : { label: "passt", klasse: "badge-ok" };
                return (
                  <tr key={z.anbau_id} className={z.kultur === "gruenspargel" ? "bg-emerald-50" : undefined}>
                    <td className="font-medium">{z.feld_bezeichnung}</td>
                    <td>{z.kultur === "gruenspargel" ? "Grün" : "Weiß"}</td>
                    <td>
                      {z.standjahrMin == null
                        ? "—"
                        : z.standjahrMin === z.standjahrMax
                          ? `${z.standjahrMin}.`
                          : `${z.standjahrMin}.–${z.standjahrMax}.`}
                    </td>
                    <td className="text-xs">
                      {z.verfruehungen.size === 0
                        ? "—"
                        : Array.from(z.verfruehungen)
                            .map((v) => VERFRUEHUNG_LABELS[v].split(" ")[0])
                            .join(", ")}
                    </td>
                    <td>{formatMenge(z.netto_ha, 2)}</td>
                    <td>{formatZahlDE(z.laufende_meter)} m</td>
                    <td>{b}</td>
                    <td>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        defaultValue={geplant ?? ""}
                        disabled={!canEdit}
                        className="w-16"
                        onBlur={(e) => geplanteMaschinenAendern(z.anbau_id, e.target.value)}
                      />
                    </td>
                    <td>
                      <span className={`badge ${status.klasse}`}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={6}>Summe</td>
                <td>{gesamtBedarf}</td>
                <td>{gesamtGeplant}</td>
                <td>
                  {gesamtGeplant > flottengroesse && (
                    <span className="badge badge-danger">über Flottengröße ({flottengroesse})</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-xs text-neutral-500">
            Aktive Flotte: {flottengroesse} Maschine(n).
          </p>
        </div>
      )}
    </div>
  );
}
