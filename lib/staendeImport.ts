// Import der Verkaufsstände aus dem Google-Unternehmensprofil-Export
// (Vertriebsplanung V1, Seite app/vertrieb/import). Nutzer-Vorgaben
// 2026-11-25:
// - Name = "Geschäftscode" des Profils (die interne Kurzbezeichnung, z.B.
//   "Seligenstadt (Deichmann)"),
// - alle Einträge übernehmen, auch die als "Duplikat" markierten (die
//   bekommen " (Duplikat)" am Namen, damit sie unterscheidbar bleiben),
// - Standnummern alphabetisch nach Ort (dann Name), fortlaufend,
// - Öffnungszeiten je Wochentag werden an 13:00 in Vormittag/Nachmittag
//   geteilt (wie die Vorgabe in der Stände-Maske),
// - Koordinaten per OpenStreetMap (Nominatim) nachschlagen, nur
//   straßengenaue Treffer übernehmen.

import type { VtHalbtag } from "@/lib/types";

export const HALBTAG_GRENZE = "13:00";

export interface StandZeitImport {
  wochentag: number; // 1 = Mo ... 7 = So
  halbtag: VtHalbtag;
  von: string; // "HH:MM"
  bis: string;
}

export interface StandImport {
  zeile: number; // Zeile in der Datei (1 = Kopf)
  datei: string; // Dateiname (mehrere Exporte je Google-Konto)
  name: string;
  status: string;
  strasse: string;
  lagehinweis: string;
  plz: string;
  ort: string;
  telefon: string;
  adresse: string;
  notiz: string;
  zeiten: StandZeitImport[];
  ohneZeiten: boolean;
  zeitFehler: string[];
  aktiv: boolean;
}

// Spaltenköpfe des Google-Exports -> Wochentag (ISO)
const ZEIT_SPALTEN: [string, number][] = [
  ["Öffnungszeiten (montags)", 1],
  ["Öffnungszeiten (dienstags)", 2],
  ["Öffnungszeiten (mittwochs)", 3],
  ["Öffnungszeiten (donnerstags)", 4],
  ["Öffnungszeiten (freitags)", 5],
  ["Öffnungszeiten (samstags)", 6],
  ["Öffnungszeiten (sonntags)", 7],
];

const PFLICHT = ["Geschäftscode", "Adresszeile 1", "Postleitzahl", "Ort"];

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function minuten(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// "08:30-18:00" (auch mehrere Spannen "08:00-12:00,14:00-18:00") ->
// Vormittag/Nachmittag an der Grenze 13:00 geteilt. Je Halbtag die früheste
// Öffnung und die späteste Schließung.
export function zeitenTeilen(
  wert: string,
  wochentag: number
): { zeiten: StandZeitImport[]; fehler: string | null } {
  const w = wert.trim();
  if (!w || /^(x|geschlossen|closed)$/i.test(w)) return { zeiten: [], fehler: null };
  const grenze = minuten(HALBTAG_GRENZE);
  const halb: Partial<Record<VtHalbtag, { von: number; bis: number }>> = {};
  for (const teil of w.split(/[,;]/)) {
    const m = teil.trim().match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) return { zeiten: [], fehler: `"${w}" nicht lesbar` };
    let von = Number(m[1]) * 60 + Number(m[2]);
    let bis = Number(m[3]) * 60 + Number(m[4]);
    if (bis === 0) bis = 24 * 60 - 1;
    if (bis <= von) return { zeiten: [], fehler: `"${w}": Ende vor Beginn` };
    if (von < grenze) {
      const b = Math.min(bis, grenze);
      halb.VM = { von: Math.min(halb.VM?.von ?? von, von), bis: Math.max(halb.VM?.bis ?? b, b) };
    }
    if (bis > grenze) {
      von = Math.max(von, grenze);
      halb.NM = { von: Math.min(halb.NM?.von ?? von, von), bis: Math.max(halb.NM?.bis ?? bis, bis) };
    }
  }
  const zeiten: StandZeitImport[] = [];
  for (const h of ["VM", "NM"] as VtHalbtag[]) {
    const z = halb[h];
    if (z && z.bis > z.von) zeiten.push({ wochentag, halbtag: h, von: hhmm(z.von), bis: hhmm(z.bis) });
  }
  return { zeiten, fehler: null };
}

// Tabelle (erste Zeile = Spaltenköpfe) -> Stände, alphabetisch nach Ort
// und Name sortiert. Wirft einen Fehler, wenn es nicht der Google-Export ist.
export function staendeLesen(zeilen: unknown[][], datei = ""): StandImport[] {
  if (zeilen.length < 2) throw new Error("Die Datei enthält keine Zeilen.");
  // Google schreibt teils geschützte Leerzeichen ("Adresszeile\u00a01")
  const kopf = zeilen[0].map((k) => text(k).normalize("NFC").replace(/\s+/g, " "));
  const fehlt = PFLICHT.filter((p) => !kopf.includes(p));
  if (fehlt.length) {
    throw new Error(
      `Das ist kein Google-Unternehmensprofil-Export (Spalten fehlen: ${fehlt.join(", ")}).`
    );
  }
  const sp = (name: string) => kopf.indexOf(name);
  const staende: StandImport[] = [];
  zeilen.slice(1).forEach((z, i) => {
    const code = text(z[sp("Geschäftscode")]);
    if (!code) return;
    const status = sp("Status") >= 0 ? text(z[sp("Status")]) : "";
    const duplikat = /duplikat/i.test(status);
    const strasse = text(z[sp("Adresszeile 1")]);
    const lagehinweis = sp("Adresszeile 2") >= 0 ? text(z[sp("Adresszeile 2")]) : "";
    const plz = text(z[sp("Postleitzahl")]);
    const ort = text(z[sp("Ort")]);
    const telefon = sp("Primäre Telefonnummer") >= 0 ? text(z[sp("Primäre Telefonnummer")]) : "";
    const zeiten: StandZeitImport[] = [];
    const zeitFehler: string[] = [];
    let irgendeineAngabe = false;
    for (const [spalte, tag] of ZEIT_SPALTEN) {
      const idx = sp(spalte);
      if (idx < 0) continue;
      const wert = text(z[idx]);
      if (wert) irgendeineAngabe = true;
      const r = zeitenTeilen(wert, tag);
      if (r.fehler) zeitFehler.push(r.fehler);
      zeiten.push(...r.zeiten);
    }
    staende.push({
      zeile: i + 2,
      datei,
      name: duplikat ? `${code} (Duplikat)` : code,
      status,
      strasse,
      lagehinweis,
      plz,
      ort,
      telefon,
      adresse: [strasse, [plz, ort].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      notiz: "",
      zeiten,
      ohneZeiten: !irgendeineAngabe,
      zeitFehler,
      aktiv: true,
    });
  });
  // Die zentrale Telefonnummer steht bei fast allen Ständen - nur
  // abweichende Nummern in der Notiz behalten.
  const haeufigkeit = new Map<string, number>();
  staende.forEach((st) => st.telefon && haeufigkeit.set(st.telefon, (haeufigkeit.get(st.telefon) ?? 0) + 1));
  const zentrale = [...haeufigkeit.entries()].sort((x, y) => y[1] - x[1])[0];
  const zentraleNr = zentrale && zentrale[1] > staende.length / 2 ? zentrale[0] : null;
  for (const st of staende) {
    st.notiz = [
      st.lagehinweis && `Lage: ${st.lagehinweis}`,
      st.telefon && st.telefon !== zentraleNr && `Tel. ${st.telefon}`,
      /duplikat/i.test(st.status) && "Im Google-Profil als Duplikat markiert",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return sortieren(staende);
}

const VGL = new Intl.Collator("de", { sensitivity: "base", numeric: true });

function sortieren(staende: StandImport[]): StandImport[] {
  return staende.sort((a, b) => VGL.compare(a.ort, b.ort) || VGL.compare(a.name, b.name));
}

// Mehrere Exporte (je Google-Konto einer, z.B. Mömmel und Reitz) zu einer
// Liste zusammenführen und gemeinsam alphabetisch sortieren, damit die
// Nummern über alle Stände durchlaufen. Gleiche Namen an verschiedenen
// Adressen (z.B. "Kelsterbach" in beiden Konten) bekommen die Straße
// angehängt: "Kelsterbach (Langer Kornweg)".
export function staendeZusammenfuehren(listen: StandImport[][]): StandImport[] {
  const alle = listen.flat();
  const schluessel = (n: string) => n.trim().toLocaleLowerCase("de");
  const anzahl = new Map<string, number>();
  alle.forEach((s) => anzahl.set(schluessel(s.name), (anzahl.get(schluessel(s.name)) ?? 0) + 1));
  for (const s of alle) {
    if ((anzahl.get(schluessel(s.name)) ?? 0) < 2) continue;
    const strasse = s.strasse.replace(/\s*\d.*$/, "").trim() || s.plz;
    if (strasse) s.name = `${s.name} (${strasse})`;
  }
  return sortieren(alle);
}

export interface GeoTreffer {
  lat: number;
  lng: number;
  genauigkeit: "strasse" | "ort";
  anzeige: string;
}

// OpenStreetMap-Nominatim (Nutzungsregeln: höchstens 1 Anfrage/Sekunde -
// der Aufrufer wartet zwischen den Ständen). Zuerst strukturiert
// (Straße/PLZ/Ort), dann als Freitext. Ein Treffer nur auf Ortsebene wird als
// "ort" gekennzeichnet und NICHT als Stand-Koordinate übernommen (wäre für
// den Geofence falsch).
export async function standSuchen(s: StandImport): Promise<GeoTreffer | null> {
  const versuche: URLSearchParams[] = [];
  if (s.strasse) {
    versuche.push(
      new URLSearchParams({ street: s.strasse, postalcode: s.plz, city: s.ort, country: "de" })
    );
    // "Südring 23 Beim Eiba Kraftfuhrwerk" -> "Südring 23" (Zusatz nach der
    // Hausnummer stört die Suche)
    const kurz = s.strasse.match(/^(.*?\d+\s?[a-zA-Z]?)(?=\s|$)/)?.[1];
    if (kurz && kurz !== s.strasse) {
      versuche.push(
        new URLSearchParams({ street: kurz, postalcode: s.plz, city: s.ort, country: "de" })
      );
    }
  }
  versuche.push(new URLSearchParams({ q: s.adresse, countrycodes: "de" }));
  for (let i = 0; i < versuche.length; i++) {
    const p = versuche[i];
    p.set("format", "jsonv2");
    p.set("limit", "1");
    p.set("addressdetails", "0");
    p.set("accept-language", "de");
    if (i > 0) await warten(1100);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${p.toString()}`);
    if (!res.ok) throw new Error(`OpenStreetMap antwortet mit ${res.status}`);
    const daten = (await res.json()) as {
      lat: string;
      lon: string;
      display_name: string;
      addresstype?: string;
      place_rank?: number;
    }[];
    if (daten.length) {
      const d = daten[0];
      const rang = d.place_rank ?? 0;
      return {
        lat: Number(Number(d.lat).toFixed(6)),
        lng: Number(Number(d.lon).toFixed(6)),
        genauigkeit: rang >= 26 ? "strasse" : "ort",
        anzeige: d.display_name,
      };
    }
  }
  return null;
}

export function warten(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
