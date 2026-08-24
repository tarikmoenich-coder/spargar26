"use client";

// Arbeitskleidung: Ausgabe-Log (Nutzer-Vorgabe 2026-08-24: "Ich möchte
// einen Datumsstempel bekommen... die Größen, die ausgegeben wurden").
// Ersetzt das bisherige Modell (eine überschreibbare Gesamtzahl je
// Person/Saison) durch ein Ausgabe-Log - jede Ausgabe ein eigener,
// zeitgestempelter Eintrag mit Größe, per Storno statt Überschreiben
// korrigierbar. Erfasst von admin/hr/zeiterfassung über die security-
// definer Funktionen arbeitskleidung_ausgabe_buchen/-stornieren - landet
// weiterhin als eigene, sichtbare Abzugsposition in der Lohnübersicht
// (wie Buskosten/Kautionen), siehe arbeitskleidung_bestand_synchronisieren
// in schema.sql. Der Lagerbestand selbst (Anfangsbestand/Inventur) lebt
// seit 2026-08-25 auf einer eigenen Seite "Lager" (nur admin/hr, Nutzer-
// Vorgabe: "'Stundenerfassung' macht nur die Ausgabe") - siehe
// app/lager/page.tsx.

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { uebersetzung } from "@/lib/i18n";
import { formatEuro } from "@/lib/format";
import ErfassungTabs from "@/components/ErfassungTabs";
import { TYPEN, TYP_BADGE_CLASS, groessenFuer } from "@/lib/arbeitskleidung";
import type {
  Arbeitsgruppe,
  Employee,
  KleidungAusgabe,
  KleidungTyp,
  ProfilName,
  VerpflegungsSatz,
} from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

interface Entwurf {
  typ: KleidungTyp;
  groesse: string;
  anzahl: string;
}

function leererEntwurf(): Entwurf {
  return { typ: "Hose", groesse: groessenFuer("Hose")[0], anzahl: "1" };
}

export default function ArbeitskleidungPage() {
  const { profile } = useProfile();
  const t = uebersetzung(profile?.sprache);
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";
  const canSeeLagerLink = profile?.role === "admin" || profile?.role === "hr";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [ausgaben, setAusgaben] = useState<KleidungAusgabe[]>([]);
  const [namenVon, setNamenVon] = useState<Record<string, string>>({});
  const [satz, setSatz] = useState<VerpflegungsSatz | null>(null);
  const [gruppeFilter, setGruppeFilter] = useState("");
  // Nutzer-Vorgabe 2026-08-24: gleicher Suchfilter wie auf der
  // Stundenerfassung (Name/Personalnummer), zusätzlich zum Gruppe-Filter.
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [offenEmployeeId, setOffenEmployeeId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Record<string, Entwurf>>({});
  const [speichernId, setSpeichernId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: gr }, { data: ausg }, { data: saetze }, { data: namen }] =
      await Promise.all([
        supabase
          .from("employees")
          // Bewusst kein "select *" (2026-08-09-Vorfall, siehe schema.sql) -
          // diese Seite ist auch für zeiterfassung erreichbar, die keine
          // sensiblen Felder (SV-Nr./IBAN/...) sehen soll.
          .select("id, personal_nr, gruppe_nr, name, vorname, aktiv")
          .eq("aktiv", true)
          .order("name"),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
        // Kein Zeilenlimit nötig - eine Saison hat realistisch nur wenige
        // hundert Ausgaben, kein Kassenbuch-Umfang.
        supabase
          .from("kleidung_ausgaben")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR)
          .order("datum", { ascending: false }),
        supabase
          .from("verpflegungssaetze")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR)
          .maybeSingle(),
        supabase.from("profile_namen").select("*"),
      ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    setAusgaben((ausg as KleidungAusgabe[]) ?? []);
    setSatz((saetze as VerpflegungsSatz) ?? null);
    const namenMap: Record<string, string> = {};
    ((namen as ProfilName[]) ?? []).forEach((p) => {
      namenMap[p.id] = p.full_name;
    });
    setNamenVon(namenMap);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function entwurfFuer(empId: string): Entwurf {
    return entwurf[empId] ?? leererEntwurf();
  }
  function entwurfAendern(empId: string, patch: Partial<Entwurf>) {
    setEntwurf((prev) => ({
      ...prev,
      [empId]: { ...entwurfFuer(empId), ...patch },
    }));
  }

  async function ausgeben(empId: string) {
    const werte = entwurfFuer(empId);
    const anzahl = Number(werte.anzahl);
    if (!anzahl || anzahl <= 0) {
      setFehler("Anzahl muss größer als 0 sein.");
      return;
    }
    setSpeichernId(empId);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("arbeitskleidung_ausgabe_buchen", {
      p_employee_id: empId,
      p_saison_jahr: CURRENT_YEAR,
      p_typ: werte.typ,
      p_groesse: werte.groesse,
      p_anzahl: anzahl,
    });
    setSpeichernId(null);
    if (error) {
      setFehler(error.message);
      return;
    }
    setEntwurf((prev) => {
      const next = { ...prev };
      delete next[empId];
      return next;
    });
    load();
  }

  async function stornieren(ausgabe: KleidungAusgabe) {
    const grund = window.prompt(t("arbeitskleidung.stornogrundprompt"));
    if (!grund) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("arbeitskleidung_ausgabe_stornieren", {
      p_ausgabe_id: ausgabe.id,
      p_grund: grund,
    });
    if (error) {
      setFehler(error.message);
      return;
    }
    load();
  }

  const gefiltert = employees.filter((e) => {
    if (gruppeFilter && e.gruppe_nr !== gruppeFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  const keinePreiseHinterlegt =
    !satz?.kleidung_hose && !satz?.kleidung_jacke && !satz?.kleidung_stiefel;

  const typLabel: Record<KleidungTyp, string> = {
    Hose: t("arbeitskleidung.typhose"),
    Jacke: t("arbeitskleidung.typjacke"),
    Stiefel: t("arbeitskleidung.typstiefel"),
  };
  // Preis je Stück direkt am Typ-Namen, damit beim Ausgeben sofort
  // sichtbar ist, was das für den Lohnabzug bedeutet.
  const typPreis: Record<KleidungTyp, number | null | undefined> = {
    Hose: satz?.kleidung_hose,
    Jacke: satz?.kleidung_jacke,
    Stiefel: satz?.kleidung_stiefel,
  };
  function typLabelMitPreis(typ: KleidungTyp): string {
    const preis = typPreis[typ];
    return preis ? `${typLabel[typ]} (${formatEuro(preis)} €)` : typLabel[typ];
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <ErfassungTabs />
        <p className="text-neutral-500">
          {t("arbeitskleidung.keineberechtigung")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ErfassungTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          {t("arbeitskleidung.title", { jahr: CURRENT_YEAR })}
        </h1>
        <p className="text-sm text-neutral-500">
          {t("arbeitskleidung.untertitel")}
          {canSeeLagerLink && (
            <>
              {" "}
              Lagerbestand siehe{" "}
              <Link href="/lager" className="text-emerald-700 underline">
                Lager
              </Link>
              .
            </>
          )}
        </p>
      </div>

      {keinePreiseHinterlegt && !loading && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {t("arbeitskleidung.keinepreise", { jahr: CURRENT_YEAR })}
        </p>
      )}

      {fehler && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          ⚠ {fehler}
        </p>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-emerald-800">
            {t("arbeitskleidung.ausgabeerfassen")}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <input
              placeholder="Suche nach Name oder Personalnummer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            <label className="text-sm">
              {t("erfassung.gruppe")}{" "}
              <select
                value={gruppeFilter}
                onChange={(e) => setGruppeFilter(e.target.value)}
              >
                <option value="">{t("gemeinsam.alle")}</option>
                {gruppen.map((g) => (
                  <option key={g.gruppe_nr} value={g.gruppe_nr}>
                    {g.gruppe_nr} – {g.bezeichnung}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <p className="text-neutral-500">{t("gemeinsam.laedt")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("erfassung.persnr")}</th>
                <th>{t("erfassung.name")}</th>
                <th>{t("erfassung.gruppe")}</th>
                <th>{t("arbeitskleidung.historie")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((emp) => {
                const offen = offenEmployeeId === emp.id;
                const eigeneAusgaben = ausgaben.filter(
                  (a) => a.employee_id === emp.id
                );
                const werte = entwurfFuer(emp.id);
                const zusammenfassung = eigeneAusgaben
                  .filter((a) => !a.storniert)
                  .map(
                    (a) =>
                      `${a.anzahl}× ${typLabel[a.typ]} (${a.groesse})`
                  )
                  .join(", ");
                return (
                  <Fragment key={emp.id}>
                    <tr>
                      <td>{emp.personal_nr}</td>
                      <td>
                        {emp.name}, {emp.vorname}
                      </td>
                      <td>{emp.gruppe_nr ?? "—"}</td>
                      <td className="text-sm text-neutral-600">
                        {zusammenfassung || "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() =>
                            setOffenEmployeeId(offen ? null : emp.id)
                          }
                        >
                          {offen
                            ? t("gemeinsam.einklappen")
                            : t("gemeinsam.aufklappen")}
                        </button>
                      </td>
                    </tr>
                    {offen && (
                      <tr>
                        <td colSpan={5} className="bg-neutral-50">
                          <div className="flex flex-col gap-3 p-2">
                            <div className="flex flex-wrap items-end gap-3">
                              <label className="text-sm">
                                {t("arbeitskleidung.typ")}{" "}
                                <select
                                  value={werte.typ}
                                  onChange={(e) => {
                                    const typ = e.target.value as KleidungTyp;
                                    entwurfAendern(emp.id, {
                                      typ,
                                      groesse: groessenFuer(typ)[0],
                                    });
                                  }}
                                >
                                  {TYPEN.map((typ) => (
                                    <option key={typ} value={typ}>
                                      {typLabelMitPreis(typ)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-sm">
                                {t("arbeitskleidung.groesse")}{" "}
                                <select
                                  value={werte.groesse}
                                  onChange={(e) =>
                                    entwurfAendern(emp.id, {
                                      groesse: e.target.value,
                                    })
                                  }
                                >
                                  {groessenFuer(werte.typ).map((g) => (
                                    <option key={g} value={g}>
                                      {g}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-sm">
                                {t("arbeitskleidung.anzahl")}{" "}
                                <input
                                  type="number"
                                  min={1}
                                  className="w-16"
                                  value={werte.anzahl}
                                  onChange={(e) =>
                                    entwurfAendern(emp.id, {
                                      anzahl: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="btn text-xs"
                                disabled={speichernId === emp.id}
                                onClick={() => ausgeben(emp.id)}
                              >
                                {t("arbeitskleidung.ausgeben")}
                              </button>
                            </div>

                            {eigeneAusgaben.length === 0 ? (
                              <p className="text-sm text-neutral-500">
                                {t("arbeitskleidung.bishernichts")}
                              </p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>{t("gemeinsam.datum")}</th>
                                      <th>{t("arbeitskleidung.typ")}</th>
                                      <th>{t("arbeitskleidung.groesse")}</th>
                                      <th>{t("arbeitskleidung.anzahl")}</th>
                                      <th>{t("arbeitskleidung.bearbeiter")}</th>
                                      <th></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {eigeneAusgaben.map((a) => (
                                      <tr
                                        key={a.id}
                                        className={a.storniert ? "opacity-50" : ""}
                                      >
                                        <td>
                                          {new Date(a.datum).toLocaleString(
                                            "de-DE"
                                          )}
                                        </td>
                                        <td>
                                          <span
                                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TYP_BADGE_CLASS[a.typ]}`}
                                          >
                                            {typLabel[a.typ]}
                                          </span>
                                        </td>
                                        <td>{a.groesse}</td>
                                        <td>{a.anzahl}</td>
                                        <td>
                                          {a.bearbeiter_id
                                            ? namenVon[a.bearbeiter_id] ?? "—"
                                            : "—"}
                                        </td>
                                        <td>
                                          {a.storniert ? (
                                            <span
                                              className="text-xs text-neutral-500"
                                              title={a.storno_grund ?? ""}
                                            >
                                              {t("arbeitskleidung.storniert")}
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              className="btn-secondary text-xs"
                                              onClick={() => stornieren(a)}
                                            >
                                              {t("arbeitskleidung.stornieren")}
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
