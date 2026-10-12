// Austauschbare Scanner-"Quelle", global per SCANNER_QUELLE umgeschaltet -
// damit wir heute schon mit Testdaten arbeiten koennen, bevor der echte
// 2D-Scanner gekauft ist (siehe docs/erntewirtschaft-plan.md, Hardware-
// Entscheidungen), ohne den Rest des Agenten spaeter anfassen zu muessen.
import readline from "node:readline";

/**
 * "simuliert": jede Enter-Taste erzeugt einen neuen Fake-Code
 * (K-TEST-0001, K-TEST-0002, ...). Zum Testen mit einer ECHTEN Waage:
 * Gewicht auflegen, dann Enter druecken - der Agent tut danach so, als
 * waere genau jetzt eine Kiste gescannt worden.
 */
async function* simuliert() {
  const rl = readline.createInterface({ input: process.stdin });
  console.log('Scanner-Quelle "simuliert": Gewicht auflegen, dann ENTER druecken (Ctrl+C zum Beenden).');
  let zaehler = 0;
  for await (const _zeile of rl) {
    zaehler += 1;
    const code = `K-TEST-${String(zaehler).padStart(4, "0")}`;
    console.log(`(simuliert) Code: ${code}`);
    yield code;
  }
}

/**
 * "stdin": liest echte Codes zeilenweise - passt sowohl zu manuellem
 * Testen mit einem echten Code als auch zu einem spaeteren USB-HID-
 * Scanner (tippt den Code + Enter, als säße jemand an der Tastatur).
 */
async function* stdin() {
  const rl = readline.createInterface({ input: process.stdin });
  console.log('Scanner-Quelle "stdin": Code eingeben/scannen, dann ENTER (Ctrl+C zum Beenden).');
  for await (const zeile of rl) {
    const code = zeile.trim();
    if (code) yield code;
  }
}

// eslint-disable-next-line require-yield
async function* seriell() {
  throw new Error(
    'Scanner-Quelle "seriell" (RS232) ist noch nicht implementiert - erst sobald ein echtes ' +
      "Scanner-Modell feststeht (siehe docs/anfrage-2d-scanner-rfq.md). Bis dahin SCANNER_QUELLE=stdin oder simuliert nutzen.",
  );
}

const QUELLEN = { simuliert, stdin, seriell };

export function scannerQuelle(name) {
  const fn = QUELLEN[name];
  if (!fn) {
    throw new Error(`Unbekannte SCANNER_QUELLE "${name}" - erlaubt: ${Object.keys(QUELLEN).join(", ")}`);
  }
  return fn();
}
