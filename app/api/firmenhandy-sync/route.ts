// Spiegelt den Firmenhandy-Nummernpool per CardDAV in ein selbst gehostetes
// Nextcloud-Adressbuch (Nutzer-Vorgabe 2026-09-17: automatisch, ohne Google,
// weil ~50 teils private Smartphones der Mitarbeiter per DAVx5 den
// aktuellen Nummer->Person-Stand als Kontakt zeigen sollen - Nutzer hat
// mehrmals pro Saison wechselnde Handy-Nutzer). NUR diese Route kennt die
// Nextcloud-Zugangsdaten (Server-Umgebungsvariablen, nie NEXT_PUBLIC_) - die
// Seite app/personal-firmenhandys schreibt Supabase direkt (RLS) und ruft
// diese Route nur für den externen Teil auf.
//
// Ein Kontakt je Nummer, UID = Nummer (nur Ziffern) - dadurch überschreibt
// ein erneuter Sync denselben Kontakt statt Duplikate anzulegen.

const BASE_URL = process.env.NEXTCLOUD_CARDDAV_BASE_URL;
const USER = process.env.NEXTCLOUD_CARDDAV_USER;
const PASSWORD = process.env.NEXTCLOUD_CARDDAV_PASSWORD;

interface SyncEintrag {
  nummer: string;
  name: string | null;
  // Funktion/Abteilung (Nutzer-Vorgabe 2026-09-18: "ein Feld ... mit dem
  // sich ein Kontakt schneller im Telefon finden lässt") - landet als vCard
  // TITLE, damit z.B. nach "Vorarbeiter" gesucht werden kann.
  funktion?: string | null;
}

interface SyncErgebnis {
  nummer: string;
  ok: boolean;
  fehler?: string;
}

function vcardUid(nummer: string): string {
  return `firmenhandy-${nummer.replace(/[^0-9]/g, "")}`;
}

function vcardEscape(text: string): string {
  return text.replace(/([,;\\])/g, "\\$1");
}

// Kurzes, eindeutiges Suffix statt der Telefonnummer in Klammern (Nutzer-
// Vorgabe 2026-09-18: "Die Telefonnummer in Klammern ist zuviel ... sowas
// wie Firma im Präfix oder Suffix") - die Nummer steht ja schon im
// Telefonfeld des Kontakts selbst. Als Suffix statt Präfix, damit die
// alphabetische Sortierung nach Namen erhalten bleibt.
const FIRMEN_SUFFIX = "Mömmel";

function vcard(nummer: string, name: string | null, funktion?: string | null): string {
  const uid = vcardUid(nummer);
  const anzeigename = name
    ? `${vcardEscape(name)} (${FIRMEN_SUFFIX})`
    : `Firmenhandy frei (${FIRMEN_SUFFIX})`;
  const zeilen = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `UID:${uid}`,
    `FN:${anzeigename}`,
    `TEL;TYPE=CELL:${nummer}`,
  ];
  if (funktion && funktion.trim() !== "") {
    zeilen.push(`TITLE:${vcardEscape(funktion.trim())}`);
  }
  zeilen.push("END:VCARD", "");
  return zeilen.join("\r\n");
}

async function syncEintrag(eintrag: SyncEintrag): Promise<SyncErgebnis> {
  const url = `${BASE_URL}${vcardUid(eintrag.nummer)}.vcf`;
  const auth = Buffer.from(`${USER}:${PASSWORD}`).toString("base64");
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "text/vcard; charset=utf-8",
      },
      body: vcard(eintrag.nummer, eintrag.name, eintrag.funktion),
    });
    if (!res.ok) {
      return {
        nummer: eintrag.nummer,
        ok: false,
        fehler: `HTTP ${res.status}`,
      };
    }
    return { nummer: eintrag.nummer, ok: true };
  } catch (err) {
    return {
      nummer: eintrag.nummer,
      ok: false,
      fehler: err instanceof Error ? err.message : "Unbekannter Fehler",
    };
  }
}

export async function POST(request: Request) {
  if (!BASE_URL || !USER || !PASSWORD) {
    return Response.json(
      {
        error:
          "Nextcloud-CardDAV-Zugangsdaten fehlen (NEXTCLOUD_CARDDAV_* Umgebungsvariablen).",
      },
      { status: 500 }
    );
  }

  let eintraege: SyncEintrag[];
  try {
    const body = await request.json();
    eintraege = Array.isArray(body?.eintraege) ? body.eintraege : [body];
  } catch {
    return Response.json({ error: "Ungültiger Request-Body." }, { status: 400 });
  }

  eintraege = eintraege.filter(
    (e): e is SyncEintrag => typeof e?.nummer === "string" && e.nummer.trim() !== ""
  );
  if (eintraege.length === 0) {
    return Response.json({ error: "Keine gültigen Einträge." }, { status: 400 });
  }
  // Sicherheitsnetz gegen versehentliche Großaufträge in einem Request.
  if (eintraege.length > 250) {
    return Response.json(
      { error: "Zu viele Einträge auf einmal (max. 250)." },
      { status: 400 }
    );
  }

  const ergebnisse = await Promise.all(eintraege.map(syncEintrag));
  return Response.json({ ergebnisse });
}
