#!/usr/bin/env pwsh
# ==============================================================================
# Khmer AI Dubbing Studio - Full Stack Windows Dev Orchestrator
# Same architecture & robust process management as Koupreng dev.ps1
# Runs: Backend (:5000) + Frontend Studio (:5173)
# ==============================================================================

param (
    [Alias("window")]
    [switch]$NewWindow,

    [Alias("no-install", "fast")]
    [switch]$SkipInstall,

    [Alias("no-browser")]
    [switch]$NoBrowser,

    [Alias("h", "?")]
    [switch]$Help
)

$ErrorActionPreference = "Continue"

# Parse raw args in case flags were passed in Linux style (--new-window, --fast, etc.)
foreach ($arg in $args) {
    switch ($arg) {
        "--new-window"   { $NewWindow = $true }
        "--window"       { $NewWindow = $true }
        "--skip-install" { $SkipInstall = $true }
        "--fast"         { $SkipInstall = $true }
        "--no-install"   { $SkipInstall = $true }
        "--no-browser"   { $NoBrowser = $true }
        "--help"         { $Help = $true }
        "-h"             { $Help = $true }
    }
}

if ($Help) {
    Write-Host "Usage: .\dev.ps1 [OPTIONS]" -ForegroundColor White
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -NewWindow, --new-window         Launch services in separate terminal windows"
    Write-Host "  -SkipInstall, -Fast, --fast      Skip dependency checks"
    Write-Host "  -NoBrowser, --no-browser         Do not auto-open default browser"
    Write-Host "  -Help, -h, --help                Show this help message"
    exit 0
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Resolve root directory
$ScriptDir = Split-Path -Parent $PSCommandPath
if (-not $ScriptDir) { $ScriptDir = $PSScriptRoot }
if (-not $ScriptDir) { $ScriptDir = Get-Location }
$RootDir = (Resolve-Path $ScriptDir).Path
Set-Location $RootDir

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   KHMER AI DUBBING STUDIO - DEV ORCHESTRATOR        " -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Cyan

# Function to forcefully free a busy port and its entire process tree (/T /F)
function Free-Port {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($conn in $conns) {
                if ($conn.OwningProcess -and $conn.OwningProcess -gt 4) {
                    Write-Host "  [*] Freeing busy port :$Port (PID $($conn.OwningProcess))..." -ForegroundColor Yellow
                    Start-Process -FilePath "taskkill.exe" -ArgumentList "/PID $($conn.OwningProcess) /T /F" -NoNewWindow -Wait -ErrorAction SilentlyContinue 2>$null
                }
            }
            Start-Sleep -Milliseconds 400
        }
    } catch {
        $lines = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)"
        foreach ($line in $lines) {
            $pidMatch = $line.Matches[0].Groups[1].Value
            if ($pidMatch -and [int]$pidMatch -gt 4) {
                Write-Host "  [*] Freeing busy port :$Port (PID $pidMatch)..." -ForegroundColor Yellow
                Start-Process -FilePath "taskkill.exe" -ArgumentList "/PID $pidMatch /T /F" -NoNewWindow -Wait -ErrorAction SilentlyContinue 2>$null
            }
        }
    }
}

# Track child process IDs for graceful shutdown
$ProcessIds = [System.Collections.Generic.List[int]]::new()

function Cleanup {
    Write-Host "`n`n[STOP] Shutting down Khmer AI Dubbing Studio services..." -ForegroundColor Yellow
    foreach ($procId in $ProcessIds) {
        if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath "taskkill.exe" -ArgumentList "/PID $procId /T /F" -NoNewWindow -Wait -ErrorAction SilentlyContinue 2>$null
        }
    }

    Free-Port 5000
    Free-Port 5173
    Write-Host "[OK] All services stopped cleanly.`n" -ForegroundColor Green
}

# Helper to start process
function Start-DevProcess {
    param(
        [string]$Title,
        [string]$WorkingDir,
        [string]$Command
    )

    $fullCmd = "cd /d `"$WorkingDir`" && $Command"
    if ($NewWindow) {
        $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/k title $Title && $fullCmd" -WorkingDirectory $WorkingDir -PassThru
    } else {
        $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $fullCmd" -WorkingDirectory $WorkingDir -PassThru -NoNewWindow
    }
    if ($proc -and $proc.Id) {
        $ProcessIds.Add($proc.Id)
    }
    return $proc
}

function Ensure-Dependencies {
    param(
        [string]$WorkingDir,
        [string]$Name
    )

    if ($SkipInstall) { return }

    $nodeModules = Join-Path $WorkingDir "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host "  Installing $Name dependencies..." -ForegroundColor Cyan
        Push-Location $WorkingDir
        try {
            & npm.cmd install
        } finally {
            Pop-Location
        }
    }
}

function Wait-ForBackend {
    param([int]$Port = 5000)
    $baseUrl = "http://127.0.0.1:$Port/api/health"
    $startupTimeoutSeconds = 30
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "  Waiting for Backend API to initialize..." -ForegroundColor Cyan
    while ($timer.Elapsed.TotalSeconds -lt $startupTimeoutSeconds) {
        try {
            $resp = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Host "  [OK] Backend API is READY at http://localhost:$Port" -ForegroundColor Green
                return
            }
        } catch {}
        Start-Sleep -Milliseconds 600
    }
    Write-Host "  [!] Backend taking longer to respond, continuing..." -ForegroundColor Yellow
}

function Wait-ForFrontend {
    param([int]$Port = 5173)
    $baseUrl = "http://127.0.0.1:$Port"
    $startupTimeoutSeconds = 30
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "  Waiting for Frontend Studio to initialize..." -ForegroundColor Cyan
    while ($timer.Elapsed.TotalSeconds -lt $startupTimeoutSeconds) {
        try {
            $resp = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Host "  [OK] Frontend Studio is READY at http://localhost:$Port" -ForegroundColor Green
                return
            }
        } catch {}
        Start-Sleep -Milliseconds 600
    }
    Write-Host "  [!] Frontend taking longer to respond, continuing..." -ForegroundColor Yellow
}

try {
    # 1. Clean existing processes
    Write-Host "`n[1/3] Checking and clearing ports 5000 & 5173..." -ForegroundColor White
    Free-Port 5000
    Free-Port 5173

    # 2. Launch Backend
    Write-Host "`n[2/3] Starting Backend API (Port 5000)..." -ForegroundColor White
    $backendDir = Join-Path $RootDir "backend"
    Ensure-Dependencies -WorkingDir $backendDir -Name "Backend"
    $backendCmd = "node --watch-path=server.js --watch-path=services --watch-path=models server.js"
    $null = Start-DevProcess -Title "[Khmer AI Dubbing] Backend API" -WorkingDir $backendDir -Command $backendCmd
    Wait-ForBackend -Port 5000

    # 3. Launch Frontend
    Write-Host "`n[3/3] Starting Frontend Studio (Port 5173)..." -ForegroundColor White
    $frontendDir = Join-Path $RootDir "frontend"
    Ensure-Dependencies -WorkingDir $frontendDir -Name "Frontend"
    $frontendCmd = "npm.cmd run dev"
    $null = Start-DevProcess -Title "[Khmer AI Dubbing] Frontend Studio" -WorkingDir $frontendDir -Command $frontendCmd
    Wait-ForFrontend -Port 5173

    # 4. Open Browser
    if (-not $NoBrowser) {
        Write-Host "`n[*] Opening Web Studio in browser: http://localhost:5173" -ForegroundColor Yellow
        Start-Process "http://localhost:5173"
    }

    # Status Banner
    Write-Host "`n======================================================" -ForegroundColor Green
    Write-Host "   ALL SERVICES RUNNING SUCCESSFULLY!" -ForegroundColor Green
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host "  - Frontend Studio: http://localhost:5173" -ForegroundColor Cyan
    Write-Host "  - Backend API:     http://localhost:5000" -ForegroundColor Cyan
    Write-Host "  - Health Check:    http://localhost:5000/api/health" -ForegroundColor Cyan
    Write-Host "------------------------------------------------------"
    Write-Host "  [*] Press [Ctrl + C] anytime to stop all services." -ForegroundColor Yellow
    Write-Host "======================================================`n"

    # Keep alive until user interrupts with Ctrl+C
    while ($true) {
        Start-Sleep -Seconds 1
    }
}
finally {
    Cleanup
}
