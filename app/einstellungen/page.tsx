"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { VerpflegungsSatz } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

export default function EinstellungenPage() {
  const { profile } = useProfile();
  const [saetze, setSaetze] = useState<VerpflegungsSatz[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    saison_jahr: CURRENT_YEAR.toString(),
    verpflegung: "10.00",
    wohnen: "10.00",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("verpflegungssaetze")
      .select("*")
      .order("saison_jahr", { ascending: false });
    if (!error) setSaetze((data as VerpflegungsSatz[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function editRow(satz: VerpflegungsSatz) {
    setForm({
      saison_jahr: satz.saison_jahr.toString(),
      verpflegung: satz.verpflegung.toString(),
      wohnen: satz.wohnen.toString(),
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("verpflegungssaetze").upsert({
      saison_jahr: Number(form.saison_jahr),
      verpflegung: Number(form.verpflegung),
      wohnen: Number(form.wohnen),
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Einstellungen
        </h1>
        <p className="text-sm text-neutral-500">
          Verpflegungs- und Unterkunft-Abzüge pro Anwesenheitstag, je
          Saisonjahr. Änderungen wirken sich nur auf das jeweilige Saisonjahr
          aus (ADR-007: versionierte Sätze) - bereits berechnete andere Jahre
          bleiben unverändert.
        </p>
      </div>

      {isAdmin ? (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-2 gap-3 rounded border border-neutral-200 bg-white p-4 sm:grid-cols-4"
        >
          <input
            type="number"
            placeholder="Saison-Jahr"
            required
            value={form.saison_jahr}
            onChange={(e) => setForm({ ...form, saison_jahr: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Verpflegung €/Tag"
            required
            value={form.verpflegung}
            onChange={(e) => setForm({ ...form, verpflegung: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Unterkunft €/Tag"
            required
            value={form.wohnen}
            onChange={(e) => setForm({ ...form, wohnen: e.target.value })}
          />
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              Speichern
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      ) : (
        <p className="text-sm text-neutral-500">
          Nur Administratoren können diese Sätze ändern.
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Saison-Jahr</th>
              <th>Verpflegung €/Tag</th>
              <th>Unterkunft €/Tag</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {saetze.map((s) => (
              <tr key={s.saison_jahr}>
                <td>{s.saison_jahr}</td>
                <td>{Number(s.verpflegung).toFixed(2)}</td>
                <td>{Number(s.wohnen).toFixed(2)}</td>
                {isAdmin && (
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => editRow(s)}
                    >
                      Bearbeiten
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
