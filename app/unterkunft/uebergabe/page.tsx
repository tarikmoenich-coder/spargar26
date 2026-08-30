"use client";

// Unterkunft → Übergabe / Abnahme (Migration 2026-08-29). Ablauf:
//   1. Zimmer + Typ (Einzug/Auszug) wählen → Vorgang starten. Dabei wird
//      eine client-seitige UUID vergeben und die Checkliste aus der Vorlage
//      als Positionen angelegt (idempotenter Upsert, "meist online" + Retry).
//   2. Je Bereich Zustand + Bemerkung + Fotos erfassen, dazu Gesamtzustand,
//      Notiz, Name der anwesenden Person + Haken "Zustand bestätigt".
//   3. Abschließen → Vorgang wird schreibgeschützt (Trigger); Positionen mit
//      Zustand "Mangel" können als Mängel übernommen werden.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import FotoAufnahme from "@/components/FotoAufnahme";
import { formatDatumDE } from "@/lib/format";
import { heuteIso } from "@/lib/unterkunft";
import {
  UNTERKUNFT_GESAMTZUSTAND_LABELS,
  UNTERKUNFT_POSITION_ZUSTAND_LABELS,
  UNTERKUNFT_VORGANG_TYP_LABELS,
  type UnterkunftBelegungAktuell,
  type UnterkunftBett,
  type UnterkunftChecklisteVorlage,
  type UnterkunftGebaeude,
  type UnterkunftGesamtzustand,
  type UnterkunftPositionZustand,
  type UnterkunftVorgang,
  type UnterkunftVorgangPosition,
  type UnterkunftVorgangTyp,
  type UnterkunftZimmer,
  type UnterkunftZuordnungOffen,
} from "@/lib/types";

interface PosEntwurf {
  zustand: UnterkunftPositionZustand;
  bemerkung: string;
}

export default function UnterkunftUebergabePage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "hausmeister";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [betten, setBetten] = useState<UnterkunftBett[]>([]);
  const [employees, setEmployees] = useState<
    { id: string; personal_nr: string; name: string; vorname: string; aktiv: boolean }[]
  >([]);
  const [vorlage, setVorlage] = useState<UnterkunftChecklisteVorlage[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungAktuell[]>([]);
  const [zuordnungen, setZuordnungen] = useState<UnterkunftZuordnungOffen[]>([]);
  const [letzte, setLetzte] = useState<UnterkunftVorgang[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);

  // Auswahl
  const [sel, setSel] = useState({
    gebaeude_id: "",
    zimmer_id: "",
    typ: "einzug" as UnterkunftVorgangTyp,
    belegung_id: "",
  });

  // Einzug: Personen (aus schwebenden Zuordnungen vorbelegt) + Bett je Person.
  // key = employee_id, wert = bett_id ("" = noch offen). Wird beim Abschließen
  // in unterkunft_belegung geschrieben und die Zuordnung geschlossen.
  const [einzug, setEinzug] = useState<Record<string, string>>({});
  const [personSuche, setPersonSuche] = useState("");

  // Laufender Vorgang
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
    const [g, z, bt, emp, v, bl, zu, lv] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").eq("aktiv", true).order("name"),
      supabase.from("unterkunft_zimmer").select("*").eq("aktiv", true).order("nummer"),
      supabase.from("unterkunft_bett").select("*").eq("aktiv", true).order("bezeichnung"),
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, aktiv")
        .order("name"),
      supabase
        .from("unterkunft_checkliste_vorlage")
        .select("*")
        .eq("aktiv", true)
        .order("reihenfolge"),
      supabase.from("unterkunft_belegung_aktuell").select("*"),
      supabase.from("unterkunft_zuordnung_offen").select("*"),
      supabase
        .from("unterkunft_vorgang")
        .select("*")
        .order("durchgefuehrt_am", { ascending: false })
        .limit(25),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setBetten((bt.data as UnterkunftBett[]) ?? []);
    setEmployees((emp.data as typeof employees) ?? []);
    setVorlage((v.data as UnterkunftChecklisteVorlage[]) ?? []);
    setBelegungen((bl.data as UnterkunftBelegungAktuell[]) ?? []);
    setZuordnungen((zu.data as UnterkunftZuordnungOffen[]) ?? []);
    setLetzte((lv.data as UnterkunftVorgang[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  // Deep-Link aus dem Grundriss: ?zimmer=<id> wählt Gebäude + Zimmer vor
  // (bewusst über window.location statt useSearchParams - spart die
  // Suspense-Grenze für diese eine Client-Seite).
  useEffect(() => {
    if (zimmer.length === 0) return;
    const param = new URLSearchParams(window.location.search).get("zimmer");
    if (!param) return;
    const z = zimmer.find((x) => String(x.id) === param);
    if (z) {
      setSel((s) => ({
        ...s,
        gebaeude_id: String(z.gebaeude_id),
        zimmer_id: String(z.id),
      }));
    }
  }, [zimmer]);

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
  const belegungenDesZimmers = belegungen.filter(
    (b) => String(b.zimmer_id) === sel.zimmer_id
  );

  // Freie Betten des gewählten Zimmers (nicht heute belegt).
  const freieBetten = useMemo(() => {
    if (!sel.zimmer_id) return [];
    const zid = Number(sel.zimmer_id);
    const belegt = new Set(belegungen.map((b) => b.bett_id));
    return betten.filter((b) => b.zimmer_id === zid && !belegt.has(b.id));
  }, [betten, belegungen, sel.zimmer_id]);

  // Beim Wählen eines Zimmers für einen Einzug: schwebende Zuordnungen dieses
  // Zimmers als Personen-Vorschlag übernehmen.
  useEffect(() => {
    if (sel.typ !== "einzug" || !sel.zimmer_id) {
      setEinzug({});
      return;
    }
    const zid = Number(sel.zimmer_id);
    const vorbelegt: Record<string, string> = {};
    zuordnungen
      .filter((z) => z.zimmer_id === zid)
      .forEach((z) => {
        vorbelegt[z.employee_id] = "";
      });
    setEinzug(vorbelegt);
  }, [sel.typ, sel.zimmer_id, zuordnungen]);

  function personName(employeeId: string): string {
    const zu = zuordnungen.find((z) => z.employee_id === employeeId);
    if (zu) return `${zu.vorname} ${zu.name}`;
    const e = employees.find((x) => x.id === employeeId);
    return e ? `${e.vorname} ${e.name}` : employeeId;
  }

  const zimmerName = useMemo(() => {
    if (!vorgang) return "";
    const z = zimmer.find((x) => x.id === vorgang.zimmer_id);
    const g = z ? gebaeude.find((x) => x.id === z.gebaeude_id) : undefined;
    return z ? `${g?.name ?? "?"} · Zimmer ${z.nummer}` : `Zimmer ${vorgang.zimmer_id}`;
  }, [vorgang, zimmer, gebaeude]);

  function setPos(id: number, patch: Partial<PosEntwurf>) {
    setPosEntwurf((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
    setDirty(true);
  }

  async function vorgangStarten() {
    setFehler(null);
    if (!sel.zimmer_id) {
      setFehler("Bitte ein Zimmer wählen.");
      return;
    }
    if (vorlage.length === 0) {
      setFehler("Keine Checklisten-Bereiche angelegt – zuerst unter Stammdaten pflegen.");
      return;
    }
    const supabase = getSupabaseClient();
    const id = crypto.randomUUID();
    const { data: vg, error } = await supabase
      .from("unterkunft_vorgang")
      .insert({
        id,
        zimmer_id: Number(sel.zimmer_id),
        typ: sel.typ,
        belegung_id: sel.belegung_id ? Number(sel.belegung_id) : null,
        durchgefuehrt_von: profile?.id ?? null,
      })
      .select("*")
      .single();
    if (error) {
      setFehler(error.message);
      return;
    }
    const { error: posError } = await supabase.from("unterkunft_vorgang_position").insert(
      vorlage.map((v) => ({
        vorgang_id: id,
        bereich: v.bereich,
        zustand: "io" as const,
      }))
    );
    if (posError) {
      setFehler(posError.message);
      return;
    }
    await vorgangOeffnen(vg as UnterkunftVorgang);
  }

  async function vorgangOeffnen(vg: UnterkunftVorgang) {
    setFehler(null);
    setHinweis(null);
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
        liste.map((p) => [p.id, { zustand: p.zustand, bemerkung: p.bemerkung ?? "" }])
      )
    );
    setKopf({
      gesamtzustand: vg.gesamtzustand ?? "",
      notiz: vg.notiz ?? "",
      unterschrift_name: vg.unterschrift_name ?? "",
      zustand_bestaetigt: vg.zustand_bestaetigt,
    });
    setDirty(false);
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
        if (e.zustand === p.zustand && (e.bemerkung || "") === (p.bemerkung || "")) {
          continue;
        }
        const { error } = await supabase
          .from("unterkunft_vorgang_position")
          .update({ zustand: e.zustand, bemerkung: e.bemerkung.trim() || null })
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

      const { data: frisch } = await supabase
        .from("unterkunft_vorgang")
        .select("*")
        .eq("id", vorgang.id)
        .single();
      const { data: pos } = await supabase
        .from("unterkunft_vorgang_position")
        .select("*")
        .eq("vorgang_id", vorgang.id)
        .order("id");
      if (frisch) setVorgang(frisch as UnterkunftVorgang);
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

  async function abschliessen() {
    if (!vorgang) return;
    setFehler(null);
    if (!kopf.unterschrift_name.trim() || !kopf.zustand_bestaetigt) {
      setFehler("Name der anwesenden Person und Haken „Zustand bestätigt“ sind Pflicht.");
      return;
    }
    const ok = await speichernAlle();
    if (!ok) return;

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("unterkunft_vorgang")
      .update({ abgeschlossen: true, abgeschlossen_am: new Date().toISOString() })
      .eq("id", vorgang.id);
    if (error) {
      setFehler(error.message);
      return;
    }

    // Einzug: je Person die bettgenaue Belegung anlegen und die schwebende
    // Zuordnung schließen. Personen ohne gewähltes Bett werden übersprungen.
    if (vorgang.typ === "einzug") {
      const ohneBett: string[] = [];
      for (const [employeeId, bettId] of Object.entries(einzug)) {
        if (!bettId) {
          ohneBett.push(personName(employeeId));
          continue;
        }
        const { data: bel, error: bErr } = await supabase
          .from("unterkunft_belegung")
          .insert({
            bett_id: Number(bettId),
            employee_id: employeeId,
            von: heuteIso(),
          })
          .select("id")
          .single();
        if (bErr) {
          setFehler(
            bErr.message.includes("unterkunft_belegung_kein_doppel")
              ? `Bett von ${personName(employeeId)} ist schon belegt.`
              : `Belegung ${personName(employeeId)}: ${bErr.message}`
          );
          continue;
        }
        await supabase
          .from("unterkunft_zuordnung")
          .update({
            status: "erledigt",
            belegung_id: (bel as { id: number }).id,
            updated_by: profile?.id ?? null,
          })
          .eq("employee_id", employeeId)
          .eq("status", "schwebend");
      }
      if (ohneBett.length > 0) {
        setHinweis(
          `Ohne Bett übersprungen: ${ohneBett.join(", ")} – unter „Belegung“ nachtragen.`
        );
      }
    }

    // Positionen mit Mangel als Mängel übernehmen (optional).
    const maengelPos = positionen.filter((p) => posEntwurf[p.id]?.zustand === "mangel");
    if (maengelPos.length > 0 && window.confirm(
      `${maengelPos.length} Position(en) mit Zustand „Mangel“ – als offene Mängel für dieses Zimmer anlegen?`
    )) {
      const { error: mErr } = await supabase.from("unterkunft_mangel").insert(
        maengelPos.map((p) => ({
          zimmer_id: vorgang.zimmer_id,
          quelle_vorgang_id: vorgang.id,
          beschreibung: `${p.bereich}: ${posEntwurf[p.id]?.bemerkung?.trim() || "Mangel bei Übergabe/Abnahme"}`,
          schwere: "mittel" as const,
        }))
      );
      if (mErr) setFehler(`Vorgang abgeschlossen, aber Mängel nicht angelegt: ${mErr.message}`);
    }

    setHinweis((h) => h ?? "Vorgang abgeschlossen.");
    setEinzug({});
    setDirty(false);
    setVorgang(null);
    setPositionen([]);
    await laden();
  }

  function abbrechen() {
    if (dirty && !window.confirm("Nicht gespeicherte Eingaben verwerfen?")) return;
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
          Übergaben/Abnahmen dürfen nur admin/hr erfassen.
        </p>
      </div>
    );
  }

  const abgeschlossen = vorgang?.abgeschlossen ?? false;

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

      {!vorgang && (
        <>
          <section className="space-y-2 rounded border border-neutral-200 p-3">
            <h1 className="text-lg font-semibold text-emerald-900">
              Übergabe / Abnahme starten
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
                      belegung_id: "",
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
                  value={sel.zimmer_id}
                  disabled={!sel.gebaeude_id}
                  onChange={(e) =>
                    setSel((s) => ({ ...s, zimmer_id: e.target.value, belegung_id: "" }))
                  }
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
                Typ
                <select
                  className="ml-2"
                  value={sel.typ}
                  onChange={(e) =>
                    setSel((s) => ({
                      ...s,
                      typ: e.target.value as UnterkunftVorgangTyp,
                    }))
                  }
                >
                  <option value="einzug">{UNTERKUNFT_VORGANG_TYP_LABELS.einzug}</option>
                  <option value="auszug">{UNTERKUNFT_VORGANG_TYP_LABELS.auszug}</option>
                </select>
              </label>
              <label>
                Belegung (optional)
                <select
                  className="ml-2"
                  value={sel.belegung_id}
                  disabled={!sel.zimmer_id}
                  onChange={(e) =>
                    setSel((s) => ({ ...s, belegung_id: e.target.value }))
                  }
                >
                  <option value="">–</option>
                  {belegungenDesZimmers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.vorname} {b.name} ({b.personal_nr})
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" onClick={vorgangStarten}>
                Vorgang starten
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              {vorlage.length} Checklisten-Bereiche werden angelegt.
            </p>

            {sel.typ === "einzug" && sel.zimmer_id && (
              <div className="mt-2 space-y-2 rounded border border-emerald-200 bg-emerald-50/50 p-2">
                <div className="text-sm font-medium">
                  Personen für den Einzug ({Object.keys(einzug).length})
                </div>
                <p className="text-xs text-neutral-500">
                  Beim Abschließen wird je Person die Belegung angelegt und die
                  schwebende Zuordnung geschlossen.
                </p>
                {Object.keys(einzug).length === 0 && (
                  <p className="text-sm text-neutral-400">
                    keine geplanten Personen – unten per Namen hinzufügen.
                  </p>
                )}
                {Object.entries(einzug).map(([empId, bettId]) => (
                  <div
                    key={empId}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="min-w-[10rem] font-medium">
                      {personName(empId)}
                    </span>
                    <label>
                      Bett
                      <select
                        className="ml-1"
                        value={bettId}
                        onChange={(e) =>
                          setEinzug((s) => ({ ...s, [empId]: e.target.value }))
                        }
                      >
                        <option value="">– wählen –</option>
                        {freieBetten.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bezeichnung}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() =>
                        setEinzug((s) => {
                          const n = { ...s };
                          delete n[empId];
                          return n;
                        })
                      }
                    >
                      entfernen
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="w-48 text-sm"
                    placeholder="Person per Name suchen"
                    value={personSuche}
                    onChange={(e) => setPersonSuche(e.target.value)}
                  />
                  {personSuche.trim() && (
                    <div className="flex flex-wrap gap-1">
                      {employees
                        .filter(
                          (e) =>
                            e.aktiv &&
                            !(e.id in einzug) &&
                            `${e.vorname} ${e.name} ${e.personal_nr}`
                              .toLowerCase()
                              .includes(personSuche.trim().toLowerCase())
                        )
                        .slice(0, 6)
                        .map((e) => (
                          <button
                            key={e.id}
                            className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:border-emerald-500"
                            onClick={() => {
                              setEinzug((s) => ({ ...s, [e.id]: "" }));
                              setPersonSuche("");
                            }}
                          >
                            + {e.vorname} {e.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-neutral-800">Letzte Vorgänge</h2>
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Zimmer</th>
                  <th>Typ</th>
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
                        {g?.name ?? "?"} · {z?.nummer ?? v.zimmer_id}
                      </td>
                      <td>{UNTERKUNFT_VORGANG_TYP_LABELS[v.typ]}</td>
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
                            onClick={() => vorgangOeffnen(v)}
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
                    <td colSpan={6} className="text-sm text-neutral-400">
                      noch keine Vorgänge
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
                {UNTERKUNFT_VORGANG_TYP_LABELS[vorgang.typ]} · {zimmerName}
              </h1>
              <p className="text-sm text-neutral-500">
                {formatDatumDE(vorgang.durchgefuehrt_am)}
                {abgeschlossen && " · abgeschlossen (schreibgeschützt)"}
              </p>
            </div>
            <button className="btn-secondary" onClick={abbrechen}>
              {abgeschlossen ? "Schließen" : "Zurück"}
            </button>
          </div>

          <div className="space-y-4">
            {positionen.map((p) => {
              const e = posEntwurf[p.id] ?? { zustand: p.zustand, bemerkung: "" };
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
                      onChange={(ev) =>
                        setPos(p.id, { bemerkung: ev.target.value })
                      }
                    />
                  </div>
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
                Anwesende Person
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
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={kopf.zustand_bestaetigt}
                  disabled={abgeschlossen}
                  onChange={(e) => {
                    setKopf((s) => ({ ...s, zustand_bestaetigt: e.target.checked }));
                    setDirty(true);
                  }}
                />
                Zustand bestätigt
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
              <button className="btn" onClick={abschliessen} disabled={speichern}>
                Abschließen
              </button>
              {dirty && (
                <span className="self-center text-xs text-amber-700">
                  nicht gespeicherte Änderungen
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
