"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Employee, VorschussHistorieEintrag, WorkEntry } from "@/lib/types";
import { formatDatumDE } from "@/lib/format";

// Für die Suche reicht die eingeschränkte Sicht (keine sensiblen Felder) -
// alle Rollen dürfen hier lesen, siehe employees_public/employees-Grant.
type SucheEmployee = Pick<
  Employee,
  "id" | "personal_nr" | "name" | "vorname" | "aktiv"
>;

function jetzigeSaison() {
  return new Date().getFullYear();
}

export default function SuchePage() {
  const [alle, setAlle] = useState<SucheEmployee[]>([]);
  const [suchtext, setSuchtext] = useState("");
  const [ausgewaehlt, setAusgewaehlt] = useState<SucheEmployee | null>(null);
  const [saisonJahr, setSaisonJahr] = useState(jetzigeSaison());
  const [stunden, setStunden] = useState<WorkEntry[]>([]);
  const [vorschuesse, setVorschuesse] = useState<VorschussHistorieEintrag[]>([]);
  const [ladenListe, setLadenListe] = useState(true);
  const [ladenDetail, setLadenDetail] = useState(false);

  useEffect(() => {
    async function ladeMitarbeiter() {
      setLadenListe(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, aktiv")
        .order("name");
      if (!error) setAlle((data as SucheEmployee[]) ?? []);
      setLadenListe(false);
    }
    ladeMitarbeiter();
  }, []);

  const treffer = useMemo(() => {
    const q = suchtext.trim().toLowerCase();
    if (!q) return [];
    return alle
      .filter(
        (m) =>
          m.personal_nr.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.vorname.toLowerCase().includes(q) ||
          `${m.name} ${m.vorname}`.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [alle, suchtext]);

  async function waehleAus(m: SucheEmployee) {
    setAusgewaehlt(m);
    setLadenDetail(true);
    const supabase = getSupabaseClient();
    const [{ data: we }, { data: vh }] = await Promise.all([
      supabase
        .from("work_entries")
        .select("*")
        .eq("employee_id", m.id)
        .gte("datum", `${saisonJahr}-01-01`)
        .lte("datum", `${saisonJahr}-12-31`)
        .order("datum"),
      supabase
        .from("employee_vorschuss_historie")
        .select("*")
        .eq("employee_id", m.id)
        .order("datum"),
    ]);
    setStunden((we as WorkEntry[]) ?? []);
    setVorschuesse((vh as VorschussHistorieEintrag[]) ?? []);
    setLadenDetail(false);
  }

  // Bei Saisonjahr-Wechsel Arbeitsstunden neu laden, falls jemand
  // ausgewählt ist.
  useEffect(() => {
    if (ausgewaehlt) waehleAus(ausgewaehlt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisonJahr]);

  const stundenGesamt = stunden.reduce((s, e) => s + Number(e.stunden ?? 0), 0);
  const tageGesamt = stunden.filter(
    (e) => e.stunden !== null || e.markierung !== null
  ).length;
  const vorschussGesamt = vorschuesse
    .filter((v) => !v.storniert)
    .reduce((s, v) => s + Number(v.betrag), 0);

  const jahreOptionen = Array.from(
    { length: 5 },
    (_, i) => jetzigeSaison() - i
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">Suche</h1>
        <p className="text-sm text-neutral-500">
          Nach Name oder Personalnummer suchen, um Arbeitsstunden und
          Vorschüsse einer Person einzusehen.
        </p>
      </div>

      <div className="rounded border border-neutral-200 bg-white p-4 print:hidden">
        <input
          autoFocus
          placeholder="Name oder Personalnummer eingeben…"
          value={suchtext}
          onChange={(e) => {
            setSuchtext(e.target.value);
            setAusgewaehlt(null);
          }}
          className="w-full"
        />
        {ladenListe ? (
          <p className="mt-2 text-sm text-neutral-500">Lädt…</p>
        ) : (
          suchtext.trim() !== "" &&
          !ausgewaehlt && (
            <ul className="mt-2 flex flex-col divide-y divide-neutral-100 rounded border border-neutral-200">
              {treffer.length === 0 ? (
                <li className="p-2 text-sm text-neutral-500">
                  Keine Treffer.
                </li>
              ) : (
                treffer.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between p-2 text-left text-sm hover:bg-emerald-50"
                      onClick={() => waehleAus(m)}
                    >
                      <span>
                        {m.name}, {m.vorname}{" "}
                        <span className="text-neutral-400">
                          ({m.personal_nr})
                        </span>
                      </span>
                      {!m.aktiv && (
                        <span className="text-xs text-neutral-400">
                          inaktiv
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )
        )}
      </div>

      {ausgewaehlt && (
        <div className="flex flex-col gap-4 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 bg-white p-4">
            <div>
              <p className="text-base font-semibold">
                {ausgewaehlt.name}, {ausgewaehlt.vorname}
              </p>
              <p className="text-sm text-neutral-500">
                Personalnummer {ausgewaehlt.personal_nr}
                {!ausgewaehlt.aktiv && " · inaktiv"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-neutral-500">Saison-Jahr</label>
              <select
                value={saisonJahr}
                onChange={(e) => setSaisonJahr(Number(e.target.value))}
              >
                {jahreOptionen.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => window.print()}
              >
                Drucken
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  setAusgewaehlt(null);
                  setSuchtext("");
                }}
              >
                Neue Suche
              </button>
            </div>
          </div>

          {ladenDetail ? (
            <p className="text-neutral-500">Lädt…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded border border-neutral-200 bg-white p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-emerald-800">
                    Arbeitsstunden {saisonJahr}
                  </h2>
                  <span className="text-sm text-neutral-500">
                    {stundenGesamt.toFixed(2)} Std. · {tageGesamt} Tage
                  </span>
                </div>
                {stunden.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    Keine Einträge in diesem Jahr.
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Std.</th>
                          <th>Markierung</th>
                          <th>Notiz</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stunden.map((e) => (
                          <tr key={e.id}>
                            <td>{formatDatumDE(e.datum)}</td>
                            <td>{e.stunden ?? "—"}</td>
                            <td>{e.markierung ?? "—"}</td>
                            <td className="text-neutral-500">{e.notiz}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded border border-neutral-200 bg-white p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-emerald-800">
                    Vorschüsse
                  </h2>
                  <span className="text-sm text-neutral-500">
                    {vorschussGesamt.toFixed(2)} € (aktiv)
                  </span>
                </div>
                {vorschuesse.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    Keine Vorschüsse erfasst.
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Betrag €</th>
                          <th>Art</th>
                          <th>Begründung</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vorschuesse.map((v, i) => (
                          <tr
                            key={`${v.datum}-${i}`}
                            className={v.storniert ? "opacity-50" : ""}
                          >
                            <td>{formatDatumDE(v.datum)}</td>
                            <td>{Number(v.betrag).toFixed(2)}</td>
                            <td>{v.zahlungsart === "BAR" ? "Bar" : "Überweisung"}</td>
                            <td>{v.begruendung ?? "—"}</td>
                            <td>{v.storniert ? "storniert" : "aktiv"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Übersicht zum Aushändigen an den Mitarbeiter - nur im Druck sichtbar. */}
      {ausgewaehlt && !ladenDetail && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Arbeitsstunden &amp; Vorschüsse – {ausgewaehlt.name},{" "}
            {ausgewaehlt.vorname}
          </h2>
          <p className="mt-1 text-base">
            Personalnummer: {ausgewaehlt.personal_nr} · Saison-Jahr:{" "}
            {saisonJahr} · Gedruckt am: {formatDatumDE(new Date().toISOString())}
          </p>

          <h3 className="mt-4 text-base font-semibold">
            Arbeitsstunden ({stundenGesamt.toFixed(2)} Std. · {tageGesamt} Tage)
          </h3>
          {stunden.length === 0 ? (
            <p className="mt-1 text-sm">Keine Einträge in diesem Jahr.</p>
          ) : (
            <table className="mt-2 print-form-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Std.</th>
                  <th>Markierung</th>
                  <th>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {stunden.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDatumDE(e.datum)}</td>
                    <td>{e.stunden ?? "—"}</td>
                    <td>{e.markierung ?? "—"}</td>
                    <td>{e.notiz ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 text-base font-semibold">
            Vorschüsse ({vorschussGesamt.toFixed(2)} € aktiv)
          </h3>
          {vorschuesse.length === 0 ? (
            <p className="mt-1 text-sm">Keine Vorschüsse erfasst.</p>
          ) : (
            <table className="mt-2 print-form-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Betrag €</th>
                  <th>Art</th>
                  <th>Begründung</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vorschuesse.map((v, i) => (
                  <tr key={`${v.datum}-${i}`}>
                    <td>{formatDatumDE(v.datum)}</td>
                    <td>{Number(v.betrag).toFixed(2)}</td>
                    <td>{v.zahlungsart === "BAR" ? "Bar" : "Überweisung"}</td>
                    <td>{v.begruendung ?? "—"}</td>
                    <td>{v.storniert ? "storniert" : "aktiv"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
