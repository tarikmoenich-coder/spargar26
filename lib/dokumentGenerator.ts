// Befüllt eine oder mehrere der Word-Vorlagen aus public/vertragsvorlagen
// (Arbeitsvertrag, Werkmietvertrag, Bankverbindung) mit echten Werten und
// stößt den Download im Browser an.
//
// Bewusst ohne docxtemplater o.ä.: ein .docx ist technisch nur ein ZIP-
// Archiv mit XML-Dateien drin, der sichtbare Text steckt in
// word/document.xml. Wir laden das Archiv mit der freien, lizenzlich
// unbedenklichen "jszip", ersetzen die «Platzhalter» direkt im XML-Text und
// packen alles wieder ein - ohne kommerzielle Templating-Bibliothek.
//
// Setzt voraus, dass ein Platzhalter wie «Name» im XML als ZUSAMMEN-
// HÄNGENDER Text steht (nicht mitten im Wort inhaltlich unterbrochen).
// ersetzePlatzhalter() sammelt dafür alles zwischen « und » ein, auch über
// <w:t>-Run-/Tag-Grenzen hinweg (z.B. wenn Word ein frei erfundenes Wort wie
// "Staatsangehoerigkeit" als Rechtschreibfehler markiert und dabei
// <w:proofErr .../>-Tags mitten reinschiebt) - die Vorlagen wurden bewusst
// in einem Zug getippt (siehe Vertragsvorlagen/ im Projektordner), nach
// manuellen Änderungen an einer Vorlage in Word im Zweifel einmal testweise
// ein Dokument generieren und prüfen, ob alle «Platzhalter» ersetzt wurden.

import JSZip from "jszip";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Ersetzt alle bekannten «Platzhalter» im XML-Text durch die übergebenen
// Werte. Wirft einen Fehler, wenn ein angefragter Platzhalter nicht
// gefunden wurde, statt still ein kaputtes Dokument auszuliefern.
function ersetzePlatzhalter(
  xml: string,
  werte: Record<string, string>,
  vorlageDateiname: string
): string {
  const gefunden = new Set<string>();
  const ersetzt = xml.replace(/«((?:(?!«|»)[\s\S])*)»/g, (spanne, roh: string) => {
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
  return ersetzt;
}

async function ladeVorlage(vorlageDateiname: string): Promise<ArrayBuffer> {
  const res = await fetch(`/vertragsvorlagen/${vorlageDateiname}`);
  if (!res.ok) {
    throw new Error(`Vorlage "${vorlageDateiname}" nicht gefunden`);
  }
  return res.arrayBuffer();
}

function loeseDownloadAus(blob: Blob, downloadDateiname: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadDateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function generiereDokument(
  vorlageDateiname: string,
  werte: Record<string, string>,
  downloadDateiname: string
): Promise<void> {
  const buffer = await ladeVorlage(vorlageDateiname);
  const zip = await JSZip.loadAsync(buffer);
  const pfad = "word/document.xml";
  const datei = zip.file(pfad);
  if (!datei) {
    throw new Error(`"${vorlageDateiname}" ist keine gültige .docx-Datei`);
  }
  let xml = await datei.async("text");
  xml = ersetzePlatzhalter(xml, werte, vorlageDateiname);
  zip.file(pfad, xml);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  loeseDownloadAus(blob, downloadDateiname);
}

export interface DokumentSpezifikation {
  vorlage: string;
  werte: Record<string, string>;
}

// Fügt mehrere befüllte Vorlagen zu EINEM Word-Dokument zusammen (mit
// Seitenumbruch dazwischen) - z.B. um für mehrere Personen jeweils
// Arbeitsvertrag + Werkmietvertrag + Bankverbindung in einem Rutsch
// auszudrucken, statt viele einzelne Dateien öffnen zu müssen.
//
// Technik: aus jeder befüllten Vorlage wird nur der <w:body>-Inhalt
// herausgeschnitten (die eigentlichen Absätze/Tabellen) und hintereinander
// in EINE Dokument-Hülle gesetzt. Die abschließende Seiteneinrichtung
// (<w:sectPr>, Seitengröße/Ränder) wird aus jedem Zwischenstück entfernt
// und nur einmal ganz am Ende wieder eingesetzt - alle drei Vorlagen
// verwenden ohnehin dieselbe Seiteneinrichtung, da sie aus demselben
// Word-Skript stammen (siehe Vertragsvorlagen/ im Projektordner).
export async function generiereKombiniertesDokument(
  dokumente: DokumentSpezifikation[],
  downloadDateiname: string
): Promise<void> {
  if (dokumente.length === 0) return;

  const vorlagenCache = new Map<string, ArrayBuffer>();
  async function ladeVorlageGecacht(name: string): Promise<ArrayBuffer> {
    let buf = vorlagenCache.get(name);
    if (!buf) {
      buf = await ladeVorlage(name);
      vorlagenCache.set(name, buf);
    }
    return buf;
  }

  const seitenumbruch = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const bodyTeile: string[] = [];
  let letzterSectPr = "";

  for (const { vorlage, werte } of dokumente) {
    const buffer = await ladeVorlageGecacht(vorlage);
    const zip = await JSZip.loadAsync(buffer);
    const datei = zip.file("word/document.xml");
    if (!datei) throw new Error(`"${vorlage}" ist keine gültige .docx-Datei`);
    let xml = await datei.async("text");
    xml = ersetzePlatzhalter(xml, werte, vorlage);

    const bodyMatch = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
    if (!bodyMatch) {
      throw new Error(`Kein <w:body> in "${vorlage}" gefunden`);
    }
    let body = bodyMatch[1];

    const sectPrMatch = body.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
    if (sectPrMatch && sectPrMatch.index !== undefined) {
      letzterSectPr = sectPrMatch[0];
      body =
        body.slice(0, sectPrMatch.index) +
        body.slice(sectPrMatch.index + sectPrMatch[0].length);
    }

    bodyTeile.push(body);
  }

  const kombinierterBody = bodyTeile.join(seitenumbruch) + letzterSectPr;

  // Als Hülle (Styles/Schriftarten/Nummerierungen) dient die erste Vorlage
  // aus der Liste.
  const huelleBuffer = await ladeVorlageGecacht(dokumente[0].vorlage);
  const huelleZip = await JSZip.loadAsync(huelleBuffer);
  const huelleDatei = huelleZip.file("word/document.xml");
  if (!huelleDatei) {
    throw new Error(`"${dokumente[0].vorlage}" ist keine gültige .docx-Datei`);
  }
  let huelleXml = await huelleDatei.async("text");
  huelleXml = huelleXml.replace(
    /<w:body>[\s\S]*<\/w:body>/,
    `<w:body>${kombinierterBody}</w:body>`
  );
  huelleZip.file("word/document.xml", huelleXml);

  const blob = await huelleZip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  loeseDownloadAus(blob, downloadDateiname);
}
