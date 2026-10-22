"use client";

// Mitarbeiterausweis-Karte (app/erntewirtschaft/ausweise) - fixe physische
// Größe 85,60 x 53,98 mm (ID-1-Format), unabhängig davon, ob sie gerade in
// der ca. 3-fach vergrößerten Bildschirm-Vorschau (per CSS transform:scale
// am äußeren Rahmen, siehe .ausweis2-vorschau-box in globals.css) oder im
// DIN-A4-Druckbogen (components/MitarbeiterAusweisDruckbogen.tsx) gezeigt
// wird - dieselbe Komponente für beide, nur "variante" ändert Schatten/
// Eckenrundung (nur auf dem Bildschirm sinnvoll, nicht beim Scheren-Zuschnitt
// auf Papier).
//
// QR-Code kommt als fertiges SVG-Markup (qrSvg) von QRCode.toString(code,
// {type:"svg", ...}) herein - der Wert "P-<personal_nr>-<suffix>" und seine
// Erzeugung bleiben unverändert, nur die Ausgabeform (SVG statt PNG-DataURL)
// für einen scharfen Vektor-Druck.

import { UserRound } from "lucide-react";

export interface MitarbeiterAusweisKarteProps {
  name: string;
  vorname: string;
  personalNr: string;
  fotoUrl: string | null;
  qrSvg: string | null;
  variante: "vorschau" | "druck";
}

export default function MitarbeiterAusweisKarte({
  name,
  vorname,
  personalNr,
  fotoUrl,
  qrSvg,
  variante,
}: MitarbeiterAusweisKarteProps) {
  return (
    <div
      className={
        variante === "vorschau" ? "ausweis2-karte ausweis2-karte--vorschau" : "ausweis2-karte"
      }
    >
      <div className="ausweis2-kopf">
        <span className="ausweis2-firma">SPARGELHOF MÖMMEL</span>
        <span className="ausweis2-typ">MITARBEITERAUSWEIS</span>
      </div>

      <p className="ausweis2-name">
        {name}, {vorname}
      </p>

      <div className="ausweis2-unten">
        {fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fotoUrl} alt="Mitarbeiterfoto" className="ausweis2-foto-bild" />
        ) : (
          <div className="ausweis2-foto-platzhalter">
            <UserRound className="h-6 w-6" strokeWidth={1.25} />
          </div>
        )}

        <div className="ausweis2-personalnr">
          <span className="ausweis2-personalnr-label">Personalnummer</span>
          <span className="ausweis2-personalnr-wert">{personalNr}</span>
        </div>

        {qrSvg && <div className="ausweis2-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />}
      </div>
    </div>
  );
}
