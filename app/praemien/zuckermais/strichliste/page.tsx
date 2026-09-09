"use client";

// Blanko-Strichliste Zuckermais zum Ausdrucken (Nutzer-Vorgabe 2026-09-09,
// auf 2 A3-Seiten verbreitert 2026-09-09) - ersetzt die von Hand gepflegte
// A3-Papierliste. Wird BLANKO gedruckt; die Halle trägt Datum und
// Arbeitszeiten selbst ein. Personen: genau die für Zuckermais
// freigegebenen, aktiven (employees.praemien_zuckermais = true, aktiv = true)
// - kein weiterer Gruppenfilter (die Halle entliest als eine Gruppe).
//
// Zwei A3-Querseiten mit denselben Personen-Zeilen (gleiche Zeilenhöhe, damit
// sie nebeneinandergelegt fluchten): Seite 1 = Kreuzfelder 1-22 + 12
// Nacharbeit-Felder, Seite 2 = Kreuzfelder 23-42 + 10 Nacharbeit-Felder +
// "Übertrag spargar". Felder ~quadratisch (10 mm), groß genug für die Halle.
// Reine Druckseite - keine Erfassung, keine Migration. Rückerfassung = Phase 2.

import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Employee } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fehlercodes für die Nacharbeit-Felder. HIER ANPASSEN, wenn sich die
// Einteilung ändert (was ist "K.O.", was noch "packbar") - die Liste
// erscheint 1:1 in der Legende unter der Strichliste. Kürzel kurz halten
// (2 Zeichen), damit sie in ein Feld passen.
// ---------------------------------------------------------------------------
const FEHLER_CODES: { code: string; text: string }[] = [
  { code: "K1", text: "Fäden nicht entfernt" },
  { code: "K2", text: "Wurm-/Zünslerbefall" },
  { code: "K3", text: "Fäulnis / Schimmel" },
  { code: "K4", text: "Fremdkörper" },
  { code: "K5", text: "Hüllblatt-/Lieschrest" },
  { code: "N1", text: "Spitze offen / unreif" },
  { code: "N2", text: "überreif / dellig" },
  { code: "N3", text: "Schnitt / Stiel zu lang" },
  { code: "N4", text: "Druckstelle" },
];

// Kreuzfelder je Person, aufgeteilt auf 2 Seiten (Seite 1: 1-22, Seite 2:
// 23-42) - Summe deckt "manche schaffen 40 in der Halbschicht" mit Reserve.
const SEITE1_KISTEN = 22;
const SEITE2_KISTEN = 20;
const SEITE1_NA = 12;
const SEITE2_NA = 10;
const MIN_ZEILEN = 20; // mind. so viele Zeilen (Reserve zum Nachtragen)

type Zeile = { key: string; nr: number; name: string };

// Dicke Linie an der RECHTEN Kante jedes 5. Kreuzfelds (5, 10 … 40).
const feldKlasse = (n: number) => "sl-k" + (n % 5 === 0 ? " sl-k5" : "");
// Dicke Umrandung um den ganzen Nacharbeit-Block.
const naKlasse = (n: number, total: number) =>
  "sl-na" + (n === 1 ? " sl-na-l" : "") + (n === total ? " sl-na-r" : "");

function bereich(von: number, bis: number) {
  return Array.from({ length: bis - von + 1 }, (_, i) => von + i);
}

function Tabelle({
  zeilen,
  kistenNummern,
  naAnzahl,
  mitUebertrag,
}: {
  zeilen: Zeile[];
  kistenNummern: number[];
  naAnzahl: number;
  mitUebertrag: boolean;
}) {
  const na = bereich(1, naAnzahl);
  return (
    <table className="sl-tab">
      <colgroup>
        <col className="c-nr" />
        <col className="c-name" />
        {kistenNummern.map((n) => (
          <col key={"c" + n} className="c-k" />
        ))}
        {na.map((n) => (
          <col key={"cn" + n} className="c-na" />
        ))}
        {mitUebertrag && (
          <>
            <col className="c-sum" />
            <col className="c-sum" />
            <col className="c-sum" />
          </>
        )}
      </colgroup>
      <thead>
        <tr>
          <th rowSpan={2}>Nr</th>
          <th rowSpan={2} className="sl-l">
            Name
          </th>
          <th colSpan={kistenNummern.length}>
            Kiste i.O. — Kreuz (X) je Kiste
          </th>
          <th colSpan={naAnzahl} className="sl-na sl-na-l sl-na-r">
            Nacharbeit — Fehlercode je abgelehnter Kiste
          </th>
          {mitUebertrag && <th colSpan={3}>Übertrag spargar</th>}
        </tr>
        <tr>
          {kistenNummern.map((n) => (
            <th key={"h" + n} className={feldKlasse(n)}>
              {n}
            </th>
          ))}
          {na.map((n) => (
            <th key={"hn" + n} className={naKlasse(n, naAnzahl)}></th>
          ))}
          {mitUebertrag && (
            <>
              <th>Σ i.O.</th>
              <th>Σ NA</th>
              <th>Std.</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => (
          <tr key={z.key}>
            <td className="sl-c">{z.nr}</td>
            <td className="sl-l">{z.name}</td>
            {kistenNummern.map((n) => (
              <td key={z.key + "k" + n} className={feldKlasse(n)}></td>
            ))}
            {na.map((n) => (
              <td key={z.key + "n" + n} className={naKlasse(n, naAnzahl)}></td>
            ))}
            {mitUebertrag && (
              <>
                <td></td>
                <td></td>
                <td></td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ZuckermaisStrichlistePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const gedruckt = useRef(false);

  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient()
        .from("employees")
        .select("id, name, vorname")
        .eq("aktiv", true)
        .eq("praemien_zuckermais", true)
        .order("name");
      setEmployees((data as Employee[]) ?? []);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (loading || gedruckt.current || employees.length === 0) return;
    gedruckt.current = true;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [loading, employees.length]);

  const leerzeilen = Math.max(0, MIN_ZEILEN - employees.length);
  const zeilen: Zeile[] = [
    ...employees.map((e, i) => ({
      key: e.id,
      nr: i + 1,
      name: `${e.name}, ${e.vorname}`,
    })),
    ...Array.from({ length: leerzeilen }, (_, i) => ({
      key: "leer" + i,
      nr: employees.length + i + 1,
      name: "",
    })),
  ];

  const kistenS1 = bereich(1, SEITE1_KISTEN);
  const kistenS2 = bereich(SEITE1_KISTEN + 1, SEITE1_KISTEN + SEITE2_KISTEN);

  return (
    <div className="strichliste-print -mx-4 -my-6">
      <div className="sl-bar print:hidden">
        <button type="button" className="btn" onClick={() => window.print()}>
          Drucken
        </button>
        <span className="sl-hint">
          Blanko, 2 A3-Seiten quer. Seite 1: Kisten 1–{SEITE1_KISTEN}. Seite 2:
          Kisten {SEITE1_KISTEN + 1}–{SEITE1_KISTEN + SEITE2_KISTEN} + Übertrag.
          Kein A3-Drucker? Im Druckdialog „An Seite anpassen" auf A4.
        </span>
      </div>

      {/* Seite 1 */}
      <div className="sl-blatt">
        <div className="sl-kopf">
          <div className="sl-titel">
            Zuckermais – Strichliste <span className="sl-seite">Seite 1 / 2</span>
          </div>
          <div className="sl-felder">
            <span>
              <b>Datum:</b>
              <span className="sl-line" />
            </span>
            <span>
              <b>Arbeitszeit von</b>
              <span className="sl-line" /> <b>bis</b>
              <span className="sl-line" />
            </span>
            <span>
              <b>Pause(n):</b>
              <span className="sl-line" />
            </span>
            <span>
              <b>Schichtmuster gezogen</b> <span className="sl-box" />{" "}
              <b>Ergebnis:</b> <span className="sl-linenum" /> / 20 Kolben i.O.
            </span>
            <span>
              <b>Prüfer:</b>
              <span className="sl-line" />
            </span>
          </div>
        </div>

        <Tabelle
          zeilen={zeilen}
          kistenNummern={kistenS1}
          naAnzahl={SEITE1_NA}
          mitUebertrag={false}
        />

        <div className="sl-legende sl-legende-kurz">
          <b>X</b> = Kiste i.O. &nbsp;·&nbsp; Nacharbeit-Feld: Fehlercode
          eintragen (Codes und Übertrag siehe Seite 2). &nbsp;·&nbsp; Weitere
          Kisten ab Nr. {SEITE1_KISTEN + 1} auf Seite 2.
        </div>
      </div>

      {/* Seite 2 */}
      <div className="sl-blatt sl-seite2">
        <div className="sl-kopf sl-kopf-kurz">
          <div className="sl-titel">
            Zuckermais – Strichliste <span className="sl-seite">Seite 2 / 2</span>
          </div>
          <div className="sl-felder">
            <span>
              <b>Datum:</b>
              <span className="sl-line" />
            </span>
            <span>
              <b>Prüfer:</b>
              <span className="sl-line" />
            </span>
          </div>
        </div>

        <Tabelle
          zeilen={zeilen}
          kistenNummern={kistenS2}
          naAnzahl={SEITE2_NA}
          mitUebertrag
        />

        <div className="sl-legende">
          <b>X</b> = Kiste i.O. &nbsp;·&nbsp; <b>Nacharbeit-Feld:</b>{" "}
          Fehlercode eintragen —{" "}
          {FEHLER_CODES.map((c) => `${c.code} ${c.text}`).join(" · ")}{" "}
          &nbsp;·&nbsp; nachgearbeitet &amp; i.O. = Häkchen, verworfen = Code
          einkreisen. &nbsp;·&nbsp; Unterbrechungen als Uhrzeit ins jeweilige
          Kistenfeld schreiben. &nbsp;·&nbsp; <b>Übertrag spargar:</b> je
          Schicht Σ i.O. (angenommene Kisten), Σ NA (Nacharbeit-Kisten) und
          Std. (Arbeitsstunden) eintragen.
        </div>
      </div>
    </div>
  );
}
