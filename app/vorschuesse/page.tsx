"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { Advance, Employee } from "@/lib/types";

function monatsSchluessel(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${mm}-${d.getFullYear()}`;
}

export default function VorschuessePage() {
  const { profile } = useProfile();
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [betrag, setBetrag] = useState("");
  const [empfaengerText, setEmpfaengerText] = useState("");
  const [begruendung, setBegruendung] = useState("");
  const [zahlungsart, setZahlungsart] = useState("BAR");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = profile?.role === "admin" || profile?.role === "kasse";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: adv }, { data: emp }] = await Promise.all([
      supabase
        .from("advances")
        .select("*")
        .order("datum", { ascending: false })
        .limit(100),
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname")
        .eq("aktiv", true)
        .order("name"),
    ]);
    setAdvances((adv as Advance[]) ?? []);
    setEmployees((emp as Employee[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedEmployees.length === 0) {
      setError("Bitte mindestens eine Person auswählen.");
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
        betrag: Number(betrag),
        empfaenger_text: empfaengerText,
        begruendung,
        zahlungsart,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    await supabase.from("advance_recipients").insert(
      selectedEmployees.map((employee_id) => ({
        advance_id: inserted.id,
        employee_id,
        anteil: Number(betrag) / selectedEmployees.length,
      }))
    );

    setBetrag("");
    setEmpfaengerText("");
    setBegruendung("");
    setSelectedEmployees([]);
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Vorschüsse</h1>
        <p className="text-sm text-neutral-500">
          Bestätigte Vorschüsse werden nicht gelöscht, sondern storniert -
          die Belegnummer und Historie bleiben nachvollziehbar.
        </p>
      </div>

      {canWrite && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded border border-neutral-200 bg-white p-4"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              type="number"
              step="0.01"
              placeholder="Betrag €"
              required
              value={betrag}
              onChange={(e) => setBetrag(e.target.value)}
            />
            <select
              value={zahlungsart}
              onChange={(e) => setZahlungsart(e.target.value)}
            >
              <option value="BAR">BAR</option>
              <option value="AZ">Überweisung (AZ)</option>
            </select>
            <input
              placeholder="Empfänger (Freitext, z.B. mehrere Namen)"
              value={empfaengerText}
              onChange={(e) => setEmpfaengerText(e.target.value)}
              className="col-span-2"
            />
            <input
              placeholder="Begründung"
              value={begruendung}
              onChange={(e) => setBegruendung(e.target.value)}
              className="col-span-full"
            />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Empfänger auswählen:</p>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded border border-neutral-100 p-2">
              {employees.map((emp) => (
                <label
                  key={emp.id}
                  className="flex items-center gap-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedEmployees.includes(emp.id)}
                    onChange={(e) =>
                      setSelectedEmployees((prev) =>
                        e.target.checked
                          ? [...prev, emp.id]
                          : prev.filter((id) => id !== emp.id)
                      )
                    }
                  />
                  {emp.personal_nr} {emp.name}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              Vorschuss erfassen
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Beleg-Nr.</th>
              <th>Datum</th>
              <th>Betrag €</th>
              <th>Empfänger</th>
              <th>Begründung</th>
              <th>Art</th>
              <th>Status</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {advances.map((a) => (
              <tr key={a.id} className={a.storniert ? "opacity-50" : ""}>
                <td>{a.belegnummer}</td>
                <td>{new Date(a.datum).toLocaleString("de-DE")}</td>
                <td>{Number(a.betrag).toFixed(2)}</td>
                <td>{a.empfaenger_text}</td>
                <td>{a.begruendung}</td>
                <td>{a.zahlungsart}</td>
                <td>{a.storniert ? `storniert: ${a.storno_grund}` : "aktiv"}</td>
                {canWrite && (
                  <td>
                    {!a.storniert && (
                      <button
                        className="btn-danger"
                        onClick={() => storno(a)}
                      >
                        Stornieren
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
