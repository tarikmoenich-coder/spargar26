"use client";

// Einstellungen → Herkünfte. Feste Liste der Herkünfte für den Personalstamm
// (keine Tippfehler-Varianten), u.a. für die Auswahl bei Vorschüssen.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import EinstellungenTabs from "@/components/EinstellungenTabs";
import type { Herkunft } from "@/lib/types";

const leer = { wert: "", reihenfolge: "0" };

export default function HerkuenftePage() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(leer);
  const [editWert, setEditWert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await getSupabaseClient()
      .from("herkuenfte")
      .select("*")
      .order("reihenfolge");
    setHerkuenfte((data as Herkunft[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function edit(h: Herkunft) {
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
    const { error } = await getSupabaseClient().from("herkuenfte").upsert({
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

  return (
    <div className="flex flex-col gap-6">
      <EinstellungenTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Herkünfte</h1>
        <p className="text-sm text-neutral-500">
          Feste Liste der Herkünfte für den Personalstamm – damit sich
          Vorschüsse zuverlässig nach Herkunft auswählen lassen (keine
          Tippfehler-Varianten).
        </p>
      </div>

      {isAdmin && (
        <form
          onSubmit={submit}
          className="grid grid-cols-2 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-4"
        >
          <input
            placeholder="Herkunft (z.B. Kroatien)"
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
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      {!loading && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Herkunft</th>
                <th>Reihenfolge</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {herkuenfte.map((h) => (
                <tr key={h.wert}>
                  <td>{h.wert}</td>
                  <td>{h.reihenfolge}</td>
                  {isAdmin && (
                    <td>
                      <button
                        className="btn-secondary"
                        onClick={() => edit(h)}
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
