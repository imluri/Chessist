@echo off
title Chessist - Rebuild
set "ROOT=%~dp0..\"
set "CS_EXE=%ROOT%overlay\bin\Release\net48\ChessistOverlay.exe"

echo Building overlay...
dotnet build "%ROOT%overlay\ChessistOverlay.csproj" -c Release
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo.
echo Build succeeded.

tasklist /fi "imagename eq ChessistOverlay.exe" 2>nul | find /i "ChessistOverlay.exe" >nul
if not errorlevel 1 (
    echo Restarting overlay...
    taskkill /f /im ChessistOverlay.exe >nul 2>&1
    timeout /t 1 /nobreak >nul
    start "" "%CS_EXE%"
    echo Overlay restarted.
) else (
    echo Overlay is not running. Use start.bat to launch.
)

pause
