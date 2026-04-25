@echo off
setlocal EnableDelayedExpansion
title Chessist Setup

echo.
echo  ==========================================
echo   Chessist - First-time Setup
echo  ==========================================
echo.

set "ROOT_DIR=%~dp0"
set "HOST_DIR=%ROOT_DIR%native-host\"
set "MANIFEST_PATH=%HOST_DIR%com.chess.live.eval.json"
set "BAT_PATH=%HOST_DIR%stockfish_host.bat"
set "OVERLAY_EXE=%ROOT_DIR%overlay\bin\Release\net48\ChessistOverlay.exe"

:: ── Step 1: Python check ──────────────────────────────────────────────────────
echo [1/4] Checking Python...
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

:: ── Step 2: Install Python dependencies ─────────────────────────────────────
echo.
echo [2/4] Installing Python dependencies (websockets)...
pip install websockets --quiet
if errorlevel 1 (
    echo  WARNING: pip install had errors. You may need to install manually:
    echo    pip install websockets
) else (
    echo  Done.
)

:: ── Step 3: Stockfish ─────────────────────────────────────────────────────────
echo.
echo [3/4] Checking Stockfish...
where stockfish >nul 2>&1
if not errorlevel 1 (
    echo  Stockfish found in PATH.
) else (
    echo  Stockfish not found in PATH.
    echo  Download from: https://stockfishchess.org/download/
    echo.
    set /p "SF_SRC=  Enter full path to stockfish.exe (or press Enter to skip): "
    if not "!SF_SRC!"=="" (
        if exist "!SF_SRC!" (
            echo  Copying to C:\Windows\stockfish.exe...
            copy /y "!SF_SRC!" "C:\Windows\stockfish.exe" >nul 2>&1
            if errorlevel 1 (
                echo  Copy failed (try running as Administrator^), but setup will continue.
                echo  You can also set STOCKFISH_PATH environment variable later.
            ) else (
                echo  Stockfish installed to C:\Windows\stockfish.exe
            )
        ) else (
            echo  File not found: !SF_SRC! — skipping.
            echo  Set STOCKFISH_PATH environment variable to point to your stockfish.exe later.
        )
    ) else (
        echo  Skipped. Set STOCKFISH_PATH environment variable to point to stockfish.exe if needed.
    )
)

:: ── Step 4: Register native messaging ────────────────────────────────────────
echo.
echo [4/4] Registering native messaging host...
echo.
echo  Your extension ID is needed to allow the browser to talk to Stockfish.
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
echo   "description": "Chessist - Native Stockfish Host",
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

:: ── Startup option ────────────────────────────────────────────────────────────
echo.
set /p "ADD_STARTUP=  Add Chessist Overlay to Windows startup? [Y/N]: "
if /i "!ADD_STARTUP!"=="Y" (
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "ChessistOverlay" /t REG_SZ /d "\"!OVERLAY_EXE!\"" /f >nul 2>&1
    echo  Added to startup.
) else (
    echo  Skipped. Start manually with: start.bat
)

echo.
echo  ==========================================
echo   Setup complete!
echo.
echo   Next steps:
echo     1. Restart your browser
echo     2. Open the Chessist extension
echo     3. Select "Native" engine in settings
echo  ==========================================
echo.
endlocal
pause
