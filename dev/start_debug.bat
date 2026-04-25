@echo off
title Chessist Overlay - Debug
set "ROOT=%~dp0..\"
set "CS_EXE=%ROOT%overlay\bin\Release\net48\ChessistOverlay.exe"

if not exist "%CS_EXE%" (
    echo Overlay exe not found. Run setup.bat first.
    pause
    exit /b 1
)

tasklist /fi "imagename eq ChessistOverlay.exe" 2>nul | find /i "ChessistOverlay.exe" >nul
if not errorlevel 1 (
    echo Killing existing instance...
    taskkill /f /im ChessistOverlay.exe >nul 2>&1
    timeout /t 1 /nobreak >nul
)

echo Starting Chessist Overlay in debug mode...
echo The overlay console will open separately.
echo This window will stay open — close it to quit the overlay.
echo.

"%CS_EXE%" -debug

echo.
echo Overlay exited.
pause
