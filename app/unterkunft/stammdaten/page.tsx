"use client";

// Unterkunft → Stammdaten (Migration 2026-08-29): Gebäude, Zimmer und Betten
// pflegen, dazu die Checklisten-Vorlage für Übergabe/Abnahme/Kontrolle.
// Pflege nur admin/hr (RLS), andere sehen die Seite schreibgeschützt.

import { Fragment, useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import type {
  UnterkunftBett,
  UnterkunftChecklisteVorlage,
  UnterkunftGebaeude,
  UnterkunftZimmer,
} from "@/lib/types";

export default function UnterkunftStammdatenPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [betten, setBetten] = useState<UnterkunftBett[]>([]);
  const [vorlage, setVorlage] = useState<UnterkunftChecklisteVorlage[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenesGebaeude, setOffenesGebaeude] = useState<number | null>(null);
  const [offenesZimmer, setOffenesZimmer] = useState<number | null>(null);

  // Eingabe-Entwürfe
  const [neuesGebaeude, setNeuesGebaeude] = useState({ name: "", adresse: "" });
  const [neuesZimmer, setNeuesZimmer] = useState({
    nummer: "",
    etage: "",
    bettenzahl: "",
  });
  const [neuesBett, setNeuesBett] = useState("");
  const [sammelAnzahl, setSammelAnzahl] = useState("");
  const [neuerBereich, setNeuerBereich] = useState({ bereich: "", reihenfolge: "" });

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, z, b, v] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase.from("unterkunft_zimmer").select("*").order("nummer"),
      supabase.from("unterkunft_bett").select("*").order("bezeichnung"),
      supabase
        .from("unterkunft_checkliste_vorlage")
        .select("*")
        .eq("aktiv", true)
        .order("reihenfolge"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setBetten((b.data as UnterkunftBett[]) ?? []);
    setVorlage((v.data as UnterkunftChecklisteVorlage[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  async function ausfuehren(
    fn: () => PromiseLike<{ error: { message: string } | null }>
  ) {
    setFehler(null);
    const { error } = await fn();
    if (error) {
      setFehler(error.message);
      return false;
    }
    await laden();
    return true;
  }

  // --- Gebäude ---
  async function gebaeudeAnlegen() {
    if (!neuesGebaeude.name.trim()) return;
    const ok = await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_gebaeude")
        .insert({
          name: neuesGebaeude.name.trim(),
          adresse: neuesGebaeude.adresse.trim() || null,
        })
    );
    if (ok) setNeuesGebaeude({ name: "", adresse: "" });
  }

  async function gebaeudeAktivSetzen(g: UnterkunftGebaeude, aktiv: boolean) {
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_gebaeude")
        .update({ aktiv, updated_by: profile?.id ?? null })
        .eq("id", g.id)
    );
  }

  // --- Zimmer ---
  async function zimmerAnlegen(gebaeudeId: number) {
    if (!neuesZimmer.nummer.trim()) return;
    const ok = await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_zimmer")
        .insert({
          gebaeude_id: gebaeudeId,
          nummer: neuesZimmer.nummer.trim(),
          etage: neuesZimmer.etage.trim() || null,
          bettenzahl: neuesZimmer.bettenzahl ? Number(neuesZimmer.bettenzahl) : null,
        })
    );
    if (ok) setNeuesZimmer({ nummer: "", etage: "", bettenzahl: "" });
  }

  async function zimmerAktivSetzen(z: UnterkunftZimmer, aktiv: boolean) {
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_zimmer")
        .update({ aktiv, updated_by: profile?.id ?? null })
        .eq("id", z.id)
    );
  }

  // --- Betten ---
  async function bettAnlegen(zimmerId: number) {
    if (!neuesBett.trim()) return;
    const ok = await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_bett")
        .insert({ zimmer_id: zimmerId, bezeichnung: neuesBett.trim() })
    );
    if (ok) setNeuesBett("");
  }

  async function bettenSammelanlage(zimmerId: number) {
    const anzahl = Number(sammelAnzahl);
    if (!anzahl || anzahl < 1) return;
    setFehler(null);
    const { error } = await getSupabaseClient().rpc("unterkunft_bett_sammelanlage", {
      p_zimmer_id: zimmerId,
      p_anzahl: anzahl,
    });
    if (error) {
      setFehler(error.message);
      return;
    }
    setSammelAnzahl("");
    await laden();
  }

  async function bettAktivSetzen(b: UnterkunftBett, aktiv: boolean) {
    await ausfuehren(() =>
      getSupabaseClient().from("unterkunft_bett").update({ aktiv }).eq("id", b.id)
    );
  }

  // --- Checkliste ---
  async function bereichAnlegen() {
    if (!neuerBereich.bereich.trim()) return;
    const maxReihenfolge = vorlage.reduce((m, v) => Math.max(m, v.reihenfolge), 0);
    const ok = await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_checkliste_vorlage")
        .insert({
          bereich: neuerBereich.bereich.trim(),
          reihenfolge: neuerBereich.reihenfolge
            ? Number(neuerBereich.reihenfolge)
            : maxReihenfolge + 10,
        })
    );
    if (ok) setNeuerBereich({ bereich: "", reihenfolge: "" });
  }

  async function bereichEntfernen(v: UnterkunftChecklisteVorlage) {
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_checkliste_vorlage")
        .update({ aktiv: false })
        .eq("id", v.id)
    );
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-8">
      <UnterkunftTabs />

      <div>
        <h1 className="text-lg font-semibold text-emerald-900">Stammdaten</h1>
        <p className="text-sm text-neutral-500">
          Gebäude, Zimmer und Betten. {canEdit ? "" : "Nur admin/hr dürfen ändern."}
        </p>
      </div>

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {/* Gebäude + Zimmer + Betten */}
      <section className="space-y-3">
        <h2 className="font-semibold text-neutral-800">Gebäude</h2>

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Name
              <input
                className="ml-2"
                value={neuesGebaeude.name}
                onChange={(e) =>
                  setNeuesGebaeude((s) => ({ ...s, name: e.target.value }))
                }
              />
            </label>
            <label className="text-sm">
              Adresse
              <input
                className="ml-2"
                value={neuesGebaeude.adresse}
                onChange={(e) =>
                  setNeuesGebaeude((s) => ({ ...s, adresse: e.target.value }))
                }
              />
            </label>
            <button className="btn" onClick={gebaeudeAnlegen}>
              Gebäude anlegen
            </button>
          </div>
        )}

        <div className="space-y-2">
          {gebaeude.map((g) => {
            const zimmerDesGebaeudes = zimmer.filter((z) => z.gebaeude_id === g.id);
            const offen = offenesGebaeude === g.id;
            return (
              <div key={g.id} className="rounded border border-neutral-200">
                <div className="flex items-center justify-between gap-2 bg-neutral-50 px-3 py-2">
                  <button
                    className="text-left text-sm font-medium"
                    onClick={() => setOffenesGebaeude(offen ? null : g.id)}
                  >
                    {offen ? "▾" : "▸"} {g.name}
                    {g.adresse ? ` · ${g.adresse}` : ""}{" "}
                    <span className="text-neutral-400">
                      ({zimmerDesGebaeudes.length} Zimmer)
                    </span>
                    {!g.aktiv && (
                      <span className="ml-2 text-xs text-red-600">inaktiv</span>
                    )}
                  </button>
                  {canEdit && (
                    <button
                      className="btn-secondary"
                      onClick={() => gebaeudeAktivSetzen(g, !g.aktiv)}
                    >
                      {g.aktiv ? "Deaktivieren" : "Aktivieren"}
                    </button>
                  )}
                </div>

                {offen && (
                  <div className="space-y-3 px-3 py-3">
                    {canEdit && (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-sm">
                          Nummer
                          <input
                            className="ml-2 w-24"
                            value={neuesZimmer.nummer}
                            onChange={(e) =>
                              setNeuesZimmer((s) => ({
                                ...s,
                                nummer: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="text-sm">
                          Etage
                          <input
                            className="ml-2 w-20"
                            value={neuesZimmer.etage}
                            onChange={(e) =>
                              setNeuesZimmer((s) => ({
                                ...s,
                                etage: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="text-sm">
                          Betten (Soll)
                          <input
                            type="number"
                            className="ml-2 w-20"
                            value={neuesZimmer.bettenzahl}
                            onChange={(e) =>
                              setNeuesZimmer((s) => ({
                                ...s,
                                bettenzahl: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <button className="btn" onClick={() => zimmerAnlegen(g.id)}>
                          Zimmer anlegen
                        </button>
                      </div>
                    )}

                    <table>
                      <thead>
                        <tr>
                          <th>Zimmer</th>
                          <th>Etage</th>
                          <th>Betten</th>
                          <th>Status</th>
                          {canEdit && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {zimmerDesGebaeudes.map((z) => {
                          const bettenDesZimmers = betten.filter(
                            (b) => b.zimmer_id === z.id
                          );
                          const aktiveBetten = bettenDesZimmers.filter((b) => b.aktiv);
                          const zOffen = offenesZimmer === z.id;
                          return (
                            <Fragment key={z.id}>
                              <tr>
                                <td>
                                  <button
                                    className="font-medium text-emerald-800"
                                    onClick={() =>
                                      setOffenesZimmer(zOffen ? null : z.id)
                                    }
                                  >
                                    {zOffen ? "▾" : "▸"} {z.nummer}
                                  </button>
                                </td>
                                <td>{z.etage ?? "—"}</td>
                                <td>
                                  {aktiveBetten.length}
                                  {z.bettenzahl != null &&
                                  z.bettenzahl !== aktiveBetten.length
                                    ? ` / ${z.bettenzahl} Soll`
                                    : ""}
                                </td>
                                <td>
                                  {z.aktiv ? (
                                    "aktiv"
                                  ) : (
                                    <span className="text-red-600">inaktiv</span>
                                  )}
                                </td>
                                {canEdit && (
                                  <td>
                                    <button
                                      className="btn-secondary"
                                      onClick={() => zimmerAktivSetzen(z, !z.aktiv)}
                                    >
                                      {z.aktiv ? "Deaktivieren" : "Aktivieren"}
                                    </button>
                                  </td>
                                )}
                              </tr>
                              {zOffen && (
                                <tr>
                                  <td colSpan={canEdit ? 5 : 4} className="bg-neutral-50">
                                    <div className="space-y-2 p-2">
                                      <div className="text-sm font-medium">
                                        Betten in Zimmer {z.nummer}
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {bettenDesZimmers.length === 0 && (
                                          <span className="text-sm text-neutral-400">
                                            noch keine Betten
                                          </span>
                                        )}
                                        {bettenDesZimmers.map((b) => (
                                          <span
                                            key={b.id}
                                            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm ${
                                              b.aktiv
                                                ? "border-neutral-300"
                                                : "border-red-200 text-red-500 line-through"
                                            }`}
                                          >
                                            {b.bezeichnung}
                                            {canEdit && (
                                              <button
                                                title={
                                                  b.aktiv
                                                    ? "Bett deaktivieren"
                                                    : "Bett aktivieren"
                                                }
                                                onClick={() =>
                                                  bettAktivSetzen(b, !b.aktiv)
                                                }
                                                className="text-neutral-400 hover:text-neutral-700"
                                              >
                                                {b.aktiv ? "×" : "↺"}
                                              </button>
                                            )}
                                          </span>
                                        ))}
                                      </div>
                                      {canEdit && (
                                        <div className="flex flex-wrap items-end gap-2">
                                          <label className="text-sm">
                                            Bett
                                            <input
                                              className="ml-2 w-28"
                                              value={neuesBett}
                                              onChange={(e) =>
                                                setNeuesBett(e.target.value)
                                              }
                                              placeholder="z.B. A"
                                            />
                                          </label>
                                          <button
                                            className="btn-secondary"
                                            onClick={() => bettAnlegen(z.id)}
                                          >
                                            Bett anlegen
                                          </button>
                                          <span className="text-neutral-300">|</span>
                                          <label className="text-sm">
                                            Anzahl
                                            <input
                                              type="number"
                                              className="ml-2 w-16"
                                              value={sammelAnzahl}
                                              onChange={(e) =>
                                                setSammelAnzahl(e.target.value)
                                              }
                                            />
                                          </label>
                                          <button
                                            className="btn-secondary"
                                            onClick={() => bettenSammelanlage(z.id)}
                                          >
                                            Betten 1…n anlegen
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {zimmerDesGebaeudes.length === 0 && (
                          <tr>
                            <td
                              colSpan={canEdit ? 5 : 4}
                              className="text-sm text-neutral-400"
                            >
                              noch keine Zimmer
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {gebaeude.length === 0 && (
            <p className="text-sm text-neutral-400">Noch keine Gebäude angelegt.</p>
          )}
        </div>
      </section>

      {/* Checklisten-Vorlage */}
      <section className="space-y-3">
        <h2 className="font-semibold text-neutral-800">Checklisten-Bereiche</h2>
        <p className="text-sm text-neutral-500">
          Wird bei jeder Übergabe/Abnahme/Kontrolle abgefragt. Änderungen wirken nur
          auf neue Vorgänge – bestehende Protokolle bleiben unverändert.
        </p>
        <ol className="list-decimal space-y-1 pl-6 text-sm">
          {vorlage.map((v) => (
            <li key={v.id} className="flex items-center gap-2">
              <span>{v.bereich}</span>
              {canEdit && (
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => bereichEntfernen(v)}
                >
                  entfernen
                </button>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Bereich
              <input
                className="ml-2"
                value={neuerBereich.bereich}
                onChange={(e) =>
                  setNeuerBereich((s) => ({ ...s, bereich: e.target.value }))
                }
              />
            </label>
            <label className="text-sm">
              Reihenfolge
              <input
                type="number"
                className="ml-2 w-20"
                value={neuerBereich.reihenfolge}
                onChange={(e) =>
                  setNeuerBereich((s) => ({ ...s, reihenfolge: e.target.value }))
                }
              />
            </label>
            <button className="btn-secondary" onClick={bereichAnlegen}>
              Bereich hinzufügen
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
