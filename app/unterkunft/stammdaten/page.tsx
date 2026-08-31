"use client";

// Unterkunft → Stammdaten (Migration 2026-08-29): Gebäude und Zimmer pflegen
// (je Zimmer nur die Anzahl Schlafplätze), dazu die Checklisten-Vorlage für
// Übergabe/Abnahme/Kontrolle. Pflege nur admin/hr (RLS), andere sehen die
// Seite schreibgeschützt.

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import type {
  UnterkunftChecklisteVorlage,
  UnterkunftKontrollIntervall,
  UnterkunftWohneinheit,
  UnterkunftGebaeude,
  UnterkunftZimmer,
  UnterkunftZimmerArt,
} from "@/lib/types";

const RAUMTYP_LABEL: Record<UnterkunftZimmerArt, string> = {
  zimmer: "Schlafzimmer",
  kueche: "Küche",
  bad: "Bad / WC",
  flur: "Flur",
  gemeinschaft: "Gemeinschaftsraum",
};

export default function UnterkunftStammdatenPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";
  const isAdmin = profile?.role === "admin";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [wohneinheiten, setWohneinheiten] = useState<UnterkunftWohneinheit[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [vorlage, setVorlage] = useState<UnterkunftChecklisteVorlage[]>([]);
  const [intervalle, setIntervalle] = useState<UnterkunftKontrollIntervall[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenesGebaeude, setOffenesGebaeude] = useState<number | null>(null);

  // Eingabe-Entwürfe
  const [neuesGebaeude, setNeuesGebaeude] = useState({ name: "", adresse: "" });
  const [neuesZimmer, setNeuesZimmer] = useState({
    nummer: "",
    wohneinheitId: "",
    bettenzahl: "",
  });
  const [neueWohneinheit, setNeueWohneinheit] = useState({
    name: "",
    etage_label: "",
    reihenfolge: "",
  });
  const [neuerBereich, setNeuerBereich] = useState({ bereich: "", reihenfolge: "" });

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, et, z, v, ki] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase
        .from("unterkunft_wohneinheit")
        .select("*")
        .order("gebaeude_id")
        .order("reihenfolge"),
      supabase.from("unterkunft_zimmer").select("*").order("nummer"),
      supabase
        .from("unterkunft_checkliste_vorlage")
        .select("*")
        .eq("aktiv", true)
        .order("reihenfolge"),
      supabase.from("unterkunft_kontroll_intervall").select("*"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setWohneinheiten((et.data as UnterkunftWohneinheit[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setVorlage((v.data as UnterkunftChecklisteVorlage[]) ?? []);
    setIntervalle((ki.data as UnterkunftKontrollIntervall[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  function fehlerText(error: { message: string; code?: string }): string {
    if (error.code === "23505")
      return (
        "Name ist schon vergeben – der Eintrag existiert vermutlich noch " +
        "(evtl. inaktiv) in der Liste."
      );
    if (error.code === "23503")
      return (
        "Es hängen noch verknüpfte Daten daran – erst diese entfernen oder " +
        "deaktivieren."
      );
    return error.message;
  }

  async function ausfuehren(
    fn: () => PromiseLike<{ error: { message: string; code?: string } | null }>
  ) {
    setFehler(null);
    const { error } = await fn();
    if (error) {
      setFehler(fehlerText(error));
      return false;
    }
    await laden();
    return true;
  }

  // Einfaches Löschen (Eintrag ohne Abhängigkeiten). Bei FK-Schutz ein
  // verständlicher Hinweis. Für „echte" Bestände bleibt Deaktivieren der
  // richtige Weg (ADR-011).
  async function loeschen(
    tabelle: string,
    id: number,
    was: string
  ): Promise<boolean> {
    setFehler(null);
    const { error } = await getSupabaseClient().from(tabelle).delete().eq("id", id);
    if (error) {
      const fk =
        error.code === "23503" ||
        /foreign key|verletzt|violates/i.test(error.message);
      setFehler(
        fk
          ? `${was} kann nicht gelöscht werden – es hängen noch Daten daran. ` +
            `Erst diese entfernen oder ${was} deaktivieren.`
          : error.message
      );
      return false;
    }
    await laden();
    return true;
  }

  // Zimmer + ALLES daran (Vorgänge inkl. Positionen/Fotos, Mängel, Belegungen)
  // hart löschen - nur Admin, nur zur Testdaten-Bereinigung. Gibt eine
  // Fehlermeldung zurück oder null bei Erfolg. Ruft laden() NICHT selbst auf.
  async function zimmerHartLoeschen(
    sb: ReturnType<typeof getSupabaseClient>,
    zimmerId: number
  ): Promise<string | null> {
    const { data: vg } = await sb
      .from("unterkunft_vorgang")
      .select("id, abgeschlossen")
      .eq("zimmer_id", zimmerId);
    const abg = ((vg as { id: string; abgeschlossen: boolean }[]) ?? [])
      .filter((v) => v.abgeschlossen)
      .map((v) => v.id);
    // Abgeschlossene Vorgänge sind trigger-geschützt: als Admin erst „öffnen".
    if (abg.length) {
      const { error } = await sb
        .from("unterkunft_vorgang")
        .update({ abgeschlossen: false })
        .in("id", abg);
      if (error) return error.message;
    }
    const schritte: (() => PromiseLike<{ error: { message: string } | null }>)[] = [
      () => sb.from("unterkunft_vorgang").delete().eq("zimmer_id", zimmerId),
      () => sb.from("unterkunft_mangel").delete().eq("zimmer_id", zimmerId),
      () => sb.from("unterkunft_zuordnung").delete().eq("zimmer_id", zimmerId),
      () => sb.from("unterkunft_belegung").delete().eq("zimmer_id", zimmerId),
      () => sb.from("unterkunft_zimmer").delete().eq("id", zimmerId),
    ];
    for (const schritt of schritte) {
      const { error } = await schritt();
      if (error) return error.message;
    }
    return null;
  }

  async function zimmerLoeschen(z: UnterkunftZimmer) {
    const sb = getSupabaseClient();
    const [vg, mg, bl] = await Promise.all([
      sb.from("unterkunft_vorgang").select("id").eq("zimmer_id", z.id),
      sb.from("unterkunft_mangel").select("id").eq("zimmer_id", z.id),
      sb.from("unterkunft_belegung").select("id").eq("zimmer_id", z.id),
    ]);
    const nVg = vg.data?.length ?? 0;
    const nMg = mg.data?.length ?? 0;
    const nBl = bl.data?.length ?? 0;
    const hatVorgeschichte = nVg + nMg + nBl > 0;

    if (hatVorgeschichte && !isAdmin) {
      setFehler(
        `Zimmer ${z.nummer} hat ${nVg} Vorgang/Vorgänge, ${nMg} Mangel/Mängel ` +
          `und ${nBl} Belegung(en). Nur ein Admin kann es endgültig mit allem ` +
          `löschen – sonst deaktivieren.`
      );
      return;
    }
    if (
      !window.confirm(
        hatVorgeschichte
          ? `Zimmer ${z.nummer} UNWIDERRUFLICH löschen – inklusive ${nVg} ` +
            `Übergabe/Kontrolle, ${nMg} Mangel/Mängel und ${nBl} Belegung(en)? ` +
            `(nur Testdaten!)`
          : `Zimmer ${z.nummer} endgültig löschen?`
      )
    )
      return;
    setFehler(null);
    const err = await zimmerHartLoeschen(sb, z.id);
    if (err) {
      setFehler(err);
      return;
    }
    await laden();
  }

  async function wohneinheitLoeschen(w: UnterkunftWohneinheit) {
    const sb = getSupabaseClient();
    const zimmerDW = zimmer.filter((z) => z.wohneinheit_id === w.id);
    if (zimmerDW.length && !isAdmin) {
      setFehler(
        `„${w.name}" hat noch ${zimmerDW.length} Zimmer – erst diese löschen.`
      );
      return;
    }
    if (
      !window.confirm(
        zimmerDW.length
          ? `Wohneinheit „${w.name}" UNWIDERRUFLICH löschen – mit ${zimmerDW.length} ` +
            `Zimmer und allem daran? (nur Testdaten!)`
          : `Wohneinheit „${w.name}" endgültig löschen?`
      )
    )
      return;
    setFehler(null);
    for (const z of zimmerDW) {
      const err = await zimmerHartLoeschen(sb, z.id);
      if (err) {
        setFehler(err);
        await laden();
        return;
      }
    }
    const { error } = await sb
      .from("unterkunft_zuordnung")
      .delete()
      .eq("wohneinheit_id", w.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    await loeschen("unterkunft_wohneinheit", w.id, "Die Wohneinheit");
  }

  async function gebaeudeLoeschen(g: UnterkunftGebaeude) {
    const sb = getSupabaseClient();
    const zimmerDG = zimmer.filter((z) => z.gebaeude_id === g.id);
    const wohnDG = wohneinheiten.filter((w) => w.gebaeude_id === g.id);
    const hat = zimmerDG.length + wohnDG.length > 0;
    if (hat && !isAdmin) {
      setFehler(
        `„${g.name}" hat noch ${wohnDG.length} Wohneinheit(en) / ${zimmerDG.length} ` +
          `Zimmer – erst diese löschen.`
      );
      return;
    }
    if (
      !window.confirm(
        hat
          ? `Gebäude „${g.name}" UNWIDERRUFLICH löschen – mit ${wohnDG.length} ` +
            `Wohneinheit(en), ${zimmerDG.length} Zimmer und allem daran? ` +
            `(nur Testdaten!)`
          : `Gebäude „${g.name}" endgültig löschen?`
      )
    )
      return;
    setFehler(null);
    for (const z of zimmerDG) {
      const err = await zimmerHartLoeschen(sb, z.id);
      if (err) {
        setFehler(err);
        await laden();
        return;
      }
    }
    for (const w of wohnDG) {
      const { error } = await sb
        .from("unterkunft_zuordnung")
        .delete()
        .eq("wohneinheit_id", w.id);
      if (error) {
        setFehler(error.message);
        await laden();
        return;
      }
      const { error: e2 } = await sb
        .from("unterkunft_wohneinheit")
        .delete()
        .eq("id", w.id);
      if (e2) {
        setFehler(e2.message);
        await laden();
        return;
      }
    }
    await loeschen("unterkunft_gebaeude", g.id, "Das Gebäude");
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

  // --- Wohneinheiten ---
  async function wohneinheitAnlegen(gebaeudeId: number) {
    if (!neueWohneinheit.name.trim()) return;
    const maxR = wohneinheiten
      .filter((e) => e.gebaeude_id === gebaeudeId)
      .reduce((m, e) => Math.max(m, e.reihenfolge), 0);
    const ok = await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_wohneinheit")
        .insert({
          gebaeude_id: gebaeudeId,
          name: neueWohneinheit.name.trim(),
          etage_label: neueWohneinheit.etage_label.trim() || null,
          reihenfolge: neueWohneinheit.reihenfolge
            ? Number(neueWohneinheit.reihenfolge)
            : maxR + 10,
        })
    );
    if (ok) setNeueWohneinheit({ name: "", etage_label: "", reihenfolge: "" });
  }

  async function wohneinheitEtageLabel(e: UnterkunftWohneinheit, etage_label: string) {
    const v = etage_label.trim() || null;
    if (v === (e.etage_label ?? null)) return;
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_wohneinheit")
        .update({ etage_label: v, updated_by: profile?.id ?? null })
        .eq("id", e.id)
    );
  }

  async function wohneinheitUmbenennen(e: UnterkunftWohneinheit) {
    const name = window.prompt("Neuer Name der Wohneinheit", e.name)?.trim();
    if (!name || name === e.name) return;
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_wohneinheit")
        .update({ name, updated_by: profile?.id ?? null })
        .eq("id", e.id)
    );
  }

  async function wohneinheitReihenfolge(e: UnterkunftWohneinheit, reihenfolge: number) {
    if (Number.isNaN(reihenfolge) || reihenfolge === e.reihenfolge) return;
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_wohneinheit")
        .update({ reihenfolge, updated_by: profile?.id ?? null })
        .eq("id", e.id)
    );
  }

  async function wohneinheitAktivSetzen(e: UnterkunftWohneinheit, aktiv: boolean) {
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_wohneinheit")
        .update({ aktiv, updated_by: profile?.id ?? null })
        .eq("id", e.id)
    );
  }

  // --- Zimmer ---
  async function zimmerAnlegen(gebaeudeId: number) {
    if (!neuesZimmer.nummer.trim() || !neuesZimmer.wohneinheitId) return;
    const ok = await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_zimmer")
        .insert({
          gebaeude_id: gebaeudeId,
          nummer: neuesZimmer.nummer.trim(),
          wohneinheit_id: Number(neuesZimmer.wohneinheitId),
          bettenzahl: Number(neuesZimmer.bettenzahl) || 0,
        })
    );
    if (ok) setNeuesZimmer({ nummer: "", wohneinheitId: "", bettenzahl: "" });
  }

  async function zimmerAktivSetzen(z: UnterkunftZimmer, aktiv: boolean) {
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_zimmer")
        .update({ aktiv, updated_by: profile?.id ?? null })
        .eq("id", z.id)
    );
  }

  async function zimmerBettenzahlSetzen(z: UnterkunftZimmer, wert: string) {
    const n = Math.max(0, Math.floor(Number(wert)) || 0);
    if (n === z.bettenzahl) return;
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_zimmer")
        .update({ bettenzahl: n, updated_by: profile?.id ?? null })
        .eq("id", z.id)
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

  // --- Kontrollzeitraum je Raumtyp ---
  async function intervallSetzen(
    i: UnterkunftKontrollIntervall,
    feld: "gruen_bis_tage" | "gelb_bis_tage",
    wert: string
  ) {
    const n = Math.max(0, Math.floor(Number(wert)) || 0);
    if (n === i[feld]) return;
    const gruen = feld === "gruen_bis_tage" ? n : i.gruen_bis_tage;
    const gelb = feld === "gelb_bis_tage" ? n : i.gelb_bis_tage;
    if (gelb < gruen) {
      setFehler(
        "Der Gelb-Wert muss mindestens so groß sein wie der Grün-Wert."
      );
      await laden();
      return;
    }
    await ausfuehren(() =>
      getSupabaseClient()
        .from("unterkunft_kontroll_intervall")
        .update({ [feld]: n, updated_by: profile?.id ?? null })
        .eq("art", i.art)
    );
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-8">
      <UnterkunftTabs />

      <div>
        <h1 className="text-lg font-semibold text-emerald-900">Stammdaten</h1>
        <p className="text-sm text-neutral-500">
          Gebäude und Zimmer. {canEdit ? "" : "Nur admin/hr dürfen ändern."}
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
            const zimmerDesGebaeudes = zimmer.filter(
              (z) => z.gebaeude_id === g.id && z.art === "zimmer"
            );
            const wohneinheitenDesGebaeudes = wohneinheiten.filter((e) => e.gebaeude_id === g.id);
            const wohneinheitName = (id: number | null) =>
              wohneinheiten.find((e) => e.id === id)?.name ?? "—";
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
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="btn-secondary"
                        onClick={() => gebaeudeAktivSetzen(g, !g.aktiv)}
                      >
                        {g.aktiv ? "Deaktivieren" : "Aktivieren"}
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => gebaeudeLoeschen(g)}
                      >
                        Löschen
                      </button>
                    </div>
                  )}
                </div>

                {offen && (
                  <div className="space-y-3 px-3 py-3">
                    {/* Wohneinheiten des Gebäudes */}
                    <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
                      <div className="text-sm font-medium">Wohneinheiten</div>
                      <p className="text-xs text-neutral-500">
                        Eine Wohneinheit = mehrere Zimmer mit gemeinsam Bad/Küche.
                        „Etage“ ist nur das Etikett für den Umschalter im Grundriss.
                      </p>
                      <div className="mt-1 space-y-1">
                        {wohneinheitenDesGebaeudes.length === 0 && (
                          <span className="text-sm text-neutral-400">
                            noch keine Wohneinheiten – für Zimmer mindestens eine anlegen
                          </span>
                        )}
                        {wohneinheitenDesGebaeudes.map((e) => (
                          <div
                            key={e.id}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <span
                              className={
                                e.aktiv ? "font-medium" : "text-neutral-400 line-through"
                              }
                            >
                              {e.name}
                            </span>
                            {canEdit && (
                              <>
                                <label className="text-xs text-neutral-500">
                                  Etage
                                  <input
                                    className="ml-1 w-20"
                                    defaultValue={e.etage_label ?? ""}
                                    placeholder="EG"
                                    onBlur={(ev) =>
                                      wohneinheitEtageLabel(e, ev.target.value)
                                    }
                                  />
                                </label>
                                <label className="text-xs text-neutral-500">
                                  Reihenfolge
                                  <input
                                    type="number"
                                    className="ml-1 w-16"
                                    defaultValue={e.reihenfolge}
                                    onBlur={(ev) =>
                                      wohneinheitReihenfolge(e, Number(ev.target.value))
                                    }
                                  />
                                </label>
                                <button
                                  className="text-xs text-emerald-700 hover:underline"
                                  onClick={() => wohneinheitUmbenennen(e)}
                                >
                                  umbenennen
                                </button>
                                <button
                                  className="text-xs text-neutral-500 hover:underline"
                                  onClick={() => wohneinheitAktivSetzen(e, !e.aktiv)}
                                >
                                  {e.aktiv ? "deaktivieren" : "aktivieren"}
                                </button>
                                <button
                                  className="text-xs text-red-600 hover:underline"
                                  onClick={() => wohneinheitLoeschen(e)}
                                >
                                  löschen
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      {canEdit && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <label className="text-sm">
                            Neue Wohneinheit
                            <input
                              className="ml-2 w-40"
                              value={neueWohneinheit.name}
                              onChange={(ev) =>
                                setNeueWohneinheit((s) => ({ ...s, name: ev.target.value }))
                              }
                              placeholder="z.B. Wohnung unten rechts"
                            />
                          </label>
                          <label className="text-sm">
                            Etage
                            <input
                              className="ml-2 w-20"
                              value={neueWohneinheit.etage_label}
                              onChange={(ev) =>
                                setNeueWohneinheit((s) => ({
                                  ...s,
                                  etage_label: ev.target.value,
                                }))
                              }
                              placeholder="EG"
                            />
                          </label>
                          <label className="text-sm">
                            Reihenfolge
                            <input
                              type="number"
                              className="ml-2 w-20"
                              value={neueWohneinheit.reihenfolge}
                              onChange={(ev) =>
                                setNeueWohneinheit((s) => ({
                                  ...s,
                                  reihenfolge: ev.target.value,
                                }))
                              }
                            />
                          </label>
                          <button
                            className="btn-secondary"
                            onClick={() => wohneinheitAnlegen(g.id)}
                          >
                            Wohneinheit anlegen
                          </button>
                        </div>
                      )}
                    </div>

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
                          Wohneinheit
                          <select
                            className="ml-2"
                            value={neuesZimmer.wohneinheitId}
                            onChange={(e) =>
                              setNeuesZimmer((s) => ({
                                ...s,
                                wohneinheitId: e.target.value,
                              }))
                            }
                          >
                            <option value="">– wählen –</option>
                            {wohneinheitenDesGebaeudes
                              .filter((e) => e.aktiv)
                              .map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="text-sm">
                          Schlafplätze
                          <input
                            type="number"
                            min={0}
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
                          <th>Wohneinheit</th>
                          <th>Schlafplätze</th>
                          <th>Status</th>
                          {canEdit && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {zimmerDesGebaeudes.map((z) => (
                          <tr key={z.id}>
                            <td className="font-medium text-emerald-800">
                              {z.nummer}
                            </td>
                            <td>{wohneinheitName(z.wohneinheit_id)}</td>
                            <td>
                              {canEdit ? (
                                <input
                                  type="number"
                                  min={0}
                                  className="w-16"
                                  defaultValue={z.bettenzahl}
                                  onBlur={(e) =>
                                    zimmerBettenzahlSetzen(z, e.target.value)
                                  }
                                />
                              ) : (
                                z.bettenzahl
                              )}
                            </td>
                            <td>
                              {z.aktiv ? (
                                "aktiv"
                              ) : (
                                <span className="text-red-600">inaktiv</span>
                              )}
                            </td>
                            {canEdit && (
                              <td className="whitespace-nowrap">
                                <button
                                  className="btn-secondary mr-1"
                                  onClick={() => zimmerAktivSetzen(z, !z.aktiv)}
                                >
                                  {z.aktiv ? "Deaktivieren" : "Aktivieren"}
                                </button>
                                <button
                                  className="btn-danger"
                                  onClick={() => zimmerLoeschen(z)}
                                >
                                  Löschen
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
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

      {/* Kontrollzeitraum je Raumtyp */}
      <section className="space-y-3">
        <h2 className="font-semibold text-neutral-800">
          Kontrollzeitraum je Raumtyp
        </h2>
        <p className="text-sm text-neutral-500">
          Steuert die Ampel „letzte Kontrolle“ im Grundriss. Grün: letzte
          Kontrolle ≤ X Tage her · Gelb: ≤ Y Tage her · darüber Rot.
        </p>
        <table>
          <thead>
            <tr>
              <th>Raumtyp</th>
              <th>Grün bis (Tage)</th>
              <th>Gelb bis (Tage)</th>
            </tr>
          </thead>
          <tbody>
            {intervalle.length === 0 && (
              <tr>
                <td colSpan={3} className="text-sm text-neutral-400">
                  Noch nicht angelegt – Migration 2026-09-08 ausführen.
                </td>
              </tr>
            )}
            {intervalle.map((i) => (
              <tr key={i.art}>
                <td className="font-medium text-emerald-800">
                  {RAUMTYP_LABEL[i.art]}
                </td>
                <td>
                  {canEdit ? (
                    <input
                      type="number"
                      min={0}
                      className="w-20"
                      defaultValue={i.gruen_bis_tage}
                      onBlur={(e) =>
                        intervallSetzen(i, "gruen_bis_tage", e.target.value)
                      }
                    />
                  ) : (
                    i.gruen_bis_tage
                  )}
                </td>
                <td>
                  {canEdit ? (
                    <input
                      type="number"
                      min={0}
                      className="w-20"
                      defaultValue={i.gelb_bis_tage}
                      onBlur={(e) =>
                        intervallSetzen(i, "gelb_bis_tage", e.target.value)
                      }
                    />
                  ) : (
                    i.gelb_bis_tage
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
