"use client";

// Unterkunft → Grundriss (Migration 2026-08-30, Wohneinheiten 2026-08-31):
// Einstiegsseite. Gebäude wählen → Etage-Umschalter → Wohneinheit-Karten
// (Betten · fest · geplant · frei · Herkunfts-Mix). Karte antippen →
// Zimmer-Raster der Wohneinheit + Liste „noch offen" (geplante Personen
// ohne Übergabe). Zimmer antippen → Panel mit Bewohnern/Kontrolle/Mängeln
// und „Übergabe starten" (deep link mit ?zimmer=).
//
// Zimmer im Raster platzieren/verschieben: nur admin.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import {
  GRUNDRISS_ZELLE as Z,
  KONTROLL_AMPEL_FARBE,
  KONTROLL_AMPEL_LABELS,
  herkunftDominant,
  herkunftFarbe,
  herkunftMix,
  heuteIso,
  kontrollAmpel,
  raumName,
  type KontrollAmpel,
  type KontrollSchwellen,
} from "@/lib/unterkunft";
import {
  UNTERKUNFT_MANGEL_KATEGORIE_LABELS,
  UNTERKUNFT_MANGEL_SCHWERE_LABELS,
  UNTERKUNFT_MANGEL_STATUS_LABELS,
  UNTERKUNFT_VORGANG_TYP_LABELS,
  type UnterkunftBelegungAktuell,
  type UnterkunftGebaeude,
  type UnterkunftKontrollIntervall,
  type UnterkunftMangel,
  type UnterkunftMangelKategorie,
  type UnterkunftMangelSchwere,
  type UnterkunftMangelStatus,
  type UnterkunftPersonOffen,
  type UnterkunftWohneinheitUebersicht,
  type UnterkunftZimmerArt,
  type UnterkunftZimmerUebersicht,
  type UnterkunftZuordnungOffen,
} from "@/lib/types";

const MIN_COLS = 14;
const MIN_ROWS = 10;

// Farbschema je Raumtyp (Fläche + Rand). Schlafzimmer werden zusätzlich
// nach Belegung eingefärbt (siehe zimmerFarbe), offene Mängel setzen den
// Rand auf Rot.
const RAUM_STYLE: Record<
  Exclude<UnterkunftZimmerArt, "zimmer">,
  { fill: string; stroke: string; label: string }
> = {
  bad: { fill: "#e0f2fe", stroke: "#0ea5e9", label: "Bad" },
  wc: { fill: "#cffafe", stroke: "#06b6d4", label: "WC" },
  flur: { fill: "#ede9fe", stroke: "#8b5cf6", label: "Flur" },
  kueche: { fill: "#fef3c7", stroke: "#f59e0b", label: "Küche" },
  gemeinschaft: { fill: "#eef2ff", stroke: "#a5b4fc", label: "Gemeinschaft" },
};
const ZIMMER_FREI = { fill: "#dcfce7", stroke: "#22c55e" };
const ZIMMER_VOLL = { fill: "#f1f5f9", stroke: "#94a3b8" };
const ZIMMER_INAKTIV = { fill: "#fafafa", stroke: "#e5e5e5" };
const ZIMMER_GESPERRT = { fill: "#e2e8f0", stroke: "#475569" };
const ZIMMER_LEER_HERKUNFT = { fill: "#f8fafc", stroke: "#cbd5e1" };

// Ansichts-Umschalter: nur die Kachelfläche wechselt die Bedeutung.
type Ansicht = "belegung" | "herkunft" | "kontrolle" | "maengel";
const ANSICHT_LABELS: Record<Ansicht, string> = {
  belegung: "Belegung",
  herkunft: "Herkunft",
  kontrolle: "Kontrolle",
  maengel: "Mängel",
};
const AMPEL_KACHEL: Record<KontrollAmpel, { fill: string; stroke: string }> = {
  keine: { fill: "#f4f4f5", stroke: "#a3a3a3" },
  gruen: { fill: "#dcfce7", stroke: "#16a34a" },
  gelb: { fill: "#fef3c7", stroke: "#f59e0b" },
  rot: { fill: "#fee2e2", stroke: "#dc2626" },
};
const MAENGEL_KACHEL = { fill: "#fee2e2", stroke: "#dc2626" };
const MAENGEL_KEIN = { fill: "#f4f4f5", stroke: "#d4d4d8" };

function legendeFuer(
  ansicht: Ansicht
): Array<{ fill: string; stroke: string; label: string }> {
  if (ansicht === "kontrolle") {
    return [
      { ...AMPEL_KACHEL.gruen, label: "aktuell" },
      { ...AMPEL_KACHEL.gelb, label: "bald fällig" },
      { ...AMPEL_KACHEL.rot, label: "überfällig" },
      { ...AMPEL_KACHEL.keine, label: "noch keine" },
    ];
  }
  if (ansicht === "maengel") {
    return [
      { ...MAENGEL_KACHEL, label: "offene Mängel" },
      { ...MAENGEL_KEIN, label: "ohne Mängel" },
    ];
  }
  if (ansicht === "herkunft") {
    return [
      { ...ZIMMER_LEER_HERKUNFT, label: "leer" },
      { fill: "hsl(30 70% 88%)", stroke: "hsl(30 55% 55%)", label: "je Herkunft eine Farbe" },
      { ...ZIMMER_GESPERRT, label: "gesperrt" },
    ];
  }
  return [
    { ...ZIMMER_FREI, label: "Zimmer (Betten frei)" },
    { ...ZIMMER_VOLL, label: "Zimmer (voll)" },
    { ...ZIMMER_GESPERRT, label: "gesperrt" },
    { ...RAUM_STYLE.bad, label: "Bad" },
    { ...RAUM_STYLE.wc, label: "WC" },
    { ...RAUM_STYLE.flur, label: "Flur" },
    { ...RAUM_STYLE.kueche, label: "Küche" },
    { fill: "#fff", stroke: "#dc2626", label: "offene Mängel" },
  ];
}

interface ZimmerFarbInput {
  art: UnterkunftZimmerArt;
  aktiv: boolean;
  frei: number;
  offene_maengel: number;
  gesperrt: boolean;
  letzte_kontrolle_am: string | null;
}

function zimmerFarbe(
  z: ZimmerFarbInput,
  ansicht: Ansicht = "belegung",
  dominant: string | null = null,
  schwellen: KontrollSchwellen | null = null
): { fill: string; stroke: string } {
  if (!z.aktiv) return ZIMMER_INAKTIV;
  // Flure sind nicht kontrollpflichtig (Nutzer-Vorgabe 2026-09-01).
  if (ansicht === "kontrolle" && z.art === "flur") return RAUM_STYLE.flur;
  if (ansicht === "kontrolle") {
    return AMPEL_KACHEL[kontrollAmpel(z.letzte_kontrolle_am, schwellen)];
  }
  if (ansicht === "maengel") {
    return z.offene_maengel > 0 ? MAENGEL_KACHEL : MAENGEL_KEIN;
  }
  if (z.gesperrt) return ZIMMER_GESPERRT;
  let base: { fill: string; stroke: string };
  if (ansicht === "herkunft") {
    base =
      z.art !== "zimmer"
        ? RAUM_STYLE[z.art]
        : dominant
          ? herkunftFarbe(dominant)
          : ZIMMER_LEER_HERKUNFT;
  } else {
    base =
      z.art !== "zimmer"
        ? RAUM_STYLE[z.art]
        : z.frei > 0
          ? ZIMMER_FREI
          : ZIMMER_VOLL;
  }
  const stroke = z.offene_maengel > 0 ? "#dc2626" : base.stroke;
  return { fill: base.fill, stroke };
}

interface DragState {
  zimmerId: number;
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  aktX: number;
  aktY: number;
}

interface UmzugState {
  belegungId: number;
  employeeId: string;
  name: string;
  vonZimmer: string;
  vonDatum: string;
}

// Kleine Symbole für die Zimmer-Aktionen: Person/Pfeil ins Haus (Einzug) bzw.
// aus dem Haus heraus (Auszug).
function IconEinzug() {
  return (
    <svg
      width="18"
      height="14"
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 15V9h4v6M12 10l4-4 4 4" />
      <path d="M2 8h8M7 4.5 10.5 8 7 11.5" />
    </svg>
  );
}
function IconAuszug() {
  return (
    <svg
      width="18"
      height="14"
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 15V9h4v6M4 10l4-4 4 4" />
      <path d="M14 8h8M18.5 4.5 22 8l-3.5 3.5" />
    </svg>
  );
}

export default function UnterkunftGrundrissPage() {
  const { profile } = useProfile();
  const router = useRouter();
  // Kacheln verschieben / Räume anlegen: nur admin.
  const canEditPlan = profile?.role === "admin";
  // Zimmer sperren: wie bei den übrigen Zimmer-Stammdaten (RLS: admin/hr).
  const canManage = profile?.role === "admin" || profile?.role === "hr";
  // Belegen + Umzug: admin/hr/hausmeister (RLS unterkunft_belegung). Der
  // Hausmeister macht die Zimmerübergaben und wickelt Umzüge vor Ort ab.
  const canMove =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "hausmeister";
  // Mängel anlegen/bearbeiten: admin/hr/hausmeister (RLS unterkunft_mangel).
  const canEditMangel = canMove;
  // Hausmeister: schlanke Ansicht - Zimmer-Liste als Standard (auch am
  // Desktop), keine Grundriss-Farbmodi, kein Zoom-/Bearbeiten-Menü
  // (Nutzer-Vorgabe 2026-09-01).
  const istHausmeister = profile?.role === "hausmeister";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [einheiten, setEinheiten] = useState<UnterkunftWohneinheitUebersicht[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmerUebersicht[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegungAktuell[]>([]);
  const [zuordnungen, setZuordnungen] = useState<UnterkunftZuordnungOffen[]>([]);
  const [personenOffen, setPersonenOffen] = useState<UnterkunftPersonOffen[]>([]);
  const [maengel, setMaengel] = useState<UnterkunftMangel[]>([]);
  const [intervalle, setIntervalle] = useState<
    Record<string, KontrollSchwellen>
  >({});
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [gebaeudeId, setGebaeudeId] = useState<number | null>(null);
  const [etageFilter, setEtageFilter] = useState<string>("");
  const [einheitId, setEinheitId] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [ansicht, setAnsicht] = useState<Ansicht>("belegung");
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Unter `lg` ist standardmäßig die Zimmer-Liste sichtbar statt des
  // SVG-Grundrisses - der ist auf dem Telefon nur mit Dauerzoomen bedienbar
  // (Nutzer-Vorgabe 2026-09-01). Umschaltbar über die Steuerleiste.
  const [mobilAnsicht, setMobilAnsicht] = useState<"liste" | "plan">("liste");
  // Tatsächliche Breite des Plan-Containers, damit der SVG-Grundriss auf
  // schmalen Schirmen auf Breite eingepasst wird (statt nativ zu überlaufen).
  const planRef = useRef<HTMLDivElement>(null);
  const [planBreite, setPlanBreite] = useState(0);
  // Nach der Auswahl einer Wohneinheit den Detailbereich in den Blick
  // holen, statt den Nutzer wieder herunterscrollen zu lassen.
  const einheitDetailRef = useRef<HTMLDivElement>(null);

  // Umzug (Zimmerwechsel einer Person)
  const [umzug, setUmzug] = useState<UmzugState | null>(null);
  const [umzugZiel, setUmzugZiel] = useState({
    wohneinheit_id: "",
    zimmer_id: "",
    datum: heuteIso(),
  });
  // Direkt belegen (nur admin), ohne Übergabe
  const [direkt, setDirekt] = useState<{ suche: string } | null>(null);
  // Zimmer-Panel: Einzug (Person hinzufügen) aufgeklappt / Auszug-Personenwahl.
  const [einzugOffen, setEinzugOffen] = useState(false);
  const [auszugWahlOffen, setAuszugWahlOffen] = useState(false);
  // Belegen-Modus: Person antippen → Zimmer antippen (2 Taps, kein Panel).
  const [belegen, setBelegen] = useState(false);
  const [handPerson, setHandPerson] = useState<UnterkunftPersonOffen | null>(null);
  const [belegenSuche, setBelegenSuche] = useState("");
  // Gruppen-Einzug (Nutzer-Vorgabe 2026-09-01): mehrere Personen des ganzen
  // Gebäudes markieren → ein Zimmer antippen → alle dort einziehen. Für den
  // Massen-Anreisetag. Personenpool = geplante Zuordnungen des Gebäudes bzw.
  // Leute ohne Bleibe.
  const [gruppenEinzug, setGruppenEinzug] = useState(false);
  const [einzugWahl, setEinzugWahl] = useState<Set<string>>(new Set());
  const [einzugQuelle, setEinzugQuelle] = useState<
    "geplant" | "offen" | "alle"
  >("geplant");
  const [einzugSuche, setEinzugSuche] = useState("");
  const [einzugZiel, setEinzugZiel] =
    useState<UnterkunftZimmerUebersicht | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  // Karten-Übersicht der Wohneinheiten ein-/ausklappen; Plan-Werkzeuge (Zoom/
  // Bearbeiten) im aufklappbaren Menü statt dauerhaft in der Leiste.
  const [uebersichtAuf, setUebersichtAuf] = useState(true);
  // Gebäude-Kartenraster ein-/ausklappen: nach der Wahl eines Gebäudes klappt
  // es zu einer Zeile zusammen, damit man nicht am ganzen Raster
  // vorbeiscrollen muss, um eine Wohneinheit zu wählen (Nutzer-Vorgabe
  // 2026-09-01).
  const [gebWahlAuf, setGebWahlAuf] = useState(true);
  const [werkzeugeAuf, setWerkzeugeAuf] = useState(false);
  // Zimmer-Panel: offene Mängel aufgeklappt / Mangel-melden-Formular offen
  const [maengelAuf, setMaengelAuf] = useState(false);
  const [neuerMangel, setNeuerMangel] = useState<{
    beschreibung: string;
    schwere: UnterkunftMangelSchwere;
    kategorie: UnterkunftMangelKategorie;
  } | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, e, z, b, zu, po, m, ki] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").order("name"),
      supabase
        .from("unterkunft_wohneinheit_uebersicht")
        .select("*")
        .order("reihenfolge"),
      supabase.from("unterkunft_zimmer_uebersicht").select("*").order("nummer"),
      supabase.from("unterkunft_belegung_aktuell").select("*"),
      supabase.from("unterkunft_zuordnung_offen").select("*"),
      supabase.from("unterkunft_person_offen").select("*").order("name"),
      supabase
        .from("unterkunft_mangel")
        .select("*")
        .neq("status", "behoben")
        .order("gemeldet_am", { ascending: false }),
      supabase.from("unterkunft_kontroll_intervall").select("*"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setEinheiten((e.data as UnterkunftWohneinheitUebersicht[]) ?? []);
    setZimmer((z.data as UnterkunftZimmerUebersicht[]) ?? []);
    setBelegungen((b.data as UnterkunftBelegungAktuell[]) ?? []);
    setZuordnungen((zu.data as UnterkunftZuordnungOffen[]) ?? []);
    setPersonenOffen((po.data as UnterkunftPersonOffen[]) ?? []);
    setMaengel((m.data as UnterkunftMangel[]) ?? []);
    setIntervalle(
      Object.fromEntries(
        ((ki.data as UnterkunftKontrollIntervall[]) ?? []).map((r) => [
          r.art,
          { gruen: r.gruen_bis_tage, gelb: r.gelb_bis_tage },
        ])
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  // Zuletzt gewähltes Gebäude/Wohneinheit wiederherstellen.
  useEffect(() => {
    if (gebaeude.length === 0) return;
    let gespeichert: number | null = null;
    try {
      const v = window.localStorage.getItem("unterkunft.gebaeudeId");
      if (v) gespeichert = Number(v);
    } catch {
      /* Storage nicht verfügbar */
    }
    if (gebaeudeId == null || !gebaeude.some((g) => g.id === gebaeudeId)) {
      const ziel =
        gespeichert != null && gebaeude.some((g) => g.id === gespeichert)
          ? gespeichert
          : gebaeude[0].id;
      setGebaeudeId(ziel);
    }
  }, [gebaeude, gebaeudeId]);

  useEffect(() => {
    try {
      if (gebaeudeId != null)
        window.localStorage.setItem("unterkunft.gebaeudeId", String(gebaeudeId));
    } catch {
      /* egal */
    }
  }, [gebaeudeId]);

  // Beim ersten Laden die zuletzt gewählte Wohneinheit übernehmen (nur wenn
  // sie zum aktuellen Gebäude passt).
  const einheitWiederhergestellt = useRef(false);
  useEffect(() => {
    if (einheitWiederhergestellt.current || einheiten.length === 0) return;
    einheitWiederhergestellt.current = true;
    try {
      const v = window.localStorage.getItem("unterkunft.einheitId");
      if (!v) return;
      const id = Number(v);
      const e = einheiten.find((x) => x.wohneinheit_id === id);
      if (e && e.gebaeude_id === gebaeudeId) {
        setEinheitId(id);
        setUebersichtAuf(false);
        setGebWahlAuf(false);
      }
    } catch {
      /* egal */
    }
  }, [einheiten, gebaeudeId]);

  useEffect(() => {
    try {
      if (einheitId != null)
        window.localStorage.setItem("unterkunft.einheitId", String(einheitId));
    } catch {
      /* egal */
    }
  }, [einheitId]);

  // Umzug-/Direktbeleg-Formular schließen, sobald ein anderer Raum oder eine
  // andere Wohneinheit gewählt wird.
  useEffect(() => {
    setUmzug(null);
    setDirekt(null);
    setMaengelAuf(false);
    setNeuerMangel(null);
    setEinzugOffen(false);
    setAuszugWahlOffen(false);
    setEinzugZiel(null);
  }, [selId, einheitId]);

  // Beim Verlassen des Belegen-Modus die „Person in der Hand" loslassen.
  useEffect(() => {
    if (!belegen) setHandPerson(null);
  }, [belegen]);

  // Gruppen-Einzug verlassen → Auswahl leeren.
  useEffect(() => {
    if (!gruppenEinzug) {
      setEinzugWahl(new Set());
      setEinzugZiel(null);
      setEinzugSuche("");
    }
  }, [gruppenEinzug]);

  // Nach Wahl/Wechsel einer Wohneinheit den Detailbereich an den oberen
  // Rand holen (scroll-margin-top hält Nav + Reiterleiste frei).
  useEffect(() => {
    if (einheitId == null) return;
    einheitDetailRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [einheitId]);

  // Breite des Plan-Containers verfolgen (für „auf Breite einpassen").
  useEffect(() => {
    const el = planRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setPlanBreite((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    setPlanBreite(el.clientWidth);
    return () => ro.disconnect();
  }, [einheitId, mobilAnsicht]);

  // Solange auf dem Telefon das Detail-Sheet offen ist, den Seiten-Scroll
  // sperren - sonst scrollt man „durch weiße Bereiche" hinter dem Sheet
  // (Nutzer-Vorgabe 2026-09-01).
  useEffect(() => {
    if (selId == null) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const vorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = vorher;
    };
  }, [selId]);

  const einheitenDesGebaeudes = useMemo(
    () => einheiten.filter((e) => e.gebaeude_id === gebaeudeId && e.aktiv),
    [einheiten, gebaeudeId]
  );

  const etagen = useMemo(() => {
    const s = new Set<string>();
    einheitenDesGebaeudes.forEach((e) => {
      if (e.etage_label) s.add(e.etage_label);
    });
    return [...s].sort();
  }, [einheitenDesGebaeudes]);

  const gefilterteEinheiten = etageFilter
    ? einheitenDesGebaeudes.filter((e) => e.etage_label === etageFilter)
    : einheitenDesGebaeudes;

  const einheit =
    einheitId != null
      ? einheiten.find((e) => e.wohneinheit_id === einheitId) ?? null
      : null;

  // Gruppen-Einzug: Personenpool des ganzen Gebäudes.
  const gebaeudeWEs = useMemo(
    () =>
      new Set(
        einheiten
          .filter((e) => e.gebaeude_id === gebaeudeId)
          .map((e) => e.wohneinheit_id)
      ),
    [einheiten, gebaeudeId]
  );
  const geplanteImGebaeude = useMemo(
    () =>
      zuordnungen.filter(
        (z) => z.wohneinheit_id != null && gebaeudeWEs.has(z.wohneinheit_id)
      ),
    [zuordnungen, gebaeudeWEs]
  );
  const einzugPool = useMemo(() => {
    type P = {
      employee_id: string;
      vorname: string;
      name: string;
      herkunft: string | null;
      hint: string;
      zuordnungId?: number;
    };
    const map = new Map<string, P>();
    if (einzugQuelle !== "offen")
      for (const z of geplanteImGebaeude)
        map.set(z.employee_id, {
          employee_id: z.employee_id,
          vorname: z.vorname,
          name: z.name,
          herkunft: z.herkunft,
          hint: z.wohneinheit_name,
          zuordnungId: z.id,
        });
    if (einzugQuelle !== "geplant")
      for (const p of personenOffen)
        if (!map.has(p.employee_id))
          map.set(p.employee_id, {
            employee_id: p.employee_id,
            vorname: p.vorname,
            name: p.name,
            herkunft: p.herkunft,
            hint: "ohne Bleibe",
          });
    const q = einzugSuche.trim().toLowerCase();
    return [...map.values()]
      .filter(
        (p) => !q || `${p.vorname} ${p.name}`.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [einzugQuelle, geplanteImGebaeude, personenOffen, einzugSuche]);

  // Inaktive Zimmer werden im Grundriss nur im Bearbeiten-Modus gezeigt
  // (sonst nicht mehr im Weg).
  const zimmerDerEinheit = useMemo(
    () =>
      zimmer.filter(
        (z) => z.wohneinheit_id === einheitId && (z.aktiv || bearbeiten)
      ),
    [zimmer, einheitId, bearbeiten]
  );
  const platziert = zimmerDerEinheit.filter(
    (z) => z.plan_x != null && z.plan_y != null
  );
  const ablage = zimmerDerEinheit.filter(
    (z) => z.plan_x == null || z.plan_y == null
  );

  const belegungProZimmer = useMemo(() => {
    const map: Record<number, UnterkunftBelegungAktuell[]> = {};
    belegungen.forEach((b) => {
      (map[b.zimmer_id] ??= []).push(b);
    });
    return map;
  }, [belegungen]);

  const zuordnungProZimmer = useMemo(() => {
    const map: Record<number, UnterkunftZuordnungOffen[]> = {};
    zuordnungen.forEach((z) => {
      if (z.zimmer_id != null) (map[z.zimmer_id] ??= []).push(z);
    });
    return map;
  }, [zuordnungen]);

  // Offene Mängel je Zimmer (für die aufklappbare Liste im Zimmer-Panel).
  const maengelProZimmer = useMemo(() => {
    const map: Record<number, UnterkunftMangel[]> = {};
    maengel.forEach((m) => {
      (map[m.zimmer_id] ??= []).push(m);
    });
    return map;
  }, [maengel]);

  // Kontroll-Schwellen (grün/gelb-Tage) für einen Raumtyp, aus den Stammdaten.
  const schwellenVon = useCallback(
    (art: UnterkunftZimmerArt): KontrollSchwellen | null =>
      intervalle[art] ?? null,
    [intervalle]
  );

  const zuordnungDerEinheit = useMemo(
    () => zuordnungen.filter((z) => z.wohneinheit_id === einheitId),
    [zuordnungen, einheitId]
  );

  // Häufigste Herkunft je Zimmer (für die Herkunfts-Ansicht).
  const dominantProZimmer = useMemo(() => {
    const m: Record<number, string | null> = {};
    for (const [zid, liste] of Object.entries(belegungProZimmer)) {
      m[Number(zid)] = herkunftDominant(liste);
    }
    return m;
  }, [belegungProZimmer]);

  // Kennzahlen je Wohneinheit aus den Zimmerdaten (lock-bereinigt): ein
  // gesperrtes Zimmer zählt nicht als "frei".
  const statsProEinheit = useMemo(() => {
    const m: Record<
      number,
      { betten: number; fest: number; geplant: number; frei: number; gesperrt: number }
    > = {};
    zimmer.forEach((z) => {
      if (z.art !== "zimmer" || !z.aktiv || z.wohneinheit_id == null) return;
      const s = (m[z.wohneinheit_id] ??= {
        betten: 0,
        fest: 0,
        geplant: 0,
        frei: 0,
        gesperrt: 0,
      });
      s.betten += z.betten;
      s.fest += z.belegt;
      s.geplant += z.geplant;
      if (z.gesperrt) s.gesperrt += 1;
      else s.frei += z.frei;
    });
    return m;
  }, [zimmer]);

  // Kennzahlen je Gebäude (für die Gebäude-Karten) - analog statsProEinheit.
  const statsProGebaeude = useMemo(() => {
    const m: Record<
      number,
      {
        betten: number;
        fest: number;
        geplant: number;
        frei: number;
        gesperrt: number;
        ueber: number;
      }
    > = {};
    zimmer.forEach((z) => {
      if (z.art !== "zimmer" || !z.aktiv || z.gebaeude_id == null) return;
      const s = (m[z.gebaeude_id] ??= {
        betten: 0,
        fest: 0,
        geplant: 0,
        frei: 0,
        gesperrt: 0,
        ueber: 0,
      });
      s.betten += z.betten;
      s.fest += z.belegt;
      s.geplant += z.geplant;
      if (z.gesperrt) s.gesperrt += 1;
      else s.frei += z.frei;
      const soll = z.belegt + z.geplant;
      if (soll > z.betten) s.ueber += soll - z.betten;
    });
    return m;
  }, [zimmer]);

  // Wohneinheit-ID → Gebäude-ID, für die Herkunfts-Zusammenfassung je Haus.
  const gebaeudeVonEinheit = useMemo(() => {
    const m: Record<number, number> = {};
    einheiten.forEach((e) => {
      m[e.wohneinheit_id] = e.gebaeude_id;
    });
    return m;
  }, [einheiten]);

  // Bewohner + geplante Personen je Gebäude (für den Herkunfts-Mix im Chip).
  const personenProGebaeude = useMemo(() => {
    const m: Record<number, { herkunft: string | null }[]> = {};
    const zu = (
      wohneinheitId: number | null,
      p: { herkunft: string | null }
    ) => {
      if (wohneinheitId == null) return;
      const gid = gebaeudeVonEinheit[wohneinheitId];
      if (gid != null) (m[gid] ??= []).push(p);
    };
    belegungen.forEach((b) => zu(b.wohneinheit_id, b));
    zuordnungen.forEach((z) => zu(z.wohneinheit_id, z));
    return m;
  }, [belegungen, zuordnungen, gebaeudeVonEinheit]);

  // Zimmer/Raum sperren oder entsperren (admin/hr).
  async function sperreSetzen(z: UnterkunftZimmerUebersicht, sperren: boolean) {
    let grund: string | null = null;
    if (sperren) {
      const eingabe = window.prompt(
        `Grund der Sperre für „${raumName(z)}" (z. B. Wasserschaden, Renovierung)`,
        z.sperr_grund ?? ""
      );
      grund = eingabe?.trim() || null;
      if (!grund) return;
    }
    setZimmer((prev) =>
      prev.map((x) =>
        x.zimmer_id === z.zimmer_id
          ? { ...x, gesperrt: sperren, sperr_grund: sperren ? grund : null }
          : x
      )
    );
    const { error } = await getSupabaseClient()
      .from("unterkunft_zimmer")
      .update({
        gesperrt: sperren,
        sperr_grund: sperren ? grund : null,
        updated_by: profile?.id ?? null,
      })
      .eq("id", z.zimmer_id);
    if (error) {
      setFehler(error.message);
      laden();
    } else {
      setFehler(null);
    }
  }

  function umzugStarten(b: UnterkunftBelegungAktuell, vonZimmer: string) {
    setUmzug({
      belegungId: b.id,
      employeeId: b.employee_id,
      name: `${b.vorname} ${b.name}`,
      vonZimmer,
      vonDatum: b.von,
    });
    setUmzugZiel({
      wohneinheit_id: einheitId ? String(einheitId) : "",
      zimmer_id: "",
      datum: heuteIso(),
    });
  }

  // Umzug: neue Belegung ab dem Umzugsdatum anlegen, alte zum selben Datum
  // schließen (der Umzugstag zählt am neuen Platz; die eintägige Überschneidung
  // löst sich am Folgetag auf).
  async function umzugAusfuehren() {
    if (!umzug) return;
    const zielId = Number(umzugZiel.zimmer_id);
    const datum = umzugZiel.datum;
    if (!zielId || !datum) {
      setFehler("Zielzimmer und Umzugsdatum wählen.");
      return;
    }
    if (datum < umzug.vonDatum) {
      setFehler(
        `Das Umzugsdatum liegt vor dem Einzug in Zimmer ${umzug.vonZimmer} (${umzug.vonDatum}).`
      );
      return;
    }
    setFehler(null);
    const sb = getSupabaseClient();
    const { error: e1 } = await sb.from("unterkunft_belegung").insert({
      zimmer_id: zielId,
      employee_id: umzug.employeeId,
      von: datum,
      notiz: `Umzug aus Zimmer ${umzug.vonZimmer}`,
    });
    if (e1) {
      setFehler(e1.message);
      return;
    }
    const { error: e2 } = await sb
      .from("unterkunft_belegung")
      .update({ bis: datum })
      .eq("id", umzug.belegungId);
    if (e2) {
      setFehler(e2.message);
      return;
    }
    setUmzug(null);
    await laden();
  }

  // Direkt belegen (nur admin), ohne Übergabe. Optional eine geplante
  // Zuordnung mitschließen.
  async function belegungDirekt(
    employeeId: string,
    zimmerId: number,
    zuordnungId?: number
  ) {
    setFehler(null);
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from("unterkunft_belegung")
      .insert({ zimmer_id: zimmerId, employee_id: employeeId, von: heuteIso() })
      .select("id")
      .single();
    if (error) {
      setFehler(error.message);
      return;
    }
    if (zuordnungId != null) {
      await sb
        .from("unterkunft_zuordnung")
        .update({
          status: "erledigt",
          belegung_id: (data as { id: number }).id,
          updated_by: profile?.id ?? null,
        })
        .eq("id", zuordnungId);
    }
    setDirekt(null);
    await laden();
  }

  // Belegen-Modus: „Person in der Hand" auf ein Zimmer setzen.
  async function belegenAufZimmer(z: UnterkunftZimmerUebersicht) {
    if (!handPerson || z.art !== "zimmer" || !z.aktiv || z.gesperrt) return;
    const p = handPerson;
    setHandPerson(null);
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_belegung")
      .insert({
        zimmer_id: z.zimmer_id,
        employee_id: p.employee_id,
        von: heuteIso(),
      });
    if (error) {
      setFehler(error.message);
      return;
    }
    setHinweis(
      `${p.vorname} ${p.name} → ${z.nummer}${
        z.frei <= 0 ? " (Überbuchung!)" : ""
      }`
    );
    await laden();
  }

  // Gruppen-Einzug: alle markierten Personen in ein Zimmer einziehen. Kommt
  // eine Person aus einer geplanten Zuordnung, wird die auf „erledigt"
  // gesetzt.
  async function einzugBestaetigen(z: UnterkunftZimmerUebersicht) {
    const ids = [...einzugWahl];
    if (ids.length === 0 || z.art !== "zimmer") return;
    setFehler(null);
    const sb = getSupabaseClient();
    const zuordnungVon = new Map(
      geplanteImGebaeude.map((g) => [g.employee_id, g.id])
    );
    const { data, error } = await sb
      .from("unterkunft_belegung")
      .insert(
        ids.map((eid) => ({
          zimmer_id: z.zimmer_id,
          employee_id: eid,
          von: heuteIso(),
        }))
      )
      .select("id, employee_id");
    if (error) {
      setFehler(error.message);
      return;
    }
    for (const r of (data as { id: number; employee_id: string }[]) ?? []) {
      const zid = zuordnungVon.get(r.employee_id);
      if (zid != null)
        await sb
          .from("unterkunft_zuordnung")
          .update({
            status: "erledigt",
            belegung_id: r.id,
            updated_by: profile?.id ?? null,
          })
          .eq("id", zid);
    }
    setHinweis(
      `${ids.length} Person(en) → Zimmer ${z.nummer}${
        z.frei < ids.length ? " (Überbuchung!)" : ""
      }`
    );
    setEinzugWahl(new Set());
    setEinzugZiel(null);
    await laden();
  }

  // Mangel direkt im Zimmer-Panel anlegen (admin/hr/hausmeister). Danach
  // erscheint er in der aufklappbaren Liste, wo auch Fotos möglich sind.
  async function mangelAnlegen(zimmerId: number) {
    if (!neuerMangel || !neuerMangel.beschreibung.trim()) {
      setFehler("Bitte eine Beschreibung eingeben.");
      return;
    }
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_mangel")
      .insert({
        zimmer_id: zimmerId,
        beschreibung: neuerMangel.beschreibung.trim(),
        schwere: neuerMangel.schwere,
        kategorie: neuerMangel.kategorie,
      });
    if (error) {
      setFehler(error.message);
      return;
    }
    setNeuerMangel(null);
    setMaengelAuf(true);
    await laden();
  }

  // Status eines offenen Mangels direkt aus dem Zimmer-Panel setzen.
  async function mangelStatusSetzen(
    m: UnterkunftMangel,
    status: UnterkunftMangelStatus
  ) {
    setFehler(null);
    const jetztBehoben = status === "behoben";
    const { error } = await getSupabaseClient()
      .from("unterkunft_mangel")
      .update({
        status,
        updated_by: profile?.id ?? null,
        ...(jetztBehoben
          ? {
              behoben_von: profile?.id ?? null,
              behoben_am: new Date().toISOString(),
            }
          : {}),
      })
      .eq("id", m.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
  }

  // Zur Orientierung: platzierte Zimmer der ANDEREN Wohneinheiten derselben
  // Etage (gleiches Gebäude, gleiches etage_label) - ausgegraut, nicht
  // anklickbar. Nur wenn die Wohneinheit ein Etage-Label trägt.
  const nachbarZimmer = useMemo(() => {
    if (!einheit || !einheit.etage_label) return [];
    const sibIds = new Set(
      einheiten
        .filter(
          (e) =>
            e.gebaeude_id === einheit.gebaeude_id &&
            e.etage_label === einheit.etage_label &&
            e.wohneinheit_id !== einheit.wohneinheit_id
        )
        .map((e) => e.wohneinheit_id)
    );
    return zimmer.filter(
      (z) =>
        z.wohneinheit_id != null &&
        sibIds.has(z.wohneinheit_id) &&
        z.plan_x != null &&
        z.plan_y != null &&
        z.aktiv
    );
  }, [einheit, einheiten, zimmer]);

  const rasterZimmer = [...platziert, ...nachbarZimmer];
  // Nur im Bearbeiten-Modus das großzügige Mindestraster (Platz zum Ziehen).
  // Sonst das Raster eng an den Inhalt legen + eine Zelle Rand - sonst
  // rendert eine 3-Zimmer-Wohneinheit ein fast leeres 14×10-Feld
  // (Nutzer-Vorgabe 2026-09-01: „weiße Bereiche 3× so groß wie der Inhalt").
  const inhaltCols = rasterZimmer.length
    ? Math.max(...rasterZimmer.map((z) => (z.plan_x ?? 0) + z.plan_w + 1))
    : 0;
  const inhaltRows = rasterZimmer.length
    ? Math.max(...rasterZimmer.map((z) => (z.plan_y ?? 0) + z.plan_h + 1))
    : 0;
  const cols = bearbeiten
    ? Math.max(MIN_COLS, inhaltCols)
    : Math.max(6, inhaltCols + 1);
  const rows = bearbeiten
    ? Math.max(MIN_ROWS, inhaltRows)
    : Math.max(4, inhaltRows + 1);

  // SVG auf Container-Breite einpassen, wenn er sonst überliefe (schmaler
  // Schirm). Auf breiten Schirmen unverändert native Größe.
  const planInhaltPx = cols * Z;
  const planPasstEin = planBreite > 0 && planBreite < planInhaltPx;
  const planW = (planPasstEin ? planBreite : planInhaltPx) * zoom;
  const planH = planW * (rows / cols);

  const sel =
    selId != null ? zimmer.find((z) => z.zimmer_id === selId) ?? null : null;

  const speicherePlan = useCallback(
    async (
      zimmerId: number,
      patch: Partial<
        Pick<UnterkunftZimmerUebersicht, "plan_x" | "plan_y" | "plan_w" | "plan_h">
      >
    ) => {
      setZimmer((prev) =>
        prev.map((z) => (z.zimmer_id === zimmerId ? { ...z, ...patch } : z))
      );
      const { error } = await getSupabaseClient()
        .from("unterkunft_zimmer")
        .update({ ...patch, updated_by: profile?.id ?? null })
        .eq("id", zimmerId);
      if (error) {
        setFehler(error.message);
        laden();
      } else {
        setFehler(null);
      }
    },
    [profile?.id, laden]
  );

  function freieZelle(): { x: number; y: number } {
    const belegt = new Set(
      rasterZimmer.flatMap((z) => {
        const cells: string[] = [];
        for (let x = z.plan_x!; x < z.plan_x! + z.plan_w; x++)
          for (let y = z.plan_y!; y < z.plan_y! + z.plan_h; y++)
            cells.push(`${x},${y}`);
        return cells;
      })
    );
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (!belegt.has(`${x},${y}`)) return { x, y };
    return { x: 0, y: 0 };
  }

  function platziereAusAblage(zimmerId: number) {
    const ziel = freieZelle();
    speicherePlan(zimmerId, { plan_x: ziel.x, plan_y: ziel.y });
    setSelId(zimmerId);
  }

  // Küche / Bad/WC / Flur als eigenen Raumtyp anlegen und direkt auf eine
  // freie Rasterzelle legen. Keine Betten, keine Belegung/Übergabe -
  // Kontrollen und Mängel gelten aber.
  async function gemeinschaftHinzufuegen(
    label: string,
    art: UnterkunftZimmerArt
  ) {
    if (!einheitId || gebaeudeId == null) return;
    const vorhanden = new Set(
      zimmer.filter((z) => z.gebaeude_id === gebaeudeId).map((z) => z.nummer)
    );
    let name = label;
    let i = 2;
    while (vorhanden.has(name)) name = `${label} ${i++}`;
    const ziel = freieZelle();
    const { data, error } = await getSupabaseClient()
      .from("unterkunft_zimmer")
      .insert({
        gebaeude_id: gebaeudeId,
        wohneinheit_id: einheitId,
        nummer: name,
        art,
        plan_x: ziel.x,
        plan_y: ziel.y,
        plan_w: 2,
        plan_h: 2,
      })
      .select("id")
      .single();
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
    setSelId((data as { id: number }).id);
  }

  async function zimmerLoeschen(z: UnterkunftZimmerUebersicht) {
    if (
      !window.confirm(
        `„${raumName(z)}" endgültig löschen – samt evtl. Kontrollen und Mängeln?`
      )
    )
      return;
    const sb = getSupabaseClient();
    // Abgeschlossene Vorgänge sind trigger-geschützt: als Admin erst „öffnen",
    // dann löschen (kaskadiert Positionen + Fotos), dann die Mängel.
    const { data: vg } = await sb
      .from("unterkunft_vorgang")
      .select("id, abgeschlossen")
      .eq("zimmer_id", z.zimmer_id);
    const abg = ((vg as { id: string; abgeschlossen: boolean }[]) ?? [])
      .filter((v) => v.abgeschlossen)
      .map((v) => v.id);
    if (abg.length) {
      const { error } = await sb
        .from("unterkunft_vorgang")
        .update({ abgeschlossen: false })
        .in("id", abg);
      if (error) {
        setFehler(error.message);
        return;
      }
    }
    for (const t of ["unterkunft_vorgang", "unterkunft_mangel"] as const) {
      const { error } = await sb.from(t).delete().eq("zimmer_id", z.zimmer_id);
      if (error) {
        setFehler(error.message);
        return;
      }
    }
    const { error } = await sb
      .from("unterkunft_zimmer")
      .delete()
      .eq("id", z.zimmer_id);
    if (error) {
      setFehler(error.message);
      return;
    }
    setSelId(null);
    await laden();
  }

  // Auswahl per echtem Klick (zuverlässiger als pointerdown im scrollenden
  // Plan-Container, wo ein kurzer Tipp sonst als Scroll verschluckt wird und
  // man die Kachel „lange drücken" musste - Nutzer-Vorgabe 2026-09-01).
  function onZimmerWaehlen(z: UnterkunftZimmerUebersicht) {
    if (gruppenEinzug) {
      if (z.art !== "zimmer" || !z.aktiv || z.gesperrt) {
        setHinweis("Bitte ein aktives, nicht gesperrtes Zimmer wählen.");
        return;
      }
      if (einzugWahl.size === 0) {
        setHinweis("Erst Personen markieren, dann das Zimmer.");
        return;
      }
      setEinzugZiel(z);
      return;
    }
    if (belegen) {
      if (handPerson) belegenAufZimmer(z);
      else setHinweis("Erst eine Person antippen, dann das Zimmer.");
      return;
    }
    setSelId(z.zimmer_id);
  }

  // Nur im Bearbeiten-Modus verdrahtet (Kacheln ziehen).
  function onZimmerPointerDown(
    e: React.PointerEvent,
    z: UnterkunftZimmerUebersicht
  ) {
    setSelId(z.zimmer_id);
    if (!canEditPlan || e.button !== 0) return;
    if (z.plan_x == null || z.plan_y == null) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({
      zimmerId: z.zimmer_id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: z.plan_x,
      origY: z.plan_y,
      aktX: z.plan_x,
      aktY: z.plan_y,
    });
  }

  function onZimmerPointerMove(
    e: React.PointerEvent,
    z: UnterkunftZimmerUebersicht
  ) {
    if (!drag || drag.zimmerId !== z.zimmer_id) return;
    const pxProZelle = Z * zoom;
    const dx = Math.round((e.clientX - drag.startX) / pxProZelle);
    const dy = Math.round((e.clientY - drag.startY) / pxProZelle);
    const nx = Math.max(0, Math.min(cols - z.plan_w, drag.origX + dx));
    const ny = Math.max(0, Math.min(rows - z.plan_h, drag.origY + dy));
    if (nx !== drag.aktX || ny !== drag.aktY) {
      setDrag({ ...drag, aktX: nx, aktY: ny });
    }
  }

  function onZimmerPointerUp(
    e: React.PointerEvent,
    z: UnterkunftZimmerUebersicht
  ) {
    if (!drag || drag.zimmerId !== z.zimmer_id) return;
    (e.currentTarget as Element).releasePointerCapture(drag.pointerId);
    const { aktX, aktY, origX, origY } = drag;
    setDrag(null);
    if (aktX !== origX || aktY !== origY) {
      speicherePlan(z.zimmer_id, { plan_x: aktX, plan_y: aktY });
    }
  }

  function onWrapKeyDown(e: React.KeyboardEvent) {
    if (!bearbeiten || !canEditPlan || !sel) return;
    if (sel.plan_x == null || sel.plan_y == null) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const s = step[e.key];
    if (!s) return;
    e.preventDefault();
    const nx = Math.max(0, Math.min(cols - sel.plan_w, sel.plan_x + s[0]));
    const ny = Math.max(0, Math.min(rows - sel.plan_h, sel.plan_y + s[1]));
    if (nx !== sel.plan_x || ny !== sel.plan_y) {
      speicherePlan(sel.zimmer_id, { plan_x: nx, plan_y: ny });
    }
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-4">
      <UnterkunftTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Immobilien</h1>
          <p className="text-sm text-neutral-500">
            Wohneinheit wählen → Zimmer antippen. „Belegen": Person antippen,
            dann Zimmer antippen.
          </p>
        </div>
      </div>

      {/* Gebäude-Auswahl als Karten (Betten/fest/geplant/frei + Herkunfts-Mix,
          wie die Wohneinheiten). Bei offener Wohneinheit zu einer
          Brotkrumen-Zeile eingeklappt (Nutzer-Vorgabe 2026-09-01). */}
      {einheit && !uebersichtAuf ? (
        <button
          onClick={() => setUebersichtAuf(true)}
          className="flex flex-wrap items-center gap-1.5 text-sm text-neutral-600"
        >
          <span className="font-medium text-emerald-800">
            {gebaeude.find((g) => g.id === gebaeudeId)?.name ?? "Gebäude"}
          </span>
          {einheit.etage_label && (
            <>
              <span className="text-neutral-300">›</span>
              <span>{einheit.etage_label}</span>
            </>
          )}
          <span className="text-neutral-300">›</span>
          <span className="font-medium text-emerald-800">{einheit.name}</span>
          <span className="ml-1 rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-emerald-700">
            ändern
          </span>
        </button>
      ) : (
        gebaeude.length > 0 && (
          <div className="space-y-3">
            {einheit && (
              <button
                onClick={() => setUebersichtAuf(false)}
                className="text-sm text-emerald-700 underline"
              >
                ▾ Auswahl einklappen
              </button>
            )}
            {gebaeudeId != null && !gebWahlAuf ? (
              <button
                onClick={() => setGebWahlAuf(true)}
                className="flex flex-wrap items-center gap-1.5 text-sm text-neutral-600"
              >
                <span className="font-medium text-emerald-800">
                  {gebaeude.find((g) => g.id === gebaeudeId)?.name ?? "Gebäude"}
                </span>
                <span className="ml-1 rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-emerald-700">
                  Gebäude wechseln
                </span>
              </button>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {gebaeude.map((g) => {
                const st = statsProGebaeude[g.id] ?? {
                  betten: 0,
                  fest: 0,
                  geplant: 0,
                  frei: 0,
                  gesperrt: 0,
                  ueber: 0,
                };
                const personen = personenProGebaeude[g.id] ?? [];
                const aktiv = g.id === gebaeudeId;
                return (
                  <button
                    key={g.id}
                    onClick={() => {
                      setGebaeudeId(g.id);
                      setGebWahlAuf(false);
                      setEinheitId(null);
                      setSelId(null);
                      setEtageFilter("");
                      setUebersichtAuf(true);
                    }}
                    className={`rounded border p-3 text-left ${
                      aktiv
                        ? "border-emerald-700 ring-1 ring-emerald-700"
                        : "border-neutral-200 hover:border-emerald-400"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-emerald-900">
                        {g.name}
                        {!g.aktiv ? " (inaktiv)" : ""}
                      </span>
                      {st.ueber > 0 && (
                        <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                          +{st.ueber} über
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm tabular-nums">
                      <span>{st.betten} Betten</span>
                      <span className="text-emerald-700">{st.fest} fest</span>
                      <span className="text-amber-700">{st.geplant} geplant</span>
                      <span
                        className={
                          st.frei > 0 ? "text-emerald-700" : "text-neutral-400"
                        }
                      >
                        {st.frei} frei
                      </span>
                      {st.gesperrt > 0 && (
                        <span className="text-slate-600">🔒 {st.gesperrt}</span>
                      )}
                    </div>
                    {personen.length > 0 && (
                      <div className="mt-1 text-xs text-neutral-500">
                        {herkunftMix(personen)}
                      </div>
                    )}
                  </button>
                );
              })}
              </div>
            )}
          </div>
        )
      )}

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}
      {hinweis && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {hinweis}{" "}
          <button
            className="ml-2 text-xs underline"
            onClick={() => setHinweis(null)}
          >
            ok
          </button>
        </p>
      )}

      {/* Etage-Umschalter */}
      {(!einheit || uebersichtAuf) && etagen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {["", ...etagen].map((et) => (
            <button
              key={et || "alle"}
              onClick={() => {
                setEtageFilter(et);
                setEinheitId(null);
                setSelId(null);
              }}
              className={`rounded-full border px-3 py-1 text-sm ${
                et === etageFilter
                  ? "border-emerald-700 bg-emerald-700 font-semibold text-white"
                  : "border-neutral-300 text-neutral-600 hover:border-emerald-400"
              }`}
            >
              {et || "Alle"}
            </button>
          ))}
        </div>
      )}

      {einheitenDesGebaeudes.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Für dieses Gebäude sind noch keine Wohneinheiten angelegt – unter{" "}
          <Link href="/unterkunft/stammdaten" className="text-emerald-700 underline">
            Stammdaten
          </Link>{" "}
          beginnen.
        </p>
      ) : (
        <>
          {(!einheit || uebersichtAuf) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {gefilterteEinheiten.map((e) => {
            const personen = [
              ...belegungen.filter((b) => b.wohneinheit_id === e.wohneinheit_id),
              ...zuordnungen.filter((z) => z.wohneinheit_id === e.wohneinheit_id),
            ];
            const s = statsProEinheit[e.wohneinheit_id] ?? {
              betten: e.betten,
              fest: e.fest,
              geplant: e.geplant,
              frei: e.frei,
              gesperrt: 0,
            };
            const aktiv = e.wohneinheit_id === einheitId;
            return (
              <button
                key={e.wohneinheit_id}
                onClick={() => {
                  setEinheitId(aktiv ? null : e.wohneinheit_id);
                  setSelId(null);
                  if (!aktiv) setUebersichtAuf(false);
                }}
                className={`rounded border p-3 text-left ${
                  aktiv
                    ? "border-emerald-700 ring-1 ring-emerald-700"
                    : "border-neutral-200 hover:border-emerald-400"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-emerald-900">{e.name}</span>
                  {e.etage_label && (
                    <span className="text-xs text-neutral-500">{e.etage_label}</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                  <span>{s.betten} Betten</span>
                  <span className="text-emerald-700">{s.fest} fest</span>
                  <span className="text-amber-700">{s.geplant} geplant</span>
                  <span className={s.frei > 0 ? "text-emerald-700" : "text-neutral-400"}>
                    {s.frei} frei
                  </span>
                  {s.gesperrt > 0 && (
                    <span className="text-slate-600">🔒 {s.gesperrt}</span>
                  )}
                </div>
                {personen.length > 0 && (
                  <div className="mt-1 text-xs text-neutral-500">
                    {herkunftMix(personen)}
                  </div>
                )}
                {e.geplant > 0 && (
                  <div className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    {e.geplant} geplant
                  </div>
                )}
              </button>
            );
          })}
        </div>
          )}
        </>
      )}

      {/* Wohneinheit-Detail: Zimmer-Raster + offene Personen */}
      {einheit && (
        <div
          ref={einheitDetailRef}
          className="space-y-3 rounded border border-neutral-200 p-3"
          style={{
            scrollMarginTop: "calc(3.5rem + var(--subtabs-h, 2.5rem) + 0.5rem)",
          }}
        >
          {/* Klebende Steuerleiste: Wohneinheit wechseln + Ansicht + Zoom,
              bleibt beim Scrollen im (großen) Plan stehen. */}
          <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 -mx-3 -mt-3 mb-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 bg-white px-3 py-2 text-sm">
            <div className="flex items-center gap-1">
              <button
                className="btn-secondary"
                title="Vorige Wohneinheit"
                disabled={
                  gefilterteEinheiten.findIndex(
                    (e) => e.wohneinheit_id === einheitId
                  ) <= 0
                }
                onClick={() => {
                  const i = gefilterteEinheiten.findIndex(
                    (e) => e.wohneinheit_id === einheitId
                  );
                  if (i > 0) {
                    setEinheitId(gefilterteEinheiten[i - 1].wohneinheit_id);
                    setSelId(null);
                  }
                }}
              >
                ‹
              </button>
              <select
                className="max-w-[12rem]"
                value={einheitId ?? ""}
                onChange={(e) => {
                  setEinheitId(Number(e.target.value));
                  setSelId(null);
                }}
              >
                {gefilterteEinheiten.map((e) => (
                  <option key={e.wohneinheit_id} value={e.wohneinheit_id}>
                    {e.name}
                    {e.etage_label ? ` · ${e.etage_label}` : ""}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary"
                title="Nächste Wohneinheit"
                disabled={
                  gefilterteEinheiten.findIndex(
                    (e) => e.wohneinheit_id === einheitId
                  ) >=
                  gefilterteEinheiten.length - 1
                }
                onClick={() => {
                  const i = gefilterteEinheiten.findIndex(
                    (e) => e.wohneinheit_id === einheitId
                  );
                  if (i >= 0 && i < gefilterteEinheiten.length - 1) {
                    setEinheitId(gefilterteEinheiten[i + 1].wohneinheit_id);
                    setSelId(null);
                  }
                }}
              >
                ›
              </button>
            </div>
            {/* Liste ↔ Grundriss. Telefon: immer; Hausmeister: auch am
                Desktop (er arbeitet mit der Liste). Sonst nur schmale Schirme. */}
            <div
              className={`flex overflow-hidden rounded border border-neutral-300 ${
                istHausmeister ? "" : "lg:hidden"
              }`}
            >
              {(["liste", "plan"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMobilAnsicht(m)}
                  className={`px-2 py-1 text-xs ${
                    m === mobilAnsicht
                      ? "bg-emerald-700 font-semibold text-white"
                      : "bg-white text-neutral-600"
                  }`}
                >
                  {m === "liste" ? "Liste" : "Grundriss"}
                </button>
              ))}
            </div>
            {canMove && (
              <button
                onClick={() => {
                  setBelegen((v) => !v);
                  setSelId(null);
                  setBearbeiten(false);
                  setGruppenEinzug(false);
                }}
                className={`rounded px-3 py-1 font-medium ${
                  belegen
                    ? "bg-emerald-700 text-white"
                    : "border border-emerald-600 text-emerald-700"
                }`}
              >
                {belegen ? "Belegen: an" : "Belegen"}
              </button>
            )}
            {canMove && (
              <button
                onClick={() => {
                  setGruppenEinzug((v) => !v);
                  setSelId(null);
                  setBearbeiten(false);
                  setBelegen(false);
                }}
                className={`rounded px-3 py-1 font-medium ${
                  gruppenEinzug
                    ? "bg-emerald-700 text-white"
                    : "border border-emerald-600 text-emerald-700"
                }`}
              >
                {gruppenEinzug ? "Gruppen-Einzug: an" : "Gruppen-Einzug"}
              </button>
            )}
            {/* Grundriss-Farbmodi + Zoom/Bearbeiten: für Hausmeister aus
                (Nutzer-Vorgabe 2026-09-01). */}
            {!istHausmeister && (
              <>
                <div className="flex overflow-hidden rounded border border-neutral-300">
                  {(Object.keys(ANSICHT_LABELS) as Ansicht[]).map((a) => (
                    <button
                      key={a}
                      onClick={() => setAnsicht(a)}
                      className={`px-2 py-1 text-xs ${
                        a === ansicht
                          ? "bg-emerald-700 font-semibold text-white"
                          : "bg-white text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      {ANSICHT_LABELS[a]}
                    </button>
                  ))}
                </div>
                <details
                  className="relative"
                  open={werkzeugeAuf}
                  onToggle={(e) =>
                    setWerkzeugeAuf((e.target as HTMLDetailsElement).open)
                  }
                >
                  <summary className="btn-secondary cursor-pointer list-none">
                    ⚙ Ansicht
                  </summary>
                  <div className="absolute right-0 z-10 mt-1 flex flex-col gap-2 rounded border border-neutral-200 bg-white p-2 shadow-lg">
                    <div className="flex items-center gap-1">
                      <button
                        className="btn-secondary"
                        onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                      >
                        −
                      </button>
                      <span className="w-10 text-center tabular-nums">
                        {Math.round(zoom * 100)}%
                      </span>
                      <button
                        className="btn-secondary"
                        onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
                      >
                        +
                      </button>
                    </div>
                    {canEditPlan && (
                      <label className="flex items-center gap-1 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={bearbeiten}
                          onChange={(e) => {
                            setBearbeiten(e.target.checked);
                            if (e.target.checked) setBelegen(false);
                          }}
                        />
                        Kacheln bearbeiten
                      </label>
                    )}
                  </div>
                </details>
              </>
            )}
          </div>

          <div>
            <h2 className="text-base font-semibold text-emerald-900">
              {einheit.name}
              {einheit.etage_label ? ` · ${einheit.etage_label}` : ""} — Zimmer
            </h2>
            {nachbarZimmer.length > 0 && !belegen && (
              <p className="text-xs text-neutral-400">
                Blasse, gestrichelte Kacheln = andere Wohneinheiten der Etage{" "}
                {einheit.etage_label} (nur zur Orientierung).
              </p>
            )}
          </div>

          {/* Belegen-Modus: Person antippen → Zimmer antippen */}
          {belegen && (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-emerald-900">
                  {handPerson
                    ? `„${handPerson.vorname} ${handPerson.name}" in der Hand – jetzt Zimmer antippen`
                    : "Person antippen, dann ein freies Zimmer antippen."}
                </span>
                {handPerson && (
                  <button
                    className="text-xs text-emerald-700 underline"
                    onClick={() => setHandPerson(null)}
                  >
                    loslassen
                  </button>
                )}
              </div>
              <input
                className="mt-2 w-full text-sm"
                placeholder="Person ohne Bleibe suchen (Name / Nr.)"
                value={belegenSuche}
                onChange={(e) => setBelegenSuche(e.target.value)}
              />
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {personenOffen
                  .filter((p) =>
                    `${p.vorname} ${p.name} ${p.personal_nr}`
                      .toLowerCase()
                      .includes(belegenSuche.trim().toLowerCase())
                  )
                  .slice(0, 40)
                  .map((p) => {
                    const inHand = handPerson?.employee_id === p.employee_id;
                    return (
                      <button
                        key={p.employee_id}
                        onClick={() =>
                          setHandPerson(inHand ? null : p)
                        }
                        className={`rounded-full border px-2.5 py-1 text-sm ${
                          inHand
                            ? "border-emerald-700 bg-emerald-700 font-semibold text-white"
                            : "border-emerald-300 bg-white text-emerald-800"
                        }`}
                      >
                        {p.vorname} {p.name}
                        {p.auf_anreiseliste ? " · Anreise" : ""}
                      </button>
                    );
                  })}
                {personenOffen.length === 0 && (
                  <span className="text-sm text-neutral-500">
                    niemand ohne Bleibe.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Gruppen-Einzug: mehrere Personen markieren → Zimmer antippen */}
          {gruppenEinzug && (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-emerald-900">
                  {einzugWahl.size > 0
                    ? `${einzugWahl.size} markiert – jetzt das Zimmer antippen`
                    : "Personen markieren, dann das Zimmer antippen."}
                </span>
                {einzugWahl.size > 0 && (
                  <button
                    className="text-xs text-emerald-700 underline"
                    onClick={() => setEinzugWahl(new Set())}
                  >
                    Auswahl leeren
                  </button>
                )}
                <span className="ml-auto flex overflow-hidden rounded border border-emerald-300">
                  {(
                    [
                      ["geplant", "Geplant"],
                      ["offen", "Ohne Bleibe"],
                      ["alle", "Alle"],
                    ] as const
                  ).map(([w, label]) => (
                    <button
                      key={w}
                      onClick={() => setEinzugQuelle(w)}
                      className={`px-2 py-0.5 text-xs ${
                        einzugQuelle === w
                          ? "bg-emerald-700 font-semibold text-white"
                          : "bg-white text-emerald-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
              <input
                className="mt-2 w-full text-sm"
                placeholder="Person suchen (Name)"
                value={einzugSuche}
                onChange={(e) => setEinzugSuche(e.target.value)}
              />
              <div className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {einzugPool.length === 0 && (
                  <span className="text-neutral-500">
                    {einzugQuelle === "geplant"
                      ? "keine geplanten Personen für dieses Gebäude."
                      : "niemand gefunden."}
                  </span>
                )}
                {einzugPool.slice(0, 80).map((p) => {
                  const drin = einzugWahl.has(p.employee_id);
                  return (
                    <button
                      key={p.employee_id}
                      onClick={() =>
                        setEinzugWahl((s) => {
                          const n = new Set(s);
                          n.has(p.employee_id)
                            ? n.delete(p.employee_id)
                            : n.add(p.employee_id);
                          return n;
                        })
                      }
                      className={`rounded-full border px-2.5 py-1 ${
                        drin
                          ? "border-emerald-700 bg-emerald-700 font-semibold text-white"
                          : "border-emerald-300 bg-white text-emerald-800"
                      }`}
                    >
                      {p.vorname} {p.name}
                      <span
                        className={
                          drin ? "text-emerald-100" : "text-neutral-400"
                        }
                      >
                        {" "}
                        · {p.hint}
                        {p.herkunft ? ` · ${p.herkunft}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              {einzugZiel && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-emerald-400 bg-white p-2">
                  <span className="font-medium text-emerald-900">
                    {einzugWahl.size} Person(en) → Zimmer {einzugZiel.nummer}
                    {einzugZiel.frei < einzugWahl.size
                      ? ` (nur ${einzugZiel.frei} frei – Überbuchung)`
                      : ""}
                    ?
                  </span>
                  <button
                    className="btn"
                    onClick={() => einzugBestaetigen(einzugZiel)}
                  >
                    Einzug bestätigen
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setEinzugZiel(null)}
                  >
                    Abbrechen
                  </button>
                </div>
              )}
            </div>
          )}

          {zimmerDerEinheit.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Noch keine Zimmer in dieser Wohneinheit – unter{" "}
              <Link
                href="/unterkunft/stammdaten"
                className="text-emerald-700 underline"
              >
                Stammdaten
              </Link>{" "}
              anlegen.
            </p>
          ) : (
            <>
              <div
                className={`${
                  mobilAnsicht === "plan" ? "flex" : "hidden"
                } flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 ${
                  istHausmeister ? "" : "lg:flex"
                }`}
              >
                {legendeFuer(ansicht).map((e) => (
                  <span key={e.label} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-3 w-3 rounded-sm border"
                      style={{ backgroundColor: e.fill, borderColor: e.stroke }}
                    />
                    {e.label}
                  </span>
                ))}
              </div>

              {/* Zimmer-Liste (Standard unter lg; für Hausmeister auch am
                  Desktop) */}
              <div
                className={`${
                  mobilAnsicht === "liste" ? "flex" : "hidden"
                } flex-col gap-1.5 ${istHausmeister ? "" : "lg:hidden"}`}
              >
                {[...zimmerDerEinheit]
                  .sort((a, b) => {
                    if ((a.art === "zimmer") !== (b.art === "zimmer"))
                      return a.art === "zimmer" ? -1 : 1;
                    return (a.nummer ?? "").localeCompare(b.nummer ?? "", "de", {
                      numeric: true,
                    });
                  })
                  .map((z) => {
                    // Flure sind nicht kontrollpflichtig (Vorgabe 2026-09-01).
                    const ampel =
                      z.art === "flur"
                        ? "keine"
                        : kontrollAmpel(
                            z.letzte_kontrolle_am,
                            schwellenVon(z.art)
                          );
                    const geplantListe = zuordnungProZimmer[z.zimmer_id] ?? [];
                    const bewohnerHier = belegungProZimmer[z.zimmer_id] ?? [];
                    const belegbar =
                      belegen &&
                      handPerson != null &&
                      z.art === "zimmer" &&
                      z.aktiv &&
                      !z.gesperrt;
                    const gedimmt =
                      belegen && handPerson != null && !belegbar;
                    return (
                      <button
                        key={z.zimmer_id}
                        onClick={() => onZimmerWaehlen(z)}
                        className={`flex items-start gap-3 rounded-lg border p-3 text-left ${
                          z.zimmer_id === selId
                            ? "border-emerald-600 bg-emerald-50"
                            : "border-neutral-200 bg-white"
                        } ${gedimmt ? "opacity-40" : ""}`}
                      >
                        <span
                          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: KONTROLL_AMPEL_FARBE[ampel] }}
                          title={KONTROLL_AMPEL_LABELS[ampel]}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-neutral-900">
                              {z.art === "zimmer"
                                ? `Zimmer ${z.nummer}`
                                : raumName(z)}
                              {z.gesperrt ? " · 🔒" : ""}
                              {!z.aktiv ? " · inaktiv" : ""}
                            </span>
                            {z.art === "zimmer" && (
                              <span
                                className={`shrink-0 text-sm font-semibold tabular-nums ${
                                  z.frei > 0
                                    ? "text-emerald-600"
                                    : "text-neutral-400"
                                }`}
                                title="freie Betten / Betten gesamt"
                              >
                                {z.frei}/{z.betten}
                              </span>
                            )}
                          </span>
                          {bewohnerHier.map((b) => (
                            <span
                              key={b.id}
                              className="mt-0.5 block text-xs text-neutral-700"
                            >
                              {b.vorname} {b.name}
                              {b.herkunft ? (
                                <span className="text-neutral-400">
                                  {" "}
                                  · {b.herkunft}
                                </span>
                              ) : null}
                            </span>
                          ))}
                          {geplantListe.map((g) => (
                            <span
                              key={g.id}
                              className="mt-0.5 block text-xs text-amber-700"
                            >
                              {g.vorname} {g.name}
                              {g.herkunft ? (
                                <span className="text-amber-500">
                                  {" "}
                                  · {g.herkunft}
                                </span>
                              ) : null}
                              {" · geplant"}
                            </span>
                          ))}
                        </span>
                        {z.offene_maengel > 0 && (
                          <span className="shrink-0 self-center rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                            {z.offene_maengel} Mangel
                          </span>
                        )}
                        <span className="shrink-0 self-center text-neutral-300">
                          ›
                        </span>
                      </button>
                    );
                  })}
              </div>

              <div className="flex flex-col gap-4 lg:flex-row">
              <div
                ref={planRef}
                tabIndex={0}
                onKeyDown={onWrapKeyDown}
                className={`max-w-full flex-1 overflow-auto rounded border border-neutral-200 bg-white p-2 outline-none ${
                  mobilAnsicht === "plan"
                    ? ""
                    : istHausmeister
                      ? "hidden"
                      : "hidden lg:block"
                }`}
              >
                <svg
                  width={planW}
                  height={planH}
                  viewBox={`0 0 ${cols * Z} ${rows * Z}`}
                  className="block"
                  style={{ touchAction: bearbeiten ? "none" : "auto" }}
                >
                  <defs>
                    <pattern
                      id="raster"
                      width={Z}
                      height={Z}
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d={`M ${Z} 0 L 0 0 0 ${Z}`}
                        fill="none"
                        stroke="#f0f0f0"
                        strokeWidth={1}
                      />
                    </pattern>
                  </defs>
                  <rect width={cols * Z} height={rows * Z} fill="url(#raster)" />

                  {/* Nachbar-Wohneinheiten derselben Etage - nur Orientierung */}
                  {nachbarZimmer.map((z) => (
                    <g
                      key={`nachbar-${z.zimmer_id}`}
                      transform={`translate(${z.plan_x! * Z} ${z.plan_y! * Z})`}
                      style={{ pointerEvents: "none" }}
                      opacity={0.4}
                    >
                      <rect
                        width={z.plan_w * Z}
                        height={z.plan_h * Z}
                        rx={5}
                        fill={
                          zimmerFarbe(
                            z,
                            ansicht,
                            dominantProZimmer[z.zimmer_id] ?? null,
                            schwellenVon(z.art)
                          ).fill
                        }
                        stroke="#cbd5e1"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <text
                        x={(z.plan_w * Z) / 2}
                        y={(z.plan_h * Z) / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="select-none"
                        fontSize={11}
                        fill="#94a3b8"
                      >
                        {raumName(z)}
                      </text>
                      <text
                        x={(z.plan_w * Z) / 2}
                        y={z.plan_h * Z - 5}
                        textAnchor="middle"
                        className="select-none"
                        fontSize={8}
                        fill="#94a3b8"
                      >
                        {einheiten.find((e) => e.wohneinheit_id === z.wohneinheit_id)
                          ?.name ?? ""}
                      </text>
                    </g>
                  ))}

                  {platziert.map((z) => {
                    const wirdGezogen = drag?.zimmerId === z.zimmer_id;
                    const px = (wirdGezogen ? drag!.aktX : z.plan_x!) * Z;
                    const py = (wirdGezogen ? drag!.aktY : z.plan_y!) * Z;
                    const w = z.plan_w * Z;
                    const h = z.plan_h * Z;
                    const { fill, stroke } = zimmerFarbe(
                      z,
                      ansicht,
                      dominantProZimmer[z.zimmer_id] ?? null,
                      schwellenVon(z.art)
                    );
                    const ausgewaehlt = z.zimmer_id === selId;
                    const ampel =
                      z.art === "flur"
                        ? "keine"
                        : kontrollAmpel(
                            z.letzte_kontrolle_am,
                            schwellenVon(z.art)
                          );
                    const geplantHier =
                      (zuordnungProZimmer[z.zimmer_id] ?? []).length;
                    // Belegen-Modus: mit „Person in der Hand" sind belegbare
                    // Zimmer hervorgehoben, alles andere gedimmt.
                    const belegbar =
                      belegen &&
                      handPerson != null &&
                      z.art === "zimmer" &&
                      z.aktiv &&
                      !z.gesperrt;
                    const gedimmt =
                      belegen && handPerson != null && !belegbar;
                    return (
                      <g
                        key={z.zimmer_id}
                        transform={`translate(${px} ${py})`}
                        onClick={
                          bearbeiten && canEditPlan
                            ? undefined
                            : () => onZimmerWaehlen(z)
                        }
                        onPointerDown={
                          bearbeiten && canEditPlan
                            ? (e) => onZimmerPointerDown(e, z)
                            : undefined
                        }
                        onPointerMove={
                          bearbeiten && canEditPlan
                            ? (e) => onZimmerPointerMove(e, z)
                            : undefined
                        }
                        onPointerUp={
                          bearbeiten && canEditPlan
                            ? (e) => onZimmerPointerUp(e, z)
                            : undefined
                        }
                        opacity={gedimmt ? 0.35 : 1}
                        style={{
                          cursor: bearbeiten && canEditPlan ? "move" : "pointer",
                        }}
                      >
                        <rect
                          width={w}
                          height={h}
                          rx={5}
                          fill={fill}
                          stroke={
                            belegbar
                              ? "#047857"
                              : ausgewaehlt
                                ? "#047857"
                                : stroke
                          }
                          strokeWidth={
                            belegbar || ausgewaehlt
                              ? 3
                              : z.offene_maengel > 0
                                ? 2
                                : 1.5
                          }
                          strokeDasharray={z.aktiv ? undefined : "4 3"}
                        />
                        {belegbar && (
                          <text
                            x={w - 10}
                            y={h - 7}
                            textAnchor="end"
                            fontSize={14}
                            fontWeight={700}
                            fill="#047857"
                            className="select-none"
                          >
                            ＋
                          </text>
                        )}
                        <text
                          x={w / 2}
                          y={h / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="select-none"
                          fontSize={Math.min(15, h / 2.2)}
                          fontWeight={600}
                          fill={z.aktiv ? "#0f172a" : "#a3a3a3"}
                        >
                          {raumName(z)}
                        </text>
                        {z.gesperrt ? (
                          <text
                            x={w / 2}
                            y={h - 6}
                            textAnchor="middle"
                            className="select-none"
                            fontSize={10}
                            fill="#475569"
                          >
                            🔒 gesperrt
                          </text>
                        ) : z.art === "zimmer" ? (
                          <text
                            x={w / 2}
                            y={h - 6}
                            textAnchor="middle"
                            className="select-none"
                            fontSize={10}
                            fill="#64748b"
                          >
                            {z.belegt}/{z.betten}
                            {geplantHier > 0 ? ` +${geplantHier}` : ""}
                          </text>
                        ) : null}
                        <circle
                          cx={w - 9}
                          cy={9}
                          r={5}
                          fill={KONTROLL_AMPEL_FARBE[ampel]}
                          stroke="#fff"
                          strokeWidth={1.5}
                        />
                        {z.offene_maengel > 0 && (
                          <text
                            x={7}
                            y={13}
                            fontSize={10}
                            fontWeight={700}
                            fill="#dc2626"
                            className="select-none"
                          >
                            {z.offene_maengel} M
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="w-full shrink-0 space-y-4 lg:w-80">
                {/* noch offen (geplante Personen dieser Wohneinheit) */}
                <div className="rounded border border-neutral-200 p-3">
                  <h3 className="text-sm font-semibold text-neutral-800">
                    Noch offen ({zuordnungDerEinheit.length})
                  </h3>
                  {zuordnungDerEinheit.length === 0 ? (
                    <p className="mt-1 text-sm text-neutral-400">
                      keine geplanten Zuordnungen.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {zuordnungDerEinheit.map((z) => (
                        <li key={z.id} className="flex justify-between gap-2">
                          <span>
                            {z.vorname} {z.name}
                            {z.herkunft ? (
                              <span className="text-neutral-400"> · {z.herkunft}</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-neutral-500">
                            {z.zimmer_nummer
                              ? `Zi. ${z.zimmer_nummer}`
                              : "kein Zimmer"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {bearbeiten && canEditPlan && (
                  <div className="rounded border border-neutral-200 p-3">
                    <h3 className="text-sm font-semibold text-neutral-800">
                      Nicht platziert ({ablage.length})
                    </h3>
                    {ablage.length === 0 ? (
                      <p className="mt-1 text-sm text-neutral-400">
                        alle Zimmer liegen im Raster.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ablage.map((z) => (
                          <button
                            key={z.zimmer_id}
                            onClick={() => platziereAusAblage(z.zimmer_id)}
                            className="rounded border border-neutral-300 px-2 py-0.5 text-sm hover:border-emerald-500"
                          >
                            {raumName(z)}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-neutral-400">
                      Zimmer ziehen · Pfeiltasten für Feinjustage.
                    </p>
                    <div className="mt-2 border-t border-neutral-100 pt-2">
                      <div className="text-xs font-medium text-neutral-500">
                        Weiteren Raum hinzufügen
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {(
                          [
                            { label: "Küche", art: "kueche" },
                            { label: "Bad", art: "bad" },
                            { label: "WC", art: "wc" },
                            { label: "Flur", art: "flur" },
                          ] as const
                        ).map(({ label, art }) => {
                          const s = RAUM_STYLE[art];
                          return (
                            <button
                              key={art}
                              onClick={() => gemeinschaftHinzufuegen(label, art)}
                              className="rounded border px-2 py-0.5 text-sm hover:brightness-95"
                              style={{
                                borderColor: s.stroke,
                                backgroundColor: s.fill,
                                color: "#1f2937",
                              }}
                            >
                              + {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {sel && sel.wohneinheit_id === einheitId && (
                  <div
                    className="fixed inset-0 z-30 bg-black/25 lg:hidden"
                    onClick={() => setSelId(null)}
                  />
                )}
                {sel && sel.wohneinheit_id === einheitId ? (
                  <div className="fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-neutral-300 bg-white p-3 shadow-2xl lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded lg:border-neutral-200 lg:shadow-none">
                    <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-300 lg:hidden" />
                    <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-1 flex items-center justify-between border-b border-neutral-100 bg-white px-3 py-2 lg:static lg:mx-0 lg:mt-0 lg:border-0 lg:p-0">
                      <h3 className="text-base font-semibold text-emerald-900">
                        {sel.art === "zimmer"
                          ? `Zimmer ${sel.nummer}`
                          : raumName(sel)}
                      </h3>
                      <button
                        className="text-sm text-neutral-500 lg:hidden"
                        onClick={() => setSelId(null)}
                      >
                        ✕ Schließen
                      </button>
                    </div>
                    {!sel.aktiv && <p className="text-xs text-red-600">inaktiv</p>}

                    <dl className="mt-2 space-y-1 text-sm">
                      {sel.art === "zimmer" && (
                        <div className="flex justify-between">
                          <dt className="text-neutral-500">Betten</dt>
                          <dd>
                            {sel.belegt} / {sel.betten} ·{" "}
                            <span
                              className={
                                sel.frei > 0
                                  ? "font-medium text-emerald-700"
                                  : ""
                              }
                            >
                              {sel.frei} frei
                            </span>
                          </dd>
                        </div>
                      )}
                      {sel.art !== "flur" && (
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">Letzte Kontrolle</dt>
                        <dd className="text-right">
                          {sel.letzte_kontrolle_am ? (
                            <>
                              {formatDatumDE(sel.letzte_kontrolle_am)}
                              {sel.letzte_kontrolle_typ
                                ? ` · ${UNTERKUNFT_VORGANG_TYP_LABELS[sel.letzte_kontrolle_typ]}`
                                : ""}
                            </>
                          ) : (
                            "noch keine"
                          )}
                          <span
                            className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
                            style={{
                              backgroundColor:
                                KONTROLL_AMPEL_FARBE[
                                  kontrollAmpel(
                                    sel.letzte_kontrolle_am,
                                    schwellenVon(sel.art)
                                  )
                                ],
                            }}
                            title={
                              KONTROLL_AMPEL_LABELS[
                                kontrollAmpel(
                                  sel.letzte_kontrolle_am,
                                  schwellenVon(sel.art)
                                )
                              ]
                            }
                          />
                          {schwellenVon(sel.art) && (
                            <span className="block text-xs text-neutral-400">
                              grün ≤ {schwellenVon(sel.art)!.gruen} T · gelb ≤{" "}
                              {schwellenVon(sel.art)!.gelb} T
                            </span>
                          )}
                        </dd>
                      </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">Offene Mängel</dt>
                        <dd
                          className={
                            sel.offene_maengel > 0
                              ? "font-medium text-red-600"
                              : ""
                          }
                        >
                          {sel.offene_maengel > 0 ? (
                            <button
                              className="underline decoration-dotted underline-offset-2"
                              onClick={() => setMaengelAuf((v) => !v)}
                            >
                              {sel.offene_maengel} · {maengelAuf ? "ausblenden" : "Details anzeigen"}
                            </button>
                          ) : (
                            "—"
                          )}
                        </dd>
                      </div>
                    </dl>

                    {maengelAuf && (
                      <ul className="mt-2 space-y-2 rounded border border-red-100 bg-red-50/50 p-2 text-sm">
                        {(maengelProZimmer[sel.zimmer_id] ?? []).length === 0 ? (
                          <li className="text-neutral-400">
                            keine offenen Mängel geladen.
                          </li>
                        ) : (
                          (maengelProZimmer[sel.zimmer_id] ?? []).map((m) => (
                            <li key={m.id} className="space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <span>{m.beschreibung}</span>
                                <Link
                                  href={`/unterkunft/maengel?mangel=${m.id}`}
                                  className="shrink-0 text-xs text-emerald-700 underline"
                                >
                                  öffnen
                                </Link>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                                <span
                                  className={`rounded px-1.5 py-0.5 ${
                                    m.kategorie === "reparatur"
                                      ? "bg-orange-100 text-orange-800"
                                      : "bg-white"
                                  }`}
                                >
                                  {UNTERKUNFT_MANGEL_KATEGORIE_LABELS[m.kategorie]}
                                </span>
                                <span className="rounded bg-white px-1.5 py-0.5">
                                  {UNTERKUNFT_MANGEL_SCHWERE_LABELS[m.schwere]}
                                </span>
                                {canEditMangel ? (
                                  <select
                                    value={m.status}
                                    onChange={(e) =>
                                      mangelStatusSetzen(
                                        m,
                                        e.target.value as UnterkunftMangelStatus
                                      )
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
                                  <span>
                                    {UNTERKUNFT_MANGEL_STATUS_LABELS[m.status]}
                                  </span>
                                )}
                                <span>{formatDatumDE(m.gemeldet_am)}</span>
                              </div>
                            </li>
                          ))
                        )}
                        <li>
                          <Link
                            href={`/unterkunft/maengel?zimmer=${sel.zimmer_id}`}
                            className="text-xs text-emerald-700 underline"
                          >
                            alle in der Mängelliste öffnen
                          </Link>
                        </li>
                      </ul>
                    )}

                    {sel.gesperrt && (
                      <p className="mt-2 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        🔒 Gesperrt
                        {sel.sperr_grund ? `: ${sel.sperr_grund}` : ""}
                      </p>
                    )}

                    {sel.art === "zimmer" && (
                      <>
                        <div className="mt-3">
                          <div className="text-xs font-medium text-neutral-500">
                            Bewohner heute
                          </div>
                          {(belegungProZimmer[sel.zimmer_id] ?? []).length ===
                          0 ? (
                            <p className="text-sm text-neutral-400">niemand</p>
                          ) : (
                            <ul className="mt-1 space-y-0.5 text-sm">
                              {(belegungProZimmer[sel.zimmer_id] ?? []).map(
                                (b) => (
                                  <li
                                    key={b.id}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span>
                                      {b.vorname} {b.name}
                                      {b.herkunft ? (
                                        <span className="text-neutral-400">
                                          {" "}
                                          · {b.herkunft}
                                        </span>
                                      ) : null}
                                    </span>
                                    {canMove && (
                                      <button
                                        className="shrink-0 text-xs text-emerald-700 hover:underline"
                                        onClick={() =>
                                          umzugStarten(b, sel.nummer)
                                        }
                                      >
                                        umziehen
                                      </button>
                                    )}
                                  </li>
                                )
                              )}
                            </ul>
                          )}
                        </div>

                        {(zuordnungProZimmer[sel.zimmer_id] ?? []).length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs font-medium text-neutral-500">
                              Geplant
                            </div>
                            <ul className="mt-1 space-y-0.5 text-sm">
                              {(zuordnungProZimmer[sel.zimmer_id] ?? []).map(
                                (z) => (
                                  <li key={z.id} className="text-amber-800">
                                    {z.vorname} {z.name}
                                  </li>
                                )
                              )}
                            </ul>
                          </div>
                        )}

                        {umzug && (
                          <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 p-2 text-sm">
                            <div className="font-medium text-emerald-900">
                              Umzug: {umzug.name}
                            </div>
                            <p className="text-xs text-neutral-500">
                              aus Zimmer {umzug.vonZimmer}
                            </p>
                            <div className="mt-2 space-y-2">
                              <label className="block">
                                Wohneinheit
                                <select
                                  className="ml-1 w-full"
                                  value={umzugZiel.wohneinheit_id}
                                  onChange={(e) =>
                                    setUmzugZiel((s) => ({
                                      ...s,
                                      wohneinheit_id: e.target.value,
                                      zimmer_id: "",
                                    }))
                                  }
                                >
                                  <option value="">–</option>
                                  {einheitenDesGebaeudes.map((e) => (
                                    <option
                                      key={e.wohneinheit_id}
                                      value={e.wohneinheit_id}
                                    >
                                      {e.name}
                                      {e.etage_label ? ` · ${e.etage_label}` : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                Zimmer
                                <select
                                  className="ml-1 w-full"
                                  value={umzugZiel.zimmer_id}
                                  disabled={!umzugZiel.wohneinheit_id}
                                  onChange={(e) =>
                                    setUmzugZiel((s) => ({
                                      ...s,
                                      zimmer_id: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">–</option>
                                  {zimmer
                                    .filter(
                                      (z) =>
                                        String(z.wohneinheit_id) ===
                                          umzugZiel.wohneinheit_id &&
                                        z.art === "zimmer" &&
                                        z.aktiv &&
                                        !z.gesperrt &&
                                        z.zimmer_id !== sel.zimmer_id
                                    )
                                    .map((z) => (
                                      <option key={z.zimmer_id} value={z.zimmer_id}>
                                        {z.nummer} — {z.belegt}/{z.betten}
                                        {z.frei > 0 ? ` · ${z.frei} frei` : " · voll"}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <label className="block">
                                Umzug am
                                <input
                                  type="date"
                                  className="ml-1"
                                  value={umzugZiel.datum}
                                  onChange={(e) =>
                                    setUmzugZiel((s) => ({
                                      ...s,
                                      datum: e.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <div className="flex gap-2">
                                <button className="btn" onClick={umzugAusfuehren}>
                                  Umzug eintragen
                                </button>
                                <button
                                  className="btn-secondary"
                                  onClick={() => setUmzug(null)}
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {canMove && !umzug && einzugOffen && (
                          <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 p-2 text-sm">
                            <div className="font-medium text-emerald-900">
                              Einzug – Person ins Zimmer
                            </div>
                            <p className="text-xs text-neutral-500">
                              Bewohner ohne Bleibe wählen; wird sofort belegt.
                            </p>
                            <div className="mt-2 space-y-2">
                              {sel.frei <= 0 && (
                                <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                                  Zimmer ist voll ({sel.belegt}/{sel.betten}) –
                                  weitere Belegung ist eine Überbuchung.
                                </p>
                              )}
                              {(zuordnungProZimmer[sel.zimmer_id] ?? []).length >
                                0 && (
                                <div>
                                  <div className="text-xs text-neutral-500">
                                    Für dieses Zimmer geplant
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {(zuordnungProZimmer[sel.zimmer_id] ?? []).map(
                                      (z) => (
                                        <button
                                          key={z.id}
                                          onClick={() =>
                                            belegungDirekt(
                                              z.employee_id,
                                              sel.zimmer_id,
                                              z.id
                                            )
                                          }
                                          className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
                                        >
                                          {z.vorname} {z.name} einziehen
                                        </button>
                                      )
                                    )}
                                  </div>
                                </div>
                              )}
                              <input
                                className="w-full text-sm"
                                placeholder="Person suchen (Name / Nr.)"
                                value={direkt?.suche ?? ""}
                                onChange={(e) =>
                                  setDirekt({ suche: e.target.value })
                                }
                              />
                              {direkt?.suche.trim() && (
                                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm">
                                  {personenOffen
                                    .filter((p) =>
                                      `${p.vorname} ${p.name} ${p.personal_nr}`
                                        .toLowerCase()
                                        .includes(
                                          direkt.suche.trim().toLowerCase()
                                        )
                                    )
                                    .slice(0, 12)
                                    .map((p) => (
                                      <li key={p.employee_id}>
                                        <button
                                          onClick={() =>
                                            belegungDirekt(
                                              p.employee_id,
                                              sel.zimmer_id
                                            )
                                          }
                                          className="w-full rounded px-1 py-0.5 text-left hover:bg-neutral-100"
                                        >
                                          {p.vorname} {p.name}{" "}
                                          <span className="text-neutral-400">
                                            ({p.personal_nr})
                                          </span>
                                          {p.auf_anreiseliste ? (
                                            <span className="ml-1 rounded bg-emerald-100 px-1 text-xs text-emerald-800">
                                              Anreise
                                            </span>
                                          ) : null}
                                        </button>
                                      </li>
                                    ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                      {sel.art === "zimmer" && canMove && (
                        <>
                          <button
                            className={`inline-flex items-center gap-1.5 rounded border px-3 py-1 font-medium ${
                              einzugOffen
                                ? "border-emerald-700 bg-emerald-700 text-white"
                                : "border-emerald-600 text-emerald-700"
                            }`}
                            onClick={() => {
                              setEinzugOffen((v) => !v);
                              setAuszugWahlOffen(false);
                            }}
                          >
                            <IconEinzug /> Einzug starten
                          </button>
                          <button
                            className="inline-flex items-center gap-1.5 rounded border border-red-600 px-3 py-1 font-medium text-red-700"
                            onClick={() => {
                              const bew =
                                belegungProZimmer[sel.zimmer_id] ?? [];
                              setEinzugOffen(false);
                              if (bew.length === 0) {
                                setHinweis("Niemand in diesem Zimmer.");
                                return;
                              }
                              if (bew.length === 1) {
                                router.push(
                                  `/unterkunft/uebergabe?zimmer=${sel.zimmer_id}&typ=auszug&belegung=${bew[0].id}`
                                );
                                return;
                              }
                              setAuszugWahlOffen((v) => !v);
                            }}
                          >
                            <IconAuszug /> Auszug starten
                          </button>
                        </>
                      )}
                      {sel.art !== "flur" && (
                        <Link
                          className="btn-secondary"
                          href={`/unterkunft/kontrolle?zimmer=${sel.zimmer_id}`}
                        >
                          Kontrolle
                        </Link>
                      )}
                      {canEditMangel ? (
                        <button
                          className="btn-secondary"
                          onClick={() =>
                            setNeuerMangel((v) =>
                              v
                                ? null
                                : {
                                    beschreibung: "",
                                    schwere: "mittel",
                                    kategorie: "reinigung",
                                  }
                            )
                          }
                        >
                          Mangel melden
                        </button>
                      ) : (
                        <Link
                          className="btn-secondary"
                          href={`/unterkunft/maengel?zimmer=${sel.zimmer_id}`}
                        >
                          Mängel
                        </Link>
                      )}
                      {canManage && (
                        <button
                          className="btn-secondary"
                          onClick={() => sperreSetzen(sel, !sel.gesperrt)}
                        >
                          {sel.gesperrt ? "Entsperren" : "Sperren"}
                        </button>
                      )}
                    </div>

                    {auszugWahlOffen && (
                      <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm">
                        <div className="font-medium text-red-900">
                          Wer zieht aus?
                        </div>
                        <ul className="mt-1 space-y-1">
                          {(belegungProZimmer[sel.zimmer_id] ?? []).map((b) => (
                            <li key={b.id}>
                              <button
                                className="w-full rounded border border-red-200 bg-white px-2 py-1 text-left hover:border-red-400"
                                onClick={() =>
                                  router.push(
                                    `/unterkunft/uebergabe?zimmer=${sel.zimmer_id}&typ=auszug&belegung=${b.id}`
                                  )
                                }
                              >
                                {b.vorname} {b.name}
                                {b.herkunft ? (
                                  <span className="text-neutral-400">
                                    {" "}
                                    · {b.herkunft}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {neuerMangel && canEditMangel && (
                      <div className="mt-3 space-y-2 rounded border border-red-200 bg-red-50 p-2 text-sm">
                        <div className="font-medium text-red-900">
                          Mangel für{" "}
                          {sel.art === "zimmer"
                            ? `Zimmer ${sel.nummer}`
                            : raumName(sel)}
                        </div>
                        <textarea
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                          rows={2}
                          placeholder="Beschreibung"
                          value={neuerMangel.beschreibung}
                          onChange={(e) =>
                            setNeuerMangel((v) =>
                              v ? { ...v, beschreibung: e.target.value } : v
                            )
                          }
                        />
                        <label className="flex items-center gap-2">
                          Art
                          <select
                            value={neuerMangel.kategorie}
                            onChange={(e) =>
                              setNeuerMangel((v) =>
                                v
                                  ? {
                                      ...v,
                                      kategorie: e.target
                                        .value as UnterkunftMangelKategorie,
                                    }
                                  : v
                              )
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
                        <label className="flex items-center gap-2">
                          Schwere
                          <select
                            value={neuerMangel.schwere}
                            onChange={(e) =>
                              setNeuerMangel((v) =>
                                v
                                  ? {
                                      ...v,
                                      schwere: e.target
                                        .value as UnterkunftMangelSchwere,
                                    }
                                  : v
                              )
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
                        <div className="flex gap-2">
                          <button
                            className="btn"
                            onClick={() => mangelAnlegen(sel.zimmer_id)}
                          >
                            Mangel anlegen
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => setNeuerMangel(null)}
                          >
                            Abbrechen
                          </button>
                        </div>
                        <p className="text-xs text-neutral-500">
                          Fotos danach über „Details anzeigen“ bei den offenen
                          Mängeln anhängen.
                        </p>
                      </div>
                    )}

                    {bearbeiten && canEditPlan && sel.plan_x != null && (
                      <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-500">Breite</span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_w: Math.max(1, sel.plan_w - 1),
                              })
                            }
                          >
                            −
                          </button>
                          <span className="w-5 text-center tabular-nums">
                            {sel.plan_w}
                          </span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_w: sel.plan_w + 1,
                              })
                            }
                          >
                            +
                          </button>
                          <span className="ml-2 text-neutral-500">Höhe</span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_h: Math.max(1, sel.plan_h - 1),
                              })
                            }
                          >
                            −
                          </button>
                          <span className="w-5 text-center tabular-nums">
                            {sel.plan_h}
                          </span>
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_h: sel.plan_h + 1,
                              })
                            }
                          >
                            +
                          </button>
                        </div>
                        <div className="flex gap-3">
                          <button
                            className="text-xs text-red-600 hover:underline"
                            onClick={() =>
                              speicherePlan(sel.zimmer_id, {
                                plan_x: null,
                                plan_y: null,
                              })
                            }
                          >
                            vom Raster nehmen
                          </button>
                          {sel.art !== "zimmer" && (
                            <button
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => zimmerLoeschen(sel)}
                            >
                              Löschen
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="hidden rounded border border-dashed border-neutral-200 p-3 text-sm text-neutral-400 lg:block">
                    {belegen
                      ? "Belegen-Modus: Person antippen, dann ein Zimmer."
                      : istHausmeister
                        ? "Zimmer in der Liste antippen für Details."
                        : "Zimmer im Plan antippen für Details."}
                  </div>
                )}
              </div>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
