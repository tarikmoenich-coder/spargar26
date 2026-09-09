"use client";

// Blanko-Strichliste Zuckermais zum Ausdrucken (Nutzer-Vorgabe 2026-09-09) -
// ersetzt die von Hand gepflegte A3-Papierliste. Wird BLANKO gedruckt; die
// Halle trägt Datum und Arbeitszeiten selbst ein. Personen: genau die für
// Zuckermais freigegebenen, aktiven (employees.praemien_zuckermais = true,
// aktiv = true) - kein weiterer Gruppenfilter (die Halle entliest als eine
// Gruppe). Namen ohne angehängte Pers.-Nr. (spart Platz).
//
// Aufbau (Nutzer-Vorgabe 2026-09-09): ZWEI Zeilen je Person untereinander auf
// EINER A3-Querseite - obere Zeile Kreuzfelder 1-20, untere Zeile 21-40.
// Dadurch wird die Liste nach unten länger (flowt bei vielen Personen auf
// Seite 2), aber alles zu einer Person steht zusammen - kein Blättern beim
// Zusammenaddieren. Kreuz-/Nacharbeit-Felder ~quadratisch (10 mm). Dicke
// Linie nach jedem 10. Kreuzfeld (erster Block 1-10). Nacharbeit-Block (12
// Felder) und "Übertrag spargar" (Σ i.O. / Σ NA / Std.) rechts, je Person
// über beide Zeilen hoch. Reine Druckseite - keine Erfassung, keine
// Migration. Rückerfassung = Phase 2.

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

const KISTEN_PRO_ZEILE = 20; // obere Zeile Kiste 1-20, untere 21-40
const NACHARBEIT_PRO_ZEILE = 10; // obere Zeile Nacharbeit 1-10, untere 11-20
const BLOCK = 10; // dicke Linie nach jedem 10. Kreuzfeld
const MIN_PERSONEN = 20; // mind. so viele Personen-Blöcke drucken (Reserve)

type Zeile = { key: string; nr: number; name: string };

// Dicke Linie an der rechten Kante jedes 10. Kreuzfelds (10, 20 → Blöcke
// 1-10, 11-20 oben; darunter 21-30, 31-40).
const feldKlasse = (spalte: number) =>
  "sl-k" + (spalte % BLOCK === 0 ? " sl-kblock" : "");
// Nacharbeit-Block: dicke Aussenkanten + dicke Linie nach jeder 5. Spalte.
const naKlasse = (n: number) =>
  "sl-na" +
  (n === 1 ? " sl-na-l" : "") +
  (n === NACHARBEIT_PRO_ZEILE ? " sl-na-r" : "") +
  (n % 5 === 0 ? " sl-kblock" : "");

const spalten = Array.from({ length: KISTEN_PRO_ZEILE }, (_, i) => i + 1);
const na = Array.from({ length: NACHARBEIT_PRO_ZEILE }, (_, i) => i + 1);

function Person({ z }: { z: Zeile }) {
  return (
    <tbody className="sl-person">
      <tr className="sl-pa">
        <td className="sl-c" rowSpan={2}>
          {z.nr}
        </td>
        <td className="sl-l" rowSpan={2}>
          {z.name}
        </td>
        <td className="sl-se" rowSpan={2}></td>
        {spalten.map((n) => (
          <td key={z.key + "a" + n} className={feldKlasse(n)}></td>
        ))}
        <td className="sl-se" rowSpan={2}></td>
        {na.map((n) => (
          <td key={z.key + "na" + n} className={naKlasse(n)}></td>
        ))}
        <td rowSpan={2}></td>
        <td rowSpan={2}></td>
        <td rowSpan={2}></td>
      </tr>
      <tr className="sl-pb">
        {spalten.map((n) => (
          <td key={z.key + "b" + n} className={feldKlasse(n)}></td>
        ))}
        {na.map((n) => (
          <td key={z.key + "nb" + n} className={naKlasse(n)}></td>
        ))}
      </tr>
    </tbody>
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

  const fueller = Math.max(0, MIN_PERSONEN - employees.length);
  const zeilen: Zeile[] = [
    ...employees.map((e, i) => ({
      key: e.id,
      nr: i + 1,
      name: `${e.name}, ${e.vorname}`,
    })),
    ...Array.from({ length: fueller }, (_, i) => ({
      key: "leer" + i,
      nr: employees.length + i + 1,
      name: "",
    })),
  ];

  return (
    <div className="strichliste-print -mx-4 -my-6">
      <div className="sl-bar print:hidden">
        <button type="button" className="btn" onClick={() => window.print()}>
          Drucken
        </button>
        <span className="sl-hint">
          Blanko, A3 quer, 2 Zeilen je Person (obere = Kisten 1–20, untere =
          21–40). Läuft bei vielen Personen auf Seite 2. Kein A3-Drucker? Im
          Druckdialog „An Seite anpassen" auf A4.
        </span>
      </div>

      <div className="sl-blatt">
        <div className="sl-kopf">
          <div className="sl-titel">Zuckermais – Strichliste</div>
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

        <table className="sl-tab">
          <colgroup>
            <col className="c-nr" />
            <col className="c-name" />
            <col className="c-se" />
            {spalten.map((n) => (
              <col key={"c" + n} className="c-k" />
            ))}
            <col className="c-se" />
            {na.map((n) => (
              <col key={"cn" + n} className="c-na" />
            ))}
            <col className="c-sum" />
            <col className="c-sum" />
            <col className="c-sum" />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Nr</th>
              <th rowSpan={2} className="sl-l">
                Name
              </th>
              <th rowSpan={2}>Start</th>
              <th colSpan={KISTEN_PRO_ZEILE}>
                Kiste i.O. — Kreuz (X) je Kiste · obere Zeile 1–
                {KISTEN_PRO_ZEILE}, untere Zeile {KISTEN_PRO_ZEILE + 1}–
                {KISTEN_PRO_ZEILE * 2}
              </th>
              <th rowSpan={2}>Ende</th>
              <th
                colSpan={NACHARBEIT_PRO_ZEILE}
                className="sl-na sl-na-l sl-na-r"
              >
                Nacharbeit — Fehlercode · obere Zeile 1–{NACHARBEIT_PRO_ZEILE},
                untere {NACHARBEIT_PRO_ZEILE + 1}–{NACHARBEIT_PRO_ZEILE * 2}
              </th>
              <th colSpan={3}>Übertrag spargar</th>
            </tr>
            <tr>
              {spalten.map((n) => (
                <th key={"h" + n} className={feldKlasse(n)}>
                  {n}
                  <span className="sl-u">{n + KISTEN_PRO_ZEILE}</span>
                </th>
              ))}
              {na.map((n) => (
                <th key={"hn" + n} className={naKlasse(n)}>
                  {n}
                  <span className="sl-u">{n + NACHARBEIT_PRO_ZEILE}</span>
                </th>
              ))}
              <th>Σ i.O.</th>
              <th>Σ NA</th>
              <th>Std.</th>
            </tr>
          </thead>
          {zeilen.map((z) => (
            <Person key={z.key} z={z} />
          ))}
        </table>

        <div className="sl-legende">
          <b>X</b> = Kiste i.O. — obere Zeile Kiste 1–{KISTEN_PRO_ZEILE}, untere
          Zeile {KISTEN_PRO_ZEILE + 1}–{KISTEN_PRO_ZEILE * 2}. &nbsp;·&nbsp;{" "}
          <b>Start / Ende:</b> Arbeitszeit dieser Person. &nbsp;·&nbsp;{" "}
          <b>Nacharbeit-Feld:</b> Fehlercode eintragen (obere Zeile 1–
          {NACHARBEIT_PRO_ZEILE}, untere {NACHARBEIT_PRO_ZEILE + 1}–
          {NACHARBEIT_PRO_ZEILE * 2}) —{" "}
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
