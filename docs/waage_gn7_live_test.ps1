<#
Dauerabfrage von <GN7> (aktuelles Nettogewicht, sofortige Antwort) im
kurzen Takt - zum Pruefen, ob die Waage waehrend des Auflegens LIVE
mitschwankende Werte liefert, oder ob sie erst antwortet, nachdem sie zur
Ruhe gekommen ist. Das ist die Grundannahme hinter der Aenderungserkennung
im Waagen-Agenten (siehe tools/ernte-waage-agent/index.mjs) - diese
Annahme sollte an der echten Waage bestaetigt werden, bevor man sich
darauf verlaesst.

Waehrend das Skript laeuft: langsam ein Gewicht auflegen (nicht einfach
hinwerfen) und beobachten:
  - Bewegen sich die Zahlen schon WAEHREND des Auflegens (Zwischenwerte,
    bevor es zur Ruhe kommt)? -> GN7 ist live, Annahme bestaetigt.
  - Bleibt die Zahl konstant und springt erst NACH einer kleinen Pause auf
    den Endwert? -> GN7 ist selbst schon gefiltert/wartet, Agent muesste
    anders gebaut werden.

Aufruf: powershell -ExecutionPolicy Bypass -File waage_gn7_live_test.ps1 -Ip 192.168.2.32 -Port 8000
Optional: -IntervallMs 300 (Standard)
Beenden mit Ctrl+C.
#>

param(
    [Parameter(Mandatory = $true)][string]$Ip,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$IntervallMs = 300
)

function Lese-GN7 {
    param([string]$Ip, [int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect($Ip, $Port)
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000

    $raus = [System.Text.Encoding]::ASCII.GetBytes("<GN7>")
    $stream.Write($raus, 0, $raus.Length)

    $buffer = New-Object byte[] 256
    $all = New-Object System.Collections.Generic.List[byte]
    try {
        while ($true) {
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            for ($i = 0; $i -lt $read; $i++) { $all.Add($buffer[$i]) }
            $text = [System.Text.Encoding]::ASCII.GetString($all.ToArray())
            if ($text.EndsWith(">")) { break }
        }
    } catch {
        # Timeout/Verbindungsabbruch - geben wir unten als Fehlertext aus.
    }
    $client.Close()
    return [System.Text.Encoding]::ASCII.GetString($all.ToArray())
}

Write-Host "Dauerabfrage <GN7> alle $IntervallMs ms gegen ${Ip}:${Port} - Ctrl+C zum Beenden."
Write-Host "Jetzt langsam ein Gewicht auflegen und beobachten, ob sich die Werte VOR der Ruhelage schon bewegen."
Write-Host ""

while ($true) {
    $zeit = Get-Date -Format "HH:mm:ss.fff"
    try {
        $antwort = Lese-GN7 -Ip $Ip -Port $Port
        Write-Host "$zeit  $antwort"
    } catch {
        Write-Host "$zeit  Fehler: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds $IntervallMs
}
