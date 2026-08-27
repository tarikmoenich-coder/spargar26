// SEPA-Überweisungsdatei (ISO 20022 pain.001.001.03) - Nutzer-Vorgabe
// 2026-08-25: "Schaltfläche 'SEPA-Datei erstellen'" bei Vorschüssen mit
// Zahlungsart Banküberweisung, wählbares Zahlungsdatum, Mömmel Agrar als
// Zahlungsleister, Verwendungszweck "[Vorschussbeleg Nummer], [Nachname],
// [Name]". Reine Client-seitige String-Erzeugung (kein Backend nötig) -
// das Format ist ein einfaches, gut dokumentiertes XML-Schema, das jede
// deutsche Bank beim Online-Banking-Upload akzeptiert.
//
// Namen/Verwendungszweck bewusst als UTF-8 ausgegeben (nicht auf den engen
// SEPA-Zeichensatz transliteriert) - moderne Banking-Portale akzeptieren
// das inzwischen durchgehend, ein "ü" in "Mömmel" ohne Transliteration zu
// verlieren ist wichtiger als pedantische Norm-Treue. Nur die technischen
// ID-Felder (MsgId/PmtInfId/EndToEndId) werden auf ein sicheres
// Zeichen-Subset beschränkt, da diese ohnehin keinen Klartext brauchen.

export interface SepaAuftraggeber {
  name: string;
  iban: string;
  bic: string;
}

export interface SepaZahlung {
  employeeId: string;
  name: string;
  iban: string;
  bic: string;
  betrag: number;
  verwendungszweck: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function saubereIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

function saubereBic(bic: string): string {
  return bic.replace(/\s+/g, "").toUpperCase();
}

// Technische IDs dürfen laut SEPA-Regelwerk nur aus einem eingeschränkten
// Zeichensatz bestehen und maximal 35 Zeichen lang sein.
function saubereId(text: string, maxLaenge = 35): string {
  return text.replace(/[^A-Za-z0-9\-]/g, "-").slice(0, maxLaenge);
}

function betragFormat(betrag: number): string {
  return betrag.toFixed(2);
}

// Baut eine vollständige pain.001.001.03-Nachricht mit genau einem
// Zahlungsauftrag (PmtInf), der alle übergebenen Einzelüberweisungen als
// Sammelbuchung (BtchBookg = true) enthält.
export function erzeugeSepaXml(
  auftraggeber: SepaAuftraggeber,
  zahlungen: SepaZahlung[],
  ausfuehrungsdatum: string, // YYYY-MM-DD
  nachrichtenIdPraefix: string
): string {
  const jetzt = new Date().toISOString().slice(0, 19);
  const msgId = saubereId(`${nachrichtenIdPraefix}-${Date.now()}`);
  const pmtInfId = saubereId(`P-${msgId}`);
  const anzahl = zahlungen.length;
  const summe = zahlungen.reduce((s, z) => s + z.betrag, 0);

  const auftraggeberIban = saubereIban(auftraggeber.iban);
  const auftraggeberBic = saubereBic(auftraggeber.bic);

  const transaktionen = zahlungen
    .map((z, i) => {
      const endToEndId = saubereId(`${nachrichtenIdPraefix}-${i + 1}`);
      return `      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${endToEndId}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${betragFormat(z.betrag)}</InstdAmt>
        </Amt>
        <CdtrAgt>
          <FinInstnId>
            <BIC>${saubereBic(z.bic)}</BIC>
          </FinInstnId>
        </CdtrAgt>
        <Cdtr>
          <Nm>${escapeXml(z.name)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${saubereIban(z.iban)}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${escapeXml(z.verwendungszweck.slice(0, 140))}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${jetzt}</CreDtTm>
      <NbOfTxs>${anzahl}</NbOfTxs>
      <CtrlSum>${betragFormat(summe)}</CtrlSum>
      <InitgPty>
        <Nm>${escapeXml(auftraggeber.name)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${pmtInfId}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${anzahl}</NbOfTxs>
      <CtrlSum>${betragFormat(summe)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${ausfuehrungsdatum}</ReqdExctnDt>
      <Dbtr>
        <Nm>${escapeXml(auftraggeber.name)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${auftraggeberIban}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BIC>${auftraggeberBic}</BIC>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${transaktionen}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}

// Stößt den Download der erzeugten XML-Datei im Browser an.
export function sepaDateiHerunterladen(xml: string, dateiname: string) {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dateiname;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
