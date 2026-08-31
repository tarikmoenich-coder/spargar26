"use client";

// Unterkunft → Zwischenkontrolle (Migration 2026-08-29). Wie Übergabe/Abnahme,
// aber ohne Belegungsbezug und mit Typ "zwischenkontrolle". Zweck: schnelle
// Sichtkontrolle je Zimmer mit Fotos, auffällige Punkte werden als Mängel
// übernommen. Abgeschlossene Kontrollen sind schreibgeschützt (Trigger).
//
// Seit 2026-09: entweder ein einzelnes Zimmer ODER eine ganze Wohneinheit am
// Stück. Bei der Wohneinheit legt "Starten" pro Raum einen eigenen Vorgang an
// und die Seite führt Raum für Raum durch ("Raum 2 von 6"). Kontrolliert-von /
// Gesamtzustand / Notiz gelten für die ganze Runde.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import FotoAufnahme from "@/components/FotoAufnahme";
import { formatDatumDE } from "@/lib/format";
import { mangelKategorieVorschlag, raumName } from "@/lib/unterkunft";
import {
  UNTERKUNFT_GESAMTZUSTAND_LABELS,
  UNTERKUNFT_MANGEL_KATEGORIE_LABELS,
  UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS,
  UNTERKUNFT_POSITION_ZUSTAND_LABELS,
  type UnterkunftChecklisteVorlage,
  type UnterkunftGebaeude,
  type UnterkunftGesamtzustand,
  type UnterkunftMangelKategorie,
  type UnterkunftMangelVerursachung,
  type UnterkunftPositionZustand,
  type UnterkunftVorgang,
  type UnterkunftVorgangPosition,
  type UnterkunftWohneinheit,
  type UnterkunftZimmer,
} from "@/lib/types";

interface PosEntwurf {
  zustand: UnterkunftPositionZustand;
  bemerkung: string;
  kategorie: UnterkunftMangelKategorie;
  verursachung: UnterkunftMangelVerursachung;
}

export default function UnterkunftKontrollePage() {
  const { profile } = useProfile();
  const router = useRouter();
  useEffect(() => {
    if (profile?.role === "hausmeister") router.replace("/unterkunft/reparaturen");
  }, [profile?.role, router]);
  // Zwischenkontrollen macht eine höhere Rolle - der Hausmeister nicht mehr.
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [wohneinheiten, setWohneinheiten] = useState<UnterkunftWohneinheit[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [vorlage, setVorlage] = useState<UnterkunftChecklisteVorlage[]>([]);
  const [letzte, setLetzte] = useState<UnterkunftVorgang[]>([]);
  const [namen, setNamen] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);

  const [sel, setSel] = useState({
    gebaeude_id: "",
    modus: "zimmer" as "zimmer" | "wohneinheit",
    zimmer_id: "",
    wohneinheit_id: "",
  });
  // Wohneinheit-Modus: welche Räume werden kontrolliert (alle vorausgewählt).
  const [raumWahl, setRaumWahl] = useState<Set<number>>(new Set());

  // Aktuelle Runde: ein Vorgang je Raum. Länge 1 = einzelnes Zimmer / Fortsetzen.
  const [runde, setRunde] = useState<UnterkunftVorgang[]>([]);
  const [rundeIdx, setRundeIdx] = useState(0);
  const [rundeAktiv, setRundeAktiv] = useState(false); // >1 Raum, geteilter Kopf

  const [vorgang, setVorgang] = useState<UnterkunftVorgang | null>(null);
  const [positionen, setPositionen] = useState<UnterkunftVorgangPosition[]>([]);
  const [posEntwurf, setPosEntwurf] = useState<Record<number, PosEntwurf>>({});
  const [kopf, setKopf] = useState({
    gesamtzustand: "" as "" | UnterkunftGesamtzustand,
    notiz: "",
    unterschrift_name: "",
    zustand_bestaetigt: false,
  });
  const [dirty, setDirty] = useState(false);
  const [speichern, setSpeichern] = useState(false);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, w, z, v, lv, pn] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").eq("aktiv", true).order("name"),
      supabase
        .from("unterkunft_wohneinheit")
        .select("*")
        .eq("aktiv", true)
        .order("reihenfolge"),
      supabase.from("unterkunft_zimmer").select("*").eq("aktiv", true).order("nummer"),
      supabase
        .from("unterkunft_checkliste_vorlage")
        .select("*")
        .eq("aktiv", true)
        .order("reihenfolge"),
      supabase
        .from("unterkunft_vorgang")
        .select("*")
        .eq("typ", "zwischenkontrolle")
        .order("durchgefuehrt_am", { ascending: false })
        .limit(25),
      supabase.from("profile_namen").select("*"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setWohneinheiten((w.data as UnterkunftWohneinheit[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setVorlage((v.data as UnterkunftChecklisteVorlage[]) ?? []);
    setLetzte((lv.data as UnterkunftVorgang[]) ?? []);
    setNamen(
      Object.fromEntries(
        ((pn.data as { id: string; full_name: string }[]) ?? []).map((p) => [
          p.id,
          p.full_name,
        ])
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  // Deep-Link aus dem Grundriss / Kontrollplan: ?zimmer=<id> wählt Gebäude +
  // Zimmer vor, ?wohneinheit=<id> den Wohneinheit-Modus.
  useEffect(() => {
    if (zimmer.length === 0) return;
    const q = new URLSearchParams(window.location.search);
    const zParam = q.get("zimmer");
    if (zParam) {
      const z = zimmer.find((x) => String(x.id) === zParam);
      if (z)
        setSel((s) => ({
          ...s,
          modus: "zimmer",
          gebaeude_id: String(z.gebaeude_id),
          zimmer_id: String(z.id),
        }));
      return;
    }
    const wParam = q.get("wohneinheit");
    if (wParam) {
      const w = wohneinheiten.find((x) => String(x.id) === wParam);
      if (w)
        setSel((s) => ({
          ...s,
          modus: "wohneinheit",
          gebaeude_id: String(w.gebaeude_id),
          wohneinheit_id: String(w.id),
        }));
    }
  }, [zimmer, wohneinheiten]);

  // Kommt der Aufruf über einen Deep-Link (Kontrollplan „Kontrolle starten",
  // Grundriss), direkt den Vorgang anlegen und öffnen - kein zweiter Klick.
  const autoStartRef = useRef(false);
  useEffect(() => {
    if (autoStartRef.current || vorgang || runde.length > 0) return;
    if (vorlage.length === 0) return;
    const q = new URLSearchParams(window.location.search);
    if (!q.get("zimmer") && !q.get("wohneinheit")) return;
    if (sel.modus === "zimmer" && !sel.zimmer_id) return;
    if (
      sel.modus === "wohneinheit" &&
      (!sel.wohneinheit_id || raumWahl.size === 0)
    )
      return;
    autoStartRef.current = true;
    starten();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, vorlage, raumWahl, runde.length, vorgang]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const zimmerDesGebaeudes = zimmer.filter(
    (z) => String(z.gebaeude_id) === sel.gebaeude_id
  );
  const wohneinheitenDesGebaeudes = wohneinheiten.filter(
    (w) => String(w.gebaeude_id) === sel.gebaeude_id
  );
  const raeumeDerEinheit = zimmer.filter(
    (z) => String(z.wohneinheit_id) === sel.wohneinheit_id
  );

  // Räume der gewählten Wohneinheit alle vorauswählen.
  useEffect(() => {
    if (sel.modus !== "wohneinheit" || !sel.wohneinheit_id) {
      setRaumWahl(new Set());
      return;
    }
    setRaumWahl(
      new Set(
        zimmer
          .filter((z) => String(z.wohneinheit_id) === sel.wohneinheit_id)
          .map((z) => z.id)
      )
    );
  }, [sel.modus, sel.wohneinheit_id, zimmer]);

  const zimmerName = useMemo(() => {
    if (!vorgang) return "";
    const z = zimmer.find((x) => x.id === vorgang.zimmer_id);
    const g = z ? gebaeude.find((x) => x.id === z.gebaeude_id) : undefined;
    return z ? `${g?.name ?? "?"} · ${raumName(z)}` : `Zimmer ${vorgang.zimmer_id}`;
  }, [vorgang, zimmer, gebaeude]);

  const durchgefuehrtVon =
    (vorgang?.durchgefuehrt_von && namen[vorgang.durchgefuehrt_von]) ||
    profile?.full_name ||
    "—";

  function setPos(id: number, patch: Partial<PosEntwurf>) {
    setPosEntwurf((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
    setDirty(true);
  }

  // Positionen eines Vorgangs laden. ladeKopf nur im Einzel-/Fortsetzen-Fall -
  // in einer Mehr-Raum-Runde bleibt der Kopf über alle Räume gleich.
  async function ladePositionen(vg: UnterkunftVorgang, ladeKopf: boolean) {
    const { data: pos } = await getSupabaseClient()
      .from("unterkunft_vorgang_position")
      .select("*")
      .eq("vorgang_id", vg.id)
      .order("id");
    const liste = (pos as UnterkunftVorgangPosition[]) ?? [];
    setVorgang(vg);
    setPositionen(liste);
    setPosEntwurf(
      Object.fromEntries(
        liste.map((p) => [
          p.id,
          {
            zustand: p.zustand,
            bemerkung: p.bemerkung ?? "",
            kategorie:
              p.mangel_kategorie ?? mangelKategorieVorschlag(p.bereich),
            verursachung: p.mangel_verursachung ?? "unklar",
          },
        ])
      )
    );
    if (ladeKopf) {
      setKopf({
        gesamtzustand: vg.gesamtzustand ?? "",
        notiz: vg.notiz ?? "",
        unterschrift_name:
          vg.unterschrift_name ??
          (vg.abgeschlossen ? "" : profile?.full_name ?? ""),
        zustand_bestaetigt: vg.zustand_bestaetigt,
      });
    }
    setDirty(false);
  }

  async function starten() {
    setFehler(null);
    if (vorlage.length === 0) {
      setFehler("Keine Checklisten-Bereiche angelegt – zuerst unter Stammdaten pflegen.");
      return;
    }
    const zimmerIds =
      sel.modus === "zimmer"
        ? sel.zimmer_id
          ? [Number(sel.zimmer_id)]
          : []
        : [...raumWahl];
    if (zimmerIds.length === 0) {
      setFehler(
        sel.modus === "zimmer"
          ? "Bitte ein Zimmer wählen."
          : "Bitte eine Wohneinheit und mindestens einen Raum wählen."
      );
      return;
    }
    // Pro Raumtyp die passenden Checklisten-Bereiche.
    const bereicheFuer = (art: string) =>
      vorlage
        .filter((v) => v.art === art)
        .sort((a, b) => a.reihenfolge - b.reihenfolge);
    const ohneCheckliste = zimmerIds.filter(
      (zid) =>
        bereicheFuer(zimmer.find((z) => z.id === zid)?.art ?? "zimmer").length ===
        0
    );
    if (ohneCheckliste.length > 0) {
      setFehler(
        `Für ${ohneCheckliste.length} gewählte(n) Raum/Räume gibt es keine ` +
          `Checkliste für den Raumtyp – in den Stammdaten anlegen.`
      );
      return;
    }

    const supabase = getSupabaseClient();
    const vorgaenge: UnterkunftVorgang[] = [];
    for (const zid of zimmerIds) {
      const art = zimmer.find((z) => z.id === zid)?.art ?? "zimmer";
      const id = crypto.randomUUID();
      const { data: vg, error } = await supabase
        .from("unterkunft_vorgang")
        .insert({
          id,
          zimmer_id: zid,
          typ: "zwischenkontrolle",
          durchgefuehrt_von: profile?.id ?? null,
        })
        .select("*")
        .single();
      if (error) {
        setFehler(error.message);
        return;
      }
      const { error: posError } = await supabase
        .from("unterkunft_vorgang_position")
        .insert(
          bereicheFuer(art).map((v) => ({
            vorgang_id: id,
            bereich: v.bereich,
            zustand: "io" as const,
          }))
        );
      if (posError) {
        setFehler(posError.message);
        return;
      }
      vorgaenge.push(vg as UnterkunftVorgang);
    }
    setRunde(vorgaenge);
    setRundeIdx(0);
    setRundeAktiv(vorgaenge.length > 1);
    setKopf({
      gesamtzustand: "",
      notiz: "",
      unterschrift_name: profile?.full_name ?? "",
      zustand_bestaetigt: false,
    });
    setHinweis(null);
    await ladePositionen(vorgaenge[0], false);
  }

  async function fortsetzen(vg: UnterkunftVorgang) {
    setFehler(null);
    setHinweis(null);
    setRunde([vg]);
    setRundeIdx(0);
    setRundeAktiv(false);
    await ladePositionen(vg, true);
  }

  async function speichernAlle(): Promise<boolean> {
    if (!vorgang) return false;
    setSpeichern(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    try {
      for (const p of positionen) {
        const e = posEntwurf[p.id];
        if (!e) continue;
        const istMangel = e.zustand === "mangel";
        const neueKat = istMangel ? e.kategorie : null;
        const neueVer = istMangel ? e.verursachung : null;
        if (
          e.zustand === p.zustand &&
          (e.bemerkung || "") === (p.bemerkung || "") &&
          neueKat === (p.mangel_kategorie ?? null) &&
          neueVer === (p.mangel_verursachung ?? null)
        )
          continue;
        const { error } = await supabase
          .from("unterkunft_vorgang_position")
          .update({
            zustand: e.zustand,
            bemerkung: e.bemerkung.trim() || null,
            mangel_kategorie: neueKat,
            mangel_verursachung: neueVer,
          })
          .eq("id", p.id);
        if (error) throw new Error(error.message);
      }
      const { error: kopfError } = await supabase
        .from("unterkunft_vorgang")
        .update({
          gesamtzustand: kopf.gesamtzustand || null,
          notiz: kopf.notiz.trim() || null,
          unterschrift_name: kopf.unterschrift_name.trim() || null,
          zustand_bestaetigt: kopf.zustand_bestaetigt,
          updated_by: profile?.id ?? null,
        })
        .eq("id", vorgang.id);
      if (kopfError) throw new Error(kopfError.message);

      const { data: pos } = await supabase
        .from("unterkunft_vorgang_position")
        .select("*")
        .eq("vorgang_id", vorgang.id)
        .order("id");
      setPositionen((pos as UnterkunftVorgangPosition[]) ?? positionen);
      setDirty(false);
      return true;
    } catch (err) {
      setFehler(
        err instanceof Error
          ? `${err.message} – Eingaben bleiben erhalten, erneut „Zwischenspeichern“ versuchen.`
          : "Speichern fehlgeschlagen."
      );
      return false;
    } finally {
      setSpeichern(false);
    }
  }

  // Einen Vorgang der Runde abschließen: Mängel übernehmen (VOR dem
  // Schreibschutz), Kopf der Runde mitschreiben, abgeschlossen setzen.
  async function vorgangAbschliessen(vg: UnterkunftVorgang): Promise<boolean> {
    const supabase = getSupabaseClient();
    // Ist es der gerade offene Raum: erst dessen Eingaben persistieren.
    if (vorgang?.id === vg.id) {
      const ok = await speichernAlle();
      if (!ok) return false;
    }
    const { data: pos } = await supabase
      .from("unterkunft_vorgang_position")
      .select("*")
      .eq("vorgang_id", vg.id);
    const maengelPos = ((pos as UnterkunftVorgangPosition[]) ?? []).filter(
      (p) => p.zustand === "mangel"
    );
    for (const p of maengelPos) {
      const { data: mg, error: mErr } = await supabase
        .from("unterkunft_mangel")
        .insert({
          zimmer_id: vg.zimmer_id,
          quelle_vorgang_id: vg.id,
          beschreibung: `${p.bereich}: ${
            p.bemerkung?.trim() || "Mangel bei Zwischenkontrolle"
          }`,
          schwere: "mittel" as const,
          kategorie: p.mangel_kategorie ?? "sonstiges",
          verursachung: p.mangel_verursachung ?? "unklar",
        })
        .select("id")
        .single();
      if (mErr) {
        setFehler(`Mangel „${p.bereich}“ nicht angelegt: ${mErr.message}`);
        continue;
      }
      await supabase
        .from("unterkunft_foto")
        .update({ mangel_id: (mg as { id: number }).id })
        .eq("vorgang_id", vg.id)
        .eq("bereich", p.bereich)
        .is("mangel_id", null);
    }
    const { error } = await supabase
      .from("unterkunft_vorgang")
      .update({
        gesamtzustand: kopf.gesamtzustand || null,
        notiz: kopf.notiz.trim() || null,
        unterschrift_name: kopf.unterschrift_name.trim() || null,
        zustand_bestaetigt: kopf.zustand_bestaetigt,
        abgeschlossen: true,
        abgeschlossen_am: new Date().toISOString(),
        updated_by: profile?.id ?? null,
      })
      .eq("id", vg.id);
    if (error) {
      setFehler(error.message);
      return false;
    }
    setRunde((prev) =>
      prev.map((v) => (v.id === vg.id ? { ...v, abgeschlossen: true } : v))
    );
    return true;
  }

  function fertig() {
    setHinweis(
      runde.length > 1
        ? `${runde.length} Räume kontrolliert.`
        : "Zwischenkontrolle abgeschlossen."
    );
    setRunde([]);
    setRundeIdx(0);
    setRundeAktiv(false);
    setVorgang(null);
    setPositionen([]);
    setDirty(false);
    laden();
  }

  async function zuRaum(idx: number) {
    if (idx === rundeIdx || idx < 0 || idx >= runde.length) return;
    if (vorgang && !vorgang.abgeschlossen) {
      const ok = await speichernAlle();
      if (!ok) return;
    }
    setRundeIdx(idx);
    await ladePositionen(runde[idx], !rundeAktiv);
  }

  async function raumAbschliessen() {
    if (!vorgang) return;
    if (!kopf.unterschrift_name.trim()) {
      setFehler("Bitte „Kontrolliert von“ ausfüllen.");
      return;
    }
    const ok = await vorgangAbschliessen(vorgang);
    if (!ok) return;
    if (rundeIdx < runde.length - 1) {
      const next = rundeIdx + 1;
      setRundeIdx(next);
      await ladePositionen(runde[next], false);
    } else {
      fertig();
    }
  }

  async function alleAbschliessen() {
    if (!kopf.unterschrift_name.trim()) {
      setFehler("Bitte „Kontrolliert von“ ausfüllen.");
      return;
    }
    setSpeichern(true);
    for (const vg of runde) {
      if (vg.abgeschlossen) continue;
      const ok = await vorgangAbschliessen(vg);
      if (!ok) {
        setSpeichern(false);
        return;
      }
    }
    setSpeichern(false);
    fertig();
  }

  function abbrechen() {
    if (dirty && !window.confirm("Nicht gespeicherte Eingaben verwerfen?")) return;
    // Angefangene Vorgänge bleiben als „offen“ im Verlauf und lassen sich
    // später fortsetzen.
    setRunde([]);
    setRundeIdx(0);
    setRundeAktiv(false);
    setVorgang(null);
    setPositionen([]);
    setDirty(false);
    setFehler(null);
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  if (!canEdit) {
    return (
      <div className="space-y-6">
        <UnterkunftTabs />
        <p className="text-sm text-neutral-500">
          Zwischenkontrollen dürfen nur admin/hr erfassen.
        </p>
      </div>
    );
  }

  const abgeschlossen = vorgang?.abgeschlossen ?? false;
  const raumStatus = runde.map((v) => v.abgeschlossen);

  return (
    <div className="space-y-6">
      <UnterkunftTabs />

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}
      {hinweis && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {hinweis}
        </p>
      )}

      {runde.length === 0 && (
        <>
          <section className="space-y-3 rounded border border-neutral-200 p-3">
            <h1 className="text-lg font-semibold text-emerald-900">
              Zwischenkontrolle starten
            </h1>
            <div className="flex flex-wrap items-end gap-2 text-sm">
              <label>
                Gebäude
                <select
                  className="ml-2"
                  value={sel.gebaeude_id}
                  onChange={(e) =>
                    setSel((s) => ({
                      ...s,
                      gebaeude_id: e.target.value,
                      zimmer_id: "",
                      wohneinheit_id: "",
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
                Umfang
                <select
                  className="ml-2"
                  value={sel.modus}
                  onChange={(e) =>
                    setSel((s) => ({
                      ...s,
                      modus: e.target.value as "zimmer" | "wohneinheit",
                      zimmer_id: "",
                      wohneinheit_id: "",
                    }))
                  }
                >
                  <option value="zimmer">Einzelnes Zimmer</option>
                  <option value="wohneinheit">Ganze Wohneinheit</option>
                </select>
              </label>

              {sel.modus === "zimmer" ? (
                <label>
                  Zimmer
                  <select
                    className="ml-2"
                    value={sel.zimmer_id}
                    disabled={!sel.gebaeude_id}
                    onChange={(e) =>
                      setSel((s) => ({ ...s, zimmer_id: e.target.value }))
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
              ) : (
                <label>
                  Wohneinheit
                  <select
                    className="ml-2"
                    value={sel.wohneinheit_id}
                    disabled={!sel.gebaeude_id}
                    onChange={(e) =>
                      setSel((s) => ({ ...s, wohneinheit_id: e.target.value }))
                    }
                  >
                    <option value="">–</option>
                    {wohneinheitenDesGebaeudes.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.etage_label ? ` · ${w.etage_label}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button className="btn" onClick={starten}>
                Kontrolle starten
              </button>
            </div>

            {sel.modus === "wohneinheit" && sel.wohneinheit_id && (
              <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
                <div className="text-sm font-medium">
                  Räume ({raumWahl.size} von {raeumeDerEinheit.length})
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {raeumeDerEinheit.map((z) => (
                    <label
                      key={z.id}
                      className="flex cursor-pointer items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={raumWahl.has(z.id)}
                        onChange={() =>
                          setRaumWahl((s) => {
                            const n = new Set(s);
                            if (n.has(z.id)) n.delete(z.id);
                            else n.add(z.id);
                            return n;
                          })
                        }
                      />
                      {raumName(z)}
                    </label>
                  ))}
                  {raeumeDerEinheit.length === 0 && (
                    <span className="text-sm text-neutral-400">
                      keine Räume in dieser Wohneinheit
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Pro Raum wird ein eigener Kontroll-Vorgang angelegt; du wirst
                  danach Raum für Raum durchgeführt.
                </p>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-neutral-800">Letzte Zwischenkontrollen</h2>
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Zimmer</th>
                  <th>Gesamtzustand</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {letzte.map((v) => {
                  const z = zimmer.find((x) => x.id === v.zimmer_id);
                  const g = z ? gebaeude.find((x) => x.id === z.gebaeude_id) : undefined;
                  return (
                    <tr key={v.id}>
                      <td>{formatDatumDE(v.durchgefuehrt_am)}</td>
                      <td>
                        {g?.name ?? "?"} · {z ? raumName(z) : v.zimmer_id}
                      </td>
                      <td>
                        {v.gesamtzustand
                          ? UNTERKUNFT_GESAMTZUSTAND_LABELS[v.gesamtzustand]
                          : "—"}
                      </td>
                      <td>
                        {v.storniert ? (
                          <span className="text-neutral-400">storniert</span>
                        ) : v.abgeschlossen ? (
                          "abgeschlossen"
                        ) : (
                          <span className="font-medium text-amber-700">offen</span>
                        )}
                      </td>
                      <td>
                        {!v.storniert && (
                          <button
                            className="btn-secondary"
                            onClick={() => fortsetzen(v)}
                          >
                            {v.abgeschlossen ? "Ansehen" : "Fortsetzen"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {letzte.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-sm text-neutral-400">
                      noch keine Zwischenkontrollen
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}

      {vorgang && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold text-emerald-900">
                Zwischenkontrolle · {zimmerName}
              </h1>
              <p className="text-sm text-neutral-500">
                {formatDatumDE(vorgang.durchgefuehrt_am)}
                {abgeschlossen && " · abgeschlossen (schreibgeschützt)"}
              </p>
              <p className="text-sm text-neutral-500">
                Durchgeführt von: {durchgefuehrtVon}
              </p>
            </div>
            <button className="btn-secondary" onClick={abbrechen}>
              {abgeschlossen ? "Schließen" : "Zurück"}
            </button>
          </div>

          {runde.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm">
              <span className="font-medium">
                Raum {rundeIdx + 1} von {runde.length}
              </span>
              <div className="flex flex-wrap gap-1">
                {runde.map((v, i) => {
                  const z = zimmer.find((x) => x.id === v.zimmer_id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => zuRaum(i)}
                      className={`rounded border px-2 py-0.5 text-xs ${
                        i === rundeIdx
                          ? "border-emerald-700 bg-emerald-700 font-semibold text-white"
                          : raumStatus[i]
                            ? "border-emerald-300 bg-white text-emerald-700"
                            : "border-neutral-300 bg-white text-neutral-600"
                      }`}
                    >
                      {raumStatus[i] ? "✓ " : ""}
                      {z ? raumName(z) : v.zimmer_id}
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex gap-1">
                <button
                  className="btn-secondary"
                  disabled={rundeIdx === 0}
                  onClick={() => zuRaum(rundeIdx - 1)}
                >
                  ‹
                </button>
                <button
                  className="btn-secondary"
                  disabled={rundeIdx === runde.length - 1}
                  onClick={() => zuRaum(rundeIdx + 1)}
                >
                  ›
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {positionen.map((p) => {
              const e = posEntwurf[p.id] ?? {
                zustand: p.zustand,
                bemerkung: "",
                kategorie: mangelKategorieVorschlag(p.bereich),
                verursachung: "unklar" as const,
              };
              return (
                <div key={p.id} className="rounded border border-neutral-200 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-[9rem] font-medium">{p.bereich}</span>
                    <select
                      value={e.zustand}
                      disabled={abgeschlossen}
                      onChange={(ev) =>
                        setPos(p.id, {
                          zustand: ev.target.value as UnterkunftPositionZustand,
                        })
                      }
                    >
                      {(
                        Object.keys(
                          UNTERKUNFT_POSITION_ZUSTAND_LABELS
                        ) as UnterkunftPositionZustand[]
                      ).map((k) => (
                        <option key={k} value={k}>
                          {UNTERKUNFT_POSITION_ZUSTAND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <input
                      className="min-w-[16rem] flex-1"
                      placeholder="Bemerkung"
                      value={e.bemerkung}
                      disabled={abgeschlossen}
                      onChange={(ev) => setPos(p.id, { bemerkung: ev.target.value })}
                    />
                  </div>
                  {e.zustand === "mangel" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-neutral-500">Mangel-Art:</span>
                      <select
                        value={e.kategorie}
                        disabled={abgeschlossen}
                        onChange={(ev) =>
                          setPos(p.id, {
                            kategorie: ev.target
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
                      {e.kategorie === "reparatur" && (
                        <>
                          <span className="text-neutral-500">Ursache:</span>
                          <select
                            value={e.verursachung}
                            disabled={abgeschlossen}
                            onChange={(ev) =>
                              setPos(p.id, {
                                verursachung: ev.target
                                  .value as UnterkunftMangelVerursachung,
                              })
                            }
                          >
                            {(
                              Object.keys(
                                UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS
                              ) as UnterkunftMangelVerursachung[]
                            ).map((k) => (
                              <option key={k} value={k}>
                                {UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  )}
                  <div className="mt-2">
                    <FotoAufnahme
                      zimmerId={vorgang.zimmer_id}
                      vorgangId={vorgang.id}
                      bereich={p.bereich}
                      disabled={abgeschlossen}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3 rounded border border-neutral-200 p-3">
            {runde.length > 1 && (
              <p className="text-xs text-neutral-500">
                Gesamtzustand, „Kontrolliert von“ und Notiz gelten für alle Räume
                dieser Runde.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label>
                Gesamtzustand
                <select
                  className="ml-2"
                  value={kopf.gesamtzustand}
                  disabled={abgeschlossen}
                  onChange={(e) => {
                    setKopf((s) => ({
                      ...s,
                      gesamtzustand: e.target.value as "" | UnterkunftGesamtzustand,
                    }));
                    setDirty(true);
                  }}
                >
                  <option value="">–</option>
                  {(
                    Object.keys(
                      UNTERKUNFT_GESAMTZUSTAND_LABELS
                    ) as UnterkunftGesamtzustand[]
                  ).map((k) => (
                    <option key={k} value={k}>
                      {UNTERKUNFT_GESAMTZUSTAND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kontrolliert von
                <input
                  className="ml-2"
                  value={kopf.unterschrift_name}
                  disabled={abgeschlossen}
                  onChange={(e) => {
                    setKopf((s) => ({ ...s, unterschrift_name: e.target.value }));
                    setDirty(true);
                  }}
                />
              </label>
            </div>
            <label className="block text-sm">
              Notiz
              <textarea
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                rows={2}
                value={kopf.notiz}
                disabled={abgeschlossen}
                onChange={(e) => {
                  setKopf((s) => ({ ...s, notiz: e.target.value }));
                  setDirty(true);
                }}
              />
            </label>
            <div className="text-sm font-medium">Allgemeine Fotos</div>
            <FotoAufnahme
              zimmerId={vorgang.zimmer_id}
              vorgangId={vorgang.id}
              bereich={null}
              disabled={abgeschlossen}
            />
          </div>

          {!abgeschlossen && (
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                onClick={speichernAlle}
                disabled={speichern}
              >
                {speichern ? "Speichert …" : "Zwischenspeichern"}
              </button>
              {runde.length > 1 ? (
                <>
                  <button
                    className="btn"
                    onClick={raumAbschliessen}
                    disabled={speichern}
                  >
                    {rundeIdx < runde.length - 1
                      ? "Raum abschließen & weiter"
                      : "Letzten Raum abschließen"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={alleAbschliessen}
                    disabled={speichern}
                  >
                    Alle übrigen abschließen
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  onClick={raumAbschliessen}
                  disabled={speichern}
                >
                  Abschließen
                </button>
              )}
              {dirty && (
                <span className="self-center text-xs text-amber-700">
                  nicht gespeicherte Änderungen
                </span>
              )}
            </div>
          )}

          {abgeschlossen && runde.length > 1 && rundeIdx < runde.length - 1 && (
            <button className="btn" onClick={() => zuRaum(rundeIdx + 1)}>
              Weiter zum nächsten Raum
            </button>
          )}
        </div>
      )}
    </div>
  );
}
