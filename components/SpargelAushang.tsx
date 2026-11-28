"use client";

// Aushang der Spargel-Tagesliste für die Erntehelfer (Nutzer-Vorgabe
// 2026-11-28): wird ausgedruckt (A3 hochkant) und gelesen von Menschen, die
// kein Deutsch sprechen und Prämienformeln nicht kennen. Deshalb nur im Druck
// sichtbar und bewusst schlicht: nach Feld und Nachname sortiert, wenige
// kurze deutsche Wörter, Zahlen groß, Prämie nur als Betrag (leer = keine),
// oben die Tagesstatistik (kg, Stunden, Ø kg/Std.), und
// das "Ziel": ab so vielen kg pro Stunde gibt es auf diesem Feld Prämie
// (= Mindestlohn ÷ Preis je kg der Kategorie). Akkordwert, Lohn, Kategorie
// und "unter der Schwelle" bleiben im Büro (Bildschirmtabelle).

import { formatDatumDE, formatEuro, formatMenge } from "@/lib/format";
// Die Felder, die der Aushang aus spargel_praemie_tag braucht
export interface AushangZeile {
  employee_id: string | null;
  personal_nr: string | null;
  gruppe: string | null;
  feld_name: string | null;
  kg: number;
  stunden: number;
  akkordwert: number | null;
  lohnanspruch: number | null;
  praemie: number;
  gruppenanteil?: boolean;
}

const WOCHENTAG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export default function SpargelAushang({
  tag,
  zeilen,
  name,
}: {
  tag: string;
  zeilen: AushangZeile[];
  name: (z: AushangZeile) => string;
}) {
  // Einzelpersonen und Gruppenmitglieder; reine Gruppenzeilen (2026) ohne Person weglassen
  const personen = zeilen
    .filter((z) => !z.gruppe)
    .map((z) => {
      const kg = Number(z.kg);
      const std = Number(z.stunden);
      const preis = z.akkordwert !== null && kg > 0 ? Number(z.akkordwert) / kg : null;
      const satz = z.lohnanspruch !== null && std > 0 ? Number(z.lohnanspruch) / std : null;
      return {
        z,
        name: name(z),
        kgh: std > 0 ? kg / std : null,
        ziel: preis && satz ? satz / preis : null,
        praemie: Number(z.praemie),
      };
    })
    .sort((a, b) => (a.z.feld_name ?? "").localeCompare(b.z.feld_name ?? "", "de") || a.name.localeCompare(b.name, "de"));
  const sumKg = personen.reduce((s, p) => s + Number(p.z.kg), 0);
  const sumStd = personen.reduce((s, p) => s + Number(p.z.stunden), 0);
  const d = new Date(tag + "T12:00:00");
  // Schriftstufe so, dass die Liste auf höchstens 2 Seiten A3 passt
  // (gemessen: groß bis 80, mittel bis 110, klein bis ~140 Personen).
  const stufe = personen.length <= 80 ? "" : personen.length <= 110 ? "aushang-mittel" : "aushang-klein";

  return (
    <div className={`spargel-aushang hidden print:block ${stufe}`}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <div style={{ fontSize: "26pt", fontWeight: 700, lineHeight: 1.1 }}>Spargel – Prämie</div>
          <div style={{ fontSize: "18pt" }}>
            {WOCHENTAG[d.getDay()]} {formatDatumDE(tag)}
          </div>
        </div>
        <table style={{ width: "auto", fontSize: "13pt" }}>
          <tbody>
            <tr>
              <td>Summe kg heute</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{formatMenge(sumKg, 0)}</td>
            </tr>
            <tr>
              <td>Summe Stunden heute</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{formatMenge(sumStd, 1)}</td>
            </tr>
            <tr>
              <td>Durchschnitt heute kg / Stunde</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{formatMenge(sumStd ? sumKg / sumStd : null, 1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Name</th>
            <th style={{ textAlign: "left" }}>Feld</th>
            <th style={{ textAlign: "right" }}>kg</th>
            <th style={{ textAlign: "right" }}>Stunden</th>
            <th style={{ textAlign: "right" }}>kg / Stunde</th>
            <th style={{ textAlign: "right" }}>Ziel kg / Stunde</th>
            <th style={{ textAlign: "right" }}>Prämie</th>
          </tr>
        </thead>
        <tbody>
          {personen.map(({ z, name, kgh, ziel, praemie }, i) => (
            <tr key={i}>
              <td>
                <b>{name}</b>
              </td>
              <td>{z.feld_name || ""}</td>
              <td style={{ textAlign: "right" }}>{formatMenge(z.kg, 0)}</td>
              <td style={{ textAlign: "right" }}>{formatMenge(z.stunden, 1)}</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{formatMenge(kgh, 1)}</td>
              <td style={{ textAlign: "right" }}>{z.gruppenanteil ? "Gruppe" : formatMenge(ziel, 1)}</td>
              <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                {praemie > 0 ? `${formatEuro(praemie)} €` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
