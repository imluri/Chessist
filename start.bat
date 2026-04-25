@echo off
title Chessist Overlay
set "ROOT=%~dp0"
set "CS_EXE=%ROOT%overlay\bin\Release\net48\ChessistOverlay.exe"

if not exist "%CS_EXE%" (
    echo Overlay exe not found. Run setup.bat first.
    pause
    exit /b 1
)

tasklist /fi "imagename eq ChessistOverlay.exe" 2>nul | find /i "ChessistOverlay.exe" >nul
if not errorlevel 1 (
    echo Chessist Overlay is already running, restarting...
    taskkill /f /im ChessistOverlay.exe >nul 2>&1
    timeout /t 1 /nobreak >nul
)

start "" "%CS_EXE%"

powershell -NoProfile -Command ^
    "Write-Host 'Chessist Overlay is running!'; for ($i = 5; $i -ge 1; $i--) { Write-Host \"`rMinimizing to tray in $i seconds...  \" -NoNewline; Start-Sleep 1 }"

exit
