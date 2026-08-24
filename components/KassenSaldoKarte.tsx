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
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

interface KassenSaldoKarteProps {
  onSaldoChange?: (saldo: number) => void;
}

export default function KassenSaldoKarte({
  onSaldoChange,
}: KassenSaldoKarteProps) {
  const [saldo, setSaldo] = useState<number | null>(null);
  const [laden, setLaden] = useState(true);

  async function laden_() {
    setLaden(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase.rpc("kassenbestand_bis");
    const wert = data === null || data === undefined ? 0 : Number(data);
    setSaldo(wert);
    onSaldoChange?.(wert);
    setLaden(false);
  }

  useEffect(() => {
    laden_();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
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
