"use client";

// Einstellungen → Arbeitsgruppen. Gruppen (Sortierer, Träger, …) für die
// Gruppierung auf der Stundenerfassung und die Gruppenstundenzettel; die
// optionale Kultur legt die Stunden dieser Gruppe für die Kulturkosten in
// der jeweiligen Statistik zu Grunde.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import EinstellungenTabs from "@/components/EinstellungenTabs";
import { KULTUREN, KULTUR_LABELS, type Arbeitsgruppe } from "@/lib/types";

const leer = { gruppe_nr: "", bezeichnung: "", reihenfolge: "0", kultur: "" };

export default function ArbeitsgruppenPage() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(leer);
  const [editNr, setEditNr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await getSupabaseClient()
      .from("arbeitsgruppen")
      .select("*")
      .order("reihenfolge");
    setGruppen((data as Arbeitsgruppe[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function edit(g: Arbeitsgruppe) {
    setEditNr(g.gruppe_nr);
    setForm({
      gruppe_nr: g.gruppe_nr,
      bezeichnung: g.bezeichnung,
      reihenfolge: g.reihenfolge.toString(),
      kultur: g.kultur ?? "",
    });
  }

  function reset() {
    setEditNr(null);
    setForm(leer);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await getSupabaseClient().from("arbeitsgruppen").upsert({
      gruppe_nr: form.gruppe_nr,
      bezeichnung: form.bezeichnung,
      reihenfolge: Number(form.reihenfolge) || 0,
      kultur: form.kultur || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    reset();
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <EinstellungenTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Arbeitsgruppen</h1>
        <p className="text-sm text-neutral-500">
          Gruppen (z.B. Sortierer, Träger, Schälmannschaft) für die
          Gruppierung auf der Stundenerfassung und die gedruckten
          Gruppenstundenzettel. Die Reihenfolge bestimmt die Anzeige-/
          Druckreihenfolge. Die optionale Kultur ordnet die in dieser Gruppe
          erfassten Stunden einer Kultur zu – in der jeweiligen Statistik
          werden diese Stunden × Mindestlohn zusätzlich auf die geerntete
          Menge umgelegt.
        </p>
      </div>

      {isAdmin && (
        <form
          onSubmit={submit}
          className="grid grid-cols-2 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-5"
        >
          <input
            placeholder="Gruppen-Nr."
            required
            disabled={editNr !== null}
            value={form.gruppe_nr}
            onChange={(e) => setForm({ ...form, gruppe_nr: e.target.value })}
          />
          <input
            placeholder="Bezeichnung (z.B. Sortierer)"
            required
            value={form.bezeichnung}
            onChange={(e) => setForm({ ...form, bezeichnung: e.target.value })}
          />
          <input
            type="number"
            placeholder="Reihenfolge"
            value={form.reihenfolge}
            onChange={(e) => setForm({ ...form, reihenfolge: e.target.value })}
          />
          <select
            value={form.kultur}
            onChange={(e) => setForm({ ...form, kultur: e.target.value })}
          >
            <option value="">Kultur: keine</option>
            {KULTUREN.map((k) => (
              <option key={k} value={k}>
                {KULTUR_LABELS[k]}
              </option>
            ))}
          </select>
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              {editNr ? "Speichern" : "Anlegen"}
            </button>
            {editNr && (
              <button type="button" className="btn-secondary" onClick={reset}>
                Abbrechen
              </button>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      {!loading && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Gruppen-Nr.</th>
                <th>Bezeichnung</th>
                <th>Reihenfolge</th>
                <th>Kultur</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {gruppen.map((g) => (
                <tr key={g.gruppe_nr}>
                  <td>{g.gruppe_nr}</td>
                  <td>{g.bezeichnung}</td>
                  <td>{g.reihenfolge}</td>
                  <td>{g.kultur ? KULTUR_LABELS[g.kultur] : "—"}</td>
                  {isAdmin && (
                    <td>
                      <button
                        className="btn-secondary"
                        onClick={() => edit(g)}
                      >
                        Bearbeiten
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
