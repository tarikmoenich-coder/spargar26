"use client";

// "Anbau → Bestellung" (Nutzer-Vorgabe 2026-08-11, nur admin/erntewirtschaft).
// Ersetzt die Handarbeit in den Excel-Zeilen 29-36 (Gesamt je Sorte /
// bestellt / selbst / Differenzbedarf / Reserve 15 % / Gesamt inkl. Reserve).
//
// Der BEDARF kommt live aus der Anbauplanung - jede Sortenmenge ist die
// Summe ihrer Bepflanzungen. Eingetragen werden nur Bestellmenge, eigener
// Bestand und der Reserve-Satz.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import AnbauTabs from "@/components/AnbauTabs";
import type { ErdbeerenBestellungUebersicht } from "@/lib/types";
import { formatZahlDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

export default function AnbauBestellungPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" || profile?.role === "erntewirtschaft";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [zeilen, setZeilen] = useState<ErdbeerenBestellungUebersicht[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neueSorte, setNeueSorte] = useState("");

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("erdbeeren_bestellung_uebersicht")
      .select("*")
      .eq("saison_jahr", jahr)
      .order("sorte");
    setZeilen((data as ErdbeerenBestellungUebersicht[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  // Bestellzeile anlegen oder ändern. Die Sicht ist ein voller Verbund aus
  // Bedarf und Bestellung - eine Sorte kann also angezeigt werden, ohne dass
  // es schon einen Bestell-Datensatz gibt. Deshalb upsert statt update.
  async function speichern(
    sorte: string,
    feld: "bestellt_anzahl" | "eigene_anzahl" | "reserve_prozent" | "lieferant",
    wert: string
  ) {
    setFehler(null);
    const supabase = getSupabaseClient();
    const zahl = feld !== "lieferant";
    const { error } = await supabase.from("erdbeeren_bestellung").upsert(
      {
        saison_jahr: jahr,
        sorte,
        [feld]: zahl ? (wert ? Number(wert) : null) : wert || null,
      },
      { onConflict: "saison_jahr,sorte" }
    );
    if (error) setFehler(error.message);
    load();
  }

  async function sorteAnlegen() {
    if (!neueSorte.trim()) return;
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("erdbeeren_bestellung")
      .insert({ saison_jahr: jahr, sorte: neueSorte.trim() });
    if (error) setFehler(error.message);
    setNeueSorte("");
    load();
  }

  const summe = (feld: keyof ErdbeerenBestellungUebersicht) =>
    zeilen.reduce((s, z) => s + (Number(z[feld]) || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <AnbauTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Pflanzen-Bestellung
        </h1>
        <p className="text-sm text-neutral-500">
          Der Bedarf je Sorte kommt direkt aus der Anbauplanung – er ist die
          Summe aller Bepflanzungen dieser Saison. Einzutragen sind nur
          Bestellmenge, eigener Bestand und der Reserve-Satz. Die Differenz
          zeigt, was noch fehlt (positiv) oder zu viel bestellt ist (negativ).
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-4 bg-neutral-50 py-2 text-sm">
        <label>
          Saison{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        {canEdit && (
          <>
            <input
              placeholder="Sorte ergänzen…"
              value={neueSorte}
              onChange={(e) => setNeueSorte(e.target.value)}
              className="w-40"
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={sorteAnlegen}
              disabled={!neueSorte.trim()}
              title="Für eine Sorte bestellen, die (noch) in keiner Bepflanzung steht"
            >
              Hinzufügen
            </button>
          </>
        )}
      </div>

      {fehler && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : zeilen.length === 0 ? (
        <p className="text-neutral-500">
          Für {jahr} ist noch nichts geplant und nichts bestellt.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Sorte</th>
                <th title="Summe aller Bepflanzungen dieser Saison - kommt aus der Anbauplanung">
                  Bedarf
                </th>
                <th>Reserve %</th>
                <th>Bedarf inkl. Reserve</th>
                <th>Bestellt</th>
                <th title="Eigene Vermehrung oder Restbestand - wird vom Bedarf abgezogen">
                  Selbst
                </th>
                <th title="Positiv = fehlt noch, negativ = zu viel bestellt">
                  Differenz
                </th>
                <th>Lieferant</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.sorte}>
                  <td className="font-medium">{z.sorte}</td>
                  <td>{formatZahlDE(z.bedarf_pflanzen)}</td>
                  <td>
                    <input
                      type="number"
                      step="0.5"
                      defaultValue={z.reserve_prozent}
                      disabled={!canEdit}
                      className="w-16"
                      onBlur={(e) =>
                        speichern(z.sorte, "reserve_prozent", e.target.value)
                      }
                    />
                  </td>
                  <td>{formatZahlDE(z.bedarf_mit_reserve)}</td>
                  <td>
                    <input
                      type="number"
                      defaultValue={z.bestellt_anzahl ?? ""}
                      disabled={!canEdit}
                      className="w-24"
                      onBlur={(e) =>
                        speichern(z.sorte, "bestellt_anzahl", e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      defaultValue={z.eigene_anzahl ?? ""}
                      disabled={!canEdit}
                      className="w-24"
                      onBlur={(e) =>
                        speichern(z.sorte, "eigene_anzahl", e.target.value)
                      }
                    />
                  </td>
                  <td
                    className={
                      z.differenz > 0
                        ? "font-medium text-red-600"
                        : z.differenz < 0
                          ? "font-medium text-amber-600"
                          : "text-emerald-700"
                    }
                  >
                    {formatZahlDE(z.differenz)}
                  </td>
                  <td>
                    <input
                      defaultValue={z.lieferant ?? ""}
                      disabled={!canEdit}
                      className="w-32"
                      onBlur={(e) =>
                        speichern(z.sorte, "lieferant", e.target.value)
                      }
                    />
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td>Gesamt</td>
                <td>{formatZahlDE(summe("bedarf_pflanzen"))}</td>
                <td></td>
                <td>{formatZahlDE(summe("bedarf_mit_reserve"))}</td>
                <td>{formatZahlDE(summe("bestellt_anzahl"))}</td>
                <td>{formatZahlDE(summe("eigene_anzahl"))}</td>
                <td>{formatZahlDE(summe("differenz"))}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
