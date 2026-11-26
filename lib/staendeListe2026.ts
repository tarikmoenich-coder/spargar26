// Ständeliste 2026 des Betriebs (Nutzer 2026-11-26), abgeglichen mit den
// Google-Unternehmensprofil-Exporten Mömmel + Reitz:
// - Standname = eigene Bezeichnung aus der Liste (statt Google-Geschäftscode),
// - Stände aus dem Export, die nicht auf der Liste stehen, werden inaktiv
//   übernommen (inkl. der beiden Google-Duplikate),
// - Stände der Liste ohne Google-Profil werden ohne Adresse angelegt
//   (Position auf /vertrieb/karte von Hand setzen).
// Nummern: erst die aktiven alphabetisch nach Ort, dann die inaktiven.

import type { StandImport } from "@/lib/staendeImport";

// Name nach staendeZusammenfuehren() -> Name laut Liste 2026
export const NAMEN_2026: Record<string, string> = {
  "Alsfeld": "Alsfeld",
  "Alzey": "Alzey",
  "Babenhausen": "Babenhausen",
  "Bad Camberg 2": "Bad Camberg Reitz",
  "Bad Camberg": "Camberg",
  "Bad König": "Bad König",
  "Bad Kreuznach Forum": "Bad Kreuznach Forum",
  "Bauschheim": "Bauschheim",
  "Beerfelden": "Beerfelden",
  "Bingen": "Bingen",
  "Bodenheim": "Bodenheim",
  "Bruchköbel": "Bruchköbel",
  "Bruchsal Hofladen Spargelhof Mönich": "Bruchsal",
  "Buchen": "Buchen",
  "Buseck": "Buseck",
  "Dettingen": "Dettingen",
  "Dietzenbach": "Dietzenbach",
  "Elsenfeld Bauermarkt": "Elsenfeld Bauerm",
  "Eltville": "Eltville",
  "Eschborn": "Eschborn",
  "Fernwald": "Fernwald",
  "Flörsheim": "Flörsheim",
  "Frankenthal": "Frankenthal",
  "Friedrichsdorf Taunus Carré": "Friedrichsdorf",
  "Fürth": "Fürth",
  "Goldbach": "Goldbach",
  "Groß-Gerau": "Groß-Gerau",
  "Großkrotzenburg": "Groß-Krotzenburg",
  "Groß-Umstadt (Medic Center)": "Groß-Umstadt Medic.",
  "Groß-Zimmern": "Groß-Zi Belmodi",
  "Haibach": "Haibach",
  "Hoechst im Odw.": "Höchst i. Odw.",
  "Hösbach Waschpark": "Hösbach alt",
  "Hösbach Norma": "Hösbach Norma",
  "Idstein": "Idstein",
  "Ingelheim": "Ingelheim",
  // zwei Stände: Martin-Luther-Straße eigener, Langer Kornweg von Reitz übernommen
  "Kelsterbach (Martin-Luther-Straße)": "Kelsterbach",
  "Kelsterbach (Langer Kornweg)": "Kelsterbach Reitz",
  "Kleinheubach": "Kleinheubach",
  "Kreuzwertheim": "Kreuz-Wertheim",
  "Langen": "Langen Kaufhaus",
  "Lauterbach": "Lauterbach",
  "Limburg Dehrn": "Limburg Dehrn",
  "Limburg Offheim": "Limburg Offheim",
  "Limburg Stadt": "Limburg Stadt",
  "Limburg Markt": "Markt Limburg",
  "Lohr am Main": "Lohr",
  "Ludwigshafen": "Ludwigshafen Dehner",
  "Ludwigshafen DepotLU": "Ludwigshafen Depot",
  "Maintal Autohaus": "Maintal neu",
  "Maintal Profi": "Maintal Profi Getr.",
  "Marktheidenfeld": "Marktheidenfeld",
  "Michelstadt": "Michelstadt",
  "Miltenberg": "Miltenberg",
  "Mömbris": "Mömbris",
  "Mömlingen": "Mömlingen",
  "Mudau": "Mudau",
  "Nieder-Ramstadt": "Nieder-Ramstadt",
  "Obernburg": "Obernburg",
  "Ober-Ramstadt": "Ober-Ramstadt",
  "Oberursel": "Oberursel",
  "Oestrich-Winkel": "Oestrich-Winkel",
  "Oppenheim (Aral)": "Oppenheim Aral",
  "Oppenheim Sans": "Oppenheim Sans",
  "Pfungstadt": "Pfungstadt Welter",
  "Reichelsheim": "Reichelsheim",
  "Reinheim": "Reinheim",
  "Rödermark": "Rödermark",
  "Rodgau": "Rodgau",
  "Rosbach": "Rosbach",
  "Rüdesheim": "Rüdesheim",
  "Rüsselsheim": "Rüsselsheim",
  "Rüsselsheim (OBI)": "Rüsselsheim Obi",
  "Schöllkrippen": "Schöllkrippen",
  "Schweinheim": "Schweinheim",
  "Seligenstadt (Deichmann)": "Seligenstadt klein",
  "Seligenstadt (Profi)": "Seligenstadt groß",
  "Stockstadt": "Stockstadt",
  "Sulzbach": "Sulzbach",
  "Walluf": "Walluf",
  "Wertheim": "Wertheim",
  "Wiesbaden Dotzheim": "Wiesbaden",
  "Wolfskehlen": "Wolfskehlen",
  "Wöllstein": "Wöllstein",
  "Worms WEP": "Worms",
  "Wörth": "Wörth",
};

// Auf der Liste, aber ohne Google-Profil (Nutzer 2026-11-26): fünf Stände
// vom Kollegen Sohling übernommen, Rüsselsheim Globus 2026 neu.
export const OHNE_PROFIL_2026: { name: string; ort: string; herkunft: string }[] = [
  { name: "Alsheim", ort: "Alsheim", herkunft: "Von Sohling übernommen" },
  { name: "Flörsheim-Dalsheim", ort: "Flörsheim-Dalsheim", herkunft: "Von Sohling übernommen" },
  { name: "Nackenheim", ort: "Nackenheim", herkunft: "Von Sohling übernommen" },
  { name: "Osthofen", ort: "Osthofen", herkunft: "Von Sohling übernommen" },
  { name: "Rüsselsheim Globus", ort: "Rüsselsheim am Main", herkunft: "Neu 2026" },
  { name: "Wörrstadt", ort: "Wörrstadt", herkunft: "Von Sohling übernommen" },
];

export function liste2026Anwenden(staende: StandImport[]): StandImport[] {
  const ergebnis: StandImport[] = staende.map((s) => {
    const neu = NAMEN_2026[s.name];
    return neu
      ? { ...s, name: neu, aktiv: true }
      : {
          ...s,
          aktiv: false,
          notiz: [s.notiz, "Nicht auf der Ständeliste 2026"].filter(Boolean).join(" · "),
        };
  });
  const vorhanden = new Set(ergebnis.map((s) => s.name));
  for (const z of OHNE_PROFIL_2026) {
    if (vorhanden.has(z.name)) continue;
    ergebnis.push({
      zeile: 0,
      datei: "Ständeliste 2026",
      name: z.name,
      status: "",
      strasse: "",
      lagehinweis: "",
      plz: "",
      ort: z.ort,
      telefon: "",
      adresse: "",
      notiz: `${z.herkunft} · kein Google-Profil - Adresse und Öffnungszeiten nachtragen`,
      zeiten: [],
      ohneZeiten: true,
      zeitFehler: [],
      aktiv: true,
    });
  }
  const vgl = new Intl.Collator("de", { sensitivity: "base", numeric: true });
  return ergebnis.sort(
    (a, b) =>
      Number(b.aktiv) - Number(a.aktiv) || vgl.compare(a.ort, b.ort) || vgl.compare(a.name, b.name)
  );
}
