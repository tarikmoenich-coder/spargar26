"use client";

// Unterkunft → Reparaturen (Migration 2026-09-12). Board für alle Mängel mit
// kategorie='reparatur': eigener Status-Fluss (gemeldet → beauftragt →
// erledigt), Fälligkeitsdatum (Handwerkertermin), Verursachung und – bei
// "vom Bewohner verschuldet" – Verursacher + geschätzte Kosten als Grundlage
// für eine Belastung. Reparaturen beeinflussen die Kontroll-Ampel nicht.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import FotoAufnahme from "@/components/FotoAufnahme";
import { formatDatumDE } from "@/lib/format";
import { raumName } from "@/lib/unterkunft";
import {
  UNTERKUNFT_MANGEL_SCHWERE_LABELS,
  UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS,
  UNTERKUNFT_REPARATUR_STATUS_LABELS,
  type UnterkunftBelegungPerson,
  type UnterkunftGebaeude,
  type UnterkunftMangel,
  type UnterkunftMangelSchwere,
  type UnterkunftMangelStatus,
  type UnterkunftMangelVerursachung,
  type UnterkunftZimmer,
} from "@/lib/types";

const VERURSACHUNG_REIHENFOLGE: UnterkunftMangelVerursachung[] = [
  "bewohner",
  "verschleiss",
  "unklar",
];

export default function UnterkunftReparaturenPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "hausmeister";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [reparaturen, setReparaturen] = useState<UnterkunftMangel[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<
    "offen_arbeit" | "alle" | UnterkunftMangelStatus
  >("offen_arbeit");
  const [gebaeudeFilter, setGebaeudeFilter] = useState("");
  const [offenId, setOffenId] = useState<number | null>(null);

  const [neu, setNeu] = useState({
    gebaeude_id: "",
    zimmer_id: "",
    beschreibung: "",
    schwere: "mittel" as UnterkunftMangelSchwere,
    verursachung: "unklar" as UnterkunftMangelVerursachung,
  });

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, z, m, bp] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase.from("unterkunft_zimmer").select("*").order("nummer"),
      supabase
        .from("unterkunft_mangel")
        .select("*")
        .eq("kategorie", "reparatur")
        .order("gemeldet_am", { ascending: false }),
      supabase
        .from("unterkunft_belegung_person")
        .select("*")
        .order("von", { ascending: false }),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setReparaturen((m.data as UnterkunftMangel[]) ?? []);
    setBelegungen((bp.data as UnterkunftBelegungPerson[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  function zimmerLabel(zimmerId: number): string {
    const z = zimmer.find((x) => x.id === zimmerId);
    const g = z ? gebaeude.find((x) => x.id === z.gebaeude_id) : undefined;
    if (!z) return `Zimmer ${zimmerId}`;
    return `${g?.name ?? "?"} · ${
      z.art === "zimmer" ? `Zimmer ${z.nummer}` : raumName(z)
    }`;
  }

  // Bewohner des betroffenen Raums (bzw. der Wohneinheit bei Allgemeinräumen)
  // – Auswahl für "Verursacher".
  function bewohnerFuer(zimmerId: number): UnterkunftBelegungPerson[] {
    const z = zimmer.find((x) => x.id === zimmerId);
    if (!z) return [];
    const abZimmer = z.art === "zimmer";
    const seen = new Set<string>();
    return belegungen.filter((b) => {
      const passt = abZimmer
        ? b.zimmer_id === z.id
        : z.wohneinheit_id != null && b.wohneinheit_id === z.wohneinheit_id;
      if (!passt || seen.has(b.employee_id)) return false;
      seen.add(b.employee_id);
      return true;
    });
  }

  function bewohnerName(employeeId: string | null): string {
    if (!employeeId) return "—";
    const b = belegungen.find((x) => x.employee_id === employeeId);
    return b ? `${b.vorname} ${b.name}` : employeeId;
  }

  const zimmerDesGebaeudes = zimmer.filter(
    (z) => String(z.gebaeude_id) === neu.gebaeude_id
  );

  const gefiltert = useMemo(() => {
    return reparaturen.filter((m) => {
      if (statusFilter === "offen_arbeit" && m.status === "behoben") return false;
      if (
        statusFilter !== "offen_arbeit" &&
        statusFilter !== "alle" &&
        m.status !== statusFilter
      )
        return false;
      if (gebaeudeFilter) {
        const z = zimmer.find((x) => x.id === m.zimmer_id);
        if (!z || String(z.gebaeude_id) !== gebaeudeFilter) return false;
      }
      return true;
    });
  }, [reparaturen, statusFilter, gebaeudeFilter, zimmer]);

  const gruppen = useMemo(
    () =>
      VERURSACHUNG_REIHENFOLGE.map((v) => ({
        verursachung: v,
        eintraege: gefiltert.filter((m) => m.verursachung === v),
      })).filter((grp) => grp.eintraege.length > 0),
    [gefiltert]
  );

  const kennzahlen = useMemo(() => {
    const offen = reparaturen.filter((m) => m.status !== "behoben");
    const kostenBewohner = offen
      .filter((m) => m.verursachung === "bewohner")
      .reduce((s, m) => s + (m.kosten_geschaetzt ?? 0), 0);
    return {
      gemeldet: offen.filter((m) => m.status === "offen").length,
      beauftragt: offen.filter((m) => m.status === "in_arbeit").length,
      kostenBewohner,
    };
  }, [reparaturen]);

  async function anlegen() {
    setFehler(null);
    if (!neu.zimmer_id || !neu.beschreibung.trim()) {
      setFehler("Zimmer und Beschreibung sind Pflicht.");
      return;
    }
    const { error } = await getSupabaseClient()
      .from("unterkunft_mangel")
      .insert({
        zimmer_id: Number(neu.zimmer_id),
        beschreibung: neu.beschreibung.trim(),
        schwere: neu.schwere,
        kategorie: "reparatur",
        verursachung: neu.verursachung,
      });
    if (error) {
      setFehler(error.message);
      return;
    }
    setNeu((s) => ({ ...s, beschreibung: "", schwere: "mittel" }));
    await laden();
  }

  async function aktualisieren(
    m: UnterkunftMangel,
    patch: Partial<UnterkunftMangel>
  ) {
    setFehler(null);
    const jetztBehoben = patch.status === "behoben" && m.status !== "behoben";
    const wiederOffen =
      patch.status && patch.status !== "behoben" && m.status === "behoben";
    const { error } = await getSupabaseClient()
      .from("unterkunft_mangel")
      .update({
        ...patch,
        updated_by: profile?.id ?? null,
        ...(jetztBehoben
          ? {
              behoben_von: profile?.id ?? null,
              behoben_am: new Date().toISOString(),
            }
          : {}),
        ...(wiederOffen ? { behoben_von: null, behoben_am: null } : {}),
      })
      .eq("id", m.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-6">
      <UnterkunftTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Reparaturen</h1>
          <p className="text-sm text-neutral-500">
            {kennzahlen.gemeldet} gemeldet · {kennzahlen.beauftragt} beauftragt ·
            geschätzte Kosten „vom Bewohner verschuldet" (offen):{" "}
            <span className="font-medium text-red-700">
              {kennzahlen.kostenBewohner.toFixed(2)} €
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>
            Status
            <select
              className="ml-2"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
            >
              <option value="offen_arbeit">gemeldet + beauftragt</option>
              <option value="offen">nur gemeldet</option>
              <option value="in_arbeit">nur beauftragt</option>
              <option value="behoben">nur erledigt</option>
              <option value="alle">alle</option>
            </select>
          </label>
          <label>
            Gebäude
            <select
              className="ml-2"
              value={gebaeudeFilter}
              onChange={(e) => setGebaeudeFilter(e.target.value)}
            >
              <option value="">alle</option>
              {gebaeude.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {canEdit && (
        <section className="space-y-2 rounded border border-neutral-200 p-3">
          <h2 className="text-sm font-semibold">Reparatur direkt anlegen</h2>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label>
              Gebäude
              <select
                className="ml-2"
                value={neu.gebaeude_id}
                onChange={(e) =>
                  setNeu((s) => ({
                    ...s,
                    gebaeude_id: e.target.value,
                    zimmer_id: "",
                  }))
                }
              >
                <option value="">–</option>
                {gebaeude.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zimmer
              <select
                className="ml-2"
                value={neu.zimmer_id}
                disabled={!neu.gebaeude_id}
                onChange={(e) =>
                  setNeu((s) => ({ ...s, zimmer_id: e.target.value }))
                }
              >
                <option value="">–</option>
                {zimmerDesGebaeudes.map((z) => (
                  <option key={z.id} value={z.id}>
                    {raumName(z)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ursache
              <select
                className="ml-2"
                value={neu.verursachung}
                onChange={(e) =>
                  setNeu((s) => ({
                    ...s,
                    verursachung: e.target
                      .value as UnterkunftMangelVerursachung,
                  }))
                }
              >
                {VERURSACHUNG_REIHENFOLGE.map((k) => (
                  <option key={k} value={k}>
                    {UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Schwere
              <select
                className="ml-2"
                value={neu.schwere}
                onChange={(e) =>
                  setNeu((s) => ({
                    ...s,
                    schwere: e.target.value as UnterkunftMangelSchwere,
                  }))
                }
              >
                {(
                  Object.keys(
                    UNTERKUNFT_MANGEL_SCHWERE_LABELS
                  ) as UnterkunftMangelSchwere[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {UNTERKUNFT_MANGEL_SCHWERE_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1">
              Beschreibung
              <input
                className="ml-2 w-full max-w-xl"
                value={neu.beschreibung}
                onChange={(e) =>
                  setNeu((s) => ({ ...s, beschreibung: e.target.value }))
                }
              />
            </label>
            <button className="btn" onClick={anlegen}>
              Anlegen
            </button>
          </div>
        </section>
      )}

      {gefiltert.length === 0 ? (
        <p className="text-sm text-neutral-500">Keine Reparaturen im Filter.</p>
      ) : (
        gruppen.map((grp) => {
          const kosten = grp.eintraege
            .filter((m) => m.status !== "behoben")
            .reduce((s, m) => s + (m.kosten_geschaetzt ?? 0), 0);
          return (
            <section key={grp.verursachung} className="space-y-2">
              <h2 className="flex flex-wrap items-center gap-2 font-semibold text-neutral-800">
                {UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS[grp.verursachung]}
                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs">
                  {grp.eintraege.length}
                </span>
                {grp.verursachung === "bewohner" && kosten > 0 && (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    {kosten.toFixed(2)} € offen
                  </span>
                )}
              </h2>

              <div className="space-y-2">
                {grp.eintraege.map((m) => {
                  const auf = offenId === m.id;
                  const kandidaten = bewohnerFuer(m.zimmer_id);
                  return (
                    <div
                      key={m.id}
                      className="rounded border border-neutral-200 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            {zimmerLabel(m.zimmer_id)}
                          </div>
                          <div className="text-sm text-neutral-700">
                            {m.beschreibung}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            gemeldet {formatDatumDE(m.gemeldet_am)}
                            {m.behoben_am &&
                              ` · erledigt ${formatDatumDE(m.behoben_am)}`}
                          </div>
                        </div>
                        <button
                          className="btn-secondary"
                          onClick={() => setOffenId(auf ? null : m.id)}
                        >
                          {auf ? "▾" : "▸"} Details
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <label className="flex items-center gap-1">
                          Status
                          {canEdit ? (
                            <select
                              value={m.status}
                              onChange={(e) =>
                                aktualisieren(m, {
                                  status: e.target
                                    .value as UnterkunftMangelStatus,
                                })
                              }
                            >
                              {(
                                Object.keys(
                                  UNTERKUNFT_REPARATUR_STATUS_LABELS
                                ) as UnterkunftMangelStatus[]
                              ).map((k) => (
                                <option key={k} value={k}>
                                  {UNTERKUNFT_REPARATUR_STATUS_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="font-medium">
                              {UNTERKUNFT_REPARATUR_STATUS_LABELS[m.status]}
                            </span>
                          )}
                        </label>

                        <label className="flex items-center gap-1">
                          fällig
                          <input
                            type="date"
                            defaultValue={m.faellig_am ?? ""}
                            disabled={!canEdit}
                            onBlur={(e) => {
                              const v = e.target.value || null;
                              if (v !== (m.faellig_am ?? null))
                                aktualisieren(m, { faellig_am: v });
                            }}
                          />
                        </label>

                        <label className="flex items-center gap-1">
                          Ursache
                          {canEdit ? (
                            <select
                              value={m.verursachung}
                              onChange={(e) =>
                                aktualisieren(m, {
                                  verursachung: e.target
                                    .value as UnterkunftMangelVerursachung,
                                })
                              }
                            >
                              {VERURSACHUNG_REIHENFOLGE.map((k) => (
                                <option key={k} value={k}>
                                  {UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS[m.verursachung]
                          )}
                        </label>

                        <label className="flex items-center gap-1">
                          Schwere
                          {canEdit ? (
                            <select
                              value={m.schwere}
                              onChange={(e) =>
                                aktualisieren(m, {
                                  schwere: e.target
                                    .value as UnterkunftMangelSchwere,
                                })
                              }
                            >
                              {(
                                Object.keys(
                                  UNTERKUNFT_MANGEL_SCHWERE_LABELS
                                ) as UnterkunftMangelSchwere[]
                              ).map((k) => (
                                <option key={k} value={k}>
                                  {UNTERKUNFT_MANGEL_SCHWERE_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            UNTERKUNFT_MANGEL_SCHWERE_LABELS[m.schwere]
                          )}
                        </label>
                      </div>

                      {m.verursachung === "bewohner" && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded bg-red-50 px-2 py-1.5 text-sm">
                          <label className="flex items-center gap-1">
                            Verursacher
                            {canEdit ? (
                              <select
                                value={m.verursacher_employee_id ?? ""}
                                onChange={(e) =>
                                  aktualisieren(m, {
                                    verursacher_employee_id:
                                      e.target.value || null,
                                  })
                                }
                              >
                                <option value="">–</option>
                                {kandidaten.map((b) => (
                                  <option
                                    key={b.employee_id}
                                    value={b.employee_id}
                                  >
                                    {b.vorname} {b.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              bewohnerName(m.verursacher_employee_id)
                            )}
                          </label>
                          <label className="flex items-center gap-1">
                            geschätzte Kosten €
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-24"
                              defaultValue={m.kosten_geschaetzt ?? ""}
                              disabled={!canEdit}
                              onBlur={(e) => {
                                const v =
                                  e.target.value === ""
                                    ? null
                                    : Math.max(0, Number(e.target.value));
                                if (v !== (m.kosten_geschaetzt ?? null))
                                  aktualisieren(m, { kosten_geschaetzt: v });
                              }}
                            />
                          </label>
                        </div>
                      )}

                      {auf && (
                        <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
                          {canEdit && (
                            <label className="block text-sm">
                              Notiz zur Behebung
                              <textarea
                                className="mt-1 w-full max-w-xl rounded border border-neutral-300 px-2 py-1 text-sm"
                                rows={2}
                                defaultValue={m.behebung_notiz ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value.trim() || null;
                                  if (v !== (m.behebung_notiz ?? null))
                                    aktualisieren(m, { behebung_notiz: v });
                                }}
                              />
                            </label>
                          )}
                          <div>
                            <div className="mb-1 text-sm font-medium">
                              Fotos
                              {m.quelle_vorgang_id && (
                                <span className="ml-1 font-normal text-neutral-400">
                                  (inkl. Fotos aus der Kontrolle)
                                </span>
                              )}
                            </div>
                            <FotoAufnahme
                              zimmerId={m.zimmer_id}
                              mangelId={m.id}
                              disabled={!canEdit}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
