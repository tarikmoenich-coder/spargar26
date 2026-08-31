// Helfer für das Modul "Unterkunft" (Zimmerverwaltung).
// Als abgekapseltes Modul gehalten (eigene lib-Datei, app/unterkunft/*,
// Migration mit Prefix unterkunft_), damit es sich später sauber in ein
// gemeinsames Portal heben lässt - siehe docs/unterkunft-plan.md.

import type { UnterkunftZimmerArt } from "./types";

// Anzeigename eines Raums: Schlafzimmer über ihre Nummer, Gemeinschaftsräume
// nur über den Typ (Küche, Bad/WC, …) - die interne Durchnummerierung
// (unterkunft_zimmer.nummer, wegen der Unique-Bedingung je Gebäude nötig)
// wird bewusst nicht angezeigt.
export const RAUM_ART_LABEL: Record<UnterkunftZimmerArt, string> = {
  zimmer: "Zimmer",
  kueche: "Küche",
  bad: "Bad/WC",
  flur: "Flur",
  gemeinschaft: "Gemeinschaftsraum",
};

export function raumName(z: {
  art: UnterkunftZimmerArt;
  nummer: string;
}): string {
  return z.art === "zimmer" ? z.nummer : RAUM_ART_LABEL[z.art];
}

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
// Kontrolle her? Die Schwellen kommen seit Migration 2026-09-08 je Raumtyp
// aus unterkunft_kontroll_intervall (Pflege in den Stammdaten). Diese
// Konstanten bleiben der Fallback, wenn kein Intervall übergeben wird.
export const KONTROLLE_WARNUNG_TAGE = 75;
export const KONTROLLE_FAELLIG_TAGE = 90;

export interface KontrollSchwellen {
  gruen: number; // letzte Kontrolle ≤ so viele Tage her → grün
  gelb: number; //  ≤ so viele Tage her → gelb, darüber → rot
}

export type KontrollAmpel = "keine" | "gruen" | "gelb" | "rot";

export function kontrollAmpel(
  letzteKontrolleAm: string | null,
  schwellen?: KontrollSchwellen | null,
  jetzt: Date = new Date()
): KontrollAmpel {
  if (!letzteKontrolleAm) return "keine";
  const gruen = schwellen?.gruen ?? KONTROLLE_WARNUNG_TAGE;
  const gelb = schwellen?.gelb ?? KONTROLLE_FAELLIG_TAGE;
  const tage = Math.floor(
    (jetzt.getTime() - new Date(letzteKontrolleAm).getTime()) / 86400000
  );
  if (tage <= gruen) return "gruen";
  if (tage <= gelb) return "gelb";
  return "rot";
}

export const KONTROLL_AMPEL_LABELS: Record<KontrollAmpel, string> = {
  keine: "Noch keine Kontrolle",
  gruen: "Kontrolle aktuell",
  gelb: "Kontrolle bald fällig",
  rot: "Kontrolle überfällig",
};

// Ein offener Mangel zieht den nächsten Kontrolltermin vor: neu gemeldet →
// binnen MANGEL_KONTROLLE_FRIST_TAGE, bei einer Kontrolle nicht behoben →
// binnen MANGEL_UNBEHOBEN_FRIST_TAGE (danach folgen Konsequenzen).
export const MANGEL_KONTROLLE_FRIST_TAGE = 3;
export const MANGEL_UNBEHOBEN_FRIST_TAGE = 1;

// Nach 2 aufeinanderfolgenden Kontrollen "alles in Ordnung" (und solange kein
// Mangel auftaucht) wird der Kontrolltakt auf diese Zahl Tage gestreckt.
export const SAUBER_STREAK_INTERVALL_TAGE = 14;

function nurDatum(iso: string): string {
  return iso.slice(0, 10);
}

function datumPlusTage(isoDatum: string, n: number): string {
  const d = new Date(`${nurDatum(isoDatum)}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Nächster spätester Kontrolltermin + Ampel eines Raums. Berücksichtigt den
// Zeitzyklus (Schwellen je Raumtyp) UND offene Mängel: bei offenem Mangel ist
// die Ampel nie grün, und die Frist wird vorgezogen.
export function naechsteKontrolle(
  input: {
    letzteKontrolleAm: string | null;
    schwellen: KontrollSchwellen | null;
    offeneMaengel: ReadonlyArray<{ gemeldet_am: string }>;
    // false = Zimmer leer (niemand drin, keiner geplant) bzw. Allgemeinraum
    // einer unbewohnten Wohneinheit → keine Kontrolle fällig. Default true.
    inNutzung?: boolean;
    // Anzahl der letzten Kontrollen in Folge mit Ergebnis "alles in Ordnung".
    sauberStreak?: number;
  },
  jetzt: Date = new Date()
): { frist: string | null; ampel: KontrollAmpel } {
  const heute = jetzt.toISOString().slice(0, 10);
  const letzte = input.letzteKontrolleAm
    ? nurDatum(input.letzteKontrolleAm)
    : null;
  const offen = input.offeneMaengel ?? [];
  const inNutzung = input.inNutzung ?? true;

  // (1) Nicht in Nutzung und mangelfrei → keine Kontrolle fällig.
  if (!inNutzung && offen.length === 0) return { frist: null, ampel: "keine" };

  let gruen = input.schwellen?.gruen ?? KONTROLLE_WARNUNG_TAGE;
  let gelb = input.schwellen?.gelb ?? KONTROLLE_FAELLIG_TAGE;

  // (2) 2× in Folge "alles in Ordnung" und aktuell mangelfrei → 14-Tage-Takt,
  //     bis wieder ein Mangel auftaucht.
  if ((input.sauberStreak ?? 0) >= 2 && offen.length === 0) {
    gelb = SAUBER_STREAK_INTERVALL_TAGE;
    gruen = Math.max(1, SAUBER_STREAK_INTERVALL_TAGE - 2);
  }

  const zyklusFrist = letzte ? datumPlusTage(letzte, gelb) : null;

  let mangelFrist: string | null = null;
  if (offen.length > 0) {
    const fruehesteMeldung = offen
      .map((m) => nurDatum(m.gemeldet_am))
      .sort()[0];
    // Eine Kontrolle nach der Mangelmeldung, Mangel weiterhin offen ->
    // "nicht behoben trotz Kontrolle".
    const nichtBehoben = letzte != null && letzte > fruehesteMeldung;
    mangelFrist = nichtBehoben
      ? datumPlusTage(letzte as string, MANGEL_UNBEHOBEN_FRIST_TAGE)
      : datumPlusTage(fruehesteMeldung, MANGEL_KONTROLLE_FRIST_TAGE);
  }

  const kandidaten = [zyklusFrist, mangelFrist].filter(
    (x): x is string => x != null
  );
  const frist = kandidaten.length ? kandidaten.sort()[0] : null;

  let ampel: KontrollAmpel;
  if (!letzte && offen.length === 0) {
    ampel = "keine";
  } else if (frist != null && heute > frist) {
    ampel = "rot";
  } else if (offen.length > 0) {
    ampel = mangelFrist != null && heute > mangelFrist ? "rot" : "gelb";
  } else {
    const tage = letzte
      ? Math.floor(
          (jetzt.getTime() - new Date(`${letzte}T00:00:00`).getTime()) / 86400000
        )
      : Infinity;
    ampel = tage <= gruen ? "gruen" : tage <= gelb ? "gelb" : "rot";
  }
  return { frist, ampel };
}

// Farbwerte für die Ampel-Punkte im Grundriss (Tailwind-nah gehalten).
export const KONTROLL_AMPEL_FARBE: Record<KontrollAmpel, string> = {
  keine: "#a3a3a3", // neutral-400
  gruen: "#16a34a", // green-600
  gelb: "#f59e0b", // amber-500
  rot: "#dc2626", // red-600
};

// Herkunfts-Mix einer Personenliste als kompakter Text, z.B.
// "Rumänien 3 · Polen 2". Häufigste zuerst. Ohne Herkunft -> "?".
export function herkunftMix(
  personen: ReadonlyArray<{ herkunft: string | null }>
): string {
  return herkunftZaehler(personen)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
}

// Herkunft -> Anzahl, häufigste zuerst. Ohne Herkunft -> "?".
export function herkunftZaehler(
  personen: ReadonlyArray<{ herkunft: string | null }>
): Array<[string, number]> {
  const zaehler = new Map<string, number>();
  for (const p of personen) {
    const k = p.herkunft?.trim() || "?";
    zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
  }
  return [...zaehler.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
}

// Häufigste Herkunft einer Personenliste (für die Herkunfts-Ansicht im
// Grundriss). Leere Liste -> null.
export function herkunftDominant(
  personen: ReadonlyArray<{ herkunft: string | null }>
): string | null {
  const z = herkunftZaehler(personen);
  return z.length > 0 ? z[0][0] : null;
}

// Deterministische, gut unterscheidbare Pastellfarbe je Herkunft (HSL über
// einen einfachen String-Hash). "?" / leer -> neutrales Grau.
export function herkunftFarbe(herkunft: string | null): {
  fill: string;
  stroke: string;
} {
  const k = herkunft?.trim();
  if (!k || k === "?") return { fill: "#f1f5f9", stroke: "#94a3b8" };
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 360;
  return { fill: `hsl(${h} 70% 88%)`, stroke: `hsl(${h} 55% 55%)` };
}
