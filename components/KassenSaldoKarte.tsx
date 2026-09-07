"use client";

// Gemeinsame Kassensaldo-Karte für Journal (app/kasse) und Kassenprüfung
// (app/kasse-pruefung) - Nutzer-Vorgabe 2026-08-24, beim Aufteilen des
// Kassenbuchs in zwei Reiter. Selbstladend wie StundenkontoBereich/
// SvFragebogenFormular, damit die Berechnung nur an EINER Stelle gepflegt
// wird (die alte Version duplizierte "Einzahlungen − Bar-Vorschüsse −
// Bar-Auszahlungen − Kautionsübergaben" clientseitig aus capped Listen -
// genau das Muster, das im Projekt schon einmal zu einem Bug führte, siehe
// StundenkontoBereich-Kommentar). Nutzt jetzt die SQL-Funktion
// kassenbestand_bis() (echtes SUM() ohne Zeilenlimit).
//
// Seit den mehreren Kassenbüchern (Migration 2026-10-03) läuft das über
// kassenbuch_saldo_bis(<lohnkasse>): das ist kassenbestand_bis() PLUS die
// Umbuchungen von/zu der Lohnkasse. Ohne explizite kassenbuchId wird die
// Lohnkasse aufgelöst; die Kassenprüfung (Phase 2) reicht später eine
// konkrete Buch-ID herein.
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

interface KassenSaldoKarteProps {
  onSaldoChange?: (saldo: number) => void;
  kassenbuchId?: number;
}

export default function KassenSaldoKarte({
  onSaldoChange,
  kassenbuchId,
}: KassenSaldoKarteProps) {
  const [saldo, setSaldo] = useState<number | null>(null);
  const [laden, setLaden] = useState(true);

  async function laden_() {
    setLaden(true);
    const supabase = getSupabaseClient();
    let buchId = kassenbuchId;
    if (buchId == null) {
      const { data: lk } = await supabase
        .from("kassenbuch")
        .select("id")
        .eq("typ", "lohnkasse")
        .maybeSingle();
      buchId = (lk as { id: number } | null)?.id;
    }
    const { data } = buchId
      ? await supabase.rpc("kassenbuch_saldo_bis", { p_kassenbuch_id: buchId })
      : await supabase.rpc("kassenbestand_bis");
    const wert = data === null || data === undefined ? 0 : Number(data);
    setSaldo(wert);
    onSaldoChange?.(wert);
    setLaden(false);
  }

  useEffect(() => {
    laden_();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kassenbuchId]);

  return (
    <div className="rounded border border-linie bg-white p-4">
      <p className="text-sm text-neutral-500">Aktueller Kassensaldo</p>
      <p className="text-2xl font-semibold text-emerald-800">
        {laden || saldo === null ? "…" : `${saldo.toFixed(2)} €`}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Einzahlungen − Bar-Vorschüsse − Bar-Auszahlungen − Kautionsübergaben
        (Überweisungen zählen nicht zum Kassenbestand) - Details siehe
        Journal.
      </p>
    </div>
  );
}
