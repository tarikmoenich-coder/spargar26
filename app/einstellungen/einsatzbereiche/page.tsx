"use client";

// Einstellungen → Einsatzbereiche (Migration 2026-11-21). Grobe Einteilung
// für die Personalplanung (Spargel, Sortierung, Traktorfahrer, ...) - bewusst
// unabhängig von den feineren Arbeitsgruppen der Stundenerfassung.

import PageHeader from "@/components/PageHeader";
import { Shapes } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import EinstellungenTabs from "@/components/EinstellungenTabs";
import type { Einsatzbereich } from "@/lib/types";

const leer = { wert: "", reihenfolge: "0" };

export default function EinsatzbereichePage() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const [bereiche, setBereiche] = useState<Einsatzbereich[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(leer);
  const [editWert, setEditWert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await getSupabaseClient()
      .from("einsatzbereiche")
      .select("*")
      .order("reihenfolge");
    setBereiche((data as Einsatzbereich[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function edit(h: Einsatzbereich) {
    setEditWert(h.wert);
    setForm({ wert: h.wert, reihenfolge: h.reihenfolge.toString() });
  }

  function reset() {
    setEditWert(null);
    setForm(leer);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await getSupabaseClient().from("einsatzbereiche").upsert({
      wert: form.wert,
      reihenfolge: Number(form.reihenfolge) || 0,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    reset();
    load();
  }

  async function entfernen(wert: string) {
    if (!window.confirm(`Einsatzbereich „${wert}" entfernen?`)) return;
    setError(null);
    const { error } = await getSupabaseClient()
      .from("einsatzbereiche")
      .delete()
      .eq("wert", wert);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <EinstellungenTabs />
      <div>
        <PageHeader icon={Shapes} titel="Einsatzbereiche" />
        <p className="text-sm text-neutral-500">
          Grobe Einsatzbereiche für die Personalplanung (geplanter Bereich je
          Person, Übersicht je Herkunft). Unabhängig von den Arbeitsgruppen
          der Stundenerfassung. Wird ein Bereich entfernt, wird er bei
          den zugeordneten Personen geleert.
        </p>
      </div>

      {isAdmin && (
        <form
          onSubmit={submit}
          className="grid grid-cols-2 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-4"
        >
          <input
            placeholder="Einsatzbereich (z.B. Spargel)"
            required
            disabled={editWert !== null}
            value={form.wert}
            onChange={(e) => setForm({ ...form, wert: e.target.value })}
          />
          <input
            type="number"
            placeholder="Reihenfolge"
            value={form.reihenfolge}
            onChange={(e) => setForm({ ...form, reihenfolge: e.target.value })}
          />
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              {editWert ? "Speichern" : "Anlegen"}
            </button>
            {editWert && (
              <button type="button" className="btn-secondary" onClick={reset}>
                Abbrechen
              </button>
            )}
            {error && <span className="text-sm text-beere-600">{error}</span>}
          </div>
        </form>
      )}

      {!loading && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Einsatzbereich</th>
                <th>Reihenfolge</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {bereiche.map((h) => (
                <tr key={h.wert}>
                  <td>{h.wert}</td>
                  <td>{h.reihenfolge}</td>
                  {isAdmin && (
                    <td>
                      <div className="flex gap-1">
                        <button
                          className="btn-secondary"
                          onClick={() => edit(h)}
                        >
                          Bearbeiten
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => entfernen(h.wert)}
                        >
                          Entfernen
                        </button>
                      </div>
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
