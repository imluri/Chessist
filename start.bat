@echo off
title Chessist Engine
set "ROOT=%~dp0"
set "CS_EXE=%ROOT%overlay\bin\Release\net48\ChessistEngine.exe"

if not exist "%CS_EXE%" (
    echo ChessistEngine.exe not found. Build it with:
    echo   cd overlay ^&^& dotnet build -c Release
    pause
    exit /b 1
)

tasklist /fi "imagename eq ChessistEngine.exe" 2>nul | find /i "ChessistEngine.exe" >nul
if not errorlevel 1 (
    echo Chessist Engine is already running, restarting...
    taskkill /f /im ChessistEngine.exe >nul 2>&1
    timeout /t 1 /nobreak >nul
)

start "" "%CS_EXE%"

powershell -NoProfile -Command ^
    "Write-Host 'Chessist Engine is running!'; for ($i = 5; $i -ge 1; $i--) { Write-Host \"`rMinimizing in $i seconds...  \" -NoNewline; Start-Sleep 1 }"

exit
