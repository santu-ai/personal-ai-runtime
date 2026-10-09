# Install the NSIS package on a clean machine and prove the packaged app
# starts its embedded backend. This script must launch the installed exe,
# not a checkout of the source tree.
param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactDir
)

$ErrorActionPreference = "Stop"

$setup = Get-ChildItem -Path $ArtifactDir -Filter "PersonalAIRuntime-Setup-*-x64.exe" |
    Select-Object -First 1
if (-not $setup) {
    throw "NSIS setup executable not found in $ArtifactDir"
}

Write-Host "Installing $($setup.FullName)"
$install = Start-Process -FilePath $setup.FullName -ArgumentList "/S" -Wait -PassThru
if ($null -ne $install.ExitCode -and $install.ExitCode -ne 0) {
    throw "Installer exit code $($install.ExitCode)"
}

# oneClick per-user install uses the sanitized package name, not the product name.
# The executable inside that folder keeps the product name.
$exe = Join-Path $env:LOCALAPPDATA "Programs\personal-ai-runtime-desktop\Personal AI Runtime.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    $programs = Join-Path $env:LOCALAPPDATA "Programs"
    $found = Get-ChildItem -Path $programs -Filter "Personal AI Runtime.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($found) {
        $exe = $found.FullName
    }
}
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Installed executable missing: $exe"
}

$root = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$work = Join-Path $root "par-desktop-smoke"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$resultPath = Join-Path $work "result.json"
$donePath = Join-Path $work "done"
$userData = Join-Path $work "user-data"
New-Item -ItemType Directory -Force -Path $userData | Out-Null
if (Test-Path -LiteralPath $resultPath) { Remove-Item -LiteralPath $resultPath -Force }
if (Test-Path -LiteralPath $donePath) { Remove-Item -LiteralPath $donePath -Force }

$env:PAR_DESKTOP_SMOKE = "1"
$env:PAR_DESKTOP_SMOKE_RESULT = $resultPath
$env:PAR_DESKTOP_SMOKE_DONE = $donePath
$env:PAR_DESKTOP_SMOKE_HOLD_MS = "180000"
$env:PAR_DESKTOP_USER_DATA = $userData
$env:BACKEND_URL = "http://127.0.0.1:8765"

$proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -ArgumentList @(
    "--user-data-dir=$userData",
    "--disable-gpu"
) -PassThru

$deadline = (Get-Date).AddMinutes(4)
$independent = $false
try {
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $resultPath) {
            try {
                $health = Invoke-WebRequest -Uri "http://127.0.0.1:8765/api/system/health" -UseBasicParsing -TimeoutSec 5
                $live = Invoke-WebRequest -Uri "http://127.0.0.1:8765/api/system/live" -UseBasicParsing -TimeoutSec 5
                $healthJson = $health.Content | ConvertFrom-Json
                $liveJson = $live.Content | ConvertFrom-Json
                if (
                    $health.StatusCode -eq 200 -and
                    $live.StatusCode -eq 200 -and
                    $healthJson.service -eq "personal-ai-runtime" -and
                    $liveJson.service -eq "personal-ai-runtime"
                ) {
                    $independent = $true
                    break
                }
            } catch {
                Write-Host "Waiting for independent health probe: $($_.Exception.Message)"
            }
        }
        if ($proc.HasExited) { break }
        Start-Sleep -Seconds 2
    }

    if (-not (Test-Path -LiteralPath $resultPath)) {
        throw "Smoke result was not written by the installed app"
    }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if (-not $result.ok) {
        throw "Packaged app smoke reported failure: $(Get-Content -LiteralPath $resultPath -Raw)"
    }
    if (-not $result.packaged) {
        throw "Smoke did not run inside the packaged app"
    }
    if ($result.health.service -ne "personal-ai-runtime" -or $result.live.service -ne "personal-ai-runtime") {
        throw "App probe did not see the personal-ai-runtime backend"
    }
    if (-not $independent) {
        throw "Independent health/live probe failed while the installed app was running"
    }
    Write-Host "Installed app and embedded backend responded."
} finally {
    New-Item -ItemType File -Force -Path $donePath | Out-Null
    if (-not $proc.HasExited) {
        $null = $proc.WaitForExit(20000)
    }
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}
