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
$ColdStartRuns = 5

function Get-Median([int[]]$Values) {
    if ($null -eq $Values -or $Values.Count -eq 0) { return $null }
    $sorted = @($Values | Sort-Object)
    $n = $sorted.Count
    if ($n -eq 0) { return $null }
    if ($n % 2 -eq 1) { return [int]$sorted[[int](($n - 1) / 2)] }
    $lower = [int]$sorted[($n / 2) - 1]
    $upper = [int]$sorted[$n / 2]
    return [int][Math]::Round(($lower + $upper) / 2.0)
}

function Test-BackendPortBusy {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect("127.0.0.1", 8765, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne(400, $false)) { return $false }
        $client.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-BackendPortFree {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-BackendPortBusy)) { return }
        Start-Sleep -Milliseconds 400
    }
    throw "Port 8765 stayed busy before the next cold start"
}

function Stop-SmokeProcess($Proc) {
    if ($null -eq $Proc -or $Proc.HasExited) { return }
    $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
    $null = Start-Process -FilePath $taskkill -ArgumentList @("/PID", "$($Proc.Id)", "/T", "/F") -Wait -WindowStyle Hidden -PassThru
    if (-not $Proc.HasExited) {
        $null = $Proc.WaitForExit(10000)
    }
}

$env:PAR_DESKTOP_SMOKE = "1"
$env:PAR_DESKTOP_SMOKE_RESULT = $resultPath
$env:PAR_DESKTOP_SMOKE_DONE = $donePath
$env:PAR_DESKTOP_SMOKE_HOLD_MS = "180000"
$env:BACKEND_URL = "http://127.0.0.1:8765"

$backendSamples = New-Object System.Collections.Generic.List[int]
$todaySamples = New-Object System.Collections.Generic.List[int]
$dashboardSamples = New-Object System.Collections.Generic.List[int]

for ($run = 1; $run -le $ColdStartRuns; $run++) {
    $userData = Join-Path $work "user-data-$run"
    if (Test-Path -LiteralPath $userData) { Remove-Item -LiteralPath $userData -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $userData | Out-Null
    if (Test-Path -LiteralPath $resultPath) { Remove-Item -LiteralPath $resultPath -Force }
    if (Test-Path -LiteralPath $donePath) { Remove-Item -LiteralPath $donePath -Force }
    $env:PAR_DESKTOP_USER_DATA = $userData
    Wait-BackendPortFree

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
            throw "Smoke result was not written by the installed app on run $run"
        }
        $raw = Get-Content -LiteralPath $resultPath -Raw
        $result = $raw | ConvertFrom-Json
        if (-not $result.ok) {
            throw "Packaged app smoke reported failure on run ${run}: $raw"
        }
        if (-not $result.packaged) {
            throw "Smoke did not run inside the packaged app on run $run"
        }
        if ($result.health.service -ne "personal-ai-runtime" -or $result.live.service -ne "personal-ai-runtime") {
            throw "App probe did not see the personal-ai-runtime backend on run $run"
        }
        if (-not $independent) {
            throw "Independent health/live probe failed while the installed app was running on run $run"
        }
        if (-not $result.coldStart -or -not $result.coldStart.todayOk) {
            throw "Today page was not usable on run ${run}: $raw"
        }
        $backendReady = [int]$result.coldStart.backendReadyMs
        $todayReady = [int]$result.coldStart.todayReadyMs
        $backendSamples.Add($backendReady)
        $todaySamples.Add($todayReady)
        $dashboardText = "null"
        if ($null -ne $result.coldStart.dashboardMs) {
            $dashboardSamples.Add([int]$result.coldStart.dashboardMs)
            $dashboardText = [string]$result.coldStart.dashboardMs
        }
        $phases = ""
        if ($result.coldStart.phases) {
            $phases = $result.coldStart.phases | ConvertTo-Json -Compress
        }
        Write-Host ("Cold start run={0} backendReadyMs={1} todayReadyMs={2} dashboardMs={3} probeMs={4} sinceLaunchMs={5} phases={6}" -f `
            $run, $backendReady, $todayReady, $dashboardText, $result.coldStart.probeMs, $result.coldStart.sinceLaunchMs, $phases)
    } finally {
        New-Item -ItemType File -Force -Path $donePath | Out-Null
        if (-not $proc.HasExited) {
            $null = $proc.WaitForExit(20000)
        }
        Stop-SmokeProcess $proc
    }
}

$backendMedian = Get-Median $backendSamples.ToArray()
$todayMedian = Get-Median $todaySamples.ToArray()
$backendMax = ($backendSamples | Measure-Object -Maximum).Maximum
$todayMax = ($todaySamples | Measure-Object -Maximum).Maximum
$dashboardMedian = Get-Median $dashboardSamples.ToArray()
$dashboardMax = $null
if ($dashboardSamples.Count -gt 0) {
    $dashboardMax = ($dashboardSamples | Measure-Object -Maximum).Maximum
}
Write-Host ("Cold start median backendReadyMs={0} todayReadyMs={1} dashboardMs={2} max backendReadyMs={3} todayReadyMs={4} dashboardMs={5} runs={6}" -f `
    $backendMedian, $todayMedian, $dashboardMedian, $backendMax, $todayMax, $dashboardMax, $ColdStartRuns)
Write-Host "Installed app and embedded backend responded."
