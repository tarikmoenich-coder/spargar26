# Aktualisiert den Waagen-Agenten auf DIESEM Rechner (Dell-Desktop
# DESKTOP-HV8VR5E): neuesten Code holen, Abhaengigkeiten installieren,
# NSSM-Dienst neu starten - fasst die drei manuellen Schritte aus der
# README zusammen, damit ein Update per SSH in einem Befehl geht statt
# physisch am Geraet nachschauen zu muessen.
#
# Einmalig pruefen/anpassen: $dienstName unten muss zum tatsaechlichen
# NSSM-Dienstnamen passen (pruefen mit "nssm list" oder der Dienste-App,
# falls beim Einrichten ein anderer Name gewaehlt wurde als hier).
#
# Aufruf (PowerShell, als Administrator - NSSM braucht das zum
# Stoppen/Starten des Dienstes):
#   .\update.ps1
# Oder direkt per SSH von einem anderen Rechner aus, ohne erst
# einzuloggen:
#   ssh <benutzer>@<dell-ip> "powershell -File C:\Pfad\zum\repo\tools\ernte-waage-agent\update.ps1"

$ErrorActionPreference = "Stop"
$dienstName = "ernte-waage-agent"

Write-Host "Stoppe Dienst $dienstName ..."
nssm stop $dienstName

# Repo-Wurzel = zwei Ebenen ueber diesem Skript (tools/ernte-waage-agent/update.ps1)
$repoWurzel = Resolve-Path (Join-Path $PSScriptRoot "..\..")

Write-Host "git pull in $repoWurzel ..."
Set-Location $repoWurzel
git pull

Write-Host "npm ci ..."
Set-Location (Join-Path $repoWurzel "tools\ernte-waage-agent")
npm ci

Write-Host "Starte Dienst $dienstName ..."
nssm start $dienstName

Write-Host "Fertig. Status:"
nssm status $dienstName
