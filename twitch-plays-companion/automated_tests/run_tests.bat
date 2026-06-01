@echo off
title Twitch Plays Companion - Test Runner
echo ===================================================
echo     TWITCH PLAYS COMPANION - AUTOMATED TEST RUNNER  
echo ===================================================
echo.

cd /d "%~dp0"

echo [STEP 1/3] Verifying and installing dependencies...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to install npm dependencies!
    pause
    exit /b %errorlevel%
)
echo ✔ NPM dependencies ready.
echo.

echo [STEP 2/3] Running API and Queue Integration Tests...
node test_server_api.js
if %errorlevel% neq 0 (
    echo.
    echo ❌ [FAIL] API Integration tests failed!
    pause
    exit /b %errorlevel%
)
echo.

echo [STEP 3/3] Running Chat and Democracy Simulation Tests...
node test_chat_simulation.js
if %errorlevel% neq 0 (
    echo.
    echo ❌ [FAIL] Chat Simulation tests failed!
    pause
    exit /b %errorlevel%
)
echo.

echo ===================================================
echo   🎉 ALL AUTOMATED TESTS COMPLETED SUCCESSFULLY!  
echo ===================================================
echo.
pause
