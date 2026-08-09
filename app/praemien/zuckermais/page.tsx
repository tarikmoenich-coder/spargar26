"use client";

// Prämien Zuckermais (Nutzer-Vorgabe 2026-08-09) - ersetzt schrittweise die
// Excel-Datei "Prämien Zuckermais 2026.xlsx". Pro Mitarbeiter und Tag
// werden Kisten und Stunden erfasst; Norm (Kolben/Std.), Kolben je Kiste
// und €-Satz je Kolben über der Norm ändern sich im Saisonverlauf (in der
// Excel stieg die Norm z.B. von 140 auf 180 Kolben/Std.) - deshalb eine
// eigene, mit "gültig ab" versionierte Sätze-Verwaltung unten auf der
// Seite (nur admin), analog zu den Verpflegungssätzen in den
// Einstellungen. Tagesprämie = GREATEST(0, (Kisten × Kolben/Kiste −
// Stunden × Norm) × Satz/Kolben) - 1:1 aus der Excel übernommen. Die
// Saison-Summe fließt automatisch (live) in die Lohnübersicht/Auszahlung
// ein (siehe season_summary.praemien_summe), erscheint dort mit in der
// Brutto-Spalte - genau wie die bisherigen Akkord-/Fahrer-/Erdbeer-/
// Spargel-Prämien.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PraemienTabs from "@/components/PraemienTabs";
import { formatDatumDE } from "@/lib/format";
import type {
  Arbeitsgruppe,
  Employee,
  ZuckermaisRohdatenEintrag,
  ZuckermaisSatz,
} from "@/lib/types";

function heuteIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toFixed(2);
}

interface Entwurf {
  kisten: string;
  stunden: string;
}

export default function PraemienZuckermaisPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung";
  const isAdmin = profile?.role === "admin";

  const [datum, setDatum] = useState(heuteIso());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [gruppeFilter, setGruppeFilter] = useState("");
  const [eintraege, setEintraege] = useState<
    Record<string, ZuckermaisRohdatenEintrag>
  >({});
  const [aktuellerSatz, setAktuellerSatz] = useState<ZuckermaisSatz | null>(
    null
  );
  const [alleSaetze, setAlleSaetze] = useState<ZuckermaisSatz[]>([]);
  const [loading, setLoading] = useState(true);
  const [entwurf, setEntwurf] = useState<Record<string, Entwurf>>({});
  const [speichernId, setSpeichernId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [druckModus, setDruckModus] = useState(false);

  // Neuen Satz anlegen (nur admin)
  const [neuGueltigAb, setNeuGueltigAb] = useState(heuteIso());
  const [neuNorm, setNeuNorm] = useState("");
  const [neuKolbenProKiste, setNeuKolbenProKiste] = useState("55");
  const [neuSatzProKolben, setNeuSatzProKolben] = useState("");
  const [satzSpeichern, setSatzSpeichern] = useState(false);
  const [satzFehler, setSatzFehler] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: emp }, { data: gr }, { data: eintr }, { data: satzAktuell }] =
      await Promise.all([
        supabase
          .from("employees")
          .select("*")
          .eq("aktiv", true)
          .order("name"),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
        supabase
          .from("zuckermais_rohdaten")
          .select("*")
          .eq("datum", datum),
        supabase
          .from("zuckermais_saetze")
          .select("*")
          .lte("gueltig_ab", datum)
          .order("gueltig_ab", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    const map: Record<string, ZuckermaisRohdatenEintrag> = {};
    ((eintr as ZuckermaisRohdatenEintrag[]) ?? []).forEach((e) => {
      map[e.employee_id] = e;
    });
    setEintraege(map);
    setAktuellerSatz((satzAktuell as ZuckermaisSatz) ?? null);
    setLoading(false);
  }

  async function ladeSaetze() {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("zuckermais_saetze")
      .select("*")
      .order("gueltig_ab", { ascending: false });
    setAlleSaetze((data as ZuckermaisSatz[]) ?? []);
  }

  useEffect(() => {
    load();
    setEntwurf({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datum]);

  useEffect(() => {
    ladeSaetze();
  }, []);

  function werteFuer(empId: string): Entwurf {
    if (entwurf[empId]) return entwurf[empId];
    const e = eintraege[empId];
    return {
      kisten: e?.kisten ? String(e.kisten) : "",
      stunden: e?.stunden ? String(e.stunden) : "",
    };
  }

  function feldAendern(empId: string, feld: keyof Entwurf, wert: string) {
    setEntwurf((prev) => ({
      ...prev,
      [empId]: { ...werteFuer(empId), [feld]: wert },
    }));
  }

  // Live-Vorschau der Prämie mit dem für "datum" aktuell gültigen Satz -
  // exakt dieselbe Formel wie die Sicht zuckermais_praemie_tag.
  function praemieVorschau(werte: Entwurf): number | null {
    if (!aktuellerSatz) return null;
    const kisten = Number(werte.kisten) || 0;
    const stunden = Number(werte.stunden) || 0;
    const kolben = kisten * aktuellerSatz.kolben_pro_kiste;
    const norm = stunden * aktuellerSatz.norm_kolben_pro_stunde;
    return Math.max((kolben - norm) * aktuellerSatz.satz_pro_kolben, 0);
  }

  async function speichern(empId: string) {
    const werte = werteFuer(empId);
    setSpeichernId(empId);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("zuckermais_rohdaten").upsert(
      {
        employee_id: empId,
        datum,
        kisten: Number(werte.kisten) || 0,
        stunden: Number(werte.stunden) || 0,
      },
      { onConflict: "employee_id,datum" }
    );
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

  async function neuenSatzSpeichern() {
    if (!neuNorm || !neuSatzProKolben) {
      setSatzFehler("Norm und Satz je Kolben sind Pflichtfelder.");
      return;
    }
    setSatzSpeichern(true);
    setSatzFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("zuckermais_saetze").insert({
      gueltig_ab: neuGueltigAb,
      norm_kolben_pro_stunde: Number(neuNorm),
      kolben_pro_kiste: Number(neuKolbenProKiste) || 55,
      satz_pro_kolben: Number(neuSatzProKolben),
    });
    setSatzSpeichern(false);
    if (error) {
      setSatzFehler(error.message);
      return;
    }
    setNeuNorm("");
    setNeuSatzProKolben("");
    ladeSaetze();
    load();
  }

  const gefiltert = employees.filter(
    (e) => !gruppeFilter || e.gruppe_nr === gruppeFilter
  );
  const gruppenByNr = new Map(gruppen.map((g) => [g.gruppe_nr, g]));

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
      if (!e || (!e.kisten && !e.stunden)) return null;
      const kolben = aktuellerSatz ? e.kisten * aktuellerSatz.kolben_pro_kiste : null;
      const praemie = aktuellerSatz
        ? Math.max(
            ((kolben ?? 0) - e.stunden * aktuellerSatz.norm_kolben_pro_stunde) *
              aktuellerSatz.satz_pro_kolben,
            0
          )
        : null;
      return { emp, e, kolben, praemie };
    })
    .filter((z): z is NonNullable<typeof z> => z !== null);

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <PraemienTabs />
        <p className="text-neutral-500">
          Nur admin/hr/zeiterfassung dürfen Zuckermais-Prämien erfassen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PraemienTabs />
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">
          Prämien – Zuckermais
        </h1>
        <p className="text-sm text-neutral-500">
          Pro Mitarbeiter und Tag Kisten und Stunden erfassen. Die Prämie
          wird automatisch mit dem für diesen Tag gültigen Satz berechnet
          und fließt live in die Lohnübersicht (Brutto-Spalte) ein.
        </p>
      </div>

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
          className="btn-secondary"
          disabled={druckZeilen.length === 0}
          onClick={drucken}
        >
          Tagesliste drucken{" "}
          {druckZeilen.length > 0 ? `(${druckZeilen.length})` : ""}
        </button>
      </div>

      {!aktuellerSatz && !loading && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 print:hidden">
          ⚠ Für den {formatDatumDE(datum)} ist noch kein Satz (Norm/Preis)
          hinterlegt - weiter unten unter &bdquo;Sätze verwalten&ldquo;
          nachtragen, sonst wird die Prämie mit 0 € berechnet.
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
          {aktuellerSatz.norm_kolben_pro_stunde} Kolben/Std. ·{" "}
          {aktuellerSatz.kolben_pro_kiste} Kolben/Kiste ·{" "}
          {aktuellerSatz.satz_pro_kolben.toFixed(4)} €/Kolben über Norm
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500 print:hidden">Lädt…</p>
      ) : (
        <div className="overflow-x-auto print:hidden">
          <table>
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Gruppe</th>
                <th>Kisten</th>
                <th>Stunden</th>
                <th>Kolben</th>
                <th>Prämie €</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((emp) => {
                const werte = werteFuer(emp.id);
                const kolben = (Number(werte.kisten) || 0) *
                  (aktuellerSatz?.kolben_pro_kiste ?? 0);
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
                        value={werte.kisten}
                        onChange={(e) =>
                          feldAendern(emp.id, "kisten", e.target.value)
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
                    <td className="text-neutral-500">{kolben ? fmt(kolben) : "—"}</td>
                    <td className="font-medium">{fmt(praemie)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={speichernId === emp.id}
                        onClick={() => speichern(emp.id)}
                      >
                        Speichern
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sätze-Verwaltung (nur admin) - Norm/Preis ändern sich im
          Saisonverlauf, daher eine Historie statt eines einzelnen Werts. */}
      {isAdmin && (
        <div className="mt-4 rounded border border-neutral-200 bg-white p-3 print:hidden">
          <h2 className="text-sm font-semibold text-emerald-800">
            Sätze verwalten (Norm/Preis, ändert sich im Saisonverlauf)
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
              Norm (Kolben/Std.){" "}
              <input
                type="number"
                step="0.01"
                className="w-24"
                value={neuNorm}
                onChange={(e) => setNeuNorm(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Kolben/Kiste{" "}
              <input
                type="number"
                step="0.01"
                className="w-20"
                value={neuKolbenProKiste}
                onChange={(e) => setNeuKolbenProKiste(e.target.value)}
              />
            </label>
            <label className="text-sm">
              €/Kolben über Norm{" "}
              <input
                type="number"
                step="0.0001"
                className="w-24"
                value={neuSatzProKolben}
                onChange={(e) => setNeuSatzProKolben(e.target.value)}
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
                  <th>Norm (Kolben/Std.)</th>
                  <th>Kolben/Kiste</th>
                  <th>€/Kolben über Norm</th>
                </tr>
              </thead>
              <tbody>
                {alleSaetze.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDatumDE(s.gueltig_ab)}</td>
                    <td>{s.norm_kolben_pro_stunde}</td>
                    <td>{s.kolben_pro_kiste}</td>
                    <td>{s.satz_pro_kolben.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tagesliste zum Aushängen - nur im Druck sichtbar. */}
      {druckModus && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Prämien Zuckermais – {formatDatumDE(datum)}
          </h2>
          <table className="mt-4 print-form-table">
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Kisten</th>
                <th>Stunden</th>
                <th>Kolben</th>
                <th>Prämie €</th>
              </tr>
            </thead>
            <tbody>
              {druckZeilen.map(({ emp, e, kolben, praemie }) => (
                <tr key={emp.id}>
                  <td>{emp.personal_nr}</td>
                  <td>
                    {emp.name}, {emp.vorname}
                  </td>
                  <td>{e.kisten}</td>
                  <td>{e.stunden}</td>
                  <td>{fmt(kolben)}</td>
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
