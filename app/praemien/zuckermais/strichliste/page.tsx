"use client";

// Blanko-Strichliste Zuckermais zum Ausdrucken (Nutzer-Vorgabe 2026-09-09) -
// ersetzt die von Hand gepflegte A3-Papierliste. Wird BLANKO gedruckt; die
// Halle trägt Datum und Arbeitszeiten selbst ein. Es werden genau die
// Personen genommen, die in "Prämien → Gruppenaufteilung" dem Zuckermais
// zugeordnet UND aktiv sind (employees.praemien_zuckermais = true, aktiv =
// true) - kein weiterer Gruppenfilter (die Halle entliest als eine Gruppe).
// Namen ohne angehängte Pers.-Nr. (spart Platz). Das Kreuz-Raster (40 Felder
// je Person, X je abgegebene Kiste) bleibt wie gewohnt; rechts ein grau
// hinterlegter Nacharbeit-Block, in den der Prüfer bei einer abgelehnten
// Kiste den Fehlercode einträgt (QS-Konzept). Reine Druckseite - keine
// Erfassung, keine Migration. Rückerfassung = Phase 2.

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

const KISTEN_SPALTEN = 40; // Kreuzfelder je Person (manche schaffen 40/Halbschicht)
const NACHARBEIT_SPALTEN = 12;
const MIN_ZEILEN = 22; // mind. so viele Zeilen drucken (Reserve zum Nachtragen)

export default function ZuckermaisStrichlistePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const gedruckt = useRef(false);

  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient()
        .from("employees")
        .select("id, name, vorname")
        // Genau die Zuckermais-Gruppenaufteilung, aktiv - kein weiterer Filter.
        .eq("aktiv", true)
        .eq("praemien_zuckermais", true)
        .order("name");
      setEmployees((data as Employee[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const gefiltert = employees;

  // Auto-Druck, sobald die Namen geladen sind - einmal.
  useEffect(() => {
    if (loading || gedruckt.current || gefiltert.length === 0) return;
    gedruckt.current = true;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [loading, gefiltert.length]);

  const kisten = Array.from({ length: KISTEN_SPALTEN }, (_, i) => i + 1);
  const nacharbeit = Array.from({ length: NACHARBEIT_SPALTEN }, (_, i) => i + 1);
  const leerzeilen = Math.max(0, MIN_ZEILEN - gefiltert.length);

  const feldKlasse = (n: number) => "sl-k" + (n % 5 === 0 ? " sl-k5" : "");

  const zeile = (nr: number, name: string, key: string) => (
    <tr key={key}>
      <td className="sl-c">{nr}</td>
      <td className="sl-l">{name}</td>
      {kisten.map((n) => (
        <td key={key + "k" + n} className={feldKlasse(n)}></td>
      ))}
      {nacharbeit.map((n) => (
        <td key={key + "n" + n} className="sl-na"></td>
      ))}
      <td></td>
      <td></td>
      <td></td>
    </tr>
  );

  return (
    <div className="strichliste-print -mx-4 -my-6">
      {/* Bildschirm-Bedienleiste - nicht im Druck */}
      <div className="sl-bar print:hidden">
        <button type="button" className="btn" onClick={() => window.print()}>
          Drucken
        </button>
        <span className="sl-hint">
          Wird blanko gedruckt (A3 quer). Kein A3-Drucker? Im Druckdialog
          „Größe anpassen / An Seite anpassen" auf A4 wählen.
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
              <b>Grenzmuster gezogen</b> <span className="sl-box" />
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
            {kisten.map((n) => (
              <col key={"c" + n} className="c-k" />
            ))}
            {nacharbeit.map((n) => (
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
              <th colSpan={KISTEN_SPALTEN}>Kiste i.O. — Kreuz (X) je Kiste</th>
              <th colSpan={NACHARBEIT_SPALTEN}>
                Nacharbeit — Fehlercode je abgelehnter Kiste
              </th>
              <th colSpan={3}>Übertrag spargar</th>
            </tr>
            <tr>
              {kisten.map((n) => (
                <th key={"h" + n} className={feldKlasse(n)}>
                  {n}
                </th>
              ))}
              {nacharbeit.map((n) => (
                <th key={"hn" + n}></th>
              ))}
              <th>Σ i.O.</th>
              <th>Σ NA</th>
              <th>Std.</th>
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((e, i) =>
              zeile(i + 1, `${e.name}, ${e.vorname}`, e.id)
            )}
            {Array.from({ length: leerzeilen }, (_, i) =>
              zeile(gefiltert.length + i + 1, "", "leer" + i)
            )}
          </tbody>
        </table>

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
