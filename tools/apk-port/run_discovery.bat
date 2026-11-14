@echo off
REM ==========================================================================
REM  PGR client - discovery run (READ ONLY)
REM
REM  Launches the client through the local logging proxy so we can record
REM  which SDK/CDN hosts it contacts. No game file is modified and no
REM  credential is entered: the game is only driven to the login screen.
REM
REM  Launching the game normally (without this script) keeps the original
REM  behaviour and talks to the official servers.
REM ==========================================================================
setlocal
REM The game directory is NOT modified during this phase.
set "GAME_DIR=E:\Punishing Gray Raven\Punishing Gray Raven Game"
if not exist "%GAME_DIR%\PGR.exe" (
  echo [x] PGR.exe not found in %GAME_DIR%
  pause
  exit /b 1
)

set "HTTP_PROXY=http://127.0.0.1:8899"
set "HTTPS_PROXY=http://127.0.0.1:8899"
set "ALL_PROXY=http://127.0.0.1:8899"
set "http_proxy=http://127.0.0.1:8899"
set "https_proxy=http://127.0.0.1:8899"
set "all_proxy=http://127.0.0.1:8899"

echo [i] Game   : %GAME_DIR%
echo [i] Proxy  : %HTTPS_PROXY%  ^(log: artifacts\hosts.log^)
echo [i] Wait until the login screen appears, then close the game.
echo.
pushd "%GAME_DIR%"
start "" "PGR.exe"
popd
endlocal