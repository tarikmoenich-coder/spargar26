"use client";

// DIN-A4-Druckbogen für den Mitarbeiterausweis (app/erntewirtschaft/ausweise) -
// ein Ausweis exakt 20mm vom linken/oberen Blattrand, 4 dezente
// Schnittmarkierungen außerhalb der Kartenfläche, Rest der Seite leer.
// Auf dem Bildschirm per CSS unsichtbar (display:none), erscheint nur unter
// @media print (siehe .ausweis2-druckbogen in app/globals.css) - deshalb
// hier keine print:hidden-Klasse nötig, das übernimmt die eigene CSS-Regel.

import MitarbeiterAusweisKarte, {
  type MitarbeiterAusweisKarteProps,
} from "./MitarbeiterAusweisKarte";

// Alle Maße in mm.
const CARD_W = 85.6;
const CARD_H = 53.98;
const MARGIN = 20;
const MARK_LEN = 5;
const MARK_GAP = 2;
const MARK_DICKE = 0.25;

interface Mark {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Je Ecke zwei kurze Linien (eine waagerecht, eine senkrecht), die nach
// außen von der Karte weg zeigen - Standard-Schnittmarken-Konvention,
// niemals über der Kartenfläche selbst.
function schnittmarken(): Mark[] {
  const ecken = [
    { x: MARGIN, y: MARGIN, h: -1, v: -1 }, // oben links
    { x: MARGIN + CARD_W, y: MARGIN, h: 1, v: -1 }, // oben rechts
    { x: MARGIN, y: MARGIN + CARD_H, h: -1, v: 1 }, // unten links
    { x: MARGIN + CARD_W, y: MARGIN + CARD_H, h: 1, v: 1 }, // unten rechts
  ];
  const marken: Mark[] = [];
  for (const e of ecken) {
    const hStart = e.h === -1 ? e.x - MARK_GAP - MARK_LEN : e.x + MARK_GAP;
    marken.push({ left: hStart, top: e.y - MARK_DICKE / 2, width: MARK_LEN, height: MARK_DICKE });
    const vStart = e.v === -1 ? e.y - MARK_GAP - MARK_LEN : e.y + MARK_GAP;
    marken.push({ left: e.x - MARK_DICKE / 2, top: vStart, width: MARK_DICKE, height: MARK_LEN });
  }
  return marken;
}

const MARKEN = schnittmarken();

type Props = Omit<MitarbeiterAusweisKarteProps, "variante">;

export default function MitarbeiterAusweisDruckbogen(props: Props) {
  return (
    <div className="ausweis2-druckbogen">
      <MitarbeiterAusweisKarte {...props} variante="druck" />
      {MARKEN.map((m, i) => (
        <div
          key={i}
          className="ausweis2-schnittmarke"
          style={{
            left: `${m.left}mm`,
            top: `${m.top}mm`,
            width: `${m.width}mm`,
            height: `${m.height}mm`,
          }}
        />
      ))}
    </div>
  );
}
