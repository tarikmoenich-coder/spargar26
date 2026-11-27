"use client";

// Startseite (Neubau 2026-11-26 im Stil der QM-App, Nutzer: "Das Design von
// der QM-Seite gefällt uns sehr gut", die alte Seite war eine lange Liste
// je Rolle mit doppelten Kacheln).
//
// Aufbau: Begrüßung mit Datum + rote Hinweise oben rechts (nur was wirklich
// brennt) · "Zu erledigen": eine Karte je Bereich mit Zahl und den
// wichtigsten Einträgen · "Ernte heute" nur in der Saison bzw. wenn heute
// etwas erfasst ist · "Zuletzt geändert" für Admin/Prüfer.
// Jede Karte erscheint nur, wenn die Rolle den Bereich auch öffnen darf
// (MENUE_RECHTE); die Controlling-Zahlen kommen aus demselben Hook wie die
// Controlling-Seite, damit überall dieselbe Zahl steht.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Gauge,
  History,
  Landmark,
  Lightbulb,
  Receipt,
  ShieldAlert,
  Sprout,
  Store,
  Users,
  Wheat,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE, formatEuro, formatZahlDE } from "@/lib/format";
import MaisStatistikKachel from "@/components/MaisStatistikKachel";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { heuteLokalIso } from "@/lib/datum";
import { MAX_STUNDEN_PRO_TAG, findeAbweichungen } from "@/lib/controlling";
import { aktionLabel, bereichLabel } from "@/lib/auditLog";
import { useControllingCounts } from "@/lib/useControllingCounts";
import { datumLang, kalenderwoche, tagesplanBerechnen } from "@/lib/tagesplan";
import { saisonVon, tagesplanDatenLaden } from "@/lib/tagesplanLaden";
import { ARTEN } from "@/components/VorschlagKnopf";
import { Abschnitt, Begruessung, Kennzahl, ListenKarte, Ring, type Eintrag } from "@/components/Uebersicht";
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

type Fehler = Partial<Record<"kasse" | "personal" | "lohn" | "unterkunft" | "vertrieb" | "vorschlaege" | "protokoll" | "ernte", string>>;

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
  vorschlaege: { id: number; art: string; text: string; erstellt_am: string }[];
  protokoll: { occurred_at: string; actor_name: string | null; entity: string; action: string }[];
  zmPersonen: number;
  zmSumme: number;
  zmSatzFehlt: boolean;
  ebPersonen: number;
  ebSumme: number;
  kolbenSaison: number;
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
  vorschlaege: [],
  protokoll: [],
  zmPersonen: 0,
  zmSumme: 0,
  zmSatzFehlt: false,
  ebPersonen: 0,
  ebSumme: 0,
  kolbenSaison: 0,
};

const SCHWERE_RANG: Record<string, number> = { hoch: 0, mittel: 1, gering: 2 };

export default function DashboardPage() {
  const { profile, loading: profilLaedt } = useProfile();
  const [d, setD] = useState<Daten>(LEER);
  const [fehler, setFehler] = useState<Fehler>({});
  const [laedt, setLaedt] = useState(true);

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
      ernte: darf(profile, "ernte.anbau:S"),
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
    const neu: Daten = { ...LEER };
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
        tage.push({
          datum,
          staende: new Set(offen.map((x) => x.stand_id)).size,
          halbtage: offen.length,
          unbesetzt: offen.filter((x) => !x.emp || x.abwesend).length,
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
        .limit(6);
      merke("protokoll", error);
      neu.protokoll = (data as Daten["protokoll"]) ?? [];
    }

    async function ernte() {
      const [zm, eb, satz, kolben] = await Promise.all([
        sb.from("zuckermais_praemie_tag").select("employee_id, praemie").eq("datum", heute),
        sb.from("erdbeeren_praemie_tag").select("employee_id, praemie").eq("datum", heute),
        sb.from("zuckermais_saetze").select("id").lte("gueltig_ab", heute).order("gueltig_ab", { ascending: false }).limit(1).maybeSingle(),
        sb.from("zuckermais_statistik_tag").select("summe_kolben").gte("datum", `${CURRENT_YEAR}-01-01`).lte("datum", `${CURRENT_YEAR}-12-31`),
      ]);
      merke("ernte", zm.error ?? eb.error ?? satz.error ?? kolben.error);
      type P = { employee_id: string; praemie: number | null };
      const zmR = (zm.data as P[]) ?? [];
      const ebR = (eb.data as P[]) ?? [];
      neu.zmPersonen = new Set(zmR.map((r) => r.employee_id)).size;
      neu.zmSumme = zmR.reduce((s, r) => s + Number(r.praemie ?? 0), 0);
      neu.zmSatzFehlt = !satz.data;
      neu.ebPersonen = new Set(ebR.map((r) => r.employee_id)).size;
      neu.ebSumme = ebR.reduce((s, r) => s + Number(r.praemie ?? 0), 0);
      neu.kolbenSaison = ((kolben.data as { summe_kolben: number | null }[]) ?? []).reduce((s, r) => s + Number(r.summe_kolben ?? 0), 0);
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

  // Ernte-Abschnitt nur in der Saison (April-Oktober) oder wenn heute schon
  // etwas erfasst ist - im Winter stand dort sonst eine Reihe Nullen.
  const monat = Number(heute.slice(5, 7));
  const ernteZeigen = sieht.ernte && (d.zmPersonen + d.ebPersonen > 0 || (monat >= 4 && monat <= 10));

  const hinweise: { href: string; text: string; icon: typeof ShieldAlert }[] = [];
  if (!laedt) {
    for (const k of kassenDifferenz) hinweise.push({ href: k.buch.typ === "lohnkasse" ? `/kasse?id=${k.buch.id}` : `/kasse/buch?id=${k.buch.id}`, text: `Kassendifferenz ${k.buch.kuerzel}`, icon: AlertTriangle });
    if (sieht.controlling && c.sv > 0) hinweise.push({ href: "/management/sozialversicherung", text: `${c.sv} über der 15-Wochen-Grenze`, icon: ShieldAlert });
    if (maengelHoch > 0) hinweise.push({ href: "/unterkunft/maengel", text: maengelHoch === 1 ? "1 schwerer Mangel" : `${maengelHoch} schwere Mängel`, icon: Building2 });
    if (vHeute && vHeute.unbesetzt > 0) hinweise.push({ href: "/vertrieb/woche", text: `Heute ${vHeute.unbesetzt} Halbtage ohne Verkäufer`, icon: Store });
    if (ernteZeigen && d.zmSatzFehlt && d.zmPersonen > 0) hinweise.push({ href: "/praemien/zuckermais", text: "Zuckermais-Satz fehlt", icon: Wheat });
  }
  const alleRuhig = !laedt && !c.loading && hinweise.length === 0 && controllingSumme === 0;

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

      <Abschnitt titel="Zu erledigen">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sieht.controlling && (
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
              max={6}
              link={{ href: "/management", text: "Zum Controlling" }}
            />
          )}

          {sieht.vertrieb && (
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
              eintraege={vOffenTage
                .filter((t) => t.datum !== heute)
                .map((t) => ({
                  key: t.datum,
                  href: `/vertrieb/druck/tag?datum=${t.datum}`,
                  text: (
                    <>
                      <span className="inline-block w-20 font-medium">{tag(t.datum)}</span>
                      {t.staende} Stände{t.aenderungen > 0 ? ` · ${t.aenderungen} geändert` : ""}
                    </>
                  ),
                  rechts: t.unbesetzt > 0 ? `${t.unbesetzt} offen` : "besetzt",
                  ton: t.unbesetzt > 0 ? ("rot" as const) : ("gruen" as const),
                }))}
              max={6}
              leer={vHeute && vHeute.halbtage > 0 ? undefined : "Die nächsten 7 Tage hat kein Stand geöffnet."}
              link={{ href: "/vertrieb/woche", text: "Zum Wochenplan" }}
            />
          )}

          {sieht.unterkunft && (
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
            />
          )}

          {sieht.personal && (
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
            />
          )}

          {sieht.lohn && (
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
            />
          )}

          {sieht.kasse && (
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
              max={6}
              link={sieht.freigabe ? { href: "/kasse-pruefung", text: "Zur Kassenprüfung" } : { href: "/kasse/uebersicht", text: "Zu den Kassenbüchern" }}
            />
          )}

          {sieht.vorschlaege && (
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
            />
          )}
        </div>
      </Abschnitt>

      {ernteZeigen && (
        <Abschnitt titel="Ernte heute">
          {fehler.ernte ? (
            <p className="text-sm text-beere-700">Prämien konnten nicht geladen werden.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kennzahl icon={Wheat} titel="Zuckermais" wert={laedt ? "…" : `${d.zmPersonen} Pers.`} unter={`${formatEuro(d.zmSumme)} € Prämie`} href="/praemien/zuckermais" />
              <Kennzahl
                icon={Receipt}
                titel="Zuckermais-Satz"
                wert={laedt ? "…" : d.zmSatzFehlt ? "fehlt" : "hinterlegt"}
                ton={d.zmSatzFehlt ? "rot" : "gruen"}
                unter={d.zmSatzFehlt ? "Norm/Preis nachtragen, sonst 0 €" : "für heute gültig"}
                href="/praemien/zuckermais"
              />
              <Kennzahl icon={Sprout} titel="Erdbeeren" wert={laedt ? "…" : `${d.ebPersonen} Pers.`} unter={`${formatEuro(d.ebSumme)} € Prämie`} href="/praemien/erdbeeren" />
              <Kennzahl icon={Wheat} titel={`Kolben ${CURRENT_YEAR}`} wert={laedt ? "…" : formatZahlDE(d.kolbenSaison)} unter="Saison bis heute" href="/statistik/zuckermais" />
            </div>
          )}
          {!laedt && d.kolbenSaison > 0 && (
            <div className="mt-4">
              <MaisStatistikKachel />
            </div>
          )}
        </Abschnitt>
      )}

      {sieht.protokoll && (
        <Abschnitt
          titel="Zuletzt geändert"
          rechts={
            <Link href="/aenderungsprotokoll" className="font-medium text-emerald-700 hover:underline">
              Änderungsprotokoll →
            </Link>
          }
        >
          <div className="rounded-xl border border-linie bg-white shadow-card">
            {fehler.protokoll ? (
              <p className="p-4 text-sm text-beere-700">Konnte nicht geladen werden.</p>
            ) : d.protokoll.length === 0 ? (
              <p className="p-4 text-sm text-neutral-500">{laedt ? "Lädt…" : "Keine Einträge."}</p>
            ) : (
              <ul className="divide-y divide-linie text-sm">
                {d.protokoll.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
                    <History className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    <span className="w-28 shrink-0 tabular-nums text-neutral-500">
                      {new Date(a.occurred_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="font-medium">{bereichLabel(a.entity)}</span>
                    <span className="text-neutral-500">{aktionLabel(a.action)}</span>
                    <span className="ml-auto text-neutral-500">{a.actor_name ?? "System"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Abschnitt>
      )}
    </div>
  );
}
