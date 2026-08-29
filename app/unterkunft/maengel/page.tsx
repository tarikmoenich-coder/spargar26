"use client";

// Unterkunft → Mängel (Migration 2026-08-29). Mängelliste je Zimmer/Gebäude,
// Status (offen / in Arbeit / behoben), Schwere, Fotos. Mängel entstehen bei
// Übergabe/Abnahme/Kontrolle oder werden hier direkt angelegt.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import FotoAufnahme from "@/components/FotoAufnahme";
import { formatDatumDE } from "@/lib/format";
import {
  UNTERKUNFT_MANGEL_SCHWERE_LABELS,
  UNTERKUNFT_MANGEL_STATUS_LABELS,
  type UnterkunftGebaeude,
  type UnterkunftMangel,
  type UnterkunftMangelSchwere,
  type UnterkunftMangelStatus,
  type UnterkunftZimmer,
} from "@/lib/types";

export default function UnterkunftMaengelPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [maengel, setMaengel] = useState<UnterkunftMangel[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"offen_arbeit" | "alle" | UnterkunftMangelStatus>(
    "offen_arbeit"
  );
  const [gebaeudeFilter, setGebaeudeFilter] = useState("");
  const [offenId, setOffenId] = useState<number | null>(null);

  const [neu, setNeu] = useState({
    gebaeude_id: "",
    zimmer_id: "",
    beschreibung: "",
    schwere: "mittel" as UnterkunftMangelSchwere,
  });

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, z, m] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase.from("unterkunft_zimmer").select("*").order("nummer"),
      supabase
        .from("unterkunft_mangel")
        .select("*")
        .order("gemeldet_am", { ascending: false }),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setMaengel((m.data as UnterkunftMangel[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  function zimmerLabel(zimmerId: number): string {
    const z = zimmer.find((x) => x.id === zimmerId);
    const g = z ? gebaeude.find((x) => x.id === z.gebaeude_id) : undefined;
    return z ? `${g?.name ?? "?"} · Zimmer ${z.nummer}` : `Zimmer ${zimmerId}`;
  }

  const zimmerDesGebaeudes = zimmer.filter(
    (z) => String(z.gebaeude_id) === neu.gebaeude_id
  );

  const gefiltert = useMemo(() => {
    return maengel.filter((m) => {
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
  }, [maengel, statusFilter, gebaeudeFilter, zimmer]);

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
      });
    if (error) {
      setFehler(error.message);
      return;
    }
    setNeu((s) => ({ ...s, beschreibung: "", schwere: "mittel" }));
    await laden();
  }

  async function aktualisieren(m: UnterkunftMangel, patch: Partial<UnterkunftMangel>) {
    setFehler(null);
    const jetztBehoben = patch.status === "behoben" && m.status !== "behoben";
    const wiederOffen = patch.status && patch.status !== "behoben" && m.status === "behoben";
    const { error } = await getSupabaseClient()
      .from("unterkunft_mangel")
      .update({
        ...patch,
        updated_by: profile?.id ?? null,
        ...(jetztBehoben
          ? { behoben_von: profile?.id ?? null, behoben_am: new Date().toISOString() }
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
          <h1 className="text-lg font-semibold text-emerald-900">Mängel</h1>
          <p className="text-sm text-neutral-500">
            {maengel.filter((m) => m.status !== "behoben").length} offen ·{" "}
            {maengel.length} gesamt
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>
            Status
            <select
              className="ml-2"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="offen_arbeit">offen + in Arbeit</option>
              <option value="offen">nur offen</option>
              <option value="in_arbeit">nur in Arbeit</option>
              <option value="behoben">nur behoben</option>
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
          <h2 className="text-sm font-semibold">Mangel direkt anlegen</h2>
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
                onChange={(e) => setNeu((s) => ({ ...s, zimmer_id: e.target.value }))}
              >
                <option value="">–</option>
                {zimmerDesGebaeudes.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nummer}
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

      <table>
        <thead>
          <tr>
            <th>Gemeldet</th>
            <th>Zimmer</th>
            <th>Beschreibung</th>
            <th>Schwere</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {gefiltert.map((m) => {
            const offen = offenId === m.id;
            return (
              <Fragment key={m.id}>
                <tr>
                  <td className="whitespace-nowrap">{formatDatumDE(m.gemeldet_am)}</td>
                  <td>{zimmerLabel(m.zimmer_id)}</td>
                  <td>{m.beschreibung}</td>
                  <td>
                    {canEdit ? (
                      <select
                        value={m.schwere}
                        onChange={(e) =>
                          aktualisieren(m, {
                            schwere: e.target.value as UnterkunftMangelSchwere,
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
                  </td>
                  <td>
                    {canEdit ? (
                      <select
                        value={m.status}
                        onChange={(e) =>
                          aktualisieren(m, {
                            status: e.target.value as UnterkunftMangelStatus,
                          })
                        }
                        className={
                          m.status === "behoben"
                            ? "text-neutral-400"
                            : m.status === "offen"
                              ? "font-medium text-red-600"
                              : "font-medium text-amber-700"
                        }
                      >
                        {(
                          Object.keys(
                            UNTERKUNFT_MANGEL_STATUS_LABELS
                          ) as UnterkunftMangelStatus[]
                        ).map((k) => (
                          <option key={k} value={k}>
                            {UNTERKUNFT_MANGEL_STATUS_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      UNTERKUNFT_MANGEL_STATUS_LABELS[m.status]
                    )}
                  </td>
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => setOffenId(offen ? null : m.id)}
                    >
                      {offen ? "▾" : "▸"} Details
                    </button>
                  </td>
                </tr>
                {offen && (
                  <tr>
                    <td colSpan={6} className="bg-neutral-50">
                      <div className="space-y-3 p-3">
                        <div className="text-sm text-neutral-600">
                          {m.quelle_vorgang_id
                            ? "Entstanden aus einem Übergabe-/Kontroll-Vorgang."
                            : "Direkt angelegt."}
                          {m.behoben_am &&
                            ` · Behoben am ${formatDatumDE(m.behoben_am)}.`}
                        </div>
                        {canEdit && (
                          <label className="block text-sm">
                            Behebungs-Notiz
                            <textarea
                              className="mt-1 w-full max-w-xl rounded border border-neutral-300 px-2 py-1 text-sm"
                              rows={2}
                              defaultValue={m.behebung_notiz ?? ""}
                              onBlur={(e) => {
                                const wert = e.target.value.trim() || null;
                                if (wert !== (m.behebung_notiz ?? null)) {
                                  aktualisieren(m, { behebung_notiz: wert });
                                }
                              }}
                            />
                          </label>
                        )}
                        <div>
                          <div className="mb-1 text-sm font-medium">Fotos</div>
                          <FotoAufnahme
                            zimmerId={m.zimmer_id}
                            mangelId={m.id}
                            disabled={!canEdit}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {gefiltert.length === 0 && (
            <tr>
              <td colSpan={6} className="text-sm text-neutral-400">
                keine Mängel im Filter
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
