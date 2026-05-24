@echo off
setlocal EnableDelayedExpansion
title Chessist Setup

echo.
echo  ==========================================
echo   Chessist - Setup
echo  ==========================================
echo.

set "ROOT_DIR=%~dp0"
set "HOST_DIR=%ROOT_DIR%native-host\"
set "MANIFEST_PATH=%HOST_DIR%com.chess.live.eval.json"
set "BAT_PATH=%HOST_DIR%stockfish_host.bat"
set "ENGINE_EXE=%ROOT_DIR%overlay\bin\Release\net48\ChessistEngine.exe"

:: ── Step 1: Python check ──────────────────────────────────────────────────────
echo [1/3] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Python is not installed or not in PATH.
    echo  Download it from https://www.python.org/downloads/
    echo  Make sure to check "Add Python to PATH" during install.
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo  Found: %%v

:: ── Step 2: Register native messaging ────────────────────────────────────────
echo.
echo [2/3] Registering native messaging host...
echo.
echo  Your extension ID is needed to allow the browser to launch Chessist Engine.
echo  To find it:
echo    1. Open chrome://extensions  (or brave://extensions^)
echo    2. Enable "Developer mode" (toggle top-right^)
echo    3. Find "Chessist" and copy the ID shown below the name
echo.
if not "%~1"=="" (
    set "EXT_ID=%~1"
    echo  Using extension ID from argument: !EXT_ID!
) else (
    set /p "EXT_ID=  Paste your extension ID: "
)

if "!EXT_ID!"=="" (
    echo  ERROR: Extension ID cannot be empty.
    pause & exit /b 1
)

set "TEMP_MANIFEST=%TEMP%\chessist_manifest.json"
(
echo {
echo   "name": "com.chess.live.eval",
echo   "description": "Chessist - Engine Launcher",
echo   "path": "%BAT_PATH:\=\\%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://!EXT_ID!/"
echo   ]
echo }
) > "!TEMP_MANIFEST!"
copy /y "!TEMP_MANIFEST!" "%MANIFEST_PATH%" >nul
del "!TEMP_MANIFEST!" 2>nul

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chess.live.eval" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.chess.live.eval" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
echo  Registered for Chrome and Brave.

:: ── Step 3: Startup option ────────────────────────────────────────────────────
echo.
echo [3/3] Startup configuration...
if not exist "%ENGINE_EXE%" (
    echo  ChessistEngine.exe not found — skipping startup registration.
    echo  Build it with: cd overlay ^&^& dotnet build -c Release
    goto :done
)

set /p "ADD_STARTUP=  Add ChessistEngine to Windows startup? [Y/N]: "
if /i "!ADD_STARTUP!"=="Y" (
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "ChessistEngine" /t REG_SZ /d "\"!ENGINE_EXE!\"" /f >nul 2>&1
    echo  Added to startup.
) else (
    echo  Skipped. The engine will auto-launch when you enable Overlay Mode in the popup.
)

:done
echo.
echo  ==========================================
echo   Setup complete!
echo.
echo   Next steps:
echo     1. Reload the Chessist extension in chrome://extensions
echo     2. Open the extension popup
echo     3. Enable Overlay Mode — the engine starts automatically.
echo        Falls back to built-in WASM if not running.
echo  ==========================================
echo.
endlocal
pause
