"use client";

// Prämien Erdbeeren (Nutzer-Vorgabe 2026-08-09) - gleiches Grundmuster wie
// Zuckermais (Strichliste je Mitarbeiter/Tag: Steigen, Stunden), aber mit
// einem wichtigen Unterschied: es wird auf mehreren Parzellen gleichzeitig
// gepflückt, mit sehr unterschiedlichen Gegebenheiten (Sorte, Alter,
// Boden) - Norm (Steigen/Std.) und Bonus (€/Steige über Norm) sind daher
// JE PARZELLE UND TAG eigenständig einstellbar, nicht global. Zusätzlich
// wird "Sut" (Abfall/nicht vermarktungsfähige Ware) erfasst - zählt nicht
// zur Prämie, dient nur der Ertrags-/Kostenstatistik. Die Saison-Summe
// fließt automatisch (live) in die Lohnübersicht/Auszahlung ein, wie bei
// Zuckermais.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PraemienTabs from "@/components/PraemienTabs";
import { formatDatumDE } from "@/lib/format";
import type {
  Arbeitsgruppe,
  Employee,
  ErdbeerenParzelle,
  ErdbeerenParzellenSatz,
  ErdbeerenRohdatenEintrag,
} from "@/lib/types";

function heuteIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toFixed(2);
}

interface Entwurf {
  steigen: string;
  stunden: string;
  sut: string;
}

export default function PraemienErdbeerenPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung" ||
    profile?.role === "erntewirtschaft";
  const isAdmin = profile?.role === "admin";

  const [datum, setDatum] = useState(heuteIso());
  const [parzellen, setParzellen] = useState<ErdbeerenParzelle[]>([]);
  const [parzelleId, setParzelleId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [gruppeFilter, setGruppeFilter] = useState("");
  const [eintraege, setEintraege] = useState<
    Record<string, ErdbeerenRohdatenEintrag>
  >({});
  const [aktuellerSatz, setAktuellerSatz] = useState<ErdbeerenParzellenSatz | null>(
    null
  );
  const [alleSaetze, setAlleSaetze] = useState<ErdbeerenParzellenSatz[]>([]);
  const [loading, setLoading] = useState(true);
  const [entwurf, setEntwurf] = useState<Record<string, Entwurf>>({});
  const [speichernAlle, setSpeichernAlle] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [druckModus, setDruckModus] = useState(false);

  // Die Felder selbst werden seit 2026-08-11 unter "Anbau → Felder"
  // gepflegt, nicht mehr hier (Nutzer-Vorgabe: in Prämien gehören nur die
  // Sätze hin, weil die Anbauplanung woanders stattfindet). Hier werden
  // sie nur noch zur Auswahl geladen.

  // Neuen Satz für die aktuell gewählte Parzelle anlegen (nur admin)
  const [neuGueltigAb, setNeuGueltigAb] = useState(heuteIso());
  const [neuNorm, setNeuNorm] = useState("");
  const [neuBonus, setNeuBonus] = useState("");
  const [satzSpeichern, setSatzSpeichern] = useState(false);
  const [satzFehler, setSatzFehler] = useState<string | null>(null);

  async function ladeParzellen() {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("erdbeeren_parzellen")
      .select("*")
      .eq("aktiv", true)
      .order("name");
    const liste = (data as ErdbeerenParzelle[]) ?? [];
    setParzellen(liste);
    if (parzelleId === null && liste.length > 0) {
      setParzelleId(liste[0].id);
    }
  }

  useEffect(() => {
    ladeParzellen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (parzelleId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: gr }, { data: eintr }, { data: satzAktuell }] =
      await Promise.all([
        supabase
          .from("employees")
          // Bewusst kein "select *" (2026-08-09-Vorfall, siehe schema.sql) -
          // diese Seite ist auch für zeiterfassung/erntewirtschaft
          // erreichbar, die keine sensiblen Felder (SV-Nr./IBAN/...) sehen
          // sollen.
          .select("id, personal_nr, gruppe_nr, name, vorname, aktiv")
          .eq("aktiv", true)
          // Nur wer über "Prämien → Gruppenaufteilung" für Erdbeeren
          // freigegeben ist (Nutzer-Vorgabe 2026-08-09) - unabhängig von
          // gruppe_nr (Stundenerfassungs-Gruppen).
          .eq("praemien_erdbeeren", true)
          .order("name"),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
        supabase
          .from("erdbeeren_rohdaten")
          .select("*")
          .eq("datum", datum)
          .eq("parzelle_id", parzelleId),
        supabase
          .from("erdbeeren_parzellen_saetze")
          .select("*")
          .eq("parzelle_id", parzelleId)
          .lte("gueltig_ab", datum)
          .order("gueltig_ab", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    const map: Record<string, ErdbeerenRohdatenEintrag> = {};
    ((eintr as ErdbeerenRohdatenEintrag[]) ?? []).forEach((e) => {
      map[e.employee_id] = e;
    });
    setEintraege(map);
    setAktuellerSatz((satzAktuell as ErdbeerenParzellenSatz) ?? null);
    setLoading(false);
  }

  async function ladeSaetze() {
    if (parzelleId === null) return;
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("erdbeeren_parzellen_saetze")
      .select("*")
      .eq("parzelle_id", parzelleId)
      .order("gueltig_ab", { ascending: false });
    setAlleSaetze((data as ErdbeerenParzellenSatz[]) ?? []);
  }

  useEffect(() => {
    load();
    setEntwurf({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datum, parzelleId]);

  useEffect(() => {
    ladeSaetze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parzelleId]);

  function werteFuer(empId: string): Entwurf {
    if (entwurf[empId]) return entwurf[empId];
    const e = eintraege[empId];
    return {
      steigen: e?.steigen ? String(e.steigen) : "",
      stunden: e?.stunden ? String(e.stunden) : "",
      sut: e?.sut ? String(e.sut) : "",
    };
  }

  function feldAendern(empId: string, feld: keyof Entwurf, wert: string) {
    setEntwurf((prev) => ({
      ...prev,
      [empId]: { ...werteFuer(empId), [feld]: wert },
    }));
  }

  // Live-Vorschau der Prämie mit dem für "datum"+"parzelleId" aktuell
  // gültigen Satz - exakt dieselbe Formel wie die Sicht
  // erdbeeren_praemie_tag. "Sut" zählt bewusst nicht zur Prämie.
  function praemieVorschau(werte: Entwurf): number | null {
    if (!aktuellerSatz) return null;
    const steigen = Number(werte.steigen) || 0;
    const stunden = Number(werte.stunden) || 0;
    const norm = stunden * aktuellerSatz.norm_steigen_pro_stunde;
    return Math.max((steigen - norm) * aktuellerSatz.bonus_pro_steige, 0);
  }

  // Speichert alle vom Nutzer bearbeiteten Zeilen (nur die tatsächlich
  // angefassten, siehe entwurf) in einem einzigen Upsert. Zeilen, die auf
  // 0/0/0 zurückgesetzt wurden, werden - falls vorher schon ein Eintrag
  // bestand - stattdessen GELÖSCHT statt stillschweigend übersprungen
  // (Nutzer-Vorgabe 2026-08-09: versehentlich am falschen Tag/an der
  // falschen Parzelle eingetragene Werte müssen wieder rauszubekommen
  // sein). Unberührte Zeilen ohne vorherigen Eintrag bleiben unangetastet.
  async function alleSpeichern() {
    if (parzelleId === null) return;
    setSpeichernAlle(true);
    setFehler(null);
    const supabase = getSupabaseClient();

    const zuSpeichern: {
      employee_id: string;
      parzelle_id: number;
      datum: string;
      steigen: number;
      stunden: number;
      sut: number;
    }[] = [];
    const zuLoeschenIds: number[] = [];

    gefiltert.forEach((emp) => {
      if (!entwurf[emp.id]) return; // nicht bearbeitet - unangetastet lassen
      const werte = werteFuer(emp.id);
      const steigen = Number(werte.steigen) || 0;
      const stunden = Number(werte.stunden) || 0;
      const sut = Number(werte.sut) || 0;
      const bestehend = eintraege[emp.id];
      if (steigen === 0 && stunden === 0 && sut === 0) {
        if (bestehend) zuLoeschenIds.push(bestehend.id);
        return;
      }
      zuSpeichern.push({
        employee_id: emp.id,
        parzelle_id: parzelleId,
        datum,
        steigen,
        stunden,
        sut,
      });
    });

    if (zuSpeichern.length === 0 && zuLoeschenIds.length === 0) {
      setSpeichernAlle(false);
      return;
    }

    if (zuLoeschenIds.length > 0) {
      const { error: loeschFehler } = await supabase
        .from("erdbeeren_rohdaten")
        .delete()
        .in("id", zuLoeschenIds);
      if (loeschFehler) {
        setSpeichernAlle(false);
        setFehler(loeschFehler.message);
        return;
      }
    }

    if (zuSpeichern.length > 0) {
      const { error } = await supabase
        .from("erdbeeren_rohdaten")
        .upsert(zuSpeichern, { onConflict: "employee_id,parzelle_id,datum" });
      if (error) {
        setSpeichernAlle(false);
        setFehler(error.message);
        return;
      }
    }

    setSpeichernAlle(false);
    setEntwurf({});
    load();
  }

  async function neuenSatzSpeichern() {
    if (parzelleId === null) return;
    if (!neuNorm || !neuBonus) {
      setSatzFehler("Norm und Bonus/Steige sind Pflichtfelder.");
      return;
    }
    setSatzSpeichern(true);
    setSatzFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("erdbeeren_parzellen_saetze").insert({
      parzelle_id: parzelleId,
      gueltig_ab: neuGueltigAb,
      norm_steigen_pro_stunde: Number(neuNorm),
      bonus_pro_steige: Number(neuBonus),
    });
    setSatzSpeichern(false);
    if (error) {
      setSatzFehler(error.message);
      return;
    }
    setNeuNorm("");
    setNeuBonus("");
    ladeSaetze();
    load();
  }

  const gefiltert = employees.filter(
    (e) => !gruppeFilter || e.gruppe_nr === gruppeFilter
  );
  const gruppenByNr = new Map(gruppen.map((g) => [g.gruppe_nr, g]));
  const aktuelleParzelle = parzellen.find((p) => p.id === parzelleId) ?? null;

  function drucken() {
    setDruckModus(true);
    setTimeout(() => {
      window.print();
      setDruckModus(false);
    }, 50);
  }

  const druckZeilen = gefiltert
    .map((emp) => {
      const e = eintraege[emp.id];
      if (!e || (!e.steigen && !e.stunden && !e.sut)) return null;
      const praemie = aktuellerSatz
        ? Math.max(
            (e.steigen - e.stunden * aktuellerSatz.norm_steigen_pro_stunde) *
              aktuellerSatz.bonus_pro_steige,
            0
          )
        : null;
      return { emp, e, praemie };
    })
    .filter((z): z is NonNullable<typeof z> => z !== null);

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <PraemienTabs />
        <p className="text-neutral-500">
          Nur admin/hr/zeiterfassung/erntewirtschaft dürfen
          Erdbeeren-Prämien erfassen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PraemienTabs />
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">
          Prämien – Erdbeeren
        </h1>
        <p className="text-sm text-neutral-500">
          Pro Mitarbeiter, Parzelle und Tag Steigen, Stunden und Sut (Abfall/
          nicht vermarktungsfähige Ware) erfassen. Norm und Bonus gelten je
          Parzelle (nicht global wie bei Zuckermais) und fließen live in die
          Lohnübersicht (Brutto-Spalte) ein. Sut zählt nicht zur Prämie.
          Feld leeren/auf 0 setzen und „Alle speichern" klicken entfernt
          einen versehentlich eingetragenen Wert wieder komplett - das
          geht allerdings nicht mehr, sobald die Person für diese Saison
          schon abgerechnet ("Jetzt Abrechnen") wurde.
        </p>
      </div>

      {parzellen.length === 0 && !loading ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 print:hidden">
          ⚠ Noch keine Parzelle angelegt - weiter unten unter „Parzellen
          verwalten" eine anlegen, bevor Prämien erfasst werden können.
        </p>
      ) : (
        <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-3 bg-neutral-50 py-2 print:hidden">
          <label className="text-sm">
            Datum{" "}
            <input
              type="date"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Parzelle{" "}
            <select
              value={parzelleId ?? ""}
              onChange={(e) => setParzelleId(Number(e.target.value))}
            >
              {parzellen.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Gruppe{" "}
            <select
              value={gruppeFilter}
              onChange={(e) => setGruppeFilter(e.target.value)}
            >
              <option value="">Alle</option>
              {gruppen.map((g) => (
                <option key={g.gruppe_nr} value={g.gruppe_nr}>
                  {g.gruppe_nr} – {g.bezeichnung}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={speichernAlle}
            onClick={alleSpeichern}
          >
            Alle speichern
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={druckZeilen.length === 0}
            onClick={drucken}
          >
            Tagesliste drucken{" "}
            {druckZeilen.length > 0 ? `(${druckZeilen.length})` : ""}
          </button>
        </div>
      )}

      {/* Sätze-Verwaltung für die aktuell gewählte Parzelle (nur admin). */}
      {isAdmin && parzelleId !== null && (
        <div className="rounded border border-neutral-200 bg-white p-3 print:hidden">
          <h2 className="text-sm font-semibold text-emerald-800">
            Sätze verwalten für {aktuelleParzelle?.name} (Norm/Bonus, ändert
            sich je Parzelle und Saisonverlauf)
          </h2>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Gültig ab{" "}
              <input
                type="date"
                value={neuGueltigAb}
                onChange={(e) => setNeuGueltigAb(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Norm (Steigen/Std.){" "}
              <input
                type="number"
                step="0.01"
                className="w-24"
                value={neuNorm}
                onChange={(e) => setNeuNorm(e.target.value)}
              />
            </label>
            <label className="text-sm">
              €/Steige über Norm{" "}
              <input
                type="number"
                step="0.0001"
                className="w-24"
                value={neuBonus}
                onChange={(e) => setNeuBonus(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn text-xs"
              disabled={satzSpeichern}
              onClick={neuenSatzSpeichern}
            >
              Satz hinzufügen
            </button>
          </div>
          {satzFehler && (
            <p className="mt-1 text-sm text-red-600">{satzFehler}</p>
          )}
          {alleSaetze.length > 0 && (
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Gültig ab</th>
                  <th>Norm (Steigen/Std.)</th>
                  <th>€/Steige über Norm</th>
                </tr>
              </thead>
              <tbody>
                {alleSaetze.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDatumDE(s.gueltig_ab)}</td>
                    <td>{s.norm_steigen_pro_stunde}</td>
                    <td>{s.bonus_pro_steige.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {parzellen.length > 0 && !aktuellerSatz && !loading && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 print:hidden">
          ⚠ Für {aktuelleParzelle?.name} am {formatDatumDE(datum)} ist noch
          kein Satz (Norm/Bonus) hinterlegt - weiter oben unter „Sätze
          verwalten" nachtragen, sonst wird die Prämie mit 0 € berechnet.
        </p>
      )}

      {fehler && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 print:hidden">
          ⚠ {fehler}
        </p>
      )}

      {aktuellerSatz && (
        <p className="text-sm text-neutral-500 print:hidden">
          Gültiger Satz seit {formatDatumDE(aktuellerSatz.gueltig_ab)}: Norm{" "}
          {aktuellerSatz.norm_steigen_pro_stunde} Steigen/Std. ·{" "}
          {aktuellerSatz.bonus_pro_steige.toFixed(4)} €/Steige über Norm
        </p>
      )}

      {parzellen.length > 0 &&
        (loading ? (
          <p className="text-neutral-500 print:hidden">Lädt…</p>
        ) : gefiltert.length === 0 ? (
          <p className="text-neutral-500 print:hidden">
            Niemand für Erdbeeren freigegeben (oder Gruppenfilter zu eng) -
            siehe „Prämien → Gruppenaufteilung".
          </p>
        ) : (
          <div className="overflow-x-auto print:hidden">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Gruppe</th>
                  <th>Steigen</th>
                  <th>Stunden</th>
                  <th title="Abfall/nicht vermarktungsfähige Ware - zählt nicht zur Prämie">
                    Sut
                  </th>
                  <th>Prämie €</th>
                </tr>
              </thead>
              <tbody>
                {gefiltert.map((emp) => {
                  const werte = werteFuer(emp.id);
                  const praemie = praemieVorschau(werte);
                  return (
                    <tr key={emp.id}>
                      <td>{emp.personal_nr}</td>
                      <td>
                        {emp.name}, {emp.vorname}
                      </td>
                      <td className="text-sm text-neutral-500">
                        {emp.gruppe_nr
                          ? `${emp.gruppe_nr} – ${
                              gruppenByNr.get(emp.gruppe_nr)?.bezeichnung ??
                              emp.gruppe_nr
                            }`
                          : "—"}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-20"
                          value={werte.steigen}
                          onChange={(e) =>
                            feldAendern(emp.id, "steigen", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="0.25"
                          className="w-20"
                          value={werte.stunden}
                          onChange={(e) =>
                            feldAendern(emp.id, "stunden", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-20"
                          value={werte.sut}
                          onChange={(e) =>
                            feldAendern(emp.id, "sut", e.target.value)
                          }
                        />
                      </td>
                      <td className="font-medium">{fmt(praemie)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {/* Tagesliste zum Aushängen - nur im Druck sichtbar. */}
      {druckModus && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Prämien Erdbeeren – {aktuelleParzelle?.name} –{" "}
            {formatDatumDE(datum)}
          </h2>
          <table className="mt-4 print-form-table">
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Steigen</th>
                <th>Stunden</th>
                <th>Sut</th>
                <th>Prämie €</th>
              </tr>
            </thead>
            <tbody>
              {druckZeilen.map(({ emp, e, praemie }) => (
                <tr key={emp.id}>
                  <td>{emp.personal_nr}</td>
                  <td>
                    {emp.name}, {emp.vorname}
                  </td>
                  <td>{e.steigen}</td>
                  <td>{e.stunden}</td>
                  <td>{e.sut}</td>
                  <td>{fmt(praemie)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right font-semibold">
                  Summe Prämie
                </td>
                <td className="font-semibold">
                  {druckZeilen
                    .reduce((s, z) => s + (z.praemie ?? 0), 0)
                    .toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
