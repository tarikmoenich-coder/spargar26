"use client";

// Umbuchung zwischen zwei Kassenbüchern - eine Aktion, die serverseitig
// (kassenbuch_umbuchen, security definer) atomar zwei verknüpfte Zeilen
// anlegt: Ausgang im Quellbuch, Eingang im Zielbuch. Wiederverwendet auf
// der Kassenbuch-Übersicht, im Lohnkasse-Journal und in den Journalen der
// übrigen Bücher (dort mit fest vorgegebenem Quellbuch).

import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Kassenbuch } from "@/lib/types";

function heute() {
  return new Date().toISOString().slice(0, 10);
}

export default function UmbuchungForm({
  buecher,
  quelleFest,
  onDone,
}: {
  buecher: Kassenbuch[];
  /** Wenn gesetzt: Quellbuch ist fix (Journal eines bestimmten Buchs). */
  quelleFest?: number;
  onDone: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const [quelleId, setQuelleId] = useState<number | "">(quelleFest ?? "");
  const [zielId, setZielId] = useState<number | "">("");
  const [betrag, setBetrag] = useState("");
  const [datum, setDatum] = useState(heute());
  const [zweck, setZweck] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function zuruecksetzen() {
    setQuelleId(quelleFest ?? "");
    setZielId("");
    setBetrag("");
    setDatum(heute());
    setZweck("");
    setError(null);
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (quelleId === "" || zielId === "") {
      setError("Quell- und Zielkassenbuch wählen.");
      return;
    }
    if (quelleId === zielId) {
      setError("Quelle und Ziel müssen unterschiedlich sein.");
      return;
    }
    const betragZahl = Number(betrag.replace(",", "."));
    if (!betragZahl || betragZahl <= 0) {
      setError("Betrag muss größer als 0 sein.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: rpcError } = await getSupabaseClient().rpc(
      "kassenbuch_umbuchen",
      {
        p_quelle_id: quelleId,
        p_ziel_id: zielId,
        p_betrag: betragZahl,
        p_datum_kassenbuch: datum,
        p_verwendungszweck: zweck || null,
      }
    );
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setOffen(false);
    zuruecksetzen();
    onDone();
  }

  if (!offen) {
    return (
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => setOffen(true)}
      >
        + Umbuchung
      </button>
    );
  }

  return (
    <form
      onSubmit={speichern}
      className="flex flex-wrap items-end gap-3 rounded border border-linie bg-white p-4"
    >
      <label className="text-sm">
        Von
        <select
          className="mt-1 block"
          value={quelleId}
          disabled={quelleFest != null}
          onChange={(e) => setQuelleId(Number(e.target.value))}
        >
          <option value="">– wählen –</option>
          {buecher.map((b) => (
            <option key={b.id} value={b.id}>
              {b.bezeichnung}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Nach
        <select
          className="mt-1 block"
          value={zielId}
          onChange={(e) => setZielId(Number(e.target.value))}
        >
          <option value="">– wählen –</option>
          {buecher
            .filter((b) => b.id !== quelleId)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.bezeichnung}
              </option>
            ))}
        </select>
      </label>
      <label className="text-sm">
        Betrag €
        <input
          type="number"
          step="0.01"
          min="0.01"
          required
          className="mt-1 block w-28"
          value={betrag}
          onChange={(e) => setBetrag(e.target.value)}
        />
      </label>
      <label className="text-sm">
        Datum
        <input
          type="date"
          className="mt-1 block"
          value={datum}
          onChange={(e) => setDatum(e.target.value)}
        />
      </label>
      <label className="flex-1 text-sm">
        Verwendungszweck
        <input
          className="mt-1 block w-full"
          placeholder="optional"
          value={zweck}
          onChange={(e) => setZweck(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Bucht…" : "Umbuchen"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setOffen(false);
            zuruecksetzen();
          }}
        >
          Abbrechen
        </button>
      </div>
      {error && <span className="w-full text-sm text-red-600">{error}</span>}
    </form>
  );
}
