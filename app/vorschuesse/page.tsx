"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type {
  Advance,
  AdvanceRecipientDetail,
  Arbeitsgruppe,
  Employee,
  Herkunft,
} from "@/lib/types";
import LohnTabs from "@/components/LohnTabs";

function monatsSchluessel(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${mm}-${d.getFullYear()}`;
}

const MONATSNAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

interface AusgewaehltePerson {
  employee_id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  betrag: string;
}

interface Beleg {
  belegnummer: string;
  datum: string;
  zahlungsart: string;
  storniert: boolean;
  uebergeben_an: string | null;
  empfaenger: AdvanceRecipientDetail[];
}

export default function VorschuessePage() {
  const { profile } = useProfile();
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [loading, setLoading] = useState(true);

  const [basisBetrag, setBasisBetrag] = useState("");
  const [zahlungsart, setZahlungsart] = useState("BAR");
  const [begruendung, setBegruendung] = useState("");
  // Person (z.B. Gruppenleiter), die das Geld zur Verteilung an die
  // einzelnen Empfänger bekommt - erscheint auf dem separaten
  // Übergabe-Beleg beim Drucken.
  const [uebergebenAn, setUebergebenAn] = useState("");
  const [ausgewaehlt, setAusgewaehlt] = useState<AusgewaehltePerson[]>([]);
  const [gruppenFilter, setGruppenFilter] = useState("");
  const [herkunftFilter, setHerkunftFilter] = useState("");
  const [suche, setSuche] = useState("");
  const [jahrFilter, setJahrFilter] = useState<number | "alle">("alle");
  const [monatFilter, setMonatFilter] = useState<number | "alle">("alle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [letzterBeleg, setLetzterBeleg] = useState<Beleg | null>(null);
  const [druckBeleg, setDruckBeleg] = useState<Beleg | null>(null);

  // Nachträgliche Korrektur eines bereits bestätigten Vorschuss-Betrags.
  const [bearbeitenAdvanceId, setBearbeitenAdvanceId] = useState<
    number | null
  >(null);
  const [bearbeitenEmpfaenger, setBearbeitenEmpfaenger] = useState<
    AdvanceRecipientDetail[]
  >([]);
  const [korrekturBetraege, setKorrekturBetraege] = useState<
    Record<string, string>
  >({});
  const [korrekturLaeuft, setKorrekturLaeuft] = useState<string | null>(null);

  const canWrite = profile?.role === "admin" || profile?.role === "kasse";
  // Deckt sich mit der RLS-Policy "advance_recipients_rw" - management sieht
  // zwar die Vorschuss-Liste, aber keine Empfänger-Details.
  const canSeeDetails =
    profile?.role === "admin" ||
    profile?.role === "kasse" ||
    profile?.role === "lohnabrechnung" ||
    profile?.role === "pruefer";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: adv }, { data: emp }, { data: gr }, { data: hk }] =
      await Promise.all([
        supabase
          .from("advances")
          .select("*")
          .order("datum", { ascending: false })
          .limit(100),
        supabase
          .from("employees")
          .select("id, personal_nr, name, vorname, aktiv, gruppe_nr, herkunft")
          .eq("aktiv", true)
          .order("name"),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
        supabase.from("herkuenfte").select("*").order("reihenfolge"),
      ]);
    setAdvances((adv as Advance[]) ?? []);
    setEmployees((emp as Employee[]) ?? []);
    setGruppen((gr as Arbeitsgruppe[]) ?? []);
    setHerkuenfte((hk as Herkunft[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Nach dem Öffnen des Druckdialogs (oder Abbruch) Druckauswahl zurücksetzen.
  useEffect(() => {
    function handleAfterPrint() {
      setDruckBeleg(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  useEffect(() => {
    if (druckBeleg === null) return;
    const id = setTimeout(() => window.print(), 50);
    return () => clearTimeout(id);
  }, [druckBeleg]);

  function istAusgewaehlt(id: string) {
    return ausgewaehlt.some((p) => p.employee_id === id);
  }

  function personHinzufuegen(emp: Employee) {
    if (istAusgewaehlt(emp.id)) return;
    setAusgewaehlt((prev) => [
      ...prev,
      {
        employee_id: emp.id,
        personal_nr: emp.personal_nr,
        name: emp.name,
        vorname: emp.vorname,
        betrag: basisBetrag || "0",
      },
    ]);
  }

  function personEntfernen(id: string) {
    setAusgewaehlt((prev) => prev.filter((p) => p.employee_id !== id));
  }

  function toggleEinzeln(emp: Employee) {
    if (istAusgewaehlt(emp.id)) personEntfernen(emp.id);
    else personHinzufuegen(emp);
  }

  function gruppeHinzufuegen() {
    if (!gruppenFilter) return;
    employees
      .filter((e) => e.gruppe_nr === gruppenFilter)
      .forEach(personHinzufuegen);
  }

  function herkunftHinzufuegen() {
    if (!herkunftFilter) return;
    employees
      .filter((e) => e.herkunft === herkunftFilter)
      .forEach(personHinzufuegen);
  }

  function betragAendern(id: string, wert: string) {
    setAusgewaehlt((prev) =>
      prev.map((p) => (p.employee_id === id ? { ...p, betrag: wert } : p))
    );
  }

  function basisBetragAufAlleAnwenden() {
    setAusgewaehlt((prev) => prev.map((p) => ({ ...p, betrag: basisBetrag || "0" })));
  }

  function auswahlLeeren() {
    setAusgewaehlt([]);
  }

  const summeAusgewaehlt = ausgewaehlt.reduce(
    (sum, p) => sum + (Number(p.betrag) || 0),
    0
  );

  function empfaengerTextAus(personen: AusgewaehltePerson[]) {
    const namen = personen.map((p) => `${p.name}, ${p.vorname}`);
    if (namen.length <= 6) return namen.join(" · ");
    return `${namen.slice(0, 3).join(" · ")} + ${namen.length - 3} weitere`;
  }

  const gefilterteEmployees = employees.filter((e) => {
    const q = suche.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  const jahreOptionen = Array.from(
    new Set(advances.map((a) => new Date(a.datum).getFullYear()))
  ).sort((a, b) => b - a);

  const advancesGefiltert = advances.filter((a) => {
    const d = new Date(a.datum);
    if (jahrFilter !== "alle" && d.getFullYear() !== jahrFilter) return false;
    if (monatFilter !== "alle" && d.getMonth() + 1 !== monatFilter) return false;
    return true;
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (ausgewaehlt.length === 0) {
      setError("Bitte mindestens eine Person auswählen.");
      return;
    }
    if (ausgewaehlt.some((p) => !(Number(p.betrag) > 0))) {
      setError("Bitte für jede ausgewählte Person einen Betrag > 0 eintragen.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();

    // Belegnummer wird serverseitig atomar vergeben (ADR-010), damit
    // gleichzeitige Erfassung durch mehrere Nutzer keine Duplikate erzeugt.
    const { data: belegnummer, error: belegError } = await supabase.rpc(
      "naechste_belegnummer",
      { prefix_monat: monatsSchluessel(new Date()) }
    );
    if (belegError) {
      setError(belegError.message);
      setSaving(false);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("advances")
      .insert({
        belegnummer,
        betrag: summeAusgewaehlt,
        empfaenger_text: empfaengerTextAus(ausgewaehlt),
        begruendung,
        uebergeben_an: uebergebenAn || null,
        zahlungsart,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    const { error: recipientsError } = await supabase
      .from("advance_recipients")
      .insert(
        ausgewaehlt.map((p) => ({
          advance_id: inserted.id,
          employee_id: p.employee_id,
          anteil: Number(p.betrag),
        }))
      );

    if (recipientsError) {
      setError(recipientsError.message);
      setSaving(false);
      return;
    }

    setLetzterBeleg({
      belegnummer,
      datum: inserted.datum,
      zahlungsart,
      storniert: false,
      uebergeben_an: uebergebenAn || null,
      empfaenger: ausgewaehlt.map((p) => ({
        employee_id: p.employee_id,
        personal_nr: p.personal_nr,
        name: p.name,
        vorname: p.vorname,
        anteil: Number(p.betrag),
      })),
    });

    setBasisBetrag("");
    setBegruendung("");
    setUebergebenAn("");
    setAusgewaehlt([]);
    setSaving(false);
    load();
  }

  async function storno(adv: Advance) {
    const grund = window.prompt(
      "Begründung für die Stornierung (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    const supabase = getSupabaseClient();
    await supabase
      .from("advances")
      .update({
        storniert: true,
        storno_grund: grund,
        storniert_am: new Date().toISOString(),
      })
      .eq("id", adv.id);
    load();
  }

  async function belegDrucken(adv: Advance) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("advance_recipients")
      .select("employee_id, anteil, employees(personal_nr, name, vorname)")
      .eq("advance_id", adv.id);
    if (error || !data) return;
    const empfaenger: AdvanceRecipientDetail[] = data.map((row: any) => ({
      employee_id: row.employee_id,
      personal_nr: row.employees?.personal_nr ?? "",
      name: row.employees?.name ?? "",
      vorname: row.employees?.vorname ?? "",
      anteil: Number(row.anteil ?? 0),
    }));
    setDruckBeleg({
      belegnummer: adv.belegnummer,
      datum: adv.datum,
      zahlungsart: adv.zahlungsart,
      storniert: adv.storniert,
      uebergeben_an: adv.uebergeben_an,
      empfaenger,
    });
  }

  async function toggleBearbeiten(adv: Advance) {
    if (bearbeitenAdvanceId === adv.id) {
      setBearbeitenAdvanceId(null);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("advance_recipients")
      .select("employee_id, anteil, employees(personal_nr, name, vorname)")
      .eq("advance_id", adv.id);
    if (error || !data) return;
    const empfaenger: AdvanceRecipientDetail[] = data.map((row: any) => ({
      employee_id: row.employee_id,
      personal_nr: row.employees?.personal_nr ?? "",
      name: row.employees?.name ?? "",
      vorname: row.employees?.vorname ?? "",
      anteil: Number(row.anteil ?? 0),
    }));
    setBearbeitenEmpfaenger(empfaenger);
    setKorrekturBetraege(
      Object.fromEntries(empfaenger.map((p) => [p.employee_id, String(p.anteil)]))
    );
    setBearbeitenAdvanceId(adv.id);
  }

  async function betragKorrigieren(
    advanceId: number,
    p: AdvanceRecipientDetail
  ) {
    const neuerWert = korrekturBetraege[p.employee_id];
    const neuerBetrag = Number(neuerWert);
    if (!neuerWert || !(neuerBetrag > 0)) return;
    if (neuerBetrag === p.anteil) return; // keine Änderung
    const hinweis = window.prompt(
      `Grund für die Korrektur von ${p.anteil.toFixed(2)} € auf ${neuerBetrag.toFixed(
        2
      )} € bei ${p.name}, ${p.vorname} (Pflichtfeld, wird protokolliert):`
    );
    if (!hinweis) return;

    setKorrekturLaeuft(p.employee_id);
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc("vorschuss_korrigieren", {
      p_advance_id: advanceId,
      p_employee_id: p.employee_id,
      p_neuer_betrag: neuerBetrag,
      p_hinweis: hinweis,
    });
    setKorrekturLaeuft(null);
    if (error) {
      window.alert(`Korrektur fehlgeschlagen: ${error.message}`);
      return;
    }
    setBearbeitenAdvanceId(null);
    load();
  }

  const anzeigeBeleg = druckBeleg ?? letzterBeleg;

  return (
    <div className="flex flex-col gap-6">
      <LohnTabs />
      <div className="print:hidden">
        <h1 className="text-lg font-semibold text-emerald-800">Vorschüsse</h1>
        <p className="text-sm text-neutral-500">
          Einzeln, gruppenweise oder nach Herkunft auswählen. Bestätigte
          Vorschüsse werden nicht gelöscht, sondern storniert - die
          Belegnummer und Historie bleiben nachvollziehbar.
        </p>
      </div>

      {canWrite && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded border border-neutral-200 bg-white p-4 print:hidden"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              type="number"
              step="0.01"
              placeholder="Betrag € pro Person"
              value={basisBetrag}
              onChange={(e) => setBasisBetrag(e.target.value)}
            />
            <select
              value={zahlungsart}
              onChange={(e) => setZahlungsart(e.target.value)}
            >
              <option value="BAR">BAR</option>
              <option value="AZ">Überweisung (AZ)</option>
            </select>
            <div className="col-span-2" />

            <div className="col-span-2 flex gap-2">
              <select
                value={gruppenFilter}
                onChange={(e) => setGruppenFilter(e.target.value)}
              >
                <option value="">Gruppe wählen…</option>
                {gruppen.map((g) => (
                  <option key={g.gruppe_nr} value={g.gruppe_nr}>
                    {g.gruppe_nr} – {g.bezeichnung}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary whitespace-nowrap text-xs"
                onClick={gruppeHinzufuegen}
              >
                Gruppe hinzufügen
              </button>
            </div>
            <div className="col-span-2 flex gap-2">
              <select
                value={herkunftFilter}
                onChange={(e) => setHerkunftFilter(e.target.value)}
              >
                <option value="">Herkunft wählen…</option>
                {herkuenfte.map((h) => (
                  <option key={h.wert} value={h.wert}>
                    {h.wert}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary whitespace-nowrap text-xs"
                onClick={herkunftHinzufuegen}
              >
                Herkunft hinzufügen
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">
              Einzeln hinzufügen (Suche nach Name oder Personalnummer):
            </p>
            <input
              placeholder="Suchen…"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              className="mb-2 w-72"
            />
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded border border-neutral-100 p-2">
              {gefilterteEmployees.map((emp) => (
                <label
                  key={emp.id}
                  className="flex items-center gap-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={istAusgewaehlt(emp.id)}
                    onChange={() => toggleEinzeln(emp)}
                  />
                  {emp.personal_nr} {emp.name}, {emp.vorname}
                </label>
              ))}
            </div>
          </div>

          {ausgewaehlt.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium">
                  Ausgewählt: {ausgewaehlt.length} Person(en), Summe:{" "}
                  {summeAusgewaehlt.toFixed(2)} €
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={basisBetragAufAlleAnwenden}
                  >
                    Betrag auf alle anwenden
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={auswahlLeeren}
                  >
                    Auswahl leeren
                  </button>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Pers.-Nr.</th>
                    <th>Name</th>
                    <th>Betrag €</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ausgewaehlt.map((p) => (
                    <tr key={p.employee_id}>
                      <td>{p.personal_nr}</td>
                      <td>
                        {p.name}, {p.vorname}
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          className="w-24"
                          value={p.betrag}
                          onChange={(e) =>
                            betragAendern(p.employee_id, e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => personEntfernen(p.employee_id)}
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <input
            placeholder="Begründung (optional)"
            value={begruendung}
            onChange={(e) => setBegruendung(e.target.value)}
          />

          <div className="flex flex-col gap-1">
            <input
              placeholder="Übergeben an (optional, z.B. Gruppenleiter)"
              value={uebergebenAn}
              onChange={(e) => setUebergebenAn(e.target.value)}
            />
            <p className="text-xs text-neutral-500">
              Falls jemand das Geld zur Verteilung an die einzelnen
              Empfänger bekommt: erscheint auf dem separaten
              Übergabe-Beleg beim Drucken (siehe unten).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              Vorschuss bestätigen
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      {letzterBeleg && (
        <div className="flex items-center gap-3 rounded border border-emerald-200 bg-emerald-50 p-3 print:hidden">
          <span className="text-sm text-emerald-800">
            Beleg {letzterBeleg.belegnummer} erfasst, Summe{" "}
            {letzterBeleg.empfaenger
              .reduce((s, p) => s + p.anteil, 0)
              .toFixed(2)}{" "}
            €.
          </span>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setDruckBeleg(letzterBeleg)}
          >
            Auszahlungsliste drucken
          </button>
        </div>
      )}

      {!loading && advances.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <label className="text-sm">
            Jahr{" "}
            <select
              value={jahrFilter}
              onChange={(e) =>
                setJahrFilter(
                  e.target.value === "alle" ? "alle" : Number(e.target.value)
                )
              }
            >
              <option value="alle">Alle</option>
              {jahreOptionen.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Monat{" "}
            <select
              value={monatFilter}
              onChange={(e) =>
                setMonatFilter(
                  e.target.value === "alle" ? "alle" : Number(e.target.value)
                )
              }
            >
              <option value="alle">Alle</option>
              {MONATSNAMEN.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-neutral-500">
            {advancesGefiltert.length} von {advances.length} Beleg(en)
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500 print:hidden">Lädt…</p>
      ) : advances.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Noch keine Vorschüsse erfasst.
        </p>
      ) : advancesGefiltert.length === 0 ? (
        <p className="text-neutral-500 print:hidden">
          Keine Vorschüsse für diesen Filter.
        </p>
      ) : (
        <table className="print:hidden">
          <thead>
            <tr>
              <th>Beleg-Nr.</th>
              <th>Datum</th>
              <th>Betrag €</th>
              <th>Empfänger</th>
              <th>Begründung</th>
              <th>Art</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {advancesGefiltert.map((a) => (
              <Fragment key={a.id}>
                <tr className={a.storniert ? "opacity-50" : ""}>
                  <td>{a.belegnummer}</td>
                  <td>{new Date(a.datum).toLocaleString("de-DE")}</td>
                  <td>{Number(a.betrag).toFixed(2)}</td>
                  <td>{a.empfaenger_text}</td>
                  <td>{a.begruendung}</td>
                  <td>{a.zahlungsart}</td>
                  <td>{a.storniert ? `storniert: ${a.storno_grund}` : "aktiv"}</td>
                  <td className="flex gap-2">
                    {canSeeDetails && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => belegDrucken(a)}
                      >
                        Drucken
                      </button>
                    )}
                    {canWrite && !a.storniert && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => toggleBearbeiten(a)}
                      >
                        {bearbeitenAdvanceId === a.id ? "Schließen" : "Bearbeiten"}
                      </button>
                    )}
                    {canWrite && !a.storniert && (
                      <button
                        className="btn-danger text-xs"
                        onClick={() => storno(a)}
                      >
                        Stornieren
                      </button>
                    )}
                  </td>
                </tr>
                {bearbeitenAdvanceId === a.id && (
                  <tr>
                    <td colSpan={8} className="bg-neutral-50">
                      <p className="mb-2 text-xs text-neutral-500">
                        Betrag ändern und auf „Speichern" klicken - Grund wird
                        abgefragt und protokolliert (wer, wann, Differenz).
                        Wirkt sich sofort auf den Kassenbestand aus.
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>Pers.-Nr.</th>
                            <th>Name</th>
                            <th>Betrag €</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bearbeitenEmpfaenger.map((p) => (
                            <tr key={p.employee_id}>
                              <td>{p.personal_nr}</td>
                              <td>
                                {p.name}, {p.vorname}
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-24"
                                  value={korrekturBetraege[p.employee_id] ?? ""}
                                  onChange={(e) =>
                                    setKorrekturBetraege((prev) => ({
                                      ...prev,
                                      [p.employee_id]: e.target.value,
                                    }))
                                  }
                                  disabled={korrekturLaeuft === p.employee_id}
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  disabled={korrekturLaeuft === p.employee_id}
                                  onClick={() => betragKorrigieren(a.id, p)}
                                >
                                  Speichern
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* Zwei getrennte Druckblätter - nur im Druck sichtbar.
          1) Mitarbeiter-Unterschriftenliste: wie bisher, aber ohne Summe -
             die Empfänger müssen die Gesamtsumme nicht sehen.
          2) Übergabe-Beleg: für die Person, die das Geld zur Verteilung
             bekommt (z.B. Gruppenleiter) - mit Summe und einem einzigen
             Unterschriftenfeld für diese Person, aber ohne
             Unterschriftenfelder je Empfänger. */}
      {anzeigeBeleg && (
        <div className="hidden print:block">
          <h2 className="text-xl font-semibold">
            Vorschuss-Auszahlung{anzeigeBeleg.storniert ? " (STORNIERT)" : ""}
          </h2>
          <p className="mt-1 text-base">
            Belegnummer: {anzeigeBeleg.belegnummer} · Datum:{" "}
            {new Date(anzeigeBeleg.datum).toLocaleDateString("de-DE")} ·{" "}
            {anzeigeBeleg.zahlungsart === "BAR" ? "Bar" : "Überweisung"}
          </p>
          <table className="mt-4 print-form-table">
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th>Betrag €</th>
                <th>Unterschrift</th>
              </tr>
            </thead>
            <tbody>
              {anzeigeBeleg.empfaenger.map((p) => (
                <tr key={p.employee_id}>
                  <td>{p.personal_nr}</td>
                  <td>
                    {p.name}, {p.vorname}
                  </td>
                  <td>{p.anteil.toFixed(2)}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="print-page-break">
            <h2 className="text-xl font-semibold">Vorschuss-Übergabe</h2>
            <p className="mt-1 text-base">
              Belegnummer: {anzeigeBeleg.belegnummer} · Datum:{" "}
              {new Date(anzeigeBeleg.datum).toLocaleDateString("de-DE")} ·{" "}
              {anzeigeBeleg.zahlungsart === "BAR" ? "Bar" : "Überweisung"}
            </p>
            <table className="mt-4 print-form-table">
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Betrag €</th>
                </tr>
              </thead>
              <tbody>
                {anzeigeBeleg.empfaenger.map((p) => (
                  <tr key={p.employee_id}>
                    <td>{p.personal_nr}</td>
                    <td>
                      {p.name}, {p.vorname}
                    </td>
                    <td>{p.anteil.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="text-right font-semibold">
                    Summe
                  </td>
                  <td className="font-semibold">
                    {anzeigeBeleg.empfaenger
                      .reduce((s, p) => s + p.anteil, 0)
                      .toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-6 text-base">
              Übergeben an:{" "}
              {anzeigeBeleg.uebergeben_an || (
                <span className="inline-block w-64 border-b-2 border-black">
                  &nbsp;
                </span>
              )}
            </p>
            <p className="mt-8 text-base">
              Unterschrift:{" "}
              <span className="ml-2 inline-block w-64 border-b-2 border-black">
                &nbsp;
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
