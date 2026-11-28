"use client";

// Startseite (Neubau 2026-11-26 im Stil der QM-App, Nutzer: "Das Design von
// der QM-Seite gefällt uns sehr gut", die alte Seite war eine lange Liste
// je Rolle mit doppelten Kacheln).
//
// Aufbau seit 2026-11-28 (docs/startseite-kacheln-plan.md): Begrüßung mit
// Datum + rote Hinweise (immer, auch für ausgeblendete Kacheln) · darunter
// Kacheln, je Nutzer Groß / Mittel / Klein / Aus (profiles.startseite, Start
// = alles Mittel) - erst alle großen, dann mittlere, dann kleine; innerhalb
// einer Größe fest nach Dringlichkeit (rot, gelb, ruhig). NUR akute/
// Tagesinformationen, keine Saisonstatistiken (Nutzer-Vorgabe).
// Jede Kachel erscheint nur, wenn der Nutzer den Bereich sehen darf; die
// Controlling-Zahlen kommen aus demselben Hook wie die
// Controlling-Seite, damit überall dieselbe Zahl steht.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Cherry,
  Eye,
  Gauge,
  History,
  Landmark,
  Lightbulb,
  Receipt,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sprout,
  Store,
  Tractor,
  Users,
  Wheat,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE, formatEuro, formatZahlDE } from "@/lib/format";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { heuteLokalIso } from "@/lib/datum";
import { MAX_STUNDEN_PRO_TAG, findeAbweichungen } from "@/lib/controlling";
import { aktionLabel, bereichLabel } from "@/lib/auditLog";
import { useControllingCounts } from "@/lib/useControllingCounts";
import { datumLang, kalenderwoche, tagesplanBerechnen, wochentagVon } from "@/lib/tagesplan";
import { saisonVon, tagesplanDatenLaden } from "@/lib/tagesplanLaden";
import { ARTEN } from "@/components/VorschlagKnopf";
import { Begruessung, KleinKachel, ListenKarte, Ring, type Eintrag } from "@/components/Uebersicht";
import {
  UNTERKUNFT_MANGEL_SCHWERE_LABELS,
  type Kassenbuch,
  type SeasonSummaryRow,
  type UnterkunftMangel,
} from "@/lib/types";
import { darf, istAdmin, MENUE_RECHTE, darfMenue, bereicheVon, ersteSeite, rollenVon } from "@/lib/rollen";

const CURRENT_YEAR = new Date().getFullYear();
const tag = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
function plusTage(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Fehler = Partial<Record<"kasse" | "personal" | "lohn" | "unterkunft" | "vertrieb" | "vorschlaege" | "protokoll" | "ernte" | "spargel" | "spinnen", string>>;


interface KassenZeile {
  buch: Kassenbuch;
  saldo: number;
  letzterCheck: { check_zeit: string; status: string; freigegeben: boolean } | null;
  bewegungenSeit: number;
}
interface VertriebTag {
  datum: string;
  staende: number;
  halbtage: number;
  unbesetzt: number;
  aenderungen: number;
  touren: number;
}
// Konkretes Besetzungsproblem im Vertrieb (Startseite, Nutzer-Vorgabe
// 2026-11-28: aufkommende Probleme sollen auffallen, z.B. "Lukas,
// Seligenstadt hat am Donnerstag frei, Ersatz noch nicht geklärt").
interface VertriebProblem {
  datum: string;
  stand: string;
  halbtag: "VM" | "NM";
  art: "niemand" | "abwesend" | "nicht_verfuegbar";
  person: string | null;
  grund: string | null;
}
interface Spinne {
  id: number;
  nummer: number;
  bezeichnung: string | null;
  online: boolean;
  personen: number;
  kg: number;
}
interface Daten {
  kassen: KassenZeile[];
  ohneFreigabe: number;
  anreiseNichtGedruckt: number;
  planJahr: number;
  geplant: number;
  platzhalter: number;
  anreiseliste: number;
  aktivePersonen: number;
  abweichungen: number;
  maengel: (UnterkunftMangel & { ort: string })[];
  auszuegeOffen: number;
  vertrieb: VertriebTag[];
  vProbleme: VertriebProblem[];
  vorschlaege: { id: number; art: string; text: string; erstellt_am: string }[];
  protokoll: { occurred_at: string; actor_name: string | null; entity: string; action: string }[];
  zmPersonen: number;
  zmSumme: number;
  zmSatzFehlt: boolean;
  qsKontrollen: number;
  qsQuote: number | null;
  nacharbeit: number | null;
  ebFelder: { feld: string; personen: number; praemie: number }[];
  spinnen: Spinne[];
  spinnenUeberfaellig: number;
  ebPersonen: number;
  ebSumme: number;
  spHeuteKg: number;
  spHeuteKisten: number;
  spHeuteFelder: number;
  spOffen: string[];
  spTage: number;
  spUngeklaert: number;
}
const LEER: Daten = {
  kassen: [],
  ohneFreigabe: 0,
  anreiseNichtGedruckt: 0,
  planJahr: CURRENT_YEAR,
  geplant: 0,
  platzhalter: 0,
  anreiseliste: 0,
  aktivePersonen: 0,
  abweichungen: 0,
  maengel: [],
  auszuegeOffen: 0,
  vertrieb: [],
  vProbleme: [],
  vorschlaege: [],
  protokoll: [],
  zmPersonen: 0,
  zmSumme: 0,
  zmSatzFehlt: false,
  qsKontrollen: 0,
  qsQuote: null,
  nacharbeit: null,
  ebFelder: [],
  spinnen: [],
  spinnenUeberfaellig: 0,
  ebPersonen: 0,
  ebSumme: 0,
  spHeuteKg: 0,
  spHeuteKisten: 0,
  spHeuteFelder: 0,
  spOffen: [],
  spTage: 0,
  spUngeklaert: 0,
};

const SCHWERE_RANG: Record<string, number> = { hoch: 0, mittel: 1, gering: 2 };

type Groesse = "G" | "M" | "K" | "aus";

// Umschalter Groß / Mittel / Klein / Aus im Anpassen-Modus
function GroessenWahl({ id, titel, wert, onChange }: { id: string; titel: string; wert: Groesse; onChange: (id: string, g: Groesse) => void }) {
  return (
    <div role="radiogroup" aria-label={`Größe ${titel}`} className="inline-flex self-start overflow-hidden rounded-lg border border-emerald-300 bg-white text-xs">
      {(["G", "M", "K", "aus"] as const).map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={wert === g}
          title={g === "G" ? "Groß" : g === "M" ? "Mittel" : g === "K" ? "Klein" : "Ausblenden"}
          onClick={() => onChange(id, g)}
          className={`border-l border-emerald-200 px-2.5 py-1 font-medium first:border-l-0 ${wert === g ? "bg-emerald-600 text-white" : "text-neutral-600 hover:bg-emerald-50"}`}
        >
          {g === "aus" ? "Aus" : g}
        </button>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { profile, loading: profilLaedt } = useProfile();
  const [d, setD] = useState<Daten>(LEER);
  const [fehler, setFehler] = useState<Fehler>({});
  const [laedt, setLaedt] = useState(true);
  // Startseite selbst gestalten: Größe je Kachel (profiles.startseite), fehlend = Mittel
  const [groessen, setGroessen] = useState<Record<string, Groesse>>({});
  const [anpassen, setAnpassen] = useState(false);
  useEffect(() => {
    setGroessen((profile?.startseite as Record<string, Groesse> | null | undefined) ?? {});
  }, [profile?.startseite]);
  async function groessenSpeichern(neu: Record<string, Groesse>) {
    const vorher = groessen;
    setGroessen(neu);
    if (!profile) return;
    const { error } = await getSupabaseClient().from("profiles").update({ startseite: neu }).eq("id", profile.id);
    if (error) {
      setGroessen(vorher);
      alert(`Konnte nicht gespeichert werden: ${error.message}`);
    }
  }
  function groesseSetzen(id: string, g: Groesse) {
    const neu = { ...groessen };
    if (g === "M") delete neu[id];
    else neu[id] = g;
    groessenSpeichern(neu);
  }

  // Was diese Rolle sieht - immer an den Menürechten ausgerichtet.
  const sieht = useMemo(() => {
    const controlling = darfMenue(profile, "/management");
    return {
      controlling,
      kasse: darfMenue(profile, "/kasse"),
      freigabe: darf(profile, "sonder.kasse_freigeben:S"),
      personal: darfMenue(profile, "/mitarbeiter"),
      // Lohn-Karte nur für die, die das Controlling nicht sehen (dort stehen
      // die Abweichungen schon).
      lohn: darf(profile, "lohn.uebersicht:S") && !controlling,
      unterkunft: darfMenue(profile, "/unterkunft"),
      vertrieb: darfMenue(profile, "/vertrieb"),
      vorschlaege: istAdmin(profile),
      protokoll: darfMenue(profile, "/aenderungsprotokoll"),
      ernte: darf(profile, "ernte.praemien:L"),
      spinnen: darf(profile, "ernte.ernte:L"),
      spargel: darf(profile, "ernte.praemien:L", "ernte.ernte:L", "ernte.statistik:L"),
      spargelFreigabe: darf(profile, "sonder.spargel_kategorie:S"),
    };
  }, [profile]);
  const controlling = useControllingCounts(!!profile && sieht.controlling);

  const keinDashboard = !!profile && !darfMenue(profile, "/dashboard");

  useEffect(() => {
    if (!profile || keinDashboard) {
      setLaedt(false);
      return;
    }
    const sb = getSupabaseClient();
    const heute = heuteLokalIso();
    const f: Fehler = {};
    // Listen frisch anlegen (LEER nicht verändern - sonst doppelte Einträge bei erneutem Laden)
    const neu: Daten = { ...LEER, vProbleme: [] };
    const merke = (k: keyof Fehler, e: { message: string } | null | undefined) => {
      if (e && !f[k]) f[k] = e.message;
    };

    async function kasse() {
      const [{ data: b, error: e1 }, { data: c, error: e2 }] = await Promise.all([
        sb.from("kassenbuch").select("*").eq("aktiv", true).order("reihenfolge"),
        sb.from("cash_checks").select("kassenbuch_id, check_zeit, status, freigegeben").order("check_zeit", { ascending: false }),
      ]);
      merke("kasse", e1 ?? e2);
      const checks = (c as (KassenZeile["letzterCheck"] & { kassenbuch_id: number })[]) ?? [];
      neu.ohneFreigabe = checks.filter((x) => !x!.freigegeben).length;
      const letzte = new Map<number, KassenZeile["letzterCheck"]>();
      for (const x of checks) if (!letzte.has(x!.kassenbuch_id)) letzte.set(x!.kassenbuch_id, x);
      neu.kassen = await Promise.all(
        ((b as Kassenbuch[]) ?? []).map(async (buch) => {
          const lc = letzte.get(buch.id) ?? null;
          const [s, bw] = await Promise.all([
            sb.rpc("kassenbuch_saldo_bis", { p_kassenbuch_id: buch.id }),
            lc ? sb.rpc("kassenbuch_bewegungen_seit", { p_kassenbuch_id: buch.id, p_seit: lc.check_zeit }) : Promise.resolve({ data: 0, error: null }),
          ]);
          merke("kasse", s.error ?? bw.error);
          return { buch, saldo: Number(s.data ?? 0), letzterCheck: lc, bewegungenSeit: Number(bw.data ?? 0) };
        })
      );
    }

    async function personal() {
      // Planungsjahr: ab August schon die nächste Saison
      const planJahr = Number(heute.slice(5, 7)) >= 8 ? CURRENT_YEAR + 1 : CURRENT_YEAR;
      type K = { id: string; status: string; platzhalter: boolean; gedruckt: boolean };
      const [k, p] = await Promise.all([
        ladeAlleSeiten<K>((von, bis) =>
          sb
            .from("personal_kandidaten")
            .select("id, status, platzhalter, gedruckt")
            .eq("saison_jahr", planJahr)
            .neq("status", "storniert")
            .order("id")
            .range(von, bis)
            .then((r) => {
              merke("personal", r.error);
              return r;
            })
        ),
        sb.from("employees").select("id", { count: "exact", head: true }).eq("aktiv", true),
      ]);
      merke("personal", p.error);
      neu.planJahr = planJahr;
      neu.geplant = k.length;
      neu.platzhalter = k.filter((x) => x.platzhalter).length;
      neu.anreiseliste = k.filter((x) => x.status === "anreiseliste").length;
      neu.anreiseNichtGedruckt = k.filter((x) => x.status === "anreiseliste" && !x.gedruckt).length;
      neu.aktivePersonen = p.count ?? 0;
    }

    async function lohn() {
      const rows = await ladeAlleSeiten<SeasonSummaryRow>((von, bis) =>
        sb
          .from("season_summary")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR)
          .not("snapshot", "is", null)
          .order("employee_id")
          .range(von, bis)
          .then((r) => {
            merke("lohn", r.error);
            return r;
          })
      );
      neu.abweichungen = rows.filter((r) => findeAbweichungen(r).length > 0).length;
      if (!sieht.personal) {
        const p = await sb.from("employees").select("id", { count: "exact", head: true }).eq("aktiv", true);
        merke("lohn", p.error);
        neu.aktivePersonen = p.count ?? 0;
      }
    }

    async function unterkunft() {
      const [m, z, a] = await Promise.all([
        sb.from("unterkunft_mangel").select("*").neq("status", "behoben").order("gemeldet_am", { ascending: false }),
        sb.from("unterkunft_zimmer_uebersicht").select("zimmer_id, nummer, gebaeude_name"),
        sb.from("unterkunft_auszug_offen").select("*", { count: "exact", head: true }),
      ]);
      merke("unterkunft", m.error ?? z.error ?? a.error);
      const ort = new Map(((z.data as { zimmer_id: number; nummer: string; gebaeude_name: string }[]) ?? []).map((x) => [x.zimmer_id, `${x.gebaeude_name} ${x.nummer}`]));
      neu.maengel = ((m.data as UnterkunftMangel[]) ?? [])
        .map((x) => ({ ...x, ort: ort.get(x.zimmer_id) ?? "" }))
        .sort((a, b) => SCHWERE_RANG[a.schwere] - SCHWERE_RANG[b.schwere] || b.gemeldet_am.localeCompare(a.gemeldet_am));
      neu.auszuegeOffen = a.count ?? 0;
    }

    async function vertrieb() {
      const bis = plusTage(heute, 6);
      const daten = await tagesplanDatenLaden(sb, heute, bis);
      if (daten.fehler) merke("vertrieb", { message: daten.fehler });
      const tage: VertriebTag[] = [];
      for (let i = 0; i <= 6; i++) {
        const datum = plusTage(heute, i);
        // Ohne Grundplan für diese Saison ruht der Verkauf (Winter) - sonst
        // stünden alle Öffnungszeiten als "ohne Verkäufer" da.
        if (!daten.grundplan.some((g) => g.saison_jahr === saisonVon(datum))) {
          tage.push({ datum, staende: 0, halbtage: 0, unbesetzt: 0, aenderungen: 0, touren: 0 });
          continue;
        }
        const tp = tagesplanBerechnen({
          datum,
          feiertage: daten.feiertage,
          grundplan: daten.grundplan.filter((g) => g.saison_jahr === saisonVon(datum)),
          zeiten: daten.zeiten,
          aenderungen: daten.aenderungen,
          abwesenheiten: daten.abwesenheiten,
          staende: daten.staende.filter((s) => s.aktiv),
          touren: daten.touren,
          tourStaende: daten.tourStaende,
          tourTage: daten.tourTage,
          fahrzeuge: daten.fahrzeuge,
          standSaison: daten.standSaison,
        });
        const offen = [...tp.felder.values()].filter((x) => x.offen && !x.zu);
        const standName = new Map(daten.staende.map((st) => [st.id, st.name]));
        const personName = new Map(daten.personen.map((pp) => [pp.id, `${pp.vorname} ${pp.name}`]));
        const wt = wochentagVon(datum);
        for (const x of offen) {
          const base = { datum, stand: standName.get(x.stand_id) ?? "Stand", halbtag: x.halbtag };
          if (!x.emp) neu.vProbleme.push({ ...base, art: "niemand", person: null, grund: null });
          else if (x.abwesend) neu.vProbleme.push({ ...base, art: "abwesend", person: personName.get(x.emp) ?? null, grund: x.abwesend.grund });
          else if (daten.verf.some((v) => v.employee_id === x.emp && v.saison_jahr === saisonVon(datum) && v.wochentag === wt && v.halbtag === x.halbtag && !v.kann))
            neu.vProbleme.push({ ...base, art: "nicht_verfuegbar", person: personName.get(x.emp) ?? null, grund: null });
        }
        tage.push({
          datum,
          staende: new Set(offen.map((x) => x.stand_id)).size,
          halbtage: offen.length,
          unbesetzt: neu.vProbleme.filter((pp) => pp.datum === datum).length,
          aenderungen: [...tp.felder.values()].filter((x) => x.aenderung).length,
          touren: tp.touren.length,
        });
      }
      neu.vertrieb = tage;
    }

    async function vorschlaege() {
      const { data, error } = await sb
        .from("verbesserungsvorschlag")
        .select("id, art, text, erstellt_am")
        .eq("status", "offen")
        .order("erstellt_am", { ascending: false });
      merke("vorschlaege", error);
      const rang = (a: string) => ARTEN.findIndex((x) => x.wert === a);
      neu.vorschlaege = ((data as Daten["vorschlaege"]) ?? []).sort((a, b) => rang(a.art) - rang(b.art) || b.erstellt_am.localeCompare(a.erstellt_am));
    }

    async function protokoll() {
      const { data, error } = await sb
        .from("audit_log_ansicht")
        .select("occurred_at, actor_name, entity, action")
        .order("occurred_at", { ascending: false })
        .limit(15);
      merke("protokoll", error);
      neu.protokoll = (data as Daten["protokoll"]) ?? [];
    }

    async function ernte() {
      const [zm, eb, satz] = await Promise.all([
        sb.from("zuckermais_praemie_tag").select("employee_id, praemie").eq("datum", heute),
        sb.from("erdbeeren_praemie_tag").select("employee_id, praemie, parzelle_name").eq("datum", heute),
        sb.from("zuckermais_saetze").select("id").lte("gueltig_ab", heute).order("gueltig_ab", { ascending: false }).limit(1).maybeSingle(),
      ]);
      merke("ernte", zm.error ?? eb.error ?? satz.error);
      type P = { employee_id: string; praemie: number | null };
      const zmR = (zm.data as P[]) ?? [];
      const ebR = (eb.data as P[]) ?? [];
      neu.zmPersonen = new Set(zmR.map((r) => r.employee_id)).size;
      neu.zmSumme = zmR.reduce((s, r) => s + Number(r.praemie ?? 0), 0);
      neu.zmSatzFehlt = !satz.data;
      neu.ebPersonen = new Set(ebR.map((r) => r.employee_id)).size;
      neu.ebSumme = ebR.reduce((s, r) => s + Number(r.praemie ?? 0), 0);
      const felder = new Map<string, { personen: Set<string>; praemie: number }>();
      for (const r of (eb.data as (P & { parzelle_name: string | null })[]) ?? []) {
        const k = r.parzelle_name ?? "ohne Feld";
        const f0 = felder.get(k) ?? { personen: new Set<string>(), praemie: 0 };
        f0.personen.add(r.employee_id);
        f0.praemie += Number(r.praemie ?? 0);
        felder.set(k, f0);
      }
      neu.ebFelder = [...felder.entries()].map(([feld, v]) => ({ feld, personen: v.personen.size, praemie: v.praemie })).sort((a, b) => b.personen - a.personen);
      const [qs, na] = await Promise.all([
        sb.from("qs_kontrolle_tag").select("kontrollen, quote_prozent").eq("datum", heute).eq("kultur", "zuckermais"),
        sb.from("zuckermais_annahme_quote").select("kisten_nacharbeit, kisten_gesamt").eq("datum", heute),
      ]);
      const q = ((qs.data as { kontrollen: number; quote_prozent: number | null }[]) ?? [])[0];
      neu.qsKontrollen = q?.kontrollen ?? 0;
      neu.qsQuote = q?.quote_prozent ?? null;
      const nRows = (na.data as { kisten_nacharbeit: number; kisten_gesamt: number | null }[]) ?? [];
      const ges = nRows.reduce((s2, r) => s2 + Number(r.kisten_gesamt ?? 0), 0);
      neu.nacharbeit = ges > 0 ? (100 * nRows.reduce((s2, r) => s2 + Number(r.kisten_nacharbeit ?? 0), 0)) / ges : null;
    }

    async function spargel() {
      const [ertrag, frei, luecken] = await Promise.all([
        sb.from("ernte_ertrag_tag").select("tag, feld_id, netto_kg, kisten").gte("tag", `${CURRENT_YEAR}-01-01`),
        sb.from("spargel_freigabe").select("datum").gte("datum", `${CURRENT_YEAR}-01-01`),
        sb.from("ernte_kette_luecken").select("*", { count: "exact", head: true }),
      ]);
      merke("spargel", ertrag.error ?? frei.error);
      type E = { tag: string; feld_id: number | null; netto_kg: number | null; kisten: number };
      const er = (ertrag.data as E[]) ?? [];
      const heuteR = er.filter((r) => r.tag.slice(0, 10) === heute);
      neu.spHeuteKg = heuteR.reduce((s, r) => s + Number(r.netto_kg ?? 0), 0);
      neu.spHeuteKisten = heuteR.reduce((s, r) => s + Number(r.kisten ?? 0), 0);
      neu.spHeuteFelder = new Set(heuteR.map((r) => r.feld_id)).size;
      const freigegeben = new Set(((frei.data as { datum: string }[]) ?? []).map((r) => r.datum));
      // offene Erntetage bis gestern (heute wird noch geerntet)
      neu.spOffen = Array.from(new Set(er.map((r) => r.tag.slice(0, 10))))
        .filter((t) => t < heute && !freigegeben.has(t))
        .sort()
        .reverse();
      neu.spTage = new Set(er.map((r) => r.tag.slice(0, 10))).size;
      neu.spUngeklaert = luecken.count ?? 0;
    }

    async function spinnen() {
      const [m, l] = await Promise.all([
        sb.from("ernte_maschine_live").select("maschine_id, nummer, bezeichnung, position_zeitpunkt, aktive_personen, kg_heute").order("nummer"),
        sb.from("ernte_kette_luecken").select("*", { count: "exact", head: true }).eq("ist_faellig", true),
      ]);
      merke("spinnen", m.error);
      const jetzt = Date.now();
      type M = { maschine_id: number; nummer: number; bezeichnung: string | null; position_zeitpunkt: string | null; aktive_personen: number; kg_heute: number };
      neu.spinnen = ((m.data as M[]) ?? []).map((x) => ({
        id: x.maschine_id,
        nummer: x.nummer,
        bezeichnung: x.bezeichnung,
        // offline: seit mehr als 10 Minuten keine Position (ernte_konfig offline_alarm_min)
        online: !!x.position_zeitpunkt && jetzt - new Date(x.position_zeitpunkt).getTime() < 10 * 60 * 1000,
        personen: Number(x.aktive_personen ?? 0),
        kg: Number(x.kg_heute ?? 0),
      }));
      neu.spinnenUeberfaellig = l.count ?? 0;
    }

    setLaedt(true);
    Promise.all([
      sieht.kasse ? kasse() : null,
      sieht.personal ? personal() : null,
      sieht.lohn ? lohn() : null,
      sieht.unterkunft ? unterkunft() : null,
      sieht.vertrieb ? vertrieb() : null,
      sieht.vorschlaege ? vorschlaege() : null,
      sieht.protokoll ? protokoll() : null,
      sieht.ernte ? ernte() : null,
      sieht.spargel ? spargel() : null,
      sieht.spinnen ? spinnen() : null,
    ]).then(() => {
      setD(neu);
      setFehler(f);
      setLaedt(false);
    });
  }, [profile, keinDashboard, sieht]);

  if (!profile) {
    return (
      <p className="text-neutral-500">
        {profilLaedt
          ? "Lädt…"
          : "Für dein Konto ist kein Profil hinterlegt oder es konnte nicht geladen werden. Bitte wende dich an den Administrator."}
      </p>
    );
  }

  const heute = heuteLokalIso();
  const vorname = (profile.full_name ?? "").split(" ")[0];
  const datumZeile = `${datumLang(heute)} · KW ${kalenderwoche(heute)}`;

  if (keinDashboard) {
    const ziel = ersteSeite(profile);
    return (
      <div className="flex flex-col gap-4">
        <Begruessung datum={datumZeile} titel={`Hallo ${vorname}.`} />
        <p className="text-sm text-neutral-500">
          {rollenVon(profile).length === 0
            ? "Dein Konto ist deaktiviert oder hat keine aktive Rolle. Bitte wende dich an den Administrator."
            : "Für deine Rolle gibt es keine eigene Startseite."}
        </p>
        {ziel && (
          <Link href={ziel.href} className="btn w-fit">
            {ziel.text}
          </Link>
        )}
      </div>
    );
  }

  // ---- Inhalte der Karten ------------------------------------------------
  const c = controlling;
  const controllingZeilen: (Eintrag & { n: number })[] = [
    { key: "anreise", text: "Arbeiten mit offener Anreiseliste", href: "/management/anreiseliste", n: c.anreiseliste, ton: "rot" as const },
    { key: "sv", text: "Über der 15-Wochen-Grenze", href: "/management/sozialversicherung", n: c.sv, ton: "rot" as const },
    { key: "serie", text: "Zu viele Arbeitstage am Stück", href: "/management/arbeitstage", n: c.serie, ton: "rot" as const },
    { key: "urlaub", text: "Urlaub überzogen / abzugelten", href: "/management/urlaub", n: c.urlaub, ton: "rot" as const },
    { key: "stunden", text: `Tage über ${MAX_STUNDEN_PRO_TAG} Stunden`, href: "/management/stundenmonitoring", n: c.stunden, ton: "gelb" as const },
    { key: "abw", text: "Abweichungen nach Auszahlung", href: "/management/auszahlungs-abweichungen", n: c.abweichungen, ton: "gelb" as const },
  ].map((z) => ({ ...z, rechts: z.n, ton: z.n > 0 ? z.ton : ("gruen" as const) }));
  const controllingSumme = controllingZeilen.reduce((s, z) => s + z.n, 0);
  const controllingRot = controllingZeilen.some((z) => z.n > 0 && z.ton === "rot");

  const kassenDifferenz = d.kassen.filter((k) => k.letzterCheck?.status === "Kassendifferenz");
  const maengelHoch = d.maengel.filter((m) => m.schwere === "hoch").length;
  const vHeute = d.vertrieb[0];
  const vOffenTage = d.vertrieb.filter((t) => t.halbtage > 0);
  const vorschlagFehler = d.vorschlaege.filter((v) => v.art === "fehler").length;


  const hinweise: { href: string; text: string; icon: typeof ShieldAlert }[] = [];
  if (!laedt) {
    for (const k of kassenDifferenz) hinweise.push({ href: k.buch.typ === "lohnkasse" ? `/kasse?id=${k.buch.id}` : `/kasse/buch?id=${k.buch.id}`, text: `Kassendifferenz ${k.buch.kuerzel}`, icon: AlertTriangle });
    if (sieht.controlling && c.sv > 0) hinweise.push({ href: "/management/sozialversicherung", text: `${c.sv} über der 15-Wochen-Grenze`, icon: ShieldAlert });
    if (maengelHoch > 0) hinweise.push({ href: "/unterkunft/maengel", text: maengelHoch === 1 ? "1 schwerer Mangel" : `${maengelHoch} schwere Mängel`, icon: Building2 });
    if (vHeute && vHeute.unbesetzt > 0) hinweise.push({ href: "/vertrieb/woche", text: `Heute ${vHeute.unbesetzt} Halbtage ohne Verkäufer`, icon: Store });
    if (sieht.ernte && d.zmSatzFehlt && d.zmPersonen > 0) hinweise.push({ href: "/praemien/zuckermais", text: "Zuckermais-Satz fehlt", icon: Wheat });
    if (sieht.spargelFreigabe && d.spOffen.length > 0)
      hinweise.push({
        href: "/praemien/spargel",
        text: d.spOffen.length === 1 ? "1 Spargeltag freigeben" : `${d.spOffen.length} Spargeltage freigeben`,
        icon: Sprout,
      });
  }
  const alleRuhig = !laedt && !c.loading && hinweise.length === 0 && controllingSumme === 0;


  // ---- Startseite in Kacheln (docs/startseite-kacheln-plan.md) -------------
  // Je Kachel: Dringlichkeit (rot vor gelb vor ruhig), kleine Fassung und
  // Liste für mittel/groß. Nur akute/Tagesinformationen (Nutzer-Vorgabe).
  type Kachel = {
    id: string;
    titel: string;
    ton: "rot" | "gelb" | "ruhig";
    klein: () => React.ReactNode;
    liste: (g: "G" | "M") => React.ReactNode;
  };
  const kacheln: Kachel[] = [];
  const vNahe = d.vProbleme.filter((pp) => pp.datum <= plusTage(heute, 1));
  const problemText = (pp: VertriebProblem) =>
    pp.art === "niemand"
      ? "niemand eingeplant"
      : pp.art === "abwesend"
        ? `${pp.person ?? "Verkäufer"} fehlt${pp.grund ? ` (${pp.grund})` : ""} – kein Ersatz`
        : `${pp.person ?? "Verkäufer"} laut Verfügbarkeit nicht da`;
  const problemEintrag = (pp: VertriebProblem, i: number): Eintrag => ({
    key: `p${pp.datum}-${i}`,
    href: `/vertrieb/druck/tag?datum=${pp.datum}`,
    text: (
      <>
        <span className="inline-block w-20 font-medium">{tag(pp.datum)}</span>
        {pp.stand} {pp.halbtag === "VM" ? "vorm." : "nachm."} · <span className="text-neutral-600">{problemText(pp)}</span>
      </>
    ),
    ton: pp.datum <= plusTage(heute, 1) ? "rot" : "gelb",
  });
  // Anzeige: Fehlende mit Namen einzeln, "niemand eingeplant" je Tag zusammengefasst
  const vEintraege: Eintrag[] = [];
  {
    const tageMitLuecke = new Map<string, VertriebProblem[]>();
    d.vProbleme.forEach((pp, i) => {
      if (pp.art === "niemand") tageMitLuecke.set(pp.datum, [...(tageMitLuecke.get(pp.datum) ?? []), pp]);
      else vEintraege.push(problemEintrag(pp, i));
    });
    for (const [datum, liste] of tageMitLuecke)
      vEintraege.push({
        key: `n${datum}`,
        href: `/vertrieb/druck/tag?datum=${datum}`,
        text: (
          <>
            <span className="inline-block w-20 font-medium">{tag(datum)}</span>
            {liste.length} {liste.length === 1 ? "Halbtag" : "Halbtage"} ohne Verkäufer ·{" "}
            <span className="text-neutral-500">{Array.from(new Set(liste.map((x) => x.stand))).join(", ")}</span>
          </>
        ),
        rechts: liste.length,
        ton: datum <= plusTage(heute, 1) ? "rot" : "gelb",
      });
    vEintraege.sort((a, b) => String(a.key).replace(/^[pn]/, "").localeCompare(String(b.key).replace(/^[pn]/, "")));
  }
  const spinnenOffline = d.spinnen.filter((x) => !x.online && x.personen > 0).length;
  const spinnenOnline = d.spinnen.filter((x) => x.online).length;

  if (sieht.controlling)
    kacheln.push({
      id: "controlling",
      titel: "Controlling",
      ton: controllingRot ? "rot" : controllingSumme > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel icon={Gauge} farbe={controllingRot ? "rot" : "gelb"} titel="Controlling" zahl={controllingSumme} ton={controllingSumme === 0 ? "gruen" : controllingRot ? "rot" : "gelb"} unter="offene Punkte" href="/management" laedt={c.loading} fehler={c.fehler} />
      ),
      liste: (g) => (
        <ListenKarte
              icon={Gauge}
              farbe={controllingRot ? "rot" : "gelb"}
              titel="Controlling"
              zahl={controllingSumme}
              zahlTon={controllingSumme === 0 ? "gruen" : controllingRot ? "rot" : "gelb"}
              laedt={c.loading}
              fehler={c.fehler}
              unter={`Offene Punkte ${CURRENT_YEAR} - Personen, Tage bzw. Serien.`}
              eintraege={[...controllingZeilen].sort((a, b) => Number(b.n > 0) - Number(a.n > 0))}
              link={{ href: "/management", text: "Zum Controlling" }}
          max={g === "G" ? 30 : 6}
          spalten={g === "G" ? 2 : 1}
        />
      ),
    });

  if (sieht.vertrieb)
    kacheln.push({
      id: "vertrieb",
      titel: "Vertrieb",
      ton: vNahe.length > 0 ? "rot" : d.vProbleme.length > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel icon={Store} farbe="blau" titel="Vertrieb" zahl={vHeute && vHeute.halbtage > 0 ? vHeute.unbesetzt : "–"} ton={vNahe.length > 0 ? "rot" : d.vProbleme.length > 0 ? "gelb" : "gruen"} unter={d.vProbleme.length > 0 ? `${d.vProbleme.length} Halbtage offen in 7 Tagen` : "heute offen"} href="/vertrieb/woche" laedt={laedt} fehler={fehler.vertrieb} />
      ),
      liste: (g) => (
        <ListenKarte
          icon={Store}
          farbe="blau"
          titel="Vertrieb"
          zahl={vHeute && vHeute.halbtage > 0 ? vHeute.unbesetzt : undefined}
          zahlTon={vHeute && vHeute.unbesetzt > 0 ? "rot" : "gruen"}
          laedt={laedt}
          fehler={fehler.vertrieb}
          unter={
            vHeute && vHeute.halbtage > 0 ? (
              <div className="flex items-center gap-3">
                <Ring prozent={((vHeute.halbtage - vHeute.unbesetzt) / vHeute.halbtage) * 100} groesse={52} />
                <span>
                  Heute {vHeute.staende} Stände offen, {vHeute.touren} Touren.
                  <br />
                  {vHeute.unbesetzt === 0 ? "Alle Halbtage besetzt." : `${vHeute.unbesetzt} Halbtage ohne Verkäufer.`}
                </span>
              </div>
            ) : (
              "Heute hat kein Stand geöffnet."
            )
          }
          eintraege={vEintraege}
          max={g === "G" ? 40 : 5}
          leer={vHeute && vHeute.halbtage > 0 ? "Die nächsten 7 Tage ist alles besetzt." : "Die nächsten 7 Tage hat kein Stand geöffnet."}
          link={{ href: "/vertrieb/woche", text: vEintraege.length > 5 && g === "M" ? `Alle ${d.vProbleme.length} offenen Halbtage` : "Zum Wochenplan" }}
        />
      ),
    });

  if (sieht.unterkunft)
    kacheln.push({
      id: "unterkunft",
      titel: "Unterkunft",
      ton: maengelHoch > 0 ? "rot" : d.maengel.length + d.auszuegeOffen > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel icon={Building2} farbe="orange" titel="Unterkunft" zahl={d.maengel.length} ton={maengelHoch > 0 ? "rot" : d.maengel.length > 0 ? "gelb" : "gruen"} unter={d.auszuegeOffen > 0 ? `Mängel · ${d.auszuegeOffen} Auszüge offen` : "offene Mängel"} href="/unterkunft/maengel" laedt={laedt} fehler={fehler.unterkunft} />
      ),
      liste: (g) => (
        <ListenKarte
              icon={Building2}
              farbe="orange"
              titel="Unterkunft: Mängel"
              zahl={d.maengel.length}
              zahlTon={maengelHoch > 0 ? "rot" : d.maengel.length > 0 ? "gelb" : "gruen"}
              laedt={laedt}
              fehler={fehler.unterkunft}
              unter={
                d.auszuegeOffen > 0 ? (
                  <Link href="/unterkunft/auszuege" className="hover:underline">
                    {d.auszuegeOffen} Auszüge noch abzunehmen
                  </Link>
                ) : (
                  "Offene und in Arbeit befindliche Mängel"
                )
              }
              eintraege={d.maengel.map((m) => ({
                key: m.id,
                href: "/unterkunft/maengel",
                text: (
                  <>
                    {m.ort && <span className="text-neutral-500">{m.ort} · </span>}
                    {m.beschreibung}
                  </>
                ),
                rechts: UNTERKUNFT_MANGEL_SCHWERE_LABELS[m.schwere],
                ton: m.schwere === "hoch" ? ("rot" as const) : m.schwere === "mittel" ? ("gelb" as const) : ("grau" as const),
              }))}
              leer="Keine offenen Mängel."
              link={{ href: "/unterkunft/maengel", text: "Alle Mängel" }}
          max={g === "G" ? 30 : 5}
          spalten={g === "G" ? 2 : 1}
        />
      ),
    });

  if (sieht.personal)
    kacheln.push({
      id: "personal",
      titel: "Personal",
      ton: d.anreiseNichtGedruckt > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel icon={Users} farbe="lila" titel="Personal" zahl={d.anreiseNichtGedruckt} ton={d.anreiseNichtGedruckt > 0 ? "gelb" : "gruen"} unter="Anreiseliste nicht gedruckt" href="/personal-anreiseliste" laedt={laedt} fehler={fehler.personal} />
      ),
      liste: (g) => (
        <ListenKarte
              icon={Users}
              farbe="lila"
              titel="Personal"
              zahl={d.aktivePersonen}
              laedt={laedt}
              fehler={fehler.personal}
              unter="Aktive Personen im Personalstamm"
              eintraege={[
                { key: "geplant", href: "/personalplanung", text: `Geplant für ${d.planJahr}`, rechts: d.geplant },
                {
                  key: "platz",
                  href: "/personalplanung",
                  text: "davon Platzhalter ohne Namen",
                  rechts: d.platzhalter,
                  ton: d.platzhalter > 0 ? "gelb" : "gruen",
                },
                { key: "liste", href: "/personal-anreiseliste", text: "Auf der Anreiseliste", rechts: d.anreiseliste },
                {
                  key: "druck",
                  href: "/personal-anreiseliste",
                  text: "Anreiseliste noch nicht gedruckt",
                  rechts: d.anreiseNichtGedruckt,
                  ton: d.anreiseNichtGedruckt > 0 ? "gelb" : "gruen",
                },
              ]}
              link={{ href: "/mitarbeiter", text: "Zum Personal" }}
          max={g === "G" ? 30 : 5}
          spalten={g === "G" ? 2 : 1}
        />
      ),
    });

  if (sieht.lohn)
    kacheln.push({
      id: "lohn",
      titel: "Lohn",
      ton: d.abweichungen > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel icon={Receipt} farbe="gruen" titel="Lohn" zahl={d.abweichungen} ton={d.abweichungen > 0 ? "gelb" : "gruen"} unter="Abweichungen nach Auszahlung" href="/management/auszahlungs-abweichungen" laedt={laedt} fehler={fehler.lohn} />
      ),
      liste: (g) => (
        <ListenKarte
              icon={Receipt}
              farbe="gruen"
              titel="Lohn"
              zahl={d.abweichungen}
              zahlTon={d.abweichungen > 0 ? "gelb" : "gruen"}
              laedt={laedt}
              fehler={fehler.lohn}
              unter={`Abweichungen nach Auszahlung (${CURRENT_YEAR})`}
              eintraege={[
                { key: "abw", href: "/management/auszahlungs-abweichungen", text: "Abweichungen ansehen", rechts: d.abweichungen, ton: d.abweichungen > 0 ? "gelb" : "gruen" },
                { key: "aktiv", href: "/uebersicht", text: "Aktive Personen", rechts: d.aktivePersonen },
              ]}
              link={{ href: "/uebersicht", text: "Zur Lohnübersicht" }}
          max={g === "G" ? 30 : 5}
          spalten={g === "G" ? 2 : 1}
        />
      ),
    });

  if (sieht.kasse)
    kacheln.push({
      id: "kasse",
      titel: "Kassen",
      ton: kassenDifferenz.length > 0 ? "rot" : sieht.freigabe && d.ohneFreigabe > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel
          icon={Landmark}
          farbe={kassenDifferenz.length > 0 ? "rot" : "gruen"}
          titel="Kassen"
          zahl={kassenDifferenz.length > 0 ? kassenDifferenz.length : sieht.freigabe ? d.ohneFreigabe : "ok"}
          ton={kassenDifferenz.length > 0 ? "rot" : sieht.freigabe && d.ohneFreigabe > 0 ? "gelb" : "gruen"}
          unter={kassenDifferenz.length > 0 ? "Kassendifferenz" : sieht.freigabe ? "Prüfungen warten auf Freigabe" : "keine Differenz"}
          href={sieht.freigabe ? "/kasse-pruefung" : "/kasse/uebersicht"}
          laedt={laedt}
          fehler={fehler.kasse}
        />
      ),
      liste: (g) => (
        <ListenKarte
              icon={Landmark}
              farbe={kassenDifferenz.length > 0 ? "rot" : "gruen"}
              titel="Kassen"
              zahl={sieht.freigabe ? d.ohneFreigabe : undefined}
              zahlTon={d.ohneFreigabe > 0 ? "gelb" : "gruen"}
              laedt={laedt}
              fehler={fehler.kasse}
              unter={sieht.freigabe ? (d.ohneFreigabe === 1 ? "Kassenprüfung wartet auf Freigabe" : "Kassenprüfungen warten auf Freigabe") : "Saldo je Kassenbuch"}
              eintraege={d.kassen.map((k) => ({
                key: k.buch.id,
                href: k.buch.typ === "lohnkasse" ? `/kasse?id=${k.buch.id}` : `/kasse/buch?id=${k.buch.id}`,
                text: (
                  <span title={k.letzterCheck ? `Letzte Prüfung ${formatDatumDE(k.letzterCheck.check_zeit)}: ${k.letzterCheck.status}, ${k.bewegungenSeit} Bewegung(en) seitdem` : "Noch keine Kassenprüfung"}>
                    <span className="inline-block w-12 font-medium">{k.buch.kuerzel}</span>
                    <span className="text-neutral-500">
                      {k.letzterCheck ? `geprüft ${formatDatumDE(k.letzterCheck.check_zeit)}` : "nie geprüft"}
                      {k.letzterCheck && k.bewegungenSeit > 0 ? ` · ${k.bewegungenSeit} neu` : ""}
                    </span>
                  </span>
                ),
                rechts: `${formatEuro(k.saldo)} €`,
                ton: k.letzterCheck?.status === "Kassendifferenz" ? ("rot" as const) : ("grau" as const),
              }))}
              link={sieht.freigabe ? { href: "/kasse-pruefung", text: "Zur Kassenprüfung" } : { href: "/kasse/uebersicht", text: "Zu den Kassenbüchern" }}
          max={g === "G" ? 30 : 6}
          spalten={g === "G" ? 2 : 1}
        />
      ),
    });

  if (sieht.spargel)
    kacheln.push({
      id: "spargel",
      titel: "Spargel",
      ton: d.spUngeklaert > 0 ? "rot" : d.spOffen.length > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel icon={Sprout} farbe="gruen" titel="Spargel" zahl={d.spTage > 0 || d.spHeuteKisten > 0 ? d.spOffen.length : "–"} ton={d.spUngeklaert > 0 ? "rot" : d.spOffen.length > 0 ? "gelb" : d.spTage > 0 ? "gruen" : "grau"} unter={d.spTage > 0 || d.spHeuteKisten > 0 ? "Tage nicht freigegeben" : "heute keine Ernte"} href="/praemien/spargel" laedt={laedt} fehler={fehler.spargel} />
      ),
      liste: (g) => (
        <ListenKarte
              icon={Sprout}
              farbe="gruen"
              titel="Spargel"
              zahl={d.spOffen.length}
              zahlTon={d.spOffen.length > 0 ? "gelb" : "gruen"}
              laedt={laedt}
              fehler={fehler.spargel}
              unter={
                d.spOffen.length > 0
                  ? d.spOffen.length === 1
                    ? "Erntetag noch nicht freigegeben"
                    : "Erntetage noch nicht freigegeben"
                  : d.spHeuteKisten > 0
                    ? `Heute ${formatZahlDE(d.spHeuteKg)} kg · ${d.spHeuteKisten} Kisten · ${d.spHeuteFelder} ${d.spHeuteFelder === 1 ? "Feld" : "Felder"}`
                    : d.spTage > 0
                      ? "Alle Erntetage freigegeben"
                      : `${CURRENT_YEAR} noch keine Spargelernte erfasst`
              }
              eintraege={[
                ...d.spOffen.slice(0, 3).map((t) => ({ key: t, href: "/praemien/spargel", text: `${datumLang(t)} freigeben`, ton: "gelb" as const, rechts: "offen" })),
                ...(d.spOffen.length > 0 && d.spHeuteKisten > 0
                  ? [{ key: "heute", text: "Heute gewogen", rechts: `${formatZahlDE(d.spHeuteKg)} kg · ${d.spHeuteKisten} Kisten` }]
                  : []),
                ...(d.spUngeklaert > 0
                  ? [{ key: "luecken", href: "/erntewirtschaft/ernte", text: "Kisten ungeklärt / nicht gewogen", rechts: String(d.spUngeklaert), ton: "rot" as const }]
                  : []),
              ]}
              leer={d.spTage > 0 ? "Nichts offen." : "Heute keine Spargelernte."}
              link={sieht.spargelFreigabe && d.spOffen.length > 0 ? { href: "/praemien/spargel", text: "Zu Prüfen & Freigeben" } : { href: "/praemien/spargel", text: "Zu den Spargelprämien" }}
          max={g === "G" ? 30 : 6}
          spalten={g === "G" ? 2 : 1}
        />
      ),
    });

  if (sieht.spinnen)
    kacheln.push({
      id: "spinnen",
      titel: "Spargelspinnen",
      ton: spinnenOffline > 0 || d.spinnenUeberfaellig > 0 ? "rot" : "ruhig",
      klein: () => (
        <KleinKachel icon={Tractor} farbe="gelb" titel="Spargelspinnen" zahl={d.spinnen.length ? `${spinnenOnline}/${d.spinnen.length}` : "–"} ton={spinnenOffline > 0 ? "rot" : "grau"} unter={spinnenOffline > 0 ? `${spinnenOffline} offline in der Schicht` : "online"} href="/erntewirtschaft" laedt={laedt} fehler={fehler.spinnen} />
      ),
      liste: (g) => (
        <ListenKarte
          icon={Tractor}
          farbe="gelb"
          titel="Spargelspinnen"
          zahl={d.spinnen.length ? `${spinnenOnline}/${d.spinnen.length}` : undefined}
          zahlTon={spinnenOffline > 0 ? "rot" : "grau"}
          laedt={laedt}
          fehler={fehler.spinnen}
          unter={
            d.spinnen.length === 0
              ? "Noch keine Spinnen angelegt."
              : `${spinnenOnline} online · ${d.spinnen.reduce((a, x) => a + x.personen, 0)} angemeldet · ${formatZahlDE(d.spinnen.reduce((a, x) => a + x.kg, 0))} kg heute`
          }
          eintraege={[
            ...(spinnenOffline > 0 ? [{ key: "off", href: "/erntewirtschaft", text: "Offline, obwohl jemand angemeldet ist", rechts: spinnenOffline, ton: "rot" as const }] : []),
            ...(d.spinnenUeberfaellig > 0 ? [{ key: "ueb", href: "/erntewirtschaft/ernte", text: "Kisten überfällig (nicht gewogen)", rechts: d.spinnenUeberfaellig, ton: "rot" as const }] : []),
            ...(g === "G"
              ? d.spinnen.map((x) => ({
                  key: `m${x.id}`,
                  href: "/erntewirtschaft",
                  text: `${x.nummer} ${x.bezeichnung ?? ""}`.trim(),
                  rechts: x.online ? `${x.personen} angemeldet · ${formatZahlDE(x.kg)} kg` : "offline",
                  ton: !x.online && x.personen > 0 ? ("rot" as const) : ("grau" as const),
                }))
              : []),
          ]}
          max={g === "G" ? 150 : 5}
          spalten={g === "G" ? 2 : 1}
          leer="Nichts auffällig."
          link={{ href: "/erntewirtschaft", text: "Zum Überblick" }}
        />
      ),
    });

  if (sieht.ernte) {
    const heuteZm = d.zmPersonen > 0;
    kacheln.push({
      id: "zuckermais",
      titel: "Zuckermais",
      ton: heuteZm && d.zmSatzFehlt ? "rot" : "ruhig",
      klein: () => (
        <KleinKachel icon={Wheat} farbe="gelb" titel="Zuckermais" zahl={heuteZm ? d.zmPersonen : "–"} ton={heuteZm && d.zmSatzFehlt ? "rot" : heuteZm ? undefined : "grau"} unter={heuteZm ? (d.zmSatzFehlt ? "Satz fehlt!" : `Personen · ${formatEuro(d.zmSumme)} €`) : "heute keine Ernte"} href="/praemien/zuckermais" laedt={laedt} fehler={fehler.ernte} />
      ),
      liste: (g) => (
        <ListenKarte
          icon={Wheat}
          farbe="gelb"
          titel="Zuckermais"
          zahl={heuteZm ? d.zmPersonen : undefined}
          laedt={laedt}
          fehler={fehler.ernte}
          unter={heuteZm ? `Personen heute · ${formatEuro(d.zmSumme)} € Prämie` : "Heute keine Zuckermaisernte."}
          eintraege={
            heuteZm
              ? [
                  { key: "satz", href: "/praemien/zuckermais", text: "Satz für heute", rechts: d.zmSatzFehlt ? "fehlt" : "hinterlegt", ton: d.zmSatzFehlt ? ("rot" as const) : ("gruen" as const) },
                  ...(g === "G"
                    ? [
                        { key: "qs", href: "/qualitaet", text: "Schichtkontrollen heute", rechts: d.qsKontrollen ? `${d.qsKontrollen} · ${d.qsQuote ?? "–"} % i.O.` : "keine", ton: d.qsKontrollen ? ("grau" as const) : ("gelb" as const) },
                        { key: "na", href: "/qualitaet/strichliste", text: "Nacharbeit heute", rechts: d.nacharbeit === null ? "–" : `${d.nacharbeit.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` },
                      ]
                    : []),
                ]
              : []
          }
          link={{ href: "/praemien/zuckermais", text: "Zu den Zuckermais-Prämien" }}
        />
      ),
    });
    const heuteEb = d.ebPersonen > 0;
    kacheln.push({
      id: "erdbeeren",
      titel: "Erdbeeren",
      ton: "ruhig",
      klein: () => (
        <KleinKachel icon={Cherry} farbe="rot" titel="Erdbeeren" zahl={heuteEb ? d.ebPersonen : "–"} ton={heuteEb ? undefined : "grau"} unter={heuteEb ? `Personen · ${formatEuro(d.ebSumme)} €` : "heute keine Ernte"} href="/praemien/erdbeeren" laedt={laedt} fehler={fehler.ernte} />
      ),
      liste: (g) => (
        <ListenKarte
          icon={Cherry}
          farbe="rot"
          titel="Erdbeeren"
          zahl={heuteEb ? d.ebPersonen : undefined}
          laedt={laedt}
          fehler={fehler.ernte}
          unter={heuteEb ? `Personen heute · ${formatEuro(d.ebSumme)} € Prämie` : "Heute keine Erdbeerernte."}
          eintraege={d.ebFelder.map((f) => ({ key: f.feld, href: "/praemien/erdbeeren", text: f.feld, rechts: `${f.personen} Pers. · ${formatEuro(f.praemie)} €` }))}
          max={g === "G" ? 30 : 4}
          spalten={g === "G" ? 2 : 1}
          link={{ href: "/praemien/erdbeeren", text: "Zu den Erdbeer-Prämien" }}
        />
      ),
    });
  }

  if (sieht.vorschlaege)
    kacheln.push({
      id: "vorschlaege",
      titel: "Vorschläge",
      ton: vorschlagFehler > 0 ? "rot" : d.vorschlaege.length > 0 ? "gelb" : "ruhig",
      klein: () => (
        <KleinKachel icon={Lightbulb} farbe="gelb" titel="Vorschläge" zahl={d.vorschlaege.length} ton={vorschlagFehler > 0 ? "rot" : d.vorschlaege.length > 0 ? "gelb" : "gruen"} unter={vorschlagFehler > 0 ? `${vorschlagFehler} „Etwas geht nicht“` : "offen"} href="/vorschlaege" laedt={laedt} fehler={fehler.vorschlaege} />
      ),
      liste: (g) => (
        <ListenKarte
              icon={Lightbulb}
              farbe="gelb"
              titel="Vorschläge"
              zahl={d.vorschlaege.length}
              zahlTon={vorschlagFehler > 0 ? "rot" : d.vorschlaege.length > 0 ? "gelb" : "gruen"}
              laedt={laedt}
              fehler={fehler.vorschlaege}
              unter={vorschlagFehler > 0 ? `${vorschlagFehler} davon „Etwas geht nicht“` : "Offen, über die Glühbirne eingereicht"}
              eintraege={d.vorschlaege.map((v) => {
                const a = ARTEN.find((x) => x.wert === v.art);
                return {
                  key: v.id,
                  href: "/vorschlaege",
                  text: (
                    <>
                      {a && <a.Icon className={`mr-1.5 inline h-3.5 w-3.5 ${v.art === "fehler" ? "text-beere-600" : "text-neutral-400"}`} />}
                      {v.text}
                    </>
                  ),
                  rechts: formatDatumDE(v.erstellt_am),
                };
              })}
              leer="Nichts offen."
              link={{ href: "/vorschlaege", text: "Alle Vorschläge" }}
          max={g === "G" ? 30 : 3}
          spalten={g === "G" ? 2 : 1}
        />
      ),
    });

  if (sieht.protokoll) {
    const heuteAenderungen = d.protokoll.filter((a) => a.occurred_at.slice(0, 10) === heute).length;
    kacheln.push({
      id: "protokoll",
      titel: "Zuletzt geändert",
      ton: "ruhig",
      klein: () => (
        <KleinKachel icon={History} farbe="grau" titel="Zuletzt geändert" zahl={heuteAenderungen} ton="grau" unter="Änderungen heute" href="/aenderungsprotokoll" laedt={laedt} fehler={fehler.protokoll} />
      ),
      liste: (g) => (
        <ListenKarte
          icon={History}
          farbe="grau"
          titel="Zuletzt geändert"
          laedt={laedt}
          fehler={fehler.protokoll}
          eintraege={d.protokoll.map((a, i) => ({
            key: i,
            href: "/aenderungsprotokoll",
            text: (
              <>
                <span className="inline-block w-24 tabular-nums text-neutral-500">
                  {new Date(a.occurred_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-medium">{bereichLabel(a.entity)}</span> <span className="text-neutral-500">{aktionLabel(a.action)}</span>
              </>
            ),
            rechts: a.actor_name ?? "System",
          }))}
          max={g === "G" ? 15 : 6}
          spalten={g === "G" ? 2 : 1}
          leer="Keine Einträge."
          link={{ href: "/aenderungsprotokoll", text: "Änderungsprotokoll" }}
        />
      ),
    });
  }

  const TON_RANG = { rot: 0, gelb: 1, ruhig: 2 };
  const groesseVon = (id: string) => groessen[id] ?? "M";
  const sortiert = kacheln
    .map((k, i) => ({ ...k, i }))
    .sort((a, b) => TON_RANG[a.ton] - TON_RANG[b.ton] || a.i - b.i);
  const ausgeblendet = kacheln.filter((k) => groesseVon(k.id) === "aus");

  const fehlerListe = Object.values(fehler);

  return (
    <div className="flex flex-col gap-8">
      <Begruessung
        datum={datumZeile}
        titel={laedt ? `Hallo ${vorname}.` : alleRuhig ? `Hallo ${vorname}, alles im grünen Bereich.` : `Hallo ${vorname}, das steht an.`}
        hinweise={hinweise}
      />

      {!laedt && fehlerListe.length > 0 && (
        <p className="text-sm text-beere-700" title={fehlerListe.join("\n")}>
          Einige Zahlen konnten nicht geladen werden - die betroffenen Karten zeigen einen Strich.
        </p>
      )}

      {!laedt && (
        <div className="-mt-4 flex flex-wrap items-center justify-end gap-3 text-sm">
          {anpassen ? (
            <>
              <span className="text-neutral-500">Je Kachel Größe wählen: G = groß, M = mittel, K = klein, Aus = ausblenden.</span>
              <button type="button" className="btn-secondary" onClick={() => groessenSpeichern({})}>
                <RotateCcw className="h-4 w-4" />
                Alles mittel
              </button>
              <button type="button" className="btn" onClick={() => setAnpassen(false)}>
                Fertig
              </button>
            </>
          ) : (
            <button type="button" className="inline-flex items-center gap-1.5 text-neutral-500 hover:text-emerald-800" onClick={() => setAnpassen(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              Startseite anpassen
            </button>
          )}
        </div>
      )}

      {(["G", "M", "K"] as const).map((g) => {
        const liste = sortiert.filter((k) => groesseVon(k.id) === g);
        if (liste.length === 0) return null;
        return (
          <div
            key={g}
            className={`grid gap-4 ${g === "G" ? "xl:grid-cols-2" : g === "M" ? "md:grid-cols-2 xl:grid-cols-3" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"}`}
          >
            {liste.map((k, i) => (
              <div
                key={k.id}
                className={`flex min-w-0 flex-col gap-1.5 ${g === "G" && i === liste.length - 1 && liste.length % 2 === 1 ? "xl:col-span-2" : ""}`}
              >
                {anpassen && <GroessenWahl id={k.id} titel={k.titel} wert={g} onChange={groesseSetzen} />}
                <div className="min-w-0 flex-1">{g === "K" ? k.klein() : k.liste(g)}</div>
              </div>
            ))}
          </div>
        );
      })}

      {anpassen && ausgeblendet.length > 0 && (
        <div className="rounded-xl border border-dashed border-linie bg-white p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Ausgeblendet</h2>
          <div className="flex flex-wrap gap-2">
            {ausgeblendet.map((k) => (
              <button key={k.id} type="button" className="btn-secondary" onClick={() => groesseSetzen(k.id, "M")}>
                <Eye className="h-4 w-4" />
                {k.titel} einblenden
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
