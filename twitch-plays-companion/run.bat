@echo off
title Twitch Plays Companion Launcher
echo =======================================
echo     TWITCH PLAYS COMPANION LAUNCHER    
echo =======================================
echo.

cd /d "%~dp0"

echo [1/3] Checking and installing Node dependencies...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to install npm dependencies!
    echo Please make sure Node.js and NPM are installed correctly.
    pause
    exit /b %errorlevel%
)
echo ✔ Dependencies installed.
echo.

echo [2/3] Starting web server in a moment...
echo ✔ Server launching at http://localhost:8080
echo.

rem echo [3/3] Launching your Streamer Dashboard...
rem start "" "http://localhost:8080"
rem echo.

echo ===================================================
echo             SERVER LOGS - COMMAND STREAM           
echo ===================================================
echo.
node server.js
pause
