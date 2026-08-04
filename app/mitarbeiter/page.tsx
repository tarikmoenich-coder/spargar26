"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  ABRECHNUNGSART_LABELS,
  type Abrechnungsart,
  type Employee,
} from "@/lib/types";

const emptyForm = {
  personal_nr: "",
  name: "",
  vorname: "",
  geburtsdatum: "",
  ort: "",
  land: "",
  stundenlohn: "",
  abrechnungsart: "sozialversicherungspflichtig" as Abrechnungsart,
  sozialversicherungsnummer: "",
  steuer_id: "",
  iban: "",
  bic: "",
  zahlungsempfaenger: "",
};

export default function MitarbeiterPage() {
  const { profile } = useProfile();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [aktivSeit, setAktivSeit] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase.from("employees").select("*").order("name");
    if (!showInactive) query = query.eq("aktiv", true);
    const [{ data, error }, { data: ersteTage }] = await Promise.all([
      query,
      supabase.from("employee_erster_arbeitstag").select("*"),
    ]);
    if (!error) setEmployees((data as Employee[]) ?? []);
    const map: Record<string, string> = {};
    (ersteTage ?? []).forEach((row: { employee_id: string; erster_arbeitstag: string }) => {
      map[row.employee_id] = row.erster_arbeitstag;
    });
    setAktivSeit(map);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setForm({
      personal_nr: emp.personal_nr,
      name: emp.name,
      vorname: emp.vorname,
      geburtsdatum: emp.geburtsdatum ?? "",
      ort: emp.ort ?? "",
      land: emp.land ?? "",
      stundenlohn: emp.stundenlohn?.toString() ?? "",
      abrechnungsart: emp.abrechnungsart ?? "sozialversicherungspflichtig",
      sozialversicherungsnummer: emp.sozialversicherungsnummer ?? "",
      steuer_id: emp.steuer_id ?? "",
      iban: emp.iban ?? "",
      bic: emp.bic ?? "",
      zahlungsempfaenger: emp.zahlungsempfaenger ?? "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const payload = {
      personal_nr: form.personal_nr,
      name: form.name,
      vorname: form.vorname,
      geburtsdatum: form.geburtsdatum || null,
      ort: form.ort || null,
      land: form.land || null,
      stundenlohn: form.stundenlohn ? Number(form.stundenlohn) : null,
      abrechnungsart: form.abrechnungsart,
      sozialversicherungsnummer: form.sozialversicherungsnummer || null,
      steuer_id: form.steuer_id || null,
      iban: form.iban || null,
      bic: form.bic || null,
      zahlungsempfaenger: form.zahlungsempfaenger || null,
    };

    const { error } = editingId
      ? await supabase.from("employees").update(payload).eq("id", editingId)
      : await supabase.from("employees").insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    resetForm();
    load();
  }

  async function toggleActive(emp: Employee) {
    // ADR-011: kein Löschen, nur Deaktivieren/Reaktivieren - Historie bleibt.
    const supabase = getSupabaseClient();
    await supabase
      .from("employees")
      .update({ aktiv: !emp.aktiv })
      .eq("id", emp.id);
    load();
  }

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Personal</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten der Mitarbeiter. Löschen ist nicht möglich - Personen
          werden bei Bedarf deaktiviert, die Historie bleibt erhalten.
        </p>
      </div>

      {canEdit && (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-2 gap-3 rounded border border-neutral-200 bg-white p-4 sm:grid-cols-4"
        >
          <input
            placeholder="Personalnummer"
            required
            value={form.personal_nr}
            onChange={(e) => setForm({ ...form, personal_nr: e.target.value })}
          />
          <input
            placeholder="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Vorname"
            required
            value={form.vorname}
            onChange={(e) => setForm({ ...form, vorname: e.target.value })}
          />
          <input
            type="date"
            placeholder="Geburtsdatum"
            value={form.geburtsdatum}
            onChange={(e) =>
              setForm({ ...form, geburtsdatum: e.target.value })
            }
          />
          <input
            placeholder="Ort"
            value={form.ort}
            onChange={(e) => setForm({ ...form, ort: e.target.value })}
          />
          <input
            placeholder="Land"
            value={form.land}
            onChange={(e) => setForm({ ...form, land: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Stundenlohn €"
            value={form.stundenlohn}
            onChange={(e) =>
              setForm({ ...form, stundenlohn: e.target.value })
            }
          />
          <select
            value={form.abrechnungsart}
            onChange={(e) =>
              setForm({
                ...form,
                abrechnungsart: e.target.value as Abrechnungsart,
              })
            }
          >
            {Object.entries(ABRECHNUNGSART_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            placeholder="Sozialversicherungsnummer"
            value={form.sozialversicherungsnummer}
            onChange={(e) =>
              setForm({ ...form, sozialversicherungsnummer: e.target.value })
            }
          />
          <input
            placeholder="Steuer-ID"
            value={form.steuer_id}
            onChange={(e) => setForm({ ...form, steuer_id: e.target.value })}
          />
          <input
            placeholder="IBAN"
            value={form.iban}
            onChange={(e) => setForm({ ...form, iban: e.target.value })}
          />
          <input
            placeholder="BIC"
            value={form.bic}
            onChange={(e) => setForm({ ...form, bic: e.target.value })}
          />
          <input
            placeholder="Zahlungsempfänger"
            value={form.zahlungsempfaenger}
            onChange={(e) =>
              setForm({ ...form, zahlungsempfaenger: e.target.value })
            }
          />
          <div className="col-span-full flex gap-2">
            <button type="submit" className="btn" disabled={saving}>
              {editingId ? "Speichern" : "Anlegen"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetForm}
              >
                Abbrechen
              </button>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      <div className="flex items-center gap-3">
        <input
          placeholder="Suche nach Name oder Personalnummer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          inaktive anzeigen
        </label>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pers.-Nr.</th>
              <th>Name</th>
              <th>Vorname</th>
              <th>Ort</th>
              <th>€/Std.</th>
              <th>Abrechnungsart</th>
              <th>Aktiv seit</th>
              <th>Status</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => (
              <tr key={emp.id} className={emp.aktiv ? "" : "opacity-50"}>
                <td>{emp.personal_nr}</td>
                <td>{emp.name}</td>
                <td>{emp.vorname}</td>
                <td>{emp.ort}</td>
                <td>{emp.stundenlohn?.toFixed(2)}</td>
                <td>{ABRECHNUNGSART_LABELS[emp.abrechnungsart]}</td>
                <td>{aktivSeit[emp.id] ?? "—"}</td>
                <td>{emp.aktiv ? "aktiv" : "inaktiv"}</td>
                {canEdit && (
                  <td className="flex gap-2">
                    <button
                      className="btn-secondary"
                      onClick={() => startEdit(emp)}
                    >
                      Bearbeiten
                    </button>
                    <button
                      className={emp.aktiv ? "btn-danger" : "btn-secondary"}
                      onClick={() => toggleActive(emp)}
                    >
                      {emp.aktiv ? "Deaktivieren" : "Reaktivieren"}
                    </button>
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
