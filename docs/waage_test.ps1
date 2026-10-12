<#
Test-Skript für die RHEWA 84vario per Ethernet/TCP-IP (Schnittstelle 7),
PowerShell-Variante (kein Python nötig) - siehe waage_test.py / erntewirtschaft-plan.md Teil D.
Nur zum manuellen Testen der Verbindung/des Protokolls.

Aufruf (aus cmd.exe oder PowerShell):
  powershell -ExecutionPolicy Bypass -File docs\waage_test.ps1 -Ip 192.168.2.79 -Port 8000
#>

param(
    [Parameter(Mandatory = $true)][string]$Ip,
    [Parameter(Mandatory = $true)][int]$Port
)

$Felder = @(
    "satzkennung", "laufende_nummer", "datum", "uhrzeit", "waegebruecke_nr",
    "waegebereich", "stueckzahl", "einheit", "brutto", "tara", "netto"
)

function Send-Befehl {
    param([string]$Ip, [int]$Port, [string]$Befehl, [int]$TimeoutMs = 35000)

    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect($Ip, $Port)
    $stream = $client.GetStream()
    $stream.ReadTimeout = $TimeoutMs

    $raus = [System.Text.Encoding]::ASCII.GetBytes("<$Befehl>")
    $stream.Write($raus, 0, $raus.Length)

    $buffer = New-Object byte[] 4096
    $all = New-Object System.Collections.Generic.List[byte]
    try {
        while ($true) {
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            for ($i = 0; $i -lt $read; $i++) { $all.Add($buffer[$i]) }
            $text = [System.Text.Encoding]::ASCII.GetString($all.ToArray())
            if ($text.EndsWith(">") -and ($text.Contains("!") -or $all.Contains([byte]3))) { break }
        }
    } catch [System.IO.IOException] {
        Write-Host "(Timeout oder Verbindungsabbruch beim Lesen)"
    }
    $client.Close()
    return , $all.ToArray()
}

Write-Host "--- Test 1: <GN7> (aktuelles Nettogewicht) ---"
$r1 = Send-Befehl -Ip $Ip -Port $Port -Befehl "GN7"
Write-Host "Rohantwort:" ([System.Text.Encoding]::ASCII.GetString($r1))

Write-Host ""
Write-Host "Leg jetzt ein bekanntes Gewicht auf die Waage, falls noch nicht geschehen."
Write-Host "--- Test 2: <FP0> (kompletter EDV1-Datensatz) ---"
$r2 = Send-Befehl -Ip $Ip -Port $Port -Befehl "FP0" -TimeoutMs 40000
Write-Host "Rohantwort:" ([System.Text.Encoding]::ASCII.GetString($r2))

$text2 = [System.Text.Encoding]::ASCII.GetString($r2)
if ($text2.Contains("!")) {
    Write-Host ""
    Write-Host "-> <FP!> - kein stabiles Gewicht innerhalb von 30s, oder außerhalb Wägebereich."
    return
}

$stxIdx = [Array]::IndexOf($r2, [byte]2)
$etxIdx = [Array]::IndexOf($r2, [byte]3)
if ($stxIdx -lt 0 -or $etxIdx -le $stxIdx) {
    Write-Host ""
    Write-Host "-> Konnte STX/ETX-Rahmen nicht finden - Rohbytes oben pruefen."
    return
}

$block = [System.Text.Encoding]::ASCII.GetString($r2, $stxIdx + 1, $etxIdx - $stxIdx - 1)
$teile = $block.Split(";")

Write-Host ""
Write-Host "Geparste Felder:"
for ($i = 0; $i -lt $Felder.Length -and $i -lt $teile.Length; $i++) {
    "{0,-20} = {1}" -f $Felder[$i], $teile[$i].Trim() | Write-Host
}
