"""
Test-Skript für die RHEWA 84vario per Ethernet/TCP-IP (Schnittstelle 7).
Nur zum manuellen Testen der Verbindung/des Protokolls, KEIN Teil des
späteren ernte-waage-agent - siehe erntewirtschaft-plan.md Teil D.

Aufruf: python3 waage_test.py <ip> <port>
Beispiel: python3 waage_test.py 192.168.1.50 8000
"""

import socket
import sys

STX = 0x02
ETX = 0x03

FELDER = [
    "satzkennung",       # vor der laufenden Nummer, im Praxistest 12.10.2026 leer
    "laufende_nummer",  # 10-stellig, Schlüssel des geräteinternen Alibispeichers
    "datum",             # TT.MM.JJJJ
    "uhrzeit",           # HH:MM:SS
    "waegebruecke_nr",
    "waegebereich",
    "stueckzahl",
    "einheit",           # kg
    "brutto",
    "tara",
    "netto",
]


def sende_befehl(sock: socket.socket, befehl: str) -> bytes:
    sock.sendall(f"<{befehl}>".encode("ascii"))
    return lese_antwort(sock)


def lese_antwort(sock: socket.socket, timeout_s: float = 35.0) -> bytes:
    # <FP0> lässt die Waage bis zu 30s auf Ruhelage warten - Timeout hier
    # bewusst etwas großzügiger als die dokumentierten 30s der Waage selbst.
    sock.settimeout(timeout_s)
    daten = b""
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            break
        daten += chunk
        # Fertig, sobald wir entweder eine Fehlerquittierung <..!> oder die
        # komplette EDV1-Antwort (ETX + anschliessendes <FP>) gesehen haben.
        if daten.endswith(b">") and (b"!" in daten or b"\x03" in daten):
            break
    return daten


def parse_edv1(rohdaten: bytes):
    if STX not in rohdaten or ETX not in rohdaten:
        return None
    block = rohdaten[rohdaten.index(STX) + 1 : rohdaten.index(ETX)]
    teile = block.decode("ascii", errors="replace").split(";")
    return dict(zip(FELDER, [t.strip() for t in teile]))


def main():
    if len(sys.argv) != 3:
        print("Aufruf: python3 waage_test.py <ip> <port>")
        sys.exit(1)
    ip, port = sys.argv[1], int(sys.argv[2])

    with socket.create_connection((ip, port), timeout=10) as sock:
        print(f"Verbunden mit {ip}:{port}")

        print("\n--- Test 1: <GN7> (aktuelles Nettogewicht) ---")
        antwort = sende_befehl(sock, "GN7")
        print("Rohantwort:", antwort)

    # <FP0> braucht eine frische Verbindung (die Waage schliesst die
    # Verbindung nach der Antwort typischerweise, siehe Plan: "Verbindung
    # schließen" gehört zum Ablauf).
    with socket.create_connection((ip, port), timeout=40) as sock:
        print("\n--- Test 2: <FP0> (kompletter EDV1-Datensatz) ---")
        print("Leg jetzt ein bekanntes Gewicht auf die Waage, falls noch nicht geschehen.")
        antwort = sende_befehl(sock, "FP0")
        print("Rohantwort:", antwort)

        if b"!" in antwort:
            print("\n-> <FP!> - kein stabiles Gewicht innerhalb von 30s, oder außerhalb Wägebereich.")
            return

        werte = parse_edv1(antwort)
        if werte is None:
            print("\n-> Konnte STX/ETX-Rahmen nicht finden - Rohbytes oben prüfen.")
            return

        print("\nGeparste Felder:")
        for k, v in werte.items():
            print(f"  {k:20s} = {v}")

        print("\nZum Abgleich mit deinem bekannten Gewicht:")
        print(f"  Brutto = {werte['brutto']}, Tara = {werte['tara']}, Netto = {werte['netto']}")


if __name__ == "__main__":
    main()
