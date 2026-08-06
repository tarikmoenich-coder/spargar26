// Befüllt eine der Word-Vorlagen aus public/vertragsvorlagen (Arbeitsvertrag,
// Werkmietvertrag, Bankverbindung) mit echten Werten und stößt den Download
// im Browser an.
//
// Bewusst ohne docxtemplater o.ä.: ein .docx ist technisch nur ein ZIP-
// Archiv mit XML-Dateien drin, der sichtbare Text steckt in
// word/document.xml. Wir laden das Archiv mit der freien, lizenzlich
// unbedenklichen "jszip", ersetzen die «Platzhalter» direkt im XML-Text und
// packen alles wieder ein - ohne kommerzielle Templating-Bibliothek.
//
// Setzt voraus, dass ein Platzhalter wie «Name» im XML als ZUSAMMEN-
// HÄNGENDER Text-Run steht (nicht mitten im Wort von Word auf mehrere
// <w:t>-Runs aufgesplittet). Die Vorlagen wurden bewusst in einem Zug
// getippt (siehe Vertragsvorlagen/ im Projektordner), damit das der Fall
// ist - nach manuellen Änderungen an einer Vorlage in Word im Zweifel
// einmal testweise ein Dokument generieren und prüfen, ob alle
// «Platzhalter» ersetzt wurden.

import JSZip from "jszip";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function generiereDokument(
  vorlageDateiname: string,
  werte: Record<string, string>,
  downloadDateiname: string
): Promise<void> {
  const res = await fetch(`/vertragsvorlagen/${vorlageDateiname}`);
  if (!res.ok) {
    throw new Error(`Vorlage "${vorlageDateiname}" nicht gefunden`);
  }
  const buffer = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const pfad = "word/document.xml";
  const datei = zip.file(pfad);
  if (!datei) {
    throw new Error(`"${vorlageDateiname}" ist keine gültige .docx-Datei`);
  }
  let xml = await datei.async("text");

  // Word trennt ein «Platzhalter»-Wort öfter in mehrere <w:t>-Runs auf, ohne
  // dass man das im Editor sieht - z.B. weil ein frei erfundenes Wort wie
  // "Staatsangehoerigkeit" (ohne Umlaut) als Rechtschreibfehler markiert
  // wird (<w:proofErr .../>) oder weil an der Stelle ein Zeilenumbruch im
  // internen Layout liegt. Ein einfaches String-Suchen/Ersetzen würde solche
  // Platzhalter übersehen. Stattdessen: alles zwischen « und » einsammeln
  // (auch über Run-/Tag-Grenzen hinweg), die reinen XML-Tags daraus
  // entfernen um den Feldnamen zu bekommen, und bei Treffer die GESAMTE
  // Spanne (inkl. aller Zwischen-Tags) durch ein einziges sauberes Textstück
  // ersetzen.
  const gefunden = new Set<string>();
  xml = xml.replace(/«((?:(?!«|»)[\s\S])*)»/g, (spanne, roh: string) => {
    const feld = roh.replace(/<[^>]+>/g, "").trim();
    if (!(feld in werte)) return spanne; // unbekannter Platzhalter: unverändert lassen
    gefunden.add(feld);
    return escapeXml(werte[feld]);
  });

  const nichtErsetzt = Object.keys(werte).filter((f) => !gefunden.has(f));
  if (nichtErsetzt.length > 0) {
    // Vorlage wurde vermutlich manuell geändert und der Platzhalter dabei
    // umbenannt/gelöscht - lieber früh und deutlich melden, als ein
    // Dokument mit sichtbarem "«Name»" drin auszuliefern.
    throw new Error(
      `Platzhalter nicht gefunden in "${vorlageDateiname}": ${nichtErsetzt.join(", ")}`
    );
  }

  zip.file(pfad, xml);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadDateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
