"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import MaisStatistikKachel from "@/components/MaisStatistikKachel";

const CURRENT_YEAR = new Date().getFullYear();
// Muss zum Wert auf der Management-Seite passen (app/management/page.tsx).
const MAX_STUNDEN_PRO_TAG = 12;

interface LetzterCheck {
  check_zeit: string;
  status: string;
  freigegeben: boolean;
}

interface AuditZeile {
  occurred_at: string;
  actor_id: string | null;
  entity: string;
  action: string;
}

function Kachel({
  href,
  titel,
  wert,
  unterzeile,
  ton = "neutral",
}: {
  href: string;
  titel: string;
  wert: string;
  unterzeile?: string;
  ton?: "neutral" | "warn" | "ok";
}) {
  const farbe =
    ton === "warn"
      ? "text-red-600"
      : ton === "ok"
      ? "text-emerald-700"
      : "text-neutral-800";
  return (
    <Link
      href={href}
      className="block rounded border border-neutral-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm"
    >
      <p className="text-sm text-neutral-500">{titel}</p>
      <p className={`text-2xl font-semibold ${farbe}`}>{wert}</p>
      {unterzeile && (
        <p className="mt-1 text-xs text-neutral-500">{unterzeile}</p>
      )}
    </Link>
  );
}

export default function DashboardPage() {
  const { profile } = useProfile();
  const [loading, setLoading] = useState(true);

  // hr
  const [anreiselisteOffen, setAnreiselisteOffen] = useState(0);
  const [svKritisch, setSvKritisch] = useState(0);

  // kasse
  const [kassenSaldo, setKassenSaldo] = useState(0);
  const [letzterCheck, setLetzterCheck] = useState<LetzterCheck | null>(null);
  const [bewegungenSeitPruefung, setBewegungenSeitPruefung] = useState(0);

  // lohnabrechnung
  const [abweichungen, setAbweichungen] = useState(0);
  const [aktivePersonen, setAktivePersonen] = useState(0);

  // pruefer
  const [wartetAufFreigabe, setWartetAufFreigabe] = useState(0);
  const [auditEintraege, setAuditEintraege] = useState<AuditZeile[]>([]);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});

  // management
  const [stundenmonitoring, setStundenmonitoring] = useState(0);

  // erntewirtschaft (Nutzer-Vorgabe 2026-08-09) - Kurzüberblick über den
  // heutigen Tag, da diese Rolle nur Prämien/Statistik sieht.
  const [zmHeuteAnzahl, setZmHeuteAnzahl] = useState(0);
  const [zmHeuteSumme, setZmHeuteSumme] = useState(0);
  const [zmSatzFehlt, setZmSatzFehlt] = useState(false);
  const [ebHeuteAnzahl, setEbHeuteAnzahl] = useState(0);
  const [ebHeuteSumme, setEbHeuteSumme] = useState(0);

  const zeigeHr = profile?.role === "admin" || profile?.role === "hr";
  const zeigeKasse = profile?.role === "admin" || profile?.role === "kasse";
  const zeigeLohnabrechnung =
    profile?.role === "admin" || profile?.role === "lohnabrechnung";
  const zeigePruefer = profile?.role === "admin" || profile?.role === "pruefer";
  const zeigeManagement =
    profile?.role === "admin" || profile?.role === "management";
  const zeigeErntewirtschaft =
    profile?.role === "admin" || profile?.role === "erntewirtschaft";
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

    async function ladeAnreiseliste(supabase: ReturnType<typeof getSupabaseClient>) {
      const { count } = await supabase
        .from("personal_kandidaten")
        .select("id", { count: "exact", head: true })
        .eq("status", "anreiseliste")
        .eq("gedruckt", false);
      setAnreiselisteOffen(count ?? 0);
    }

    async function ladeSvKritisch(supabase: ReturnType<typeof getSupabaseClient>) {
      const { count } = await supabase
        .from("employee_sv_pruefung")
        .select("employee_id", { count: "exact", head: true })
        .eq("saison_jahr", CURRENT_YEAR)
        .eq("kritisch", true);
      setSvKritisch(count ?? 0);
    }

    async function ladeKasse(supabase: ReturnType<typeof getSupabaseClient>) {
      const [{ data: dep }, { data: adv }, { data: az }, { data: chk }] =
        await Promise.all([
          supabase.from("cash_deposits").select("betrag, storniert"),
          supabase
            .from("advances")
            .select("betrag, datum, storniert")
            .eq("zahlungsart", "BAR"),
          supabase
            .from("auszahlungsbeleg_summary")
            .select("summe_auszahlungsbetrag, erstellt_am")
            .eq("zahlungsart", "BAR"),
          supabase
            .from("cash_checks")
            .select("check_zeit, status, freigegeben")
            .order("check_zeit", { ascending: false })
            .limit(1),
        ]);
      const einzahlungenSumme = (dep ?? [])
        .filter((d: any) => !d.storniert)
        .reduce((s: number, d: any) => s + Number(d.betrag), 0);
      const vorschuesseSumme = (adv ?? [])
        .filter((a: any) => !a.storniert)
        .reduce((s: number, a: any) => s + Number(a.betrag), 0);
      const auszahlungenSumme = (az ?? []).reduce(
        (s: number, a: any) => s + Number(a.summe_auszahlungsbetrag ?? 0),
        0
      );
      setKassenSaldo(einzahlungenSumme - vorschuesseSumme - auszahlungenSumme);

      const letzter = (chk ?? [])[0] as LetzterCheck | undefined;
      setLetzterCheck(letzter ?? null);
      const seit = letzter?.check_zeit ?? null;

      const [{ count: advCount }, { count: bewCount }, { count: azCount }] =
        await Promise.all([
          seit
            ? supabase
                .from("advances")
                .select("id", { count: "exact", head: true })
                .eq("zahlungsart", "BAR")
                .eq("storniert", false)
                .gt("datum", seit)
            : supabase
                .from("advances")
                .select("id", { count: "exact", head: true })
                .eq("zahlungsart", "BAR")
                .eq("storniert", false),
          seit
            ? supabase
                .from("kassenbewegungen")
                .select("id", { count: "exact", head: true })
                .eq("zahlungsart", "BAR")
                .gt("zeitstempel", seit)
            : supabase
                .from("kassenbewegungen")
                .select("id", { count: "exact", head: true })
                .eq("zahlungsart", "BAR"),
          seit
            ? supabase
                .from("auszahlungsbeleg_summary")
                .select("id", { count: "exact", head: true })
                .eq("zahlungsart", "BAR")
                .gt("erstellt_am", seit)
            : supabase
                .from("auszahlungsbeleg_summary")
                .select("id", { count: "exact", head: true })
                .eq("zahlungsart", "BAR"),
        ]);
      setBewegungenSeitPruefung(
        (advCount ?? 0) + (bewCount ?? 0) + (azCount ?? 0)
      );
    }

    async function ladeAbweichungen(supabase: ReturnType<typeof getSupabaseClient>) {
      const { data: rows } = await supabase
        .from("season_summary")
        .select("employee_id, snapshot, auszahlungsbetrag")
        .eq("saison_jahr", CURRENT_YEAR)
        .not("snapshot", "is", null);
      const anzahl = (rows ?? []).filter(
        (r: any) =>
          r.snapshot &&
          "auszahlungsbetrag" in r.snapshot &&
          Math.abs(
            Number(r.snapshot.auszahlungsbetrag ?? 0) -
              Number(r.auszahlungsbetrag ?? 0)
          ) > 0.005
      ).length;
      setAbweichungen(anzahl);
    }

    async function ladeAktivePersonen(supabase: ReturnType<typeof getSupabaseClient>) {
      const { count } = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("aktiv", true);
      setAktivePersonen(count ?? 0);
    }

    async function ladePruefer(supabase: ReturnType<typeof getSupabaseClient>) {
      const [{ count }, { data: log }, { data: namen }] = await Promise.all([
        supabase
          .from("cash_checks")
          .select("id", { count: "exact", head: true })
          .eq("freigegeben", false),
        supabase
          .from("audit_log")
          .select("occurred_at, actor_id, entity, action")
          .order("occurred_at", { ascending: false })
          .limit(8),
        supabase.from("profile_namen").select("*"),
      ]);
      setWartetAufFreigabe(count ?? 0);
      setAuditEintraege((log as AuditZeile[]) ?? []);
      const map: Record<string, string> = {};
      (namen ?? []).forEach((p: any) => {
        map[p.id] = p.full_name;
      });
      setNamenVon((prev) => ({ ...prev, ...map }));
    }

    async function ladeStundenmonitoring(supabase: ReturnType<typeof getSupabaseClient>) {
      const { data } = await supabase
        .from("work_entries")
        .select("employee_id, stunden, datum")
        .gt("stunden", MAX_STUNDEN_PRO_TAG)
        .gte("datum", `${CURRENT_YEAR}-01-01`)
        .lte("datum", `${CURRENT_YEAR}-12-31`);
      const distinct = new Set((data ?? []).map((r: any) => r.employee_id));
      setStundenmonitoring(distinct.size);
    }

    async function ladeErntewirtschaft(supabase: ReturnType<typeof getSupabaseClient>) {
      const heute = new Date().toISOString().slice(0, 10);
      const [{ data: zm }, { data: eb }, { data: satzHeute }] =
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
        ]);
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
      setLoading(false);
    }
    load();
    // profile?.role reicht als Abhängigkeit - die zeige*-Variablen hängen
    // nur davon ab und ändern sich nie unabhängig davon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, keinDashboard]);

  if (!profile) {
    return <p className="text-neutral-500">Lädt…</p>;
  }

  if (keinDashboard) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-emerald-800">
          Willkommen, {profile.full_name}
        </h1>
        <p className="text-sm text-neutral-500">
          Für deine Rolle gibt es aktuell kein eigenes Dashboard.
        </p>
        <Link href="/erfassung" className="btn w-fit">
          Zur Stundenerfassung
        </Link>
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
                />
                <Kachel
                  href="/management"
                  titel={`90-Tage-/15-Wochen-Grenze (${CURRENT_YEAR})`}
                  wert={String(svKritisch)}
                  unterzeile="Personen mit überschrittener Grenze"
                  ton={svKritisch > 0 ? "warn" : "ok"}
                />
              </div>
            </section>
          )}

          {zeigeKasse && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Kassenbuch
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/kasse"
                  titel="Aktueller Kassensaldo"
                  wert={`${kassenSaldo.toFixed(2)} €`}
                />
                <Kachel
                  href="/kasse"
                  titel="Letzte Kassenprüfung"
                  wert={
                    letzterCheck
                      ? new Date(letzterCheck.check_zeit).toLocaleDateString(
                          "de-DE"
                        )
                      : "—"
                  }
                  unterzeile={
                    letzterCheck
                      ? `${letzterCheck.status}${
                          letzterCheck.freigegeben ? " · freigegeben" : ""
                        }`
                      : "Noch keine Prüfung erfasst"
                  }
                  ton={
                    letzterCheck && letzterCheck.status === "Kassendifferenz"
                      ? "warn"
                      : "neutral"
                  }
                />
                <Kachel
                  href="/kasse"
                  titel="Bewegungen seit letzter Prüfung"
                  wert={String(bewegungenSeitPruefung)}
                  ton={bewegungenSeitPruefung > 0 ? "warn" : "ok"}
                />
              </div>
            </section>
          )}

          {zeigeLohnabrechnung && (
            <section>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Lohn
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/management"
                  titel={`Abweichungen bei Auszahlungen (${CURRENT_YEAR})`}
                  wert={String(abweichungen)}
                  ton={abweichungen > 0 ? "warn" : "ok"}
                />
                <Kachel
                  href="/mitarbeiter"
                  titel="Aktive Personen"
                  wert={String(aktivePersonen)}
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
                  href="/kasse"
                  titel="Kassenprüfungen ohne Freigabe"
                  wert={String(wartetAufFreigabe)}
                  ton={wartetAufFreigabe > 0 ? "warn" : "ok"}
                />
              </div>
              <div className="mt-3">
                <h3 className="mb-1 text-sm font-semibold text-neutral-700">
                  Letzte Audit-Log-Einträge
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
                          <td>{a.entity}</td>
                          <td>{a.action}</td>
                          <td>
                            {a.actor_id
                              ? namenVon[a.actor_id] ?? "—"
                              : "—"}
                          </td>
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
                Management
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Kachel
                  href="/management"
                  titel={`90-Tage-/15-Wochen-Grenze (${CURRENT_YEAR})`}
                  wert={String(svKritisch)}
                  ton={svKritisch > 0 ? "warn" : "ok"}
                />
                <Kachel
                  href="/management"
                  titel={`Stundenmonitoring (${CURRENT_YEAR})`}
                  wert={String(stundenmonitoring)}
                  unterzeile={`Personen mit Tag(en) über ${MAX_STUNDEN_PRO_TAG} Std.`}
                  ton={stundenmonitoring > 0 ? "warn" : "ok"}
                />
                <Kachel
                  href="/management"
                  titel={`Abweichungen bei Auszahlungen (${CURRENT_YEAR})`}
                  wert={String(abweichungen)}
                  ton={abweichungen > 0 ? "warn" : "ok"}
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
                  unterzeile={`${zmHeuteSumme.toFixed(2)} € Prämie heute`}
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
                />
                <Kachel
                  href="/praemien/erdbeeren"
                  titel="Erdbeeren - erfasste Personen heute"
                  wert={String(ebHeuteAnzahl)}
                  unterzeile={`${ebHeuteSumme.toFixed(2)} € Prämie heute (alle Parzellen)`}
                />
                <Kachel
                  href="/statistik/zuckermais"
                  titel="Statistik"
                  wert="Öffnen"
                  unterzeile="Tages-/Saisonauswertung Zuckermais & Erdbeeren"
                />
                {profile?.role === "admin" && (
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
