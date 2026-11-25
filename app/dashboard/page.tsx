"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatEuro, formatZahlDE } from "@/lib/format";
import MaisStatistikKachel from "@/components/MaisStatistikKachel";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { heuteLokalIso } from "@/lib/datum";
import { MAX_STUNDEN_PRO_TAG, findeAbweichungen } from "@/lib/controlling";
import { aktionLabel, bereichLabel } from "@/lib/auditLog";
import type { Kassenbuch, SeasonSummaryRow } from "@/lib/types";

import { hatRolle, rollenVon } from "@/lib/rollen";
const CURRENT_YEAR = new Date().getFullYear();

interface LetzterCheck {
  check_zeit: string;
  status: string;
  freigegeben: boolean;
}

// Kassen-Kachel je Kassenbuch (Rundum-Check 2026-11-25): Saldo, letzte
// Prüfung und Bewegungen seitdem je Buch - wie app/kasse/uebersicht.
interface KassenKachel {
  buch: Kassenbuch;
  saldo: number;
  letzterCheck: LetzterCheck | null;
  bewegungenSeit: number;
}

interface AuditZeile {
  occurred_at: string;
  actor_name: string | null;
  entity: string;
  action: string;
}

// Fehlerschlüssel je Kachelgruppe - bei einem Ladefehler zeigt die Kachel
// "—" statt einer (falschen) grünen 0.
type FehlerKey =
  | "anreise"
  | "sv"
  | "kasse"
  | "abweichungen"
  | "aktive"
  | "pruefer"
  | "stunden"
  | "ernte";

// Supabase-Fehler aus einer ladeAlleSeiten-Abfrage mitschneiden
// (ladeAlleSeiten selbst bricht bei einem Fehler nur still ab).
function mitFehler<T extends { data: unknown[] | null; error: { message: string } | null }>(
  merke: (msg: string) => void,
  hole: () => PromiseLike<T>
): PromiseLike<T> {
  return Promise.resolve(hole()).then((r) => {
    if (r.error) merke(r.error.message);
    return r;
  });
}

function Kachel({
  href,
  titel,
  wert,
  unterzeile,
  ton = "neutral",
  icon: Icon,
  fehler,
}: {
  href: string;
  titel: string;
  wert: string;
  unterzeile?: string;
  ton?: "neutral" | "warn" | "ok";
  icon?: LucideIcon;
  fehler?: string;
}) {
  if (fehler) {
    wert = "—";
    unterzeile = "Konnte nicht geladen werden";
    ton = "neutral";
  }
  const farbe =
    ton === "warn"
      ? "text-beere-600"
      : ton === "ok"
      ? "text-emerald-700"
      : "text-neutral-800";
  const badge =
    ton === "warn"
      ? "bg-beere-50 text-beere-600"
      : ton === "ok"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-neutral-100 text-neutral-500";
  return (
    <Link
      href={href}
      className="block rounded-lg border border-linie bg-white p-4 shadow-card transition hover:border-emerald-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-neutral-500">{titel}</p>
        {Icon && (
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${badge}`}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className={`mt-1 text-2xl font-semibold ${farbe}`}>{wert}</p>
      {unterzeile && (
        <p className="mt-1 text-xs text-neutral-500">{unterzeile}</p>
      )}
    </Link>
  );
}

export default function DashboardPage() {
  const { profile, loading: profilLaedt } = useProfile();
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<Partial<Record<FehlerKey, string>>>({});

  // hr
  const [anreiselisteOffen, setAnreiselisteOffen] = useState(0);
  const [svKritisch, setSvKritisch] = useState(0);

  // kasse
  const [kassen, setKassen] = useState<KassenKachel[]>([]);

  // lohnabrechnung
  const [abweichungen, setAbweichungen] = useState(0);
  const [aktivePersonen, setAktivePersonen] = useState(0);

  // pruefer
  const [wartetAufFreigabe, setWartetAufFreigabe] = useState(0);
  const [auditEintraege, setAuditEintraege] = useState<AuditZeile[]>([]);

  // management
  const [stundenmonitoring, setStundenmonitoring] = useState(0);

  // erntewirtschaft (Nutzer-Vorgabe 2026-08-09) - Kurzüberblick über die
  // Prämien des heutigen Tages (Flotte/Waage/Ernte: Menüpunkt
  // Erntewirtschaft).
  const [zmHeuteAnzahl, setZmHeuteAnzahl] = useState(0);
  const [zmHeuteSumme, setZmHeuteSumme] = useState(0);
  const [zmSatzFehlt, setZmSatzFehlt] = useState(false);
  const [ebHeuteAnzahl, setEbHeuteAnzahl] = useState(0);
  const [ebHeuteSumme, setEbHeuteSumme] = useState(0);
  const [zmKolbenSaison, setZmKolbenSaison] = useState(0);

  const zeigeHr = hatRolle(profile, "admin", "hr");
  const zeigeKasse = hatRolle(profile, "admin", "kasse");
  const zeigeLohnabrechnung =
    hatRolle(profile, "admin", "lohnabrechnung");
  const zeigePruefer = hatRolle(profile, "admin", "pruefer");
  const zeigeManagement =
    hatRolle(profile, "admin", "management");
  const zeigeErntewirtschaft =
    hatRolle(profile, "admin", "erntewirtschaft");
  const keinDashboard =
    !!profile &&
    !zeigeHr &&
    !zeigeKasse &&
    !zeigeLohnabrechnung &&
    !zeigePruefer &&
    !zeigeManagement &&
    !zeigeErntewirtschaft;

  useEffect(() => {
    if (!profile) return;
    if (keinDashboard) {
      setLoading(false);
      return;
    }
    const fehlerNeu: Partial<Record<FehlerKey, string>> = {};
    const merke = (key: FehlerKey) => (msg: string) => {
      fehlerNeu[key] = msg;
    };

    async function ladeAnreiseliste(supabase: ReturnType<typeof getSupabaseClient>) {
      const { count, error } = await supabase
        .from("personal_kandidaten")
        .select("id", { count: "exact", head: true })
        .eq("status", "anreiseliste")
        .eq("gedruckt", false);
      if (error) merke("anreise")(error.message);
      setAnreiselisteOffen(count ?? 0);
    }

    async function ladeSvKritisch(supabase: ReturnType<typeof getSupabaseClient>) {
      const { count, error } = await supabase
        .from("employee_sv_pruefung")
        .select("employee_id", { count: "exact", head: true })
        .eq("saison_jahr", CURRENT_YEAR)
        .eq("kritisch", true);
      if (error) merke("sv")(error.message);
      setSvKritisch(count ?? 0);
    }

    async function ladeKasse(supabase: ReturnType<typeof getSupabaseClient>) {
      // Je Kassenbuch (MLK/ML/MD/MÖ, seit 2026-11-24 mit Prüfung je Buch):
      // Saldo über kassenbuch_saldo_bis, letzte Prüfung dieses Buchs und
      // Bewegungen seitdem über kassenbuch_bewegungen_seit - dieselbe Logik
      // wie app/kasse/uebersicht/page.tsx.
      const [{ data: buecherRoh, error: buchErr }, { data: checksRoh, error: chkErr }] =
        await Promise.all([
          supabase.from("kassenbuch").select("*").eq("aktiv", true).order("reihenfolge"),
          supabase
            .from("cash_checks")
            .select("kassenbuch_id, check_zeit, status, freigegeben")
            .order("check_zeit", { ascending: false }),
        ]);
      if (buchErr || chkErr) {
        merke("kasse")((buchErr ?? chkErr)!.message);
        return;
      }
      const buecher = (buecherRoh as Kassenbuch[]) ?? [];
      const letzte = new Map<number, LetzterCheck>();
      for (const c of (checksRoh as (LetzterCheck & { kassenbuch_id: number })[]) ?? []) {
        if (!letzte.has(c.kassenbuch_id)) letzte.set(c.kassenbuch_id, c);
      }
      const ergebnis = await Promise.all(
        buecher.map(async (b): Promise<KassenKachel> => {
          const lc = letzte.get(b.id) ?? null;
          const [saldoRes, bewRes] = await Promise.all([
            supabase.rpc("kassenbuch_saldo_bis", { p_kassenbuch_id: b.id }),
            lc
              ? supabase.rpc("kassenbuch_bewegungen_seit", {
                  p_kassenbuch_id: b.id,
                  p_seit: lc.check_zeit,
                })
              : Promise.resolve({ data: 0, error: null }),
          ]);
          if (saldoRes.error) merke("kasse")(saldoRes.error.message);
          if (bewRes.error) merke("kasse")(bewRes.error.message);
          return {
            buch: b,
            saldo: saldoRes.data == null ? 0 : Number(saldoRes.data),
            letzterCheck: lc,
            bewegungenSeit: bewRes.data == null ? 0 : Number(bewRes.data),
          };
        })
      );
      setKassen(ergebnis);
    }

    async function ladeAbweichungen(supabase: ReturnType<typeof getSupabaseClient>) {
      // Gleiche Prüfung wie im Controlling (findeAbweichungen, alle Felder),
      // seitenweise wegen der 1000-Zeilen-Grenze.
      const rows = await ladeAlleSeiten<SeasonSummaryRow>((von, bis) =>
        mitFehler(merke("abweichungen"), () =>
          supabase
            .from("season_summary")
            .select("*")
            .eq("saison_jahr", CURRENT_YEAR)
            .not("snapshot", "is", null)
            .order("employee_id")
            .range(von, bis)
        )
      );
      setAbweichungen(rows.filter((r) => findeAbweichungen(r).length > 0).length);
    }

    async function ladeAktivePersonen(supabase: ReturnType<typeof getSupabaseClient>) {
      const { count, error } = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("aktiv", true);
      if (error) merke("aktive")(error.message);
      setAktivePersonen(count ?? 0);
    }

    async function ladePruefer(supabase: ReturnType<typeof getSupabaseClient>) {
      const [{ count, error }, { data: log, error: logErr }] = await Promise.all([
        supabase
          .from("cash_checks")
          .select("id", { count: "exact", head: true })
          .eq("freigegeben", false),
        supabase
          .from("audit_log_ansicht")
          .select("occurred_at, actor_name, entity, action")
          .order("occurred_at", { ascending: false })
          .limit(8),
      ]);
      if (error || logErr) merke("pruefer")((error ?? logErr)!.message);
      setWartetAufFreigabe(count ?? 0);
      setAuditEintraege((log as AuditZeile[]) ?? []);
    }

    async function ladeStundenmonitoring(supabase: ReturnType<typeof getSupabaseClient>) {
      const data = await ladeAlleSeiten<{ employee_id: string }>((von, bis) =>
        mitFehler(merke("stunden"), () =>
          supabase
            .from("work_entries")
            .select("id, employee_id")
            .gt("stunden", MAX_STUNDEN_PRO_TAG)
            .gte("datum", `${CURRENT_YEAR}-01-01`)
            .lte("datum", `${CURRENT_YEAR}-12-31`)
            .order("id")
            .range(von, bis)
        )
      );
      setStundenmonitoring(new Set(data.map((r) => r.employee_id)).size);
    }

    async function ladeErntewirtschaft(supabase: ReturnType<typeof getSupabaseClient>) {
      const heute = heuteLokalIso();
      const [
        { data: zm, error: e1 },
        { data: eb, error: e2 },
        { data: satzHeute, error: e3 },
        { data: zmSaison, error: e4 },
      ] =
        await Promise.all([
          supabase
            .from("zuckermais_praemie_tag")
            .select("employee_id, praemie")
            .eq("datum", heute),
          supabase
            .from("erdbeeren_praemie_tag")
            .select("employee_id, praemie")
            .eq("datum", heute),
          supabase
            .from("zuckermais_saetze")
            .select("id")
            .lte("gueltig_ab", heute)
            .order("gueltig_ab", { ascending: false })
            .limit(1)
            .maybeSingle(),
          // Saison-Summe Kolben bis heute (Nutzer-Vorgabe 2026-08-09) - aus
          // der bereits pro Tag aggregierten Statistik-Sicht, nicht aus den
          // einzelnen Rohdaten-Zeilen.
          supabase
            .from("zuckermais_statistik_tag")
            .select("summe_kolben")
            .gte("datum", `${CURRENT_YEAR}-01-01`)
            .lte("datum", `${CURRENT_YEAR}-12-31`),
        ]);
      const ernteFehler = e1 ?? e2 ?? e3 ?? e4;
      if (ernteFehler) merke("ernte")(ernteFehler.message);
      const zmRows = zm ?? [];
      const ebRows = eb ?? [];
      setZmHeuteAnzahl(new Set(zmRows.map((r: any) => r.employee_id)).size);
      setZmHeuteSumme(
        zmRows.reduce((s: number, r: any) => s + Number(r.praemie ?? 0), 0)
      );
      setZmSatzFehlt(!satzHeute);
      setEbHeuteAnzahl(new Set(ebRows.map((r: any) => r.employee_id)).size);
      setEbHeuteSumme(
        ebRows.reduce((s: number, r: any) => s + Number(r.praemie ?? 0), 0)
      );
      setZmKolbenSaison(
        (zmSaison ?? []).reduce(
          (s: number, r: any) => s + Number(r.summe_kolben ?? 0),
          0
        )
      );
    }

    async function load() {
      setLoading(true);
      const supabase = getSupabaseClient();
      await Promise.all([
        zeigeHr ? ladeAnreiseliste(supabase) : null,
        zeigeHr || zeigeManagement ? ladeSvKritisch(supabase) : null,
        zeigeKasse ? ladeKasse(supabase) : null,
        zeigeLohnabrechnung || zeigeManagement
          ? ladeAbweichungen(supabase)
          : null,
        zeigeLohnabrechnung ? ladeAktivePersonen(supabase) : null,
        zeigePruefer ? ladePruefer(supabase) : null,
        zeigeManagement ? ladeStundenmonitoring(supabase) : null,
        zeigeErntewirtschaft ? ladeErntewirtschaft(supabase) : null,
      ]);
      setFehler(fehlerNeu);
      setLoading(false);
    }
    load();
    // profile reicht als Abhängigkeit - die zeige*-Variablen hängen
    // nur davon ab und ändern sich nie unabhängig davon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, keinDashboard]);

  if (!profile) {
    return (
      <p className="text-neutral-500">
        {profilLaedt
          ? "Lädt…"
          : "Für dein Konto ist kein Profil hinterlegt oder es konnte nicht geladen werden. Bitte wende dich an den Administrator."}
      </p>
    );
  }

  if (keinDashboard) {
    const ziel =
      rollenVon(profile).length === 0
        ? null
        : hatRolle(profile, "hausmeister")
          ? { href: "/unterkunft/reparaturen", text: "Zu den Reparaturen" }
          : hatRolle(profile, "zeiterfassung")
            ? { href: "/erfassung", text: "Zur Stundenerfassung" }
            : hatRolle(profile, "waage")
              ? { href: "/erntewirtschaft/waage/kiosk", text: "Zum Waagen-Kiosk" }
              : null;
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-emerald-800">
          Willkommen, {profile.full_name}
        </h1>
        <p className="text-sm text-neutral-500">
          {rollenVon(profile).length === 0
            ? "Dein Konto ist deaktiviert oder hat keine aktive Rolle. Bitte wende dich an den Administrator."
            : "Für deine Rolle gibt es aktuell kein eigenes Dashboard."}
        </p>
        {ziel && (
          <Link href={ziel.href} className="btn w-fit">
            {ziel.text}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Willkommen, {profile.full_name}
        </h1>
        <p className="text-sm text-neutral-500">
          Kurzüberblick über das, was gerade Aufmerksamkeit braucht.
        </p>
      </div>

      {!loading && Object.keys(fehler).length > 0 && (
        <p className="text-sm text-beere-600">
          ⚠ Einige Kennzahlen konnten nicht geladen werden (
          {Object.values(fehler).join(" · ")}).
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          {zeigeHr && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Personal
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/personal-anreiseliste"
                  titel="Anreiseliste - noch nicht gedruckt"
                  wert={String(anreiselisteOffen)}
                  ton={anreiselisteOffen > 0 ? "warn" : "ok"}
                  fehler={fehler.anreise}
                />
                <Kachel
                  href="/management/sozialversicherung"
                  titel={`15-Wochen-Grenze (105 Tage, ${CURRENT_YEAR})`}
                  wert={String(svKritisch)}
                  unterzeile="Personen mit überschrittener Grenze"
                  ton={svKritisch > 0 ? "warn" : "ok"}
                  fehler={fehler.sv}
                />
              </div>
            </section>
          )}

          {zeigeKasse && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Kassenbücher
              </h2>
              {fehler.kasse ? (
                <p className="text-sm text-beere-600">
                  Kassenbücher konnten nicht geladen werden.
                </p>
              ) : kassen.length === 0 ? (
                <p className="text-sm text-neutral-500">Keine Kassenbücher sichtbar.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {kassen.map(({ buch, saldo, letzterCheck, bewegungenSeit }) => (
                    <Kachel
                      key={buch.id}
                      href={
                        buch.typ === "lohnkasse"
                          ? `/kasse?id=${buch.id}`
                          : `/kasse/buch?id=${buch.id}`
                      }
                      titel={`${buch.bezeichnung} (${buch.kuerzel})`}
                      wert={`${formatEuro(saldo)} €`}
                      unterzeile={
                        letzterCheck
                          ? `Letzte Prüfung ${new Date(
                              letzterCheck.check_zeit
                            ).toLocaleDateString("de-DE")}: ${letzterCheck.status}${
                              letzterCheck.freigegeben ? " · freigegeben" : ""
                            } · ${bewegungenSeit} Bewegung(en) seitdem`
                          : "Noch keine Kassenprüfung erfasst"
                      }
                      ton={
                        letzterCheck?.status === "Kassendifferenz"
                          ? "warn"
                          : "neutral"
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {zeigeLohnabrechnung && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Lohn
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/management/auszahlungs-abweichungen"
                  titel={`Abweichungen bei Auszahlungen (${CURRENT_YEAR})`}
                  wert={String(abweichungen)}
                  ton={abweichungen > 0 ? "warn" : "ok"}
                  fehler={fehler.abweichungen}
                />
                <Kachel
                  href="/uebersicht"
                  titel="Aktive Personen (Lohnübersicht)"
                  wert={String(aktivePersonen)}
                  fehler={fehler.aktive}
                />
              </div>
            </section>
          )}

          {zeigePruefer && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Prüfung
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/kasse-pruefung"
                  titel="Kassenprüfungen ohne Freigabe"
                  wert={String(wartetAufFreigabe)}
                  ton={wartetAufFreigabe > 0 ? "warn" : "ok"}
                  fehler={fehler.pruefer}
                />
              </div>
              <div className="mt-3">
                <h3 className="mb-1 text-sm font-semibold text-neutral-700">
                  Letzte Einträge im Änderungsprotokoll{" "}
                  <Link
                    href="/aenderungsprotokoll"
                    className="ml-1 text-xs font-normal text-emerald-700 underline"
                  >
                    Alle Einträge →
                  </Link>
                </h3>
                {auditEintraege.length === 0 ? (
                  <p className="text-sm text-neutral-500">Keine Einträge.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Zeitpunkt</th>
                        <th>Bereich</th>
                        <th>Aktion</th>
                        <th>Anwender</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEintraege.map((a, i) => (
                        <tr key={i}>
                          <td>
                            {new Date(a.occurred_at).toLocaleString("de-DE")}
                          </td>
                          <td>{bereichLabel(a.entity)}</td>
                          <td>{aktionLabel(a.action)}</td>
                          <td>{a.actor_name ?? "System"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {zeigeManagement && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Controlling
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/management/sozialversicherung"
                  titel={`15-Wochen-Grenze (105 Tage, ${CURRENT_YEAR})`}
                  wert={String(svKritisch)}
                  ton={svKritisch > 0 ? "warn" : "ok"}
                  fehler={fehler.sv}
                />
                <Kachel
                  href="/management/stundenmonitoring"
                  titel={`Stundenmonitoring (${CURRENT_YEAR})`}
                  wert={String(stundenmonitoring)}
                  unterzeile={`Personen mit Tag(en) über ${MAX_STUNDEN_PRO_TAG} Std. (Controlling zählt die Tage)`}
                  ton={stundenmonitoring > 0 ? "warn" : "ok"}
                  fehler={fehler.stunden}
                />
                <Kachel
                  href="/management/auszahlungs-abweichungen"
                  titel={`Abweichungen bei Auszahlungen (${CURRENT_YEAR})`}
                  wert={String(abweichungen)}
                  ton={abweichungen > 0 ? "warn" : "ok"}
                  fehler={fehler.abweichungen}
                />
              </div>
            </section>
          )}

          {zeigeErntewirtschaft && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Prämien heute
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/praemien/zuckermais"
                  titel="Zuckermais - erfasste Personen heute"
                  wert={String(zmHeuteAnzahl)}
                  unterzeile={`${formatEuro(zmHeuteSumme)} € Prämie heute`}
                  fehler={fehler.ernte}
                />
                <Kachel
                  href="/praemien/zuckermais"
                  titel="Zuckermais - Satz für heute"
                  wert={zmSatzFehlt ? "Fehlt" : "Hinterlegt"}
                  unterzeile={
                    zmSatzFehlt
                      ? "Norm/Preis nachtragen, sonst 0 € Prämie"
                      : undefined
                  }
                  ton={zmSatzFehlt ? "warn" : "ok"}
                  fehler={fehler.ernte}
                />
                <Kachel
                  href="/praemien/erdbeeren"
                  titel="Erdbeeren - erfasste Personen heute"
                  wert={String(ebHeuteAnzahl)}
                  unterzeile={`${formatEuro(ebHeuteSumme)} € Prämie heute (alle Parzellen)`}
                  fehler={fehler.ernte}
                />
                <Kachel
                  href="/statistik/zuckermais"
                  titel="Anzahl Kolben bis heute"
                  wert={formatZahlDE(zmKolbenSaison)}
                  unterzeile="Zuckermais, Saison-Summe - Details in der Statistik"
                  fehler={fehler.ernte}
                />
                {hatRolle(profile, "admin") && (
                  <Kachel
                    href="/praemien/gruppenaufteilung"
                    titel="Gruppenaufteilung"
                    wert="Öffnen"
                    unterzeile="Wer ist welcher Prämien-Erfassung zugeordnet"
                  />
                )}
              </div>
              <div className="mt-4">
                <MaisStatistikKachel />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
