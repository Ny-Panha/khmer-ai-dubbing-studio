@echo off
title Khmer AI Dubbing Studio Launcher
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Launcher stopped with exit code %ERRORLEVEL%.
    pause
)
