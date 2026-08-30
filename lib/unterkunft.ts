// Helfer für das Modul "Unterkunft" (Zimmerverwaltung).
// Als abgekapseltes Modul gehalten (eigene lib-Datei, app/unterkunft/*,
// Migration mit Prefix unterkunft_), damit es sich später sauber in ein
// gemeinsames Portal heben lässt - siehe docs/unterkunft-plan.md.

// Privater Storage-Bucket für die Fotos (angelegt in der Migration).
// Downloads laufen wie bei mitarbeiter-dokumente über signierte URLs.
export const UNTERKUNFT_FOTOS_BUCKET = "unterkunft-fotos";

// Längste Kante, auf die Fotos vor dem Upload heruntergerechnet werden, und
// JPEG-Qualität. Übergaben entstehen auf dem Handy, oft bei mäßigem Netz -
// Originale (8-12 MP) wären dafür unnötig groß.
const MAX_KANTE_PX = 1600;
const JPEG_QUALITAET = 0.8;

export interface VerkleinertesBild {
  blob: Blob;
  breite: number;
  hoehe: number;
  // Zeitstempel aus der Datei (Aufnahmezeit als Näherung über lastModified) -
  // rein dokumentierend, maßgeblich bleibt der Server-Zeitstempel.
  aufgenommen_am: string | null;
}

// Rechnet ein Bild clientseitig herunter (max. MAX_KANTE_PX auf der längeren
// Seite) und gibt es als JPEG-Blob samt Maßen zurück. Bilder, die schon
// kleiner sind, werden nur neu als JPEG kodiert (vereinheitlicht den
// Upload-Typ). Wirft, wenn die Datei kein dekodierbares Bild ist.
export async function bildVerkleinern(datei: File): Promise<VerkleinertesBild> {
  const aufgenommen_am = datei.lastModified
    ? new Date(datei.lastModified).toISOString()
    : null;

  const bitmap = await createImageBitmap(datei);
  const skala = Math.min(1, MAX_KANTE_PX / Math.max(bitmap.width, bitmap.height));
  const breite = Math.max(1, Math.round(bitmap.width * skala));
  const hoehe = Math.max(1, Math.round(bitmap.height * skala));

  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas-Kontext nicht verfügbar - Foto kann nicht verarbeitet werden.");
  }
  ctx.drawImage(bitmap, 0, 0, breite, hoehe);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITAET)
  );
  if (!blob) throw new Error("Foto konnte nicht als JPEG gespeichert werden.");

  return { blob, breite, hoehe, aufgenommen_am };
}

// Pfad im Bucket: "<zimmerId>/<vorgangId>/<zufall>.jpg". Nach Zimmer und
// Vorgang gruppiert, damit ein späterer Umzug/Export einfach bleibt.
export function fotoStoragePfad(zimmerId: number, vorgangId: string): string {
  const zufall =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // bildVerkleinern() liefert immer JPEG.
  return `${zimmerId}/${vorgangId}/${zufall}.jpg`;
}

// "YYYY-MM-DD" von heute - für <input type="date"> und Belegungs-Vergleiche.
export function heuteIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Läuft die Belegung an diesem Stichtag (Standard: heute)?
export function belegungLaeuft(
  von: string,
  bis: string | null,
  stichtag: string = heuteIso()
): boolean {
  return von <= stichtag && (bis === null || bis >= stichtag);
}

// --- Grundriss (Migration 2026-08-30) --------------------------------------

// Kantenlänge einer Rasterzelle in SVG-Einheiten. Zimmer liegen auf ganzen
// Zellen (plan_x/plan_y/plan_w/plan_h), gezoomt wird über den SVG-viewBox.
export const GRUNDRISS_ZELLE = 44;

// Kontroll-Ampel je Zimmer: wie lange ist die letzte abgeschlossene
// Kontrolle her? Schwellen bewusst als Konstante - das eigentliche
// Kontrollmuster (Intervall je Zimmertyp/Saison) wird später festgelegt,
// siehe docs/unterkunft-plan.md.
export const KONTROLLE_WARNUNG_TAGE = 75;
export const KONTROLLE_FAELLIG_TAGE = 90;

export type KontrollAmpel = "keine" | "gruen" | "gelb" | "rot";

export function kontrollAmpel(
  letzteKontrolleAm: string | null,
  jetzt: Date = new Date()
): KontrollAmpel {
  if (!letzteKontrolleAm) return "keine";
  const tage = Math.floor(
    (jetzt.getTime() - new Date(letzteKontrolleAm).getTime()) / 86400000
  );
  if (tage <= KONTROLLE_WARNUNG_TAGE) return "gruen";
  if (tage <= KONTROLLE_FAELLIG_TAGE) return "gelb";
  return "rot";
}

export const KONTROLL_AMPEL_LABELS: Record<KontrollAmpel, string> = {
  keine: "Noch keine Kontrolle",
  gruen: "Kontrolle aktuell",
  gelb: "Kontrolle bald fällig",
  rot: "Kontrolle überfällig",
};

// Farbwerte für die Ampel-Punkte im Grundriss (Tailwind-nah gehalten).
export const KONTROLL_AMPEL_FARBE: Record<KontrollAmpel, string> = {
  keine: "#a3a3a3", // neutral-400
  gruen: "#16a34a", // green-600
  gelb: "#f59e0b", // amber-500
  rot: "#dc2626", // red-600
};
