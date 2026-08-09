// Sehr leichtgewichtige Übersetzungs-Infrastruktur - kein Framework, nur ein
// flaches Wörterbuch pro Sprache + eine kleine t()-Hilfsfunktion. Betrifft
// NUR die Bedienoberfläche, keine Dokumente/Formulare (Nutzer-Vorgabe
// 2026-08-08 - deshalb auch bewusst NICHT für Druckansichten genutzt, die
// zählen wie ein Formular). Schrittweise ausgerollt: aktuell nur
// Stundenerfassung ("erfassung.*") und Suche ("suche.*") übersetzt, mit
// Deutsch als Ausgangssprache (=Schlüssel-Quelle) und Kroatisch als erste
// zusätzliche Sprache. Weitere Seiten/Sprachen können ergänzt werden, ohne
// bestehende Schlüssel zu verändern.
//
// Verwendung in einer Seite:
//   const { profile } = useProfile();
//   const t = uebersetzung(profile?.sprache);
//   ... {t("erfassung.title")} ...
//   ... {t("erfassung.tagessumme", { wert: gesamtStunden.toFixed(2) })} ...

export type Sprache = "de" | "hr";

export const SPRACHEN: { wert: Sprache; label: string }[] = [
  { wert: "de", label: "Deutsch" },
  { wert: "hr", label: "Hrvatski" },
];

const de = {
  // Gemeinsam (mehrfach genutzt)
  "gemeinsam.laedt": "Lädt…",
  "gemeinsam.drucken": "Drucken",
  "gemeinsam.datum": "Datum",
  "gemeinsam.std": "Std.",
  "gemeinsam.markierung": "Markierung",
  "gemeinsam.notiz": "Notiz",
  "gemeinsam.bar": "Bar",
  "gemeinsam.ueberweisung": "Überweisung",
  "gemeinsam.storniert": "storniert",
  "gemeinsam.aktiv": "aktiv",
  "gemeinsam.inaktiv": "inaktiv",
  "gemeinsam.kisten": "Kisten",
  "gemeinsam.praemieeuro": "Prämie €",
  "gemeinsam.kolbennorm": "Kolben Norm",
  "gemeinsam.alle": "Alle",
  "gemeinsam.speichern": "Speichern",
  "gemeinsam.steigen": "Steigen",
  "gemeinsam.sut": "Sut",
  "gemeinsam.parzelle": "Parzelle",

  // Stundenerfassung (app/erfassung/page.tsx)
  "erfassung.title": "Stundenerfassung",
  "erfassung.untertitel":
    'Änderungen werden sofort für alle angemeldeten Nutzer sichtbar (Live-Sync). „U" = Urlaub/Feiertag.',
  "erfassung.eintagzurueck": "Ein Tag zurück",
  "erfassung.eintagvor": "Ein Tag vor",
  "erfassung.tagessumme": "Tagessumme: {wert} Std.",
  "erfassung.rollegesperrt":
    "🔒 Deine Rolle ({rolle}) darf hier nur lesen, keine Stunden eintragen - die Felder sind deshalb gesperrt.",
  "erfassung.monatgesperrt":
    "🔒 Dieser Monat ist im Rahmen des Monatsabschlusses gesperrt - die Stunden für diesen Tag können nicht mehr geändert werden. Zum Nachtragen muss der Monat auf der Lohnübersicht bewusst wieder geöffnet werden.",
  "erfassung.ausblenden": "Ausblenden",
  "erfassung.gruppedrucken": "Gruppe drucken",
  "erfassung.persnr": "Pers.-Nr.",
  "erfassung.name": "Name",
  "erfassung.herkunft": "Herkunft",
  "erfassung.fuehrerschein": "Führerschein",
  "erfassung.stunden": "Stunden",
  "erfassung.gruppe": "Gruppe",
  "erfassung.nurkontrolle": "Nur zur Kontrolle - hier nicht bearbeitbar",
  "erfassung.markierungurlaub": "U (Urlaub/Feiertag)",
  "erfassung.markierungfahrer": "F (Fahrer)",
  "erfassung.notizplatzhalter": "z.B. krank, zu spät",
  "erfassung.stundenfeldtitel":
    "↑/↓: vorherige/nächste Person · Umschalt+←/→: Vortag/Folgetag derselben Person",
  "erfassung.keinegruppe": "— keine Gruppe —",
  "erfassung.personenstd": "{n} Pers., {std} Std.",

  // Suche (app/suche/page.tsx)
  "suche.title": "Suche",
  "suche.untertitel":
    "Nach Name oder Personalnummer suchen, um Arbeitsstunden und Vorschüsse einer Person einzusehen.",
  "suche.platzhalter": "Name oder Personalnummer eingeben…",
  "suche.keinetreffer": "Keine Treffer.",
  "suche.personalnummer": "Personalnummer {nr}",
  "suche.saisonjahr": "Saison-Jahr",
  "suche.neuesuche": "Neue Suche",
  "suche.arbeitsstunden": "Arbeitsstunden {jahr}",
  "suche.stdtage": "{std} Std. · {tage} Tage",
  "suche.keineeintraege": "Keine Einträge in diesem Jahr.",
  "suche.vorschuesse": "Vorschüsse",
  "suche.betragaktiv": "{betrag} € (aktiv)",
  "suche.keinevorschuesse": "Keine Vorschüsse erfasst.",
  "suche.betrageuro": "Betrag €",
  "suche.art": "Art",
  "suche.begruendung": "Begründung",
  "suche.status": "Status",
  "suche.zuckermaispraemien": "Zuckermais-Prämien {jahr}",
  "suche.praemiegesamt": "{betrag} € gesamt",
  "suche.keinezuckermais": "Keine Zuckermais-Einträge in diesem Jahr.",
  "suche.erdbeerenpraemien": "Erdbeeren-Prämien {jahr}",

  // Arbeitskleidung (app/arbeitskleidung/page.tsx)
  "arbeitskleidung.title": "Arbeitskleidung {jahr}",
  "arbeitskleidung.untertitel":
    "Nur Hose, Jacke und Stiefel werden berechnet und als eigene Abzugsposition in die Lohnübersicht übernommen (wie Buskosten/Kautionen). Spargelmesser, Feile, Handschuhe sind Verbrauchsgegenstände - werden beim Tausch gegen das Altgerät kostenlos ersetzt und hier nicht erfasst. Anzahl statt Betrag: der Preis je Stück steht fest in den Einstellungen.",
  "arbeitskleidung.keinepreise":
    "⚠ Für {jahr} sind noch keine Preise für Hose/Jacke/Stiefel in den Einstellungen hinterlegt - eingetragene Stückzahlen werden erst mit 0 € berechnet, bis das nachgeholt wird.",
  "arbeitskleidung.keineberechtigung":
    "Nur admin/hr/zeiterfassung dürfen Arbeitskleidung erfassen.",
  "arbeitskleidung.hose": "Hose (Anzahl)",
  "arbeitskleidung.jacke": "Jacke (Anzahl)",
  "arbeitskleidung.stiefel": "Stiefel (Anzahl)",
} as const;

export type TKey = keyof typeof de;

const hr: Record<TKey, string> = {
  "gemeinsam.laedt": "Učitavanje…",
  "gemeinsam.drucken": "Ispis",
  "gemeinsam.datum": "Datum",
  "gemeinsam.std": "h",
  "gemeinsam.markierung": "Oznaka",
  "gemeinsam.notiz": "Napomena",
  "gemeinsam.bar": "Gotovina",
  "gemeinsam.ueberweisung": "Bankovni prijenos",
  "gemeinsam.storniert": "stornirano",
  "gemeinsam.aktiv": "aktivno",
  "gemeinsam.inaktiv": "neaktivno",
  "gemeinsam.kisten": "Sanduci",
  "gemeinsam.praemieeuro": "Premija €",
  "gemeinsam.kolbennorm": "Klipovi norma",
  "gemeinsam.alle": "Sve",
  "gemeinsam.speichern": "Spremi",
  "gemeinsam.steigen": "Gajbe",
  "gemeinsam.sut": "Otpad",
  "gemeinsam.parzelle": "Parcela",

  "erfassung.title": "Evidencija radnih sati",
  "erfassung.untertitel":
    'Promjene su odmah vidljive svim prijavljenim korisnicima (uživo). „U" = godišnji odmor/praznik.',
  "erfassung.eintagzurueck": "Jedan dan unatrag",
  "erfassung.eintagvor": "Jedan dan unaprijed",
  "erfassung.tagessumme": "Dnevni zbroj: {wert} h",
  "erfassung.rollegesperrt":
    "🔒 Vaša uloga ({rolle}) ovdje smije samo čitati, ne i unositi sate - polja su zato zaključana.",
  "erfassung.monatgesperrt":
    "🔒 Ovaj mjesec je zaključan u sklopu mjesečnog obračuna - sati za ovaj dan se više ne mogu mijenjati. Za naknadni unos mjesec mora biti svjesno ponovno otvoren na pregledu plaća.",
  "erfassung.ausblenden": "Sakrij",
  "erfassung.gruppedrucken": "Ispis grupe",
  "erfassung.persnr": "Br. osobe",
  "erfassung.name": "Ime",
  "erfassung.herkunft": "Podrijetlo",
  "erfassung.fuehrerschein": "Vozačka dozvola",
  "erfassung.stunden": "Sati",
  "erfassung.gruppe": "Grupa",
  "erfassung.nurkontrolle": "Samo za kontrolu - ovdje se ne može uređivati",
  "erfassung.markierungurlaub": "U (godišnji odmor/praznik)",
  "erfassung.markierungfahrer": "F (vozač)",
  "erfassung.notizplatzhalter": "npr. bolestan, kasni",
  "erfassung.stundenfeldtitel":
    "↑/↓: prethodna/sljedeća osoba · Shift+←/→: prethodni/sljedeći dan iste osobe",
  "erfassung.keinegruppe": "— bez grupe —",
  "erfassung.personenstd": "{n} os., {std} h",

  "suche.title": "Pretraga",
  "suche.untertitel":
    "Pretražite po imenu ili osobnom broju kako biste pregledali radne sate i predujmove osobe.",
  "suche.platzhalter": "Unesite ime ili osobni broj…",
  "suche.keinetreffer": "Nema rezultata.",
  "suche.personalnummer": "Osobni broj {nr}",
  "suche.saisonjahr": "Sezonska godina",
  "suche.neuesuche": "Nova pretraga",
  "suche.arbeitsstunden": "Radni sati {jahr}",
  "suche.stdtage": "{std} h · {tage} dana",
  "suche.keineeintraege": "Nema unosa u ovoj godini.",
  "suche.vorschuesse": "Predujmovi",
  "suche.betragaktiv": "{betrag} € (aktivno)",
  "suche.keinevorschuesse": "Nema unesenih predujmova.",
  "suche.betrageuro": "Iznos €",
  "suche.art": "Vrsta",
  "suche.begruendung": "Obrazloženje",
  "suche.status": "Status",
  "suche.zuckermaispraemien": "Premije kukuruz šećerac {jahr}",
  "suche.praemiegesamt": "{betrag} € ukupno",
  "suche.keinezuckermais": "Nema unosa za kukuruz šećerac u ovoj godini.",
  "suche.erdbeerenpraemien": "Premije jagode {jahr}",

  "arbeitskleidung.title": "Radna odjeća {jahr}",
  "arbeitskleidung.untertitel":
    "Obračunavaju se samo hlače, jakna i čizme te se preuzimaju kao zasebna stavka odbitka u pregledu plaća (kao putni troškovi/depoziti). Nož za šparoge, turpija i rukavice su potrošni materijal - besplatno se zamjenjuju uz predaju starog komada i ovdje se ne evidentiraju. Broj komada umjesto iznosa: cijena po komadu je fiksno postavljena u postavkama.",
  "arbeitskleidung.keinepreise":
    "⚠ Za {jahr} još nisu unesene cijene za hlače/jaknu/čizme u postavkama - unesene količine se do tada obračunavaju s 0 €.",
  "arbeitskleidung.keineberechtigung":
    "Samo admin/hr/zeiterfassung smiju evidentirati radnu odjeću.",
  "arbeitskleidung.hose": "Hlače (kom.)",
  "arbeitskleidung.jacke": "Jakna (kom.)",
  "arbeitskleidung.stiefel": "Čizme (kom.)",
};

const WOERTERBUECHER: Record<Sprache, Record<TKey, string>> = { de, hr };

// Ersetzt {platzhalter} in einem Übersetzungstext mit den übergebenen
// Werten - einfache, framework-freie Interpolation.
function interpoliere(text: string, werte?: Record<string, string | number>): string {
  if (!werte) return text;
  let ergebnis = text;
  for (const [schluessel, wert] of Object.entries(werte)) {
    ergebnis = ergebnis.replaceAll(`{${schluessel}}`, String(wert));
  }
  return ergebnis;
}

// Liefert eine t()-Funktion für die übergebene Sprache (Default Deutsch,
// z.B. solange profile noch lädt oder für Nutzer ohne Sprachwahl).
export function uebersetzung(sprache: Sprache | null | undefined) {
  const woerterbuch = WOERTERBUECHER[sprache ?? "de"] ?? de;
  return function t(schluessel: TKey, werte?: Record<string, string | number>): string {
    const text = woerterbuch[schluessel] ?? de[schluessel] ?? schluessel;
    return interpoliere(text, werte);
  };
}
