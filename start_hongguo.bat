@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Hongguo PC Launcher

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "PKG_NAME=com.phoenix.read.oversea.gp"
set "LAUNCH_ACTIVITY=com.phoenix.read.oversea.gp/com.dragon.read.pages.splash.SplashActivity"
set "PREFERRED_AVD=Medium_Phone_API_37.0"
set "APK_DIR=%SCRIPT_DIR%\Hongguo_APK"

echo ==================================================
echo   Hongguo PC Standalone Launcher (No Phone / USB)
echo ==================================================

REM 1. Auto-detect Android SDK
set "SDK_DIR="
if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" set "SDK_DIR=%ANDROID_SDK_ROOT%"
if not defined SDK_DIR if defined ANDROID_HOME if exist "%ANDROID_HOME%\platform-tools\adb.exe" set "SDK_DIR=%ANDROID_HOME%"
if not defined SDK_DIR if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "SDK_DIR=%LOCALAPPDATA%\Android\Sdk"

if not defined SDK_DIR (
    echo [ERROR] Android SDK not found. Expected at: "%LOCALAPPDATA%\Android\Sdk"
    pause
    exit /b 1
)

set "ANDROID_SDK_ROOT=%SDK_DIR%"
set "ANDROID_HOME=%SDK_DIR%"
set "ADB_EXE=%SDK_DIR%\platform-tools\adb.exe"
set "EMU_EXE=%SDK_DIR%\emulator\emulator.exe"

if not exist "%EMU_EXE%" (
    echo [ERROR] Android Emulator not found at: "%EMU_EXE%"
    pause
    exit /b 1
)

echo [OK] Android SDK: "%SDK_DIR%"

REM 2. Auto-detect AVD (prefer Medium_Phone_API_37.0, else first listed AVD)
set "AVD_NAME="
for /f "usebackq delims=" %%A in (`""%EMU_EXE%" -list-avds 2>nul"`) do (
    if /i "%%A"=="%PREFERRED_AVD%" set "AVD_NAME=%%A"
    if not defined AVD_NAME set "AVD_NAME=%%A"
)

if not defined AVD_NAME (
    echo [ERROR] No Android Virtual Device found.
    pause
    exit /b 1
)

echo [OK] Target AVD: %AVD_NAME%

REM 3. Ensure ADB daemon is running and check for running emulator-* (ignores USB phones)
"%ADB_EXE%" start-server >nul 2>&1
set "EMU_SERIAL="
call :FIND_EMU
if defined EMU_SERIAL (
    echo [OK] Reusing running emulator: !EMU_SERIAL!
    goto :WAIT_BOOT
)

REM 4. Clean stale AVD lock files only when QEMU is not running
tasklist /fi "imagename eq qemu-system-x86_64.exe" 2>nul | find /i "qemu-system-x86_64.exe" >nul
if errorlevel 1 (
    set "AVD_FOLDER="
    if exist "%USERPROFILE%\.android\avd\%AVD_NAME%.ini" (
        for /f "usebackq tokens=1,* delims==" %%K in ("%USERPROFILE%\.android\avd\%AVD_NAME%.ini") do (
            if /i "%%K"=="path" set "AVD_FOLDER=%%L"
        )
    )
    if defined AVD_FOLDER if exist "!AVD_FOLDER!" (
        del /q "!AVD_FOLDER!\*.lock" >nul 2>&1
        for /d %%L in ("!AVD_FOLDER!\*.lock") do rmdir /s /q "%%L" >nul 2>&1
    )
)

echo [INFO] Starting Android Emulator "%AVD_NAME%"...
start "Hongguo Emulator" /D "%SDK_DIR%\emulator" "%EMU_EXE%" -avd "%AVD_NAME%" -no-boot-anim

echo [INFO] Waiting for emulator ADB device...
for /L %%I in (1,1,60) do (
    call :FIND_EMU
    if defined EMU_SERIAL goto :WAIT_BOOT
    ping -n 3 127.0.0.1 >nul
)

echo [ERROR] Timed out waiting for emulator to connect to ADB.
if not defined HONGGUO_NO_PAUSE pause
exit /b 1

:WAIT_BOOT
echo [INFO] Waiting for Android system boot on !EMU_SERIAL!...
set "BOOTED="
for /L %%I in (1,1,60) do (
    for /f "usebackq delims=" %%B in (`""%ADB_EXE%" -s !EMU_SERIAL! shell getprop sys.boot_completed 2>nul"`) do (
        if "%%B"=="1" set "BOOTED=1"
    )
    if defined BOOTED goto :CHECK_APP
    ping -n 3 127.0.0.1 >nul
)

echo [ERROR] Emulator connected ^(!EMU_SERIAL!^), but Android boot did not complete in time.
pause
exit /b 1

:CHECK_APP
echo [OK] Android booted on !EMU_SERIAL!.

REM 5. Avoid repeated install if Hongguo is already installed
set "PKG_FOUND="
for /f "usebackq delims=" %%P in (`""%ADB_EXE%" -s !EMU_SERIAL! shell pm list packages %PKG_NAME% 2>nul"`) do (
    echo %%P | findstr /c:"package:%PKG_NAME%" >nul && set "PKG_FOUND=1"
)

if defined PKG_FOUND (
    echo [OK] Hongguo ^(%PKG_NAME%^) already installed. Preserving app data and session.
    goto :LAUNCH_APP
)

echo [INFO] Hongguo not installed yet. Installing Split APKs from "%APK_DIR%"...
if not exist "%APK_DIR%\base.apk" (
    echo [ERROR] Missing APK file: "%APK_DIR%\base.apk"
    pause
    exit /b 1
)

set "APK_ARGS="%APK_DIR%\base.apk""
if exist "%APK_DIR%\split_config.arm64_v8a.apk" set "APK_ARGS=!APK_ARGS! "%APK_DIR%\split_config.arm64_v8a.apk""
if exist "%APK_DIR%\split_config.xxhdpi.apk" set "APK_ARGS=!APK_ARGS! "%APK_DIR%\split_config.xxhdpi.apk""

"%ADB_EXE%" -s !EMU_SERIAL! install-multiple -r !APK_ARGS!
if errorlevel 1 (
    echo [ERROR] Failed to install Hongguo Split APKs.
    pause
    exit /b 1
)
echo [OK] Hongguo installation succeeded.

:LAUNCH_APP
set "IN_FRONT="
"%ADB_EXE%" -s !EMU_SERIAL! shell dumpsys window > "%TEMP%\hongguo_win.tmp" 2>nul
for /f "usebackq delims=" %%F in (`"findstr /c:"mCurrentFocus" "%TEMP%\hongguo_win.tmp" 2>nul"`) do (
    echo %%F | findstr /c:"%PKG_NAME%" >nul && set "IN_FRONT=1"
)
del /q "%TEMP%\hongguo_win.tmp" >nul 2>&1
if defined IN_FRONT (
    echo [OK] Hongguo is already active in foreground on !EMU_SERIAL!.
    exit /b 0
)

echo [INFO] Launching Hongguo on !EMU_SERIAL!...
set "RESOLVED_ACT="
for /f "usebackq delims=" %%C in (`""%ADB_EXE%" -s !EMU_SERIAL! shell cmd package resolve-activity --brief %PKG_NAME% 2>nul"`) do (
    echo %%C | findstr /c:"/" >nul && set "RESOLVED_ACT=%%C"
)
if not defined RESOLVED_ACT set "RESOLVED_ACT=%LAUNCH_ACTIVITY%"

set "LAUNCH_OK="
for /L %%T in (1,1,2) do (
    if not defined LAUNCH_OK (
        "%ADB_EXE%" -s !EMU_SERIAL! shell am start -W -n "!RESOLVED_ACT!" >nul 2>&1
        if errorlevel 1 (
            "%ADB_EXE%" -s !EMU_SERIAL! shell monkey -p %PKG_NAME% -c android.intent.category.LAUNCHER 1 >nul 2>&1
        )
        ping -n 5 127.0.0.1 >nul
        for /f "usebackq delims=" %%K in (`""%ADB_EXE%" -s !EMU_SERIAL! shell pidof %PKG_NAME% 2>nul"`) do (
            if not "%%K"=="" set "LAUNCH_OK=1"
        )
        if not defined LAUNCH_OK echo [WARN] Hongguo startup did not settle ^(attempt %%T^), retrying...
    )
)
if not defined LAUNCH_OK (
    echo [ERROR] Failed to launch %PKG_NAME%.
    if not defined HONGGUO_NO_PAUSE pause
    exit /b 1
)

echo [OK] Hongguo launched successfully on !EMU_SERIAL!.
exit /b 0

:FIND_EMU
set "EMU_SERIAL="
for /f "usebackq tokens=1,2" %%D in (`""%ADB_EXE%" devices 2>nul"`) do (
    if "%%E"=="device" (
        echo %%D | findstr /b /c:"emulator-" >nul && if not defined EMU_SERIAL set "EMU_SERIAL=%%D"
    )
)
exit /b 0
