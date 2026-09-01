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
import { raumName } from "@/lib/unterkunft";
import {
  UNTERKUNFT_MANGEL_KATEGORIE_LABELS,
  UNTERKUNFT_MANGEL_SCHWERE_LABELS,
  UNTERKUNFT_MANGEL_STATUS_LABELS,
  type UnterkunftBelegungPerson,
  type UnterkunftGebaeude,
  type UnterkunftMangel,
  type UnterkunftMangelKategorie,
  type UnterkunftMangelSchwere,
  type UnterkunftMangelStatus,
  type UnterkunftZimmer,
} from "@/lib/types";

export default function UnterkunftMaengelPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "hausmeister";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [wohneinheiten, setWohneinheiten] = useState<
    { id: number; name: string }[]
  >([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [maengel, setMaengel] = useState<UnterkunftMangel[]>([]);
  // Eingeklappte Gruppen (Haus / Wohneinheit) in der Liste.
  const [zuKollaps, setZuKollaps] = useState<Set<string>>(new Set());
  const toggleKollaps = (k: string) =>
    setZuKollaps((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"offen_arbeit" | "alle" | UnterkunftMangelStatus>(
    "offen_arbeit"
  );
  const [gebaeudeFilter, setGebaeudeFilter] = useState("");
  const [kategorieFilter, setKategorieFilter] = useState<
    "alle" | UnterkunftMangelKategorie
  >("alle");
  const [offenId, setOffenId] = useState<number | null>(null);
  // Deep-Link aus Grundriss / Kontrollplan: ?mangel=<id> zeigt genau diesen
  // Mangel, ?zimmer=<id> alle Mängel dieses Raums.
  const [fokus, setFokus] = useState<{ zimmerId?: number; mangelId?: number } | null>(
    null
  );

  const [neu, setNeu] = useState({
    gebaeude_id: "",
    zimmer_id: "",
    beschreibung: "",
    schwere: "mittel" as UnterkunftMangelSchwere,
    kategorie: "reinigung" as UnterkunftMangelKategorie,
  });

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, w, z, m, bp] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase.from("unterkunft_wohneinheit").select("id, name").order("name"),
      supabase.from("unterkunft_zimmer").select("*").order("nummer"),
      supabase
        .from("unterkunft_mangel")
        .select("*")
        .order("gemeldet_am", { ascending: false }),
      supabase
        .from("unterkunft_belegung_person")
        .select("*")
        .order("von", { ascending: false }),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setWohneinheiten((w.data as { id: number; name: string }[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setMaengel((m.data as UnterkunftMangel[]) ?? []);
    setBelegungen((bp.data as UnterkunftBelegungPerson[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const mangel = q.get("mangel");
    const zimmerP = q.get("zimmer");
    if (mangel) setFokus({ mangelId: Number(mangel) });
    else if (zimmerP) setFokus({ zimmerId: Number(zimmerP) });
  }, []);

  // Fokussierten Mangel automatisch aufklappen (bzw. den einzigen des Raums).
  useEffect(() => {
    if (fokus?.mangelId) {
      setOffenId(fokus.mangelId);
    } else if (fokus?.zimmerId) {
      const treffer = maengel.filter((m) => m.zimmer_id === fokus.zimmerId);
      if (treffer.length === 1) setOffenId(treffer[0].id);
    }
  }, [fokus, maengel]);

  function fokusAufheben() {
    setFokus(null);
    window.history.replaceState(null, "", "/unterkunft/maengel");
  }

  function zimmerLabel(zimmerId: number): string {
    const z = zimmer.find((x) => x.id === zimmerId);
    const g = z ? gebaeude.find((x) => x.id === z.gebaeude_id) : undefined;
    if (!z) return `Zimmer ${zimmerId}`;
    return `${g?.name ?? "?"} · ${
      z.art === "zimmer" ? `Zimmer ${z.nummer}` : raumName(z)
    }`;
  }

  // Bewohner zur Rückverfolgung: bei einem Zimmer-Mangel die Bewohner dieses
  // Zimmers, bei einem Allgemeinraum (Küche/Bad/Flur/…) die der ganzen
  // Wohneinheit. Zeitraum: alle, deren Aufenthalt seit der Meldung (mit)lief.
  function bewohnerFuerMangel(m: UnterkunftMangel): {
    abZimmer: boolean;
    titel: string;
    personen: UnterkunftBelegungPerson[];
  } {
    const z = zimmer.find((x) => x.id === m.zimmer_id);
    const abZimmer = z?.art === "zimmer";
    const gemeldet = m.gemeldet_am.slice(0, 10);
    const heute = new Date().toISOString().slice(0, 10);
    const personen = !z
      ? []
      : belegungen.filter((b) => {
          const passt = abZimmer
            ? b.zimmer_id === z.id
            : z.wohneinheit_id != null && b.wohneinheit_id === z.wohneinheit_id;
          return (
            passt && (b.bis === null || b.bis >= gemeldet) && b.von <= heute
          );
        });
    const weName =
      z && !abZimmer
        ? (belegungen.find((b) => b.wohneinheit_id === z.wohneinheit_id)
            ?.wohneinheit_name ?? null)
        : null;
    const titel = !z
      ? "Bewohner"
      : abZimmer
        ? `Bewohner Zimmer ${z.nummer}`
        : `Bewohner Wohneinheit${weName ? ` ${weName}` : ""}`;
    return { abZimmer, titel, personen };
  }

  const zimmerDesGebaeudes = zimmer.filter(
    (z) => String(z.gebaeude_id) === neu.gebaeude_id
  );

  const gefiltert = useMemo(() => {
    // Fokus (Deep-Link) hat Vorrang und ignoriert Status-/Gebäudefilter.
    if (fokus?.mangelId) return maengel.filter((m) => m.id === fokus.mangelId);
    return maengel.filter((m) => {
      if (fokus?.zimmerId && m.zimmer_id !== fokus.zimmerId) return false;
      if (kategorieFilter !== "alle" && m.kategorie !== kategorieFilter)
        return false;
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
  }, [maengel, statusFilter, gebaeudeFilter, kategorieFilter, zimmer, fokus]);

  // Aufklappbare Gruppierung Haus → Wohneinheit (Nutzer-Vorgabe 2026-09-01).
  const gruppiert = useMemo(() => {
    const zById = new Map(zimmer.map((z) => [z.id, z]));
    const gName = new Map(gebaeude.map((g) => [g.id, g.name]));
    const wName = new Map(wohneinheiten.map((w) => [w.id, w.name]));
    const gm = new Map<
      number,
      {
        gebId: number;
        gebName: string;
        total: number;
        offen: number;
        einheiten: Map<
          string,
          { key: string; weName: string; maengel: UnterkunftMangel[] }
        >;
      }
    >();
    for (const m of gefiltert) {
      const z = zById.get(m.zimmer_id);
      const gebId = z?.gebaeude_id ?? -1;
      let g = gm.get(gebId);
      if (!g) {
        g = {
          gebId,
          gebName: gName.get(gebId) ?? "Ohne Gebäude",
          total: 0,
          offen: 0,
          einheiten: new Map(),
        };
        gm.set(gebId, g);
      }
      g.total++;
      if (m.status !== "behoben") g.offen++;
      const weId = z?.wohneinheit_id ?? null;
      const key = weId == null ? `w:none:${gebId}` : `w:${weId}`;
      let w = g.einheiten.get(key);
      if (!w) {
        w = {
          key,
          weName:
            weId == null
              ? "Ohne Wohneinheit"
              : (wName.get(weId) ?? `Wohneinheit ${weId}`),
          maengel: [],
        };
        g.einheiten.set(key, w);
      }
      w.maengel.push(m);
    }
    return [...gm.values()]
      .sort((a, b) =>
        a.gebName.localeCompare(b.gebName, "de", { numeric: true })
      )
      .map((g) => ({
        ...g,
        einheiten: [...g.einheiten.values()].sort((a, b) =>
          a.weName.localeCompare(b.weName, "de", { numeric: true })
        ),
      }));
  }, [gefiltert, zimmer, gebaeude, wohneinheiten]);

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
        kategorie: neu.kategorie,
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
          <label>
            Kategorie
            <select
              className="ml-2"
              value={kategorieFilter}
              onChange={(e) =>
                setKategorieFilter(
                  e.target.value as "alle" | UnterkunftMangelKategorie
                )
              }
            >
              <option value="alle">alle</option>
              {(
                Object.keys(
                  UNTERKUNFT_MANGEL_KATEGORIE_LABELS
                ) as UnterkunftMangelKategorie[]
              ).map((k) => (
                <option key={k} value={k}>
                  {UNTERKUNFT_MANGEL_KATEGORIE_LABELS[k]}
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

      {fokus && (
        <p className="flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Angezeigt:{" "}
          {fokus.mangelId
            ? "ein einzelner Mangel"
            : `nur ${zimmerLabel(fokus.zimmerId as number)}`}
          <button
            className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs"
            onClick={fokusAufheben}
          >
            alle Mängel anzeigen
          </button>
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
                    {raumName(z)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kategorie
              <select
                className="ml-2"
                value={neu.kategorie}
                onChange={(e) =>
                  setNeu((s) => ({
                    ...s,
                    kategorie: e.target.value as UnterkunftMangelKategorie,
                  }))
                }
              >
                {(
                  Object.keys(
                    UNTERKUNFT_MANGEL_KATEGORIE_LABELS
                  ) as UnterkunftMangelKategorie[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {UNTERKUNFT_MANGEL_KATEGORIE_LABELS[k]}
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
            <th>Kategorie</th>
            <th>Schwere</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const renderMangel = (m: UnterkunftMangel) => {
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
                        value={m.kategorie}
                        onChange={(e) =>
                          aktualisieren(m, {
                            kategorie: e.target
                              .value as UnterkunftMangelKategorie,
                          })
                        }
                      >
                        {(
                          Object.keys(
                            UNTERKUNFT_MANGEL_KATEGORIE_LABELS
                          ) as UnterkunftMangelKategorie[]
                        ).map((k) => (
                          <option key={k} value={k}>
                            {UNTERKUNFT_MANGEL_KATEGORIE_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      UNTERKUNFT_MANGEL_KATEGORIE_LABELS[m.kategorie]
                    )}
                  </td>
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
                    <td colSpan={7} className="bg-neutral-50">
                      <div className="space-y-3 p-3">
                        <div className="text-sm text-neutral-600">
                          {m.quelle_vorgang_id
                            ? "Entstanden aus einem Übergabe-/Kontroll-Vorgang."
                            : "Direkt angelegt."}
                          {m.behoben_am &&
                            ` · Behoben am ${formatDatumDE(m.behoben_am)}.`}
                        </div>

                        {(() => {
                          const { abZimmer, titel, personen } =
                            bewohnerFuerMangel(m);
                          return (
                            <details className="text-sm">
                              <summary className="cursor-pointer font-medium text-neutral-700">
                                {titel} ({personen.length})
                              </summary>
                              {personen.length === 0 ? (
                                <p className="mt-1 text-neutral-400">
                                  niemand seit der Meldung (
                                  {formatDatumDE(m.gemeldet_am)}).
                                </p>
                              ) : (
                                <ul className="mt-1 space-y-0.5">
                                  {personen.map((b) => (
                                    <li key={b.id}>
                                      {b.vorname} {b.name}
                                      {b.herkunft ? (
                                        <span className="text-neutral-400">
                                          {" "}
                                          · {b.herkunft}
                                        </span>
                                      ) : null}
                                      {!abZimmer && (
                                        <span className="text-neutral-400">
                                          {" "}
                                          · Zi. {b.zimmer_nummer}
                                        </span>
                                      )}
                                      <span className="text-neutral-400">
                                        {" "}
                                        — {formatDatumDE(b.von)}–
                                        {b.bis ? formatDatumDE(b.bis) : "offen"}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </details>
                          );
                        })()}
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
                    </td>
                  </tr>
                )}
              </Fragment>
            );
            };
            if (fokus) return gefiltert.map(renderMangel);
            return gruppiert.map((g) => {
              const gZu = zuKollaps.has(`g:${g.gebId}`);
              return (
                <Fragment key={`g${g.gebId}`}>
                  <tr>
                    <td colSpan={7} className="p-0">
                      <button
                        className="flex w-full items-center gap-2 bg-neutral-100 px-2 py-1.5 text-left font-semibold text-emerald-900"
                        onClick={() => toggleKollaps(`g:${g.gebId}`)}
                      >
                        <span>{gZu ? "▸" : "▾"}</span>
                        {g.gebName}
                        <span className="rounded-full bg-neutral-300 px-2 py-0.5 text-xs font-normal">
                          {g.total}
                        </span>
                        {g.offen > 0 && (
                          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                            {g.offen} offen
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                  {!gZu &&
                    g.einheiten.map((w) => {
                      const wZu = zuKollaps.has(w.key);
                      return (
                        <Fragment key={w.key}>
                          <tr>
                            <td colSpan={7} className="p-0">
                              <button
                                className="flex w-full items-center gap-2 bg-neutral-50 px-2 py-1 pl-6 text-left text-sm font-medium text-neutral-700"
                                onClick={() => toggleKollaps(w.key)}
                              >
                                <span>{wZu ? "▸" : "▾"}</span>
                                {w.weName}
                                <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-xs font-normal">
                                  {w.maengel.length}
                                </span>
                              </button>
                            </td>
                          </tr>
                          {!wZu && w.maengel.map(renderMangel)}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            });
          })()}
          {gefiltert.length === 0 && (
            <tr>
              <td colSpan={7} className="text-sm text-neutral-400">
                keine Mängel im Filter
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
