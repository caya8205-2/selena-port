@echo off
rem Selena-port control centre: prepares dependencies and runs the stack.
rem Double-click this file, or pass an action: start, stop, status, prepare, game.
setlocal
set SCRIPT=%~dp0SelenaPort-ControlCenter.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action %*
if "%~1"=="" pause