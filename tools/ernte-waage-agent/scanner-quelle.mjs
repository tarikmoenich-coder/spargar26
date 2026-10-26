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

/**
 * "seriell": RS232-Scanner ueber einen COM-Port (Windows) bzw. ein
 * /dev/tty...-Geraet (Linux) - z.B. ueber einen USB-Seriell-Adapter an
 * einem Desktop-PC. Anders als "stdin" braucht das KEINEN Tastaturfokus -
 * laeuft deshalb problemlos auch als unsichtbarer Hintergrunddienst (z.B.
 * NSSM unter Windows), waehrend ein USB-HID-Scanner (Tastatur-Emulation)
 * genau dafuer ein sichtbares, fokussiertes Fenster braeuchte.
 * Braucht SCANNER_SERIELL_PORT (z.B. "COM3" oder "/dev/ttyUSB0") in der
 * .env; SCANNER_SERIELL_BAUDRATE (Default 9600) und
 * SCANNER_SERIELL_DELIMITER (Default "\r" - viele Scanner im RS232-Modus
 * senden nur CR, nicht CRLF - im Handbuch des jeweiligen Geraets pruefen)
 * je nach Scanner-Modell anpassen.
 */
async function* seriell() {
  const { SerialPort } = await import("serialport");
  const { ReadlineParser } = await import("@serialport/parser-readline");

  const pfad = process.env.SCANNER_SERIELL_PORT;
  if (!pfad) {
    throw new Error(
      'SCANNER_QUELLE=seriell braucht SCANNER_SERIELL_PORT in der .env ' +
        '(z.B. "COM3" unter Windows, "/dev/ttyUSB0" unter Linux).',
    );
  }
  const baudRate = Number(process.env.SCANNER_SERIELL_BAUDRATE ?? 9600);
  const delimiter = (process.env.SCANNER_SERIELL_DELIMITER ?? "\r").replace(/\\r/g, "\r").replace(/\\n/g, "\n");

  const port = new SerialPort({ path: pfad, baudRate });
  const parser = port.pipe(new ReadlineParser({ delimiter }));
  console.log(`Scanner-Quelle "seriell": lausche auf ${pfad} (${baudRate} Baud) ...`);

  port.on("error", (e) => {
    console.error(`  -> Serielle Schnittstelle (${pfad}): ${e.message}`);
  });

  // Bridge: serialport/der Parser sind event-basiert, wir brauchen einen
  // async generator - einfache Warteschlange + Aufwecken bei leerer Queue.
  const warteschlange = [];
  let wecken = null;
  parser.on("data", (zeile) => {
    const code = String(zeile).trim();
    if (!code) return;
    warteschlange.push(code);
    if (wecken) {
      wecken();
      wecken = null;
    }
  });

  while (true) {
    if (warteschlange.length === 0) {
      await new Promise((resolve) => {
        wecken = resolve;
      });
    }
    while (warteschlange.length > 0) {
      yield warteschlange.shift();
    }
  }
}

const QUELLEN = { simuliert, stdin, seriell };

export function scannerQuelle(name) {
  const fn = QUELLEN[name];
  if (!fn) {
    throw new Error(`Unbekannte SCANNER_QUELLE "${name}" - erlaubt: ${Object.keys(QUELLEN).join(", ")}`);
  }
  return fn();
}
