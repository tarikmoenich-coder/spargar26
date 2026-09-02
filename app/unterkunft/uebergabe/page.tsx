"use client";

// Unterkunft → Übergabe / Abnahme (Migration 2026-08-29). Ablauf:
//   1. Zimmer + Typ (Einzug/Auszug) wählen → Vorgang starten. Dabei wird
//      eine client-seitige UUID vergeben und die Checkliste aus der Vorlage
//      als Positionen angelegt (idempotenter Upsert, "meist online" + Retry).
//   2. Je Bereich Zustand + Bemerkung + Fotos erfassen, dazu Gesamtzustand,
//      Notiz, Name der anwesenden Person + Haken "Zustand bestätigt".
//   3. Abschließen → Vorgang wird schreibgeschützt (Trigger); Positionen mit
//      Zustand "Mangel" können als Mängel übernommen werden.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import FotoAufnahme from "@/components/FotoAufnahme";
import { formatDatumDE } from "@/lib/format";
import { heuteIso, mangelKategorieVorschlag } from "@/lib/unterkunft";
import {
  UNTERKUNFT_GESAMTZUSTAND_LABELS,
  UNTERKUNFT_MANGEL_KATEGORIE_LABELS,
  UNTERKUNFT_MANGEL_VERURSACHUNG_LABELS,
  UNTERKUNFT_POSITION_ZUSTAND_LABELS,
  UNTERKUNFT_VORGANG_TYP_LABELS,
  type UnterkunftBelegungAktuell,
  type UnterkunftChecklisteVorlage,
  type UnterkunftGebaeude,
  type UnterkunftGesamtzustand,
  type UnterkunftMangelKategorie,
  type UnterkunftMangelVerursachung,
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
  kategorie: UnterkunftMangelKategorie;
  verursachung: UnterkunftMangelVerursachung;
}

export default function UnterkunftUebergabePage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "hausmeister";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [employees, setEmployees] = useState<
    { id: string; personal_nr: string; name: string; vorname: string; aktiv: boolean }[]
  >([]);
  const [vorlage, setVorlage] = useState<UnterkunftChecklisteVorlage[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungAktuell[]>([]);
  const [zuordnungen, setZuordnungen] = useState<UnterkunftZuordnungOffen[]>([]);
  const [letzte, setLetzte] = useState<UnterkunftVorgang[]>([]);
  const [namen, setNamen] = useState<Record<string, string>>({});
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

  // Einzug: Personen (aus geplanten Zuordnungen vorbelegt). Beim Abschließen
  // wird je Person die zimmergenaue unterkunft_belegung angelegt und die
  // geplante Zuordnung geschlossen.
  const [einzug, setEinzug] = useState<Set<string>>(new Set());
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
    // Schlüssel: bei Einzug herausgegeben, bei Auszug zurückgegeben.
    schluessel_ausgegeben: 0,
    schluessel_zurueck: 0,
  });
  // Auszug: wie viele Schlüssel bei der letzten Einzugs-Übergabe dieses
  // Zimmers herausgegeben wurden (null = keine Einzugs-Übergabe gefunden).
  const [einzugSchluessel, setEinzugSchluessel] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [speichern, setSpeichern] = useState(false);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, z, emp, v, bl, zu, lv, pn] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").eq("aktiv", true).order("name"),
      supabase.from("unterkunft_zimmer").select("*").eq("aktiv", true).order("nummer"),
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
      supabase.from("profile_namen").select("*"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setEmployees((emp.data as typeof employees) ?? []);
    setVorlage((v.data as UnterkunftChecklisteVorlage[]) ?? []);
    setBelegungen((bl.data as UnterkunftBelegungAktuell[]) ?? []);
    setZuordnungen((zu.data as UnterkunftZuordnungOffen[]) ?? []);
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

  // Deep-Link aus den Immobilien: ?zimmer=<id> (+ optional ?typ=einzug|auszug,
  // ?belegung=<id>) wählt Gebäude/Zimmer/Typ vor. Bei ?typ=auszug mit
  // ?belegung wird der Vorgang direkt gestartet (Person ist ja schon gewählt).
  const autoStartRef = useRef(false);
  useEffect(() => {
    if (zimmer.length === 0) return;
    const q = new URLSearchParams(window.location.search);
    const param = q.get("zimmer");
    if (!param) return;
    const z = zimmer.find((x) => String(x.id) === param);
    if (!z) return;
    const typParam = q.get("typ");
    const belegungParam = q.get("belegung");
    setSel((s) => ({
      ...s,
      gebaeude_id: String(z.gebaeude_id),
      zimmer_id: String(z.id),
      typ:
        typParam === "auszug" || typParam === "einzug"
          ? (typParam as UnterkunftVorgangTyp)
          : s.typ,
      belegung_id: belegungParam ?? s.belegung_id,
    }));
  }, [zimmer]);

  // Auszug per Deep-Link direkt starten (Person = ?belegung ist schon gewählt).
  useEffect(() => {
    if (autoStartRef.current || vorgang || vorlage.length === 0) return;
    if (sel.typ !== "auszug" || !sel.zimmer_id) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("typ") !== "auszug") return;
    autoStartRef.current = true;
    vorgangStarten();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.typ, sel.zimmer_id, vorlage, vorgang]);

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
    (z) => String(z.gebaeude_id) === sel.gebaeude_id && z.art === "zimmer"
  );
  const belegungenDesZimmers = belegungen.filter(
    (b) => String(b.zimmer_id) === sel.zimmer_id
  );

  // Checklisten-Bereiche für einen Raumtyp (Migration 2026-09-11).
  const checklisteFuer = useCallback(
    (art: string) =>
      vorlage
        .filter((v) => v.art === art)
        .sort((a, b) => a.reihenfolge - b.reihenfolge),
    [vorlage]
  );
  const selArt =
    zimmer.find((z) => z.id === Number(sel.zimmer_id))?.art ?? "zimmer";

  // Belegung des gewählten Zimmers heute (für die Kapazitäts-Anzeige).
  const zimmerKapazitaet = useMemo(() => {
    if (!sel.zimmer_id) return null;
    const zid = Number(sel.zimmer_id);
    const z = zimmer.find((x) => x.id === zid);
    const belegt = belegungen.filter((b) => b.zimmer_id === zid).length;
    return { plaetze: z?.bettenzahl ?? 0, belegt };
  }, [zimmer, belegungen, sel.zimmer_id]);

  // Beim Wählen eines Zimmers für einen Einzug: geplante Zuordnungen dieses
  // Zimmers als Personen-Vorschlag übernehmen.
  useEffect(() => {
    if (sel.typ !== "einzug" || !sel.zimmer_id) {
      setEinzug(new Set());
      return;
    }
    const zid = Number(sel.zimmer_id);
    setEinzug(
      new Set(
        zuordnungen.filter((z) => z.zimmer_id === zid).map((z) => z.employee_id)
      )
    );
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
    const art = zimmer.find((z) => z.id === Number(sel.zimmer_id))?.art ?? "zimmer";
    const bereiche = checklisteFuer(art);
    if (bereiche.length === 0) {
      setFehler(
        "Für diesen Raumtyp sind keine Checklisten-Bereiche angelegt – zuerst unter Stammdaten pflegen."
      );
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
      bereiche.map((v) => ({
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
    setKopf({
      gesamtzustand: vg.gesamtzustand ?? "",
      notiz: vg.notiz ?? "",
      // Namensfeld für einen noch offenen Vorgang mit dem angemeldeten
      // Benutzer vorbelegen (überschreibbar, z. B. wenn bei einer
      // Auszugs-Abnahme der Mieter gegenzeichnet). Bei abgeschlossenen
      // Vorgängen nur zeigen, was gespeichert ist.
      unterschrift_name:
        vg.unterschrift_name ??
        (vg.abgeschlossen ? "" : profile?.full_name ?? ""),
      zustand_bestaetigt: vg.zustand_bestaetigt,
      schluessel_ausgegeben: vg.schluessel_ausgegeben ?? 0,
      schluessel_zurueck: vg.schluessel_zurueck ?? 0,
    });
    setDirty(false);

    // Beim Auszug: herausgegebene Schlüssel aus der letzten abgeschlossenen
    // Einzugs-Übergabe dieses Zimmers nachschlagen.
    if (vg.typ === "auszug") {
      const { data: ez } = await getSupabaseClient()
        .from("unterkunft_vorgang")
        .select("schluessel_ausgegeben")
        .eq("zimmer_id", vg.zimmer_id)
        .eq("typ", "einzug")
        .eq("abgeschlossen", true)
        .order("abgeschlossen_am", { ascending: false })
        .limit(1)
        .maybeSingle();
      const n = (ez as { schluessel_ausgegeben: number | null } | null)
        ?.schluessel_ausgegeben;
      setEinzugSchluessel(typeof n === "number" ? n : null);
      // Rückgabe-Feld sinnvoll vorbelegen, wenn noch nichts erfasst wurde.
      if (
        !vg.abgeschlossen &&
        vg.schluessel_zurueck == null &&
        typeof n === "number"
      ) {
        setKopf((s) => ({ ...s, schluessel_zurueck: n }));
      }
    } else {
      setEinzugSchluessel(null);
    }
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
        ) {
          continue;
        }
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
          ...(vorgang.typ === "einzug"
            ? { schluessel_ausgegeben: kopf.schluessel_ausgegeben }
            : {}),
          ...(vorgang.typ === "auszug"
            ? { schluessel_zurueck: kopf.schluessel_zurueck }
            : {}),
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
    if (
      vorgang.typ === "auszug" &&
      einzugSchluessel != null &&
      kopf.schluessel_zurueck !== einzugSchluessel &&
      !window.confirm(
        `Beim Einzug wurden ${einzugSchluessel} Schlüssel herausgegeben, ` +
          `jetzt sind ${kopf.schluessel_zurueck} zurückgegeben. Trotzdem abschließen?`
      )
    ) {
      return;
    }
    const ok = await speichernAlle();
    if (!ok) return;

    const supabase = getSupabaseClient();

    // Positionen mit Mangel als Mängel übernehmen (optional) - VOR dem
    // Abschließen, damit die Bereichs-Fotos noch an den neuen Mangel gehängt
    // werden können (danach ist der Vorgang schreibgeschützt).
    const maengelPos = positionen.filter(
      (p) => posEntwurf[p.id]?.zustand === "mangel"
    );
    if (
      maengelPos.length > 0 &&
      window.confirm(
        `${maengelPos.length} Position(en) mit Zustand „Mangel“ – als offene Mängel für dieses Zimmer anlegen?`
      )
    ) {
      for (const p of maengelPos) {
        const meta = posEntwurf[p.id];
        const { data: mg, error: mErr } = await supabase
          .from("unterkunft_mangel")
          .insert({
            zimmer_id: vorgang.zimmer_id,
            quelle_vorgang_id: vorgang.id,
            beschreibung: `${p.bereich}: ${
              meta?.bemerkung?.trim() || "Mangel bei Übergabe/Abnahme"
            }`,
            schwere: "mittel" as const,
            kategorie: meta?.kategorie ?? "sonstiges",
            verursachung:
              meta?.kategorie === "reparatur"
                ? meta?.verursachung ?? "unklar"
                : "unklar",
          })
          .select("id")
          .single();
        if (mErr) {
          setFehler(`Mangel „${p.bereich}“ nicht angelegt: ${mErr.message}`);
          continue;
        }
        // Die zu diesem Bereich aufgenommenen Fotos zusätzlich an den Mangel
        // hängen, damit sie in der Mängelliste erscheinen.
        await supabase
          .from("unterkunft_foto")
          .update({ mangel_id: (mg as { id: number }).id })
          .eq("vorgang_id", vorgang.id)
          .eq("bereich", p.bereich)
          .is("mangel_id", null);
      }
    }

    const { error } = await supabase
      .from("unterkunft_vorgang")
      .update({ abgeschlossen: true, abgeschlossen_am: new Date().toISOString() })
      .eq("id", vorgang.id);
    if (error) {
      setFehler(error.message);
      return;
    }

    // Einzug: je Person die zimmergenaue Belegung anlegen und die geplante
    // Zuordnung schließen.
    if (vorgang.typ === "einzug") {
      for (const employeeId of einzug) {
        const { data: bel, error: bErr } = await supabase
          .from("unterkunft_belegung")
          .insert({
            zimmer_id: vorgang.zimmer_id,
            employee_id: employeeId,
            von: heuteIso(),
          })
          .select("id")
          .single();
        if (bErr) {
          setFehler(`Belegung ${personName(employeeId)}: ${bErr.message}`);
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
          .eq("status", "geplant");
      }
    }

    // Auszug: die laufende(n) Belegung(en) tatsächlich beenden - sonst zählt
    // die Person in Suche/Grundriss/Übersicht weiter als "aktuell". Ist im
    // Startformular eine bestimmte Belegung gewählt, wird nur diese
    // geschlossen, sonst alle offenen Belegungen des Zimmers.
    if (vorgang.typ === "auszug") {
      const offene = belegungen.filter(
        (b) =>
          b.zimmer_id === vorgang.zimmer_id &&
          b.bis === null &&
          (!vorgang.belegung_id || b.id === vorgang.belegung_id)
      );
      if (offene.length > 0) {
        const wer = offene
          .map((b) => `${b.vorname} ${b.name}`)
          .join(", ");
        const datum = window.prompt(
          `Auszugsdatum – die Belegung von ${wer} wird zu diesem Datum beendet.`,
          heuteIso()
        );
        if (datum) {
          const { error: aErr } = await supabase
            .from("unterkunft_belegung")
            .update({ bis: datum })
            .in(
              "id",
              offene.map((b) => b.id)
            )
            .is("bis", null);
          if (aErr) setFehler(`Belegung beenden: ${aErr.message}`);
        } else {
          setHinweis(
            "Vorgang abgeschlossen – die Belegung wurde NICHT beendet " +
              "(kein Datum). Bei Bedarf unter „Belegung“ nachtragen."
          );
        }
      }
    }

    setHinweis((h) => h ?? "Vorgang abgeschlossen.");
    setEinzug(new Set());
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
          <section className="space-y-2 rounded border border-linie p-3">
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
              {sel.zimmer_id
                ? `${checklisteFuer(selArt).length} Checklisten-Bereiche werden angelegt.`
                : "Checkliste richtet sich nach dem Raumtyp."}
            </p>

            {sel.typ === "einzug" && sel.zimmer_id && (
              <div className="mt-2 space-y-2 rounded border border-emerald-200 bg-emerald-50/50 p-2">
                <div className="text-sm font-medium">
                  Personen für den Einzug ({einzug.size})
                  {zimmerKapazitaet && (
                    <span className="ml-2 font-normal text-neutral-500">
                      Zimmer: {zimmerKapazitaet.belegt}/{zimmerKapazitaet.plaetze}{" "}
                      Plätze belegt
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">
                  Beim Abschließen wird je Person die Belegung angelegt und die
                  geplante Zuordnung geschlossen.
                </p>
                {zimmerKapazitaet &&
                  zimmerKapazitaet.belegt + einzug.size >
                    zimmerKapazitaet.plaetze && (
                    <p className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                      Mehr Personen als Schlafplätze – Überbuchung.
                    </p>
                  )}
                {einzug.size === 0 && (
                  <p className="text-sm text-neutral-400">
                    keine geplanten Personen – unten per Namen hinzufügen.
                  </p>
                )}
                {[...einzug].map((empId) => (
                  <div
                    key={empId}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="min-w-[10rem] font-medium">
                      {personName(empId)}
                    </span>
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() =>
                        setEinzug((s) => {
                          const n = new Set(s);
                          n.delete(empId);
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
                            !einzug.has(e.id) &&
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
                              setEinzug((s) => new Set(s).add(e.id));
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
              <p className="text-sm text-neutral-500">
                Durchgeführt von:{" "}
                {(vorgang.durchgefuehrt_von &&
                  namen[vorgang.durchgefuehrt_von]) ||
                  profile?.full_name ||
                  "—"}
              </p>
            </div>
            <button className="btn-secondary" onClick={abbrechen}>
              {abgeschlossen ? "Schließen" : "Zurück"}
            </button>
          </div>

          <div className="space-y-4">
            {positionen.map((p) => {
              const e = posEntwurf[p.id] ?? {
                zustand: p.zustand,
                bemerkung: "",
                kategorie: mangelKategorieVorschlag(p.bereich),
                verursachung: "unklar" as const,
              };
              return (
                <div key={p.id} className="rounded border border-linie p-3">
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

          <div className="space-y-3 rounded border border-linie p-3">
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

              {vorgang.typ === "einzug" && (
                <label>
                  Schlüssel herausgegeben
                  <select
                    className="ml-2"
                    value={kopf.schluessel_ausgegeben}
                    disabled={abgeschlossen}
                    onChange={(e) => {
                      setKopf((s) => ({
                        ...s,
                        schluessel_ausgegeben: Number(e.target.value),
                      }));
                      setDirty(true);
                    }}
                  >
                    {Array.from({ length: 13 }, (_, i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {vorgang.typ === "auszug" && (
                <label>
                  Schlüssel zurückgegeben
                  {einzugSchluessel != null && (
                    <span className="ml-1 text-xs text-neutral-500">
                      (beim Einzug: {einzugSchluessel})
                    </span>
                  )}
                  <select
                    className="ml-2"
                    value={kopf.schluessel_zurueck}
                    disabled={abgeschlossen}
                    onChange={(e) => {
                      setKopf((s) => ({
                        ...s,
                        schluessel_zurueck: Number(e.target.value),
                      }));
                      setDirty(true);
                    }}
                  >
                    {Array.from(
                      { length: Math.max(13, (einzugSchluessel ?? 0) + 1) },
                      (_, i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      )
                    )}
                  </select>
                </label>
              )}
            </div>

            {vorgang.typ === "auszug" &&
              einzugSchluessel != null &&
              !abgeschlossen &&
              kopf.schluessel_zurueck < einzugSchluessel && (
                <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  Es fehlen {einzugSchluessel - kopf.schluessel_zurueck} von{" "}
                  {einzugSchluessel} Schlüsseln.
                </p>
              )}
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
