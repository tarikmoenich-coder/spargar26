"use client";

// Arbeitskleidung-Ausgabe (Nutzer-Vorgabe 2026-08-09): nur Hose/Jacke/
// Stiefel werden berechnet - Spargelmesser/Feile/Handschuhe sind
// Verbrauchsgegenstände (kostenloser Tausch), werden hier bewusst nicht
// erfasst. Erfasst von der Rolle zeiterfassung (gibt die Kleidung aus),
// über die security-definer Funktion arbeitskleidung_setzen - landet als
// eigene, sichtbare Abzugsposition in der Lohnübersicht (wie
// Buskosten/Kautionen).

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { uebersetzung } from "@/lib/i18n";
import ErfassungTabs from "@/components/ErfassungTabs";
import type {
  Arbeitsgruppe,
  Employee,
  EmployeeKleidungAusgabe,
  VerpflegungsSatz,
} from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

interface Entwurf {
  hose: string;
  jacke: string;
  stiefel: string;
}

export default function ArbeitskleidungPage() {
  const { profile } = useProfile();
  const t = uebersetzung(profile?.sprache);
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [ausgabe, setAusgabe] = useState<
    Record<string, EmployeeKleidungAusgabe>
  >({});
  const [satz, setSatz] = useState<VerpflegungsSatz | null>(null);
  const [gruppeFilter, setGruppeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [entwurf, setEntwurf] = useState<Record<string, Entwurf>>({});
  const [speichernId, setSpeichernId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: gr }, { data: ausg }, { data: saetze }] =
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
        supabase
          .from("employee_kleidung_ausgabe")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR),
        supabase
          .from("verpflegungssaetze")
          .select("*")
          .eq("saison_jahr", CURRENT_YEAR)
          .maybeSingle(),
      ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    const map: Record<string, EmployeeKleidungAusgabe> = {};
    ((ausg as EmployeeKleidungAusgabe[]) ?? []).forEach((a) => {
      map[a.employee_id] = a;
    });
    setAusgabe(map);
    setSatz((saetze as VerpflegungsSatz) ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function werteFuer(empId: string): Entwurf {
    if (entwurf[empId]) return entwurf[empId];
    const a = ausgabe[empId];
    return {
      hose: a?.kleidung_hose_anzahl ? String(a.kleidung_hose_anzahl) : "",
      jacke: a?.kleidung_jacke_anzahl ? String(a.kleidung_jacke_anzahl) : "",
      stiefel: a?.kleidung_stiefel_anzahl
        ? String(a.kleidung_stiefel_anzahl)
        : "",
    };
  }

  function feldAendern(empId: string, feld: keyof Entwurf, wert: string) {
    setEntwurf((prev) => ({
      ...prev,
      [empId]: { ...werteFuer(empId), [feld]: wert },
    }));
  }

  async function speichern(empId: string) {
    const werte = werteFuer(empId);
    setSpeichernId(empId);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("arbeitskleidung_setzen", {
      p_employee_id: empId,
      p_saison_jahr: CURRENT_YEAR,
      p_hose_anzahl: Number(werte.hose) || 0,
      p_jacke_anzahl: Number(werte.jacke) || 0,
      p_stiefel_anzahl: Number(werte.stiefel) || 0,
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

  const gefiltert = employees.filter(
    (e) => !gruppeFilter || e.gruppe_nr === gruppeFilter
  );

  const keinePreiseHinterlegt =
    !satz?.kleidung_hose && !satz?.kleidung_jacke && !satz?.kleidung_stiefel;

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

      {loading ? (
        <p className="text-neutral-500">{t("gemeinsam.laedt")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("erfassung.persnr")}</th>
              <th>{t("erfassung.name")}</th>
              <th>{t("erfassung.gruppe")}</th>
              <th>{t("arbeitskleidung.hose")}</th>
              <th>{t("arbeitskleidung.jacke")}</th>
              <th>{t("arbeitskleidung.stiefel")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((emp) => {
              const werte = werteFuer(emp.id);
              return (
                <tr key={emp.id}>
                  <td>{emp.personal_nr}</td>
                  <td>
                    {emp.name}, {emp.vorname}
                  </td>
                  <td>{emp.gruppe_nr ?? "—"}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      className="w-16"
                      value={werte.hose}
                      onChange={(e) =>
                        feldAendern(emp.id, "hose", e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      className="w-16"
                      value={werte.jacke}
                      onChange={(e) =>
                        feldAendern(emp.id, "jacke", e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      className="w-16"
                      value={werte.stiefel}
                      onChange={(e) =>
                        feldAendern(emp.id, "stiefel", e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={speichernId === emp.id}
                      onClick={() => speichern(emp.id)}
                    >
                      {t("gemeinsam.speichern")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
