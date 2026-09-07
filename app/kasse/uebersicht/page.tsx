"use client";

// Übersicht aller Kassenbücher (Migration 2026-10-03, Phase 1). Zeigt je Buch
// den aktuellen Saldo und bietet die Umbuchung zwischen zwei beliebigen
// Büchern. admin kann den Eröffnungssaldo je Buch setzen (Phase 2 sperrt das,
// sobald das Buch eine freigegebene Kassenprüfung hat).

import { useCallback, useEffect, useState } from "react";
import { formatMenge } from "@/lib/format";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { Kassenbuch } from "@/lib/types";
import KassenbuchTabs from "@/components/KassenbuchTabs";
import UmbuchungForm from "@/components/UmbuchungForm";

export default function KassenbuecherUebersichtPage() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const [buecher, setBuecher] = useState<Kassenbuch[]>([]);
  const [salden, setSalden] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [editWert, setEditWert] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("kassenbuch")
      .select("*")
      .order("reihenfolge");
    const liste = (data as Kassenbuch[]) ?? [];
    setBuecher(liste);
    const eintraege = await Promise.all(
      liste.map((b) =>
        supabase
          .rpc("kassenbuch_saldo_bis", { p_kassenbuch_id: b.id })
          .then(({ data: s }) => [b.id, s == null ? 0 : Number(s)] as const)
      )
    );
    setSalden(Object.fromEntries(eintraege));
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  async function eroeffnungSpeichern(id: number) {
    const wert = Number(editWert.replace(",", "."));
    if (Number.isNaN(wert)) {
      setFehler("Ungültiger Betrag.");
      return;
    }
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("kassenbuch")
      .update({ eroeffnungssaldo: wert })
      .eq("id", id);
    if (error) {
      setFehler(error.message);
      return;
    }
    setEditId(null);
    laden();
  }

  return (
    <div className="flex flex-col gap-6">
      <KassenbuchTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Kassenbücher</h1>
        <p className="text-sm text-neutral-500">
          Aktueller Saldo je Buch. Eine Umbuchung wird in beiden betroffenen
          Büchern erfasst – als Ausgang im Quellbuch, als Eingang im Zielbuch.
        </p>
      </div>

      {fehler && <p className="text-sm text-red-600">⚠ {fehler}</p>}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {buecher.map((b) => (
              <div key={b.id} className="card flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-900">
                    {b.bezeichnung}
                  </span>
                  <span className="badge badge-neutral">{b.kuerzel}</span>
                </div>
                <span className="text-2xl font-semibold text-emerald-800">
                  {formatMenge(salden[b.id] ?? 0, 2)} €
                </span>
                <span className="text-xs text-neutral-500">
                  {b.typ === "lohnkasse"
                    ? "inkl. Vorschüsse / Auszahlungen / Kautionen"
                    : `Eröffnungssaldo ${formatMenge(b.eroeffnungssaldo, 2)} €`}
                </span>

                {isAdmin && b.typ === "allgemein" && (
                  <div className="mt-1">
                    {editId === b.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          className="w-28"
                          value={editWert}
                          onChange={(e) => setEditWert(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn text-xs"
                          onClick={() => eroeffnungSpeichern(b.id)}
                        >
                          Speichern
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => setEditId(null)}
                        >
                          Abbrechen
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => {
                          setEditId(b.id);
                          setEditWert(String(b.eroeffnungssaldo));
                        }}
                      >
                        Eröffnungssaldo ändern
                      </button>
                    )}
                  </div>
                )}

                <Link
                  href={b.typ === "lohnkasse" ? "/kasse" : `/kasse/buch?id=${b.id}`}
                  className="mt-1 text-sm text-emerald-700 underline"
                >
                  Journal öffnen
                </Link>
              </div>
            ))}
          </div>

          {(isAdmin || profile?.role === "kasse") && buecher.length > 1 && (
            <div>
              <h2 className="mb-2 text-base font-semibold text-emerald-800">
                Umbuchung
              </h2>
              <UmbuchungForm buecher={buecher} onDone={laden} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
