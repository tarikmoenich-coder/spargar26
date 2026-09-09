"use client";

// Blanko-Strichliste Zuckermais zum Ausdrucken (Nutzer-Vorgabe 2026-09-09) -
// ersetzt die von Hand gepflegte A3-Papierliste "Name, Pers. Nr." (Vor-/
// Nachmittag). Namen + Pers.-Nr. kommen live aus dem Personalstamm
// (praemien_zuckermais = true, optional nach Gruppe gefiltert), damit die
// Liste nie veraltet ist. Das Kreuz-Raster (40 Felder je Person, X je
// abgegebene Kiste) bleibt wie gewohnt; neu ist rechts ein
// Nacharbeit-Block, in den der Prüfer bei einer abgelehnten Kiste den
// Fehlercode einträgt (QS-Konzept). Reine Druckseite - keine Erfassung,
// keine Migration. Rückerfassung der Zahlen kommt als Phase 2.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type { Arbeitsgruppe, Employee } from "@/lib/types";

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

const KISTEN_SPALTEN = 40; // Kreuzfelder je Person (Nutzer-Vorgabe: manche schaffen 40/Halbschicht)
const NACHARBEIT_SPALTEN = 12;
const MIN_ZEILEN = 22; // mind. so viele Zeilen drucken (Reserve zum Nachtragen)

function heuteIso() {
  return new Date().toISOString().slice(0, 10);
}

function Inner() {
  const params = useSearchParams();
  const datum = params.get("datum") || heuteIso();
  const gruppeParam = params.get("gruppe") || "";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [loading, setLoading] = useState(true);
  const [schicht, setSchicht] = useState("");
  const gedruckt = useRef(false);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseClient();
      const [{ data: emp }, { data: gr }] = await Promise.all([
        supabase
          .from("employees")
          .select("id, personal_nr, gruppe_nr, name, vorname, aktiv")
          .eq("aktiv", true)
          .eq("praemien_zuckermais", true)
          .order("name"),
        supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
      ]);
      setEmployees((emp as Employee[]) ?? []);
      setGruppen((gr as Arbeitsgruppe[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const gefiltert = useMemo(
    () => employees.filter((e) => !gruppeParam || e.gruppe_nr === gruppeParam),
    [employees, gruppeParam]
  );
  const gruppeLabel = gruppen.find((g) => g.gruppe_nr === gruppeParam)?.bezeichnung;

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

  const feldKlasse = (n: number) =>
    "sl-k" + (n % 5 === 0 ? " sl-k5" : "");

  return (
    <div className="strichliste-print -mx-4 -my-6">
      {/* Bildschirm-Bedienleiste - nicht im Druck */}
      <div className="sl-bar print:hidden">
        <label>
          Schicht/Zeit&nbsp;
          <select value={schicht} onChange={(e) => setSchicht(e.target.value)}>
            <option value="">— (von Hand)</option>
            <option value="Vormittag">Vormittag</option>
            <option value="Nachmittag">Nachmittag</option>
          </select>
        </label>
        <button type="button" className="btn" onClick={() => window.print()}>
          Drucken
        </button>
        <span className="sl-hint">
          A3 quer. Kein A3-Drucker? Im Druckdialog „Größe anpassen / An Seite
          anpassen" auf A4 wählen.
        </span>
      </div>

      <div className="sl-blatt">
        <div className="sl-kopf">
          <div className="sl-titel">Zuckermais – Strichliste</div>
          <div className="sl-felder">
            <span>
              <b>Datum:</b> {formatDatumDE(datum)}
            </span>
            <span>
              <b>Gruppe:</b> {gruppeLabel || "alle"}
            </span>
            <span>
              <b>Schicht/Zeit:</b> {schicht}
              <span className="sl-line" />
            </span>
            <span>
              <b>Feld / Charge:</b>
              <span className="sl-line sl-line-lang" />
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
            <col className="c-zeit" />
            <col className="c-zeit" />
            <col className="c-zeit" />
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
                Name, Pers.-Nr.
              </th>
              <th colSpan={3}>Zeit</th>
              <th colSpan={KISTEN_SPALTEN}>Kiste i.O. — Kreuz (X) je Kiste</th>
              <th colSpan={NACHARBEIT_SPALTEN}>
                Nacharbeit — Fehlercode je abgelehnter Kiste
              </th>
              <th colSpan={3}>Übertrag spargar</th>
            </tr>
            <tr>
              <th>von</th>
              <th>bis</th>
              <th>Pause</th>
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
            {gefiltert.map((e, i) => (
              <tr key={e.id}>
                <td className="sl-c">{i + 1}</td>
                <td className="sl-l">
                  {e.name}, {e.vorname}{" "}
                  <span className="sl-pnr">({e.personal_nr})</span>
                </td>
                <td></td>
                <td></td>
                <td></td>
                {kisten.map((n) => (
                  <td key={"k" + n} className={feldKlasse(n)}></td>
                ))}
                {nacharbeit.map((n) => (
                  <td key={"n" + n} className="sl-na"></td>
                ))}
                <td></td>
                <td></td>
                <td></td>
              </tr>
            ))}
            {Array.from({ length: leerzeilen }, (_, i) => (
              <tr key={"leer" + i}>
                <td className="sl-c">{gefiltert.length + i + 1}</td>
                <td className="sl-l"></td>
                <td></td>
                <td></td>
                <td></td>
                {kisten.map((n) => (
                  <td key={"lk" + n} className={feldKlasse(n)}></td>
                ))}
                {nacharbeit.map((n) => (
                  <td key={"ln" + n} className="sl-na"></td>
                ))}
                <td></td>
                <td></td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sl-legende">
          <b>X</b> = Kiste i.O. &nbsp;·&nbsp; <b>Nacharbeit-Feld:</b>{" "}
          Fehlercode eintragen —{" "}
          {FEHLER_CODES.map((c) => `${c.code} ${c.text}`).join(" · ")}{" "}
          &nbsp;·&nbsp; nachgearbeitet &amp; i.O. = Häkchen, verworfen = Code
          einkreisen. &nbsp;·&nbsp; Unterbrechungen als Uhrzeit ins jeweilige
          Kistenfeld schreiben (wie bisher).
        </div>
      </div>
    </div>
  );
}

export default function ZuckermaisStrichlistePage() {
  return (
    <Suspense
      fallback={<p className="p-4 text-sm text-neutral-500">Lädt…</p>}
    >
      <Inner />
    </Suspense>
  );
}
