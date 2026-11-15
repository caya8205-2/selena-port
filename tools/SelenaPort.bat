@echo off
rem Selena-port control centre: prepares dependencies and runs the stack.
rem Double-click this file, or pass an action: start, stop, status, prepare, game.
setlocal
set SCRIPT=%~dp0SelenaPort-ControlCenter.ps1
if "%~1"=="" (
    rem No action: open the window. Nothing to pause for afterwards.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action %*
    pause
)