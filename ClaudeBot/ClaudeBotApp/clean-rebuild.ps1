<#
.SYNOPSIS
    Clean rebuild a ClaudeBotApp-hoz: leallitja a futo peldanyt, torli a generalt
    bin/obj/dist mappakat, majd ujraepiti a teljes appot (React UI + WinForms host).

.PARAMETER Full
    Ha meg van adva, a react-ui/node_modules is torlodik, es az npm csomagok is
    ujratelepulnek a build soran. Alapbol ez megmarad (gyorsabb rebuild).
#>

param(
    [switch]$Full
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Remove-FolderRobust {
    param([string]$Path)

    if (-not (Test-Path $Path)) { return }

    try {
        Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
        return
    } catch {
        # Tipikusan a WebView2 cache mely mappastrukturaja lepi at a Windows MAX_PATH korlatjat.
        # Robocopy /MIR trukkel kiuritjuk, mert az natívan kezeli a hosszu path-okat.
        Write-Host "  Sima torles sikertelen, robocopy-val probalkozom: $Path" -ForegroundColor DarkYellow
        $empty = Join-Path $env:TEMP "empty_$(Get-Random)"
        New-Item -ItemType Directory -Path $empty -Force | Out-Null
        robocopy $empty $Path /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        Remove-Item -Path $empty -Force -Recurse -ErrorAction SilentlyContinue
        Remove-Item -Path $Path -Force -Recurse -ErrorAction SilentlyContinue
    }
}

Write-Host "=== Clean Rebuild indul ===" -ForegroundColor Cyan

# 1. Futo ClaudeBotApp.exe leallitasa, ha fut
$proc = Get-Process -Name ClaudeBotApp -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "Futo ClaudeBotApp.exe leallitasa (PID: $($proc.Id -join ', '))..." -ForegroundColor Yellow
    $proc | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

# 2. Generalt mappak torlese
$pathsToClean = @(
    (Join-Path $scriptDir "bin"),
    (Join-Path $scriptDir "obj"),
    (Join-Path $scriptDir "react-ui\dist")
)

if ($Full) {
    $pathsToClean += (Join-Path $scriptDir "react-ui\node_modules")
}

foreach ($path in $pathsToClean) {
    if (Test-Path $path) {
        Write-Host "Torles: $path" -ForegroundColor Yellow
        Remove-FolderRobust -Path $path
    }
}

# 3. Teljes build (a csproj MSBuild targetjei maguktol lefuttatjak az npm install/build lepeseket)
Write-Host "`n=== dotnet build indul ===" -ForegroundColor Cyan
dotnet build

if ($LASTEXITCODE -ne 0) {
    Write-Host "`nA build HIBAVAL ert veget (exit code: $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n=== Clean Rebuild sikeresen befejezodott ===" -ForegroundColor Green
