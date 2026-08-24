@echo off
rem ---------------------------------------------------------------------------
rem  ssh-web - Windows launcher
rem
rem  Prepares whatever is missing and starts the server. It can be run with a
rem  double click; the first run takes a while because it installs and builds.
rem ---------------------------------------------------------------------------
setlocal

cd /d "%~dp0"
title ssh-web

echo.
echo   SSH-WEB
echo   ----------------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo   [X] Node.js was not found.
    echo.
    echo       Install version 24 or later from https://nodejs.org
    echo       and run this file again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (
    echo   [X] Node.js %NODE_MAJOR% is too old. Version 24 or later is required,
    echo       since that is what runs TypeScript without compiling it.
    echo.
    pause
    exit /b 1
)
echo   [OK] Node.js %NODE_MAJOR% detected

if not exist "node_modules\" (
    echo   [..] Installing dependencies, this takes a couple of minutes
    call npm ci --ignore-scripts --no-audit --no-fund
    if errorlevel 1 (
        echo   [X] Installing dependencies failed.
        pause
        exit /b 1
    )
    echo   [OK] Dependencies installed
)

if not exist ".next\BUILD_ID" (
    echo   [..] Building the application, first run only
    call npm run build
    if errorlevel 1 (
        echo   [X] The build failed.
        pause
        exit /b 1
    )
    echo   [OK] Application built
)

if "%PORT%"=="" set PORT=3030

echo.
echo   Opening http://localhost:%PORT%
echo   To stop the server, close this window or press Ctrl+C
echo.

rem Give the server a moment to start listening before opening the browser.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:%PORT%"

node server.ts

echo.
echo   The server has stopped.
pause
endlocal
