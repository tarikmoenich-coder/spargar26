"use client";

import { useEffect, useRef, useState } from "react";

// Schmale Gruppen-Auswahl für die Stundenerfassung: zugeklappt steht nur die
// Gruppennummer, die aufgeklappte Liste zeigt "Nummer – Bezeichnung". Die
// Liste ist fixed positioniert, weil die Tabelle in einem scrollenden
// Container liegt, der ein absolut positioniertes Menü abschneiden würde.
export default function GruppenAuswahl({
  wert,
  gruppen,
  keineLabel,
  onWaehlen,
}: {
  wert: string | null;
  gruppen: { gruppe_nr: string; bezeichnung: string }[];
  keineLabel: string;
  onWaehlen: (nr: string) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const knopf = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLUListElement>(null);
  const aktuell = gruppen.find((g) => g.gruppe_nr === wert);

  useEffect(() => {
    if (!pos) return;
    const schliessen = () => setPos(null);
    const aussen = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!liste.current?.contains(n) && !knopf.current?.contains(n)) schliessen();
    };
    const taste = (e: KeyboardEvent) => e.key === "Escape" && schliessen();
    document.addEventListener("mousedown", aussen);
    document.addEventListener("keydown", taste);
    window.addEventListener("scroll", schliessen, true);
    window.addEventListener("resize", schliessen);
    return () => {
      document.removeEventListener("mousedown", aussen);
      document.removeEventListener("keydown", taste);
      window.removeEventListener("scroll", schliessen, true);
      window.removeEventListener("resize", schliessen);
    };
  }, [pos]);

  function oeffnen() {
    if (pos) return setPos(null);
    const r = knopf.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 2 });
  }

  return (
    <>
      <button
        ref={knopf}
        type="button"
        className="w-16 rounded border border-linie bg-white px-1 py-1 text-left text-sm"
        title={aktuell?.bezeichnung ?? keineLabel}
        onClick={oeffnen}
      >
        {wert ?? "—"} <span className="text-neutral-400">▾</span>
      </button>
      {pos && (
        <ul
          ref={liste}
          className="fixed z-50 max-h-72 overflow-y-auto rounded border border-linie bg-white py-1 text-sm shadow-lg"
          style={{ left: pos.left, top: pos.top }}
        >
          <li>
            <button
              type="button"
              className="block w-full px-3 py-1 text-left hover:bg-sand"
              onClick={() => {
                setPos(null);
                onWaehlen("");
              }}
            >
              {keineLabel}
            </button>
          </li>
          {gruppen.map((g) => (
            <li key={g.gruppe_nr}>
              <button
                type="button"
                className={`block w-full whitespace-nowrap px-3 py-1 text-left hover:bg-sand ${g.gruppe_nr === wert ? "font-semibold text-emerald-800" : ""}`}
                onClick={() => {
                  setPos(null);
                  onWaehlen(g.gruppe_nr);
                }}
              >
                {g.gruppe_nr} – {g.bezeichnung}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
