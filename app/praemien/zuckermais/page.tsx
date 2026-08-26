"use client";

// Prämien Zuckermais (Nutzer-Vorgabe 2026-08-09) - ersetzt schrittweise die
// Excel-Datei "Prämien Zuckermais 2026.xlsx". Pro Mitarbeiter und Tag
// werden Kisten und Stunden erfasst; Norm (Kolben/Std.), Kolben je Kiste
// und €-Satz je Kolben über der Norm ändern sich im Saisonverlauf (in der
// Excel stieg die Norm z.B. von 140 auf 180 Kolben/Std.) - deshalb eine
// eigene, mit "gültig ab" versionierte Sätze-Verwaltung direkt unter der
// Datumsauswahl (nur admin, Nutzer-Vorgabe 2026-08-09), analog zu den
// Verpflegungssätzen in den Einstellungen. Tagesprämie =
// GREATEST(0, (Kisten × Kolben/Kiste − Stunden × Norm) × Satz/Kolben) -
// 1:1 aus der Excel übernommen. Die
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
    profile?.role === "zeiterfassung" ||
    profile?.role === "erntewirtschaft";
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
  const [speichernAlle, setSpeichernAlle] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [druckModus, setDruckModus] = useState(false);

  // Neuen Satz anlegen ODER einen bestehenden korrigieren (nur admin) -
  // dasselbe Formular für beides. Nutzer-Meldung 2026-08-25: ein falsch
  // angelegter Satz ließ sich bisher nicht korrigieren (nur "hinzufügen"
  // = insert), ein erneuter Versuch mit demselben Datum scheiterte an
  // "duplicate key value violates unique constraint
  // zuckermais_saetze_gueltig_ab_key" - jetzt mit "Bearbeiten"/"Löschen"
  // je Zeile.
  const [neuGueltigAb, setNeuGueltigAb] = useState(heuteIso());
  const [neuNorm, setNeuNorm] = useState("");
  const [neuKolbenProKiste, setNeuKolbenProKiste] = useState("55");
  const [neuSatzProKolben, setNeuSatzProKolben] = useState("");
  const [satzSpeichern, setSatzSpeichern] = useState(false);
  const [satzFehler, setSatzFehler] = useState<string | null>(null);
  const [bearbeitenId, setBearbeitenId] = useState<number | null>(null);

  async function load() {
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
          // Nur wer über "Prämien → Gruppenaufteilung" für Zuckermais
          // freigegeben ist (Nutzer-Vorgabe 2026-08-09) - unabhängig von
          // gruppe_nr (Stundenerfassungs-Gruppen).
          .eq("praemien_zuckermais", true)
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

  // Speichert alle vom Nutzer bearbeiteten Zeilen (nur die tatsächlich
  // angefassten, siehe entwurf) in einem einzigen Upsert. Zeilen, die auf
  // 0/0 zurückgesetzt wurden, werden - falls vorher schon ein Eintrag
  // bestand - stattdessen GELÖSCHT statt stillschweigend übersprungen
  // (Nutzer-Vorgabe 2026-08-09: versehentlich am falschen Tag eingetragene
  // Werte müssen wieder rauszubekommen sein). Unberührte Zeilen ohne
  // vorherigen Eintrag bleiben unangetastet (kein unnötiges Anlegen leerer
  // Einträge). Einzelne Speichern-Knöpfe je Zeile gibt es bewusst nicht
  // mehr - "Alle speichern" reicht.
  async function alleSpeichern() {
    setSpeichernAlle(true);
    setFehler(null);
    const supabase = getSupabaseClient();

    const zuSpeichern: { employee_id: string; datum: string; kisten: number; stunden: number }[] = [];
    const zuLoeschenIds: number[] = [];

    gefiltert.forEach((emp) => {
      if (!entwurf[emp.id]) return; // nicht bearbeitet - unangetastet lassen
      const werte = werteFuer(emp.id);
      const kisten = Number(werte.kisten) || 0;
      const stunden = Number(werte.stunden) || 0;
      const bestehend = eintraege[emp.id];
      if (kisten === 0 && stunden === 0) {
        if (bestehend) zuLoeschenIds.push(bestehend.id);
        return;
      }
      zuSpeichern.push({ employee_id: emp.id, datum, kisten, stunden });
    });

    if (zuSpeichern.length === 0 && zuLoeschenIds.length === 0) {
      setSpeichernAlle(false);
      return;
    }

    if (zuLoeschenIds.length > 0) {
      const { error: loeschFehler } = await supabase
        .from("zuckermais_rohdaten")
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
        .from("zuckermais_rohdaten")
        .upsert(zuSpeichern, { onConflict: "employee_id,datum" });
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
    if (!neuNorm || !neuSatzProKolben) {
      setSatzFehler("Norm und Satz je Kolben sind Pflichtfelder.");
      return;
    }
    setSatzSpeichern(true);
    setSatzFehler(null);
    const supabase = getSupabaseClient();
    const werte = {
      gueltig_ab: neuGueltigAb,
      norm_kolben_pro_stunde: Number(neuNorm),
      kolben_pro_kiste: Number(neuKolbenProKiste) || 55,
      satz_pro_kolben: Number(neuSatzProKolben),
    };
    const { error } =
      bearbeitenId === null
        ? await supabase.from("zuckermais_saetze").insert(werte)
        : await supabase
            .from("zuckermais_saetze")
            .update(werte)
            .eq("id", bearbeitenId);
    setSatzSpeichern(false);
    if (error) {
      setSatzFehler(error.message);
      return;
    }
    satzFormularZuruecksetzen();
    ladeSaetze();
    load();
  }

  function satzBearbeiten(s: ZuckermaisSatz) {
    setBearbeitenId(s.id);
    setNeuGueltigAb(s.gueltig_ab);
    setNeuNorm(String(s.norm_kolben_pro_stunde));
    setNeuKolbenProKiste(String(s.kolben_pro_kiste));
    setNeuSatzProKolben(String(s.satz_pro_kolben));
    setSatzFehler(null);
  }

  function satzFormularZuruecksetzen() {
    setBearbeitenId(null);
    setNeuGueltigAb(heuteIso());
    setNeuNorm("");
    setNeuKolbenProKiste("55");
    setNeuSatzProKolben("");
    setSatzFehler(null);
  }

  async function satzLoeschen(s: ZuckermaisSatz) {
    if (
      !window.confirm(
        `Satz gültig ab ${formatDatumDE(s.gueltig_ab)} wirklich löschen?`
      )
    )
      return;
    setSatzFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("zuckermais_saetze")
      .delete()
      .eq("id", s.id);
    if (error) {
      setSatzFehler(error.message);
      return;
    }
    if (bearbeitenId === s.id) satzFormularZuruecksetzen();
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
      const kolbenNorm = aktuellerSatz
        ? e.stunden * aktuellerSatz.norm_kolben_pro_stunde
        : null;
      const praemie = aktuellerSatz
        ? Math.max(((kolben ?? 0) - (kolbenNorm ?? 0)) * aktuellerSatz.satz_pro_kolben, 0)
        : null;
      return { emp, e, kolben, kolbenNorm, praemie };
    })
    .filter((z): z is NonNullable<typeof z> => z !== null);

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <PraemienTabs />
        <p className="text-neutral-500">
          Nur admin/hr/zeiterfassung/erntewirtschaft dürfen Zuckermais-Prämien
          erfassen.
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
          und fließt live in die Lohnübersicht (Brutto-Spalte) ein. Feld
          leeren/auf 0 setzen und „Alle speichern" klicken entfernt einen
          versehentlich eingetragenen Wert wieder komplett - das geht
          allerdings nicht mehr, sobald die Person für diese Saison schon
          abgerechnet ("Jetzt Abrechnen") wurde.
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

      {/* Sätze-Verwaltung (nur admin) - Norm/Preis ändern sich im
          Saisonverlauf, daher eine Historie statt eines einzelnen Werts.
          Bewusst direkt unter der Datumsauswahl (Nutzer-Vorgabe
          2026-08-09), nicht unten auf der Seite. */}
      {isAdmin && (
        <div className="rounded border border-neutral-200 bg-white p-3 print:hidden">
          <h2 className="text-sm font-semibold text-emerald-800">
            Sätze verwalten (Norm/Preis, ändert sich im Saisonverlauf)
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Ändern oder Löschen wirkt sich auf alle Tage aus, die diesen Satz
            nutzen (von "Gültig ab" bis zum nächsten Satz bzw. bis heute) -
            auch rückwirkend auf bereits erfasste Tage und ggf. bereits
            abgerechnete Personen. Bei einem Tippfehler kurz nach dem
            Anlegen unbedenklich, bei einem länger genutzten Satz vorher
            genau prüfen.
          </p>
          {bearbeitenId !== null && (
            <p className="mt-1 text-xs text-amber-700">
              Bearbeite Satz gültig ab {formatDatumDE(neuGueltigAb)} - unten
              speichern oder abbrechen.
            </p>
          )}
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
              {bearbeitenId === null ? "Satz hinzufügen" : "Änderungen speichern"}
            </button>
            {bearbeitenId !== null && (
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={satzFormularZuruecksetzen}
              >
                Abbrechen
              </button>
            )}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {alleSaetze.map((s) => (
                  <tr
                    key={s.id}
                    className={bearbeitenId === s.id ? "bg-amber-50" : ""}
                  >
                    <td>{formatDatumDE(s.gueltig_ab)}</td>
                    <td>{s.norm_kolben_pro_stunde}</td>
                    <td>{s.kolben_pro_kiste}</td>
                    <td>{s.satz_pro_kolben.toFixed(4)}</td>
                    <td className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => satzBearbeiten(s)}
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => satzLoeschen(s)}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!aktuellerSatz && !loading && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 print:hidden">
          ⚠ Für den {formatDatumDE(datum)} ist noch kein Satz (Norm/Preis)
          hinterlegt - weiter oben unter &bdquo;Sätze verwalten&ldquo;
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
      ) : gefiltert.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Niemand für Zuckermais freigegeben (oder Gruppenfilter zu eng) -
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
                <th>Kisten</th>
                <th>Stunden</th>
                <th title="Kolben ÷ Stunden - die tatsächliche Ausbeute, nicht die erwartete Norm">
                  Kolben/Std.
                </th>
                <th>Kolben</th>
                <th title="Erwartete Kolbenzahl bei der aktuellen Norm (Stunden × Norm/Std.) - erst darüber gibt es eine Prämie">
                  Kolben Norm
                </th>
                <th>Prämie €</th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((emp) => {
                const werte = werteFuer(emp.id);
                const kolben = (Number(werte.kisten) || 0) *
                  (aktuellerSatz?.kolben_pro_kiste ?? 0);
                const kolbenNorm = (Number(werte.stunden) || 0) *
                  (aktuellerSatz?.norm_kolben_pro_stunde ?? 0);
                const stundenZahl = Number(werte.stunden) || 0;
                const kolbenProStunde =
                  stundenZahl > 0 ? kolben / stundenZahl : null;
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
                    <td className="text-neutral-500">
                      {kolbenProStunde === null ? "—" : fmt(kolbenProStunde)}
                    </td>
                    <td className="text-neutral-500">{kolben ? fmt(kolben) : "—"}</td>
                    <td className="text-neutral-500">
                      {kolbenNorm ? fmt(kolbenNorm) : "—"}
                    </td>
                    <td className="font-medium">{fmt(praemie)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
                <th>Kolben Norm</th>
                <th>Prämie €</th>
              </tr>
            </thead>
            <tbody>
              {druckZeilen.map(({ emp, e, kolben, kolbenNorm, praemie }) => (
                <tr key={emp.id}>
                  <td>{emp.personal_nr}</td>
                  <td>
                    {emp.name}, {emp.vorname}
                  </td>
                  <td>{e.kisten}</td>
                  <td>{e.stunden}</td>
                  <td>{fmt(kolben)}</td>
                  <td>{fmt(kolbenNorm)}</td>
                  <td>{fmt(praemie)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="text-right font-semibold">
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
